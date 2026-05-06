-- Migration 060: Add lifecycle_status and completion debug columns to leagues.
--
-- lifecycle_status drives the Season Long completion evaluator (Phase 2b+).
-- Existing leagues default to 'active' — no behaviour changes.
-- The evaluator is NOT implemented yet; these columns are foundations only.

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active','awaiting_fixtures','pending_resolution','completed','archived')),
  ADD COLUMN IF NOT EXISTS last_completion_check_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completion_deferred_reason TEXT DEFAULT NULL;

-- Fast lookup: evaluator queries season_long leagues that are not yet completed.
CREATE INDEX IF NOT EXISTS idx_leagues_lifecycle_status
  ON public.leagues (lifecycle_status)
  WHERE lifecycle_status != 'completed';
