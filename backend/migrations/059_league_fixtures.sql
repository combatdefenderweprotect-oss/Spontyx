-- Migration 059: Season Long fixture lifecycle — Phase 1
--
-- 1. league_fixtures: authoritative fixture list per Season Long league.
--    Populated at league creation from the browser-loaded fixture preview.
--    Generator uses these rows instead of broad competition queries.
--
-- 2. leagues: completion state + fixture count (scaffold only — evaluator not live yet).
--
-- 3. league_members: final rank + final points (scaffold only).

-- ── league_fixtures ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.league_fixtures (
  id           BIGSERIAL PRIMARY KEY,
  league_id    UUID        NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  fixture_id   BIGINT      NOT NULL REFERENCES public.api_football_fixtures(fixture_id) ON DELETE CASCADE,
  api_league_id INTEGER     NOT NULL,   -- competition ID (api_football_fixtures.league_id)
  kickoff_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, fixture_id)
);

CREATE INDEX IF NOT EXISTS idx_league_fixtures_league_id
  ON public.league_fixtures (league_id);

CREATE INDEX IF NOT EXISTS idx_league_fixtures_fixture_id
  ON public.league_fixtures (fixture_id);

-- RLS: owners and members may read; only the service role may insert/delete.
ALTER TABLE public.league_fixtures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "league_fixtures_read" ON public.league_fixtures;
CREATE POLICY "league_fixtures_read"
  ON public.league_fixtures FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_fixtures.league_id
        AND lm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.leagues l
      WHERE l.id = league_fixtures.league_id
        AND l.owner_id = auth.uid()
    )
  );

-- ── leagues: completion scaffold ────────────────────────────────────────────
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS fixture_count    INTEGER     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS winner_user_id  UUID        DEFAULT NULL
    REFERENCES public.users(id) ON DELETE SET NULL;

-- ── league_members: final placement scaffold ────────────────────────────────
ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS final_rank   INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS final_points INTEGER DEFAULT NULL;
