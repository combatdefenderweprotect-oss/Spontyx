-- Migration 058: Persistent league_type
--
-- Stores the creator's explicit league type so backend systems can identify
-- Match Night, Season Long, and Custom leagues without heuristic inference.
--
-- Before this migration the distinction was inferred:
--   - creation_path 'team'/'competition' → Season Long
--   - fixture_id NOT NULL → Match Night (added migration 057)
--   - everything else → ambiguous
-- That caused the context builder to misclassify Match Night as a season league
-- whenever league_end_date was set.
--
-- Values:
--   match_night  — bound to exactly one fixture (fixture_id IS NOT NULL)
--   season_long  — auto-populated fixture set for a team or competition
--   custom       — creator-defined date range / fixture set
--
-- NULL is valid for leagues created before this migration. The generator and
-- context builder fall back safely on old inference logic for NULL rows.

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS league_type TEXT DEFAULT NULL
    CHECK (league_type IS NULL OR league_type IN ('match_night', 'season_long', 'custom'));

COMMENT ON COLUMN public.leagues.league_type IS
  'Explicit league type set at creation. '
  'match_night = single fixture; season_long = full season auto-fixture; custom = creator-defined. '
  'NULL for leagues created before migration 058 — legacy inference applies. '
  'Migration 058, 2026-05-06.';
