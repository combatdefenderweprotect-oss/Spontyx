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
  url: string;           // included in Call 3 source selection; never sent to Call 1/2
}

/** NewsItem extended with optional full-text enrichment from the scraper service.
 *  All enrichment fields are optional — callers must handle the un-enriched case. */
export interface EnrichedNewsItem extends NewsItem {
  /** Full article body text, capped at 3,000 chars by the scraper. */
  extracted_text?:    string;
  /** First ~800 chars of extracted_text — sent to OpenAI as the primary signal. */
  extracted_context?: string;
  /** 'success' | 'partial' | 'failed' | 'skipped' — scraper's own status. */
  extraction_status?: 'success' | 'partial' | 'failed' | 'skipped';
  /** Non-null when the scraper encountered an error fetching/parsing the page. */
  scraper_error?:     string | null;
}

// ── REAL_WORLD Call 3 return types ────────────────────────────────────

/** One curated news source returned by Call 3. Stored in source_news_urls JSONB. */
export interface RwContextSource {
  source_name:  string;
  published_at: string;  // ISO timestamp (original from NewsItem)
  title:        string;  // shortened headline, factual
  url:          string;
}

/** Structured output of generateRealWorldContext() (Call 3). */
export interface RwContextResult {
  context:                string;   // 1–2 sentence "why this question exists" shown to users
  confidence_explanation: string;   // short phrase e.g. "Based on multiple independent reports"
  sources:                RwContextSource[];  // max 3 curated sources; stored as source_news_urls
}

// ── League classification ─────────────────────────────────────────────

export type MatchClassification = 'IMMINENT' | 'UPCOMING' | 'DISTANT' | 'NONE';
export type GenerationMode = 'match_preview' | 'narrative_preview' | 'narrative_only' | 'live_gap' | 'live_event';

// ── Live match generation context ─────────────────────────────────────
// Built at generation time from live_match_stats + active questions.
// Used by the live generation branch in index.ts.
export interface LiveMatchContext {
  matchId: string;
  kickoff: string;                    // ISO timestamp from api_football_fixtures.kickoff_at
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  matchMinute: number;                // current match clock minute
  matchPhase: 'early' | 'mid' | 'late';  // derived from matchMinute
  homeScore: number;
  awayScore: number;
  isCloseGame: boolean;               // score diff ≤ 1
  isBlowout: boolean;                 // score diff ≥ 3
  recentEvents: Array<{               // events since last generation (from live_match_stats.events)
    time: number;
    type: string;
    detail: string | null;
    team_id: number;
  }>;
  lastEventType: 'goal' | 'penalty' | 'red_card' | 'yellow_card' | 'none';  // most significant event since last generation
  lastEventMinute: number | null;     // match minute of the last significant event
  activeWindows: Array<{ start: number; end: number }>;  // windows from active CORE_MATCH_LIVE questions
  activeQuestionCount: number;        // current count of active (pending + answer window open) LIVE questions
  generationTrigger: 'time_driven' | 'event_driven';
  lastGenerationMinute: number | null;  // match_minute_at_generation from the most recent LIVE question
}

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
  created_at?: string | null;  // used by isMatchEligibleForPrematch late-creation fallback
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

  // Live anchored-window fields (optional — only for match_stat_window questions)
  window_start_minute?: number | null;  // match minute where prediction window begins (live only)
  window_end_minute?: number | null;    // match minute where prediction window ends (live only)
  anchoring_type?: 'fixed_window' | 'deadline' | 'match_phase' | null;  // live window type

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
  | MultipleChoiceMapPredicate
  | MatchStatWindowPredicate
  | BttsPredicate
  | MatchLineupPredicate
  | ManualReviewPredicate;

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

// ── Live anchored match-minute window predicate ───────────────────────
// Resolves by counting goal or card EVENTS within [window_start_minute, window_end_minute].
// Only goal and card events are available with per-minute granularity from the
// API-Sports /fixtures/events endpoint (stored in live_match_stats.events).
// Corners are NOT supported — they are cumulative totals only.
//
// Three anchoring types define how the window is framed to the user:
//   fixed_window — "between the 60th and 65th minute" (3–7 min range)
//   deadline     — "before the 75th minute" (wider window up to 45 min)
//   match_phase  — "before half-time" / "before full-time" (window to 45 or 90)
export interface MatchStatWindowPredicate {
  resolution_type: 'match_stat_window';
  match_id: string;
  sport: string;
  field: 'goals' | 'cards';            // must match event types in live_match_stats.events
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: number;
  window_start_minute: number;         // inclusive — prediction window starts at this match minute
  window_end_minute: number;           // inclusive — prediction window ends at this match minute
  anchoring_type?: 'fixed_window' | 'deadline' | 'match_phase';  // default: fixed_window
}

// ── BTTS predicate ────────────────────────────────────────────────────
// Resolves true when both home_score >= 1 AND away_score >= 1 at full time.
// Simpler than a compound binary_condition — evaluated directly from match scores.
export interface BttsPredicate {
  resolution_type: 'btts';
  match_id: string;
  sport: string;
}

// ── Match lineup predicate (REAL_WORLD) ───────────────────────────────
// Resolves from live_match_stats.lineups — checks if a player appears in
// the starting XI or squad for a specific match.
export interface MatchLineupPredicate {
  resolution_type: 'match_lineup';
  match_id: string;
  sport: string;
  player_id: string;
  player_name: string;   // for display/logging
  check: 'starting_xi' | 'squad';  // starting_xi = in the 11; squad = in the 23
}

// ── Manual review predicate (REAL_WORLD) ─────────────────────────────
// Used for coach status, transfers, disciplinary bans — anything that
// cannot be resolved from match data automatically. A human admin must
// mark the outcome in the Supabase dashboard before resolution_deadline.
// If not resolved by deadline, the question is auto-voided.
export interface ManualReviewPredicate {
  resolution_type: 'manual_review';
  category: 'coach_status' | 'transfer' | 'contract' | 'disciplinary';
  description: string;         // human-readable: what to check and mark
  resolution_deadline: string; // ISO timestamp — auto-void after this
  source_urls: string[];       // reference articles for the admin
}

// ── Raw output from REAL_WORLD Call 1 ────────────────────────────────
// OpenAI returns this shape from generateRealWorldQuestion().
// 'SKIP' is returned as a string when the news signal is too weak.
export interface RawRealWorldQuestion {
  question_text: string;
  news_narrative_summary: string;    // 1-sentence summary of the driving news story
  confidence_level: 'low' | 'medium' | 'high';
  resolution_type_suggestion: 'match_stat' | 'player_stat' | 'match_lineup' | 'manual_review';
  resolution_condition: string;      // human-readable: "Correct if player starts as per official lineup"
  resolution_deadline: string;       // ISO timestamp — when the question must resolve by
  source_news_ids: string[];         // URLs of source articles
  entity_focus: 'player' | 'coach' | 'team' | 'club';
  predicate_hint: string;            // fed into Call 2 (convertToPredicate)
  skip_reason?: string;              // set when OpenAI decides to return SKIP
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
  // ── REAL_WORLD-specific fields (migration 024) ────────────────────────
  resolution_condition?: string;    // human-readable resolution criteria
  resolution_deadline?: string;     // ISO — auto-void deadline
  source_news_urls?: Array<{ url: string; title?: string; source_name?: string; published_at?: string }>;  // curated source objects (Call 3 output)
  entity_focus?: string;            // player | coach | team | club
  confidence_level?: string;        // low | medium | high
  rw_context?: string;              // Call 3 output — "why this question exists"
}

// ── REAL_WORLD quality scoring result (Call 4) ───────────────────────
// Returned by scoreRealWorldQuestion() in openai-client.ts.
// Drives the APPROVE / WEAK / REJECT gate in index.ts before DB insert.

export interface RwQualityResult {
  final_score: number;
  decision: 'APPROVE' | 'WEAK' | 'REJECT';
  breakdown: {
    news_link_strength: number;   // 0–25: how tightly derived from the news
    clarity:            number;   // 0–15: easy to understand
    resolvability:      number;   // 0–25: can be resolved objectively
    relevance:          number;   // 0–20: interesting to fans
    uniqueness:         number;   // 0–15: feels like real insight, not generic
    risk:               number;   // -30–0: penalty for genericness / obviousness / invalidity
  };
  reason: string;  // short explanation for logging
}

// ── Run tracking ──────────────────────────────────────────────────────

export interface RejectionLogEntry {
  attempt: number;
  stage: 'question_generation' | 'predicate_parse' | 'schema_validation' | 'entity_validation' | 'temporal_validation' | 'logic_validation' | 'availability_validation' | 'prematch_quality' | 'live_timing_validation' | 'real_world_generation' | 'rw_quality_score';
  question_text?: string;
  error: string;
  // ── Structured fields for prematch_quality stage (used by analytics views) ──
  reason?: string;        // normalized reason key (too_obvious / duplicate_question / etc.)
  score?: number;         // 0–100 quality score
  fixture_id?: string | null;  // match_id of the fixture being evaluated
  timestamp?: string;     // ISO timestamp of rejection
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
