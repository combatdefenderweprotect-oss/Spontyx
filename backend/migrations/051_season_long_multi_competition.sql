-- 051_season_long_multi_competition.sql
--
-- Season-Long League rebuild — Phase 2 of the implementation plan tracked in
-- docs/LEAGUE_CREATION_FLOW.md (canonical spec).
--
-- Adds:
--   * leagues.creation_path TEXT — discriminator for Season-Long Path A vs Path B.
--     NULL for Match Night, Custom, and legacy rows.
--   * leagues.api_sports_league_ids INTEGER[] — multi-competition support for
--     Path A (and single-element for Path B). Temporary launch shape; the
--     long-term target is a normalised league_competitions join table.
--
-- Existing leagues.api_sports_league_id remains as legacy / convenience for the
-- primary competition. New code should prefer api_sports_league_ids when set.
--
-- Idempotent. Safe for existing data.

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS creation_path TEXT
    CHECK (creation_path IN ('team', 'competition')) DEFAULT NULL;

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS api_sports_league_ids INTEGER[];

COMMENT ON COLUMN leagues.creation_path IS
  'Season-Long path discriminator: ''team'' (Path A — team-based, multi-competition) or ''competition'' (Path B — single competition). NULL for Match Night, Custom, and legacy rows. Spec: docs/LEAGUE_CREATION_FLOW.md';

COMMENT ON COLUMN leagues.api_sports_league_ids IS
  'Array of API-Sports league IDs covered by this league. Path A may contain many; Path B contains exactly one. Match Night/Custom/legacy may be NULL. Temporary launch shape — long-term target is a normalised league_competitions join table. New code reads this first; falls back to api_sports_league_id (legacy) when NULL or empty.';

-- Trivial backfill: existing rows with a single api_sports_league_id get a
-- one-element array mirror so new code reading api_sports_league_ids works
-- transparently for legacy leagues. NULL rows stay NULL (legacy/custom behaviour).
UPDATE leagues
   SET api_sports_league_ids = ARRAY[api_sports_league_id]
 WHERE api_sports_league_id IS NOT NULL
   AND api_sports_league_ids IS NULL;

CREATE INDEX IF NOT EXISTS idx_leagues_creation_path
  ON leagues (creation_path)
  WHERE creation_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leagues_api_sports_league_ids
  ON leagues USING GIN (api_sports_league_ids);
