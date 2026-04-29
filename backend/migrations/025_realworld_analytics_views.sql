-- Migration 025: REAL_WORLD analytics views
-- Mirrors the prematch (020) and live (023) analytics pattern.
-- Source: questions table filtered by question_type = 'REAL_WORLD'.
-- Safe to re-run (CREATE OR REPLACE).

-- ── View 1: Daily summary ─────────────────────────────────────────────
-- One row per day. Shows volume, entity focus, confidence level,
-- resolution type distribution, and context/deadline coverage.

CREATE OR REPLACE VIEW analytics_realworld_summary AS
SELECT
  date_trunc('day', created_at)::date                                         AS day,

  -- Volume
  count(*)                                                                     AS total_generated,

  -- Entity focus breakdown
  count(*) FILTER (WHERE entity_focus = 'player')                             AS player_questions,
  count(*) FILTER (WHERE entity_focus = 'coach')                              AS coach_questions,
  count(*) FILTER (WHERE entity_focus = 'team')                               AS team_questions,
  count(*) FILTER (WHERE entity_focus = 'club')                               AS club_questions,
  count(*) FILTER (WHERE entity_focus IS NULL)                                AS unknown_entity,

  -- Confidence level breakdown
  count(*) FILTER (WHERE confidence_level = 'high')                           AS high_confidence,
  count(*) FILTER (WHERE confidence_level = 'medium')                         AS medium_confidence,
  count(*) FILTER (WHERE confidence_level = 'low')                            AS low_confidence,

  -- Resolution type breakdown (from predicate JSONB)
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'match_lineup')    AS lineup_questions,
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'manual_review')   AS manual_review_questions,
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'match_stat')      AS match_stat_questions,
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'player_stat')     AS player_stat_questions,
  count(*) FILTER (WHERE resolution_predicate->>'resolution_type' = 'btts')            AS btts_questions,

  -- Lifecycle coverage
  count(*) FILTER (WHERE rw_context IS NOT NULL AND rw_context <> '')         AS with_context,
  count(*) FILTER (WHERE rw_context IS NULL OR rw_context = '')               AS missing_context,
  count(*) FILTER (WHERE resolution_deadline IS NOT NULL)                     AS with_deadline,
  count(*) FILTER (WHERE resolution_condition IS NOT NULL)                    AS with_resolution_condition,
  count(*) FILTER (WHERE source_news_urls IS NOT NULL
                     AND jsonb_array_length(source_news_urls) > 0)            AS with_source_urls,

  -- Resolution outcomes
  count(*) FILTER (WHERE resolution_status = 'pending')                       AS pending,
  count(*) FILTER (WHERE resolution_status = 'resolved')                      AS resolved,
  count(*) FILTER (WHERE resolution_status = 'voided')                        AS voided,

  -- Deadline health
  count(*) FILTER (WHERE resolution_deadline < now()
                     AND resolution_status = 'pending')                       AS overdue_pending

FROM questions
WHERE question_type = 'REAL_WORLD'
GROUP BY date_trunc('day', created_at)::date
ORDER BY day DESC;


-- ── View 2: Question detail ───────────────────────────────────────────
-- One row per REAL_WORLD question. For inspection and debugging.

CREATE OR REPLACE VIEW analytics_realworld_questions AS
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


-- ── Grants ────────────────────────────────────────────────────────────
GRANT SELECT ON analytics_realworld_summary   TO authenticated, anon;
GRANT SELECT ON analytics_realworld_questions TO authenticated, anon;
