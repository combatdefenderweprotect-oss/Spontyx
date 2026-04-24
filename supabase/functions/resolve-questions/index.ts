import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchMatchStats, needsPlayerStats } from './lib/stats-fetcher/index.ts';
import { evaluatePredicate }                 from './lib/predicate-evaluator.ts';
import type { MatchStats }                   from './lib/predicate-evaluator.ts';

// ── Environment ───────────────────────────────────────────────────────
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const API_SPORTS_KEY   = Deno.env.get('API_SPORTS_KEY')!;
const CRON_SECRET      = Deno.env.get('CRON_SECRET');

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
      'id', 'league_id', 'type', 'sport', 'options', 'resolution_predicate',
      // Scoring metadata (added by migration 006)
      'base_value', 'difficulty_multiplier',
      'answer_closes_at', 'deadline',
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
      // ── player_status: no historical data → void immediately ──────────
      if (pred.resolution_type === 'player_status') {
        await voidQuestion(sb, q.id, 'player_status_no_historical_data');
        runStats.voided++;
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

async function resolveQuestion(sb: any, questionId: string, outcome: string) {
  const { error } = await sb.from('questions').update({
    resolution_status:  'resolved',
    resolution_outcome: outcome,
    resolution_source:  'system',
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

// ── Full scoring formula ──────────────────────────────────────────────
//
// points = base_value × time_pressure × difficulty × streak × comeback × clutch
//
// MVP (mid-May launch): difficulty, comeback, and clutch are bypassed to 1.0.
// time_pressure and streak remain active — both are reliable at MVP scale.
// All multiplier columns and functions are preserved for post-launch activation.
// To re-enable post-MVP: remove the MVP_BYPASS constants and use computed values.

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
// using the full multi-factor scoring formula.
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

  const now = new Date().toISOString();

  const updates = answers.map((a: any) => {
    const isCorrect = (a.answer === outcome);

    if (!isCorrect) {
      // Wrong answer: 0 points, no streak penalty here (streak reset happens at next answer)
      return sb.from('player_answers').update({
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
    }

    // ── Correct answer: apply formula ─────────────────────────────────
    const timePressure = computeTimePressureMultiplier(a.answered_at, closesAt, deadlineFb);
    const streak       = computeStreakMultiplier(a.streak_at_answer);
    // MVP: difficulty, comeback, clutch bypassed to 1.0 — data columns intact for post-launch
    const difficulty_mvp = 1.0;
    const comeback_mvp   = 1.0;
    const clutch_mvp     = 1.0;

    const finalPts = Math.max(
      0,
      Math.round(baseValue * timePressure * difficulty_mvp * streak * comeback_mvp * clutch_mvp),
    );

    return sb.from('player_answers').update({
      is_correct:    true,
      points_earned: finalPts,
      resolved_at:   now,
      multiplier_breakdown: {
        base_value:    baseValue,
        time_pressure: timePressure,
        difficulty:    difficulty_mvp,
        streak,
        comeback:      comeback_mvp,
        clutch:        clutch_mvp,
        total:         finalPts,
        mvp_bypass:    true,  // flag so post-launch audit can identify MVP-era scores
      },
    }).eq('id', a.id);
  });

  await Promise.all(updates);
}
