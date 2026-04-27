# Spontix — Project State & Developer Handoff

Last updated 2026-04-27 — Discover leagues now fetches from Supabase directly (newly created leagues appear immediately for all users). League owner can delete their league; members can leave — both via confirmation modal in Settings tab. Join a League button added to My Leagues header. Tier badge no longer shows price. Match Live quick-create button live. Tier system v2 complete. Player availability filtering live. Auth gate hardened. Live & Activity page fully dynamic. Username system live. Beta access flow live. Full end-to-end simulation verified. Football only. Max 2 active questions. Three-lane question architecture locked. All advanced systems preserved intact for post-launch activation.

---

# ⚠️ MVP EXECUTION CONTROL (MANDATORY)

**This section overrides all other rules in this document.**

This document describes the FULL Spontix system. The sections below contain both MVP scope and post-launch design. The full system design is preserved for continuity and post-launch development. It must not be implemented ahead of the mid-May launch.

## Active launch target: mid-May 2026

## MVP rules

1. **MVP overrides everything.** If any section below conflicts with the MVP scope defined here, MVP wins. No exceptions.
2. **Everything below is FULL SYSTEM unless explicitly marked MVP.** Do not assume a section is in scope just because it is documented.
3. **Do not implement features not listed as MVP-critical.** This applies to all developers and to AI assistants reading this file.
4. **Do not remove, delete, or simplify advanced systems.** They are preserved for post-launch. Removing them creates rework.
5. **If in doubt, do nothing.** A missing advanced feature is always safer than a broken advanced feature at launch.

## MVP implementation rule

> If a feature is not explicitly required for MVP, do NOT implement it.
> Leave it in code. Leave it in documentation. Do not extend it. Do not wire it up. Do not expose it to users.

---

## MVP scope definition

### Sport
- **Football only.** The generation pipeline skips all non-football leagues at runtime (`sport_not_supported_mvp`).
- Hockey and tennis code, adapters, and documentation are preserved intact. Do not extend them pre-launch.

### League type
- **Type 1 single-match leagues** are the target user experience for launch.
- Type 2 season league infrastructure exists in the codebase and runs for the two existing seed leagues. Do not build further Type 2 behaviour pre-launch.
- Do not remove Type 2 code. Do not hide it from the DB. Do not break existing leagues.

### Live questions engine
- **`CORE_MATCH_LIVE`** is the primary lane. Time-driven questions are the reliable core; event-driven questions fire on goals and red cards only.
- **`CORE_MATCH_PREMATCH`** is supported. Generated before kickoff, resolved post-match.
- **`REAL_WORLD`** is limited for MVP: max 1 per league per day, only when a strong signal exists, tier-gated.
- **Max 2 active questions at any time** (across all lanes combined). This is the MVP override. Full system target is 3.
- No event queue system for MVP.
- No advanced collision engine for MVP.
- No advanced diversity orchestration for MVP.

### Timing model — MANDATORY, DO NOT SKIP
The three-timestamp model is required for launch. It is not advanced — it is the fairness guarantee.
- `visible_from` — when question appears
- `answer_closes_at` — authoritative answer lock
- `resolves_after` — when resolver evaluates outcome
All three must be populated on every question. Do not simplify this away.

### Scoring — MVP mode (see §MVP SCORING MODE below)
- **Active**: `base_value`, `time_pressure_multiplier`, `streak_multiplier`
- **Bypassed to 1.0**: `difficulty_multiplier`, `comeback_multiplier`, `clutch_multiplier`
- All scoring columns and functions remain in code. Only runtime values are bypassed.

### Question delivery
- Polling every 5s (active questions present) / 15s (idle). This is reliable enough for launch.
- Do not block launch on Realtime subscription. It is the highest-priority post-launch item.

### Question volume
- Hard cap: max 2 active questions.
- Prefer reuse from pool over new generation.
- Prefer fewer reliable questions over high volume.

### UI
- Surface only stable features.
- Hockey/tennis hidden in create-league sport selector.
- Do not remove any completed UI pages.

---

## MVP SCORING MODE

**Only these multipliers are active at runtime:**

| Multiplier | Status | Value |
|---|---|---|
| `base_value` | ✅ Active | Per category: 20/15/12/10/6 |
| `time_pressure_multiplier` | ✅ Active | 1.0–1.5× based on time remaining |
| `streak_multiplier` | ✅ Active | 1.0–1.3× based on consecutive correct answers |
| `difficulty_multiplier` | 🔒 Bypassed | Fixed at 1.0 for MVP |
| `comeback_multiplier` | 🔒 Bypassed | Fixed at 1.0 for MVP |
| `clutch_multiplier` | 🔒 Bypassed | Fixed at 1.0 for MVP |

**Implementation**: bypassed multipliers are assigned `1.0` via `MVP_BYPASS` constants in `resolve-questions/index.ts`. The `multiplier_breakdown` JSONB includes `mvp_bypass: true` for audit purposes.

**Do NOT remove the bypassed systems.** `computeComebackMultiplier()`, `computeTimePressureMultiplier()`, and all related DB columns remain in code. Post-launch activation requires only removing the bypass constants — no other change.

---

## MVP FALLBACK RULES

The system must never show an empty live experience. These rules override generation and display logic:

1. **If no active question exists during a live match** → show the holding card ("Next moment dropping soon"). Never show an empty feed mid-match.
2. **If generation produces zero questions** → do not surface an error to the user. Show the holding card. Log the failure internally.
3. **If the resolver voids a question** → remove it from the feed silently. Do not show an error state.
4. **Minimum engagement guarantee** → at least one question should appear in the first 10 minutes of a live match. If generation has not fired recently, the holding card is the safe fallback.
5. **Graceful degradation over crash** → any pipeline failure (sports API, OpenAI, Supabase) must degrade quietly. The user experience continues. The failure is logged.

---

## MVP RUNTIME SAFETY RULES

These rules are MVP-active. They protect the live experience against the most likely failure modes at launch: spam, double-scoring, duplicate submission exploits, and silent failures.

### Generation rate limit (MVP)

This rule applies ONLY to CORE_MATCH_LIVE:

- Do not generate more than 1 new CORE_MATCH_LIVE question per 3 minutes per league

This rule does NOT apply to:

CORE_MATCH_PREMATCH:
- generated pre-kickoff
- not governed by live rate limit

REAL_WORLD:
- governed by separate limit:
  max 1 question per league per day

IMPORTANT:
- Do NOT block REAL_WORLD generation because of CORE_MATCH_LIVE rate limit
- Do NOT apply live rate limit to PREMATCH pipeline

Additional rules (apply to CORE_MATCH_LIVE only):

- If a question was generated recently for that league, skip this cycle — do not force a question to fill the gap
- Prefer quality over quantity — a missing question is always better than a low-quality filler
- The holding card ("Next moment dropping soon") is the correct fallback when no safe question is available
- Never generate a `low_value_filler` question just to maintain volume. If the best available option is filler, skip and wait for the next cycle.

**Purpose:** prevent question spam, repeated low-value questions, and loss of user trust during the live match experience.

### Resolver safety — idempotency (CRITICAL)

- A question must only be resolved once
- Before processing a question, the resolver must verify the question is still in `pending` status
- If the question is already `resolved`, `voided`, or in any non-pending state — skip it entirely. Do not modify it.
- Re-running the resolver (scheduled retry, manual trigger, cron overlap) must never award points twice
- The `player_answers` scoring update loop must not run if the question has already been resolved
- This is guaranteed in the current implementation by checking `resolution_status = 'pending'` in the resolver query — do not remove or weaken this filter

**Purpose:** prevent duplicate scoring caused by cron overlap, partial failure recovery, or manual re-triggers.

### Answer submission safety

- Each user may submit only one answer per question
- This is enforced at the database level by the unique constraint on `(question_id, user_id)` in `player_answers`
- The RLS insert policy also enforces that the answer window is still open (`answer_closes_at > now()`)
- If a duplicate submission is attempted: the DB unique constraint rejects it at the DB level — the client shows a safe error state, not a crash
- Under no condition may the same user receive points twice for the same question — the unique constraint makes this structurally impossible
- Do not remove or relax the `(question_id, user_id)` unique constraint. Do not bypass it with upsert logic that could re-award points.

**Purpose:** prevent duplicate answer exploits, spam clicking, refresh resubmits, and race-condition duplicates.

### MVP logging (minimum required)

Log the following at the Edge Function level. Use `console.log` / `console.warn` — visible in Supabase Edge Function logs dashboard:

- Generation failures (OpenAI call failed, predicate parse failed, all retries exhausted)
- Resolver failures (API-Sports fetch failed, predicate evaluation error, DB write error)
- Skipped generation events — log the reason: rate limit, no active slot, no valid question, unsupported sport, quota exhausted, NONE classification
- Duplicate submission attempts if they surface (DB constraint violation errors in the client path)
- Pool reuse vs fresh generation — already logged at `[pool]` prefix level

Logging must never interrupt or visibly degrade the user experience. All log calls are fire-and-forget. Failures in the logging path must not propagate.

**Purpose:** enable post-launch debugging without exposing internal errors to users. The generation_runs and generation_run_leagues tables already capture most of this — console logging fills the gap for runtime errors not captured in DB records.

---

## MVP conflict resolution

Where the full system spec below conflicts with MVP scope, these MVP values always win:

| Parameter | Full system value | **MVP override** |
|---|---|---|
| Max active questions | 3 | **2** |
| Active event-driven triggers | Goals, penalties, red cards, yellow cards | **Goals and red cards only** |
| Scoring multipliers active | All 6 | **Base, time pressure, streak only** |
| Sports supported | Football, hockey, tennis | **Football only** |
| Question delivery | Realtime subscription | **Polling 5s/15s** |
| Event queue | Bounded 3-slot priority queue | **No queue — skip if limit reached** |
| Generation frequency | As fast as events/gaps allow | **Max 1 new question per 3 min per league** |

**MVP runtime safety overrides all full-system orchestration rules below.** If any later section implies more aggressive generation, more active questions, queued events, or more complex live behaviour, the MVP runtime safety rules above take precedence.

---

## Protected systems — DO NOT MODIFY

These systems are stable, deployed, and critical. Do not refactor, redesign, or extend them pre-launch. Only make targeted bug fixes if required.

| System | Location | Protection level |
|---|---|---|
| Generation pipeline | `generate-questions/index.ts` + `lib/` | **DO NOT REFACTOR** — stable, deployed, working |
| Resolver pipeline | `resolve-questions/index.ts` | **CRITICAL** — do not redesign; only safe scoring adjustments |
| Database schema | `backend/migrations/001–008` | **DO NOT DROP** columns, tables, or constraints |
| Timing model | `visible_from`, `answer_closes_at`, `resolves_after` | **MANDATORY** — locked, always populate all three |
| Pool system | `lib/pool-manager.ts` | **DO NOT REDESIGN** — race-safe, deployed, working |
| 4-stage validator | `lib/predicate-validator.ts` | **DO NOT WEAKEN** — schema, entity, temporal, logic checks must all run |

---

*The full system documentation continues below. All sections describe intended post-launch behaviour unless explicitly marked as MVP above or active in the current deployment.*

---

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

### MVP lane status

| Lane | MVP status | Key constraints |
|---|---|---|
| `CORE_MATCH_LIVE` | ✅ Primary focus | Max 2 active total, goals + red cards only, 3-min rate limit |
| `CORE_MATCH_PREMATCH` | ✅ Supported | Generated pre-kickoff, resolved post-match |
| `REAL_WORLD` | ⚠️ Limited | Max 1 per league per day, skip if signal weak, tier-gated |

### Critical product rule

**Spontix is a Core Match Questions product. REAL_WORLD is a premium intelligence add-on. This relationship must never be reversed.**

Every time a question is generated, resolved, or displayed — explicitly identify its lane: `CORE_MATCH_PREMATCH`, `CORE_MATCH_LIVE`, or `REAL_WORLD`.

---

## 1. Project Overview

**Spontix** is a live, real-time sports prediction & trivia gaming platform that connects **players** (fans who want to predict outcomes, answer live questions, and win trophies) with **venues** (sports bars, pubs, restaurants) that host events and reward their winners.

**Core identity**: Spontix is a **second-screen live sports experience**. The differentiator is not generic prediction — it is AI-generated live match questions (`CORE_MATCH_LIVE` + `CORE_MATCH_PREMATCH`) delivered in real time alongside the match, with `REAL_WORLD` premium intelligence as an optional overlay. Players compete against each other inside leagues, not just against the outcome of a game. This distinction drives every engagement design decision.

### What the app does
- Players sign up, join **leagues**, play **Battle Royale** trivia, duel in **1v1 trivia**, and reserve spots at real-world venues hosting Spontix events.
- Venues create events, host live question flows, award trophies to winners, and appear in a searchable discovery grid.
- Users earn **badges** (incremental achievement progress) and **trophies** (awarded on wins, shown in a public Trophy Room).
- Tiered subscription model (Starter / Pro / Elite for players; Venue Starter / Pro / Elite for venues) gates advanced features.
- Leagues can opt in to **AI-generated Real World questions** — prediction questions built from live sports API data + current news, auto-validated and published with a "Real World" badge.

### Two league types — CRITICAL DISTINCTION

> **MVP NOTE:** Type 1 single-match is the target launch experience. Type 2 season league infrastructure exists and runs for seed leagues — do not break it. Do not build further Type 2 behaviour pre-launch. Type 1 session pacing (question budget, chaining, match summary card) is documented below but NOT YET IMPLEMENTED — it is a post-launch sprint.

These are not the same system with different parameters. They have different logic, different constraints, and different UX expectations. Before working on anything related to live questions, generation, pacing, or session flow — know which type you are in.

---

**Type 1 — Single-match live league: a CLOSED GAME SESSION**

The user chooses one specific match to play. This behaves like a real game mode with a defined start, a defined end, and controlled pacing throughout.

Configurable at creation:
- Which half: first half / second half / full match
- Total question budget: min 5, max 20
- Mode: pre-match only / live only / hybrid

Rules:
- The budget is fixed. Questions are paced across the match to fill it — not generated freely.
- Session logic (question chaining, holding card, match summary card) applies here.
- Event-driven and time-driven live questions both apply — but count against the budget ceiling.
- When the match ends, the active phase is over.

---

**Type 2 — Season or long-term league: an ONGOING SYSTEM**

This is not a session. It is a content layer that runs continuously over multiple matches across weeks or a season. There is no game mode start/end per match — the league just keeps generating and resolving questions.

Rules:
- No fixed per-match question budget.
- Questions generated continuously per league AI quota settings (weekly/total limits, sport, team scope).
- No session pacing. No match-level question ceiling.
- Players accumulate points across many matches. The competition runs for weeks or a full season.
- Session continuation UI (chaining, holding card) can still improve experience, but the underlying generation is not session-constrained.

---

**What applies to which type:**

| Concept | Type 1 (single-match) | Type 2 (season) |
|---|---|---|
| Question budget per match | Yes — 5 to 20, fixed at creation | No |
| Session pacing | Yes — questions spread across match | No |
| Event-driven live questions | Yes | Yes |
| Time-driven live questions | Yes — gap filler, secondary to event-driven, counts against budget | Yes — **core engagement driver**, keeps system active in low-event matches |
| Blowout adaptation | Yes — adapt, never stop | Yes — adapt, never stop |
| Question chaining UI | Yes — core session mechanic | Nice to have, not required |
| Match summary card | Yes — session endpoint | Yes — marks match completion |
| Continuous AI generation | No — single match, closed budget | Yes — runs indefinitely |
| Per-match AI quota limits | Not applicable (budget set at creation) | Yes — weekly/total quota from league settings |

**The rule**: session pacing and question budget logic lives in Type 1 only. Season leagues use continuous generation logic and are not constrained by match-level session rules.

### Main features implemented so far
| Feature | Status |
|---|---|
| Player signup / login / logout via Supabase Auth | ✅ Working |
| Venue-owner signup with role metadata | ✅ Working |
| Venue discovery grid (searchable, filterable) | ✅ Working — backed by Supabase |
| Venue dashboard (stats, badges, trophies, photos) | ✅ Working — backed by Supabase |
| Create league wizard (5-step, with trophy selection) | ✅ Working — backed by Supabase |
| League discovery, joining, leaving | ✅ Working — backed by Supabase |
| League ownership + membership (league_members table) | ✅ Working — backed by Supabase |
| Create event wizard (4-step, with trophy/AI trophy) | ✅ Working — backed by Supabase |
| Live gameplay: Battle Royale, Trivia, Live Matches | ✅ UI complete — client-only simulations |
| Trophy system: presets, custom venue trophies, AI trophies | ✅ Working — backed by Supabase |
| Badge system (30 player badges, 16 venue badges) | ✅ Working — backed by Supabase |
| Venue title photos (premade gallery + custom uploads) | ✅ Working — backed by Supabase (data URLs in DB) |
| Facility photo upload with tier gating | ✅ Working — backed by Supabase |
| Tier limits (6 tiers, 3-layer enforcement) | ✅ Working — key limits (`leagueMaxPlayers`, `leaguesJoinMax`, `leaguesCreatePerWeek`, `liveQuestionsPerMatch`) now Supabase-backed; all hardcoded tier string comparisons eliminated |
| Reservations (player reserves spot at venue event) | ✅ Working — backed by Supabase |
| Game history (per-user completed game stats) | ✅ Working — backed by Supabase |
| User profile sync (name, handle → public.users) | ✅ Working — backed by Supabase |
| Password reset flow | ✅ Working — Supabase Auth |
| Auth gate (redirect to login if not signed in) | ✅ Working |
| Supabase Auth on all pages (SDK loaded everywhere) | ✅ Working |
| Battle Royale ELO rating system | ✅ Working — `br-elo.js`, stored in `game_history` |
| AI Real World Questions (generation pipeline) | ✅ Live — fires every 6h via pg_cron. `OPENAI_API_KEY` + `API_SPORTS_KEY` active. First run generated 6 real questions from live fixtures. |
| AI question resolver (auto-scoring pipeline) | ✅ Deployed + verified — fires every hour via pg_cron. Returns `ok:true`. Scores `player_answers` when questions resolve. |
| league.html — dynamic question feed + leaderboard | ✅ Fully Supabase-backed — questions, members, answers, lazy leaderboard |

---

## 2. Tech Stack

### Frontend
- **Plain HTML + vanilla JavaScript** — no framework, no build step. Each page is a standalone `.html` file.
- **Shared CSS** in `styles.css` plus per-page `<style>` blocks.
- **Single shared JS module** (`spontix-store.js`) acts as a data access layer that every page includes.
- **Inter** font from Google Fonts.
- Brand colours: lime `#A8E10C` (player), purple `#7C5CFC` (venue), coral `#FF6B6B`, teal `#4ECDC4`.

### Backend
- **Supabase** — managed Postgres + Auth + Storage + Realtime in one product.
- **No custom server** — all backend logic lives in Postgres (RLS policies, triggers, functions) or happens directly from the browser via the Supabase JS client.
- **Supabase Edge Functions** (Deno TypeScript) — used for the AI question generation pipeline, triggered by pg_cron.

### Supabase usage
- **Database** (Postgres 15, eu-west-2 / London, free tier `t4g.nano` compute)
- **Auth** (email/password; email confirmation togglable; password reset flow)
- **Storage** — not yet configured (photos currently stored as data URLs in `venue_photos.storage_url`; migrate to CDN bucket later)
- **Realtime** — not yet configured (planned for live gameplay websockets)
- **Edge Functions** — `generate-questions` (question generation) and `resolve-questions` (auto-scoring) both written, awaiting first deploy

### External APIs (used by Edge Function only)
- **API-Sports** (`v3.football.api-sports.io`, `v1.hockey.api-sports.io`) — upcoming fixtures, standings, injuries, top scorers
- **GNews** — real-world news headlines for narrative context in AI question generation
- **OpenAI** (`gpt-4o`) — two-call pipeline: question generation + predicate conversion

---

## 3. Architecture

### High-level data flow

```
┌─────────────────────────────────────────┐
│  Browser (any .html page)               │
│                                          │
│  ┌────────────────────────────────┐     │
│  │  Page UI (e.g. venues.html)    │     │
│  └────────────────────────────────┘     │
│              │                           │
│              ▼                           │
│  ┌────────────────────────────────┐     │
│  │  SpontixStore (sync API)       │     │
│  │  • localStorage cache          │     │
│  │  • Backwards-compat layer       │     │
│  └────────────────────────────────┘     │
│              │                           │
│              ▼                           │
│  ┌────────────────────────────────┐     │
│  │  SpontixStoreAsync (Promises)  │     │
│  │  • Supabase-backed overrides   │     │
│  │  • Hits Postgres via SDK       │     │
│  └────────────────────────────────┘     │
│              │                           │
└──────────────┼───────────────────────────┘
               │ HTTPS
               ▼
┌─────────────────────────────────────────┐
│  Supabase (hdulhffpmuqepoqstsor)         │
│  • Postgres with RLS policies           │
│  • Auth service                         │
│  • public.users trigger on signup       │
│  • pg_cron → Edge Function every 6h    │
└─────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Edge Function: generate-questions      │
│  • Fetches upcoming matches (API-Sports)│
│  • Fetches news context (GNews)         │
│  • Generates questions (OpenAI gpt-4o) │
│  • Validates + inserts to `questions`  │
└─────────────────────────────────────────┘

pg_cron (every 1h)
               │
               ▼
┌─────────────────────────────────────────┐
│  Edge Function: resolve-questions       │
│  • Fetches pending questions past       │
│    their resolves_after deadline        │
│  • Fetches post-match stats (API-Sports)│
│  • Evaluates resolution predicate       │
│  • Marks player_answers correct/wrong  │
│  • Awards points_earned (full scoring  │
│    formula — see scoring system below) │
└─────────────────────────────────────────┘
```

### How it actually works

1. **Every page** includes `spontix-store.js`. This file exports two global objects:
   - `SpontixStore` — **synchronous** API backed by localStorage (for backwards compatibility).
   - `SpontixStoreAsync` — **Promise-based** API that hits Supabase when available, falls back to localStorage offline.

2. **On page load**, an auth gate checks for a Supabase session token in localStorage. If none is found, the user is redirected to `login.html`. Public pages (`index.html`, `login.html`, `supabase-test.html`) are exempt. Elite tier is forced for all users until Stripe billing is wired.

3. **Cache warming**: 1.5s after page load, all domain async fetchers run in parallel — venues, leagues, events, badges, trophies, photos, reservations, game history, user profile. Each fires a custom event (e.g. `spontix-venues-refreshed`) so pages can re-render with fresh data.

4. **Writes** (create league, award trophy, etc.) go directly to Supabase via `SpontixStoreAsync.createX()`. Postgres **Row Level Security policies** enforce that users can only modify their own data — even a compromised client can't edit someone else's venue.

5. **Auth** — `login.html` handles sign-in, sign-up, and password reset. A Postgres trigger (`handle_new_user`) auto-creates a matching `public.users` row on signup. The sidebar has a **Logout** button. All 25 app pages include the Supabase SDK and redirect to login if no session exists.

6. **AI question generation** — a Supabase Edge Function (`generate-questions`) runs on a pg_cron schedule (every 6 hours). It fetches upcoming matches, news context, builds a context packet, calls OpenAI twice (generate + convert to predicate), validates against 4 checks (schema, entity, temporal, logic), and inserts passing questions into the `questions` table with `source = 'ai_generated'` and a "Real World" source badge.

### Battle Royale ELO system

`br-elo.js` is a standalone module (no imports, no dependencies) loaded on `battle-royale.html` and `br-leaderboard.html`. It exposes `BRElo.calculateSinglePlayer({ currentElo, placement, totalPlayers })` which returns `{ eloChange, newElo, prevElo }` using proper K-factor + placement-weight logic with clamped deltas.

`recordGameResult()` in `spontix-store.js` computes ELO **before** inserting the game_history row so `elo_before` and `elo_after` are stored in the same DB write. The victory screen and match history tab both use these values directly — no reverse-engineering.

### AI question resolution pipeline

> **✅ MVP-ACTIVE — CRITICAL SYSTEM — DO NOT REDESIGN**
> This pipeline runs every hour via pg_cron and is the scoring engine. For MVP, scoring applies `base_value × time_pressure × streak` with difficulty/comeback/clutch bypassed to 1.0 via `MVP_BYPASS` constants in `resolve-questions/index.ts`. Do not redesign this pipeline. Only adjust the bypass constants post-launch to activate the full formula.
>
> **MVP resolver safety — idempotency is mandatory:** The resolver fetches only questions with `resolution_status = 'pending'`. This filter must never be removed or weakened — it is the primary guard against double-resolution. Re-running the resolver must be safe at any time. If a question is already resolved or voided, the resolver skips it without touching `player_answers`. Resolver failures are logged but must not surface to users.

```
pg_cron (every 1h, `0 * * * *`)
  → GET /functions/v1/resolve-questions
    → fetch up to 30 `pending` questions where resolves_after < now()
    → for each question:
        ① Check resolution_type — void `player_status` immediately (no historical data)
        ② Require match_id — void if missing
        ③ Fetch (or reuse) match stats from API-Sports (cached by sport:matchId)
        ④ Check match status — void if cancelled/postponed; skip if not yet finished
        ⑤ evaluatePredicate(pred, stats, options) — returns outcome + winningOptionId
        ⑥ resolveQuestion() — update questions row (status=resolved, outcome, resolved_at)
        ⑦ markCorrectAnswers() — fetch all player_answers, update is_correct + points_earned
    → return { resolved, voided, skipped, errors }
```

Predicate types supported:
- `match_outcome` — winner_team_id eq, or draw
- `match_stat` — total_goals/total_cards/total_corners/shots_total etc. with eq/gt/gte/lt/lte
- `player_stat` — goals/assists/yellow_cards etc. for a specific player (football only)
- `multiple_choice_map` — iterates options, returns first matching condition as winningOptionId
- `player_status` — voided (no historical injury data in free tier)

### AI question generation pipeline

> **✅ MVP-ACTIVE — DO NOT REFACTOR**
> This pipeline is stable, deployed, and generating live questions. For MVP: football only (non-football skipped at runtime), max 2 active questions enforced via context packet. Do not restructure this pipeline pre-launch. Only make targeted changes for direct bug fixes.
>
> **MVP generation safety:** Generation may intentionally skip cycles to preserve quality — this is correct behaviour, not a bug. Rate limit: max 1 new live question per 3 minutes per league. If no high-quality question is available, the generation cycle skips and the holding card is displayed. Generation failures are logged but must not surface to users.

```
pg_cron (every 6h)
  → GET /functions/v1/generate-questions
    → create generation_runs row
    → fetch all leagues where ai_questions_enabled = true
    → for each league (sorted by match imminence):
        ① classifyLeague() → IMMINENT / UPCOMING / DISTANT / NONE
        ② checkQuota()     → how many questions to generate this run
        ③ fetchSportsContext() → upcoming matches, standings, players, narrative hooks
        ④ fetchNewsContext()   → GNews headlines (graceful degradation)

        ── Pool-aware generation (3 phases) ──────────────────────────
        Phase A — Reuse: check match_question_pool for a ready pool
                  matching this league's generation profile.
                  If found → attachPoolQuestionsToLeague() (no OpenAI call).

        Phase B — Generate: for uncovered matches, claim the pool
                  (race-safe UNIQUE constraint), call OpenAI once:
                  ⑤ buildContextPacket() → single text block
                  ⑥ generateQuestions()  → Call 1: gpt-4o-mini, temp=0.8
                  ⑦ convertToPredicate() → Call 2: gpt-4o-mini, temp=0.1
                  ⑧ validateQuestion()   → 4 checks: schema/entity/temporal/logic
                  ⑨ storePoolQuestions() → upsert into match_pool_questions
                  ⑩ markPoolReady()

        Phase C — Attach: attachPoolQuestionsToLeague()
                  → creates league-specific rows in `questions`
                  → each row has its own unique ID (answers/scoring independent)
                  → sets pool_question_id = source reference (source_question_id)
    → finalise generation_runs row with stats
```

### Generation profile (reuse key)

> **✅ MVP-ACTIVE — DO NOT REDESIGN**
> The pool system is deployed and working. Do not refactor the cache key, pool status lifecycle, or attach logic pre-launch.

Two leagues watching the same match share a question pool **only** if their generation profile matches exactly. The profile determines what kind of questions are appropriate — mixing profiles would produce wrong or unfair questions.

```
generation_profile = {
  match_id         // which match
  sport            // football | hockey | tennis
  league_type      // type1 (single-match) | type2 (season)
  phase_scope      // full_match | first_half | second_half
  mode             // prematch | live | hybrid
  scope            // full_league | team_specific
  scoped_team_id   // null for full_league; team API id for team_specific
  prompt_version   // regenerate on prompt upgrades
}
```

**Why scope + scoped_team_id matter**: a team-scoped league (e.g. "Arsenal fans only") gets questions focused on Arsenal's performance — player scorers, Arsenal-specific outcomes. A full-league pool covering Arsenal vs Atletico would include questions about both teams. Sharing that pool with an Arsenal-scoped league would produce irrelevant questions. Separate pool per scope.

**Freshness**: pools expire at match kickoff (`expires_at = kickoff`). Stale pools are detected and regenerated. Prematch questions are only valid before kickoff; after kickoff the pool is stale and live questions are generated separately.

**Question independence**: `questions` rows are never shared across leagues. `attachPoolQuestionsToLeague()` always inserts a new row per league with:
- its own `id` (unique per league instance)
- `pool_question_id` pointing to the source canonical question
- `league_id` scoped to the target league
- independent `player_answers`, scoring, and leaderboard

**Schema** (migration 007 + 008):
- `match_question_pool` — one row per generation profile. Status: generating → ready → stale/failed. Race-safe via two partial UNIQUE indexes (one for full_league, one for team_specific).
- `match_pool_questions` — canonical question rows per pool. UNIQUE on (pool_id, fingerprint) for semantic dedup.
- `questions.pool_question_id` — FK to the source pool question (source_question_id equivalent).
- `questions.reuse_scope` — prematch_only | live_safe | league_specific.

### Live session design

> **⚠️ POST-LAUNCH SYSTEM — DO NOT IMPLEMENT FOR MVP**
> Session continuation flow (question chaining, Realtime feed, match summary card, deep-link from notifications) is designed but not built. For MVP, polling replaces Realtime, and the holding card replaces the chaining UI. Do not implement the full session flow pre-launch. The spec below is preserved for the post-launch sprint.

The full specification lives in `SESSION_CONTINUATION_DESIGN.txt`. Key principles for any Claude session working on live features.

**FIRST: know which league type you are in.** Session pacing, question budgets, and chaining logic are Type 1 (single-match) concerns. Season leagues (Type 2) use continuous generation and are not session-constrained. See the Two League Types section in Project Overview — do not conflate them.

**Notification philosophy**: notifications bring users in; the app keeps them there. Max 2 notifications per match window per user, max 4 per day. Never send a notification for an event the user is already watching inside the app.

**Two types of live questions** — both required in both league types, but they serve different roles depending on league type:
- **Event-driven**: triggered by match events (goal, red card, penalty). Reactive and exciting. Problem: events don't happen on a schedule — a match can go 15–20 minutes with nothing significant.
- **Time-driven**: triggered by the clock. Examples: "Will there be a corner in the next 5 minutes?", "Will the home team register 2+ shots in the next 8 minutes?" Short deadlines (5–10 min), simple yes/no, easy to resolve from existing stat data.

**Time-driven questions serve different roles by league type — this is important:**
- **Type 1 (single-match)**: time-driven = gap filler. Fires when no event-driven question has fired for 8–12 minutes. Secondary to event-driven. Both count against the fixed budget ceiling.
- **Type 2 (season)**: time-driven = continuous engagement driver. Since there is no session pacing or per-match budget, time-driven questions are responsible for keeping the system active across quiet stretches of a match. They are not a fallback — they are a core generation mechanism. Without them, a low-event match produces no engagement.

**Live question limits**:
- Type 1 (single-match): total budget 5–20 set at creation; both event-driven and time-driven count against it; max 3 active at once; 3-min cooldown
- Type 2 (season): no per-match budget; max 3 active at once; 3-min cooldown; weekly/total AI quota from league settings applies across matches, not per match

**Game state awareness** — questions must reflect the actual match situation. Two variables drive this: score difference and time remaining. Combined with match phase, they determine what question types are valid:

| State | Score example | Valid questions | Avoid |
|---|---|---|---|
| Close game | 0-0, 1-1, 2-1 | Winner, equaliser, clean sheet, next goal, stat questions | Nothing |
| One-sided game | 3-0, 4-0 | Stat questions (corners, cards, shots, next goal scorer) | Equaliser, winner, clean sheet |
| Late phase + close | 1-1, 75 min | Equaliser, winner, goal in next 5 min — maximise tension | Low-value fillers |
| Late phase + one-sided | 4-0, 80 min | Next goal, final score total, individual player stats | Outcome questions |

Asking "Will there be an equaliser?" at 4-0 in the 85th minute breaks user trust. Questions must always feel relevant to what is actually happening in the match.

**Blowout handling — adapt, never stop**: do not suppress question generation based on score margin. A 4-0 match still has players competing against each other for league points. Close match → outcome/state questions (clean sheet, equaliser). One-sided match → stat questions (corners, cards, goal totals), player questions, next-event questions. Silence during a live match is a bug, not a feature.

**Match phase awareness** — a football match is not uniform. Question intensity scales with time to create a natural tension curve:

| Phase | Minutes | Intensity | Question preference | Time window |
|---|---|---|---|---|
| Early | 0–20 | Low | Medium and low questions; let the match settle | 8–10 min |
| Mid | 20–70 | Balanced | Full mix; high-value triggers fire on events | 5–8 min |
| Late | 70–90+ | High | Prioritise high-value questions; increase frequency slightly | 3–5 min |

The last 20 minutes should feel noticeably more dynamic. Late-phase questions use shorter time windows, fire more readily, and lean toward high-value triggers. The early phase is deliberately quieter — don't burn questions before the match has developed.

**Live question priority tiers** — not all questions have equal engagement value. The system must prefer higher-value questions and only fall back to lower tiers when nothing better is available:

- **High** (event-driven, always priority): goals, penalties, red cards. These are the moments that matter. Questions triggered by these events are generated immediately and take precedence over everything else.
- **Medium** (time-driven preferred): shots on target, corners. Objectively interesting, clearly resolvable. Time-driven generation should prefer these when available.
- **Low** (fallback only): general time-window fillers ("Will a goal be scored in the next 10 minutes?"). Used only when no medium-value event is available to anchor a question. Do not use these as the default.

The goal: avoid flooding users with low-engagement filler. Preserve the sense that each question is worth answering.

**Question diversity control** — the system must avoid repetitive patterns. Per league, track the last 3–5 questions and apply these rules before generating the next one:

- Do not repeat the same question type consecutively (stat → event → player → outcome, rotate)
- Do not repeat the same stat focus back to back (corners twice in a row, cards twice in a row)
- Vary time windows — do not use "next 5 minutes" multiple times consecutively
- If the only valid option would repeat a recent pattern, prefer a different category or window length over repeating

What to track per league: last question type, last event/stat focus, last time window used. This does not need to be persistent across sessions — tracking the in-memory queue for the current match is sufficient.

**Live question design rules — what to ask and what to avoid**:

Questions must be fair, clearly resolvable, and based on observable events. Engagement comes from time pressure (short deadlines) and match stakes — not from simulating match commentary.

DO ask:
- Event-based: "Will there be a corner in the next 5 minutes?" / "Will there be a yellow card before the 75th minute?"
- Time-window: "Will a goal be scored in the next 10 minutes?"
- Simple state: "Will the home team keep a clean sheet?" / "Will there be an equaliser?"
- Player-specific: "Will the striker score before full time?"

DO NOT ask:
- Anything requiring subjective interpretation: pressure, dominance, momentum, form
- Questions that depend on statistical inference rather than observable events
- Questions that a referee or scoreboard cannot definitively answer

The rule: if the resolution of a question requires a human to make a judgment call, don't ask it.

**Delay-aware live question design — fairness over speed**

Spontix is a second-screen product. Users are watching the match on TV, streaming, or in person — all with different latency. The sports API also has its own delivery lag. Live questions must be designed as **fair answer windows**, not instant reaction prompts. The system must never assume all users see the same moment at the same time.

*Sources of real-world delay:*
- Sports API live data latency (typically 15–60 seconds behind real time)
- TV broadcast delay (5–30 seconds depending on provider)
- Streaming delay (10–60 seconds, sometimes more)
- Time for the user to notice a new question has appeared in the feed
- Time to read the question and understand what is being asked
- Time to select an answer

A user who sees the match on a 30-second delay is not cheating — they are using a normal service. The question window must be long enough that the answer is genuinely unknown to essentially all users when they read it.

*Minimum answer windows:*
- Absolute minimum: 90 seconds. No live question should be answerable for less than this.
- Preferred window for most live questions: 2–5 minutes
- Time-driven questions: 3–10 minutes (these are the safe default)
- Event-driven questions: use longer windows specifically because the triggering event may already be visible to some users before the question reaches them

*Safety buffer before a question becomes active:*
Before publishing a live question, the system should account for the full delivery chain. A question triggered by a goal at minute 34 should not have an answer window that expires at minute 35. The window must begin after reasonable delivery lag has passed, and end far enough ahead that late-feed users still have a genuine decision to make.

*Event-driven vs time-driven fairness:*
- **Time-driven questions are inherently fairer.** The trigger is the clock, not a match event. No user has an information advantage over another. Time-driven questions should be the reliable core of the live experience.
- **Event-driven questions carry higher fairness risk.** The triggering event (a goal, a red card) may already be visible on some feeds before the question arrives. This does not make event-driven questions wrong — they are still more engaging — but they must use longer, safer answer windows to compensate. Never use short windows for event-driven questions.

*Question patterns to avoid:*
- "Will there be a goal in the next 20 seconds?"
- "Will there be a shot in the next 30 seconds?"
- Any window shorter than 90 seconds
- Any event-driven question with a window under 2 minutes

*Question patterns to prefer:*
- "Will there be a goal in the next 5 minutes?"
- "Will there be a yellow card before the 75th minute?"
- "Will there be a corner in the next 3 minutes?"
- "Will the home team score again before full time?"

*The principle:* Spontix should feel live, but never unfair. A user on a 40-second broadcast delay should have the same genuine chance to answer as a user watching in real time. Speed creates excitement; fairness creates trust. Both are required.

**Question lock timing — three required timestamps per live question**

Every live question must carry three explicit timestamps. These are not optional — they are the mechanism that makes fairness enforceable and consistent.

| Timestamp | Purpose | Practical value |
|---|---|---|
| `visible_from` | When the question appears in the feed | 20–60 seconds after generation, to absorb delivery lag |
| `answer_closes_at` | Last moment a user can submit | `visible_from` + answer window (minimum 90 seconds, typically 2–5 min) |
| `resolves_after` | When the resolver evaluates the outcome | `answer_closes_at` + safety buffer (minimum 60 seconds) |

Rules:
- The database and RLS must reject any `player_answers` insert where `created_at > answer_closes_at`. `answer_closes_at` is the authoritative lock time for all live questions and replaces `deadline` for this purpose. The existing `deadline` column is retained for backwards compatibility with non-live and pre-existing questions only.
- `resolves_after` must always be strictly after `answer_closes_at`. A question cannot be resolved while answers are still open.
- `visible_from` must never be set in the past at generation time. If generation is delayed, the buffer is absorbed into `visible_from`, not removed.
- The UI must hide the question card entirely before `visible_from` and lock the answer controls at `answer_closes_at`, even if the card remains visible.

*Example for a time-driven question generated at 00:34:00 match time:*
- `visible_from` = T+30s → question appears at 00:34:30
- `answer_closes_at` = `visible_from` + 4 minutes → closes at 00:38:30
- `resolves_after` = `answer_closes_at` + 90s → resolver checks at 00:40:00

*Example for an event-driven question triggered by a goal at 00:67:00:*
- `visible_from` = T+45s → question appears at 00:67:45 (longer buffer for event-driven)
- `answer_closes_at` = `visible_from` + 3 minutes → closes at 00:70:45
- `resolves_after` = `answer_closes_at` + 90s → resolver checks at 00:72:15

No answer submitted after `answer_closes_at` is accepted. No outcome is evaluated before `resolves_after`. These constraints are enforced at the database level, not just in the UI.

**Two valid states during a live match** (applies to both league types):
1. A question is open → user answers it
2. No question open → holding card ("Next moment dropping soon") displayed in the feed

There is no third state while a match is live. "Nothing left" only appears after the final whistle.

**Session continuation flow (not yet built — planned sprint — primarily Type 1)**:
- After answering a question, the app immediately surfaces the next action (next live question, next open question, or holding card)
- New live questions appear at the top of the feed without a page refresh (Supabase Realtime subscription on `questions` filtered by `league_id`)
- When the match ends and all answers resolve, a summary card appears in the feed (points earned, leaderboard position) — replaces the result notification for users already in the app
- Deep-linking from notifications into specific question cards (pass `league_id` + `question_id` in notification context JSONB)

### Full scoring system

> **⚠️ POST-LAUNCH SYSTEM — DO NOT IMPLEMENT FOR MVP**
> The full multi-factor scoring formula is the post-launch target. For MVP, only `base_value`, `time_pressure_multiplier`, and `streak_multiplier` are active. `difficulty_multiplier`, `comeback_multiplier`, and `clutch_multiplier` are bypassed to 1.0 in `resolve-questions/index.ts` via `MVP_BYPASS` constants. All columns, functions, and code below remain in the codebase. Do not remove them. To activate post-launch: remove the bypass constants — no other change required.
>
> The note below about "flat 10 base points placeholder" is now stale — the resolver was fully implemented in the 2026-04-20 sprint and uses the formula with MVP bypasses applied.



#### 1. Core philosophy

Scoring is not just about correctness. It rewards timing, difficulty, and clutch moments. The goal is tension, comeback potential, and dopamine spikes — not a flat accumulation of identical points.

A player who answers a late-phase question in a close game with 3 minutes left on the answer window should earn more than a player who answered a low-stakes filler in the 15th minute. The score should reflect that.

#### 2. Base question values by category

| Category | Examples | Base points |
|---|---|---|
| High-value event | Goal, penalty, red card | 20 |
| Outcome / state | Winner, equaliser, clean sheet | 15 |
| Player-specific | "Will the striker score?" | 12 |
| Medium stat | Shots on target, corners, cards | 10 |
| Low-value filler | "Will a goal be scored in the next 10 min?" | 6 |

These map directly to the question priority tiers already defined. Higher-priority questions pay more — not only because they are more engaging to answer, but because they are harder to get right.

#### 3. Time pressure multiplier

Shorter answer windows earn more. Time remaining is computed as `answer_closes_at - player_answers.created_at`. For live questions, `answer_closes_at` is always the authoritative timestamp — it is the enforced lock time defined in the question lock timing model. Do not use `deadline` for this calculation on live questions. If a question only has `deadline` and no `answer_closes_at` (legacy or non-live questions), fall back to `deadline - player_answers.created_at`.

| Time remaining at answer submission | Multiplier |
|---|---|
| > 8 minutes remaining | 1.0× |
| 5–8 minutes remaining | 1.1× |
| 3–5 minutes remaining | 1.25× |
| < 3 minutes remaining | 1.5× |

Late-phase questions already have shorter `answer_closes_at` windows (3–5 min). This multiplier stacks naturally with the match phase — the late phase produces shorter windows which produce higher multipliers without any additional logic.

#### 4. Difficulty multiplier

Less likely outcomes should pay more. Rather than building a probability engine, use a simple proxy: question category + game state.

| Situation | Multiplier |
|---|---|
| Standard question, expected outcome | 1.0× |
| Outcome question in a close game (could go either way) | 1.2× |
| Underdog outcome (e.g. equaliser when trailing by 2+) | 1.5× |
| Player-specific question (narrow, specific) | 1.15× |

Difficulty multiplier is set at question generation time and stored in the `questions` row (add a `difficulty_multiplier` column, default 1.0). The resolver reads it when scoring — no real-time calculation needed.

#### 5. Streak multiplier

Consecutive correct answers increase scoring. Wrong answer resets the streak.

| Streak | Multiplier |
|---|---|
| 1 correct (no streak) | 1.0× |
| 2 in a row | 1.1× |
| 3 in a row | 1.2× |
| 4+ in a row | 1.3× (cap) |

Streak is tracked per user per match (Type 1) or per user per session (Type 2). Store as `current_streak` on the `player_answers` row or aggregate from recent history. Reset to 0 on wrong answer.

#### 6. Comeback multiplier

Players trailing on the leaderboard should have a chance to recover. This prevents early leaders from coasting and keeps lower-ranked players engaged.

| Position vs leader | Bonus multiplier |
|---|---|
| Within 20 pts of leader | 1.0× (no bonus) |
| 21–50 pts behind | 1.1× |
| 51–100 pts behind | 1.2× |
| 100+ pts behind | 1.3× (cap) |

This is computed at answer submission time by comparing the user's running total against the current leader's total for that league + match, and stored as `leader_gap_at_answer` on the `player_answers` row. The resolver reads this stored value — it does not re-query the leaderboard at resolve time. Leaderboard state can change between submission and resolution; scoring must reflect the conditions when the player made their decision.

Keep the cap at 1.3× — enough to matter, not enough to let a player leap from last to first on a single question.

#### 7. Clutch / late-match multiplier

Late-phase moments feel more valuable because they are. Connect directly to match phase awareness:

| Match phase | Clutch multiplier |
|---|---|
| Early (0–20 min) | 1.0× |
| Mid (20–70 min) | 1.0× |
| Late (70–90+ min) | 1.25× |

Phase is determined from `match_minute_at_generation` stored on the `questions` row, not from `resolves_after`. `resolves_after` is a technical resolution deadline — it does not reliably represent when in the match the question was asked. The client computes the clutch multiplier from `match_minute_at_generation` at submission time and stores it as `clutch_multiplier_at_answer` on the `player_answers` row. The resolver reads this stored value directly.

This multiplier applies to all questions answered in the late phase, regardless of type. Stacks with time pressure multiplier. A late-phase question with a short `answer_closes_at` window could reach 1.25 × 1.5 = 1.875× before base value is applied.

#### 8. Wrong answer handling

Wrong answers receive zero points. No negative points. Streak resets to zero.

Rationale: negative points create frustration and incentivise not answering (skip the question to protect your score). Zero is the right floor — it punishes inaction and wrong guesses equally, keeps players engaged rather than defensive, and avoids the feeling that a single mistake destroys a session.

Voided questions: if a question is voided by the resolver (match cancelled, predicate unresolvable), all answers for that question are refunded — `is_correct` set to null, `points_earned` set to 0, streak not affected.

#### 9. Final scoring formula

```
points = base_value
       × time_pressure_multiplier
       × difficulty_multiplier
       × streak_multiplier
       × comeback_multiplier
       × clutch_multiplier
```

All multipliers are floats, rounded to nearest integer at the end. Minimum awarded: 0. No cap on maximum (natural cap comes from multiplier limits — theoretical max is approximately 20 × 1.5 × 1.5 × 1.3 × 1.3 × 1.25 ≈ 95 pts for a single perfect question).

Example:
- High-value event question (base 20)
- Answered with 2 min remaining (1.5×)
- Close game outcome (1.2×)
- 3-question streak (1.2×)
- No comeback gap (1.0×)
- Late phase (1.25×)
- **Total: 20 × 1.5 × 1.2 × 1.2 × 1.0 × 1.25 = 54 pts**

#### 10. Distinction by league type

**Type 1 — Single-match live league (closed session)**
- All multipliers apply within the match session.
- Streak resets at the start of each session.
- Comeback multiplier compares against the league leaderboard for that single match.
- Final session score is the sum of all question points earned in the match.
- The match summary card shows total session points + position change.

**Type 2 — Season / long-term league (ongoing system)**
- All multipliers apply per question, same formula.
- Streak persists across a single match but resets between matches.
- Comeback multiplier compares against the cumulative season leaderboard — a player 300 pts behind the leader has more incentive to keep answering.
- Points accumulate across all matches over the season. Leaderboard is cumulative.
- Each match is one scoring opportunity within a longer competition.

#### 11. Moment weighting (engagement priority)

Multipliers adjust points up or down, but they must never flatten the difference between question categories. A low-value filler with a lucky combination of multipliers should not produce the same outcome as a high-value event question. The base value gap must be preserved.

**The rule**: high-value event questions should consistently produce the highest point outcomes. Multipliers amplify that gap — they do not close it.

Practical enforcement:
- Base values are fixed per category (see section 2) and cannot be overridden by generation logic
- The gap between categories is intentional: 20 / 15 / 12 / 10 / 6 — each tier is meaningfully lower than the one above
- A low-value filler (base 6) at maximum multipliers: 6 × 1.5 × 1.5 × 1.3 × 1.3 × 1.25 ≈ 28 pts
- A high-value event (base 20) at the same maximum: 20 × 1.5 × 1.5 × 1.3 × 1.3 × 1.25 ≈ 95 pts
- The gap holds. A goal question is always worth more than a filler question, even under identical conditions.

Goal: create clear emotional peaks in scoring. When a goal is scored and a question fires, the points earned from answering correctly should feel noticeably bigger. Players should feel that big moments matter more — because they do.

#### 12. Resolver integration

The current resolver (`resolve-questions` Edge Function) awards a flat `BASE_POINTS = 10` in `markCorrectAnswers()`. This is the placeholder to replace.

**Two multipliers must be captured at answer submission time, not at resolve time.** The leaderboard can shift and match metadata can be ambiguous between when the user answers and when the resolver runs. Scoring must reflect the conditions at the moment the user made their decision.

Changes required to `player_answers` table:
- Add `streak_at_answer integer` — streak value at the time the user answered
- Add `leader_gap_at_answer integer` — point gap between this user and the current league leader at the time of submission; resolver derives comeback multiplier from this stored value, not from a live leaderboard query
- Add `clutch_multiplier_at_answer numeric` — match phase multiplier (1.0 / 1.0 / 1.25) stored at submission time, derived from `match_minute_at_generation` on the question; resolver reads this directly
- Add `multiplier_breakdown jsonb` — full breakdown written by resolver for auditability and UI display: `{ time_pressure, difficulty, streak, comeback, clutch }`

Changes required to `questions` table:
- Add `difficulty_multiplier numeric default 1.0` — set at generation time based on question type and game state context
- Add `match_minute_at_generation integer` — the match minute when the question was generated; used by the client to compute and store `clutch_multiplier_at_answer` on submission. Do not use `resolves_after` for phase inference — it is a technical resolution deadline, not a reliable match clock value.

Changes required to resolver logic in `markCorrectAnswers()`:
1. Read `difficulty_multiplier` from the `questions` row
2. Compute `time_pressure_multiplier` from `answer_closes_at - player_answers.created_at` for live questions; fall back to `deadline - player_answers.created_at` if `answer_closes_at` is null (legacy questions only)
3. Read `streak_at_answer` from `player_answers` → derive streak multiplier
4. Read `leader_gap_at_answer` from `player_answers` → derive comeback multiplier (do not re-query the leaderboard)
5. Read `clutch_multiplier_at_answer` from `player_answers` → use directly (do not infer from `resolves_after`)
6. Apply formula → round → write to `points_earned`
7. Write `multiplier_breakdown` JSONB for display and debugging

The resolver already fetches all `player_answers` for a question — the multiplier computation happens in that same loop. No new database round-trips required beyond the existing pattern.

### Scoring visibility — communicating value to the user

> **⚠️ POST-LAUNCH SYSTEM — DO NOT IMPLEMENT FOR MVP**
> Point range display, question badges (HIGH VALUE / CLUTCH / FAST), visual hierarchy, and post-answer multiplier breakdown are post-launch UI enhancements. The holding card and basic answer confirmation state are sufficient for MVP. Do not implement the full scoring visibility system pre-launch.

The scoring system is only effective if users understand it while playing. Each question must communicate its value clearly before the user answers. Scoring must be visible, not hidden.

**1. Point range display**

Every question card shows an estimated point range based on its base value and the multipliers that are already known at display time (difficulty, clutch phase, active streak if available). Time pressure multiplier varies with when the user answers, so display the range rather than a fixed number.

Examples:
- Low-value filler, early phase, no streak → "Up to 8 pts"
- Medium stat question, mid phase → "10–18 pts"
- High-value event, late phase, 3-streak → "Up to 85 pts"

The range is derived from the formula using minimum multipliers (all at 1.0×) as the floor and maximum realistic multipliers as the ceiling. The exact number is resolved after submission.

**2. Question badges**

Small visual labels on the question card. Derived from existing scoring and timing logic — no new data required.

| Badge | Condition | Purpose |
|---|---|---|
| `HIGH VALUE` | Base value ≥ 20 (goals, penalties, red cards) | Signals this question matters more |
| `CLUTCH` | `match_minute_at_generation` ≥ 70 (late phase) | Signals clutch multiplier is active |
| `FAST` | `answer_closes_at` − now < 3 minutes | Signals time pressure multiplier is elevated |

Badges stack. A late-phase goal question with 2 minutes remaining shows all three: `HIGH VALUE` · `CLUTCH` · `FAST`.

**3. Visual hierarchy**

High-value questions must look more important than low-value ones. This is not cosmetic — it is part of the engagement system.

- **HIGH VALUE questions**: stronger border treatment, lime accent colour (`#A8E10C`), slightly larger card or bolder title
- **CLUTCH questions**: additional urgency treatment — pulsing countdown, elevated visual weight
- **Standard questions**: default card style, no special treatment
- **Low-value fillers**: no badge, standard or slightly muted treatment — they should not compete visually with high-value cards

The hierarchy should be immediately legible at a glance. A user scanning the feed should feel the difference without reading the badge text.

**4. Post-answer feedback**

Immediately after submitting an answer, the card transitions to a confirmation state that shows:
- The answer selected (highlighted)
- Estimated points if correct (based on multipliers locked at submission time)
- Contributing factors displayed as small tags: `×1.5 Fast` · `×1.25 Clutch` · `×1.2 Streak`

When the question resolves, the card updates to show:
- Correct / incorrect result
- Actual points awarded (for correct answers)
- Full breakdown: base value + each multiplier that contributed
- For wrong answers: "0 pts — streak reset" (no negativity, just clarity)

The breakdown is sourced from `multiplier_breakdown` JSONB stored on `player_answers` by the resolver. No additional computation needed in the UI.

**5. The goal**

Users should feel the emotional difference between answering a low-value corner question and a late-phase goal question. The visual system — point range, badges, hierarchy, post-answer feedback — is what makes that difference tangible. Without it, the scoring system exists only in the database. With it, every high-value moment becomes a visible spike in the experience.

### Sport-specific live logic packs

> **⚠️ POST-LAUNCH SYSTEM (HOCKEY + TENNIS) — DO NOT IMPLEMENT FOR MVP**
> Football (Soccer) is the only sport supported at launch. The football reference implementation in §2 below is active. Hockey (§3) and Tennis (§4) logic packs are fully designed and documented but must not be implemented or exposed to users pre-launch. Their adapters exist as stubs/partials in the codebase — do not extend them. The generator skips non-football leagues at runtime via `MVP_UNSUPPORTED_SPORTS` guard. The event queue (§1 global event priority) and advanced collision protection are also post-launch — for MVP, max 2 active questions is the safety mechanism.

#### 1. Core principle

The full product engine — scoring formula, multipliers, fairness model, question lock timing, diversity control, match phase awareness, game state awareness, session continuation, notification philosophy — is **shared across all sports**. None of that changes per sport.

What changes per sport:
- Match structure (halves vs periods vs sets)
- Event types that trigger event-driven questions
- Valid question types and framing
- Phase definitions (time-based vs sequence-based)
- Game state interpretation (what counts as "close" or "one-sided")

The pattern: one core engine, sport-specific logic packs that plug into it. Generation selects the correct pack based on `leagues.sport`. The resolver evaluates based on sport-specific event definitions. Scoring is untouched.

**Global event priority override (applies to all sports):**

High-value events always override normal generation scheduling. This rule is not sport-specific — it applies identically across soccer, hockey, and tennis.

| Sport | High-value events that trigger override |
|---|---|
| Soccer | Goals, penalties awarded, red cards |
| Hockey | Goals, major penalties |
| Tennis | Break of serve, end of set, match point reached |

Override behaviour:
- An event-driven question fires immediately when a high-value event is detected — regardless of active cooldown, time-driven scheduling, or diversity rotation
- Diversity constraints are soft-overridden: the system may repeat a recent question category if the event demands it. Diversity rules resume normally on the next generation cycle.
- The time-driven gap timer resets to zero after an event question fires
- If the active question limit is already reached when an event fires, the event question is queued — not dropped. It fires as soon as a slot opens.
- Time-driven questions may be skipped when the limit is reached. Event-driven questions are never dropped.

The system must never miss a high-value moment due to cooldown or rotation state.

**Active question queue behaviour (applies to all sports):**

When the active question limit for a sport is reached (3 for soccer/hockey, 2 for tennis):
- Event-driven questions: queued in a small bounded priority queue. Fire in order when slots open.
- Time-driven questions: skipped entirely if no slot is available. Do not queue time-driven questions — if the window passes, skip it and wait for the next generation cycle.

**Event-driven queue rules:**
- Maximum queue depth: 3 items. This is not a job scheduler — it is a small safety buffer to avoid losing closely-timed events (e.g. goal followed immediately by a red card).
- Ordering: highest-priority item fires first. Priority is determined by (1) fixed event priority order per sport (see below), then (2) recency (newer event preferred if priority is equal).

Fixed event priority order per sport:

| Sport | Priority order (highest → lowest) |
|---|---|
| Soccer | Goal > Penalty awarded > Red card > Yellow card |
| Hockey | Goal > Major penalty > Minor penalty |
| Tennis | Match point > Set end > Break of serve > Hold of serve |
- Time-to-live: each queued item expires after 90 seconds. Expired items are removed from the queue at the start of every generation cycle — before any new questions are considered or slots are evaluated. Do not wait until a slot opens to check TTL. This prevents stale events from firing long after the moment has passed.
- Collision check applies to the queue: if a new event would produce a question that duplicates or invalidates something already active or already in the queue, do not add it. The queue and active set are checked together.
- If the queue is full (3 items) and a new event fires: compare the new event against the lowest-priority item in the queue. If the new event is higher priority, replace the lowest-priority queued item. If equal or lower, drop the new event.

This keeps the queue short, deterministic, and bounded. It is not a complex scheduler — it is a 3-slot buffer with priority ordering and fast expiry.

**Question collision and overlap protection (applies to all sports):**

Before generating any question, the system must check both active questions and the queued event items for the same league and reject the new question if:
- It is semantically identical to an already-active question (same subject, same window, same outcome type)
- It logically invalidates an already-active question (e.g. "Will there be a goal in the next 5 minutes?" generated immediately after a goal question covering the same window)

If a collision is detected:
- Do not generate the conflicting question
- Prefer: letting the existing question expire naturally, or generating a different question type that does not conflict
- Do not force-close the existing question — this would break fairness for users who already answered it

Collisions most commonly occur with time-driven questions in rapid-event sequences. The check is simple: compare `question_type`, `stat_focus`, and the time window against all currently active questions and all queued event items for the league.

---

#### 2. Soccer (reference implementation)

Soccer is the base model. All core system design decisions were made with soccer as the primary sport. Other sports adapt from here.

**Match structure:**
- First half (0–45 min)
- Second half (45–90 min)
- Full match
- Extra time counts as late phase

**Event types (event-driven triggers):**
- Goals
- Penalties awarded
- Red cards
- Yellow cards (lower priority)
- Corners (lower priority)

**Valid question types:**
- "Will there be a goal in the next X minutes?"
- "Will there be a yellow/red card before the Xth minute?"
- "Will there be a corner in the next X minutes?"
- "Which team scores next?"
- "Will the home team keep a clean sheet?"
- "Will there be an equaliser?"
- "Who wins the match?"

**Phase logic:**
- Early: 0–20 min — low intensity, medium/low questions
- Mid: 20–70 min — balanced, full mix
- Late: 70–90+ min — high intensity, prioritise outcome and high-value questions, shorten windows to 3–5 min

**Game state:**
- Close (≤1 goal margin): outcome questions valid
- One-sided (2+ goal margin): shift to stat/event/player questions; avoid equaliser and winner framing

**Active question limits:**
- Max 3 active questions at once
- 3-minute cooldown between time-driven questions
- Event priority override applies (see global rule in section 1) — goals, penalties, red cards fire immediately and bypass cooldown

---

#### 3. Hockey logic pack

Hockey maps cleanly onto the core engine but uses periods instead of halves and has no corners. Penalties in hockey are different from soccer — they result in power plays, not direct kicks.

**Match structure:**
- 1st period
- 2nd period
- 3rd period
- Full game
- *(Future: overtime and shootout — defer until API data confirms reliable coverage)*

**Event types (event-driven triggers):**
- Goals
- Penalties (power play situations)
- Shots on goal (high volume — use as time-driven anchor, not primary event trigger)

**Valid question types:**
- "Will there be a goal in the next X minutes?"
- "Will there be a penalty in the next X minutes?"
- "Will [team] score before the end of the period?"
- "Which team scores next?"
- "Will the total shots on goal exceed X before end of period?"
- "Will there be a goal in the power play?"

**Phase logic:**
- Early: Period 1 + first half of Period 2
- Mid: Second half of Period 2 into Period 3
- Late: Final 8–10 minutes of Period 3

**Game state:**
- Close (≤1 goal): equaliser and winner questions valid
- One-sided (2+ goals): shift to stats (shots, penalties) and next-goal questions; avoid comeback framing

**Sport constraints — do not apply soccer logic:**
- No corners in hockey
- No "cards" in the soccer sense — use "penalty" for power play situations only
- No halves — always use period-based framing
- Shots on goal are high-frequency; avoid using them as event-driven triggers (use as time-driven stat questions instead)

**Hockey late-phase adjustments (final 5 minutes of Period 3):**

The last 5 minutes of a hockey game are high-chaos and high-value. Teams trailing may pull the goalie, creating empty-net situations and elevated scoring probability.

- Increase question frequency slightly — reduce the time-driven gap threshold from 8–12 min to 5–8 min
- Prioritise: next goal, total goals in game, team to score next
- Deprioritise: low-value time-window fillers — they feel irrelevant in late high-stakes hockey
- Empty-net context: if API data signals goalie pull, next-goal and total-goal questions are especially appropriate
- All fairness windows remain in force — do not shorten `answer_closes_at` below system minimums (90 seconds absolute)

**Active question limits:**
- Max 3 active questions at once
- 3-minute cooldown between time-driven questions
- Event priority override applies (see global rule in section 1) — goals and major penalties fire immediately and bypass cooldown

---

#### 4. Tennis logic pack

Tennis is structurally different from soccer and hockey. It is not time-driven — a game can last 20 minutes or 3 hours. The correct unit is sequence (games and sets), not minutes. Time-window questions like "next 5 minutes" are not appropriate as a primary pattern for tennis.

**Match structure:**
- Sets (Set 1, Set 2, Set 3, etc.)
- Games within each set
- Full match
- Tie-break within a set
- Deciding set (third or fifth set depending on format)

**Event types (sequence-driven triggers):**
- Break of serve
- Hold of serve
- Set won
- Tie-break reached (6–6)
- Match point reached

**Valid question types:**
- "Will [player] hold serve in the next game?"
- "Will there be a break of serve before the end of this set?"
- "Will this set reach a tie-break?"
- "Will the match go to a deciding set?"
- "Who wins the next game?"
- "Who wins the next set?"
- "Will [player] win the next two games?"

**Phase logic (sequence-based, not time-based):**
- Early: First 1–3 games of a set — lower intensity, hold/break questions
- Mid: Games 3–5 of a set — balanced, allow set outcome questions
- Late: Games 5–6, tie-break, deciding set — highest intensity, match outcome questions valid

**Game state:**
- Close set (scores within 1 game, or tie-break): all question types valid including match outcome
- One-sided set (one player leading by 3+ games): avoid set winner framing; prefer next-game and hold/break questions

**Sport constraints — do not apply soccer or hockey logic:**
- Do not use "next 5 minutes" as a primary time window — use sequence windows instead ("next game", "next 2 games", "before end of set")
- Time-driven clock logic does not apply to tennis — replace with sequence-driven generation (fire a question after each game or every 2 games)
- No goals, no cards, no corners, no periods
- Shots in tennis (aces, winners) are high-frequency micro-events — avoid using individual shots as question triggers; focus on game-level and set-level outcomes

**Tennis generation triggers (sequence-driven — not clock-driven):**

Tennis has no reliable time signal for generation. Questions must be triggered by match progression, not clock intervals.

Standard generation triggers (fire after):
- Each completed game — primary trigger; generate one question per game by default
- Throttle to every 2 games if the match pace is fast and active questions are accumulating

Priority triggers (fire immediately regardless of game count):
- Break of serve — high-value event, question fires at once
- End of a set — generate a set-outcome or next-set question immediately
- Tie-break reached (6–6) — generate a tie-break outcome question immediately
- Match point reached — generate a match outcome question immediately

Pacing constraints:
- Max 2 active questions at once (lower than soccer/hockey — tennis questions stay open longer per game)
- Minimum 1 completed game gap before the next standard question fires
- Do not repeat the same question type consecutively (diversity rule applies as normal)
- All answer windows must be sequence-based: "next game", "next 2 games", "before end of this set", "before end of match"

All standard fairness and lock timing rules apply. `visible_from`, `answer_closes_at`, and `resolves_after` are still required.

**Tennis answer windows are time-based, not sequence-estimated:**
- Do not attempt to estimate game duration from API data — game length is too variable to be reliable
- `answer_closes_at` is always a fixed wall-clock window from `visible_from`, exactly as in other sports
- Standard window: 2–4 minutes. Never below 90 seconds (global minimum applies)
- Resolution is sequence-based (next game result, set outcome, etc.) — but the answer *window* is always time-based
- The distinction: window = time-based (fairness). Resolution = sequence-based (correctness). These are independent.

**Active question limits:**
- Max 2 active questions at once
- Spacing enforced by game progression (minimum 1 game gap), not a time-based cooldown

---

#### 5. Integration rules

**League creation:**
- Each league has a `sport` field (already exists on the `leagues` table)
- `sport` determines which logic pack is used at generation time and at resolver evaluation time

**Generation must always:**
- Select the sport pack based on `leagues.sport` before any question logic runs
- Apply the correct trigger model for that sport (time-driven for soccer/hockey, sequence-driven for tennis)
- Generate only question types listed as valid for that sport — no cross-sport question bleed
- Respect the active question limit defined per sport (3 for soccer/hockey, 2 for tennis)
- Apply the correct phase definition (time-based minutes for soccer/hockey, game/set sequence for tennis)
- Apply game state logic using sport-specific close/one-sided thresholds

**Resolver must:**
- Route to the correct `fetchMatchStats()` branch by sport (already implemented)
- Evaluate predicates using only field names valid for that sport — never attempt to evaluate `total_corners` for a hockey question, never attempt `penalty_goals` for a soccer question
- Ignore stat types not covered by the API tier in use (e.g. hockey player stats — void immediately, do not attempt)
- For tennis: evaluate resolution using game scores and set scores, not wall-clock time

**Scoring system:**
- Unchanged across all sports. Base values, multipliers, formula, and timing model are identical.
- Phase multipliers in tennis map from sequence-phase (early/mid/late within a set) to the same 1.0/1.0/1.25× clutch values as time-based sports.

---

#### 6. Design constraints and fallback behaviour

**Design constraints:**
- Do not duplicate the full system per sport. The core engine runs once; only the sport pack layer changes.
- Each sport pack defines only what is different: match structure, event types, question types, phase definitions, game state rules.
- Keep all question logic simple, observable, and resolvable. The rules from the live question design section apply to all sports — no subjective inference, no momentum, no pressure. Only events a scoreboard can confirm.

**Fallback behaviour (when sport adapter returns insufficient data):**

System correctness is more important than always generating content. If the data required to generate a fair, resolvable question is not available, do not generate.

- If the sport adapter returns no data or a critical failure: skip generation entirely for that league in this cycle. Do not generate questions. Do not void partial attempts.
- If the adapter returns partial data (some fields missing, some present): fall back to the simplest available question types only — those that require the fewest fields to resolve. Do not attempt questions that depend on missing data.
- Never generate a question that cannot be reliably resolved from data already available or imminently available from the API.
- If tennis sequence data is unavailable or unreliable: do not enable tennis question generation. Tennis is gated on verified API coverage — this has not yet been confirmed.
- If hockey player stats are missing (current situation on free API tier): void any `player_stat` predicate immediately at resolution. Do not attempt to generate hockey player-stat questions.

The principle: a skipped generation cycle is always better than a voided question. Voided questions degrade user trust and waste resolver cycles.

### Tier architecture

**Full tier documentation: [`docs/TIER_ARCHITECTURE.md`](docs/TIER_ARCHITECTURE.md)**

Pricing: Player Starter=Free, Pro=€7.99/mo, Elite=€19.99/mo. Venue Starter=Free, Venue Pro=€29.99/mo, Venue Elite=€79.99/mo.

Core monetization rule: `CORE_MATCH_PREMATCH` is Starter+, `CORE_MATCH_LIVE` is Pro+, `REAL_WORLD` is Pro (limited) / Elite (full). Live questions are the primary upgrade hook.

Central config: `TIER_LIMITS` in `spontix-store.js`. Always read via `SpontixStore.getTierLimits(tier)`. Never hardcode tier strings in feature checks — use the boolean keys (`liveQuestionsEnabled`, `realWorldQuestionsEnabled`, `customPhotoUpload`, etc.).

### Three-layer tier enforcement

Every gated feature is defended at three independent layers:
1. **UI** — controls are visually locked (badges, dashed borders, disabled state).
2. **Handler** — click handlers route unauthorized tiers to upgrade modals instead of executing.
3. **Store** — functions return typed errors (`{ error: 'tier' }`) when called programmatically.

Backend RLS will mirror layer 3 when we move enforcement server-side.

---

## 4. File Structure

```
Spontix/
├── CLAUDE.md                          ← This file (project handoff)
├── ARCHITECTURE.md                    ← Deeper data-model docs
├── SESSION_CONTINUATION_DESIGN.txt    ← Live session engagement design: two league types,
│                                        event-driven + time-driven questions, blowout handling,
│                                        notification philosophy, session flow, what to build next
├── IMPLEMENTATION_NOTES.txt           ← Historical implementation notes (stale)
│
├── index.html                         ← Landing / marketing page
├── login.html                         ← Supabase Auth signup + login + password reset
├── dashboard.html                     ← Player home
├── profile.html                       ← Player profile + Trophy Room + Settings (Supabase-backed ✅)
├── discover.html                      ← League discovery (Supabase-backed ✅)
├── my-leagues.html                    ← Player's leagues list (Supabase-backed ✅)
├── create-league.html                 ← 5-step wizard (sport/scope/team/AI quota fields ✅)
├── league.html                        ← Single league view (fully Supabase-backed ✅ — question feed, members, answers, leaderboard)
├── activity.html                      ← Your Games feed (Supabase-backed ✅)
├── upcoming.html                      ← Upcoming matches/events
├── matches.html                       ← Browse fixtures
├── leaderboard.html                   ← Global rankings
├── battle-royale.html                 ← Battle Royale game mode (ELO integrated ✅)
├── trivia.html                        ← Trivia modes (Solo/1v1/Party)
├── live.html                          ← Live match prediction game
├── br-leaderboard.html                ← BR-specific leaderboard (ELO history tab ✅)
├── notifications.html                 ← User notifications
├── player-onboarding.html             ← First-time player setup
│
├── venues.html                        ← Venue discovery grid (Supabase-backed ✅)
├── venue-register.html                ← Venue signup
├── venue-onboarding.html              ← First-time venue setup
├── venue-dashboard.html               ← Venue admin home (Supabase-backed ✅)
├── venue-schedule.html                ← Venue events calendar (Supabase-backed ✅)
├── venue-tonights-events.html         ← Tonight's events (static template — not yet dynamic)
├── venue-create-event.html            ← 4-step wizard (Supabase-backed ✅)
├── venue-live-floor.html              ← Live question pushing + end-event (Supabase-backed ✅)
├── venue-questions.html               ← Question bank
├── venue-teams.html                   ← Team setup
├── venue-table-map.html               ← Physical table layout
├── venue-analytics.html               ← Stats dashboard
├── venue-billing.html                 ← Subscription billing UI
│
├── spontix-architecture.html          ← Marketing/architecture explainer page
├── supabase-test.html                 ← Connection smoke-test page
│
├── spontix-store.js                   ← ★ Central data layer (~4000+ lines)
│                                        • SpontixStore (sync)
│                                        • SpontixStoreAsync (Promises)
│                                        • Session module + Auth gate
│                                        • All domains: Users/Venues/Leagues/Events/
│                                          Trophies/Badges/Photos/Reservations/GameHistory
│                                        • Tier limits matrix
│                                        • ELO computed + stored in recordGameResult()
│
├── br-elo.js                          ← Battle Royale ELO calculator (standalone, no deps)
│                                        • BRElo.calculateSinglePlayer({currentElo, placement, totalPlayers})
│                                        • Returns {eloChange, newElo, prevElo}
│
├── supabase-client.js                 ← Supabase SDK client initialization
├── sidebar.js                         ← Shared sidebar builder (with logout)
├── utils.js                           ← Shared utility functions
├── styles.css                         ← Shared styles
│
├── backend/
│   └── migrations/
│       ├── 001_initial_schema.sql     ← Full schema + RLS + seed data (~510 lines)
│       ├── 002_ai_questions.sql       ← AI questions schema: sports_competitions,
│       │                                sports_teams, questions, generation_runs,
│       │                                generation_run_leagues + league columns + RLS
│       ├── 003_cron_schedule.sql      ← pg_cron + pg_net setup, 6-hourly generator job
│       ├── 004_player_answers.sql     ← player_answers table + RLS + resolver 1-hourly cron job
│       ├── 006_scoring_columns.sql    ← adds visible_from, answer_closes_at, base_value,
│       │                                difficulty_multiplier, match_minute_at_generation to
│       │                                questions; adds streak_at_answer, leader_gap_at_answer,
│       │                                clutch_multiplier_at_answer, multiplier_breakdown to
│       │                                player_answers; updates RLS; expands event_type CHECK
│       └── 009_saved_matches.sql      ← saved_matches table: players + venues save fixtures
│                                        to personal/venue schedule. RLS: own rows only.
│                                        Unique(user_id, match_id). Two indexes (user, venue).
│
└── supabase/
    └── functions/
        ├── generate-questions/        ← Edge Function: question generation (Deno TypeScript)
        │   ├── index.ts               ← Main orchestrator (GET/POST handler)
        │   ├── DEPLOY.md              ← Step-by-step deployment + monitoring guide
        │   └── lib/
        │       (see below)
        └── resolve-questions/         ← Edge Function: question resolution + scoring (Deno TypeScript)
            ├── index.ts               ← Orchestrator: fetch pending → evaluate → score
            └── lib/
                ├── predicate-evaluator.ts ← evaluatePredicate() + all resolution type handlers
                └── stats-fetcher/
                    ├── index.ts       ← Routes fetchMatchStats() by sport; needsPlayerStats()
                    ├── football.ts    ← Full football stats (fixtures + statistics + players endpoints)
                    └── hockey.ts      ← Hockey game stats (scores + status; no player stats in free tier)

        generate-questions/lib/
                ├── types.ts           ← All shared interfaces (SportsContext, ResolutionPredicate, etc.)
                ├── quota-checker.ts   ← classifyLeague, sortLeaguesByPriority, checkQuota
                ├── context-builder.ts ← buildContextPacket, buildPredicatePrompt, computeResolvesAfter
                ├── openai-client.ts   ← generateQuestions (Call 1), convertToPredicate (Call 2)
                ├── predicate-validator.ts ← validateQuestion (4-stage: schema/entity/temporal/logic)
                ├── sports-adapter/
                │   ├── index.ts       ← Routes to correct adapter by sport
                │   ├── football.ts    ← Full API-Sports football adapter
                │   ├── hockey.ts      ← API-Sports hockey adapter (standings + games)
                │   └── tennis.ts      ← Stub (returns empty context, TODO)
                └── news-adapter/
                    ├── index.ts       ← Graceful wrapper (returns unavailable=true on failure)
                    └── gnews.ts       ← GNews API, parallel queries, dedup, cap 10 items/run
```

### Key files at a glance

- **`spontix-store.js`** — the single most important file. Everything writes/reads through here.
- **`br-elo.js`** — standalone ELO module. Included on `battle-royale.html` and `br-leaderboard.html`.
- **`backend/migrations/001_initial_schema.sql`** — the DB truth. 13 base tables, RLS policies, seed data.
- **`backend/migrations/002_ai_questions.sql`** — adds 5 new tables + 12 new columns to `leagues`.
- **`backend/migrations/003_cron_schedule.sql`** — enables pg_cron/pg_net, schedules the generator. Replace `<<YOUR_CRON_SECRET>>` before running.
- **`backend/migrations/004_player_answers.sql`** — `player_answers` table + RLS + resolver cron job. Replace `<<YOUR_CRON_SECRET>>` before running.
- **`backend/migrations/005_notifications.sql`** — `notifications` table + RLS + 5 Postgres SECURITY DEFINER triggers.
- **`supabase/functions/resolve-questions/index.ts`** — hourly resolver: evaluates predicates against post-match stats, scores `player_answers`.
- **`supabase/functions/resolve-questions/lib/predicate-evaluator.ts`** — `evaluatePredicate()`, all predicate types, `applyOperator()`.
- **`supabase/functions/generate-questions/DEPLOY.md`** — full deploy checklist (updated to include resolve-questions).
- **`SESSION_CONTINUATION_DESIGN.txt`** — product design spec for live session engagement. Read this before working on anything related to live questions, notifications, or the league question feed.
- **`ARCHITECTURE.md`** — deeper explanation of identity model, trophy routing, tier gating, league membership model, async/sync pattern.

---

## 5. Supabase Setup

**Project**: `spontix-prototype` (Spontix org, Free tier, eu-west-2 / London)
**Project URL**: `https://hdulhffpmuqepoqstsor.supabase.co`
**Project Ref**: `hdulhffpmuqepoqstsor`

### Tables (19 — 13 original + 5 from migration 002 + 1 from migration 004)

| Table | Purpose |
|---|---|
| `users` | Profile mirror of `auth.users`. Handle, name, avatar, role, tier, aggregated stats. **✅** |
| `venues` | Venue records with `owner_id`. Seeded with 6 demo venues. **✅** |
| `leagues` | League records. Now includes: `sport`, `scope`, `scoped_team_id/name`, `api_sports_league_id/team_id/season`, `league_start/end_date`, `ai_questions_enabled`, `ai_weekly_quota`, `ai_total_quota`. **✅** |
| `league_members` | Join table. `(league_id, user_id)` primary key. **✅** |
| `venue_events` | Events hosted by a venue. `venue_id` + `host_user_id`. JSONB trophy config. **✅** |
| `venue_custom_trophies` | Venue's designed trophy catalogue. Tracks `times_awarded`. **✅** |
| `trophies` | Awarded trophies — the contents of each user's Trophy Room. **✅** |
| `venue_photos` | Photo metadata. `storage_url` holds data URLs (CDN migration later). **✅** |
| `venue_photo_config` | Which photo is the title, whether to use it. One row per venue. **✅** |
| `player_badges` | Per-user badge progress + earned state. **✅** |
| `venue_badges` | Per-venue badge progress + earned state. **✅** |
| `reservations` | Player reserves a spot at a venue event. **✅** |
| `game_history` | Per-user completed game stats. Now includes `elo_before`, `elo_after` columns. **✅** |
| `sports_competitions` | Master list of competitions AI can generate questions for. Seeded with 10 competitions (PL, La Liga, Bundesliga, Serie A, UCL, NHL conferences + Grand Slams). |
| `sports_teams` | Teams within each competition. Seeded with ~40 teams. Used by league creation team picker. |
| `questions` | All prediction questions (manual, ai_generated, live_driven). Includes full resolution predicate JSONB. |
| `generation_runs` | Top-level audit row per AI generation cycle. Tracks status, stats, prompt version. |
| `generation_run_leagues` | Per-league breakdown within each run. Includes rejection log, news snapshot, duration. |
| `player_answers` | Each user's answer submission per question. `is_correct` + `points_earned` filled by resolver Edge Function. **Unique constraint on `(question_id, user_id)` — MVP safety: do not remove or relax. This is the structural guarantee against duplicate answer exploits.** RLS insert policy enforces answer window is still open. Migration 006 adds: `streak_at_answer`, `leader_gap_at_answer`, `clutch_multiplier_at_answer`, `multiplier_breakdown`. |
| `saved_matches` | Players and venues save football fixtures to their personal/venue schedule. `venue_id = null` → player save; `venue_id` set → venue save. Unique `(user_id, match_id)`. RLS: own rows only. Surface in `upcoming.html` (players) and `venue-schedule.html` (venues). Added by migration 009. |

### Seed data
- **6 demo venues** with stable UUIDs (`11111111-1111-1111-1111-1111111111XX`). Owner_id is NULL.
- **3 seed leagues** — LaLiga Legends 24/25, UCL Knockout Crew, NBA Draft Kings. Owned by the first registered user.
- **10 seed competitions** + **~40 seed teams** — added by migration 002.
- **No seed users** — real users come from Supabase Auth signups.

### Auth configuration
- **Email/password** enabled.
- **Email confirmation** — currently user's choice (recommend OFF for prototype speed, ON for production).
- **Trigger on signup**: `handle_new_user()` auto-populates `public.users` from `auth.users` metadata.
- **Logout**: `SpontixStore.Session.logout()` signs out of Supabase + clears local state + redirects to login.

### Row Level Security policies
- All 13 original tables: unchanged (see 2026-04-15 log for details).
- `sports_competitions`, `sports_teams` — public read-only (only service role can write).
- `questions` — public read; only service role can insert (Edge Function uses service role key).
- `generation_runs`, `generation_run_leagues` — service role only (internal audit, not exposed to browser).
- `player_answers` — select: own answers + answers within leagues you belong to; insert: own only, must be a league member, `answer_closes_at` must be in the future (falls back to `deadline > now()` for legacy questions); update (is_correct/points_earned): service role only (resolver).
  - **MVP safety note:** The `insert` policy enforces the answer window is still open — this is the server-side enforcement of the timing lock. The `update` policy restricts scoring to the service role only — this prevents any client from self-awarding points. The `(question_id, user_id)` unique constraint prevents duplicate submissions. Do not modify any of these three guarantees.

### Postgres functions / extensions
- `handle_new_user()` — trigger that creates a `public.users` row on signup.
- `pg_cron` + `pg_net` — enabled by migration 003. Two jobs: `generate-questions-every-6h` (migration 003) and `resolve-questions-every-hour` (migration 004).

### Edge Function secrets required
Set in Supabase dashboard → Settings → Edge Functions → Secrets:
- `OPENAI_API_KEY` — OpenAI key (sk-...)
- `API_SPORTS_KEY` — API-Sports key
- `GNEWS_API_KEY` — GNews key
- `CRON_SECRET` — random string matching the one used in `003_cron_schedule.sql`
- (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically)

---

## 6. Environment Setup

### Credentials (in `supabase-client.js`)
```js
SUPABASE_URL              = "https://hdulhffpmuqepoqstsor.supabase.co"
SUPABASE_PUBLISHABLE_KEY  = "sb_publishable_P-FAJ7Jp5IomFiiqEfB_qg_PKv24KS5"
```

These are **safe to commit and ship to the browser**. Security comes from RLS policies, not key secrecy.

### Required to run (browser app)
- **A modern browser** (Chrome/Safari/Firefox/Edge — any version from the last 3 years)
- **Internet connection** — the app fetches live data from Supabase on every page load
- **That's it** — no Node, no npm install, no build tool

### Required to deploy the Edge Function
- Supabase CLI: `npm install -g supabase`
- See `supabase/functions/generate-questions/DEPLOY.md` for the full checklist.

### Optional but recommended
- A lightweight local HTTP server to avoid `file://` CORS issues:
  - `python3 -m http.server 8000`
  - `npx serve`
  - Live Server extension (VS Code)

---

## 7. What Is Working

### ✅ Fully functional (end-to-end, Supabase-backed)
- **Supabase project** — provisioned, schema migrated, RLS enabled, all tables active.
- **Auth** — signup, login, logout, password reset. All pages require auth.
- **Venues** — discovery grid, CRUD, owner assignment. 6 seed venues.
- **Leagues** — create, join, leave, delete. Now includes sport/scope/team/AI quota fields in the wizard. `create-league.html` prefills name, dates, and competition from URL params (invoked from Browse Matches "Invite players" CTA).
- **Events** — create via wizard, schedule calendar, live floor.
- **Trophies** — awarded trophies, venue custom trophies, Trophy Room.
- **Badges** — player + venue badges via upsert pattern.
- **Photos** — venue photos stored as data URLs. Title photo config.
- **Reservations** — player reserves spots at venue events.
- **Game history** — per-user game results with `elo_before`/`elo_after`.
- **User profile** — name/handle/stats synced to `public.users`.
- **Battle Royale ELO** — `BRElo.calculateSinglePlayer()` wired into `battle-royale.html`. Victory screen shows real ELO delta. `br-leaderboard.html` match history shows `elo_before → elo_after`.
- **AI question generation pipeline** — deployed, firing every 6h via pg_cron. Football only (MVP guard). Pool system active.
- **AI question resolver pipeline** — deployed, firing every hour. Full scoring formula with MVP bypasses.
- **league.html — live engine v2** — correct question state machine (visible_from / answer_closes_at / resolves_after with legacy deadline fallback), 5-second polling while active / 15-second idle, holding card when no active question, engagement badges (HIGH VALUE / CLUTCH / FAST), point range display per question, answer window enforcement client + server side, scoring multiplier capture (clutch, streak) at submission time, dynamic league activity card replacing static live match card.
- **matches.html — Browse Matches** — real football fixtures loaded directly from `api_football_fixtures` table (synced from API-Sports by Edge Function); functional filters (competition, date); Save button (bookmark icon) on every card; post-save inline CTA ("Invite players" / "Create event"); **Match Live button** — one click navigates to create-league.html with competition and fixture pre-filled from page data (zero extra DB queries); pre-loads saved state on page init.
- **upcoming.html — Upcoming Matches** — player schedule from league membership + saved fixtures merged; deduplicates (league entry takes precedence); "⭐ Saved" filter chip; **Match Live button** on every fixture card; early-exit paths (no memberships, no football leagues, no questions) all show saved matches instead of empty state.
- **venue-schedule.html** — week grid includes saved venue fixtures as lime-bordered "Match" cards alongside regular events; loaded async via `getSavedMatches({ venueId })`.
- **Save Match feature (migration 009)** — `saved_matches` table + RLS; `SpontixStoreAsync.saveMatch`, `unsaveMatch`, `getSavedMatches` with localStorage fallback. Run `009_saved_matches.sql` in Supabase SQL editor to activate.
- **Tier system v2** — Starter gets limited live access (3 LIVE answers per match, not locked out); Pro gets monthly caps (50 BR / 100 trivia); Elite gets fair-use cooldown model. All meaningful limits (leagueMaxPlayers, leaguesJoinMax, leaguesCreatePerWeek, liveQuestionsPerMatch, eventsPerMonth) now enforced via Supabase counts — not bypassable via localStorage. `-1` is the universal "unlimited" sentinel replacing `Infinity`.
- **Battle Royale tier gate** — 3-way gate: Starter daily counter (`spontix_br_day_*`), Pro monthly counter (`spontix_br_month_*`), Elite fair-use cooldown (`spontix_br_cooldown`). Cooldown resets to 20s on victory (was 30s at game start).
- **Trivia tier gate** — same 3-way pattern: Starter daily, Pro monthly (100/month), Elite fair-use. Cooldown resets on results screen.
- **Match Live quick-create** — `matches.html` and `upcoming.html` both have a coral "Match Live" button on every fixture card. Clicking it navigates to `create-league.html?league_type=match&...` with home, away, kickoff, match_id, api_league_id, and comp_name all in the URL. `create-league.html` `readPrefill()` constructs `selectedCompetition` and `selectedMatch` directly from URL params — no DB queries. The browser never calls any external API; all fixture data was already loaded from `api_football_fixtures` (Supabase) on the source page.
- **Discover leagues** — `hydrateDiscover()` is now async and calls `SpontixStoreAsync.getDiscoverLeagues()` which hits Supabase directly on page load. Newly created leagues by any user appear immediately without waiting for cache warming. Shows loading state while fetching, and empty state if no leagues exist.
- **Delete / Leave league** — `league.html` Settings tab Danger Zone shows a **Delete League** button for the owner and a **Leave League** button for members. Both open a confirmation modal (league name + warning text + Cancel / Confirm). On confirm, calls `SpontixStoreAsync.deleteLeague()` or `leaveLeague()` and redirects to My Leagues. RLS on the DB enforces owner-only delete independently.
- **My Leagues — Join a League button** — purple pill button added to the My Leagues header alongside the lime Create New League button. Links to `discover.html`.
- **Tier badge — name only** — `getTierLabel()` in `spontix-store.js` now returns `'Starter'`, `'Pro'`, `'Elite'` without price strings. Prices remain only in upgrade modal CTAs where they are appropriate.
- **Cache warming** — all domains auto-refresh 1.5s after page load.
- **All UI screens** — every `.html` file renders correctly. `profile.html` and `leaderboard.html` use full-width layout.

---

## 8. What Is Incomplete or Missing

### Architecture gaps flagged but not yet addressed
- **Live gameplay pages** (`live.html`, `battle-royale.html`, `trivia.html`, `venue-live-floor.html`) are **single-player client simulations**. Real multi-user games need server-authoritative state via websockets — a separate sprint.
- **Cross-user trophy awarding** — RLS only allows self-insert (`recipient_user_id = auth.uid()`). A venue owner can't award a trophy to a winner yet. Needs a Postgres function or Edge Function.
- **venue-tonights-events.html** — still a static HTML template with hardcoded event cards.
- **Public trophy rooms** — `getTrophies(userId)` supports viewing other users' trophies but no UI route exists.
- **Elite tier forced** — `authGate()` in `spontix-store.js` forces Elite tier for all users. Must be replaced when Stripe billing lands.
- **Tennis adapter** — `supabase/functions/generate-questions/lib/sports-adapter/tennis.ts` is a stub that returns empty context. Needs implementing before tennis leagues can use AI questions.
- **Hockey player stats** — not available in API-Sports free tier. Hockey questions using `player_stat` predicate type will be voided by the resolver.
- **Admin exception flow** — when a question can't auto-resolve, it gets voided automatically. No admin UI to manually override or inspect voided questions.

### Not-started pieces
- **Stripe subscriptions** — tier is forced to Elite in `authGate()`. No payment flow.
- **OAuth providers** — only email/password. No Google/Apple sign-in.
- **Photo CDN storage** — photos are base64 data URLs. Needs a Supabase Storage bucket.
- **Live gameplay** — websockets, server authority, real-time leaderboards.
- **Audit log** — no record of authz decisions.
- **Rate limiting** — AI trophy generation, event creation, signup are all unthrottled.

### Live session design — designed, not yet built
Full spec in `SESSION_CONTINUATION_DESIGN.txt`. Items not yet implemented:
- **Deep-linking from notifications** — notification context JSONB carries `league_id` + `question_id`; landing page reads them and opens the right card directly
- **Question chaining UI** — "what's next" prompt after answering; next live question slides in below
- **Holding card** — shown in feed when no question is active mid-match; "Next moment dropping soon"
- **Time-driven question generation** — background check alongside resolver cron: if no live question fired for 8–12 min, generate a simple stat question (corners, cards, shots, goals). Templates are pre-defined; resolves using stats the resolver already fetches
- **Realtime question feed** — Supabase Realtime subscription on `questions` filtered by `league_id`; new live questions prepend to feed without page refresh (biggest single retention feature)
- **Match summary card** — appears in feed after final whistle; shows points earned + leaderboard position; replaces result notification for users already in the app
- **Live dot on dashboard** — lime indicator next to leagues with an active match; re-entry point for users who navigated away mid-session

### Known minor issues
- `ARCHITECTURE.md` section 6 lists old short venue IDs (`ven_arena`); actual IDs are now UUIDs. Doc refresh needed.
- `IMPLEMENTATION_NOTES.txt` is a stale design doc; can be deleted.
- `api_football_fixtures` table is populated by the `generate-questions` Edge Function as a side effect of each generation cycle. If the table is empty (e.g. fresh project), matches.html will show "No upcoming fixtures" until the first generation run completes.

---

## 9. How to Run the Project

### Start the local server
```bash
cd /path/to/Spontix
python3 -m http.server 8000
# open http://localhost:8000/login.html
```

### To sign up as a new user
1. Open `http://localhost:8000/login.html`
2. Click **Create account**, pick Player or Venue Owner
3. Enter name, email, password (min 8 chars)
4. You'll land on `dashboard.html` (player) or `venue-dashboard.html` (venue-owner)

### Auth required
All pages (except `index.html` and `login.html`) require a Supabase auth session.

### To verify Supabase connection
Open `supabase-test.html` — should show a green "Connected · 6 venues" pill.

### To run DB migrations
1. Open Supabase SQL Editor: https://supabase.com/dashboard/project/hdulhffpmuqepoqstsor/sql/new
2. Run `001_initial_schema.sql` (base schema — idempotent)
3. Run `002_ai_questions.sql` (AI questions tables + league columns + seed data)
4. Edit `003_cron_schedule.sql` — replace `<<YOUR_CRON_SECRET>>` — then run it
5. Edit `004_player_answers.sql` — replace `<<YOUR_CRON_SECRET>>` with the **same secret** — then run it
6. Run `009_saved_matches.sql` — creates `saved_matches` table + RLS + indexes (required for Save Match feature)

### To deploy the Edge Functions
See `supabase/functions/generate-questions/DEPLOY.md` for the full checklist including secrets setup, deploy commands for both functions, and smoke-test curl commands.

---

## 10. Next Steps (in priority order)

### 1. ✅ DONE — Deploy both Edge Functions + run all migrations + activate AI generation
- All 6 migrations run in Supabase SQL editor ✅
- `CRON_SECRET = spontix-cron-x7k2m9` set in Supabase Secrets ✅
- `generate-questions` deployed with `--no-verify-jwt` ✅ (fires every 6h)
- `resolve-questions` deployed with `--no-verify-jwt` ✅ (fires every hour, verified ok:true)
- `OPENAI_API_KEY` + `API_SPORTS_KEY` added to Supabase Secrets ✅ — AI generation now active
- `sync-teams` Edge Function deployed ✅ — pulls all teams from API-Sports for all active competitions
- 335 teams synced across: PL (20), La Liga (20), Bundesliga (18), Serie A (20), Ligue 1 (18), UCL (82), UEL (77), NHL (32), FIFA World Cup 2026 (48)
- FIFA World Cup 2026 added to `sports_competitions` (api_league_id=1, season=2026)
- First generation run: 6 questions generated, 1 rejected — live fixtures UCL + La Liga ✅
- Bug fixed: `.catch()` on Supabase query builder replaced with `await` + destructure in `generate-questions/index.ts:335`
- Known issue: duplicate question dedup occasionally misses near-identical questions (Lamine Yamal scored twice in one run)
- **Model optimisation**: both OpenAI calls switched from `gpt-4o` → `gpt-4o-mini` (PROMPT_VERSION bumped to v1.1). Quality verified identical. Cost per run ~$0.003 vs ~$0.05. If question quality degrades in future, upgrade `MODEL_GENERATION` back to `gpt-4o` in `openai-client.ts` — `MODEL_PREDICATE` should stay on mini permanently.
- **Bug fixed**: temporal validator was rejecting prematch questions with `opens_at` > 30 minutes from now. Fixed to 7 days — prematch questions legitimately open days before kickoff. File: `predicate-validator.ts` line ~206.
- **Match-level question pool** (migration 007 + `lib/pool-manager.ts`): one OpenAI call per unique match context (match_id + sport + league_type + phase_scope + mode + prompt_version), reused across all leagues following that match. Two new tables: `match_question_pool` (race-safe cache key + status), `match_pool_questions` (canonical questions with fingerprint dedup). `questions` table gains `pool_question_id` + `reuse_scope`. Pool reuse confirmed: `ai_model = 'gpt-4o-mini/pool_reuse'` on reused rows. 15 leagues watching PSG vs Bayern = 1 OpenAI call, not 15. Generator restructured into 3 phases: A) reuse ready pools, B) claim + generate for uncovered matches, C) attach from pool to league with per-league constraint checks.

### 2. ✅ DONE — Full scoring system implemented end-to-end
- `resolve-questions/index.ts` — `markCorrectAnswers()` now applies the complete formula: `base_value × time_pressure × difficulty × streak × comeback × clutch`
- `BASE_POINTS = 10` placeholder fully removed
- Three pure scoring helpers: `computeTimePressureMultiplier()`, `computeStreakMultiplier()`, `computeComebackMultiplier()`
- Questions SELECT now fetches `base_value`, `difficulty_multiplier`, `answer_closes_at`, `deadline`
- Player answers SELECT now fetches `answered_at`, `streak_at_answer`, `leader_gap_at_answer`, `clutch_multiplier_at_answer`
- `multiplier_breakdown` JSONB written for every answer (correct and wrong) — includes all six multipliers + total
- Wrong answers: 0 pts, breakdown includes `note: 'wrong_answer'`
- `league.html` — `computeLeaderGap()` added: queries all resolved correct answers, aggregates per user, computes real gap to leader
- `handleAnswer()` now runs `computeCurrentStreak()` + `computeLeaderGap()` in parallel before saving
- **Remaining known limitations:**
  - `leader_gap_at_answer` will be 0 for everyone on the very first question in a league (no prior resolved answers exist — correct behaviour)
  - `difficulty_multiplier` is always 1.0 until the AI generation pipeline sets it at question creation time; manual/seed questions default to 1.0×
  - Hockey `player_stat` questions are voided at resolution (API-Sports free tier returns no player stats) — by design
  - Streak reset logic: the streak counter resets correctly on the next answer after a wrong answer, but the wrong answer itself does not actively zero a stored streak column — the resolver counts wrong answers as 0 pts and the next `computeCurrentStreak()` call naturally returns 0 because the broken streak is the most recent resolved answer

### 3. ✅ DONE — Save Match feature
- `backend/migrations/009_saved_matches.sql` — new table, RLS, indexes
- `spontix-store.js` — `SpontixStoreAsync.saveMatch`, `unsaveMatch`, `getSavedMatches` (Supabase + localStorage fallback)
- `matches.html` — bookmark button per card, post-save inline CTA (player → "Invite players" prefilling `create-league.html`; venue → "Create event" prefilling `venue-create-event.html`)
- `upcoming.html` — saved matches merged into schedule; early-exit paths show saved matches; "⭐ Saved" filter chip
- `venue-schedule.html` — saved venue fixtures injected as lime-bordered Match cards in week grid
- `create-league.html` — `readPrefill()` reads URL params and pre-populates league name, dates, competition

### 4. ✅ DONE — Tier system v2 + BR/trivia gate upgrade
- **Starter limited live access** — `liveQuestionsEnabled: true` + `liveQuestionsMode: 'limited'` (3 answers per match, not locked out). Pro/Elite: `liveQuestionsMode: 'full'`.
- **3-way gate pattern** — Starter daily counter / Pro monthly counter / Elite fair-use cooldown. Implemented on both `battle-royale.html` and `trivia.html`. Pro monthly caps: 50 BR, 100 trivia.
- **Elite fair-use cooldown** — localStorage timestamps (`spontix_br_cooldown`, `spontix_trivia_cooldown`). 30s at game start, reset to 20s on victory/results. Neutral toast: "Preparing your next match… ready in Xs".
- **`-1` replaces `Infinity`** as the universal unlimited sentinel across all of `TIER_LIMITS` and all limit checks in 9 files.
- **All limits Supabase-backed** — `joinLeague()`, `leaguesCreatePerWeek`, `liveQuestionsPerMatch`, `eventsPerMonth`, `customTrophyCreation` all now check live DB counts, not localStorage. Bypass by clearing storage no longer works.
- **`docs/TIER_ARCHITECTURE.md` updated to v3** — Pro monthly caps, Elite fair-use model, 3-way gate code pattern, localStorage key reference table, updated Feature Gate Matrix.
- **`profile.html` Pro plan card** updated: "50 Battle Royale / month" and "100 trivia games / month".

### 5. ✅ DONE — Match Live quick-create button
- `matches.html` and `upcoming.html` — coral "Match Live" button on every fixture card. Uses `_matchStore` / `_inviteStore` data-store pattern (no JSON in onclick attributes).
- URL params passed: `league_type=match`, `home`, `away`, `kickoff`, `match_id`, `api_league_id`, `comp_name`.
- `create-league.html` `readPrefill()` — when `league_type=match`: selects Match Night type card, jumps to Step 1, builds `selectedCompetition` and `selectedMatch` directly from URL params. Zero DB queries in the browser — all data was already loaded from `api_football_fixtures` on the source page.
- Data flow: `api_football_fixtures` (Supabase, synced by Edge Function) → source page → URL params → create-league.html. No external API calls from the browser at any point.

### 7. Wire Stripe for real tier subscriptions
- Enable Stripe in Supabase Edge Functions
- Add `subscriptions` table mirroring Stripe state
- Add webhook handler that updates `users.tier`
- Replace `authGate()` Elite tier forcing with real tier reads

### 8. Make remaining static pages dynamic
- **venue-tonights-events.html** — render from `getVenueEvents()` (league.html is now fully dynamic ✅)

### 9. Photo CDN migration
- Create a `venue-photos` Storage bucket
- Replace data URL uploads with `supabase.storage.from('venue-photos').upload()`

### Longer-term (separate sprints)
- **Live session sprint** — implement remaining session continuation design (see `SESSION_CONTINUATION_DESIGN.txt`): deep-linking from notifications, question chaining UI (what's next prompt after answering), Supabase Realtime subscription replacing polling, match summary card, live dot on dashboard. Holding card ✅ already in league.html.
- **Live gameplay websockets** — full server authority. 1-2 weeks of work.
- **Tennis sports adapter** — implement `tennis.ts` in the Edge Function.
- **Cross-user trophy awarding** — Postgres function bypassing RLS for venue owner → winner awards.
- **Production launch checklist** — email verification, rate limiting, error monitoring (Sentry), cookie consent, ToS.
- **OAuth providers** — Google/Apple sign-in.
- **Mobile app** — Capacitor wrapper.

---

## Quick Reference Card

**Supabase dashboard:** https://supabase.com/dashboard/project/hdulhffpmuqepoqstsor
**SQL editor:** https://supabase.com/dashboard/project/hdulhffpmuqepoqstsor/sql/new
**Auth settings:** https://supabase.com/dashboard/project/hdulhffpmuqepoqstsor/auth/providers
**API keys:** https://supabase.com/dashboard/project/hdulhffpmuqepoqstsor/settings/api-keys

**Credentials in code:** `supabase-client.js`, lines 17-18
**Seed venue IDs:** `SpontixStore.VENUE_IDS.{PENALTY|SCORE|DUGOUT|ARENA|FULLTIME|FINAL}`
**Arena venue owned by:** `f901f211-738e-4409-abfd-8e1a9fb4bffb` (utis.richard@gmail.com)

**Resume prompt for a fresh Claude session:**
> "Continue Spontix development. Read `CLAUDE.md` for full context. Also read `SESSION_CONTINUATION_DESIGN.txt` before working on anything related to live questions, notifications, or the league question feed. Last completed: Discover leagues now fetches from Supabase directly so new leagues appear immediately. League owners can delete their league; members can leave — both via confirmation modal. Join a League button added to My Leagues. Tier badge no longer shows price. Next priorities: (1) Realtime subscription replacing polling in league.html — biggest single retention feature; (2) Stripe subscriptions replacing forced Elite tier; (3) GNews API key to activate news context in generation."

---

## Update Log

### 2026-04-14 — Leagues domain ported to Supabase
- Leagues async overrides: `getLeagues`, `createLeague`, `joinLeague`, `leaveLeague`, `deleteLeague`
- Updated `create-league.html`, `my-leagues.html`, `discover.html` to async
- Seeded 3 leagues into DB

### 2026-04-15 — All remaining domains ported + auth hardening
**Domains ported:**
1. **Events** — `getVenueEvents`, `createVenueEvent`, `updateVenueEvent`, `deleteVenueEvent`. Updated `venue-create-event.html`, `venue-schedule.html`, `venue-live-floor.html`, `venue-dashboard.html`.
2. **Badges** — `getPlayerBadges`, `checkAndAwardPlayerBadge`, `getVenueBadges`, `checkAndAwardVenueBadge`.
3. **Trophies** — `getTrophies`, `awardTrophy`, `awardCustomTrophy`, `getVenueCustomTrophies`, `createVenueCustomTrophy`.
4. **Photos** — `getVenuePhotoConfig`, `addVenuePhoto`, `selectPresetPhoto`, `removeVenuePhoto`, `setVenueTitlePhoto`, `setVenueUseTitlePhoto`.
5. **Reservations** — `getReservations`, `reserveSpot`, `cancelReservation`.
6. **Game History** — `getGameHistory`, `recordGameResult`.
7. **User Profile Sync** — `getProfile`, `updateProfile`.

**Auth hardening:**
- Supabase SDK added to all 23 app pages; `authGate()` redirects unauthenticated users.
- Demo mode removed. Password reset flow added.
- Elite tier forced in `authGate()` until Stripe lands.

**Bug fixes:**
- Fixed `tier-gate-overlay` `display:flex` intercepting first click on every page → changed to `display:none`.
- Fixed `venue-schedule.html` null element errors.
- Fixed session hydration overwriting forced Elite tier.
- Cache warming delay increased from 300ms to 1500ms.

### 2026-04-16 — Battle Royale ELO integration
- **`br-elo.js`** — new standalone ELO module. `BRElo.calculateSinglePlayer({ currentElo, placement, totalPlayers })` returns `{ eloChange, newElo, prevElo }` with K-factor + placement weights + clamped deltas.
- **`spontix-store.js`** — `recordGameResult()` restructured: ELO computed before DB insert so `elo_before`/`elo_after` go into the same game_history row. Returns `{ eloChange, newElo, prevElo }` to callers.
- **`battle-royale.html`** — `<script src="br-elo.js">` added. Victory screen reads `gameResult.eloChange`, `gameResult.newElo`, `gameResult.prevElo` directly.
- **`br-leaderboard.html`** — `<script src="br-elo.js">` added. Match history tab shows real `elo_before → elo_after` delta in lime/coral colour based on sign.
- **`backend/migrations/001_initial_schema.sql`** — added `elo_before integer`, `elo_after integer` columns to `game_history` + partial index on `(user_id, played_at desc) where elo_after is not null`.

### 2026-04-16 — 2026-04-17 — AI Real World Questions system
Full end-to-end pipeline written (awaiting first deploy).

**New DB tables (migration 002):**
- `sports_competitions` — master list of competitions the AI can target. 10 seeded (PL, La Liga, Bundesliga, Serie A, UCL, NHL East/West, Australian Open, Wimbledon, US Open).
- `sports_teams` — teams within competitions. ~40 seeded.
- `questions` — all prediction questions. Key fields: `source`, `type`, `resolution_predicate` (JSONB), `resolution_status`, `source_badge`.
- `generation_runs` — top-level audit per cycle (status, stats, prompt_version, trigger_type).
- `generation_run_leagues` — per-league breakdown (mode, quota, generated/rejected counts, rejection log, news snapshot, duration_ms).

**New columns on `leagues`:** `sport`, `scope`, `scoped_team_id`, `scoped_team_name`, `api_sports_league_id`, `api_sports_team_id`, `api_sports_season`, `league_start_date`, `league_end_date`, `ai_questions_enabled`, `ai_weekly_quota`, `ai_total_quota`.

**pg_cron schedule (migration 003):** `0 */6 * * *` — fires every 6 hours via `pg_net.http_get()` to the Edge Function. Bearer token checked against `CRON_SECRET` env var.

**Edge Function (`supabase/functions/generate-questions/`):**
- `index.ts` — orchestrator: create run → classify leagues by match imminence → quota check → sports context → news context → build context packet → generate (up to 3 retries) → validate (4 stages) → insert → finalise run
- `lib/quota-checker.ts` — `IMMINENT`/`UPCOMING`/`DISTANT`/`NONE` classification; weekly rate by tier (elite=10, pro=5, starter=2); `PER_RUN_CAP = 3`
- `lib/sports-adapter/` — football (full), hockey (partial), tennis (stub)
- `lib/news-adapter/` — GNews parallel queries, dedup by normalised headline, cap 10 items/run, graceful degradation
- `lib/context-builder.ts` — mode-aware context packet; URGENCY NOTE for <24h matches; predicate prompt builder; `computeResolvesAfter()` with sport buffers (football=150min, hockey=180min, tennis=240min)
- `lib/openai-client.ts` — Call 1 (temp=0.8, generates questions JSON); Call 2 (temp=0.1, converts resolution rule to structured predicate)
- `lib/predicate-validator.ts` — 4-stage validation: schema (types/required fields), entity (IDs must exist in sportsCtx, scope enforcement), temporal (timing ordering + 90min gap), logic (field-operator compatibility, MC option alignment)

**`create-league.html` updates:**
- Step 2: sport `<select>` triggers async competition load from `sports_competitions` table; competition is now a `<select>` with `dataset.row` JSON; scope toggle (Full League / Team Specific); team picker loads from `sports_teams`; start/end date fields.
- Step 3: AI Real World Questions toggle card with weekly/total quota pills and mode label.
- Step 5 review: populated scope, team, date range, AI questions summary.
- `launchLeague()`: passes all new league fields to `createLeague`.
- `DOMContentLoaded`: calls `onSportChange()` on load; wires date inputs to `updateAIQuotaDisplay`.

### 2026-04-17 — Refined event-driven queue to bounded priority queue

Replaced the single-queued-event rule with a small bounded priority queue (max 3 items). Key rules: items ordered by fixed per-sport event priority then recency; 90-second TTL per queued item — expired items purged at start of each generation cycle, not lazily at slot-open time; queue full + new event arrives → replace lowest-priority item if new is higher, otherwise drop; collision check covers active questions and queued items together. Time-driven questions remain skip-only. Fixed priority tables: Soccer (goal > penalty > red card > yellow card), Hockey (goal > major penalty > minor penalty), Tennis (match point > set end > break of serve > hold of serve).

### 2026-04-17 — Live question logic edge cases closed

Refined live question logic with four targeted additions to close ambiguity before implementation:
- **Tennis answer windows**: explicitly time-based (2–4 min fixed), never dynamically estimated from game duration. Resolution remains sequence-based. Window and resolution are independent concerns.
- **Global event priority override**: moved from soccer-only to a core rule in section 1 of sport packs. Applies to all sports — goals/penalties/red cards (soccer), goals/major penalties (hockey), break of serve/set end/match point (tennis). Event questions always fire immediately or queue; never dropped.
- **Queue behaviour**: event-driven questions queue when active limit is reached; fire immediately when a slot opens. Time-driven questions may be skipped — they are never queued.
- **Collision protection**: new pre-generation check — reject questions that are semantically identical to or logically conflict with already-active questions. Do not force-close existing questions; generate a different type instead.

### 2026-04-17 — Sport-specific logic packs refined for production

Refined sport-specific logic packs with generation triggers, late-game behaviour, event priority overrides, and fallback handling. Ensures consistent live flow across soccer, hockey, and tennis:
- **Soccer**: event priority override added — goals, penalties, red cards bypass cooldown and diversity rules immediately; active limits made explicit (max 3, 3-min cooldown)
- **Hockey**: late-phase adjustments added for final 5 minutes of Period 3 (increased frequency, next-goal priority, empty-net context); active limits explicit
- **Tennis**: full generation trigger model added — sequence-driven, not clock-driven; triggers on completed games, breaks of serve, end of set, tie-break, match point; max 2 active questions; 1-game gap minimum
- **Integration rules**: strengthened — generation must select sport pack before any logic runs; resolver must ignore unsupported stat types
- **Fallback behaviour**: new subsection — skip generation on missing data rather than produce unresolvable questions; system correctness over always generating content

### 2026-04-17 — Sport-specific live logic packs added

Added sport-specific live logic packs for Soccer, Hockey, and Tennis. Core system remains shared (scoring, timing, fairness, multipliers, diversity, UI, session flow). Only match structure, event types, valid question types, phase definitions, and game state logic are sport-specific. Soccer formalised as the reference implementation. Hockey uses period-based structure with power-play penalties; no corners, no halves. Tennis is sequence-driven (games/sets) not time-driven; "next 5 minutes" is not a valid primary pattern. Integration rules define how `leagues.sport` connects generation and resolver to the correct pack.

### 2026-04-17 — Unified scoring time reference to `answer_closes_at`

Resolved inconsistency between the live question lock timing model and the scoring formula. `answer_closes_at` is now the authoritative timestamp for time pressure calculation on all live questions: `time_pressure_multiplier = f(answer_closes_at - player_answers.created_at)`. `deadline` retained as a fallback for legacy/non-live questions only. Updated: time pressure multiplier section, clutch multiplier section, resolver integration step 2, RLS description in tables list, and migration 004 update log entry. No scoring logic changed — timing reference unified only.

### 2026-04-17 — Scoring visibility defined

Added scoring visibility section covering how the scoring system is communicated to users in the UI. Key decisions: point range displayed on every question card before answering (derived from known multipliers at display time); three visual badges — HIGH VALUE, CLUTCH, FAST — derived from existing scoring and timing fields with no new data required; visual hierarchy gives high-value questions stronger treatment so the difference is legible at a glance; post-answer feedback shows estimated points at submission and full multiplier breakdown after resolution, sourced from `multiplier_breakdown` JSONB already stored by the resolver.

### 2026-04-17 — Question lock timing formalised

Every live question now requires three explicit timestamps: `visible_from` (question appears, absorbs delivery lag), `answer_closes_at` (last moment to submit), and `resolves_after` (when resolver evaluates outcome, strictly after close). Rules: RLS rejects answers after `answer_closes_at`; resolver cannot run before `resolves_after`; UI hides card before `visible_from` and locks controls at close. Concrete timing examples documented for both time-driven and event-driven questions.

### 2026-04-17 — Live question logic refined for delay-awareness and fairness

Added delay-aware design rules to the live session design section. Key decisions:
- Live questions are fair answer windows, not instant reaction prompts. Users watch on different feeds with different latency — the system must never assume they all see the same moment at the same time.
- Absolute minimum answer window: 90 seconds. Preferred window: 2–5 minutes. Time-driven questions: 3–10 minutes.
- Time-driven questions are the fairer and more reliable foundation — no user has an information advantage over another. Event-driven questions carry higher fairness risk and must use longer windows.
- Explicit unsafe patterns documented (sub-30-second windows). Explicit safe patterns documented.
- Scoring comeback and clutch multipliers corrected: both captured at answer submission time, not at resolver execution time. `leader_gap_at_answer` and `clutch_multiplier_at_answer` stored on `player_answers`; resolver reads stored values, never re-derives from live state.

### 2026-04-17 — Full engagement-based scoring system defined

Replaced the placeholder flat 10-point scoring with a full multi-factor scoring system. Key decisions:

- **Base values by question category**: high-value events (20 pts), outcome/state (15), player-specific (12), medium stat (10), low filler (6) — maps directly to existing priority tiers
- **Time pressure multiplier**: 1.0× to 1.5× based on time remaining at answer — stacks naturally with late-phase short deadlines, no extra logic needed
- **Difficulty multiplier**: 1.0× to 1.5× set at question generation time, stored on `questions.difficulty_multiplier` — avoids real-time probability calculation
- **Streak multiplier**: 1.0× to 1.3× cap — consecutive correct answers, resets on wrong answer
- **Comeback multiplier**: 1.0× to 1.3× cap — based on gap to leaderboard leader; prevents runaway leads, keeps trailing players engaged
- **Clutch multiplier**: 1.0× early/mid, 1.25× late phase — connects directly to match phase awareness
- **Wrong answers**: zero points, streak reset, no negative points — avoids defensive play
- **Voided questions**: full refund (0 pts, streak unaffected)
- **Formula**: `base × time_pressure × difficulty × streak × comeback × clutch` — rounded to integer, min 0
- **Resolver changes needed**: add `difficulty_multiplier` to `questions`, add `streak_at_answer` + `multiplier_breakdown` to `player_answers`, update `markCorrectAnswers()` to apply formula
- **Moment weighting**: base value gaps are fixed and enforced — multipliers amplify the difference between categories, never flatten it. A goal question must always feel more valuable than a filler.

Architecture diagram updated to remove "10 base pts" reference.

### 2026-04-17 — League type distinction hardened

Critical clarification: single-match live leagues and season leagues are NOT the same system with different parameters. They have different logic, constraints, and UX expectations.

- **Type 1 (single-match)** is a CLOSED GAME SESSION — defined start/end, fixed question budget (5–20), session pacing, question chaining. Behaves like a game mode.
- **Type 2 (season)** is an ONGOING SYSTEM — no session, no per-match budget, continuous AI generation, no match-level pacing constraints. Behaves like a content layer over time.

Session pacing, question budgets, and chaining logic apply to Type 1 only. Season leagues use continuous generation and are not session-constrained. CLAUDE.md updated with a full comparison table in Project Overview and architecture section updated to enforce the distinction.

SESSION_CONTINUATION_DESIGN.txt also updated to reflect this.

### 2026-04-17 — Live session design + platform identity clarified

**SESSION_CONTINUATION_DESIGN.txt** created — full product design spec for live engagement. Key decisions recorded:
- Spontix is a second-screen live experience, not just a prediction app. AI Real World questions are the core differentiator.
- Two league types defined: single-match live (fixed budget, 5–20 questions, configured at creation) vs season/long-term (continuous generation, no per-match ceiling).
- Two live question types: event-driven (triggered by goals/cards/penalties) + time-driven (triggered by clock when no event fires for 8–12 min). Both required. Neither alone is sufficient.
- Blowout suppression removed. When match is one-sided, question type adapts (stat/player/next-event questions) instead of stopping. Silence during a live match is a bug.
- Session continuation flow designed: question chaining, holding card, match summary card, Realtime feed (not yet built — planned sprint).
- Notification philosophy: max 2 per match window, max 4 per day. Never notify users already in an active session. Notifications bring users in; in-app mechanics keep them there.

**CLAUDE.md updated** to reflect:
- Core identity statement (second-screen live experience)
- Two league types in project overview
- Live session design section in Architecture
- SESSION_CONTINUATION_DESIGN.txt in file structure and key files list
- Live session items added to What Is Incomplete
- Live session sprint added to Next Steps
- Resume prompt updated

### 2026-04-20 — Full scoring system implemented end-to-end

**`supabase/functions/resolve-questions/index.ts`:**
- Removed `BASE_POINTS = 10` placeholder entirely
- Questions SELECT expanded: now fetches `base_value`, `difficulty_multiplier`, `answer_closes_at`, `deadline`
- Player answers SELECT expanded: now fetches `answered_at`, `streak_at_answer`, `leader_gap_at_answer`, `clutch_multiplier_at_answer`
- `markCorrectAnswers()` now accepts the full question row and applies the complete formula: `base_value × time_pressure × difficulty × streak × comeback × clutch`
- Three pure scoring helper functions added:
  - `computeTimePressureMultiplier(answeredAt, answerClosesAt, deadline)` — uses `answer_closes_at` for live questions, falls back to `deadline` for legacy; bands: <3 min → 1.5×, 3–5 min → 1.25×, 5–8 min → 1.1×, >8 min → 1.0×
  - `computeStreakMultiplier(streakAtAnswer)` — 1+ → 1.0×, 2 → 1.1×, 3 → 1.2×, 4+ → 1.3×
  - `computeComebackMultiplier(leaderGapAtAnswer)` — 0–20 pts → 1.0×, 21–50 → 1.1×, 51–100 → 1.2×, 100+ → 1.3×
- `clutch_multiplier_at_answer` read directly from `player_answers` (captured at submission time by client from `match_minute_at_generation`)
- `multiplier_breakdown` JSONB written for every answer — correct answers include all six values + total; wrong answers include `note: 'wrong_answer'` + 0 total
- Rounding applied only at the end of the formula; minimum 0 pts
- `markCorrectAnswers()` signature changed from `(sb, questionId, outcome, type)` to `(sb, q, outcome)` — question object passed directly so scoring metadata is accessible without an extra DB query

**`league.html`:**
- `computeLeaderGap()` added — queries all resolved correct `player_answers` for the league, aggregates points per user, returns the gap between current user's score and the leader's score
- `handleAnswer()` now runs `computeCurrentStreak()` + `computeLeaderGap()` in parallel via `Promise.all()` before saving — reduces latency vs sequential
- `leader_gap_at_answer` now stores the real computed gap (was hardcoded to 0 previously)
- Comment on `leader_gap_at_answer` updated to remove the "deferred" note

**Known limitations after this change:**
- `difficulty_multiplier` defaults to 1.0 on all existing and manually-created questions — only AI-generated questions will eventually set non-default values (requires `OPENAI_API_KEY` + generation pipeline active)
- `leader_gap_at_answer` is 0 for everyone on the very first question in a league — correct, no prior scores exist
- Streak does not write a 0 back to any column on a wrong answer; the resolver relies on `computeCurrentStreak()` returning 0 naturally because the wrong answer is the most recent resolved row

---

### 2026-04-22 — Match-level question pool + temporal validator fix

**New migration: `007_match_question_pool.sql`**
- `match_question_pool` — one row per cache key (match_id + sport + league_type + phase_scope + mode + prompt_version). UNIQUE constraint is the race lock. Status: generating → ready → stale.
- `match_pool_questions` — canonical questions per pool. UNIQUE on (pool_id, fingerprint) for semantic dedup. `reuse_scope`: prematch_only / live_safe / league_specific.
- `questions` gains `pool_question_id` (FK to pool questions) + `reuse_scope`.

**New file: `supabase/functions/generate-questions/lib/pool-manager.ts`**
- `getOrClaimPool()` — race-safe INSERT ON CONFLICT; only one process generates per match context
- `findReadyPools()` — bulk lookup of existing pools by match_id list
- `storePoolQuestions()` — upsert with fingerprint dedup
- `getPoolQuestions()` — fetch eligible questions by reuse_scope and mode
- `attachPoolQuestionsToLeague()` — creates league-specific question rows with timing + dedup checks
- `computeFingerprint()` — semantic dedup: type + match + teams + event_type + predicate fields
- `determineReuseScope()` — classifies event_type into prematch_only / live_safe / league_specific
- `isPoolStale()` — checks expires_at (match kickoff) against now

**`generate-questions/index.ts` restructured:**
- Generation now runs in 3 phases: A) reuse ready pools (no OpenAI), B) claim + generate for uncovered matches, C) attach from pool to league
- 15 leagues following PSG vs Bayern = 1 OpenAI call + 14 pool reuses at zero AI cost
- Confirmed working: `ai_model = 'gpt-4o-mini/pool_reuse'` on reused rows, `pool_question_id` populated

**Bug fixed: `predicate-validator.ts`**
- `opens_at` window was 30 minutes — rejected all prematch questions opening days before kickoff
- Fixed to 7 days — prematch questions legitimately open well before the match

---

### 2026-04-23 — Full MVP end-to-end simulation verified

**Goal**: complete live simulation to validate all 10 MVP system checkpoints before launch.

**Test league created:**
- `MVP Sim Test League` — id `6f8cd088-24a3-4448-a0b8-071235ee99af`, sport=football, scope=full_league, api_sports_league_id=140 (La Liga), season=2025
- Two members: Richard Utis (owner) + Jordan Loove (member)
- Created via SQL directly (UI wizard not required for test setup)

**Lessons from league INSERT:** `leagues` table constraint notes for future reference:
- `description` column does not exist
- `mode` CHECK: `'individual' | 'team'` (visibility mode, not game mode)
- `type` CHECK: `'public' | 'private'` (league visibility, not type1/type2)
- `league_type` (type1/type2 distinction from CLAUDE.md) is not a DB column — inferred from other fields at runtime

**Simulation results — all 10 checkpoints passed:**

| # | Test | Result |
|---|---|---|
| 1 | Question generation | ✅ 3 questions generated from real La Liga fixture (Rayo vs Espanyol) |
| 2 | Questions appear in UI | ✅ Cards, REAL WORLD badges, HIGH VALUE badge, timers, point ranges all correct |
| 3 | Answer submission | ✅ Optimistic UI, saved to DB with clutch/streak/leader_gap captured |
| 4 | Resolver works | ✅ `resolved:9, voided:1` on first run |
| 5 | Scoring correct | ✅ `15 × 1.25 time_pressure = 19 pts`, `mvp_bypass:true` in multiplier_breakdown |
| 6 | Leaderboard updates | ✅ Richard 1st (19 pts + crown), Jordan 2nd (0 pts) |
| 7 | Rate limiting | ✅ 2nd immediate generation run → `generated:0` |
| 8 | No duplicate answers | ✅ DB unique constraint held — count=1 per question per user |
| 9 | No double scoring | ✅ 2nd resolver run → `resolved:0`, Richard still 19 pts (not 38) |
| 10 | Holding card fallback | ✅ Not shown when active questions exist (correct — only shows mid-match with no open question) |

**Resolver test method:** Inserted a synthetic question in the test league pointing to completed match `1391140` (Barcelona vs Celta Vigo, played 2026-04-22) with `answer_closes_at` and `resolves_after` set in the past. Richard answered `yes` (4 min before close → 1.25× time pressure), Jordan answered `no`. Resolver correctly scored Richard 19 pts and Jordan 0.

**Observation — active question cap:**
The MVP cap of 2 active questions is enforced via the OpenAI context prompt (`maxActiveQuestions=2`), not as a hard DB constraint. Multiple manual generation triggers within a short window produced 5 active questions across 2 matches. In production this cannot happen (6h cron + 3-min rate limiter per league prevent stacking). Not a launch risk — noted for post-launch hardening.

**Real match resolution pending:**
The 3 Rayo vs Espanyol questions (`answer_closes_at = 18:00 UTC 2026-04-23`, `resolves_after = 20:30 UTC 2026-04-23`) will auto-resolve via the hourly pg_cron job after the match ends. No manual action needed.

---

### 2026-04-23 — MVP scope lock (mid-May launch)

**Goal**: narrow the live path to what is reliable and safe for launch. No features removed. No architecture changed. Targeted bypasses and guards only.

**`resolve-questions/index.ts`** — scoring simplified for MVP:
- `difficulty_multiplier`, `comeback`, and `clutch` bypassed to `1.0` via `MVP_BYPASS` constants
- `time_pressure` and `streak` remain fully active (reliable, no extra state needed)
- All functions (`computeComebackMultiplier`, `computeTimePressureMultiplier`, etc.) preserved intact
- All DB columns (`difficulty_multiplier`, `clutch_multiplier_at_answer`, `leader_gap_at_answer`) untouched
- `multiplier_breakdown` JSONB now includes `mvp_bypass: true` flag so post-launch audit can identify MVP-era scores
- Post-launch: remove the three `_mvp` constants and use computed values — no other change needed

**`generate-questions/lib/context-builder.ts`** — active question cap reduced:
- `maxActiveQuestions` default changed from `3` → `2`
- Prompt already respects this field — no prompt change needed
- Post-launch: bump back to 3

**`generate-questions/index.ts`** — football-only guard:
- `MVP_UNSUPPORTED_SPORTS = ['hockey', 'tennis', 'other']` check added before quota check
- Non-football leagues are skipped with `skipReason: 'sport_not_supported_mvp'`
- Hockey and tennis adapters, code, and docs untouched
- Post-launch: remove sports from the list as each is verified end-to-end

**`create-league.html`** — sport selector:
- Hockey, Tennis, Other options marked `disabled hidden` with "(coming soon)" label
- Football remains the only selectable option
- HTML options preserved in source — re-enable by removing `disabled hidden` attributes

**What was preserved untouched:**
- Full scoring formula and all multiplier logic
- All DB columns from migrations 006, 007, 008
- Hockey and tennis adapters (`sports-adapter/hockey.ts`, `tennis.ts`)
- Pool system and generation profile
- Timing model (visible_from, answer_closes_at, resolves_after)
- Type 2 season league logic
- All UI pages and features

**What is intentionally not implemented for MVP:**
- Type 1 session pacing (question budget, chaining) — existing Type 2-style generation used for MVP
- Event queue system — no queue, max 2 active is the safety valve
- Advanced collision detection
- Comeback / clutch / difficulty multipliers (bypassed, not removed)
- Realtime subscription (polling at 5s active / 15s idle is reliable enough)
- Tennis sequence engine
- Hockey expansion

**Launch risks remaining:**
- No Realtime subscription — polling adds 5–15s latency for new question delivery
- Type 1 single-match session pacing not implemented — users experience continuous generation, not a structured session arc
- `GNews API key` not yet added — news context missing from generation (degrades gracefully)
- Stripe not wired — tier forced to Elite for all users

---

### 2026-04-23 — league.html UI/UX upgrade (presentation layer only — no backend changes)

**`league.html`** — full 8-task UI/UX overhaul. CSS and JS only. No DB schema, pipeline, resolver, or scoring changes.

**New CSS added (before `</style>`):**
- Three-lane question type labels: `.qt-label`, `.qt-live` (red dot + coral), `.qt-prematch` (lime), `.qt-realworld` (purple)
- Primary card treatment for first active question: `.question-card.primary-card` — larger padding, bigger text + buttons
- Real World purple card: `.question-card.rw-card` — purple border + gradient background; `.rw-source` italic sub-label
- Timer progress bar: `.timer-bar-wrap`, `.timer-bar-fill`, `.timer-bar-wrap.urgent` + `@keyframes pulse-bar` — red + pulse when < 10s
- Multiplier breakdown tags: `.multiplier-tags`, `.mult-tag`, `.mult-tag.active` (lime)
- Enhanced holding card tip box: `.holding-tip`
- Match context strip: `.match-context-strip` + `.mcs-live`, `.mcs-live-dot`, `.mcs-idle`, `.mcs-sep`, `.mcs-sport`, `.mcs-min`
- Leaderboard float notification: `.lb-float-notif` (fixed bottom-right, slides up on `.show`)
- Micro-interactions: `.question-option:active` scale 0.97×; `@keyframes glow-correct`, `@keyframes shake-wrong`; `.question-card.glow-correct`, `.question-card.shake-wrong`

**New HTML:**
- `<div id="match-context-strip">` — injected above `#questions-feed` inside Questions tab panel
- `<div id="lb-float-notif">` — fixed overlay element before `<!-- Toast -->`

**New JS global state:**
- `prevMyAnswers` — snapshot of previous poll's answer state; used to detect newly-resolved correct answers
- `tickTimer` — handle for 1s setInterval that drives smooth countdown + progress bar updates

**New JS functions:**
- `detectLane(q)` — returns `'LIVE'` / `'REAL_WORLD'` / `'PREMATCH'` from `event_type` + `source_badge` (no DB column required)
- `getQuestionTypeBadge(q)` — returns lane label HTML with appropriate `qt-*` class
- `renderTimerBar(q)` — returns progress bar HTML with `data-closes-at` + `data-total-ms` for 1s tick updates
- `tickTimers()` — 1s tick: updates all `.timer-tick` text + `.timer-bar-fill` widths from data attributes (no DB calls)
- `startTimerTick()` / `stopTimerTick()` — manage the 1s interval alongside polling
- `showLbNotif(pts)` — shows `+X pts · Correct answer` float notification with 3.5s auto-dismiss
- `updateMatchContextStrip(qs)` — populates context strip with live indicator, sport name, latest match minute
- `renderHoldingCard(qs)` — now accepts `qs` param; shows resolved count + rotating tip from 5-item `HOLDING_TIPS` array

**Modified JS functions:**
- `renderQuestionCard(q, isPrimary)` — new `isPrimary` parameter; uses `detectLane()` + `getQuestionTypeBadge()`; adds `.primary-card` / `.rw-card` classes; `data-qid` attribute on card; `data-closes-at` on timer text; calls `renderTimerBar()`; renders `multiplier_breakdown` JSONB as tag row when resolved; adds `rw-source` sub-label for Real World cards
- `loadAndRenderQuestions()` — captures `prevSnapshot` before updating `prevMyAnswers`; detects newly-correct answers → `showLbNotif()`; passes `isPrimary=true` to first active question; calls `renderHoldingCard(qs)` with qs; calls `updateMatchContextStrip(qs)`; triggers `startTimerTick()` / `stopTimerTick()` alongside polling; post-render micro-animation loop applies `glow-correct` / `shake-wrong` to newly-resolved cards via `data-qid`
- `player_answers` SELECT expanded to include `multiplier_breakdown`

**No backend changes.** No DB schema modifications. No pipeline or resolver changes. No new Supabase queries added.

---

### 2026-04-23 — Prompt v1.7 + generation profile fix (scope in pool key)

**`openai-client.ts` — GENERATION_SYSTEM_PROMPT updated to v1.7:**
- Rewrote prompt to cleaner, more structured format — shorter, easier for model to parse
- Added explicit `DIFFICULTY MULTIPLIER` table (standard 1.0, close game 1.2, underdog 1.5, player_specific 1.15)
- Added `EVENT OVERRIDE (CRITICAL)` section: if `last_event_type ≠ none` → MUST generate event-driven, overrides pool limits and diversity
- Added `ACTIVE CONTROL + QUEUE` section: event-driven at limit → generate as queued (max 3, TTL 90s); time-driven at limit → skip
- Phase-specific answer windows: early +4–6 min, mid +3–5 min, late +2–4 min (replaces flat 2–5 min)
- Removed verbose quality examples block
- `PROMPT_VERSION` bumped to `v1.7`
- **Result: 0 rejections** on first test run (down from ~35% at v1.5)

**`pool-manager.ts` — generation profile now includes scope:**
- `PoolCacheKey` extended with `scope: 'full_league' | 'team_specific'` and `scopedTeamId: string | null`
- `buildCacheKey()` derives scope and scoped_team_id from league config
- `getOrClaimPool()` insert includes new fields; fetch query filters on scope + scoped_team_id (with `.is(null)` for full_league to handle Postgres NULL uniqueness correctly)
- `findReadyPools()` filters on scope + scoped_team_id the same way
- **Fix**: team-scoped leagues no longer accidentally reuse pools generated for full-league contexts (and vice versa)

**New migration: `008_pool_generation_profile.sql`**
- Adds `scope text CHECK (IN ('full_league','team_specific'))` and `scoped_team_id text` to `match_question_pool`
- Drops the old UNIQUE constraint (programmatically, handles auto-generated constraint names)
- Creates two partial UNIQUE indexes:
  - `match_question_pool_profile_full_idx` — for full_league (WHERE scoped_team_id IS NULL)
  - `match_question_pool_profile_scoped_idx` — for team_specific (WHERE scoped_team_id IS NOT NULL)
- Backfills existing rows to `scope = 'full_league'`
- **Run this in Supabase SQL editor before next generation run**

---

### 2026-04-23 — Prompt v1.6: timing context, trigger type, predicate hardening + visible_from bug fix

**`openai-client.ts` — GENERATION_SYSTEM_PROMPT updated to v1.6:**
- Added `MATCH TIMING CONTEXT` section: instructs OpenAI to set `match_minute_at_generation = match_minute` (used for clutch multiplier downstream)
- Added `GENERATION TRIGGER TYPE` section: maps generation_mode to `generation_trigger` — `live_event` → `event_driven`, `live_gap` → `time_driven`, `prematch` → `prematch_only`
- Renamed `current_time` → `now_timestamp` throughout prompt (matching context-builder output)
- Added "DO NOT override" to `BASE VALUE RULE` — prevents OpenAI from inventing non-standard base values
- `generation_trigger` in OUTPUT FORMAT updated to include `"prematch_only"` as a valid value
- `PROMPT_VERSION` bumped to `v1.6`

**`context-builder.ts`:**
- `current_time` label renamed to `now_timestamp` in the context block (matches v1.6 prompt expectation)
- `buildPredicatePrompt()` — added `CRITICAL RULES` block before the schema:
  - Rule 1: winner/draw questions MUST use Shape A (match_outcome), never match_stat
  - Rule 2: player_stat ALWAYS requires match_id — never omit it
  - Rule 3: only use entity IDs from the provided reference list
  - Shape A description annotated with example winner question types to avoid ambiguity

**`types.ts`:**
- `RawGeneratedQuestion.generation_trigger` type extended to `'event_driven' | 'time_driven' | 'prematch_only'`

**`pool-manager.ts` — bug fix: `visible_from` and `answer_closes_at` null in questions table:**
- `attachPoolQuestionsToLeague()` was not writing `visible_from` or `answer_closes_at` when inserting from pool to `questions`
- Fix: added `visible_from: pq.opensAt` and `answer_closes_at: pq.deadline` to the insert payload
- `opens_at = visible_from` and `deadline = answer_closes_at` at generation time, so no schema change needed
- Verified: DB now shows correct timestamps for all newly generated questions

**Results after deploy:**
- `visible_from` and `answer_closes_at` confirmed populated in DB ✓
- Rejection rate dropped from ~35% to ~25% (winner predicate fix working)
- Timing chain verified: opens now → closes at kickoff → resolves at kickoff + sport buffer
- Known remaining issue: OpenAI assigns `high_value_event` (base 20) to some total-goals questions that should be `medium_stat` (base 10) — prompt clarity improvement needed in a future prompt version

---

### 2026-04-22 — Prompt v1.2: structured generation with categories + difficulty

**New system prompt (`GENERATION_SYSTEM_PROMPT` in `openai-client.ts`):**
- Explicit generation modes: `prematch` (exactly 5 questions), `live_event` (1–2), `live_gap` (exactly 1)
- Question categories with hard priority: `high_value_event` > `outcome_state` > `player_specific` > `medium_stat` > `low_value_filler`
- OpenAI now returns new fields per question: `question_category`, `question_type`, `difficulty_multiplier` (1.0–1.5), `reusable_scope`, `reasoning_short`, `predicate_hint`
- `PROMPT_VERSION` bumped to `v1.2`

**`context-builder.ts` restructured:**
- Replaced verbose section-based format with concise match-first structured block
- Now outputs: `sport`, `league_type`, `generation_mode`, `match_id`, `home_team/away_team with IDs`, `kickoff`, live fields (null for prematch), `question_budget_remaining`
- Entity reference block lists all match + team IDs OpenAI must use in `predicate_hint`
- Removed 6 old section builder functions (buildLeagueContext, buildUpcomingMatches, etc.) — replaced by single `buildContextPacket`

**`types.ts` — `RawGeneratedQuestion` extended:**
- New v1.2 fields: `question_category`, `question_type`, `difficulty_multiplier`, `reusable_scope`, `reasoning_short`, `predicate_hint`
- Older fields (`match_id`, `team_ids`, `player_ids`, `event_type`, `opens_at`, `deadline`, `resolves_after`, `resolution_rule_text`, `narrative_context`) are now computed by the system after generation
- `ValidatedQuestion` gains: `base_value?`, `difficulty_multiplier?`, `reuse_scope?`

**`index.ts` — system computes fields after generation:**
- `event_type`: mapped from `question_category` (`high_value_event` → `goal`, etc.)
- `narrative_context`: from `reasoning_short`
- `resolution_rule_text`: from `predicate_hint` (also used as input to Call 2)
- `match_id`: backfilled from predicate if set, else defaults to first match in context
- `team_ids`: derived from matched match's homeTeam + awayTeam
- `opens_at` = now, `deadline` = kickoff of match
- `base_value`: mapped from `question_category` (20/15/12/10/6)
- `difficulty_multiplier` + `reuse_scope` passed through from OpenAI output directly

**Result:** First v1.2 run — 3 questions generated, 4 rejected. `base_value` and `difficulty_multiplier` now populated from OpenAI at generation time.

---

### 2026-04-22 — AI generation live + sync-teams + full team data

**API keys activated:**
- `OPENAI_API_KEY` + `API_SPORTS_KEY` added to Supabase Secrets — AI question generation now active
- `GNEWS_API_KEY` not yet added — news adapter degrades gracefully (adds narrative context, not required)

**New Edge Function: `supabase/functions/sync-teams/index.ts`**
- Fetches all teams for every active competition from API-Sports and upserts into `sports_teams`
- Supports football + hockey; tennis skipped (not yet supported)
- Idempotent — safe to re-run anytime (e.g. after adding new competitions or for season updates)
- Deployed with `--no-verify-jwt`; invoke with: `curl -X POST .../functions/v1/sync-teams -H "Authorization: Bearer spontix-cron-x7k2m9"`
- **335 teams synced**: PL (20), La Liga (20), Bundesliga (18), Serie A (20), Ligue 1 (18), UCL (82), UEL (77), NHL (32), FIFA World Cup 2026 (48)

**New competition added:**
- FIFA World Cup 2026 inserted into `sports_competitions` (sport=football, api_league_id=1, api_season=2026, display_order=8)

**Bug fixed in `generate-questions/index.ts`:**
- `writeLeagueResult()` used `.catch()` on a Supabase query builder (not a full Promise — `.catch` is not a function)
- Fixed: replaced with `const { error } = await sb.from(...).insert(...)` + `if (error) console.warn(...)`

**First successful generation run:**
- 2 leagues processed (LaLiga Legends 24/25, UCL Knockout Crew), 0 skipped, 6 generated, 1 rejected
- Sample questions: "Will Harry Kane score against PSG?", "Will Lamine Yamal score against Celta Vigo?", "Will PSG win against Bayern München?"
- Known issue: near-duplicate questions occasionally pass dedup (Lamine Yamal goal question appeared twice with 1-second deadline difference) — dedup logic compares question text but misses rephrased near-duplicates

**Test league fix:**
- Both seed leagues had `league_end_date` in the past (2025-05-31) — updated to 2026-06-30 to match current active seasons

---

### 2026-04-20 — Full backend deployment: all migrations run + Edge Functions live

**Migrations completed (all 6 run in Supabase SQL editor):**
- 001 → 002 → 003 → 004 → 005 → 006 all successful
- pg_cron jobs active: `generate-questions-every-6h` (job 2) + `resolve-questions-every-hour` (job 3)
- All 5 notification triggers live: member_joined, question_new, question_resolved, trophy_awarded, badge_earned
- All scoring columns confirmed in DB: visible_from, answer_closes_at, base_value, difficulty_multiplier, match_minute_at_generation on questions; streak_at_answer, leader_gap_at_answer, clutch_multiplier_at_answer, multiplier_breakdown on player_answers

**Edge Functions deployed:**
- `generate-questions` — deployed with `--no-verify-jwt`, fires every 6h automatically
- `resolve-questions` — deployed with `--no-verify-jwt`, fires every hour, smoke test returned `{"ok":true,"resolved":0,"voided":0,"skipped":0}` ✅
- `CRON_SECRET = spontix-cron-x7k2m9` set in Supabase Secrets
- Supabase CLI v2.90.0 installed via Homebrew

**AI generation status:** LIVE — `OPENAI_API_KEY` + `API_SPORTS_KEY` active in Supabase Secrets. Fires every 6h via pg_cron. First run confirmed: 6 real questions generated from UCL and La Liga fixtures. `GNEWS_API_KEY` not yet added (news adapter degrades gracefully without it — adds narrative context but is not required).

---

### 2026-04-20 — Live engine v2 in league.html + migration 006 scoring columns

**New migration: `006_scoring_columns.sql`**
- `questions` table: adds `visible_from timestamptz`, `answer_closes_at timestamptz`, `base_value integer` (CHECK: 6/10/12/15/20, default 6), `difficulty_multiplier numeric` (default 1.0), `match_minute_at_generation integer`
- `player_answers` table: adds `streak_at_answer integer`, `leader_gap_at_answer integer` (default 0), `clutch_multiplier_at_answer numeric`, `multiplier_breakdown jsonb`
- RLS updated: `pa_insert_self` now uses `coalesce(answer_closes_at, deadline) > now()` as the authoritative open-window check; `pa_update_answer` added (allows answer change while window open)
- `event_type` CHECK constraint expanded to include granular live event types: `goal`, `penalty`, `red_card`, `yellow_card`, `corner`, `shot`, `hockey_goal`, `major_penalty`, `minor_penalty`, `power_play`, `break_of_serve`, `hold_of_serve`, `set_won`, `tie_break`, `match_point`, `time_window`, `stat_threshold`, `clean_sheet`, `equaliser`, `next_scorer`

**`league.html` — live engine rewrite:**

*Question state machine (replaces `isOpen = deadline > now()` with correct 5-state model):*
- `getVisibleFrom(q)` — prefers `visible_from`, falls back to `opens_at`
- `getAnswerClosesAt(q)` — prefers `answer_closes_at`, falls back to `deadline`
- `questionState(q)` → `upcoming | active | closed | resolved | voided`
- `isOpen(q)` / `isPendingResolution(q)` built on state machine

*Polling:*
- `startPolling(intervalMs)` — 5000ms while active questions exist, 15000ms when idle
- `stopPolling()` — clears interval; called when no questions loaded
- Polling starts on initial load; rate adapts to question state automatically

*Holding card:*
- `renderHoldingCard()` — shown at top of feed when no active question but questions exist
- Lime pulsing dot + "Next moment dropping soon" message

*Engagement badges (shown on active questions only):*
- `HIGH VALUE` — `base_value >= 20` or high-value `event_type` (goal, penalty, red card)
- `CLUTCH` — `match_minute_at_generation >= 70`
- `FAST` — less than 3 minutes remaining on `answer_closes_at`

*Point range display:*
- Shown in question footer alongside the timer
- `getPointRange(q)` — min (1.0× all multipliers) to max (1.5× time × 1.3× streak × 1.3× comeback) using `base_value`, `difficulty_multiplier`, `getClutchMultiplier()`
- Falls back to event_type inference if `base_value` not set (pre-migration compatibility)

*Answer submission (`handleAnswer`):*
- Client-side active window check before submitting (shows helpful message if window just closed)
- Captures `clutch_multiplier_at_answer` from `match_minute_at_generation` at submission time
- Captures `streak_at_answer` via `computeCurrentStreak()` (DB query: last 4 resolved answers)
- `leader_gap_at_answer` computed via `computeLeaderGap()` (aggregates resolved correct answers in the league) — ~~was deferred/hardcoded 0~~, now real value as of 2026-04-20 scoring update
- Schema-safe: scoring columns only included in payload if non-null (guards against pre-migration DB)
- DB constraint error (23514) shows "Answer window just closed" instead of generic error

*Dynamic league activity card:*
- Replaces hardcoded static Barcelona 2-1 Real Madrid live match widget
- Shows: LIVE dot (if active questions), Active / Awaiting / Resolved counts, total question count
- Updated on every `loadAndRenderQuestions` call

*Question SELECT updated:* includes `visible_from`, `answer_closes_at`, `base_value`, `difficulty_multiplier`, `match_minute_at_generation` alongside existing columns.

*Sort order:* active (soonest expiry first) → closed → resolved → voided → upcoming

---

### 2026-04-17 — Resolver Edge Function + player_answers + league.html fully dynamic

**New DB table (migration 004):**
- `player_answers` — records each user's answer to each question. `is_correct` + `points_earned` filled by resolver. Unique constraint `(question_id, user_id)`. RLS: own answers + league-member visibility; insert only while question is open (`answer_closes_at > now()`, falling back to `deadline > now()` for legacy questions); scoring updates by service role only.

**pg_cron schedule (migration 004):** `resolve-questions-every-hour` at `0 * * * *` — calls `/functions/v1/resolve-questions` with the same `CRON_SECRET`.

**New Edge Function (`supabase/functions/resolve-questions/`):**
- `index.ts` — processes up to 30 pending questions per run; caches API stats by `sport:matchId`; void/skip/resolve logic; calls `markCorrectAnswers()` for each resolved question. ~~10 base points placeholder~~ → replaced by full formula (see 2026-04-20 scoring entry)
- `lib/predicate-evaluator.ts` — `evaluatePredicate(pred, stats, options)` dispatches to per-type handlers: `evalMatchOutcome`, `evalMatchStat`, `evalPlayerStat`, `evalMultipleChoiceMap`. `applyOperator()` handles eq/gt/gte/lt/lte with String() eq for team IDs. Field map: `total_goals`, `total_cards`, `total_corners`, `shots_total`, etc.
- `lib/stats-fetcher/football.ts` — parallel fetch of fixtures + statistics + (optional) players endpoints; normalised to `MatchStats`; clean sheet computed from goalkeeper minutes + goals against
- `lib/stats-fetcher/hockey.ts` — single `/games?id=` call; `isDraw` always false (OT/SO); player stats return empty (free tier limitation)
- `lib/stats-fetcher/index.ts` — `fetchMatchStats()` routes by sport; `needsPlayerStats()` helper

**`league.html` — fully dynamic (replaces all static content):**
- **CSS added:** `.question-type.real-world` (lime badge), `.feed-loading`, `.feed-empty`, `.q-awaiting`, `.q-voided`, `.question-card.resolved-correct/wrong/voided`, `.q-stats`
- **`#panel-questions`** — replaced ~100 lines of static cards with `<div id="questions-feed">` loaded from `questions` table
- **`#panel-leaderboard`** — replaced ~180 lines of static podium + table with `<div id="leaderboard-container">` lazy-loaded on first tab open
- **`.members-card`** — replaced 8 hardcoded rows with `<div id="members-list">` + dynamic `id="members-card-title"`
- **Script (~340 lines):** `hydrateLeaguePage()`, `loadAndRenderQuestions()`, `renderQuestionCard()`, `renderOptions()`, `handleAnswer()` (optimistic UI + Supabase upsert), `loadAndRenderMembers()`, `loadLeaderboard()` (lazy, aggregates points from `player_answers`), `escHtml()`, `escAttr()` (XSS safety), `copyInviteCode()`

---

### 2026-04-23 — Three-lane question system architecture locked

**CANONICAL PRODUCT DEFINITION.** All questions in Spontix now belong to exactly one of three lanes. This naming is mandatory across all code, pipelines, logs, database fields, and documentation.

**Three lanes defined:**
- `CORE_MATCH_PREMATCH` — pre-match questions tied to a specific match, based on sports data. NOT premium-only.
- `CORE_MATCH_LIVE` — live in-match questions with time windows, highest priority lane. NOT premium-only.
- `REAL_WORLD` — premium intelligence layer based on real-world news/transfers/injuries. Tier-gated. Must never replace or crowd out core match questions.

**Critical product rule locked:** Spontix is a Core Match Questions product. REAL_WORLD is a premium add-on. This relationship must never be reversed.

**Feed priority order:** CORE_MATCH_LIVE > CORE_MATCH_PREMATCH > REAL_WORLD.

**`question_type` ENUM values locked.** Old terms like `"ai_generated"`, `"event_driven"`, `"time_driven"`, `"prematch"`, `"live"` are internal generation descriptors and must not be used as `question_type` values.

**Pipeline separation mandated:** each lane has its own generation pipeline (triggers, rules, validation). Pipelines must not be merged.

**REAL_WORLD MVP constraints:** max 1 per league per day, skip if signal is weak, tier-gated.

**CLAUDE.md updated:** new `QUESTION SYSTEM ARCHITECTURE — CANONICAL DEFINITION` section added after the Protected Systems block. MVP scope live questions section updated to reference lane names. Core identity statement updated.

---

### 2026-04-23 — Save Match feature + layout fixes

**New migration: `009_saved_matches.sql`**
- `saved_matches` table — player and venue saves of football fixtures. `venue_id = null` = player save; `venue_id` set = venue save. Unique `(user_id, match_id)`. RLS: own rows only (select/insert/delete). Two indexes: per-user by kickoff, per-venue by kickoff.
- **Run this in Supabase SQL editor** before the Save Match feature will persist to DB.

**`spontix-store.js` — three new async methods:**
- `SpontixStoreAsync.saveMatch(data)` — inserts row; treats `23505` unique conflict as `alreadySaved: true`
- `SpontixStoreAsync.unsaveMatch(matchId)` — deletes by user + matchId
- `SpontixStoreAsync.getSavedMatches(opts)` — fetches all saved matches for current user; `opts.venueId` filters to venue saves. All three have localStorage fallback under `'spontix_saved_matches'` key.

**`matches.html` — Browse Matches rewrite:**
- Real football fixtures loaded from `questions` table (by `match_id` + `team_ids`); functional competition + date filters
- Save button (bookmark icon) per card — two-state (saved/unsaved); pre-loads saved state into `savedMatchIds` Set on init
- Post-save inline CTA: player sees "Invite players" (→ `create-league.html?prefill_match=1&...`); venue sees "Create event" (→ `venue-create-event.html?prefill_match=1&...`)
- Role detection via `document.body.dataset.userRole` set from `SpontixStore.Session.getCurrentUser().role`

**`upcoming.html` — player schedule updated:**
- `getSavedMatches()` called after loading league matches; deduplicates (league entry takes precedence over saved-only)
- Saved-only entries shown with lime bookmark badge + `data-league-id="saved"` + click to `matches.html`
- "⭐ Saved" filter chip appended when saved-only entries exist
- All three early-exit paths (no memberships, no football leagues, no questions) now call `renderSavedOnly()` instead of showing empty state

**`venue-schedule.html` — week grid updated:**
- `loadVenueSavedMatches()` — async, looks up owner's venue, calls `getSavedMatches({ venueId })`, stores in `savedMatchItems`, re-renders grid
- `renderWeekGrid()` — modified to group saved matches by date alongside regular events; saved cards styled `.sched-item.type-saved` (lime left-border, `Match` tag); clicking navigates to `matches.html`
- Day header event count includes saved matches

**`create-league.html` — URL param prefill:**
- `readPrefill()` function — reads `?prefill_match=1&home=...&away=...&api_league_id=...&kickoff=...`; sets league name (`"Home vs Away — Match Night"`), start/end dates from kickoff, and selects matching competition from the loaded `<select>` by `api_league_id`
- `DOMContentLoaded` made `async`; `await onSportChange()` before `readPrefill()` so competition options are present when prefill tries to select one
- Zero changes to submission logic

**Layout fixes:**
- `profile.html` — removed `max-width: 900px` from `.content`, replaced with `width: 100%`
- `leaderboard.html` — removed `max-width: 1000px` from `.content`, replaced with `width: 100%`
- Both pages now fill the full available width alongside the sidebar

---

### 2026-04-23 — Pre-launch alignment: question_type column + naming collision fix + source_badge correction

**Goal**: close the four highest-priority gaps between CLAUDE.md and the codebase before launch. No architecture changes. No new features. Minimal targeted fixes only.

**New migration: `010_question_type_column.sql`**
- Adds `question_type TEXT CHECK (IN ('CORE_MATCH_PREMATCH','CORE_MATCH_LIVE','REAL_WORLD'))` to `questions` table
- Backfills existing rows using the same heuristic as `detectLane()`: `match_minute_at_generation IS NOT NULL` → CORE_MATCH_LIVE, `match_id IS NOT NULL` → CORE_MATCH_PREMATCH, else → REAL_WORLD
- Creates `idx_questions_question_type` index
- ✅ **Run in Supabase SQL editor — DONE 2026-04-23**

**Naming collision fix — `question_subtype` in `RawGeneratedQuestion` (types.ts + openai-client.ts):**
- `RawGeneratedQuestion.question_type` (short label: "match_winner", "total_goals") renamed → `question_subtype`
- Eliminates collision with the new canonical `question_type` lane column (CORE_MATCH_PREMATCH / CORE_MATCH_LIVE / REAL_WORLD)
- `openai-client.ts` OUTPUT FORMAT prompt updated: `"question_type"` → `"question_subtype"` so OpenAI returns the correct field name
- `ValidatedQuestion` in `types.ts` updated: `question_type` field added (lane), `source_badge` type relaxed from `'Real World'` literal to `string`
- The short label was not persisted to the DB — no migration needed for this rename

**`source_badge` fix — `generate-questions/index.ts` + `pool-manager.ts`:**
- Both files previously hardcoded `source_badge: 'Real World'` on every AI question regardless of lane
- Fixed: `computeLane()` helper added to both files (mirrors `detectLane()` logic in league.html)
- `LANE_SOURCE_BADGE` map: `CORE_MATCH_LIVE → 'LIVE'`, `CORE_MATCH_PREMATCH → 'PRE-MATCH'`, `REAL_WORLD → 'REAL WORLD'`
- `source_badge` is now set from the lane at generation time — UI labels will be correct
- `question_type` (lane) now also written to each inserted question row

**`pool-manager.ts` — `PoolQuestion` type updated:**
- Added `matchMinuteAtGeneration: number | null` to `PoolQuestion` interface and `mapRow()` — required so `computeLane()` can read it when attaching pool questions to leagues

**`league.html` — `question_type` added to SELECT:**
- `question_type` and `match_id` added to the Supabase column list in `loadAndRenderQuestions()`
- `detectLane()` already checked `q.question_type` first (from prior session) — now that field will be populated from the DB after migration 010 runs, eliminating the heuristic fallback for all new questions

**`quota-checker.ts` — comment updated:**
- Stale "until the question_type column migration lands" note replaced with accurate description of the two-layer guard (canonical column + `match_minute_at_generation` proxy)

**What was NOT changed:**
- Resolver logic — untouched
- Scoring formula — untouched
- Pool system structure — untouched
- Cron schedule — untouched
- Any page other than league.html — untouched
- Architecture — unchanged

---

### 2026-04-23 — Beta access flow: waitlist page + beta unlock gate

**Goal**: make `index.html` the public entry point. Users must enter a beta password before accessing login or registration. All beta users automatically get full Elite access.

**`index.html` — replaced with waitlist/beta-access page:**
- Dark navy background, Spontix branding, Inter font — consistent with the rest of the app
- "Private Beta" badge + hero headline + product description
- Waitlist form (email input + "Join Waitlist" button) — stores submitted emails in `localStorage` under `spontix_waitlist`; no backend required for MVP
- Divider: "Already have access?"
- "Enter Beta Version" button → opens password modal
- Password modal: enter `spontyx15` → `localStorage.setItem('spontix_beta_access', 'granted')` → redirect to `login.html`
- Wrong password → inline error, input cleared, stays on page
- If beta flag already set on page load → skip immediately to `login.html`
- ESC key closes modal; clicking outside modal closes it

**`login.html` — beta guard added:**
- Synchronous IIFE at top of `<script>` block, runs before any auth code
- `if (localStorage.getItem('spontix_beta_access') !== 'granted') window.location.replace('index.html')`
- Covers both login and registration — both tabs are inside `login.html`

**Elite tier:** unchanged — `authGate()` in `spontix-store.js` already forces `elite` / `venue-elite` for all authenticated users globally. All beta users automatically have full access. No additional change needed.

**Post-login redirect:** unchanged — already implemented in `login.html` (queries `public.users.role` → routes venue-owner to `venue-dashboard.html`, everyone else to `dashboard.html`).

**Post-registration redirect:** unchanged — already implemented in `login.html` (uses `selectedRole` at signup time → same routing logic).

**Protection chain:**
- Direct URL to any app page → `authGate()` → `login.html` → beta guard → `index.html`
- Direct URL to `login.html` without beta flag → `index.html`
- Beta password entered → `login.html` → auth → correct dashboard

**Beta password:** `spontyx15`
**Beta flag key:** `spontix_beta_access`
**Beta flag value:** `granted`

---

### 2026-04-23 — Beta gate hardened: session-scoped flag + back button fix + GitHub/Vercel setup

**Goal**: fix two UX issues with the beta gate — the flag was permanent (localStorage) so once entered it never asked again, and clicking back from login.html bounced back to login in an infinite loop.

**Beta flag moved from `localStorage` → `sessionStorage`:**
- Flag now clears when the browser session ends (tab/window closed)
- Entering the password but not logging in → next visit requires password again
- Logged-in users bypass the password entirely (Supabase session checked first)
- Logging out clears the flag immediately (no leftover access)

**`waitlist.html` changes:**
- On load: async check — if Supabase session exists → redirect to correct dashboard (venue-owner → `venue-dashboard.html`, else `dashboard.html`). No other auto-redirect.
- If beta flag is set but not logged in: stay on page, change button label to "→ Go to Login" (no password re-entry needed within same session)
- "Enter Beta Version" button: if flag already set → go straight to `login.html`; if not → open password modal
- `submitBetaPassword()`: stores flag in `sessionStorage` (was `localStorage`)

**`login.html` changes:**
- Beta guard IIFE changed from `localStorage` → `sessionStorage` check
- Sends to `waitlist.html` (not `index.html`) if flag missing

**`spontix-store.js` — `logout()` changes:**
- Added `sessionStorage.removeItem('spontix_beta_access')` — clears beta flag on logout
- Redirect target changed from `login.html` → `waitlist.html` (skips the redirect chain)

**Full access flow after these changes:**

| Scenario | Result |
|---|---|
| New visit, not logged in | Waitlist page — must enter password |
| Enter password, don't log in, close browser | Next visit → waitlist page again |
| Enter password, navigate back from login | Waitlist page stays; button says "→ Go to Login" |
| Logged in, refresh any page | Goes to correct dashboard |
| Log out | Flag cleared → redirected to waitlist |

**GitHub + Vercel setup (completed this session):**
- GitHub repo created: `https://github.com/combatdefenderweprotect-oss/Spontyx` (private)
- Local repo initialized, all files committed and pushed
- GitHub CLI (`gh`) installed via Homebrew and authenticated
- Vercel project connected to GitHub repo — auto-deploys on every `git push`
- Standard deploy command going forward: `git add -A && git commit -m "message" && git push`

**Note for future sessions:** if a user reports being stuck in a login redirect loop, ask them to clear `spontix_beta_access` from localStorage in browser DevTools (Application → Local Storage). This is a stale entry from the old `localStorage`-based implementation.

---

### 2026-04-24 — Waitlist page UI fixes

**S logo / content positioning:**
- S logo (`spontyx-icon.svg`) moved inside `.hero` div as normal page content — no longer fixed. Sits above "Coming Soon" badge and scrolls with the page.
- Logo size increased to 160×160px
- Top padding reduced: desktop `60px`, mobile `20px` (via `@media (max-width: 768px)`)
- Social proof strip (3 feature bullets) removed
- `overflow-x: hidden` removed from `body` — was breaking `position: fixed` on iOS Safari
- `display: flex` moved from `body` → `.page-wrap` wrapper div — was breaking `position: fixed` on iOS Safari. Fixed elements (logo, orbs) are now siblings of `.scroll-container`, not inside it.
- `.scroll-container` added: `height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch` — scrolling happens here, not on body. This is the bulletproof pattern for keeping `position: fixed` reliable across all browsers.

**Spontyx wordmark (top left):**
- Text logo (`Spontyx` + lime dot) replaced with `spontyx-logo.svg` (SVG brand asset, transparent background)
- New file: `spontyx-logo.svg` — copy of `spontyx_clash_pack/spontyx_primary_navy.svg` with the navy `<rect>` background removed
- CSS updated: `.logo` simplified to `position: fixed; top: 16px; left: 24px` + `img { height: 44px }`

---

### 2026-04-24 — Login page fixes

**Logo:**
- Text logo replaced with `spontyx-logo.svg` (same as waitlist page)
- `.logo` CSS simplified to `position: absolute; top: 20px; left: 24px` + `img { height: 40px }`

**Mobile overlap fix:**
- Body `padding` changed from `24px` → `80px 24px 24px` so the card doesn't overlap the logo on small screens

**Duplicate email error:**
- Supabase raw error message replaced with friendly copy: "An account with this email already exists. Try signing in instead."
- Also catches password-too-short errors with friendly message

---

### 2026-04-24 — Role-based access control

**Problem:** any logged-in user could navigate directly to any page regardless of role. New venue owners saw Richard's cached "Arena Bar and Grill" venue data.

**Root cause:** `authGate()` only checked for a Supabase session — never checked the user's role.

**Fix 1 — Store role in session (`spontix-store.js`):**
- `hydrateSessionFromSupabase()` now includes `role` in the `spontix_session` object written to localStorage
- `sessionObj` = `{ userId, venueId, role }`

**Fix 2 — Role-based routing in `authGate()` (`spontix-store.js`):**
- `waitlist.html` added to `publicPages` list
- Stale demo session clear now resets `existingSession` to null so the role check below it works correctly
- Players on any `venue-*.html` page → redirected to `dashboard.html`
- Venue owners on `dashboard.html` → redirected to `venue-dashboard.html`

**Fix 3 — New venue owner guard (`venue-dashboard.html`):**
- Async IIFE runs on load: queries Supabase for venues owned by current user
- If no venues found → redirect to `venue-register.html`
- Prevents new venue owners from seeing cached venue data (e.g. Richard's Arena Bar and Grill)

**Access control matrix (post-fix):**

| User | Tries to access | Result |
|---|---|---|
| Player | `venue-*.html` | → `dashboard.html` |
| Venue owner | `dashboard.html` | → `venue-dashboard.html` |
| Venue owner (no venue) | `venue-dashboard.html` | → `venue-register.html` |
| Not logged in | Any protected page | → `login.html` |

**One-email-per-account:** Supabase Auth enforces this at the DB level. No two accounts can share an email. The friendly error message in `login.html` surfaces this clearly to the user.

---

### 2026-04-24 — Username system + dashboard name fix

**New migration: `011_username_constraints.sql`**
- Strips `@` prefix from all existing `handle` values in `public.users`
- Adds `idx_users_handle_ci` — case-insensitive unique index on `lower(handle) WHERE handle IS NOT NULL`
- Updates `handle_new_user` trigger: reads `first_name` + `last_name` from metadata to build `name`; reads `username` from metadata as handle (no `@` prefix); venue-owners get `NULL` handle (no username field in their signup)

**`login.html` — sign-up form:**
- "Your name" field replaced with First name + Last name (side by side)
- Username field added for players: real-time format validation + debounced availability check against DB; hidden for venue-owners
- Format rules enforced: lowercase letters, numbers, underscores, 3–20 characters, unique (case-insensitive)
- Metadata passed to Supabase: `{ name, first_name, last_name, role, username }` (username omitted for venues)

**`login.html` — sign-in:**
- Input changed from `type="email"` to `type="text"`, label updated to "Email or username"
- If input has no `@` → queries `public.users WHERE handle = lower(input)` to get email, then signs in with email + password
- Venue owners have NULL handle so username login naturally only works for players

**`profile.html` — settings:**
- Username field wired with real-time format validation + uniqueness check (excludes current user's own handle via `.neq('id', uid)`)
- `saveProfileSettings()` validates format and blocks save if handle is taken
- Handle stored without `@` prefix; `_handleOriginal` tracks baseline to skip self-check

**`spontix-store.js`:**
- `_mapUserFromDb` updated: handle stored/returned without `@` prefix (`row.handle.replace(/^@/, '')`)
- `_mapUserToDb` already stripped `@` — unchanged

**`dashboard.html`:**
- Welcome message uses `handle` (username) instead of `name`: "Welcome back, richutis"
- Both sync (`hydrateFromStore`) and async (`applyRealProfile`) paths strip legacy `@` prefix
- Profile card still shows full name; handle shown below it without `@`

**Account deletion — two places to delete (IMPORTANT):**
- Deleting a row from `public.users` (Table Editor) does NOT revoke login ability. That table is only the profile mirror.
- To fully remove an account: delete from **Authentication → Users** in the Supabase dashboard. That removes the auth record and invalidates credentials.
- Deleting only from `public.users` leaves the auth record intact — `signInWithPassword` will still succeed.

**Auth gate — server-side validation (fixed 2026-04-24):**
- `authGate()` in `spontix-store.js` now runs a two-phase check: (1) fast localStorage pre-check to block users with no token at all, then (2) `supabase.auth.getUser()` on page load which hits the Supabase API and detects deleted/invalid accounts.
- `getSession()` and the old localStorage string-check both read only from local storage — neither can detect a deleted account. `getUser()` always makes an API call.
- If `getUser()` returns an error: all `sb-*` localStorage keys, `spontix_session`, and `spontix_beta_access` (sessionStorage) are cleared and the user is redirected to `waitlist.html`.
- Network failures in the `getUser()` call are silently ignored — a dropped connection will not log the user out.

---

### 2026-04-24 — Auth gate hardened: server-side account validation

**Root cause identified:** `authGate()` was checking only for the presence of a Supabase token string in localStorage — it never called the Supabase API. The Supabase JS SDK silently refreshes JWTs in the background using the refresh token, so a deleted account with a cached token remained "logged in" indefinitely. `getSession()` has the same flaw — it reads from localStorage, not from the server.

**`spontix-store.js` — `authGate()` updated:**
- Fast pre-check retained: if no `sb-*` token in localStorage at all → redirect immediately (avoids flash of content)
- New server-side validation on `window load`: calls `window.sb.auth.getUser()` which always hits the Supabase API
- If `getUser()` returns an error or no user: clears all `sb-*` localStorage keys + `spontix_session` + `sessionStorage.spontix_beta_access`, redirects to `waitlist.html`
- Network failures caught and ignored — offline users are not logged out

**Key distinction documented:**
- `public.users` (Table Editor) = profile mirror only. Deleting here does nothing to login ability.
- `Authentication → Users` (Supabase dashboard) = actual auth record. Must delete here to revoke credentials.
- Deleting only from `public.users` leaves `signInWithPassword` working — confirmed in testing.

---

### 2026-04-24 — Live & Activity page + Dashboard fully dynamic

**`activity.html` — all placeholder content replaced with real Supabase data:**
- All three hardcoded sections (Live Now, Unanswered Questions, summary cards) now load from DB
- `loadActivityData()` — async function using `window.sb`; queries `league_members → questions → player_answers → sports_teams` in sequence
- **Live Now** — groups open questions by `match_id`; looks up team names from `sports_teams` by `api_team_id`; shows live dot, match minute, active question count, links to `league.html?id=...`
- **Unanswered Questions** — filters open questions not yet answered by the current user; shows live vs pre-match icon, question text, league name, countdown timer with critical/warning/ok colouring
- **Summary cards** — Live Matches, Unanswered, Answered Today all show real counts
- **Styled empty states** — both sections show a card with icon + title + sub-text when empty (not just grey text)
- **Section header icons** — wrapped in `.section-icon` pill with coral/orange backgrounds, consistent with summary card icons
- **`--orange: #FF9F43`** defined in page `<style>` block — was missing from `styles.css`, causing all orange icons to render transparent
- **Flex layout fix** — removed redundant `.live-matches` wrapper div; `#live-matches-container` and `#unanswered-container` now have the flex+gap layout directly

**`dashboard.html` — alert banner and nav cards connected to real data:**
- Hardcoded "4 unanswered questions / Barcelona vs Real Madrid" alert replaced with `<div id="activity-alert">` populated by `loadActivityAlert()`
- `loadActivityAlert()` — same Supabase query pattern as activity.html; runs on every page load
- **Alert states**: coral pulsing banner (unanswered questions exist) or lime "You're all caught up" banner (all clear); falls back to all-clear on any error
- League breakdown in alert sub-text: "LaLiga Legends (2) · UCL Knockout (1)" — real league names + counts
- Fixed broken CSS rule `.unanswered-alert-` (was a dangling selector with no properties)
- **Nav cards updated from real data** via `updateNavCards()` — piggybacks on `loadActivityAlert()` data, no extra round trips except one `saved_matches` count:
  - **Your Games** — "X live" badge shows real open question count, hidden when 0; sub-text shows "X open questions waiting" or "No open questions right now"
  - **Schedule** — sub-text shows real count of saved matches with `kickoff_at` in next 7 days ("X saved matches coming up this week" or "No saved matches this week")
  - **My Leagues** — badge shows real league membership count, hidden when 0; sub-text shows "X active leagues" or "Join a league to get started"
  - **Battle Royale** — static (no real-time data to connect)
- All early-return paths (no leagues, no open questions, all answered) still call `updateNavCards()` with appropriate counts before returning

---

### 2026-04-25 — Tier system v2: limited live for Starter, daily RW cap, -1 unlimited convention

**Goal:** controlled monetization upgrade across 5 tasks — no architecture changes, no gameplay logic changes.

**Task 1 — Starter now has LIMITED live access (not locked out)**

`spontix-store.js` — Starter tier updated:
- `liveQuestionsEnabled: false` → `true` — Starter users CAN see and answer LIVE questions
- `liveQuestionsMode: 'limited'` added — new key distinguishing limited (Starter) from full (Pro/Elite)
- `liveQuestionsPerMatch: 3` unchanged
- Pro and Elite: `liveQuestionsMode: 'full'` added

`create-league.html` — live mode creation gate updated:
- Was `!!limits.liveQuestionsEnabled` (now always true → broken)
- Now `limits.liveQuestionsEnabled && limits.liveQuestionsMode !== 'limited'`
- Starter still cannot CREATE a live-mode league; they can only participate in one

`league.html` — UI enforcement upgraded:
- `getLiveQuotaState(q)` — new helper: returns `{ limit, used, exhausted }` for LIVE questions on limited tiers; returns null for non-LIVE or unlimited tiers
- `renderOptions()` — buttons are now visually disabled (`.disabled-opt`) when live quota is exhausted and user hasn't answered yet; upgrade modal still fires on submit
- Footer of active LIVE cards shows "Live answers: X / 3" for Starter; turns coral + shows "Upgrade" link when exhausted

**Task 2 — REAL_WORLD daily cap enforced (MVP safety rule)**

`quota-checker.ts` — `checkRealWorldQuota()` updated:
- New Step 1 (runs before tier check): counts `REAL_WORLD` questions for this league created today (UTC midnight boundary)
- If count >= 1 → `{ allowed: false, skipReason: 'real_world_daily_cap' }`
- Applies to ALL tiers including elite — this is the MVP safety rule, not a tier rule
- Step 2 (tier check) unchanged: starter blocked, pro monthly cap 10, elite unlimited
- Wiring in `generate-questions/index.ts` unchanged — already calls `checkRealWorldQuota()` and filters accordingly

**Task 3 — Venue Starter AI preview (already implemented, isFinite fixed)**

`venue-live-floor.html` — `isFinite(_aiPreviewLimit)` replaced with `_aiPreviewLimit !== -1` (2 occurrences)

**Task 4 — Lane priority in question feed (already implemented)**

`league.html` — `lanePriority` sort within active questions already enforced LIVE > PREMATCH > REAL_WORLD. No change needed.

**Task 5 — -1 replaces Infinity as the "unlimited" sentinel**

All `Infinity` values in `TIER_LIMITS` replaced with `-1`. All limit checks updated:

| Old pattern | New pattern |
|---|---|
| `isFinite(limit)` | `limit !== -1` |
| `limit !== Infinity` | `limit !== -1` |
| `limit === Infinity` | `limit === -1` |

Files updated: `spontix-store.js` (TIER_LIMITS + 3 code checks), `league.html`, `create-league.html`, `my-leagues.html`, `venue-create-event.html`, `venue-live-floor.html`, `venue-dashboard.html`, `trivia.html`, `battle-royale.html`

**`docs/TIER_ARCHITECTURE.md` updated:**
- Feature Gate Matrix: `liveQuestionsMode` row added, `-1` values shown
- Implementation Notes: new `liveQuestionsEnabled + liveQuestionsMode` section, new `-1 means unlimited` section
- Enforcement Status: `liveQuestionsPerMatch` entry updated to describe UI disable + indicator

---

### 2026-04-25 — Tier enforcement hardened: all limits now Supabase-backed

**Goal:** eliminate all localStorage-based tier limit bypasses. Every meaningful limit is now checked against live Supabase data before the action is allowed.

**`spontix-store.js` — `SpontixStoreAsync.joinLeague()` rewritten:**
- Fetches `max_members` from `leagues` alongside `type` and `join_password`
- Counts current `league_members` from Supabase before inserting → returns `{ ok: false, error: 'league-full' }` if at capacity
- Counts all `league_members WHERE user_id = uid` from Supabase → returns `{ ok: false, error: 'join-limit-reached' }` if user is at their `leaguesJoinMax` tier limit
- `TIER_LIMITS` extended: `aiWeeklyQuota` key added to all 3 player tiers (Starter: 2, Pro: 5, Elite: 10) — eliminates hardcoded ternaries in `create-league.html`

**`discover.html` — both join paths handle new error codes:**
- `league-full` → toast message (both direct join and password modal)
- `join-limit-reached` → upgrade modal (both direct join and password modal)
- Neither error falls back to `SpontixStore.joinLeague()` — localStorage bypass removed

**`create-league.html` — `leaguesCreatePerWeek` now Supabase-backed:**
- `launchLeague()` queries `SELECT count(*) FROM leagues WHERE owner_id = uid AND created_at > 7 days ago` before creating
- Falls back to localStorage count only when Supabase unavailable (offline)

**`my-leagues.html` — Create button now Supabase-backed:**
- `applyLeagueTierGating()` converted to `async`
- Same Supabase count query as `launchLeague()` — button lock and creation gate are now consistent

**`league.html` — `liveQuestionsPerMatch` no longer uses localStorage:**
- Counter replaced with in-memory count: filters `currentQuestions` (already loaded) to LIVE questions for the current match, checks against `myAnswers` (already loaded) to see how many the user has answered
- `spontix_live_count_{userId}_{matchRef}` localStorage key removed entirely — not bypassable by clearing storage

**`venue-create-event.html` — event quota fixed:**
- `eventsPerWeek` (legacy alias) replaced with `eventsPerMonth` (canonical key)
- Count window changed from rolling 7 days → calendar month start (consistent with the limit semantics)

**`profile.html` — trophy CTA hardcoded check replaced:**
- `player.tier === 'elite'` replaced with `SpontixStore.getTierLimits(tier).customTrophyCreation`

**`venue-dashboard.html` — tier UI now dynamic:**
- `applyVenueTierUI()` reads all values via `SpontixStore.getTierLimits(tier)` — no hardcoded tier strings
- Shows event quota used this month, Analytics "Pro" lock badge, Live Floor "Preview" badge for Venue Starter

**`docs/TIER_ARCHITECTURE.md` updated:**
- Enforcement Status section reorganised: new "Supabase-backed" category for limits moved off localStorage
- `aiWeeklyQuota` added to Feature Gate Matrix and documented in Implementation Notes
- All enforcement statuses reflect current state accurately

**Enforcement status after this change:**

| Limit | Before | After |
|---|---|---|
| `leagueMaxPlayers` | Frontend-only (localStorage leagues cache) | ✅ Supabase count in `joinLeague()` |
| `leaguesJoinMax` | Not enforced (hint text only) | ✅ Supabase count in `joinLeague()` |
| `leaguesCreatePerWeek` | Frontend-only (localStorage leagues cache) | ✅ Supabase count in `launchLeague()` + `applyLeagueTierGating()` |
| `liveQuestionsPerMatch` | localStorage counter (clearable) | ✅ In-memory count from `currentQuestions` + `myAnswers` |
| `eventsPerMonth` | Wrong key (`eventsPerWeek`), 7-day window | ✅ Correct key, calendar-month window |
| `customTrophyCreation` | `tier === 'elite'` hardcoded | ✅ `getTierLimits().customTrophyCreation` |

---

### 2026-04-27 — Match Live quick-create button

**Goal:** one-click path from any fixture card in Browse Matches or My Schedule directly into the Match Night league creation wizard with sport, competition, and match auto-filled.

**`matches.html`:**
- Added coral "Match Live" button to every fixture card alongside the existing Save and Invite buttons
- Uses `_matchStore` data-store pattern: `_matchStore[m.matchId] = m` during render; button uses `data-match-key="${matchId}"` in onclick — avoids JSON in HTML attributes (which breaks on double quotes in team names)
- `createMatchLive(key)` builds URL params: `league_type=match`, `home`, `away`, `kickoff`, `api_league_id` (= `m.compId`), `comp_name` (= `m.compName`), `match_id`
- Added `.btn-match-live` CSS (coral pill)

**`upcoming.html`:**
- Same "Match Live" button added to every match card (both league matches and saved-only matches)
- Uses `_inviteStore` data-store pattern (already existed)
- `createMatchLive(key)` same URL params: `comp_name` comes from `m.competitionName`
- For league matches: `apiLeagueId` comes from `leagueMap[q.league_id].api_sports_league_id` — may be empty for older leagues (handled in create-league.html)
- For saved matches: `apiLeagueId` comes from `s.api_league_id` stored at save time

**`create-league.html` — `readPrefill()` rewritten for `league_type=match`:**
- Reads `home`, `away`, `kickoff`, `match_id`, `api_league_id`, `comp_name` from URL params
- Selects Match Night type card programmatically
- Jumps to Step 1, fills league name: `"Home vs Away — Match Night"`
- **Constructs `selectedCompetition` directly from URL params** (no DB query):
  `{ api_league_id: parseInt(apiLeagueId), name: compName, sport: 'football', season: kickoffYear }`
- **Constructs `selectedMatch` directly from URL params** (no DB query):
  `{ match_id, homeTeamName: home, awayTeamName: away, visible_from: kickoff }`
- Populates competition and match dropdowns with single pre-selected options built from URL data
- User only needs to pick a question mode (Prematch / Live / Hybrid) before clicking Next

**Architecture principle confirmed:**
- Browser never calls external APIs (API-Sports, OpenAI, GNews) — all API keys are Edge Function secrets only
- Fixture data flow: API-Sports → `generate-questions` Edge Function → `api_football_fixtures` (Supabase DB) → matches.html / upcoming.html → URL params → create-league.html
- `create-league.html` reads only from Supabase (competitions, fixtures tables) in the normal wizard path. In the Match Live path, it reads zero DB tables — all data travels via URL

---

### 2026-04-27 — Tier system v2: BR/trivia 3-way gate + all limits Supabase-backed

**`battle-royale.html` — Elite fair-use cooldown:**
- Added cooldown reset to victory screen handler: when `id === 'victory'` and `limits.battleRoyaleFairUse` is true, sets `spontix_br_cooldown` localStorage key to `Date.now() + 20000` (20s cooldown after completing a game, vs 30s set at game start)

**`trivia.html` — full 3-way tier gate:**
- Replaced single daily-check `startGame()` with 3-way logic:
  - Starter: daily counter keyed `spontix_trivia_day_YYYY-MM-DD`
  - Pro: monthly counter keyed `spontix_trivia_month_YYYY-MM`
  - Elite: fair-use cooldown via `spontix_trivia_cooldown` timestamp
- Added cooldown reset to `goScreen('screen-results')`: sets `spontix_trivia_cooldown` to `Date.now() + 20000`
- Updated upgrade modal benefits text: "100 trivia games per month" for Pro
- Monthly cap: 100 games/month for Pro (matches `TIER_LIMITS.triaMonthlyLimit`)

**`docs/TIER_ARCHITECTURE.md` — full rewrite to v3:**
- Pro monthly caps documented: 50 BR/month, 100 trivia/month (was listed as "unlimited" — corrected)
- Elite fair-use model documented with mandatory UX wording rules (neutral language: "Preparing your next match…")
- 3-way gate code pattern documented with exact localStorage key names
- `-1 = unlimited` sentinel convention documented (replaces `Infinity`)
- Feature Gate Matrix updated with `liveQuestionsMode`, `aiWeeklyQuota` rows
- Enforcement Status section reorganised: Supabase-backed vs localStorage-backed limits clearly separated

**`profile.html` — Pro plan card updated:**
- "Unlimited BR games" → "50 Battle Royale / month"
- "Unlimited trivia" → "100 trivia games / month · Solo + 1v1"
- Elite card: "Unlimited BR & trivia · all modes incl. Party"

**`spontix-store.js` — `joinLeague()` fully Supabase-backed:**
- Fetches `max_members` from `leagues` table before inserting
- Counts current `league_members` from Supabase → `{ error: 'league-full' }` if at capacity
- Counts all leagues the user belongs to from Supabase → `{ error: 'join-limit-reached' }` if at `leaguesJoinMax` tier limit
- `TIER_LIMITS` extended: `aiWeeklyQuota` added to all 3 player tiers (Starter: 2, Pro: 5, Elite: 10)

**`create-league.html` — `leaguesCreatePerWeek` Supabase-backed:**
- `launchLeague()` queries `leagues WHERE owner_id = uid AND created_at > 7 days ago` before creating
- Falls back to localStorage count only when Supabase unavailable

**`my-leagues.html` — Create button Supabase-backed:**
- `applyLeagueTierGating()` converted to async with same Supabase count query

**`league.html` — `liveQuestionsPerMatch` localStorage bypass removed:**
- Counter replaced with in-memory count from `currentQuestions` + `myAnswers` (already loaded)
- `spontix_live_count_{userId}_{matchRef}` localStorage key eliminated

**`-1 replaces Infinity` — files updated:**
`spontix-store.js`, `league.html`, `create-league.html`, `my-leagues.html`, `venue-create-event.html`, `venue-live-floor.html`, `venue-dashboard.html`, `trivia.html`, `battle-royale.html`

---

### 2026-04-27 — Discover leagues fetches from Supabase directly

**Problem:** `hydrateDiscover()` called `SpontixStore.getDiscoverLeagues()` — the sync localStorage version. Leagues created by other users wouldn't appear until the background cache refresh fired (~1.5s). On a cold load with no cache, the grid would be empty.

**`discover.html`:**
- `hydrateDiscover()` converted to `async` — now calls `SpontixStoreAsync.getDiscoverLeagues()` which hits Supabase directly
- Extracted `renderDiscoverLeagues(leagues)` as a pure render function called by both initial load and the `spontix-leagues-refreshed` background refresh
- Added "Loading leagues..." placeholder while fetching
- Added empty state message ("No leagues to discover yet — be the first to create one!") when Supabase returns zero results
- Promoted grid now filters to public leagues only
- `filterLeagues()` called automatically after render so active filters apply immediately

**Result:** any league created by any user appears in Discover the moment the page loads, with no cache dependency.

---

### 2026-04-27 — Delete league (owner) + Leave league (members)

**`league.html` — Settings tab Danger Zone:**
- Static "Archive League" / "Leave League" buttons replaced with dynamic buttons injected by `hydrateLeaguePage()` based on `owner_id === currentUserId`
- **Owner** sees: 🗑 Delete League (coral, bordered)
- **Member** sees: Leave League (grey, bordered)
- Neither button is shown until `hydrateLeaguePage()` runs and the ownership check resolves

**Confirmation modal added:**
- `<div id="danger-overlay">` — full-screen dark overlay with a centred card
- `openDangerModal(icon, title, body, onConfirm)` — reusable for both actions
- `closeDangerModal()` — dismisses; clicking outside the modal also dismisses
- `confirmDeleteLeague()` — shows league name + permanent warning → calls `SpontixStoreAsync.deleteLeague(currentLeagueId)` → toast + redirect to `my-leagues.html`
- `confirmLeaveLeague()` — shows league name + progress loss warning → calls `SpontixStoreAsync.leaveLeague(currentLeagueId)` → toast + redirect
- DB-level protection: RLS on `leagues` table enforces owner-only delete independently of the UI

---

### 2026-04-27 — My Leagues: Join a League button + tier badge price removed

**`my-leagues.html`:**
- Added `.header-btns` flex wrapper around the existing Create New League button
- Added purple **Join a League** pill button linking to `discover.html` (with person-plus SVG icon)
- Added `.join-league-btn` CSS class (purple background, white text, same pill shape as create button)

**`spontix-store.js` — `getTierLabel()`:**
- `'starter'` → `'Starter'` (was `'Starter (Free)'`)
- `'pro'` → `'Pro'` (was `'Pro ($5.99/mo)'`)
- `'elite'` → `'Elite'` (was `'Elite ($14.99/mo)'`)
- Venue tier labels unchanged (never had prices)
- Prices retained only in `sidebar.js` upgrade modal CTAs where they serve as conversion prompts

---

### 2026-04-24 — Sidebar flash fix + mobile layout fix

**Root cause of sidebar flash identified and fixed:**
- Every page loaded `sidebar.js` and called `SpontixSidebar.init()` before `spontix-store.js` was loaded. `SpontixStore.getPlayer()` returned null at init time, so the sidebar rendered empty, then flashed through multiple states as subsequent scripts loaded.
- Fixed by reordering scripts on all affected pages: `spontix-store.js` now loads before `sidebar.js` across all 24 pages. When the sidebar initialises, the player cache is already available and the correct username + photo renders immediately.

**Sidebar name overwrite fixed (3 pages):**
- `dashboard.html` `hydrateFromStore()`, `activity.html` `DOMContentLoaded`, and `profile.html` `hydrateProfile()` were each overwriting `.sidebar-profile-name` with `player.name` (full name e.g. "Richard Utis") after `sidebar.js` had already correctly rendered the handle. Removed all three sidebar overwrites — `sidebar.js` and the `spontix-profile-refreshed` event are the sole owners of the sidebar DOM.

**`defaultPlayer()` / stale data cleaned up (prior session):**
- `defaultPlayer()` changed from `{ name: 'Bran', handle: '@bran_predicts' }` to empty strings, eliminating the "Bran" flash on first load.
- `savePlayer()` now tries full save first, strips data URL only on quota error — was previously silently failing for all fields when a large base64 photo caused `localStorage.setItem` to throw.
- `getProfile()` preserves `spontix_user_tier` (forced Elite) after DB merge so `public.users.tier = 'starter'` can't overwrite it.

**Supabase Storage photo migration (prior session):**
- `backend/migrations/014_user_photos_bucket.sql` — creates `user-photos` public bucket (5MB, image types only). RLS: public read, authenticated users own `{uid}/profile.jpg`.
- `uploadPlayerPhoto()` in `spontix-store.js` now uploads to Supabase Storage and stores a CDN URL instead of a base64 data URL, fixing the localStorage quota issue that was silently blocking all profile field saves.
- Fixed `saveAvatarChoice()` in `profile.html` to build `displayPlayer` with `_avatarPick.url` directly before rendering — previously re-read from `getPlayer()` which had the URL stripped.
- Run migration 014 in Supabase SQL editor to activate the bucket.

**Mobile layout fix — content no longer overflows off-screen:**
- Every page had `.main { margin-left: 260px }` in its own inline `<style>` block, which came after `styles.css` in the cascade and silently overrode the `@media (max-width: 900px) { .main { margin-left: 0 } }` rule already in `styles.css`.
- Removed the redundant `.main` definition from 14 pages. `styles.css` now controls both desktop and mobile layout correctly.
- `matches.html` used `.content { margin-left: 260px }` with no mobile breakpoint — added `@media (max-width: 900px) { .content { margin-left: 0 } }`.
- `venue-table-map.html` had a custom `.main` (height: 100vh + overflow: hidden) — added `margin-left: 0` to its existing mobile override.

**Page navigation flash eliminated:**
- Added `<style>html{background:#1A1A2E;margin:0;padding:0}</style>` inline in `<head>` of all app pages — fires before Google Fonts and `styles.css`, guaranteeing the dark background is painted on frame zero with no white/black gap between page navigations.
- Added `<meta name="view-transition" content="same-origin">` to all pages — enables native browser cross-fade between same-origin pages in Chrome/Safari with no JavaScript required.
- Added `animation: page-enter 120ms ease` to `body` in `styles.css` for a smooth fade-in on every page load.
