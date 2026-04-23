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
  match_stat:    ['total_goals', 'total_cards', 'total_corners', 'home_score', 'away_score'],
  player_stat:   ['goals', 'assists', 'shots', 'cards', 'minutes_played', 'clean_sheet'],
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
): RejectionLogEntry | null {
  const checks: Array<() => ValidationResult> = [
    () => checkSchema(predicate, raw),
    () => checkEntities(predicate, raw, sportsCtx, league),
    () => checkTemporal(raw),
    () => checkLogic(predicate, raw),
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
  const validTypes = ['match_outcome', 'match_stat', 'player_stat', 'player_status', 'multiple_choice_map'];
  if (!validTypes.includes(type)) {
    return { valid: false, stage, error: `unknown resolution_type: ${type}` };
  }

  if (!('sport' in pred) || typeof (pred as any).sport !== 'string') {
    return { valid: false, stage, error: 'missing or invalid sport field' };
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
): ValidationResult {
  const stage = 'entity_validation';

  const validMatchIds  = new Set(ctx.upcomingMatches.map((m) => m.id));
  const validPlayerIds = new Set(ctx.keyPlayers.map((p) => p.id));
  const validTeamIds   = new Set(ctx.upcomingMatches.flatMap((m) => [m.homeTeam.id, m.awayTeam.id]));

  const p = pred as any;

  // Match ID check
  if (p.match_id && !validMatchIds.has(String(p.match_id))) {
    return { valid: false, stage, error: `match_id ${p.match_id} not found in upcoming matches` };
  }

  // Player ID check
  if (p.player_id && !validPlayerIds.has(String(p.player_id))) {
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
