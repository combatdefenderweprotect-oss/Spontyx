-- =============================================================================
-- Migration 082: Trivia Daily Challenges, Completions, and pg_cron Jobs
-- =============================================================================
-- Creates:
--   - trivia_daily_challenges   : one challenge record per calendar day
--   - trivia_daily_completions  : one completion record per user per challenge
-- Schedules pg_cron jobs:
--   - trivia-reset-xp-weekly    : resets trivia_player_stats.xp_this_week every Monday 00:00 UTC
--   - trivia-expire-duel-queue  : expires stale trivia_duel_queue rows every minute
-- Depends on:
--   - migration 076: set_updated_at() trigger function
--   - migration 077: trivia_sessions, trivia_player_stats (xp_this_week column)
--   - migration 079: trivia_duel_queue
--   - pg_cron extension (already enabled)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. trivia_daily_challenges
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.trivia_daily_challenges (
    id                   UUID         NOT NULL DEFAULT gen_random_uuid(),
    challenge_date       DATE         NOT NULL,
    sport                TEXT         NOT NULL
                             CHECK (sport IN ('soccer','nfl','nba','mlb','college_football','f1','tennis','mma')),
    difficulty           TEXT         NOT NULL DEFAULT 'medium'
                             CHECK (difficulty IN ('easy','medium','hard','mixed')),
    question_ids         UUID[]       NOT NULL DEFAULT '{}',
    total_rounds         INT          NOT NULL DEFAULT 10 CHECK (total_rounds > 0),
    timer_seconds        INT          NOT NULL DEFAULT 20 CHECK (timer_seconds > 0),
    bonus_xp_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.5
                             CHECK (bonus_xp_multiplier BETWEEN 1.0 AND 3.0),
    title                TEXT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT trivia_daily_challenges_pkey        PRIMARY KEY (id),
    CONSTRAINT trivia_daily_challenges_date_unique UNIQUE      (challenge_date)
);

-- Index: descending date for "fetch today's challenge" and recent history queries
CREATE INDEX IF NOT EXISTS idx_tdc_date
    ON public.trivia_daily_challenges (challenge_date DESC);

-- RLS
ALTER TABLE public.trivia_daily_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tdc_select_authenticated" ON public.trivia_daily_challenges;
CREATE POLICY "tdc_select_authenticated"
    ON public.trivia_daily_challenges
    FOR SELECT
    TO authenticated
    USING (true);

-- No INSERT / UPDATE / DELETE policies — admin writes via service role only.


-- ---------------------------------------------------------------------------
-- 2. trivia_daily_completions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.trivia_daily_completions (
    user_id        UUID        NOT NULL REFERENCES auth.users       ON DELETE CASCADE,
    challenge_id   UUID        NOT NULL REFERENCES public.trivia_daily_challenges ON DELETE CASCADE,
    session_id     UUID                 REFERENCES public.trivia_sessions          ON DELETE SET NULL,
    xp_earned      INT         NOT NULL DEFAULT 0  CHECK (xp_earned >= 0),
    correct_count  INT         NOT NULL DEFAULT 0  CHECK (correct_count >= 0),
    stars          INT         NOT NULL DEFAULT 0  CHECK (stars BETWEEN 0 AND 3),
    completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT trivia_daily_completions_pkey PRIMARY KEY (user_id, challenge_id)
);

-- Index: per-challenge leaderboard (order by xp_earned DESC)
CREATE INDEX IF NOT EXISTS idx_tdco_challenge
    ON public.trivia_daily_completions (challenge_id, xp_earned DESC);

-- Index: per-user completion history (most recent first)
CREATE INDEX IF NOT EXISTS idx_tdco_user
    ON public.trivia_daily_completions (user_id, completed_at DESC);

-- RLS
ALTER TABLE public.trivia_daily_completions ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all completions for a challenge (daily leaderboard)
DROP POLICY IF EXISTS "tdco_select_authenticated" ON public.trivia_daily_completions;
CREATE POLICY "tdco_select_authenticated"
    ON public.trivia_daily_completions
    FOR SELECT
    TO authenticated
    USING (true);

-- Users can only insert their own completion row
DROP POLICY IF EXISTS "tdco_insert_own" ON public.trivia_daily_completions;
CREATE POLICY "tdco_insert_own"
    ON public.trivia_daily_completions
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- No UPDATE policy — completions are immutable once written.


-- ---------------------------------------------------------------------------
-- 3. pg_cron jobs
-- ---------------------------------------------------------------------------

-- 3a. trivia-reset-xp-weekly
--     Runs every Monday at 00:00 UTC.
--     Zeroes xp_this_week on trivia_player_stats (non-zero rows only).

DO $$
BEGIN
    PERFORM cron.unschedule('trivia-reset-xp-weekly');
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
    'trivia-reset-xp-weekly',
    '0 0 * * 1',
    $$UPDATE public.trivia_player_stats SET xp_this_week = 0 WHERE xp_this_week > 0;$$
);

-- 3b. trivia-expire-duel-queue
--     Runs every minute.
--     Marks stale waiting rows in trivia_duel_queue as expired.

DO $$
BEGIN
    PERFORM cron.unschedule('trivia-expire-duel-queue');
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
    'trivia-expire-duel-queue',
    '* * * * *',
    $$UPDATE public.trivia_duel_queue SET status = 'expired' WHERE status = 'waiting' AND expires_at < NOW();$$
);
