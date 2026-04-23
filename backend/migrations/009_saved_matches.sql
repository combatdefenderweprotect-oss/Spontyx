-- Migration 009: saved_matches
-- Lightweight table for players and venues to save football fixtures
-- to their personal schedule / venue schedule.
-- Run in Supabase SQL editor.

create table if not exists public.saved_matches (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users not null,
  venue_id       uuid references public.venues null,  -- null = player save
  match_id       text not null,
  home_team      text not null,
  away_team      text not null,
  competition    text,
  api_league_id  integer,
  kickoff_at     timestamptz,
  notes          text,
  created_at     timestamptz default now(),
  unique(user_id, match_id)
);

alter table public.saved_matches enable row level security;

create policy "sm_select_own"
  on public.saved_matches for select
  using (user_id = auth.uid());

create policy "sm_insert_own"
  on public.saved_matches for insert
  with check (user_id = auth.uid());

create policy "sm_delete_own"
  on public.saved_matches for delete
  using (user_id = auth.uid());

-- Index for fast per-user lookups
create index if not exists saved_matches_user_idx
  on public.saved_matches (user_id, kickoff_at asc);

-- Index for venue lookups
create index if not exists saved_matches_venue_idx
  on public.saved_matches (venue_id, kickoff_at asc)
  where venue_id is not null;
