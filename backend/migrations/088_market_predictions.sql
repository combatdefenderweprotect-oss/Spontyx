-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 088: Spontyx Market — Predictions
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_predictions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid          NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question_id     uuid          NOT NULL REFERENCES public.market_questions(id) ON DELETE CASCADE,
  fixture_id      integer       NOT NULL,  -- denormalised for fast match-level queries

  selected_answer text          NOT NULL,
  stake           numeric(12,2) NOT NULL CHECK (stake > 0),
  confidence      text          NOT NULL CHECK (confidence IN ('safe', 'confident', 'bold')),
  max_loss        numeric(12,2) NOT NULL CHECK (max_loss > 0),
  reward_on_win   numeric(12,2) NOT NULL CHECK (reward_on_win > 0),

  -- Status lifecycle: placed → locked → won | lost | void | refunded
  status          text          NOT NULL DEFAULT 'placed'
                                CHECK (status IN ('placed','locked','won','lost','void','refunded')),

  placed_at       timestamptz   NOT NULL DEFAULT now(),
  resolved_at     timestamptz,

  -- One prediction per user per question
  UNIQUE (user_id, question_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_mp_user_status
  ON public.market_predictions (user_id, status, placed_at DESC);

CREATE INDEX IF NOT EXISTS idx_mp_question
  ON public.market_predictions (question_id, status);

CREATE INDEX IF NOT EXISTS idx_mp_fixture_user
  ON public.market_predictions (fixture_id, user_id);

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.market_predictions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own predictions
CREATE POLICY "mp_select_own"
  ON public.market_predictions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role handles all mutations via SECURITY DEFINER RPCs
