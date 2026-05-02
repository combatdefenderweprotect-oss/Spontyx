-- Migration 044: BR Questions Table Alterations (v2 — fixed)
--
-- Two changes to the existing `questions` table to support BR_MATCH_LIVE:
--
-- 1. questions.br_session_id — add FK column
--    Links a BR_MATCH_LIVE question to its session. Null for all existing
--    CORE_MATCH_PREMATCH / CORE_MATCH_LIVE / REAL_WORLD questions.
--
-- 2. questions CHECK constraint update — three-way exclusivity
--    Migration 033 added `questions_exactly_one_owner` (strict 2-way: exactly
--    one of league_id / arena_session_id must be set). BR questions have both
--    NULL. We drop the old constraint and add a permissive 3-way version.
--
-- NOTE: correct_answer column does not exist on this questions table schema,
-- so the original step 1 (DROP NOT NULL on correct_answer) is omitted.


-- ── 1. Add br_session_id column ───────────────────────────────────────────────

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS br_session_id UUID
    REFERENCES br_sessions (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_questions_br_session
  ON questions (br_session_id, resolution_status)
  WHERE br_session_id IS NOT NULL;


-- ── 2. Replace strict two-way CHECK with permissive three-way CHECK ───────────
-- Drop the old constraint by its known name from migration 033.

ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_exactly_one_owner;

-- Also drop by the new name in case this migration was partially run before.
ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_session_exclusivity;

ALTER TABLE questions
  ADD CONSTRAINT questions_session_exclusivity CHECK (
    league_id IS NOT NULL
    OR arena_session_id IS NOT NULL
    OR br_session_id IS NOT NULL
  );


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'questions'
  AND column_name  IN ('br_session_id', 'league_id', 'arena_session_id')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'questions'::regclass
  AND contype = 'c'
  AND conname = 'questions_session_exclusivity';
