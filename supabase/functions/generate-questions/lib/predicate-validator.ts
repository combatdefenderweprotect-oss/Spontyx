import type {
  ResolutionPredicate,
  RawGeneratedQuestion,
  SportsContext,
  LeagueWithConfig,
  RejectionLogEntry,
} from './types.ts';

// Valid fields per resolution_type
const VALID_FIELDS: Record<string, string[]> = {
  match_outcome: ['winner_team_id', 'draw'],
  match_stat:    ['total_goals', 'total_cards', 'total_corners', 'home_score', 'away_score', 'shots_total'],
  player_stat:   ['goals', 'assists', 'shots', 'cards', 'yellow_cards', 'minutes_played', 'clean_sheet',
                  'passes_total', 'passes_key', 'dribbles_attempts', 'dribbles_success',
                  'tackles', 'interceptions', 'duels_total', 'duels_won'],
  player_status: ['injury_status'],
};

const NUMERIC_OPERATORS = ['gt', 'gte', 'lt', 'lte'];
const ALL_OPERATORS     = ['eq', 'gt', 'gte', 'lt', 'lte'];

export interface ValidationResult {
  valid: boolean;
  stage?: RejectionLogEntry['stage'];
  error?: string;
}

// ── Master validator — runs all 4 checks in sequence ─────────────────

export function validateQuestion(
  raw: RawGeneratedQuestion,
  predicate: ResolutionPredicate,
  sportsCtx: SportsContext,
  league: LeagueWithConfig,
  attempt: number,
  questionType?: 'CORE_MATCH_PREMATCH' | 'CORE_MATCH_LIVE' | 'REAL_WORLD',
): RejectionLogEntry | null {
  const checks: Array<() => ValidationResult> = [
    () => checkSchema(predicate, raw),
    () => checkEntities(predicate, raw, sportsCtx, league, questionType),
    () => checkTemporal(raw),
    () => checkLogic(predicate, raw),
    () => checkLiveTiming(predicate, raw),
    () => checkAvailability(predicate, raw, sportsCtx),
  ];

  for (const check of checks) {
    const result = check();
    if (!result.valid) {
      return {
        attempt,
        stage:         result.stage!,
        question_text: raw.question_text,
        error:         result.error!,
      };
    }
  }

  return null; // all checks passed
}

// ── Check 1: Schema ───────────────────────────────────────────────────
// All required fields present, correct types, no unknown resolution_type.

function checkSchema(pred: ResolutionPredicate, raw: RawGeneratedQuestion): ValidationResult {
  const stage = 'schema_validation';

  if (!pred || typeof pred !== 'object') {
    return { valid: false, stage, error: 'predicate is not an object' };
  }

  const type = (pred as any).resolution_type;
  const validTypes = [
    'match_outcome', 'match_stat', 'player_stat', 'player_status',
    'multiple_choice_map', 'match_stat_window', 'btts',
    'match_lineup', 'manual_review',
  ];
  if (!validTypes.includes(type)) {
    return { valid: false, stage, error: `unknown resolution_type: ${type}` };
  }

  // ── manual_review: admin resolves; no sport/match_id required ────────
  // Must be checked BEFORE the sport field guard below (manual_review
  // predicates are not tied to a match and have no sport field).
  if (type === 'manual_review') {
    const p = pred as any;
    const validCategories = ['coach_status', 'transfer', 'contract', 'disciplinary'];
    if (!p.category || !validCategories.includes(p.category)) {
      return { valid: false, stage, error: `manual_review category must be one of: ${validCategories.join(', ')}` };
    }
    if (!p.description) {
      return { valid: false, stage, error: 'manual_review requires description' };
    }
    if (!p.resolution_deadline) {
      return { valid: false, stage, error: 'manual_review requires resolution_deadline' };
    }
    return { valid: true };
  }

  if (!('sport' in pred) || typeof (pred as any).sport !== 'string') {
    return { valid: false, stage, error: 'missing or invalid sport field' };
  }

  // ── match_stat_window: no binary_condition — handle before else block ──
  // (Fixes latent bug: the else block below requires binary_condition for all
  //  non-MC types; match_stat_window doesn't have one.)
  if (type === 'match_stat_window') {
    const msw = pred as any;
    if (!msw.match_id) {
      return { valid: false, stage, error: 'match_stat_window requires match_id' };
    }
    if (!msw.field || !['goals', 'cards'].includes(msw.field)) {
      return { valid: false, stage, error: `match_stat_window field must be "goals" or "cards", got: ${msw.field}` };
    }
    if (!msw.operator || !ALL_OPERATORS.includes(msw.operator)) {
      return { valid: false, stage, error: `match_stat_window invalid operator: ${msw.operator}` };
    }
    if (msw.value === undefined || typeof msw.value !== 'number') {
      return { valid: false, stage, error: 'match_stat_window missing or invalid value (must be a number)' };
    }
    if (msw.window_start_minute == null || typeof msw.window_start_minute !== 'number') {
      return { valid: false, stage, error: 'match_stat_window requires window_start_minute (number)' };
    }
    if (msw.window_end_minute == null || typeof msw.window_end_minute !== 'number') {
      return { valid: false, stage, error: 'match_stat_window requires window_end_minute (number)' };
    }
    // Logical window checks are in checkLogic
    return { valid: true };
  }

  // ── match_lineup: check player is in starting XI or squad ─────────────
  if (type === 'match_lineup') {
    const p = pred as any;
    if (!p.match_id) {
      return { valid: false, stage, error: 'match_lineup requires match_id' };
    }
    if (!p.player_id) {
      return { valid: false, stage, error: 'match_lineup requires player_id' };
    }
    if (!p.player_name) {
      return { valid: false, stage, error: 'match_lineup requires player_name' };
    }
    if (!p.check || !['starting_xi', 'squad'].includes(p.check)) {
      return { valid: false, stage, error: `match_lineup check must be "starting_xi" or "squad", got: ${p.check}` };
    }
    return { valid: true };
  }

  // ── btts: no binary_condition — just needs match_id ───────────────────
  if (type === 'btts') {
    const p = pred as any;
    if (!p.match_id) {
      return { valid: false, stage, error: 'btts requires match_id' };
    }
    return { valid: true };
  }

  if (type === 'multiple_choice_map') {
    const mc = pred as any;
    if (!Array.isArray(mc.options) || mc.options.length === 0) {
      return { valid: false, stage, error: 'multiple_choice_map missing options array' };
    }
    if (!mc.field || typeof mc.field !== 'string') {
      return { valid: false, stage, error: 'multiple_choice_map missing field' };
    }
    if (!mc.source || !['match_outcome','match_stat','player_stat'].includes(mc.source)) {
      return { valid: false, stage, error: `multiple_choice_map invalid source: ${mc.source}` };
    }
    for (const opt of mc.options) {
      if (!opt.id || !ALL_OPERATORS.includes(opt.operator) || opt.value === undefined) {
        return { valid: false, stage, error: `MC option malformed: ${JSON.stringify(opt)}` };
      }
    }
  } else {
    // All remaining types (match_outcome, match_stat, player_stat, player_status) use binary_condition
    const p = pred as any;
    if (!p.binary_condition || typeof p.binary_condition !== 'object') {
      return { valid: false, stage, error: 'missing binary_condition' };
    }
    const bc = p.binary_condition;
    if (!bc.field || !ALL_OPERATORS.includes(bc.operator) || bc.value === undefined) {
      return { valid: false, stage, error: `binary_condition malformed: ${JSON.stringify(bc)}` };
    }

    if (['match_outcome','match_stat','player_stat'].includes(type) && !p.match_id) {
      return { valid: false, stage, error: `${type} requires match_id` };
    }
    if (type === 'player_stat' && !p.player_id) {
      return { valid: false, stage, error: 'player_stat requires player_id' };
    }
    if (type === 'player_status' && !p.player_id) {
      return { valid: false, stage, error: 'player_status requires player_id' };
    }
    if (type === 'player_status' && !p.check_at) {
      return { valid: false, stage, error: 'player_status requires check_at' };
    }
  }

  // For MC questions, predicate must be multiple_choice_map
  if (raw.type === 'multiple_choice' && type !== 'multiple_choice_map') {
    return { valid: false, stage, error: 'multiple_choice question must use multiple_choice_map predicate' };
  }
  if (raw.type === 'binary' && type === 'multiple_choice_map') {
    return { valid: false, stage, error: 'binary question must not use multiple_choice_map predicate' };
  }

  return { valid: true };
}

// ── Check 2: Entity validation ────────────────────────────────────────
// All entity IDs referenced in the predicate must exist in the sports context.
// For team_specific leagues, all entities must belong to the scoped team's matches.

function checkEntities(
  pred: ResolutionPredicate,
  raw: RawGeneratedQuestion,
  ctx: SportsContext,
  league: LeagueWithConfig,
  questionType?: 'CORE_MATCH_PREMATCH' | 'CORE_MATCH_LIVE' | 'REAL_WORLD',
): ValidationResult {
  const stage = 'entity_validation';

  const validMatchIds  = new Set(ctx.upcomingMatches.map((m) => m.id));
  const validPlayerIds = new Set(ctx.keyPlayers.map((p) => p.id));
  const validTeamIds   = new Set(ctx.upcomingMatches.flatMap((m) => [m.homeTeam.id, m.awayTeam.id]));

  const p = pred as any;

  // Match ID check (covers all predicate types that carry match_id)
  if (p.match_id && !validMatchIds.has(String(p.match_id))) {
    return { valid: false, stage, error: `match_id ${p.match_id} not found in upcoming matches` };
  }

  // Player ID check — skipped for match_lineup and, for REAL_WORLD questions only,
  // for player_stat predicates.
  //
  // WHY match_lineup is exempt (both lanes):
  //   match_lineup questions ask whether a player will appear in the starting XI or
  //   squad. The player is identified from news/squad data and may not be on the injury
  //   list at all (e.g. returning from injury). validPlayerIds is the keyPlayers injury
  //   focus list (~5–15 players) — not a full squad. Blocking on absence from that list
  //   inverts the intent of these questions entirely.
  //
  // WHY player_stat is additionally exempt for REAL_WORLD:
  //   REAL_WORLD TYPE 2 (yellow-card risk) and TYPE 3 (form/goals/assists) questions
  //   target fit, active players identified from news signals. These players will not
  //   appear in validPlayerIds (injury/fitness list only). The CORE_MATCH validator
  //   keeps strict player_id enforcement because it validates against match-specific
  //   context that includes all participating players. REAL_WORLD questions are driven
  //   by news signals, not match context — the news article IS the entity validation.
  //
  // CORE_MATCH_PREMATCH and CORE_MATCH_LIVE are unaffected — strict enforcement kept.
  const isRealWorldPlayerStat =
    questionType === 'REAL_WORLD' && p.resolution_type === 'player_stat';

  if (
    p.player_id &&
    p.resolution_type !== 'match_lineup' &&
    !isRealWorldPlayerStat &&
    !validPlayerIds.has(String(p.player_id))
  ) {
    return { valid: false, stage, error: `player_id ${p.player_id} not found in key players` };
  }

  // Team ID in binary_condition value (for match_outcome)
  if (p.resolution_type === 'match_outcome' && p.binary_condition?.field === 'winner_team_id') {
    const teamId = String(p.binary_condition.value);
    if (!validTeamIds.has(teamId)) {
      return { valid: false, stage, error: `winner_team_id value ${teamId} not found in match teams` };
    }
  }

  // Team scope enforcement — all referenced entities must belong to scoped team's matches
  if (league.scope === 'team_specific' && league.api_sports_team_id) {
    const teamIdStr = String(league.api_sports_team_id);
    if (p.match_id) {
      const match = ctx.upcomingMatches.find((m) => m.id === String(p.match_id));
      if (match && match.homeTeam.id !== teamIdStr && match.awayTeam.id !== teamIdStr) {
        return { valid: false, stage, error: `match ${p.match_id} does not involve scoped team ${teamIdStr}` };
      }
    }
    if (p.player_id) {
      const player = ctx.keyPlayers.find((pl) => pl.id === String(p.player_id));
      if (player && player.teamId !== teamIdStr) {
        return { valid: false, stage, error: `player ${p.player_id} (${player.teamName}) is not on scoped team` };
      }
    }
  }

  // Also validate raw question entity IDs
  for (const tid of (raw.team_ids ?? [])) {
    if (!validTeamIds.has(String(tid))) {
      return { valid: false, stage, error: `raw question team_id ${tid} not found in match teams` };
    }
  }

  return { valid: true };
}

// ── Check 3: Temporal validation ──────────────────────────────────────

function checkTemporal(raw: RawGeneratedQuestion): ValidationResult {
  const stage = 'temporal_validation';
  const now   = Date.now();

  const opensAt      = new Date(raw.opens_at).getTime();
  const deadline     = new Date(raw.deadline).getTime();
  const resolvesAfter = new Date(raw.resolves_after).getTime();

  if (isNaN(opensAt) || isNaN(deadline) || isNaN(resolvesAfter)) {
    return { valid: false, stage, error: 'one or more timestamps are invalid' };
  }

  // opens_at must be no more than 7 days in the future.
  // Prematch questions legitimately open days before kickoff.
  if (opensAt > now + 7 * 24 * 60 * 60 * 1000) {
    return { valid: false, stage, error: `opens_at is too far in the future: ${raw.opens_at}` };
  }

  // Deadline must be at least 30 minutes from now
  if (deadline < now + 30 * 60 * 1000) {
    return { valid: false, stage, error: `deadline is too soon or in the past: ${raw.deadline}` };
  }

  // Ordering: opens_at <= deadline < resolves_after
  if (opensAt > deadline) {
    return { valid: false, stage, error: 'opens_at is after deadline' };
  }
  if (deadline >= resolvesAfter) {
    return { valid: false, stage, error: 'deadline must be before resolves_after' };
  }

  // resolves_after must be at least 90 minutes after deadline
  if (resolvesAfter < deadline + 90 * 60 * 1000) {
    return { valid: false, stage, error: 'resolves_after is too close to deadline (need at least 90 min gap)' };
  }

  return { valid: true };
}

// ── Check 4: Logic validation ─────────────────────────────────────────
// Field-operator compatibility, MC option alignment.

function checkLogic(pred: ResolutionPredicate, raw: RawGeneratedQuestion): ValidationResult {
  const stage = 'logic_validation';
  const p = pred as any;
  const type = p.resolution_type as string;

  if (type === 'match_stat_window') {
    const anchoringType = (p.anchoring_type as string | undefined) ?? 'fixed_window';
    const windowSize = p.window_end_minute - p.window_start_minute;

    if (p.window_end_minute <= p.window_start_minute) {
      return { valid: false, stage, error: 'match_stat_window: window_end_minute must be strictly after window_start_minute' };
    }
    if (windowSize < 3) {
      return { valid: false, stage, error: `match_stat_window: window too small (${windowSize} min — minimum is 3)` };
    }

    // Maximum window size depends on anchoring type:
    //   fixed_window  → 3–7 min  (narrow, specific span)
    //   deadline      → 3–45 min (can span to a milestone minute)
    //   match_phase   → 3–90 min (can span to half-time or full-time)
    if (anchoringType === 'fixed_window' && windowSize > 7) {
      return { valid: false, stage, error: `match_stat_window: fixed_window too large (${windowSize} min — maximum is 7 for fixed_window type)` };
    }
    if (anchoringType === 'deadline' && windowSize > 45) {
      return { valid: false, stage, error: `match_stat_window: deadline window too large (${windowSize} min — maximum is 45 for deadline type)` };
    }
    if (anchoringType === 'match_phase' && windowSize > 90) {
      return { valid: false, stage, error: `match_stat_window: match_phase window too large (${windowSize} min — maximum is 90)` };
    }

    if (p.window_start_minute < 1) {
      return { valid: false, stage, error: `match_stat_window: window_start_minute must be ≥ 1, got ${p.window_start_minute}` };
    }
    if (p.window_end_minute > 120) {
      return { valid: false, stage, error: `match_stat_window: window_end_minute must be ≤ 120, got ${p.window_end_minute}` };
    }
    return { valid: true };
  }

  if (type === 'multiple_choice_map') {
    // MC options in predicate must match options in question
    if (raw.options && raw.options.length > 0) {
      const predOptionIds = new Set((p.options as any[]).map((o: any) => o.id));
      for (const opt of raw.options) {
        if (!predOptionIds.has(opt.id)) {
          return {
            valid: false,
            stage,
            error: `question option id "${opt.id}" missing from predicate options`,
          };
        }
      }
    }

    // Validate field is compatible with source
    const validFieldsForSource = VALID_FIELDS[p.source] ?? [];
    if (validFieldsForSource.length > 0 && !validFieldsForSource.includes(p.field)) {
      return { valid: false, stage, error: `field "${p.field}" not valid for source "${p.source}"` };
    }
  } else {
    // Validate field name
    const validFields = VALID_FIELDS[type] ?? [];
    if (validFields.length > 0 && !validFields.includes(p.binary_condition.field)) {
      return {
        valid: false,
        stage,
        error: `field "${p.binary_condition.field}" not valid for resolution_type "${type}"`,
      };
    }

    // winner_team_id can only use 'eq'
    if (p.binary_condition.field === 'winner_team_id' && p.binary_condition.operator !== 'eq') {
      return { valid: false, stage, error: 'winner_team_id must use operator "eq"' };
    }

    // Numeric fields must not use 'eq' on string values
    if (
      NUMERIC_OPERATORS.includes(p.binary_condition.operator) &&
      typeof p.binary_condition.value === 'string'
    ) {
      return {
        valid: false,
        stage,
        error: `operator ${p.binary_condition.operator} requires a numeric value`,
      };
    }
  }

  return { valid: true };
}

// ── Check 5: Live timing validation ──────────────────────────────────
// Enforces three live-specific timing rules for match_stat_window predicates.
// Only runs when match_minute_at_generation is set (i.e. live questions).
// Prematch questions (match_minute_at_generation = null) pass through immediately.
//
// Rejection codes:
//   relative_time_window_rejected — question text uses banned relative phrasing
//   invalid_live_window           — window starts in the past (≤ current match minute)
//   answer_window_overlap         — window starts too soon after current minute (< 3 min gap)

function checkLiveTiming(pred: ResolutionPredicate, raw: RawGeneratedQuestion): ValidationResult {
  const stage: RejectionLogEntry['stage'] = 'live_timing_validation';

  // Only applies to live questions (match_minute_at_generation is set for live, null for prematch)
  const matchMinute = raw.match_minute_at_generation;
  if (matchMinute == null) return { valid: true };

  // ── relative_time_window_rejected ──────────────────────────────────────
  // Live questions must use anchored match-minute windows, not relative phrasing.
  // Relative phrasing is unfair across TV/stream/API delays.
  const RELATIVE_PATTERNS = [
    /\bin the next \d+/i,
    /\bin the next few/i,
    /\bcoming minutes\b/i,
    /\bshortly\b/i,
    /\bin the coming\b/i,
    /\bover the next\b/i,
    /\bwithin the next\b/i,
  ];
  const questionText = raw.question_text ?? '';
  for (const pattern of RELATIVE_PATTERNS) {
    if (pattern.test(questionText)) {
      return {
        valid: false,
        stage,
        error: `relative_time_window_rejected: live question uses relative timing language — must use anchored match-minute windows. Matched in: "${questionText.slice(0, 80)}"`,
      };
    }
  }

  // Remaining checks only apply to match_stat_window predicates
  const p = pred as any;
  if (p.resolution_type !== 'match_stat_window') return { valid: true };

  // ── invalid_live_window ────────────────────────────────────────────────
  // The prediction window must start strictly after the current match minute.
  // A window that has already started or is in the past cannot be fair.
  if (p.window_start_minute != null && p.window_start_minute <= matchMinute) {
    return {
      valid: false,
      stage,
      error: `invalid_live_window: window_start_minute (${p.window_start_minute}) must be > current match_minute (${matchMinute}) — window cannot start in the past or at the current minute`,
    };
  }

  // ── answer_window_overlap ──────────────────────────────────────────────
  // The answer collection period must close before the prediction window begins.
  // We enforce at least a 3-minute gap between current play and window start as a
  // proxy for "answer_closes_at < windowStart real-time" (kickoff not available here).
  // Rationale: visible_from delay (up to 45s) + 90s minimum answer window = 135s > 120s (2 min).
  // A 3-minute gap guarantees the 90-second floor is always achievable across all delivery lags.
  // Exception: when match_minute >= 87, the gap is relaxed to 1 minute (late-match edge case).
  const MIN_GAP = matchMinute >= 87 ? 1 : 3;
  if (p.window_start_minute != null && (p.window_start_minute - matchMinute) < MIN_GAP) {
    return {
      valid: false,
      stage,
      error: `answer_window_overlap: window_start_minute (${p.window_start_minute}) is too close to current match_minute (${matchMinute}) — need at least ${MIN_GAP} minutes gap so the answer period can close before the prediction window opens`,
    };
  }

  // ── Late-match hard reject ─────────────────────────────────────────────
  // At minute 89 or later, there is not enough match time remaining to create
  // any valid anchored window. Always reject to prevent invalid questions.
  if (matchMinute >= 89) {
    return {
      valid: false,
      stage,
      error: `answer_window_overlap: match_minute (${matchMinute}) >= 89 — insufficient match time remaining to generate a valid anchored window question`,
    };
  }

  return { valid: true };
}

// ── Check 6: Player availability ──────────────────────────────────────
// Blocks questions that reference injured or suspended players.
// Checks both the predicate's player_id and the raw question's player_ids.
// Safe to run when no availability data is present — passes through.
//
// REAL_WORLD match_lineup EXEMPTION:
// TYPE 1 REAL_WORLD questions ("Will X return from injury for this match?") are
// specifically ABOUT injured or suspended players — the injury IS the news signal.
// Blocking them here inverts the intent of the entire question type.
// match_lineup predicates are fully exempt from the unavailability check.

function checkAvailability(
  pred: ResolutionPredicate,
  raw: RawGeneratedQuestion,
  ctx: SportsContext,
): ValidationResult {
  const stage: RejectionLogEntry['stage'] = 'availability_validation';

  // Exempt match_lineup predicates — these ask about a player's availability status,
  // which is only interesting when the player is injured or in doubt.
  if ((pred as any).resolution_type === 'match_lineup') return { valid: true };

  // Build the combined set of unavailable player IDs from both data sources
  const unavailableIds = new Set<string>();

  for (const a of (ctx.playerAvailability ?? [])) {
    if (a.status === 'unavailable') unavailableIds.add(a.playerId);
  }
  // Also catch players flagged in keyPlayers (covers fallback when no fixture-level data)
  for (const p of ctx.keyPlayers) {
    if (p.injuryStatus === 'injured' || p.injuryStatus === 'suspended') {
      unavailableIds.add(p.id);
    }
  }

  if (unavailableIds.size === 0) return { valid: true };

  const p = pred as any;

  // Check predicate-level player_id (player_stat and player_status predicates)
  if (p.player_id) {
    const pid = String(p.player_id);
    if (unavailableIds.has(pid)) {
      const name = lookupPlayerName(pid, ctx);
      return {
        valid: false,
        stage,
        error: `player_unavailable: ${name} (id: ${pid}) is injured or suspended — cannot generate questions about this player`,
      };
    }
  }

  // Check raw question player_ids list (set by the system from predicate hints)
  for (const pid of (raw.player_ids ?? [])) {
    const pidStr = String(pid);
    if (unavailableIds.has(pidStr)) {
      const name = lookupPlayerName(pidStr, ctx);
      return {
        valid: false,
        stage,
        error: `player_unavailable: ${name} (id: ${pidStr}) is injured or suspended`,
      };
    }
  }

  // ── answer_already_known: reject start/availability questions when lineup is confirmed ──
  // Build the set of players whose lineup status is confirmed (starting or substitute).
  // Only player_status predicates map to "Will X start?" — those are the only questions
  // whose answer is trivially known once a lineup is published.
  const lineupConfirmedIds = new Set(
    (ctx.playerAvailability ?? [])
      .filter((a) => a.source === 'lineup' && (a.status === 'starting' || a.status === 'substitute'))
      .map((a) => a.playerId),
  );

  if (lineupConfirmedIds.size > 0) {
    const p2 = pred as any;
    const isStartQuestion =
      p2.resolution_type === 'player_status' ||
      raw.question_subtype === 'player_start' ||
      /\bstart(s|ing|ed)?\b|\blineup\b|\bselected\b|\bin the squad\b/i.test(raw.question_text ?? '');

    if (isStartQuestion && p2.player_id && lineupConfirmedIds.has(String(p2.player_id))) {
      const entry = ctx.playerAvailability?.find((a) => a.playerId === String(p2.player_id));
      const name  = entry?.playerName ?? String(p2.player_id);
      const status = entry?.status ?? 'in lineup';
      return {
        valid: false,
        stage,
        error: `answer_already_known: lineup confirmed, ${name} is ${status} — start/availability question has an obvious answer`,
      };
    }
  }

  return { valid: true };
}

function lookupPlayerName(playerId: string, ctx: SportsContext): string {
  return (
    ctx.keyPlayers.find((p) => p.id === playerId)?.name ??
    ctx.playerAvailability?.find((a) => a.playerId === playerId)?.playerName ??
    playerId
  );
}
