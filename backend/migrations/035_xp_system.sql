-- Migration 035: Global XP System
--
-- Core principle: XP is universal progress, independent of rating systems (ELO, arena_elo).
--   XP accumulates across ALL game modes and never decreases.
--   Rating systems (ELO) are for relative matchmaking — separate concern entirely.
--
-- Changes:
--   • users.total_xp              — running XP total (denormalized for fast level reads)
--   • users.level                 — current level (1–based, derived from total_xp)
--   • player_xp_events columns    — source_type, source_id, metadata (extend existing table)
--   • Partial unique index        — (user_id, event_type, source_id) WHERE source_id IS NOT NULL
--   • get_level_number()          — IMMUTABLE helper: XP → level integer
--   • get_level_info()            — IMMUTABLE helper: XP → {level, xp_in_level, xp_for_next, progress_pct}
--   • award_xp()                  — SECURITY DEFINER RPC — single write path for ALL XP awards
--   • Backfill                    — total_xp from existing player_xp_events rows; level from total_xp


-- ── 1. USERS: add total_xp + level ───────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS total_xp INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level     INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_users_total_xp
  ON users (total_xp DESC)
  WHERE total_xp > 0;


-- ── 2. PLAYER_XP_EVENTS: extend schema ───────────────────────────────────────

ALTER TABLE player_xp_events
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id   UUID,
  ADD COLUMN IF NOT EXISTS metadata    JSONB NOT NULL DEFAULT '{}';

-- Idempotency: prevents duplicate XP awards for the same (user, event, source).
-- Only applies when source_id is NOT NULL — loose events (no source) are allowed to repeat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_events_idempotency
  ON player_xp_events (user_id, event_type, source_id)
  WHERE source_id IS NOT NULL;

-- Anti-abuse: daily session count per source_type (for cap queries).
CREATE INDEX IF NOT EXISTS idx_xp_events_daily_cap
  ON player_xp_events (user_id, source_type, created_at DESC)
  WHERE source_id IS NOT NULL;


-- ── 3. get_level_number() — XP → level ───────────────────────────────────────
-- Formula: XP required to advance from level N to N+1 = floor(100 × N^1.5)
-- Cumulative XP to reach level N = sum(floor(100 × k^1.5)) for k = 1..N-1
-- IMMUTABLE so Postgres can cache results.

CREATE OR REPLACE FUNCTION get_level_number(p_xp INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_level      INTEGER := 1;
  v_cumulative INTEGER := 0;
  v_needed     INTEGER;
BEGIN
  LOOP
    v_needed := FLOOR(100.0 * POWER(v_level::NUMERIC, 1.5))::INTEGER;
    EXIT WHEN v_cumulative + v_needed > p_xp;
    v_cumulative := v_cumulative + v_needed;
    v_level      := v_level + 1;
    -- Hard cap at 100 to prevent infinite loops
    EXIT WHEN v_level >= 100;
  END LOOP;
  RETURN v_level;
END;
$$;


-- ── 4. get_level_info() — XP → level details ─────────────────────────────────
-- Returns JSONB: {level, xp_in_level, xp_for_next, progress_pct}
-- Used by profile pages and XP bar rendering.

CREATE OR REPLACE FUNCTION get_level_info(p_xp INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_level       INTEGER := 1;
  v_cumulative  INTEGER := 0;
  v_needed      INTEGER;
  v_xp_in_level INTEGER;
  v_xp_for_next INTEGER;
BEGIN
  LOOP
    v_needed := FLOOR(100.0 * POWER(v_level::NUMERIC, 1.5))::INTEGER;
    EXIT WHEN v_cumulative + v_needed > p_xp;
    v_cumulative := v_cumulative + v_needed;
    v_level      := v_level + 1;
    EXIT WHEN v_level >= 100;
  END LOOP;

  v_xp_in_level := p_xp - v_cumulative;
  v_xp_for_next := FLOOR(100.0 * POWER(v_level::NUMERIC, 1.5))::INTEGER;

  RETURN jsonb_build_object(
    'level',         v_level,
    'xp_in_level',   v_xp_in_level,
    'xp_for_next',   v_xp_for_next,
    'progress_pct',  ROUND((v_xp_in_level::NUMERIC / GREATEST(v_xp_for_next, 1)) * 100, 1)
  );
END;
$$;


-- ── 5. award_xp() — single write path for ALL XP ─────────────────────────────
--
-- Handles: idempotency, anti-abuse (daily cap + repeat opponent), atomic total_xp update.
-- Called by: Edge Functions (service role, auth.uid() = NULL) and browser JS (authenticated).
--
-- Auth rule:
--   - Service role: auth.uid() IS NULL — may award for any user (trusted server path)
--   - Authenticated user: auth.uid() must equal p_user_id — cannot award XP for others
--
-- Anti-abuse:
--   - Daily soft cap: COUNT(DISTINCT source_id) per source_type today
--       ≥ 20 → 0.5× multiplier
--       ≥ 10 → 0.7× multiplier
--   - Repeat opponent penalty: ≥ 3 unique source_ids today with same opponent_id
--       → 0.5× multiplier (stacks multiplicatively with daily cap)
--
-- Arena validation:
--   - source_type = 'arena': verifies arena_sessions.status = 'completed'
--     and user is in arena_session_players
--
-- Returns JSONB:
--   {awarded_xp, new_total_xp, new_level, multiplier, duplicate: false} on success
--   {awarded_xp: 0, duplicate: true}                                     on idempotent duplicate

CREATE OR REPLACE FUNCTION award_xp(
  p_user_id     UUID,
  p_xp_amount   INTEGER,
  p_event_type  TEXT,
  p_source_type TEXT,
  p_source_id   UUID    DEFAULT NULL,
  p_metadata    JSONB   DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_uid    UUID    := auth.uid();
  v_session_count INTEGER;
  v_opp_count     INTEGER;
  v_opponent_id   TEXT;
  v_multiplier    NUMERIC := 1.0;
  v_awarded_xp    INTEGER;
  v_new_xp        INTEGER;
  v_new_level     INTEGER;
  v_today_start   TIMESTAMPTZ := DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC');
BEGIN
  -- ── Auth guard ────────────────────────────────────────────────────────────
  -- Service role has NULL auth.uid() — allowed for any user.
  -- Authenticated callers must only award XP for themselves.
  IF v_caller_uid IS NOT NULL AND v_caller_uid != p_user_id THEN
    RAISE EXCEPTION 'award_xp: caller % cannot award XP for user %', v_caller_uid, p_user_id;
  END IF;

  -- ── Input validation ──────────────────────────────────────────────────────
  IF p_xp_amount <= 0 THEN
    RAISE EXCEPTION 'award_xp: p_xp_amount must be > 0, got %', p_xp_amount;
  END IF;

  -- ── Arena source validation ───────────────────────────────────────────────
  -- For arena events with a source_id (session UUID), verify the session is
  -- completed and the user participated — prevents premature or fabricated claims.
  IF p_source_type = 'arena' AND p_source_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM arena_sessions a
      JOIN arena_session_players asp ON asp.session_id = a.id
      WHERE a.id     = p_source_id
        AND a.status = 'completed'
        AND asp.user_id = p_user_id
    ) THEN
      RETURN jsonb_build_object(
        'awarded_xp', 0,
        'error',      'arena_session_not_completed_or_not_participant'
      );
    END IF;
  END IF;

  -- ── Daily soft cap ────────────────────────────────────────────────────────
  -- Count distinct sessions of this source_type submitted today.
  SELECT COUNT(DISTINCT source_id)
    INTO v_session_count
    FROM player_xp_events
   WHERE user_id     = p_user_id
     AND source_type = p_source_type
     AND source_id   IS NOT NULL
     AND created_at  >= v_today_start;

  IF v_session_count >= 20 THEN
    v_multiplier := v_multiplier * 0.5;
  ELSIF v_session_count >= 10 THEN
    v_multiplier := v_multiplier * 0.7;
  END IF;

  -- ── Repeat opponent penalty ───────────────────────────────────────────────
  -- If metadata carries an opponent_id, check how many unique sessions vs
  -- this opponent already exist today. ≥ 3 → halve the remaining amount.
  v_opponent_id := p_metadata->>'opponent_id';

  IF v_opponent_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT source_id)
      INTO v_opp_count
      FROM player_xp_events
     WHERE user_id               = p_user_id
       AND source_type           = p_source_type
       AND source_id             IS NOT NULL
       AND metadata->>'opponent_id' = v_opponent_id
       AND created_at            >= v_today_start;

    IF v_opp_count >= 3 THEN
      v_multiplier := v_multiplier * 0.5;
    END IF;
  END IF;

  -- Final awarded amount (floor, minimum 1 so the insert doesn't fail the > 0 check)
  v_awarded_xp := GREATEST(1, FLOOR(p_xp_amount * v_multiplier)::INTEGER);

  -- ── Idempotent insert ─────────────────────────────────────────────────────
  -- ON CONFLICT DO NOTHING — if the unique index fires, we return {duplicate: true}.
  INSERT INTO player_xp_events (
    user_id, event_type, xp_amount, source_type, source_id, metadata,
    source_question_id, source_match_id
  ) VALUES (
    p_user_id,
    p_event_type,
    v_awarded_xp,
    p_source_type,
    p_source_id,
    p_metadata,
    -- Back-compat: populate legacy columns when metadata carries them
    CASE WHEN p_metadata ? 'question_id' THEN (p_metadata->>'question_id')::UUID ELSE NULL END,
    p_metadata->>'match_id'
  )
  ON CONFLICT (user_id, event_type, source_id)
    WHERE source_id IS NOT NULL
    DO NOTHING;

  -- Detect duplicate (no row inserted)
  IF NOT FOUND THEN
    RETURN jsonb_build_object('awarded_xp', 0, 'duplicate', TRUE);
  END IF;

  -- ── Atomic total_xp + level update ───────────────────────────────────────
  UPDATE users
     SET total_xp = total_xp + v_awarded_xp,
         level    = get_level_number(total_xp + v_awarded_xp)
   WHERE id = p_user_id
  RETURNING total_xp, level INTO v_new_xp, v_new_level;

  RETURN jsonb_build_object(
    'awarded_xp',    v_awarded_xp,
    'new_total_xp',  v_new_xp,
    'new_level',     v_new_level,
    'multiplier',    v_multiplier,
    'duplicate',     FALSE
  );
END;
$$;

-- Grant execute to authenticated users (browser JS) and service_role (Edge Functions).
GRANT EXECUTE ON FUNCTION award_xp(UUID, INTEGER, TEXT, TEXT, UUID, JSONB)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION get_level_number(INTEGER)  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_level_info(INTEGER)    TO authenticated, anon, service_role;


-- ── 6. Backfill existing data ─────────────────────────────────────────────────

-- Sum existing XP events per user → populate total_xp.
UPDATE users u
   SET total_xp = COALESCE(agg.total, 0)
  FROM (
    SELECT user_id, SUM(xp_amount) AS total
      FROM player_xp_events
     GROUP BY user_id
  ) agg
 WHERE u.id = agg.user_id;

-- Derive level from the now-populated total_xp.
UPDATE users
   SET level = get_level_number(total_xp)
 WHERE total_xp > 0;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'users'
   AND column_name  IN ('total_xp', 'level')
 ORDER BY column_name;

SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'player_xp_events'
   AND column_name  IN ('source_type', 'source_id', 'metadata')
 ORDER BY column_name;
