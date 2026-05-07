-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 076 — Trivia question bank foundation
-- Tables: trivia_questions, trivia_question_sets
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Shared updated_at helper (idempotent) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_questions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trivia_questions (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Taxonomy
  sport                     TEXT        NOT NULL
                            CHECK (sport IN ('soccer','nfl','nba','mlb','college_football','f1','tennis','mma')),
  category                  TEXT,
  event                     TEXT
                            CHECK (event IS NULL OR event IN ('world_cup_2026')),
  league                    TEXT,
  team                      TEXT,
  player                    TEXT,
  era                       TEXT,

  -- Content
  difficulty                TEXT        NOT NULL
                            CHECK (difficulty IN ('easy','medium','hard')),
  question_type             TEXT        NOT NULL DEFAULT 'multiple_choice',
  question                  TEXT        NOT NULL CHECK (length(question) >= 15),
  options                   JSONB       NOT NULL,   -- must be array of exactly 4 strings
  correct_index             INT         NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation               TEXT,

  -- Source and approval
  source_type               TEXT        NOT NULL DEFAULT 'manual'
                            CHECK (source_type IN ('manual','ai','user','event')),
  approval_state            TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (approval_state IN (
                              'pending',
                              'playable_private',
                              'approved_public',
                              'rejected',
                              'auto_suppressed'
                            )),
  approved_at               TIMESTAMPTZ,
  approved_by               UUID        REFERENCES auth.users ON DELETE SET NULL,

  -- Quality signals
  quality_score             NUMERIC(3,1) NOT NULL DEFAULT 5.0
                            CHECK (quality_score BETWEEN 0 AND 10),
  times_used                INT         NOT NULL DEFAULT 0,
  correct_rate              NUMERIC(5,4)
                            CHECK (correct_rate IS NULL OR correct_rate BETWEEN 0 AND 1),
  report_count              INT         NOT NULL DEFAULT 0,

  -- Promotion tracking (playable_private → approved_public path)
  times_used_private        INT         NOT NULL DEFAULT 0,
  avg_correct_rate_private  NUMERIC(5,4)
                            CHECK (avg_correct_rate_private IS NULL OR avg_correct_rate_private BETWEEN 0 AND 1),
  promotion_eligible        BOOLEAN     NOT NULL DEFAULT FALSE,
  promotion_flagged_at      TIMESTAMPTZ,

  -- Ownership
  created_by                UUID        REFERENCES auth.users ON DELETE SET NULL,
  generation_log_id         UUID,       -- FK added in migration 082 when that table exists

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Structural constraint: options must be a JSON array of exactly 4 elements
  CONSTRAINT options_is_array         CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT options_has_four_items   CHECK (jsonb_array_length(options) = 4)
);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_trivia_questions_updated_at ON public.trivia_questions;
CREATE TRIGGER trg_trivia_questions_updated_at
  BEFORE UPDATE ON public.trivia_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Public pool: main serving index (most queries)
CREATE INDEX IF NOT EXISTS idx_tq_public_pool
  ON public.trivia_questions (sport, difficulty)
  WHERE approval_state = 'approved_public';

-- Public pool with event tag
CREATE INDEX IF NOT EXISTS idx_tq_event_pool
  ON public.trivia_questions (event, difficulty)
  WHERE event IS NOT NULL AND approval_state = 'approved_public';

-- Private pool: owner queries their own generated questions
CREATE INDEX IF NOT EXISTS idx_tq_private_owner
  ON public.trivia_questions (created_by, sport, difficulty)
  WHERE approval_state = 'playable_private';

-- Promotion monitoring
CREATE INDEX IF NOT EXISTS idx_tq_promotion_eligible
  ON public.trivia_questions (sport)
  WHERE promotion_eligible = TRUE AND approval_state = 'playable_private';

-- Generation log linkage (for credit reconciliation queries)
CREATE INDEX IF NOT EXISTS idx_tq_generation_log
  ON public.trivia_questions (generation_log_id)
  WHERE generation_log_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.trivia_questions ENABLE ROW LEVEL SECURITY;

-- Anyone can read approved_public questions
CREATE POLICY tq_read_public ON public.trivia_questions
  FOR SELECT
  USING (approval_state = 'approved_public');

-- Owner can read their own playable_private questions
CREATE POLICY tq_read_own_private ON public.trivia_questions
  FOR SELECT
  USING (
    approval_state = 'playable_private'
    AND created_by = auth.uid()
  );

-- Only service role inserts/updates (enforced by absence of INSERT/UPDATE policies for anon/user)
-- Edge Functions use service role key and bypass RLS.


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_question_sets
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trivia_question_sets (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT        NOT NULL,
  description           TEXT,

  -- Taxonomy (mirrors question taxonomy)
  sport                 TEXT        NOT NULL
                        CHECK (sport IN ('soccer','nfl','nba','mlb','college_football','f1','tennis','mma')),
  category              TEXT,
  event                 TEXT
                        CHECK (event IS NULL OR event IN ('world_cup_2026')),
  scope_type            TEXT        CHECK (scope_type IN ('team','player','competition','era','mixed',NULL)),
  scope_value           TEXT,
  difficulty            TEXT        CHECK (difficulty IN ('easy','medium','hard','mixed')),

  -- Contents
  question_ids          UUID[]      NOT NULL,
  question_count        INT         GENERATED ALWAYS AS (array_length(question_ids, 1)) STORED,

  -- Source and visibility
  source_type           TEXT        NOT NULL DEFAULT 'manual'
                        CHECK (source_type IN ('manual','ai','user','event')),
  visibility            TEXT        NOT NULL DEFAULT 'private'
                        CHECK (visibility IN ('private','public','event_only')),
  created_by            UUID        REFERENCES auth.users ON DELETE SET NULL,

  -- AI dedup (populated only for AI-generated sets)
  ai_prompt_hash        TEXT,
  ai_prompt_text        TEXT,

  -- Quality and promotion signals
  times_played          INT         NOT NULL DEFAULT 0,
  avg_correct_rate      NUMERIC(5,4)
                        CHECK (avg_correct_rate IS NULL OR avg_correct_rate BETWEEN 0 AND 1),
  quality_score         NUMERIC(3,1) NOT NULL DEFAULT 5.0
                        CHECK (quality_score BETWEEN 0 AND 10),
  promotion_eligible    BOOLEAN     NOT NULL DEFAULT FALSE,
  promoted_at           TIMESTAMPTZ,

  -- Credit tracking (populated for AI-generated sets in migration 082)
  credits_spent_total   INT         NOT NULL DEFAULT 0,
  generation_log_ids    UUID[],

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_trivia_question_sets_updated_at ON public.trivia_question_sets;
CREATE TRIGGER trg_trivia_question_sets_updated_at
  BEFORE UPDATE ON public.trivia_question_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tqs_public
  ON public.trivia_question_sets (sport, difficulty)
  WHERE visibility = 'public';

CREATE INDEX IF NOT EXISTS idx_tqs_event
  ON public.trivia_question_sets (event)
  WHERE event IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tqs_prompt_hash
  ON public.trivia_question_sets (ai_prompt_hash)
  WHERE ai_prompt_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tqs_owner
  ON public.trivia_question_sets (created_by)
  WHERE created_by IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.trivia_question_sets ENABLE ROW LEVEL SECURITY;

-- Anyone can read public sets
CREATE POLICY tqs_read_public ON public.trivia_question_sets
  FOR SELECT
  USING (visibility = 'public');

-- Owner can read their own private sets
CREATE POLICY tqs_read_own ON public.trivia_question_sets
  FOR SELECT
  USING (created_by = auth.uid());

-- Owner can update their own sets (title, description, question_ids only — not visibility/approval)
CREATE POLICY tqs_update_own ON public.trivia_question_sets
  FOR UPDATE
  USING (created_by = auth.uid());
