-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 013: sync-fixtures cron jobs
-- ════════════════════════════════════════════════════════════════════════
-- Schedules the four sync-fixtures modes via pg_cron + pg_net.
-- Prerequisites: pg_cron + pg_net already enabled (migration 003).
--
-- Run in Supabase SQL Editor.
-- Safe to re-run — unschedules existing jobs before recreating them.
-- ════════════════════════════════════════════════════════════════════════

-- ── Remove existing jobs if re-running ───────────────────────────────────

SELECT cron.unschedule('sync-fixtures-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-fixtures-daily');

SELECT cron.unschedule('sync-fixtures-prematch')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-fixtures-prematch');

SELECT cron.unschedule('sync-fixtures-live')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-fixtures-live');

SELECT cron.unschedule('sync-fixtures-stats')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-fixtures-stats');


-- ── 1. Daily sync — fixtures + standings ─────────────────────────────────
-- Runs once per day at 06:00 UTC.
-- Fetches upcoming fixtures (next 14 days) and league standings for
-- Premier League (39) and La Liga (140).

SELECT cron.schedule(
  'sync-fixtures-daily',
  '0 6 * * *',
  $$
    SELECT net.http_get(
      url     => 'https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/sync-fixtures?type=daily',
      headers => jsonb_build_object(
        'Authorization', 'Bearer spontix-cron-x7k2m9',
        'Content-Type',  'application/json'
      )
    );
  $$
);


-- ── 2. Pre-match sync — lineups ───────────────────────────────────────────
-- Runs every 30 minutes.
-- Fetches starting XIs for matches kicking off within the next 2 hours.
-- Exits immediately (0 API calls) when no matches are in that window.

SELECT cron.schedule(
  'sync-fixtures-prematch',
  '*/30 * * * *',
  $$
    SELECT net.http_get(
      url     => 'https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/sync-fixtures?type=prematch',
      headers => jsonb_build_object(
        'Authorization', 'Bearer spontix-cron-x7k2m9',
        'Content-Type',  'application/json'
      )
    );
  $$
);


-- ── 3. Live sync — score + events ────────────────────────────────────────
-- Runs every minute.
-- Refreshes fixture status, score, and match events (goals, cards, subs)
-- for relevant live matches only (saved / active league / currently live).
-- Exits immediately with 0 API calls when no relevant matches are found.

SELECT cron.schedule(
  'sync-fixtures-live',
  '* * * * *',
  $$
    SELECT net.http_get(
      url     => 'https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/sync-fixtures?type=live',
      headers => jsonb_build_object(
        'Authorization', 'Bearer spontix-cron-x7k2m9',
        'Content-Type',  'application/json'
      )
    );
  $$
);


-- ── 4. Stats sync — team statistics ──────────────────────────────────────
-- Runs every 3 minutes.
-- Refreshes shots, corners, cards, possession for relevant live matches.
-- Exits immediately with 0 API calls when no relevant matches are found.

SELECT cron.schedule(
  'sync-fixtures-stats',
  '*/3 * * * *',
  $$
    SELECT net.http_get(
      url     => 'https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/sync-fixtures?type=stats',
      headers => jsonb_build_object(
        'Authorization', 'Bearer spontix-cron-x7k2m9',
        'Content-Type',  'application/json'
      )
    );
  $$
);


-- ── Verify all four jobs ─────────────────────────────────────────────────

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'sync-fixtures-%'
ORDER BY jobname;
