-- Migration 069: BR Sessions — v2 schema corrections
--
-- Changes:
--   1. Rename half_scope → segment_scope (generic: soccer, hockey, basketball, tennis, NFL)
--   2. Expand segment_scope CHECK to full sport set; remove 'full_match'
--   3. Make pool_id nullable — BR v2 uses the live question pipeline directly,
--      not a pre-generated pool. pool_id IS kept in schema (FK stays) but is
--      no longer required.
--   4. Add rating_mode TEXT ('classic' | 'ranked') — separate from gameplay mode.
--      mode column remains gameplay-oriented (ffa for BR v1).
--   5. Add segment_ends_at TIMESTAMPTZ — informational; written at lobby lock
--      time for UI countdown. Resolver uses live match status, not this value.
--
-- Safe to run on a live DB: all ALTER operations add or relax constraints.
-- pool_id DROP NOT NULL is a metadata-only change (no rewrite).
-- Verify br_sessions row count before running; expected 0 in pre-launch.


-- ── 1. Rename half_scope → segment_scope ─────────────────────────────────────

ALTER TABLE br_sessions
  RENAME COLUMN half_scope TO segment_scope;


-- ── 2. Drop old CHECK constraint (now references segment_scope after rename) ──
-- Postgres renames the constraint definition but the constraint name stays as
-- br_sessions_half_scope_check. Drop by the auto-generated name.

ALTER TABLE br_sessions
  DROP CONSTRAINT IF EXISTS br_sessions_half_scope_check;


-- ── 3. Add expanded CHECK and fix DEFAULT ────────────────────────────────────

ALTER TABLE br_sessions
  ADD CONSTRAINT br_sessions_segment_scope_check CHECK (segment_scope IN (
    -- Soccer (v1 active)
    'first_half', 'second_half',
    -- Hockey (future)
    'period_1', 'period_2', 'period_3',
    -- Basketball / NFL (future)
    'quarter_1', 'quarter_2', 'quarter_3', 'quarter_4',
    -- Tennis (future)
    'set_1', 'set_2', 'set_3', 'set_4', 'set_5'
  ));

ALTER TABLE br_sessions
  ALTER COLUMN segment_scope SET DEFAULT 'first_half';


-- ── 4. Make pool_id nullable ─────────────────────────────────────────────────
-- BR v2 questions are generated directly into the questions table via the live
-- pipeline. pool_id stays as an optional FK for any future pool-based flows.

ALTER TABLE br_sessions
  ALTER COLUMN pool_id DROP NOT NULL;


-- ── 5. Add rating_mode column ────────────────────────────────────────────────
-- Determines whether this session affects br_rating (ELO).
-- Kept separate from mode to avoid overloading gameplay semantics.

ALTER TABLE br_sessions
  ADD COLUMN IF NOT EXISTS rating_mode TEXT NOT NULL DEFAULT 'classic'
    CONSTRAINT br_sessions_rating_mode_check
    CHECK (rating_mode IN ('classic', 'ranked'));


-- ── 6. Add segment_ends_at column ────────────────────────────────────────────
-- Informational. Computed at lobby-lock time: kickoff + 55 min (first_half)
-- or kickoff + 130 min (second_half). Never used for authoritative termination.

ALTER TABLE br_sessions
  ADD COLUMN IF NOT EXISTS segment_ends_at TIMESTAMPTZ;


-- ── 7. Update index on pool_id ───────────────────────────────────────────────
-- idx_br_sessions_pool still valid after pool_id becomes nullable.
-- No action needed — partial indexes on nullable columns work correctly.


-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'br_sessions'
  AND column_name  IN (
    'segment_scope', 'pool_id', 'rating_mode', 'segment_ends_at',
    'mode', 'total_questions', 'started_at'
  )
ORDER BY ordinal_position;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'br_sessions'::regclass
  AND contype  = 'c'
ORDER BY conname;
