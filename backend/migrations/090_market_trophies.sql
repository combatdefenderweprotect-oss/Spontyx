-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 090: Spontyx Market — Trophies
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_trophies (
  slug          text    PRIMARY KEY,
  name          text    NOT NULL,
  description   text    NOT NULL,
  icon          text    NOT NULL DEFAULT '🏆',
  category      text    NOT NULL CHECK (category IN (
                          'real_world', 'accuracy', 'streak', 'risk', 'match', 'general'
                        )),
  rarity        text    NOT NULL DEFAULT 'common' CHECK (rarity IN ('common','rare','epic','legendary')),
  xp_reward     integer NOT NULL DEFAULT 50
);

-- ── Seed trophy definitions ───────────────────────────────────────────

INSERT INTO public.market_trophies (slug, name, description, icon, category, rarity, xp_reward)
VALUES
  ('real_world_insider',   'Insider',          'Win 5 Real World Edge predictions',        '🕵️', 'real_world', 'common',    50),
  ('real_world_oracle',    'Oracle',           'Win 20 Real World Edge predictions',       '🔮', 'real_world', 'rare',      150),
  ('bold_master',          'Bold Master',      'Win 10 BOLD confidence predictions',       '💥', 'risk',       'rare',      120),
  ('accuracy_star',        'Accuracy Star',    '80%+ accuracy over 20+ predictions',       '⭐', 'accuracy',   'epic',      200),
  ('hot_streak',           'Hot Streak',       '5 consecutive correct predictions',        '🔥', 'streak',     'common',    75),
  ('inferno',              'Inferno',          '10 consecutive correct predictions',       '🌋', 'streak',     'epic',      250),
  ('el_clasico_champion',  'El Clásico Champ', 'Correctly predict an El Clásico result',  '👑', 'match',      'rare',      100),
  ('derby_winner',         'Derby Winner',     'Correctly predict a derby match result',   '⚽', 'match',      'common',    60),
  ('high_roller',          'High Roller',      'Place a BOLD stake of ≥200 coins',         '💰', 'risk',       'common',    40),
  ('market_veteran',       'Market Veteran',   'Place 100 total predictions',              '📊', 'general',    'rare',      150),
  ('lineup_expert',        'Lineup Expert',    'Win 10 player_prediction questions',       '👕', 'real_world', 'common',    80),
  ('first_win',            'First Blood',      'Win your first market prediction',         '🎯', 'general',    'common',    25)
ON CONFLICT (slug) DO NOTHING;

-- ── User trophies ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.market_user_trophies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trophy_slug text        NOT NULL REFERENCES public.market_trophies(slug),
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trophy_slug)
);

CREATE INDEX IF NOT EXISTS idx_mut_user
  ON public.market_user_trophies (user_id, awarded_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.market_trophies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_user_trophies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market_trophies_select_all"
  ON public.market_trophies FOR SELECT USING (true);

CREATE POLICY "mut_select_own"
  ON public.market_user_trophies FOR SELECT
  USING (auth.uid() = user_id);
