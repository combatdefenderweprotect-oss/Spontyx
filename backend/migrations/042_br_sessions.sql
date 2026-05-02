-- Migration 042: Battle Royale Sessions
--
-- One row per live BR game instance. Multiple sessions may share the same
-- br_match_pool (same match_id + half_scope) — each session progresses
-- through the pool questions independently via current_question_seq.
--
-- Session lifecycle:
--   waiting  → players joining lobby
--   active   → game in progress
--   completed → all rounds done or last player standing
--   cancelled → abandoned / no players / watchdog terminated
--
-- current_question_seq: 1-based pointer to the question being played now.
--   Starts at 0 (no question yet), advances after each round via
--   advance_br_session_round() RPC.
--
-- last_processed_seq: idempotency guard. advance_br_session_round() is a
--   no-op when last_processed_seq >= p_question_seq.
--
-- Stuck session watchdog condition (in resolve-questions Edge Function):
--   last_processed_seq < current_question_seq
--   AND resolves_after < now() - 10 minutes
--   → advance to next round (or finalize if last question).


-- ── 1. BR_SESSIONS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS br_sessions (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Pool reference (all questions come from here)
  pool_id               BIGINT        NOT NULL
                          REFERENCES br_match_pools (id),
  -- Match context (denormalized for fast reads without pool join)
  match_id              TEXT          NOT NULL,
  half_scope            TEXT          NOT NULL DEFAULT 'full_match'
                          CHECK (half_scope IN ('first_half', 'second_half', 'full_match')),
  mode                  TEXT          NOT NULL DEFAULT '1v1'
                          CHECK (mode IN ('1v1', 'ffa', '2v2')),
  -- Lobby that spawned this session
  lobby_id              UUID          REFERENCES match_lobbies (id) ON DELETE SET NULL,
  -- Match metadata (denormalized for display)
  home_team_name        TEXT,
  away_team_name        TEXT,
  kickoff_at            TIMESTAMPTZ,
  api_league_id         INTEGER,
  -- Session lifecycle
  status                TEXT          NOT NULL DEFAULT 'waiting'
                          CHECK (status IN ('waiting', 'active', 'completed', 'cancelled')),
  -- Round tracking
  current_question_seq  INTEGER       NOT NULL DEFAULT 0,
  last_processed_seq    INTEGER       NOT NULL DEFAULT 0,
  total_questions       INTEGER       NOT NULL DEFAULT 0,
  -- Winner (NULL = no winner / battle royale in progress)
  winner_user_id        UUID          REFERENCES auth.users (id) ON DELETE SET NULL,
  -- Timestamps
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Lookup by match (used by pool-sharing logic)
CREATE INDEX IF NOT EXISTS idx_br_sessions_match
  ON br_sessions (match_id, status);

-- Lookup by pool (used by advance_br_session_round)
CREATE INDEX IF NOT EXISTS idx_br_sessions_pool
  ON br_sessions (pool_id, status);

-- Active sessions ordered by creation (used by watchdog sweep)
CREATE INDEX IF NOT EXISTS idx_br_sessions_active
  ON br_sessions (status, created_at)
  WHERE status = 'active';

-- Lobby → session mapping
CREATE INDEX IF NOT EXISTS idx_br_sessions_lobby
  ON br_sessions (lobby_id)
  WHERE lobby_id IS NOT NULL;


-- ── 2. RLS ────────────────────────────────────────────────────────────────────
-- Authenticated read (BR session pages, lobby coordination).
-- Service role writes (Edge Functions, RPCs use service role key).

ALTER TABLE br_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_sessions' AND policyname = 'br_sessions_select'
  ) THEN
    CREATE POLICY "br_sessions_select"
      ON br_sessions FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_sessions' AND policyname = 'br_sessions_insert'
  ) THEN
    CREATE POLICY "br_sessions_insert"
      ON br_sessions FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- ⚠️  br_sessions_update_own references br_session_players (created in 043).
--     Run the block below AFTER migration 043 has been applied.
--
-- DO $$ BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_policies
--     WHERE tablename = 'br_sessions' AND policyname = 'br_sessions_update_own'
--   ) THEN
--     CREATE POLICY "br_sessions_update_own"
--       ON br_sessions FOR UPDATE TO authenticated
--       USING (
--         EXISTS (
--           SELECT 1 FROM br_session_players
--           WHERE br_session_players.session_id = br_sessions.id
--             AND br_session_players.user_id = auth.uid()
--         )
--       );
--   END IF;
-- END $$;


-- ── 3. Realtime ───────────────────────────────────────────────────────────────
-- BR session pages subscribe to status + seq changes so the UI advances
-- automatically when the server processes each round.
ALTER PUBLICATION supabase_realtime ADD TABLE br_sessions;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'br_sessions'
ORDER BY ordinal_position;
