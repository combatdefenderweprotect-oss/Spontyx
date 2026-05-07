-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 079 — Trivia rooms, duel queue, finalize_duel RPC
-- Tables:   trivia_rooms, trivia_duel_queue
-- Alters:   trivia_sessions (best_streak_in_session column + room_id FK)
-- Updates:  complete_trivia_session (store streak, skip stats for ranked)
-- RPC:      finalize_duel()
-- Depends:  076 (trivia_questions), 077/077a (trivia_sessions, RPCs), 078 (ratings)
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_rooms
-- One row per Ranked Duel match. Created by the matchmaker (future pairing RPC).
-- player1/player2 assignment is arbitrary (first/second in queue).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trivia_rooms (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Question scope
  sport                 TEXT        NOT NULL
                        CHECK (sport IN ('soccer','nfl','nba','mlb','college_football','f1','tennis','mma')),
  event                 TEXT        CHECK (event IS NULL OR event IN ('world_cup_2026')),
  question_set_id       UUID        REFERENCES public.trivia_question_sets ON DELETE SET NULL,
  question_ids          UUID[]      NOT NULL DEFAULT '{}',   -- ordered, populated by matchmaker

  -- Ranked duel is always 10 questions / 15s timer (enforced by config)
  total_rounds          INT         NOT NULL DEFAULT 10 CHECK (total_rounds > 0),
  timer_seconds         INT         NOT NULL DEFAULT 15 CHECK (timer_seconds > 0),

  -- Players
  player1_id            UUID        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  player2_id            UUID        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  CONSTRAINT tr_different_players CHECK (player1_id <> player2_id),

  -- Session linkage (nullable until each player starts their session)
  player1_session_id    UUID,       -- FK added below after trivia_sessions exists
  player2_session_id    UUID,       -- FK added below

  -- Room lifecycle
  status                TEXT        NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting','active','completed','abandoned')),

  -- Result (set by finalize_duel)
  winner_id             UUID        REFERENCES auth.users ON DELETE SET NULL,
  is_draw               BOOLEAN     NOT NULL DEFAULT FALSE,
  finalized_at          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK back to trivia_sessions (table already exists from mig 077)
ALTER TABLE public.trivia_rooms
  ADD CONSTRAINT fk_tr_p1_session
  FOREIGN KEY (player1_session_id) REFERENCES public.trivia_sessions (id) ON DELETE SET NULL;

ALTER TABLE public.trivia_rooms
  ADD CONSTRAINT fk_tr_p2_session
  FOREIGN KEY (player2_session_id) REFERENCES public.trivia_sessions (id) ON DELETE SET NULL;

-- ── Indexes: trivia_rooms ────────────────────────────────────────────────────

-- Active room lookup by player (join screen, reconnect)
CREATE INDEX IF NOT EXISTS idx_tr_player1
  ON public.trivia_rooms (player1_id, created_at DESC)
  WHERE status IN ('waiting','active');

CREATE INDEX IF NOT EXISTS idx_tr_player2
  ON public.trivia_rooms (player2_id, created_at DESC)
  WHERE status IN ('waiting','active');

-- ── RLS: trivia_rooms ────────────────────────────────────────────────────────
ALTER TABLE public.trivia_rooms ENABLE ROW LEVEL SECURITY;

-- Both players can read their own room
CREATE POLICY tr_select_participant ON public.trivia_rooms
  FOR SELECT
  USING (player1_id = auth.uid() OR player2_id = auth.uid());

-- No INSERT/UPDATE policies — matchmaker and finalize_duel use SECURITY DEFINER.


-- ─────────────────────────────────────────────────────────────────────────────
-- Patch trivia_sessions
-- 1. Add best_streak_in_session column so finalize_duel can read it.
-- 2. Wire deferred room_id FK (column exists from mig 077, FK was deferred).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.trivia_sessions
  ADD COLUMN IF NOT EXISTS best_streak_in_session INT NOT NULL DEFAULT 0
    CHECK (best_streak_in_session >= 0);

ALTER TABLE public.trivia_sessions
  ADD CONSTRAINT fk_ts_room_id
  FOREIGN KEY (room_id) REFERENCES public.trivia_rooms (id) ON DELETE SET NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_duel_queue
-- One active entry per player. Status transitions: waiting → matched/cancelled/expired.
-- Matchmaker (future pair_trivia_queue RPC) reads waiting rows and pairs them.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trivia_duel_queue (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id           UUID        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  sport             TEXT        NOT NULL
                    CHECK (sport IN ('soccer','nfl','nba','mlb','college_football','f1','tennis','mma')),
  event             TEXT        CHECK (event IS NULL OR event IN ('world_cup_2026')),

  -- Rating snapshot at queue join time — used by matchmaker for ELO-balanced pairing
  rating_snapshot   INT         NOT NULL DEFAULT 800 CHECK (rating_snapshot >= 0),

  status            TEXT        NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting','matched','cancelled','expired')),
  matched_room_id   UUID        REFERENCES public.trivia_rooms ON DELETE SET NULL,

  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active queue entry per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdq_user_waiting
  ON public.trivia_duel_queue (user_id)
  WHERE status = 'waiting';

-- Matchmaker scan index: sport + waiting + expiry
CREATE INDEX IF NOT EXISTS idx_tdq_waiting
  ON public.trivia_duel_queue (sport, rating_snapshot)
  WHERE status = 'waiting';

-- ── RLS: trivia_duel_queue ───────────────────────────────────────────────────
ALTER TABLE public.trivia_duel_queue ENABLE ROW LEVEL SECURITY;

-- Users read only their own queue entry
CREATE POLICY tdq_select_own ON public.trivia_duel_queue
  FOR SELECT USING (user_id = auth.uid());

-- Users can insert their own entry (matchmaker validates uniqueness via partial index)
CREATE POLICY tdq_insert_own ON public.trivia_duel_queue
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can cancel their own waiting entry only
CREATE POLICY tdq_cancel_own ON public.trivia_duel_queue
  FOR UPDATE
  USING (user_id = auth.uid() AND status = 'waiting')
  WITH CHECK (status = 'cancelled');


-- ─────────────────────────────────────────────────────────────────────────────
-- Update complete_trivia_session
-- Changes vs 077a:
--   1. Stores p_best_streak in best_streak_in_session column.
--   2. Skips upsert_trivia_player_stats_after_session for ranked sessions —
--      finalize_duel handles stats for both players atomically.
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
  v_session  public.trivia_sessions%ROWTYPE;
  v_stats    JSONB;
BEGIN
  SELECT * INTO v_session FROM public.trivia_sessions WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;
  IF v_session.user_id <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;
  IF v_session.completed THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_completed');
  END IF;

  UPDATE public.trivia_sessions SET
    correct_count           = p_correct_count,
    wrong_count             = p_wrong_count,
    total_xp_earned         = p_total_xp_earned,
    accuracy                = p_accuracy,
    stars                   = p_stars,
    avg_response_ms         = p_avg_response_ms,
    duration_seconds        = p_duration_seconds,
    xp_source_breakdown     = p_xp_breakdown,
    best_streak_in_session  = GREATEST(0, COALESCE(p_best_streak, 0)),
    -- ranked sessions get result_status from finalize_duel, not 'completed'
    result_status           = CASE WHEN v_session.is_ranked THEN 'abandoned' ELSE 'completed' END,
    completed               = TRUE
  WHERE id = p_session_id;

  -- Ranked duel: stats are handled atomically by finalize_duel after both
  -- players complete. Skip here to avoid double-counting.
  IF v_session.is_ranked THEN
    RETURN jsonb_build_object('ok', true, 'ranked', true);
  END IF;

  v_stats := public.upsert_trivia_player_stats_after_session(
    v_session.user_id, p_mode,
    p_correct_count, p_wrong_count, p_total_xp_earned,
    p_accuracy, p_perfect_game, p_best_streak
  );

  RETURN jsonb_build_object('ok', true, 'stats', v_stats);

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- finalize_duel(p_room_id UUID) → JSONB
--
-- Called by either player after they complete their session.
-- Returns 'waiting_for_opponent' if the other player hasn't finished yet.
-- On first call that sees both complete: determines winner, applies Elo to all
-- three rating tables, updates both sessions' result_status + rating_delta,
-- inlines stats upsert for both players (bypasses auth check in the public RPC).
-- Idempotent: safe to call multiple times.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_duel(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room       public.trivia_rooms%ROWTYPE;
  v_sess1      public.trivia_sessions%ROWTYPE;
  v_sess2      public.trivia_sessions%ROWTYPE;

  -- Global ratings
  v_rating1    INT;  v_rating2   INT;
  v_duels1     INT;  v_duels2    INT;
  v_k1         INT;  v_k2        INT;
  v_expected1  NUMERIC;
  v_actual1    NUMERIC;  v_actual2   NUMERIC;
  v_delta1     INT;  v_delta2    INT;
  v_new_r1     INT;  v_new_r2    INT;

  -- Result state
  v_winner_id  UUID;
  v_is_draw    BOOLEAN := FALSE;
  v_result1    TEXT;   v_result2   TEXT;
BEGIN

  -- ── Load and validate room ────────────────────────────────────────────────
  SELECT * INTO v_room FROM public.trivia_rooms WHERE id = p_room_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_not_found');
  END IF;

  IF auth.uid() IS NULL
     OR (auth.uid() <> v_room.player1_id AND auth.uid() <> v_room.player2_id)
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  -- Idempotency guard
  IF v_room.status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'reason', 'already_finalized',
      'winner_id', v_room.winner_id, 'is_draw', v_room.is_draw
    );
  END IF;

  IF v_room.status = 'abandoned' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_abandoned');
  END IF;

  -- ── Check session readiness ───────────────────────────────────────────────
  IF v_room.player1_session_id IS NULL OR v_room.player2_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 'waiting_for_opponent');
  END IF;

  SELECT * INTO v_sess1
    FROM public.trivia_sessions WHERE id = v_room.player1_session_id;
  IF NOT FOUND OR NOT v_sess1.completed THEN
    RETURN jsonb_build_object('ok', true, 'status', 'waiting_for_opponent');
  END IF;

  SELECT * INTO v_sess2
    FROM public.trivia_sessions WHERE id = v_room.player2_session_id;
  IF NOT FOUND OR NOT v_sess2.completed THEN
    RETURN jsonb_build_object('ok', true, 'status', 'waiting_for_opponent');
  END IF;

  -- ── Determine winner ──────────────────────────────────────────────────────
  -- Primary: correct_count. Tiebreak: avg_response_ms (lower wins). Else: draw.
  IF v_sess1.correct_count > v_sess2.correct_count THEN
    v_winner_id := v_room.player1_id;
    v_result1 := 'win';   v_result2 := 'loss';
    v_actual1 := 1.0;     v_actual2 := 0.0;

  ELSIF v_sess2.correct_count > v_sess1.correct_count THEN
    v_winner_id := v_room.player2_id;
    v_result1 := 'loss';  v_result2 := 'win';
    v_actual1 := 0.0;     v_actual2 := 1.0;

  ELSE
    -- Tied — tiebreak by response time
    IF v_sess1.avg_response_ms IS NOT NULL
       AND v_sess2.avg_response_ms IS NOT NULL
       AND v_sess1.avg_response_ms <> v_sess2.avg_response_ms
    THEN
      IF v_sess1.avg_response_ms < v_sess2.avg_response_ms THEN
        v_winner_id := v_room.player1_id;
        v_result1 := 'win';   v_result2 := 'loss';
        v_actual1 := 1.0;     v_actual2 := 0.0;
      ELSE
        v_winner_id := v_room.player2_id;
        v_result1 := 'loss';  v_result2 := 'win';
        v_actual1 := 0.0;     v_actual2 := 1.0;
      END IF;
    ELSE
      -- True draw
      v_is_draw   := TRUE;
      v_winner_id := NULL;
      v_result1   := 'draw';  v_result2   := 'draw';
      v_actual1   := 0.5;     v_actual2   := 0.5;
    END IF;
  END IF;

  -- ── Init global rating rows if missing ────────────────────────────────────
  INSERT INTO public.trivia_player_ratings (user_id)
    VALUES (v_room.player1_id), (v_room.player2_id)
    ON CONFLICT (user_id) DO NOTHING;

  SELECT rating, ranked_duels
    INTO v_rating1, v_duels1
    FROM public.trivia_player_ratings WHERE user_id = v_room.player1_id;

  SELECT rating, ranked_duels
    INTO v_rating2, v_duels2
    FROM public.trivia_player_ratings WHERE user_id = v_room.player2_id;

  -- ── K-factor (ladder: <20 → 40, 20–49 → 30, 50+ → 20) ───────────────────
  v_k1 := CASE WHEN v_duels1 < 20 THEN 40 WHEN v_duels1 < 50 THEN 30 ELSE 20 END;
  v_k2 := CASE WHEN v_duels2 < 20 THEN 40 WHEN v_duels2 < 50 THEN 30 ELSE 20 END;

  -- ── Elo formula ───────────────────────────────────────────────────────────
  v_expected1 := 1.0 / (1.0 + power(10.0, (v_rating2 - v_rating1)::NUMERIC / 400.0));

  v_delta1    := ROUND(v_k1 * (v_actual1 - v_expected1))::INT;
  v_delta2    := ROUND(v_k2 * (v_actual2 - (1.0 - v_expected1)))::INT;

  -- Floor: rating cannot drop below 400
  v_new_r1    := GREATEST(400, v_rating1 + v_delta1);
  v_new_r2    := GREATEST(400, v_rating2 + v_delta2);

  -- Recalculate delta to reflect floor clamping (for accurate session record)
  v_delta1    := v_new_r1 - v_rating1;
  v_delta2    := v_new_r2 - v_rating2;

  -- ── Update global ratings ─────────────────────────────────────────────────
  UPDATE public.trivia_player_ratings SET
    rating       = v_new_r1,
    peak_rating  = GREATEST(peak_rating, v_new_r1),
    ranked_duels = ranked_duels + 1,
    wins   = wins   + CASE WHEN v_result1 = 'win'  THEN 1 ELSE 0 END,
    losses = losses + CASE WHEN v_result1 = 'loss' THEN 1 ELSE 0 END,
    draws  = draws  + CASE WHEN v_result1 = 'draw' THEN 1 ELSE 0 END
  WHERE user_id = v_room.player1_id;

  UPDATE public.trivia_player_ratings SET
    rating       = v_new_r2,
    peak_rating  = GREATEST(peak_rating, v_new_r2),
    ranked_duels = ranked_duels + 1,
    wins   = wins   + CASE WHEN v_result2 = 'win'  THEN 1 ELSE 0 END,
    losses = losses + CASE WHEN v_result2 = 'loss' THEN 1 ELSE 0 END,
    draws  = draws  + CASE WHEN v_result2 = 'draw' THEN 1 ELSE 0 END
  WHERE user_id = v_room.player2_id;

  -- ── Init and update sport ratings ─────────────────────────────────────────
  INSERT INTO public.trivia_sport_ratings (user_id, sport)
    VALUES (v_room.player1_id, v_room.sport),
           (v_room.player2_id, v_room.sport)
    ON CONFLICT (user_id, sport) DO NOTHING;

  -- Sport deltas mirror global deltas (same game, same skill delta)
  UPDATE public.trivia_sport_ratings SET
    rating       = GREATEST(400, rating + v_delta1),
    peak_rating  = GREATEST(peak_rating, GREATEST(400, rating + v_delta1)),
    ranked_duels = ranked_duels + 1,
    wins   = wins   + CASE WHEN v_result1 = 'win'  THEN 1 ELSE 0 END,
    losses = losses + CASE WHEN v_result1 = 'loss' THEN 1 ELSE 0 END,
    draws  = draws  + CASE WHEN v_result1 = 'draw' THEN 1 ELSE 0 END
  WHERE user_id = v_room.player1_id AND sport = v_room.sport;

  UPDATE public.trivia_sport_ratings SET
    rating       = GREATEST(400, rating + v_delta2),
    peak_rating  = GREATEST(peak_rating, GREATEST(400, rating + v_delta2)),
    ranked_duels = ranked_duels + 1,
    wins   = wins   + CASE WHEN v_result2 = 'win'  THEN 1 ELSE 0 END,
    losses = losses + CASE WHEN v_result2 = 'loss' THEN 1 ELSE 0 END,
    draws  = draws  + CASE WHEN v_result2 = 'draw' THEN 1 ELSE 0 END
  WHERE user_id = v_room.player2_id AND sport = v_room.sport;

  -- ── Event ratings (only if room has an event tag) ─────────────────────────
  IF v_room.event IS NOT NULL THEN
    INSERT INTO public.trivia_event_ratings (user_id, event)
      VALUES (v_room.player1_id, v_room.event),
             (v_room.player2_id, v_room.event)
      ON CONFLICT (user_id, event) DO NOTHING;

    UPDATE public.trivia_event_ratings SET
      rating       = GREATEST(400, rating + v_delta1),
      peak_rating  = GREATEST(peak_rating, GREATEST(400, rating + v_delta1)),
      ranked_duels = ranked_duels + 1,
      wins   = wins   + CASE WHEN v_result1 = 'win'  THEN 1 ELSE 0 END,
      losses = losses + CASE WHEN v_result1 = 'loss' THEN 1 ELSE 0 END,
      draws  = draws  + CASE WHEN v_result1 = 'draw' THEN 1 ELSE 0 END
    WHERE user_id = v_room.player1_id AND event = v_room.event;

    UPDATE public.trivia_event_ratings SET
      rating       = GREATEST(400, rating + v_delta2),
      peak_rating  = GREATEST(peak_rating, GREATEST(400, rating + v_delta2)),
      ranked_duels = ranked_duels + 1,
      wins   = wins   + CASE WHEN v_result2 = 'win'  THEN 1 ELSE 0 END,
      losses = losses + CASE WHEN v_result2 = 'loss' THEN 1 ELSE 0 END,
      draws  = draws  + CASE WHEN v_result2 = 'draw' THEN 1 ELSE 0 END
    WHERE user_id = v_room.player2_id AND event = v_room.event;
  END IF;

  -- ── Update both trivia_sessions ───────────────────────────────────────────
  UPDATE public.trivia_sessions SET
    result_status   = v_result1,
    rating_delta    = v_delta1,
    pre_game_rating = v_rating1
  WHERE id = v_room.player1_session_id;

  UPDATE public.trivia_sessions SET
    result_status   = v_result2,
    rating_delta    = v_delta2,
    pre_game_rating = v_rating2
  WHERE id = v_room.player2_session_id;

  -- ── Upsert trivia_player_stats for both players ───────────────────────────
  -- Inlined to bypass the auth.uid() check in the public RPC wrapper.
  -- finalize_duel is already SECURITY DEFINER with ownership verified above.

  INSERT INTO public.trivia_player_stats (
    user_id, xp_total, xp_this_week, games_played, games_duel,
    correct_total, wrong_total, best_single_game_score, best_accuracy,
    perfect_games, best_in_session_streak, last_played_at
  ) VALUES (
    v_room.player1_id,
    GREATEST(0, v_sess1.total_xp_earned), GREATEST(0, v_sess1.total_xp_earned),
    1, 1,
    GREATEST(0, v_sess1.correct_count), GREATEST(0, v_sess1.wrong_count),
    GREATEST(0, v_sess1.total_xp_earned), v_sess1.accuracy,
    CASE WHEN v_sess1.wrong_count = 0 AND v_sess1.correct_count > 0 THEN 1 ELSE 0 END,
    GREATEST(0, v_sess1.best_streak_in_session),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    xp_total               = trivia_player_stats.xp_total
                             + GREATEST(0, v_sess1.total_xp_earned),
    xp_this_week           = trivia_player_stats.xp_this_week
                             + GREATEST(0, v_sess1.total_xp_earned),
    games_played           = trivia_player_stats.games_played + 1,
    games_duel             = trivia_player_stats.games_duel + 1,
    correct_total          = trivia_player_stats.correct_total
                             + GREATEST(0, v_sess1.correct_count),
    wrong_total            = trivia_player_stats.wrong_total
                             + GREATEST(0, v_sess1.wrong_count),
    best_single_game_score = GREATEST(trivia_player_stats.best_single_game_score,
                             GREATEST(0, v_sess1.total_xp_earned)),
    best_accuracy          = GREATEST(COALESCE(trivia_player_stats.best_accuracy, 0),
                             COALESCE(v_sess1.accuracy, 0)),
    perfect_games          = trivia_player_stats.perfect_games
                             + CASE WHEN v_sess1.wrong_count = 0
                                     AND v_sess1.correct_count > 0 THEN 1 ELSE 0 END,
    best_in_session_streak = GREATEST(trivia_player_stats.best_in_session_streak,
                             GREATEST(0, v_sess1.best_streak_in_session)),
    last_played_at         = NOW();

  INSERT INTO public.trivia_player_stats (
    user_id, xp_total, xp_this_week, games_played, games_duel,
    correct_total, wrong_total, best_single_game_score, best_accuracy,
    perfect_games, best_in_session_streak, last_played_at
  ) VALUES (
    v_room.player2_id,
    GREATEST(0, v_sess2.total_xp_earned), GREATEST(0, v_sess2.total_xp_earned),
    1, 1,
    GREATEST(0, v_sess2.correct_count), GREATEST(0, v_sess2.wrong_count),
    GREATEST(0, v_sess2.total_xp_earned), v_sess2.accuracy,
    CASE WHEN v_sess2.wrong_count = 0 AND v_sess2.correct_count > 0 THEN 1 ELSE 0 END,
    GREATEST(0, v_sess2.best_streak_in_session),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    xp_total               = trivia_player_stats.xp_total
                             + GREATEST(0, v_sess2.total_xp_earned),
    xp_this_week           = trivia_player_stats.xp_this_week
                             + GREATEST(0, v_sess2.total_xp_earned),
    games_played           = trivia_player_stats.games_played + 1,
    games_duel             = trivia_player_stats.games_duel + 1,
    correct_total          = trivia_player_stats.correct_total
                             + GREATEST(0, v_sess2.correct_count),
    wrong_total            = trivia_player_stats.wrong_total
                             + GREATEST(0, v_sess2.wrong_count),
    best_single_game_score = GREATEST(trivia_player_stats.best_single_game_score,
                             GREATEST(0, v_sess2.total_xp_earned)),
    best_accuracy          = GREATEST(COALESCE(trivia_player_stats.best_accuracy, 0),
                             COALESCE(v_sess2.accuracy, 0)),
    perfect_games          = trivia_player_stats.perfect_games
                             + CASE WHEN v_sess2.wrong_count = 0
                                     AND v_sess2.correct_count > 0 THEN 1 ELSE 0 END,
    best_in_session_streak = GREATEST(trivia_player_stats.best_in_session_streak,
                             GREATEST(0, v_sess2.best_streak_in_session)),
    last_played_at         = NOW();

  -- ── Mark room completed ───────────────────────────────────────────────────
  UPDATE public.trivia_rooms SET
    status       = 'completed',
    winner_id    = v_winner_id,
    is_draw      = v_is_draw,
    finalized_at = NOW()
  WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'winner_id',   v_winner_id,
    'is_draw',     v_is_draw,
    'result_p1',   v_result1,
    'result_p2',   v_result2,
    'delta_p1',    v_delta1,
    'delta_p2',    v_delta2,
    'new_rating_p1', v_new_r1,
    'new_rating_p2', v_new_r2
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
