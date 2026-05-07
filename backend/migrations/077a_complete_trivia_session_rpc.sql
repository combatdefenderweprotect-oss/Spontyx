-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 077a — complete_trivia_session RPC
-- Atomically marks a session completed and upserts player stats.
-- SECURITY DEFINER so it can UPDATE trivia_sessions (no user UPDATE policy).
-- Depends: migration 077 (trivia_sessions, upsert_trivia_player_stats_after_session)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_trivia_session(
  p_session_id        UUID,
  p_correct_count     INT,
  p_wrong_count       INT,
  p_total_xp_earned   INT,
  p_accuracy          NUMERIC,
  p_stars             INT,
  p_avg_response_ms   INT,
  p_duration_seconds  INT,
  p_xp_breakdown      JSONB,
  p_best_streak       INT,
  p_perfect_game      BOOLEAN,
  p_mode              TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session     public.trivia_sessions%ROWTYPE;
  v_stats       JSONB;
BEGIN
  -- ── Ownership + state guard ──────────────────────────────────────────────
  SELECT * INTO v_session FROM public.trivia_sessions WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF v_session.user_id <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  IF v_session.completed THEN
    -- Idempotent: return ok without re-applying stats
    RETURN jsonb_build_object('ok', true, 'reason', 'already_completed');
  END IF;

  -- ── Update session ────────────────────────────────────────────────────────
  UPDATE public.trivia_sessions SET
    correct_count       = p_correct_count,
    wrong_count         = p_wrong_count,
    total_xp_earned     = p_total_xp_earned,
    accuracy            = p_accuracy,
    stars               = p_stars,
    avg_response_ms     = p_avg_response_ms,
    duration_seconds    = p_duration_seconds,
    xp_source_breakdown = p_xp_breakdown,
    result_status       = 'completed',
    completed           = TRUE
  WHERE id = p_session_id;

  -- ── Upsert player stats ───────────────────────────────────────────────────
  v_stats := public.upsert_trivia_player_stats_after_session(
    v_session.user_id,
    p_mode,
    p_correct_count,
    p_wrong_count,
    p_total_xp_earned,
    p_accuracy,
    p_perfect_game,
    p_best_streak
  );

  RETURN jsonb_build_object(
    'ok',    true,
    'stats', v_stats
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
