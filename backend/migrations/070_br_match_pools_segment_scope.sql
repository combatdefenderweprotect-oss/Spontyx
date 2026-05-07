-- Migration 070: br_match_pools — half_scope → segment_scope rename
--
-- Mirrors migration 069's rename on br_sessions so both tables use the same
-- column name for the same concept.
--
-- The pool tables (br_match_pools, br_match_pool_questions) are dormant in
-- BR v2 — the live question pipeline writes directly to the questions table.
-- These tables remain in schema for potential future use (e.g., pre-warmup
-- questions, bonus rounds). The rename keeps them consistent with the rest
-- of the BR schema.
--
-- Safe to run: rename + constraint swap with no data migration needed.


-- ── 1. Rename half_scope → segment_scope ─────────────────────────────────────

ALTER TABLE br_match_pools
  RENAME COLUMN half_scope TO segment_scope;


-- ── 2. Drop old CHECK (auto-generated name after column rename) ───────────────

ALTER TABLE br_match_pools
  DROP CONSTRAINT IF EXISTS br_match_pools_half_scope_check;


-- ── 3. Add expanded CHECK and fix DEFAULT ────────────────────────────────────

ALTER TABLE br_match_pools
  ADD CONSTRAINT br_match_pools_segment_scope_check CHECK (segment_scope IN (
    'first_half', 'second_half',
    'period_1', 'period_2', 'period_3',
    'quarter_1', 'quarter_2', 'quarter_3', 'quarter_4',
    'set_1', 'set_2', 'set_3', 'set_4', 'set_5'
  ));

ALTER TABLE br_match_pools
  ALTER COLUMN segment_scope SET DEFAULT 'first_half';


-- ── 4. Unique index ───────────────────────────────────────────────────────────
-- The existing partial unique index idx_br_match_pools_profile references
-- (match_id, half_scope). Postgres automatically updates the column reference
-- to segment_scope after the rename, but the index name stays as-is.
-- No action required — Postgres handles this correctly.
--
-- Verify by checking the index definition below:


-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'br_match_pools'
  AND column_name  IN ('segment_scope', 'status', 'expires_at')
ORDER BY ordinal_position;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'br_match_pools'::regclass
  AND contype  = 'c'
ORDER BY conname;

-- Verify the unique index now references segment_scope
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'br_match_pools'
  AND indexname = 'idx_br_match_pools_profile';
