-- Migration 040: Battle Royale Match Pools
--
-- Shared question pool per match context. Multiple BR sessions using the same
-- match + half_scope share one pool — one set of OpenAI calls, reused across
-- all concurrent sessions for that match window.
--
-- Pool lifecycle:
--   generating → ready → stale
--   generating → failed
--
-- Pool expiry: kickoff + 130 minutes (covers full match including extra time).
-- A pool is stale when expires_at < now(). The generator skips stale pools and
-- creates a new one.
--
-- The generation_profile JSONB is the cache key that uniquely identifies a pool.
-- A partial unique index enforces one pool per (match_id, half_scope) context.


-- ── 1. BR_MATCH_POOLS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS br_match_pools (
  id                 BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Match context
  match_id           TEXT          NOT NULL,
  half_scope         TEXT          NOT NULL DEFAULT 'full_match'
                       CHECK (half_scope IN ('first_half', 'second_half', 'full_match')),
  -- Structured cache key (stored for auditability)
  generation_profile JSONB         NOT NULL DEFAULT '{}',
  -- Lifecycle
  status             TEXT          NOT NULL DEFAULT 'generating'
                       CHECK (status IN ('generating', 'ready', 'failed', 'stale')),
  question_count     INTEGER       NOT NULL DEFAULT 0,
  -- Expiry: kickoff + 130 minutes
  expires_at         TIMESTAMPTZ   NOT NULL,
  -- Timestamps
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- One pool per (match_id, half_scope). Race-safe: the INSERT ON CONFLICT pattern
-- in the generator claims the pool; only one process generates per match context.
CREATE UNIQUE INDEX IF NOT EXISTS idx_br_match_pools_profile
  ON br_match_pools (match_id, half_scope)
  WHERE status NOT IN ('failed', 'stale');

-- General index for lookup by match + status
CREATE INDEX IF NOT EXISTS idx_br_match_pools_match
  ON br_match_pools (match_id, status);

-- Index for expiry sweeps
CREATE INDEX IF NOT EXISTS idx_br_match_pools_expires
  ON br_match_pools (expires_at)
  WHERE status = 'ready';


-- ── 2. RLS ────────────────────────────────────────────────────────────────────
-- Public read (session pages need to read pool metadata).
-- Service role writes (Edge Function uses service role key).

ALTER TABLE br_match_pools ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_match_pools' AND policyname = 'br_pools_select'
  ) THEN
    CREATE POLICY "br_pools_select"
      ON br_match_pools FOR SELECT TO authenticated USING (true);
  END IF;
END $$;


-- ── 3. Realtime ───────────────────────────────────────────────────────────────
-- br-session.html (Phase 2) will subscribe to pool status changes so it can
-- start the session the moment a pool transitions to 'ready'.
ALTER PUBLICATION supabase_realtime ADD TABLE br_match_pools;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'br_match_pools'
ORDER BY ordinal_position;
