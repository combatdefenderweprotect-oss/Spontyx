-- Migration 068: Arena Queue — v1 queue-based pairing foundation
--
-- Core principle: Arena v1 is 1v1 only. Players join a queue for a specific
-- fixture + phase (H1 / H2). When two players queue for the same slot, an
-- arena_session is created atomically by pair_arena_queue() and both queue
-- entries are marked matched. No client-side session creation.
--
-- Changes:
--   • arena_sessions.session_start_minute  — match minute at session creation
--   • arena_sessions.arena_mode            — 'ranked' | 'casual'
--   • New table arena_queue                — matchmaking queue rows
--   • RPC pair_arena_queue()               — atomic pairing + session creation
--   • RPC cancel_arena_queue()             — user cancels own waiting entry
--   • RLS on arena_queue                   — users read own rows only; writes via RPC
--   • Realtime publication for arena_queue


-- ── 1. arena_sessions: additive columns ──────────────────────────────────────
-- Do NOT drop or rename existing columns (mode, lobby_id, winning_team_number).
-- arena_mode is the v1 queue concept (ranked/casual); mode stays as '1v1'/'2v2'.

ALTER TABLE arena_sessions
  ADD COLUMN IF NOT EXISTS session_start_minute INTEGER,
  ADD COLUMN IF NOT EXISTS arena_mode TEXT DEFAULT 'ranked'
    CHECK (arena_mode IN ('ranked', 'casual'));


-- ── 2. arena_queue table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_queue (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fixture_id  BIGINT      NOT NULL,
  sport       TEXT        NOT NULL DEFAULT 'football',
  phase       TEXT        NOT NULL CHECK (phase IN ('H1', 'H2')),
  mode        TEXT        NOT NULL CHECK (mode IN ('ranked', 'casual')),
  status      TEXT        NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'matched', 'cancelled', 'expired')),
  session_id  UUID        REFERENCES arena_sessions(id) ON DELETE SET NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes')
);

-- One active waiting entry per user — enforced at DB level.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_arena_queue_user_waiting
  ON arena_queue (user_id)
  WHERE status = 'waiting';

-- Pairing lookup (hot path: fixture + phase + mode + status + FIFO order).
CREATE INDEX IF NOT EXISTS idx_arena_queue_pair
  ON arena_queue (fixture_id, phase, mode, status, joined_at)
  WHERE status = 'waiting';

-- User history.
CREATE INDEX IF NOT EXISTS idx_arena_queue_user
  ON arena_queue (user_id, joined_at DESC);


-- ── 3. RLS on arena_queue ─────────────────────────────────────────────────────
-- Users can only read their own queue entries.
-- All inserts and updates are done by SECURITY DEFINER RPCs (service-role bypass).

ALTER TABLE arena_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'arena_queue' AND policyname = 'aq_select_own'
  ) THEN
    CREATE POLICY "aq_select_own"
      ON arena_queue FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;


-- ── 4. Realtime ───────────────────────────────────────────────────────────────
-- arena-session.html (and a future queue waiting screen) can subscribe to
-- status changes on the user's queue row to detect when they are paired.
ALTER PUBLICATION supabase_realtime ADD TABLE arena_queue;


-- ── 5. RPC pair_arena_queue ───────────────────────────────────────────────────
-- Atomic pairing + session creation. Called by join-arena-queue Edge Function
-- after auth and minute-window validation are complete.
--
-- Concurrency: uses FOR UPDATE SKIP LOCKED on the opponent row so two users
-- joining simultaneously cannot both claim the same opponent.
--
-- Returns JSONB:
--   { "status": "matched",  "session_id": "<uuid>" }
--   { "status": "waiting",  "queue_id":   "<uuid>" }
--   { "status": "error",    "reason":     "<code>" }
--     reason codes: already_in_queue | session_create_failed

CREATE OR REPLACE FUNCTION pair_arena_queue(
  p_user_id       UUID,
  p_fixture_id    BIGINT,
  p_sport         TEXT,
  p_phase         TEXT,       -- 'H1' | 'H2'
  p_arena_mode    TEXT,       -- 'ranked' | 'casual'
  p_match_minute  INTEGER,
  p_home_team     TEXT        DEFAULT NULL,
  p_away_team     TEXT        DEFAULT NULL,
  p_kickoff_at    TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opponent_entry_id UUID;
  v_opponent_user_id  UUID;
  v_session_id        UUID;
  v_queue_id          UUID;
  v_half_scope        TEXT;
BEGIN
  -- Guard: user must not already have a waiting entry.
  IF EXISTS (
    SELECT 1 FROM arena_queue
    WHERE user_id = p_user_id AND status = 'waiting'
  ) THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'already_in_queue');
  END IF;

  -- Map phase → half_scope for arena_sessions.
  v_half_scope := CASE p_phase WHEN 'H1' THEN 'first_half' ELSE 'second_half' END;

  -- Try to claim the oldest valid waiting opponent (FIFO fairness).
  -- SKIP LOCKED: if another concurrent transaction is mid-pair on this row,
  -- skip it rather than blocking — the current user will enter the waiting queue.
  SELECT aq.id, aq.user_id
    INTO v_opponent_entry_id, v_opponent_user_id
    FROM arena_queue aq
   WHERE aq.fixture_id = p_fixture_id
     AND aq.phase      = p_phase
     AND aq.mode       = p_arena_mode
     AND aq.status     = 'waiting'
     AND aq.expires_at > now()
     AND aq.user_id   != p_user_id
   ORDER BY aq.joined_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_opponent_entry_id IS NOT NULL THEN
    -- ── Pairing path ─────────────────────────────────────────────────────────

    -- 1. Create arena_session (mode always '1v1' for Arena v1).
    INSERT INTO arena_sessions (
      match_id,
      half_scope,
      mode,
      arena_mode,
      status,
      home_team_name,
      away_team_name,
      kickoff_at,
      started_at,
      session_start_minute
    ) VALUES (
      p_fixture_id::TEXT,
      v_half_scope,
      '1v1',
      p_arena_mode,
      'active',
      p_home_team,
      p_away_team,
      p_kickoff_at,
      now(),
      p_match_minute
    )
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'reason', 'session_create_failed');
    END IF;

    -- 2. Insert both players (score starts at 0 — enforced by column default).
    INSERT INTO arena_session_players (session_id, user_id)
    VALUES
      (v_session_id, v_opponent_user_id),
      (v_session_id, p_user_id);

    -- 3. Mark opponent's queue entry matched.
    UPDATE arena_queue
       SET status     = 'matched',
           matched_at = now(),
           session_id = v_session_id
     WHERE id = v_opponent_entry_id;

    -- 4. Record current user's queue entry as already matched (for history).
    INSERT INTO arena_queue (
      user_id, fixture_id, sport, phase, mode,
      status, session_id, matched_at
    ) VALUES (
      p_user_id, p_fixture_id, p_sport, p_phase, p_arena_mode,
      'matched', v_session_id, now()
    );

    RETURN jsonb_build_object('status', 'matched', 'session_id', v_session_id);

  ELSE
    -- ── Waiting path ──────────────────────────────────────────────────────────
    INSERT INTO arena_queue (user_id, fixture_id, sport, phase, mode, status)
    VALUES (p_user_id, p_fixture_id, p_sport, p_phase, p_arena_mode, 'waiting')
    RETURNING id INTO v_queue_id;

    RETURN jsonb_build_object('status', 'waiting', 'queue_id', v_queue_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION pair_arena_queue TO authenticated, service_role;


-- ── 6. RPC cancel_arena_queue ─────────────────────────────────────────────────
-- Allows a user to cancel their own waiting queue entry (e.g. they navigate away).
-- p_queue_id is optional — if NULL, cancels whatever waiting entry the user has.
--
-- Returns JSONB:
--   { "cancelled": true }
--   { "cancelled": false, "reason": "no_waiting_entry" }

CREATE OR REPLACE FUNCTION cancel_arena_queue(
  p_user_id  UUID,
  p_queue_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE arena_queue
     SET status = 'cancelled'
   WHERE user_id = p_user_id
     AND status  = 'waiting'
     AND (p_queue_id IS NULL OR id = p_queue_id);

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    RETURN jsonb_build_object('cancelled', true);
  ELSE
    RETURN jsonb_build_object('cancelled', false, 'reason', 'no_waiting_entry');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_arena_queue TO authenticated, service_role;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'arena_sessions'
  AND column_name  IN ('session_start_minute', 'arena_mode')
ORDER BY column_name;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'arena_queue'
ORDER BY ordinal_position;
