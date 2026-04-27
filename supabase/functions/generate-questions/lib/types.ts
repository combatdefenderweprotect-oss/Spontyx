// ── Shared types for the generate-questions Edge Function ──────────────

// ── Sports API layer ──────────────────────────────────────────────────

export interface SportTeam {
  id: string;        // external API team id (as string)
  name: string;
  shortName?: string;
}

export interface SportMatch {
  id: string;        // external API match id (as string)
  sport: string;
  homeTeam: SportTeam;
  awayTeam: SportTeam;
  kickoff: string;   // ISO timestamp
  competition: string;
  venue?: string;
  status: 'not_started' | 'in_progress' | 'finished' | 'postponed' | 'cancelled';
}

export interface SportPlayer {
  id: string;        // external API player id
  name: string;
  teamId: string;
  teamName: string;
  position?: string;
  injuryStatus: 'fit' | 'doubtful' | 'injured' | 'suspended';
  injuryNote?: string;
  recentForm?: string; // e.g. "3 goals in last 5 matches"
}

export interface StandingsEntry {
  position: number;
  team: SportTeam;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalDifference: number;
}

export interface TeamForm {
  teamId: string;
  teamName: string;
  last5: string[];      // ['W','W','L','D','W']
  homeRecord?: string;  // e.g. "3W 1D 1L"
  awayRecord?: string;
}

// ── Player availability ───────────────────────────────────────────────

export interface PlayerAvailabilityStatus {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  fixtureId: string;
  // unavailable = injured/suspended; doubtful = fitness concern; starting/substitute = confirmed lineup
  status: 'unavailable' | 'doubtful' | 'available' | 'starting' | 'substitute';
  reason?: string;
  source: 'injury_report' | 'lineup' | 'inferred';
}

export interface SportsContext {
  upcomingMatches: SportMatch[];
  standings: StandingsEntry[];
  form: TeamForm[];
  keyPlayers: SportPlayer[];
  narrativeHooks: string[];  // derived from data, not from news
  playerAvailability?: PlayerAvailabilityStatus[];  // empty if data unavailable
}

// ── News layer ────────────────────────────────────────────────────────

export interface NewsItem {
  headline: string;
  summary: string;       // max 280 chars
  sourceName: string;
  publishedAt: string;   // ISO timestamp
  relevanceTag: string;  // e.g. "team:liverpool", "player:salah", "competition:pl"
  url: string;           // for logging only — never sent to OpenAI
}

// ── League classification ─────────────────────────────────────────────

export type MatchClassification = 'IMMINENT' | 'UPCOMING' | 'DISTANT' | 'NONE';
export type GenerationMode = 'match_preview' | 'narrative_preview' | 'narrative_only';

export interface LeagueWithConfig {
  id: string;
  name: string;
  sport: string;
  scope: 'full_league' | 'team_specific';
  scoped_team_id: string | null;
  scoped_team_name: string | null;
  api_sports_league_id: number;
  api_sports_team_id: number | null;
  api_sports_season: number;
  ai_weekly_quota: number;
  ai_total_quota: number;
  league_start_date: string | null;
  league_end_date: string | null;
  owner_id: string | null;       // used for Real World quota tier lookup
  // ── Intensity budget (migration 017) ──────────────────────────────────
  // Target question counts per match — set from INTENSITY_PRESETS at creation.
  // null/undefined means the league was created before migration 017 → use defaults.
  prematch_question_budget: number | null;   // default 4 (STANDARD)
  live_question_budget: number | null;       // default 8 (STANDARD)
  // ── Pre-match scheduling (migration 018) ─────────────────────────────
  // Controls when prematch questions become visible relative to kickoff.
  // null/undefined means the league was created before migration 018 → treat as 'automatic'.
  prematch_generation_mode: 'automatic' | 'manual' | null;
  prematch_publish_offset_hours: number | null;  // manual mode: hours before kickoff (48/24/12/6)
}

export interface LeagueClassification {
  league: LeagueWithConfig;
  classification: MatchClassification;
  priorityScore: number;
  earliestKickoff: string | null;
  hoursUntilKickoff: number | null;
  generationMode: GenerationMode;
}

export interface QuotaCheck {
  quotaTotal: number;
  quotaUsedTotal: number;
  quotaUsedThisWeek: number;
  questionsToGenerate: number;  // 0 means skip
  skipReason?: string;
}

// ── OpenAI layer ──────────────────────────────────────────────────────

// Shape of each question object returned by OpenAI in Call 1 (v1.5 prompt)
export interface RawGeneratedQuestion {
  question_text: string;
  type: 'binary' | 'multiple_choice';
  options: Array<{ id: string; text: string }> | null;

  // Structured fields returned by OpenAI
  question_category: 'high_value_event' | 'outcome_state' | 'player_specific' | 'medium_stat' | 'low_value_filler';
  question_subtype: string;      // short machine label e.g. "match_winner", "total_goals"
  base_value: number;            // 20/15/12/10/6 — set by OpenAI per category rule
  difficulty_multiplier: number; // 1.0–1.5, set by OpenAI at generation time
  generation_trigger: 'event_driven' | 'time_driven' | 'prematch_only';
  match_id: string | null;       // from context, returned by OpenAI
  match_minute_at_generation: number | null;
  visible_from: string;          // ISO timestamp from OpenAI
  answer_closes_at: string;      // ISO timestamp from OpenAI
  resolves_after: string;        // ISO timestamp from OpenAI (overridden by system for prematch)
  reusable_scope: 'prematch_only' | 'live_safe' | 'league_specific';
  reasoning_short: string;       // internal reasoning (stored as narrative_context)
  predicate_hint: string;        // resolution description used as input to Call 2

  // Computed by system after generation (not returned by OpenAI)
  event_type: string;
  team_ids: string[];
  player_ids: string[];
  deadline: string;              // = answer_closes_at (backwards-compat column)
  opens_at: string;              // = visible_from (backwards-compat column)
  resolution_rule_text: string;
  narrative_context: string;
}

// Shape of structured predicate returned by OpenAI in Call 2
export type ResolutionPredicate =
  | MatchOutcomePredicate
  | MatchStatPredicate
  | PlayerStatPredicate
  | PlayerStatusPredicate
  | MultipleChoiceMapPredicate;

export interface BinaryCondition {
  field: string;
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string | number | boolean;
}

export interface MatchOutcomePredicate {
  resolution_type: 'match_outcome';
  match_id: string;
  sport: string;
  binary_condition: BinaryCondition;
}

export interface MatchStatPredicate {
  resolution_type: 'match_stat';
  match_id: string;
  sport: string;
  binary_condition: BinaryCondition;
}

export interface PlayerStatPredicate {
  resolution_type: 'player_stat';
  match_id: string;
  player_id: string;
  sport: string;
  binary_condition: BinaryCondition;
}

export interface PlayerStatusPredicate {
  resolution_type: 'player_status';
  player_id: string;
  sport: string;
  check_at: string;
  binary_condition: BinaryCondition;
}

export interface MCOption {
  id: string;
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string | number;
}

export interface MultipleChoiceMapPredicate {
  resolution_type: 'multiple_choice_map';
  source: 'match_outcome' | 'match_stat' | 'player_stat';
  match_id: string | null;
  player_id: string | null;
  sport: string;
  field: string;
  options: MCOption[];
}

// ── Validated question ready for DB insert ────────────────────────────

export interface ValidatedQuestion {
  league_id: string;
  source: 'ai_generated';
  generation_run_id: string;
  question_text: string;
  type: 'binary' | 'multiple_choice';
  options: Array<{ id: string; text: string }> | null;
  sport: string;
  match_id: string | null;
  team_ids: string[];
  player_ids: string[];
  event_type: string;
  narrative_context: string;
  opens_at: string;
  deadline: string;
  resolves_after: string;
  resolution_rule_text: string;
  resolution_predicate: ResolutionPredicate;
  resolution_status: 'pending';
  ai_model: string;
  ai_prompt_version: string;
  question_type?: 'CORE_MATCH_PREMATCH' | 'CORE_MATCH_LIVE' | 'REAL_WORLD';
  source_badge: string;
  // Scoring + timing metadata (from migrations 006/007)
  base_value?: number;
  difficulty_multiplier?: number;
  reuse_scope?: string;
  visible_from?: string;
  answer_closes_at?: string;
  match_minute_at_generation?: number | null;
  generation_trigger?: string;
}

// ── Run tracking ──────────────────────────────────────────────────────

export interface RejectionLogEntry {
  attempt: number;
  stage: 'question_generation' | 'predicate_parse' | 'schema_validation' | 'entity_validation' | 'temporal_validation' | 'logic_validation' | 'availability_validation';
  question_text?: string;
  error: string;
}

export interface LeagueRunResult {
  leagueId: string;
  sport: string;
  generationMode: GenerationMode;
  earliestMatchKickoff: string | null;
  hoursUntilKickoff: number | null;
  priorityScore: number;
  quotaTotal: number;
  quotaUsedTotal: number;
  quotaUsedThisWeek: number;
  questionsRequested: number;
  questionsGenerated: number;
  questionsRejected: number;
  rejectionLog: RejectionLogEntry[];
  skipped: boolean;
  skipReason?: string;
  newsItemsFetched: number;
  newsUnavailable: boolean;
  newsSnapshot: Array<{ headline: string; source: string; publishedAt: string; relevanceTag: string }>;
  durationMs: number;
}
