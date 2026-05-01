-- Migration 034: Add arena_session_id to match_lobbies
--
-- When all players are present in a lobby, createArenaSession() inserts
-- into arena_sessions and then updates match_lobbies.arena_session_id so
-- late-joining players (e.g. via invite link) can be redirected to the
-- already-created session rather than creating a duplicate.

ALTER TABLE match_lobbies
  ADD COLUMN IF NOT EXISTS arena_session_id UUID
    REFERENCES arena_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_match_lobbies_arena_session
  ON match_lobbies (arena_session_id)
  WHERE arena_session_id IS NOT NULL;
