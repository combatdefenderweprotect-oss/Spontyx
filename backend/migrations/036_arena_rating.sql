-- Migration 036: Arena Rating System
--
-- Core principle: Arena Rating measures skill in Live Multiplayer (arena_sessions) ONLY.
--   Completely separate from XP (global progression) and BR ELO (battle royale).
--   Rating is zero-sum between players; floor at 500; no performance modifiers.
--
-- Changes:
--   • users.arena_rating              — current rating (default 500)
--   • users.arena_games_played        — total completed arena games
--   • users.arena_rating_updated_at   — last update timestamp
--   • arena_session_players columns   — before / after / delta per session
--   • Index                           — arena_rating DESC for leaderboard
--   • update_arena_ratings()          — SECURITY DEFINER RPC — single write path


-- ── 1. USERS: add arena rating columns ───────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS arena_rating            INTEGER     NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS arena_games_played      INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arena_rating_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_arena_rating
  ON users (arena_rating DESC)
  WHERE arena_games_played > 0;


-- ── 2. ARENA_SESSION_PLAYERS: add rating snapshot columns ────────────────────

ALTER TABLE arena_session_players
  ADD COLUMN IF NOT EXISTS arena_rating_before INTEGER,
  ADD COLUMN IF NOT EXISTS arena_rating_after  INTEGER,
  ADD COLUMN IF NOT EXISTS arena_rating_delta  INTEGER;


-- ── 3. update_arena_ratings() RPC ────────────────────────────────────────────
--
-- Called from arena-session.html after session completes.
-- Idempotent: safe to call multiple times for the same session.
--
-- Returns:
--   { updated: bool, skip_reason: text|null, invalid_match: bool,
--     players: [{ user_id, delta, arena_rating_before, arena_rating_after }] }

CREATE OR REPLACE FUNCTION update_arena_ratings(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         RECORD;
  v_player          RECORD;
  v_mode            TEXT;
  v_team1_ratings   INTEGER[];
  v_team2_ratings   INTEGER[];
  v_team1_avg       NUMERIC;
  v_team2_avg       NUMERIC;
  v_result          JSONB := '[]'::JSONB;
  v_output          JSONB;

  -- per-player working vars
  v_user_id         UUID;
  v_rating_before   INTEGER;
  v_games_played    INTEGER;
  v_actual          NUMERIC;   -- 1 win / 0.5 draw / 0 loss
  v_opp_rating      NUMERIC;   -- opponent or opposing team avg
  v_expected        NUMERIC;
  v_k               INTEGER;
  v_raw_delta       NUMERIC;
  v_delta           INTEGER;
  v_rating_after    INTEGER;

  -- repeat-opponent penalty
  v_recent_count    INTEGER;
  v_penalty_applied BOOLEAN;

  -- team helpers
  v_winning_team    INTEGER;   -- 1 or 2, null = draw
  v_team_number     INTEGER;
  v_max_delta       INTEGER;

  r                 RECORD;
  u                 RECORD;
BEGIN

  -- ── Guard 1: session exists and is completed ────────────────────────────────
  SELECT * INTO v_session FROM arena_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'skip_reason', 'session_not_found', 'invalid_match', false, 'players', '[]'::JSONB);
  END IF;

  IF v_session.status <> 'completed' THEN
    RETURN jsonb_build_object('updated', false, 'skip_reason', 'session_not_completed', 'invalid_match', false, 'players', '[]'::JSONB);
  END IF;

  v_mode := v_session.mode;  -- '1v1' or '2v2'

  -- ── Guard 2: idempotency — already processed ────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM arena_session_players
    WHERE session_id = p_session_id
      AND arena_rating_before IS NOT NULL
    LIMIT 1
  ) THEN
    -- Return existing deltas so UI can still display them
    SELECT jsonb_agg(jsonb_build_object(
      'user_id',             asp.user_id,
      'delta',               asp.arena_rating_delta,
      'arena_rating_before', asp.arena_rating_before,
      'arena_rating_after',  asp.arena_rating_after
    )) INTO v_result
    FROM arena_session_players asp
    WHERE asp.session_id = p_session_id;

    RETURN jsonb_build_object('updated', false, 'skip_reason', 'already_processed', 'invalid_match', false, 'players', COALESCE(v_result, '[]'::JSONB));
  END IF;

  -- ── Guard 3: validate player count ─────────────────────────────────────────
  DECLARE
    v_total_players INTEGER;
    v_team1_count   INTEGER;
    v_team2_count   INTEGER;
    v_required      INTEGER;
  BEGIN
    SELECT COUNT(*)                                         INTO v_total_players FROM arena_session_players WHERE session_id = p_session_id;
    SELECT COUNT(*) FILTER (WHERE team_number = 1)         INTO v_team1_count   FROM arena_session_players WHERE session_id = p_session_id;
    SELECT COUNT(*) FILTER (WHERE team_number = 2)         INTO v_team2_count   FROM arena_session_players WHERE session_id = p_session_id;

    v_required := CASE WHEN v_mode = '2v2' THEN 4 ELSE 2 END;

    IF v_total_players <> v_required OR v_team1_count <> (v_required / 2) OR v_team2_count <> (v_required / 2) THEN
      RETURN jsonb_build_object('updated', false, 'skip_reason', 'invalid_match', 'invalid_match', true, 'players', '[]'::JSONB);
    END IF;
  END;

  -- ── Determine winning team ──────────────────────────────────────────────────
  -- winner_user_id set → look up their team_number
  -- winning_team_number set directly → use it
  -- both null → draw
  IF v_session.winner_user_id IS NOT NULL THEN
    SELECT team_number INTO v_winning_team
    FROM arena_session_players
    WHERE session_id = p_session_id AND user_id = v_session.winner_user_id;
  ELSIF v_session.winning_team_number IS NOT NULL THEN
    v_winning_team := v_session.winning_team_number;
  ELSE
    v_winning_team := NULL;  -- draw
  END IF;

  -- ── Compute team average ratings ───────────────────────────────────────────
  SELECT COALESCE(AVG(u2.arena_rating), 500) INTO v_team1_avg
  FROM arena_session_players asp2
  JOIN users u2 ON u2.id = asp2.user_id
  WHERE asp2.session_id = p_session_id AND asp2.team_number = 1;

  SELECT COALESCE(AVG(u2.arena_rating), 500) INTO v_team2_avg
  FROM arena_session_players asp2
  JOIN users u2 ON u2.id = asp2.user_id
  WHERE asp2.session_id = p_session_id AND asp2.team_number = 2;

  -- ── Process each player ────────────────────────────────────────────────────
  FOR r IN
    SELECT asp.user_id, asp.team_number, u.arena_rating, u.arena_games_played
    FROM arena_session_players asp
    JOIN users u ON u.id = asp.user_id
    WHERE asp.session_id = p_session_id
  LOOP
    v_user_id       := r.user_id;
    v_rating_before := r.arena_rating;
    v_games_played  := r.arena_games_played;
    v_team_number   := r.team_number;

    -- K-factor (read BEFORE incrementing games_played)
    v_k := CASE
      WHEN v_games_played < 10 THEN 32
      WHEN v_games_played < 30 THEN 24
      ELSE 20
    END;

    -- Max delta cap per mode
    v_max_delta := CASE WHEN v_mode = '2v2' THEN 20 ELSE 25 END;

    -- Actual result for this player
    v_actual := CASE
      WHEN v_winning_team IS NULL THEN 0.5              -- draw
      WHEN v_team_number = v_winning_team THEN 1.0      -- win
      ELSE 0.0                                           -- loss
    END;

    -- Opponent strength: opposing team's average
    v_opp_rating := CASE WHEN v_team_number = 1 THEN v_team2_avg ELSE v_team1_avg END;

    -- ELO expected score
    v_expected := 1.0 / (1.0 + POWER(10.0, (v_opp_rating - v_rating_before) / 400.0));

    -- Raw delta
    v_raw_delta := v_k * (v_actual - v_expected);

    -- ── Repeat-opponent penalty (rolling 24h) ──────────────────────────────
    -- Count completed sessions in last 24h where this player faced the same opponent(s)
    SELECT COUNT(DISTINCT s2.id) INTO v_recent_count
    FROM arena_sessions s2
    JOIN arena_session_players p1 ON p1.session_id = s2.id AND p1.user_id = v_user_id
    JOIN arena_session_players p2 ON p2.session_id = s2.id AND p2.user_id <> v_user_id
    WHERE s2.id <> p_session_id
      AND s2.status = 'completed'
      AND s2.completed_at >= NOW() - INTERVAL '24 hours'
      AND EXISTS (
        -- same set of opponents appeared in current session too
        SELECT 1 FROM arena_session_players cur
        WHERE cur.session_id = p_session_id
          AND cur.user_id = p2.user_id
          AND cur.user_id <> v_user_id
      );

    v_penalty_applied := v_recent_count >= 3;

    IF v_penalty_applied THEN
      v_raw_delta := v_raw_delta * 0.5;
    END IF;

    -- Clamp to ±max_delta
    v_delta := GREATEST(-v_max_delta, LEAST(v_max_delta, ROUND(v_raw_delta)::INTEGER));

    -- Minimum ±1 when penalty was applied and delta would zero out a non-zero result
    IF v_penalty_applied AND v_delta = 0 AND v_raw_delta <> 0.0 THEN
      v_delta := CASE WHEN v_raw_delta > 0 THEN 1 ELSE -1 END;
    END IF;

    -- Apply floor at 500
    v_rating_after := GREATEST(500, v_rating_before + v_delta);

    -- Recalculate stored delta as post-floor actual change
    v_delta := v_rating_after - v_rating_before;

    -- ── Write to arena_session_players ─────────────────────────────────────
    UPDATE arena_session_players
    SET arena_rating_before = v_rating_before,
        arena_rating_after  = v_rating_after,
        arena_rating_delta  = v_delta
    WHERE session_id = p_session_id AND user_id = v_user_id;

    -- ── Update users ────────────────────────────────────────────────────────
    UPDATE users
    SET arena_rating            = v_rating_after,
        arena_games_played      = arena_games_played + 1,
        arena_rating_updated_at = NOW()
    WHERE id = v_user_id;

    -- Accumulate result
    v_result := v_result || jsonb_build_object(
      'user_id',             v_user_id,
      'delta',               v_delta,
      'arena_rating_before', v_rating_before,
      'arena_rating_after',  v_rating_after,
      'penalty_applied',     v_penalty_applied
    );

  END LOOP;

  RETURN jsonb_build_object(
    'updated',       true,
    'skip_reason',   NULL,
    'invalid_match', false,
    'players',       v_result
  );

END;
$$;

GRANT EXECUTE ON FUNCTION update_arena_ratings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_arena_ratings(UUID) TO service_role;
