// pool-manager.ts
// Match-level question pool: canonical shared generation cache.
//
// Guarantees:
//   - One OpenAI call per unique match context (match_id + sport + league_type + phase + mode + prompt_version)
//   - Race-safe via Postgres UNIQUE constraint on the cache key
//   - Semantic dedup via fingerprint UNIQUE constraint per pool
//   - Independent answering preserved: each league gets its own questions rows with distinct IDs
//   - Reuse eligibility enforced: prematch_only vs live_safe vs league_specific
//   - Staleness enforced: pools expire at match kickoff

import type { LeagueWithConfig } from './types.ts';

// ── Types ────────────────────────────────────────────────────────────

export type LeagueType     = 'type1' | 'type2';
export type PhaseScope     = 'first_half' | 'second_half' | 'full_match';
export type GenerationMode = 'prematch' | 'live' | 'hybrid';
export type ReuseScope     = 'prematch_only' | 'live_safe' | 'league_specific';
export type PoolStatus     = 'generating' | 'ready' | 'failed' | 'stale';

export interface PoolCacheKey {
  matchId:       string;
  sport:         string;
  leagueType:    LeagueType;
  phaseScope:    PhaseScope;
  mode:          GenerationMode;
  promptVersion: string;
  // Scoped leagues get their own pool — team-focused questions must not
  // be reused across full-league contexts and vice versa.
  scope:         'full_league' | 'team_specific';
  scopedTeamId:  string | null;  // null for full_league
}

export interface MatchPool {
  id:             string;
  status:         PoolStatus;
  questionsCount: number;
  expiresAt:      string | null;
}

export interface PoolQuestion {
  id:                   string;
  poolId:               string;
  questionText:         string;
  type:                 string;
  options:              any;
  sport:                string;
  matchId:              string | null;
  teamIds:              string[];
  playerIds:            string[];
  eventType:            string | null;
  narrativeContext:     string | null;
  resolutionRuleText:   string | null;
  resolutionPredicate:  any;
  baseValue:            number;
  difficultyMultiplier: number;
  reuseScope:           ReuseScope;
  fingerprint:          string;
  opensAt:                     string | null;
  deadline:                    string | null;
  resolvesAfter:               string | null;
  matchMinuteAtGeneration:     number | null;
}

export interface PoolQuestionInput {
  question_text:         string;
  type:                  string;
  options?:              any;
  sport:                 string;
  match_id?:             string | null;
  team_ids?:             string[];
  player_ids?:           string[];
  event_type?:           string;
  narrative_context?:    string;
  resolution_rule_text?: string;
  resolution_predicate:  any;
  base_value?:           number;
  difficulty_multiplier?: number;
  match_minute_at_generation?: number;
  opens_at?:             string;
  deadline?:             string;
  resolves_after?:       string;
}


// ── Lane helpers (mirrors detectLane() in league.html) ───────────────

type QuestionLane = 'CORE_MATCH_PREMATCH' | 'CORE_MATCH_LIVE' | 'REAL_WORLD';

function computeLane(
  matchMinuteAtGeneration: number | null | undefined,
  matchId: string | null | undefined,
): QuestionLane {
  if (matchMinuteAtGeneration != null) return 'CORE_MATCH_LIVE';
  if (matchId != null)                 return 'CORE_MATCH_PREMATCH';
  return 'REAL_WORLD';
}

const LANE_SOURCE_BADGE: Record<QuestionLane, string> = {
  CORE_MATCH_LIVE:     'LIVE',
  CORE_MATCH_PREMATCH: 'PRE-MATCH',
  REAL_WORLD:          'REAL WORLD',
};

// ── Cache key helpers ────────────────────────────────────────────────

// All current AI-enabled leagues are Type 2 (season/ongoing).
// Type 1 (single-match, fixed budget) is not yet implemented in the AI pipeline.
// When Type 1 is added, this function should inspect league config to distinguish.
export function getLeagueType(_league: LeagueWithConfig): LeagueType {
  return 'type2';
}

// All current AI leagues cover the full match.
// Extend when first_half / second_half scoped leagues are supported.
export function getPhaseScope(_league: LeagueWithConfig): PhaseScope {
  return 'full_match';
}

// All current AI generation is prematch (questions generated before kickoff).
// Live and hybrid modes are generated separately (not yet implemented).
export function getMode(_league: LeagueWithConfig): GenerationMode {
  return 'prematch';
}

export function buildCacheKey(
  matchId: string,
  league: LeagueWithConfig,
  promptVersion: string,
): PoolCacheKey {
  return {
    matchId,
    sport:         league.sport,
    leagueType:    getLeagueType(league),
    phaseScope:    getPhaseScope(league),
    mode:          getMode(league),
    promptVersion,
    scope:         league.scope,
    scopedTeamId:  league.scope === 'team_specific' ? String(league.api_sports_team_id ?? '') : null,
  };
}


// ── Semantic fingerprint ─────────────────────────────────────────────
// Produces a deterministic string that identifies the semantic content
// of a question. Two questions with the same fingerprint are considered
// duplicates within the same pool and will not both be stored.

export function computeFingerprint(
  type: string,
  matchId: string | null | undefined,
  teamIds: string[],
  eventType: string | null | undefined,
  predicate: any,
): string {
  const p = predicate ?? {};
  const parts = [
    type ?? '',
    matchId ?? '',
    [...(teamIds ?? [])].sort().join(','),
    eventType ?? '',
    p.resolution_type ?? p.type ?? '',
    p.field ?? '',
    p.operator ?? p.binary_condition?.operator ?? '',
    String(p.value ?? p.binary_condition?.value ?? ''),
    p.player_id ?? '',
    p.winner_team_id ?? '',
  ];
  return parts.join('::').toLowerCase().replace(/\s+/g, '_');
}


// ── Reuse scope ──────────────────────────────────────────────────────
// Determines how broadly a question can be reused across leagues.
// Prematch outcome/player questions: safe for all prematch leagues.
// Live event questions: only safe for live-capable leagues with timing checks.

export function determineReuseScope(eventType: string | null | undefined): ReuseScope {
  if (!eventType) return 'prematch_only';
  const liveTriggers = ['goal', 'penalty', 'red_card', 'yellow_card', 'corner', 'shot',
                        'stat_threshold', 'time_window', 'equaliser', 'next_scorer',
                        'hockey_goal', 'major_penalty', 'minor_penalty', 'power_play',
                        'break_of_serve', 'hold_of_serve', 'set_won', 'tie_break', 'match_point'];
  if (liveTriggers.includes(eventType)) return 'live_safe';
  return 'prematch_only';
}


// ── Staleness check ──────────────────────────────────────────────────

export function isPoolStale(pool: MatchPool): boolean {
  if (!pool.expiresAt) return false;
  return new Date(pool.expiresAt) < new Date();
}


// ── Pool claim (race-safe) ───────────────────────────────────────────
// Attempts to INSERT a new pool row. Only one process can succeed due to
// the UNIQUE constraint on the cache key.
//
// Returns:
//   { pool, isNew: true }  → we won the race; caller must generate and markReady
//   { pool, isNew: false } → existing ready pool found; caller can reuse
//   { pool: null }         → another process is generating; caller must skip this match

export async function getOrClaimPool(
  sb: any,
  key: PoolCacheKey,
  runId: string,
  expiresAt: string,
): Promise<{ pool: MatchPool | null; isNew: boolean }> {

  // Attempt to claim by inserting. ON CONFLICT means only one worker wins.
  const { data: inserted, error: insertErr } = await sb
    .from('match_question_pool')
    .insert({
      match_id:          key.matchId,
      sport:             key.sport,
      league_type:       key.leagueType,
      phase_scope:       key.phaseScope,
      mode:              key.mode,
      prompt_version:    key.promptVersion,
      scope:             key.scope,
      scoped_team_id:    key.scopedTeamId,
      status:            'generating',
      generation_run_id: runId,
      expires_at:        expiresAt,
    })
    .select('id, status, questions_count, expires_at')
    .single();

  if (!insertErr && inserted) {
    return {
      pool: { id: inserted.id, status: 'generating', questionsCount: 0, expiresAt: inserted.expires_at },
      isNew: true,
    };
  }

  // Row exists — fetch current state
  const existingQuery = sb
    .from('match_question_pool')
    .select('id, status, questions_count, expires_at')
    .eq('match_id',       key.matchId)
    .eq('sport',          key.sport)
    .eq('league_type',    key.leagueType)
    .eq('phase_scope',    key.phaseScope)
    .eq('mode',           key.mode)
    .eq('prompt_version', key.promptVersion)
    .eq('scope',          key.scope);

  const { data: existing, error: fetchErr } = key.scopedTeamId
    ? await existingQuery.eq('scoped_team_id', key.scopedTeamId).single()
    : await existingQuery.is('scoped_team_id', null).single();

  if (fetchErr || !existing) {
    console.warn('[pool] could not fetch existing pool for match', key.matchId);
    return { pool: null, isNew: false };
  }

  const pool: MatchPool = {
    id:             existing.id,
    status:         existing.status,
    questionsCount: existing.questions_count,
    expiresAt:      existing.expires_at,
  };

  // Stale ready pool: mark stale and re-claim
  if (isPoolStale(pool) && pool.status === 'ready') {
    const { data: marked } = await sb
      .from('match_question_pool')
      .update({ status: 'stale', updated_at: new Date().toISOString() })
      .eq('id', pool.id)
      .eq('status', 'ready')  // guard: only transition from ready
      .select('id')
      .single();

    if (marked) {
      // We marked it stale — delete its questions and re-claim
      await sb.from('match_pool_questions').delete().eq('pool_id', pool.id);
      return getOrClaimPool(sb, key, runId, expiresAt);
    }
    // Someone else marked it first — skip
    return { pool: null, isNew: false };
  }

  // Another process is generating — skip this match this run
  if (pool.status === 'generating') {
    console.log(`[pool] match ${key.matchId} is being generated by another process — skipping`);
    return { pool: null, isNew: false };
  }

  // Failed pool — allow retry by this process
  if (pool.status === 'failed') {
    await sb.from('match_question_pool').update({
      status:            'generating',
      generation_run_id: runId,
      updated_at:        new Date().toISOString(),
    }).eq('id', pool.id);
    return { pool: { ...pool, status: 'generating' }, isNew: true };
  }

  // Ready and not stale — available for reuse
  return { pool, isNew: false };
}


// ── Store canonical questions in pool ────────────────────────────────
// Upserts questions into match_pool_questions.
// Fingerprint UNIQUE constraint silently drops semantic duplicates.

export async function storePoolQuestions(
  sb: any,
  poolId: string,
  questions: PoolQuestionInput[],
): Promise<PoolQuestion[]> {
  if (!questions.length) return [];

  const rows = questions.map((q) => ({
    pool_id:                    poolId,
    question_text:              q.question_text,
    type:                       q.type,
    options:                    q.options ?? null,
    sport:                      q.sport,
    match_id:                   q.match_id ?? null,
    team_ids:                   q.team_ids ?? [],
    player_ids:                 q.player_ids ?? [],
    event_type:                 q.event_type ?? null,
    narrative_context:          q.narrative_context ?? null,
    resolution_rule_text:       q.resolution_rule_text ?? null,
    resolution_predicate:       q.resolution_predicate,
    base_value:                 q.base_value ?? 6,
    difficulty_multiplier:      q.difficulty_multiplier ?? 1.0,
    match_minute_at_generation: q.match_minute_at_generation ?? null,
    opens_at:                   q.opens_at ?? null,
    deadline:                   q.deadline ?? null,
    resolves_after:             q.resolves_after ?? null,
    reuse_scope:                determineReuseScope(q.event_type ?? null),
    fingerprint:                computeFingerprint(
      q.type,
      q.match_id,
      q.team_ids ?? [],
      q.event_type,
      q.resolution_predicate,
    ),
  }));

  const { data, error } = await sb
    .from('match_pool_questions')
    .upsert(rows, { onConflict: 'pool_id,fingerprint', ignoreDuplicates: true })
    .select();

  if (error) {
    console.warn('[pool] storePoolQuestions error:', error.message);
    return [];
  }

  return (data ?? []).map(mapRow);
}


// ── Pool status updates ──────────────────────────────────────────────

export async function markPoolReady(sb: any, poolId: string, count: number): Promise<void> {
  const { error } = await sb.from('match_question_pool').update({
    status:          'ready',
    generated_at:    new Date().toISOString(),
    questions_count: count,
    updated_at:      new Date().toISOString(),
  }).eq('id', poolId);
  if (error) console.warn('[pool] markPoolReady error:', error.message);
}

export async function markPoolFailed(sb: any, poolId: string): Promise<void> {
  const { error } = await sb.from('match_question_pool').update({
    status:     'failed',
    updated_at: new Date().toISOString(),
  }).eq('id', poolId);
  if (error) console.warn('[pool] markPoolFailed error:', error.message);
}


// ── Find existing ready pools ────────────────────────────────────────
// Returns a map of matchId → pool for all ready (non-stale) pools
// matching the given cache key parameters.

export async function findReadyPools(
  sb: any,
  matchIds: string[],
  key: Omit<PoolCacheKey, 'matchId'>,
): Promise<Map<string, MatchPool>> {
  if (!matchIds.length) return new Map();

  const readyQuery = sb
    .from('match_question_pool')
    .select('id, match_id, status, questions_count, expires_at')
    .in('match_id',       matchIds)
    .eq('sport',          key.sport)
    .eq('league_type',    key.leagueType)
    .eq('phase_scope',    key.phaseScope)
    .eq('mode',           key.mode)
    .eq('prompt_version', key.promptVersion)
    .eq('scope',          key.scope)
    .eq('status',         'ready');

  const { data, error } = key.scopedTeamId
    ? await readyQuery.eq('scoped_team_id', key.scopedTeamId)
    : await readyQuery.is('scoped_team_id', null);

  if (error || !data) return new Map();

  const result = new Map<string, MatchPool>();
  for (const row of data) {
    const pool: MatchPool = {
      id:             row.id,
      status:         row.status,
      questionsCount: row.questions_count,
      expiresAt:      row.expires_at,
    };
    if (!isPoolStale(pool)) {
      result.set(row.match_id, pool);
    }
  }
  return result;
}


// ── Fetch eligible pool questions ────────────────────────────────────
// Returns questions from a pool that are eligible for the given mode.
// prematch: returns prematch_only + live_safe
// live:     returns live_safe only (timing must be re-validated per league)

export async function getPoolQuestions(
  sb: any,
  poolId: string,
  mode: GenerationMode,
): Promise<PoolQuestion[]> {
  const eligibleScopes: ReuseScope[] =
    mode === 'live' ? ['live_safe'] : ['prematch_only', 'live_safe'];

  const { data, error } = await sb
    .from('match_pool_questions')
    .select('*')
    .eq('pool_id', poolId)
    .in('reuse_scope', eligibleScopes);

  if (error) {
    console.warn('[pool] getPoolQuestions error:', error.message);
    return [];
  }

  return (data ?? []).map(mapRow);
}


// ── Attach pool questions to a league ────────────────────────────────
// Creates league-specific question instances from canonical pool questions.
// Enforces per-league constraints before each attach:
//   - quota limit
//   - timing validity (deadline must be in the future)
//   - text-based dedup against recent questions for this league
//
// Each inserted row has its own unique ID — answering is fully independent
// across leagues even when questions share the same pool source.

export async function attachPoolQuestionsToLeague(
  sb: any,
  poolQuestions: PoolQuestion[],
  league: LeagueWithConfig,
  runId: string,
  promptVersion: string,
  recentQuestionTexts: string[],
  alreadyAttachedThisRun: number,
  quota: number,
): Promise<number> {
  if (!poolQuestions.length) return 0;

  const now = new Date();
  const recentNormalised = new Set(recentQuestionTexts.map(t => t.toLowerCase().trim()));
  const toInsert = [];

  for (const pq of poolQuestions) {
    if (alreadyAttachedThisRun + toInsert.length >= quota) break;

    // Timing validity: skip questions whose answer window has already closed
    if (pq.deadline && new Date(pq.deadline) <= now) {
      console.log(`[pool] skip stale: "${pq.questionText.slice(0, 50)}" — deadline passed`);
      continue;
    }

    // Text dedup: skip if league already has a near-identical question recently
    if (recentNormalised.has(pq.questionText.toLowerCase().trim())) {
      console.log(`[pool] skip duplicate: "${pq.questionText.slice(0, 50)}"`);
      continue;
    }

    toInsert.push({
      league_id:             league.id,
      pool_question_id:      pq.id,
      reuse_scope:           pq.reuseScope,
      source:                'ai_generated',
      generation_run_id:     runId,
      question_text:         pq.questionText,
      type:                  pq.type,
      options:               pq.options,
      sport:                 pq.sport,
      match_id:              pq.matchId,
      team_ids:              pq.teamIds,
      player_ids:            pq.playerIds,
      event_type:            pq.eventType,
      narrative_context:     pq.narrativeContext,
      opens_at:              pq.opensAt,
      deadline:              pq.deadline,
      resolves_after:        pq.resolvesAfter,
      resolution_rule_text:  pq.resolutionRuleText,
      resolution_predicate:  pq.resolutionPredicate,
      resolution_status:     'pending',
      // 'pool_reuse' signals this was attached from cache, not freshly generated
      ai_model:              'gpt-4o-mini/pool_reuse',
      ai_prompt_version:     promptVersion,
      question_type:         computeLane(pq.matchMinuteAtGeneration, pq.matchId),
      source_badge:          LANE_SOURCE_BADGE[computeLane(pq.matchMinuteAtGeneration, pq.matchId)],
      base_value:            pq.baseValue,
      difficulty_multiplier: pq.difficultyMultiplier,
      // opens_at = visible_from and deadline = answer_closes_at at generation time
      visible_from:          pq.opensAt,
      answer_closes_at:      pq.deadline,
    });
  }

  if (!toInsert.length) return 0;

  const { error } = await sb.from('questions').insert(toInsert);
  if (error) {
    console.warn('[pool] attachPoolQuestionsToLeague insert error:', error.message);
    return 0;
  }

  return toInsert.length;
}


// ── Internal row mapper ──────────────────────────────────────────────

function mapRow(r: any): PoolQuestion {
  return {
    id:                   r.id,
    poolId:               r.pool_id,
    questionText:         r.question_text,
    type:                 r.type,
    options:              r.options,
    sport:                r.sport,
    matchId:              r.match_id,
    teamIds:              r.team_ids ?? [],
    playerIds:            r.player_ids ?? [],
    eventType:            r.event_type,
    narrativeContext:     r.narrative_context,
    resolutionRuleText:   r.resolution_rule_text,
    resolutionPredicate:  r.resolution_predicate,
    baseValue:            r.base_value ?? 6,
    difficultyMultiplier: r.difficulty_multiplier ?? 1.0,
    reuseScope:           r.reuse_scope,
    fingerprint:          r.fingerprint,
    opensAt:                     r.opens_at,
    deadline:                    r.deadline,
    resolvesAfter:               r.resolves_after,
    matchMinuteAtGeneration:     r.match_minute_at_generation ?? null,
  };
}
