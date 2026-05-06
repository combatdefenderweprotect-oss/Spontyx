-- Migration 062: team_competition_status — team elimination / active signal per season.
--
-- Primary signal for Season Long Path A (team-based) completion evaluation.
-- Populated by a future sync job (sync-team-status — NOT YET IMPLEMENTED).
-- The evaluator reads status to determine if a team is still alive in a competition.
--
-- Status enum:
--   active     — team is confirmed still in the competition this season
--   eliminated — team has been knocked out or the season ended for them
--   unknown    — data exists but status cannot be determined (e.g. ambiguous bracket)
--
-- The evaluator treats NULL (no row) and 'unknown' identically: DEFER.
-- A row is never auto-inserted by any currently live process — table starts empty.

CREATE TABLE IF NOT EXISTS public.team_competition_status (
  sport          TEXT        NOT NULL,
  api_team_id    INTEGER     NOT NULL,
  api_league_id  INTEGER     NOT NULL,
  season         INTEGER     NOT NULL,
  status         TEXT        NOT NULL
    CHECK (status IN ('active', 'eliminated', 'unknown')),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, api_team_id, api_league_id, season)
);

-- RLS: service role writes; authenticated users may read (for admin visibility).
ALTER TABLE public.team_competition_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tcs_read_authenticated" ON public.team_competition_status;
CREATE POLICY "tcs_read_authenticated"
  ON public.team_competition_status FOR SELECT
  USING (auth.role() = 'authenticated');

-- Index for evaluator's primary lookup pattern.
CREATE INDEX IF NOT EXISTS idx_tcs_team_league_season
  ON public.team_competition_status (api_team_id, api_league_id, season);
