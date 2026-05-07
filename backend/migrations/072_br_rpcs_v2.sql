-- Migration 072: Battle Royale RPCs — v2 rewrite
--
-- Rewrites all three BR RPCs to align with the v2 segment-based gameplay model:
--
-- instantiate_br_session(p_session_id)
--   - Removed: p_pool_id, p_total_questions parameters (no pre-generated pool in v2)
--   - Added: segment_ends_at computed from kickoff_at + segment_scope
--   - Lobby lock now callable by the resolver cron without a pool
--
-- advance_br_session_round(p_session_id, p_question_seq, p_is_voided)
--   - Removed: pool question fetch (br_match_pool_questions no longer used)
--   - Removed: v_is_last_question termination (segment-end handled by resolver)
--   - Added: correct_answer_count increment on correct answer
--   - Added: hp_at_elimination, eliminated_at_seq written on elimination
--   - HP damage/reward: fixed constants (-15 wrong, 0 correct) — no variable damage in v1
--   - Streak bonus: 2-correct = +5 HP, 3+-correct = +10 HP (unchanged)
--   - Session terminates only when ≤1 survivor remains (segment-end is external)
--
-- finalize_br_session(p_session_id)
--   - Added: idempotency guard (re-entry is a no-op)
--   - Fixed: survivor ranking now uses full tiebreaker chain (HP → correct_answer_count
--             → avg_response_ms → current_streak) instead of all sharing placement 1
--   - Fixed: eliminated player ranking uses eliminated_at_seq + hp_at_elimination
--   - Added: avg_response_ms computed from player_answers timestamps at finalize
--   - Added: calls update_br_ratings() if rating_mode = 'ranked' and player_count >= 4
--
-- Requires: migrations 069 (rating_mode, segment_ends_at), 071 (new player columns)


-- ── 1. instantiate_br_session ────────────────────────────────────────────────
-- Transitions a waiting session to active. Called by:
--   a) Resolver cron — when live match status crosses segment start threshold
--   b) Client (br-lobby.html) — host can still trigger start manually in Phase 1
--
-- No longer accepts pool_id or total_questions. These are v1 pool-model params.

CREATE OR REPLACE FUNCTION instantiate_br_session(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session       RECORD;
  v_segment_ends  TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_session FROM br_sessions WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF v_session.status <> 'waiting' THEN
    RETURN jsonb_build_object(
      'ok',     false,
      'reason', 'session_not_waiting',
      'status', v_session.status
    );
  END IF;

  -- Compute informational segment end timestamp from kickoff + segment constant.
  -- Soccer v1 constants. Future sports add cases here.
  IF v_session.kickoff_at IS NOT NULL THEN
    v_segment_ends := CASE v_session.segment_scope
      WHEN 'first_half'  THEN v_session.kickoff_at + INTERVAL '55 minutes'
      WHEN 'second_half' THEN v_session.kickoff_at + INTERVAL '130 minutes'
      WHEN 'period_1'    THEN v_session.kickoff_at + INTERVAL '25 minutes'
      WHEN 'period_2'    THEN v_session.kickoff_at + INTERVAL '50 minutes'
      WHEN 'period_3'    THEN v_session.kickoff_at + INTERVAL '75 minutes'
      WHEN 'quarter_1'   THEN v_session.kickoff_at + INTERVAL '30 minutes'
      WHEN 'quarter_2'   THEN v_session.kickoff_at + INTERVAL '65 minutes'
      WHEN 'quarter_3'   THEN v_session.kickoff_at + INTERVAL '100 minutes'
      WHEN 'quarter_4'   THEN v_session.kickoff_at + INTERVAL '135 minutes'
      ELSE v_session.kickoff_at + INTERVAL '130 minutes'
    END;
  END IF;

  UPDATE br_sessions SET
    status               = 'active',
    current_question_seq = 1,
    last_processed_seq   = 0,
    started_at           = NOW(),
    segment_ends_at      = v_segment_ends,
    updated_at           = NOW()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'status',         'active',
    'segment_ends_at', v_segment_ends
  );
END;
$$;

GRANT EXECUTE ON FUNCTION instantiate_br_session(UUID)
  TO authenticated, service_role;


-- ── 2. finalize_br_session (internal) ────────────────────────────────────────
-- Called by advance_br_session_round (single survivor) and by the resolver
-- cron (segment end). Must be idempotent — both can fire near-simultaneously.

CREATE OR REPLACE FUNCTION finalize_br_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session        RECORD;
  v_winner_uid     UUID;
  v_rank           INTEGER;
  v_elim_rank      INTEGER;
  v_player_count   INTEGER;
  r                RECORD;
BEGIN
  -- ── Idempotency guard ────────────────────────────────────────────────────
  SELECT * INTO v_session FROM br_sessions WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_session.status = 'completed' OR v_session.status = 'cancelled' THEN
    RETURN;  -- already finalised; safe no-op
  END IF;

  -- ── Compute avg_response_ms for each player ──────────────────────────────
  -- Use player_answers.created_at (answer submission time) minus
  -- questions.visible_from (question appearance time) as latency proxy.
  -- Only counts questions where an answer was submitted (not timeouts).
  UPDATE br_session_players bsp
  SET avg_response_ms = sub.avg_ms
  FROM (
    SELECT
      pa.user_id,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (pa.created_at - q.visible_from)) * 1000
      ))::INTEGER AS avg_ms
    FROM player_answers pa
    JOIN questions q ON q.id = pa.question_id
    WHERE q.br_session_id = p_session_id
      AND pa.created_at   > q.visible_from  -- exclude pre-window submissions
    GROUP BY pa.user_id
  ) sub
  WHERE bsp.session_id = p_session_id
    AND bsp.user_id    = sub.user_id;

  -- ── Rank surviving players ───────────────────────────────────────────────
  -- Tiebreaker chain: HP desc → correct_answer_count desc → avg_response_ms asc
  -- (nulls last on avg_response_ms) → current_streak desc (v1 fallback)
  v_rank := 1;
  FOR r IN
    SELECT user_id
    FROM br_session_players
    WHERE session_id    = p_session_id
      AND is_eliminated = false
    ORDER BY
      hp                   DESC,
      correct_answer_count DESC,
      avg_response_ms      ASC NULLS LAST,
      current_streak       DESC
  LOOP
    UPDATE br_session_players SET placement = v_rank
    WHERE session_id = p_session_id AND user_id = r.user_id;

    -- Capture winner (placement 1)
    IF v_rank = 1 THEN
      v_winner_uid := r.user_id;
    END IF;

    v_rank := v_rank + 1;
  END LOOP;

  -- ── Rank eliminated players ──────────────────────────────────────────────
  -- Continuing rank from where survivors left off.
  -- Eliminated players with NULL placement (gap fill from concurrent calls).
  -- Order: later elimination = better rank (eliminated_at_seq desc),
  --        then hp_at_elimination desc within same round.
  FOR r IN
    SELECT user_id
    FROM br_session_players
    WHERE session_id    = p_session_id
      AND is_eliminated = true
      AND placement     IS NULL
    ORDER BY
      eliminated_at_seq  DESC NULLS LAST,
      hp_at_elimination  DESC NULLS LAST
  LOOP
    UPDATE br_session_players SET placement = v_rank
    WHERE session_id = p_session_id AND user_id = r.user_id;

    v_rank := v_rank + 1;
  END LOOP;

  -- ── Mark session completed ───────────────────────────────────────────────
  UPDATE br_sessions SET
    status         = 'completed',
    winner_user_id = v_winner_uid,
    completed_at   = NOW(),
    updated_at     = NOW()
  WHERE id = p_session_id;

  -- ── Trigger ELO update for ranked sessions ───────────────────────────────
  -- Minimum 4 players with placements required for ELO to apply.
  SELECT COUNT(*) INTO v_player_count
  FROM br_session_players
  WHERE session_id = p_session_id AND placement IS NOT NULL;

  IF v_session.rating_mode = 'ranked' AND v_player_count >= 4 THEN
    PERFORM update_br_ratings(p_session_id);
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION finalize_br_session(UUID)
  TO service_role;


-- ── 3. advance_br_session_round ───────────────────────────────────────────────
-- Called by the resolver after each BR_MATCH_LIVE question resolves (or is voided).
--
-- Key changes from v1:
--   - No pool question fetch. Damage/reward are fixed constants in v1.
--   - No v_is_last_question check. Session end is segment-driven (external).
--   - Writes correct_answer_count, hp_at_elimination, eliminated_at_seq.
--   - Session terminates only when ≤1 survivor remains.

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
  -- v1 fixed constants — no variable damage
  V1_WRONG_DAMAGE    CONSTANT INTEGER := -15;
  V1_CORRECT_REWARD  CONSTANT INTEGER :=  0;
  STREAK_BONUS_2     CONSTANT INTEGER :=  5;
  STREAK_BONUS_3PLUS CONSTANT INTEGER := 10;
  HP_CAP             CONSTANT INTEGER := 150;

  v_session          RECORD;
  v_player           RECORD;
  v_answer           RECORD;
  v_hp_delta         INTEGER;
  v_new_hp           INTEGER;
  v_new_streak       INTEGER;
  v_was_eliminated   BOOLEAN;
  v_survivors        INTEGER;
  v_next_placement   INTEGER;
  v_newly_eliminated INTEGER := 0;
  v_question_id      UUID;
BEGIN

  -- ── Guard 1: session must exist and be active ─────────────────────────────
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

  -- ── Guard 2: idempotency — already processed this seq ────────────────────
  IF v_session.last_processed_seq >= p_question_seq THEN
    RETURN jsonb_build_object(
      'ok',                  false,
      'reason',              'already_processed',
      'last_processed_seq',  v_session.last_processed_seq
    );
  END IF;

  -- ── Fetch the questions row for this round ────────────────────────────────
  -- Questions are written directly to the questions table by the generator
  -- with br_session_id set. Sequence is positional (OFFSET p_question_seq - 1).
  SELECT id INTO v_question_id
  FROM questions
  WHERE br_session_id = p_session_id
    AND question_type = 'BR_MATCH_LIVE'
  ORDER BY created_at ASC
  OFFSET (p_question_seq - 1)
  LIMIT 1;

  -- ── Void path: no HP change, no streak reset ──────────────────────────────
  IF p_is_voided THEN
    UPDATE br_sessions SET
      last_processed_seq   = p_question_seq,
      current_question_seq = p_question_seq + 1,
      updated_at           = NOW()
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'ok',               true,
      'voided',           true,
      'question_seq',     p_question_seq,
      'next_seq',         p_question_seq + 1
    );
  END IF;

  -- ── Process each active (non-eliminated) player ───────────────────────────
  FOR v_player IN
    SELECT * FROM br_session_players
    WHERE session_id    = p_session_id
      AND is_eliminated = false
  LOOP
    -- Fetch answer (NULL = no answer submitted = treated as wrong)
    SELECT pa.is_correct INTO v_answer
    FROM player_answers pa
    WHERE pa.question_id = v_question_id
      AND pa.user_id     = v_player.user_id
    LIMIT 1;

    v_new_streak := v_player.current_streak;

    IF v_answer IS NULL OR NOT v_answer.is_correct THEN
      -- Wrong answer or no answer
      v_hp_delta   := V1_WRONG_DAMAGE;
      v_new_streak := 0;

    ELSE
      -- Correct answer
      v_hp_delta   := V1_CORRECT_REWARD;  -- base: 0
      v_new_streak := v_new_streak + 1;

      -- Streak HP bonus (applied on top of base reward)
      IF v_new_streak >= 3 THEN
        v_hp_delta := v_hp_delta + STREAK_BONUS_3PLUS;
      ELSIF v_new_streak = 2 THEN
        v_hp_delta := v_hp_delta + STREAK_BONUS_2;
      END IF;
    END IF;

    -- Apply HP delta: clamp between 0 and HP_CAP
    v_new_hp       := GREATEST(0, LEAST(HP_CAP, v_player.hp + v_hp_delta));
    v_was_eliminated := (v_new_hp = 0);

    UPDATE br_session_players SET
      hp                   = v_new_hp,
      current_streak       = v_new_streak,
      correct_answer_count = CASE
        WHEN v_answer.is_correct IS TRUE THEN correct_answer_count + 1
        ELSE correct_answer_count
      END,
      is_eliminated        = v_was_eliminated,
      eliminated_at        = CASE WHEN v_was_eliminated THEN NOW() ELSE eliminated_at END,
      eliminated_at_seq    = CASE WHEN v_was_eliminated THEN p_question_seq ELSE eliminated_at_seq END,
      hp_at_elimination    = CASE WHEN v_was_eliminated THEN v_new_hp ELSE hp_at_elimination END
    WHERE session_id = p_session_id
      AND user_id    = v_player.user_id;

    IF v_was_eliminated THEN
      v_newly_eliminated := v_newly_eliminated + 1;
    END IF;

  END LOOP;

  -- ── Count survivors and assign placements to newly eliminated players ─────
  SELECT COUNT(*) INTO v_survivors
  FROM br_session_players
  WHERE session_id    = p_session_id
    AND is_eliminated = false;

  IF v_newly_eliminated > 0 THEN
    -- All players eliminated in the same round receive the same placement.
    -- Example: 6 players, 2 survive → newly eliminated get placement 3.
    v_next_placement := v_survivors + 1;

    UPDATE br_session_players SET
      placement = v_next_placement
    WHERE session_id    = p_session_id
      AND is_eliminated = true
      AND placement     IS NULL;
  END IF;

  -- ── Advance the sequence counter ──────────────────────────────────────────
  -- Note: session_over is checked below. If over, seq stays — finalize handles it.
  UPDATE br_sessions SET
    last_processed_seq   = p_question_seq,
    current_question_seq = CASE
      WHEN v_survivors <= 1 THEN current_question_seq  -- freeze if ending
      ELSE p_question_seq + 1
    END,
    updated_at           = NOW()
  WHERE id = p_session_id;

  -- ── Check session-over: single survivor wins immediately ─────────────────
  -- Segment-end is handled externally by the resolver cron.
  IF v_survivors <= 1 THEN
    PERFORM finalize_br_session(p_session_id);

    RETURN jsonb_build_object(
      'ok',               true,
      'session_complete', true,
      'reason',           'last_survivor',
      'survivors',        v_survivors,
      'newly_eliminated', v_newly_eliminated
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
