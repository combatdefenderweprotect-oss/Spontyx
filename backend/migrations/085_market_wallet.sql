-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 085: Spontyx Market — Wallet System
-- ════════════════════════════════════════════════════════════════════════
-- Creates market_wallets table and auto-initialises a wallet for every
-- user (existing and future) with 1,000 starting coins.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Wallet table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.market_wallets (
  user_id            uuid         PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance_total      numeric(12,2) NOT NULL DEFAULT 1000.00 CHECK (balance_total >= 0),
  balance_reserved   numeric(12,2) NOT NULL DEFAULT 0.00    CHECK (balance_reserved >= 0),
  balance_available  numeric(12,2) NOT NULL DEFAULT 1000.00 CHECK (balance_available >= 0),
  xp_total           integer       NOT NULL DEFAULT 0       CHECK (xp_total >= 0),
  streak_correct     integer       NOT NULL DEFAULT 0       CHECK (streak_correct >= 0),
  last_bonus_at      timestamptz,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_wallet_balance CHECK (balance_available = balance_total - balance_reserved)
);

-- ── 2. Trigger: auto-create wallet on new user ────────────────────────

CREATE OR REPLACE FUNCTION public.create_market_wallet_for_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.market_wallets (user_id, balance_total, balance_available)
  VALUES (NEW.id, 1000.00, 1000.00)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_created_market_wallet ON public.users;
CREATE TRIGGER on_user_created_market_wallet
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.create_market_wallet_for_user();

-- ── 3. Backfill: create wallets for all existing users ────────────────

INSERT INTO public.market_wallets (user_id, balance_total, balance_available)
SELECT id, 1000.00, 1000.00
FROM public.users
ON CONFLICT (user_id) DO NOTHING;

-- ── 4. Updated_at trigger ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.market_wallet_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS set_market_wallet_updated_at ON public.market_wallets;
CREATE TRIGGER set_market_wallet_updated_at
  BEFORE UPDATE ON public.market_wallets
  FOR EACH ROW EXECUTE FUNCTION public.market_wallet_updated_at();

-- ── 5. RLS ────────────────────────────────────────────────────────────

ALTER TABLE public.market_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_select_own"
  ON public.market_wallets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "wallet_update_own"
  ON public.market_wallets FOR UPDATE
  USING (auth.uid() = user_id);

-- ── 6. Indexes ────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_market_wallets_xp
  ON public.market_wallets (xp_total DESC);
