# generate-questions — Deployment Guide

## Prerequisites

- Supabase CLI installed: `npm install -g supabase`
- Logged in: `supabase login`
- Project ref: `hdulhffpmuqepoqstsor`

---

## Step 1 — Run the DB migrations

In the Supabase SQL Editor (https://supabase.com/dashboard/project/hdulhffpmuqepoqstsor/sql/new):

Run in order. All migrations are idempotent (safe to re-run).

1. `001_initial_schema.sql` — base tables, RLS policies, seed data
2. `002_ai_questions.sql` — `sports_competitions`, `sports_teams`, `questions`, `generation_runs`, `generation_run_leagues` + new `leagues` columns
3. `003_cron_schedule.sql` — **replace `<<YOUR_CRON_SECRET>>`** before running. Enables `pg_cron` + `pg_net`, schedules generator every 6h
4. `004_player_answers.sql` — **replace `<<YOUR_CRON_SECRET>>`** with the same secret. Creates `player_answers` table + RLS + resolver cron job
5. `005_notifications.sql` — `notifications` table + 5 Postgres SECURITY DEFINER triggers
6. `006_scoring_columns.sql` — adds `visible_from`, `answer_closes_at`, `base_value`, `difficulty_multiplier`, `match_minute_at_generation` to `questions`; adds `streak_at_answer`, `leader_gap_at_answer`, `clutch_multiplier_at_answer`, `multiplier_breakdown` to `player_answers`; updates RLS
7. `007_match_question_pool.sql` — `match_question_pool` + `match_pool_questions` tables; adds `pool_question_id` + `reuse_scope` to `questions`
8. `008_pool_generation_profile.sql` — adds `scope` + `scoped_team_id` to `match_question_pool`; drops old UNIQUE constraint; creates two partial UNIQUE indexes
9. `009_saved_matches.sql` — `saved_matches` table + RLS + indexes
10. `010_question_type_column.sql` — adds `question_type TEXT CHECK IN ('CORE_MATCH_PREMATCH','CORE_MATCH_LIVE','REAL_WORLD')` to `questions`; backfills existing rows; adds index
11. `011_username_constraints.sql` — case-insensitive unique index on `lower(handle)`; updates `handle_new_user` trigger to read first/last name + username from signup metadata
12. `014_user_photos_bucket.sql` — creates `user-photos` Storage bucket for profile photos
13. `015_live_match_stats.sql` — `live_match_stats` table; `fixture_id` column on `leagues`; pg_cron job 8 template (every minute → live-stats-poller)
14. `016_live_match_stats_additions.sql` — additional columns/indexes for live_match_stats
15. `017_question_intensity.sql` — question intensity tracking additions
16. `018_prematch_schedule.sql` — adds `prematch_generation_mode` + `prematch_publish_offset_hours` to `leagues`; index on scheduling mode for AI-enabled leagues
17. `019_cascade_delete_questions.sql` — cleans up orphaned questions; adds `ON DELETE CASCADE` to `questions.league_id` and `league_members.league_id` FKs

---

## Step 2 — Set Edge Function environment variables

In the Supabase dashboard → Settings → Edge Functions → Secrets, add:

| Secret name              | Value |
|--------------------------|-------|
| `OPENAI_API_KEY`         | Your OpenAI API key (sk-...) |
| `API_SPORTS_KEY`         | Your API-Sports key |
| `GNEWS_API_KEY`          | Your GNews API key |
| `CRON_SECRET`            | The same random string you used in step 1 |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase — do not add them manually.

---

## Step 3 — Deploy both Edge Functions

```bash
cd /path/to/Spontix

# Link project (one-time)
supabase link --project-ref hdulhffpmuqepoqstsor

# Deploy question generator
supabase functions deploy generate-questions --project-ref hdulhffpmuqepoqstsor

# Deploy question resolver
supabase functions deploy resolve-questions --project-ref hdulhffpmuqepoqstsor
```

---

## Step 4 — Trigger manually (smoke tests)

**Generator:**
```bash
curl -X POST \
  https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/generate-questions \
  -H "Authorization: Bearer <YOUR_CRON_SECRET>" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{ "ok": true, "run_id": "...", "leaguesEvaluated": N, "leaguesProcessed": N, "generated": N, "rejected": N }
```

Check the generation run:
```sql
select * from generation_runs order by created_at desc limit 5;
select * from generation_run_leagues where run_id = '<run_id>';
```

**Resolver:**
```bash
curl -X GET \
  https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/resolve-questions \
  -H "Authorization: Bearer <YOUR_CRON_SECRET>"
```

Expected response (when no questions are due yet):
```json
{ "ok": true, "resolved": 0, "voided": 0, "skipped": 0 }
```

Check resolved questions and scored answers:
```sql
select id, question_text, resolution_status, resolution_outcome, resolved_at
from questions
where resolution_status != 'pending'
order by resolved_at desc limit 10;

select pa.user_id, pa.answer, pa.is_correct, pa.points_earned
from player_answers pa
where pa.resolved_at is not null
order by pa.resolved_at desc limit 20;
```

---

## Step 5 — Enable AI questions on a league

In the league creation wizard (create-league.html):
1. Pick a sport and competition
2. Set a start and end date
3. Toggle on "AI Real World Questions" in Step 3
4. (Optional) Set Pre-Match Scheduling mode — Automatic (default) or Manual with an offset (Pro: 24h/12h, Elite: 48h/24h/12h/6h)
5. Complete the wizard — the league is created with `ai_questions_enabled = true`

Or directly via SQL for an existing league:
```sql
update leagues set
  ai_questions_enabled          = true,
  ai_weekly_quota               = 10,
  ai_total_quota                = 40,
  api_sports_league_id          = 39,      -- Premier League
  api_sports_season             = 2025,
  league_start_date             = '2025-01-01',
  league_end_date               = '2025-05-31',
  prematch_generation_mode      = 'automatic',   -- or 'manual'
  prematch_publish_offset_hours = 24             -- ignored when mode = 'automatic'
where id = '<league_uuid>';
```

**Pre-match scheduling modes:**
- `automatic` (default) — questions generated any time within 48h of kickoff; `visible_from` = generation time
- `manual` — questions only generated once `now >= kickoff − offset_hours`; `visible_from` = `kickoff − offset_hours`

**Tier gating for manual mode:** Starter = automatic only. Pro = manual with 24h or 12h offset. Elite = manual with 48h, 24h, 12h, or 6h offset.

---

## Monitoring

**Generation runs:**
```sql
select id, status, trigger_type, leagues_evaluated, leagues_processed,
       questions_generated, questions_rejected, created_at, completed_at
from generation_runs
order by created_at desc
limit 10;
```

**Per-league breakdown (last run):**
```sql
select l.name, rl.generation_mode, rl.questions_requested,
       rl.questions_generated, rl.questions_rejected,
       rl.skipped, rl.skip_reason, rl.duration_ms
from generation_run_leagues rl
join leagues l on l.id = rl.league_id
where rl.run_id = (select id from generation_runs order by created_at desc limit 1);
```

**Rejection log (what failed validation and why):**
```sql
select league_id, rejection_log
from generation_run_leagues
where rejection_log is not null
order by created_at desc
limit 10;
```

**Generated questions awaiting resolution:**
```sql
select id, league_id, question_text, type, deadline, resolves_after, resolution_status
from questions
where source = 'ai_generated' and resolution_status = 'pending'
order by deadline asc;
```

---

## Cron schedule

The job fires every 6 hours (00:00, 06:00, 12:00, 18:00 UTC). To change:

```sql
-- Remove existing job
select cron.unschedule('generate-questions-every-6h');

-- Re-schedule (e.g. every 4 hours)
select cron.schedule(
  'generate-questions-every-6h',
  '0 */4 * * *',
  $$ select net.http_get(
    url     => 'https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/generate-questions',
    headers => jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>', 'Content-Type', 'application/json')
  ); $$
);
```

View recent cron run history:
```sql
select * from cron.job_run_details order by start_time desc limit 20;
```

---

## Resolver monitoring

**Questions pending resolution (past their resolves_after):**
```sql
select id, question_text, sport, resolves_after, resolution_status
from questions
where resolution_status = 'pending'
  and resolves_after < now()
order by resolves_after asc;
```

**Resolution outcomes:**
```sql
select resolution_status, resolution_outcome, resolution_source, count(*)
from questions
group by 1, 2, 3
order by 4 desc;
```

**Voided questions and reasons:**
```sql
select question_text, resolution_note, resolved_at
from questions
where resolution_status = 'voided'
order by resolved_at desc limit 20;
```

**Player scores per league:**
```sql
select u.display_name, sum(pa.points_earned) as total_pts, count(*) filter (where pa.is_correct) as correct
from player_answers pa
join public.users u on u.id = pa.user_id
where pa.league_id = '<league_uuid>'
group by u.display_name
order by total_pts desc;
```

**Resolver cron job:**
```sql
-- Both scheduled jobs
select jobid, jobname, schedule, active from cron.job
where jobname in ('generate-questions-every-6h', 'resolve-questions-every-hour');
```
