-- Migration 073: update_br_ratings() — v2 corrections
--
-- Changes from migration 050:
--
--   1. Rating mode gate: only runs for sessions with rating_mode = 'ranked'.
--      Classic sessions return immediately with { skipped: true }.
--
--   2. Minimum player count: requires >= 4 players with placements.
--      Ranked sessions that completed with fewer (e.g. mass cancellation)
--      are treated as Classic for rating purposes.
--
--   3. K-factor thresholds updated:
--      Old: <5 → 32, <20 → 24, >=20 → 20
--      New: <10 → 40, <30 → 30, >=30 → 20
--
--   4. Delta clamp tightened: ±100 → ±18
--      After pairwise averaging over a 4–12 player lobby the raw delta
--      is already modest; ±18 prevents extreme swings from lopsided lobbies.
--
--   5. Everything else unchanged:
--      - Pairwise ELO algorithm (compare each player vs every other)
--      - Normalise by (N-1) so magnitude is independent of lobby size
--      - Rating floor 800 (GREATEST(800, ...))
--      - Idempotency guard on br_rating_before
--      - Writes br_rating_before/after/delta on br_session_players
--      - Updates users.br_rating, br_games_played, br_rating_updated_at
--
-- Requires: migrations 069 (rating_mode on br_sessions),
--           071 (br_session_players columns — br_rating_before/after/delta
--                already exist from migration 046)


CREATE OR REPLACE FUNCTION update_br_ratings(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  DELTA_CLAMP_MAX   CONSTANT NUMERIC := 18.0;
  RATING_FLOOR      CONSTANT INTEGER := 800;
  MIN_PLAYERS_RANKED CONSTANT INTEGER := 4;

  v_session        RECORD;
  v_player_count   INT;
  v_rec            RECORD;
  v_opp            RECORD;
  v_k              NUMERIC;
  v_expected       NUMERIC;
  v_delta_pair     NUMERIC;
  v_total_delta    NUMERIC;
  v_rating_before  INT;
  v_rating_after   INT;
  v_games_played   INT;
  v_updated        INT := 0;
BEGIN

  -- ── Ranked gate ────────────────────────────────────────────────────────────
  SELECT rating_mode INTO v_session
  FROM br_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_session.rating_mode <> 'ranked' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_ranked');
  END IF;

  -- ── Session must be completed ──────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM br_sessions
    WHERE id = p_session_id AND status = 'completed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_completed');
  END IF;

  -- ── Minimum players gate ──────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_player_count
  FROM br_session_players
  WHERE session_id = p_session_id AND placement IS NOT NULL;

  IF v_player_count < MIN_PLAYERS_RANKED THEN
    RETURN jsonb_build_object(
      'ok',      true,
      'skipped', true,
      'reason',  'insufficient_players',
      'count',   v_player_count
    );
  END IF;

  -- ── Idempotency guard ─────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM br_session_players
    WHERE session_id      = p_session_id
      AND br_rating_before IS NOT NULL
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_processed');
  END IF;

  -- ── Process each player ───────────────────────────────────────────────────
  FOR v_rec IN
    SELECT
      bsp.user_id,
      bsp.placement,
      COALESCE(u.br_rating, 1000)    AS br_rating,
      COALESCE(u.br_games_played, 0) AS br_games_played
    FROM br_session_players bsp
    JOIN users u ON u.id = bsp.user_id
    WHERE bsp.session_id = p_session_id
      AND bsp.placement  IS NOT NULL
  LOOP

    v_rating_before := v_rec.br_rating;
    v_games_played  := v_rec.br_games_played;

    -- K-factor: higher for new players, lower for experienced
    v_k := CASE
      WHEN v_games_played < 10 THEN 40.0
      WHEN v_games_played < 30 THEN 30.0
      ELSE                          20.0
    END;

    v_total_delta := 0.0;

    -- Pairwise ELO: compare against every other participant
    FOR v_opp IN
      SELECT
        bsp.user_id,
        bsp.placement,
        COALESCE(u.br_rating, 1000) AS br_rating
      FROM br_session_players bsp
      JOIN users u ON u.id = bsp.user_id
      WHERE bsp.session_id = p_session_id
        AND bsp.user_id    != v_rec.user_id
        AND bsp.placement   IS NOT NULL
    LOOP
      -- Expected score (standard ELO formula)
      v_expected := 1.0 / (
        1.0 + POWER(10.0, (v_opp.br_rating::NUMERIC - v_rating_before::NUMERIC) / 400.0)
      );

      -- Actual: lower placement = better finish
      IF    v_rec.placement < v_opp.placement THEN
        v_delta_pair := v_k * (1.0 - v_expected);
      ELSIF v_rec.placement > v_opp.placement THEN
        v_delta_pair := v_k * (0.0 - v_expected);
      ELSE
        v_delta_pair := v_k * (0.5 - v_expected);
      END IF;

      v_total_delta := v_total_delta + v_delta_pair;
    END LOOP;

    -- Normalise: average across all opponents so magnitude ≈ 1v1 range
    v_total_delta := v_total_delta / GREATEST(1, (v_player_count - 1));

    -- Round to integer
    v_total_delta := ROUND(v_total_delta);

    -- Hard clamp ±18
    v_total_delta := GREATEST(-DELTA_CLAMP_MAX, LEAST(DELTA_CLAMP_MAX, v_total_delta));

    -- Apply rating floor
    v_rating_after := GREATEST(RATING_FLOOR, v_rating_before + v_total_delta::INT);

    -- Write snapshot to br_session_players
    UPDATE br_session_players SET
      br_rating_before = v_rating_before,
      br_rating_after  = v_rating_after,
      br_rating_delta  = v_rating_after - v_rating_before
    WHERE session_id = p_session_id
      AND user_id    = v_rec.user_id;

    -- Update live rating on users
    UPDATE users SET
      br_rating            = v_rating_after,
      br_games_played      = v_games_played + 1,
      br_rating_updated_at = NOW()
    WHERE id = v_rec.user_id;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',              true,
    'session_id',      p_session_id,
    'players_updated', v_updated,
    'player_count',    v_player_count
  );
END;
$$;


-- ── Permissions ───────────────────────────────────────────────────────────────
-- Restricted to service_role only — never callable directly by authenticated clients.
REVOKE EXECUTE ON FUNCTION update_br_ratings(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION update_br_ratings(UUID) TO service_role;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  proname        AS function_name,
  prosecdef      AS security_definer,
  pg_catalog.pg_get_function_arguments(oid) AS arguments
FROM pg_proc
WHERE proname = 'update_br_ratings';
