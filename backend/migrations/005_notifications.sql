-- ════════════════════════════════════════════════════════════════════
-- 005_notifications.sql
-- In-app notification system — table + RLS + Postgres triggers.
-- Run after 004_player_answers.sql.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. TABLE ──────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,

  -- Classification
  type          text not null,    -- 'league.member_joined' | 'question.new' | 'question.result' | 'award.trophy' | 'award.badge'
  category      text not null     -- maps to filter tab: 'live' | 'question' | 'league' | 'social' | 'system'
                check (category in ('live', 'question', 'league', 'social', 'system')),

  -- Content
  title         text not null,
  body          text,

  -- Relation
  actor_user_id uuid references public.users(id) on delete set null,
  related_id    uuid,
  related_type  text,             -- 'league' | 'question' | 'trophy' | 'badge'

  -- Structured data the UI needs to render the card
  context       jsonb not null default '{}',

  -- State
  read          boolean not null default false,
  read_at       timestamptz,

  created_at    timestamptz not null default now()
);

create index if not exists idx_notif_user
  on public.notifications(user_id, created_at desc);

create index if not exists idx_notif_user_unread
  on public.notifications(user_id) where read = false;


-- ── 2. ROW LEVEL SECURITY ─────────────────────────────────────────────

alter table public.notifications enable row level security;

drop policy if exists "notif_select_self" on public.notifications;
drop policy if exists "notif_update_self" on public.notifications;
drop policy if exists "notif_delete_self" on public.notifications;

-- Users can read their own notifications
create policy "notif_select_self" on public.notifications
  for select using (auth.uid() = user_id);

-- Users can mark their own notifications read
create policy "notif_update_self" on public.notifications
  for update using (auth.uid() = user_id);

-- Users can dismiss (delete) their own notifications
create policy "notif_delete_self" on public.notifications
  for delete using (auth.uid() = user_id);

-- Inserts come exclusively from SECURITY DEFINER trigger functions,
-- which bypass RLS — no client insert policy needed.


-- ── 3. TRIGGER: league member joined → notify owner ──────────────────

create or replace function public.trg_notify_member_joined()
returns trigger language plpgsql security definer as $$
declare
  v_owner_id    uuid;
  v_league_name text;
  v_actor_name  text;
begin
  select owner_id, name into v_owner_id, v_league_name
  from public.leagues where id = NEW.league_id;

  -- Don't notify when the owner joins their own league (or no owner set)
  if v_owner_id is null or v_owner_id = NEW.user_id then
    return NEW;
  end if;

  select coalesce(name, 'Someone') into v_actor_name
  from public.users where id = NEW.user_id;

  insert into public.notifications
    (user_id, type, category, title, actor_user_id, related_id, related_type, context)
  values (
    v_owner_id,
    'league.member_joined',
    'social',
    v_actor_name || ' joined ' || v_league_name,
    NEW.user_id,
    NEW.league_id,
    'league',
    jsonb_build_object(
      'league_name', v_league_name,
      'actor_name',  v_actor_name
    )
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_member_joined on public.league_members;
create trigger trg_notify_member_joined
  after insert on public.league_members
  for each row execute function public.trg_notify_member_joined();


-- ── 4. TRIGGER: new question posted → notify league members ──────────
-- Rate-limited: each user gets at most one 'question.new' notification
-- per league per 4-hour window (prevents spam when AI generates a batch).

create or replace function public.trg_notify_question_new()
returns trigger language plpgsql security definer as $$
declare
  v_league_name text;
begin
  select name into v_league_name from public.leagues where id = NEW.league_id;

  insert into public.notifications
    (user_id, type, category, title, related_id, related_type, context)
  select
    lm.user_id,
    'question.new',
    'question',
    'New question in ' || v_league_name,
    NEW.id,
    'question',
    jsonb_build_object(
      'league_name',   v_league_name,
      'league_id',     NEW.league_id,
      'question_text', NEW.question_text,
      'deadline',      NEW.deadline
    )
  from public.league_members lm
  where lm.league_id = NEW.league_id
    -- Rate-limit: skip if user already got a question.new for this league recently
    and not exists (
      select 1 from public.notifications n2
      where n2.user_id = lm.user_id
        and n2.type    = 'question.new'
        and (n2.context->>'league_id')::uuid = NEW.league_id
        and n2.created_at > now() - interval '4 hours'
    );

  return NEW;
end;
$$;

drop trigger if exists trg_notify_question_new on public.questions;
create trigger trg_notify_question_new
  after insert on public.questions
  for each row execute function public.trg_notify_question_new();


-- ── 5. TRIGGER: answer graded → notify answerer ──────────────────────

create or replace function public.trg_notify_question_resolved()
returns trigger language plpgsql security definer as $$
declare
  v_question_text text;
  v_league_name   text;
  v_league_id     uuid;
begin
  -- Only fire when is_correct transitions NULL → non-NULL
  if OLD.is_correct is not null or NEW.is_correct is null then
    return NEW;
  end if;

  select q.question_text, q.league_id, l.name
  into v_question_text, v_league_id, v_league_name
  from public.questions q
  join public.leagues l on l.id = q.league_id
  where q.id = NEW.question_id;

  insert into public.notifications
    (user_id, type, category, title, related_id, related_type, context)
  values (
    NEW.user_id,
    'question.result',
    'question',
    case when NEW.is_correct
      then 'Correct! +' || NEW.points_earned || ' pts'
      else 'Unlucky — wrong answer'
    end,
    NEW.question_id,
    'question',
    jsonb_build_object(
      'league_name',   v_league_name,
      'league_id',     v_league_id,
      'question_text', v_question_text,
      'is_correct',    NEW.is_correct,
      'points_earned', NEW.points_earned
    )
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_question_resolved on public.player_answers;
create trigger trg_notify_question_resolved
  after update on public.player_answers
  for each row execute function public.trg_notify_question_resolved();


-- ── 6. TRIGGER: trophy awarded → notify recipient ────────────────────

create or replace function public.trg_notify_trophy_awarded()
returns trigger language plpgsql security definer as $$
declare
  v_trophy_name text;
begin
  -- Prefer the custom name, fall back to formatted type string
  v_trophy_name := coalesce(
    NEW.custom_data->>'name',
    initcap(replace(NEW.type, '_', ' ')),
    'Trophy'
  );

  insert into public.notifications
    (user_id, type, category, title, related_id, related_type, context)
  values (
    NEW.recipient_user_id,
    'award.trophy',
    'system',
    'You earned the ' || v_trophy_name || ' trophy!',
    NEW.id,
    'trophy',
    jsonb_build_object(
      'trophy_name', v_trophy_name,
      'trophy_type', NEW.type
    )
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_trophy_awarded on public.trophies;
create trigger trg_notify_trophy_awarded
  after insert on public.trophies
  for each row execute function public.trg_notify_trophy_awarded();


-- ── 7. TRIGGER: badge earned → notify user ───────────────────────────

create or replace function public.trg_notify_badge_earned()
returns trigger language plpgsql security definer as $$
declare
  v_badge_label text;
begin
  -- INSERT path: only if badge inserted as already earned
  if TG_OP = 'INSERT' and not NEW.earned then
    return NEW;
  end if;
  -- UPDATE path: only when transitioning false → true
  if TG_OP = 'UPDATE' and not (OLD.earned = false and NEW.earned = true) then
    return NEW;
  end if;

  v_badge_label := initcap(replace(NEW.badge_id, '_', ' '));

  insert into public.notifications
    (user_id, type, category, title, related_id, related_type, context)
  values (
    NEW.user_id,
    'award.badge',
    'system',
    'You earned the "' || v_badge_label || '" badge!',
    NULL,   -- no UUID id on player_badges (PK is user_id + badge_id)
    'badge',
    jsonb_build_object(
      'badge_id',    NEW.badge_id,
      'badge_label', v_badge_label
    )
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_badge_earned on public.player_badges;
create trigger trg_notify_badge_earned
  after insert or update on public.player_badges
  for each row execute function public.trg_notify_badge_earned();


-- ── Verify ────────────────────────────────────────────────────────────
select trigger_name, event_object_table, action_timing, event_manipulation
from information_schema.triggers
where trigger_name in (
  'trg_notify_member_joined',
  'trg_notify_question_new',
  'trg_notify_question_resolved',
  'trg_notify_trophy_awarded',
  'trg_notify_badge_earned'
)
order by event_object_table;
