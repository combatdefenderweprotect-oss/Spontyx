-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 078 — Trivia rating tables
-- Tables:   trivia_player_ratings, trivia_sport_ratings, trivia_event_ratings
-- Helper:   get_trivia_rating_tier(INT) → TEXT
--
-- Starting rating: 800.
-- Only Ranked Duel will write to these tables (via finalize_duel RPC, mig 079+).
-- No user-facing writes. RLS = public read, no direct write.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_player_ratings
-- One row per player. Global lifetime rating, unaffected by season resets.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trivia_player_ratings (
  user_id         UUID    PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,

  rating          INT     NOT NULL DEFAULT 800
                          CHECK (rating >= 0),
  peak_rating     INT     NOT NULL DEFAULT 800
                          CHECK (peak_rating >= rating OR peak_rating >= 800),

  -- Duel record
  ranked_duels    INT     NOT NULL DEFAULT 0 CHECK (ranked_duels >= 0),
  wins            INT     NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses          INT     NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws           INT     NOT NULL DEFAULT 0 CHECK (draws >= 0),

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_trivia_player_ratings_updated_at ON public.trivia_player_ratings;
CREATE TRIGGER trg_trivia_player_ratings_updated_at
  BEFORE UPDATE ON public.trivia_player_ratings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Global leaderboard
CREATE INDEX IF NOT EXISTS idx_tpr_rating
  ON public.trivia_player_ratings (rating DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.trivia_player_ratings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read (leaderboard, opponent card, profile)
CREATE POLICY tpr_select_public ON public.trivia_player_ratings
  FOR SELECT USING (auth.role() = 'authenticated');

-- No INSERT/UPDATE policies — writes come exclusively from SECURITY DEFINER RPCs.


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_sport_ratings
-- One row per (player × sport). Permanent — never reset.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trivia_sport_ratings (
  user_id         UUID    NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  sport           TEXT    NOT NULL
                          CHECK (sport IN ('soccer','nfl','nba','mlb','college_football','f1','tennis','mma')),

  rating          INT     NOT NULL DEFAULT 800
                          CHECK (rating >= 0),
  peak_rating     INT     NOT NULL DEFAULT 800
                          CHECK (peak_rating >= rating OR peak_rating >= 800),

  -- Duel record for this sport
  ranked_duels    INT     NOT NULL DEFAULT 0 CHECK (ranked_duels >= 0),
  wins            INT     NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses          INT     NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws           INT     NOT NULL DEFAULT 0 CHECK (draws >= 0),

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, sport)
);

DROP TRIGGER IF EXISTS trg_trivia_sport_ratings_updated_at ON public.trivia_sport_ratings;
CREATE TRIGGER trg_trivia_sport_ratings_updated_at
  BEFORE UPDATE ON public.trivia_sport_ratings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Per-sport leaderboard
CREATE INDEX IF NOT EXISTS idx_tsr_sport_rating
  ON public.trivia_sport_ratings (sport, rating DESC);

-- Player's own sport ratings (profile page)
CREATE INDEX IF NOT EXISTS idx_tsr_user
  ON public.trivia_sport_ratings (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.trivia_sport_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tsr_select_public ON public.trivia_sport_ratings
  FOR SELECT USING (auth.role() = 'authenticated');


-- ─────────────────────────────────────────────────────────────────────────────
-- trivia_event_ratings
-- One row per (player × event). Seasonal — reset at season_end.
-- world_cup_2026 is the first active event.
--
-- season_start / season_end are populated by the finalize_duel RPC (mig 079+)
-- when the row is first created, sourced from a central event config.
-- Both are stored per-row so historical rows remain accurate after the event
-- window changes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trivia_event_ratings (
  user_id         UUID    NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  event           TEXT    NOT NULL
                          CHECK (event IN ('world_cup_2026')),

  rating          INT     NOT NULL DEFAULT 800
                          CHECK (rating >= 0),
  peak_rating     INT     NOT NULL DEFAULT 800
                          CHECK (peak_rating >= rating OR peak_rating >= 800),

  -- Duel record for this event season
  ranked_duels    INT     NOT NULL DEFAULT 0 CHECK (ranked_duels >= 0),
  wins            INT     NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses          INT     NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws           INT     NOT NULL DEFAULT 0 CHECK (draws >= 0),

  -- Season window — set at row creation, never changed mid-season
  season_start    TIMESTAMPTZ,
  season_end      TIMESTAMPTZ,

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, event),

  CONSTRAINT ter_season_order CHECK (season_end IS NULL OR season_end > season_start)
);

DROP TRIGGER IF EXISTS trg_trivia_event_ratings_updated_at ON public.trivia_event_ratings;
CREATE TRIGGER trg_trivia_event_ratings_updated_at
  BEFORE UPDATE ON public.trivia_event_ratings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Per-event seasonal leaderboard
CREATE INDEX IF NOT EXISTS idx_ter_event_rating
  ON public.trivia_event_ratings (event, rating DESC);

-- Player's own event ratings
CREATE INDEX IF NOT EXISTS idx_ter_user
  ON public.trivia_event_ratings (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.trivia_event_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ter_select_public ON public.trivia_event_ratings
  FOR SELECT USING (auth.role() = 'authenticated');


-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: get_trivia_rating_tier(rating INT) → TEXT
--
-- Returns the display tier label for a given Elo rating.
-- Starting rating is 800 (Bronze).
--
-- Thresholds:
--   Bronze    <  900   (starting bracket)
--   Silver    900–1099
--   Gold      1100–1299
--   Platinum  1300–1499
--   Diamond   1500–1699
--   Elite     1700+
--
-- Used by the frontend profile card, leaderboard badge, and duel result screen.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_trivia_rating_tier(p_rating INT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN p_rating >= 1700 THEN 'Elite'
    WHEN p_rating >= 1500 THEN 'Diamond'
    WHEN p_rating >= 1300 THEN 'Platinum'
    WHEN p_rating >= 1100 THEN 'Gold'
    WHEN p_rating >= 900  THEN 'Silver'
    ELSE                       'Bronze'
  END;
$$;
