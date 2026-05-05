# Question System Architecture — Canonical Definition

> This is the authoritative naming and structure for all questions in Spontix. It must be respected in all code, pipelines, logs, database fields, and documentation without exception.

## QUESTION SYSTEM ARCHITECTURE — CANONICAL DEFINITION

> **This section defines the authoritative naming and structure for all questions in Spontix. It must be respected in all code, pipelines, logs, database fields, and documentation without exception.**

Spontix is a **Core Match Questions product**. There are exactly three question lanes. They must never be merged, combined, or treated as interchangeable.

---

### Lane 1: CORE_MATCH_PREMATCH

Questions generated **before** a match starts, based on sports data tied to a specific match.

**Data sources:** sports API, team/player statistics, standings, injuries, match context

**Examples:**
- Who will win the match?
- Will both teams score?
- Will there be over 2.5 goals?
- Will Player X score?
- Will Team Y keep a clean sheet?

**Rules:**
- MUST be tied to a specific `match_id`
- MUST be resolvable from official match result or stats data
- NOT premium-only
- NOT a REAL_WORLD question

---

### Lane 2: CORE_MATCH_LIVE

Questions generated **during** a match, based on live match state. **Highest-priority lane.**

**Data sources:** live sports API, score state, match clock, cards, corners, shots, scorers

**Examples:**
- Will there be a goal in the next 5 minutes?
- Which team scores next?
- Will there be a red card before full time?
- Will there be a corner in the next 3 minutes?

**Rules:**
- MUST be tied to `match_id`
- MUST include time windows
- MUST be resolvable via match data
- MUST have highest display priority in the question feed
- NOT premium-only
- NOT a REAL_WORLD question

---

### Lane 3: REAL_WORLD

A **separate premium intelligence layer** — not a core match question. Based on real-world developments outside the live match event stream.

**Data sources:** news APIs (GNews), transfers, injuries, coach situations, lineup expectations, official announcements

**Examples:**
- Will Player X start the next match?
- Will Coach X be sacked before the next fixture?
- Will Team Y sign Player Z before deadline day?

**Rules:**
- MUST be verifiable
- MUST be binary (YES/NO)
- MUST have a `resolution_condition` and a `resolution_deadline`
- MUST NOT be vague or subjective
- MUST NOT invent facts
- MUST be lower volume than core match questions
- MUST be tier-gated (premium feature)
- MUST NOT replace or crowd out CORE_MATCH_PREMATCH or CORE_MATCH_LIVE questions

---

### Feed display priority

1. **CORE_MATCH_LIVE** — always first
2. **CORE_MATCH_PREMATCH** — second
3. **REAL_WORLD** — only if enabled; never crowds out lanes 1 or 2

### Priority enforcement (UI + generation)

The priority order:

1. CORE_MATCH_LIVE
2. CORE_MATCH_PREMATCH
3. REAL_WORLD

This priority applies to BOTH:

1. UI rendering
2. Question generation decisions

Rules:

- REAL_WORLD questions must NEVER occupy a slot if a CORE_MATCH_LIVE question is available
- REAL_WORLD questions must NEVER crowd out core match questions
- CORE_MATCH_LIVE always takes precedence over all other lanes
- CORE_MATCH_PREMATCH may be shown only when no higher-priority live question exists

This ensures that the core match experience remains dominant.

### `question_type` naming standard (MANDATORY)

The `question_type` column in the database and all code uses exactly these three values:

| Value | Meaning |
|---|---|
| `CORE_MATCH_PREMATCH` | Pre-match question tied to a specific match |
| `CORE_MATCH_LIVE` | Live in-match question with a time window |
| `REAL_WORLD` | Premium real-world intelligence question |

**Do NOT use** as `question_type` values: `"ai_generated"`, `"premium_question"`, `"smart_question"`, `"event_driven"`, `"time_driven"`, `"prematch"`, `"live"`. These are internal generation trigger descriptors — not lane identifiers.

### Source vs Question Type (CRITICAL DISTINCTION)

The `question_type` defines the PRODUCT LANE:

- CORE_MATCH_PREMATCH
- CORE_MATCH_LIVE
- REAL_WORLD

The `source` field defines the ORIGIN of the question:

- ai_generated
- pool_reuse
- manual
- (future sources possible)

IMPORTANT:
- `question_type` controls logic, UI, priority, and gameplay behavior
- `source` is ONLY metadata about how the question was created

These must NEVER be confused or used interchangeably.

DO NOT:
- use `source` to determine gameplay logic
- use `source` instead of `question_type`

All gameplay logic MUST be based on `question_type`.

### Required database fields per lane

All questions require: `id`, `question_type`, `league_id`, `question_text`, `options`, `correct_answer`, `status`, `visible_from`, `answer_closes_at`, `resolves_after`.

CORE_MATCH_PREMATCH and CORE_MATCH_LIVE additionally require: `match_id` (NOT NULL).

REAL_WORLD additionally requires: `resolution_condition`, `resolution_deadline`. `match_id` is nullable.

### Pipeline separation (MANDATORY)

Each lane has its own generation pipeline with its own triggers, rules, and validation:
1. CORE_MATCH_PREMATCH pipeline — runs before kickoff
2. CORE_MATCH_LIVE pipeline — runs during the match (event-driven + time-driven triggers)
3. REAL_WORLD pipeline — runs on news/transfer signals, not match events

These pipelines must not be merged.

### CORE_MATCH_PREMATCH triggers (event-driven primary, cron backstop)

Pre-match generation is **demand-driven**, not cron-primary. Two client-side hooks call the `ensure-prematch` edge function with `{ league_id }`:

1. **On league creation** — `create-league.html` fires `ensure-prematch` immediately after the league row is inserted (fire-and-forget, before redirect).
2. **On league page open** — `league.html` fires `ensure-prematch` after league hydration on every load (fire-and-forget).

`ensure-prematch` is a thin orchestrator: JWT-auth → RLS access check on the league row → debounce (counts CORE_MATCH_PREMATCH rows created in last 5 min; skips if `recentCount >= perMatchTarget`) → forwards to `generate-questions` with `{ league_id, [match_id] }` using the `CRON_SECRET` bearer.

`generate-questions` accepts an optional POST body. With `league_id`, the league fetch is narrowed to that single row. With `match_id`, eligible-matches are filtered to that single fixture. The no-body cron path is unchanged.

**Cron backstop** — `generate-questions-every-6h` (Job 2) remains in place unchanged. It catches leagues created without a UI session and any fixtures that drift into the 48h window between user opens.

**Per-match question count** — `prematch_questions_per_match` (migration 053, INT 1–10, default 5) is the user-chosen target set at league creation. The pipeline reads `prematch_questions_per_match ?? prematch_question_budget ?? 5`. `prematch_question_budget` is kept as a legacy fallback for rows created before migration 053.

The CORE_MATCH_LIVE lane has an equivalent: `live_questions_per_match` (migration 054, INT 1–10, default 6). Read order: `live_questions_per_match ?? live_question_budget ?? 6`. See [docs/LIVE_QUESTION_SYSTEM.md](LIVE_QUESTION_SYSTEM.md) for full slot logic.

**Idempotency** — per-(league, match_id) existing-count check runs before Phase A. If existing `CORE_MATCH_PREMATCH` rows (non-voided) already meet the target → match is skipped immediately. If partial → only the shortfall is generated. Additionally:
- Pool fingerprint dedup in `lib/pool-manager.ts`
- Two-pass quality filter in `lib/prematch-quality-filter.ts` (see below)
- No new lock table

**Two-pass quality filter** — `lib/prematch-quality-filter.ts` runs two independent passes:

*Pass 1 — pre-predicate (`filterPrematchBatch`):* runs after Call 1 (question generation) and before Call 2 (predicate conversion). Scores candidates 0–100 on text quality, category diversity, player cap, and team balance. Hard-rejects below 60. Saves token cost by discarding poor candidates before OpenAI predicate conversion.

*Pass 2 — post-predicate (`filterPrematchPostPredicate`):* runs after Call 2 (predicate conversion) and before schema validation. Operates on the resolved predicate — not text. Hard-rejects on:
- **Market uniqueness**: one question per `market_type` per (league, match). Market types are derived from predicate structure (e.g. `home_win`, `over_goals:2.5`, `btts`, `clean_sheet_home`, `player_goal:PID`).
- **Predicate fingerprint dedup**: exact logical duplicate detection across DB + current batch.
- **DB text dedup**: Jaccard similarity ≥ 0.65 vs all existing questions for same (league, match).
- **Heavy-favourite winner**: `home_win` / `away_win` hard-rejected when `standingGap ≥ 5`. Alternatives (btts, clean sheet, goals, corners, cards) are unaffected.
- **Lineup-aware player rules**: player questions blocked when kickoff > 60 min unless player is confirmed in lineup data; blocked when kickoff ≤ 60 min if no lineup data is available.
- **Team balance**: single team may not exceed 70% of questions (enforced at ≥ 3 questions).

`MatchMarketState` is pre-fetched from DB per (league, match) before generation begins and mutated as questions are accepted — correct across retry rounds and concurrent calls.

The post-predicate filter is called with a **per-match** `prematchBatchCtx` and `lineupCtx`, rebuilt inside the per-question loop using `raw.match_id`. This keeps `deriveMarketType`, the heavy-favourite reject, and lineup gating aligned with the question's actual fixture even when a batch covers multiple matches. The pre-predicate filter (`filterPrematchBatch`) intentionally uses a shared first-match ctx since it only runs coarse text/category heuristics.

**Fallback templates (Phase D)** — after AI generation + 3-retry loop, any per-match shortfall is filled by deterministic templates. Phase D is **market-aware**: it reads a fresh DB fetch of all questions for the match, skips any template whose market is already present, and stops cleanly when all valid markets are exhausted. No filler is inserted if the target cannot be reached without violating market uniqueness or quality rules — logs `target_unmet` (console.warn) instead.

11 available fallback markets (diversity-priority order): `btts`, `over_goals:2.5`, `over_goals:1.5`, `over_goals:3.5`, `clean_sheet_home`, `clean_sheet_away`, `cards_total`, `corners_total`, `home_win`, `away_win`, `draw`. `home_win` / `away_win` are skipped in heavy-favourite matches.

Inserted as `source='fallback_template'` — no OpenAI call, no AI quota consumed. Predicates use existing resolver types (`match_outcome`, `match_stat`, `btts`).

For full quality filter analytics and monitoring queries, see [docs/PREMATCH_QUALITY_ANALYTICS.md](PREMATCH_QUALITY_ANALYTICS.md).

**Fixture window** — `isMatchEligibleForPrematch()` enforces: automatic mode = kickoff in 24–48h (with late-creation fallback to <24h); manual mode = `now ≥ kickoff − offset_hours`; never generate after kickoff. This is unchanged from the cron-only era.

**Match Night, Season-Long, Custom** all flow through the same `fetchSportsContext` path. No special branching. Match Night attaches CORE_MATCH_PREMATCH against `league_id` (no `arena_session_id` path — Arena is a separate pillar).

### Lane status

| Lane | Status | Key constraints |
|---|---|---|
| `CORE_MATCH_LIVE` | ✅ Primary focus | Max 3 active total, goals/cards, budget `live_questions_per_match` (1–10, default 6), slot-paced (floor(N/2) pre-HT, ceil(N/2) post-HT), 3-min rate limit (time-driven), event-driven bypasses slot + rate limit |
| `CORE_MATCH_PREMATCH` | ✅ Supported | Generated pre-kickoff, resolved post-match |
| `REAL_WORLD` | ⚠️ Limited | Max 1 per league per day, skip if signal weak, tier-gated |

### Critical product rule

**Spontix is a Core Match Questions product. REAL_WORLD is a premium intelligence add-on. This relationship must never be reversed.**

Every time a question is generated, resolved, or displayed — explicitly identify its lane: `CORE_MATCH_PREMATCH`, `CORE_MATCH_LIVE`, or `REAL_WORLD`.

---
