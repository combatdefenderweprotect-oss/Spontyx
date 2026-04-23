-- ════════════════════════════════════════════════════════════════════
-- 003_cron_schedule.sql
-- Schedules the generate-questions Edge Function via pg_cron + pg_net.
--
-- Prerequisites (run once in Supabase dashboard → Extensions):
--   • pg_cron   — enable at: Dashboard → Database → Extensions → pg_cron
--   • pg_net    — enable at: Dashboard → Database → Extensions → pg_net
--
-- Run this file in: Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Enable required extensions ─────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 2. Grant pg_cron usage to postgres role ───────────────────────────
-- (already granted by default in Supabase, but included for safety)
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- ── 3. Remove existing job if re-running this migration ───────────────
select cron.unschedule('generate-questions-every-6h')
where exists (
  select 1 from cron.job where jobname = 'generate-questions-every-6h'
);

-- ── 4. Schedule the Edge Function every 6 hours ───────────────────────
-- Fires at 00:00, 06:00, 12:00, 18:00 UTC daily.
-- Adjust the schedule string (cron syntax) to change frequency.
--
-- The CRON_SECRET value below must match the CRON_SECRET environment
-- variable set on the Edge Function (see deployment instructions).
-- Replace spontix-cron-abc123 with your actual secret before running.

select cron.schedule(
  'generate-questions-every-6h',   -- job name (unique)
  '0 */6 * * *',                   -- cron schedule: every 6 hours
  $$
    select net.http_get(
      url     => 'https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/generate-questions',
      headers => jsonb_build_object(
        'Authorization', 'Bearer <<YOUR_CRON_SECRET>>',
        'Content-Type',  'application/json'
      )
    );
  $$
);

-- ── 5. Verify the job was created ─────────────────────────────────────
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'generate-questions-every-6h';

-- ── 6. Optional: view recent job run history ──────────────────────────
-- select * from cron.job_run_details where jobid = <id from above> order by start_time desc limit 20;
