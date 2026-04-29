-- ── Migration 023: Live question analytics views ─────────────────────────────
--
-- Mirrors migration 020 (prematch analytics) for CORE_MATCH_LIVE questions.
-- Reads from generation_run_leagues filtered to generation_mode IN ('live_gap','live_event').
--
-- Views created:
--   analytics_live_quality_summary     — daily summary: totals, rejection rate, trigger split
--   analytics_live_rejection_reasons   — per-reason breakdown from rejection_log JSONB
--
-- Safe to run multiple times (CREATE OR REPLACE).
-- ──────────────────────────────────────────────────────────────────────────────


-- ── View 1: Daily live generation summary ────────────────────────────────────
--
-- One row per day. Tracks:
--   total_generated       — CORE_MATCH_LIVE questions successfully inserted
--   total_rejected        — questions rejected across all validation stages
--   rejection_rate        — rejected / (generated + rejected), 0–1
--   time_driven_runs      — cycles with generation_mode = 'live_gap'
--   event_driven_runs     — cycles with generation_mode = 'live_event'
--   skipped_runs          — cycles that were skipped before generation
--   halftime_skips        — skipped due to HT pause
--   rate_limit_skips      — skipped due to 3-min rate limit
--   active_cap_skips      — skipped due to active question cap (max 2)
--   late_match_skips      — skipped due to match_minute >= 89
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW analytics_live_quality_summary AS
SELECT
  date_trunc('day', processed_at)::date                                          AS day,

  -- Volume
  SUM(questions_generated)                                                        AS total_generated,
  SUM(questions_rejected)                                                         AS total_rejected,
  CASE
    WHEN SUM(questions_generated) + SUM(questions_rejected) = 0 THEN 0
    ELSE ROUND(
      SUM(questions_rejected)::numeric /
      NULLIF(SUM(questions_generated) + SUM(questions_rejected), 0),
      3
    )
  END                                                                             AS rejection_rate,

  -- Trigger split
  COUNT(*) FILTER (WHERE generation_mode = 'live_gap')                           AS time_driven_runs,
  COUNT(*) FILTER (WHERE generation_mode = 'live_event')                         AS event_driven_runs,

  -- Skip breakdown
  COUNT(*) FILTER (WHERE skipped = true)                                          AS skipped_runs,
  COUNT(*) FILTER (WHERE skip_reason = 'halftime_pause')                          AS halftime_skips,
  COUNT(*) FILTER (WHERE skip_reason = 'rate_limit_3min_live')                    AS rate_limit_skips,
  COUNT(*) FILTER (WHERE skip_reason = 'active_question_cap_reached')             AS active_cap_skips,
  COUNT(*) FILTER (WHERE skip_reason = 'match_minute_too_late')                   AS late_match_skips,
  COUNT(*) FILTER (WHERE skip_reason = 'no_live_stats_available')                 AS no_stats_skips,

  -- Total cycles evaluated
  COUNT(*)                                                                         AS total_cycles

FROM generation_run_leagues
WHERE generation_mode IN ('live_gap', 'live_event')
GROUP BY date_trunc('day', processed_at)::date
ORDER BY day DESC;


-- ── View 2: Live rejection reason breakdown ───────────────────────────────────
--
-- One row per rejection log entry from live generation runs.
-- Unnests the rejection_log JSONB array so each rejection is a separate row.
--
-- Columns:
--   day          — UTC date of the run
--   league_id    — league the rejection occurred in
--   stage        — validation stage: schema_validation | entity_validation |
--                  temporal_validation | logic_validation | live_timing_validation
--   error        — raw error string from the validator
--   question_text — question text that was rejected (may be null)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW analytics_live_rejection_reasons AS
SELECT
  date_trunc('day', grl.processed_at)::date            AS day,
  grl.league_id,
  grl.generation_mode,
  entry->>'stage'                                       AS stage,
  entry->>'error'                                       AS error,
  entry->>'question_text'                               AS question_text,
  (entry->>'attempt')::int                              AS attempt
FROM generation_run_leagues grl,
     jsonb_array_elements(grl.rejection_log) AS entry
WHERE grl.generation_mode IN ('live_gap', 'live_event')
  AND grl.rejection_log IS NOT NULL
  AND jsonb_array_length(grl.rejection_log) > 0
ORDER BY grl.processed_at DESC;


-- ── Permissions ───────────────────────────────────────────────────────────────
GRANT SELECT ON analytics_live_quality_summary   TO authenticated;
GRANT SELECT ON analytics_live_quality_summary   TO anon;
GRANT SELECT ON analytics_live_rejection_reasons TO authenticated;
GRANT SELECT ON analytics_live_rejection_reasons TO anon;
