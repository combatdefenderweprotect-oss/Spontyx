-- Migration 056: League invite code
-- Adds a short unique invite code to every league for sharing and future join-by-code.
--
-- Design decisions:
--   - Separate from join_password (migration 002) — join_password is a private-league access gate;
--     league_code is a human-friendly share code for ALL leagues regardless of visibility.
--   - 6 uppercase alphanumeric characters, ambiguous chars excluded (O/0, I/1).
--   - UNIQUE constraint enforced at DB level; application retries on collision.
--   - Nullable until backfill runs, then NOT NULL enforced.
--   - Index for O(1) lookup by code (used by future join-by-code and Discover flows).

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS league_code TEXT;

-- ── Backfill existing leagues with unique codes ──────────────────────────
DO $$
DECLARE
  rec      RECORD;
  new_code TEXT;
  chars    TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i        INT;
  inserted BOOLEAN;
BEGIN
  FOR rec IN SELECT id FROM public.leagues WHERE league_code IS NULL ORDER BY created_at LOOP
    inserted := FALSE;
    WHILE NOT inserted LOOP
      new_code := '';
      FOR i IN 1..6 LOOP
        new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      BEGIN
        UPDATE public.leagues SET league_code = new_code WHERE id = rec.id;
        inserted := TRUE;
      EXCEPTION WHEN unique_violation THEN
        -- collision — retry with a new code
      END;
    END LOOP;
  END LOOP;
END$$;

-- ── Add UNIQUE constraint and index after backfill ───────────────────────
ALTER TABLE public.leagues
  ADD CONSTRAINT leagues_league_code_unique UNIQUE (league_code);

CREATE INDEX IF NOT EXISTS idx_leagues_league_code ON public.leagues (league_code);

COMMENT ON COLUMN leagues.league_code IS
  'Short human-friendly 6-char invite code (A-Z 2-9, no ambiguous chars). '
  'Unique across all leagues. Used for sharing and future join-by-code / Discover flows. '
  'Separate from join_password — that is a private-league access gate; this is for all leagues.';
