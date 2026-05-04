-- 052_league_scoring_v2.sql
--
-- League Scoring V2 — flat +10/0 model with optional Confidence Scoring (Normal/High/Very High).
-- Applies to ALL league-bound questions going forward. Arena and BR are NOT affected.
--
-- Adds:
--   * player_answers.confidence_level TEXT — 'normal' | 'high' | 'very_high'. Default 'normal'.
--     Captured at answer submission time. Existing rows get 'normal' implicitly via the column default.
--   * leagues.confidence_scoring_enabled BOOLEAN DEFAULT false — creator-controlled toggle. When false,
--     all answers in this league score as Normal regardless of player selection.
--
-- Behaviour change (post-deploy):
--   * League questions: resolver applies calculateLeagueAnswerPoints() — flat +10/0 (Normal),
--     +15/-5 (High), +20/-10 (Very High). NO time-pressure / streak / comeback / clutch /
--     difficulty multipliers. Existing already-resolved answers are NOT recalculated.
--   * Arena & BR: untouched — keep base × multipliers formula.
--
-- Idempotent. Additive only.

ALTER TABLE public.player_answers
  ADD COLUMN IF NOT EXISTS confidence_level TEXT NOT NULL DEFAULT 'normal'
    CHECK (confidence_level IN ('normal', 'high', 'very_high'));

COMMENT ON COLUMN public.player_answers.confidence_level IS
  'League Scoring V2 (migration 052). Player-selected confidence at answer submission. Honored only when leagues.confidence_scoring_enabled = true. Arena/BR ignore this field.';

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS confidence_scoring_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leagues.confidence_scoring_enabled IS
  'League Scoring V2 (migration 052). When true, players choose Normal / High / Very High before submitting and earn matching points (10/0, 15/-5, 20/-10). When false, all answers score Normal (+10/0).';

-- Optional small index for resolver performance — most resolver queries already filter by question
-- so this is just an analytics/debug aid, not a hot path.
CREATE INDEX IF NOT EXISTS idx_pa_confidence_level
  ON public.player_answers (confidence_level)
  WHERE confidence_level <> 'normal';
