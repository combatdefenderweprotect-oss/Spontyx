// Clutch Answer Detector
//
// A clutch answer is a CORRECT answer to a CORE_MATCH_LIVE question that meets
// ALL of the following conditions:
//   1. The question is CORE_MATCH_LIVE (not PREMATCH or REAL_WORLD)
//   2. The answer is correct
//   3. clutch_context is present on the question (generated from live match state)
//   4. The answer was given in the clutch time window (last 20% of session scope)
//   5. The match was competitive at generation time (goal diff ≤ 1 OR player
//      was close to the leaderboard leader within 1 high-value question's worth)
//
// Clutch time windows:
//   first_half  → match_minute_at_generation ≥ 35
//   full_match  → match_minute_at_generation ≥ 80
//   second_half → match_minute_at_generation ≥ 80

export interface ClutchContext {
  match_minute_at_generation:  number;
  home_goals_at_generation:    number;
  away_goals_at_generation:    number;
  session_scope:               'full_match' | 'first_half' | 'second_half';
}

export interface ClutchCheckInput {
  questionType:        string | null;
  isCorrect:           boolean;
  clutchContext:       ClutchContext | null;
  leaderGapAtAnswer:   number | null;
}

export interface ClutchCheckResult {
  isClutch: boolean;
  reason:   string;
}

// XP bonus awarded for a clutch answer
export const CLUTCH_XP = 15;

// Achievement milestones for clutch_answers counter
export const CLUTCH_MILESTONES = new Set([1, 10, 50, 100]);

export function isClutchAnswer(input: ClutchCheckInput): ClutchCheckResult {
  const { questionType, isCorrect, clutchContext, leaderGapAtAnswer } = input;

  if (questionType !== 'CORE_MATCH_LIVE') {
    return { isClutch: false, reason: 'not_live_question' };
  }

  if (!isCorrect) {
    return { isClutch: false, reason: 'incorrect_answer' };
  }

  if (!clutchContext) {
    return { isClutch: false, reason: 'no_clutch_context' };
  }

  const { match_minute_at_generation, home_goals_at_generation, away_goals_at_generation, session_scope } = clutchContext;

  // ── Clutch time window ────────────────────────────────────────────────
  const clutchMinute = session_scope === 'first_half' ? 35 : 80;
  if (match_minute_at_generation < clutchMinute) {
    return { isClutch: false, reason: `too_early_minute_${match_minute_at_generation}_threshold_${clutchMinute}` };
  }

  // ── Competitive match condition ───────────────────────────────────────
  // Either the match was close (goal diff ≤ 1) OR the player was close to the
  // leaderboard leader (within ~1 high-value question = leader_gap ≤ 20 pts).
  const goalDiff = Math.abs((home_goals_at_generation ?? 0) - (away_goals_at_generation ?? 0));
  const isMatchClose   = goalDiff <= 1;
  const isLeaderClose  = (leaderGapAtAnswer ?? 0) <= 20;

  if (!isMatchClose && !isLeaderClose) {
    return { isClutch: false, reason: `not_competitive_goal_diff_${goalDiff}_leader_gap_${leaderGapAtAnswer ?? 0}` };
  }

  return { isClutch: true, reason: `minute_${match_minute_at_generation}_goal_diff_${goalDiff}` };
}
