-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 089: Spontyx Market — Match Leagues
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_match_leagues (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id        integer       NOT NULL REFERENCES public.api_football_fixtures(fixture_id) ON DELETE CASCADE,
  name              text          NOT NULL,
  description       text,
  entry_fee         numeric(12,2) NOT NULL DEFAULT 50.00 CHECK (entry_fee >= 0),
  max_participants  integer,      -- null = unlimited
  reward_coins      numeric(12,2) NOT NULL DEFAULT 0,
  reward_xp         integer       NOT NULL DEFAULT 0,
  -- optional trophies awarded to top finishers
  trophy_slug       text,

  -- Status: open → closed (at kickoff) → resolved (after match)
  status            text          NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'closed', 'resolved', 'cancelled')),

  created_by        uuid          REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_match_league_members (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  match_league_id  uuid         NOT NULL REFERENCES public.market_match_leagues(id) ON DELETE CASCADE,
  user_id          uuid         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entry_paid_at    timestamptz  NOT NULL DEFAULT now(),
  final_rank       integer,
  coins_won        numeric(12,2) NOT NULL DEFAULT 0,
  xp_won           integer       NOT NULL DEFAULT 0,
  UNIQUE (match_league_id, user_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_mml_fixture_status
  ON public.market_match_leagues (fixture_id, status);

CREATE INDEX IF NOT EXISTS idx_mmlm_user
  ON public.market_match_league_members (user_id, match_league_id);

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.market_match_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_match_league_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mml_select_authenticated"
  ON public.market_match_leagues FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "mmlm_select_authenticated"
  ON public.market_match_league_members FOR SELECT
  TO authenticated USING (true);
