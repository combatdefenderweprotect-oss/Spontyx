-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Initial Schema Migration
-- ════════════════════════════════════════════════════════════════════════
-- Run this in the Supabase SQL Editor:
--   Dashboard → SQL Editor → New query → paste this whole file → Run
--
-- It is idempotent (uses IF NOT EXISTS / DROP IF EXISTS) so re-running
-- on the same project will not duplicate or error out — useful while you
-- iterate. For production, freeze migrations and never re-run them.
--
-- This migration mirrors the data shapes already implemented client-side
-- in /sessions/bold-loving-keller/mnt/Spontix/spontix-store.js.
-- See ARCHITECTURE.md for the full data model documentation.
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. Extensions ──
-- pgcrypto gives us gen_random_uuid() for primary keys.
create extension if not exists pgcrypto;

-- ════════════════════════════════════════════════════════════════════════
-- 1. USERS  (public.users mirrors Supabase auth.users)
-- ════════════════════════════════════════════════════════════════════════
-- Supabase manages authentication in the auth.users table. We mirror each
-- auth user into public.users with our own profile fields. A trigger keeps
-- them in sync: every new auth.users row auto-creates a public.users row.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        text unique,
  name          text,
  email         text unique,
  role          text not null default 'player' check (role in ('player', 'venue-owner')),
  avatar        text,           -- single character or initials, e.g. 'B'
  avatar_color  text,           -- hex like '#A8E10C'
  tier          text not null default 'starter',  -- 'starter' | 'pro' | 'elite' | 'venue-starter' | 'venue-pro' | 'venue-elite'
  total_points     integer not null default 0,
  total_correct    integer not null default 0,
  total_wrong      integer not null default 0,
  best_streak      integer not null default 0,
  current_streak   integer not null default 0,
  games_played     integer not null default 0,
  leagues_joined   integer not null default 0,
  teams_joined     integer not null default 0,
  team_wins        integer not null default 0,
  badges_count     integer not null default 0,
  trophies_count   integer not null default 0,
  accuracy         jsonb not null default '{"live":0,"prematch":0,"trivia":0,"news":0}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Auto-create a public.users row whenever a new auth.users row appears.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, handle)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'handle', '@' || split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ════════════════════════════════════════════════════════════════════════
-- 2. VENUES
-- ════════════════════════════════════════════════════════════════════════
-- owner_id is nullable: NULL means "system / discovery-only" venue (the
-- demo seed venues). Real venue owners' venues have owner_id set.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.venues (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references public.users(id) on delete set null,
  venue_name    text not null,
  city          text,
  country       text,
  type          text,            -- 'Sports Bar' | 'Pub' | 'Restaurant' | 'Stadium' | etc.
  hours         text,
  capacity      integer,
  address       text,
  lat           numeric,
  lng           numeric,
  sports        text[],          -- ['Football', 'Rugby', ...]
  description   text,
  color         text default 'purple',  -- card header color when no title photo
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_venues_owner on public.venues(owner_id);
create index if not exists idx_venues_city  on public.venues(city);


-- ════════════════════════════════════════════════════════════════════════
-- 3. LEAGUES + LEAGUE MEMBERS
-- ════════════════════════════════════════════════════════════════════════
-- Membership lives in a proper join table (NOT an array on the league row)
-- so we can query "all leagues user X is in" efficiently and add per-member
-- metadata (joined_at, role, points, etc.) later.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.leagues (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.users(id) on delete cascade,
  name          text not null,
  sport         text not null default 'Football',
  region        text default 'Europe',
  type          text not null default 'public' check (type in ('public', 'private')),
  mode          text not null default 'individual' check (mode in ('individual', 'team')),
  team          text,
  max_members   integer not null default 50,
  status        text not null default 'active' check (status in ('active', 'completed', 'archived')),
  stage         text default 'Matchday 1',
  trophy        jsonb,           -- { kind: 'preset'|'custom'|'ai', ... }
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_leagues_owner  on public.leagues(owner_id);
create index if not exists idx_leagues_status on public.leagues(status);

create table if not exists public.league_members (
  league_id     uuid not null references public.leagues(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  team_name     text,
  rank          integer,
  points        integer not null default 0,
  primary key (league_id, user_id)
);

create index if not exists idx_league_members_user on public.league_members(user_id);


-- ════════════════════════════════════════════════════════════════════════
-- 4. VENUE EVENTS
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.venue_events (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues(id) on delete cascade,
  host_user_id    uuid not null references public.users(id) on delete cascade,
  name            text not null,
  match_title     text,
  date            date not null,
  time            time,
  sport           text default 'Football',
  max_players     integer not null default 50,
  registered      integer not null default 0,
  status          text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  trophy          jsonb,         -- same shape as leagues.trophy
  created_at      timestamptz not null default now()
);

create index if not exists idx_events_venue  on public.venue_events(venue_id);
create index if not exists idx_events_date   on public.venue_events(date);
create index if not exists idx_events_status on public.venue_events(status);


-- ════════════════════════════════════════════════════════════════════════
-- 5. VENUE CUSTOM TROPHIES (the venue's catalogue of designed trophies)
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.venue_custom_trophies (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references public.venues(id) on delete cascade,
  created_by_user_id  uuid references public.users(id) on delete set null,
  name                text not null,
  description         text,
  icon                text default 'custom',
  rarity              text not null default 'rare' check (rarity in ('common', 'rare', 'epic', 'legendary')),
  times_awarded       integer not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists idx_vct_venue on public.venue_custom_trophies(venue_id);


-- ════════════════════════════════════════════════════════════════════════
-- 6. TROPHIES (awarded — what's in each user's trophy room)
-- ════════════════════════════════════════════════════════════════════════
-- A trophy is either a "preset" (TROPHY_TYPES key) or a "custom" snapshot
-- of a venue trophy at the moment of award. We snapshot custom trophy
-- display data so renaming the venue's catalogue doesn't change history.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.trophies (
  id                  uuid primary key default gen_random_uuid(),
  recipient_user_id   uuid not null references public.users(id) on delete cascade,
  type                text not null,         -- 'league_champion' | 'br_champion' | 'custom' | etc.
  custom              boolean not null default false,
  custom_data         jsonb,                 -- { name, desc, icon, rarity, venue_name, venue_id, category }
  context             jsonb,                 -- { league_name, league_id, venue_name, venue_id, event, ... }
  awarded_at          timestamptz not null default now()
);

create index if not exists idx_trophies_recipient on public.trophies(recipient_user_id);
create index if not exists idx_trophies_type      on public.trophies(type);


-- ════════════════════════════════════════════════════════════════════════
-- 7. VENUE PHOTOS
-- ════════════════════════════════════════════════════════════════════════
-- Photo binaries themselves live in Supabase Storage (bucket: venue-photos),
-- this table holds the metadata. For prototype we can also accept a raw
-- data URL in the storage_url column to keep parity with the localStorage
-- prototype. When we wire up Storage in step 6, frontends switch to
-- uploading binaries and saving the resulting public URL here.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.venue_photos (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  storage_url   text not null,            -- CDN URL or data URL fallback
  is_preset     boolean not null default false,
  preset_id     text,                     -- 'preset_sportsbar_neon' etc. when is_preset
  label         text,
  uploaded_at   timestamptz not null default now()
);

create index if not exists idx_photos_venue on public.venue_photos(venue_id);

-- One row per venue describing which photo is the title and whether to use it.
create table if not exists public.venue_photo_config (
  venue_id          uuid primary key references public.venues(id) on delete cascade,
  title_photo_id    uuid references public.venue_photos(id) on delete set null,
  use_title_photo   boolean not null default false,
  updated_at        timestamptz not null default now()
);


-- ════════════════════════════════════════════════════════════════════════
-- 8. BADGES (per-user and per-venue progress)
-- ════════════════════════════════════════════════════════════════════════
-- Badge definitions (id, name, threshold, etc.) live in client code as
-- PLAYER_BADGES / VENUE_BADGES — we don't need a definitions table.
-- These tables only track per-user/per-venue progress and earned state.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.player_badges (
  user_id     uuid not null references public.users(id) on delete cascade,
  badge_id    text not null,         -- matches PLAYER_BADGES key
  progress    integer not null default 0,
  earned      boolean not null default false,
  earned_at   timestamptz,
  primary key (user_id, badge_id)
);

create table if not exists public.venue_badges (
  venue_id    uuid not null references public.venues(id) on delete cascade,
  badge_id    text not null,         -- matches VENUE_BADGES key
  progress    integer not null default 0,
  earned      boolean not null default false,
  earned_at   timestamptz,
  primary key (venue_id, badge_id)
);


-- ════════════════════════════════════════════════════════════════════════
-- 9. RESERVATIONS (player reserves a spot at a venue event)
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  venue_id    uuid references public.venues(id) on delete set null,
  event_id    uuid references public.venue_events(id) on delete set null,
  status      text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'attended', 'no-show')),
  reserved_at timestamptz not null default now()
);

create index if not exists idx_reservations_user  on public.reservations(user_id);
create index if not exists idx_reservations_venue on public.reservations(venue_id);


-- ════════════════════════════════════════════════════════════════════════
-- 10. GAME HISTORY
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.game_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  match_title     text,
  match_score     text,
  points          integer not null default 0,
  correct         integer not null default 0,
  wrong           integer not null default 0,
  best_streak     integer not null default 0,
  end_streak      integer not null default 0,
  question_types  jsonb,
  rank            integer,
  total_players   integer,
  played_at       timestamptz not null default now(),
  elo_before      integer,
  elo_after       integer
);

create index if not exists idx_history_user     on public.game_history(user_id);
create index if not exists idx_history_elo_game on public.game_history(user_id, played_at desc) where elo_after is not null;


-- ════════════════════════════════════════════════════════════════════════
-- 11. ROW LEVEL SECURITY — enable on every table
-- ════════════════════════════════════════════════════════════════════════
-- Default-deny: with RLS enabled and no policies, nobody can read/write.
-- We then add explicit policies below for what each role IS allowed to do.
-- ════════════════════════════════════════════════════════════════════════

alter table public.users                  enable row level security;
alter table public.venues                 enable row level security;
alter table public.leagues                enable row level security;
alter table public.league_members         enable row level security;
alter table public.venue_events           enable row level security;
alter table public.venue_custom_trophies  enable row level security;
alter table public.trophies               enable row level security;
alter table public.venue_photos           enable row level security;
alter table public.venue_photo_config     enable row level security;
alter table public.player_badges          enable row level security;
alter table public.venue_badges           enable row level security;
alter table public.reservations           enable row level security;
alter table public.game_history           enable row level security;


-- ── USERS policies ──
-- Anyone authenticated can read any user profile (handles, names, avatars
-- are public for trophy rooms, leaderboards, etc.). Only the user can
-- update their own row.
drop policy if exists "users_select_all"      on public.users;
drop policy if exists "users_update_self"     on public.users;
create policy "users_select_all"  on public.users for select using (true);
create policy "users_update_self" on public.users for update using (auth.uid() = id);


-- ── VENUES policies ──
-- Read: anyone (authenticated or not) can see all venues (it's discovery).
-- Insert/Update/Delete: only the owner can modify their own venue.
drop policy if exists "venues_select_all"   on public.venues;
drop policy if exists "venues_insert_self"  on public.venues;
drop policy if exists "venues_update_owner" on public.venues;
drop policy if exists "venues_delete_owner" on public.venues;
create policy "venues_select_all"   on public.venues for select using (true);
create policy "venues_insert_self"  on public.venues for insert with check (auth.uid() = owner_id);
create policy "venues_update_owner" on public.venues for update using (auth.uid() = owner_id);
create policy "venues_delete_owner" on public.venues for delete using (auth.uid() = owner_id);


-- ── LEAGUES policies ──
-- Read: anyone can see public leagues; private leagues only members + owner.
-- Insert: any authenticated user (creating their own league).
-- Update/Delete: only owner.
drop policy if exists "leagues_select_visible" on public.leagues;
drop policy if exists "leagues_insert_self"    on public.leagues;
drop policy if exists "leagues_update_owner"   on public.leagues;
drop policy if exists "leagues_delete_owner"   on public.leagues;
create policy "leagues_select_visible" on public.leagues for select using (
  type = 'public'
  or owner_id = auth.uid()
  or exists (
    select 1 from public.league_members lm
    where lm.league_id = leagues.id and lm.user_id = auth.uid()
  )
);
create policy "leagues_insert_self"  on public.leagues for insert with check (auth.uid() = owner_id);
create policy "leagues_update_owner" on public.leagues for update using (auth.uid() = owner_id);
create policy "leagues_delete_owner" on public.leagues for delete using (auth.uid() = owner_id);


-- ── LEAGUE MEMBERS policies ──
-- Anyone can see league members of leagues they can see. Users can join
-- (insert their own membership) and leave (delete their own row).
drop policy if exists "members_select_visible" on public.league_members;
drop policy if exists "members_insert_self"    on public.league_members;
drop policy if exists "members_delete_self"    on public.league_members;
create policy "members_select_visible" on public.league_members for select using (true);
create policy "members_insert_self"    on public.league_members for insert with check (auth.uid() = user_id);
create policy "members_delete_self"    on public.league_members for delete using (auth.uid() = user_id);


-- ── VENUE EVENTS policies ──
drop policy if exists "events_select_all"      on public.venue_events;
drop policy if exists "events_insert_host"     on public.venue_events;
drop policy if exists "events_update_host"     on public.venue_events;
drop policy if exists "events_delete_host"     on public.venue_events;
create policy "events_select_all"  on public.venue_events for select using (true);
create policy "events_insert_host" on public.venue_events for insert with check (
  auth.uid() = host_user_id
  and exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);
create policy "events_update_host" on public.venue_events for update using (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);
create policy "events_delete_host" on public.venue_events for delete using (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);


-- ── VENUE CUSTOM TROPHIES policies ──
drop policy if exists "vct_select_all"     on public.venue_custom_trophies;
drop policy if exists "vct_insert_owner"   on public.venue_custom_trophies;
drop policy if exists "vct_update_owner"   on public.venue_custom_trophies;
drop policy if exists "vct_delete_owner"   on public.venue_custom_trophies;
create policy "vct_select_all"   on public.venue_custom_trophies for select using (true);
create policy "vct_insert_owner" on public.venue_custom_trophies for insert with check (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);
create policy "vct_update_owner" on public.venue_custom_trophies for update using (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);
create policy "vct_delete_owner" on public.venue_custom_trophies for delete using (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);


-- ── TROPHIES (awarded) policies ──
-- Trophy rooms are PUBLIC — anyone can browse anyone's trophies (badge of
-- pride). Only the recipient or a venue owner who awarded it can insert.
-- Inserts are normally done via a server-side function in production.
drop policy if exists "trophies_select_all"      on public.trophies;
drop policy if exists "trophies_insert_self"     on public.trophies;
drop policy if exists "trophies_delete_recipient" on public.trophies;
create policy "trophies_select_all"      on public.trophies for select using (true);
create policy "trophies_insert_self"     on public.trophies for insert with check (auth.uid() = recipient_user_id);
create policy "trophies_delete_recipient" on public.trophies for delete using (auth.uid() = recipient_user_id);


-- ── PHOTOS policies ──
drop policy if exists "photos_select_all"    on public.venue_photos;
drop policy if exists "photos_insert_owner"  on public.venue_photos;
drop policy if exists "photos_delete_owner"  on public.venue_photos;
create policy "photos_select_all"   on public.venue_photos for select using (true);
create policy "photos_insert_owner" on public.venue_photos for insert with check (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);
create policy "photos_delete_owner" on public.venue_photos for delete using (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);

drop policy if exists "photo_cfg_select_all"   on public.venue_photo_config;
drop policy if exists "photo_cfg_upsert_owner" on public.venue_photo_config;
create policy "photo_cfg_select_all"   on public.venue_photo_config for select using (true);
create policy "photo_cfg_upsert_owner" on public.venue_photo_config for all using (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);


-- ── BADGES policies (player & venue) ──
drop policy if exists "pb_select_all"      on public.player_badges;
drop policy if exists "pb_upsert_self"     on public.player_badges;
create policy "pb_select_all"  on public.player_badges for select using (true);
create policy "pb_upsert_self" on public.player_badges for all using (auth.uid() = user_id);

drop policy if exists "vb_select_all"   on public.venue_badges;
drop policy if exists "vb_upsert_owner" on public.venue_badges;
create policy "vb_select_all"   on public.venue_badges for select using (true);
create policy "vb_upsert_owner" on public.venue_badges for all using (
  exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);


-- ── RESERVATIONS policies ──
drop policy if exists "res_select_self_or_venue" on public.reservations;
drop policy if exists "res_insert_self"          on public.reservations;
drop policy if exists "res_delete_self"          on public.reservations;
create policy "res_select_self_or_venue" on public.reservations for select using (
  auth.uid() = user_id
  or exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())
);
create policy "res_insert_self" on public.reservations for insert with check (auth.uid() = user_id);
create policy "res_delete_self" on public.reservations for delete using (auth.uid() = user_id);


-- ── GAME HISTORY policies ──
drop policy if exists "gh_select_all"  on public.game_history;
drop policy if exists "gh_insert_self" on public.game_history;
create policy "gh_select_all"  on public.game_history for select using (true);
create policy "gh_insert_self" on public.game_history for insert with check (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════
-- 12. SEED DATA — demo venues
-- ════════════════════════════════════════════════════════════════════════
-- These are the 6 hardcoded venues from venues.html, now in the database.
-- They have owner_id = NULL ("system" venues for discovery). When you sign
-- up as a real venue owner you'll insert your own venue with owner_id set.
--
-- IDs are stable strings cast to UUID via md5 so they'll be the same on
-- every fresh provision (helpful for migrating photo data later).
-- ════════════════════════════════════════════════════════════════════════

insert into public.venues (id, owner_id, venue_name, city, country, type, hours, capacity, address, lat, lng, sports, color, description) values
  ('11111111-1111-1111-1111-111111111101', null, 'The Penalty Box',       'London',     'UK',      'Sports Bar', '11:00 - 01:00', 120, '42 Brick Lane, Shoreditch', 51.5219, -0.0714, array['Football','Rugby','Boxing'],         'purple', 'The ultimate matchday experience. 12 screens, draft beers, and Spontix trivia every game night.'),
  ('11111111-1111-1111-1111-111111111102', null, 'Score Sports Lounge',   'Manchester', 'UK',      'Sports Bar', '12:00 - 00:00',  85, '15 Deansgate, City Centre',  53.4794, -2.2453, array['Football','Cricket','Tennis'],       'lime',   'Premium sports viewing with immersive Spontix leagues running every weekend.'),
  ('11111111-1111-1111-1111-111111111103', null, 'The Dugout',            'Liverpool',  'UK',      'Pub',        '14:00 - 23:00',  60, '8 Mathew Street',            53.4055, -2.9877, array['Football','Boxing','MMA'],           'coral',  'Old-school pub, new-school games. Weekly Spontix tournaments with cash prizes.'),
  ('11111111-1111-1111-1111-111111111104', null, 'Arena Bar & Grill',     'Birmingham', 'UK',      'Restaurant', '11:00 - 23:00', 150, '99 Broad St',                52.4744, -1.9149, array['Football','Basketball','Rugby'],     'teal',   'Great food, cold beers, and the best trivia in Brum. Book a table for game night.'),
  ('11111111-1111-1111-1111-111111111105', null, 'Full Time Sports Café', 'Leeds',      'UK',      'Sports Bar', '10:00 - 00:00', 100, '22 Briggate',                53.7960, -1.5424, array['Football','Rugby','Cricket'],        'gold',   'Yorkshire''s premier sports café. 20+ screens and Spontix trivia every match day.'),
  ('11111111-1111-1111-1111-111111111106', null, 'The Final Whistle',     'Dublin',     'Ireland', 'Pub',        '12:00 - 01:30',  80, 'Temple Bar, Dublin 2',       53.3454, -6.2632, array['Football','Rugby','MMA','Boxing'],   'purple', 'Legendary Dublin pub now powered by Spontix. Live games every weekend.')
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════
-- 13. ELO RATING — Battle Royale skill column on users
-- ════════════════════════════════════════════════════════════════════════
-- Standard Elo starting point is 1000. Updated after each BR game using
-- K=32 and a multi-player actualScore = 1 − (rank−1)/(totalPlayers−1).
-- ════════════════════════════════════════════════════════════════════════

alter table public.users add column if not exists elo_rating integer not null default 1000;
create index if not exists idx_users_elo    on public.users(elo_rating desc);
create index if not exists idx_users_points on public.users(total_points desc);


-- ════════════════════════════════════════════════════════════════════════
-- 14. CROSS-USER TROPHY AWARDING — security-definer function
-- ════════════════════════════════════════════════════════════════════════
-- The `trophies` RLS policy only allows self-insert (auth.uid() = recipient).
-- Venue owners and league owners need to award trophies TO players.
-- This SECURITY DEFINER function runs as the DB owner (bypasses RLS) but
-- enforces its own authorization check before inserting:
--   • self-award (always allowed)
--   • caller owns any venue (venue owner awarding event winner)
--   • caller owns any league (league owner awarding league champion)
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.award_trophy_to_winner(
  p_winner_id   uuid,
  p_type        text,
  p_custom      boolean default false,
  p_custom_data jsonb   default '{}'::jsonb,
  p_context     jsonb   default '{}'::jsonb
)
returns public.trophies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller        uuid := auth.uid();
  v_is_authorized boolean;
  v_result        public.trophies;
begin
  -- Must be authenticated
  if v_caller is null then
    raise exception 'award_trophy_to_winner: not authenticated';
  end if;

  -- Winner must exist in public.users
  if not exists (select 1 from public.users where id = p_winner_id) then
    raise exception 'award_trophy_to_winner: winner user not found';
  end if;

  -- Authorization: self-award OR caller owns a venue OR caller owns a league
  select (
    v_caller = p_winner_id
    or exists (select 1 from public.venues  where owner_id = v_caller)
    or exists (select 1 from public.leagues where owner_id = v_caller)
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'award_trophy_to_winner: caller is not authorized to award trophies';
  end if;

  -- Insert the trophy (bypasses RLS because SECURITY DEFINER)
  insert into public.trophies (recipient_user_id, type, custom, custom_data, context)
  values (p_winner_id, p_type, p_custom, p_custom_data, p_context)
  returning * into v_result;

  -- Keep winner's trophy count in sync
  update public.users
  set trophies_count = trophies_count + 1,
      updated_at     = now()
  where id = p_winner_id;

  return v_result;
end;
$$;

-- Allow any authenticated user to call it (the function enforces authz internally)
grant execute on function public.award_trophy_to_winner(uuid, text, boolean, jsonb, jsonb)
  to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- DONE. Verify with:  select count(*) from public.venues;  -- expect 6
-- ════════════════════════════════════════════════════════════════════════
