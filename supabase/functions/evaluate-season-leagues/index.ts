// evaluate-season-leagues — Season Long completion evaluator
//
// Phase 2b: competition-based (creation_path = 'competition') only.
// Path A (team-based) leagues are explicitly skipped — team_competition_status
// signal not yet populated.
//
// Decision tree per league:
//   1. All league_fixtures terminal?           → no  → defer (active)
//   2. sports_competitions.current_season_end present + fresh? → no → defer (awaiting_fixtures)
//   3. current_season_end <= today?            → no  → defer (awaiting_fixtures)
//   4. Pending questions == 0?                 → no  → defer (pending_resolution)
//   5. Finalize: scores, ranks, winner, completed_at, lifecycle_status = 'completed'
//
// Terminal fixture statuses: FT, AET, PEN, CANC, ABD, AWD, WO
// PST (postponed) is NOT terminal — the fixture may be rescheduled.
//
// Idempotent: completed leagues are never touched again.
// Dry run: pass ?dry_run=1 or { dry_run: true } in body — reads + logs, no writes.
//
// Deploy: supabase functions deploy evaluate-season-leagues --no-verify-jwt
// Manual: curl "<url>/functions/v1/evaluate-season-leagues?dry_run=1" -H "Authorization: Bearer <CRON_SECRET>"
// Cron:   schedule via pg_cron — recommended daily at 04:00 UTC after sync-fixtures-season-meta (03:00 UTC).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Constants ─────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO']);

// Defer if season_end data is older than 48h — may be stale after a sync failure.
const SEASON_END_STALE_MS = 48 * 60 * 60 * 1000;

// ── Entry point ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const auth   = req.headers.get('Authorization') ?? '';
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  if (!auth.includes(secret)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const url = new URL(req.url);
  let dryRun = url.searchParams.get('dry_run') === '1' || url.searchParams.get('dry_run') === 'true';
  try {
    const body = await req.json().catch(() => ({}));
    if (body.dry_run === true || body.dry_run === '1') dryRun = true;
  } catch { /* ignore */ }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  console.log(`[evaluator] starting — dry_run=${dryRun}`);

  const stats = {
    dry_run:   dryRun,
    evaluated: 0,
    completed: 0,
    deferred:  [] as Array<{ leagueId: string; reason: string }>,
    skipped:   [] as Array<{ leagueId: string; reason: string }>,
    errors:    [] as Array<{ leagueId: string; error: string }>,
  };

  try {
    // Fetch all eligible season_long competition leagues.
    // Excludes: already completed, Path A (team), non-season_long.
    const { data: leagues, error: leagueErr } = await sb
      .from('leagues')
      .select(`
        id, name, sport,
        api_sports_league_id, api_sports_league_ids,
        creation_path, league_type, lifecycle_status
      `)
      .eq('league_type', 'season_long')
      .eq('creation_path', 'competition')
      .in('lifecycle_status', ['active', 'awaiting_fixtures', 'pending_resolution']);

    if (leagueErr) throw new Error(`league fetch failed: ${leagueErr.message}`);

    if (!leagues || leagues.length === 0) {
      console.log('[evaluator] no eligible leagues found');
      return jsonOk({ ...stats, message: 'no eligible leagues' });
    }

    console.log(`[evaluator] ${leagues.length} eligible league(s) found`);

    for (const league of leagues as any[]) {
      stats.evaluated++;
      try {
        const outcome = await evaluateLeague(sb, league, dryRun);
        if (outcome.completed) {
          stats.completed++;
        } else {
          stats.deferred.push({ leagueId: league.id, reason: outcome.reason ?? 'unknown' });
        }
      } catch (err) {
        const msg = String(err);
        console.error(`[evaluator] error for league ${league.id}:`, msg);
        stats.errors.push({ leagueId: league.id, error: msg });
      }
    }
  } catch (err) {
    console.error('[evaluator] fatal:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }

  console.log(`[evaluator] done — evaluated=${stats.evaluated} completed=${stats.completed} deferred=${stats.deferred.length} errors=${stats.errors.length}`);
  return jsonOk(stats);
});

// ── Per-league evaluation ─────────────────────────────────────────────────

async function evaluateLeague(
  sb: any,
  league: any,
  dryRun: boolean,
): Promise<{ completed: boolean; reason?: string }> {
  const leagueId = league.id as string;
  const today    = todayStr();

  // Resolve competition ID — prefer api_sports_league_ids[0] (post-migration-051),
  // fall back to legacy api_sports_league_id.
  const compId: number | null =
    (Array.isArray(league.api_sports_league_ids) && league.api_sports_league_ids.length > 0)
      ? league.api_sports_league_ids[0]
      : (league.api_sports_league_id ?? null);

  if (!compId) {
    const reason = 'no_competition_id';
    console.log(`[evaluator] league ${leagueId} — SKIP: ${reason}`);
    await writeDefer(sb, leagueId, reason, dryRun);
    return { completed: false, reason };
  }

  // ── STEP 1: Fixture scope check ──────────────────────────────────────────
  // league_fixtures rows must all be in a terminal state.
  // NULL fixture_status = not yet synced → treated as unfinished (safe default).
  const { data: fixtures, error: fxErr } = await sb
    .from('league_fixtures')
    .select('fixture_id, fixture_status')
    .eq('league_id', leagueId);

  if (fxErr) throw new Error(`league_fixtures fetch failed: ${fxErr.message}`);

  if (!fixtures || fixtures.length === 0) {
    // No league_fixtures rows — league predates Phase 1 or was created with no fixtures.
    // Cannot safely evaluate without an explicit fixture scope. Defer indefinitely.
    const reason = 'no_league_fixtures_rows';
    console.log(`[evaluator] league ${leagueId} — DEFER: ${reason}`);
    await writeDefer(sb, leagueId, reason, dryRun);
    return { completed: false, reason };
  }

  const unfinished = (fixtures as any[]).filter(
    (f) => !TERMINAL_STATUSES.has(f.fixture_status ?? ''),
  );

  if (unfinished.length > 0) {
    const reason = `fixtures_not_complete:${unfinished.length}_of_${fixtures.length}`;
    console.log(`[evaluator] league ${leagueId} — DEFER: ${reason}`);
    // Fixtures still in progress → league should be 'active', not awaiting_fixtures.
    await writeLifecycle(sb, leagueId, 'active', reason, dryRun);
    return { completed: false, reason };
  }

  // All fixtures are terminal.
  console.log(`[evaluator] league ${leagueId} — all ${fixtures.length} fixture(s) terminal`);

  // ── STEP 2: Season end signal check ─────────────────────────────────────
  const { data: comp, error: compErr } = await sb
    .from('sports_competitions')
    .select('current_season_end, season_end_synced_at')
    .eq('api_league_id', compId)
    .eq('sport', league.sport)
    .maybeSingle();

  if (compErr) throw new Error(`sports_competitions fetch failed: ${compErr.message}`);

  if (!comp || !comp.current_season_end) {
    const reason = 'season_end_unknown';
    console.log(`[evaluator] league ${leagueId} — DEFER: ${reason} (comp ${compId})`);
    await writeLifecycle(sb, leagueId, 'awaiting_fixtures', reason, dryRun);
    return { completed: false, reason };
  }

  // Staleness guard — if the season_end data hasn't been refreshed in 48h, defer.
  // Avoids acting on stale data after a sync job failure.
  if (comp.season_end_synced_at) {
    const ageMs = Date.now() - new Date(comp.season_end_synced_at).getTime();
    if (ageMs > SEASON_END_STALE_MS) {
      const reason = `season_end_data_stale:${Math.round(ageMs / 3600000)}h_old`;
      console.log(`[evaluator] league ${leagueId} — DEFER: ${reason}`);
      await writeDefer(sb, leagueId, reason, dryRun);
      return { completed: false, reason };
    }
  }

  if (comp.current_season_end > today) {
    const reason = `season_end_future:${comp.current_season_end}`;
    console.log(`[evaluator] league ${leagueId} — DEFER: ${reason}`);
    await writeLifecycle(sb, leagueId, 'awaiting_fixtures', reason, dryRun);
    return { completed: false, reason };
  }

  // Season has officially ended.
  console.log(`[evaluator] league ${leagueId} — season ended ${comp.current_season_end}`);

  // ── STEP 3: Questions drain check ────────────────────────────────────────
  const { count: pendingCount, error: pendingErr } = await sb
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('resolution_status', 'pending');

  if (pendingErr) throw new Error(`pending questions check failed: ${pendingErr.message}`);

  if ((pendingCount ?? 0) > 0) {
    const reason = `pending_questions:${pendingCount}`;
    console.log(`[evaluator] league ${leagueId} — DEFER: ${reason}`);
    await writeLifecycle(sb, leagueId, 'pending_resolution', reason, dryRun);
    return { completed: false, reason };
  }

  // ── STEP 4: Finalize ─────────────────────────────────────────────────────
  console.log(`[evaluator] league ${leagueId} — all checks passed → FINALIZING${dryRun ? ' (DRY RUN — no writes)' : ''}`);

  if (!dryRun) {
    await finalizeLeague(sb, leagueId);
  }

  return { completed: true };
}

// ── Finalization ──────────────────────────────────────────────────────────

async function finalizeLeague(sb: any, leagueId: string) {
  // 1. Fetch all league members.
  const { data: members, error: membersErr } = await sb
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId);

  if (membersErr) throw new Error(`league_members fetch failed: ${membersErr.message}`);

  if (!members || members.length === 0) {
    console.log(`[evaluator] league ${leagueId} — no members, marking completed with no rankings`);
    await markCompleted(sb, leagueId, null);
    return;
  }

  const memberUserIds: string[] = (members as any[]).map((m) => m.user_id);

  // 2. Fetch all resolved question IDs for this league.
  const { data: resolvedQs, error: qErr } = await sb
    .from('questions')
    .select('id')
    .eq('league_id', leagueId)
    .eq('resolution_status', 'resolved');

  if (qErr) throw new Error(`resolved questions fetch failed: ${qErr.message}`);

  const resolvedQIds = new Set<string>((resolvedQs ?? []).map((q: any) => String(q.id)));

  // 3. Fetch player_answers for those questions.
  //    Only fetch for member users (avoids pulling spectator/removed-member answers).
  let answerRows: any[] = [];
  if (resolvedQIds.size > 0) {
    const { data: answers, error: answersErr } = await sb
      .from('player_answers')
      .select('user_id, question_id, points_earned')
      .in('question_id', [...resolvedQIds])
      .in('user_id', memberUserIds);

    if (answersErr) throw new Error(`player_answers fetch failed: ${answersErr.message}`);
    answerRows = answers ?? [];
  }

  // 4. Build points map — initialise every member at 0 (no-answer members rank last).
  const pointsMap = new Map<string, number>();
  for (const uid of memberUserIds) pointsMap.set(uid, 0);

  for (const row of answerRows) {
    if (!resolvedQIds.has(String(row.question_id))) continue;
    pointsMap.set(row.user_id, (pointsMap.get(row.user_id) ?? 0) + (row.points_earned ?? 0));
  }

  // 5. Sort descending by points; assign RANK (ties share rank, next rank skips).
  const sorted = [...pointsMap.entries()].sort((a, b) => b[1] - a[1]);

  const rankMap = new Map<string, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i][1] < sorted[i - 1][1]) rank = i + 1;
    rankMap.set(sorted[i][0], rank);
  }

  // 6. Write final_points + final_rank to each league_members row.
  for (const [userId, totalPoints] of pointsMap.entries()) {
    const finalRank = rankMap.get(userId) ?? sorted.length;
    const { error: updateErr } = await sb
      .from('league_members')
      .update({ final_points: totalPoints, final_rank: finalRank })
      .eq('league_id', leagueId)
      .eq('user_id', userId);

    if (updateErr) {
      console.warn(`[evaluator] final_points write failed — league=${leagueId} user=${userId}:`, updateErr.message);
    }
  }

  // 7. Winner = first rank-1 user in sorted array (deterministic; trophy system not built yet).
  const winnerEntry = sorted.find(([, pts]) => pts === sorted[0][1]);
  const winnerId    = winnerEntry ? winnerEntry[0] : null;

  // 8. Mark league completed.
  await markCompleted(sb, leagueId, winnerId);

  console.log(
    `[evaluator] COMPLETED — league=${leagueId} winner=${winnerId} ` +
    `members=${members.length} top_score=${sorted[0]?.[1] ?? 0}`,
  );
}

// ── DB write helpers ──────────────────────────────────────────────────────

async function markCompleted(sb: any, leagueId: string, winnerId: string | null) {
  const { error } = await sb
    .from('leagues')
    .update({
      lifecycle_status:           'completed',
      completed_at:               new Date().toISOString(),
      winner_user_id:             winnerId,
      last_completion_check_at:   new Date().toISOString(),
      completion_deferred_reason: null,
    })
    .eq('id', leagueId)
    .neq('lifecycle_status', 'completed'); // idempotency guard — never re-write completed

  if (error) throw new Error(`markCompleted failed for league ${leagueId}: ${error.message}`);
}

// writeLifecycle updates lifecycle_status AND the defer fields.
// Used when the new status meaningfully changes (active / awaiting_fixtures / pending_resolution).
async function writeLifecycle(sb: any, leagueId: string, status: string, reason: string, dryRun: boolean) {
  if (dryRun) return;
  const { error } = await sb
    .from('leagues')
    .update({
      lifecycle_status:           status,
      last_completion_check_at:   new Date().toISOString(),
      completion_deferred_reason: reason,
    })
    .eq('id', leagueId)
    .neq('lifecycle_status', 'completed'); // never touch completed leagues

  if (error) console.warn(`[evaluator] writeLifecycle failed for ${leagueId}:`, error.message);
}

// writeDefer updates only the timestamp + reason, leaves lifecycle_status unchanged.
// Used for transient deferrals (stale data, missing rows) where the state itself hasn't changed.
async function writeDefer(sb: any, leagueId: string, reason: string, dryRun: boolean) {
  if (dryRun) return;
  const { error } = await sb
    .from('leagues')
    .update({
      last_completion_check_at:   new Date().toISOString(),
      completion_deferred_reason: reason,
    })
    .eq('id', leagueId)
    .neq('lifecycle_status', 'completed');

  if (error) console.warn(`[evaluator] writeDefer failed for ${leagueId}:`, error.message);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
