-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 012: API-Football cache tables
-- ════════════════════════════════════════════════════════════════════════
-- Purpose: Server-side cache for all API-Football data.
--          Edge Functions read from these tables instead of hitting the
--          API directly. The sync-fixtures Edge Function owns all writes.
--
-- Run in Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. Fixture index ──────────────────────────────────────────────────────
-- One row per fixture. Updated every minute for live matches, once daily
-- for upcoming. Covers PL (39) and La Liga (140) for MVP.

CREATE TABLE IF NOT EXISTS api_football_fixtures (
  fixture_id      integer       PRIMARY KEY,
  league_id       integer       NOT NULL,
  season          integer       NOT NULL,
  kickoff_at      timestamptz,
  status_short    text,
  -- NS = not started, 1H/2H = first/second half, HT = half time
  -- ET = extra time, BT = break extra time, P = penalties
  -- FT = full time, AET = after extra time, PEN = after penalties
  -- SUSP = suspended, INT = interrupted
  -- PST = postponed, CANC = cancelled, ABD = abandoned, TBD = to be defined
  status_elapsed  integer,       -- match minute (null when not started)
  home_team_id    integer,
  home_team_name  text,
  away_team_id    integer,
  away_team_name  text,
  home_goals      integer,
  away_goals      integer,
  home_winner     boolean,       -- true/false/null (null = draw or not finished)
  away_winner     boolean,
  venue_name      text,
  referee         text,
  round           text,          -- e.g. "Regular Season - 32"
  raw_fixture     jsonb,         -- full API response object for this fixture
  synced_at       timestamptz    DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_league_kickoff
  ON api_football_fixtures (league_id, kickoff_at);

CREATE INDEX IF NOT EXISTS idx_aff_status
  ON api_football_fixtures (status_short);

CREATE INDEX IF NOT EXISTS idx_aff_kickoff
  ON api_football_fixtures (kickoff_at);


-- ── 2. Match events ───────────────────────────────────────────────────────
-- Goals, cards, substitutions. Refreshed every minute during live matches.
-- UNIQUE constraint prevents duplicate rows on re-sync.

CREATE TABLE IF NOT EXISTS api_football_events (
  id              bigserial     PRIMARY KEY,
  fixture_id      integer       NOT NULL REFERENCES api_football_fixtures (fixture_id) ON DELETE CASCADE,
  time_elapsed    integer,
  time_extra      integer,
  team_id         integer,
  team_name       text,
  player_id       integer,
  player_name     text,
  assist_id       integer,
  assist_name     text,
  event_type      text,          -- Goal | Card | Subst | Var
  event_detail    text,          -- Normal Goal | Yellow Card | Red Card | Missed Penalty | etc.
  comments        text,
  synced_at       timestamptz    DEFAULT now()
);

-- Expression-based unique index (COALESCE not allowed in inline UNIQUE constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_afe_unique_event
  ON api_football_events (fixture_id, time_elapsed, team_id, event_type, COALESCE(player_id, 0));

CREATE INDEX IF NOT EXISTS idx_afe_fixture
  ON api_football_events (fixture_id);

CREATE INDEX IF NOT EXISTS idx_afe_fixture_type
  ON api_football_events (fixture_id, event_type);


-- ── 3. Team statistics per match ──────────────────────────────────────────
-- One row per team per fixture. Refreshed every 3 minutes during live.
-- Upserted on every sync (ON CONFLICT DO UPDATE).

CREATE TABLE IF NOT EXISTS api_football_statistics (
  fixture_id      integer       NOT NULL REFERENCES api_football_fixtures (fixture_id) ON DELETE CASCADE,
  team_id         integer       NOT NULL,
  team_name       text,
  shots_total     integer       DEFAULT 0,
  shots_on        integer       DEFAULT 0,
  shots_off       integer       DEFAULT 0,
  corners         integer       DEFAULT 0,
  yellow_cards    integer       DEFAULT 0,
  red_cards       integer       DEFAULT 0,
  fouls           integer       DEFAULT 0,
  offsides        integer       DEFAULT 0,
  possession_pct  integer       DEFAULT 0,  -- 0–100
  passes_total    integer       DEFAULT 0,
  passes_accurate integer       DEFAULT 0,
  raw_stats       jsonb,                    -- full statistics array from API
  synced_at       timestamptz   DEFAULT now(),
  PRIMARY KEY (fixture_id, team_id)
);


-- ── 4. Lineups ────────────────────────────────────────────────────────────
-- Fetched once ~1h before kickoff, re-checked once after kickoff if missing.
-- Rarely changes post-kickoff.

CREATE TABLE IF NOT EXISTS api_football_lineups (
  fixture_id      integer       NOT NULL REFERENCES api_football_fixtures (fixture_id) ON DELETE CASCADE,
  team_id         integer       NOT NULL,
  team_name       text,
  formation       text,          -- e.g. "4-3-3"
  coach_name      text,
  start_xi        jsonb,         -- [{id, name, number, pos, grid}]
  substitutes     jsonb,         -- same shape
  synced_at       timestamptz   DEFAULT now(),
  PRIMARY KEY (fixture_id, team_id)
);


-- ── 5. Standings cache ────────────────────────────────────────────────────
-- One row per team per league/season. Refreshed once daily.

CREATE TABLE IF NOT EXISTS api_football_standings (
  league_id       integer       NOT NULL,
  season          integer       NOT NULL,
  team_id         integer       NOT NULL,
  team_name       text,
  rank            integer,
  points          integer,
  played          integer,
  won             integer,
  drawn           integer,
  lost            integer,
  goals_for       integer,
  goals_against   integer,
  goal_diff       integer,
  form            text,          -- last 5 results: "WWDLW"
  description     text,          -- e.g. "Promotion - Champions League"
  synced_at       timestamptz   DEFAULT now(),
  PRIMARY KEY (league_id, season, team_id)
);

CREATE INDEX IF NOT EXISTS idx_afs_league_season_rank
  ON api_football_standings (league_id, season, rank);


-- ── 6. Sync audit log ─────────────────────────────────────────────────────
-- One row per sync invocation. Used to debug missed syncs and track
-- request counts against the Pro plan budget.

CREATE TABLE IF NOT EXISTS api_football_sync_log (
  id              bigserial     PRIMARY KEY,
  sync_type       text          NOT NULL,
  -- daily_fixtures | daily_standings | live_status | live_events
  -- live_stats | pre_match_lineups
  fixture_id      integer,       -- null for league-level syncs
  league_id       integer,       -- null for fixture-level syncs
  status          text          NOT NULL DEFAULT 'ok',
  -- ok | error | skipped (no relevant matches)
  requests_made   integer       DEFAULT 0,
  fixtures_synced integer       DEFAULT 0,
  error_message   text,
  ran_at          timestamptz   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_afsl_type_ran
  ON api_football_sync_log (sync_type, ran_at DESC);


-- ── 7. Row Level Security ─────────────────────────────────────────────────
-- All cache tables: public read (browser can query standings/fixtures),
-- service role only for writes (sync-fixtures Edge Function).

ALTER TABLE api_football_fixtures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_football_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_football_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_football_lineups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_football_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_football_sync_log  ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "public_read_fixtures"   ON api_football_fixtures   FOR SELECT USING (true);
CREATE POLICY "public_read_events"     ON api_football_events     FOR SELECT USING (true);
CREATE POLICY "public_read_statistics" ON api_football_statistics FOR SELECT USING (true);
CREATE POLICY "public_read_lineups"    ON api_football_lineups    FOR SELECT USING (true);
CREATE POLICY "public_read_standings"  ON api_football_standings  FOR SELECT USING (true);
CREATE POLICY "public_read_sync_log"   ON api_football_sync_log   FOR SELECT USING (true);

-- Service role write (Edge Functions use the service role key)
CREATE POLICY "service_write_fixtures"    ON api_football_fixtures   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_write_events"      ON api_football_events     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_write_statistics"  ON api_football_statistics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_write_lineups"     ON api_football_lineups    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_write_standings"   ON api_football_standings  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_write_sync_log"    ON api_football_sync_log   FOR ALL TO service_role USING (true) WITH CHECK (true);
