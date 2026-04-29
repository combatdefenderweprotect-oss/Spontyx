-- ── Migration 026: REAL_WORLD player database ────────────────────────────────
-- Adds teams, players, and team_players tables for the soccer-first REAL_WORLD
-- news query architecture. Auto-populated from live_match_stats by the
-- live-stats-poller Edge Function.
--
-- Design principles:
--   - Natural-key primary keys (sport + external_id) — no UUID lookups needed
--   - team_players.relevance_score accumulates from lineup + event data
--   - Decay handled at read time (filter last_seen_at > 90 days)
--   - RPC functions keep complex SQL in the DB layer
--
-- Deploy order:
--   1. Run this migration in Supabase SQL editor
--   2. Deploy updated live-stats-poller Edge Function
--   3. Deploy updated generate-questions Edge Function
-- ─────────────────────────────────────────────────────────────────────────────

-- ── teams ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.teams (
  sport              TEXT        NOT NULL,
  external_team_id   TEXT        NOT NULL,
  name               TEXT        NOT NULL,
  aliases            TEXT[]      DEFAULT '{}',
  league             TEXT        DEFAULT '',
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (sport, external_team_id)
);

CREATE INDEX IF NOT EXISTS idx_teams_sport_name
  ON public.teams (sport, lower(name));

-- ── players ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.players (
  sport                TEXT        NOT NULL,
  external_player_id   TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (sport, external_player_id)
);

CREATE INDEX IF NOT EXISTS idx_players_sport_name
  ON public.players (sport, lower(name));

-- ── team_players ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_players (
  sport                TEXT        NOT NULL,
  external_team_id     TEXT        NOT NULL,
  external_player_id   TEXT        NOT NULL,
  position             TEXT,
  shirt_number         INTEGER,
  status               TEXT        DEFAULT 'active'
                         CHECK (status IN ('active', 'inactive', 'unknown')),
  relevance_score      INTEGER     NOT NULL DEFAULT 0
                         CHECK (relevance_score >= 0),
  last_seen_at         TIMESTAMPTZ DEFAULT now(),
  source               TEXT        NOT NULL DEFAULT 'lineup'
                         CHECK (source IN ('lineup', 'event', 'news', 'manual')),
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (sport, external_team_id, external_player_id),
  FOREIGN KEY (sport, external_team_id)
    REFERENCES public.teams (sport, external_team_id) ON DELETE CASCADE,
  FOREIGN KEY (sport, external_player_id)
    REFERENCES public.players (sport, external_player_id) ON DELETE CASCADE
);

-- Top-player query index (the main read path for PLAYER BOOST)
CREATE INDEX IF NOT EXISTS idx_team_players_by_relevance
  ON public.team_players (sport, external_team_id, relevance_score DESC);

-- Decay filter index (filter out stale players)
CREATE INDEX IF NOT EXISTS idx_team_players_last_seen
  ON public.team_players (sport, last_seen_at DESC);

-- ── Add events_synced column to live_match_stats ───────────────────────────
-- Prevents re-incrementing relevance scores every time a done match is polled.

ALTER TABLE public.live_match_stats
  ADD COLUMN IF NOT EXISTS events_synced BOOLEAN DEFAULT false;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Public read (needed by browser + Edge Functions via service role).
-- Write is service-role only (via SECURITY DEFINER functions below).

ALTER TABLE public.teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_players ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'teams' AND policyname = 'public_read_teams'
  ) THEN
    CREATE POLICY public_read_teams        ON public.teams        FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'players' AND policyname = 'public_read_players'
  ) THEN
    CREATE POLICY public_read_players      ON public.players      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_players' AND policyname = 'public_read_team_players'
  ) THEN
    CREATE POLICY public_read_team_players ON public.team_players FOR SELECT USING (true);
  END IF;
END $$;

GRANT SELECT ON public.teams        TO authenticated, anon;
GRANT SELECT ON public.players      TO authenticated, anon;
GRANT SELECT ON public.team_players TO authenticated, anon;

-- ── RPC: sync_lineup_players ───────────────────────────────────────────────
-- Called once per fixture when lineups are first fetched.
-- Upserts teams, players, and team_players in a single SQL batch.
-- Uses GREATEST() for relevance_score so existing scores are never downgraded.
--
-- p_players JSONB: array of
--   { player_id TEXT, player_name TEXT, team_id TEXT,
--     pos TEXT, number INTEGER, is_starter BOOLEAN }

CREATE OR REPLACE FUNCTION public.sync_lineup_players(
  p_sport     TEXT,
  p_home_id   TEXT,
  p_home_name TEXT,
  p_away_id   TEXT,
  p_away_name TEXT,
  p_players   JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           RECORD;
  base_score  INTEGER;
BEGIN
  -- Ensure both teams exist
  INSERT INTO public.teams (sport, external_team_id, name, updated_at)
    VALUES
      (p_sport, p_home_id, p_home_name, now()),
      (p_sport, p_away_id, p_away_name, now())
    ON CONFLICT (sport, external_team_id) DO UPDATE
      SET name       = EXCLUDED.name,
          updated_at = now();

  -- Process each player entry
  FOR r IN
    SELECT *
    FROM jsonb_to_recordset(p_players) AS x(
      player_id   TEXT,
      player_name TEXT,
      team_id     TEXT,
      pos         TEXT,
      number      INTEGER,
      is_starter  BOOLEAN
    )
  LOOP
    -- Skip rows with missing IDs
    CONTINUE WHEN r.player_id IS NULL OR r.team_id IS NULL;

    -- Ensure player record exists
    INSERT INTO public.players (sport, external_player_id, name, updated_at)
      VALUES (p_sport, r.player_id, r.player_name, now())
      ON CONFLICT (sport, external_player_id) DO UPDATE
        SET name       = EXCLUDED.name,
            updated_at = now();

    -- Base relevance: starting XI = 10, substitute = 4
    base_score := CASE WHEN r.is_starter THEN 10 ELSE 4 END;

    -- Upsert team_player — GREATEST ensures scores only ever increase here
    INSERT INTO public.team_players (
      sport, external_team_id, external_player_id,
      position, shirt_number, relevance_score, last_seen_at, source, updated_at
    )
    VALUES (
      p_sport, r.team_id, r.player_id,
      r.pos, r.number, base_score, now(), 'lineup', now()
    )
    ON CONFLICT (sport, external_team_id, external_player_id) DO UPDATE
      SET position        = COALESCE(EXCLUDED.position, team_players.position),
          shirt_number    = COALESCE(EXCLUDED.shirt_number, team_players.shirt_number),
          relevance_score = GREATEST(team_players.relevance_score, EXCLUDED.relevance_score),
          last_seen_at    = now(),
          updated_at      = now();
  END LOOP;
END;
$$;

-- ── RPC: sync_match_events ─────────────────────────────────────────────────
-- Called once per fixture when the match finishes (events_synced = false).
-- Bumps relevance scores from goals (scorer +8, assist +6) and cards (+5).
-- Caps individual player relevance_score at 100.
--
-- p_events JSONB: array of
--   { player_id TEXT, team_id TEXT, event_type TEXT,
--     assist_id TEXT, assist_team_id TEXT }

CREATE OR REPLACE FUNCTION public.sync_match_events(
  p_sport   TEXT,
  p_events  JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r     RECORD;
  delta INTEGER;
BEGIN
  FOR r IN
    SELECT *
    FROM jsonb_to_recordset(p_events) AS x(
      player_id      TEXT,
      team_id        TEXT,
      event_type     TEXT,
      assist_id      TEXT,
      assist_team_id TEXT
    )
  LOOP
    -- Scorer delta
    delta := CASE
      WHEN r.event_type = 'Goal' THEN 8
      WHEN r.event_type = 'Card' THEN 5
      ELSE 0
    END;

    IF delta > 0 AND r.player_id IS NOT NULL AND r.team_id IS NOT NULL THEN
      UPDATE public.team_players
        SET relevance_score = LEAST(100, relevance_score + delta),
            updated_at      = now()
        WHERE sport              = p_sport
          AND external_team_id   = r.team_id
          AND external_player_id = r.player_id;
    END IF;

    -- Assist bonus (+6, only for Goal events)
    IF r.event_type = 'Goal' AND r.assist_id IS NOT NULL AND r.assist_team_id IS NOT NULL THEN
      UPDATE public.team_players
        SET relevance_score = LEAST(100, relevance_score + 6),
            updated_at      = now()
        WHERE sport              = p_sport
          AND external_team_id   = r.assist_team_id
          AND external_player_id = r.assist_id;
    END IF;
  END LOOP;
END;
$$;

-- ── Grant execute on RPC functions to service role ─────────────────────────
GRANT EXECUTE ON FUNCTION public.sync_lineup_players TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_match_events   TO service_role;
