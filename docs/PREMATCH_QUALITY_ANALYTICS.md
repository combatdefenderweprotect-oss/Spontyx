# Prematch Quality Analytics

Lightweight analytics layer for monitoring the prematch question quality filter.

**Filter location:** `supabase/functions/generate-questions/lib/prematch-quality-filter.ts`  
**Activated:** 2026-04-28 (Edge Function v2.1, migration 020)

---

## How it works

Every time the prematch generation pipeline runs, `filterPrematchBatch()` evaluates each candidate question against 9 quality rules and produces a score from 0–100. Questions below 60 are rejected; questions 60–75 are kept only if needed to fill quota. All rejections are logged to `generation_run_leagues.rejection_log` as structured JSONB entries with a normalized `reason` field and numeric `score`.

### Rejection log entry format (prematch_quality stage)

```json
{
  "attempt": 1,
  "stage": "prematch_quality",
  "question_text": "Will Arsenal win against Chelsea?",
  "error": "too_obvious (score=45)",
  "reason": "too_obvious",
  "score": 45,
  "fixture_id": "1234567",
  "timestamp": "2026-04-28T14:00:00.000Z"
}
```

---

## Normalized reason codes

| Code | Meaning | Penalty |
|---|---|---|
| `too_obvious` | Winner question in heavy-favourite match, or no standings to assess | −20 to −35 pts |
| `duplicate_question` | Near-duplicate of accepted or prior-round question, or same player appears twice | −30 to −40 pts |
| `too_many_player_specific` | Exceeds cap of 2 player-specific questions per batch | Hard cap (score=0) |
| `poor_team_balance` | Would over-represent one team when all accepted questions already focus on the same team | −15 pts |
| `low_quality_score` | Catch-all: over-represented category, short/generic question, or weak resolvability hint | −20 to −25 pts |

---

## Quality score thresholds

| Score range | Decision |
|---|---|
| 90–100 | Strong accept |
| 75–89 | Accept |
| 60–74 | Marginal — accept only if quota not yet filled |
| < 60 | Hard reject |
| 0 | Hard cap (player-specific over limit) |

---

## Analytics views (migration 020)

Run `backend/migrations/020_prematch_analytics_views.sql` in the Supabase SQL editor to create these views.

### `analytics_prematch_quality_summary`

Daily summary of filter activity. Use this to track trend over time.

```sql
SELECT * FROM analytics_prematch_quality_summary LIMIT 14;
```

**Columns:**

| Column | Description |
|---|---|
| `date` | UTC calendar day |
| `total_generated` | Questions that entered the filter (accepted + rejected by quality filter) |
| `total_rejected` | Questions rejected by the prematch quality filter |
| `rejection_rate` | `total_rejected / total_generated × 100` — target < 40% |
| `avg_quality_score` | Mean score of rejected questions — target > 45 (if low, questions aren't even close) |
| `rejected_too_obvious` | Winner questions in mismatched fixtures |
| `rejected_duplicates` | Near-duplicate or same-player-twice rejections |
| `rejected_player_specific` | Over player-specific cap (> 2 per batch) |
| `rejected_team_balance` | Questions that over-represent one team |
| `rejected_low_score` | Catch-all: short, generic, unresolvable, or over-category |

### `analytics_prematch_score_distribution`

Score bucket breakdown by day — use this to tune the 60/75 thresholds.

```sql
SELECT * FROM analytics_prematch_score_distribution LIMIT 30;
```

**Columns:** `date`, `score_bucket` (0-50 / 50-60 / 60-75 / 75-90 / 90+), `count`

Note: only rejected questions appear here (accepted questions are not in rejection_log). A large `60-75` bucket means many marginal questions — consider whether the prompt or thresholds need tuning.

---

## Part 4 — Dashboard queries

### Overall health check

```sql
SELECT
  date,
  total_generated,
  total_rejected,
  rejection_rate || '%' AS rejection_rate,
  avg_quality_score
FROM analytics_prematch_quality_summary
ORDER BY date DESC
LIMIT 7;
```

### Rejection breakdown by reason (last 7 days)

```sql
SELECT
  SUM(rejected_too_obvious)       AS too_obvious,
  SUM(rejected_duplicates)        AS duplicates,
  SUM(rejected_player_specific)   AS player_cap,
  SUM(rejected_team_balance)      AS team_balance,
  SUM(rejected_low_score)         AS low_score,
  SUM(total_rejected)             AS total
FROM analytics_prematch_quality_summary
WHERE date >= current_date - 7;
```

### Score distribution (last 7 days)

```sql
SELECT
  score_bucket,
  SUM(count) AS total_questions
FROM analytics_prematch_score_distribution
WHERE date >= current_date - 7
GROUP BY 1
ORDER BY 1;
```

### Raw rejection log inspection (most recent 20)

```sql
SELECT
  gr.started_at,
  grl.league_id,
  entry->>'question_text' AS question_text,
  entry->>'reason'        AS reason,
  (entry->>'score')::int  AS score,
  entry->>'fixture_id'    AS fixture_id
FROM generation_run_leagues grl
JOIN generation_runs gr ON gr.id = grl.run_id,
  jsonb_array_elements(grl.rejection_log) AS entry
WHERE entry->>'stage' = 'prematch_quality'
ORDER BY gr.started_at DESC
LIMIT 20;
```

### Find the most-rejected fixture

```sql
SELECT
  entry->>'fixture_id' AS fixture_id,
  COUNT(*)             AS rejection_count,
  ROUND(AVG((entry->>'score')::numeric), 1) AS avg_score
FROM generation_run_leagues grl
JOIN generation_runs gr ON gr.id = grl.run_id,
  jsonb_array_elements(grl.rejection_log) AS entry
WHERE entry->>'stage' = 'prematch_quality'
  AND entry->>'fixture_id' IS NOT NULL
  AND gr.started_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;
```

---

## Monitoring thresholds

| Metric | Green | Yellow | Red — investigate |
|---|---|---|---|
| Rejection rate (daily) | < 30% | 30–50% | > 50% |
| `rejected_too_obvious` share | < 20% of rejections | 20–40% | > 40% — prompt needs stricter winner rule |
| `rejected_duplicates` share | < 15% of rejections | 15–30% | > 30% — model generating repetitive questions |
| `rejected_low_score` share | < 30% of rejections | 30–50% | > 50% — overall question quality issue |
| `avg_quality_score` of rejected | > 50 | 35–50 | < 35 — questions far below bar; filter working hard |

If rejection rate exceeds 50% consistently:
1. Check the score distribution — are most rejections 50-60 (marginal) or 0-50 (deeply poor)?
2. If 0-50 dominates, the prompt is producing weak questions; bump to `v2.2` with stronger category rules.
3. If 50-60 dominates, the threshold may be too strict — consider lowering the hard-reject threshold from 60 to 55.

If `rejected_too_obvious` is > 40% of all rejections:
- The current fixture schedule likely has many mismatched opponents.
- Consider relaxing the `standingGap >= 5` threshold to `>= 7` in `scorePrematchQuestionQuality()`.
- Or instruct OpenAI in the prompt to explicitly avoid winner questions when standingGap is provided.

---

## Implementation notes

- `fixture_id` and `timestamp` fields are only present on entries written after Edge Function v2.1 (2026-04-28). Older entries have only `stage`, `question_text`, and `error` string.
- The analytics views are resilient to missing fields via `IS NOT NULL` guards on `score`.
- Views are aggregate-only — no question text or user data is exposed in summary rows.
- The `error` string field is kept alongside the structured fields for human-readable log inspection in the Supabase dashboard.

---

## Future improvement: log accepted questions

Currently only rejected questions appear in `rejection_log`. Accepted questions are not scored after the filter runs — their scores are discarded. To enable full score distribution tracking (not just rejected):

1. Update `filterPrematchBatch()` to return `{ accepted, rejected, acceptedScores: { question_text, score }[] }`
2. Add a separate `prematch_quality_accepted` entry type to the rejection log (or a new column)
3. Update the analytics views to separate accepted vs rejected score distributions

This would allow measuring the true quality floor of accepted questions, not just the rejected tail. Deferred post-launch — current analytics are sufficient for monitoring filter behaviour.

---

## Future Extension — LIVE Quality Analytics

The live generation pipeline is now deployed. Operational live analytics (generation counts, skip reasons, cycle totals) are covered by migration 023 (`analytics_live_quality_summary` and `analytics_live_rejection_reasons` views). The **quality filter analytics** described here — scoring rejected live questions at the `live_quality` stage — are a separate future item. The live generation pipeline does not yet include a `filterLiveBatch()` equivalent to the prematch quality filter.

### How it will work

- The live generation pipeline will include a `filterLiveBatch()` function equivalent to `filterPrematchBatch()` for prematch
- Rejected live questions will be written to `generation_run_leagues.rejection_log` using `stage: 'live_quality'`
- The entry structure is identical to prematch quality entries:

```json
{
  "attempt": 1,
  "stage": "live_quality",
  "question_text": "Will there be a goal in the next 5 minutes?",
  "error": "duplicate_question (score=38)",
  "reason": "duplicate_question",
  "score": 38,
  "fixture_id": "1234567",
  "timestamp": "2026-05-15T19:34:00.000Z"
}
```

### Live-specific normalized reason codes

The same 5 canonical codes will be reused (`too_obvious`, `duplicate_question`, `too_many_player_specific`, `poor_team_balance`, `low_quality_score`) with two additions for live-specific failure modes:

| Code | Meaning |
|---|---|
| `window_too_short` | Answer window would be < 90s — fairness minimum not met |
| `stale_match_state` | Match context was fetched > 60s ago — question no longer reflects live state |

### Analytics views

**Migration 023 (deployed ✅):** `analytics_live_quality_summary` and `analytics_live_rejection_reasons` cover operational live generation metrics (cycles, skip reasons, generated/rejected counts by mode).

**Future migration:** when a `filterLiveBatch()` quality filter is implemented, two additional views will be added:

- `analytics_live_quality_score_summary` — daily live quality-scored rejection summary (mirrors `analytics_prematch_quality_summary`)
- `analytics_live_score_distribution` — score bucket breakdown for live questions that went through quality scoring

The existing prematch and operational live views remain unchanged. The future quality views query `rejection_log` filtered by `stage = 'live_quality'`.

**DO NOT IMPLEMENT** — document only. Live generation is a post-MVP activation. See `docs/LIVE_QUESTION_SYSTEM.md` for the full live system design and `CLAUDE.md` for the post-MVP activation plan.
