-- Migration 048: BR 1-Minute Resolver Cron Job
--
-- Schedules a per-minute cron job that calls resolve-questions?br_only=1.
-- This gives BR sessions ~1 minute between rounds instead of up to 60 minutes
-- on the regular hourly resolver cron.
--
-- The regular hourly resolver (job 3) still processes BR questions as a safety
-- net. Double-processing is safe — advance_br_session_round() is idempotent via
-- the last_processed_seq guard.
--
-- ⚠️  Run AFTER the updated resolve-questions Edge Function is deployed.
--     Running this before the deploy means the 1-minute job hits the old
--     resolver which has no br_only param and would process all question
--     types every minute (expensive + unnecessary).
--
-- Replace <<YOUR_CRON_SECRET>> with the value stored in
-- Supabase Secrets → CRON_SECRET (same secret used by jobs 2, 3, 8).


-- ── Schedule the job ──────────────────────────────────────────────────────────

SELECT cron.schedule(
  'br-resolve-every-minute',
  '* * * * *',
  $$
    SELECT net.http_get(
      url    := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/resolve-questions?br_only=1',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer spontix-cron-x7k2m9'
      )
    )
  $$
);


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'br-resolve-every-minute';
