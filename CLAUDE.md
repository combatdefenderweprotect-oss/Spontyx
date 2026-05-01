# Spontix — Project State & Developer Handoff

Last updated 2026-05-01 — Arena in-session Question History panel live in `arena-session.html`. Floating `≡ History` pill button (fixed bottom-right, `bottom: max(18px, env(safe-area-inset-bottom))` for mobile safe areas) opens a 75vh bottom-sheet drawer. Drawer shows all past questions (closed answer window) newest-first, reusing `.as-qr-card` styles from the completion overlay. Cards display correct/wrong/missed/pending state, player's answer, correct answer, points earned, and tags (Clutch/Streak/Comeback/Hard). New-question indicator: lime `"⚡ Live question available — close to answer"` banner appears inside the open drawer when `loadQuestions()` detects an active question; button gains lime border + dot. Tapping the banner or the close button clears the indicator and restores the feed. `openHistory()`, `closeHistory()`, `renderHistory()` JS functions added. New-question hook inserted after `renderFeed()` in `loadQuestions()`. Global `historyOpen` + `historyHasNewQ` flags. Display-only — no backend, schema, or scoring changes.

Last updated 2026-05-01 — Arena completion overlay Question Results Breakdown live in `arena-session.html`. Scrollable per-question review section (`#as-qreview`) rendered inside the completion overlay by `renderQuestionReview()` after `showCompleteOverlay()` fires. Each question shows: result badge (✓ Correct / ✗ Wrong / — Missed / … Awaiting), player's answer vs correct answer (colour-coded), points earned pill, and optional tags (Clutch, Streak ×N when ≥3, Comeback when gap >20, Hard when difficulty >1.1). Questions sorted ascending by `created_at`. `player_answers` SELECT extended to include `multiplier_breakdown`, `is_clutch`, `streak_at_answer`, `leader_gap_at_answer`. Dark navy `.as-qr-card` cards with lime/coral/grey colour variants. No backend, schema, or scoring changes.

Last updated 2026-05-01 — Arena Leaderboard tab live in `leaderboard.html`. New 4th tab "Arena" (after Global/My Leagues/Friends) loads `users WHERE arena_games_played > 0 ORDER BY arena_rating DESC LIMIT 100` directly from Supabase. UI: hero banner (title + "1v1 / 2v2" badge), top-3 podium (slots ordered 2nd/1st/3rd), full ranked table with columns `#`, Player, Tier, Arena Rating, Games. `getArenaTier(rating)` maps rating → 9 tier labels + CSS classes (Rookie ≥500, Bronze ≥800, Silver ≥1100, Gold ≥1400, Platinum ≥1700, Diamond ≥1900, Master ≥2200, Grandmaster ≥2600, Legend ≥3000). Lazy-load on first tab click (`arenaLoaded` flag — no re-fetch on repeated clicks). Current user rows highlighted with `you-row` + `(You)` tag. Sticky card (`#ar-sticky-you`) slides up from bottom when current user is ranked #11 or lower. Empty state links to `multiplayer.html` with "Enter Arena" CTA. `switchView()` updated with arena branch (hides sticky card when switching away). No backend, schema, or rating changes — all data from migration 036 `arena_rating`/`arena_games_played` columns already on `users`.

Last updated 2026-05-01 — Resolver arena session safety: `resolve-questions/index.ts` now verifies arena session status before resolving any arena-session-bound question. Pre-load block runs once per batch: collects distinct `arena_session_id` values from the pending questions list, queries `arena_sessions WHERE id IN (...)` in a single round-trip, builds `arenaSessionStatusMap: Map<string, string>`. If the DB query errors, `arenaStatusLookupFailed = true` (fail-closed). Per-question guard at the top of each question's try block: if `q.arena_session_id` is set and `arenaStatusLookupFailed` → void with reason `arena_session_status_lookup_failed`; if session status ≠ `'active'` → void with reason `arena_session_not_active`. League questions (no `arena_session_id`) are completely unaffected. Deployed to `hdulhffpmuqepoqstsor`. Also includes migration 037: `increment_arena_player_score(p_session_id, p_user_id, p_points)` SECURITY DEFINER RPC — atomic `score = score + N` update on `arena_session_players`, avoiding race window from the JS client; also increments `correct_answers`. GRANT to `authenticated` + `service_role`. All migrations 001–037 applied ✅.

Last updated 2026-04-30 — Arena UI polish: Streak, Comeback, and Clutch display all live in `arena-session.html`. Streak badge + streak notif show current correct-answer run in the scoreboard and on answer. Comeback badge + scoreboard line + popup notif read live arena scores from `players[]` and show ×1.1/×1.2/×1.3 multiplier tiers (gaps 21–50/51–100/100+). Clutch badge now mirrors the backend `isClutchAnswer()` definition exactly: LIVE questions only, half-scope-aware minute window (first_half ≥ 35, else ≥ 80), competitive signal from `clutch_context.homeScore/awayScore` (gap ≤ 1) or arena score gap (≤ 20, only when both players present) — missing data hides safely. `clutch_context` added to `loadQuestions()` SELECT. All three are display-only with no backend, schema, or scoring changes.

Last updated 2026-04-30 — Phase 3: Arena Rating ELO live ✅. Migration 036 applied. `update_arena_ratings(p_session_id UUID)` SECURITY DEFINER RPC: ELO formula with K-factor tiers (K=32 <10 games, K=24 10–29, K=20 ≥30), 2v2 team average, rating floor 500, repeat-opponent rolling-24h penalty (×0.5 before clamp, minimum ±1 on non-zero delta), strict player-count validation (invalid 2v2 = `invalid_match:true`, no fallback), idempotency via `arena_rating_before IS NOT NULL`. `arena_session_players` gains `arena_rating_before/after/delta` snapshot columns. `users` gains `arena_rating` (DEFAULT 500), `arena_games_played`, `arena_rating_updated_at`. Leaderboard index on `(arena_rating DESC) WHERE arena_games_played > 0`. `arena-session.html` `showCompleteOverlay()` calls `update_arena_ratings()` in `Promise.all` with `award_xp()`; shows colored `±N SR` delta pill. 9 visual tiers (Rookie → Legend) with CSS classes rendered on `profile.html` header and `dashboard.html` profile preview card. `spontix-store.js` `_mapUserFromDb()` maps `arena_rating` + `arena_games_played`. All migrations 001–037 applied ✅.

Last updated 2026-04-30 — Phase 2: Global XP system live ✅. Migration 035 applied. `arena-session.html` `showCompleteOverlay()` now authoritative on `winner_user_id` (falls back to score comparison only when null); calls `award_xp()` RPC at session end (win=50XP, draw=25XP, loss=15XP, `source_id=sessionId` for idempotency); shows `+N XP` pill in the score card. `spontix-store.js` `_mapUserFromDb()` now maps `total_xp` and `level` through to the JS profile object. XP bar + level badge added to `dashboard.html` (profile preview card) and `profile.html` (profile header) — hidden until `total_xp` is non-null, formula mirrors the DB `get_level_number()` function in JS (XP to advance level N = floor(100 × N^1.5)). All async profile refresh paths wired.

Last updated 2026-04-30 — Arena Session system Phase 1 (migrations 033 + 034): `arena_sessions` + `arena_session_players` tables; dual FK on `questions` (league_id OR arena_session_id, CHECK constraint); `leagues.session_type` (`league|solo_match`); dual-path player_answers RLS (PATH A: league member, PATH B: arena participant); both tables in Realtime publication. `generate-questions/index.ts`: `live_only=1` URL param, `solo_match` REAL_WORLD guard, full arena session live generation loop (mirrors league live but writes `arena_session_id`). `live-stats-poller/index.ts`: fires `generate-questions?live_only=1` after each fixture upsert (fire-and-forget). `multiplayer.html`: `createArenaSession()` replaces `createLeagueFromLobby()` — inserts arena_sessions + arena_session_players + updates lobby.arena_session_id, redirects to `arena-session.html?id=`. New `arena-session.html`: 1,035-line gameplay page, questions filtered by arena_session_id, answers submitted with arena_session_id (no league_id), three Realtime channels, complete overlay with per-player handles. `arena-session.html` fix: `loadPlayers()` joins `users(handle, name)` so opponent handles display correctly in scoreboard and complete overlay. Migration 033 bug fixed: removed dead `UPDATE game_history SET game_mode = game_type` backfill (game_type column does not exist). Migrations 033 + 034 applied ✅. Both Edge Functions redeployed ✅.

Last updated 2026-04-30 — Clutch Answer system (migration 032): Clutch = correct answer to CORE_MATCH_LIVE question where (1) match is in clutch window (minute ≥ 35 for first_half, ≥ 80 for full_match/second_half) AND (2) match is competitive (goal diff ≤ 1 OR leader_gap ≤ 20 pts). New migration 032 adds: `clutch_context JSONB` on `questions` (snapshot: minute + score at generation), `is_clutch BOOLEAN` on `player_answers`, `clutch_answers INTEGER` counter on `users`, `player_xp_events` table (XP audit trail), and `increment_clutch_answers()` SECURITY DEFINER RPC. `generate-questions/index.ts`: live question insert now writes `clutch_context` from `liveCtx.matchMinute/homeScore/awayScore`. `resolve-questions/lib/clutch-detector.ts`: new `isClutchAnswer()` helper — pure function, no DB calls. `resolve-questions/index.ts`: `markCorrectAnswers()` now calls `isClutchAnswer()`, writes `is_clutch` to `player_answers`, and calls `awardClutchXp()` for clutch answers (+15 XP, counter increment, milestone log at 1/10/50/100). The existing `clutch_multiplier_at_answer` (1.0×/1.25×) scoring factor is untouched — this system adds XP only, no second score multiplier. ⚠️ Run migration 032 in Supabase SQL editor then redeploy both Edge Functions.

Last updated 2026-04-30 — Multiplayer sport filter: `multiplayer.html` match toolbar now has a Sport dropdown before the Competition dropdown. Selecting a sport cascades the competition dropdown to show only competitions for that sport. `onSportFilterChange()` rebuilds competition options from `allMatches` filtered by selected sport; `applyFilters()` checks sport before competition. Each match object now includes `sport` field from `compById[league_id].sport` (loaded from `sports_competitions`). State: `filterSport = 'all'`.

Last updated 2026-04-30 — Multiplayer match card interest signals: live activity signals added to each match card in `multiplayer.html`. Priority logic: 👥 Ready (lime) → ⚡ Trending (teal) → 🔥 N in queue (coral) → nothing. Ready = any lobby 1 player away from full. Trending = 5+ joins in last 2 min (configurable `TRENDING_THRESHOLD`). Queue = 2+ total players waiting. Never shows zero/empty states. `loadQueueCounts()` extended with second lightweight query on `match_lobby_players` for trending data; `readyMap` computed from per-lobby `player_count` vs mode capacity. `getMatchSignal(matchId)` helper enforces priority order. CSS variants `.match-signal.ready/.trending/.queue`. Migration 031 adds denormalized `player_count` to `match_lobbies` with a DB trigger on `match_lobby_players` INSERT/DELETE — eliminates per-player row fetches, scales to any number of players.

Last updated 2026-04-30 — Multiplayer arena redesign: `multiplayer.html` fully rewritten (761 → 1741 lines). Full-screen desktop layout (no max-width cap), 3-step arena flow. Step 1: 1v1 vs 2v2 format cards with large watermarks + glow selection state. Step 2: full-width two-column split — match browser (left, with search/competition filter/sort toggle) + config panel (right, with half-scope cards + per-half queue count breakdown + 2v2 team options). Step 3: fixed-position waiting room overlay with 4 pulsing concentric lime rings, player vs opponent avatars (searching-pulse → found-pop animations), invite link section for 2v2 share-link mode. Queue count system: denormalized `player_count` on `match_lobbies` (migration 031 trigger) aggregated into `queueMap[matchId][halfScope][mode]`. Supabase Realtime subscriptions on `match_lobbies` and `match_lobby_players` keep queue counts live. Direct lobby join via `?join=<lobbyId>`. Migration 030 creates `match_lobbies` + `match_lobby_players` tables (must be run before page works). SpontixStoreAsync lobby methods (`findOrJoinLobby`, `joinLobbyById`, `createLeagueFromLobby`) are inline stubs in the page — functional for MVP, to be promoted to spontix-store.js later.

Last updated 2026-04-29 — play_mode (singleplayer / multiplayer) added to leagues: migration 029 adds `play_mode TEXT NOT NULL DEFAULT 'multiplayer' CHECK (play_mode IN ('singleplayer', 'multiplayer'))` to `leagues`. play_mode is INDEPENDENT of subscription tier — all TIER_LIMITS (liveQuestionsPerMatch, realWorldQuestionsEnabled, leaguesCreatePerWeek, etc.) apply identically in both modes. `spontix-store.js`: `_mapLeagueFromDb` maps `play_mode → playMode`, `_mapLeagueToDb` maps back. `create-league.html`: new Play Experience selector (Multiplayer / Solo cards) with `selectSessionType()` function — Solo locks player slider to 1, hides Team Mode section, enforces `max_members=1` in `launchLeague()`. `applyRealWorldTierGating()` shows Pro+ badge and blocks AI Real World toggle for Starter in both modes. `applySingleplayerLiveCapNotice()` shows coral cap notice when Solo + live/hybrid + Starter. Review step shows "Solo (1 player)" or "Multiplayer". `league.html`: `hydrateLeaguePage()` detects `isSolo`, sets `statMode` to 'Solo', adds Solo tag to meta strip, hides invite card for singleplayer leagues. `docs/TIER_ARCHITECTURE.md` updated to v7 with full "Play Mode vs Subscription Tier" section. Migrations 028 (Realtime publication) and 029 (play_mode column) both applied ✅.

Last updated 2026-04-29 — Realtime subscription replacing polling in league.html: Supabase Realtime channel (`league-{id}`) subscribes to `questions` INSERT/UPDATE/DELETE and `player_answers` UPDATE for the current league. New questions appear instantly (sub-second) instead of waiting up to 15s. Resolved cards flip in real-time when the resolver awards points. Polling downgraded to 30s heartbeat when Realtime is connected (catches reconnect gaps). Falls back to 5s/15s polling if channel errors. Tab visibility handling: pauses channel when hidden, resumes + refreshes on return. `beforeunload` cleanup. Migration 028 enables Realtime publication for both tables — **run `028_enable_realtime.sql` in Supabase SQL editor**.

Last updated 2026-04-29 — Scraper enrichment integrated into REAL_WORLD pipeline: new `enrichArticlesWithScraper()` in generate-questions index.ts calls the Railway scraper service on up to 5 top-ranked candidate articles per league before Call 1. Attaches `extracted_context` (800 chars of full article body) to each enriched NewsItem. `EnrichedNewsItem` type added to types.ts. `generateRealWorldQuestion()` signature updated to accept EnrichedNewsItem[]; Call 1 prompt STEP 0 updated to prefer extracted_context over RSS summary. Falls back gracefully when scraper is unconfigured or fails. 4 log events. Env vars: SCRAPER_API_URL + SCRAPER_API_KEY (add to Supabase Edge Function secrets). `docs/REAL_WORLD_QUESTION_SYSTEM.md` updated with Article Enrichment Layer section. generate-questions redeployed.

Last updated 2026-04-29 — spontix-scraper-service: lightweight Node.js 20 + Express + Playwright Chromium + Mozilla Readability microservice built and deployed to Railway. Accepts a URL via POST /scrape, renders the page headlessly, and returns clean article content (title, source, published_at, extracted_text up to 3,000 chars). Auth via x-scraper-key header. Rate limited to 20 req/min. Docker non-root pattern (PLAYWRIGHT_BROWSERS_PATH=/ms-playwright + chmod -R o+rx + appuser). GitHub repo: combatdefenderweprotect-oss/spontyx-scraper-service. Railway URL: https://spontyx-scraper-service-production.up.railway.app. Both /health and /scrape verified live.

Last updated 2026-04-29 — REAL_WORLD AI-assisted fallback resolution: new `lib/ai-verifier.ts` in resolve-questions uses OpenAI Responses API + web_search_preview as a last resort for manual_review and match_lineup questions. FORBIDDEN for player_stat/match_stat/btts (official API only). Resolution rules: high confidence → resolve; medium + ≥2 sources → resolve; low/unresolvable → allow auto-void. `resolution_source = 'ai_web_verification'` when AI resolves. 4 log events. Also: bounded REAL_WORLD retry loop (MAX_RW_RETRIES=3) in generate-questions with ranked news batches, weakCandidate pattern, buildRwQuestion() helper. resolve-questions redeployed.

Last updated 2026-04-29 — REAL_WORLD match binding: all REAL_WORLD questions now hard-bound to a 48h target match. 48h window filter before Call 1, strict predicate match_id validation after Call 2 (no fallback), TARGET MATCH CONSTRAINT added to prompt, manual_review answer_closes_at changed to kickoff, match_id always NOT NULL on insert. PROMPT_VERSION bumped v2.8 → v2.9. generate-questions redeployed.

Last updated 2026-04-28 — REAL_WORLD sixth audit pass: 8 fixes. (C1) deleted dead `rwQuota` ReferenceError block in prematch pool Phase C — was crashing the entire prematch generation pass per league with an undefined variable left by the 5th pass cleanup. (C2) match_id added to `upcomingMatchStr` passed to Call 1 — model was fabricating numeric IDs that passed schema validation but resolved against wrong fixtures. (C3) manual_review resolvesAfter changed from deadline to deadline+91min — checkTemporal requires resolvesAfter >= deadline+90min, so deadline (5th pass fix) was always 1 minute too early, failing validation after all 4 OpenAI calls. (M1) extended player_stat VALID_FIELDS in predicate-validator: passes_total, passes_key, dribbles_attempts, dribbles_success, tackles, interceptions, duels_total, duels_won — TYPE 2/3 RW questions using these fields were silently rejected. (M2) quota-checker daily cap fail-safe: DB error now returns allowed=false instead of silently allowing through; both count queries changed from select('*') to select('id'). (M3) mergedKnownPlayers (team_players DB + keyPlayers injury list) now passed to Call 1 instead of only keyPlayers — fit squad players had no player_id in the hint causing TYPE 2/3 player predicates to fail entity validation. (M4) all upcoming matches (up to 3) now passed to Call 1 as upcoming_matches[] — model selects the most relevant fixture; post-Call-2 upcomingMatch resolved by matching predicate match_id against all upcoming matches. (M5) news-adapter/index.ts: sportsCtx.teamStandings (non-existent field) replaced with sportsCtx.standings?.map(s => s.team.name) — was silently stripping all standings team names from the knownTeams list. (M6) match_lineup resolution_deadline overridden to kickoff (not kickoff-30min): auto-void fires at kickoff+1h giving the resolver a full hour of retries; near-kickoff guard extended from 30min to 60min (lineups released ~1h before kickoff). PROMPT_VERSION bumped to v2.7. Both Edge Functions redeployed.

---

# System Rules

Permanent operational rules for Spontix. These apply to all development regardless of feature scope.

## Sport support
- **Football is the only live sport.** The generation pipeline skips non-football leagues at runtime (`sport_not_supported_mvp`).
- Hockey and tennis adapters exist in the codebase. Do not extend them until API coverage is verified end-to-end.

## Timing model — MANDATORY
Every question must have all three timestamps populated. This is the fairness guarantee — do not simplify it away.
- `visible_from` — when the question appears in the feed
- `answer_closes_at` — authoritative answer lock (enforced at DB level via RLS)
- `resolves_after` — when the resolver evaluates the outcome (always strictly after `answer_closes_at`)

## Scoring formula — FULLY ACTIVE
All six multipliers are live in `resolve-questions/index.ts`:

```
points = base_value × time_pressure × difficulty × streak × comeback × clutch
```

| Multiplier | Value |
|---|---|
| `base_value` | Per category: 20 / 15 / 12 / 10 / 6 |
| `time_pressure_multiplier` | 1.0–1.5× based on time remaining at answer |
| `difficulty_multiplier` | 1.0–1.5× set at question generation time |
| `streak_multiplier` | 1.0–1.3× based on consecutive correct answers |
| `comeback_multiplier` | 1.0–1.3× based on gap to leaderboard leader |
| `clutch_multiplier` | 1.0–1.25× based on match phase at generation |

All multiplier functions and DB columns remain in code. Do not remove them.

## Active question cap
- **Max 3 active questions per league at any time** (enforced via `maxActiveQuestions = 3` in context packet and `MVP_MAX_ACTIVE_LIVE = 3` in live branch).

## Generation rate limits
- **CORE_MATCH_LIVE**: max 1 new question per 3 minutes per league (time-driven only; event-driven bypasses this limit).
- **REAL_WORLD**: max 1 per league per day.
- **CORE_MATCH_PREMATCH**: no rate limit — governed by publish window and weekly quota instead.

These are independent. CORE_MATCH_LIVE rate limiting must never block REAL_WORLD or PREMATCH generation.

## Fallback rules — never show an empty live feed
1. No active question during a live match → show the holding card ("Next moment dropping soon").
2. Generation produces zero questions → holding card, log internally, no user-facing error.
3. Resolver voids a question → remove from feed silently, no error state.
4. Any pipeline failure (sports API, OpenAI, Supabase) → degrade quietly, log, continue.

## Resolver safety — idempotency (CRITICAL)
- A question is resolved exactly once.
- The resolver fetches only `resolution_status = 'pending'` questions — do not remove or weaken this filter.
- Re-running the resolver (cron overlap, manual trigger, retry) must never award points twice.
- `player_answers` scoring loop must not run if the question is already resolved.

## Answer submission safety
- One answer per user per question — enforced by `UNIQUE (question_id, user_id)` in `player_answers`.
- Answer window enforced at DB level via RLS insert policy (`answer_closes_at > now()`).
- Do not remove the unique constraint. Do not bypass it with upsert logic that could re-award points.

## LIVE system — current state
All LIVE system components are fully implemented and deployed:

| Component | Status | Notes |
|---|---|---|
| UI (league.html) | ✅ Complete | Realtime subscription (30s heartbeat fallback), holding card, lane detection, badges, timers, answer submission, live window strip |
| Resolver | ✅ Complete | All predicate types including `match_stat_window` and `btts`; full scoring formula |
| Prematch generation | ✅ Complete | Full pipeline, pool system, quality filter (v2.2), prematch analytics (migration 020) |
| Live generation | ✅ Complete | In-progress match detection via `live_match_stats`; time-driven + event-driven; rate limit enforced |
| Live analytics | ✅ Complete | `analytics_live_quality_summary` + `analytics_live_rejection_reasons` views (migration 023) |

## LIVE tier enforcement
Two distinct rule types — never confuse them:

**Safety rules** (all tiers, always enforced):
- Max 3 active questions per league at any time
- Max 1 new live question per 3 minutes per league (time-driven)
- Minimum 90-second answer window
- No generation after match ends (≥89 min hard reject)

**Monetization rules** (per tier, enforced at answer submission):
- **Starter**: answer limit = 3 per match (`liveQuestionsPerMatch: 3`); cannot create live-mode leagues
- **Pro**: unlimited live answers; can create live-mode leagues
- **Elite**: unlimited live answers; can create live-mode leagues; live stats tab

## Protected systems — do not redesign
Stable, deployed, production-critical. Targeted bug fixes only.

| System | Location | Rule |
|---|---|---|
| Generation pipeline | `generate-questions/index.ts` + `lib/` | Do not refactor — stable and deployed |
| Resolver pipeline | `resolve-questions/index.ts` | Do not redesign — only safe targeted changes |
| Database schema | `backend/migrations/001–034` | Do not drop columns, tables, or constraints |
| Timing model | `visible_from`, `answer_closes_at`, `resolves_after` | Always populate all three on every question |
| Pool system | `lib/pool-manager.ts` | Do not redesign — race-safe, deployed |
| 4-stage validator | `lib/predicate-validator.ts` | Do not weaken — all four stages must run |

## Logging requirements
Log at Edge Function level (`console.log` / `console.warn`):
- Generation failures (OpenAI, predicate parse, all retries exhausted)
- Resolver failures (API-Sports fetch, predicate evaluation error, DB write error)
- Skipped generation — always log the skip reason
- Pool reuse vs fresh generation — logged at `[pool]` prefix level

Logging is fire-and-forget. Failures in the logging path must not propagate or degrade the user experience.

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
| `CORE_MATCH_LIVE` | ✅ Primary focus | Max 3 active total, goals/penalties/red cards/yellow cards, 3-min rate limit |
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
| AI Real World Questions (generation pipeline) | ✅ Live — fires every 6h via pg_cron. **4-call OpenAI pipeline**: Call 1 (generate) → Call 2 (predicate) → Call 3 (context + sources) → Call 4 (quality gate: APPROVE/WEAK/REJECT). `OPENAI_API_KEY` + `API_SPORTS_KEY` active. match_lineup + manual_review predicate types. Deadline auto-void. |
| AI Real World Questions (feed UI) | ✅ Live — league.html renders rw_context snippet, confidence badge (high/medium/low), resolve-by date, sources link. Fallback copy when rw_context missing. |
| REAL_WORLD player database | ✅ Live — migration 026: teams + players + team_players tables. live-stats-poller syncs from lineups (starters +10, subs +4) + events (goals +8, assist +6, cards +5). PLAYER BOOST RSS query targets top-relevance players per match. 5 soccer question types in RW_GENERATION_SYSTEM_PROMPT. |
| REAL_WORLD quality gate (Call 4) | ✅ Live — `scoreRealWorldQuestion()` LLM scorer in `openai-client.ts`. 6-dimension scoring (news_link_strength + clarity + resolvability + relevance + uniqueness − risk). APPROVE ≥80 published; WEAK 65–79 published only if no better question in run; REJECT <65 discarded. Score + decision embedded in `narrative_context` for immediate DB inspection. `RwQualityResult` type in `types.ts`. `rw_quality_score` stage in `RejectionLogEntry`. |
| AI question resolver (auto-scoring pipeline) | ✅ Deployed + verified — fires every hour via pg_cron. Returns `ok:true`. Scores `player_answers` when questions resolve. |
| league.html — dynamic question feed + leaderboard | ✅ Fully Supabase-backed — questions, members, answers, lazy leaderboard |
| Pre-match scheduling (migration 018) | ✅ Live — automatic/manual modes; tier-gated offset pills (Pro: 24h/12h, Elite: 48h/24h/12h/6h); Edge Function respects publish window; pool reuse recomputes per-league visible_from |
| League cascade delete (migration 019) | ✅ Live — ON DELETE CASCADE on questions + league_members FKs; orphan questions cleaned up; deleteLeague() cascades at JS layer too |
| Pre-match question lifecycle UX | ✅ Live — status strips (🔒 active / ⏳ closed), answer-change hint, "Your current pick" label, contextual toasts, result timing messaging in league.html |

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
- **Realtime** — ✅ configured: `questions` + `player_answers` tables subscribed in `league.html` via `postgres_changes` channel; migration 028 enables the Supabase publication. New questions appear sub-second; resolved cards flip in real-time when the resolver awards points.
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
> Session continuation flow (question chaining, match summary card, deep-link from notifications) is designed but partially built. Realtime feed ✅ implemented (migration 028 required). Holding card ✅ implemented. Chaining UI, match summary card, and deep-link from notifications remain post-launch. The spec below is preserved for the post-launch sprint.

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
├── multiplayer.html                   ← Multiplayer arena: 1v1 / 2v2 lobby matchmaking (Supabase Realtime ✅)
│                                        Full-screen desktop layout, 3-step flow (Format → Match+Config → Waiting Room)
│                                        Match cards show live interest signals (Ready/Trending/queue count)
│                                        createArenaSession() creates arena_sessions row + redirects to arena-session.html
│                                        Uses migrations 030 + 031 + 034: match_lobbies + player_count trigger + arena_session_id FK
├── arena-session.html                 ← Live Multiplayer gameplay page (arena sessions only, NOT leagues)
│                                        Questions filtered by arena_session_id; answers submitted with arena_session_id
│                                        Three Realtime channels: session status, questions, player scores
│                                        Complete overlay: winner/draw/loss + per-player scores + handles + Question Results Breakdown
│                                          renderQuestionReview() — scrollable per-question cards (correct/wrong/missed/awaiting),
│                                          answer rows, pts pill, tags (Clutch/Streak/Comeback/Hard); sorted ascending by created_at
│                                        In-session History drawer: floating ≡ History button (safe-area aware), 75vh bottom-sheet,
│                                          past questions newest-first; new-question lime banner when active question exists
│                                        loadPlayers() two-step query (arena_session_players → public.users by UUID list)
│                                        parseOptions() normalises plain strings → {id,label} objects for button rendering
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
│       ├── 009_saved_matches.sql      ← saved_matches table: players + venues save fixtures
│       │                                to personal/venue schedule. RLS: own rows only.
│       │                                Unique(user_id, match_id). Two indexes (user, venue).
│       └── 015_live_match_stats.sql   ← live_match_stats table (fixture cache for Stats tab);
│                                        fixture_id column on leagues; pg_cron job 8 template
│                                        (every minute → live-stats-poller).
│
└── supabase/
    └── functions/
        ├── generate-questions/        ← Edge Function: question generation (Deno TypeScript)
        │   ├── index.ts               ← Main orchestrator (GET/POST handler)
        │   ├── DEPLOY.md              ← Step-by-step deployment + monitoring guide
        │   └── lib/
        │       (see below)
        ├── live-stats-poller/         ← Edge Function: live match stats cache (Deno TypeScript)
        │   └── index.ts               ← Polls API-Sports every minute for active fixtures;
        │                                upserts to live_match_stats. Endpoints used:
        │                                /fixtures (every cycle), /fixtures/events (live+done),
        │                                /fixtures/statistics (live+done, 2 calls),
        │                                /fixtures/players (every 3 min live; once done),
        │                                /fixtures/lineups (once), /predictions (once),
        │                                /fixtures/headtohead (once). ~305 req/match.
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
| `live_match_stats` | Live match statistics cache. One row per API-Sports fixture ID. Upserted every minute by the `live-stats-poller` Edge Function. Stores: score, status, minute, events JSONB, team_stats JSONB, player_stats JSONB, lineups JSONB, predictions JSONB, head_to_head JSONB. One-time fields (lineups/predictions/H2H) are flag-guarded and never re-fetched. Public read, service-role write. Added by migration 015. |

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
- `pg_cron` + `pg_net` — enabled by migration 003. Three jobs active:
  - Job 2: `generate-questions-every-6h` (migration 003)
  - Job 3: `resolve-questions-every-hour` (migration 004)
  - Job 8: `live-stats-every-minute` (migration 015) — polls API-Sports for active fixtures, exits fast when none

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
- **league.html — live engine v2** — correct question state machine (visible_from / answer_closes_at / resolves_after with legacy deadline fallback), Supabase Realtime channel (`league-{id}`) for instant question + answer updates (replaces 5s/15s polling), 30s heartbeat polling as safety net when Realtime is active (5s/15s restored if channel errors), holding card when no active question, engagement badges (HIGH VALUE / CLUTCH / FAST), live window strip for CORE_MATCH_LIVE cards, point range display per question, answer window enforcement client + server side, scoring multiplier capture (clutch, streak) at submission time, dynamic league activity card replacing static live match card. Tab visibility handling (pauses channel when hidden, resumes on return). `beforeunload` cleanup. **Requires migration 028 in Supabase SQL editor to enable Realtime publication.**
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
- **Live Stats Feed** — `live_match_stats` table (migration 015) stores per-fixture cache: score, status, minute, events, team stats, player stats, lineups, predictions, H2H. `live-stats-poller` Edge Function (pg_cron job 8, every minute) polls API-Sports and upserts. `league.html` **Stats tab** renders the full experience: SVG visual pitch with player positions (home=lime/bottom, away=coral/top, jersey numbers + surnames, goal/card markers), events timeline, team stats comparison bars, player stat cards with Home/Away tab toggle, predictions with win-probability bars + form dots, H2H last 5. Graceful empty states when no data yet. "Updated X ago · Refresh" footer.
- **Cache warming** — all domains auto-refresh 1.5s after page load.
- **All UI screens** — every `.html` file renders correctly. `profile.html` and `leaderboard.html` use full-width layout.
- **spontix-scraper-service** — standalone Node.js microservice (separate repo). POST /scrape accepts a URL, renders with headless Chromium (Playwright), extracts clean article text via Mozilla Readability + jsdom fallback. Deployed on Railway at `https://spontyx-scraper-service-production.up.railway.app`. Auth: `x-scraper-key` header. Rate limit: 20 req/min. Stack: Node 20, Express, Playwright, Readability, jsdom. Docker non-root pattern with `/ms-playwright` world-readable browser path.
- **Multiplayer arena (`multiplayer.html`)** — full-screen desktop matchmaking lobby. 3-step flow: (1) Format selection (1v1 vs 2v2 arena cards), (2) Match browser + config panel side-by-side, (3) Waiting room overlay with cinematic pulsing lime rings. Match list has search, competition filter, sort by time or active players. Each match card shows a live interest signal (👥 Ready / ⚡ Trending / 🔥 N in queue) — only highest-priority signal shown, never empty states; signals update in real-time via Realtime. Config panel shows half-scope options (Full Match / First Half / Second Half) with per-half + per-mode queue counts. 2v2 team options: auto-match queue, invite via share link. Waiting room: player vs opponent avatars with `searching` pulse / `found` pop-in animation, invite link section for 2v2 share-link mode, cancel button. DB: migration 030 (`match_lobbies` + `match_lobby_players`) + migration 031 (denormalized `player_count` with DB trigger — scales to any player count). Stub fallbacks built into page script if `SpontixStoreAsync` lobby methods are not yet wired.

---

## 8. What Is Incomplete or Missing

### Architecture gaps flagged but not yet addressed
- **Live gameplay pages** (`live.html`, `battle-royale.html`, `trivia.html`, `venue-live-floor.html`) are **single-player client simulations**. Real multi-user games need server-authoritative state via websockets — a separate sprint.
- **Multiplayer lobby — `SpontixStoreAsync` lobby methods not yet wired** — `multiplayer.html` has built-in stubs for `findOrJoinLobby()`, `joinLobbyById()`, and `createLeagueFromLobby()` that call Supabase directly from the page. These should eventually be promoted to `spontix-store.js` async methods. The stub implementations in the page script are fully functional for MVP.
- **Multiplayer — `createLeagueFromLobby()` incomplete** — when all players are present, a `leagues` row is inserted and players are redirected to `league.html`. The lobby-to-league wiring (linking `match_lobbies.league_id` and routing players) is implemented in the page stub but has not been tested end-to-end with real matched players.
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
- **Realtime question feed** — ✅ Implemented: Supabase Realtime channel in `league.html` subscribes to `questions` INSERT/UPDATE/DELETE + `player_answers` UPDATE; new questions appear sub-second; 30s heartbeat safety net; migration 028 enables publication
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

### 6. ✅ DONE — Live Stats Feed
- `backend/migrations/015_live_match_stats.sql` — `live_match_stats` table + `fixture_id` on `leagues` + pg_cron job 8 template. Run in Supabase SQL editor ✅
- `supabase/functions/live-stats-poller/index.ts` — deployed with `--no-verify-jwt` ✅. Smoke test: `ok:true, "No active fixtures"` ✅
- `cron.schedule('live-stats-every-minute', '* * * * *', ...)` — job 8 active ✅
- `league.html` — Stats tab added (between Leaderboard and Schedule): SVG pitch, events, team stats bars, player cards, predictions, H2H

### 7. ✅ DONE — Arena Session system Phase 1 end-to-end verified
- `arena-session.html` bug fixes: `parseOptions()` normalised (plain strings → `{id,label}` objects); `loadPlayers()` two-step query (replaces broken FK join)
- Full flow confirmed: options render ✅, answer submission ✅, scoreboard with both handles ✅, Realtime fires complete overlay automatically on `status='completed'` ✅
- Migration 035 (Global XP system) written — `users.total_xp + level`, `player_xp_events` extended, `get_level_number()` + `get_level_info()` IMMUTABLE helpers, `award_xp()` SECURITY DEFINER RPC. ⚠️ Not yet applied.

### 8. ✅ DONE — Phase 2: XP system
- Migration 035 applied ✅
- `award_xp()` wired in `arena-session.html` `showCompleteOverlay()` — win=50XP, draw=25XP, loss=15XP; idempotent via `source_id=sessionId`; `+N XP` pill rendered in score card
- `winner_user_id` now authoritative for win/loss determination in overlay (score fallback for null only)
- `spontix-store.js` `_mapUserFromDb()` maps `total_xp` + `level` through to JS profile object
- XP bar + level badge added to `dashboard.html` and `profile.html` — hidden until data present

### 9. ✅ DONE — Phase 3: Arena Rating ELO
- Migration 036 applied ✅ — `arena_rating` (DEFAULT 500), `arena_games_played`, `arena_rating_updated_at` on `users`; `arena_rating_before/after/delta` snapshot columns on `arena_session_players`; leaderboard index
- `update_arena_ratings()` SECURITY DEFINER RPC — K-factor tiers (32/24/20), 2v2 team average, floor 500, repeat-opponent 24h penalty ×0.5 before clamp (minimum ±1), strict 2v2 validation (invalid_match:true), idempotent
- `arena-session.html` `showCompleteOverlay()` calls RPC via `Promise.all` with `award_xp()`; shows colored `±N SR` pill
- 9 visual tiers (Rookie/Bronze/Silver/Gold/Platinum/Diamond/Master/Grandmaster/Legend) displayed on `profile.html` and `dashboard.html`
- `spontix-store.js` `_mapUserFromDb()` maps `arena_rating` + `arena_games_played`

### 10. Wire Stripe for real tier subscriptions
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
- **Live session sprint** — implement remaining session continuation design (see `SESSION_CONTINUATION_DESIGN.txt`): deep-linking from notifications, question chaining UI (what's next prompt after answering), match summary card, live dot on dashboard. Holding card ✅ already in league.html. Realtime subscription ✅ already implemented.
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

**Scraper service (Railway):** https://spontyx-scraper-service-production.up.railway.app
**Scraper GitHub repo:** https://github.com/combatdefenderweprotect-oss/spontyx-scraper-service
**Scraper API key:** set as `SCRAPER_API_KEY` in Railway Variables AND in Supabase Edge Function Secrets
**Scraper base URL:** set as `SCRAPER_API_URL` in Supabase Edge Function Secrets (= `https://spontyx-scraper-service-production.up.railway.app`)

**Credentials in code:** `supabase-client.js`, lines 17-18
**Seed venue IDs:** `SpontixStore.VENUE_IDS.{PENALTY|SCORE|DUGOUT|ARENA|FULLTIME|FINAL}`
**Arena venue owned by:** `f901f211-738e-4409-abfd-8e1a9fb4bffb` (utis.richard@gmail.com)

**Resume prompt for a fresh Claude session:**
> "Continue Spontix development. Read `CLAUDE.md` for full context. Also read `SESSION_CONTINUATION_DESIGN.txt` before working on anything related to live questions, notifications, or the league question feed. Last completed: Arena Question History panel + completion overlay Question Results Breakdown ✅ — `arena-session.html` has a floating `≡ History` bottom-sheet drawer (past questions, newest-first, `.as-qr-card` style, new-question lime banner), and the completion overlay now shows a full per-question breakdown via `renderQuestionReview()` (result badge, answer rows, pts pill, Clutch/Streak/Comeback/Hard tags). All migrations 001–037 applied ✅. docs/REAL_WORLD_QUESTION_SYSTEM.md is the authoritative REAL_WORLD reference. Next priorities: (1) Stripe subscriptions (wire real tier reads, replace authGate() Elite forcing); (2) `resolve-questions/index.ts` call `increment_arena_player_score()` after awarding points to keep live scoreboard in sync."

---

## Update Log

### 2026-04-29 — play_mode: singleplayer / multiplayer (migration 029)

**Goal:** add a `play_mode` field to leagues so users can create either a solo session (just them vs the match) or a multiplayer league (compete with others). `play_mode` is a gameplay experience toggle — completely independent of subscription tier.

**Key design constraint:** ALL `TIER_LIMITS` apply identically in both modes:
- Starter: 3 live answers per match, REAL_WORLD locked — same in solo and multiplayer
- Pro: full live, 10 REAL_WORLD/month — same in solo and multiplayer
- Elite: all features unlimited — same in solo and multiplayer
- `leaguesCreatePerWeek`, `leagueMaxPlayers`, all other limits: unchanged by play_mode

**New migration: `backend/migrations/029_play_mode.sql`** — ✅ run:
- `play_mode TEXT NOT NULL DEFAULT 'multiplayer' CHECK (play_mode IN ('singleplayer', 'multiplayer'))` added to `leagues`
- `idx_leagues_play_mode` index added
- Backfill: all existing leagues set to `multiplayer`

**`spontix-store.js`:**
- `_mapLeagueFromDb`: `playMode: row.play_mode || 'multiplayer'` — maps DB column to camelCase
- `_mapLeagueToDb`: `if (l.playMode !== undefined) out.play_mode = l.playMode;` — maps back to DB
- Note: `playMode` on the league object maps to `play_mode` (singleplayer/multiplayer). This is DISTINCT from the wizard-local `playMode` JS variable in `create-league.html` which maps to `leagues.mode` (individual/team).

**`create-league.html` — 14 targeted edits:**

*New state variable:*
- `let sessionType = 'multiplayer';` — wizard-local; maps to `leagues.play_mode`; distinct from existing `let playMode` (individual/team → `leagues.mode`)

*New HTML:*
- `<!-- Play Experience -->` section before `<!-- Team Mode -->` — two mode cards: Multiplayer (purple icon) + Solo (lime icon); `id="play-experience-section"`
- `id="sp-live-cap-notice"` — coral notice shown when Solo + live/hybrid + Starter tier; cap value from TIER_LIMITS, never hardcoded
- `id="ai-rw-lock-badge"` Pro+ badge next to AI Real World toggle

*New JS functions:*
- `selectSessionType(type, el)` — updates `sessionType`; hides Team Mode section for singleplayer; locks player slider to value=1, disabled=true; calls `applySingleplayerLiveCapNotice()`
- `applyRealWorldTierGating()` — reads `getTierLimits(tier).realWorldQuestionsEnabled`; shows Pro+ badge + reduces toggle opacity for Starter; forces toggle off if Starter and somehow enabled; called from `applyMatchNightTierGating()`, `initStandardStep()`, `DOMContentLoaded`
- `applySingleplayerLiveCapNotice()` — shows/hides `#sp-live-cap-notice` based on `sessionType === 'singleplayer' && isLimitedLive && isLiveOrHybrid`; called from `selectSessionType()` and `selectQuestionMode()`

*Modified functions:*
- `toggleAIQuestions()` — tier check added at top: Starter → upgrade modal + return; prevents any bypass
- `selectPlayMode()` — scoped to `.team-mode-section .mode-card` (was global `.mode-card` — would have cleared Play Experience cards)
- `restoreStepState()` step 1 — scoped card selection + Solo state restoration (slider disabled, team section hidden)
- `launchLeague()` — `playMode: sessionType` added (maps to `play_mode`); `maxMembers: isSingleplayer ? 1 : sliderValue`
- `populateReview()` — new `review-session-type` row shows "Solo (1 player)" (lime) or "Multiplayer" (purple)
- `selectQuestionMode()` — calls `applySingleplayerLiveCapNotice()`

*Review HTML:*
- New `<div class="review-row">` with `id="review-session-type"` before existing Play Mode row

**`league.html`:**
- `invite-card-section` id added to the invite card div for programmatic show/hide
- `hydrateLeaguePage()` — `isSolo` boolean from `league.playMode === 'singleplayer'`; sets `statMode` to 'Solo'; appends Solo tag to meta strip; hides `#invite-card-section` for solo leagues

**`docs/TIER_ARCHITECTURE.md`** — updated to v7 (2026-04-29):
- New section `## Play Mode vs Subscription Tier (migration 029)` with: comparison table showing identical tier limits in both modes, 4 critical rules (never add play_mode to TIER_LIMITS; always call getTierLimits(); show locked/upgrade state; singleplayer max_members=1), implementation locations, enforcement status table

**Migrations 028 + 029 status:**
- Migration 028 (Realtime publication) — ✅ already applied: both `questions` and `player_answers` were already in `supabase_realtime` publication before this session
- Migration 029 (play_mode column) — ✅ run successfully

---

### 2026-04-29 — spontix-scraper-service built and deployed

**Goal:** lightweight standalone microservice that accepts a URL, renders it with headless Chromium, and returns clean extracted article content. Built as a separate repo for use by the Spontix generate-questions pipeline to fetch full article bodies from news URLs.

**Stack:**
- Node.js 20, Express, Playwright Chromium, Mozilla Readability, jsdom
- Docker with non-root user pattern

**Files created (8 total):**
- `package.json` — dependencies + scripts (start, dev)
- `index.js` — Express server: auth middleware (`x-scraper-key` header), rate limiter (20 req/min via express-rate-limit), `GET /health`, `POST /scrape`
- `scraper.js` — Playwright Chromium launcher: blocks images/media/fonts/websockets, waits for `domcontentloaded` + 4s `networkidle`, returns raw HTML
- `utils/extract.js` — content extraction: Mozilla Readability (primary) → semantic selectors fallback → `<p>` paragraph fallback. Extracts title (og:title → twitter:title → h1 → `<title>`), published_at (time[datetime] → meta tags → JSON-LD), source domain, extracted_text (capped at 3,000 chars)
- `.env.example` — documents PORT and SCRAPER_API_KEY
- `Dockerfile` — multi-layer Docker build with non-root user pattern:
  - System deps for Chromium installed
  - `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` set before install
  - `chmod -R o+rx /ms-playwright` so non-root user can read browsers
  - `appuser` created, `/app` owned by appuser, `USER appuser` at runtime
- `README.md` — local dev guide, API reference, curl examples, Railway/Render/Docker deployment guides
- `.dockerignore` — excludes node_modules, .env, *.md, .git

**API:**
- `GET /health` — no auth, returns `{"ok":true}`
- `POST /scrape` — requires `x-scraper-key` header and `{"url":"..."}` body
- Response includes: `success`, `url`, `title`, `source`, `published_at`, `extracted_text`, `extraction_status` (success/partial/failed), `error`

**GitHub:** `https://github.com/combatdefenderweprotect-oss/spontyx-scraper-service`
- Private repo under combatdefenderweprotect-oss org
- `.env` excluded via `.gitignore` before first commit

**Railway deployment:**
- Connected via GitHub App (installed Railway App on GitHub account)
- Docker auto-detected from Dockerfile
- `SCRAPER_API_KEY` set in Railway Variables
- Domain generated: `https://spontyx-scraper-service-production.up.railway.app` → Port 8080 (Railway injects its own PORT env var; app uses `process.env.PORT || 3000`)
- `/health` → `{"ok":true}` ✅
- `/scrape` with BBC Sport URL → full JSON with title, source, extracted_text ✅

**Key issues resolved:**
- npm cache EACCES: `sudo chown -R 501:20 "/Users/richutis/.npm"` then reinstall
- Dockerfile browser path: Chromium installed to `/ms-playwright` (not `/root/.cache`) so non-root `appuser` can access it
- Railway port mismatch: server logs showed port 8080 (Railway's injected PORT), but domain was configured for 3000 — fixed by editing the domain target port to 8080

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
- Session continuation flow: holding card ✅ built, Realtime feed ✅ built (migration 028 required), question chaining and match summary card planned post-launch sprint.
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
- Tennis sequence engine
- Hockey expansion

**Launch risks remaining:**
- ~~No Realtime subscription~~ — ✅ Realtime implemented (migration 028 must be run in Supabase SQL editor)
- Type 1 single-match session pacing not implemented — users experience continuous generation, not a structured session arc
- `GNews API key` not yet added — news context missing from generation (degrades gracefully; Google News RSS adapter is the primary source)
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

---

### 2026-04-27 — Discover filters: DB-driven Sport/Competition/Team + fake cards removed

**Problem:** All 3 filter dropdowns in `discover.html` referenced data that didn't exist in the DB (Region: Europe/NA/etc.; Sport: basketball/tennis/F1/rugby; Team: Real Madrid/Lakers). Every league defaulted to `region = 'Europe'` so the Region filter showed all leagues regardless. 12 static browse cards and 2 promoted cards showed fake non-existent leagues.

**`discover.html` — filter bar rewritten:**
- **Sport dropdown** — populated from `sports_competitions.sport` (distinct values, deduplicated)
- **Competition dropdown** — populated from `api_sports_league_id` values on real leagues, joined to `sports_competitions` for names; hidden if no competition data exists
- **Team dropdown** — populated from `scoped_team_name` values on real team-scoped leagues; hidden if no team-scoped leagues exist
- Old **Region** dropdown removed entirely (no DB backing; was broken)
- New `populateFilters(leagues, competitions)` function builds `window._compMap` (`api_league_id → {name, sport}`) and fills all three dropdowns in one pass
- `hydrateDiscover()` now fetches `sports_competitions` in parallel with `getDiscoverLeagues()` via `Promise.all`

**`discover.html` — filter logic updated:**
- `filterLeagues()` replaces `data-region` check with `data-competition` check
- `createLeagueCard()` sets `div.dataset.competition = league.apiSportsLeagueId` and `div.dataset.team = league.scopedTeamName.toLowerCase()`
- Competition name tag on each card now reads from `_compMap` instead of hardcoded strings
- `scopedTeamName` used (correct DB column) instead of old `league.team` (legacy/empty)

**Static content removed:**
- All 12 hardcoded browse cards (`browseGrid`) removed — `<!-- populated dynamically -->`
- Both promoted cards (`promotedGrid`) removed — `<!-- populated dynamically -->`
- Result count initial value changed from `"12"` to `"0"` (reflects real loaded count)

---

### 2026-04-27 — Sidebar: My Leagues badge live (real active league count)

**`sidebar.js` — `playerNav` My Leagues item:**
- Removed `badge: '3', badgeClass: 'lime'` (hardcoded)
- New `updateLeagueBadge()` async IIFE runs after `init()` renders the sidebar

**Badge logic:**
- Fetches all active leagues owned by the user (`leagues WHERE owner_id = uid AND status = 'active'`) → `ownedIds` Set
- Fetches all `league_members` rows for the user → filters out owned IDs → `joinedOnlyIds`
- Counts active joined-only leagues from Supabase (separate query with `.in()` filter)
- Total = `ownedIds.size + joinedActiveCount`
- Badge hidden when total = 0; shows lime badge otherwise

**Bug fixed (owner double-counting):** when a user creates a league they are added to both `leagues.owner_id` AND `league_members`. Naive count of member rows double-counted owned leagues. Fix: filter `league_members` rows against `ownedIds` Set before counting joined leagues.

---

### 2026-04-27 — Sidebar: Your Games badge live (unanswered questions count)

**`sidebar.js` — `playerNav` Your Games item:**
- Removed `badge: '2'` (hardcoded)
- New `updateGamesBadge()` async IIFE runs after `init()`

**Badge logic (initial version — single coral badge):**
- Collects all league IDs the user is in (member + owned, deduplicated)
- Queries open questions in those leagues (answer window still open, not resolved/voided)
- Queries `player_answers` to find which questions the user has already answered
- Counts unanswered = open questions minus answered ones
- Badge hidden when count = 0; shows coral badge with count otherwise

---

### 2026-04-27 — Sidebar: Your Games split into two badges (red + orange)

**Problem:** A single coral badge couldn't communicate the difference between "a match is live RIGHT NOW" and "you have pre-match questions to answer" — two distinct urgency levels that match the two sections on `activity.html`.

**`sidebar.js` — `updateGamesBadge()` rewritten:**
- Query expanded: open questions now also fetch `question_type`, `match_minute_at_generation`, `match_id`, `league_id`
- **Red badge (`badge coral`)** — counts distinct live matches: groups open questions by `match_id` (or `league_id` fallback) where `question_type = 'CORE_MATCH_LIVE'` or `match_minute_at_generation != null`. Each unique match key = 1. Matches the "Live Now" section on `activity.html`.
- **Orange badge (inline style `#FF9F43`)** — counts total unanswered open questions across all types (all questions not in `answeredIds`). Matches the "Unanswered Questions" section on `activity.html`.
- Both badges cleared and re-injected on every page load (no stale state)
- Either badge hidden if its count is 0; both can appear simultaneously
- Badges stack next to each other on the nav item (right-aligned after label text)

---

### 2026-04-27 — Pre-Match Scheduling system (migration 018)

**Goal**: give league owners control over WHEN pre-match questions appear in the feed before kickoff. Two modes: automatic (default, 24–48h before kickoff) and manual (publish at kickoff − N hours). Tier-gated.

**New migration: `018_prematch_schedule.sql`** — run in Supabase SQL editor before deploying Edge Function
- Adds `prematch_generation_mode TEXT NOT NULL DEFAULT 'automatic' CHECK IN ('automatic','manual')` to `leagues`
- Adds `prematch_publish_offset_hours INTEGER NOT NULL DEFAULT 24 CHECK IN (48,24,12,6)` to `leagues`
- Index on `(prematch_generation_mode) WHERE ai_questions_enabled = true`

**`supabase/functions/generate-questions/lib/types.ts`:**
- `LeagueWithConfig` extended: `prematch_generation_mode: 'automatic' | 'manual' | null` + `prematch_publish_offset_hours: number | null`

**`supabase/functions/generate-questions/index.ts`:**
- SELECT query now includes both new columns
- New publish window filter (Step 3b) after `recentQuestions` fetch: calls `isMatchEligibleForPrematch()` per match; leagues with no eligible matches are skipped with `no_matches_in_publish_window`
- Phase A and B now operate on `filteredSportsCtxBySchedule` (schedule-filtered matches only)
- `visible_from` computation replaced: automatic → now; manual → `kickoff − offset_hours` (clamped to now)
- New helper `isMatchEligibleForPrematch(kickoff, league, nowMs)` — automatic: ≤48h from kickoff; manual: `now >= kickoff − offset_hours`; both: reject after kickoff
- New exported helper `computeVisibleFrom(league, kickoff)` — same logic, used at generation time

**`supabase/functions/generate-questions/lib/pool-manager.ts`:**
- New internal helper `computeLeagueVisibleFrom(league, kickoff)` — recomputes visible_from per-league so pool-reused questions get the correct publish time for each league's scheduling mode
- `attachPoolQuestionsToLeague`: `visible_from` and `opens_at` now use `computeLeagueVisibleFrom(league, pq.deadline)` instead of the pool's canonical `pq.opensAt`

**`spontix-store.js`:**
- All 6 tiers: `prematchSchedulingEnabled` + `allowedPrematchOffsets` added under `// ── Pre-Match Scheduling ──` section
  - Starter/Venue Starter: `enabled: false, offsets: []`
  - Pro/Venue Pro: `enabled: true, offsets: [24, 12]`
  - Elite/Venue Elite: `enabled: true, offsets: [48, 24, 12, 6]`
- `_mapLeagueToDb`: two new explicit guards — `prematchGenerationMode` → `prematch_generation_mode`, `prematchPublishOffsetHours` → `prematch_publish_offset_hours`
- `SpontixStoreAsync.createLeague`: passes both fields through from `data.*`

**`create-league.html`:**
- CSS: `.timing-card`, `.timing-mode-cards`, `.timing-card-label`, `.timing-card-hint`, `.timing-lock-badge`, `.timing-offset-grid`, `.timing-offset-pill` (locked state: dashed border + 🔒 suffix)
- HTML: `#prematch-timing-section` with Automatic/Manual cards + offset pills (48h/24h/12h/6h); hidden by default; shown when prematch questions are relevant
- JS state: `prematchScheduleMode = 'automatic'`, `prematchPublishOffset = 24`
- JS functions: `selectPrematchMode()`, `selectPrematchModeGated()`, `selectPrematchOffset()`, `renderPrematchTimingTierLocks()`, `updatePrematchTimingVisibility()`
- `selectQuestionMode()` + `toggleAIQuestions()` each call `updatePrematchTimingVisibility()` — section appears/disappears as mode changes
- `launchLeague()`: `prematch_generation_mode` + `prematch_publish_offset_hours` added to `leagueData`

**`docs/TIER_ARCHITECTURE.md`:** new `## Pre-Match Scheduling System (migration 018)` section + enforcement status entries

**Post-implementation checklist:**
1. ✅ Run `018_prematch_schedule.sql` in Supabase SQL editor — done 2026-04-28
2. ✅ Deploy Edge Function: `supabase functions deploy generate-questions --no-verify-jwt` — deployed
3. ✅ Verify with smoke test — `ok:true` confirmed

---

### 2026-04-27 — Live Stats Feed: migration + Edge Function + Stats tab

**Goal**: full live match stats experience — backend polling, DB cache, and Stats tab UI in league.html — deployed end-to-end and verified live.

**New migration: `015_live_match_stats.sql`** — run in Supabase SQL editor ✅
- `live_match_stats` table — one row per API-Sports fixture ID (bigint PRIMARY KEY)
  - Score: `home_score`, `away_score`, `status` (NS/1H/HT/2H/ET/FT/etc.), `minute`
  - Teams: `home_team_id/name/logo`, `away_team_id/name/logo`, `competition_name`, `kickoff_at`
  - Live data (every cycle): `events` JSONB, `team_stats` JSONB, `player_stats` JSONB
  - One-time data (flag-guarded, never re-fetched): `lineups` JSONB, `predictions` JSONB, `head_to_head` JSONB
  - Poll flags: `lineups_polled`, `predictions_polled`, `h2h_polled` (prevent re-fetching)
  - Freshness: `last_polled_at`, `updated_at`
  - RLS: public read, service-role write only
- `fixture_id bigint` column added to `leagues` for optional direct match linking
- pg_cron schedule template included (commented — uncommented and run separately)

**New Edge Function: `supabase/functions/live-stats-poller/index.ts`** — deployed ✅, smoke test: `ok:true` ✅
- Finds fixtures to poll: distinct `match_id` from pending questions (within last 4 hours) + `leagues.fixture_id` with active date range
- Per 1-minute cycle: `/fixtures` (score + status) + `/fixtures/events` + `/fixtures/statistics` ×2 = 4 req/min
- Every ~3 min when live: `/fixtures/players` (player stats: rating, goals, assists, shots, saves, fouls, cards)
- Once per fixture (flag-guarded): `/fixtures/lineups`, `/predictions`, `/fixtures/headtohead?last=5`
- Dead statuses (CANC/PST/ABD) skipped immediately; 25s overlap guard prevents double-polling
- ~305 API requests per 90-minute live match — within Pro plan (7,500 req/day)
- Exits fast with 1 DB query when no active fixtures (cheap idle cost)

**pg_cron job 8: `live-stats-every-minute`** — activated via SQL ✅
- `* * * * *` — fires every minute
- Auth: Bearer `spontix-cron-x7k2m9` (same CRON_SECRET as other jobs)

**`league.html` — Stats tab added** (between Leaderboard and Schedule)

*Pre-match view* (status=NS):
- Win probability bars (home/draw/away %) + manager advice quote
- Recent form dots (W/D/L, colour-coded) for both teams
- Head-to-Head: last 5 results with dates and scores
- SVG pitch with starting XI lineups

*Live / Post-match view* (status=1H/HT/2H/ET/FT/etc.):
- Score header: home score : away score + LIVE badge with minute, or "Full Time"
- Events timeline (reversed, most recent first): ⚽ goals, 🟨🟥 cards, 🔄 substitutions, 📺 VAR
- Team stats comparison bars: possession (%), shots, shots on target, corners, fouls, yellow cards, saves
- SVG visual pitch (home=lime/bottom, away=coral/top)
- Player stat cards with Home/Away tab toggle

*SVG pitch design* (viewBox 0 0 380 540):
- Dark green background (`#0B1F12`) with subtle grass stripes (9 alternating bands)
- Accurate football pitch markings: outer boundary, penalty areas, 6-yard boxes, penalty spots, penalty arcs, center line + circle + spot, corner arcs, goals (outside boundary)
- All markings: `rgba(255,255,255,0.28–0.38)` stroke
- Player circles: r=18, drop shadow; home=`#A8E10C` (lime), away=`#FF6B6B` (coral)
- Inside circle: jersey number (bold, 10.5px); below: truncated surname (7.5px, semi-transparent)
- Goal badge: ⚽ emoji injected top-right per player per goal scored
- Card badge: yellow (`#FFD700`) or red (`#FF3B3B`) rectangle top-right corner of circle
- Positions derived from API-Sports `grid: "row:col"` — row 1=GK near own goal, increasing row toward opponent; columns distributed evenly across pitch width
- Home occupies y=295–498 (bottom half); Away occupies y=42–245 (top half)

*Player stat cards*:
- Jersey number (coloured by team), full name, position + minutes played, numerical rating (colour: lime ≥8.0, orange ≥7.0, grey <7.0)
- Outfield stats grid: Goals / Assists / Shots / Fouls Drawn
- GK stats grid: Saves / Minutes / Fouls / Cards
- Home / Away tab toggle (no page reload)

*Graceful states*:
- No questions in league → "No match linked yet"
- Questions exist but no `live_match_stats` row → "Stats not yet available — check back closer to kick-off"
- Any error → safe empty state, no crash
- "Updated X ago · Refresh" footer on every loaded state

**No architectural changes.** No changes to questions pipeline, resolver, scoring, or existing pages.

---

### 2026-04-28 — Cascade delete for leagues (migration 019)

**Problem:** `deleteLeague()` only deleted the `leagues` row. Questions tied to that league remained with `resolution_status = 'pending'`, causing the `live-stats-poller` Edge Function to keep hitting API-Sports every minute for fixtures belonging to deleted leagues. Identified when fixture 1391132 (Espanyol vs Levante) was still being polled after its league was deleted via the Settings → Danger Zone UI.

**Root cause:** no FK cascade on `questions.league_id` or `league_members.league_id`.

**`backend/migrations/019_cascade_delete_questions.sql`** — run ✅:
- `UPDATE questions SET resolution_status = 'voided' WHERE resolution_status = 'pending' AND league_id NOT IN (SELECT id FROM leagues)` — void orphaned pending questions
- `DELETE FROM player_answers WHERE question_id IN (SELECT id FROM questions WHERE league_id NOT IN ...)` — clean orphaned answers
- `DELETE FROM questions WHERE league_id NOT IN (SELECT id FROM leagues)` — remove orphaned questions
- Drops and re-adds `questions_league_id_fkey` WITH `ON DELETE CASCADE`
- Drops and re-adds `league_members_league_id_fkey` WITH `ON DELETE CASCADE`

**`spontix-store.js` — `deleteLeague()` rewritten:**
- Now explicitly cascades in JS before the leagues row delete (defense in depth alongside DB cascade):
  1. Void pending questions for the league
  2. Delete `player_answers` for all question IDs in the league
  3. Delete all questions for the league
  4. Delete all `league_members` rows for the league
  5. Delete the `leagues` row
- Previously: only step 5 existed

**Why both layers:** DB cascade handles any future deletion path (direct SQL, admin tools, future code). JS cascade ensures proper cleanup order and audit trail in the application layer.

---

### 2026-04-28 — Pre-match question lifecycle UX (league.html)

**Goal:** make the pre-match question experience self-explanatory. Users needed to understand: when they can answer, that they can change answers, when answering locks, and when results appear. No logic changes — CSS and rendering only.

**New CSS (before RIGHT COLUMN section):**
- `.pm-status-strip` — base strip with flex + border-radius; two variants: `.pm-active` (lime tint) and `.pm-closed` (grey tint)
- `.current-pick-label` — small grey hint below option buttons

**`renderQuestionCard()` additions:**

*Pre-match status strip (`pmStatusHtml`):*
- `lane === 'PREMATCH'` + `state === 'active'` → lime strip: `🔒 Answers lock at kickoff · You can change your answer until then`
- `lane === 'PREMATCH'` + `state === 'closed'` → grey strip: `⏳ Answering closed · Results after the match ends (~2–3h after kickoff)`
- Injected between `rwSource` and `question-text` so it's the first thing read after the type badge

*Current pick label (`currentPickHtml`):*
- Shown when: PREMATCH + active + user has already submitted an answer
- Text: `Your current pick — tap any option to change`
- Injected between `bodyHtml` (options) and `multHtml`

*Footer for PREMATCH closed state:*
- Was: `Awaiting match result...`
- Now: `Match in progress · results will appear once the match ends (~2–3h after kickoff)`
- LIVE/REAL_WORLD closed state unchanged

**`handleAnswer()` additions:**
- `hadPreviousAnswer` captured before the local cache is updated (before upsert)
- After successful upsert:
  - Changed answer → toast: `Answer updated ✓`
  - First PREMATCH answer → toast: `Answer saved · you can change it any time before kickoff`
  - First LIVE answer → no toast (optimistic button highlight is sufficient for fast-moving live questions)

**State → UI mapping (complete):**

| State | Lane | What user sees |
|---|---|---|
| `active` | PREMATCH | Lime strip "Answers lock at kickoff" + timer + "Your current pick" if answered |
| `active` | LIVE | Engagement badges (HIGH VALUE / CLUTCH / FAST) + timer bar — no lifecycle strip |
| `closed` | PREMATCH | Grey strip "Answering closed · Results after match ends" + footer timing message |
| `closed` | LIVE/RW | `Awaiting match result...` (unchanged) |
| `resolved` | any | ✅/❌ + points + multiplier breakdown (unchanged) |
| `voided` | any | `This question was voided and did not count.` (unchanged) |

**No backend changes.** No DB schema modifications. No pipeline or resolver changes.

---

### 2026-04-28 — Pre-match generation fixes (v2.0) + prematch question ruleset (v2.1)

**Goal 1 — Align prematch generation with intensity architecture (PROMPT_VERSION v2.0).**

5 targeted fixes, no pipeline refactor:

1. **`isMatchEligibleForPrematch()` — automatic window tightened**: was `≤48h`, now `24h–48h` band only. Late-creation fallback: if league was created after the normal window opened (within 24h of kickoff), allow generation immediately.
2. **Hardcoded "exactly 5 questions" removed**: OpenAI prompt now reads `max_questions_allowed` from context. Default fallback = 4.
3. **PER_RUN_CAP bypassed for prematch**: `checkQuota()` takes `isPrematch = false` parameter. When `isPrematch = true` (prematch call site), cap = `Infinity` — real cap is `min(weeklyRemaining, totalRemaining, prematch_question_budget)`. PER_RUN_CAP (3) unchanged for LIVE.
4. **Lineup data filtered at 6h**: `context-builder.ts` now excludes confirmed starters/bench when `hoursUntilKickoff > 6`. Injuries/suspensions always included. Prevents OpenAI shying away from player questions when lineups aren't released yet.
5. **DISTANT skip explicit**: index.ts hard-skips `classification === 'DISTANT'` with `skipReason: 'match_too_distant'` before quota check. Was previously only implicitly handled by the publish window filter.

Also: `created_at` added to `LeagueWithConfig` and SELECT query (used by late-creation fallback).

---

**Goal 2 — Full prematch question ruleset (PROMPT_VERSION v2.1).**

Replaced the 7-line PREMATCH prompt section with an 8-rule structured ruleset. No pipeline changes — prompt only.

**Rule 1 — Question type distribution:**
- 3 questions: outcome/state + match stat + player/team
- 4 questions: outcome/state + goals/BTTS/clean sheet + player-specific + context-driven
- 5+ questions: max 2 player-specific, max 2 outcome/state, ≥1 stat, ≥1 underdog/away angle
- Never all same predicate type

**Rule 2 — Quality filters:**
- DO NOT: "Will there be a goal?", obvious winner when dominant favourite, unavailable player, >80% likely outcomes, subjective questions
- DO prefer: over/under, BTTS, clean sheet, underdog resistance, H2H-informed, form-streak angles

**Rule 3 — Match context adaptation:**
- Close match → winner/draw/BTTS valid, difficulty 1.2×
- Heavy favourite → no simple winner, ask "win by 2+?" / "underdog score?" / "clean sheet?", difficulty 1.5× for underdog angles
- Rivalry/derby → cards, BTTS, both-teams-scoring, avoid clean sheet
- Low-scoring teams → under 2.5, clean sheet, low totals
- High-scoring teams → BTTS, over 2.5, player goals
- Key player absent → team-impact question instead

**Rule 4 — Team balance:**
- ≥1 question covering the underdog or away team per set
- Player questions not all from same team (unless team-scoped league)

**Rule 5 — Player question gate:**
- Only allowed when: player in context, not unavailable, not doubtful, stat is resolvable
- Allowed stats: goals, assists, shots, cards, clean_sheet (GK only)
- Forbidden for prematch: pass%, xG, distance, dribbles/tackles (rarely meaningful to fans)
- Hard max: 2 player questions per set

**Rule 6 — Resolvability gate:**
- Every question must resolve from: final score, team match stats, player match stats, or official outcome
- Forbidden: human judgment, betting settlement, post-kickoff news, unsupported stats, time-windowed player stats

**Rule 7 — Diversity:**
- No same predicate type more than twice in a set
- No same player twice
- No same stat focus twice
- If 3+ questions would be obvious binary — make ≥1 multiple_choice

**Rule 8 — Self-check before output:**
- OpenAI instructed to internally verify each question against all rules before returning
- Replace any failing question before output
- Checks: type diversity, team coverage, player gate, obviousness, resolvability, team balance, heavy-favourite handling

---

### Prematch Quality Filter — Post-Deployment Validation

#### 1. Purpose

`lib/prematch-quality-filter.ts` was introduced as a lightweight code-level quality gate for `CORE_MATCH_PREMATCH` questions. It addresses issues that prompt rules alone cannot reliably prevent:
- obvious winner questions in heavy-favourite matches
- near-duplicate questions within the same batch or across retry rounds
- player-specific question overuse (max 2 per batch)
- poor team balance (all questions about one team)
- generic/vague questions with no editorial value

#### 2. Implementation detail

The filter runs **after** `generateQuestions()` (OpenAI Call 1) and **before** `convertToPredicate()` (OpenAI Call 2). Rejected questions never reach predicate conversion or the 5-stage validator. This reduces token usage and keeps low-quality questions out of the pool entirely.

It stacks with the existing validator — it does not replace it.

#### 3. Known behaviour

**Quality scoring** — start at 100, subtract:

| Penalty | Amount | Condition |
|---|---|---|
| Obvious winner, heavy favourite | −35 | `outcome_state` winner + `standingGap ≥ 5` |
| Winner with no standings | −20 | `outcome_state` winner + `standingGap = null` |
| Near-duplicate (batch) | −40 | Jaccard word-overlap ≥ 0.65 vs accepted question |
| Near-duplicate (prior round) | −40 | Same check vs `validatedQuestions` from prior retries |
| Same player repeated | −30 | Same `player_id` already in batch or prior round |
| Over-represented category | −20 | ≥ 2 questions of same `question_category` already accepted |
| Poor team balance | −15 | All accepted questions about same team, this one too |
| Generic/short text | −25 | Question text ≤ 7 words |
| Weak resolvability hint | −20 | `predicate_hint` lacks any stat or outcome reference |

**Thresholds:**
- Score < 60 → rejected
- Score 60–74 → kept only if quota is not yet met (marginal)
- Score ≥ 75 → accepted

**Player cap:** max 2 `player_specific` questions per batch (accepted + prior rounds). Hard gate — runs before scoring.

**Team balance:** soft penalty only (−15). Not a hard rejection. A mildly imbalanced batch still passes if it scores ≥ 75 overall.

#### 4. Required testing after deployment

Run a manual generation trigger and check the Supabase Edge Function logs. Validate:

- [ ] Obvious winner questions are reduced — e.g. "Will Barcelona win?" should not appear when the opponent is 7+ table positions below
- [ ] No two questions in the same batch are near-duplicates (same question framed differently)
- [ ] Maximum 2 player-specific questions per batch — never 3 or more for the same match
- [ ] Both teams are represented in most batches — at least one question should reference the away team or underdog
- [ ] Question types are varied — not all `match_outcome`, not all `player_specific`
- [ ] `generation_run_leagues.rejection_log` contains `stage: 'prematch_quality'` entries with recognisable reasons:
  - `too_many_player_specific`
  - `obvious_winner_heavy_favourite`
  - `near_duplicate_in_batch`
  - `duplicate_player`
  - `poor_team_balance`
  - `low_quality_score`
  - `marginal_not_needed`
- [ ] Enough questions still pass the filter to fill the prematch quota — if a 4-question batch is consistently producing only 1–2 passing questions, the retry loop should compensate but this warrants investigation

**SQL to check recent rejection reasons:**
```sql
select league_id, rejection_log
from generation_run_leagues
where rejection_log is not null
  and created_at > now() - interval '24 hours'
order by created_at desc
limit 10;
```

#### 5. Monitoring

- Check how many questions fall into the 60–74 score band (logged as `marginal_not_needed` when quota is already met, or kept silently when quota is short)
- If a high proportion of accepted questions are scoring 60–74 (visible from rejection_log patterns), the filter is passing borderline questions because the model is consistently generating mediocre quality
- Action threshold: if more than 30% of accepted questions in a run are marginal, investigate whether prompt v2.1 is working correctly

#### 6. Future improvement

> If production logs show a persistent pattern of 60–74 score questions being used to fill quota, consider adding a stricter rule: **only allow marginal (60–74) questions if no ≥75 question is available after all MAX_RETRIES are exhausted.**

This would require tracking per-batch quality scores across retry rounds and doing a final promotion/rejection pass after the while loop, rather than the current per-round decision. Not needed at launch — implement post-launch if logs indicate the problem is real.

#### 7. Status

**This is not a launch blocker.** The current implementation is acceptable for MVP. Prematch quality is materially better than pre-filter behaviour. Production log validation should happen in the first 2–3 generation runs after launch to confirm the filter is working as expected.

---

### 2026-04-28 — Prematch quality analytics (migration 020)

**Goal:** structured analytics layer for the prematch quality filter — structured JSONB fields in rejection log, two Postgres views, dashboard queries, and a docs file.

**`supabase/functions/generate-questions/lib/types.ts`:**
- `RejectionLogEntry` extended with optional structured fields: `reason?: string`, `score?: number`, `fixture_id?: string | null`, `timestamp?: string`
- All four fields are written only for `stage = 'prematch_quality'` entries
- Other stages still write only `attempt`, `stage`, `question_text`, `error` — no breaking change

**`supabase/functions/generate-questions/lib/prematch-quality-filter.ts`:**
- `REASON_MAP` added — maps 11 internal scoring reason codes to 5 normalized analytics codes:
  - `too_obvious` — winner questions in mismatched fixtures (2 raw codes)
  - `duplicate_question` — near-duplicates and same-player (3 raw codes)
  - `too_many_player_specific` — player cap exceeded (1 raw code, unchanged)
  - `poor_team_balance` — team balance issue (1 raw code, unchanged)
  - `low_quality_score` — all other quality failures (4 raw codes)
- `normalizeReason(raw)` helper added — returns canonical code from `REASON_MAP`, defaults to `'low_quality_score'`
- All `rejected.push()` calls now use `normalizeReason(...)` — `PrematchRejection.reason` is normalized at the point of creation

**`supabase/functions/generate-questions/index.ts`:**
- Prematch quality rejection log entries now include all 4 structured fields:
  ```typescript
  result.rejectionLog.push({
    attempt, stage: 'prematch_quality', question_text: r.question_text,
    error: `${r.reason} (score=${r.score})`,  // human-readable string kept
    reason: r.reason,                          // normalized code
    score: r.score,                            // numeric 0–100
    fixture_id: firstMatchForQuality?.id ?? null,
    timestamp: new Date().toISOString(),
  });
  ```
- `error` string retained alongside structured fields for human-readable inspection in Supabase dashboard

**New migration: `backend/migrations/020_prematch_analytics_views.sql`**
- `analytics_prematch_quality_summary` view — daily rejection summary: total_generated, total_rejected, rejection_rate, avg_quality_score, 5 per-reason counters
- `analytics_prematch_score_distribution` view — score bucket distribution per day (0-50 / 50-60 / 60-75 / 75-90 / 90+) for threshold tuning
- Both views granted SELECT to `authenticated` and `anon`
- Run in Supabase SQL editor (safe to re-run — `CREATE OR REPLACE`)

**New file: `docs/PREMATCH_QUALITY_ANALYTICS.md`**
- Normalized reason code table
- Score threshold table
- View column reference
- 5 dashboard SQL queries (health check, reason breakdown, score distribution, raw log inspection, most-rejected fixture)
- Monitoring thresholds with Green/Yellow/Red bands and investigation actions
- Implementation notes (structured fields only from v2.1+, resilience to missing fields)
- Future improvement note (log accepted question scores)

**No generation logic changes.** No prompt changes. No pipeline restructuring. Code and docs only.

---

### 2026-04-28 — LIVE question system documentation + intensity preset wiring

**Goal:** formalize the LIVE question system into core documentation so its design, tier rules, and post-MVP activation plan are not lost before launch. Also wire migration 017 intensity presets into the create-league wizard (they were missing).

**`create-league.html` — intensity preset wiring (migration 017 gap closed):**
- `INTENSITY_PRESETS` map added to `launchLeague()`: `casual→{preset:'casual', prematch:3, live:5}`, `competitive/standard→{preset:'standard', prematch:4, live:8}`, `hardcore→{preset:'hardcore', prematch:6, live:12}`
- `vibe` answer from wizard (casual / competitive / hardcore) now maps to the correct preset
- `question_intensity_preset`, `prematch_question_budget`, `live_question_budget` added to `leagueData`
- Previously all leagues silently defaulted to STANDARD (4/8) regardless of vibe selection

**`spontix-store.js` — `_mapLeagueToDb()` extended:**
- Three new explicit mappings: `questionIntensityPreset → question_intensity_preset`, `prematchQuestionBudget → prematch_question_budget`, `liveQuestionBudget → live_question_budget`
- `SpontixStoreAsync.createLeague()`: passes all three fields from `data.*` into `_mapLeagueToDb()` call with defaults (standard / 4 / 8)

**`docs/TIER_ARCHITECTURE.md` — updated to v4 (2026-04-28):**
- Added `## CORE_MATCH_LIVE — Product Definition` section: product rationale, LIVE vs REAL_WORLD comparison table, tier behavior tables (player + venue), feed priority rule (LIVE always first, enforced by `lanePriority` sort in league.html)
- Added `## LIVE Cost Logic` section: ~305 API requests per 90-min match, ~$0.001–$0.003 OpenAI per question, why Starter must be limited to 3 answers, why the 3-min rate limit exists

**`CLAUDE.md` — `## LIVE SYSTEM — POST-MVP ACTIVATION PLAN` section added:**
- Current state table (what exists vs what does not)
- Target state (7 items to build)
- LIVE SYSTEM RULES (7 permanent rules — timing model, max active, rate limit, fallback, pool reuse, no event queue, football-only at launch)
- LIVE TIER ENFORCEMENT: safety rules (all tiers, enforced by code) vs monetization rules (per tier, enforced at answer submission)
- "What must be built" — 8 ordered implementation items (football adapter live detection, live quota check, question generation, timing helper, resolve-after computation, resolver live predicate handling, league.html answer gate, migration 021)
- Why live was deferred from MVP

**New file: `docs/LIVE_QUESTION_SYSTEM.md`** — 7 sections + pre-launch validation checklist:
1. System Overview — PREMATCH/LIVE/REAL_WORLD comparison table, feed priority rule
2. Generation Model — time-driven vs event-driven, 8-step generation flow, live context fields, match phase rules
3. Tier Integration — player tiers, venue tiers, safety vs monetization rules distinction
4. Timing Model — 3-timestamp model (visible_from / answer_closes_at / resolves_after), concrete examples for time-driven and event-driven questions
5. Question Types — allowed and forbidden patterns, blowout adaptation rules
6. Safety Rules — max 2 active, 3-min rate limit (time-driven only), fallback to holding card
7. Analytics — rejection log format with `stage: 'live_quality'`, 8 normalized live rejection codes (`too_obvious`, `duplicate_question`, `too_many_player_specific`, `poor_team_balance`, `low_quality_score`, `window_too_short`, `stale_match_state`, `low_base_value`), key metrics table, future migration 021 SQL views
8. Pre-Launch Validation Checklist — 34+ checkboxes across 6 categories

**`docs/PREMATCH_QUALITY_ANALYTICS.md` — `## Future Extension — LIVE Quality Analytics` section added:**
- Same analytics system will extend to `CORE_MATCH_LIVE` using `stage: 'live_quality'`
- Identical rejection log entry structure; two additional live-specific reason codes (`window_too_short`, `stale_match_state`)
- Future migration 021 will add `analytics_live_quality_summary` and `analytics_live_score_distribution` views
- Marked DO NOT IMPLEMENT — documentation only

**No pipeline changes.** No schema changes. No resolver changes. All live generation is post-MVP.

---

### 2026-04-28 — Prematch quality rules v2.2 (prompt + context signals)

**Goal:** improve prematch question quality so questions feel like a sports editor prepared them, not random AI guesses. Diverse, context-aware, non-obvious, resolvable, team-balanced, match-appropriate.

**`supabase/functions/generate-questions/lib/context-builder.ts`:**
- Added `MATCH ANALYSIS` section to the context packet for prematch mode
- Computes explicit signals from the full standings array (not the top-8-sliced view):
  - `home_position`, `away_position` — standings positions of each team
  - `standing_gap` — absolute position difference between the two teams
  - `match_type` — CLOSE_MATCH (gap ≤ 3) | MODERATE (gap 4–5) | HEAVY_FAVOURITE (gap ≥ 6)
  - `table_favourite`, `table_underdog` — team names derived from standings
  - `home_goal_diff`, `away_goal_diff` — from standings (signals scoring tendency)
- Inline warning messages when match_type = HEAVY_FAVOURITE or CLOSE_MATCH
- Graceful fallback to `match_type: UNKNOWN` when standings are incomplete for one or both teams
- Only injected for `generation_mode = "prematch"` — no effect on live generation

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `PROMPT_VERSION` bumped `v2.1` → `v2.2`
- Entire PREMATCH QUESTION RULESET replaced. Full changelog:

  **STEP 0 (new)** — explicit context reading step before generation begins:
  - Reads `match_type` and `standing_gap` from MATCH ANALYSIS section (no arithmetic required)
  - Records all BLOCKED and DOUBTFUL players before any question is written
  - Flags derby/rivalry matches and form streaks

  **Rule 1** — slot assignment restructured:
  - Model must assign structural slots (A/B/C/D/E) BEFORE writing question text
  - Hard limits: max 2 player_specific, max 2 outcome_state, min 1 underdog/away reference
  - Slot D explicitly MUST name the away team or underdog in question_text (for 4 questions)

  **Rule 2** — quality filters hardened:
  - Added explicit bans: half-time score, "score before minute X", lineup-confirmed start questions
  - Removed BTTS from "DO prefer" list — BTTS is not directly resolvable (see Rule 6 BTTS note)
  - Removed shots-based team angles — `shots_total` is not a valid resolver field
  - Added H2H and form-streak angles to preferred list

  **Rule 3** — match context adaptation rewritten around `match_type` field:
  - CLOSE_MATCH, HEAVY_FAVOURITE, RIVALRY/DERBY, LOW-SCORING, HIGH-SCORING, KEY PLAYER UNAVAILABLE, MODERATE — each has concrete question templates with exact predicate_hint formats
  - Removed: "Will [favourite] score in the first half?" (no half-time field)
  - Removed: "Will [favourite] win by 2+ goals?" (requires arithmetic on two fields, not supported)
  - Added correct resolvable alternatives for all removed templates
  - Slot D constraint on HEAVY_FAVOURITE: must involve the underdog

  **Rule 4** — team balance converted to two concrete binary checks
  - Check 1: at least 1 question_text contains away team or underdog name
  - Check 2: player questions from different teams (if two player slots filled)

  **Rule 5** — player gate unchanged in substance; predicate_hint format added for each allowed stat

  **Rule 6** — resolvability gate rewritten with exact field list:
  - Explicit: `shots_total` is NOT a valid match_stat field in the validator (double gap documented)
  - Added BTTS note: BTTS cannot be expressed as a single binary_condition; use `total_goals gte 2` as proxy
  - Removed `shots_total` from resolvable field list (was incorrectly listed in v2.1)

  **Rule 7** — diversity enforcement updated:
  - Added: stat field uniqueness (same field must not appear twice in one set)
  - Added: multiple_choice predicate_hint formats for all three common MC question types
  - Removed: "BTTS" from binary-to-multiple_choice suggestion examples

  **Rule 8** — self-check expanded from 8 to 9 binary checks:
  - Added: STAT UNIQUENESS check
  - All checks reframed as binary PASS/FAIL with explicit replacement instructions

**Validator gaps documented (no code fix needed at launch — noted for post-MVP):**
1. `shots_total` is in the prompt's historical text but NOT in `VALID_FIELDS` in `predicate-validator.ts` — any question using `shots_total` as a match_stat fails logic_validation and is silently rejected. Fix post-MVP: add `shots_total` to VALID_FIELDS and handle in `getMatchStatValue()` in the evaluator.
2. BTTS (both teams score) requires a conjunction predicate (home_score ≥ 1 AND away_score ≥ 1) — the current single binary_condition predicate schema cannot express this. Fix post-MVP: add a `btts` resolution_type or compound_condition support.

**No pipeline refactoring.** No schema changes. No resolver changes. No scoring changes.

---

### 2026-04-28 — docs/LIVE_QUESTION_SYSTEM.md safety rules + timing hardening

**Goal:** fix the remaining LIVE system issues: minimum gap correctness, event-driven window safety, overlapping window prevention, late-match edge cases, and real-time validation clarity.

**No code changes.** Documentation only.

**Changes:**
- **MINIMUM WINDOW GAP — HARD RULE** — minimum gap raised from 2 to 3 minutes (`window_start_minute − match_minute ≥ 3`). Rationale: 2-minute gap was insufficient; `visible_from` delay (up to 45s) + 90s minimum answer window = 135s minimum, which exceeds a 120s (2-minute) gap at the high end.
- **EVENT WINDOW SAFETY RULE** — event-driven questions must also satisfy `window_start_minute ≥ match_minute + 3`; ensures triggering event is never inside the prediction window; cannot be bypassed by the rate limit bypass
- **NO OVERLAPPING WINDOWS — HARD RULE** — no two active CORE_MATCH_LIVE questions may have overlapping `[window_start_minute, window_end_minute]` ranges; applies across all anchoring types; outcome/player questions exempt (resolve from match-wide stats)
- **LATE MATCH EDGE CASE RULE** — for `match_minute ≥ 87`: minimum gap reduced to 1 minute; for `match_minute ≥ 89`: always reject; added as explicit fallback rule (rule 5)
- **REAL-TIME VALIDATION RULE** — clarifies that all timing must be validated in real clock time via `minuteToTimestamp()`, accounting for halftime gap; both constraints must hold simultaneously or question is invalid
- `answer_window_overlap` rejection code threshold updated in analytics table from `< 2` to `< 3`
- Three anchored type definitions: `window_start_minute` now consistently states `match_minute + 3 (minimum)` with late-match exception noted
- Match minute adaptation table extended to 6 rows covering 85–87, 87–89, and ≥89 separately
- Timing example (minute 34) corrected: `window_start = 37` (was 36), reflects 3-minute minimum gap
- Late-phase example (minute 87) corrected to show the question being **rejected** — the 90s floor cannot be met at that minute
- Pre-launch checklist: 4 new items (match_minute ≥ 89 skip, event window safety, no overlapping windows, late-match rejection)

---

### 2026-04-28 — docs/LIVE_QUESTION_SYSTEM.md timing corrections

**Goal:** fix inconsistencies in the live question documentation so all examples, timing math, and rules are internally consistent and correct.

**No code changes.** Documentation only.

**`docs/LIVE_QUESTION_SYSTEM.md` changes:**
- **Relative time examples removed** — time-driven question type examples ("corner in the next 5 min", "2+ shots in the next 8 min") replaced with anchored equivalents ("goal between the 36th and 41st minute", "card before the 80th minute")
- **Corner examples removed from time windows** — corners are cumulative-only stats (no per-minute event data); removed from all `match_stat_window` examples; rule added to Forbidden Patterns section and pre-launch checklist
- **Timing example fixed (minute 34 FIXED WINDOW)** — `answer_closes_at = visible_from + ~4 min` was wrong (would land after `window_start_minute`); replaced with `answer_closes_at = kickoff + 35:50` derived from `window_start_minute` real match time. Same fix applied to the minute-67 event-driven example.
- **LIVE WINDOW VALIDATION — HARD RULE added** (Section 4) — explicit rule: a LIVE question is invalid if a ≥90-second answer window cannot fit before `window_start_minute`; system must select a later window or reject the question entirely
- **Event-driven delay clarified** — "fires immediately" replaced in Section 2 and Section 6 with "event detection fires immediately; question publication is delayed by 45–60 seconds to absorb broadcast and API latency differences"
- **Pre-launch checklist extended** — two new items: `answer_closes_at` must be derived from match clock (not `visible_from + duration`); reject-or-reselect rule for tight windows; `answer_window_overlap` description updated to reference the 90-second constraint; corner field ban added as a checklist item; live window UI strip checks added (3 items)

---

### 2026-04-28 — Unified LIVE timing system (prompt v2.4)

**Goal:** unify all LIVE question timing logic around three anchored question types. Eliminates relative phrasing ("next 5 minutes") entirely and enforces match-minute adaptation rules so question framing always makes sense at the current point in the match.

**`supabase/functions/generate-questions/lib/types.ts`:**
- `MatchStatWindowPredicate`: added `anchoring_type?: 'fixed_window' | 'deadline' | 'match_phase'` with inline doc comment explaining each type
- `RawGeneratedQuestion`: added `anchoring_type?: 'fixed_window' | 'deadline' | 'match_phase' | null` — OpenAI returns this in Call 1 output
- `RejectionLogEntry.stage` union: added `'live_timing_validation'` for the new validation check

**`supabase/functions/generate-questions/lib/predicate-validator.ts`:**
- `checkLogic()` for `match_stat_window`: window size maximum now depends on `anchoring_type`:
  - `fixed_window` (default): 3–7 min (unchanged, narrow span)
  - `deadline`: 3–45 min (can span to a milestone minute)
  - `match_phase`: 3–90 min (can span to half-time or full-time)
- New `checkLiveTiming()` function — stage `'live_timing_validation'`, skips prematch questions (`match_minute_at_generation == null`):
  - `relative_time_window_rejected` — scans `question_text` for 8 banned relative phrases ("in the next X minutes", "coming minutes", "shortly", etc.)
  - `invalid_live_window` — rejects `match_stat_window` where `window_start_minute <= match_minute_at_generation` (window in the past)
  - `answer_window_overlap` — rejects `match_stat_window` where `window_start_minute - match_minute_at_generation < 2` (less than 2 min gap for answer period)
- `validateQuestion()`: added `checkLiveTiming` to the checks array (runs after `checkLogic`, before `checkAvailability`)

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `PROMPT_VERSION` bumped `v2.3` → `v2.4`
- `TIMING` section updated: split into PREMATCH and LIVE descriptions; LIVE now points to `LIVE WINDOW CONSTANTS` in context rather than repeating timing math
- `LIVE_EVENT` section fully replaced — new structure:
  - **Three anchored question types** with exact format, `anchoring_type`, window size, timing source
  - **Match minute adaptation**: < 60 → FIXED+DEADLINE; 60–75 → all three; 75–85 → DEADLINE+MATCH PHASE; > 85 → ONLY "before full-time" (match_phase, window_end = 90)
  - **Banned phrases list** (8 patterns) — will be caught by `relative_time_window_rejected`
  - **Required phrasing** per type: "between the Xth and Yth minute" / "before the Yth minute" / "before full-time"
  - **Post-event framing** rules (goal → another goal; red card → card or goal)
  - **Predicate format** includes `anchoring_type` in hint string
  - **Distribution rules** for 2 questions: at least 2 different anchoring types
  - **Final type diversity check** (3 binary checks before output)
- `LIVE_GAP` section fully replaced — same three question types, same match minute adaptation, same banned phrases, same predicate format; differs only in timing buffers (20s delay, 2-min start buffer, 90s settle) and count (exactly 1)
- `OUTPUT FORMAT` updated: `anchoring_type` field added as REQUIRED for live questions, null for prematch

**Anchored window principles (permanent design constraints):**
- FIXED WINDOW questions ("between the 60th and 65th minute"): narrow 3–7 min span; ideal for early/mid game
- DEADLINE questions ("before the 75th minute"): wider span to milestone; adds urgency; ideal 60–85 min
- MATCH PHASE questions ("before full-time"): natural climax framing; ONLY valid type after minute 85
- Relative phrasing ("next 5 minutes") is permanently banned from live questions — unfair across TV delays
- All three types resolve via the same `match_stat_window` evaluator — no resolver changes required

**No resolver changes.** No DB schema changes. No pipeline restructuring. Code and prompt only.

---

### 2026-04-28 — Live window UI strip in league.html

**Goal:** surface the prediction window ("`Window: 60'–65'`" / "`Before 75'`" / "`Before full-time`") and the answer lock minute directly on each active LIVE card so users always know what they're predicting and when they must answer.

**`league.html`:**
- `resolution_predicate` added to the SELECT columns in `loadAndRenderQuestions()` — JSONB field is now available on every question object in the browser
- New `getWindowInfo(q)` helper — reads `q.resolution_predicate`; returns `{ start, end, type, field }` for `match_stat_window` predicates; returns `null` for all other types
- New `renderLiveWindowStrip(q)` function — builds a coral-tinted info strip:
  - **FIXED WINDOW** → "⚽ Prediction window: 60'–65' · 🔒 Answers lock before 60'"
  - **DEADLINE** → "⚽ Prediction window: Before 75' · 🔒 Answers lock before 63'"
  - **MATCH PHASE** → "⚽ Prediction window: Before full-time · 🔒 Answers lock before 87'"
  - Card emoji switches to 🟨 when `field = 'cards'`
- Strip is injected into `renderQuestionCard()` between the pre-match status strip position and the question text, but ONLY when `lane === 'LIVE' && state === 'active'` — no strip on closed, resolved, or voided cards
- New CSS `.live-window-strip`, `.lw-item`, `.lw-sep`: coral tint (`rgba(255,107,107,0.06)` bg, `0.15` border), flex layout, right separator between the two info items

**Rendering position in card:**
```
[ lane badge ]  [ engagement badges ]  [ time remaining ]
[ RW source label — Real World only ]
[ Pre-match status strip — PREMATCH only ]
[ Live window strip — LIVE match_stat_window only, active only ]   ← NEW
[ Question text ]
[ Options ]
[ Footer ]
```

**No backend changes.** No pipeline changes. No DB schema changes.

---

### 2026-04-28 — Live anchored match-minute window system (prompt v2.3)

**Goal:** replace vague relative live question windows ("next 5 minutes") with anchored match-minute windows ("between the 60th and 65th minute") that remain fair across all users regardless of TV/stream/API delay. Infrastructure laid for when live generation is activated post-MVP.

**`supabase/functions/generate-questions/lib/types.ts`:**
- New `MatchStatWindowPredicate` interface added:
  - `resolution_type: 'match_stat_window'`
  - `match_id`, `sport` (standard)
  - `field: 'goals' | 'cards'` — only fields with per-minute event granularity in API-Sports events timeline; corners excluded (cumulative only)
  - `operator`, `value` — standard binary condition
  - `window_start_minute`, `window_end_minute` — inclusive match-minute boundaries
- `ResolutionPredicate` union updated to include `MatchStatWindowPredicate`
- `RawGeneratedQuestion` extended with optional `window_start_minute?: number | null` and `window_end_minute?: number | null` for live anchored-window output
- `buildContextPacket` params extended with `matchMinute?: number | null` (wired for live generation)

**`supabase/functions/resolve-questions/lib/predicate-evaluator.ts`:**
- New `MatchEvent` interface exported: `{ time, extra, type, detail, team_id, team_name }`
- `MatchStats.events?: MatchEvent[]` — optional events timeline field (undefined = not available)
- New `evalMatchStatWindow()` function:
  - Counts `Goal` events (field=goals) or `Card` events (field=cards) within `[window_start_minute, window_end_minute]`
  - Returns `unresolvable` with reason `events_not_available` if `stats.events` is missing
  - Returns `unresolvable` with reason `invalid_window_minutes` if window_end ≤ window_start
  - Otherwise evaluates count against predicate using `applyOperator()`
- `case 'match_stat_window'` added to `evaluatePredicate()` switch

**`supabase/functions/resolve-questions/lib/stats-fetcher/football.ts`:**
- `MatchEvent` added to import from `predicate-evaluator.ts`
- New `readEventsFromCache(sb, matchId)` function: reads `events` JSONB from `live_match_stats` table; maps to `MatchEvent[]` shape; returns `null` if no row or no events
- `fetchFootballMatchStats()` now reads events in step 3 (before player stats) and includes `events` in the returned `MatchStats`
- Events are undefined (not null) when cache misses — evaluator handles gracefully with `unresolvable` outcome

**`supabase/functions/generate-questions/lib/predicate-validator.ts`:**
- `validTypes` array: added `'match_stat_window'`
- `checkSchema()`: full `match_stat_window` block — validates `match_id`, `field` (must be `goals` or `cards`), `operator`, `value` (number), `window_start_minute` (number), `window_end_minute` (number)
- `checkLogic()`: `match_stat_window` block — validates `window_end > window_start`, minimum window 3 min, maximum 7 min, start ≥ 1, end ≤ 120

**`supabase/functions/generate-questions/lib/context-builder.ts`:**
- New exported `minuteToTimestamp(kickoffIso, minute)` helper — converts match minute to UTC wall-clock timestamp; accounts for 15-minute halftime gap for minute > 45
- New `LIVE_WINDOW` constants object: all 9 timing values centralised (start buffers, window sizes, visible delays, settle buffers)
- `buildContextPacket` param `matchMinute?: number | null` added
- `match_minute` in context block now uses `matchMinute` param (was hardcoded `null`)
- New `LIVE WINDOW CONSTANTS` section injected for live modes when `matchMinute` is non-null: pre-computes `suggested_window_start_minute`, `answer_closes_at_for_window`, `resolves_after_for_window` — all as ISO timestamps so OpenAI doesn't need to do timestamp arithmetic
- `buildPredicatePrompt()` extended with Shape F: `match_stat_window` — trigger phrase, output schema, parse example

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `PROMPT_VERSION` bumped `v2.2` → `v2.3`
- `LIVE_EVENT` section fully replaced: proper rules for 1–2 questions, anchored-window timing, 3-min start buffer, `match_stat_window` predicate format, post-event framing, banned relative phrases
- `LIVE_GAP` section fully replaced: 1 question, 2-min start buffer, anchored windows only, context sensitivity (close/blowout/late phase)
- Output format extended: `window_start_minute` and `window_end_minute` added as optional fields
- Both live sections explicitly document: corners are NOT allowed in `match_stat_window`; ban on "next X minutes" phrasing

**Architectural rationale documented:**
- Anchored windows ("between 60th and 65th minute") are fair regardless of TV/stream/API delay — no user has a timing advantage
- Event data from `/fixtures/events` has `time.elapsed` (integer minutes) — goals and cards are fully minute-granular; corners have no such data (only cumulative totals from `/fixtures/statistics`)
- `events` on `MatchStats` is optional (`?`) — if `live_match_stats` has no events row, the predicate resolves as `unresolvable` (graceful degradation, not a crash)

**No DB migrations required.** No live generation pipeline changes (post-MVP). No existing test or generation flow affected — prematch generation is unchanged.

---

### 2026-04-28 — LIVE question system: deterministic overlap resolution + window selection priority + late-match generation rule

**Goal:** close final edge cases in the LIVE question system documentation and code — making overlap resolution fully deterministic, adding explicit window selection priority, and hardening the late-match generation rule to prevent any retries or fallbacks after minute 87.

**`supabase/functions/generate-questions/lib/predicate-validator.ts`:**
- `answer_window_overlap` threshold updated from `< 2` to `< 3` in both comment and code
- `MIN_GAP` constant added: `matchMinute >= 87 ? 1 : 3` — enforces the late-match gap exception
- Dynamic error message now includes the actual `MIN_GAP` value
- New **late-match hard reject block** added after the gap check: if `matchMinute >= 89` → return `valid: false` with `answer_window_overlap` stage — no window can be valid at this point
- Rationale comment added: `visible_from` delay (up to 45s) + 90s minimum = 135s > 120s (2-min gap)

**`docs/LIVE_QUESTION_SYSTEM.md`:**
- **LATE MATCH GENERATION RULE** added (new subsection after LATE MATCH EDGE CASE RULE):
  - If `match_minute ≥ 87`: MUST attempt MATCH PHASE only; if ≥90s window cannot fit → skip entirely; NO retries, NO alternative window shifting, NO fallback question types; show holding card
  - If `match_minute ≥ 89`: skip immediately without any attempt
  - Rationale: retrying at minute 87 produces rushed questions with <3 real clock minutes remaining
- **OVERLAP RESOLUTION RULE** (replaces vague "reject OR shift" phrasing in NO OVERLAPPING WINDOWS section):
  - Step 1: attempt a SINGLE window shift forward to next valid non-overlapping window
  - Step 2: re-validate ALL constraints (3-min gap, 90s window, event safety, match phase)
  - Step 3: if still overlapping OR violates any rule → reject
  - Hard constraints: never multiple shifts, never compress window below allowed minimum, never override anchoring type
- **WINDOW SELECTION PRIORITY RULE** added (new subsection in Section 4):
  - Always select the earliest valid non-overlapping window that satisfies all constraints
  - If multiple valid windows exist → pick the one closest to the current match minute
  - Ensures continuous engagement, no dead zones, predictable pacing
- **Timing example at minute 87** updated: explicitly shows the question must be rejected per LATE MATCH GENERATION RULE (no retries noted)
- **Pre-launch checklist** extended with 3 new items: late-match retry prevention, deterministic overlap resolution, window selection priority verification
- **Section 6 edge cases** updated: separate items for ≥89 hard reject and 87–88 rejection without retries; overlap edge case updated to reference single-shift rule

**No pipeline changes.** No DB schema changes. No resolver changes.

---

### 2026-04-28 — LIVE question generation pipeline implemented

**Goal:** implement the full CORE_MATCH_LIVE generation pipeline so the Edge Function automatically detects in_progress matches and generates live questions without manual context input. 5 files changed; prematch pipeline untouched.

**`supabase/functions/generate-questions/lib/types.ts`:**
- `GenerationMode` extended: added `'live_gap' | 'live_event'` (was `'match_preview' | 'narrative_preview' | 'narrative_only'`)
- New `LiveMatchContext` interface — all fields needed for live generation:
  `matchId, kickoff, homeTeamId/Name, awayTeamId/Name, matchMinute, matchPhase, homeScore, awayScore, isCloseGame, isBlowout, recentEvents[], lastEventType, lastEventMinute, activeWindows[], activeQuestionCount, generationTrigger, lastGenerationMinute`

**`supabase/functions/generate-questions/lib/context-builder.ts`:**
- `LIVE_WINDOW.timeDrivenStartBufferMinutes` fixed: `2 → 3` (aligns with LIVE_QUESTION_SYSTEM.md minimum gap rule)
- New exported `buildLiveContext(sb, leagueId, matchId, fixtureRow)` — returns `LiveMatchContext | null`:
  - Step 1: reads `live_match_stats` for score, status, minute, events; returns null if row doesn't exist yet (poller not yet run)
  - Step 2: reads most recent CORE_MATCH_LIVE question for the league+match to get `lastGenerationMinute`
  - Step 3: parses `events` JSONB — filters to events since `lastGenerationMinute` (or last 10 min if no prior question)
  - Step 4: detects goals and red cards (own goals excluded); sets `lastEventType` and `lastEventMinute`; determines `generationTrigger` (event_driven vs time_driven)
  - Step 5: reads pending CORE_MATCH_LIVE questions with open answer windows → extracts `match_stat_window` `window_start_minute/end_minute` into `activeWindows[]`
  - Match phase: `< 20 → early`, `< 70 → mid`, `≥ 70 → late`
  - `isCloseGame = scoreDiff ≤ 1`, `isBlowout = scoreDiff ≥ 3`

**`supabase/functions/generate-questions/lib/sports-adapter/football.ts`:**
- New exported `fetchInProgressFixturesFromCache(sb, leagueId, teamId?, scopeType)`:
  - Queries `api_football_fixtures` with `status_short IN ('1H', 'HT', '2H', 'ET')`
  - Filtered by `league_id` (full_league) or `home/away_team_id` (team_specific)
  - Returns raw DB rows (not SportMatch) — live branch needs `fixture_id`, `kickoff_at`, team data
  - Includes HT rows so the live branch can explicitly skip them

**`supabase/functions/generate-questions/index.ts`:**
- Imports extended: `SportsContext, LeagueClassification, GenerationMode` from types.ts; `buildLiveContext, minuteToTimestamp` from context-builder; `fetchInProgressFixturesFromCache` from sports-adapter/football
- New live generation loop added after prematch loop (before `finaliseRun()`):
  - Iterates all ai_enabled football leagues
  - Per league: fetches in_progress fixtures from cache
  - Per fixture: runs safety checks in order:
    1. **HT skip** — `status_short === 'HT'` → `skipReason: 'halftime_pause'`
    2. **buildLiveContext** — null return → `skipReason: 'no_live_stats_available'`
    3. **≥89 hard reject** → `skipReason: 'match_minute_too_late'`
    4. **Active cap** — `activeQuestionCount >= 2` → `skipReason: 'active_question_cap_reached'`
    5. **Rate limit** — time_driven only: query `CORE_MATCH_LIVE` questions created in last 3 min → `skipReason: 'rate_limit_3min_live'` (event_driven bypasses)
  - Builds `liveSportsCtx` (minimal SportsContext with the live match) and `liveCls` (LeagueClassification with priority=4)
  - Calls `buildContextPacket()` with all live fields populated from `liveCtx` (match phase, last event, active count, match minute)
  - Appends `LIVE MATCH STATE` section: current score, isCloseGame, isBlowout, generation_trigger, last event, active windows
  - Calls `generateQuestions()` — generates exactly 1 question
  - Fills timing: `visible_from = now + 20s (time_driven) or 45s (event_driven)`, `answer_closes_at = visible_from + 3 min` (default)
  - If predicate is `match_stat_window`: overrides `answer_closes_at = minuteToTimestamp(kickoff, window_start_minute)`, `resolves_after = minuteToTimestamp(kickoff, window_end_minute) + 90s (or 120s event_driven)`
  - Calls `validateQuestion()` — runs all 5 validation stages including `checkLiveTiming()`
  - Inserts directly into `questions` table (bypasses pool — live questions are not reused)
  - Always `question_type = 'CORE_MATCH_LIVE'`, `source_badge = 'LIVE'`, `reuse_scope = 'live_safe'`
  - Logs every outcome: `[live-gen] CORE_MATCH_LIVE generated...` or skip reason

**Safety properties preserved:**
- All MVP safety rules enforced: HT pause, ≥89 reject, 2-question active cap, 3-min rate limit (time_driven)
- Event_driven bypasses rate limit — exactly as documented
- Prematch pipeline completely unchanged — no shared code paths modified
- Pool system bypassed for live — no risk of live questions appearing in prematch pools
- `resolution_status: 'pending'` on all inserts — resolver idempotency guarantee maintained
- All 3 timestamps populated: `visible_from`, `answer_closes_at`, `resolves_after`

---

### 2026-04-28 — Migration 021: extend generation_mode CHECK for live modes

**Problem:** `generation_run_leagues.generation_mode` had a DB-level CHECK constraint (from migration 002) allowing only `'match_preview' | 'narrative_preview' | 'narrative_only'`. The live generation pipeline writes `'live_gap'` and `'live_event'` as `generationMode` values. Without this migration every `writeLeagueResult()` call from the live branch would fail with a Postgres constraint violation, making all live runs invisible in the audit tables.

**`backend/migrations/021_live_generation_mode.sql`** — ⚠️ **Run in Supabase SQL editor before deploying the updated Edge Function:**
- `DROP CONSTRAINT IF EXISTS generation_run_leagues_generation_mode_check` — removes the old inline constraint (auto-named by Postgres)
- `ADD CONSTRAINT generation_run_leagues_generation_mode_check CHECK (generation_mode IN ('match_preview','narrative_preview','narrative_only','live_gap','live_event'))` — adds expanded constraint
- Idempotent — safe to re-run

**Deploy order (MANDATORY):**
1. Run `021_live_generation_mode.sql` in Supabase SQL editor first
2. Then deploy `generate-questions` Edge Function: `supabase functions deploy generate-questions --no-verify-jwt`

Running the Edge Function before the migration will cause every live generation audit write to fail silently (console.warn logged, run continues). The generation itself would still work — questions would be inserted into `questions` — but the run audit in `generation_run_leagues` would be incomplete.

---

### 2026-04-28 — Migration 022: drop outdated skip_reason CHECK constraint

**Problem:** `generation_run_leagues.skip_reason` had a CHECK constraint (from migration 002) allowing only 6 original values. The pipeline uses 12+ skip reasons (`sport_not_supported_mvp`, `match_too_distant`, `no_matches_in_publish_window`, `halftime_pause`, `no_live_stats_available`, `match_minute_too_late`, `active_question_cap_reached`, `rate_limit_3min_live`, etc.). Every INSERT with a non-original skip_reason failed silently with error code 23514, causing `generation_run_leagues` to have no rows for most skipped leagues.

**`backend/migrations/022_drop_skip_reason_constraint.sql`** — ✅ Run:
- `DROP CONSTRAINT IF EXISTS generation_run_leagues_skip_reason_check` — removes the constraint entirely
- `skip_reason` is now a free-text audit field — no restriction needed
- Idempotent — safe to re-run

---

### 2026-04-28 — fetchInProgressFixturesFromCache() rewritten to use live_match_stats

**Problem:** `fetchInProgressFixturesFromCache()` in `sports-adapter/football.ts` queried `api_football_fixtures WHERE status_short IN ('1H', 'HT', '2H', 'ET')`. But `api_football_fixtures.status_short` is only ever set to `NS` (not started) when prematch fixtures are fetched — it is never updated to live statuses. The live-stats-poller updates `live_match_stats.status` every minute but never touches `api_football_fixtures`. Result: the live branch could never detect any in-progress matches.

**Fix (`supabase/functions/generate-questions/lib/sports-adapter/football.ts`):**
- Step 1: query `live_match_stats WHERE status IN ('1H', 'HT', '2H', 'ET')` — authoritative live status kept current by the poller
- Step 2: cross-reference `api_football_fixtures` for league/team scope filtering (`league_id` or `home/away_team_id`)
- Return merged rows with `status_short` aliased from `status` for consistent field naming in index.ts
- Deployed with `supabase functions deploy generate-questions --no-verify-jwt` ✅

---

### 2026-04-28 — Migration 023: live question analytics views

**Goal:** mirror the prematch analytics system (migration 020) for CORE_MATCH_LIVE questions so live generation quality can be monitored from day one.

**`backend/migrations/023_live_analytics_views.sql`** — ✅ Run:
- `analytics_live_quality_summary` — one row per day: `total_generated`, `total_rejected`, `rejection_rate`, `time_driven_runs` (live_gap), `event_driven_runs` (live_event), `skipped_runs`, `halftime_skips`, `rate_limit_skips`, `active_cap_skips`, `late_match_skips`, `no_stats_skips`, `total_cycles`
- `analytics_live_rejection_reasons` — one row per rejection_log entry from live runs: `day`, `league_id`, `generation_mode`, `stage`, `error`, `question_text`, `attempt`
- Both views granted SELECT to `authenticated` and `anon`
- Both return empty until first live generation cycle runs — correct behaviour

**Monitoring queries:**
```sql
-- Daily health
SELECT * FROM analytics_live_quality_summary ORDER BY day DESC LIMIT 7;

-- Rejection detail
SELECT day, stage, error, question_text
FROM analytics_live_rejection_reasons
ORDER BY day DESC LIMIT 20;
```

---

### 2026-04-28 — shots_total + BTTS fully resolved (prompt v2.5)

**Goal:** close the two remaining prematch pipeline gaps identified in audit — `shots_total` not in the validator's allowed field list, and BTTS having no resolution path.

**`supabase/functions/generate-questions/lib/types.ts`:**
- New `BttsPredicate` interface: `{ resolution_type: 'btts', match_id: string, sport: string }` — no `binary_condition`; resolver evaluates from match scores directly
- `ResolutionPredicate` union extended with `BttsPredicate`

**`supabase/functions/generate-questions/lib/predicate-validator.ts`:**
- `match_stat` VALID_FIELDS extended: `shots_total` added — questions predicting total shots now pass `logic_validation`
- `validTypes` extended: `'btts'` added
- `btts` schema check added (early return, before the `if/else` block) — requires only `match_id`, no `binary_condition`
- **Latent `match_stat_window` bug fixed**: the `match_stat_window` schema check was placed AFTER the `else` block that requires `binary_condition` for all non-MC types. Since `match_stat_window` predicates have no `binary_condition`, they would have failed schema validation the first time a live question went through the validator. Fix: moved `match_stat_window` handling to an early-return block BEFORE the `if/else`, matching the same pattern now used for `btts`.

**`supabase/functions/resolve-questions/lib/predicate-evaluator.ts`:**
- `case 'btts'` added to `evaluatePredicate()` switch
- New `evalBtts(stats)` function: `homeScore >= 1 && awayScore >= 1` → `correct`, otherwise `incorrect`
- `case 'shots_total'` added to `getMatchStatValue()`: sums `shots_total` across both teams from `teamStats` (field already populated by the stats-fetcher from `/fixtures/statistics`)

**`supabase/functions/generate-questions/lib/context-builder.ts`:**
- Shape G added to `buildPredicatePrompt()`: `btts` — trigger phrase `"btts"` in `predicate_hint`, output `{ "resolution_type":"btts", "match_id":string, "sport":string }`
- Valid fields list updated: `shots_total` added to `match_stat`, `btts` documented as its own type with no field

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `PROMPT_VERSION` bumped `v2.4` → `v2.5`
- Rule 6 (resolvability): `shots_total` moved from the DO NOT USE list to the `match_stat fields` list
- Rule 6: BTTS proxy (`total_goals gte 2`) replaced with the native `btts` type and its `predicate_hint` format; proxy note removed
- `home_shots`, `away_shots`, `shots_on_target` remain in the DO NOT USE list (only `shots_total` is valid)

**Both Edge Functions redeployed:** `generate-questions` + `resolve-questions`.

---

### 2026-04-28 — REAL_WORLD pipeline fully implemented

**Goal:** build the complete end-to-end REAL_WORLD question pipeline: 3-call OpenAI flow, two new predicate types, resolver support, deadline auto-void, and migration 024 DB columns.

**`backend/migrations/024_realworld_fields.sql`** — new migration (⚠️ run before deploying):
- `resolution_condition TEXT` — human-readable resolution criteria shown to users
- `resolution_deadline TIMESTAMPTZ` — auto-void deadline with 1h grace period
- `source_news_urls JSONB DEFAULT '[]'` — URLs of news articles that triggered the question
- `entity_focus TEXT CHECK IN ('player','coach','team','club')` — what entity the question is about
- `confidence_level TEXT CHECK IN ('low','medium','high')` — signal strength from news
- `rw_context TEXT` — Call 3 output: "why this question exists" snippet (shown to users)
- `idx_questions_resolution_deadline` index for deadline-based resolver queries

**`supabase/functions/generate-questions/lib/types.ts`:**
- New `MatchLineupPredicate` interface: `{ resolution_type:'match_lineup', match_id, sport, player_id, player_name, check:'starting_xi'|'squad' }` — resolves from `live_match_stats.lineups`
- New `ManualReviewPredicate` interface: `{ resolution_type:'manual_review', category:'coach_status'|'transfer'|'contract'|'disciplinary', description, resolution_deadline, source_urls[] }` — admin-resolved; resolver skips (leaves pending) until deadline
- `ResolutionPredicate` union: `MatchLineupPredicate | ManualReviewPredicate` added
- New `RawRealWorldQuestion` interface: `{ question_text, news_narrative_summary, confidence_level, resolution_type_suggestion, resolution_condition, resolution_deadline, source_news_ids[], entity_focus, predicate_hint, skip_reason? }`
- `ValidatedQuestion`: 6 new optional REAL_WORLD fields added (`resolution_condition`, `resolution_deadline`, `source_news_urls`, `entity_focus`, `confidence_level`, `rw_context`)
- `RejectionLogEntry.stage` union: `'real_world_generation'` added

**`supabase/functions/generate-questions/lib/predicate-validator.ts`:**
- `validTypes`: `'match_lineup' | 'manual_review'` added
- `manual_review` early-return schema check added BEFORE the `sport` field guard (manual_review has no sport field — must come first)
- `match_lineup` early-return schema check: validates `match_id`, `player_id`, `player_name`, `check` field
- No duplicate `manual_review` block (second instance removed)

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `RW_GENERATION_SYSTEM_PROMPT` added — Call 1 system prompt for REAL_WORLD generation
- `generateRealWorldQuestion(newsItems, leagueScope, upcomingMatch, knownPlayers, nowIso, apiKey)` added — returns `RawRealWorldQuestion | null` (null = model chose to skip)
- `RW_CONTEXT_SYSTEM_PROMPT` added — Call 3 system prompt
- `generateRealWorldContext(questionText, newsItems, confidenceLevel, apiKey)` added — returns plain-text context string
- `PROMPT_VERSION` bumped `v2.5` → `v2.6` (yellow_card event trigger + RW prompts)
- `last_event_type` enum in live prompts: `yellow_card` added
- POST-EVENT FRAMING: yellow_card framing added ("Will there be another card?" / "Will there be a goal?")

**`supabase/functions/resolve-questions/lib/predicate-evaluator.ts`:**
- `MatchStats.lineups?: any` field added — populated from `live_match_stats.lineups`
- `case 'match_lineup'` added to switch → `evalMatchLineup()`: checks player in `startXI` or `substitutes` in the lineup array; returns `unresolvable` if lineups not available yet
- `case 'manual_review'` added to switch → `unresolvable` with reason `'pending_admin_review'` (admin resolves manually; deadline auto-void in main loop)

**`supabase/functions/resolve-questions/lib/stats-fetcher/football.ts`:**
- `readLineupsFromCache()` added: reads `lineups` JSONB from `live_match_stats`
- `fetchFootballMatchStats()` step 4 (lineups) added: reads lineups before player stats step
- `lineups` included in returned `MatchStats`

**`supabase/functions/resolve-questions/index.ts`:**
- SELECT columns: `question_type`, `resolution_deadline`, `confidence_level` added
- **Deadline auto-void block** added at the top of the per-question loop: if `resolution_deadline` is set and `now > deadline + 1h grace` → void with `resolution_deadline_passed`
- **`manual_review` skip block** added: skips with `runStats.skipped++` (never auto-resolves; deadline void handles cleanup)

**`supabase/functions/generate-questions/index.ts`:**
- `generateRealWorldQuestion`, `generateRealWorldContext` added to import
- **REAL_WORLD generation pass** added between live loop and `finaliseRun()`:
  - Per league: REAL_WORLD quota check → fetch sports + news context → skip if no news
  - Call 1: `generateRealWorldQuestion` with league scope string + upcoming match string
  - Skip if null returned (weak signal)
  - Call 2: `convertToPredicate` on the predicate_hint
  - Call 3: `generateRealWorldContext` (non-fatal; rw_context = '' if fails)
  - Timing: `visible_from = now`, `answer_closes_at = deadline − 1h`, `resolves_after = deadline + 1h`
  - Validates via standard 4-stage validator
  - Inserts with all 6 REAL_WORLD-specific fields
  - Source URLs: all news item URLs included (since NewsItem.url is not sent to OpenAI, positional IDs can't be matched back)

**`supabase/functions/generate-questions/lib/context-builder.ts`:**
- `maxActiveQuestions` default: `2 → 3`
- Event detection: `yellow_card` and `Penalty Confirmed` (VAR) added to filter
- `lastEventType`: `'yellow_card'` union added; mapping updated

**`supabase/functions/generate-questions/index.ts`:**
- `MVP_MAX_ACTIVE_LIVE`: `2 → 3`

**Deploy order (MANDATORY):**
1. Run `024_realworld_fields.sql` in Supabase SQL editor
2. Deploy `generate-questions`: `supabase functions deploy generate-questions --no-verify-jwt`
3. Deploy `resolve-questions`: `supabase functions deploy resolve-questions --no-verify-jwt`

---

### 2026-04-28 — REAL_WORLD analytics views (migration 025)

**Goal:** mirror the prematch (migration 020) and live (migration 023) analytics pattern for REAL_WORLD questions. Source is the `questions` table filtered by `question_type = 'REAL_WORLD'` (the REAL_WORLD generation pass does not write to `generation_run_leagues`, unlike prematch/live).

**`backend/migrations/025_realworld_analytics_views.sql`** — ✅ run in Supabase SQL editor:
- `analytics_realworld_summary` — one row per day: `total_generated`, entity focus breakdown (`player/coach/team/club/unknown`), confidence level breakdown (`high/medium/low`), resolution type breakdown (`lineup/manual_review/match_stat/player_stat/btts`), lifecycle coverage (`with_context`, `with_deadline`, `with_resolution_condition`, `with_source_urls`), resolution outcomes (`pending/resolved/voided`), `overdue_pending` (deadline passed but still pending)
- `analytics_realworld_questions` — one row per question: `question_text`, `entity_focus`, `confidence_level`, `resolution_condition`, `resolution_deadline`, `predicate_type`, `manual_review_category`, `rw_context`, `has_context` boolean, `source_url_count`, `deadline_status` (`ok` / `overdue` / `no_deadline`), `league_name`
- Both views granted SELECT to `authenticated` and `anon`

**Monitoring queries:**
```sql
-- Daily health
SELECT * FROM analytics_realworld_summary ORDER BY day DESC LIMIT 7;

-- All questions
SELECT * FROM analytics_realworld_questions LIMIT 20;

-- Overdue (deadline passed, still pending — resolver should have voided these)
SELECT id, question_text, entity_focus, resolution_deadline
FROM analytics_realworld_questions WHERE deadline_status = 'overdue';

-- Missing context (Call 3 failed silently)
SELECT id, question_text, confidence_level
FROM analytics_realworld_questions WHERE has_context = false;
```

---

### 2026-04-28 — Full scoring formula activated + MVP section replaced

**`supabase/functions/resolve-questions/index.ts`:**
- Three MVP bypass constants removed: `difficulty_mvp`, `comeback_mvp`, `clutch_mvp`
- All six multipliers now computed and applied at runtime:
  - `difficulty` — read from `q.difficulty_multiplier` (was `difficulty_mvp = 1.0`)
  - `comeback` — computed by `computeComebackMultiplier(a.leader_gap_at_answer)` (was `comeback_mvp = 1.0`)
  - `clutch` — read from `a.clutch_multiplier_at_answer` (was `clutch_mvp = 1.0`)
- `finalPts = Math.max(0, Math.round(baseValue * timePressure * difficulty * streak * comeback * clutch))`
- `multiplier_breakdown` JSONB: `mvp_bypass: true` flag removed; now records actual computed values for all six multipliers
- Section comment updated to: "All six multipliers are active."

**`CLAUDE.md` — System Rules section:**
- Entire `# ⚠️ MVP EXECUTION CONTROL (MANDATORY)` section replaced with `# System Rules`
- Removed: launch target date, pre-launch gate language, scoring bypass table, LIVE "not implemented" status, "What must be built for LIVE activation", "Context: why this was deferred from MVP", pre-launch prohibitions
- Kept (reframed as permanent operational rules): 3-timestamp model, max 2 active questions, rate limits, fallback rules, resolver idempotency, answer submission uniqueness, football-only guard, graceful degradation, logging requirements
- LIVE system status table updated: all five components ✅ Complete
- Scoring formula table updated: all six multipliers active
- Protected systems table updated: migrations 001–036

---

### 2026-04-28 — REAL_WORLD feed UI (league.html)

**Goal:** make REAL_WORLD cards feel meaningfully different from CORE_MATCH cards. The "why this question exists" context was being generated (Call 3) and stored but never shown to users.

**`league.html` — SELECT updated:**
- Added 5 REAL_WORLD fields to the questions SELECT: `rw_context`, `confidence_level`, `entity_focus`, `resolution_deadline`, `source_news_urls`
- All fields are null for CORE_MATCH_PREMATCH and CORE_MATCH_LIVE questions — no impact on those cards

**`league.html` — new CSS (5 rules added before timer bar section):**
- `.rw-context` — italic, muted white, 0.78rem; the context snippet under the question text
- `.rw-confidence` — small uppercase pill badge; three variants:
  - `.high` — lime tint (`#A8E10C`)
  - `.medium` — orange tint (`#FF9F43`)
  - `.low` — coral tint (`#FF6B6B`)
- `.rw-footer-row` — flex row at the bottom of REAL_WORLD cards for deadline + sources
- `.rw-deadline` — "🗓 Resolves by D Mon YYYY"
- `.rw-sources-link` — purple link; hover underlines

**`league.html` — `renderQuestionCard()` updated (REAL_WORLD cards only):**

*`rwSource` block replaced with richer rendering:*
- Sub-label: `"Premium intelligence · AI-sourced"` + confidence badge inline
- Context block: `rw_context` text if present; falls back to `"Based on recent news around this league."` if null/empty

*New `rwFooterExtra` variable (empty for non-RW cards):*
- `resolution_deadline` → formatted as `🗓 Resolves by 28 Apr 2026`
- `source_news_urls` → `📰 View source` / `📰 View sources (N)` link to first URL, opens new tab
- Row only rendered if at least one field is non-null
- Injected after `footerHtml` in the card HTML output

**REAL_WORLD card anatomy (complete):**
```
[ REAL WORLD badge ]  [ engagement badges ]  [ time remaining ]
Premium intelligence · AI-sourced  [ HIGH confidence ]
"Why this question exists — the Call 3 context snippet."
─────────────────────────────────────────────────────────
Question text
─────────────────────────────────────────────────────────
[ Yes ]  [ No ]
─────────────────────────────────────────────────────────
[ 🕐 4m 30s left ]                    [ Up to 15 pts ]
🗓 Resolves by 2 May 2026  ·  📰 View sources (3)
```

**No backend changes.** No DB schema modifications. No pipeline or resolver changes. No scoring changes. CORE_MATCH_PREMATCH and CORE_MATCH_LIVE cards completely unaffected.

---

### 2026-04-28 — REAL_WORLD Call 3 upgraded to structured JSON output

**Goal:** replace plain-text `rw_context` with a structured JSON response from Call 3 that returns a curated source list (title + publisher + date + URL) so the feed can render titled, attributed source links rather than a generic "View sources (N)" count.

**`supabase/functions/generate-questions/lib/types.ts`:**
- New `RwContextSource` interface: `{ source_name, published_at, title, url }` — one curated news source
- New `RwContextResult` interface: `{ context, confidence_explanation, sources: RwContextSource[] }` — structured return type of Call 3

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `import` updated: added `NewsItem`, `RwContextResult` from `types.ts`
- `RW_CONTEXT_SYSTEM_PROMPT` replaced with the full structured prompt:
  - Context rules (fact-based only, 1–2 sentences, no predictions)
  - Confidence language table (low/medium/high)
  - Source selection rules (max 3, different publishers, most recent, relevance-ranked, no duplicates)
  - Output format: `{ context, confidence_explanation, sources[] }` JSON
- `generateRealWorldContext()` signature updated:
  - New params: `newsItems: NewsItem[]` (was anonymous object array), `teams: string`, `players: string`
  - Maps `NewsItem` fields to prompt's expected names (`headline → title`, `summary → snippet`, `sourceName → source_name`, `publishedAt → published_at`)
  - Added `response_format: { type: 'json_object' }` — forces deterministic JSON output
  - Return type changed: `Promise<string>` → `Promise<RwContextResult>`
  - Parses JSON; validates minimal shape; defaults gracefully if model returns partial output
  - Sources sliced to max 3

**`supabase/functions/generate-questions/index.ts`:**
- Call 3 block rewritten:
  - Builds `rwTeams` string from upcoming match + standings
  - Builds `rwPlayers` string from `sportsCtxRW.keyPlayers` (first 5)
  - Stores `rwCtxResult.context` → `rwContextText`
  - Stores `rwCtxResult.sources` → `sourceUrls` (array of objects, not strings)
- Fallback: if Call 3 fails, `sourceUrls` falls back to all raw news URLs as `[{ url }]` objects (backward compat)
- `rw_context` column insert: `rwContextText` (was `rwContext`)
- `source_news_urls` column insert: `sourceUrls` array of objects (was string array)

**`league.html` — source rendering updated:**
- New format (objects with `url`, `title`, `source_name`): renders up to 3 individual titled links — `📰 [Article title] · Publisher`; titles truncated to 55 chars
- Legacy format (plain URL strings): falls back to generic "View sources (N)" link
- `.rw-footer-row` CSS: changed from `flex-direction: row` to `column` so multiple source links each get their own line

**`source_news_urls` schema change (no migration needed — JSONB):**

| Before | After |
|---|---|
| `["https://bbc.co.uk/...", "https://sky.com/..."]` | `[{ "source_name": "BBC Sport", "published_at": "2026-04-28T...", "title": "Haaland ruled out...", "url": "https://..." }]` |

Old string-array entries (questions generated before this change) still render correctly via the legacy fallback path in `league.html`.

---

### 2026-04-28 — Google News RSS adapter replaces GNews

**Goal:** remove the GNews API key dependency and replace the basic keyword query system with a fully automatic, scored news pipeline that works for any league or team without manual configuration.

**`lib/news-adapter/google-news-rss.ts`** — new file, replaces `gnews.ts`:

*Step 1 — Query builder (`buildRssUrls()`):*
- **Team scope**: `("team_name" OR aliases)` + signal variant with `AND (injury OR ruled out OR suspension OR transfer OR coach OR lineup OR ...)`
- **League scope**: `("league_name" OR upcoming fixture teams)` + signal variant with same keyword set
- Produces 2 RSS URLs (BROAD + SIGNAL) per league — fetched concurrently
- URL: `https://news.google.com/rss/search?q=ENCODED_QUERY&hl=en-US&gl=US&ceid=US:en`
- No API key required

*Step 2 — Fetch + parse (`fetchRssFeed()` + `parseRssXml()`):*
- 8-second timeout per feed with `AbortController`
- Regex-based RSS XML parser (no DOM dependency) — handles CDATA sections, `<source>` tag, "Headline - Source Name" Google News title format
- Parses: `title`, `sourceName`, `url`, `publishedAt` (ISO), `snippet` (280 char truncated)

*Step 3 — Deduplication (`deduplicateArticles()`):*
- Groups articles by Jaccard word similarity (threshold 0.50) — same story → one entry
- Keeps best version per group: most recent first; tie-breaks by source credibility rank

*Step 4 — Entity extraction (`extractEntities()`):*
- **Teams**: string match against `knownTeams` list (from `upcomingMatches` + standings)
- **Players**: Title Case bigram detection in headline, filtered against team names + stopwords
- **Coach**: keyword match (`manager`, `sacked`, `appointed`, etc.)
- **Topic**: `injury` | `lineup` | `suspension` | `transfer` | `coach` | `other`

*Step 5 — Scoring (`scoreArticle()`):*
- **RELEVANCE** (0–25): team match (+15), second team (+5), signal keyword (+10)
- **FRESHNESS** (0–15): <6h=15, <24h=12, <48h=8, <72h=4, else=1
- **CREDIBILITY** (0–20): BBC/Sky/ESPN/Athletic/Reuters=20; Mirror/Sun/GiveMeSport=12; unknown=8
- **RESOLVABILITY** (0–25): injury/lineup/suspension=22–25; coach=18; transfer=15; other=5
- **IMPACT** (0–15): named player=12; coach story=10; multi-team=10; else=5
- **RISK** (−30 to 0): clickbait keywords=−10; <50 chars total=−15; irrelevant topic + no team=−20
- **Thresholds**: ≥80=GENERATE, 65–79=MAYBE, 50–64=CONTEXT_ONLY, <50=SKIP

*Step 6 — Output filter:*
- Passes GENERATE articles; falls back to MAYBE only when no GENERATE exists
- Maps to `NewsItem[]` (same type the rest of the pipeline consumes)
- Caps at 10 articles; logs a summary line per run

**`lib/news-adapter/index.ts`** — rewritten:
- Imports `fetchAndScoreNews` from `google-news-rss.ts` (not gnews)
- `_apiKey` param kept (prefixed `_`) for backward compat — completely ignored
- Derives `knownTeams` from `sportsCtx.upcomingMatches` + standings + `league.scoped_team_name`
- Derives `leagueAliases` from a built-in map of well-known league abbreviations (PL, UCL, EPL, etc.)
- No longer gates on API key presence — runs for every league unconditionally

**`index.ts` (generate-questions)**:
- `GNEWS_API_KEY` changed from `!` (required) to `?? ''` (optional) — missing key no longer breaks the pipeline

**What changed and what didn't:**

| | Before | After |
|---|---|---|
| API key required | ✅ `GNEWS_API_KEY` required | ❌ Not required |
| Query quality | Basic keyword strings | BROAD + SIGNAL RSS queries |
| Articles per run | 3 per query (GNews free tier cap) | 15 per feed × 2 feeds |
| Deduplication | Exact headline hash | Jaccard similarity grouping |
| Entity extraction | None | Teams, players, coach, topic |
| Scoring | None (accept all) | 5-dimension scored + thresholds |
| News freshness window | 7 days | 5 days |

**No DB schema changes.** `NewsItem` type unchanged. All downstream pipeline (Call 1, Call 2, Call 3, `source_news_urls`) unchanged.

---

### 2026-04-28 — REAL_WORLD soccer player database (migration 026)

**Goal:** additive player intelligence layer for the REAL_WORLD pipeline. Automatically discovers and ranks players from live match data. Enables a targeted PLAYER BOOST news query for injury/availability signals on high-relevance players.

**New migration: `026_realworld_player_database.sql`** — ⚠️ run before deploying Edge Functions:
- `teams` table — `PRIMARY KEY (sport, external_team_id)`. Auto-populated from lineups. Public read, service-role write via RPC.
- `players` table — `PRIMARY KEY (sport, external_player_id)`. Auto-populated from lineups. Same RLS.
- `team_players` join table — `PRIMARY KEY (sport, external_team_id, external_player_id)`. Tracks `relevance_score`, `last_seen_at`, `position`, `shirt_number`, `source`.
- `idx_team_players_by_relevance` index — for fast top-N reads per team
- `live_match_stats.events_synced BOOLEAN` column added — prevents re-incrementing on every done-match poll
- `sync_lineup_players(p_sport, p_home_id, p_home_name, p_away_id, p_away_name, p_players JSONB)` RPC — SECURITY DEFINER. Upserts teams + players + team_players in a single SQL batch. Uses `GREATEST()` so existing relevance scores are never downgraded.
- `sync_match_events(p_sport, p_events JSONB)` RPC — SECURITY DEFINER. Bumps relevance scores from goal/card events. Goal scorer: +8, assist: +6, card: +5. Caps at 100.

**Relevance scoring model:**
| Source | Score contribution |
|---|---|
| Starting XI (lineup) | +10 (base, set on first seen) |
| Substitute (lineup) | +4 (base) |
| Goal scored | +8 cumulative |
| Assist | +6 cumulative |
| Card received | +5 cumulative |
| Not seen in >90 days | Excluded from PLAYER BOOST query |
| Not seen in >30 days | Soft decay: score still stored, caller applies decay weight at read time |

**`supabase/functions/live-stats-poller/index.ts`:**
- After `lineups_polled = true`: builds array of all starters and subs from both teams; calls `sync_lineup_players` RPC in one DB round-trip
- After upsert when `isDone && !existing?.events_synced`: filters events to Goal/Card; calls `sync_match_events` RPC; marks `events_synced = true` to prevent re-incrementing on future polls

**`supabase/functions/generate-questions/lib/news-adapter/google-news-rss.ts`:**
- `NewsQueryParams` extended: `topPlayers?: string[]` — optional, up to 15 names, pre-sorted by relevance_score DESC
- `buildRssUrls()` extended: when `topPlayers.length > 0`, adds a third RSS URL:
  - Query: `("Player1" OR "Player2" OR ...) AND (TeamName) AND (SIGNAL_TERMS)`
  - Anchored to team context to suppress cross-league false positives
  - Capped at 12 player names to keep query length reasonable
  - Surfaces injury/availability/form news for high-relevance players that broad LEAGUE queries miss

**`supabase/functions/generate-questions/lib/news-adapter/index.ts`:**
- `fetchNewsContext()` signature extended: `topPlayers?: string[]` 4th param (optional, backward-compat)
- Passes `topPlayers.slice(0, 15)` to `fetchAndScoreNews`

**`supabase/functions/generate-questions/index.ts` — REAL_WORLD pass:**
- Before calling `fetchNewsContext`, queries `team_players` for top players from both teams in upcoming match
- Filters: `sport='football'`, `last_seen_at > now() - 90 days`, ordered `relevance_score DESC LIMIT 8` per team
- Joins with `players(name)` to get player names for the query
- Passes combined list (up to 16 names) to `fetchNewsContext` as `rwTopPlayers`
- Logs player names used in PLAYER BOOST for monitoring

**`supabase/functions/generate-questions/lib/openai-client.ts` — `RW_GENERATION_SYSTEM_PROMPT` rewritten:**
- Replaced generic 4-type prompt with 5 soccer-specific question types in priority order:
  1. **TYPE 1 — INJURY/AVAILABILITY** (highest) — match_lineup resolution; requires match_id
  2. **TYPE 2 — SUSPENSION/YELLOW CARD RISK** — player_stat (cards/yellow_cards); only if news names the player
  3. **TYPE 3 — MATCH-DRIVEN PLAYER FORM** — player_stat (goals/assists); only if form explicitly in news
  4. **TYPE 4 — COACH/CLUB STATUS** — manual_review (coach_status); medium/high confidence only
  5. **TYPE 5 — TRANSFER/OFFICIAL ANNOUNCEMENT** — manual_review (transfer); only if imminent (within days)
- STEP 0 added: explicit "read inputs before writing" checklist
- Priority order section: model always picks highest-priority valid signal; never blends two signals
- Predicate hint format expanded: yellow_cards field, match_lineup squad/starting_xi formats
- Quality rules: player_name must match news_items or known_players; TYPE 1 requires match_id; TYPE 2 requires player named in news
- Resolution deadline updated: match_lineup deadline = kickoff − 30 minutes (not kickoff + 2h — lineups released ~1h before kickoff)

**Architectural principle:**
- The player database is additive — it enhances the RW pipeline but doesn't break it if empty
- A fresh deployment with no team_players data still works: `rwTopPlayers = []` → no PLAYER BOOST query → falls back to BROAD + SIGNAL only (same behaviour as before)
- System is sport-extensible: `sport` field is a TEXT key on all three tables — hockey/tennis can follow the same pattern without schema changes
- NFL is NOT included (football/soccer only at launch)

**Deploy order:**
1. Run `026_realworld_player_database.sql` in Supabase SQL editor ✅
2. Deploy `live-stats-poller`: `supabase functions deploy live-stats-poller --no-verify-jwt` ✅
3. Deploy `generate-questions`: `supabase functions deploy generate-questions --no-verify-jwt` ✅
4. team_players will start populating automatically from the next live match polled by the poller

---

### 2026-04-28 — REAL_WORLD Call 4 quality gate

**Goal:** prevent low-quality REAL_WORLD questions from reaching users. The 3-call pipeline (generate / predicate / context) had no final quality check — a question that passed schema validation could still be generic, weakly news-linked, or have an obvious answer. Call 4 adds an LLM-based scorer between Call 3 and the DB insert.

**`supabase/functions/generate-questions/lib/types.ts`:**
- New `RwQualityResult` interface: `{ final_score, decision, breakdown: { news_link_strength, clarity, resolvability, relevance, uniqueness, risk }, reason }`
- `RejectionLogEntry.stage` union: `'rw_quality_score'` added

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `RwQualityResult` added to imports
- `RW_QUALITY_SYSTEM_PROMPT` constant added — the full 6-dimension scoring rubric with APPROVE/WEAK/REJECT thresholds, good/bad examples, and JSON output format
- New exported `scoreRealWorldQuestion(questionText, newsContext, sources, confidenceLevel, resolutionType, resolutionDeadline, entityFocus, apiKey)` → `Promise<RwQualityResult | null>`:
  - Model: `gpt-4o-mini`, `temperature: 0.0` (deterministic scoring)
  - `response_format: { type: 'json_object' }` — enforces clean JSON
  - Returns `null` on network/parse failure (caller treats null as WEAK — safe fallback)
  - Validates minimal response shape before returning

**`supabase/functions/generate-questions/index.ts`:**
- `scoreRealWorldQuestion` added to import
- Call 4 block inserted between Call 3 (context + sources) and timing/validation:
  - Builds input from assembled data: `rwContextText`, `sourceUrls`, `rawRW.confidence_level`, `rwPredicate.resolution_type`, `rawRW.resolution_deadline`, `rawRW.entity_focus`
  - `null` return → defaults to `score=65, decision=WEAK` (bad network day never silently empties the feed)
  - `REJECT` (<65) → `continue` — question is discarded, logged
  - `WEAK` (65–79) AND `runStats.generated > 0` → `continue` — a better question already published this run, skip the borderline one
  - `WEAK` AND `runStats.generated === 0` → allow through (nothing better exists yet)
  - `APPROVE` (≥80) → always allow through
- Quality score + decision appended to `narrative_context` on every inserted question: `[quality=87 decision=APPROVE]` — inspectable immediately in Supabase Table Editor without a new column

**Scoring system (6 dimensions, max 100):**

| Dimension | Range | What it measures |
|---|---|---|
| `news_link_strength` | 0–25 | How tightly the question is derived from the news |
| `clarity` | 0–15 | Ease of understanding |
| `resolvability` | 0–25 | Objective resolution path exists |
| `relevance` | 0–20 | Fan interest and impact |
| `uniqueness` | 0–15 | Real insight vs generic question |
| `risk` (penalty) | −30–0 | Genericness, obviousness, invalidity |

**Decision thresholds:**

| Score | Decision | Action |
|---|---|---|
| 80–100 | APPROVE | Always insert |
| 65–79 | WEAK | Insert only if `rwLeagueGenerated === 0` for this league in this run (per-league counter, not global) |
| 0–64 | REJECT | Discard, log, continue |

**What is logged:**
```
[rw-quality] league abc123 score=87 decision=APPROVE reason="Clearly derived from injury news..."
[rw-quality] league def456 score=42 decision=REJECT reason="Generic — could exist without news"
[rw-gen] REJECTED by quality gate for league def456
[rw-gen] WEAK question skipped (better already generated) for league ghi789
```

**Post-MVP:** add `rw_quality_score INTEGER` column and `rw_quality_breakdown JSONB` column to `questions` table for proper analytics queries — straightforward migration. Currently embedded in `narrative_context` for zero-migration inspectability.

---

### 2026-04-28 — REAL_WORLD pipeline audit fixes (8 surgical changes)

**Goal:** fix silent rejection of valid REAL_WORLD questions, correct WEAK publishing logic, and clean up minor issues identified in a post-implementation audit.

**`predicate-validator.ts`:**
- **Fix 1 — `checkAvailability` match_lineup exemption**: Added early return for `match_lineup` predicates at the top of `checkAvailability()`. TYPE 1 questions ("Will X return from injury to start?") are specifically about injured/suspended players — the injury is the news signal. The old code was systematically blocking the highest-value RW question type.
- **Fix 2 — `checkEntities` match_lineup exemption**: `validPlayerIds` is built from `ctx.keyPlayers` (injury/fitness list only, ~5–15 players). The player_id check now skips when `p.resolution_type === 'match_lineup'` — for lineup questions, the match_id check already validates the match; player identity is carried by `player_name` in the predicate. Prevents false rejections for players not on the injury list.

**`openai-client.ts`:**
- **Fix 3 — Call 1 skip signal**: `generateRealWorldQuestion()` now handles all skip forms: `{ skip: true }` (preferred), `{ skip_reason: "..." }` without `skip: true`, `{ SKIP: true }` (uppercase variant), and missing `question_text` entirely. Previously only `parsed.skip === true` was handled — any other form was treated as a real question with missing fields, causing downstream failures.
- **TYPE 4/5 deprioritisation in `RW_GENERATION_SYSTEM_PROMPT`**: TYPE 4 (coach status) now marked `FALLBACK ONLY — use only when no TYPE 1/2/3 signal exists`. TYPE 5 (transfer) now marked `LAST RESORT ONLY — prefer SKIP over TYPE 5`. Both types require admin resolution and always auto-void — generating them wastes the daily quota without delivering user value.

**`index.ts`:**
- **Fix 4 — Per-league WEAK counter**: Replaced `runStats.generated > 0` with `rwLeagueGenerated > 0` in the WEAK logic gate. `runStats.generated` is a global run counter — if any other league generated a PREMATCH or LIVE question earlier in the same run, all WEAK RW questions would be silently skipped. `rwLeagueGenerated` is initialised to 0 at the top of each league iteration and only incremented on successful RW insert.
- **Fix 5 — `player_ids` from predicate**: After Call 2 resolves `rwPredicate`, the predicate's `player_id` (present on `match_lineup` and `player_stat` predicates) is extracted into `rwPlayerIds` and written to both `rawForValidation.player_ids` and the DB insert `player_ids`. Previously always `[]` — player reference was only inside `resolution_predicate` JSONB.
- **Fix 8 — stale comment**: Updated "3-call pipeline" to "4-call pipeline" in the REAL_WORLD pass block comment.

**`quota-checker.ts`:**
- **Fix 6 — Pro monthly UTC**: `monthStart` for Pro monthly quota check changed from `new Date(now.getFullYear(), now.getMonth(), 1)` (local timezone) to `new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))` (UTC). Daily cap already used UTC — this makes the two quota checks consistent.

**`types.ts`:**
- **Fix 7 — `source_news_urls` type**: Changed from `string[]` to `Array<{ url: string; title?: string; source_name?: string; published_at?: string }>`. Matches the actual runtime type (objects from Call 3 structured output). No runtime change — Supabase JSONB is permissive — but TypeScript type system is now correct.

**Remaining known gap — ✅ RESOLVED in next session:**
- TYPE 2/3 `player_stat` questions about non-injured players — `checkEntities` exemption extended to cover `player_stat` when `questionType === 'REAL_WORLD'`. See update log entry `2026-04-28 — checkEntities player_stat exemption for REAL_WORLD`.

---

### 2026-04-28 — checkEntities player_stat exemption for REAL_WORLD

**Goal:** close the remaining known gap from the audit-fixes session. TYPE 2 (yellow-card risk) and TYPE 3 (form/goals/assists) REAL_WORLD questions produce `player_stat` predicates about fit, active players identified from news signals. These players will not appear in `ctx.keyPlayers` (the injury/fitness focus list, ~5–15 players) causing silent rejection at `entity_validation`.

**`supabase/functions/generate-questions/lib/predicate-validator.ts`:**
- `validateQuestion()` signature extended with optional 6th param: `questionType?: 'CORE_MATCH_PREMATCH' | 'CORE_MATCH_LIVE' | 'REAL_WORLD'`
- `checkEntities()` receives `questionType` as its 5th param
- New `isRealWorldPlayerStat` boolean: `questionType === 'REAL_WORLD' && p.resolution_type === 'player_stat'`
- Player ID check condition expanded: `p.player_id && p.resolution_type !== 'match_lineup' && !isRealWorldPlayerStat && !validPlayerIds.has(...)`
- Full rationale comment block added explaining the different exemption rules per predicate type and per lane

**`supabase/functions/generate-questions/index.ts`:**
- REAL_WORLD call site changed from `validateQuestion(..., 1)` to `validateQuestion(..., 1, 'REAL_WORLD')`
- PREMATCH call site (line 557) unchanged — no sixth argument
- LIVE call site (line 962) unchanged — no sixth argument

**Enforcement matrix after this change:**

| Lane | Predicate | player_id validation |
|---|---|---|
| CORE_MATCH_PREMATCH | any | Strict — must be in keyPlayers |
| CORE_MATCH_LIVE | any | Strict — must be in keyPlayers |
| REAL_WORLD | match_lineup | Exempt (Fix 2 from audit session) |
| REAL_WORLD | player_stat | Exempt (this fix) |
| REAL_WORLD | all others | Strict — must be in keyPlayers |

**No resolver changes.** No DB schema changes. No scoring changes. No pipeline restructuring. Two files changed.

---

### 2026-04-28 — REAL_WORLD pipeline second audit pass (7 fixes)

**Goal:** fix 7 issues identified in a second audit of the REAL_WORLD pipeline — covering silent failures in Call 1 validation, degraded Call 4 context, a dead field reference, enrichment gaps in source fallback, unsafe predicate generation without an upcoming match, incorrect `answer_closes_at` for different predicate types, and missing observability on no-signal skips.

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- **Fix 1 — Call 1 full field validation**: `generateRealWorldQuestion()` now validates all 7 required string fields (`news_narrative_summary`, `confidence_level`, `resolution_type_suggestion`, `resolution_condition`, `resolution_deadline`, `entity_focus`, `predicate_hint`) after the `question_text` null check. Invalid or missing fields return `null` (treated as skip). `confidence_level` and `entity_focus` enum values are normalised to `'medium'` / `'player'` when unrecognised. `resolution_deadline` is validated as a future ISO timestamp — past or non-parseable values return `null`. Prevents 7 partially-formed fields from silently propagating through Call 2 → Call 3 → Call 4.

**`supabase/functions/generate-questions/index.ts`:**
- **Fix 2 — Call 3 context pre-seeded**: `rwContextText` initialised from `rawRW.news_narrative_summary` before the Call 3 try block. Call 3 result overwrites only when non-empty. Ensures Call 4 always receives meaningful context even if Call 3 fails on a network error.
- **Fix 3 — `teamStandings` dead field reference**: `sportsCtxRW.teamStandings?.slice(0,2).map((t:any) => t.teamName)` replaced with `sportsCtxRW.standings?.slice(0,2).map((s) => s.team.name)`. `SportsContext` has `standings: StandingsEntry[]`; the `teamStandings` field never existed and always resolved to `undefined`, silently stripping team context from Call 3.
- **Fix 4 — Source fallback enrichment**: When no curated sources come back from Call 3, the fallback now builds `{ url, title, source_name, published_at }` objects from the `rwNewsItems` array (NewsItem fields). Previously built bare `{ url }` objects, which rendered as generic "View sources (N)" in the feed instead of titled, attributed links.
- **Fix 5 — No-match guard after Call 2**: After `convertToPredicate()` resolves, `rwPredType` is extracted from the predicate. If `rwPredType` is `'match_lineup'` or `'player_stat'` and `upcomingMatch` is null, the question is skipped with a log entry. Without this guard, these predicates would insert with an empty `match_id`, causing the resolver to void them every single time.
- **Fix 6 — `answer_closes_at` per predicate type**: `answer_closes_at` and `resolvesAfter` now computed based on `rwPredType`:
  - `match_lineup` → `answer_closes_at = deadline` (kickoff−30min); `resolves_after = deadline + 90min`
  - `player_stat` / `match_stat` / `btts` → `answer_closes_at = kickoff`; `resolves_after = deadline + 30min`
  - `manual_review` (and all others) → `answer_closes_at = deadline − 24h`; `resolves_after = deadline + 60min`
  Previously all REAL_WORLD questions used `answer_closes_at = deadline − 1h` — TYPE 2/3 player_stat questions closing 1h before the resolution deadline meant they accepted answers during an in-progress match.
- **Fix 7 — No-news-signal skip observability**: Added `console.log` when the news pass is skipped with `rwNewsUnavailable || rwNewsItems.length === 0`. Logs `skipReason: no_news_signal, items=N, unavailable=true/false` — previously a silent continue with no log output.

**No resolver changes.** No DB schema changes. No scoring changes. No pipeline restructuring. Two files changed. generate-questions redeployed.

---

### 2026-04-28 — REAL_WORLD third audit pass (5 fixes)

**Goal:** fix 5 issues found in a third audit — one critical (TYPE 2 questions completely broken), two major (unguarded null match_id, wrong team context for scoped leagues), two minor (resolver observability, entity metadata mismatch).

**`supabase/functions/generate-questions/lib/predicate-validator.ts`:**
- **Fix 1 — `yellow_cards` added to VALID_FIELDS**: `player_stat` VALID_FIELDS extended from `['goals', 'assists', 'shots', 'cards', 'minutes_played', 'clean_sheet']` to include `'yellow_cards'`. The RW_GENERATION_SYSTEM_PROMPT TYPE 2 prompt instructs the model to use `field=yellow_cards` but the validator was rejecting it as invalid — all TYPE 2 (suspension/yellow-card risk) questions were silently failing logic_validation and never reaching the DB.

**`supabase/functions/resolve-questions/lib/predicate-evaluator.ts`:**
- **Fix 1 (continued) — `yellow_cards` resolver case**: Added `case 'yellow_cards': return p.yellow_cards;` to `getPlayerStatValue()`. Without this, even a question that somehow passed validation would return `null` at resolution (unresolvable). The existing `cards` case returns `yellow_cards + red_cards` — separate field for when the question is specifically about yellow cards only.

**`supabase/functions/generate-questions/index.ts`:**
- **Fix 2 — Extended no-match guard**: `MATCH_REQUIRED_TYPES` constant replaces the inline check. Now covers `['match_lineup', 'player_stat', 'match_stat', 'btts']` (was only `match_lineup` and `player_stat`). `match_stat` and `btts` predicates require a `match_id` to resolve — without an upcoming match they insert `match_id: null` and are immediately voided by the resolver with `no_match_id`, wasting the daily quota.
- **Fix 3 — `scoped_team_name` in Call 3 context**: `league.scoped_team_name` added to the `rwTeams` array before the standings slice. For team-specific leagues with no upcoming match, the previous code sent the top-2 standings teams (unrelated to the scoped team) to Call 3. An Arsenal-scoped league might have received "Real Madrid, Barcelona" as team context. Now always includes the scoped team name when set.
- **Fix 5 — `entity_focus` cross-validation**: After Call 2 resolves `rwPredType`, a normalisation block checks that `entity_focus` is consistent with the predicate type. `match_lineup`/`player_stat` → must be `'player'` (normalised if not). `match_stat`/`btts`/`match_outcome` → must be `'team'` or `'club'` (normalised to `'team'` if not). `manual_review` accepted as-is (coach/player/team all valid depending on category). Logs a warning on normalisation. The `entity_focus` value now stored in DB is the normalised value, not the model's raw output.

**`supabase/functions/resolve-questions/index.ts`:**
- **Fix 4 — `manual_review` skip logging**: Added `console.log(\`[resolve] skipping manual_review question ${q.id} (pending admin action, deadline=${q.resolution_deadline})\`)` before the `continue`. Previously silent — no way to tell from resolver logs which manual_review questions were pending.

**Both Edge Functions redeployed.** No DB schema changes. No scoring changes.

---

### 2026-04-28 — REAL_WORLD fourth audit pass (4 fixes)

**Goal:** fix 4 bugs confirmed in a gap audit of the REAL_WORLD pipeline — one critical resolver correctness issue, two major silent-rejection issues, one minor quality-score accuracy issue.

**`supabase/functions/resolve-questions/lib/predicate-evaluator.ts`:**
- **Fix 1 — `evalMatchLineup` partial lineup guard**: Added `if (lineupArr.length < 2) return { outcome: 'unresolvable', reason: 'lineups_incomplete' }` after building `lineupArr`. Previously, if the API returned only one team's lineup (partial response), a player from the missing team fell through to `return { outcome: 'incorrect' }` — resolving the question as NO with wrong certainty. Now returns `unresolvable` so the resolver retries on the next cycle when both lineups are available.

**`supabase/functions/generate-questions/index.ts`:**
- **Fix 2 — `match_lineup` near-kickoff guard**: Added a pre-check immediately after the `MATCH_REQUIRED_TYPES` guard. If `rwPredType === 'match_lineup'` and `rawRW.resolution_deadline` is less than 2 minutes away, the question is skipped with a log entry. Without this, `Math.max(deadlineMs, nowRW)` clamped `answer_closes_at` to now — the temporal validator rejected with a minimum-window violation after all 4 OpenAI calls had already been consumed.
- **Fix 3 — `match_lineup` `check` field normalisation**: Added `(rwPredicate as any).check = 'squad'` when the field is absent after Call 2. The validator rejects `undefined` (valid values: `starting_xi | squad`). The resolver's `pred.check ?? 'squad'` default was never reached because the validator ran first. Normalising before `validateQuestion()` closes the gap — valid lineup questions are no longer silently dropped for a missing optional field.
- **Fix 4 — Call 4 `normalisedEntityFocus` argument**: `scoreRealWorldQuestion()` now receives `normalisedEntityFocus` (computed after entity/predicate cross-validation at ~line 1184) instead of `rawRW.entity_focus` (raw model output). The quality scorer was penalising entity/predicate type mismatches that had already been corrected before DB insert — unfairly reducing scores and increasing REJECT outcomes for otherwise valid questions.

**Both Edge Functions redeployed.** No DB schema changes. No scoring changes. No pipeline restructuring.

---

### 2026-04-28 — REAL_WORLD fifth audit pass (8 fixes)

**Goal:** fix 8 bugs identified in a fifth gap audit — two critical timing bugs causing systematic auto-void on every REAL_WORLD question, and 6 additional correctness/efficiency issues.

**`supabase/functions/resolve-questions/index.ts`:**
- **Fix 2 (resolver side) — lineup retry not void**: Added `LINEUP_RETRY_REASONS` Set containing `'lineups_not_available'` and `'lineups_incomplete'`. When `evaluatePredicate` returns `unresolvable` with either reason, the resolver now increments `skipped` and continues (retries next cycle) instead of voiding. Lineups may simply not be in the cache yet — voiding on the first attempt discards valid match_lineup questions before kickoff.

**`supabase/functions/resolve-questions/lib/stats-fetcher/football.ts`:**
- **Fix 5 — null score FT fallback**: Added `cacheIsIncomplete` check: if `api_football_fixtures` has a finished status (`FT`/`AET`/`PEN`) but `home_goals === null && away_goals === null`, the cache is incomplete (race condition — poller hasn't written scores yet). Falls back to direct API call instead of coercing null → 0. Null → 0 produced wrong BTTS (`0:0 = false` instead of `unresolvable`) and wrong match_stat scores. Logs a warning when this path is taken.

**`supabase/functions/resolve-questions/lib/predicate-evaluator.ts`:**
- **Fix 6 — partial lineup optimistic check**: `evalMatchLineup` now checks whether the player IS in the available entries before returning `unresolvable('lineups_incomplete')`. If the player is found in a partial response (one team's lineup), returns `correct` immediately. Only returns `unresolvable` if the player is NOT found — they may be in the missing team's data. Maintains the original safe behaviour for the not-found case.

**`supabase/functions/generate-questions/index.ts`:**
- **Fix 1 — `manual_review` resolvesAfter timing**: `resolvesAfter` for `manual_review` predicates changed from `deadline + 1h` to `deadline`. The auto-void fires when `now > deadline + 1h`. With the old timing, a manual_review question entered the resolver at exactly the moment auto-void fired — every question was voided on its first pass. Now `resolvesAfter = deadline` gives the admin a full extra hour before auto-void without the race.
- **Fix 2 (generator side) — `match_lineup` resolvesAfter timing**: `resolvesAfter` for `match_lineup` predicates changed from `kickoff + 60min` to `kickoff` (using `upcomingMatch.kickoff` or `deadlineMs + 30min` fallback). Auto-void fires at `kickoff + 30min` (= `deadline + 30min`). With the old timing of `resolvesAfter = kickoff + 60min`, the question entered the resolver 30 minutes after auto-void had already fired — never evaluated.
- **Fix 3 — near-kickoff guard extended from 2min → 30min**: The `checkTemporal` stage requires `deadline >= now + 30min`. The previous guard of `< 2min` left a 28-minute window where all 4 OpenAI calls were consumed before the validator rejected with a timing violation. Extended to `< 30min` to match the validator's floor — now skips before spending any tokens.
- **Fix 4 — `manual_review` `resolution_deadline` backfill**: After Call 2, `manual_review` predicates lack a `resolution_deadline` field (Call 2 builds from `predicate_hint` which contains no deadline). Added backfill: `(rwPredicate as any).resolution_deadline = rawRW.resolution_deadline`. Without this, all `manual_review` questions fail `checkSchema` and are rejected post-Call-4 — wasting all 4 tokens.
- **Fix 7 — dead `checkRealWorldQuota` filter removed from prematch pool loop**: `checkRealWorldQuota()` was called inside the prematch pool attach loop and used to filter out pool questions where `computeLane()` returned `'REAL_WORLD'`. But pool questions are always `CORE_MATCH_PREMATCH` — `computeLane()` never returns `REAL_WORLD` for them. The filter was a no-op that made one DB query per league per run. Removed entirely.
- **Fix 8 — `btts` mapped to `'match_stat'` for Call 4**: `scoreRealWorldQuestion()` was receiving `'btts'` as `resolutionType`. The `RW_QUALITY_SYSTEM_PROMPT` lists `match_stat`, `player_stat`, `match_lineup`, `manual_review` as known types — `btts` is not listed. Seeing an unknown type triggered the risk penalty (−30) and REJECT on otherwise valid BTTS questions. Now passes `rwPredType === 'btts' ? 'match_stat' : rwPredicate.resolution_type` to the scorer.

**Both Edge Functions redeployed.** No DB schema changes. No scoring changes.

---

### 2026-04-28 — REAL_WORLD sixth audit pass (8 fixes)

**Goal:** fix 3 critical bugs causing zero REAL_WORLD questions to ever reach the DB plus 5 major correctness/efficiency issues identified in a comprehensive gap audit.

**`supabase/functions/generate-questions/index.ts`:**
- **C1 — dead `rwQuota` ReferenceError deleted**: A stale `if (!rwQuota.allowed)` block was left in Phase C (prematch pool attach) after the 5th pass removed the `checkRealWorldQuota()` call. `rwQuota` was undefined in prematch scope → ReferenceError crashed the entire prematch generation pass for every league. Deleted the entire 10-line filter block.
- **C2 — `match_id` added to `upcomingMatchStr`**: Call 1 received `"Home vs Away (kickoff: ISO)"` — no match_id. The model fabricated numeric IDs that passed schema validation (string check only) but resolved against wrong fixtures. Fixed by including `match_id: ${m.id}` in every match string.
- **C3 — `manual_review` resolvesAfter = deadline+91min**: 5th pass set `resolvesAfter = deadline`. `checkTemporal` requires `resolvesAfter >= deadline + 90min`. One minute too early — temporal validation failed after all 4 OpenAI calls, every time. Fixed to `deadline + 91min` — clears the 90-min floor while still ensuring the resolver sees the question before auto-void fires at `deadline + 60min`.
- **M3 — `mergedKnownPlayers` wired to Call 1**: `generateRealWorldQuestion()` now receives `mergedKnownPlayers` (team_players DB + keyPlayers injury list) instead of only `sportsCtxRW.keyPlayers`. Fit squad players had no player_id in the hint — Call 2 couldn't build valid predicates for TYPE 2/3 questions.
- **M4 — all upcoming matches passed to Call 1**: `upcomingMatchStrings[]` (up to 3 matches) replaces single `upcomingMatchStr`. Model selects the most relevant fixture. Post-Call-2: `upcomingMatch` resolved by matching predicate's `match_id` against all upcoming matches (falls back to [0] if no match). STEP 0 + TYPE 1 prompt updated to reference `upcoming_matches[]`.
- **M6 — `match_lineup` deadline = kickoff, guard = 60min**: `resolution_deadline` overridden to `upcomingMatch.kickoff` (was `kickoff - 30min` from model). Auto-void now fires at `kickoff + 1h` giving resolver a full hour of retries. Near-kickoff guard extended from 30min to 60min (lineups released ~1h before kickoff).

**`supabase/functions/generate-questions/lib/predicate-validator.ts`:**
- **M1 — extended player_stat VALID_FIELDS**: Added `passes_total`, `passes_key`, `dribbles_attempts`, `dribbles_success`, `tackles`, `interceptions`, `duels_total`, `duels_won`. TYPE 2/3 RW questions using these fields were silently rejected by logic_validation.

**`supabase/functions/generate-questions/lib/quota-checker.ts`:**
- **M2 — daily cap fail-safe**: `if (dailyErr) return { allowed: false, skipReason: 'real_world_quota_check_failed' }` added before the daily count check. Previously a DB error silently allowed a second REAL_WORLD question through (fail-open). Both count queries changed from `select('*')` to `select('id')` to avoid fetching full row data.

**`supabase/functions/generate-questions/lib/news-adapter/index.ts`:**
- **M5 — `standings` field fix**: `sportsCtx.teamStandings` (non-existent field) replaced with `sportsCtx.standings?.map(s => s.team.name)`. Was silently stripping all standings team names from `knownTeams` — the PLAYER BOOST query and entity matching had no standing team context.

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- **PROMPT_VERSION bumped to v2.7**: `upcoming_match` → `upcoming_matches[]` in user content; STEP 0 updated; TYPE 1 match_id instruction updated.

**Both Edge Functions redeployed.** No DB schema changes. No resolver changes. No scoring changes.

---

### 2026-04-29 — Migration 027: rw_quality_score + rw_quality_breakdown columns

**Goal:** move Call 4 quality gate results from an embedded `narrative_context` suffix into proper DB columns so they are queryable, indexable, and visible in analytics.

**New migration: `027_rw_quality_score.sql`** — ✅ run:
- `rw_quality_score INTEGER` added to `questions` — the raw 0–100 Call 4 score
- `rw_quality_breakdown JSONB` added to `questions` — the six-dimension breakdown object (`news_link_strength`, `clarity`, `resolvability`, `relevance`, `uniqueness`, `risk`)
- `idx_questions_rw_quality_score` partial index (WHERE `question_type = 'REAL_WORLD'`)
- Backfills `rw_quality_score` from the old `[quality=N decision=X]` suffix already in `narrative_context`
- Strips the suffix from `narrative_context` on all existing rows — field now holds clean text only
- Drops and rebuilds `analytics_realworld_questions` and `analytics_realworld_summary` with quality columns

**`supabase/functions/generate-questions/index.ts`:**
- `narrative_context` now stores only `rawRW.news_narrative_summary` — no suffix
- `rw_quality_score: rwScore` and `rw_quality_breakdown: rwQuality?.breakdown ?? null` written to DB columns
- WEAK fairness counter renamed `rwLeagueGenerated` → `rwLeagueApproved` — name now accurately reflects that it only increments on APPROVE decisions, not on WEAK publishes
- Success log line now includes `score=N decision=X` inline

**`analytics_realworld_summary` — new columns:**
- `approve_count`, `weak_count`, `reject_count`, `unknown_score_count`, `avg_quality_score`

**`analytics_realworld_questions` — new columns:**
- `rw_quality_score`, `quality_decision` (approve/weak/reject/unknown derived label), `rw_quality_breakdown`

**generate-questions redeployed.** No resolver changes. No scoring changes.

---

### 2026-04-29 — REAL_WORLD Call 1 prompt v2.8: news-signal-first generation

**Goal:** eliminate generic and news-detached REAL_WORLD questions by enforcing a hard traceability constraint directly in the Call 1 system prompt. Questions that would exist without a specific news signal must be skipped before any tokens are spent on Call 2–4.

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `PROMPT_VERSION` bumped `'v2.7'` → `'v2.8'`
- `RW_GENERATION_SYSTEM_PROMPT` fully replaced with new v2.8 structure:

**CORE RULE (hard constraint, opening of prompt):**
> A question MUST ONLY be generated if there is a clear, specific news-driven trigger. If no strong, concrete signal exists → return `{ "skip": true }`. DO NOT generate fallback or generic questions.

**STEP 0 — explicit pre-writing checklist (6 steps):**
1. Read every news_item headline + summary
2. Identify the exact piece of news that creates a prediction-worthy signal
3. Ask: "What specific statement or implication from the news caused this question?" → if unanswerable → SKIP
4. Check upcoming_matches[] — pick the match whose teams match the news story
5. Check known_players — find the player_id if the story names a player
6. Apply the QUALITY BAR — if any answer is "no" → SKIP

**WHAT COUNTS AS A VALID NEWS SIGNAL (6 categories):**
1. Player availability uncertainty
2. Lineup expectation
3. Strong player form — explicitly stated in news
4. Disciplinary context
5. Coach / club situation with immediate match impact
6. Imminent event tied to the upcoming match

**WHAT IS STRICTLY FORBIDDEN (explicit banned list):**
- "Will Player X score?" — unless news explicitly reports recent scoring form
- "Will Player X get a yellow card?" — unless news flags suspension risk specifically
- "Will Team X win?" — never
- Any question that would exist WITHOUT the news signal
- Questions based on vague match previews with no specific uncertainty
- Questions where the outcome is >85% or <15% certain
- Questions based on rumour-only with no objective resolution path

**TRACEABILITY RULE:**
> The question MUST be traceable to a specific statement or implication from the news. Model internally verifies: "What exact piece of news caused this question?" — if unanswerable → SKIP.

**QUALITY BAR — 4 checkboxes (all must be YES):**
- Is this question clearly derived from a specific news item?
- Would this question exist WITHOUT the news? (If yes → SKIP)
- Is it specific and tied to a real upcoming match?
- Does it have a clear, objective YES/NO resolution path?

**TYPE 1–5 hardened with explicit "Hard rule:" labels.** TYPE 4 marked "FALLBACK ONLY"; TYPE 5 marked "LAST RESORT — prefer SKIP over TYPE 5".

**Retained from v2.7:** all predicate hint formats (7 shapes), resolution deadline rules, confidence level definitions, priority order, `upcoming_matches[]` handling, `known_players` format.

**`docs/REAL_WORLD_QUESTION_SYSTEM.md`:** Call 1 section updated — CORE RULE, STEP 0 checklist, valid signal categories, forbidden list, traceability rule, QUALITY BAR, and updated type table all documented.

**generate-questions redeployed.** No resolver changes. No DB schema changes. No scoring changes.

---

### 2026-04-29 — REAL_WORLD hard match binding (all predicates, 48h window)

**Goal:** enforce that every REAL_WORLD question is specific prematch intelligence bound to a single upcoming match — not a generic background news question that could apply to any week.

**`supabase/functions/generate-questions/index.ts`:**

*48h target match filter (before Call 1):*
- `targetMatches` computed from `sportsCtxRW.upcomingMatches` filtered to `0 < msUntilKickoff <= 48h`
- If `targetMatches.length === 0` → `continue` (log: `no upcoming match within 48h`)
- Only `targetMatches` (not all upcoming) are passed to Call 1 as `upcomingMatchStrings`

*Strict binding validation (after Call 2):*
- `rwPredicateMatchId` extracted from `rwPredicate.match_id`
- `upcomingMatch` resolved by looking up `rwPredicateMatchId` against `targetMatches` ONLY — no fallback to `[0]`
- If `upcomingMatch === null` (missing or non-target match_id) → `continue` with log `real_world_match_binding_failed`

*Removed: `MATCH_REQUIRED_TYPES` guard* — now redundant since all types require a bound match via the new universal guard.

*`manual_review` timing updated:*
- `answer_closes_at` changed from `deadline − 24h` to `kickoff` — users cannot change their TYPE 4/5 answer once the match starts
- `resolvesAfter` unchanged: `deadline + 91 min`

*`rawForValidation` and `rwQuestion` insert:*
- `match_id` and `team_ids` are now unconditional (no `?.` fallback) — `upcomingMatch` is guaranteed non-null at this point

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- `PROMPT_VERSION` bumped `v2.8` → `v2.9`
- `TARGET MATCH CONSTRAINT (HARD RULE)` section added to `RW_GENERATION_SYSTEM_PROMPT` between TRACEABILITY RULE and QUESTION TYPES:
  - Model must identify which team/player the news references and find that team's match in `upcoming_matches[]`
  - `match_id` in `predicate_hint` is mandatory — fabrication or omission → skip
  - If news doesn't connect to any team/player in the 48h match list → `{ "skip": true }`
  - Valid/invalid examples included

**Guard conditions (in order of execution):**
1. `targetMatches.length === 0` → skip: `no upcoming match within 48h`
2. After Call 1: null return or skip signal → skip: `weak news signal`
3. After Call 2: `upcomingMatch === null` (missing or mismatched match_id) → skip: `real_world_match_binding_failed`
4. Existing guards follow: `match_lineup` near-kickoff (60 min), `manual_review` deadline backfill, entity_focus normalisation, Calls 3 + 4, temporal validator

**generate-questions redeployed.** No resolver changes. No DB schema changes. No tier/quota changes. No feed changes.

---

### 2026-04-29 — REAL_WORLD bounded retry loop (generate-questions)

**Goal:** improve the probability of producing one high-quality match-bound REAL_WORLD question per league per run without weakening quality rules or generating generic fallback questions.

**`supabase/functions/generate-questions/index.ts`:**
- `MAX_RW_RETRIES = 3` constant — maximum attempts per league per run
- News items (sorted best-first by the adapter) are split positionally into `rwNewsGroups` (up to 3 batches); each attempt draws from a different ranked tier of news
- `weakCandidate` object stores the best WEAK result seen across attempts: `{ rawRW, rwPredicate, rwPredType, upcomingMatch, normalisedEntityFocus, rwPlayerIds, rwContextText, sourceUrls, rwScore, rwQuality, answerClosesAt, resolvesAfter, nowRW, attemptNum }`
- `rwLeagueApproved` counter (per-league, not global) — APPROVE increments it; WEAK never does
- Inner retry loop: APPROVE → insert via `buildRwQuestion()`, increment `rwLeagueApproved`, `break`; WEAK → update `weakCandidate` if score is higher, `continue`; REJECT → log and `continue`
- Post-loop: if `rwLeagueApproved === 0 && weakCandidate !== null` → publish best WEAK; else if both zero → log `real_world_no_valid_candidate_after_retries`
- `leagueScopeStr` moved before the retry loop (was inside the try block — constant per league)

**`buildRwQuestion()` helper** — DRY extract of the ~40-field insert object used by both APPROVE and WEAK publish paths. Parameters: `league, runId, rawRW, rwPredicate, upcomingMatch, normalisedEntityFocus, rwPlayerIds, rwContextText, sourceUrls, answerClosesAt, resolvesAfter, nowRW, rwScore, rwQuality`. Added to Helpers section at bottom of file.

**7 new log events:**
- `real_world_attempt_skip` — Call 1 returned null/skip
- `real_world_attempt_reject` — Call 4 scored REJECT (<65)
- `real_world_attempt_binding_failed` — post-Call-2 match_id validation failed
- `real_world_attempt_weak_stored` — WEAK candidate stored
- `real_world_attempt_approve_published` — APPROVE inserted, loop breaks
- `real_world_best_weak_published` — best WEAK published after all retries exhausted
- `real_world_no_valid_candidate_after_retries` — all attempts ended in SKIP/REJECT/binding failure

**No prompt changes.** No quality rule changes. No pipeline restructuring outside the REAL_WORLD pass. generate-questions redeployed.

---

### 2026-04-29 — REAL_WORLD AI-assisted fallback resolution (resolve-questions)

**Goal:** prevent REAL_WORLD questions from being auto-voided solely due to missing admin action or delayed lineup data. As a last resort, use OpenAI web search to verify the outcome before voiding.

**New file: `supabase/functions/resolve-questions/lib/ai-verifier.ts`**
- `AiVerificationResult` interface: `{ decision: 'correct'|'incorrect'|'unresolvable', confidence: 'low'|'medium'|'high', sources: [{url, title}], reasoning }`
- `verifyRealWorldOutcome(questionText, resolutionCondition, predicateType, apiKey)` — async, returns `AiVerificationResult | null`
  - **Safety gate**: forbidden predicate types (`player_stat`, `match_stat`, `btts`, `match_outcome`, `multiple_choice_map`) return null immediately — these must rely on official APIs only
  - Uses OpenAI Responses API (`POST https://api.openai.com/v1/responses`) with `tool: web_search_preview`, `tool_choice: 'required'`, `text.format: { type: 'json_object' }`
  - 30-second timeout via `AbortSignal.timeout(30_000)`
  - Response parsed from `data.output[].content[].text` (type=message, type=output_text)
  - Validates `decision` + `confidence` enums; normalises sources array; strips markdown fences; caps sources at 5
  - Returns null on network error, non-200 status, JSON parse failure, or missing required fields
- `isAiResultResolvable(result)` — exported helper: `true` when `high` confidence (any source count) OR `medium` + `≥2 sources`; `false` for `low` / `unresolvable` / medium+<2 sources
- System prompt: fact-checker framing; requires reliable sources (BBC/ESPN/Sky/Athletic/Reuters/AP/national press); bans betting sites, fan forums, Wikipedia; explicit confidence definitions; "never guess" rule

**`supabase/functions/resolve-questions/index.ts`:**
- New import: `verifyRealWorldOutcome, isAiResultResolvable` from `./lib/ai-verifier.ts`
- New env var: `OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''` (optional — if absent, AI path is bypassed)
- SELECT extended: `question_text`, `resolution_condition` added
- `resolveQuestion()` signature extended: optional `source` param (default `'system'`); AI path passes `'ai_web_verification'`

**`manual_review` integration point:**
- Was: unconditional skip + log
- Now: if `question_type === 'REAL_WORLD' && OPENAI_API_KEY && question_text && resolution_condition` → call `tryAiVerification()`; if it returns `true` (handled) → `continue`; otherwise fall through to original skip behaviour
- Non-REAL_WORLD `manual_review` questions: unchanged — still skip for admin action

**`match_lineup` unresolvable integration point:**
- Was: unconditional skip when reason is `lineups_not_available` or `lineups_incomplete`
- Now: if `deadlinePassed && question_type === 'REAL_WORLD' && OPENAI_API_KEY && question_text && resolution_condition` → call `tryAiVerification()`; if handled → `continue`; if deadline not passed → original skip logic; if deadline passed and AI failed → fall through to void

**`tryAiVerification()` private helper:**
- Logs `real_world_ai_resolution_attempt` before calling verifier
- On null return: logs `real_world_ai_resolution_failed` with `decision=null confidence=null source_count=0`, returns `false`
- On network/API error: logs `real_world_ai_resolution_failed` with error text, returns `false`
- On strong result (`isAiResultResolvable = true`): resolves question with `'ai_web_verification'` source, calls `markCorrectAnswers()`, increments `runStats.resolved`, returns `true`
- On weak result (`unresolvable` or `low` confidence): logs `real_world_ai_resolution_voided` with full detail, returns `false`
- On medium + <2 sources: logs `real_world_ai_resolution_failed` with "insufficient sources" note, returns `false`

**4 required log events (all include question_id, predicate_type, decision, confidence, source_count):**
- `real_world_ai_resolution_attempt` — before the AI call
- `real_world_ai_resolution_success` — strong result, question resolved
- `real_world_ai_resolution_failed` — null result, network error, or insufficient confidence/sources
- `real_world_ai_resolution_voided` — AI ran but result is unresolvable/low confidence

**Resolution priority order (complete):**
1. Standard predicate evaluation (official API data)
2. Retry cycles (lineups: skip for next poll; manual_review: skip for admin)
3. AI web verification (last resort, REAL_WORLD only, manual_review + match_lineup post-deadline)
4. Auto-void (resolution_deadline + 1h grace)

**Forbidden predicate types for AI fallback:** `player_stat`, `match_stat`, `btts`, `match_outcome`, `multiple_choice_map` — stats must come from official APIs only, never AI inference.

**resolve-questions redeployed.** No DB schema changes. No scoring changes. No generation pipeline changes.

---

### 2026-04-29 — Scraper enrichment integrated into REAL_WORLD generation pipeline

**Goal:** give Call 1 full article text (not just a 280-char RSS snippet) for the top-ranked candidate news items before generating each REAL_WORLD question. Improves signal quality and reduces SKIP/REJECT rate.

**`supabase/functions/generate-questions/lib/types.ts`:**
- `EnrichedNewsItem` interface added extending `NewsItem`:
  - `extracted_text?` — full body text, capped at 3,000 chars by the scraper
  - `extracted_context?` — first 800 chars of `extracted_text`; what is sent to OpenAI
  - `extraction_status?` — `'success' | 'partial' | 'failed' | 'skipped'`
  - `scraper_error?` — error message when scraper fails

**`supabase/functions/generate-questions/index.ts`:**
- Import: `EnrichedNewsItem` added to type imports from `./lib/types.ts`
- New env vars: `SCRAPER_API_URL` + `SCRAPER_API_KEY` (both optional — pipeline degrades gracefully when absent)
- New `enrichArticlesWithScraper(articles, leagueId)` async helper:
  - Selects up to 5 unique URLs from top candidates (already sorted best-first)
  - Calls `${SCRAPER_API_URL}/scrape` concurrently with 10s `AbortController` timeout
  - On success: attaches `extracted_text` (≤3,000 chars) and `extracted_context` (≤800 chars)
  - On any failure (network error, timeout, non-200, extraction failure): sets `extraction_status` and `scraper_error`; returns original article unchanged
  - Never throws
  - 4 log events: `real_world_article_scrape_attempt`, `real_world_article_scrape_success`, `real_world_article_scrape_failed`, `real_world_article_scrape_fallback_to_rss`
- REAL_WORLD pass: `enrichArticlesWithScraper(rwNewsItems, league.id)` called after `rwNewsGroups` is split, before the retry loop
- `rwEnrichedGroups` built from the enriched list (same chunk sizes); retry loop now iterates `rwEnrichedGroups` instead of `rwNewsGroups`
- `generateRealWorldQuestion()` called with enriched items — no other change to the call site

**`supabase/functions/generate-questions/lib/openai-client.ts`:**
- Import: `EnrichedNewsItem` added
- `generateRealWorldQuestion()` param type: `Array<{ ... }>` → `EnrichedNewsItem[]`
- `news_items` mapping: `extracted_context` conditionally included when non-empty — sent as an extra field in the JSON object alongside `headline`, `summary`, `publishedAt`, etc.
- `RW_GENERATION_SYSTEM_PROMPT` STEP 0 (item 1) updated:
  > "If a news_item includes 'extracted_context', READ IT — it is the full article text and is more reliable than the RSS summary. Prefer extracted_context over summary when identifying the specific news signal."
- No prompt version bump required — content clarification only, not a structural change

**`docs/REAL_WORLD_QUESTION_SYSTEM.md`:**
- Generation Pipeline diagram: step ⑤ `enrichArticlesWithScraper()` added; remaining steps renumbered ⑥–⑬
- New "Article Enrichment Layer" subsection: how it works, key design constraints, log events, required env vars, graceful fallback behaviour

**⚠️ DEPLOY REQUIRED before this change takes effect:**
1. Add `SCRAPER_API_URL = https://spontyx-scraper-service-production.up.railway.app` to Supabase Edge Function Secrets
2. Add `SCRAPER_API_KEY = Welcome2Spontyx` to Supabase Edge Function Secrets
3. `supabase functions deploy generate-questions --no-verify-jwt`

Until step 1–3 are done, the pipeline runs exactly as before (`SCRAPER_API_URL` and `SCRAPER_API_KEY` both default to `''`, causing `enrichArticlesWithScraper()` to return articles unmodified).

**No resolver changes.** No DB schema changes. No scoring changes. No prematch/live generation changes.

---

### 2026-04-29 — Supabase Realtime subscription in league.html (replaces polling)

**Goal:** eliminate 5s/15s poll latency so new questions appear sub-second and resolved cards flip in real-time when the resolver awards points. Polling downgraded to a 30s heartbeat safety net.

**`league.html` — 6 targeted changes (JS + no CSS changes):**

*Global state:*
- `var realtimeChannel = null;` — tracks the active Supabase Realtime channel handle

*Polling interval logic updated:*
- `loadAndRenderQuestions()` now checks `var rtActive = realtimeChannel !== null` before setting polling interval
- When Realtime is active: `startPolling(30000)` (heartbeat, catches reconnect gaps and missed events)
- When Realtime is inactive (channel error or not yet started): `startPolling(5000)` active / `startPolling(15000)` idle — restores the original fast cadence automatically

*New `startRealtime()` function:*
- Channel name: `'league-' + currentLeagueId`
- `questions` subscription: listens to `*` (INSERT/UPDATE/DELETE), filtered by `league_id=eq.{currentLeagueId}` → calls `loadAndRenderQuestions(true)` on any event
- `player_answers` subscription: listens to `UPDATE` events (no server-side filter — `league_id` not on `player_answers`), client-side filter: `payload.new.user_id === currentUserId` → calls `loadAndRenderQuestions(true)` to flip the user's own answer card when the resolver scores it
- On `SUBSCRIBED` status: calls `loadAndRenderQuestions(true)` to re-evaluate the polling interval (switches from 5s → 30s)
- On `CHANNEL_ERROR` or `TIMED_OUT`: sets `realtimeChannel = null`, calls `loadAndRenderQuestions(true)` to restore 5s/15s polling — no dead feed possible

*New `stopRealtime()` function:*
- Calls `window.sb.removeChannel(realtimeChannel)` if channel is set; sets `realtimeChannel = null`

*`hydrateLeaguePage()` wiring:*
- `startRealtime()` called after `Promise.all([loadAndRenderQuestions(false), loadAndRenderMembers()])` completes

*`DOMContentLoaded` — two new event listeners:*
- `visibilitychange`: when tab becomes hidden → `stopRealtime(); stopPolling(); stopTimerTick()`; when tab becomes visible again → `loadAndRenderQuestions(false).then(() => startRealtime())`
- `beforeunload`: `stopRealtime(); stopPolling(); stopTimerTick()` — clean teardown, prevents lingering subscriptions

**New migration: `backend/migrations/028_enable_realtime.sql`:**
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE questions;
ALTER PUBLICATION supabase_realtime ADD TABLE player_answers;
```
- ⚠️ **MUST be run in Supabase SQL editor before Realtime events will flow.** The channel connects without this but receives no events.

**Why `player_answers` cannot be filtered server-side:** Supabase Realtime `postgres_changes` filters work on columns that exist in the changed table. `player_answers` has `question_id`, `user_id`, and `is_correct` — no `league_id`. Server-side filter is impossible; client-side `user_id` check is the correct pattern.

**Latency comparison:**

| | Before | After |
|---|---|---|
| New question appears in feed | Up to 5s (active poll) / 15s (idle) | Sub-second via Realtime |
| Resolved card flips to correct/incorrect | Up to 5s (active poll) | Sub-second via Realtime |
| Fallback if Realtime fails | N/A (polling was primary) | 5s/15s polling auto-restored |
| Tab hidden | Polling continued (wasted DB queries) | Channel + polling stopped |

**No backend changes.** No DB schema changes beyond the publication. No pipeline, resolver, or scoring changes.

---

### 2026-04-30 — Multiplayer arena redesign (multiplayer.html — full rewrite)

**Goal:** replace the old 4-step mobile-constrained wizard (761 lines, max-width: 960px) with a cinematic full-screen desktop arena experience that feels like entering a live competitive arena rather than filling out a form.

**Design principles applied:**
- Full viewport (`body { overflow: hidden; height: 100vh }`, no max-width cap) — fills the screen like a desktop app
- 3 steps only: Format → Match + Config → Waiting Room (no intermediate "configure" step separate from match selection)
- "Enter the Arena" identity: lime live badge, watermark cards, dark `#080815` background
- Queue counts on every match row and in the config panel — social proof and matchmaking signal

**Step 1 — Format selection:**
- Two full-height watermark cards: **1 vs 1** (coral, ⚔️ icon) and **2 vs 2** (lime, 🛡️ icon)
- Large typographic watermarks (`font-size: 8rem`) tinted at 7% opacity, increasing to 16% on hover/selected
- Selected state: coloured border + glow box-shadow per format colour
- Check icon animates in on selection (`.format-check` CSS)
- Player dots row shows seat count (2 for 1v1, 4 for 2v2)
- "Find a Match →" CTA button disabled until format is selected

**Step 2 — Match browser + config panel (side-by-side):**
- Full-width grid: `grid-template-columns: 1fr 380px`; both columns `overflow: hidden` with independent inner scroll
- **Left — match list:**
  - Toolbar: text search, competition filter `<select>` (populated from `api_football_fixtures`), sort toggle (By Time / Most Active)
  - Sort "By Time": live matches first, then ascending by `|kickoff − now|` proximity
  - Sort "Most Active": highest total queue count first, tie-break by time proximity
  - Each match row shows: team names, competition badge, status (LIVE dot / kickoff time), total queue count badge (`N in queue`)
  - Selected match row gets a lime left-border highlight
- **Right — config panel:**
  - Placeholder "← Select a match" shown until a match is clicked
  - Half-scope selector: three cards — Full Match / First Half / Second Half — each showing per-half, per-mode queue count breakdown
  - Queue breakdown: `"1v1: N  ·  2v2: N"` per half option
  - **2v2 team options** (shown only when `selectedMode === '2v2'`): Auto-match queue / Invite via link — styled as radio-style option cards
  - "Enter Arena →" button becomes enabled once a match is selected

**Step 3 — Waiting room (fixed-position overlay):**
- `position: fixed; inset: 0; z-index: 200` — overlays the entire step-2 split layout; treated as step 3 in the progress bars via `updateStepBars()` checking `#wr-overlay.style.display === 'flex'`
- **4 concentric pulsing rings** (`@keyframes ring-pulse`): r1=160px, r2=320px, r3=480px, r4=640px; staggered delays 0/1/2/3s; lime tinted, fading opacity from 0.12 → 0
- **Match context badge** — "Home vs Away · half label · mode"
- **Avatar row**: "You" (lime ring) vs "??" opponent (purple ring); opponent animates `searching-pulse` (opacity oscillation) until matched, then `found-pop` (scale bounce in) when a match is found
- **Mode badge** — coral `1v1` or lime `2v2` pill
- **Status line + bouncing dots** — `"Searching for opponent"` with 3-dot `dot-bounce` animation while searching; switches to lime `"⚡ Opponent found! Starting…"` on match
- **Invite section** (shown for 2v2 share-link mode): URL input + Copy button, lime-tinted styling
- Cancel button — leaves lobby and returns to step 2

**Queue count system:**
```javascript
async function loadQueueCounts() {
  // 1. Fetch all waiting lobbies for this match context
  var { data: waitingLobbies } = await window.sb.from('match_lobbies')
    .select('id, match_id, half_scope, mode').eq('status', 'waiting');
  // 2. Count players per lobby
  var { data: players } = await window.sb.from('match_lobby_players')
    .select('lobby_id').in('lobby_id', lobbyIds);
  // 3. Aggregate into queueMap[matchId][halfScope][mode] = playerCount
}
```
- Called on Step 2 load and on every Realtime update to `match_lobbies` / `match_lobby_players`
- `getMatchQueueTotal(matchId)` — sums all modes/halves for a match (shown on match row badge)
- `getQueueCount(matchId, half, mode)` — per-half, per-mode count (shown in config panel)

**Lobby system:**
- `enterLobby()` — calls `SpontixStoreAsync.findOrJoinLobby()` stub (or falls back to direct Supabase upsert); upserts to `match_lobbies` + inserts to `match_lobby_players`; starts Realtime subscription
- `startLobbyRealtime(lobbyId)` — Supabase Realtime channel on `match_lobbies:id=eq.{lobbyId}` + `match_lobby_players:lobby_id=eq.{lobbyId}`; calls `refreshLobbyUI()` on every change
- `refreshLobbyUI(lobbyId)` — reads current lobby + player count; transitions avatar from searching → found when lobby reaches required player count; calls `handleLobbyFull()` when full
- `handleLobbyFull()` — calls `createLeagueFromLobby()` stub to create a `leagues` row and redirect all players to `league.html?id=...`
- `leaveLobby()` — deletes `match_lobby_players` row; removes Realtime channel; hides waiting room overlay
- `directJoinLobby(lobbyId)` — handles `?join=<lobbyId>` URL param for 2v2 invite-link joins; reads lobby to infer format/match/half; skips steps 1 and 2 and goes straight to waiting room

**DB (migration 030):**
- `match_lobbies` — `id UUID PK`, `match_id TEXT`, `half_scope TEXT`, `mode TEXT (1v1|2v2)`, `status TEXT (waiting|ready|active|finished)`, `home/away_team_name`, `kickoff_at`, `api_league_id`, `league_id UUID → leagues`
- `match_lobby_players` — `PK (lobby_id, user_id)`, `team_number INT (1|2)`, `is_invited BOOL`, `invited_by UUID`
- Both tables have RLS (authenticated read; own-row insert/delete)
- Both tables added to `supabase_realtime` publication

**State variables:**
```javascript
var currentStep     = 1;       // 1 or 2 (waiting room is overlay, not step 3 in DOM)
var selectedMode    = null;    // '1v1' | '2v2'
var selectedMatch   = null;    // match object
var selectedHalf    = 'full_match'; // 'full_match' | 'first_half' | 'second_half'
var selected2v2Sub  = 'solo_queue'; // 'solo_queue' | 'invite_link'
var currentLobbyId  = null;
var lobbyChannel    = null;
var allMatches      = [];
var compMap         = {};
var filterLeague    = 'all';
var sortMode        = 'time';  // 'time' | 'active'
var queueMap        = {};
var currentUserId   = null;
var currentUserHandle = null;
```

**SpontixStoreAsync stubs (built into page script):**
- `SpontixStoreAsync.findOrJoinLobby({ matchId, halfScope, mode, homeTeamName, awayTeamName, kickoffAt, apiLeagueId })` — finds an existing `waiting` lobby or creates a new one; joins the player
- `SpontixStoreAsync.joinLobbyById(lobbyId)` — direct join for invite-link flows
- `SpontixStoreAsync.createLeagueFromLobby(lobbyId, userId)` — creates a `leagues` row bound to the lobby; updates `match_lobbies.league_id`; returns `{ leagueId }`

These stubs operate directly on Supabase and are fully functional. They should be promoted to `spontix-store.js` in a future cleanup sprint.

**No backend changes (beyond migration 030).** No pipeline, resolver, or scoring changes. No other pages affected.

---

### 2026-04-30 — Arena Session system: Live Multiplayer game-mode separation (Phase 1)

**Core architectural rule:** `leagues` = persistent long-term competition. `arena_sessions` = short live competitive sessions (Live Multiplayer). They must NEVER be mixed.

**Goal:** build the full arena session architecture — DB schema, generation pipeline separation, gameplay page — so Live Multiplayer games run in isolated sessions rather than shared league tables.

---

**New migration: `backend/migrations/033_arena_sessions.sql`** — ⚠️ run before deploying Edge Functions:
- `arena_sessions` table — one per matchmaking lobby game. Fields: `lobby_id`, `match_id`, `half_scope`, `mode (1v1|2v2)`, `status (waiting→active→completed→cancelled)`, `home/away_team_name`, `kickoff_at`, `api_league_id`, `winner_user_id`, `winning_team_number`, `started_at`, `completed_at`. Indexes on `(status, created_at)` and `(match_id, status)`.
- `arena_session_players` table — per-player state. Fields: `session_id`, `user_id`, `team_number`, `score`, `correct_answers`, `total_answers`, `joined_at`. PK `(session_id, user_id)`. Index on `(user_id, joined_at)`.
- `questions.league_id` — made nullable (was NOT NULL). `questions.arena_session_id` — new FK to `arena_sessions`. CHECK constraint: exactly one of `league_id` / `arena_session_id` must be set.
- `leagues.session_type` — `'league' | 'solo_match'`. Index on `solo_match` value.
- `game_history` discriminator columns — `game_mode`, `rating_type`, `source_session_id`.
- `player_answers.league_id` — made nullable. `player_answers.arena_session_id` — new FK. Index.
- RLS: `arena_sessions` — authenticated read + insert + update. `arena_session_players` — read all; insert/delete own rows. `player_answers pa_insert_self` — dual-path: PATH A (league member) OR PATH B (arena session participant). `pa_select_member` — union of own + league members + arena session participants.
- Realtime: both `arena_sessions` and `arena_session_players` added to `supabase_realtime` publication.

**New migration: `backend/migrations/034_match_lobbies_arena_session_id.sql`** — ⚠️ run after 033:
- Adds `arena_session_id UUID REFERENCES arena_sessions(id) ON DELETE SET NULL` to `match_lobbies` — forward reference from lobby to the session it spawned. Used by `multiplayer.html`'s `createArenaSession()` to detect already-created sessions and redirect late-joining players rather than creating duplicates.

---

**`supabase/functions/generate-questions/lib/context-builder.ts`:**
- `buildLiveContext(sb, leagueId, matchId, fixtureRow, arenaSessionId?)` — 5th param added. `ownerCol` / `ownerId` discriminator: when `arenaSessionId` is set, all question queries use `arena_session_id` filter; otherwise `league_id`. Rate-limit query and active-window extraction both respect this.

**`supabase/functions/generate-questions/index.ts`:**
- `live_only` URL param: `url.searchParams.get('live_only') === '1'` skips prematch and REAL_WORLD loops entirely; used by the `live-stats-poller` fire-and-forget call.
- `session_type` added to leagues SELECT — `solo_match` leagues blocked from REAL_WORLD generation.
- **Arena session live generation loop** added after the league live loop (before REAL_WORLD):
  - Fetches all `arena_sessions WHERE status='active'`
  - Cross-references `live_match_stats` (status IN `1H|2H|ET`) — skips sessions whose match isn't live
  - HT skip, `buildLiveContext` with `arenaSessionId`, ≥89 hard reject, 3-question active cap, 3-min rate limit (time_driven only; event_driven bypasses)
  - Builds a `fakeLeague` object and `SportsContext` from session data — re-uses all existing generation infrastructure
  - Appends `LIVE MATCH STATE` section to context packet (score, isCloseGame, isBlowout, trigger, last event, active windows)
  - Calls `generateQuestions()` + `convertToPredicate()` + `validateQuestion()` — same 5-stage validation as league live
  - Inserts with `arena_session_id: session.id` — `league_id` intentionally omitted (CHECK constraint enforces exactly one)
  - `question_type: 'CORE_MATCH_LIVE'`, `source_badge: 'LIVE'`, `reuse_scope: 'live_safe'`
  - `clutch_context` JSONB includes `session_scope` (half_scope value)
  - Log prefix: `[arena-gen]`

**`supabase/functions/live-stats-poller/index.ts`:**
- After completing successful fixture upserts, fires `fetch(generateQuestionsUrl + '?live_only=1', ...)` as a fire-and-forget call (no `await`). Allows the live question generator to run immediately after fresh stats land, without waiting for the 6h cron cycle. Never blocks the poller — errors logged but ignored.

---

**`multiplayer.html` — `createArenaSession()` stub rewritten:**
- Replaces the old `createLeagueFromLobby()` approach entirely — no `leagues` row created.
- Reads `lobby.arena_session_id` first: if set, redirect to the already-created session (prevents duplicate sessions when multiple players reach full capacity simultaneously).
- Inserts `arena_sessions` row: `lobby_id`, `match_id`, `half_scope`, `mode`, `home/away_team_name`, `kickoff_at`, `api_league_id`, `status: 'waiting'`.
- Inserts all current lobby players into `arena_session_players` in a batch.
- Updates `match_lobbies.arena_session_id` to the new session's UUID (migration 034 column).
- Updates `match_lobbies.status` to `'active'`.
- After 1.6s animation delay, redirects all players to `arena-session.html?id=<sessionUUID>`.

---

**New file: `arena-session.html`** — the complete Live Multiplayer gameplay page (1,032 lines).

*Init flow:*
- Parses `?id=<sessionId>` from URL → Supabase auth check → loads user handle from `users` → `loadSession() + loadQuestions() + loadPlayers()` in parallel → starts Realtime + 5s poll + 1s timer tick.

*Data loading:*
- `loadSession()` — `arena_sessions WHERE id = sessionId`. Sets `sessionData`, calls `renderTopbar()` and `renderScoreboard()`.
- `loadPlayers()` — `arena_session_players WHERE session_id = sessionId` joined with `users(handle, name)`. Attaches `_handle` to each player row for display.
- `loadQuestions()` — `questions WHERE arena_session_id = sessionId`. Filters by `visible_from`. Loads `player_answers` for current user. Detects newly-resolved correct answers → `showPtsNotif()`.

*Answer submission (`handleAnswer()`):*
```javascript
var payload = {
  question_id:                questionId,
  user_id:                    currentUserId,
  arena_session_id:           currentSessionId,  // ← no league_id
  answer:                     answer,
  answered_at:                new Date().toISOString(),
  clutch_multiplier_at_answer: minute >= 70 ? 1.25 : 1.0,
  leader_gap_at_answer:       0,
  streak_at_answer:           0,
};
await window.sb.from('player_answers').upsert(payload, { onConflict: 'question_id,user_id' });
```

*Three Realtime subscriptions:*
1. `arena_sessions` filtered `id=eq.{sessionId}` — `completed`/`cancelled` status → `loadPlayers()` → `showCompleteOverlay()`
2. `questions` filtered `arena_session_id=eq.{sessionId}` — new questions → `loadQuestions()`
3. `arena_session_players` filtered `session_id=eq.{sessionId}` — score updates → `loadPlayers()` → `renderScoreboard()`

*Complete overlay (`showCompleteOverlay()`):*
- Reads final `players` state. Determines winner/draw/loss. Shows 🏆/🤝/💪 icon + result text + per-player score rows with handles (from `players[i]._handle`) and correct answer counts.

*Question cards (`renderCard(q, isPrimary)`):*
- Full lane badge (LIVE/PREMATCH/REAL_WORLD via `detectLane()`), engagement badges (HIGH VALUE/CLUTCH/FAST), timer bar with 1s tick, option buttons with correct/wrong state, footer with pts earned.
- Live window strip for `match_stat_window` predicates.

*State management:*
- When Realtime is active: poll interval = 30s heartbeat. On `CHANNEL_ERROR`/`TIMED_OUT`: poll switches back to 5s.
- Tab visibility: pauses all channels + polls when hidden; resumes with fresh load on focus.
- `beforeunload`: clean teardown.

*CSS highlights:* `--navy: #080815`; lime score ring for current user; `glow-correct` / `shake-wrong` card animations; timer bar drains with CSS transition; live dot pulse; `page-enter` fade-in.

**Deploy order (MANDATORY):**
1. Run `033_arena_sessions.sql` in Supabase SQL editor
2. Run `034_match_lobbies_arena_session_id.sql`
3. `supabase functions deploy generate-questions --no-verify-jwt`
4. `supabase functions deploy live-stats-poller --no-verify-jwt`

---

### 2026-04-30 — Arena Session Phase 1 end-to-end validation + two bug fixes

**Goal:** full end-to-end test of the arena session flow: lobby → `createArenaSession()` → `arena-session.html` → questions with answer buttons → answer submission → Realtime complete overlay.

**Bug fix 1 — `parseOptions()` normalisation (`arena-session.html`):**
- **Root cause:** `parseOptions` returned plain string items (`["Yes","No"]`) unchanged when the input was already a parsed array. The card renderer at line 712 calls `opt.id` and `opt.label` — both `undefined` on a plain string — producing an empty button (invisible/zero-height). Answer buttons were never rendered.
- **Fix:** normalise plain strings to `{id, label}` objects:
  ```javascript
  return arr.map(function(o) {
    if (typeof o === 'string') return { id: o.toLowerCase().replace(/\s+/g, '_'), label: o };
    return o;
  });
  ```
- Also applied: test question was inserted with `options = '[]'` (the JSONB default). Fixed via SQL `UPDATE` to set `[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]` with refreshed timestamps (`answer_closes_at + deadline + resolves_after`) — required because the `timing_order` CHECK constraint rejects `answer_closes_at > resolves_after` if only some timestamps are updated.

**Bug fix 2 — `loadPlayers()` two-step query (`arena-session.html`):**
- **Root cause:** `arena_session_players.user_id` has a FK to `auth.users(id)` (Supabase Auth), not `public.users(id)`. Supabase PostgREST cannot resolve `.select('..., users(handle, name)')` across the Auth/public boundary — query silently returned rows without the join data, so `players = []`, and `renderScoreboard()` hid the scoreboard because `players.length < 2`.
- **Fix:** two-step query:
  1. Fetch `arena_session_players` rows (no join)
  2. Extract `user_id` UUIDs → query `public.users WHERE id IN (uids)`
  3. Build `profileMap` → merge `_handle` onto each player row in JS
- Both scoreboard and complete overlay now correctly display player handles.

**End-to-end test results (all checkpoints passed ✅):**

| Check | Result |
|---|---|
| Questions load with correct options | ✅ |
| Answer buttons (Yes/No) render and are clickable | ✅ |
| Answer submission writes to `player_answers` with `arena_session_id` | ✅ |
| Scoreboard shows both player handles | ✅ |
| Realtime fires complete overlay automatically on `status='completed'` | ✅ |
| Complete overlay shows correct player handles and scores | ✅ |
| Play Again button present | ✅ |

**Note on complete overlay winner/draw logic:** `showCompleteOverlay()` determines winner/draw by comparing `players[i].score` (from `arena_session_players.score`). Since `arena_session_players.score` is only updated by the resolver awarding `points_earned`, both scores were 0 in the test → displayed as draw even though `winner_user_id` was set. Once the resolver starts updating scores, winner/loss display will work correctly. `winner_user_id` is not currently used by the overlay — it's set on the session row but the overlay reads live scores.

**Migration 035 — Global XP system (`backend/migrations/035_xp_system.sql`):** Written this session. ⚠️ **Not yet applied.**
- `users.total_xp INTEGER NOT NULL DEFAULT 0` + `users.level INTEGER NOT NULL DEFAULT 1`
- `player_xp_events` extended: `source_type TEXT`, `source_id UUID`, `metadata JSONB NOT NULL DEFAULT '{}'`
- Partial unique index `(user_id, event_type, source_id) WHERE source_id IS NOT NULL` — idempotency
- `get_level_number(p_xp INTEGER)` IMMUTABLE — XP → level integer. Formula: XP to advance level N = `floor(100 × N^1.5)`
- `get_level_info(p_xp INTEGER)` IMMUTABLE — returns `{level, xp_in_level, xp_for_next, progress_pct}` JSONB
- `award_xp(p_user_id, p_xp_amount, p_event_type, p_source_type, p_source_id?, p_metadata?)` SECURITY DEFINER RPC:
  - Auth guard: service role (null `auth.uid()`) may award for any user; authenticated callers may only award for themselves
  - Arena validation: if `source_type='arena'`, verifies `arena_sessions.status='completed'` and user is in `arena_session_players`
  - Daily soft cap: `≥20 distinct source_ids today → 0.5×`; `≥10 → 0.7×`
  - Repeat opponent penalty: `≥3 unique sessions vs same opponent_id today → 0.5×` (stacks multiplicatively)
  - Idempotent: ON CONFLICT DO NOTHING on the partial unique index → returns `{awarded_xp:0, duplicate:true}`
  - Returns `{awarded_xp, new_total_xp, new_level, multiplier, duplicate:false}` on success
- Backfill: `total_xp` from existing `player_xp_events`; `level` from `total_xp`
- GRANT EXECUTE to `authenticated` + `service_role`

**Deploy order for Phase 2:**
1. Run `035_xp_system.sql` in Supabase SQL editor ✅
2. Wire `award_xp()` in `arena-session.html` `showCompleteOverlay()` ✅
3. Add XP bar + level badge to `dashboard.html` and `profile.html` ✅

---

### 2026-04-30 — Phase 2: Global XP system wired end-to-end

**Goal:** make XP awards and the level bar visible to users following an arena session, and surface the level/progress on the two main player-facing pages.

**`arena-session.html`:**
- `showCompleteOverlay()` made `async`
- `winner_user_id` from `sessionData` is now the authoritative win/loss signal. Score comparison (`myScore > oppScore`) is only the fallback when `winner_user_id` is null (2v2 sessions where `winning_team_number` is used instead)
- `awardSessionXp(iWon, isDraw)` helper added — calls `window.sb.rpc('award_xp', {...})` with: `p_event_type = 'arena_win' | 'arena_draw' | 'arena_loss'`, `p_xp_amount = 50 | 25 | 15`, `p_source_type = 'arena'`, `p_source_id = currentSessionId`. Idempotent — duplicate calls return `{duplicate:true}` and are silently ignored
- `renderScores(myXp)` extracted as an inner function — called immediately with `null` (overlay appears at once without waiting for the RPC), then called again with the real `awarded_xp` once the RPC resolves
- `+N XP` pill (`.as-xp-earned`) rendered in the "You" score card when XP is returned; hidden for the opponent
- `XP_WIN = 50, XP_DRAW = 25, XP_LOSS = 15` constants added
- Graceful degradation: `awardSessionXp()` catches all errors and returns `null` — overlay is never blocked

**`spontix-store.js`:**
- `_mapUserFromDb()` extended: `total_xp: row.total_xp != null ? row.total_xp : null` and `level: row.level != null ? row.level : null` added. Both fields were previously dropped by the mapper even though `getProfile()` uses `select('*')` which retrieves them

**`dashboard.html`:**
- CSS: `.xp-bar-wrap`, `.xp-level-badge`, `.xp-bar-track`, `.xp-bar-fill`, `.xp-bar-label` added
- HTML: `<div id="dash-xp-bar-wrap" style="display:none">` injected inside `.profile-preview-info` after the tier badge
- `renderXpBar(totalXp, level)` function added — mirrors the DB `get_level_number()` formula in JS (`XP to advance level N = floor(100 × N^1.5)`); computes `xpInLevel`, `xpForNext`, progress %
- `applyRealProfile()` calls `renderXpBar(profile.total_xp, profile.level)` when `total_xp != null`

**`profile.html`:**
- Same CSS classes added (after `.profile-meta-item strong`)
- HTML: `<div id="prof-xp-bar-wrap" style="display:none">` injected inside `.profile-header-info` after `.profile-header-meta`
- `renderXpBar(totalXp, level)` function added (identical formula, uses `prof-xp-*` IDs)
- `hydrateProfile()` calls `renderXpBar(player.total_xp, player.level)` when `total_xp != null`
- All async refresh paths (`spontix-profile-refreshed` event, public profile load, game-history refresh) go through `hydrateProfile()` — all wired

**XP bar display rules:**
- Hidden (`display:none`) until `total_xp` is non-null — no broken UI for pre-migration rows or users with no XP yet
- Level badge: circular gradient (lime → teal), shows level number
- Progress bar: fills left-to-right, lime → teal gradient, 0.6s ease transition
- Label: `"xpInLevel / xpForNext XP"`
- Level cap: formula runs to level 99 (same as DB `get_level_number()` hard cap at 100)

---

### 2026-04-30 — Arena Streak UI

**Goal:** surface the current correct-answer streak visually inside the arena session so players are aware of their multiplier status without reading a number.

**`arena-session.html`:**
- `currentMyStreak` global var tracks the live streak count (incremented on correct answer resolution, reset on wrong)
- `updateStreakUI(streak)` — updates the streak badge in the scoreboard; badge hidden when streak = 0; shows "🔥 N" when active
- Streak notif — pops up from the bottom-right when a new streak milestone is crossed (2, 3, 4+); auto-dismisses in 2.5s
- `renderScoreboard()` calls `updateStreakUI(currentMyStreak)` on every refresh
- `loadQuestions()` computes `currentMyStreak` from resolved correct answers in `myAnswers` (already loaded; no extra DB query)

**Design rules:**
- Display-only — reads existing `streak_at_answer` concept but does not write any new DB columns
- No backend, resolver, or scoring changes

---

### 2026-04-30 — Arena Comeback UI

**Goal:** show players when they are in a comeback scoring window and which multiplier tier is active (×1.1 / ×1.2 / ×1.3), matching the backend `computeComebackMultiplier()` tiers exactly.

**`arena-session.html` — CSS:**
- `.as-eng-badge.comeback` — teal (`#4ECDC4`) tinted badge for standard comeback tiers
- `.as-eng-badge.comeback-max` — same teal + `as-pulse` animation for 100+ gap (×1.3 cap)
- `.as-comeback-line` — small secondary line under the scoreboard score showing comeback status
- `.as-comeback-notif` — fixed-position popup (bottom-right, above streak notif) that slides in on answer submission

**`arena-session.html` — HTML:**
- `<div class="as-comeback-line" id="as-my-comeback">` injected in scoreboard after `#as-my-streak`
- `<div class="as-comeback-notif" id="as-comeback-notif">` injected after `#as-streak-notif`

**`arena-session.html` — JS:**
- `getComeback(myScore, oppScore)` — returns `null` when gap ≤ 20 (no bonus), otherwise `{ gap, multLabel, copyLabel, popupLabel, isMax }` per tier:
  - Gap 21–50 → ×1.1, "Comeback window"
  - Gap 51–100 → ×1.2, "Big comeback window"
  - Gap 100+ → ×1.3, "Massive comeback window", `isMax: true`
- `updateComebackUI(myScore, oppScore)` — updates `#as-my-comeback` text; clears when no comeback
- `showComebackNotif(myScore, oppScore)` — shows popup with tier label; auto-dismisses in 3.5s
- `renderScoreboard()` calls `updateComebackUI(myScore, oppScore)` on every refresh
- `renderCard()` pushes comeback badge when `me` and `opp` both found in `players[]` and gap qualifies
- `handleAnswer()` calls `showComebackNotif()` on first answer only (not on answer change)

**Design rules:**
- Gap read from live `players[]` scores at render time — no extra DB queries
- Wording is positive ("Comeback window" not "You are losing") — avoids negativity
- Card badge shows the multiplier label inline: `COMEBACK ×1.1` etc.
- Display-only — no backend, resolver, schema, or scoring changes

---

### 2026-04-30 — Arena Clutch UI accuracy fix

**Goal:** make the CLUTCH badge in `arena-session.html` mirror the backend `isClutchAnswer()` definition exactly, rather than using the simpler `match_minute_at_generation >= 70` proxy which was incorrect for `first_half` sessions and ignored match competitiveness entirely.

**Backend definition (source of truth, not changed):**
- `isClutchAnswer()` in `resolve-questions/lib/clutch-detector.ts`: CLUTCH = (1) match in clutch window AND (2) match is competitive (goal diff ≤ 1 OR leader_gap ≤ 20)
- Clutch window: `first_half` → minute ≥ 35; `second_half` / `full_match` → minute ≥ 80

**`arena-session.html` changes:**

*`loadQuestions()` SELECT:*
- `'clutch_context'` added to the `cols` array — fetches the JSONB snapshot (`{ matchMinute, homeScore, awayScore }`) written by the generator at question creation time

*`isDisplayClutch(q)` helper (new function before Cleanup section):*
```
1. LIVE questions only (question_type === 'CORE_MATCH_LIVE')
2. match_minute_at_generation present + in clutch window
   - half_scope === 'first_half' → minute >= 35
   - all others → minute >= 80
3A. clutch_context present with homeScore + awayScore → show if |diff| <= 1
3B. Both players present in players[] → show if |me.score - opp.score| <= 20
    (ONLY if both found — missing opponent data never defaults to close)
4. Any required signal missing → return false (hide safely)
```

*`renderCard()` — two replacements:*
- Card `.clutch-state` class: `(q.match_minute_at_generation || 0) >= 70` → `isDisplayClutch(q)`
- Clutch badge push: same replacement

**What was NOT changed:**
- Backend `isClutchAnswer()`, `clutch_multiplier_at_answer`, scoring formula, `clutch_context` JSONB schema, DB, resolver, XP system — none touched

---

### 2026-05-01 — Arena completion overlay: Question Results Breakdown

**Goal:** give players a full post-game review of every question in the session so they can understand their score and learn from mistakes.

**`arena-session.html`:**
- `player_answers` SELECT extended: `multiplier_breakdown`, `is_clutch`, `streak_at_answer`, `leader_gap_at_answer` added alongside existing columns
- `renderQuestionReview()` new function — called from `showCompleteOverlay()` after the overlay becomes visible:
  - Reads `currentQuestions` + `myAnswers`; sorts questions ascending by `created_at`
  - Per question: determines state (`correct` / `wrong` / `missed` / `pending`) from `myAnswers[q.id].is_correct` + `q.resolution_status`
  - Badge labels: `✓ Correct` / `✗ Wrong` / `— Missed` / `… Awaiting`
  - Answer rows: "Your pick" (colour-coded `highlight-correct` / `highlight-wrong`) + "Answer" (always lime) when resolved
  - Points pill: `+N pts` (lime) when correct + points > 0; `0 pts` (grey) otherwise
  - Tags: `Clutch` (from `a.is_clutch`), `Streak ×N` (when `streak_at_answer >= 3`), `Comeback` (when `leader_gap_at_answer > 20`), `Hard` (when `difficulty_multiplier > 1.1`)
  - Writes to `#as-qreview` inside `.as-complete-inner`

**New CSS (`.as-qr-*` prefix):**
- `.as-qreview-section`, `.as-qreview-title`, `.as-qr-card` (correct/wrong/missed/pending variants)
- `.as-qr-top`, `.as-qr-badge`, `.as-qr-qtext`, `.as-qr-answers`, `.as-qr-answer-row`
- `.as-qr-answer-label`, `.as-qr-answer-val` (`.highlight-correct` / `.highlight-wrong`)
- `.as-qr-footer`, `.as-qr-pts` (`.zero` variant), `.as-qr-tag` (clutch/streak/comeback/diff)
- `.as-qreview-empty` — shown when no questions to review

**Overlay layout change:** `.as-complete-overlay` made `overflow-y: auto` so the question list is scrollable without the overlay itself being scroll-clipped.

**No backend changes.** No DB schema changes. No resolver or scoring changes.

---

### 2026-05-01 — Arena in-session Question History panel

**Goal:** let players review past questions without leaving the live session feed, and surface a notification when a new live question drops while the drawer is open.

**`arena-session.html`:**

*New global state:*
- `var historyOpen = false;` — tracks drawer open state
- `var historyHasNewQ = false;` — tracks whether the new-question indicator is active; cleared on close

*New functions:*
- `openHistory()` — adds `.open` to `#as-hist-overlay`; calls `renderHistory()`
- `closeHistory()` — removes `.open`; clears `historyHasNewQ`; removes `.has-new` + banner `.show`
- `renderHistory()` — filters `currentQuestions` to exclude questions with open answer window (`answer_closes_at > now`); sorts remaining newest-first; builds card HTML using the same `.as-qr-card` pattern as `renderQuestionReview()`; writes to `#as-hist-body`. Shows `.as-hist-empty` when no past questions yet.

*New-question hook (inside `loadQuestions()`, after `renderFeed()`):*
- When `historyOpen` and an active question exists and `historyHasNewQ` is false: sets flag, adds `.show` to `#as-hist-new-banner`, adds `.has-new` to `#as-hist-btn`

*Floating `≡ History` button (`.as-hist-btn`):*
- `position: fixed; right: 16px; bottom: max(18px, env(safe-area-inset-bottom))` — never overlaps iPhone home bar
- Default: semi-transparent dark pill. When `.has-new`: lime border + lime text + pulsing dot

*Bottom-sheet drawer (`.as-hist-overlay`):*
- `position: fixed; bottom: 0; max-height: 75vh` — slides up via CSS transform on `.open`
- Handle bar + header ("Question History" title + ✕ close button)
- Lime `"⚡ Live question available — close to answer"` banner (`#as-hist-new-banner`) — tapping it calls `closeHistory()` so the player can answer immediately
- Scrollable body (`#as-hist-body`) — question cards identical in structure to completion overlay breakdown

*z-index layering:* history button at 160, history overlay at 155, complete overlay at 200 (history never overlaps game-over screen).

**New CSS (`.as-hist-*` prefix):**
`@keyframes as-hist-slide`, `.as-hist-btn` (with `.has-new` variant), `.as-hist-dot`, `.as-hist-overlay` (with `.open` variant), `.as-hist-handle`, `.as-hist-header`, `.as-hist-title`, `.as-hist-close`, `.as-hist-new-banner` (with `.show` variant), `.as-hist-body`, `.as-hist-empty`

**No backend changes.** No DB schema changes. No resolver or scoring changes.
