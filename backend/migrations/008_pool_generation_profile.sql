-- Migration 008: Add scope + scoped_team_id to match_question_pool
-- Fixes: scoped (team-specific) leagues were incorrectly sharing a pool with
-- full-league leagues watching the same match. The generation profile must
-- include scope so team-focused questions are never served to full-league contexts.

ALTER TABLE match_question_pool
  ADD COLUMN IF NOT EXISTS scope          text NOT NULL DEFAULT 'full_league'
    CHECK (scope IN ('full_league', 'team_specific')),
  ADD COLUMN IF NOT EXISTS scoped_team_id text;

-- Drop the old UNIQUE constraint and recreate with scope + scoped_team_id included.
-- The constraint name may vary — drop by name if it exists, ignore if not.
DO $$
BEGIN
  ALTER TABLE match_question_pool
    DROP CONSTRAINT IF EXISTS match_question_pool_match_id_sport_league_type_phase_scope_mo_key;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Also try the shorter auto-generated name variant
DO $$
BEGIN
  ALTER TABLE match_question_pool
    DROP CONSTRAINT IF EXISTS match_question_pool_cache_key;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Find and drop any existing unique constraint on this table programmatically
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'match_question_pool'
      AND constraint_type = 'UNIQUE'
  LOOP
    EXECUTE 'ALTER TABLE match_question_pool DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
  END LOOP;
END $$;

-- New unique constraint including scope and scoped_team_id
-- Uses COALESCE so NULL scoped_team_id is treated uniformly in the unique check
-- (Postgres treats NULLs as distinct in UNIQUE, so we use a partial index instead)
CREATE UNIQUE INDEX IF NOT EXISTS match_question_pool_profile_full_idx
  ON match_question_pool (match_id, sport, league_type, phase_scope, mode, prompt_version, scope)
  WHERE scoped_team_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS match_question_pool_profile_scoped_idx
  ON match_question_pool (match_id, sport, league_type, phase_scope, mode, prompt_version, scope, scoped_team_id)
  WHERE scoped_team_id IS NOT NULL;

-- Backfill existing rows (all existing pools are full_league — no team-scoped leagues existed yet)
UPDATE match_question_pool SET scope = 'full_league', scoped_team_id = NULL WHERE scope IS NULL;
