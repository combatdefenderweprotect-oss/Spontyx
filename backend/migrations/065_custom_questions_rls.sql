-- 065_custom_questions_rls.sql
--
-- RLS additions for Custom Questions (migration 064 prerequisite).
--
-- Rules enforced:
--   1. questions SELECT — existing policy already allows league members to read
--      questions for their league. Custom questions follow the same rule.
--      No change needed here (source column is transparent to the selector).
--
--   2. player_answers SELECT — existing "pa_select_member" allows any league
--      member to SELECT all answers in their league. For custom questions, we
--      must prevent the admin from reading other players' answers before the
--      question is resolved (anti-gaming). We replace the policy with one that
--      adds this guard.
--
--   3. player_answers INSERT — existing "pa_insert_self" enforces:
--        (a) user is league member
--        (b) question window is open (coalesce(answer_closes_at, deadline) > now())
--        (c) question is pending
--      This already works for custom questions — no change needed.
--      NOTE: custom questions use INSERT-only (no upsert) to prevent answer edits.
--      The Edge Function enforces the no-edit rule server-side.
--
-- Idempotent. Safe to re-run.

-- ── 1. Replace player_answers SELECT policy ──────────────────────────────────
-- New rule: a league member can see a player_answer IF:
--   (a) it is their own answer  [always]
--   OR
--   (b) the question is NOT a custom question  [system questions: open visibility]
--   OR
--   (c) the custom question has been resolved (custom_resolution_status = 'resolved')
--        [custom: visible after resolution so leaderboard reflects correct scores]
--
-- This prevents admin from querying other players' picks before the deadline
-- passes and they submit the correct answers.

DROP POLICY IF EXISTS "pa_select_member" ON public.player_answers;

CREATE POLICY "pa_select_member" ON public.player_answers
  FOR SELECT USING (
    -- Must be a league member
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE  lm.league_id = player_answers.league_id
        AND  lm.user_id   = auth.uid()
    )
    -- AND one of:
    AND (
      -- (a) own answer — always visible
      player_answers.user_id = auth.uid()
      OR
      -- (b) system question — no restriction
      NOT EXISTS (
        SELECT 1 FROM public.questions q
        WHERE  q.id     = player_answers.question_id
          AND  q.source = 'custom'
      )
      OR
      -- (c) custom question that has been resolved
      EXISTS (
        SELECT 1 FROM public.questions q
        WHERE  q.id                      = player_answers.question_id
          AND  q.source                  = 'custom'
          AND  q.custom_resolution_status = 'resolved'
      )
    )
  );

COMMENT ON POLICY "pa_select_member" ON public.player_answers IS
  'migration 065. Extended from 004/006: adds custom question guard — other players'' answers on unresolved custom questions are hidden until the admin resolves the question.';

-- ── 2. questions INSERT policy for custom questions ──────────────────────────
-- The existing questions INSERT policy (if any) allows service_role inserts.
-- Custom questions are always inserted via the Edge Function using service_role,
-- which bypasses RLS. No additional policy needed.

-- ── 3. Verify policies ───────────────────────────────────────────────────────

SELECT policyname, cmd, qual
FROM   pg_policies
WHERE  tablename = 'player_answers'
  AND  schemaname = 'public';
