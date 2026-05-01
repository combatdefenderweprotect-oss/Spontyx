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

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── Fetch pending questions past their resolves_after ────────────────
  // Include all scoring metadata needed by markCorrectAnswers()
  const { data: questions, error: fetchErr } = await sb
    .from('questions')
    .select([
      'id', 'league_id', 'arena_session_id', 'type', 'question_type', 'sport', 'options', 'resolution_predicate',
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

  // ── Cache match stats by (sport:matchId) to avoid duplicate API calls ─
  const statsCache = new Map<string, MatchStats | null>();
  const runStats   = { resolved: 0, voided: 0, skipped: 0, errors: 0 };

  for (const q of questions) {
    const pred = q.resolution_predicate as any;
    if (!pred?.resolution_type) {
      await voidQuestion(sb, q.id, 'invalid_predicate');
      runStats.voided++;
      continue;
    }

    const matchId = pred.match_id ? String(pred.match_id) : null;

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
          continue;
        }
      }

      // ── player_status: no historical data → void immediately ──────────
      if (pred.resolution_type === 'player_status') {
        await voidQuestion(sb, q.id, 'player_status_no_historical_data');
        runStats.voided++;
        continue;
      }

      // ── manual_review: attempt AI web verification for REAL_WORLD ────
      // For REAL_WORLD questions, try AI verification before leaving pending.
      // For all other lanes (or if AI key missing), skip as normal — admin resolves.
      if (pred.resolution_type === 'manual_review') {
        if (q.question_type === 'REAL_WORLD' && OPENAI_API_KEY && q.question_text && q.resolution_condition) {
          const aiResolved = await tryAiVerification(sb, q, pred.resolution_type, runStats);
          if (aiResolved) continue; // resolved or voided — handled inside helper
        }
        console.log(`[resolve] skipping manual_review question ${q.id} (pending admin action, deadline=${q.resolution_deadline ?? 'none'})`);
        runStats.skipped++;
        continue;
      }

      // ── Questions without a match_id can't be resolved via stats ──────
      if (!matchId) {
        await voidQuestion(sb, q.id, 'no_match_id');
        runStats.voided++;
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
        continue;
      }

      if (!stats.finished) {
        // Match not over yet — skip (retry next run)
        runStats.skipped++;
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
        await voidQuestion(sb, q.id, result.reason ?? 'unresolvable');
        runStats.voided++;
        continue;
      }

      // For binary questions: outcome is 'yes' or 'no'
      // For MC: outcome is the winning option id
      const resolutionOutcome = result.winningOptionId ?? (result.outcome === 'correct' ? 'yes' : 'no');

      await resolveQuestion(sb, q.id, resolutionOutcome);
      await markCorrectAnswers(sb, q, resolutionOutcome);
      runStats.resolved++;

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
    ].join(', '))
    .eq('question_id', q.id);

  if (error || !answers?.length) return;

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
