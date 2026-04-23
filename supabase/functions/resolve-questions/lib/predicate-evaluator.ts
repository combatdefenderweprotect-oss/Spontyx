// ── Predicate evaluator ───────────────────────────────────────────────
// Takes a ResolutionPredicate (JSONB from DB) + a normalised MatchStats
// object and returns { outcome, winningOptionId?, reason? }.
//
// outcome:
//   'correct'       → binary question resolved YES, or MC winning option found
//   'incorrect'     → binary question resolved NO
//   'unresolvable'  → data unavailable or predicate can't be evaluated

export interface MatchStats {
  finished:    boolean;
  status:      string;              // 'FT', 'AET', 'PEN', 'PST', 'CANC', etc.
  homeTeamId:  string;
  awayTeamId:  string;
  homeScore:   number;
  awayScore:   number;
  winnerTeamId: string | null;      // null = draw
  isDraw:      boolean;
  teamStats:   Record<string, TeamStatBlock>;
  playerStats: Record<string, PlayerStatBlock>;
}

export interface TeamStatBlock {
  yellow_cards: number;
  red_cards:    number;
  corners:      number;
  shots_total:  number;
  shots_on:     number;
}

export interface PlayerStatBlock {
  goals:          number;
  assists:        number;
  shots:          number;
  yellow_cards:   number;
  red_cards:      number;
  minutes_played: number;
  clean_sheet:    boolean;
}

export interface EvalResult {
  outcome:         'correct' | 'incorrect' | 'unresolvable';
  winningOptionId?: string;   // MC only — the option id that won
  reason?:         string;    // when unresolvable, why
}

// ── Main entry point ──────────────────────────────────────────────────

export function evaluatePredicate(
  pred: any,
  stats: MatchStats,
  questionOptions: any[] | null,
): EvalResult {
  if (!stats.finished) {
    return { outcome: 'unresolvable', reason: 'match_not_finished' };
  }

  const type = pred.resolution_type as string;

  switch (type) {
    case 'match_outcome':
      return evalMatchOutcome(pred, stats);
    case 'match_stat':
      return evalMatchStat(pred, stats);
    case 'player_stat':
      return evalPlayerStat(pred, stats);
    case 'player_status':
      // Cannot reliably resolve historical injury status — void
      return { outcome: 'unresolvable', reason: 'player_status_no_historical_data' };
    case 'multiple_choice_map':
      return evalMultipleChoiceMap(pred, stats, questionOptions);
    default:
      return { outcome: 'unresolvable', reason: `unknown_resolution_type:${type}` };
  }
}

// ── Match Outcome ─────────────────────────────────────────────────────

function evalMatchOutcome(pred: any, stats: MatchStats): EvalResult {
  const { field, operator, value } = pred.binary_condition;

  if (field === 'winner_team_id') {
    const actual = stats.winnerTeamId;
    if (actual === null) {
      // Match was a draw — winner_team_id question resolves NO
      return { outcome: 'incorrect' };
    }
    const match = applyOperator(actual, operator, String(value));
    return { outcome: match ? 'correct' : 'incorrect' };
  }

  if (field === 'draw') {
    const match = applyOperator(stats.isDraw, operator, value);
    return { outcome: match ? 'correct' : 'incorrect' };
  }

  return { outcome: 'unresolvable', reason: `unknown_match_outcome_field:${field}` };
}

// ── Match Stat ────────────────────────────────────────────────────────

function evalMatchStat(pred: any, stats: MatchStats): EvalResult {
  const { field, operator, value } = pred.binary_condition;
  const actual = getMatchStatValue(field, stats);

  if (actual === null) {
    return { outcome: 'unresolvable', reason: `stat_unavailable:${field}` };
  }

  const match = applyOperator(actual, operator, value);
  return { outcome: match ? 'correct' : 'incorrect' };
}

// ── Player Stat ───────────────────────────────────────────────────────

function evalPlayerStat(pred: any, stats: MatchStats): EvalResult {
  const playerId = String(pred.player_id);
  const playerBlock = stats.playerStats[playerId];

  if (!playerBlock) {
    return { outcome: 'unresolvable', reason: `player_not_in_stats:${playerId}` };
  }

  const { field, operator, value } = pred.binary_condition;
  const actual = getPlayerStatValue(field, playerBlock);

  if (actual === null) {
    return { outcome: 'unresolvable', reason: `player_stat_unavailable:${field}` };
  }

  const match = applyOperator(actual, operator, value);
  return { outcome: match ? 'correct' : 'incorrect' };
}

// ── Multiple Choice Map ───────────────────────────────────────────────

function evalMultipleChoiceMap(
  pred: any,
  stats: MatchStats,
  questionOptions: any[] | null,
): EvalResult {
  const source = pred.source as string;
  const field  = pred.field  as string;
  const opts   = pred.options as Array<{ id: string; operator: string; value: any }>;

  // Resolve the actual value depending on source
  let actual: number | string | boolean | null = null;

  if (source === 'match_outcome') {
    if (field === 'winner_team_id') actual = stats.winnerTeamId;
    else if (field === 'draw')      actual = stats.isDraw;
  } else if (source === 'match_stat') {
    actual = getMatchStatValue(field, stats);
  } else if (source === 'player_stat') {
    const playerId = pred.player_id ? String(pred.player_id) : null;
    if (!playerId) return { outcome: 'unresolvable', reason: 'mc_player_stat_no_player_id' };
    const block = stats.playerStats[playerId];
    if (!block) return { outcome: 'unresolvable', reason: `mc_player_not_in_stats:${playerId}` };
    actual = getPlayerStatValue(field, block);
  }

  if (actual === null) {
    return { outcome: 'unresolvable', reason: `mc_stat_unavailable:${field}` };
  }

  // Find the winning option — exactly one should match
  const winning = opts.find((o) => applyOperator(actual!, o.operator, o.value));
  if (!winning) {
    return { outcome: 'unresolvable', reason: 'mc_no_option_matched' };
  }

  return { outcome: 'correct', winningOptionId: winning.id };
}

// ── Field extractors ──────────────────────────────────────────────────

function getMatchStatValue(field: string, stats: MatchStats): number | null {
  switch (field) {
    case 'total_goals': return stats.homeScore + stats.awayScore;
    case 'home_score':  return stats.homeScore;
    case 'away_score':  return stats.awayScore;
    case 'total_cards': {
      let c = 0;
      for (const b of Object.values(stats.teamStats)) c += b.yellow_cards + b.red_cards;
      return c;
    }
    case 'total_corners': {
      let c = 0;
      for (const b of Object.values(stats.teamStats)) c += b.corners;
      return c;
    }
    default: return null;
  }
}

function getPlayerStatValue(field: string, p: PlayerStatBlock): number | boolean | null {
  switch (field) {
    case 'goals':          return p.goals;
    case 'assists':        return p.assists;
    case 'shots':          return p.shots;
    case 'cards':          return p.yellow_cards + p.red_cards;
    case 'minutes_played': return p.minutes_played;
    case 'clean_sheet':    return p.clean_sheet;
    default:               return null;
  }
}

// ── Operator evaluation ───────────────────────────────────────────────

function applyOperator(
  actual: number | string | boolean | null,
  operator: string,
  expected: number | string | boolean,
): boolean {
  switch (operator) {
    case 'eq':
      // String comparison for team IDs; numeric for everything else
      return String(actual) === String(expected);
    case 'gt':  return Number(actual) >  Number(expected);
    case 'gte': return Number(actual) >= Number(expected);
    case 'lt':  return Number(actual) <  Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    default:    return false;
  }
}
