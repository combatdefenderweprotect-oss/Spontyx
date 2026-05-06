-- 067_scoring_leaderboard_fixes.sql
--
-- Scoring and leaderboard production fixes (2026-05-06).
--
-- 1. player_answers.voided BOOLEAN — distinguishes "voided after scoring"
--    from "wrong answer". Void handler now keeps is_correct as-is and sets
--    voided=true instead of forcing is_correct=false. UI reads voided to show
--    "Voided — points removed" state instead of the wrong-answer state.
--
-- 2. increment_user_total_points(UUID, INTEGER) RPC — atomic additive update
--    used by resolve-questions and custom-questions to keep users.total_points
--    in sync with player_answers.points_earned. Supports positive and negative
--    deltas (High/Very High confidence wrong answers decrement the column).
--
-- Idempotent. Additive only.

-- ── 1. player_answers.voided ─────────────────────────────────────────────────

ALTER TABLE public.player_answers
  ADD COLUMN IF NOT EXISTS voided BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.player_answers.voided IS
  'migration 067. True when a custom question was voided after this answer was
   already scored. is_correct retains its value at resolve time. points_earned
   is zeroed. Distinct from is_correct=false (a genuinely wrong answer).
   System-voided questions (before scoring) leave this column false.';

CREATE INDEX IF NOT EXISTS idx_pa_voided
  ON public.player_answers (question_id)
  WHERE voided = true;

-- ── 2. increment_user_total_points RPC ───────────────────────────────────────
--
-- Called by resolve-questions (league V2 branch) and custom-questions
-- (resolve + void rollback) via service_role after writing player_answers.
--
-- Using a SECURITY DEFINER function matches the pattern of existing RPCs
-- (increment_arena_player_score, award_xp) and keeps the UPDATE atomic.
-- p_delta may be negative — correct for High/Very High wrong-answer penalties
-- and for void-after-resolve rollbacks.

CREATE OR REPLACE FUNCTION public.increment_user_total_points(
  p_user_id UUID,
  p_delta   INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET    total_points = total_points + p_delta
  WHERE  id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.increment_user_total_points(UUID, INTEGER) IS
  'migration 067. Atomically increments (or decrements when p_delta < 0)
   users.total_points. Called by league resolvers after writing
   player_answers.points_earned. Negative delta used for void-after-resolve
   rollbacks and wrong-answer confidence penalties.';

GRANT EXECUTE ON FUNCTION public.increment_user_total_points(UUID, INTEGER)
  TO service_role;

-- ── Verify ────────────────────────────────────────────────────────────────────

SELECT column_name, data_type, column_default, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'player_answers'
  AND  column_name  = 'voided';

SELECT routine_name, routine_type
FROM   information_schema.routines
WHERE  routine_schema = 'public'
  AND  routine_name   = 'increment_user_total_points';
