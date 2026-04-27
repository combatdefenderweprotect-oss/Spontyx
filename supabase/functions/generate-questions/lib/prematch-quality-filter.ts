// ── Prematch quality pre-filter ───────────────────────────────────────
//
// Runs AFTER generateQuestions() (Call 1) and BEFORE convertToPredicate()
// (Call 2), so low-quality questions are discarded without spending tokens
// on predicate conversion.
//
// Does NOT replace the 5-stage predicate-validator. Both layers run.
// The validator enforces structural/schema correctness.
// This filter enforces editorial quality: diversity, balance, obviousness.
//
// Only applies to CORE_MATCH_PREMATCH questions (generation_trigger = 'prematch_only').
// Live and REAL_WORLD questions pass through unchanged.

import type { RawGeneratedQuestion } from './types.ts';

// ── Context supplied by the caller (built from sportsCtx in index.ts) ─

export interface PrematchBatchContext {
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  // Absolute difference between league table positions (|home_pos - away_pos|).
  // null = standings data unavailable for this match.
  standingGap: number | null;
  scopedTeamId: string | null;
  scopedTeamName: string | null;
}

// ── Minimal info about questions already committed from prior rounds ──

export interface PriorQuestionInfo {
  question_text: string;
  player_id?: string;   // first player_id in player_ids[], if any
}

// ── Rejection record (appended to result.rejectionLog) ───────────────

export interface PrematchRejection {
  question_text: string;
  reason: string;
  score: number;
}

// ── Scoring result ────────────────────────────────────────────────────

export interface QualityScore {
  score: number;       // 0–100
  reasons: string[];   // one entry per penalty applied
}

// ─────────────────────────────────────────────────────────────────────
// Score a single prematch question against already-accepted questions
// in the same batch and questions committed in prior retry rounds.
//
// accepted  = questions accepted so far in THIS filter pass (current round)
// prior     = validatedQuestions already committed from PRIOR retry rounds
// ─────────────────────────────────────────────────────────────────────

export function scorePrematchQuestionQuality(
  q: RawGeneratedQuestion,
  accepted: RawGeneratedQuestion[],
  prior: PriorQuestionInfo[],
  ctx: PrematchBatchContext,
): QualityScore {
  let score = 100;
  const reasons: string[] = [];

  // ── 1. Obvious winner question in heavy-favourite match ─────────────
  // If one team is 5+ table positions above the other, asking "who wins?"
  // is ~80%+ obvious and adds no value. Penalise heavily.
  if (isOutcomeWinnerQuestion(q) && ctx.standingGap !== null && ctx.standingGap >= 5) {
    score -= 35;
    reasons.push('obvious_winner_heavy_favourite');
  }

  // ── 2. No standings data + winner question ──────────────────────────
  // Without standings we can't know if it's obvious, so we treat it as
  // potentially obvious and apply a lighter penalty.
  if (isOutcomeWinnerQuestion(q) && ctx.standingGap === null) {
    score -= 20;
    reasons.push('winner_question_no_standings_context');
  }

  // ── 3. Near-duplicate of accepted question in THIS round ────────────
  for (const a of accepted) {
    if (textSimilarity(q.question_text, a.question_text) >= 0.65) {
      score -= 40;
      reasons.push('near_duplicate_in_batch');
      break;
    }
  }

  // ── 4. Near-duplicate of a committed question from a prior round ────
  for (const p of prior) {
    if (textSimilarity(q.question_text, p.question_text) >= 0.65) {
      score -= 40;
      reasons.push('near_duplicate_prior_round');
      break;
    }
  }

  // ── 5. Same player already appears in accepted or prior questions ───
  const qPlayer = extractPlayerId(q.predicate_hint ?? '');
  if (qPlayer) {
    const playerInAccepted = accepted.some(
      (a) => extractPlayerId(a.predicate_hint ?? '') === qPlayer,
    );
    const playerInPrior = prior.some((p) => p.player_id === qPlayer);
    if (playerInAccepted || playerInPrior) {
      score -= 30;
      reasons.push('duplicate_player');
    }
  }

  // ── 6. Over-represented question category ──────────────────────────
  // Count how many accepted + prior questions share the same category.
  // 2+ already accepted → this question is redundant.
  const sameCategory = [
    ...accepted.filter((a) => a.question_category === q.question_category),
  ].length;
  if (sameCategory >= 2) {
    score -= 20;
    reasons.push('over_represented_category');
  }

  // ── 7. Poor team balance ────────────────────────────────────────────
  // If all accepted questions so far focus on the same team, and this
  // question also focuses on that same team, penalise the imbalance.
  if (accepted.length >= 2) {
    const dominantTeam = getDominantTeam(accepted, ctx);
    if (dominantTeam && isSingleTeamFocused(q, dominantTeam, ctx)) {
      score -= 15;
      reasons.push('poor_team_balance');
    }
  }

  // ── 8. Generic / suspiciously short question ────────────────────────
  const wordCount = (q.question_text ?? '').trim().split(/\s+/).length;
  if (wordCount <= 7) {
    score -= 25;
    reasons.push('weak_short_question');
  }

  // ── 9. Missing resolvability signal ────────────────────────────────
  // predicate_hint must reference at least a stat field or team ID.
  // match_id gets backfilled later, so absence here is only a soft penalty.
  const hint = (q.predicate_hint ?? '').toLowerCase();
  const hasResolvableHint = hint.length > 5 && (
    hint.includes('total_') ||
    hint.includes('winner_team') ||
    hint.includes('player_stat') ||
    hint.includes('match_stat') ||
    hint.includes('match_outcome') ||
    hint.includes('clean_sheet') ||
    hint.includes('btts') ||
    hint.includes('goals') ||
    hint.includes('score')
  );
  if (!hasResolvableHint) {
    score -= 20;
    reasons.push('weak_resolvability_hint');
  }

  return { score: Math.max(0, score), reasons };
}

// ─────────────────────────────────────────────────────────────────────
// Filter a batch of raw questions.
//
// Returns { accepted, rejected } where rejected entries carry the reason
// and quality score for logging into result.rejectionLog.
//
// quotaRemaining = how many more questions we still need (used to decide
//                 whether to keep marginal-quality questions).
// ─────────────────────────────────────────────────────────────────────

export function filterPrematchBatch(
  rawQuestions: RawGeneratedQuestion[],
  ctx: PrematchBatchContext,
  prior: PriorQuestionInfo[],
  quotaRemaining: number,
): { accepted: RawGeneratedQuestion[]; rejected: PrematchRejection[] } {
  const accepted: RawGeneratedQuestion[] = [];
  const rejected: PrematchRejection[]    = [];

  // Count player-specific questions already committed in prior rounds
  let playerSpecificCount = prior.filter((p) =>
    // Prior questions don't carry question_category; use player_id presence as proxy
    p.player_id !== undefined && p.player_id !== null,
  ).length;

  for (const q of rawQuestions) {
    // Pass non-prematch questions through unchanged
    if (q.generation_trigger !== 'prematch_only') {
      accepted.push(q);
      continue;
    }

    // ── Player-specific cap: max 2 per full batch (accepted + prior) ──
    if (q.question_category === 'player_specific') {
      const playerSpecificInAccepted = accepted.filter(
        (a) => a.question_category === 'player_specific',
      ).length;
      if (playerSpecificCount + playerSpecificInAccepted >= 2) {
        rejected.push({
          question_text: q.question_text,
          reason: 'too_many_player_specific',
          score: 0,
        });
        continue;
      }
    }

    const { score, reasons } = scorePrematchQuestionQuality(q, accepted, prior, ctx);

    // Hard reject: score < 60
    if (score < 60) {
      rejected.push({
        question_text: q.question_text,
        reason: reasons[0] ?? 'low_quality_score',
        score,
      });
      continue;
    }

    // Marginal (60–75): keep only if we still need questions to fill quota
    if (score < 75 && accepted.length >= quotaRemaining) {
      rejected.push({
        question_text: q.question_text,
        reason: `marginal_not_needed`,
        score,
      });
      continue;
    }

    // Accept
    accepted.push(q);
    if (q.question_category === 'player_specific') {
      // track for cap purposes (the main counter is across prior rounds)
      // no need to increment playerSpecificCount here — accepted array is checked above
    }
  }

  return { accepted, rejected };
}

// ─────────────────────────────────────────────────────────────────────
// Compute standing position gap between home and away teams.
// Returns null if standings are unavailable or teams can't be found.
// ─────────────────────────────────────────────────────────────────────

export function computeStandingGap(
  standings: Array<{ position: number; team: { id: string; name: string } }>,
  match: { homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string } } | undefined,
): number | null {
  if (!standings.length || !match) return null;

  const find = (teamId: string, teamName: string) =>
    standings.find(
      (s) => s.team.id === teamId || s.team.name.toLowerCase() === teamName.toLowerCase(),
    );

  const homeEntry = find(match.homeTeam.id, match.homeTeam.name);
  const awayEntry = find(match.awayTeam.id, match.awayTeam.name);

  if (!homeEntry || !awayEntry) return null;
  return Math.abs(homeEntry.position - awayEntry.position);
}

// ── Private helpers ───────────────────────────────────────────────────

// Detect if a question is specifically asking "who wins the match?"
function isOutcomeWinnerQuestion(q: RawGeneratedQuestion): boolean {
  if (q.question_category !== 'outcome_state') return false;
  const subtype = (q.question_subtype ?? '').toLowerCase();
  const text    = (q.question_text ?? '').toLowerCase();
  const hint    = (q.predicate_hint ?? '').toLowerCase();
  return (
    subtype.includes('winner') ||
    subtype.includes('win') ||
    text.includes('win the match') ||
    text.includes('win the game') ||
    text.includes('who will win') ||
    hint.includes('winner_team_id')
  );
}

// Extract the first player_id from a predicate_hint string.
// predicate_hint format: "player_stat: goals gte 1 for player_id 123456"
function extractPlayerId(hint: string): string | null {
  const m = hint.match(/player_id[:\s=]+(\d+)/i);
  return m ? m[1] : null;
}

// Compute word-overlap similarity between two question texts (Jaccard on 4+ char words).
function textSimilarity(a: string, b: string): number {
  const wordsOf = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/[\s\W]+/).filter((w) => w.length >= 4));
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  const union        = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

// Return the team name that dominates the accepted set, or null if balanced.
function getDominantTeam(
  accepted: RawGeneratedQuestion[],
  ctx: PrematchBatchContext,
): string | null {
  let homeCount = 0;
  let awayCount = 0;
  for (const q of accepted) {
    const text  = (q.question_text ?? '').toLowerCase();
    const hint  = (q.predicate_hint ?? '').toLowerCase();
    const mentions = (name: string) => name.length > 2 && (text.includes(name.toLowerCase()) || hint.includes(name.toLowerCase()));
    const isHome = mentions(ctx.homeTeamName);
    const isAway = mentions(ctx.awayTeamName);
    if (isHome && !isAway) homeCount++;
    if (isAway && !isHome) awayCount++;
  }
  // A team "dominates" if it appears in ALL accepted questions so far
  if (homeCount === accepted.length) return ctx.homeTeamName;
  if (awayCount === accepted.length) return ctx.awayTeamName;
  return null;
}

// Return true if the question focuses only on a specific team (dominantTeam).
function isSingleTeamFocused(
  q: RawGeneratedQuestion,
  dominantTeamName: string,
  ctx: PrematchBatchContext,
): boolean {
  if (!dominantTeamName || dominantTeamName.length < 2) return false;
  const text      = (q.question_text ?? '').toLowerCase();
  const hint      = (q.predicate_hint ?? '').toLowerCase();
  const lower     = dominantTeamName.toLowerCase();
  const otherName = dominantTeamName === ctx.homeTeamName
    ? ctx.awayTeamName.toLowerCase()
    : ctx.homeTeamName.toLowerCase();
  const mentionsDominant = text.includes(lower) || hint.includes(lower);
  const mentionsOther    = otherName.length > 2 && (text.includes(otherName) || hint.includes(otherName));
  return mentionsDominant && !mentionsOther;
}
