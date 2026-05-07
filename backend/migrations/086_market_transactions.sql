-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 086: Spontyx Market — Transaction Ledger
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_transactions (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type              text         NOT NULL CHECK (type IN (
                                   'stake_reserved', 'win_profit', 'loss_deduct',
                                   'refund', 'daily_bonus', 'entry_fee', 'entry_refund',
                                   'admin_credit', 'admin_debit'
                                 )),
  -- amount is the delta to balance_total (can be zero for stake_reserved/refund)
  amount            numeric(12,2) NOT NULL DEFAULT 0,
  -- reserved_delta is the delta to balance_reserved (+ = more reserved, - = released)
  reserved_delta    numeric(12,2) NOT NULL DEFAULT 0,
  -- snapshot after this transaction
  balance_after     numeric(12,2),
  prediction_id     uuid,
  match_league_id   uuid,
  note              text,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_mktx_user_created
  ON public.market_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mktx_prediction
  ON public.market_transactions (prediction_id)
  WHERE prediction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mktx_type
  ON public.market_transactions (type, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.market_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mktx_select_own"
  ON public.market_transactions FOR SELECT
  USING (auth.uid() = user_id);
