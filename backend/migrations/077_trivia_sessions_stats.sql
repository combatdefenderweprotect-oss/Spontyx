-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 077 — Trivia session persistence and player stats
-- Tables:  trivia_sessions, trivia_session_answers, trivia_player_stats
-- RPC:     upsert_trivia_player_stats_after_session()
-- Depends: migration 076 (trivia_questions, trivia_question_sets, set_updated_at)
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_sessions
-- One row per game played, all modes.
-- total_rounds and timer_seconds are stored at session creation so past
-- sessions remain historically accurate if config defaults change.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trivia_sessions (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Player
  user_id               UUID          NOT NULL REFERENCES auth.users ON DELETE CASCADE,

  -- Mode
  mode                  TEXT          NOT NULL
                        CHECK (mode IN ('solo','ranked_duel','friend_duel','party','event')),

  -- Question taxonomy (mirrors trivia_questions columns)
  sport                 TEXT          NOT NULL
                        CHECK (sport IN ('soccer','nfl','nba','mlb','college_football','f1','tennis','mma')),
  category              TEXT,
  event                 TEXT          CHECK (event IS NULL OR event IN ('world_cup_2026')),
  topic                 TEXT,                       -- display label chosen by user (e.g. "Green Bay Packers")

  -- Question set reference (nullable: AI custom games may build ephemeral sets)
  question_set_id       UUID          REFERENCES public.trivia_question_sets ON DELETE SET NULL,

  -- Game configuration — stored at session start, not derived from config at query time
  difficulty            TEXT          NOT NULL
                        CHECK (difficulty IN ('easy','medium','hard','mixed','adaptive','escalating')),
  total_rounds          INT           NOT NULL CHECK (total_rounds > 0),
  timer_seconds         INT           NOT NULL CHECK (timer_seconds > 0),
  is_ranked             BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Results
  correct_count         INT           NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count           INT           NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  base_xp_earned        INT           NOT NULL DEFAULT 0 CHECK (base_xp_earned >= 0),
  bonus_xp_earned       INT           NOT NULL DEFAULT 0 CHECK (bonus_xp_earned >= 0),
  total_xp_earned       INT           NOT NULL DEFAULT 0 CHECK (total_xp_earned >= 0),
  accuracy              NUMERIC(5,4)  CHECK (accuracy IS NULL OR accuracy BETWEEN 0 AND 1),
  stars                 INT           CHECK (stars IS NULL OR stars BETWEEN 0 AND 3),
  avg_response_ms       INT           CHECK (avg_response_ms IS NULL OR avg_response_ms >= 0),
  duration_seconds      INT           CHECK (duration_seconds IS NULL OR duration_seconds >= 0),

  -- Outcome
  -- Solo / Party / Event use:   'completed' or 'abandoned'
  -- Ranked / Friend Duel use:   'win', 'loss', 'draw' (set by finalize RPC in migration 080)
  result_status         TEXT          NOT NULL DEFAULT 'abandoned'
                        CHECK (result_status IN ('completed','abandoned','win','loss','draw')),

  -- Rating impact (solo/party/event = 0; ranked_duel = non-zero after finalize)
  rating_delta          INT           NOT NULL DEFAULT 0,
  pre_game_rating       INT,                         -- snapshot of global rating before game

  -- XP breakdown for results screen display and anti-farming audit
  -- e.g. {"base":80,"speed":12,"streak":8,"mode_mult":0.6,"perfect":0,"source_penalty":0,"daily_cap_applied":false}
  xp_source_breakdown   JSONB,

  -- Multiplayer linkage (null for solo)
  room_id               UUID,                        -- FK added in migration 080
  event_id              UUID,                        -- FK added in migration 081

  -- State
  completed             BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Indexes: trivia_sessions ─────────────────────────────────────────────────

-- Primary player history query (profile page, recent games widget)
CREATE INDEX IF NOT EXISTS idx_ts_user_created
  ON public.trivia_sessions (user_id, created_at DESC);

-- Mode-level analytics and leaderboard filtering
CREATE INDEX IF NOT EXISTS idx_ts_mode
  ON public.trivia_sessions (mode, created_at DESC)
  WHERE completed = TRUE;

-- Sport-level filtering (category leaderboards)
CREATE INDEX IF NOT EXISTS idx_ts_sport
  ON public.trivia_sessions (sport, created_at DESC)
  WHERE completed = TRUE;

-- Event-scoped session lookup (World Cup 2026 leaderboard, etc.)
CREATE INDEX IF NOT EXISTS idx_ts_event
  ON public.trivia_sessions (event, created_at DESC)
  WHERE event IS NOT NULL AND completed = TRUE;

-- Room linkage (used in migration 080 when rooms are wired)
CREATE INDEX IF NOT EXISTS idx_ts_room_id
  ON public.trivia_sessions (room_id)
  WHERE room_id IS NOT NULL;

-- ── RLS: trivia_sessions ─────────────────────────────────────────────────────

ALTER TABLE public.trivia_sessions ENABLE ROW LEVEL SECURITY;

-- Users read only their own sessions
CREATE POLICY ts_select_own ON public.trivia_sessions
  FOR SELECT
  USING (user_id = auth.uid());

-- Users insert only their own sessions
CREATE POLICY ts_insert_own ON public.trivia_sessions
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users may not update sessions directly (result_status, XP, rating_delta
-- for ranked duel are set by a SECURITY DEFINER RPC in migration 080)
-- No UPDATE policy = no direct user updates.


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_session_answers
-- One row per question per session.
-- Cascade-deletes when the parent session is deleted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trivia_session_answers (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  session_id        UUID          NOT NULL
                    REFERENCES public.trivia_sessions (id) ON DELETE CASCADE,

  question_id       UUID          NOT NULL
                    REFERENCES public.trivia_questions (id) ON DELETE RESTRICT,

  -- Position within the session (0-based)
  question_index    INT           NOT NULL CHECK (question_index >= 0),

  -- chosen_index NULL means the player timed out (no answer submitted)
  chosen_index      INT           CHECK (chosen_index IS NULL OR chosen_index BETWEEN 0 AND 3),
  is_correct        BOOLEAN,      -- NULL if timed out

  -- Timing (milliseconds)
  response_time_ms  INT           CHECK (response_time_ms IS NULL OR response_time_ms >= 0),

  -- XP components for this answer
  -- These are stored per-answer so the results screen can show breakdowns
  -- and the session-level xp_source_breakdown JSONB can be derived.
  base_xp           INT           NOT NULL DEFAULT 0,
  speed_multiplier  NUMERIC(4,2)  NOT NULL DEFAULT 1.0,
  streak_multiplier NUMERIC(4,2)  NOT NULL DEFAULT 1.0,
  source_multiplier NUMERIC(4,2)  NOT NULL DEFAULT 1.0,  -- 0.0 user/event q, 0.7 private AI, 1.0 approved
  final_xp_awarded  INT           NOT NULL DEFAULT 0,    -- floor(base × speed × streak × source)

  answered_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Each question position appears exactly once per session
  CONSTRAINT tsa_unique_position UNIQUE (session_id, question_index)
);

-- ── Indexes: trivia_session_answers ─────────────────────────────────────────

-- Primary lookup: all answers for a session
CREATE INDEX IF NOT EXISTS idx_tsa_session_id
  ON public.trivia_session_answers (session_id);

-- Question-level analytics (correct_rate updates, quality scoring)
CREATE INDEX IF NOT EXISTS idx_tsa_question_id
  ON public.trivia_session_answers (question_id);

-- ── RLS: trivia_session_answers ───────────────────────────────────────────────

ALTER TABLE public.trivia_session_answers ENABLE ROW LEVEL SECURITY;

-- Read answers only for own sessions (join-enforced via session ownership)
CREATE POLICY tsa_select_own ON public.trivia_session_answers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trivia_sessions ts
      WHERE ts.id = trivia_session_answers.session_id
        AND ts.user_id = auth.uid()
    )
  );

-- Insert answers only into own sessions
CREATE POLICY tsa_insert_own ON public.trivia_session_answers
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trivia_sessions ts
      WHERE ts.id = trivia_session_answers.session_id
        AND ts.user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_player_stats
-- One row per player. Aggregate lifetime stats.
-- Level is NOT stored here — computed from xp_total in TriviaConfig / store.
-- updated_at managed by trigger (set_updated_at from migration 076).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trivia_player_stats (
  user_id                 UUID          PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,

  -- XP
  xp_total                INT           NOT NULL DEFAULT 0 CHECK (xp_total >= 0),
  xp_this_week            INT           NOT NULL DEFAULT 0 CHECK (xp_this_week >= 0),
                          -- Reset every Monday 00:00 UTC by pg_cron (scheduled in migration 082)

  -- Game counts
  games_played            INT           NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  games_solo              INT           NOT NULL DEFAULT 0 CHECK (games_solo >= 0),
  games_duel              INT           NOT NULL DEFAULT 0 CHECK (games_duel >= 0),
                          -- counts both ranked_duel and friend_duel
  games_party             INT           NOT NULL DEFAULT 0 CHECK (games_party >= 0),
  games_event             INT           NOT NULL DEFAULT 0 CHECK (games_event >= 0),

  -- Answer totals
  correct_total           INT           NOT NULL DEFAULT 0 CHECK (correct_total >= 0),
  wrong_total             INT           NOT NULL DEFAULT 0 CHECK (wrong_total >= 0),

  -- Personal bests
  best_single_game_score  INT           NOT NULL DEFAULT 0 CHECK (best_single_game_score >= 0),
                          -- highest total_xp_earned in a single completed session
  best_accuracy           NUMERIC(5,4)  CHECK (best_accuracy IS NULL OR best_accuracy BETWEEN 0 AND 1),
                          -- highest accuracy in a completed session (NULL until first game)
  perfect_games           INT           NOT NULL DEFAULT 0 CHECK (perfect_games >= 0),
                          -- sessions with wrong_count = 0 and completed = true
  best_in_session_streak  INT           NOT NULL DEFAULT 0 CHECK (best_in_session_streak >= 0),
                          -- longest consecutive correct streak within a single session

  -- Activity
  last_played_at          TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- updated_at trigger (reuses set_updated_at() from migration 076)
DROP TRIGGER IF EXISTS trg_trivia_player_stats_updated_at ON public.trivia_player_stats;
CREATE TRIGGER trg_trivia_player_stats_updated_at
  BEFORE UPDATE ON public.trivia_player_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes: trivia_player_stats ─────────────────────────────────────────────

-- All-time leaderboard
CREATE INDEX IF NOT EXISTS idx_tps_xp_total
  ON public.trivia_player_stats (xp_total DESC);

-- Weekly leaderboard
CREATE INDEX IF NOT EXISTS idx_tps_xp_week
  ON public.trivia_player_stats (xp_this_week DESC);

-- ── RLS: trivia_player_stats ─────────────────────────────────────────────────

ALTER TABLE public.trivia_player_stats ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read all stats rows (leaderboard queries need this)
CREATE POLICY tps_select_public ON public.trivia_player_stats
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users insert only their own row (first game creates it via RPC)
CREATE POLICY tps_insert_own ON public.trivia_player_stats
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users update only their own row (direct update; RPC is the preferred path)
CREATE POLICY tps_update_own ON public.trivia_player_stats
  FOR UPDATE
  USING (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: upsert_trivia_player_stats_after_session
--
-- Called by the frontend immediately after a solo session is saved.
-- Atomically creates or updates the player's stats row.
-- SECURITY DEFINER so the UPSERT bypasses RLS row-creation edge cases,
-- but the function validates that the caller matches p_user_id.
--
-- Parameters:
--   p_user_id               UUID    — must match auth.uid()
--   p_mode                  TEXT    — 'solo','ranked_duel','friend_duel','party','event'
--   p_correct_count         INT
--   p_wrong_count           INT
--   p_total_xp_earned       INT
--   p_session_xp            INT     — total_xp_earned (same value, used for best_single_game_score)
--   p_accuracy              NUMERIC — 0.0–1.0
--   p_perfect_game          BOOLEAN — true if wrong_count = 0 and completed
--   p_best_in_session_streak INT    — longest streak within this session
--
-- Returns: JSONB { ok, xp_total, games_played }
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_trivia_player_stats_after_session(
  p_user_id                UUID,
  p_mode                   TEXT,
  p_correct_count          INT,
  p_wrong_count            INT,
  p_total_xp_earned        INT,
  p_accuracy               NUMERIC,
  p_perfect_game           BOOLEAN,
  p_best_in_session_streak INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.trivia_player_stats%ROWTYPE;
BEGIN
  -- ── Auth guard ────────────────────────────────────────────────────────────
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  -- ── Validate mode ─────────────────────────────────────────────────────────
  IF p_mode NOT IN ('solo','ranked_duel','friend_duel','party','event') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_mode');
  END IF;

  -- ── Upsert ────────────────────────────────────────────────────────────────
  INSERT INTO public.trivia_player_stats (
    user_id,
    xp_total,
    xp_this_week,
    games_played,
    games_solo,
    games_duel,
    games_party,
    games_event,
    correct_total,
    wrong_total,
    best_single_game_score,
    best_accuracy,
    perfect_games,
    best_in_session_streak,
    last_played_at
  ) VALUES (
    p_user_id,
    GREATEST(0, p_total_xp_earned),
    GREATEST(0, p_total_xp_earned),
    1,
    CASE WHEN p_mode = 'solo'                             THEN 1 ELSE 0 END,
    CASE WHEN p_mode IN ('ranked_duel','friend_duel')     THEN 1 ELSE 0 END,
    CASE WHEN p_mode = 'party'                            THEN 1 ELSE 0 END,
    CASE WHEN p_mode = 'event'                            THEN 1 ELSE 0 END,
    GREATEST(0, p_correct_count),
    GREATEST(0, p_wrong_count),
    GREATEST(0, p_total_xp_earned),
    p_accuracy,
    CASE WHEN p_perfect_game THEN 1 ELSE 0 END,
    GREATEST(0, p_best_in_session_streak),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    xp_total                = trivia_player_stats.xp_total
                              + GREATEST(0, p_total_xp_earned),
    xp_this_week            = trivia_player_stats.xp_this_week
                              + GREATEST(0, p_total_xp_earned),
    games_played            = trivia_player_stats.games_played + 1,
    games_solo              = trivia_player_stats.games_solo
                              + CASE WHEN p_mode = 'solo' THEN 1 ELSE 0 END,
    games_duel              = trivia_player_stats.games_duel
                              + CASE WHEN p_mode IN ('ranked_duel','friend_duel') THEN 1 ELSE 0 END,
    games_party             = trivia_player_stats.games_party
                              + CASE WHEN p_mode = 'party' THEN 1 ELSE 0 END,
    games_event             = trivia_player_stats.games_event
                              + CASE WHEN p_mode = 'event' THEN 1 ELSE 0 END,
    correct_total           = trivia_player_stats.correct_total
                              + GREATEST(0, p_correct_count),
    wrong_total             = trivia_player_stats.wrong_total
                              + GREATEST(0, p_wrong_count),
    best_single_game_score  = GREATEST(
                                trivia_player_stats.best_single_game_score,
                                GREATEST(0, p_total_xp_earned)
                              ),
    best_accuracy           = GREATEST(
                                COALESCE(trivia_player_stats.best_accuracy, 0),
                                COALESCE(p_accuracy, 0)
                              ),
    perfect_games           = trivia_player_stats.perfect_games
                              + CASE WHEN p_perfect_game THEN 1 ELSE 0 END,
    best_in_session_streak  = GREATEST(
                                trivia_player_stats.best_in_session_streak,
                                GREATEST(0, p_best_in_session_streak)
                              ),
    last_played_at          = NOW();

  -- ── Return updated state ──────────────────────────────────────────────────
  SELECT * INTO v_row
  FROM public.trivia_player_stats
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'xp_total',    v_row.xp_total,
    'xp_this_week',v_row.xp_this_week,
    'games_played',v_row.games_played
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
