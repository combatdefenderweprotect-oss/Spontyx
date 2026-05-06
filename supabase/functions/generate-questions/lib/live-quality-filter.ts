// ── Live Question Quality & Diversity Filter ──────────────────────────
//
// Runs AFTER validateQuestion() and the window overlap guard.
// Runs BEFORE DB insert.
// Only applies to league CORE_MATCH_LIVE (soccer). Never called for Arena/BR/Trivia.
//
// This is v1 — intentionally conservative. Hard rejects are high-confidence
// only. Soft scoring infrastructure is wired up but the single v1 soft rule
// (-30 for event-driven consecutive market) stays above the reject threshold
// (50), so no soft rejections occur in v1. Additional soft rules in v2.
//
// Hard reject rules:
//   1. already_resolved_clean_sheet — team has already conceded; clean sheet impossible
//   2. already_resolved_btts        — both teams already scored; BTTS trivially YES
//   3. blowout_outcome_reject       — winner question when score diff ≥ 3
//   4. equaliser_blowout_reject     — equaliser phrasing when score diff ≥ 2
//   5. consecutive_same_market      — same market key as last question (time-driven only)
//
// Soft scoring (event-driven only in v1):
//   event_driven_consecutive_same_market: -30 → score stays at 70, above threshold

import type { LiveMatchContext, RawGeneratedQuestion } from './types.ts';

// ── Result type ───────────────────────────────────────────────────────

export interface LiveQualityResult {
  reject: boolean;
  reason: string;   // normalized rejection code (or 'pass')
  score: number;    // 0–100; populated for all outcomes, used for analytics
}

// ── Reject threshold ──────────────────────────────────────────────────

const REJECT_THRESHOLD = 50;

// ── Market key derivation ─────────────────────────────────────────────
//
// Returns a canonical market key from a resolved predicate.
// Covers all predicate types valid for CORE_MATCH_LIVE soccer questions.
// Returns 'other' for unclassifiable or unknown predicates.

export function deriveLiveMarketKey(predicate: unknown): string {
  const p = predicate as any;
  if (!p || typeof p !== 'object') return 'other';
  const type = p.resolution_type as string;

  switch (type) {
    case 'match_stat_window':
      return p.field === 'goals' ? 'goals_window' : 'cards_window';

    case 'match_outcome': {
      const bc = p.binary_condition as any;
      if (bc?.field === 'draw') return 'draw';
      return 'match_outcome_winner';
    }

    case 'btts':
      return 'btts';

    case 'match_stat': {
      const bc = p.binary_condition as any;
      if (!bc) return 'match_stat';
      if (bc.field === 'total_goals') return 'total_goals';
      // away_score = 0 → home team keeps a clean sheet
      if (bc.field === 'away_score' && bc.operator === 'eq' && bc.value === 0) return 'clean_sheet_home';
      // home_score = 0 → away team keeps a clean sheet
      if (bc.field === 'home_score' && bc.operator === 'eq' && bc.value === 0) return 'clean_sheet_away';
      return 'match_stat';
    }

    case 'player_stat': {
      const bc = p.binary_condition as any;
      const field = (bc?.field as string) ?? '';
      if (field === 'goals') return 'player_goal';
      if (field === 'cards' || field === 'yellow_cards') return 'player_card';
      return 'player_stat';
    }

    default:
      return 'other';
  }
}

// ── Main quality check ────────────────────────────────────────────────

export function checkLiveQuality(
  predicate: unknown,
  raw: RawGeneratedQuestion,
  liveCtx: LiveMatchContext,
): LiveQualityResult {
  const marketKey   = deriveLiveMarketKey(predicate);
  const scoreDiff   = Math.abs(liveCtx.homeScore - liveCtx.awayScore);
  const questionText = (raw.question_text ?? '').toLowerCase();

  // ── 1. already_resolved_clean_sheet ──────────────────────────────────
  // clean_sheet_home = "will the away_score end at 0?" (home team's clean sheet).
  // Impossible if the away team has already scored.
  if (marketKey === 'clean_sheet_home' && liveCtx.awayScore > 0) {
    return {
      reject: true,
      reason: `already_resolved_clean_sheet: home clean sheet impossible — away team has already scored ${liveCtx.awayScore} goal(s) (score: ${liveCtx.homeScore}–${liveCtx.awayScore})`,
      score: 0,
    };
  }
  // clean_sheet_away = "will the home_score end at 0?" (away team's clean sheet).
  // Impossible if the home team has already scored.
  if (marketKey === 'clean_sheet_away' && liveCtx.homeScore > 0) {
    return {
      reject: true,
      reason: `already_resolved_clean_sheet: away clean sheet impossible — home team has already scored ${liveCtx.homeScore} goal(s) (score: ${liveCtx.homeScore}–${liveCtx.awayScore})`,
      score: 0,
    };
  }

  // ── 2. already_resolved_btts ─────────────────────────────────────────
  // If both teams have already scored, "will both teams score?" is trivially YES.
  // The question has no predictive value.
  if (marketKey === 'btts' && liveCtx.homeScore > 0 && liveCtx.awayScore > 0) {
    return {
      reject: true,
      reason: `already_resolved_btts: both teams have already scored (${liveCtx.homeScore}–${liveCtx.awayScore}) — BTTS outcome is already determined`,
      score: 0,
    };
  }

  // ── 3. blowout_outcome_reject ─────────────────────────────────────────
  // "Who will win?" in a 3+ goal blowout is obvious. Asking it wastes a live slot.
  if (scoreDiff >= 3 && marketKey === 'match_outcome_winner') {
    return {
      reject: true,
      reason: `blowout_outcome_reject: winner question when score diff is ${scoreDiff} (${liveCtx.homeScore}–${liveCtx.awayScore}) — outcome too obvious`,
      score: 0,
    };
  }

  // ── 4. equaliser_blowout_reject ──────────────────────────────────────
  // Equaliser/comeback question with 2+ goal difference is near-impossible and low-value.
  // Covers both predicate-level and text-level phrasing.
  if (
    scoreDiff >= 2 &&
    /equali[sz]e?r?|come[\s-]*back|level\s+the\s+(tie|game|score|match)|level\s+up/i.test(questionText)
  ) {
    return {
      reject: true,
      reason: `equaliser_blowout_reject: equaliser/comeback question with score diff ${scoreDiff} (${liveCtx.homeScore}–${liveCtx.awayScore}) — too improbable`,
      score: 0,
    };
  }

  // ── 5. consecutive_same_market (time-driven only) ────────────────────
  // Prevent the same market key being asked twice in a row for time-driven questions.
  // Event-driven questions are NOT hard-rejected here — they may legitimately
  // react to a recent event using the same market (e.g. a second goal window
  // after a goal). They receive a soft penalty instead (see below).
  const nonVoided = liveCtx.matchQuestions.filter((q) => q.resolution_status !== 'voided');
  const lastQ     = nonVoided.length > 0 ? nonVoided[nonVoided.length - 1] : null;
  const lastKey   = lastQ ? deriveLiveMarketKey(lastQ.resolution_predicate) : null;

  if (
    lastKey !== null &&
    lastKey === marketKey &&
    marketKey !== 'other' &&
    liveCtx.generationTrigger === 'time_driven'
  ) {
    return {
      reject: true,
      reason: `consecutive_same_market: market "${marketKey}" matches the previous question — no same market twice in a row for time-driven questions`,
      score: 0,
    };
  }

  // ── Soft scoring ──────────────────────────────────────────────────────
  // Score starts at 100. Reject if score < REJECT_THRESHOLD (50).
  // v1: only one soft rule; score floor is 70 — no soft rejections in v1.
  // Infrastructure is in place for additional rules in v2.

  let score = 100;

  // event_driven_consecutive_same_market (-30):
  // Repeated market key from event-driven trigger is allowed but nudged down.
  // 100 - 30 = 70 → stays above threshold (50) → never rejects in v1.
  if (
    lastKey !== null &&
    lastKey === marketKey &&
    marketKey !== 'other' &&
    liveCtx.generationTrigger === 'event_driven'
  ) {
    score -= 30;
  }

  if (score < REJECT_THRESHOLD) {
    return {
      reject: true,
      reason: `live_quality_score: score=${score} below threshold=${REJECT_THRESHOLD}`,
      score,
    };
  }

  return { reject: false, reason: 'pass', score };
}
