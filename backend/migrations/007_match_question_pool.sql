-- ════════════════════════════════════════════════════════════════════════
-- 007_match_question_pool.sql
-- Match-level question pool: canonical shared generation cache
--
-- Allows one OpenAI call per unique match context to be reused across
-- all leagues following the same match. League-specific instances are
-- created in public.questions with a pool_question_id reference.
--
-- Run after 006_scoring_columns.sql
-- Idempotent — safe to re-run
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. Match Question Pool ────────────────────────────────────────────
-- One row per unique generation context.
-- The UNIQUE constraint is the race-safety mechanism:
-- whichever process inserts first owns the generation for this key.
-- Others see the existing row and either wait (if 'generating') or reuse.

CREATE TABLE IF NOT EXISTS public.match_question_pool (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Deterministic cache key
  match_id        text NOT NULL,
  sport           text NOT NULL,
  -- type1 = single-match closed session (fixed budget + pacing)
  -- type2 = season/ongoing league (continuous, no per-match budget)
  league_type     text NOT NULL CHECK (league_type IN ('type1', 'type2')),
  phase_scope     text NOT NULL CHECK (phase_scope IN ('first_half', 'second_half', 'full_match')),
  mode            text NOT NULL CHECK (mode IN ('prematch', 'live', 'hybrid')),
  prompt_version  text NOT NULL,

  -- Race-safe status
  -- 'generating' = claimed by one worker; all others must skip this pool this run
  -- 'ready'      = questions available for reuse by any league
  -- 'failed'     = generation failed; will be retried next run
  -- 'stale'      = match has started or expires_at passed; do not reuse
  status          text NOT NULL DEFAULT 'generating'
                  CHECK (status IN ('generating', 'ready', 'failed', 'stale')),

  -- Metadata
  generated_at      timestamptz,
  expires_at        timestamptz,   -- staleness boundary, typically match kickoff
  generation_run_id uuid REFERENCES public.generation_runs(id),
  questions_count   integer NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- This constraint IS the race lock: only one pool per context
  UNIQUE (match_id, sport, league_type, phase_scope, mode, prompt_version)
);


-- ── 2. Match Pool Questions ───────────────────────────────────────────
-- Canonical question store: match-level, not league-level.
-- Questions here have no league_id and no resolution_status.
-- League-specific instances are created in public.questions via attach step.

CREATE TABLE IF NOT EXISTS public.match_pool_questions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id               uuid NOT NULL REFERENCES public.match_question_pool(id) ON DELETE CASCADE,

  -- Question content (mirrors questions table minus league-specific fields)
  question_text         text NOT NULL,
  type                  text NOT NULL,
  options               jsonb,
  sport                 text NOT NULL,
  match_id              text,
  team_ids              text[]  DEFAULT '{}',
  player_ids            text[]  DEFAULT '{}',
  event_type            text,
  narrative_context     text,
  resolution_rule_text  text,
  resolution_predicate  jsonb NOT NULL,
  base_value            integer DEFAULT 6,
  difficulty_multiplier numeric DEFAULT 1.0,
  match_minute_at_generation integer,

  -- Absolute timing (all leagues sharing this match use the same kickoff)
  opens_at              timestamptz,
  deadline              timestamptz,
  resolves_after        timestamptz,

  -- Reuse rules
  -- 'prematch_only'  : safe to reuse for any league asking before match starts
  -- 'live_safe'      : safe to reuse during live play (timing re-validated per league)
  -- 'league_specific': do not reuse — generated for a specific league's context only
  reuse_scope           text NOT NULL DEFAULT 'prematch_only'
                        CHECK (reuse_scope IN ('prematch_only', 'live_safe', 'league_specific')),

  -- Semantic fingerprint for dedup within a pool.
  -- Format: type::match_id::sorted_team_ids::event_type::pred_type::pred_field::operator::value
  -- Two questions with the same fingerprint are considered semantically identical.
  fingerprint           text NOT NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Semantic dedup: one canonical instance per unique question within a pool
  UNIQUE (pool_id, fingerprint)
);


-- ── 3. Extend questions table ─────────────────────────────────────────
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS pool_question_id uuid REFERENCES public.match_pool_questions(id),
  ADD COLUMN IF NOT EXISTS reuse_scope      text DEFAULT 'prematch_only';


-- ── 4. Indexes ────────────────────────────────────────────────────────

-- Primary lookup: find pools by cache key
CREATE INDEX IF NOT EXISTS idx_match_pool_lookup
  ON public.match_question_pool(match_id, sport, league_type, phase_scope, mode, prompt_version);

-- Status filter: quickly find ready pools
CREATE INDEX IF NOT EXISTS idx_match_pool_ready
  ON public.match_question_pool(match_id, status) WHERE status = 'ready';

-- Staleness sweep: find pools past their expiry
CREATE INDEX IF NOT EXISTS idx_match_pool_expires
  ON public.match_question_pool(expires_at) WHERE status = 'ready';

-- Pool questions lookup by pool
CREATE INDEX IF NOT EXISTS idx_pool_questions_pool
  ON public.match_pool_questions(pool_id);

-- Traceability: find which pool a question row came from
CREATE INDEX IF NOT EXISTS idx_questions_pool_link
  ON public.questions(pool_question_id) WHERE pool_question_id IS NOT NULL;


-- ── 5. RLS ────────────────────────────────────────────────────────────
-- Pool tables are internal to the Edge Function (service role key).
-- No browser access is needed or allowed.

ALTER TABLE public.match_question_pool  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_pool_questions ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically — no explicit policies needed.
-- Add read policies if admin tooling ever needs browser access.
