-- Migration 041: Battle Royale Match Pool Questions
--
-- Canonical question storage per pool. Multiple concurrent BR sessions that
-- share the same pool (match_id + half_scope) all read from this table.
--
-- One set of OpenAI calls generates these rows; br_sessions consume them
-- independently via current_question_seq pointer.
--
-- br_question_type:
--   standard — normal question, wrong = −15 HP, no HP reward
--   risk     — double-or-nothing variant (Phase 2 activation only)
--   bonus    — HP-restore question, one per pool max (Phase 2 activation only)
--
-- Phase 1: only 'standard' questions are generated. The risk/bonus columns
-- and partial unique index are present in schema but never populated until
-- pool generation config enables them in Phase 2.


-- ── 1. BR_MATCH_POOL_QUESTIONS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS br_match_pool_questions (
  id                          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pool_id                     BIGINT        NOT NULL
                                REFERENCES br_match_pools (id) ON DELETE CASCADE,
  -- Ordered position within this pool (1-based)
  br_question_seq             INTEGER       NOT NULL,
  -- Question content
  question_text               TEXT          NOT NULL,
  options                     JSONB         NOT NULL DEFAULT '[]',
  correct_answer              TEXT,         -- NULL allowed; resolver uses predicate
  resolution_predicate        JSONB         NOT NULL DEFAULT '{}',
  -- Question variant (Phase 1: always 'standard')
  br_question_type            TEXT          NOT NULL DEFAULT 'standard'
                                CHECK (br_question_type IN ('standard', 'risk', 'bonus')),
  -- HP delta on wrong answer (negative integer, e.g. −15)
  br_wrong_damage             INTEGER       NOT NULL DEFAULT -15
                                CHECK (br_wrong_damage <= 0),
  -- HP delta on correct answer for bonus questions (non-negative; 0 for standard)
  br_correct_reward           INTEGER       NOT NULL DEFAULT 0
                                CHECK (br_correct_reward >= 0),
  -- Answer window duration in seconds (enforced by UI; stored for pool reuse)
  answer_window_seconds       INTEGER       NOT NULL DEFAULT 30
                                CHECK (answer_window_seconds BETWEEN 15 AND 120),
  -- Seconds after the previous question resolves before this one becomes visible
  visible_from_offset_seconds INTEGER       NOT NULL DEFAULT 5
                                CHECK (visible_from_offset_seconds >= 0),
  -- Generation metadata
  difficulty_multiplier       NUMERIC(3,2)  NOT NULL DEFAULT 1.0,
  narrative_context           TEXT,
  -- Timestamps
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Seq must be unique within a pool
CREATE UNIQUE INDEX IF NOT EXISTS idx_br_pool_questions_seq
  ON br_match_pool_questions (pool_id, br_question_seq);

-- Fast pool read in question order
CREATE INDEX IF NOT EXISTS idx_br_pool_questions_pool
  ON br_match_pool_questions (pool_id, br_question_seq);

-- At most one bonus question per pool (Phase 2 activation guard)
CREATE UNIQUE INDEX IF NOT EXISTS idx_br_pool_questions_bonus
  ON br_match_pool_questions (pool_id)
  WHERE br_question_type = 'bonus';


-- ── 2. RLS ────────────────────────────────────────────────────────────────────
-- Authenticated read (BR session pages need to display questions).
-- Service role writes (Edge Function pool generator uses service role key).

ALTER TABLE br_match_pool_questions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_match_pool_questions' AND policyname = 'br_pool_questions_select'
  ) THEN
    CREATE POLICY "br_pool_questions_select"
      ON br_match_pool_questions FOR SELECT TO authenticated USING (true);
  END IF;
END $$;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'br_match_pool_questions'
ORDER BY ordinal_position;
