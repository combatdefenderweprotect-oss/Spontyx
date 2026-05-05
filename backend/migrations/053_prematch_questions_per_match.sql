-- Migration 053: prematch_questions_per_match
--
-- Adds a user-facing, per-match pre-match question count to leagues.
-- Replaces the indirect intensity-preset control (prematch_question_budget)
-- as the primary UX lever. prematch_question_budget is kept for backward-compat
-- with leagues created before this migration.
--
-- Range: 1–10.  Default: 5.
-- Generation reads: prematch_questions_per_match ?? prematch_question_budget ?? 5

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS prematch_questions_per_match INTEGER DEFAULT 5;

ALTER TABLE leagues
  DROP CONSTRAINT IF EXISTS chk_prematch_qpm;

ALTER TABLE leagues
  ADD CONSTRAINT chk_prematch_qpm
  CHECK (
    prematch_questions_per_match IS NULL
    OR (prematch_questions_per_match >= 1 AND prematch_questions_per_match <= 10)
  );

-- Backfill existing rows so prematch_questions_per_match matches the budget
-- already set by the intensity preset (casual=3, standard=4, hardcore=6).
-- Rows with no budget get the new default of 5.
UPDATE leagues
SET prematch_questions_per_match = COALESCE(prematch_question_budget, 5)
WHERE prematch_questions_per_match IS NULL;

COMMENT ON COLUMN leagues.prematch_questions_per_match IS
  'User-selected target pre-match questions per fixture (1–10, default 5). '
  'Takes priority over prematch_question_budget. Set at league creation. '
  'Generation fills up to this count per (league_id, match_id); fallback '
  'templates cover any shortfall after the normal AI retry loop. '
  'Migration 053, 2026-05-05.';
