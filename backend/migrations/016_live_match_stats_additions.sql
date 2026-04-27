-- 016_live_match_stats_additions.sql
-- Adds injuries, odds, and sidelined data to live_match_stats
-- Run in Supabase SQL Editor before deploying the updated live-stats-poller
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE live_match_stats
  ADD COLUMN IF NOT EXISTS injuries        jsonb,   -- [{player_id, player_name, team_id, team_name, reason, type}]
  ADD COLUMN IF NOT EXISTS odds            jsonb,   -- {bookmaker, match_winner, over_under, both_teams_score}
  ADD COLUMN IF NOT EXISTS sidelined       jsonb,   -- {player_id: [{reason, start, end}]} — history for each injured player

  ADD COLUMN IF NOT EXISTS injuries_polled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS odds_polled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sidelined_polled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN live_match_stats.injuries  IS
  'Players absent from squad for this fixture (injured or suspended). '
  'Fetched once via /injuries?fixture={id}. Polled pre-match or on first cycle.';

COMMENT ON COLUMN live_match_stats.odds IS
  'Betting odds snapshot. Fetched once via /odds?fixture={id}. '
  'Stores Match Winner, Goals Over/Under, and Both Teams Score from the first available bookmaker.';

COMMENT ON COLUMN live_match_stats.sidelined IS
  'Injury history for each player in the injuries list. '
  'Fetched once per injured player via /sidelined?player={id}. Capped at 5 players to limit API usage.';
