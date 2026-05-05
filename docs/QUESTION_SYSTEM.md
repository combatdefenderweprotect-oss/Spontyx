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

`ensure-prematch` is a thin orchestrator: JWT-auth → RLS access check on the league row → 5-minute recent-generation debounce (counts CORE_MATCH_PREMATCH rows for the league created within the last 5 min) → forwards to `generate-questions` with `{ league_id, [match_id] }` using the `CRON_SECRET` bearer.

`generate-questions` accepts an optional POST body. With `league_id`, the league fetch is narrowed to that single row. With `match_id`, eligible-matches are filtered to that single fixture. The no-body cron path is unchanged.

**Cron backstop** — `generate-questions-every-6h` (Job 2) remains in place unchanged. It catches leagues created without a UI session and any fixtures that drift into the 48h window between user opens.

**Idempotency** — there is no new lock table. The pipeline already guarantees uniqueness via:
- `prematch_question_budget` cap per league (default 4)
- pool fingerprint dedup in `lib/pool-manager.ts`
- Jaccard near-duplicate filter in `lib/prematch-quality-filter.ts`

**Fixture window** — `isMatchEligibleForPrematch()` enforces: automatic mode = kickoff in 24–48h (with late-creation fallback to <24h); manual mode = `now ≥ kickoff − offset_hours`; never generate after kickoff. This is unchanged from the cron-only era.

**Match Night, Season-Long, Custom** all flow through the same `fetchSportsContext` path. No special branching. Match Night attaches CORE_MATCH_PREMATCH against `league_id` (no `arena_session_id` path — Arena is a separate pillar).

### MVP lane status

| Lane | MVP status | Key constraints |
|---|---|---|
| `CORE_MATCH_LIVE` | ✅ Primary focus | Max 3 active total, goals/penalties/red cards/yellow cards, 3-min rate limit |
| `CORE_MATCH_PREMATCH` | ✅ Supported | Generated pre-kickoff, resolved post-match |
| `REAL_WORLD` | ⚠️ Limited | Max 1 per league per day, skip if signal weak, tier-gated |

### Critical product rule

**Spontix is a Core Match Questions product. REAL_WORLD is a premium intelligence add-on. This relationship must never be reversed.**

Every time a question is generated, resolved, or displayed — explicitly identify its lane: `CORE_MATCH_PREMATCH`, `CORE_MATCH_LIVE`, or `REAL_WORLD`.

---
