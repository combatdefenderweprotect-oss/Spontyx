-- Migration 027: rw_quality_score + rw_quality_breakdown columns
-- Adds dedicated columns for REAL_WORLD Call 4 quality gate results.
-- Previously embedded as "[quality=N decision=X]" suffix in narrative_context.
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING).

-- ── 1. Add columns ───────────────────────────────────────────────────────────
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS rw_quality_score     INTEGER,
  ADD COLUMN IF NOT EXISTS rw_quality_breakdown JSONB;

-- ── 2. Index for analytics (only on REAL_WORLD questions) ───────────────────
CREATE INDEX IF NOT EXISTS idx_questions_rw_quality_score
  ON questions (rw_quality_score)
  WHERE question_type = 'REAL_WORLD';

-- ── 3. Backfill existing rows from embedded narrative_context suffix ─────────
-- Extracts the integer after "[quality=" from narrative_context strings like:
--   "Some context text [quality=87 decision=APPROVE]"
UPDATE questions
SET rw_quality_score = (regexp_match(narrative_context, '\[quality=(\d+) decision='))[1]::integer
WHERE question_type = 'REAL_WORLD'
  AND narrative_context LIKE '%[quality=%'
  AND rw_quality_score IS NULL;

-- ── 4. Clean the embedded suffix from narrative_context (cosmetic) ───────────
-- Removes the "[quality=N decision=X]" trailer so the column holds clean text.
UPDATE questions
SET narrative_context = trim(regexp_replace(narrative_context, '\s*\[quality=\d+ decision=\w+\]', '', 'g'))
WHERE question_type = 'REAL_WORLD'
  AND narrative_context LIKE '%[quality=%';

-- ── 5. Grant read access (matches existing column grants) ───────────────────
-- No explicit grant needed — columns inherit table-level RLS (public SELECT).

-- ── 6. Rebuild analytics views to include quality score ─────────────────────
-- Must DROP first — CREATE OR REPLACE cannot add columns in new positions.

DROP VIEW IF EXISTS analytics_realworld_questions;
DROP VIEW IF EXISTS analytics_realworld_summary;

CREATE VIEW analytics_realworld_questions AS
SELECT
  q.id,
  q.created_at,
  q.league_id,
  l.name                                                AS league_name,
  q.question_text,
  q.entity_focus,
  q.confidence_level,
  q.resolution_condition,
  q.resolution_deadline,
  q.resolution_status,
  q.resolution_predicate->>'resolution_type'            AS predicate_type,
  q.resolution_predicate->>'category'                   AS manual_review_category,
  q.rw_context,
  CASE
    WHEN q.rw_context IS NOT NULL AND q.rw_context <> '' THEN true
    ELSE false
  END                                                   AS has_context,
  jsonb_array_length(COALESCE(q.source_news_urls, '[]'::jsonb)) AS source_url_count,
  -- Quality gate (Call 4)
  q.rw_quality_score,
  CASE
    WHEN q.rw_quality_score IS NULL     THEN 'unknown'
    WHEN q.rw_quality_score >= 80       THEN 'approve'
    WHEN q.rw_quality_score >= 65       THEN 'weak'
    ELSE                                     'reject'
  END                                                   AS quality_decision,
  q.rw_quality_breakdown,
  q.answer_closes_at,
  q.resolves_after,
  q.ai_prompt_version,
  -- Resolution health flags
  CASE
    WHEN q.resolution_deadline < now() AND q.resolution_status = 'pending' THEN 'overdue'
    WHEN q.resolution_deadline IS NULL THEN 'no_deadline'
    ELSE 'ok'
  END                                                   AS deadline_status
FROM questions q
LEFT JOIN leagues l ON l.id = q.league_id
WHERE q.question_type = 'REAL_WORLD'
ORDER BY q.created_at DESC;

-- Rebuild summary to include quality score distribution
CREATE VIEW analytics_realworld_summary AS
SELECT
  date_trunc('day', created_at)::date                  AS day,
  count(*)                                             AS total_generated,
  -- Entity focus
  count(*) FILTER (WHERE entity_focus = 'player')      AS player_questions,
  count(*) FILTER (WHERE entity_focus = 'coach')       AS coach_questions,
  count(*) FILTER (WHERE entity_focus = 'team')        AS team_questions,
  count(*) FILTER (WHERE entity_focus = 'club')        AS club_questions,
  -- Confidence levels
  count(*) FILTER (WHERE confidence_level = 'high')    AS high_confidence,
  count(*) FILTER (WHERE confidence_level = 'medium')  AS medium_confidence,
  count(*) FILTER (WHERE confidence_level = 'low')     AS low_confidence,
  -- Resolution types
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'match_lineup')   AS lineup_questions,
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'manual_review')  AS manual_review_questions,
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'match_stat')     AS match_stat_questions,
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'player_stat')    AS player_stat_questions,
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'btts')           AS btts_questions,
  -- Quality score distribution (Call 4)
  count(*) FILTER (WHERE rw_quality_score >= 80)       AS approve_count,
  count(*) FILTER (WHERE rw_quality_score >= 65 AND rw_quality_score < 80) AS weak_count,
  count(*) FILTER (WHERE rw_quality_score < 65)        AS reject_count,
  count(*) FILTER (WHERE rw_quality_score IS NULL)     AS unknown_score_count,
  round(avg(rw_quality_score))                         AS avg_quality_score,
  -- Lifecycle coverage
  count(*) FILTER (WHERE rw_context IS NOT NULL AND rw_context <> '')       AS with_context,
  count(*) FILTER (WHERE resolution_deadline IS NOT NULL)                    AS with_deadline,
  count(*) FILTER (WHERE resolution_condition IS NOT NULL)                   AS with_resolution_condition,
  count(*) FILTER (WHERE source_news_urls IS NOT NULL AND source_news_urls <> '[]')  AS with_source_urls,
  -- Resolution outcomes
  count(*) FILTER (WHERE resolution_status = 'pending')   AS pending,
  count(*) FILTER (WHERE resolution_status = 'resolved')  AS resolved,
  count(*) FILTER (WHERE resolution_status = 'voided')    AS voided,
  count(*) FILTER (WHERE resolution_deadline < now() AND resolution_status = 'pending') AS overdue_pending
FROM questions
WHERE question_type = 'REAL_WORLD'
GROUP BY date_trunc('day', created_at)::date
ORDER BY day DESC;

GRANT SELECT ON analytics_realworld_summary   TO authenticated, anon;
GRANT SELECT ON analytics_realworld_questions TO authenticated, anon;
