-- Migration 032: Clutch Answer System
-- Adds clutch detection infrastructure:
--   • clutch_context JSONB on questions  — snapshot at generation time (minute + score)
--   • is_clutch BOOLEAN on player_answers — set by resolver when clutch conditions are met
--   • clutch_answers counter on users     — incremented on each clutch answer
--   • player_xp_events table             — immutable XP audit trail

-- ── questions: clutch snapshot at generation ──────────────────────────
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS clutch_context JSONB;

-- ── player_answers: clutch flag ───────────────────────────────────────
ALTER TABLE player_answers
  ADD COLUMN IF NOT EXISTS is_clutch BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_player_answers_clutch
  ON player_answers (user_id, is_clutch)
  WHERE is_clutch = true;

-- ── users: lifetime clutch counter ───────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS clutch_answers INTEGER NOT NULL DEFAULT 0;

-- ── player_xp_events: immutable XP audit trail ───────────────────────
CREATE TABLE IF NOT EXISTS player_xp_events (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type         TEXT          NOT NULL,
  xp_amount          INTEGER       NOT NULL CHECK (xp_amount > 0),
  source_question_id UUID          REFERENCES questions(id) ON DELETE SET NULL,
  source_match_id    TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user
  ON player_xp_events (user_id, created_at DESC);

-- RLS: authenticated users can read their own XP events; service role writes
ALTER TABLE player_xp_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='player_xp_events' AND policyname='xp_events_select_own'
  ) THEN
    CREATE POLICY "xp_events_select_own"
      ON player_xp_events FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- ── increment_clutch_answers: atomic counter RPC ──────────────────────
-- Called by resolve-questions Edge Function (service role).
-- Increments users.clutch_answers by 1, returns the new value.
CREATE OR REPLACE FUNCTION increment_clutch_answers(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE users
     SET clutch_answers = clutch_answers + 1
   WHERE id = p_user_id
  RETURNING clutch_answers INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;
