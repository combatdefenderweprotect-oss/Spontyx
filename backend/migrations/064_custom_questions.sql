-- 064_custom_questions.sql
--
-- Custom Questions — admin-created, manually-resolved questions for leagues.
--
-- Adds:
--   * questions: 10 new columns for custom question metadata + resolution tracking
--   * questions.question_type: 'CUSTOM' added to CHECK constraint
--   * questions.event_type: 'custom' added to CHECK constraint
--   * player_answers: selected_options JSONB for multi-choice answers
--   * custom_question_events: audit log for create/publish/answered/resolved/voided
--
-- Design:
--   * Custom questions use source='custom'. The existing resolve-questions cron
--     skips them (it filters WHERE resolution_predicate IS NOT NULL).
--   * Admin resolves via the resolve-custom-question Edge Function action which
--     writes resolution_status='resolved' / 'voided' directly.
--   * Tier limits (per-day + per-match) enforced by the Edge Function.
--
-- Idempotent. Additive only. Safe to re-run.

-- ── 1. Extend questions: source + custom question metadata ───────────────────

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'system'
    CHECK (source IN ('system', 'custom')),

  -- 'single' = single_choice, 'multi' = multi_choice
  ADD COLUMN IF NOT EXISTS custom_question_type TEXT
    CHECK (custom_question_type IN ('single', 'multi')),

  -- Array of option strings, e.g. ["Arsenal", "Chelsea", "Draw"]
  ADD COLUMN IF NOT EXISTS custom_options JSONB,

  -- Set at admin resolve time: the correct answer(s)
  ADD COLUMN IF NOT EXISTS custom_correct_answers JSONB,

  -- Flat scoring preset values set at creation time
  ADD COLUMN IF NOT EXISTS custom_points_correct INT,
  ADD COLUMN IF NOT EXISTS custom_points_wrong   INT,

  -- Who created / resolved this custom question
  ADD COLUMN IF NOT EXISTS created_by_user_id  UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS resolved_by_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS resolved_at         TIMESTAMPTZ,

  -- Admin-facing resolution status (separate from system resolver's resolution_status)
  ADD COLUMN IF NOT EXISTS custom_resolution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (custom_resolution_status IN ('pending', 'resolved', 'voided'));

COMMENT ON COLUMN public.questions.source IS
  'migration 064. system = AI-generated; custom = admin-created manual question.';
COMMENT ON COLUMN public.questions.custom_question_type IS
  'migration 064. single = single choice; multi = multi choice (strict exact match scoring). NULL for system questions.';
COMMENT ON COLUMN public.questions.custom_options IS
  'migration 064. Array of option label strings, e.g. ["Yes","No"]. 2–8 items. NULL for system questions.';
COMMENT ON COLUMN public.questions.custom_correct_answers IS
  'migration 064. Set at admin resolve time. Array of correct option labels. NULL until resolved.';
COMMENT ON COLUMN public.questions.custom_points_correct IS
  'migration 064. Points awarded on correct answer (preset values: 10, 15, 25, 40).';
COMMENT ON COLUMN public.questions.custom_points_wrong IS
  'migration 064. Points awarded on wrong answer (preset values: 0, -5, -10, -25).';
COMMENT ON COLUMN public.questions.custom_resolution_status IS
  'migration 064. Admin-side status: pending (unresolved), resolved (admin resolved), voided (admin voided). Read by the admin resolve panel.';

-- ── 2. Extend questions.question_type CHECK to include CUSTOM ────────────────

ALTER TABLE public.questions
  DROP CONSTRAINT IF EXISTS questions_question_type_check;

ALTER TABLE public.questions
  ADD CONSTRAINT questions_question_type_check CHECK (
    question_type IN (
      'CORE_MATCH_PREMATCH',
      'CORE_MATCH_LIVE',
      'REAL_WORLD',
      'BR_MATCH_LIVE',
      'CUSTOM'
    )
  );

-- ── 3. Extend questions.event_type CHECK to include 'custom' ─────────────────

ALTER TABLE public.questions
  DROP CONSTRAINT IF EXISTS questions_event_type_check;

ALTER TABLE public.questions
  ADD CONSTRAINT questions_event_type_check CHECK (event_type IN (
    -- Original high-level categories (AI-generated)
    'match_result', 'player_performance', 'injury', 'narrative',
    -- Soccer live events
    'goal', 'penalty', 'red_card', 'yellow_card', 'corner', 'shot',
    -- Hockey live events
    'hockey_goal', 'major_penalty', 'minor_penalty', 'power_play',
    -- Tennis sequence events
    'break_of_serve', 'hold_of_serve', 'set_won', 'tie_break', 'match_point',
    -- Generic time-driven
    'time_window', 'stat_threshold', 'clean_sheet', 'equaliser', 'next_scorer',
    -- Custom admin-created
    'custom'
  ));

-- ── 4. Extend player_answers: selected_options for custom multi-choice ───────

ALTER TABLE public.player_answers
  ADD COLUMN IF NOT EXISTS selected_options JSONB;

COMMENT ON COLUMN public.player_answers.selected_options IS
  'migration 064. Populated for custom questions. Array of selected option labels. Single-choice: one element. Multi-choice: one or more elements. Resolver compares this against custom_correct_answers for scoring.';

-- ── 5. custom_question_events: audit log ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.custom_question_events (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id UUID        NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL CHECK (action IN ('created', 'published', 'answered', 'resolved', 'voided')),
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID        REFERENCES auth.users(id)
);

COMMENT ON TABLE public.custom_question_events IS
  'migration 064. Append-only audit log for all custom question lifecycle events.';

CREATE INDEX IF NOT EXISTS idx_cqe_question_id ON public.custom_question_events (question_id);
CREATE INDEX IF NOT EXISTS idx_cqe_action      ON public.custom_question_events (action);

ALTER TABLE public.custom_question_events ENABLE ROW LEVEL SECURITY;

-- Members of the question's league can read events (for transparency post-resolve)
DROP POLICY IF EXISTS "cqe_select_member" ON public.custom_question_events;
CREATE POLICY "cqe_select_member" ON public.custom_question_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM   public.questions q
      JOIN   public.league_members lm ON lm.league_id = q.league_id
      WHERE  q.id        = custom_question_events.question_id
        AND  lm.user_id  = auth.uid()
    )
  );

-- Only service_role (Edge Functions) can insert events
-- (no INSERT policy — callers use service_role key which bypasses RLS)

-- ── 6. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_questions_source
  ON public.questions (league_id, source)
  WHERE source = 'custom';

CREATE INDEX IF NOT EXISTS idx_questions_custom_res_status
  ON public.questions (league_id, custom_resolution_status)
  WHERE source = 'custom';

-- ── 7. Verify ────────────────────────────────────────────────────────────────

SELECT column_name, data_type, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'questions'
  AND  column_name  IN (
    'source', 'custom_question_type', 'custom_options', 'custom_correct_answers',
    'custom_points_correct', 'custom_points_wrong', 'created_by_user_id',
    'resolved_by_user_id', 'resolved_at', 'custom_resolution_status'
  )
ORDER BY column_name;

SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'player_answers'
  AND  column_name  = 'selected_options';
