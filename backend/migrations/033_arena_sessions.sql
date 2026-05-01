-- Migration 033: Arena Sessions — Live Multiplayer game-mode separation
--
-- Core principle: `leagues` = persistent long-term competition.
--                 `arena_sessions` = short live competitive sessions (Live Multiplayer).
--
-- Changes:
--   • New table `arena_sessions`         — one per matchmaking lobby game
--   • New table `arena_session_players`  — players in each session
--   • `questions.league_id`              — made nullable (was NOT NULL)
--   • `questions.arena_session_id`       — new FK to arena_sessions
--   • CHECK constraint on questions      — exactly one of league_id / arena_session_id must be set
--   • `leagues.session_type`             — 'league' | 'solo_match'
--   • `game_history` discriminator cols  — game_mode, rating_type, source_session_id
--   • `player_answers.league_id`         — made nullable (arena answers don't belong to a league)
--   • `player_answers.arena_session_id`  — new FK for arena answers
--   • Updated RLS on player_answers      — allows arena session participants to insert


-- ── 1. ARENA SESSIONS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_sessions (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id            UUID          REFERENCES match_lobbies(id) ON DELETE SET NULL,
  match_id            TEXT          NOT NULL,
  half_scope          TEXT          NOT NULL DEFAULT 'full_match'
                        CHECK (half_scope IN ('first_half', 'second_half', 'full_match')),
  mode                TEXT          NOT NULL CHECK (mode IN ('1v1', '2v2')),
  status              TEXT          NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting', 'active', 'completed', 'cancelled')),
  home_team_name      TEXT,
  away_team_name      TEXT,
  kickoff_at          TIMESTAMPTZ,
  api_league_id       INTEGER,
  -- 1v1: winning player; 2v2: NULL (use winning_team_number instead)
  winner_user_id      UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 2v2: 1 or 2
  winning_team_number INTEGER       CHECK (winning_team_number IN (1, 2)),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_sessions_status
  ON arena_sessions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arena_sessions_match
  ON arena_sessions (match_id, status);


-- ── 2. ARENA SESSION PLAYERS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_session_players (
  session_id      UUID    NOT NULL REFERENCES arena_sessions(id) ON DELETE CASCADE,
  user_id         UUID    NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  team_number     INTEGER CHECK (team_number IN (1, 2)),
  score           INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  total_answers   INTEGER NOT NULL DEFAULT 0,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_asp_user
  ON arena_session_players (user_id, joined_at DESC);


-- ── 3. questions: add arena_session_id + make league_id nullable ──────────────

-- Step 3a: drop the NOT NULL constraint on questions.league_id
-- (league_id was implicitly NOT NULL due to FK — we must drop and re-add as nullable)
ALTER TABLE questions
  ALTER COLUMN league_id DROP NOT NULL;

-- Step 3b: add arena_session_id FK
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS arena_session_id UUID
    REFERENCES arena_sessions(id) ON DELETE CASCADE;

-- Step 3c: enforce exactly one linkage
-- Existing rows have league_id set and arena_session_id NULL — constraint is satisfied.
ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_exactly_one_owner;

ALTER TABLE questions
  ADD CONSTRAINT questions_exactly_one_owner CHECK (
    (league_id IS NOT NULL AND arena_session_id IS NULL)
    OR
    (league_id IS NULL AND arena_session_id IS NOT NULL)
  );

-- Index: fetch questions for an arena session (live feed in arena-session.html)
CREATE INDEX IF NOT EXISTS idx_questions_arena_session
  ON questions (arena_session_id, visible_from)
  WHERE arena_session_id IS NOT NULL;


-- ── 4. leagues: session_type column ───────────────────────────────────────────
-- 'league'      = persistent competition (default, all existing rows)
-- 'solo_match'  = single-player match session (blocks REAL_WORLD, chat, invites)

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'league'
    CHECK (session_type IN ('league', 'solo_match'));

CREATE INDEX IF NOT EXISTS idx_leagues_session_type
  ON leagues (session_type)
  WHERE session_type = 'solo_match';


-- ── 5. game_history: mode discriminator columns ───────────────────────────────
-- game_mode:        what kind of game this history entry represents
-- rating_type:      which rating system was affected (or null if none)
-- source_session_id: FK to arena_sessions for Live Multiplayer games

ALTER TABLE game_history
  ADD COLUMN IF NOT EXISTS game_mode         TEXT,
  ADD COLUMN IF NOT EXISTS rating_type       TEXT
                             CHECK (rating_type IN ('arena_elo', 'br_elo', 'trivia_skill', NULL)),
  ADD COLUMN IF NOT EXISTS source_session_id UUID
                             REFERENCES arena_sessions(id) ON DELETE SET NULL;

-- Note: game_type column does not exist in this schema — no backfill needed.
-- game_mode will be NULL for all existing rows (correct default).


-- ── 6. player_answers: add arena_session_id + make league_id nullable ─────────

-- Step 6a: make league_id nullable on player_answers
ALTER TABLE player_answers
  ALTER COLUMN league_id DROP NOT NULL;

-- Step 6b: add arena_session_id FK
ALTER TABLE player_answers
  ADD COLUMN IF NOT EXISTS arena_session_id UUID
    REFERENCES arena_sessions(id) ON DELETE CASCADE;

-- Step 6c: index for arena session answer lookup
CREATE INDEX IF NOT EXISTS idx_pa_arena_session
  ON player_answers (arena_session_id)
  WHERE arena_session_id IS NOT NULL;


-- ── 7. RLS: arena_sessions ────────────────────────────────────────────────────

ALTER TABLE arena_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_session_players ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- arena_sessions: any authenticated user can read; service role writes
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='arena_sessions' AND policyname='arena_sessions_select'
  ) THEN
    CREATE POLICY "arena_sessions_select"
      ON arena_sessions FOR SELECT TO authenticated USING (true);
  END IF;
  -- arena_sessions insert: authenticated (from multiplayer.html stub until service role takes over)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='arena_sessions' AND policyname='arena_sessions_insert'
  ) THEN
    CREATE POLICY "arena_sessions_insert"
      ON arena_sessions FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='arena_sessions' AND policyname='arena_sessions_update'
  ) THEN
    CREATE POLICY "arena_sessions_update"
      ON arena_sessions FOR UPDATE TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  -- arena_session_players: read all; insert/delete own rows only
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='arena_session_players' AND policyname='asp_select'
  ) THEN
    CREATE POLICY "asp_select"
      ON arena_session_players FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='arena_session_players' AND policyname='asp_insert'
  ) THEN
    CREATE POLICY "asp_insert"
      ON arena_session_players FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='arena_session_players' AND policyname='asp_delete'
  ) THEN
    CREATE POLICY "asp_delete"
      ON arena_session_players FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;


-- ── 8. RLS: player_answers — add arena session path ───────────────────────────

-- Drop and recreate the insert policy to add the arena session participant path.
-- The original league-member path is preserved unchanged.

DROP POLICY IF EXISTS "pa_insert_self" ON player_answers;

CREATE POLICY "pa_insert_self" ON player_answers
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    -- PATH A: League answer — must be a league member
    AND (
      (
        league_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM league_members
          WHERE league_id = player_answers.league_id
            AND user_id   = auth.uid()
        )
      )
      OR
      -- PATH B: Arena session answer — must be a session participant
      (
        arena_session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM arena_session_players
          WHERE session_id = player_answers.arena_session_id
            AND user_id    = auth.uid()
        )
      )
    )
    -- Question must still be open (both paths)
    AND EXISTS (
      SELECT 1 FROM questions q
      WHERE q.id                = player_answers.question_id
        AND q.resolution_status = 'pending'
        AND coalesce(q.answer_closes_at, q.deadline) > now()
    )
  );

-- Update the select policy to include arena session participants
DROP POLICY IF EXISTS "pa_select_member" ON player_answers;

CREATE POLICY "pa_select_member" ON player_answers
  FOR SELECT USING (
    user_id = auth.uid()
    OR (
      -- League answers: visible to league members
      league_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM league_members
        WHERE league_id = player_answers.league_id
          AND user_id   = auth.uid()
      )
    )
    OR (
      -- Arena answers: visible to session participants
      arena_session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM arena_session_players
        WHERE session_id = player_answers.arena_session_id
          AND user_id    = auth.uid()
      )
    )
  );

-- questions: arena session questions readable by session participants
DROP POLICY IF EXISTS "questions_select_arena" ON questions;

CREATE POLICY "questions_select_arena" ON questions
  FOR SELECT TO authenticated USING (
    -- Original: public read (questions table already has public read via its existing policy)
    true
  );


-- ── 9. Realtime: arena_sessions ───────────────────────────────────────────────
-- arena-session.html subscribes to session status changes (waiting → active → completed)
-- and to player score updates.
ALTER PUBLICATION supabase_realtime ADD TABLE arena_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE arena_session_players;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'questions'
  AND column_name  IN ('league_id', 'arena_session_id')
ORDER BY column_name;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'player_answers'
  AND column_name  IN ('league_id', 'arena_session_id')
ORDER BY column_name;
