// ─────────────────────────────────────────────────────────────────────────────
// trivia-config.js — Central Trivia game rules configuration
// Load before trivia.html scripts. Exposes global: TriviaConfig
// ─────────────────────────────────────────────────────────────────────────────

const TriviaConfig = (() => {

  // ── Game lengths ───────────────────────────────────────────────────────────
  // Each entry: { allowed: number[], default: number, fixed: bool }
  // fixed:true means the host/user cannot change the round count.

  const GAME_LENGTHS = {
    solo: {
      allowed:  [10, 15, 25],
      default:  15,
      fixed:    false,
      labels:   { 10: 'Quick', 15: 'Standard', 25: 'Long Game' },
      freeAiMax: 10,      // Free-tier daily AI game is capped at 10 questions
    },
    ranked_duel: {
      allowed:  [10],
      default:  10,
      fixed:    true,     // Ranked duel is always 10 questions — not configurable
    },
    friend_duel: {
      // Not yet implemented. Config reserved.
      allowed:  [5, 10, 15],
      default:  10,
      fixed:    false,
    },
    party: {
      allowed:  [10, 15, 20, 30],
      default:  15,
      fixed:    false,
    },
    event: {
      allowed:  [10, 20, 30, 50],
      default:  20,
      fixed:    false,
    },
  };

  // ── Timers (seconds per question) ─────────────────────────────────────────
  // ranked_duel is fixed and enforced server-side.
  // All others are the current defaults; host-configurable UI comes later.

  const TIMERS = {
    solo:        { default: 20, fixed: false },
    ranked_duel: { default: 15, fixed: true  },  // server-enforced, not client configurable
    friend_duel: { default: 20, fixed: false },
    party:       { default: 20, fixed: false },
    event:       { default: 20, fixed: false },
  };

  // Warning thresholds (seconds remaining) — drives ring colour changes
  const TIMER_WARNING_AT  = 8;   // ring turns amber
  const TIMER_CRITICAL_AT = 5;   // ring turns red

  // ── Rating rules ──────────────────────────────────────────────────────────
  // Only ranked_duel affects trivia rating.
  // All other modes affect XP only.

  const RATING_RULES = {
    solo:        { affectsRating: false, affectsXP: true  },
    ranked_duel: { affectsRating: true,  affectsXP: true  },
    friend_duel: { affectsRating: false, affectsXP: true  },
    party:       { affectsRating: false, affectsXP: true  },
    event:       { affectsRating: false, affectsXP: true  },
  };

  // ── XP mode multipliers ───────────────────────────────────────────────────
  // Applied to session total after per-question XP is summed.
  // These match the architecture decision (Party 0.6, Event 0.5 for approved).

  const XP_MODE_MULTIPLIERS = {
    solo:        1.0,
    ranked_duel: 1.0,
    friend_duel: 0.8,   // slightly reduced vs ranked
    party:       0.6,
    event:       0.5,   // further reduced for event (source penalties applied separately)
  };

  // ── Win conditions ─────────────────────────────────────────────────────────

  const WIN_CONDITIONS = {
    solo: {
      // Session ends when all selected questions are answered or user quits.
      // No opponent — no win/loss, only stars (0–3) and XP.
      endsAfterAllQuestions: true,
      hasWinner:             false,
    },
    ranked_duel: {
      // 10 fixed questions, both players see identical set in identical order.
      // Winner = most correct answers.
      // Tiebreak 1: lower average response time wins.
      // Tiebreak 2: if same correct count AND same avg response time → draw.
      endsAfterAllQuestions: true,
      hasWinner:             true,
      tiebreakByResponseTime: true,
      allowDraw:             true,
      resultStates:          ['win', 'loss', 'draw'],
    },
    friend_duel: {
      // Same tiebreak logic as ranked_duel, no rating change.
      endsAfterAllQuestions: true,
      hasWinner:             true,
      tiebreakByResponseTime: true,
      allowDraw:             true,
      resultStates:          ['win', 'loss', 'draw'],
    },
    party: {
      // Highest score (XP) at end of all rounds wins.
      // No tiebreak rule — ties are acceptable.
      endsAfterAllQuestions: true,
      hasWinner:             true,
      tiebreakByResponseTime: false,
      allowDraw:             true,
      resultStates:          ['winner', 'participant'],
    },
    event: {
      // Highest score wins. Host ends the event after all questions.
      endsAfterAllQuestions: true,
      hasWinner:             true,
      tiebreakByResponseTime: false,
      allowDraw:             true,
      resultStates:          ['winner', 'participant'],
    },
  };

  // ── XP scoring constants ───────────────────────────────────────────────────
  // These drive getXPForDiff() and the speed/streak multipliers.

  const XP_BASE = {
    easy:   5,
    medium: 10,
    hard:   20,
  };

  const XP_SPEED_MULTIPLIERS = [
    { maxSeconds: 5,  multiplier: 1.5 },
    { maxSeconds: 10, multiplier: 1.2 },
    { maxSeconds: Infinity, multiplier: 1.0 },
  ];

  const XP_STREAK_MULTIPLIERS = [
    { minStreak: 8, multiplier: 1.4 },
    { minStreak: 5, multiplier: 1.25 },
    { minStreak: 3, multiplier: 1.1 },
    { minStreak: 0, multiplier: 1.0 },
  ];

  const XP_PERFECT_GAME_BONUS = 1.3;   // ×1.3 applied to session total if wrongCount === 0

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getGameLength(mode) {
    return GAME_LENGTHS[mode] || GAME_LENGTHS.solo;
  }

  function getDefaultRounds(mode) {
    return getGameLength(mode).default;
  }

  function isRoundCountAllowed(mode, n) {
    const cfg = getGameLength(mode);
    return cfg.fixed ? n === cfg.default : cfg.allowed.includes(n);
  }

  function getTimer(mode) {
    return TIMERS[mode] || TIMERS.solo;
  }

  function getDefaultTimerSeconds(mode) {
    return getTimer(mode).default;
  }

  function isTimerFixed(mode) {
    return !!(getTimer(mode).fixed);
  }

  function affectsRating(mode) {
    return !!(RATING_RULES[mode] && RATING_RULES[mode].affectsRating);
  }

  function getXpMultiplier(mode) {
    return XP_MODE_MULTIPLIERS[mode] !== undefined ? XP_MODE_MULTIPLIERS[mode] : 1.0;
  }

  function getSpeedMultiplier(responseSeconds) {
    for (const rule of XP_SPEED_MULTIPLIERS) {
      if (responseSeconds <= rule.maxSeconds) return rule.multiplier;
    }
    return 1.0;
  }

  function getStreakMultiplier(streak) {
    for (const rule of XP_STREAK_MULTIPLIERS) {
      if (streak >= rule.minStreak) return rule.multiplier;
    }
    return 1.0;
  }

  function getWinCondition(mode) {
    return WIN_CONDITIONS[mode] || WIN_CONDITIONS.solo;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    // Raw constants (read-only access)
    GAME_LENGTHS,
    TIMERS,
    TIMER_WARNING_AT,
    TIMER_CRITICAL_AT,
    RATING_RULES,
    XP_MODE_MULTIPLIERS,
    XP_BASE,
    XP_SPEED_MULTIPLIERS,
    XP_STREAK_MULTIPLIERS,
    XP_PERFECT_GAME_BONUS,
    WIN_CONDITIONS,

    // Helper functions
    getGameLength,
    getDefaultRounds,
    isRoundCountAllowed,
    getTimer,
    getDefaultTimerSeconds,
    isTimerFixed,
    affectsRating,
    getXpMultiplier,
    getSpeedMultiplier,
    getStreakMultiplier,
    getWinCondition,
  };

})();
