-- ════════════════════════════════════════════════════════════════════════
-- 002_ai_questions.sql
-- AI-generated real-world questions system
-- Run after 001_initial_schema.sql
-- Idempotent — safe to re-run
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- 1. SPORTS COMPETITIONS — supported competitions per sport
--    Used in the league creation wizard to let admins pick which
--    competition their league follows. Seeded with MVP competitions.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.sports_competitions (
  id               uuid primary key default gen_random_uuid(),
  sport            text not null,                  -- 'football' | 'hockey' | 'tennis'
  name             text not null,
  short_name       text,
  country          text,
  api_provider     text not null default 'api-sports',
  api_league_id    integer not null,               -- ID in the provider's system
  api_season       integer not null,               -- current season year (e.g. 2025)
  is_active        boolean not null default true,
  display_order    integer not null default 99,
  created_at       timestamptz not null default now()
);

create unique index if not exists idx_sports_comp_api
  on public.sports_competitions(sport, api_provider, api_league_id);

-- Seed: Football competitions (API-Sports api-football.com)
insert into public.sports_competitions
  (sport, name, short_name, country, api_provider, api_league_id, api_season, display_order)
values
  ('football', 'Premier League',      'PL',  'England',  'api-sports', 39,  2025, 1),
  ('football', 'La Liga',             'LL',  'Spain',    'api-sports', 140, 2025, 2),
  ('football', 'Bundesliga',          'BL',  'Germany',  'api-sports', 78,  2025, 3),
  ('football', 'Serie A',             'SA',  'Italy',    'api-sports', 135, 2025, 4),
  ('football', 'Ligue 1',             'L1',  'France',   'api-sports', 61,  2025, 5),
  ('football', 'UEFA Champions League','UCL', 'Europe',  'api-sports', 2,   2025, 6),
  ('football', 'UEFA Europa League',  'UEL', 'Europe',   'api-sports', 3,   2025, 7),
  -- Hockey (API-Sports api-hockey.com)
  ('hockey',   'NHL',                 'NHL', 'USA/Canada','api-sports', 57,  2025, 10),
  -- Tennis (api-tennis.com — tournament-based; league_id is a placeholder)
  ('tennis',   'ATP Tour',            'ATP', 'Global',   'api-sports', 1,   2025, 20),
  ('tennis',   'WTA Tour',            'WTA', 'Global',   'api-sports', 2,   2025, 21)
on conflict (sport, api_provider, api_league_id) do update
  set api_season    = excluded.api_season,
      name          = excluded.name,
      is_active     = excluded.is_active;


-- ════════════════════════════════════════════════════════════════════════
-- 2. SPORTS TEAMS — seeded major teams per competition
--    Used in team-specific league scope to let admins pick a team.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.sports_teams (
  id               uuid primary key default gen_random_uuid(),
  sport            text not null,
  name             text not null,
  short_name       text,
  api_provider     text not null default 'api-sports',
  api_team_id      integer not null,
  api_league_id    integer not null,               -- which competition this team belongs to
  country          text,
  is_active        boolean not null default true
);

create unique index if not exists idx_sports_team_api
  on public.sports_teams(sport, api_provider, api_team_id, api_league_id);

-- Seed: Premier League teams
insert into public.sports_teams (sport, name, short_name, api_provider, api_team_id, api_league_id, country)
values
  ('football','Arsenal',           'ARS','api-sports',42, 39,'England'),
  ('football','Chelsea',           'CHE','api-sports',49, 39,'England'),
  ('football','Liverpool',         'LIV','api-sports',40, 39,'England'),
  ('football','Manchester City',   'MCI','api-sports',50, 39,'England'),
  ('football','Manchester United', 'MUN','api-sports',33, 39,'England'),
  ('football','Tottenham',         'TOT','api-sports',47, 39,'England'),
  ('football','Newcastle United',  'NEW','api-sports',34, 39,'England'),
  ('football','Aston Villa',       'AVL','api-sports',66, 39,'England'),
  ('football','West Ham United',   'WHU','api-sports',48, 39,'England'),
  ('football','Brighton',          'BHA','api-sports',51, 39,'England'),
  ('football','Everton',           'EVE','api-sports',45, 39,'England'),
  ('football','Fulham',            'FUL','api-sports',36, 39,'England'),
  ('football','Wolves',            'WOL','api-sports',39, 39,'England'),
  ('football','Crystal Palace',    'CRY','api-sports',52, 39,'England'),
  ('football','Nottm Forest',      'NFO','api-sports',65, 39,'England'),
  -- La Liga teams
  ('football','Barcelona',         'BAR','api-sports',529,140,'Spain'),
  ('football','Real Madrid',       'RMA','api-sports',541,140,'Spain'),
  ('football','Atletico Madrid',   'ATM','api-sports',530,140,'Spain'),
  ('football','Athletic Bilbao',   'ATH','api-sports',531,140,'Spain'),
  ('football','Real Sociedad',     'RSO','api-sports',548,140,'Spain'),
  ('football','Villarreal',        'VIL','api-sports',533,140,'Spain'),
  ('football','Sevilla',           'SEV','api-sports',536,140,'Spain'),
  ('football','Real Betis',        'BET','api-sports',543,140,'Spain'),
  -- Bundesliga teams
  ('football','Bayern Munich',     'BAY','api-sports',157,78,'Germany'),
  ('football','Borussia Dortmund', 'BVB','api-sports',165,78,'Germany'),
  ('football','RB Leipzig',        'RBL','api-sports',173,78,'Germany'),
  ('football','Bayer Leverkusen',  'LEV','api-sports',168,78,'Germany'),
  ('football','Eintracht Frankfurt','SGE','api-sports',169,78,'Germany'),
  -- Serie A teams
  ('football','Juventus',          'JUV','api-sports',496,135,'Italy'),
  ('football','Inter Milan',       'INT','api-sports',505,135,'Italy'),
  ('football','AC Milan',          'ACM','api-sports',489,135,'Italy'),
  ('football','Roma',              'ROM','api-sports',497,135,'Italy'),
  ('football','Napoli',            'NAP','api-sports',492,135,'Italy'),
  ('football','Lazio',             'LAZ','api-sports',487,135,'Italy'),
  ('football','Atalanta',          'ATA','api-sports',499,135,'Italy'),
  -- NHL teams (api-hockey)
  ('hockey','Boston Bruins',       'BOS','api-sports',1,  57,'USA'),
  ('hockey','Colorado Avalanche',  'COL','api-sports',4,  57,'USA'),
  ('hockey','Vegas Golden Knights','VGK','api-sports',24, 57,'USA'),
  ('hockey','Florida Panthers',    'FLA','api-sports',13, 57,'USA'),
  ('hockey','New York Rangers',    'NYR','api-sports',18, 57,'USA'),
  ('hockey','Toronto Maple Leafs', 'TOR','api-sports',22, 57,'Canada'),
  ('hockey','Edmonton Oilers',     'EDM','api-sports',9,  57,'Canada'),
  ('hockey','Carolina Hurricanes', 'CAR','api-sports',3,  57,'USA')
on conflict (sport, api_provider, api_team_id, api_league_id) do update
  set name       = excluded.name,
      is_active  = excluded.is_active;


-- ════════════════════════════════════════════════════════════════════════
-- 3. EXTEND LEAGUES TABLE — AI questions config + scope + duration
-- ════════════════════════════════════════════════════════════════════════
alter table public.leagues
  add column if not exists scope               text not null default 'full_league'
                                                 check (scope in ('full_league','team_specific')),
  add column if not exists scoped_team_id      text,      -- external API team id (api_sports_teams.api_team_id as text)
  add column if not exists scoped_team_name    text,      -- display name for the scoped team
  add column if not exists league_start_date   date,
  add column if not exists league_end_date     date,
  add column if not exists ai_questions_enabled boolean not null default false,
  add column if not exists ai_weekly_quota     integer not null default 0,
  add column if not exists ai_total_quota      integer not null default 0,
  add column if not exists api_sports_league_id integer,  -- competition's API id
  add column if not exists api_sports_team_id  integer,   -- team's API id (team_specific only)
  add column if not exists api_sports_season   integer,   -- e.g. 2025
  add column if not exists join_password       text;      -- used for private leagues

create index if not exists idx_leagues_ai_enabled
  on public.leagues(ai_questions_enabled) where ai_questions_enabled = true;


-- ════════════════════════════════════════════════════════════════════════
-- 4. GENERATION RUNS — top-level audit record per cycle execution
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.generation_runs (
  id                    uuid primary key default gen_random_uuid(),
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  status                text not null default 'running'
                          check (status in ('running','completed','failed')),
  trigger_type          text not null check (trigger_type in ('scheduled','manual')),
  prompt_version        text not null default 'v1.0',

  -- Aggregate counters
  leagues_evaluated     integer not null default 0,
  leagues_skipped       integer not null default 0,
  leagues_processed     integer not null default 0,
  questions_generated   integer not null default 0,
  questions_rejected    integer not null default 0,

  error_summary         jsonb   -- populated only on status='failed'
);

create index if not exists idx_gen_runs_started on public.generation_runs(started_at desc);


-- ════════════════════════════════════════════════════════════════════════
-- 5. GENERATION RUN LEAGUES — per-league breakdown within a run
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.generation_run_leagues (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid not null references public.generation_runs(id) on delete cascade,
  league_id               uuid not null references public.leagues(id) on delete cascade,
  sport                   text not null,
  processed_at            timestamptz not null default now(),

  -- Time-awareness fields
  generation_mode         text check (generation_mode in ('match_preview','narrative_preview','narrative_only')),
  earliest_match_kickoff  timestamptz,
  hours_until_kickoff     integer,
  league_priority_score   integer,

  -- Quota snapshot at time of run
  quota_total             integer not null default 0,
  quota_used_total        integer not null default 0,
  quota_used_this_week    integer not null default 0,
  questions_requested     integer not null default 0,

  -- Outcomes
  questions_generated     integer not null default 0,
  questions_rejected      integer not null default 0,

  -- Per-attempt rejection detail
  rejection_log           jsonb,
  -- shape: [{"attempt":1,"stage":"predicate_parse","error":"...","question_text":"..."}]

  -- Skip detail
  skipped                 boolean not null default false,
  skip_reason             text check (skip_reason in (
                            'quota_reached',
                            'no_upcoming_matches',
                            'disabled',
                            'league_not_started',
                            'league_ended',
                            'missing_api_config'
                          )),

  -- News layer
  news_items_fetched      integer not null default 0,
  news_unavailable        boolean not null default false,
  news_snapshot           jsonb,
  -- shape: [{"headline":"...","source":"...","published_at":"...","relevance_tag":"..."}]

  duration_ms             integer,

  constraint unique_run_league unique (run_id, league_id)
);

create index if not exists idx_gen_run_leagues_run    on public.generation_run_leagues(run_id);
create index if not exists idx_gen_run_leagues_league on public.generation_run_leagues(league_id);


-- ════════════════════════════════════════════════════════════════════════
-- 6. QUESTIONS — all question types (manual, ai_generated, live_driven)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.questions (
  id                    uuid primary key default gen_random_uuid(),
  league_id             uuid not null references public.leagues(id) on delete cascade,
  created_at            timestamptz not null default now(),

  -- Origin
  source                text not null check (source in ('manual','ai_generated','live_driven')),
  generation_run_id     uuid references public.generation_runs(id) on delete set null,
  created_by_user_id    uuid references public.users(id) on delete set null,

  -- Content
  question_text         text not null,
  type                  text not null check (type in ('binary','multiple_choice')),
  options               jsonb,
  -- binary  → null (answers stored as 'yes'/'no')
  -- mc      → [{"id":"a","text":"..."},{"id":"b","text":"..."},...]

  -- Sports context
  sport                 text not null,
  match_id              text,            -- external API match id
  team_ids              text[],          -- external API team ids involved
  player_ids            text[],          -- external API player ids involved
  event_type            text check (event_type in (
                          'match_result','player_performance','injury','narrative'
                        )),
  narrative_context     text,            -- AI's internal note — never shown to users

  -- Timing
  opens_at              timestamptz not null,
  deadline              timestamptz not null,
  resolves_after        timestamptz not null,

  -- Resolution — natural language
  resolution_rule_text  text not null,

  -- Resolution — structured predicate
  resolution_predicate  jsonb not null,

  -- Resolution — outcome
  resolution_status     text not null default 'pending'
                          check (resolution_status in (
                            'pending','resolved','pending_admin','voided'
                          )),
  resolved_at           timestamptz,
  resolution_outcome    text,            -- winning option id, or 'yes'/'no' for binary
  resolution_source     text check (resolution_source in ('system','admin','auto_void')),
  resolution_note       text,            -- explanation when exception occurs

  -- AI generation metadata
  validation_attempts   integer not null default 0,
  last_validation_error text,
  ai_model              text,            -- e.g. 'gpt-4o'
  ai_prompt_version     text,            -- e.g. 'v1.0'

  -- Admin exception flow
  admin_notified_at     timestamptz,
  admin_action_deadline timestamptz,     -- auto-void if admin takes no action by this time
  admin_action          text check (admin_action in ('resolved_manually','voided')),
  void_replacement_sent boolean not null default false,

  -- Display
  source_badge          text,            -- 'Real World' for ai_generated, null for manual

  -- Constraint: timing must be ordered
  constraint timing_order check (opens_at <= deadline and deadline < resolves_after)
);

create index if not exists idx_questions_league   on public.questions(league_id);
create index if not exists idx_questions_status   on public.questions(resolution_status);
create index if not exists idx_questions_deadline on public.questions(deadline);
create index if not exists idx_questions_run      on public.questions(generation_run_id);
-- Partial index used for quota COUNT queries — keeps them fast at scale
create index if not exists idx_questions_ai_quota on public.questions(league_id, created_at)
  where source = 'ai_generated';


-- ════════════════════════════════════════════════════════════════════════
-- 7. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════

-- sports_competitions: public read, no user writes
alter table public.sports_competitions enable row level security;
drop policy if exists "sc_select_all" on public.sports_competitions;
create policy "sc_select_all" on public.sports_competitions
  for select using (true);

-- sports_teams: public read, no user writes
alter table public.sports_teams enable row level security;
drop policy if exists "st_select_all" on public.sports_teams;
create policy "st_select_all" on public.sports_teams
  for select using (true);

-- questions: league members can read; manual inserts by league owner;
--            AI/live inserts via service_role (Edge Function) — bypass RLS
alter table public.questions enable row level security;
drop policy if exists "q_select_members"  on public.questions;
drop policy if exists "q_insert_manual"   on public.questions;
drop policy if exists "q_update_admin"    on public.questions;

create policy "q_select_members" on public.questions
  for select using (
    exists (
      select 1 from public.league_members
      where league_id = questions.league_id
        and user_id = auth.uid()
    )
  );

create policy "q_insert_manual" on public.questions
  for insert with check (
    source = 'manual'
    and created_by_user_id = auth.uid()
    and exists (
      select 1 from public.leagues
      where id = questions.league_id and owner_id = auth.uid()
    )
  );

create policy "q_update_admin" on public.questions
  for update using (
    exists (
      select 1 from public.leagues
      where id = questions.league_id and owner_id = auth.uid()
    )
  );

-- generation tables: service_role only (Edge Function uses service key)
alter table public.generation_runs        enable row level security;
alter table public.generation_run_leagues enable row level security;
-- no user-facing policies — all access via service_role
