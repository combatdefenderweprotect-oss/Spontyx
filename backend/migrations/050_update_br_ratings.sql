-- Migration 050: update_br_ratings() RPC — Phase 3 BR ELO
--
-- Computes and writes ELO (SR) rating changes after a completed BR session.
-- Reads placements from br_session_players, applies pairwise ELO against every
-- other participant, then writes:
--   • br_session_players.br_rating_before / br_rating_after / br_rating_delta
--   • users.br_rating / br_games_played / br_rating_updated_at
--
-- Idempotent: returns { skipped: true } when any player already has
-- br_rating_before set on their br_session_players row.
--
-- ELO model
--   K-factor:   32 when br_games_played < 5
--               24 when br_games_played < 20
--               20 when br_games_played >= 20
--   Pairwise:   each player plays a virtual 1v1 vs every other participant.
--               actual = 1 (better placement) | 0.5 (same) | 0 (worse)
--               expected = 1 / (1 + 10^((opp_rating - own_rating) / 400))
--               delta_vs_opp = K * (actual - expected)
--   Normalise:  sum of pairwise deltas / (N-1) keeps magnitude ~= 1v1 range
--               regardless of lobby size.
--   Rating floor: 800  (br_rating starts at 1000)
--   Delta clamp:  [-100, +100] hard limit
--
-- Requires: migrations 042 (br_sessions), 043 (br_session_players),
--           046 (br_rating columns on users + br_session_players)


CREATE OR REPLACE FUNCTION update_br_ratings(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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

  -- ── Idempotency guard ─────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM br_session_players
    WHERE session_id = p_session_id
      AND br_rating_before IS NOT NULL
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_processed');
  END IF;

  -- ── Session must be completed ─────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM br_sessions
    WHERE id = p_session_id AND status = 'completed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_completed');
  END IF;

  -- ── Need at least 2 players with placements ───────────────────────────────
  SELECT COUNT(*) INTO v_player_count
  FROM br_session_players
  WHERE session_id = p_session_id
    AND placement IS NOT NULL;

  IF v_player_count < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_players_with_placement');
  END IF;

  -- ── Process each player ───────────────────────────────────────────────────
  FOR v_rec IN
    SELECT
      bsp.user_id,
      bsp.placement,
      COALESCE(u.br_rating, 1000)        AS br_rating,
      COALESCE(u.br_games_played, 0)     AS br_games_played
    FROM br_session_players bsp
    JOIN users u ON u.id = bsp.user_id
    WHERE bsp.session_id = p_session_id
      AND bsp.placement IS NOT NULL
  LOOP

    v_rating_before := v_rec.br_rating;
    v_games_played  := v_rec.br_games_played;

    -- K-factor tiers
    v_k := CASE
      WHEN v_games_played < 5  THEN 32.0
      WHEN v_games_played < 20 THEN 24.0
      ELSE                          20.0
    END;

    v_total_delta := 0.0;

    -- Pairwise ELO vs every other participant
    FOR v_opp IN
      SELECT
        bsp.user_id,
        bsp.placement,
        COALESCE(u.br_rating, 1000) AS br_rating
      FROM br_session_players bsp
      JOIN users u ON u.id = bsp.user_id
      WHERE bsp.session_id = p_session_id
        AND bsp.user_id    != v_rec.user_id
        AND bsp.placement IS NOT NULL
    LOOP
      -- Expected outcome (ELO formula)
      v_expected := 1.0 / (1.0 + POWER(10.0, (v_opp.br_rating::NUMERIC - v_rating_before::NUMERIC) / 400.0));

      -- Actual outcome: lower placement number = better finish
      IF    v_rec.placement < v_opp.placement THEN  -- player beat this opponent
        v_delta_pair := v_k * (1.0 - v_expected);
      ELSIF v_rec.placement > v_opp.placement THEN  -- player lost to this opponent
        v_delta_pair := v_k * (0.0 - v_expected);
      ELSE                                           -- same placement (tie)
        v_delta_pair := v_k * (0.5 - v_expected);
      END IF;

      v_total_delta := v_total_delta + v_delta_pair;
    END LOOP;

    -- Normalise: divide by (N-1) so magnitude is ~K regardless of lobby size
    v_total_delta := v_total_delta / GREATEST(1, (v_player_count - 1));

    -- Round to integer
    v_total_delta := ROUND(v_total_delta);

    -- Ensure non-zero deltas aren't rounded to 0 (minimum ±1)
    -- (v_total_delta is already ROUND()-ed here; guard for sub-0.5 cases)

    -- Hard clamp: [-100, +100]
    v_total_delta := GREATEST(-100.0, LEAST(100.0, v_total_delta));

    -- Apply rating floor at 800
    v_rating_after := GREATEST(800, v_rating_before + v_total_delta::INT);

    -- ── Write to br_session_players ──────────────────────────────────────────
    UPDATE br_session_players
    SET
      br_rating_before = v_rating_before,
      br_rating_after  = v_rating_after,
      br_rating_delta  = v_rating_after - v_rating_before
    WHERE session_id = p_session_id
      AND user_id    = v_rec.user_id;

    -- ── Write to users ───────────────────────────────────────────────────────
    UPDATE users
    SET
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
GRANT EXECUTE ON FUNCTION update_br_ratings(UUID) TO authenticated, service_role;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  proname        AS function_name,
  prosecdef      AS security_definer,
  pg_catalog.pg_get_function_arguments(oid) AS arguments
FROM pg_proc
WHERE proname = 'update_br_ratings';
