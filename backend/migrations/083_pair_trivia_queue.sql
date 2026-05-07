-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 083 — Trivia queue RPCs
-- RPCs:    pair_trivia_queue()  — atomic matchmaking → room + sessions
--          cancel_trivia_queue() — cancel caller's waiting entry
-- Depends: 079 (trivia_rooms, trivia_duel_queue, trivia_sessions.room_id)
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- pair_trivia_queue() → JSONB
--
-- Called by a player who is already waiting in trivia_duel_queue.
-- Finds the oldest other waiting player in the same sport.
-- On match:
--   1. Picks 10 random approved_public questions for the sport.
--   2. Creates a trivia_room (status='active') with the question set.
--   3. Creates a trivia_session for each player (is_ranked=true, mode='ranked_duel').
--   4. Links sessions back to the room.
--   5. Marks both queue entries matched.
--   6. Returns {ok, status:'matched', room_id, session_id, opponent_id, question_ids}.
--
-- If no opponent found: returns {ok:true, status:'waiting'}.
-- If caller's entry is expired: marks it expired, returns {ok:false, reason:'queue_expired'}.
-- Race-safe: FOR UPDATE SKIP LOCKED prevents double-pairing.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pair_trivia_queue()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_my_entry      public.trivia_duel_queue%ROWTYPE;
  v_opp_entry     public.trivia_duel_queue%ROWTYPE;
  v_question_ids  UUID[];
  v_room_id       UUID;
  v_sess1_id      UUID;
  v_sess2_id      UUID;
  v_my_session_id UUID;
  v_p1_id         UUID;
  v_p2_id         UUID;
  v_opp_id        UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- ── Lock caller's own waiting entry ──────────────────────────────────────
  SELECT * INTO v_my_entry
    FROM public.trivia_duel_queue
   WHERE user_id = v_caller_id
     AND status  = 'waiting'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_queue');
  END IF;

  -- Expire stale entry
  IF v_my_entry.expires_at < NOW() THEN
    UPDATE public.trivia_duel_queue
       SET status = 'expired'
     WHERE id = v_my_entry.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'queue_expired');
  END IF;

  -- ── Find opponent (oldest first, SKIP LOCKED for race safety) ────────────
  SELECT * INTO v_opp_entry
    FROM public.trivia_duel_queue
   WHERE status    = 'waiting'
     AND sport     = v_my_entry.sport
     AND user_id  <> v_caller_id
     AND expires_at > NOW()
   ORDER BY joined_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'waiting');
  END IF;

  -- ── Assign player1 / player2 by queue join order ──────────────────────────
  IF v_my_entry.joined_at <= v_opp_entry.joined_at THEN
    v_p1_id := v_caller_id;
    v_p2_id := v_opp_entry.user_id;
  ELSE
    v_p1_id := v_opp_entry.user_id;
    v_p2_id := v_caller_id;
  END IF;

  v_opp_id := CASE WHEN v_caller_id = v_p1_id THEN v_p2_id ELSE v_p1_id END;

  -- ── Pick 10 random approved questions for the sport ───────────────────────
  SELECT ARRAY(
    SELECT id
      FROM public.trivia_questions
     WHERE sport          = v_my_entry.sport
       AND approval_state = 'approved_public'
     ORDER BY random()
     LIMIT 10
  ) INTO v_question_ids;

  IF array_length(v_question_ids, 1) IS NULL
     OR array_length(v_question_ids, 1) < 10
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_questions');
  END IF;

  -- ── Create room ────────────────────────────────────────────────────────────
  INSERT INTO public.trivia_rooms (
    sport,           event,
    question_ids,    total_rounds,  timer_seconds,
    player1_id,      player2_id,
    status
  ) VALUES (
    v_my_entry.sport,  v_my_entry.event,
    v_question_ids,    10,            15,
    v_p1_id,           v_p2_id,
    'active'
  )
  RETURNING id INTO v_room_id;

  -- ── Create sessions ────────────────────────────────────────────────────────
  INSERT INTO public.trivia_sessions (
    user_id,  mode,           sport,            difficulty,
    total_rounds,  timer_seconds,  is_ranked,  room_id,
    result_status, completed
  ) VALUES (
    v_p1_id,  'ranked_duel',  v_my_entry.sport, 'mixed',
    10,            15,             TRUE,       v_room_id,
    'abandoned',   FALSE
  )
  RETURNING id INTO v_sess1_id;

  INSERT INTO public.trivia_sessions (
    user_id,  mode,           sport,            difficulty,
    total_rounds,  timer_seconds,  is_ranked,  room_id,
    result_status, completed
  ) VALUES (
    v_p2_id,  'ranked_duel',  v_my_entry.sport, 'mixed',
    10,            15,             TRUE,       v_room_id,
    'abandoned',   FALSE
  )
  RETURNING id INTO v_sess2_id;

  -- ── Link sessions to room ──────────────────────────────────────────────────
  UPDATE public.trivia_rooms SET
    player1_session_id = v_sess1_id,
    player2_session_id = v_sess2_id
  WHERE id = v_room_id;

  -- ── Mark both queue entries matched ────────────────────────────────────────
  UPDATE public.trivia_duel_queue SET
    status          = 'matched',
    matched_room_id = v_room_id
  WHERE id IN (v_my_entry.id, v_opp_entry.id);

  -- ── Return caller's session + room ────────────────────────────────────────
  v_my_session_id := CASE WHEN v_caller_id = v_p1_id THEN v_sess1_id ELSE v_sess2_id END;

  RETURN jsonb_build_object(
    'ok',          true,
    'status',      'matched',
    'room_id',     v_room_id,
    'session_id',  v_my_session_id,
    'opponent_id', v_opp_id,
    'question_ids', v_question_ids
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- cancel_trivia_queue() → JSONB
--
-- Cancels the caller's waiting queue entry.
-- Idempotent: returns ok=true if already cancelled/matched/expired.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_trivia_queue()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_entry     public.trivia_duel_queue%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_entry
    FROM public.trivia_duel_queue
   WHERE user_id = v_caller_id
   ORDER BY joined_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'no_entry');
  END IF;

  -- Already in terminal state
  IF v_entry.status <> 'waiting' THEN
    RETURN jsonb_build_object('ok', true, 'status', v_entry.status);
  END IF;

  UPDATE public.trivia_duel_queue
     SET status = 'cancelled'
   WHERE id = v_entry.id;

  RETURN jsonb_build_object('ok', true, 'status', 'cancelled');

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
