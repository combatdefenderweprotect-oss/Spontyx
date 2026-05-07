-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 084 — Realtime publication + duel participant RLS
--
-- 1. Adds trivia_duel_queue + trivia_session_answers to the Supabase Realtime
--    publication so postgres_changes subscriptions receive events.
-- 2. Adds a SELECT policy on trivia_session_answers that lets both players in
--    a ranked_duel room read each other's answers.
--    Used by the frontend Realtime subscription for live opponent score tracking.
-- Depends: 077 (trivia_session_answers), 079 (trivia_rooms, trivia_duel_queue)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Enable Realtime on required tables ────────────────────────────────────
-- Safe to run multiple times: DO block ignores errors if table already added.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.trivia_duel_queue;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.trivia_session_answers;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- ── 2. Room-participant read policy on trivia_session_answers ─────────────────
-- Allows each player in a trivia_room to read the other player's answers.
-- Scope is intentionally narrow: only rows whose session belongs to a room
-- where the caller is player1 or player2.

DROP POLICY IF EXISTS tsa_select_duel_room_participant ON public.trivia_session_answers;

CREATE POLICY tsa_select_duel_room_participant ON public.trivia_session_answers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.trivia_rooms r
      JOIN public.trivia_sessions ts
        ON ts.room_id = r.id
       AND ts.id      = trivia_session_answers.session_id
      WHERE r.player1_id = auth.uid()
         OR r.player2_id = auth.uid()
    )
  );
