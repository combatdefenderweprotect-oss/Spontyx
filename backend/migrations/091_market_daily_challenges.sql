-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 091: Spontyx Market — Daily Challenges
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_daily_challenges (
  slug            text    PRIMARY KEY,
  name            text    NOT NULL,
  description     text    NOT NULL,
  icon            text    NOT NULL DEFAULT '🎯',
  goal_type       text    NOT NULL CHECK (goal_type IN (
                            'predictions_placed', 'predictions_won',
                            'bold_placed', 'real_world_answered', 'league_joined'
                          )),
  goal_count      integer NOT NULL DEFAULT 1,
  reward_coins    numeric(12,2) NOT NULL DEFAULT 100,
  reward_xp       integer       NOT NULL DEFAULT 25,
  sort_order      integer       NOT NULL DEFAULT 0
);

INSERT INTO public.market_daily_challenges (slug, name, description, icon, goal_type, goal_count, reward_coins, reward_xp, sort_order)
VALUES
  ('daily_predictor',    'Daily Predictor',    'Place 5 predictions today',              '📋', 'predictions_placed',   5, 100.00, 25, 1),
  ('on_fire',            'On Fire',            'Win 3 predictions today',                '🔥', 'predictions_won',      3, 150.00, 40, 2),
  ('risk_taker',         'Risk Taker',         'Place 1 BOLD confidence prediction',     '💥', 'bold_placed',          1,  75.00, 20, 3),
  ('real_world_scout',   'Real World Scout',   'Answer 2 Real World Edge questions',     '🌍', 'real_world_answered',  2, 200.00, 50, 4),
  ('league_entrant',     'League Entrant',     'Join 1 Match League',                    '🏟', 'league_joined',        1,  50.00, 15, 5)
ON CONFLICT (slug) DO NOTHING;

-- ── User challenge progress (resets daily) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.market_user_challenge_progress (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  challenge_slug  text        NOT NULL REFERENCES public.market_daily_challenges(slug),
  challenge_date  date        NOT NULL DEFAULT current_date,
  progress        integer     NOT NULL DEFAULT 0,
  completed       boolean     NOT NULL DEFAULT false,
  completed_at    timestamptz,
  reward_claimed  boolean     NOT NULL DEFAULT false,
  UNIQUE (user_id, challenge_slug, challenge_date)
);

CREATE INDEX IF NOT EXISTS idx_mucp_user_date
  ON public.market_user_challenge_progress (user_id, challenge_date DESC);

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.market_daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_user_challenge_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mdc_select_all"
  ON public.market_daily_challenges FOR SELECT USING (true);

CREATE POLICY "mucp_select_own"
  ON public.market_user_challenge_progress FOR SELECT
  USING (auth.uid() = user_id);

-- ── RPC: get_or_create_today_challenges ──────────────────────────────

CREATE OR REPLACE FUNCTION public.get_market_challenges_today()
RETURNS SETOF public.market_user_challenge_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Upsert a row for each challenge for today
  INSERT INTO public.market_user_challenge_progress (user_id, challenge_slug, challenge_date)
  SELECT auth.uid(), slug, current_date
  FROM   public.market_daily_challenges
  ON CONFLICT (user_id, challenge_slug, challenge_date) DO NOTHING;

  RETURN QUERY
  SELECT * FROM public.market_user_challenge_progress
  WHERE user_id = auth.uid() AND challenge_date = current_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_market_challenges_today() TO authenticated;
