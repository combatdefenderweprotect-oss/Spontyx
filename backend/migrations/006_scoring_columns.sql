-- ════════════════════════════════════════════════════════════════════════
-- 006_scoring_columns.sql
-- Adds scoring + live timing columns required by the full scoring system
-- and the live question lock timing model.
--
-- Run after 005_notifications.sql.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- 1. QUESTIONS TABLE — live timing + scoring metadata
-- ════════════════════════════════════════════════════════════════════════
--
-- The existing timing columns (opens_at / deadline / resolves_after) are
-- retained for backwards compatibility and as fallbacks for legacy questions.
-- Live questions use the new three-timestamp model:
--   visible_from     → when the question appears in the feed (absorbs delivery lag)
--   answer_closes_at → authoritative lock time; no answers accepted after this
--   resolves_after   → already exists; when resolver evaluates the outcome
--
-- base_value: set at generation time; avoids UI needing to infer from event_type.
--   Values: 20 (high-value event), 15 (outcome/state), 12 (player-specific),
--           10 (medium stat), 6 (low-value filler).
--
-- difficulty_multiplier: 1.0 – 1.5, set at generation based on question type +
--   game state context. Default 1.0.
--
-- match_minute_at_generation: the match clock minute (0–90+) when the question
--   was generated. Used by the client to compute clutch_multiplier_at_answer at
--   submission time (≥70 → 1.25×, else 1.0×). Do NOT use resolves_after for
--   this — it is a technical deadline, not a match clock value.
-- ════════════════════════════════════════════════════════════════════════

alter table public.questions
  -- Live timing (nullable — legacy questions use opens_at / deadline)
  add column if not exists visible_from          timestamptz,
  add column if not exists answer_closes_at      timestamptz,

  -- Scoring metadata (set at question generation time)
  add column if not exists base_value            integer not null default 6
                                                   check (base_value in (6, 10, 12, 15, 20)),
  add column if not exists difficulty_multiplier numeric not null default 1.0,
  add column if not exists match_minute_at_generation integer;

-- Index for resolver: quickly find questions whose answer window has closed
create index if not exists idx_questions_closes_at
  on public.questions(answer_closes_at)
  where answer_closes_at is not null;

-- Index for live feed: questions visible now for a given league
create index if not exists idx_questions_visible_from
  on public.questions(league_id, visible_from)
  where visible_from is not null;


-- ════════════════════════════════════════════════════════════════════════
-- 2. PLAYER_ANSWERS TABLE — scoring multiplier capture columns
-- ════════════════════════════════════════════════════════════════════════
--
-- These columns are written at answer submission time (not resolve time)
-- because leaderboard state and match context can change between submission
-- and when the resolver runs.
--
-- streak_at_answer:            consecutive correct answers at submission time;
--                              resolver derives the streak multiplier from this.
-- leader_gap_at_answer:        pts gap between this user and current leader at
--                              submission; resolver derives comeback multiplier.
--                              Default 0 → no comeback bonus (1.0×).
-- clutch_multiplier_at_answer: 1.0 (early/mid) or 1.25 (late, minute ≥ 70);
--                              computed from match_minute_at_generation by client,
--                              stored here so resolver reads it directly.
-- multiplier_breakdown:        written by resolver after scoring; full audit trail
--                              for UI display.
--                              Shape: {time_pressure, difficulty, streak, comeback, clutch, total}
-- ════════════════════════════════════════════════════════════════════════

alter table public.player_answers
  add column if not exists streak_at_answer            integer,
  add column if not exists leader_gap_at_answer        integer not null default 0,
  add column if not exists clutch_multiplier_at_answer numeric,
  add column if not exists multiplier_breakdown        jsonb;


-- ════════════════════════════════════════════════════════════════════════
-- 3. UPDATE RLS: player_answers insert — use answer_closes_at (authoritative)
--    with fallback to deadline for legacy questions.
-- ════════════════════════════════════════════════════════════════════════

drop policy if exists "pa_insert_self" on public.player_answers;

create policy "pa_insert_self" on public.player_answers
  for insert with check (
    user_id = auth.uid()
    -- Must be a league member
    and exists (
      select 1 from public.league_members
      where league_id = player_answers.league_id
        and user_id   = auth.uid()
    )
    -- Question must still be open:
    --   for live questions: answer_closes_at > now()
    --   for legacy questions: deadline > now() (fallback)
    and exists (
      select 1 from public.questions q
      where q.id               = player_answers.question_id
        and q.resolution_status = 'pending'
        and coalesce(q.answer_closes_at, q.deadline) > now()
    )
  );


-- ════════════════════════════════════════════════════════════════════════
-- 4. UPDATE RLS: player_answers upsert / update
--    Allows a player to change their answer while the question is still open.
--    Resolver-only columns (is_correct, points_earned, multiplier_breakdown)
--    cannot be set by the client — they are only writable by service_role.
-- ════════════════════════════════════════════════════════════════════════

drop policy if exists "pa_update_answer" on public.player_answers;

create policy "pa_update_answer" on public.player_answers
  for update
  using  (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    -- Can only change answer while question is still open
    and exists (
      select 1 from public.questions q
      where q.id               = player_answers.question_id
        and q.resolution_status = 'pending'
        and coalesce(q.answer_closes_at, q.deadline) > now()
    )
  );


-- ════════════════════════════════════════════════════════════════════════
-- 5. EXTEND event_type CHECK — add live event granularity
-- ════════════════════════════════════════════════════════════════════════
-- The original check constraint only allows high-level categories.
-- Live question generation needs more granular event types.
-- We drop the old constraint and replace it with an expanded one.
-- ════════════════════════════════════════════════════════════════════════

alter table public.questions
  drop constraint if exists questions_event_type_check;

alter table public.questions
  add constraint questions_event_type_check
  check (event_type in (
    -- Original high-level categories (legacy / AI-generated)
    'match_result', 'player_performance', 'injury', 'narrative',
    -- Soccer live events
    'goal', 'penalty', 'red_card', 'yellow_card', 'corner', 'shot',
    -- Hockey live events
    'hockey_goal', 'major_penalty', 'minor_penalty', 'power_play',
    -- Tennis sequence events
    'break_of_serve', 'hold_of_serve', 'set_won', 'tie_break', 'match_point',
    -- Generic time-driven
    'time_window', 'stat_threshold', 'clean_sheet', 'equaliser', 'next_scorer'
  ));


-- ════════════════════════════════════════════════════════════════════════
-- Verify
-- ════════════════════════════════════════════════════════════════════════
select
  column_name,
  data_type,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'questions'
  and column_name  in ('visible_from','answer_closes_at','base_value','difficulty_multiplier','match_minute_at_generation')
order by column_name;

select
  column_name,
  data_type,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'player_answers'
  and column_name  in ('streak_at_answer','leader_gap_at_answer','clutch_multiplier_at_answer','multiplier_breakdown')
order by column_name;
