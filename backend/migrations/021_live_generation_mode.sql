-- ── Migration 021: Extend generation_mode CHECK to include live modes ────────
--
-- The generation_run_leagues.generation_mode column was created in migration 002
-- with a CHECK constraint allowing only:
--   'match_preview' | 'narrative_preview' | 'narrative_only'
--
-- The live generation pipeline introduced in the 2026-04-28 LIVE sprint writes
-- 'live_gap' and 'live_event' as generation_mode values.  Without this migration
-- every live generation writeLeagueResult() call will fail with a constraint
-- violation and the run will not be auditable in generation_run_leagues.
--
-- Safe to run multiple times (DROP IF EXISTS + ADD IF NOT EXISTS pattern).
-- ──────────────────────────────────────────────────────────────────────────────

-- Step 1 — Drop the old inline constraint (auto-named by Postgres).
-- If the constraint was already dropped or never existed the IF EXISTS guard
-- prevents an error so this migration remains idempotent.
ALTER TABLE public.generation_run_leagues
  DROP CONSTRAINT IF EXISTS generation_run_leagues_generation_mode_check;

-- Step 2 — Add the expanded constraint with all valid values.
-- Includes all original values plus the two new live modes.
ALTER TABLE public.generation_run_leagues
  ADD CONSTRAINT generation_run_leagues_generation_mode_check
  CHECK (generation_mode IN (
    'match_preview',
    'narrative_preview',
    'narrative_only',
    'live_gap',
    'live_event'
  ));
