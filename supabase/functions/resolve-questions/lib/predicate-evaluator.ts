// ── Predicate evaluator ───────────────────────────────────────────────
// Takes a ResolutionPredicate (JSONB from DB) + a normalised MatchStats
// object and returns { outcome, winningOptionId?, reason? }.
//
// outcome:
//   'correct'       → binary question resolved YES, or MC winning option found
//   'incorrect'     → binary question resolved NO
//   'unresolvable'  → data unavailable or predicate can't be evaluated

// ── Match event (from /fixtures/events endpoint, stored in live_match_stats.events) ──
// Used to evaluate match_stat_window predicates.
export interface MatchEvent {
  time:      number;        // match minute (elapsed)
  extra:     number | null; // extra-time minute (null if not in extra time)
  type:      string;        // "Goal" | "Card" | "subst" | "Var"
  detail:    string | null; // "Normal Goal" | "Own Goal" | "Yellow Card" | "Red Card" | etc.
  team_id:   number;
  team_name: string;
}

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
  events?:     MatchEvent[];        // optional — populated from live_match_stats.events when available
  lineups?:    any;                 // optional — populated from live_match_stats.lineups when available
}

export interface TeamStatBlock {
  yellow_cards: number;
  red_cards:    number;
  corners:      number;
  shots_total:  number;
  shots_on:     number;
}

export interface PlayerStatBlock {
  goals:               number;
  assists:             number;
  shots:               number;
  yellow_cards:        number;
  red_cards:           number;
  minutes_played:      number;
  clean_sheet:         boolean;
  // Extended stats
  passes_total:        number | null;
  passes_key:          number | null;
  dribbles_attempts:   number | null;
  dribbles_success:    number | null;
  tackles:             number | null;
  interceptions:       number | null;
  duels_total:         number | null;
  duels_won:           number | null;
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
    case 'match_stat_window':
      return evalMatchStatWindow(pred, stats);
    case 'btts':
      return evalBtts(stats);
    case 'match_lineup':
      return evalMatchLineup(pred, stats);
    case 'manual_review':
      // Admin-resolved — resolver leaves these pending; deadline auto-void is
      // handled upstream in the main resolver loop before evaluatePredicate is called.
      return { outcome: 'unresolvable', reason: 'pending_admin_review' };
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

// ── Match Stat Window ─────────────────────────────────────────────────
// Resolves live anchored-window questions by counting goal or card events
// that occurred within [window_start_minute, window_end_minute] (both inclusive).
// Event data comes from live_match_stats.events (minute-granular timeline).

function evalMatchStatWindow(pred: any, stats: MatchStats): EvalResult {
  const { field, operator, value, window_start_minute, window_end_minute } = pred;

  if (!stats.events) {
    return { outcome: 'unresolvable', reason: 'events_not_available' };
  }

  if (window_start_minute == null || window_end_minute == null) {
    return { outcome: 'unresolvable', reason: 'window_minutes_missing' };
  }

  if (window_end_minute <= window_start_minute) {
    return { outcome: 'unresolvable', reason: 'invalid_window_minutes' };
  }

  let count = 0;
  for (const event of stats.events) {
    const minute = event.time;
    if (minute < window_start_minute || minute > window_end_minute) continue;

    if (field === 'goals' && event.type === 'Goal') count++;
    if (field === 'cards' && event.type === 'Card') count++;
  }

  const match = applyOperator(count, operator, value);
  return { outcome: match ? 'correct' : 'incorrect' };
}

// ── BTTS ──────────────────────────────────────────────────────────────
// Both Teams To Score — true when both home_score >= 1 AND away_score >= 1.

function evalBtts(stats: MatchStats): EvalResult {
  const btts = stats.homeScore >= 1 && stats.awayScore >= 1;
  return { outcome: btts ? 'correct' : 'incorrect' };
}

// ── Match Lineup ──────────────────────────────────────────────────────
// Checks whether a player appears in the starting XI or full squad
// for a given match. Lineup data comes from live_match_stats.lineups
// which is populated by the live-stats-poller once per fixture.
//
// Lineup JSON shape (from API-Sports /fixtures/lineups):
//   [ { team: { id }, startXI: [ { player: { id, name } } ], substitutes: [...] }, ... ]

function evalMatchLineup(pred: any, stats: MatchStats): EvalResult {
  if (!stats.lineups) {
    return { outcome: 'unresolvable', reason: 'lineups_not_available' };
  }

  const playerId = String(pred.player_id);
  const check: 'starting_xi' | 'squad' = pred.check ?? 'squad';

  // lineups is an array of team lineup objects
  const lineupArr: any[] = Array.isArray(stats.lineups) ? stats.lineups : [];

  // Partial lineup response: API returned fewer than 2 team entries.
  // Optimistic check first: if the player IS in the available entry, answer is
  // definitively YES — return correct immediately rather than waiting for both
  // team lineups. Only return unresolvable if the player is NOT found, since
  // they might be in the missing team's lineup.
  if (lineupArr.length < 2) {
    for (const teamLineup of lineupArr) {
      const startXI: any[]    = teamLineup.startXI    ?? [];
      const substitutes: any[] = teamLineup.substitutes ?? [];
      const inStart = startXI.some((e: any) => String(e?.player?.id) === playerId);
      if (inStart) return { outcome: 'correct' };
      if (check === 'squad') {
        const inSub = substitutes.some((e: any) => String(e?.player?.id) === playerId);
        if (inSub) return { outcome: 'correct' };
      }
    }
    // Not found in partial data — may be in the missing team's lineup
    return { outcome: 'unresolvable', reason: 'lineups_incomplete' };
  }

  for (const teamLineup of lineupArr) {
    const startXI: any[] = teamLineup.startXI ?? [];
    const substitutes: any[] = teamLineup.substitutes ?? [];

    if (check === 'starting_xi') {
      const inStart = startXI.some((entry: any) =>
        String(entry?.player?.id) === playerId,
      );
      if (inStart) return { outcome: 'correct' };
    } else {
      // squad = starting XI + substitutes
      const inSquad =
        startXI.some((entry: any) => String(entry?.player?.id) === playerId) ||
        substitutes.some((entry: any) => String(entry?.player?.id) === playerId);
      if (inSquad) return { outcome: 'correct' };
    }
  }

  // Player not found in any team lineup — question resolves NO
  return { outcome: 'incorrect' };
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
    case 'shots_total': {
      let s = 0;
      for (const b of Object.values(stats.teamStats)) s += b.shots_total;
      return s;
    }
    default: return null;
  }
}

function getPlayerStatValue(field: string, p: PlayerStatBlock): number | boolean | null {
  switch (field) {
    case 'goals':               return p.goals;
    case 'assists':             return p.assists;
    case 'shots':               return p.shots;
    case 'cards':               return p.yellow_cards + p.red_cards;
    case 'yellow_cards':        return p.yellow_cards;
    case 'minutes_played':      return p.minutes_played;
    case 'clean_sheet':         return p.clean_sheet;
    // Extended stats
    case 'passes_total':        return p.passes_total;
    case 'passes_key':          return p.passes_key;
    case 'dribbles_attempts':   return p.dribbles_attempts;
    case 'dribbles_success':    return p.dribbles_success;
    case 'tackles':             return p.tackles;
    case 'interceptions':       return p.interceptions;
    case 'duels_total':         return p.duels_total;
    case 'duels_won':           return p.duels_won;
    default:                    return null;
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
