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
| [docs/TRIVIA_SYSTEM.md](docs/TRIVIA_SYSTEM.md) | Trivia pillar: DB schema, modes, RPCs, XP scoring, Elo rating, UI screens (migrations 076–084) |
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
   - **Trivia** → [docs/TRIVIA_SYSTEM.md](docs/TRIVIA_SYSTEM.md)
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
- **Football is the only live sport.** The generation pipeline skips non-football leagues at runtime (`sport_not_supported`).
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
Run in order in the Supabase SQL editor: `backend/migrations/001_initial_schema.sql` through `074_drop_instantiate_br_session_v1.sql`.

### Edge Function deployment
See `supabase/functions/generate-questions/DEPLOY.md`.

---

## Resume prompt

> "Continue Spontix development. Read `CLAUDE.md` for the rules and architecture pointers. The full history is in [docs/CHANGELOG_RECENT.md](docs/CHANGELOG_RECENT.md); domain specs are in the docs map. All migrations 001–068 applied; all Edge Functions deployed (`ensure-prematch` + `generate-questions` redeployed 2026-05-06, `resolve-questions` updated 2026-05-05, `sync-fixtures` updated 2026-05-05, `custom-questions` deployed 2026-05-06, `evaluate-season-leagues` deployed 2026-05-06, `join-arena-queue` deployed 2026-05-06). Pre-match generation is event-based (league create + league.html open) with cron as backstop. Per-match PREMATCH question count is user-controlled via `prematch_questions_per_match` (1–10, default 5); pipeline fills shortfall with AI then fallback templates. Per-match LIVE question count is user-controlled via `live_questions_per_match` (1–10, default 6, migration 054); generation is slot-paced via `computePlannedSlots()` (floor(N/2) pre-HT in [10–40], ceil(N/2) post-HT in [55–85]). LIVE pipeline has two post-predicate guards before insert: (1) window overlap guard (`live_window_overlap`) — rejects overlapping `match_stat_window` ranges; (2) live quality filter (`lib/live-quality-filter.ts`) — 5 hard-reject rules + soft scoring for event-driven. Prematch quality filter is two-pass (text/category pre-filter + post-predicate strict filter with market dedup, lineup-aware player rules, heavy-favourite reject, 11 fallback markets). `league.html` has two frontend moment layers: (a) Moment Feeling Layer — flash strip + slide-in entrance + live context banner on new LIVE question arrival; (b) Result Moment Layer — tension strip for closed LIVE questions, correct/wrong in-card overlay with +pts and streak copy, smooth holding card fade-in after resolve. REAL_WORLD pipeline: two critical bugs fixed 2026-05-05; first end-to-end verification window: 2026-05-07 ~12:00 UTC (Liverpool vs Chelsea). Migration 055 (universal question config): four new columns on `leagues` — `question_style` (prematch/live/hybrid), `real_world_enabled` (BOOLEAN default true), `real_world_questions_per_week` (1–3 intensity cap), `custom_questions_enabled` (BOOLEAN, controls FAB visibility). Generator lane gating live: prematch lane skips on `question_style='live'`; live lane skips on `question_style='prematch'`; REAL_WORLD skips when `real_world_enabled=false` or `question_style='live'`. `checkRealWorldQuota()` enforces user weekly cap before platform cap. Create League Step 3 redesigned (2026-05-06): single unified multi-select Question Types section (4 cards: Pre-match, Live Pro+, Real World Pro+, Custom Questions Elite+) replaces old Question Style radio cards + Question Types chip grid. Sliders appear conditionally below cards. Hybrid card removed. Pre-Match Timing UI removed. `matchNightMode` replaced by `selectedQTypes` object. Deployed to spontyx.com. Migration 056 (league_code): `league_code TEXT UNIQUE` added to `leagues`; 6-char alphanumeric (charset excludes O/0, I/1); PL/pgSQL backfill + unique constraint + index; applied 2026-05-06. Invite step (Step 4) cleaned: placeholder users, social share buttons, and Copy Link removed; only League Code display + Copy Code button remain; client-side generation with 10-attempt retry loop on unique_violation. `spontix-store.js` maps `leagueCode` ↔ `league_code`. Migration 057 (`fixture_id BIGINT` on `leagues`, deferred FK to `api_football_fixtures`): Match Night binds to exact fixture at creation; generator filters all three passes by `fixture_id`. Migration 058 (`league_type TEXT CHECK(match_night|season_long|custom)` on `leagues`): explicit type replaces heuristic inference in context builder and generator. Migration 059 (Season Long fixture lifecycle Phase 1): `league_fixtures` table stores exact fixture scope per Season Long league (populated at creation from `slLoadedFixtures`); `leagues.fixture_count/completed_at/winner_user_id` + `league_members.final_rank/final_points` scaffold columns added (evaluator not yet live). `create-league.html`: zero-fixture guard blocks Season Long creation with no loaded fixtures; batch-inserts all `slLoadedFixtures` into `league_fixtures` after creation, updates `fixture_count`. Generator builds `leagueFixtureScopes` map before main loop; all three passes (prematch, live, REAL_WORLD) filter to scoped fixtures for season_long leagues; legacy leagues with no rows fall back to competition scope (logged). Migrations 060–063 (Phase 2a foundations): `leagues.lifecycle_status` (CHECK: active/awaiting_fixtures/pending_resolution/completed/archived, default active) + `last_completion_check_at` + `completion_deferred_reason`; `sports_competitions.current_season_end` + `season_end_synced_at`; new `team_competition_status` table (sport, api_team_id, api_league_id, season PK; status: active/eliminated/unknown; starts empty); `league_fixtures.fixture_status` + `finished_at`. `sync-fixtures` new `season_meta` mode writes `current_season_end` from API-Sports `/leagues`; `syncLive` propagates `fixture_status` to `league_fixtures` per fixture; `syncDaily` bulk-propagates terminal statuses. `season_meta` cron not yet scheduled. No evaluator logic implemented — no league is completed. Phase 2b: `evaluate-season-leagues` Edge Function implements competition-based Season Long completion evaluator. Decision tree: (1) all league_fixtures terminal? (2) current_season_end present + fresh + past today? (3) no pending questions? → finalize: final_points/final_rank on league_members, winner_user_id/completed_at/lifecycle_status='completed' on leagues. PST is not terminal. Idempotency guard on all writes. Dry run via ?dry_run=1. Path A (team) skipped. Deploy with --no-verify-jwt. Cron not yet scheduled (add daily 04:00 UTC). Migrations 064–066 + Custom Questions (2026-05-06): `custom-questions` Edge Function (create/submit_answer/resolve/void); 4th question lane `CUSTOM` (source='custom', question_type='CUSTOM'); atomic claim guard in resolve (TOCTOU-safe); `pa_select_member` hides other players' answers until resolution; `q_update_admin` restricted to source='system'; `cqe answered` events hidden from non-creator before resolution; leaderboard fixed to include negative points (`not('is_correct','is',null)` replaces `eq('is_correct',true)`). Migration 068 (Arena v1 queue): `arena_queue` table (fixture_id, phase H1/H2, mode ranked/casual, status waiting/matched/cancelled/expired, expires_at = joined + 5min); unique partial index on (user_id) WHERE status='waiting'; `pair_arena_queue()` RPC — atomic pairing with FOR UPDATE SKIP LOCKED, creates arena_session + arena_session_players; `cancel_arena_queue()` RPC. `arena_sessions` two new columns: `session_start_minute`, `arena_mode`. `join-arena-queue` Edge Function: validates auth + phase window (H1: status='1H' + minute≤25; H2: status='2H' + minute 45–65) + minimum question estimate (≥4); actions: join / cancel_queue. `multiplayer.html` fully rebuilt: 7-day schedule browser, terminal status filter, countdown strings, arena state labels, per-phase H1/H2 sections with Notify Me (localStorage) / Join Ranked + Casual / Closed states; competition filter fallback uses 'League {id}' (not 'Football') so filtering works when sports_competitions lacks the league. Next priorities: (1) Schedule evaluate-season-leagues cron (daily 04:00 UTC); (2) Season Long completion evaluator Phase 2c (Path A — team-based, needs sync-team-status job first); (3) BR end-to-end test during a live match; (4) Arena end-to-end pairing test during a live match; (5) Stripe subscriptions." Migrations 069–074 applied (BR v2 schema: segment_scope, rating_mode, pool-free RPCs, pairwise ELO). `generate-questions` + `resolve-questions` redeployed 2026-05-06 with BR v2 changes: predicate allowlist (match_stat_window goals/cards only), segment window validation, runBrLifecycle() in resolver. `br-lobby.html` segment picker live, pool creation removed. `br-session.html` uses segment_scope/rating_mode. All 5 BR RPCs verified in pg_proc; stale v1 overload dropped (migration 074). Migration 075 applied: `join_br_session(UUID)` + `leave_br_session(UUID)` SECURITY DEFINER RPCs — replace client-side INSERT into br_session_players (was blocked by RLS); leave called via fetch keepalive on pagehide. `br-lobby.html` full esports card redesign: match cards (not rows) with expand-on-click → half select → JOIN BATTLE CTA; player count as primary visual; flex-shrink:0 fix on .bf-card prevents height collapse when 100+ matches load."
