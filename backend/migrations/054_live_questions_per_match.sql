-- Migration 054: live_questions_per_match
--
-- Adds a user-facing, per-match live question count to leagues.
-- Mirrors migration 053 (prematch_questions_per_match) for the live lane.
-- live_question_budget is kept as a legacy fallback (not removed).
--
-- Range: 1–10.  Default: 6.
-- Generation reads: live_questions_per_match ?? live_question_budget ?? 6
--
-- Soccer-specific: slot positions in the generation pipeline assume a
-- 90-minute match with halftime. Other sports must not share this column
-- until they have their own slot logic.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS live_questions_per_match INTEGER DEFAULT 6;

ALTER TABLE leagues
  DROP CONSTRAINT IF EXISTS chk_live_qpm;

ALTER TABLE leagues
  ADD CONSTRAINT chk_live_qpm
  CHECK (
    live_questions_per_match IS NULL
    OR (live_questions_per_match >= 1 AND live_questions_per_match <= 10)
  );

-- Backfill existing rows: clamp live_question_budget to 1–10, fall back to 6.
UPDATE leagues
SET live_questions_per_match = LEAST(GREATEST(COALESCE(live_question_budget, 6), 1), 10)
WHERE live_questions_per_match IS NULL;

COMMENT ON COLUMN leagues.live_questions_per_match IS
  'User-selected target CORE_MATCH_LIVE questions per soccer match (1–10, default 6). '
  'Takes priority over live_question_budget. Set at league creation. '
  'Generation distributes questions across planned match-minute slots '
  '(floor(N/2) pre-HT in minutes 10–40, ceil(N/2) post-HT in minutes 55–85). '
  'Soccer-only: do not use for other sports without separate slot logic. '
  'Migration 054, 2026-05-05.';
