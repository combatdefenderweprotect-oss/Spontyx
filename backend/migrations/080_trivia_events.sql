-- =============================================================================
-- Migration 080: trivia_events + trivia_event_participants
-- =============================================================================
-- Creates:
--   1. trivia_events            — host-managed trivia event rooms
--   2. trivia_event_participants — per-player join/status/rank within an event
--   3. Wires deferred FK: trivia_sessions.event_id → trivia_events.id
--
-- Dependencies:
--   076_trivia_question_sets.sql — trivia_question_sets table + set_updated_at() trigger
--   077_trivia_sessions.sql      — trivia_sessions table (with nullable event_id UUID column)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. trivia_events
-- ---------------------------------------------------------------------------

CREATE TABLE trivia_events (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id             UUID        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    event_code          TEXT        NOT NULL UNIQUE,
    title               TEXT        NOT NULL,
    description         TEXT,
    sport               TEXT        NOT NULL
                            CHECK (sport IN ('soccer','nfl','nba','mlb','college_football','f1','tennis','mma')),
    event_tag           TEXT
                            CHECK (event_tag IS NULL OR event_tag IN ('world_cup_2026')),
    difficulty          TEXT        NOT NULL DEFAULT 'mixed'
                            CHECK (difficulty IN ('easy','medium','hard','mixed')),
    total_rounds        INT         NOT NULL DEFAULT 15 CHECK (total_rounds > 0),
    timer_seconds       INT         NOT NULL DEFAULT 20  CHECK (timer_seconds > 0),
    question_set_id     UUID        REFERENCES trivia_question_sets ON DELETE SET NULL,
    question_ids        UUID[]      NOT NULL DEFAULT '{}',
    status              TEXT        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','lobby','active','completed','cancelled')),
    max_participants    INT         NOT NULL DEFAULT 50  CHECK (max_participants > 0),
    participant_count   INT         NOT NULL DEFAULT 0   CHECK (participant_count >= 0),
    starts_at           TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    winner_user_id      UUID        REFERENCES auth.users ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_te_host
    ON trivia_events (host_id, created_at DESC);

CREATE INDEX idx_te_status
    ON trivia_events (status, created_at DESC)
    WHERE status IN ('lobby', 'active');

-- event_code uniqueness is already enforced by the UNIQUE constraint; add a
-- dedicated index so point-lookup by code (join flow) uses an index scan.
CREATE UNIQUE INDEX idx_te_event_code
    ON trivia_events (event_code);

-- updated_at trigger
CREATE TRIGGER set_updated_at_trivia_events
    BEFORE UPDATE ON trivia_events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE trivia_events ENABLE ROW LEVEL SECURITY;

-- Public (authenticated): view lobby / active events
DROP POLICY IF EXISTS "te_select_public" ON trivia_events;
CREATE POLICY "te_select_public"
    ON trivia_events
    FOR SELECT
    TO authenticated
    USING (status IN ('lobby', 'active'));

-- Host: view their own events regardless of status
DROP POLICY IF EXISTS "te_select_host" ON trivia_events;
CREATE POLICY "te_select_host"
    ON trivia_events
    FOR SELECT
    TO authenticated
    USING (host_id = auth.uid());

-- Host: update their own events (event management — title, status, rounds, etc.)
DROP POLICY IF EXISTS "te_update_host" ON trivia_events;
CREATE POLICY "te_update_host"
    ON trivia_events
    FOR UPDATE
    TO authenticated
    USING (host_id = auth.uid());

-- No INSERT policy — row creation is handled by a future SECURITY DEFINER RPC.

-- ---------------------------------------------------------------------------
-- 2. trivia_event_participants
-- ---------------------------------------------------------------------------

CREATE TABLE trivia_event_participants (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID        NOT NULL REFERENCES trivia_events ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    session_id  UUID        REFERENCES trivia_sessions ON DELETE SET NULL,
    status      TEXT        NOT NULL DEFAULT 'joined'
                    CHECK (status IN ('joined','active','completed','disqualified')),
    final_rank  INT         CHECK (final_rank >= 1),
    final_xp    INT         CHECK (final_xp >= 0),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, user_id)
);

-- Indexes
CREATE INDEX idx_tep_event
    ON trivia_event_participants (event_id, final_xp DESC NULLS LAST);

CREATE INDEX idx_tep_user
    ON trivia_event_participants (user_id, joined_at DESC);

-- RLS
ALTER TABLE trivia_event_participants ENABLE ROW LEVEL SECURITY;

-- Authenticated: SELECT participants in events they have joined, or in lobby/active events
DROP POLICY IF EXISTS "tep_select_participant" ON trivia_event_participants;
CREATE POLICY "tep_select_participant"
    ON trivia_event_participants
    FOR SELECT
    TO authenticated
    USING (
        -- they are a participant in this event
        user_id = auth.uid()
        OR
        -- the event is publicly visible (lobby or active)
        EXISTS (
            SELECT 1 FROM trivia_events te
            WHERE te.id = event_id
              AND te.status IN ('lobby', 'active')
        )
        OR
        -- they are the host of the event
        EXISTS (
            SELECT 1 FROM trivia_events te
            WHERE te.id = event_id
              AND te.host_id = auth.uid()
        )
    );

-- Users: INSERT their own participant row (joining an event)
DROP POLICY IF EXISTS "tep_insert_self" ON trivia_event_participants;
CREATE POLICY "tep_insert_self"
    ON trivia_event_participants
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Users: UPDATE their own row (e.g. abandoning — status change)
DROP POLICY IF EXISTS "tep_update_self" ON trivia_event_participants;
CREATE POLICY "tep_update_self"
    ON trivia_event_participants
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Wire deferred FK: trivia_sessions.event_id → trivia_events
-- ---------------------------------------------------------------------------

ALTER TABLE trivia_sessions
    ADD CONSTRAINT fk_ts_event_id
    FOREIGN KEY (event_id)
    REFERENCES trivia_events (id)
    ON DELETE SET NULL;
