-- Migration 010: question_type lane column
-- Adds the canonical three-lane question_type identifier to the questions table.
-- Values: CORE_MATCH_PREMATCH | CORE_MATCH_LIVE | REAL_WORLD
-- Backfills existing rows using the same heuristic as detectLane() in league.html.
-- Run in Supabase SQL editor.

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_type TEXT
    CHECK (question_type IN ('CORE_MATCH_PREMATCH', 'CORE_MATCH_LIVE', 'REAL_WORLD'));

-- Backfill: same logic as detectLane() heuristic
-- match_minute_at_generation IS NOT NULL → live question (set only during live generation)
-- match_id IS NOT NULL                   → pre-match question tied to a specific match
-- else                                   → real-world intelligence question
UPDATE public.questions
SET question_type = CASE
  WHEN match_minute_at_generation IS NOT NULL THEN 'CORE_MATCH_LIVE'
  WHEN match_id IS NOT NULL                   THEN 'CORE_MATCH_PREMATCH'
  ELSE                                             'REAL_WORLD'
END
WHERE question_type IS NULL;

-- Index for fast lane-based queries (feed display priority, quota checks)
CREATE INDEX IF NOT EXISTS idx_questions_question_type
  ON public.questions (question_type);
