-- ════════════════════════════════════════════════════════════════════
-- 004_player_answers.sql
-- Player answer submissions + resolver pg_cron schedule.
-- Run after 003_cron_schedule.sql.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. PLAYER ANSWERS ─────────────────────────────────────────────────
-- Records each user's answer to each question.
-- is_correct + points_earned are filled in by the resolver Edge Function
-- when the question's resolution_status transitions to 'resolved'.

create table if not exists public.player_answers (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions(id)  on delete cascade,
  user_id        uuid not null references public.users(id)      on delete cascade,
  league_id      uuid not null references public.leagues(id)    on delete cascade,

  -- The user's choice
  -- binary:          'yes' | 'no'
  -- multiple_choice: the option id (e.g. 'a', 'b', 'c', 'd')
  answer         text not null,

  answered_at    timestamptz not null default now(),
  resolved_at    timestamptz,          -- filled when question resolves

  -- Outcome (filled by resolver)
  is_correct     boolean,
  points_earned  integer not null default 0,

  -- One answer per player per question
  constraint unique_player_answer unique (question_id, user_id)
);

-- Indexes
create index if not exists idx_pa_question  on public.player_answers(question_id);
create index if not exists idx_pa_user      on public.player_answers(user_id);
create index if not exists idx_pa_league    on public.player_answers(league_id);

-- ── 2. ROW LEVEL SECURITY ────────────────────────────────────────────
alter table public.player_answers enable row level security;

-- Users can read their own answers + all answers within leagues they're in
-- (needed to show "X/Y members got it right")
drop policy if exists "pa_select_member"  on public.player_answers;
drop policy if exists "pa_insert_self"    on public.player_answers;
drop policy if exists "pa_update_self"    on public.player_answers;

create policy "pa_select_member" on public.player_answers
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.league_members
      where league_id = player_answers.league_id
        and user_id = auth.uid()
    )
  );

create policy "pa_insert_self" on public.player_answers
  for insert with check (
    user_id = auth.uid()
    -- Must be a member of the league
    and exists (
      select 1 from public.league_members
      where league_id = player_answers.league_id
        and user_id = auth.uid()
    )
    -- Question must still be open (deadline in the future)
    and exists (
      select 1 from public.questions
      where id = player_answers.question_id
        and deadline > now()
        and resolution_status = 'pending'
    )
  );

-- Only resolver (service_role) can update is_correct / points_earned
-- Browser clients may not update answers once submitted
-- (enforced by the unique constraint preventing re-insert too)


-- ── 3. ADD RESOLVER pg_cron SCHEDULE ─────────────────────────────────
-- Requires pg_cron + pg_net from migration 003.
-- Fires every hour — resolves questions whose resolves_after is in the past.
--
-- Replace <<YOUR_CRON_SECRET>> with your actual secret before running.

select cron.unschedule('resolve-questions-every-hour')
where exists (
  select 1 from cron.job where jobname = 'resolve-questions-every-hour'
);

select cron.schedule(
  'resolve-questions-every-hour',
  '0 * * * *',                         -- every hour on the hour
  $$
    select net.http_get(
      url     => 'https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/resolve-questions',
      headers => jsonb_build_object(
        'Authorization', 'Bearer <<YOUR_CRON_SECRET>>',
        'Content-Type',  'application/json'
      )
    );
  $$
);

-- Verify
select jobid, jobname, schedule, active
from cron.job
where jobname in ('generate-questions-every-6h', 'resolve-questions-every-hour');
