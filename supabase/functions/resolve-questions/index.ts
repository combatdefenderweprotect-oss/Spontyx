import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchMatchStats, needsPlayerStats } from './lib/stats-fetcher/index.ts';
import { evaluatePredicate }                 from './lib/predicate-evaluator.ts';
import type { MatchStats }                   from './lib/predicate-evaluator.ts';
import { verifyRealWorldOutcome, isAiResultResolvable } from './lib/ai-verifier.ts';
import { isClutchAnswer, CLUTCH_XP, CLUTCH_MILESTONES } from './lib/clutch-detector.ts';
import type { ClutchContext } from './lib/clutch-detector.ts';

// ── Environment ───────────────────────────────────────────────────────
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const API_SPORTS_KEY   = Deno.env.get('API_SPORTS_KEY')!;
const CRON_SECRET      = Deno.env.get('CRON_SECRET');
const OPENAI_API_KEY   = Deno.env.get('OPENAI_API_KEY') ?? '';

// Max questions to process per invocation — keeps run time predictable
const BATCH_SIZE = 30;

// ── Main handler ──────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const reqUrl = new URL(req.url);
  const brOnly = reqUrl.searchParams.get('br_only') === '1';

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── BR lifecycle: lobby lock + segment-end (br_only cron only) ───────
  // Runs before question processing so newly locked sessions can start
  // receiving questions in the same cron tick.
  if (brOnly) {
    await runBrLifecycle(sb);
  }

  // ── Fetch pending questions past their resolves_after ────────────────
  // Include all scoring metadata needed by markCorrectAnswers()
  let questionsQuery = sb
    .from('questions')
    .select([
      'id', 'league_id', 'arena_session_id', 'br_session_id',
      'type', 'question_type', 'sport', 'options', 'resolution_predicate',
      // Scoring metadata (added by migration 006)
      'base_value', 'difficulty_multiplier',
      'answer_closes_at', 'deadline',
      // REAL_WORLD fields (added by migration 024)
      'resolution_deadline', 'confidence_level',
      // AI fallback resolution fields
      'question_text', 'resolution_condition',
      // Clutch detection (added by migration 032)
      'clutch_context',
    ].join(', '))
    .eq('resolution_status', 'pending')
    .lt('resolves_after', new Date().toISOString())
    .not('resolution_predicate', 'is', null)
    .order('resolves_after', { ascending: true })
    .limit(BATCH_SIZE);

  // br_only=1: process only BR questions (used by the 1-minute cron job)
  if (brOnly) {
    questionsQuery = questionsQuery.not('br_session_id', 'is', null);
  }

  const { data: questions, error: fetchErr } = await questionsQuery;

  if (fetchErr) {
    console.error('[resolve-questions] fetch error:', fetchErr);
    return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), { status: 500 });
  }

  if (!questions || questions.length === 0) {
    return new Response(JSON.stringify({ ok: true, resolved: 0, voided: 0, skipped: 0 }), { status: 200 });
  }

  // ── Pre-load arena session statuses ──────────────────────────────────
  // One query for the whole batch; O(1) lookup per question in the loop.
  // If the query fails we must NOT allow arena questions to resolve with
  // unverified session state — fail safe by voiding them all.
  const arenaSessionIds = [...new Set(
    questions
      .map((q: any) => q.arena_session_id)
      .filter(Boolean),
  )] as string[];

  const arenaSessionStatusMap = new Map<string, string>();
  let   arenaStatusLookupFailed = false;

  if (arenaSessionIds.length > 0) {
    const { data: arenaSessions, error: arenaErr } = await sb
      .from('arena_sessions')
      .select('id, status')
      .in('id', arenaSessionIds);

    if (arenaErr) {
      console.error('[resolve] arena_session_status_lookup_error:', arenaErr.message);
      arenaStatusLookupFailed = true;
    } else {
      for (const s of (arenaSessions ?? [])) {
        arenaSessionStatusMap.set(s.id, s.status);
      }
    }
  }

  // ── Pre-load BR session statuses ──────────────────────────────────────
  // One query covers all BR questions in the batch. Fail-closed: if the
  // query errors, brStatusLookupFailed = true and all BR questions are
  // skipped (not voided) — the 1-min cron retries next cycle.
  const brSessionIds = [...new Set(
    questions
      .map((q: any) => q.br_session_id)
      .filter(Boolean),
  )] as string[];

  const brSessionMap = new Map<string, { status: string; current_question_seq: number }>();
  let   brStatusLookupFailed = false;

  if (brSessionIds.length > 0) {
    const { data: brSessions, error: brErr } = await sb
      .from('br_sessions')
      .select('id, status, current_question_seq')
      .in('id', brSessionIds);

    if (brErr) {
      console.error('[resolve] br_session_status_lookup_error:', brErr.message);
      brStatusLookupFailed = true;
    } else {
      for (const s of (brSessions ?? [])) {
        brSessionMap.set(s.id, { status: s.status, current_question_seq: s.current_question_seq });
      }
    }

    // ── Stuck BR session watchdog ─────────────────────────────────────
    // Log sessions where the active question has been pending >10 minutes.
    // Logs only — advance_br_session_round() handles the actual fix.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: stuckQs } = await sb
      .from('questions')
      .select('id, br_session_id, resolves_after')
      .in('br_session_id', brSessionIds)
      .eq('resolution_status', 'pending')
      .lt('resolves_after', tenMinutesAgo);

    if (stuckQs && stuckQs.length > 0) {
      for (const sq of stuckQs) {
        console.warn(
          `[br-watchdog] stuck question — session=${sq.br_session_id} ` +
          `question=${sq.id} resolves_after=${sq.resolves_after}`,
        );
      }
    }
  }

  // ── Cache match stats by (sport:matchId) to avoid duplicate API calls ─
  const statsCache = new Map<string, MatchStats | null>();
  const runStats   = { resolved: 0, voided: 0, skipped: 0, errors: 0 };

  for (const q of questions) {
    const pred = q.resolution_predicate as any;
    if (!pred?.resolution_type) {
      await voidQuestion(sb, q.id, 'invalid_predicate');
      runStats.voided++;
      if (q.arena_session_id) {
        await maybeCompleteArenaSession(sb, q.arena_session_id);
      }
      if (q.br_session_id) {
        await advanceBrRound(sb, q.br_session_id, brSessionMap, true);
      }
      continue;
    }

    const matchId = pred.match_id ? String(pred.match_id) : null;

    // invalid_predicate void happens before the arena guard — still check completion
    // for arena-bound questions so a malformed question doesn't stall the session.
    try {
      // ── Arena session guard ───────────────────────────────────────────
      // Arena questions resolve only when their session is active.
      // If the status lookup failed entirely, void all arena questions in
      // this batch rather than risk scoring against a dead session.
      if (q.arena_session_id) {
        if (arenaStatusLookupFailed) {
          console.log(`[resolve] arena_session_status_lookup_failed question=${q.id} arena_session_id=${q.arena_session_id}`);
          await voidQuestion(sb, q.id, 'arena_session_status_lookup_failed');
          runStats.voided++;
          continue;
        }

        const sessionStatus = arenaSessionStatusMap.get(q.arena_session_id);
        if (sessionStatus !== 'active') {
          console.log(`[resolve] arena_question_voided_session_not_active question=${q.id} arena_session_id=${q.arena_session_id} session_status=${sessionStatus ?? 'not_found'}`);
          await voidQuestion(sb, q.id, 'arena_session_not_active');
          runStats.voided++;
          continue;
        }
      }

      // ── BR session guard ──────────────────────────────────────────────
      // BR questions resolve only when their session is active.
      // Skip (not void) on lookup failure — 1-min cron retries next cycle.
      if (q.br_session_id) {
        if (brStatusLookupFailed) {
          console.log(`[resolve] br_session_status_lookup_failed question=${q.id} br_session_id=${q.br_session_id}`);
          runStats.skipped++;
          continue;
        }

        const brSession = brSessionMap.get(q.br_session_id);
        if (!brSession) {
          console.log(`[resolve] br_session_not_found question=${q.id} br_session_id=${q.br_session_id}`);
          runStats.skipped++;
          continue;
        }

        if (brSession.status !== 'active') {
          console.log(
            `[resolve] br_question_skipped_session_not_active ` +
            `question=${q.id} br_session_id=${q.br_session_id} status=${brSession.status}`,
          );
          runStats.skipped++;
          continue;
        }
      }

      // ── REAL_WORLD deadline auto-void ─────────────────────────────────
      // If resolution_deadline has passed (+ 1-hour grace), void the question.
      // This covers both manual_review and match_lineup questions that were
      // never resolved before their stated deadline.
      if (q.resolution_deadline) {
        const deadlineMs  = new Date(q.resolution_deadline).getTime();
        const gracePeriodMs = 60 * 60 * 1000; // 1 hour
        if (Date.now() > deadlineMs + gracePeriodMs) {
          await voidQuestion(sb, q.id, 'resolution_deadline_passed');
          runStats.voided++;
          if (q.arena_session_id) {
            await maybeCompleteArenaSession(sb, q.arena_session_id);
          }
          if (q.br_session_id) {
            await advanceBrRound(sb, q.br_session_id, brSessionMap, true);
          }
          continue;
        }
      }

      // ── player_status: no historical data → void immediately ──────────
      if (pred.resolution_type === 'player_status') {
        await voidQuestion(sb, q.id, 'player_status_no_historical_data');
        runStats.voided++;
        if (q.arena_session_id) {
          await maybeCompleteArenaSession(sb, q.arena_session_id);
        }
        if (q.br_session_id) {
          await advanceBrRound(sb, q.br_session_id, brSessionMap, true);
        }
        continue;
      }

      // ── manual_review: skip in MVP — auto-void handles cleanup ──────
      // AI verifier removed for MVP: manual_review questions always
      // auto-void at deadline+1h (no admin UI exists). Calling the verifier
      // every hourly cycle burns OpenAI budget with no user value.
      // Restore tryAiVerification here when admin review UI is shipped.
      if (pred.resolution_type === 'manual_review') {
        console.log(`[resolve] skipping manual_review question ${q.id} (pending admin action, deadline=${q.resolution_deadline ?? 'none'})`);
        runStats.skipped++;
        continue;
      }

      // ── Questions without a match_id can't be resolved via stats ──────
      if (!matchId) {
        await voidQuestion(sb, q.id, 'no_match_id');
        runStats.voided++;
        if (q.arena_session_id) {
          await maybeCompleteArenaSession(sb, q.arena_session_id);
        }
        if (q.br_session_id) {
          await advanceBrRound(sb, q.br_session_id, brSessionMap, true);
        }
        continue;
      }

      // ── Fetch (or reuse cached) match stats ───────────────────────────
      const cacheKey = `${q.sport}:${matchId}`;
      if (!statsCache.has(cacheKey)) {
        const stats = await fetchMatchStats({
          sport:            q.sport,
          matchId,
          needsPlayerStats: needsPlayerStats(pred),
          apiKey:           API_SPORTS_KEY,
          sb,
        });
        statsCache.set(cacheKey, stats);
      }

      const stats = statsCache.get(cacheKey) ?? null;

      if (!stats) {
        // API unavailable — skip (not void); will retry on next run
        console.warn(`[resolve] no stats for match ${matchId}, skipping question ${q.id}`);
        runStats.skipped++;
        continue;
      }

      // Cancelled / postponed match → void the question
      const deadStatuses = new Set(['PST', 'CANC', 'ABD', 'SUSP']);
      if (deadStatuses.has(stats.status)) {
        await voidQuestion(sb, q.id, `match_${stats.status.toLowerCase()}`);
        runStats.voided++;
        if (q.arena_session_id) {
          await maybeCompleteArenaSession(sb, q.arena_session_id);
        }
        if (q.br_session_id) {
          await advanceBrRound(sb, q.br_session_id, brSessionMap, true);
        }
        continue;
      }

      if (!stats.finished) {
        // Match not over yet. Void PREMATCH/LIVE questions stuck >48 hours past
        // resolves_after — covers abandoned matches and permanent API data gaps.
        // REAL_WORLD has its own resolution_deadline path; leave it unchanged.
        const STALE_TIMEOUT_TYPES = new Set(['CORE_MATCH_PREMATCH', 'CORE_MATCH_LIVE']);
        const hoursElapsed = (Date.now() - new Date(q.resolves_after).getTime()) / 3_600_000;
        if (hoursElapsed > 48 && STALE_TIMEOUT_TYPES.has(q.question_type ?? '')) {
          console.warn(
            `[resolve] staleness_timeout — question=${q.id} type=${q.question_type} ` +
            `hours_elapsed=${Math.round(hoursElapsed)} match=${matchId}`,
          );
          await voidQuestion(sb, q.id, 'resolver_staleness_timeout');
          runStats.voided++;
          if (q.arena_session_id) await maybeCompleteArenaSession(sb, q.arena_session_id);
          if (q.br_session_id)    await advanceBrRound(sb, q.br_session_id, brSessionMap, true);
        } else {
          runStats.skipped++;
        }
        continue;
      }

      // ── Evaluate the predicate ────────────────────────────────────────
      const result = evaluatePredicate(pred, stats, q.options ?? null);

      if (result.outcome === 'unresolvable') {
        // Lineup questions may return unresolvable when lineups aren't in cache yet.
        // For REAL_WORLD match_lineup: if lineups will never arrive (deadline passed),
        // try AI web verification as a last resort before voiding.
        const LINEUP_RETRY_REASONS = new Set(['lineups_not_available', 'lineups_incomplete']);
        if (LINEUP_RETRY_REASONS.has(result.reason ?? '')) {
          // Only attempt AI fallback when the lineup window has definitively closed
          // (resolution_deadline has passed) — otherwise just retry next cycle.
          const deadlinePassed = q.resolution_deadline
            ? Date.now() > new Date(q.resolution_deadline).getTime()
            : false;

          if (
            deadlinePassed &&
            q.question_type === 'REAL_WORLD' &&
            OPENAI_API_KEY &&
            q.question_text &&
            q.resolution_condition
          ) {
            const aiResolved = await tryAiVerification(sb, q, pred.resolution_type, runStats);
            if (aiResolved) continue;
          }

          if (!deadlinePassed) {
            console.log(`[resolve] lineups not yet available for question ${q.id} (${result.reason}) — skipping for retry`);
            runStats.skipped++;
            continue;
          }
          // Deadline passed and AI could not resolve — fall through to void
        }

        // ── player_stat API lag grace window (30 min post resolves_after) ─────
        // /fixtures/players can lag several minutes after FT before all player
        // entries are populated. Skip and retry rather than voiding permanently
        // during this window. After 30 min the grace expires and the void stands.
        if (pred.resolution_type === 'player_stat') {
          const reason = result.reason ?? '';
          const isStatLag =
            reason.startsWith('player_not_in_stats') ||
            reason.startsWith('player_stat_unavailable');
          if (isStatLag) {
            const msPostFt = Date.now() - new Date(q.resolves_after).getTime();
            const GRACE_MS = 30 * 60 * 1000;
            if (msPostFt < GRACE_MS) {
              console.log(
                `[resolve] player_stat_lag_skip — question=${q.id} reason=${reason} ` +
                `seconds_post_ft=${Math.round(msPostFt / 1000)} — retrying next cycle`,
              );
              runStats.skipped++;
              continue;
            }
            console.log(
              `[resolve] player_stat_lag_grace_expired — question=${q.id} reason=${reason} ` +
              `minutes_post_ft=${Math.round(msPostFt / 60000)} — voiding`,
            );
          }
        }

        await voidQuestion(sb, q.id, result.reason ?? 'unresolvable');
        runStats.voided++;
        if (q.arena_session_id) {
          await maybeCompleteArenaSession(sb, q.arena_session_id);
        }
        if (q.br_session_id) {
          await advanceBrRound(sb, q.br_session_id, brSessionMap, true);
        }
        continue;
      }

      // For binary questions: outcome is 'yes' or 'no'
      // For MC: outcome is the winning option id
      const resolutionOutcome = result.winningOptionId ?? (result.outcome === 'correct' ? 'yes' : 'no');

      await resolveQuestion(sb, q.id, resolutionOutcome);
      await markCorrectAnswers(sb, q, resolutionOutcome);
      runStats.resolved++;

      // Check if all questions for this arena session are now done
      if (q.arena_session_id) {
        await maybeCompleteArenaSession(sb, q.arena_session_id);
      }

      // Advance the BR session to the next round (isVoided=false → HP deltas applied)
      if (q.br_session_id) {
        await advanceBrRound(sb, q.br_session_id, brSessionMap, false);
      }

    } catch (err) {
      console.error(`[resolve] exception for question ${q.id}:`, err);
      runStats.errors++;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, ...runStats, total: questions.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

// ── Helpers ───────────────────────────────────────────────────────────

async function resolveQuestion(
  sb:         any,
  questionId: string,
  outcome:    string,
  source:     string = 'system',
) {
  const { error } = await sb.from('questions').update({
    resolution_status:  'resolved',
    resolution_outcome: outcome,
    resolution_source:  source,
    resolved_at:        new Date().toISOString(),
  }).eq('id', questionId);

  if (error) {
    console.warn(`[resolve] failed to resolve question ${questionId}:`, error);
  }
}

async function voidQuestion(sb: any, questionId: string, reason: string) {
  const { error } = await sb.from('questions').update({
    resolution_status:  'voided',
    resolution_outcome: null,
    resolution_source:  'auto_void',
    resolution_note:    reason,
    resolved_at:        new Date().toISOString(),
  }).eq('id', questionId);

  if (error) {
    console.warn(`[resolve] failed to void question ${questionId}:`, error);
  }
}

// ── AI-assisted fallback resolution ──────────────────────────────────
//
// LAST-RESORT ONLY. Called when:
//   • question_type = 'REAL_WORLD'
//   • predicate type is manual_review OR match_lineup (with expired deadline)
//   • standard evaluation could not produce a result
//   • OPENAI_API_KEY is configured
//
// Returns true if the question was handled (resolved or decided to void),
// false if the caller should continue with its own fallback path.
//
// Resolution rules:
//   high confidence                          → resolve
//   medium confidence + ≥2 sources           → resolve
//   medium confidence + <2 sources           → return false (allow auto-void)
//   low confidence / unresolvable            → return false (allow auto-void)

async function tryAiVerification(
  sb:            any,
  q:             any,
  predicateType: string,
  runStats:      { resolved: number; voided: number; skipped: number; errors: number },
): Promise<boolean> {
  console.log(`[resolve] real_world_ai_resolution_attempt — question_id=${q.id} predicate_type=${predicateType}`);

  let aiResult;
  try {
    aiResult = await verifyRealWorldOutcome(
      q.question_text        as string,
      q.resolution_condition as string,
      predicateType,
      OPENAI_API_KEY,
    );
  } catch (err) {
    console.warn(`[resolve] real_world_ai_resolution_failed — question_id=${q.id} error=${String(err)}`);
    return false;
  }

  if (!aiResult) {
    console.warn(
      `[resolve] real_world_ai_resolution_failed — question_id=${q.id} ` +
      `predicate_type=${predicateType} decision=null confidence=null source_count=0`,
    );
    return false;
  }

  const { decision, confidence, sources, reasoning } = aiResult;
  const sourceCount = sources.length;

  if (isAiResultResolvable(aiResult)) {
    const outcome = decision === 'correct' ? 'yes' : 'no';
    console.log(
      `[resolve] real_world_ai_resolution_success — question_id=${q.id} ` +
      `predicate_type=${predicateType} decision=${decision} confidence=${confidence} source_count=${sourceCount}`,
    );
    await resolveQuestion(sb, q.id, outcome, 'ai_web_verification');
    await markCorrectAnswers(sb, q, outcome);
    runStats.resolved++;
    return true;
  }

  // AI ran but result is not strong enough to resolve — log and return false
  // so caller can fall through to auto-void or its own skip logic.
  if (decision === 'unresolvable' || confidence === 'low') {
    console.log(
      `[resolve] real_world_ai_resolution_voided — question_id=${q.id} ` +
      `predicate_type=${predicateType} decision=${decision} confidence=${confidence} ` +
      `source_count=${sourceCount} reasoning="${reasoning.slice(0, 120)}"`,
    );
  } else {
    // medium + <2 sources — not enough certainty
    console.log(
      `[resolve] real_world_ai_resolution_failed — question_id=${q.id} ` +
      `predicate_type=${predicateType} decision=${decision} confidence=${confidence} ` +
      `source_count=${sourceCount} (insufficient sources for medium confidence)`,
    );
  }

  return false;
}

// ── Full scoring formula ──────────────────────────────────────────────
//
// points = base_value × time_pressure × difficulty × streak × comeback × clutch
//
// All six multipliers are active. Values are captured at answer-submission time
// (streak, leader_gap, clutch) and at question-generation time (difficulty)
// so scoring always reflects the conditions when the player made their decision.

function computeTimePressureMultiplier(
  answeredAt:     string,
  answerClosesAt: string | null,
  deadline:       string | null,
): number {
  // Live questions: use answer_closes_at.
  // Legacy / non-live questions: fall back to deadline.
  const closesAt = answerClosesAt ?? deadline;
  if (!closesAt) return 1.0;

  const msRemaining  = new Date(closesAt).getTime() - new Date(answeredAt).getTime();
  const minRemaining = msRemaining / 60_000;

  if (minRemaining < 3)  return 1.50;
  if (minRemaining < 5)  return 1.25;
  if (minRemaining < 8)  return 1.10;
  return 1.0;
}

function computeStreakMultiplier(streakAtAnswer: number | null): number {
  const s = streakAtAnswer ?? 0;
  if (s >= 4) return 1.3;
  if (s === 3) return 1.2;
  if (s === 2) return 1.1;
  return 1.0;
}

// ─────────────────────────────────────────────────────────────────────
// League Scoring V2 (migration 052) — flat points, optional confidence.
//
// Applied to ALL league-bound questions (q.league_id IS NOT NULL).
// Replaces the multi-multiplier formula entirely for leagues. NO time
// pressure, streak, comeback, clutch, or difficulty multipliers apply
// to league questions under V2.
//
// Confidence honored only when league.confidence_scoring_enabled = true.
// When false → always Normal regardless of player's stored confidence.
// ─────────────────────────────────────────────────────────────────────
function calculateLeagueAnswerPoints(
  isCorrect: boolean,
  confidenceLevel: string | null | undefined,
): number {
  const c = (confidenceLevel ?? 'normal') as string;
  if (c === 'very_high') return isCorrect ?  20 : -10;
  if (c === 'high')      return isCorrect ?  15 :  -5;
  /* normal (or anything unrecognised) */
  return isCorrect ? 10 : 0;
}

function computeComebackMultiplier(leaderGapAtAnswer: number | null): number {
  const gap = leaderGapAtAnswer ?? 0;
  if (gap > 100) return 1.3;
  if (gap > 50)  return 1.2;
  if (gap > 20)  return 1.1;
  return 1.0;
}

// Mark each player_answer row as correct or incorrect and award points
// using the full multi-factor scoring formula. Also runs clutch detection
// for CORE_MATCH_LIVE correct answers and awards XP when earned.
async function markCorrectAnswers(
  sb:      any,
  q:       any,      // full question row including scoring metadata
  outcome: string,
) {
  // Fetch all answers for this question, including submission-time scoring context
  const { data: answers, error } = await sb
    .from('player_answers')
    .select([
      'id', 'user_id', 'answer', 'answered_at',
      // Submission-time scoring context (migration 006)
      'streak_at_answer', 'leader_gap_at_answer', 'clutch_multiplier_at_answer',
      // League Scoring V2 (migration 052)
      'confidence_level',
    ].join(', '))
    .eq('question_id', q.id);

  if (error || !answers?.length) return;

  // ── League Scoring V2 branch (migration 052) ──────────────────────
  // For league-bound questions, use flat +10/0 (Normal) with optional
  // confidence multiplier. Skip the multi-multiplier formula entirely.
  // Arena (q.arena_session_id) and BR (q.br_session_id) keep the legacy
  // formula — branch falls through.
  if (q.league_id) {
    let confidenceEnabled = false;
    const { data: leagueRow, error: leagueErr } = await sb
      .from('leagues')
      .select('confidence_scoring_enabled')
      .eq('id', q.league_id)
      .single();
    if (leagueErr) {
      console.warn('[resolve-questions] league fetch failed for confidence flag:', leagueErr.message, 'q:', q.id, 'league:', q.league_id);
      // fail-closed → Normal scoring
    } else if (leagueRow) {
      confidenceEnabled = !!leagueRow.confidence_scoring_enabled;
    }

    const nowL = new Date().toISOString();
    const userDeltas = new Map<string, number>();
    for (const a of answers) {
      const isCorrect = (a.answer === outcome);
      // When confidence scoring is disabled for the league, always score Normal
      // regardless of what the player stored at submit time.
      const effectiveConf = confidenceEnabled ? (a.confidence_level ?? 'normal') : 'normal';
      const finalPts = calculateLeagueAnswerPoints(isCorrect, effectiveConf);

      await sb.from('player_answers').update({
        is_correct:    isCorrect,
        points_earned: finalPts,
        resolved_at:   nowL,
        multiplier_breakdown: {
          model:               'league_v2',
          confidence_enabled:  confidenceEnabled,
          confidence_used:     effectiveConf,
          confidence_stored:   a.confidence_level ?? 'normal',
          base_correct_value:  isCorrect ? finalPts : null,
          base_wrong_value:    isCorrect ? null : finalPts,
          total:               finalPts,
          note:                isCorrect ? 'league_v2_correct' : 'league_v2_wrong',
        },
      }).eq('id', a.id);

      // Accumulate per-user delta for global leaderboard sync.
      // Zero-point answers (Normal wrong) are skipped — no-op on total_points.
      if (finalPts !== 0) {
        userDeltas.set(a.user_id, (userDeltas.get(a.user_id) ?? 0) + finalPts);
      }
    }

    // Propagate aggregate deltas to users.total_points.
    // Negative deltas (High/Very High confidence wrong answers) correctly decrement.
    for (const [userId, delta] of userDeltas) {
      const { error: ptErr } = await sb.rpc('increment_user_total_points', {
        p_user_id: userId,
        p_delta:   delta,
      });
      if (ptErr) {
        console.warn(
          '[resolve-questions] total_points increment failed:',
          ptErr.message, 'user:', userId, 'delta:', delta,
        );
      }
    }
    return;
  }
  // ── End League Scoring V2 branch — Arena/BR continue below with legacy formula ──

  // Question-level scoring values (migration 006)
  // base_value: 6 (filler) / 10 (medium stat) / 12 (player) / 15 (outcome) / 20 (high-value event)
  const baseValue  = (q.base_value ?? 6) as number;
  const difficulty = parseFloat(q.difficulty_multiplier ?? '1.0') || 1.0;
  // answer_closes_at is the authoritative lock time for live questions;
  // deadline is the fallback for legacy questions
  const closesAt   = (q.answer_closes_at as string | null) ?? null;
  const deadlineFb = (q.deadline as string | null) ?? null;

  const clutchCtx = (q.clutch_context ?? null) as ClutchContext | null;
  const now = new Date().toISOString();

  for (const a of answers) {
    const isCorrect = (a.answer === outcome);

    if (!isCorrect) {
      // Wrong answer: 0 points, no streak penalty here (streak reset happens at next answer)
      await sb.from('player_answers').update({
        is_correct:           false,
        points_earned:        0,
        resolved_at:          now,
        multiplier_breakdown: {
          base_value:    baseValue,
          time_pressure: null,
          difficulty,
          streak:        null,
          comeback:      null,
          clutch:        null,
          total:         0,
          note:          'wrong_answer',
        },
      }).eq('id', a.id);
      continue;
    }

    // ── Correct answer: apply formula ─────────────────────────────────
    const timePressure = computeTimePressureMultiplier(a.answered_at, closesAt, deadlineFb);
    const streak       = computeStreakMultiplier(a.streak_at_answer);
    const comeback     = computeComebackMultiplier(a.leader_gap_at_answer);
    // clutch_multiplier_at_answer is captured at submission time from match_minute_at_generation
    const clutch       = parseFloat(a.clutch_multiplier_at_answer ?? '1.0') || 1.0;

    const finalPts = Math.max(
      0,
      Math.round(baseValue * timePressure * difficulty * streak * comeback * clutch),
    );

    // ── Clutch detection ──────────────────────────────────────────────
    const clutchResult = isClutchAnswer({
      questionType:      q.question_type ?? null,
      isCorrect:         true,
      clutchContext:     clutchCtx,
      leaderGapAtAnswer: a.leader_gap_at_answer ?? null,
    });

    await sb.from('player_answers').update({
      is_correct:    true,
      points_earned: finalPts,
      resolved_at:   now,
      is_clutch:     clutchResult.isClutch,
      multiplier_breakdown: {
        base_value:    baseValue,
        time_pressure: timePressure,
        difficulty,
        streak,
        comeback,
        clutch,
        total:         finalPts,
        is_clutch:     clutchResult.isClutch,
      },
    }).eq('id', a.id);

    // ── Propagate score to arena_session_players (arena sessions only) ──
    // arena_session_players.score drives the live scoreboard and the
    // update_arena_ratings() ELO function; must be kept in sync atomically.
    if (q.arena_session_id && finalPts > 0) {
      const { error: arenaScoreErr } = await sb.rpc('increment_arena_player_score', {
        p_session_id: q.arena_session_id,
        p_user_id:    a.user_id,
        p_points:     finalPts,
      });
      if (arenaScoreErr) {
        console.warn('[resolve-questions] arena score increment failed:', arenaScoreErr.message,
          'session:', q.arena_session_id, 'user:', a.user_id);
      }
    }

    // ── Clutch XP + achievement hooks ─────────────────────────────────
    if (clutchResult.isClutch) {
      await awardClutchXp(sb, a.user_id, q.id, q.resolution_predicate?.match_id ?? null);
    }
  }
}

// Award +15 XP for a clutch answer, increment counter, fire achievement hooks.
// Routes through award_xp RPC for idempotency (source_id = questionId), anti-abuse,
// and atomic users.total_xp update. The unique index on (user_id, event_type, source_id)
// prevents double-awarding if the resolver is re-run.
async function awardClutchXp(
  sb:         any,
  userId:     string,
  questionId: string,
  matchId:    string | null,
) {
  const { data: xpResult, error: xpErr } = await sb.rpc('award_xp', {
    p_user_id:     userId,
    p_xp_amount:   CLUTCH_XP,
    p_event_type:  'clutch_answer',
    p_source_type: 'question',
    p_source_id:   questionId,
    p_metadata:    matchId ? { match_id: matchId, question_id: questionId } : { question_id: questionId },
  });

  if (xpErr) {
    console.warn(`[resolve] clutch XP award_xp failed for user ${userId} question ${questionId}:`, xpErr.message);
    return;
  }

  if (xpResult?.duplicate) {
    // Already awarded in a prior resolver run — idempotent, no action needed.
    return;
  }

  // Increment users.clutch_answers and read the new value for achievement check
  const { data: updated, error: incErr } = await sb.rpc('increment_clutch_answers', { p_user_id: userId });
  if (incErr) {
    console.warn(`[resolve] clutch_answers increment failed for user ${userId}:`, incErr.message);
    return;
  }

  const newCount: number = updated ?? 0;

  console.log(
    `[resolve] clutch_answer awarded — user=${userId} question=${questionId} ` +
    `xp=+${xpResult?.awarded_xp ?? CLUTCH_XP} new_total_xp=${xpResult?.new_total_xp} ` +
    `level=${xpResult?.new_level} total_clutch=${newCount}`,
  );

  if (CLUTCH_MILESTONES.has(newCount)) {
    console.log(`[resolve] clutch_milestone reached — user=${userId} milestone=${newCount}`);
    // Achievement hook placeholder — badge/notification system wired here post-MVP
  }
}

// ── BR session round advancement helper ──────────────────────────────
//
// Called after every BR question resolves (isVoided=false) or is voided
// (isVoided=true). Calls the advance_br_session_round() SECURITY DEFINER
// RPC which applies HP deltas, eliminates players, assigns placements,
// and finalises the session when ≤1 survivor or the last question resolves.
//
// The RPC is idempotent via last_processed_seq guard — safe to call on
// resolver retries without double-applying HP changes.
//
// Log events:
//   [br-advance] advanced        — round processed, session continuing
//   [br-advance] session_complete — all rounds done, session finalised
//   [br-advance] no-op           — already_processed or other non-error skip

async function advanceBrRound(
  sb:           any,
  sessionId:    string,
  brSessionMap: Map<string, { status: string; current_question_seq: number }>,
  isVoided:     boolean,
): Promise<void> {
  const brSession = brSessionMap.get(sessionId);
  if (!brSession) {
    console.warn(`[br-advance] no session data for ${sessionId} — skipping advance`);
    return;
  }

  const { data, error } = await sb.rpc('advance_br_session_round', {
    p_session_id:   sessionId,
    p_question_seq: brSession.current_question_seq,
    p_is_voided:    isVoided,
  });

  if (error) {
    console.warn(
      `[br-advance] rpc error session=${sessionId} seq=${brSession.current_question_seq}:`,
      error.message,
    );
    return;
  }

  if (data?.ok === false) {
    console.log(
      `[br-advance] no-op session=${sessionId} seq=${brSession.current_question_seq} ` +
      `reason=${data.reason ?? 'unknown'}`,
    );
    return;
  }

  if (data?.session_complete) {
    console.log(
      `[br-advance] session_complete session=${sessionId} ` +
      `survivors=${data.survivors ?? '?'} newly_eliminated=${data.newly_eliminated ?? '?'} ` +
      `last_question=${data.last_question ?? false} voided=${isVoided}`,
    );
  } else {
    console.log(
      `[br-advance] advanced session=${sessionId} ` +
      `seq=${brSession.current_question_seq} → ${data?.next_question_seq ?? '?'} ` +
      `survivors=${data?.survivors ?? '?'} newly_eliminated=${data?.newly_eliminated ?? '?'} ` +
      `voided=${isVoided}`,
    );
  }
}

// ── Arena session completion helper ──────────────────────────────────
//
// Calls complete_arena_session() RPC after each arena-question resolve or void.
// The RPC has all necessary guards (active status, ≥1 question, 0 pending),
// so it is safe to call after every terminal transition — a no-op when the
// session isn't ready yet.
//
// Log events:
//   [arena-complete] completed   — session marked completed, winner determined
//   [arena-complete] pending     — questions still pending; normal mid-session state
//   [arena-complete] no_questions — session has zero questions; not completed
//   [arena-complete] skipped     — already done, not active, or not found

async function maybeCompleteArenaSession(sb: any, sessionId: string): Promise<void> {
  try {
    const { data, error } = await sb.rpc('complete_arena_session', {
      p_session_id: sessionId,
    });

    if (error) {
      console.warn(`[arena-complete] rpc error for session ${sessionId}:`, error.message);
      return;
    }

    const result = data as {
      completed:           boolean;
      reason?:             string;
      pending_count?:      number;
      total_questions?:    number;
      winner_user_id?:     string | null;
      winning_team_number?: number | null;
    };

    if (result.completed) {
      console.log(
        `[arena-complete] completed — session=${sessionId} ` +
        `winner_user_id=${result.winner_user_id ?? 'draw'} ` +
        `winning_team=${result.winning_team_number ?? 'n/a'} ` +
        `total_questions=${result.total_questions}`,
      );
    } else if (result.reason === 'questions_still_pending') {
      console.log(
        `[arena-complete] pending — session=${sessionId} ` +
        `pending=${result.pending_count} total=${result.total_questions}`,
      );
    } else if (result.reason === 'no_questions') {
      console.log(`[arena-complete] no_questions — session=${sessionId}`);
    } else {
      // already_done, session_not_active, session_not_found — safe, no action
      console.log(`[arena-complete] skipped — session=${sessionId} reason=${result.reason ?? 'unknown'}`);
    }
  } catch (err) {
    console.warn(`[arena-complete] exception for session ${sessionId}:`, String(err));
  }
}

// ── BR lifecycle: lobby lock + segment-end detection ─────────────────
//
// Runs at the start of every br_only=1 cron tick (before question processing).
//
// Lock phase:  finds waiting BR sessions whose match segment has started
//              (first_half → status '1H', second_half → status '2H') and
//              calls instantiate_br_session() to transition them to 'active'.
//
// Segment-end: finds active BR sessions whose segment has ended and calls
//              finalize_br_session(). finalize is idempotent — safe if a
//              single-survivor win already triggered it this tick.
//
// Uses live_match_stats (written by live-stats-poller every minute) as the
// authoritative source of match status. Never uses segment_ends_at (that is
// informational only).

const SEGMENT_END_STATUSES: Record<string, string[]> = {
  first_half:  ['HT', '2H', 'FT', 'AET', 'PEN', 'FT_PEN', 'ABD'],
  second_half: ['FT', 'AET', 'PEN', 'FT_PEN', 'ABD'],
  // Future sports can add entries here
};

async function runBrLifecycle(sb: any): Promise<void> {
  // ── 1. Fetch waiting + active sessions and their match statuses ───────
  const [waitingResult, activeResult] = await Promise.all([
    sb.from('br_sessions')
      .select('id, match_id, segment_scope')
      .eq('status', 'waiting'),
    sb.from('br_sessions')
      .select('id, match_id, segment_scope')
      .eq('status', 'active'),
  ]);

  const allSessions = [
    ...(waitingResult.data ?? []),
    ...(activeResult.data  ?? []),
  ];

  if (allSessions.length === 0) return;

  const allMatchIds = [...new Set(allSessions.map((s: any) => String(s.match_id)))];

  const { data: liveStats, error: statsErr } = await sb
    .from('live_match_stats')
    .select('fixture_id, status')
    .in('fixture_id', allMatchIds);

  if (statsErr) {
    console.warn('[br-lifecycle] live_match_stats fetch error:', statsErr.message);
    return;
  }

  const matchStatusMap = new Map<string, string>();
  for (const row of (liveStats ?? [])) {
    matchStatusMap.set(String(row.fixture_id), row.status);
  }

  // ── 2. Lock waiting sessions whose segment has started ─────────────
  for (const session of (waitingResult.data ?? [])) {
    const matchStatus = matchStatusMap.get(String(session.match_id));
    if (!matchStatus) continue;

    const shouldLock =
      (session.segment_scope === 'first_half'  && matchStatus === '1H') ||
      (session.segment_scope === 'second_half' && matchStatus === '2H');

    if (!shouldLock) continue;

    const { error } = await sb.rpc('instantiate_br_session', {
      p_session_id: session.id,
    });

    if (error) {
      console.warn(`[br-lock] failed to lock session ${session.id}:`, error.message);
    } else {
      console.log(
        `[br-lock] session ${session.id} locked — ` +
        `segment=${session.segment_scope} match_status=${matchStatus}`,
      );
    }
  }

  // ── 3. Finalize active sessions whose segment has ended ─────────────
  for (const session of (activeResult.data ?? [])) {
    const matchStatus = matchStatusMap.get(String(session.match_id));
    if (!matchStatus) continue;

    const endStatuses = SEGMENT_END_STATUSES[session.segment_scope] ?? [];
    if (!endStatuses.includes(matchStatus)) continue;

    const { error } = await sb.rpc('finalize_br_session', {
      p_session_id: session.id,
    });

    if (error) {
      console.warn(`[br-segment-end] failed to finalize session ${session.id}:`, error.message);
    } else {
      console.log(
        `[br-segment-end] session ${session.id} finalized — ` +
        `segment=${session.segment_scope} match_status=${matchStatus}`,
      );
    }
  }
}
