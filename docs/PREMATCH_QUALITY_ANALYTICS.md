# Prematch Quality Analytics

Monitoring and analytics for the two-pass prematch question quality filter.

**Filter location:** `supabase/functions/generate-questions/lib/prematch-quality-filter.ts`  
**Last updated:** 2026-05-05 (Edge Function v60 — added post-predicate strict filter)

---

## Two-pass filter architecture

Prematch quality filtering runs in two passes. Both apply only to `CORE_MATCH_PREMATCH` questions (`generation_trigger = 'prematch_only'`). LIVE and REAL_WORLD questions pass through unchanged.

### Pass 1 — Pre-predicate text/category filter (`filterPrematchBatch`)

Runs **after** `generateQuestions()` (Call 1) and **before** `convertToPredicate()` (Call 2).

Saves token cost by discarding low-quality candidates before OpenAI converts them to structured predicates.

Operates on: raw question text, `question_category`, `question_subtype`, `predicate_hint`.

Rules (scored 0–100):
- Obvious winner question in heavy-favourite match (standingGap ≥ 5) → −35 pts
- Winner question with no standings data → −20 pts
- Near-duplicate of accepted question in batch (Jaccard ≥ 0.65) → −40 pts
- Near-duplicate of prior-round committed question → −40 pts
- Same player already in accepted or prior questions → −30 pts
- Over-represented category (≥ 2 already accepted) → −20 pts
- Poor team balance (all accepted questions focus on same team) → −15 pts
- Short/generic question (≤ 7 words) → −25 pts
- Weak resolvability hint → −20 pts

Thresholds: score < 60 → hard reject; 60–74 → marginal (kept only if quota not filled); ≥ 75 → accept.

Player-specific cap: ≥ 2 player-specific already in batch → hard reject (score = 0).

Writes to `rejection_log` with `stage: 'prematch_quality'`.

---

### Pass 2 — Post-predicate strict filter (`filterPrematchPostPredicate`)

Runs **after** `convertToPredicate()` (Call 2) and **before** `validateQuestion()`.

Operates on the resolved predicate structure — not text. This is the authoritative dedup layer.

Market state (`MatchMarketState`) is pre-fetched from DB for each (league, match) before generation begins, then mutated as questions are accepted. Guarantees correctness across retry rounds and concurrent runs.

**Hard reject rules (no scoring — binary accept/reject):**

| Rule | Condition | Reason code |
|---|---|---|
| Player question too early | Player-specific question, kickoff > 60 min away, player not in confirmed lineup | `player_question_too_early` |
| No lineup data | Player-specific question, kickoff ≤ 60 min, no `source='lineup'` data available | `player_question_no_lineup` |
| Player not confirmed | Lineup data available but player not in starting_xi / substitute set | `player_not_in_lineup` |
| Duplicate player | Same player_id already in accepted or DB questions | `duplicate_player_post` |
| Player cap exceeded | Batch target ≤ 5 → max 1 player question; > 5 → max 2 | `player_cap_exceeded` |
| Duplicate market | Same market_type already exists for this (league, match) | `duplicate_market` |
| Heavy favourite winner | market_type = home_win or away_win AND standingGap ≥ 5 | `heavy_favourite_winner` |
| Duplicate predicate | Identical predicate fingerprint already in (league, match) | `duplicate_predicate` |
| Duplicate text | Jaccard similarity ≥ 0.65 vs any existing question text for (league, match) | `duplicate_question_text` |
| Team imbalance | Adding this question would push one team above 70% of all questions (enforced at ≥ 3 questions) | `team_imbalance` |

Writes to `rejection_log` with `stage: 'prematch_quality_post'`.

---

## Market-type derivation

Market types are derived from the resolved predicate structure. Used for uniqueness enforcement (one question per market per match).

| Market key | Predicate shape |
|---|---|
| `home_win` | `match_outcome` + `winner_team_id = homeId` |
| `away_win` | `match_outcome` + `winner_team_id = awayId` |
| `draw` | `match_outcome` + `draw` field |
| `over_goals:1.5` / `2.5` / `3.5` | `match_stat` + `total_goals` (threshold normalised to .5 boundary) |
| `under_goals:N` | Same, lt/lte direction |
| `btts` | `btts` predicate |
| `clean_sheet_home` | `match_stat` + `away_score = 0` |
| `clean_sheet_away` | `match_stat` + `home_score = 0` |
| `cards_total` | `match_stat` + `total_cards` |
| `corners_total` | `match_stat` + `total_corners` |
| `shots_total` | `match_stat` + `shots_total` |
| `goals_window:M-N` | `match_stat_window` + `goals` field |
| `cards_window:M-N` | `match_stat_window` + `cards` field |
| `player_goal:PID` | `player_stat` + `goals` + player_id |
| `player_assist:PID` | `player_stat` + `assists` + player_id |
| `player_card:PID` | `player_stat` + `cards`/`yellow_cards` + player_id |
| `player_shots:PID` | `player_stat` + `shots` + player_id |
| `player_clean_sheet:PID` | `player_stat` + `clean_sheet` + player_id |
| `player_passes:PID` | `player_stat` + `passes_total`/`passes_key` + player_id |
| `player_lineup:PID` | `match_lineup` predicate |
| `player_status:PID` | `player_status` predicate |
| `mc:source:field` | `multiple_choice_map` predicate |

`null` returned for unclassifiable predicates → soft-pass (no market dedup applied, fingerprint dedup still runs).

---

## Fallback template markets (Phase D)

After AI generation + retries, any shortfall is filled with deterministic templates. Templates are selected in diversity-priority order, skipping any market already present for the match.

11 available markets (ordered):

1. `btts`
2. `over_goals:2.5`
3. `over_goals:1.5`
4. `over_goals:3.5`
5. `clean_sheet_home`
6. `clean_sheet_away`
7. `cards_total`
8. `corners_total`
9. `home_win` *(skipped if standingGap ≥ 5)*
10. `away_win` *(skipped if standingGap ≥ 5)*
11. `draw`

If target cannot be reached without violating market uniqueness or heavy-favourite rules, the system stops and logs `target_unmet` (see §Monitoring). No filler is inserted.

---

## Rejection log entry formats

### Pass 1 — prematch_quality stage

```json
{
  "attempt": 1,
  "stage": "prematch_quality",
  "question_text": "Will Arsenal win against Chelsea?",
  "error": "too_obvious (score=45)",
  "reason": "too_obvious",
  "score": 45,
  "fixture_id": "1234567",
  "timestamp": "2026-05-05T14:00:00.000Z"
}
```

### Pass 2 — prematch_quality_post stage

```json
{
  "attempt": 1,
  "stage": "prematch_quality_post",
  "question_text": "Will Arsenal win the match?",
  "error": "duplicate_market",
  "reason": "duplicate_question",
  "score": 0
}
```

Note: Pass 2 entries have no `score` (always 0) and no `fixture_id` / `timestamp` (binary reject, not score-based).

---

## Normalized reason codes

Both passes write a `reason` field using the same canonical vocabulary. All analytics views filter on this field.

| Canonical reason | Raw codes that map to it |
|---|---|
| `too_obvious` | `obvious_winner_heavy_favourite`, `winner_question_no_standings_context`, `heavy_favourite_winner` |
| `duplicate_question` | `near_duplicate_in_batch`, `near_duplicate_prior_round`, `duplicate_player` (pass 1) · `duplicate_market`, `duplicate_predicate`, `duplicate_question_text`, `duplicate_player_post` (pass 2) |
| `too_many_player_specific` | `too_many_player_specific` (pass 1) · `player_question_too_early`, `player_question_no_lineup`, `player_not_in_lineup`, `player_cap_exceeded` (pass 2) |
| `poor_team_balance` | `poor_team_balance` (pass 1) · `team_imbalance` (pass 2) |
| `low_quality_score` | `over_represented_category`, `weak_short_question`, `weak_resolvability_hint`, `marginal_not_needed`, `low_quality_score` (pass 1) |

---

## Quality score thresholds (Pass 1 only)

| Score range | Decision |
|---|---|
| 90–100 | Strong accept |
| 75–89 | Accept |
| 60–74 | Marginal — accept only if quota not yet filled |
| < 60 | Hard reject |
| 0 | Hard cap (player-specific over limit) |

Pass 2 is binary — no score. All pass 2 rejects have `score: 0` in the log.

---

## Analytics views (migration 020)

Run `backend/migrations/020_prematch_analytics_views.sql` in the Supabase SQL editor to create these views.

Both views aggregate across both pass 1 (`stage = 'prematch_quality'`) and pass 2 (`stage = 'prematch_quality_post'`) entries.

### `analytics_prematch_quality_summary`

Daily summary of filter activity.

```sql
SELECT * FROM analytics_prematch_quality_summary LIMIT 14;
```

**Columns:**

| Column | Description |
|---|---|
| `date` | UTC calendar day |
| `total_generated` | Questions that entered the filter |
| `total_rejected` | Rejected by either pass |
| `rejection_rate` | `total_rejected / total_generated × 100` — target < 40% |
| `avg_quality_score` | Mean score of pass 1 rejected questions |
| `rejected_too_obvious` | Winner questions in mismatched fixtures |
| `rejected_duplicates` | Deduplication rejections (both passes) |
| `rejected_player_specific` | Player cap / lineup rule rejections |
| `rejected_team_balance` | Team imbalance rejections |
| `rejected_low_score` | Catch-all: short, generic, unresolvable |

### `analytics_prematch_score_distribution`

Pass 1 score bucket breakdown by day.

```sql
SELECT * FROM analytics_prematch_score_distribution LIMIT 30;
```

**Columns:** `date`, `score_bucket` (0-50 / 50-60 / 60-75 / 75-90 / 90+), `count`

Note: Pass 2 rejects always have score=0. To separate them from genuine 0-score pass 1 rejects, filter by `stage = 'prematch_quality'` in the raw query.

---

## Dashboard queries

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

### Rejection breakdown by pass (last 7 days)

```sql
SELECT
  entry->>'stage'  AS pass,
  entry->>'reason' AS reason,
  COUNT(*)         AS count
FROM generation_run_leagues grl
JOIN generation_runs gr ON gr.id = grl.run_id,
  jsonb_array_elements(grl.rejection_log) AS entry
WHERE entry->>'stage' IN ('prematch_quality', 'prematch_quality_post')
  AND gr.started_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1, 3 DESC;
```

### Market-level dedup rate (pass 2)

```sql
SELECT
  entry->>'error' AS reject_reason,
  COUNT(*)        AS count
FROM generation_run_leagues grl
JOIN generation_runs gr ON gr.id = grl.run_id,
  jsonb_array_elements(grl.rejection_log) AS entry
WHERE entry->>'stage' = 'prematch_quality_post'
  AND gr.started_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 2 DESC;
```

### target_unmet events (last 7 days)

These appear as `console.warn` only — not in rejection_log. Monitor via Supabase Edge Function logs:

```
[prematch] target_unmet league=<id> match=<id> inserted=N target=T
```

High frequency of `target_unmet` with `N < T` for all matches suggests the AI + fallback pipeline is exhausting all available markets. Likely cause: `standingGap ≥ 5` on most fixtures, eliminating `home_win` and `away_win` fallback markets.

### Raw rejection log inspection (most recent 20, both passes)

```sql
SELECT
  gr.started_at,
  grl.league_id,
  entry->>'stage'         AS stage,
  entry->>'question_text' AS question_text,
  entry->>'reason'        AS reason,
  (entry->>'score')::int  AS score
FROM generation_run_leagues grl
JOIN generation_runs gr ON gr.id = grl.run_id,
  jsonb_array_elements(grl.rejection_log) AS entry
WHERE entry->>'stage' IN ('prematch_quality', 'prematch_quality_post')
ORDER BY gr.started_at DESC
LIMIT 20;
```

### Most-rejected fixture (last 30 days, pass 1 only — has fixture_id)

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
| Overall rejection rate (daily) | < 30% | 30–50% | > 50% |
| Pass 2 rejections as % of total | < 20% | 20–35% | > 35% — AI generating many duplicate-market questions |
| `rejected_too_obvious` share | < 20% | 20–40% | > 40% — prompt needs stricter winner rule |
| `rejected_duplicates` share | < 15% | 15–30% | > 30% — model generating repetitive questions |
| `rejected_low_score` share (pass 1) | < 30% | 30–50% | > 50% — overall question quality issue |
| `avg_quality_score` of pass 1 rejected | > 50 | 35–50 | < 35 — questions far below bar |
| `target_unmet` log events | Rare / none | Occasional | Frequent — fallback exhausting all markets |

### Tuning guidance

**High pass 2 `duplicate_market` rate:**
- AI is generating multiple questions for the same market (e.g. two `over_goals` variants).
- Add explicit instruction to the generation prompt to vary market types.
- Consider increasing `poolGenerationTarget` slightly to give the filter more candidates to choose from.

**High `heavy_favourite_winner` rate:**
- Fixture schedule has many mismatched opponents.
- The 9 non-winner fallback markets cover these matches — verify `target_unmet` isn't firing.
- If `target_unmet` is common, consider relaxing `standingGap >= 5` threshold to `>= 7` in `filterPrematchPostPredicate()`.

**Frequent `player_question_too_early` or `player_question_no_lineup`:**
- Expected behavior — lineup data is not available until ~60 min before kickoff.
- Only investigate if player questions are being blocked even when lineup data is present.

**Overall rejection rate > 50% consistently:**
1. Check pass breakdown — is pass 1 or pass 2 driving rejections?
2. If pass 1 dominates: check score distribution. If 0-50 bucket is large, prompt is producing weak questions.
3. If pass 2 dominates: AI is generating market duplicates — strengthen diversity instruction in prompt.

---

## Implementation notes

- `fixture_id` and `timestamp` fields are only present on **pass 1** entries written after Edge Function v2.1 (2026-04-28). Pass 2 entries have neither field.
- Pass 2 entries always have `score: 0` — this is a signal field, not a quality score.
- Analytics views are resilient to missing fields via `IS NOT NULL` guards on `score`.
- Views are aggregate-only — no question text or user data exposed in summary rows.
- The `error` string field is kept alongside the structured fields for human-readable log inspection in the Supabase dashboard.
- `MatchMarketState` is scoped per (league, match) — there is no cross-league or cross-match state.

---

## Per-match context (resolved 2026-05-05, v61)

The post-predicate filter (`filterPrematchPostPredicate`) is invoked with a **per-match** `prematchBatchCtx` and `lineupCtx`, built inside the per-question loop using `raw.match_id`. This guarantees that `deriveMarketType`, the heavy-favourite reject (`standingGap ≥ 5`), and lineup gating (`lineupAvailable`, `confirmedPlayerIds`, `minutesToKickoff`) all reflect the question's actual match — not the first match in the batch.

The pre-predicate filter (`filterPrematchBatch`) still uses a shared first-match ctx by design — it operates on coarse text/category signals where per-match scoping is unnecessary.

---

## Future improvement: log accepted questions

Currently only rejected questions appear in `rejection_log`. To enable full score distribution tracking:

1. Update `filterPrematchBatch()` to return `{ accepted, rejected, acceptedScores[] }`
2. Add a `prematch_quality_accepted` entry type to the rejection log
3. Update analytics views to separate accepted vs rejected score distributions

Deferred post-launch.

---

## Future Extension — LIVE Quality Analytics

The live generation pipeline does not yet include a `filterLiveBatch()` equivalent. When implemented, rejected live questions will write to `rejection_log` with `stage: 'live_quality'`. The same canonical reason codes apply, with two live-specific additions: `window_too_short` and `stale_match_state`.

Migration 023 (deployed ✅) covers operational live generation metrics (`analytics_live_quality_summary`, `analytics_live_rejection_reasons`). Quality-scored live analytics are a separate future item.

**DO NOT IMPLEMENT** — document only.
