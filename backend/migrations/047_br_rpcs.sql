-- Migration 047: Battle Royale RPCs
--
-- Two SECURITY DEFINER functions that form the server-authoritative
-- round-advance engine for BR sessions:
--
--   instantiate_br_session(p_session_id, p_pool_id, p_total_questions)
--     Called once by the client after all players have joined and the host
--     (or lobby) transitions the session from 'waiting' → 'active'.
--     Sets current_question_seq = 1 and records started_at.
--
--   advance_br_session_round(p_session_id, p_question_seq, p_is_voided)
--     Called by the resolve-questions Edge Function after each question
--     resolves (or is voided). Idempotent: no-op when
--     last_processed_seq >= p_question_seq.
--
--     Per-round actions:
--       1. Apply HP damage/bonus to each player based on their answer
--       2. Mark eliminated players (hp = 0 after delta)
--       3. Assign placement to newly eliminated players
--       4. Check if session is over (≤1 survivor OR last question)
--       5. If over → call finalize_br_session()
--       6. If continuing → advance current_question_seq
--
--   finalize_br_session(p_session_id)
--     Internal helper called by advance_br_session_round. Assigns final
--     placements, sets winner_user_id, marks session 'completed'.
--     Phase 3 will add br_rating updates here.


-- ── 1. instantiate_br_session ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION instantiate_br_session(
  p_session_id       UUID,
  p_pool_id          BIGINT,
  p_total_questions  INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
BEGIN
  SELECT * INTO v_session FROM br_sessions WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF v_session.status <> 'waiting' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'session_not_waiting',
      'status', v_session.status
    );
  END IF;

  UPDATE br_sessions SET
    status               = 'active',
    pool_id              = p_pool_id,
    total_questions      = p_total_questions,
    current_question_seq = 1,
    last_processed_seq   = 0,
    started_at           = NOW(),
    updated_at           = NOW()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'ok',               true,
    'current_question_seq', 1,
    'total_questions',  p_total_questions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION instantiate_br_session(UUID, BIGINT, INTEGER)
  TO authenticated, service_role;


-- ── 2. finalize_br_session (internal) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION finalize_br_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survivor_count  INTEGER;
  v_winner_uid      UUID;
  v_next_placement  INTEGER;
  r                 RECORD;
BEGIN
  -- Count surviving (non-eliminated) players
  SELECT COUNT(*) INTO v_survivor_count
  FROM br_session_players
  WHERE session_id  = p_session_id
    AND is_eliminated = false;

  -- Assign winner if exactly one survivor remains
  IF v_survivor_count = 1 THEN
    SELECT user_id INTO v_winner_uid
    FROM br_session_players
    WHERE session_id  = p_session_id
      AND is_eliminated = false
    LIMIT 1;
  END IF;

  -- Assign placement = 1 to survivor(s) not yet placed
  -- (ties share placement 1 when multiple survive to final question)
  UPDATE br_session_players
  SET placement = 1
  WHERE session_id    = p_session_id
    AND is_eliminated = false
    AND placement     IS NULL;

  -- Verify all eliminated players have placements (they should from round processing)
  -- Fill any gaps defensively
  SELECT COALESCE(MIN(placement), 2) INTO v_next_placement
  FROM br_session_players
  WHERE session_id  = p_session_id
    AND placement   IS NOT NULL;

  UPDATE br_session_players
  SET placement = v_next_placement + 1
  WHERE session_id  = p_session_id
    AND placement   IS NULL;

  -- Mark session completed
  UPDATE br_sessions SET
    status       = 'completed',
    winner_user_id = v_winner_uid,
    completed_at = NOW(),
    updated_at   = NOW()
  WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION finalize_br_session(UUID)
  TO service_role;


-- ── 3. advance_br_session_round ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION advance_br_session_round(
  p_session_id   UUID,
  p_question_seq INTEGER,
  p_is_voided    BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session          RECORD;
  v_pool_question    RECORD;
  v_player           RECORD;
  v_answer           RECORD;
  v_hp_delta         INTEGER;
  v_new_hp           INTEGER;
  v_streak           INTEGER;
  v_was_eliminated   BOOLEAN;
  v_survivors        INTEGER;
  v_next_placement   INTEGER;
  v_newly_eliminated INTEGER := 0;
  v_is_last_question BOOLEAN;
  v_question_id      UUID;
BEGIN

  -- ── Guard 1: session must exist and be active ───────────────────────────
  SELECT * INTO v_session FROM br_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object(
      'ok',     false,
      'reason', 'session_not_active',
      'status', v_session.status
    );
  END IF;

  -- ── Guard 2: idempotency — already processed this seq ──────────────────
  IF v_session.last_processed_seq >= p_question_seq THEN
    RETURN jsonb_build_object(
      'ok',                  false,
      'reason',              'already_processed',
      'last_processed_seq',  v_session.last_processed_seq
    );
  END IF;

  v_is_last_question := (p_question_seq >= v_session.total_questions);

  -- ── Fetch the pool question for HP delta values ─────────────────────────
  SELECT bpq.* INTO v_pool_question
  FROM br_match_pool_questions bpq
  WHERE bpq.pool_id          = v_session.pool_id
    AND bpq.br_question_seq  = p_question_seq;

  -- ── Fetch the live question row (to read player_answers) ────────────────
  SELECT id INTO v_question_id
  FROM questions
  WHERE br_session_id = p_session_id
    AND question_type = 'BR_MATCH_LIVE'
  ORDER BY created_at ASC
  OFFSET (p_question_seq - 1)
  LIMIT 1;

  -- ── Process each active player ──────────────────────────────────────────
  FOR v_player IN
    SELECT * FROM br_session_players
    WHERE session_id  = p_session_id
      AND is_eliminated = false
  LOOP
    -- Fetch this player's answer (if any)
    SELECT pa.is_correct, pa.streak_at_answer INTO v_answer
    FROM player_answers pa
    WHERE pa.question_id   = v_question_id
      AND pa.user_id       = v_player.user_id
    LIMIT 1;

    v_streak := v_player.current_streak;

    IF p_is_voided THEN
      -- Voided question: no HP change, no streak change
      v_hp_delta := 0;

    ELSIF v_answer IS NULL OR NOT v_answer.is_correct THEN
      -- Wrong answer or no answer — standard damage
      v_hp_delta := COALESCE(v_pool_question.br_wrong_damage, -15);
      v_streak   := 0;

    ELSE
      -- Correct answer
      v_hp_delta := 0;  -- base: no HP gain for standard questions
      v_streak   := v_streak + 1;

      -- Streak HP bonuses (Phase 1 schema; values capped by hp CHECK)
      IF v_streak >= 3 THEN
        v_hp_delta := v_hp_delta + 10;
      ELSIF v_streak = 2 THEN
        v_hp_delta := v_hp_delta + 5;
      END IF;

      -- Bonus question reward (Phase 2 activation)
      IF v_pool_question.br_question_type = 'bonus' THEN
        v_hp_delta := v_hp_delta + COALESCE(v_pool_question.br_correct_reward, 0);
      END IF;
    END IF;

    -- Apply HP delta with floor 0 and cap 150
    v_new_hp := GREATEST(0, LEAST(150, v_player.hp + v_hp_delta));

    v_was_eliminated := (v_new_hp = 0);

    -- Write HP update
    UPDATE br_session_players SET
      hp            = v_new_hp,
      current_streak = v_streak,
      is_eliminated  = v_was_eliminated,
      eliminated_at  = CASE WHEN v_was_eliminated THEN NOW() ELSE eliminated_at END
    WHERE session_id = p_session_id
      AND user_id    = v_player.user_id;

    IF v_was_eliminated THEN
      v_newly_eliminated := v_newly_eliminated + 1;
    END IF;

  END LOOP;

  -- ── Assign placements to newly eliminated players ───────────────────────
  -- Placement = (survivors_remaining + 1). All players eliminated in the same
  -- round receive the same placement number (tied elimination).
  SELECT COUNT(*) INTO v_survivors
  FROM br_session_players
  WHERE session_id  = p_session_id
    AND is_eliminated = false;

  IF v_newly_eliminated > 0 THEN
    v_next_placement := v_survivors + 1;

    UPDATE br_session_players SET
      placement = v_next_placement
    WHERE session_id    = p_session_id
      AND is_eliminated = true
      AND placement     IS NULL;
  END IF;

  -- ── Advance the sequence counter ────────────────────────────────────────
  UPDATE br_sessions SET
    last_processed_seq   = p_question_seq,
    current_question_seq = CASE
      WHEN (v_survivors <= 1 OR v_is_last_question) THEN current_question_seq
      ELSE p_question_seq + 1
    END,
    updated_at           = NOW()
  WHERE id = p_session_id;

  -- ── Check session-over conditions ───────────────────────────────────────
  IF v_survivors <= 1 OR v_is_last_question THEN
    PERFORM finalize_br_session(p_session_id);

    RETURN jsonb_build_object(
      'ok',               true,
      'session_complete', true,
      'survivors',        v_survivors,
      'newly_eliminated', v_newly_eliminated,
      'last_question',    v_is_last_question
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'session_complete',    false,
    'next_question_seq',   p_question_seq + 1,
    'survivors',           v_survivors,
    'newly_eliminated',    v_newly_eliminated,
    'last_processed_seq',  p_question_seq
  );

END;
$$;

GRANT EXECUTE ON FUNCTION advance_br_session_round(UUID, INTEGER, BOOLEAN)
  TO authenticated, service_role;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  p.proname   AS function_name,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'instantiate_br_session',
    'advance_br_session_round',
    'finalize_br_session'
  )
ORDER BY p.proname;
