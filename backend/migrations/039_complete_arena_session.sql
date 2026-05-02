-- Migration 039: Arena Session Completion Trigger
--
-- Provides a single authoritative write path for marking an arena session
-- as completed. Called by:
--   (1) resolve-questions Edge Function — after resolving/voiding an
--       arena-session-bound question (primary path)
--   (2) arena-session.html client — as a fallback when polling detects
--       no active questions remain (replaces the previous direct status write)
--
-- Completion requires ALL of:
--   • session.status = 'active'
--   • at least 1 question exists for this session
--   • 0 pending questions remain
--
-- The function is idempotent: calling it on an already-completed session
-- returns the existing winner fields without re-writing anything.
--
-- Winner logic:
--   1v1 — compare arena_session_players.score; highest wins; tie = draw
--   2v2 — sum score by team_number; highest team wins; tie = draw

CREATE OR REPLACE FUNCTION complete_arena_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session          RECORD;
  v_total_questions  INTEGER;
  v_pending_count    INTEGER;
  v_winner_user_id   UUID    := NULL;
  v_winning_team_num INTEGER := NULL;

  -- 1v1 helpers
  v_p1               RECORD;
  v_p2               RECORD;

  -- 2v2 helpers
  v_team1_score      BIGINT := 0;
  v_team2_score      BIGINT := 0;
BEGIN

  -- ── Guard 1: session must exist and be active ───────────────────────
  SELECT * INTO v_session FROM arena_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'completed', false,
      'reason',    'session_not_found'
    );
  END IF;

  -- ── Guard 2: idempotency — already completed or cancelled ──────────
  IF v_session.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'completed',           false,
      'reason',              'already_done',
      'winner_user_id',      v_session.winner_user_id,
      'winning_team_number', v_session.winning_team_number
    );
  END IF;

  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object(
      'completed', false,
      'reason',    'session_not_active',
      'status',    v_session.status
    );
  END IF;

  -- ── Guard 3: at least one question must exist ───────────────────────
  SELECT COUNT(*) INTO v_total_questions
  FROM questions
  WHERE arena_session_id = p_session_id;

  IF v_total_questions = 0 THEN
    RETURN jsonb_build_object(
      'completed', false,
      'reason',    'no_questions'
    );
  END IF;

  -- ── Guard 4: no pending questions may remain ────────────────────────
  SELECT COUNT(*) INTO v_pending_count
  FROM questions
  WHERE arena_session_id = p_session_id
    AND resolution_status = 'pending';

  IF v_pending_count > 0 THEN
    RETURN jsonb_build_object(
      'completed',       false,
      'reason',          'questions_still_pending',
      'pending_count',   v_pending_count,
      'total_questions', v_total_questions
    );
  END IF;

  -- ── Determine winner ────────────────────────────────────────────────
  IF v_session.mode = '2v2' THEN

    SELECT COALESCE(SUM(score), 0) INTO v_team1_score
    FROM arena_session_players
    WHERE session_id = p_session_id AND team_number = 1;

    SELECT COALESCE(SUM(score), 0) INTO v_team2_score
    FROM arena_session_players
    WHERE session_id = p_session_id AND team_number = 2;

    IF v_team1_score > v_team2_score THEN
      v_winning_team_num := 1;
    ELSIF v_team2_score > v_team1_score THEN
      v_winning_team_num := 2;
    END IF;
    -- Equal scores → both remain NULL (draw)

  ELSE
    -- 1v1: compare the two players directly
    SELECT user_id, score INTO v_p1
    FROM arena_session_players
    WHERE session_id = p_session_id
    ORDER BY score DESC, joined_at ASC
    LIMIT 1;

    SELECT user_id, score INTO v_p2
    FROM arena_session_players
    WHERE session_id = p_session_id
      AND user_id <> v_p1.user_id
    LIMIT 1;

    IF v_p1.score > COALESCE(v_p2.score, 0) THEN
      v_winner_user_id := v_p1.user_id;
    END IF;
    -- Equal scores → winner_user_id remains NULL (draw)

  END IF;

  -- ── Write completion ────────────────────────────────────────────────
  UPDATE arena_sessions SET
    status              = 'completed',
    completed_at        = NOW(),
    winner_user_id      = v_winner_user_id,
    winning_team_number = v_winning_team_num
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'completed',           true,
    'winner_user_id',      v_winner_user_id,
    'winning_team_number', v_winning_team_num,
    'total_questions',     v_total_questions
  );

END;
$$;

GRANT EXECUTE ON FUNCTION complete_arena_session(UUID) TO authenticated, service_role;
