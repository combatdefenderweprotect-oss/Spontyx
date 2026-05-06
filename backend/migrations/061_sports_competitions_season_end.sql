-- Migration 061: Add season end metadata to sports_competitions.
--
-- current_season_end: official end date for the active season per competition.
-- Populated by the sync-fixtures `season_meta` sync mode (daily cron — not yet scheduled).
-- The evaluator reads this to decide if a competition season has officially concluded.
-- NULL = unknown. Evaluator MUST defer when NULL.

ALTER TABLE public.sports_competitions
  ADD COLUMN IF NOT EXISTS current_season_end    DATE        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS season_end_synced_at  TIMESTAMPTZ DEFAULT NULL;
