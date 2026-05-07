-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 087: Spontyx Market — Questions
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_questions (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id            integer      NOT NULL REFERENCES public.api_football_fixtures(fixture_id) ON DELETE CASCADE,
  category              text         NOT NULL CHECK (category IN (
                                       'real_world_edge', 'featured', 'match_result',
                                       'goals', 'team_stats', 'player_prediction'
                                     )),
  question_text         text         NOT NULL,
  -- [{id: 'a', label: 'Real Madrid Win'}, {id: 'b', label: 'Draw'}, ...]
  answer_options        jsonb        NOT NULL DEFAULT '[]'::jsonb,
  correct_answer        text,          -- answer id, set on resolution
  difficulty            text         NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  xp_reward             integer      NOT NULL DEFAULT 20,
  is_featured           boolean      NOT NULL DEFAULT false,

  -- Real World Edge fields
  real_world_context    text,          -- explanation of why this question exists
  real_world_confidence text         CHECK (real_world_confidence IN ('low', 'medium', 'high')),

  -- Resolution
  resolution_source     text         NOT NULL DEFAULT 'match_result'
                                     CHECK (resolution_source IN (
                                       'match_result', 'match_stats', 'lineup',
                                       'player_stats', 'ai_resolved'
                                     )),
  resolution_rule       jsonb        NOT NULL DEFAULT '{}'::jsonb,

  -- Timing
  deadline_at           timestamptz  NOT NULL,
  resolves_after        timestamptz  NOT NULL,

  -- Status lifecycle: draft → active → locked → resolved | void
  status                text         NOT NULL DEFAULT 'draft'
                                     CHECK (status IN ('draft','active','locked','resolving','resolved','void')),

  resolved_at           timestamptz,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_mq_fixture_status
  ON public.market_questions (fixture_id, status);

CREATE INDEX IF NOT EXISTS idx_mq_status_resolves
  ON public.market_questions (status, resolves_after)
  WHERE status = 'locked';

CREATE INDEX IF NOT EXISTS idx_mq_category
  ON public.market_questions (category, status);

CREATE INDEX IF NOT EXISTS idx_mq_featured
  ON public.market_questions (fixture_id, is_featured)
  WHERE is_featured = true;

-- ── Updated_at ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.market_questions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS set_market_questions_updated_at ON public.market_questions;
CREATE TRIGGER set_market_questions_updated_at
  BEFORE UPDATE ON public.market_questions
  FOR EACH ROW EXECUTE FUNCTION public.market_questions_updated_at();

-- ── Auto-lock questions past deadline ────────────────────────────────
-- Called by the resolve Edge Function or pg_cron.

CREATE OR REPLACE FUNCTION public.lock_market_questions_past_deadline()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.market_questions
  SET    status = 'locked'
  WHERE  status = 'active'
    AND  deadline_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.market_questions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read active/locked/resolved questions
CREATE POLICY "mq_select_authenticated"
  ON public.market_questions FOR SELECT
  TO authenticated
  USING (status IN ('active','locked','resolving','resolved','void'));

-- Only service role can insert/update
