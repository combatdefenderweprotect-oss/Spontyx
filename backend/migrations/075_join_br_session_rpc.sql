-- Migration 075: join_br_session RPC
--
-- Replaces the client-side INSERT into br_session_players with a
-- SECURITY DEFINER function. This:
--   1. Bypasses the RLS WITH CHECK that was blocking client inserts
--   2. Makes the join server-authoritative (status check + insert are atomic)
--   3. Handles the late-join race: returns 'session_not_waiting' cleanly
--      instead of letting the trigger raise an unhandled exception
--
-- Called from br-lobby.html via sb.rpc('join_br_session', { p_session_id })

CREATE OR REPLACE FUNCTION join_br_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_status  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT status INTO v_status FROM br_sessions WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF v_status <> 'waiting' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_waiting', 'status', v_status);
  END IF;

  INSERT INTO br_session_players (session_id, user_id)
  VALUES (p_session_id, v_uid)
  ON CONFLICT (session_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION join_br_session(UUID) TO authenticated;


-- Verify
SELECT proname, pg_get_function_arguments(oid) AS args, prosecdef AS security_definer
FROM pg_proc
WHERE proname = 'join_br_session';
