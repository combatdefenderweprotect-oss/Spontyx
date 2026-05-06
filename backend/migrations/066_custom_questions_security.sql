-- 066_custom_questions_security.sql
--
-- Security hardening for Custom Questions (post-064/065 audit fixes).
--
-- Fixes:
--   1. q_update_admin RLS bypass (BLOCKER 2)
--      The existing q_update_admin policy (migration 002) allows the league
--      owner to UPDATE any columns on any questions row in their league,
--      including custom questions. An admin could overwrite custom_correct_answers
--      or custom_resolution_status directly from the browser client, bypassing
--      the Edge Function's tier limits, atomic claim guard, and audit log.
--      Fix: restrict the policy to system questions only (source IS NULL OR 'system').
--      Custom questions are always mutated via the Edge Function using service_role.
--
--   2. cqe_select_member audit log leak (BLOCKER 3)
--      The existing cqe_select_member policy (migration 064) allows all league
--      members to SELECT all custom_question_events rows for their league.
--      'answered' events were previously written with { selected_options } in
--      the payload — exposing every player's answer choices to all other members
--      before resolution. The Edge Function payload is now { answered: true }
--      (fixed in index.ts), but we also add a DB-level guard: 'answered' events
--      are only visible to the event's creator (created_by = auth.uid()) or
--      after the question is resolved, so even if a future payload regression
--      occurs the leak cannot propagate to other members.
--
-- Idempotent. Safe to re-run.

-- ── 1. Replace q_update_admin: restrict to system questions ─────────────────

DROP POLICY IF EXISTS "q_update_admin" ON public.questions;

CREATE POLICY "q_update_admin" ON public.questions
  FOR UPDATE USING (
    -- User must be the league owner
    EXISTS (
      SELECT 1 FROM public.leagues l
      WHERE l.id       = questions.league_id
        AND l.owner_id = auth.uid()
    )
    -- Only system (non-custom) questions — custom questions mutated via Edge Function only
    AND (questions.source IS NULL OR questions.source = 'system')
  );

COMMENT ON POLICY "q_update_admin" ON public.questions IS
  'migration 066. Updated from 002: owner may UPDATE only system questions. Custom questions (source=custom) are mutated exclusively via the custom-questions Edge Function using service_role.';

-- ── 2. Replace cqe_select_member: hide answered events before resolution ─────

DROP POLICY IF EXISTS "cqe_select_member" ON public.custom_question_events;

CREATE POLICY "cqe_select_member" ON public.custom_question_events
  FOR SELECT USING (
    -- Must be a league member
    EXISTS (
      SELECT 1
      FROM   public.questions q
      JOIN   public.league_members lm ON lm.league_id = q.league_id
      WHERE  q.id        = custom_question_events.question_id
        AND  lm.user_id  = auth.uid()
    )
    -- AND one of:
    AND (
      -- (a) not an answered event — all members can see created/published/resolved/voided
      custom_question_events.action <> 'answered'
      OR
      -- (b) it is their own answered event — always visible to creator
      custom_question_events.created_by = auth.uid()
      OR
      -- (c) the question has been resolved — answered events visible post-resolution
      EXISTS (
        SELECT 1 FROM public.questions q2
        WHERE  q2.id                      = custom_question_events.question_id
          AND  q2.custom_resolution_status = 'resolved'
      )
    )
  );

COMMENT ON POLICY "cqe_select_member" ON public.custom_question_events IS
  'migration 066. Updated from 064: answered events are hidden from other members until the question is resolved, preventing answer-snooping before the deadline.';

-- ── 3. Verify ────────────────────────────────────────────────────────────────

SELECT policyname, cmd, qual
FROM   pg_policies
WHERE  tablename IN ('questions', 'custom_question_events')
  AND  schemaname = 'public'
  AND  policyname IN ('q_update_admin', 'cqe_select_member')
ORDER BY tablename, policyname;
