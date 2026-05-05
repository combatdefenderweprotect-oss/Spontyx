# Spontix — Project Handoff

**Spontix** is a live, real-time sports prediction & trivia gaming platform. Players predict outcomes, answer AI-generated live match questions, and compete in leagues, arenas, battle royales, and trivia. Venues host events and reward winners.

**Core identity:** Spontix is a **second-screen live sports experience**. The differentiator is AI-generated live match questions delivered in real time alongside the match. Players compete against each other inside leagues, not just against the outcome of a game.

---

## Prompt Template

For task instructions, response style, and the domain quick map, refer to: [docs/PROMPT_TEMPLATE.md](docs/PROMPT_TEMPLATE.md).

---

## Documentation Map

Authoritative specs live in `docs/`. This file holds only the high-level identity, non-negotiable rules, and pointers.

| Doc | Scope |
|---|---|
| [docs/QUESTION_SYSTEM.md](docs/QUESTION_SYSTEM.md) | Canonical 3-lane question architecture (PREMATCH / LIVE / REAL_WORLD) |
| [docs/LIVE_QUESTION_SYSTEM.md](docs/LIVE_QUESTION_SYSTEM.md) | LIVE generation rules, timing model, anchored windows, fairness |
| [docs/REAL_WORLD_QUESTION_SYSTEM.md](docs/REAL_WORLD_QUESTION_SYSTEM.md) | REAL_WORLD pipeline (4 OpenAI calls, news adapter, scraper, AI fallback resolver) |
| [docs/PREMATCH_QUALITY_ANALYTICS.md](docs/PREMATCH_QUALITY_ANALYTICS.md) | Prematch quality filter analytics + monitoring queries |
| [docs/LEAGUE_CREATION_FLOW.md](docs/LEAGUE_CREATION_FLOW.md) | Three league types: Season-Long / Match Night / Custom |
| [docs/LEAGUE_SCORING_V2.md](docs/LEAGUE_SCORING_V2.md) | League scoring V2 (flat +10/0 with optional confidence) |
| [docs/LEAGUE_COMPLETION_EVALUATOR_TODO.md](docs/LEAGUE_COMPLETION_EVALUATOR_TODO.md) | Season-Long completion evaluator backlog |
| [docs/ARENA_SESSION_SYSTEM.md](docs/ARENA_SESSION_SYSTEM.md) | Arena session lifecycle, RPCs, completion, XP, ELO, spectator |
| [docs/BR_SESSION_SYSTEM.md](docs/BR_SESSION_SYSTEM.md) | Battle Royale server-authoritative session system |
| [docs/GAMEPLAY_ARCHITECTURE.md](docs/GAMEPLAY_ARCHITECTURE.md) | Cross-cutting gameplay architecture (4 pillars, scoring, multipliers) |
| [docs/GAME_ARCHITECTURE_MAP.md](docs/GAME_ARCHITECTURE_MAP.md) | Visual map: pages, tables, RPCs per game mode |
| [docs/LEADERBOARD_ARCHITECTURE.md](docs/LEADERBOARD_ARCHITECTURE.md) | Leaderboard Phase 1 audit + filter system |
| [docs/TIER_ARCHITECTURE.md](docs/TIER_ARCHITECTURE.md) | Player + venue tiers, gates, enforcement |
| [docs/PROMPT_TEMPLATE.md](docs/PROMPT_TEMPLATE.md) | Reusable prompt template + domain quick map |
| [docs/CHANGELOG_RECENT.md](docs/CHANGELOG_RECENT.md) | Recent updates (last ~7 days) |
| [docs/CHANGELOG_ARCHIVE.md](docs/CHANGELOG_ARCHIVE.md) | Full historical update log |

---

## Context Usage Rule

Claude must NOT load the entire documentation by default. Read `CLAUDE.md` for navigation only — then load the single most relevant doc for the task.

**How to use this map:**

1. Treat `CLAUDE.md` as the high-level reference and navigation index — never as a full context dump.
2. Identify the task's domain first:
   - **Leagues / scoring** → [docs/LEAGUE_SCORING_V2.md](docs/LEAGUE_SCORING_V2.md), [docs/LEAGUE_CREATION_FLOW.md](docs/LEAGUE_CREATION_FLOW.md)
   - **Arena** → [docs/ARENA_SESSION_SYSTEM.md](docs/ARENA_SESSION_SYSTEM.md)
   - **Battle Royale** → [docs/BR_SESSION_SYSTEM.md](docs/BR_SESSION_SYSTEM.md)
   - **Question system / lanes** → [docs/QUESTION_SYSTEM.md](docs/QUESTION_SYSTEM.md)
   - **Live questions** → [docs/LIVE_QUESTION_SYSTEM.md](docs/LIVE_QUESTION_SYSTEM.md)
   - **Real World questions** → [docs/REAL_WORLD_QUESTION_SYSTEM.md](docs/REAL_WORLD_QUESTION_SYSTEM.md)
   - **Tiers / monetization** → [docs/TIER_ARCHITECTURE.md](docs/TIER_ARCHITECTURE.md)
   - **Cross-cutting / pillar overview** → [docs/GAMEPLAY_ARCHITECTURE.md](docs/GAMEPLAY_ARCHITECTURE.md)
3. Load ONLY the relevant docs. Ignore unrelated systems.
4. For history, prefer `CHANGELOG_RECENT.md`. Only open `CHANGELOG_ARCHIVE.md` when investigating something pre-2026-04-29.

**Behaviour rules:**
- Minimize token usage — don't read entire docs when a section will do.
- Don't restate `CLAUDE.md` in responses.
- Don't mix domain context (e.g. don't load BR docs for a league task).
- If a doc is needed mid-task, load it then — don't pre-load everything upfront.

---

## Non-Negotiable Rules

### Sport support
- **Football is the only live sport.** The generation pipeline skips non-football leagues at runtime (`sport_not_supported_mvp`).
- Hockey and tennis adapters exist but must not be extended until API coverage is verified end-to-end.

### Timing model — MANDATORY
Every question must have all three timestamps populated:
- `visible_from` — when the question appears in the feed
- `answer_closes_at` — authoritative answer lock (enforced at DB level via RLS)
- `resolves_after` — when the resolver evaluates the outcome (always strictly after `answer_closes_at`)

### Scoring formula — FULLY ACTIVE (Arena/BR)
```
points = base_value × time_pressure × difficulty × streak × comeback × clutch
```
All six multipliers live in `resolve-questions/index.ts`. Do not remove their functions or DB columns.

> **League scoring is V2** — flat +10/0 (Normal) or optional confidence (+15/-5 High, +20/-10 Very High). The legacy multiplier formula is bypassed for league-bound questions. See [docs/LEAGUE_SCORING_V2.md](docs/LEAGUE_SCORING_V2.md). Arena and Battle Royale UNCHANGED — they keep the full V1 formula.

### Active question cap
**Max 3 active questions per league at any time.**

### Generation rate limits
- **CORE_MATCH_LIVE**: max 1 new time-driven question per 3 minutes per league (event-driven bypasses this).
- **REAL_WORLD**: max 1 per league per day.
- **CORE_MATCH_PREMATCH**: no rate limit — governed by publish window and weekly quota.

These are independent. CORE_MATCH_LIVE rate limiting must never block REAL_WORLD or PREMATCH generation.

### Fallback rules — never show an empty live feed
1. No active question during a live match → show the holding card.
2. Generation produces zero questions → holding card, log internally, no user-facing error.
3. Resolver voids a question → remove from feed silently.
4. Any pipeline failure → degrade quietly, log, continue.

### Resolver safety — idempotency (CRITICAL)
- A question is resolved exactly once.
- Resolver fetches only `resolution_status = 'pending'` — do not weaken this filter.
- Re-running the resolver must never award points twice.
- `player_answers` scoring loop must not run if the question is already resolved.

### Answer submission safety
- One answer per user per question — enforced by `UNIQUE (question_id, user_id)` in `player_answers`.
- Answer window enforced at DB level via RLS insert policy (`answer_closes_at > now()`).
- Do not remove the unique constraint or bypass it with re-awarding upsert logic.

### Logging requirements
Log at Edge Function level (`console.log` / `console.warn`) for: generation failures, resolver failures, skipped generation reasons, pool reuse vs fresh generation. Logging is fire-and-forget.

---

## Protected Systems — do not redesign

| System | Location | Rule |
|---|---|---|
| Generation pipeline | `generate-questions/index.ts` + `lib/` | Stable and deployed — do not refactor. Accepts optional POST body `{league_id, match_id?}` for demand-driven path |
| Prematch orchestrator | `ensure-prematch/index.ts` | Thin JWT-auth wrapper around `generate-questions`. Do not embed generation logic here — keep it as orchestrator only |
| Resolver pipeline | `resolve-questions/index.ts` | Only safe targeted changes |
| Database schema | `backend/migrations/001–052` | Do not drop columns, tables, or constraints |
| Arena session completion | `complete_arena_session()` RPC | Single write path — do not add direct status writes |
| BR session round advance | `advance_br_session_round()` + `finalize_br_session()` RPCs | Server-authoritative; idempotency guard (`last_processed_seq`) must remain |
| Timing model | `visible_from`, `answer_closes_at`, `resolves_after` | Always populate all three |
| Pool system | `lib/pool-manager.ts` | Race-safe, deployed — do not redesign |
| 4-stage validator | `lib/predicate-validator.ts` | All four stages must run |

---

## High-level Architecture

### Stack
- **Frontend**: plain HTML + vanilla JS, no framework, no build step. Shared CSS in `styles.css`. Single shared data layer in `spontix-store.js`.
- **Backend**: Supabase (Postgres + Auth + Storage + Realtime). No custom server.
- **Edge Functions** (Deno TypeScript): `generate-questions`, `ensure-prematch`, `resolve-questions`, `live-stats-poller`, `sync-teams`. Triggered by pg_cron and (for `ensure-prematch`) directly by the frontend on league create / league.html open. See [docs/QUESTION_SYSTEM.md](docs/QUESTION_SYSTEM.md) "CORE_MATCH_PREMATCH triggers".
- **External APIs** (Edge Function only): API-Sports, OpenAI (gpt-4o-mini), Google News RSS, scraper microservice.

### Data flow
```
Browser (any .html page)
  → SpontixStore (sync, localStorage cache) / SpontixStoreAsync (Promises)
  → Supabase (Postgres + RLS + Auth + Realtime)
  → Edge Functions (cron-driven: question generation, resolution, live stats)
  → External APIs (API-Sports, OpenAI, news, scraper)
```

### Three league types
| Type | Lifecycle | Fixture source | Generation |
|---|---|---|---|
| **Season-Long** | Ends when fixture source is exhausted | Auto-loaded from `api_football_fixtures` | Continuous |
| **Match Night** | Ends when match resolves | Single user-picked fixture | Closed session, fixed budget |
| **Custom** | Creator-defined date range | Creator-defined | Continuous |

Canonical spec: [docs/LEAGUE_CREATION_FLOW.md](docs/LEAGUE_CREATION_FLOW.md).

### Four gameplay pillars
1. **Leagues** — long-term competition; questions tied to `league_id`. League scoring V2.
2. **Arena** — 1v1 / 2v2 sessions; questions tied to `arena_session_id`. Full V1 multiplier formula.
3. **Battle Royale** — server-authoritative survival; HP system; questions tied to `br_session_id`. Full V1 formula.
4. **Trivia** — solo / duel / party. Client-side simulation; tier-gated.

See [docs/GAMEPLAY_ARCHITECTURE.md](docs/GAMEPLAY_ARCHITECTURE.md) and [docs/GAME_ARCHITECTURE_MAP.md](docs/GAME_ARCHITECTURE_MAP.md).

### Question system
Three lanes, never mixed: `CORE_MATCH_PREMATCH`, `CORE_MATCH_LIVE`, `REAL_WORLD`. Feed priority: LIVE > PREMATCH > REAL_WORLD.

Canonical spec: [docs/QUESTION_SYSTEM.md](docs/QUESTION_SYSTEM.md).

### Tier system
3 player tiers (Starter / Pro / Elite) + 3 venue tiers (Venue Starter / Pro / Elite). All tier limits read via `SpontixStore.getTierLimits(tier)`. Never hardcode tier strings in feature checks.

Canonical spec: [docs/TIER_ARCHITECTURE.md](docs/TIER_ARCHITECTURE.md).

---

## Supabase

**Project**: `spontix-prototype` · ref `hdulhffpmuqepoqstsor` · region eu-west-2 (London) · Free tier.
**URL**: `https://hdulhffpmuqepoqstsor.supabase.co`.

Credentials in `supabase-client.js` are safe to ship to the browser — security comes from RLS.

### Edge Function secrets required
`OPENAI_API_KEY`, `API_SPORTS_KEY`, `GNEWS_API_KEY` (optional), `CRON_SECRET`, `SCRAPER_API_URL`, `SCRAPER_API_KEY`. `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` injected automatically.

### Active pg_cron jobs
- Job 2 — `generate-questions-every-6h`
- Job 3 — `resolve-questions-every-hour`
- Job 8 — `live-stats-every-minute`
- Job 9 — `br-resolve-every-minute`

---

## How to Run

```bash
cd /path/to/Spontix
python3 -m http.server 8000
# open http://localhost:8000/login.html
```

All pages except `index.html`, `waitlist.html`, and `login.html` require a Supabase auth session. Beta password: `spontyx15` (sessionStorage flag, cleared on logout).

### Migrations
Run in order in the Supabase SQL editor: `backend/migrations/001_initial_schema.sql` through `052_league_scoring_v2.sql`.

### Edge Function deployment
See `supabase/functions/generate-questions/DEPLOY.md`.

---

## Resume prompt

> "Continue Spontix development. Read `CLAUDE.md` for the rules and architecture pointers. The full history is in [docs/CHANGELOG.md](docs/CHANGELOG.md); domain specs are in the docs map. All migrations 001–052 applied; all Edge Functions deployed including `ensure-prematch` (demand-driven prematch wrapper). Pre-match generation is now event-based (fired on league create + league.html open) with the `generate-questions-every-6h` cron preserved as backstop. Next priorities: (1) Stripe subscriptions; (2) Arena push notification deep-links; (3) League Completion Evaluator."
