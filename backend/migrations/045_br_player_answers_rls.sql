-- Migration 045: BR Player Answers RLS
--
-- Extends player_answers RLS policies to support the BR answer path (PATH C).
--
-- Three answer paths now exist:
--   PATH A — league member answering a league question
--   PATH B — arena session participant answering an arena question
--   PATH C — BR session player (not eliminated) answering a BR question


-- ── Add br_session_id column to player_answers ────────────────────────────────
-- Do this BEFORE recreating RLS policies so the column exists when PATH C
-- references player_answers.br_session_id in the WITH CHECK.

ALTER TABLE player_answers
  ADD COLUMN IF NOT EXISTS br_session_id UUID
    REFERENCES br_sessions (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_player_answers_br_session
  ON player_answers (br_session_id, question_id)
  WHERE br_session_id IS NOT NULL;


-- ── Drop and recreate insert policy ───────────────────────────────────────────

DROP POLICY IF EXISTS pa_insert_self ON player_answers;

CREATE POLICY "pa_insert_self"
  ON player_answers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      SELECT NOW() < COALESCE(q.answer_closes_at, q.deadline)
      FROM questions q
      WHERE q.id = player_answers.question_id
    )
    AND (
      -- PATH A: league member
      (
        league_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM league_members lm
          WHERE lm.league_id = player_answers.league_id
            AND lm.user_id   = auth.uid()
        )
      )
      OR
      -- PATH B: arena session participant
      (
        arena_session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM arena_session_players asp
          WHERE asp.session_id = player_answers.arena_session_id
            AND asp.user_id    = auth.uid()
        )
      )
      OR
      -- PATH C: active (non-eliminated) BR session player
      (
        br_session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM br_session_players bsp
          WHERE bsp.session_id    = player_answers.br_session_id
            AND bsp.user_id       = auth.uid()
            AND bsp.is_eliminated = false
        )
      )
    )
  );


-- ── Drop and recreate select policy ───────────────────────────────────────────

DROP POLICY IF EXISTS pa_select_member ON player_answers;

CREATE POLICY "pa_select_member"
  ON player_answers
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR
    (
      league_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM league_members lm
        WHERE lm.league_id = player_answers.league_id
          AND lm.user_id   = auth.uid()
      )
    )
    OR
    (
      arena_session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM arena_session_players asp
        WHERE asp.session_id = player_answers.arena_session_id
          AND asp.user_id    = auth.uid()
      )
    )
    OR
    (
      br_session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM br_session_players bsp
        WHERE bsp.session_id = player_answers.br_session_id
          AND bsp.user_id    = auth.uid()
      )
    )
  );


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'player_answers'
  AND policyname IN ('pa_insert_self', 'pa_select_member')
ORDER BY policyname;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'player_answers'
  AND column_name  = 'br_session_id';
