-- Migration 063: Add fixture status tracking to league_fixtures.
--
-- fixture_status: mirrors api_football_fixtures.status_short for fast completion checks.
--   Populated by sync-fixtures (live mode per fixture, daily bulk propagation).
--   NULL = not yet synced. Evaluator treats NULL as unfinished.
--
-- finished_at: timestamp when the fixture reached a terminal status.
--   Terminal statuses: FT, AET, PEN, AWD, WO, CANC, ABD.
--   Populated by sync-fixtures at the same time as fixture_status.
--
-- These columns let the evaluator check league_fixtures directly without
-- joining api_football_fixtures on every run.

ALTER TABLE public.league_fixtures
  ADD COLUMN IF NOT EXISTS fixture_status TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS finished_at    TIMESTAMPTZ DEFAULT NULL;

-- Fast evaluator query: count unfinished fixtures per league.
CREATE INDEX IF NOT EXISTS idx_league_fixtures_status
  ON public.league_fixtures (league_id, fixture_status);
