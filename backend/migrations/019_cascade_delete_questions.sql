-- 019_cascade_delete_questions.sql
-- Adds ON DELETE CASCADE to questions.league_id so that deleting a league
-- automatically removes its questions at the DB level.
--
-- Also cleans up any orphaned questions whose league no longer exists
-- (e.g. leagues deleted before this migration was applied).
--
-- Background: previously deleteLeague() only deleted the leagues row.
-- Questions were left behind as orphans, causing the live-stats-poller
-- to keep hitting the API every minute for fixtures tied to deleted leagues.
--
-- Fix 1: DB-level cascade (this migration)
-- Fix 2: Client-side cascade in SpontixStoreAsync.deleteLeague() (spontix-store.js)
-- Both layers now enforce cleanup — defense in depth.

-- ── Step 1: Clean up existing orphaned questions ──────────────────────
-- Void pending questions whose league no longer exists, then delete all.
UPDATE questions
SET resolution_status = 'voided'
WHERE resolution_status = 'pending'
  AND league_id NOT IN (SELECT id FROM leagues);

DELETE FROM player_answers
WHERE question_id IN (
  SELECT id FROM questions
  WHERE league_id NOT IN (SELECT id FROM leagues)
);

DELETE FROM questions
WHERE league_id NOT IN (SELECT id FROM leagues);

-- ── Step 2: Re-add questions.league_id FK with ON DELETE CASCADE ──────
-- Drop the existing FK constraint (Postgres auto-names it questions_league_id_fkey)
ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_league_id_fkey;

-- Re-add with CASCADE so deleting a league removes its questions automatically
ALTER TABLE questions
  ADD CONSTRAINT questions_league_id_fkey
  FOREIGN KEY (league_id)
  REFERENCES leagues (id)
  ON DELETE CASCADE;

-- ── Step 3: Also cascade league_members ──────────────────────────────
ALTER TABLE league_members
  DROP CONSTRAINT IF EXISTS league_members_league_id_fkey;

ALTER TABLE league_members
  ADD CONSTRAINT league_members_league_id_fkey
  FOREIGN KEY (league_id)
  REFERENCES leagues (id)
  ON DELETE CASCADE;
