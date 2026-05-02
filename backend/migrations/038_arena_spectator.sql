-- Migration 038: Arena Session Spectator Mode
--
-- Adds opt-in spectating flag to arena_sessions.
-- Sessions are private by default (is_spectatable = false).
-- Set to true to allow non-participants to watch live.
--
-- Privacy guarantees:
--   • pa_select_member RLS already blocks spectators from reading player_answers
--   • pa_insert_self PATH B already blocks spectators from submitting answers
--   • No RLS changes required — existing policies are correct

ALTER TABLE arena_sessions
  ADD COLUMN IF NOT EXISTS is_spectatable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN arena_sessions.is_spectatable IS
  'When true, any authenticated user may view the session in read-only mode. Default false = private.';
