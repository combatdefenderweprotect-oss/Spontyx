-- 015_live_match_stats.sql
-- Live match statistics cache table + fixture_id column on leagues
-- Used by the live-stats-poller Edge Function and the Stats tab in league.html
--
-- Run this in Supabase SQL Editor before deploying the live-stats-poller Edge Function.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add optional direct fixture reference to leagues
--    (used by Match Live quick-create and future scheduler)
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS fixture_id bigint;
CREATE INDEX IF NOT EXISTS idx_leagues_fixture_id ON leagues(fixture_id) WHERE fixture_id IS NOT NULL;

-- 2. Live match stats cache table
--    One row per API-Sports fixture. Upserted by the poller Edge Function every minute.
--    Columns mirror the API-Sports response shapes after normalisation.
CREATE TABLE IF NOT EXISTS live_match_stats (
  fixture_id          bigint PRIMARY KEY,

  -- Match identity
  status              text NOT NULL DEFAULT 'NS',   -- NS | 1H | HT | 2H | ET | P | BT | INT | FT | AET | PEN | PST | CANC | ABD
  minute              integer,                       -- current elapsed minute (null when not live)
  home_team_id        integer,
  away_team_id        integer,
  home_team_name      text,
  away_team_name      text,
  home_logo           text,                          -- URL from API-Sports
  away_logo           text,
  home_score          integer NOT NULL DEFAULT 0,
  away_score          integer NOT NULL DEFAULT 0,
  competition_name    text,
  kickoff_at          timestamptz,

  -- Live / post-match data (polled every cycle while match active)
  events              jsonb,   -- [{time, extra, type, detail, team_id, team_name, player_name, player_id, assist_name, assist_id}]
  team_stats          jsonb,   -- {home: {shots_total, shots_on_goal, possession, corners, fouls, yellow_cards, red_cards, offsides, saves, passes_total, passes_accuracy}, away: {...}}
  player_stats        jsonb,   -- {home: [{id, name, number, pos, minutes, rating, goals, assists, shots_total, shots_on_goal, saves, fouls_committed, fouls_drawn, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved}], away: [...]}

  -- One-time data (fetched once, never re-fetched)
  lineups             jsonb,   -- {home: {formation, coach, players:[{id,name,number,pos,grid}], substitutes:[...]}, away: {...}}
  predictions         jsonb,   -- {winner_team_id, winner_name, home_win_pct, draw_pct, away_win_pct, advice, goals_home, goals_away, under_over, form_home, form_away, att_home, att_away, def_home, def_away}
  head_to_head        jsonb,   -- [{date, home_team, home_team_id, away_team, away_team_id, home_score, away_score, winner_id}] — last 5

  -- Poll control flags (prevent redundant API calls)
  lineups_polled      boolean NOT NULL DEFAULT false,
  predictions_polled  boolean NOT NULL DEFAULT false,
  h2h_polled          boolean NOT NULL DEFAULT false,

  -- Freshness
  last_polled_at      timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE live_match_stats IS
  'Cache of live / post-match API-Sports data, upserted by the live-stats-poller Edge Function. '
  'Populated for any fixture referenced by an active question or a league with fixture_id set. '
  'Public read-only. Service role writes only.';

-- 3. RLS
ALTER TABLE live_match_stats ENABLE ROW LEVEL SECURITY;

-- Authenticated and anonymous users can read (Stats tab makes direct Supabase queries)
CREATE POLICY "lms_public_read"
  ON live_match_stats FOR SELECT USING (true);

-- Only the Edge Function (service role) may insert or update
CREATE POLICY "lms_service_insert"
  ON live_match_stats FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "lms_service_update"
  ON live_match_stats FOR UPDATE
  USING (auth.role() = 'service_role');

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_lms_status       ON live_match_stats(status);
CREATE INDEX IF NOT EXISTS idx_lms_polled       ON live_match_stats(last_polled_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_lms_kickoff      ON live_match_stats(kickoff_at);

-- 5. pg_cron schedule — fires every minute
--    The poller exits fast (~1 DB query) if no active fixtures are found.
--    Replace <<YOUR_CRON_SECRET>> with the value you set as CRON_SECRET in Supabase Secrets
--    (same secret used by 003_cron_schedule.sql and 004_player_answers.sql).
--
--    IMPORTANT: Only uncomment and run this block AFTER:
--      (a) setting the CRON_SECRET secret in Supabase Secrets dashboard
--      (b) deploying the live-stats-poller Edge Function
--
-- SELECT cron.schedule(
--   'live-stats-every-minute',
--   '* * * * *',
--   $$
--     SELECT net.http_get(
--       url     := 'https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/live-stats-poller',
--       headers := jsonb_build_object('Authorization', 'Bearer <<YOUR_CRON_SECRET>>')
--     )
--   $$
-- );
