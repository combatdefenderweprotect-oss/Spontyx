-- ── Migration 020: Prematch quality analytics views ──────────────────────
-- Run in Supabase SQL editor.
-- Creates two read-only views over generation_run_leagues.rejection_log
-- to track prematch question quality over time.
--
-- Prerequisites:
--   - generation_run_leagues table exists (migration 002)
--   - generation_runs table exists (migration 002) — provides started_at timestamp
--   - rejection_log JSONB column exists (migration 002)
--   - Edge Function writes structured prematch_quality entries with
--     reason, score, fixture_id, timestamp fields (deployed 2026-04-28+)
--
-- Note: generation_run_leagues has no created_at column.
--   Timestamp comes from the parent generation_runs table via run_id → started_at.
--
-- Views are safe to run multiple times (CREATE OR REPLACE).
-- ──────────────────────────────────────────────────────────────────────────

-- ── View 1: Daily rejection summary by reason category ────────────────────
--
-- Rows: one per calendar day where any prematch generation ran.
-- Columns:
--   date                  UTC calendar day (from generation_runs.started_at)
--   total_generated       all questions that entered the filter (accepted + rejected)
--   total_rejected        questions rejected by the prematch quality filter
--   rejection_rate        % of total that were rejected (0–100)
--   avg_quality_score     mean score of rejected questions (NULL if no scores recorded)
--   rejected_too_obvious  winner questions flagged as obvious (heavy favourite / no standings)
--   rejected_duplicates   near-duplicates or same-player-twice
--   rejected_player_specific  over player-specific cap (>2 per batch)
--   rejected_team_balance questions that would over-represent one team
--   rejected_low_score    catch-all for weak/filler/over-category questions

CREATE OR REPLACE VIEW analytics_prematch_quality_summary AS
SELECT
  date_trunc('day', gr.started_at)::date AS date,

  -- Total questions processed by filter = generated + rejected by prematch_quality
  (
    SUM(grl.questions_generated) +
    SUM((
      SELECT COUNT(*)
      FROM jsonb_array_elements(grl.rejection_log) AS e
      WHERE e->>'stage' = 'prematch_quality'
    ))
  ) AS total_generated,

  SUM((
    SELECT COUNT(*)
    FROM jsonb_array_elements(grl.rejection_log) AS e
    WHERE e->>'stage' = 'prematch_quality'
  )) AS total_rejected,

  ROUND(
    SUM((
      SELECT COUNT(*)
      FROM jsonb_array_elements(grl.rejection_log) AS e
      WHERE e->>'stage' = 'prematch_quality'
    ))::numeric /
    NULLIF(
      SUM(grl.questions_generated) +
      SUM((
        SELECT COUNT(*)
        FROM jsonb_array_elements(grl.rejection_log) AS e
        WHERE e->>'stage' = 'prematch_quality'
      )), 0
    ) * 100, 1
  ) AS rejection_rate,

  ROUND(AVG((
    SELECT AVG((e->>'score')::numeric)
    FROM jsonb_array_elements(grl.rejection_log) AS e
    WHERE e->>'stage' = 'prematch_quality'
      AND e->>'score' IS NOT NULL
  )), 1) AS avg_quality_score,

  SUM((
    SELECT COUNT(*)
    FROM jsonb_array_elements(grl.rejection_log) AS e
    WHERE e->>'stage' = 'prematch_quality'
      AND e->>'reason' = 'too_obvious'
  )) AS rejected_too_obvious,

  SUM((
    SELECT COUNT(*)
    FROM jsonb_array_elements(grl.rejection_log) AS e
    WHERE e->>'stage' = 'prematch_quality'
      AND e->>'reason' = 'duplicate_question'
  )) AS rejected_duplicates,

  SUM((
    SELECT COUNT(*)
    FROM jsonb_array_elements(grl.rejection_log) AS e
    WHERE e->>'stage' = 'prematch_quality'
      AND e->>'reason' = 'too_many_player_specific'
  )) AS rejected_player_specific,

  SUM((
    SELECT COUNT(*)
    FROM jsonb_array_elements(grl.rejection_log) AS e
    WHERE e->>'stage' = 'prematch_quality'
      AND e->>'reason' = 'poor_team_balance'
  )) AS rejected_team_balance,

  SUM((
    SELECT COUNT(*)
    FROM jsonb_array_elements(grl.rejection_log) AS e
    WHERE e->>'stage' = 'prematch_quality'
      AND e->>'reason' = 'low_quality_score'
  )) AS rejected_low_score

FROM generation_run_leagues grl
JOIN generation_runs gr ON gr.id = grl.run_id
WHERE grl.rejection_log IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;


-- ── View 2: Quality score distribution by bucket, by day ──────────────────
--
-- Rows: one per (day, score_bucket) combination present in the data.
-- Score buckets: 0-50 | 50-60 | 60-75 | 75-90 | 90+
-- Note: 0-50 = deep reject, 50-60 = borderline, 60-75 = marginal,
--       75-90 = good (accepted), 90+ = excellent (accepted).
-- Accepted questions are NOT in rejection_log — this view shows only
-- rejected questions' scores. Use for tuning the 60/75 thresholds.

CREATE OR REPLACE VIEW analytics_prematch_score_distribution AS
SELECT
  date_trunc('day', gr.started_at)::date AS date,
  CASE
    WHEN (entry->>'score')::numeric < 50  THEN '0-50'
    WHEN (entry->>'score')::numeric < 60  THEN '50-60'
    WHEN (entry->>'score')::numeric < 75  THEN '60-75'
    WHEN (entry->>'score')::numeric < 90  THEN '75-90'
    ELSE '90+'
  END AS score_bucket,
  COUNT(*) AS count
FROM generation_run_leagues grl
JOIN generation_runs gr ON gr.id = grl.run_id,
  jsonb_array_elements(grl.rejection_log) AS entry
WHERE grl.rejection_log IS NOT NULL
  AND entry->>'stage' = 'prematch_quality'
  AND entry->>'score' IS NOT NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 2;


-- ── Grant access (views inherit table RLS, but service role can always read) ──
-- Public read is intentional — these are aggregate stats with no PII.
GRANT SELECT ON analytics_prematch_quality_summary    TO authenticated;
GRANT SELECT ON analytics_prematch_quality_summary    TO anon;
GRANT SELECT ON analytics_prematch_score_distribution TO authenticated;
GRANT SELECT ON analytics_prematch_score_distribution TO anon;
