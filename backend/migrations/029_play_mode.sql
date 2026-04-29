-- Migration 029: play_mode column on leagues
-- Adds play_mode = 'singleplayer' | 'multiplayer' to the leagues table.
--
-- play_mode is INDEPENDENT of subscription tier.
-- It controls the gameplay experience:
--   'multiplayer' (default) — social competition, invite friends, leaderboard
--   'singleplayer'          — solo session, just the player vs the match, max_members = 1
--
-- Tier controls remain unchanged:
--   - liveQuestionsPerMatch cap applies to BOTH modes
--   - realWorldQuestionsEnabled gating applies to BOTH modes
--   - leaguesCreatePerWeek limit applies to BOTH modes
--   - All other tier limits apply identically regardless of play_mode

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS play_mode TEXT NOT NULL DEFAULT 'multiplayer'
    CHECK (play_mode IN ('singleplayer', 'multiplayer'));

CREATE INDEX IF NOT EXISTS idx_leagues_play_mode ON leagues (play_mode);

-- Backfill: all existing leagues are multiplayer (safe — no existing singleplayer data)
UPDATE leagues SET play_mode = 'multiplayer' WHERE play_mode IS NULL;
