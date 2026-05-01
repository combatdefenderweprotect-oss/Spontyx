-- Migration 037: Arena Session Score Increment RPC
--
-- Provides an atomic score increment for arena_session_players.
-- Called by the resolve-questions Edge Function after awarding points_earned
-- to player_answers so the live scoreboard always reflects current scores.
--
-- Why a function: Supabase JS client cannot express
--   UPDATE ... SET score = score + N
-- without a race window. SECURITY DEFINER + a single UPDATE is atomic.

CREATE OR REPLACE FUNCTION increment_arena_player_score(
  p_session_id UUID,
  p_user_id    UUID,
  p_points     INTEGER
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE arena_session_players
  SET
    score           = score + p_points,
    correct_answers = correct_answers + 1
  WHERE session_id = p_session_id
    AND user_id    = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION increment_arena_player_score(UUID, UUID, INTEGER)
  TO authenticated, service_role;
