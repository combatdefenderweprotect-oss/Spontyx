-- Migration 046: BR Rating Columns on Users
--
-- Adds Battle Royale rating tracking to the users table.
-- br_rating is a separate system from arena_rating:
--   - arena_rating: 1v1 / 2v2 head-to-head, floor 500
--   - br_rating:    BR survival (free-for-all), floor 0, clamp ±18
--
-- Rating formula (mirrors br-elo.js — kept in sync):
--   K-factor: 32 (<10 games), 24 (10–29 games), 20 (≥30 games)
--   Actual:   (lobbySize − placement) / (lobbySize − 1)
--   Expected: 1 / (1 + 10^((avgOpponentsElo − playerElo) / 400))
--   Raw:      K × (actual − expected)
--   Clamped:  max(−18, min(+18, raw)) → rounded integer
--   Floor:    max(0, br_rating + delta)
--
-- br_rating columns are independent of this migration being run in any
-- particular order — they add no FKs and do not depend on 040–045.
-- Run in any order relative to those migrations, but must run before
-- finalize_br_session() RPC (Phase 3) attempts to write rating updates.


-- ── 1. Add br_rating columns to users ─────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS br_rating            INTEGER     NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS br_games_played      INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS br_rating_updated_at TIMESTAMPTZ;

-- Leaderboard index (only users who have played at least one ranked BR game)
CREATE INDEX IF NOT EXISTS idx_users_br_rating
  ON users (br_rating DESC)
  WHERE br_games_played > 0;


-- ── 2. Add br_rating snapshot columns to br_session_players ───────────────────
-- Stores the before/after snapshot for each player in each session.
-- Written by finalize_br_session() (Phase 3).

ALTER TABLE br_session_players
  ADD COLUMN IF NOT EXISTS br_rating_before INTEGER,
  ADD COLUMN IF NOT EXISTS br_rating_after  INTEGER,
  ADD COLUMN IF NOT EXISTS br_rating_delta  INTEGER;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'users'
  AND column_name  IN ('br_rating', 'br_games_played', 'br_rating_updated_at')
ORDER BY column_name;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'br_session_players'
  AND column_name  IN ('br_rating_before', 'br_rating_after', 'br_rating_delta')
ORDER BY column_name;
