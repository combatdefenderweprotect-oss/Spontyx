-- Migration 030: Multiplayer lobby / matchmaking system
-- Creates match_lobbies + match_lobby_players tables.
-- Adds lobby_id + multiplayer_mode columns to leagues.
-- Enables Realtime publication on both new tables.
--
-- Run in Supabase SQL editor before deploying the multiplayer.html page.

-- ── match_lobbies ──────────────────────────────────────────────────────────
-- One row per matchmaking session. Lifecycle: waiting → ready → active → finished.
CREATE TABLE IF NOT EXISTS match_lobbies (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         TEXT          NOT NULL,
  half_scope       TEXT          NOT NULL DEFAULT 'full_match'
                     CHECK (half_scope IN ('first_half', 'second_half', 'full_match')),
  mode             TEXT          NOT NULL CHECK (mode IN ('1v1', '2v2')),
  status           TEXT          NOT NULL DEFAULT 'waiting'
                     CHECK (status IN ('waiting', 'ready', 'active', 'finished')),
  home_team_name   TEXT,
  away_team_name   TEXT,
  kickoff_at       TIMESTAMPTZ,
  api_league_id    INTEGER,
  -- Filled once the game league is auto-created (triggers redirect on all clients)
  league_id        UUID          REFERENCES leagues(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ
);

-- ── match_lobby_players ────────────────────────────────────────────────────
-- One row per player per lobby.
-- team_number: 1 or 2. Assigned at join time.
-- is_invited: TRUE when player joined via a shared invite link (not matchmaking).
CREATE TABLE IF NOT EXISTS match_lobby_players (
  lobby_id     UUID    NOT NULL REFERENCES match_lobbies(id) ON DELETE CASCADE,
  user_id      UUID    NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  team_number  INTEGER CHECK (team_number IN (1, 2)),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_invited   BOOLEAN     NOT NULL DEFAULT false,
  invited_by   UUID        REFERENCES auth.users(id),
  PRIMARY KEY (lobby_id, user_id)
);

-- ── Indexes ────────────────────────────────────────────────────────────────
-- Fast matchmaking lookup: find waiting lobby for this match+half+mode
CREATE INDEX IF NOT EXISTS idx_match_lobbies_matchmaking
  ON match_lobbies (match_id, half_scope, mode, status)
  WHERE status = 'waiting';

-- Per-user active lobby lookup (leave cleanup, rejoin detection)
CREATE INDEX IF NOT EXISTS idx_match_lobby_players_user
  ON match_lobby_players (user_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_lobby_players_lobby
  ON match_lobby_players (lobby_id, joined_at ASC);

-- ── leagues: add multiplayer columns ──────────────────────────────────────
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS lobby_id          UUID REFERENCES match_lobbies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS multiplayer_mode  TEXT CHECK (multiplayer_mode IN ('1v1', '2v2'));

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE match_lobbies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_lobby_players  ENABLE ROW LEVEL SECURITY;

-- match_lobbies: any authenticated user can read/insert/update (status updates etc.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='match_lobbies' AND policyname='lobbies_select') THEN
    CREATE POLICY "lobbies_select" ON match_lobbies FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='match_lobbies' AND policyname='lobbies_insert') THEN
    CREATE POLICY "lobbies_insert" ON match_lobbies FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='match_lobbies' AND policyname='lobbies_update') THEN
    CREATE POLICY "lobbies_update" ON match_lobbies FOR UPDATE TO authenticated USING (true);
  END IF;
END $$;

-- match_lobby_players: read all; insert/delete own rows only
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='match_lobby_players' AND policyname='mlp_select') THEN
    CREATE POLICY "mlp_select" ON match_lobby_players FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='match_lobby_players' AND policyname='mlp_insert') THEN
    CREATE POLICY "mlp_insert" ON match_lobby_players FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='match_lobby_players' AND policyname='mlp_delete') THEN
    CREATE POLICY "mlp_delete" ON match_lobby_players FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Lobby waiting room uses Realtime so all players see joins in real time.
ALTER PUBLICATION supabase_realtime ADD TABLE match_lobbies;
ALTER PUBLICATION supabase_realtime ADD TABLE match_lobby_players;
