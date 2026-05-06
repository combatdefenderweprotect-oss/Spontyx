-- Migration 057: Match Night single-fixture binding
--
-- Adds fixture_id to leagues so a Match Night league can be bound to exactly
-- one fixture from api_football_fixtures. The generator reads this column to
-- restrict prematch, live, and REAL_WORLD generation to that specific match.
--
-- Season-Long and Custom leagues leave this NULL — their existing competition /
-- team scope continues to govern fixture selection unchanged.
--
-- Type: BIGINT (matches api_football_fixtures.fixture_id which is the external
-- integer ID from API-Sports). Nullable — NULL means "all fixtures in scope".

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS fixture_id BIGINT DEFAULT NULL;

-- FK guard: ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL syntax.
-- Use a DO block to add the constraint only when it does not already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_leagues_fixture_id'
      AND conrelid = 'public.leagues'::regclass
  ) THEN
    ALTER TABLE public.leagues
      ADD CONSTRAINT fk_leagues_fixture_id
      FOREIGN KEY (fixture_id)
      REFERENCES public.api_football_fixtures(fixture_id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_leagues_fixture_id
  ON public.leagues (fixture_id)
  WHERE fixture_id IS NOT NULL;

COMMENT ON COLUMN public.leagues.fixture_id IS
  'Single-fixture binding for Match Night leagues. '
  'When set, the question generator restricts prematch, live, and REAL_WORLD '
  'generation to this fixture only. NULL means the league covers all fixtures '
  'in scope (Season-Long and Custom). '
  'References api_football_fixtures(fixture_id). Migration 057, 2026-05-06.';
