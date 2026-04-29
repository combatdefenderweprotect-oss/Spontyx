-- ── Migration 022: Drop outdated skip_reason CHECK on generation_run_leagues ──
--
-- The generation_run_leagues.skip_reason column had a CHECK constraint (from
-- migration 002) that only allowed 6 original values:
--   quota_reached | no_upcoming_matches | disabled |
--   league_not_started | league_ended | missing_api_config
--
-- The generation pipeline has evolved to use many more skip reasons:
--   sport_not_supported_mvp, match_too_distant, no_matches_in_publish_window,
--   halftime_pause, no_live_stats_available, match_minute_too_late,
--   active_question_cap_reached, rate_limit_3min_live, no_questions_generated,
--   venue_ai_preview_cap, real_world_daily_cap, etc.
--
-- Any INSERT with a skip_reason not in the original 6 failed silently with
-- error code 23514 (check_violation), causing generation_run_leagues to have
-- missing rows for most skipped leagues.
--
-- Fix: drop the constraint entirely. skip_reason is an audit/debug field —
-- a free-text column is more useful than a restricted enum here.
--
-- Safe to run multiple times (DROP IF EXISTS).
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.generation_run_leagues
  DROP CONSTRAINT IF EXISTS generation_run_leagues_skip_reason_check;
