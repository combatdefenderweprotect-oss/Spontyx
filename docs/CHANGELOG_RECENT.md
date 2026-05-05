# Spontix Changelog — Recent

Recent updates (last ~7 days). For older history, see [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md).

---

Chronological history of major changes. Most recent first.

For canonical specs, see the domain docs in this folder. This file is history only.

---

## Recent updates (top-of-CLAUDE.md history)

### 2026-05-05 — Demand-driven pre-match generation (`ensure-prematch`)

Pre-match question generation is now event-based as the primary UX path. Cron job `generate-questions-every-6h` is preserved unchanged as a backstop.

- New edge function `supabase/functions/ensure-prematch/index.ts`. Public, JWT-authenticated wrapper. Validates league access via RLS, debounces (5 min recent-generation check), and forwards to `generate-questions` with `{ league_id, [match_id] }`.
- `supabase/functions/generate-questions/index.ts` now accepts an optional POST body `{ league_id, match_id? }`. With `league_id`, the league fetch is narrowed to one row; with `match_id`, eligible-matches are filtered to that single fixture. No-body cron path is unchanged.
- `create-league.html` fires `ensure-prematch` immediately after a league row is inserted (fire-and-forget).
- `league.html` fires `ensure-prematch` on every page load after league hydration (fire-and-forget).
- Idempotency unchanged — delegated to existing `prematch_question_budget` cap, pool fingerprint dedup ([pool-manager.ts](../supabase/functions/generate-questions/lib/pool-manager.ts)), and Jaccard dedup in [prematch-quality-filter.ts](../supabase/functions/generate-questions/lib/prematch-quality-filter.ts). No new lock table.
- Resolver, Arena, Battle Royale, Trivia: untouched.
- Custom leagues use the same cron-path fixture source (`fetchSportsContext`) — no special branching needed.
- Match Night attaches CORE_MATCH_PREMATCH against `league_id` (no `arena_session_id` path added).

**Deploy steps required:**
1. `supabase functions deploy ensure-prematch`
2. `supabase functions deploy generate-questions` (redeploy for body-parsing change)

# Spontix — Project State & Developer Handoff

Last updated 2026-05-04 — **League Scoring V2 implemented (pending deploy).** Canonical spec: [`docs/LEAGUE_SCORING_V2.md`](docs/LEAGUE_SCORING_V2.md). Migration 052 written and ready. Applies to ALL league-bound questions (Season-Long, Match Night, Custom — anything where `questions.league_id IS NOT NULL`). Arena and Battle Royale UNCHANGED.

**What V2 deletes for leagues:** the entire multi-multiplier formula (`base_value × time_pressure × difficulty × streak × comeback × clutch`). No speed reward, no streak multiplier, no comeback multiplier, no clutch multiplier, no difficulty tiers, no per-category base values. League questions now score flat +10/0 (Normal) or, optionally, with creator-enabled confidence (+15/-5 High, +20/-10 Very High). Negative scores allowed.

**Migration 052 (`backend/migrations/052_league_scoring_v2.sql`):** additive. Adds `player_answers.confidence_level TEXT DEFAULT 'normal'` (CHECK enum) and `leagues.confidence_scoring_enabled BOOLEAN DEFAULT false`. Existing rows get the column defaults — no backfill needed. Idempotent.

**Resolver (`supabase/functions/resolve-questions/index.ts`):** branches on `q.league_id`. League branch reads `confidence_level` from each answer + `confidence_scoring_enabled` from the league once per question (fail-closed — read error → Normal scoring + warning log). Skips the legacy formula entirely for leagues. Arena (`arena_session_id`) and BR (`br_session_id`) fall through to the unchanged V1 formula. New helper `calculateLeagueAnswerPoints(isCorrect, confidenceLevel)` lives next to the legacy multiplier helpers (which remain for Arena/BR). When league has confidence OFF but a player's stored `confidence_level` is non-Normal, the resolver forces Normal scoring.

**`league.html`:** new `renderConfidenceStrip()` renders a 3-chip selector (Normal / High / Very High) above the answer buttons when `currentLeague.confidenceScoringEnabled === true`. Default selection is Normal. Locks when answer is submitted (read-only thereafter). New `pendingConfidence` state map. `handleAnswer()` now sends `confidence_level` in the player_answers upsert. `loadAndRenderQuestions()` SELECT extended to fetch `confidence_level` so the locked chip displays after refresh.

**`create-league.html`:** four dead toggle rows removed (Risky Answers, Streak Bonuses, Live Stats Feed, Betting-Style Predictions — none had ever been wired to scoring or generation logic). Replaced with a single Confidence Scoring toggle, default OFF. New state var `confidenceScoringEnabled`, new handler `toggleConfidenceScoring()`, new `confidence_scoring_enabled` field on the launch payload. Review screen "Risky Answers / Streaks" rows replaced with a single "Confidence Scoring" row that shows On / Off.

**`spontix-store.js`:** bidirectional mapping for `confidence_scoring_enabled ↔ confidenceScoringEnabled`. `createLeague` accepts the snake_case field from the wizard.

**Backward compatibility:** already-resolved answers stay frozen (resolver only acts on `pending` rows). In-flight unresolved answers in pre-V2 leagues will score under V2 at next resolver run (flat +10/0 since `confidence_scoring_enabled` defaults to false). Mid-league scoring jump was explicitly accepted as the migration cost. The legacy V1 formula and helpers remain in the resolver for Arena and BR — do not delete them.

**Documentation:** new file [`docs/LEAGUE_SCORING_V2.md`](docs/LEAGUE_SCORING_V2.md) — full spec, scope, removal list, scoring table, UI rules, resolver rules, backward-compat, 14-row test matrix.

**Pending deploy:** migration not yet applied; resolver not yet redeployed.

---

Last updated 2026-05-04 — **Leagues hub real-data wiring + Clubs v1 + my-leagues.html removed.**

**`leagues-hub.html`** — placeholders gone, real user leagues now load from Supabase. `loadUserLeagues()` queries `league_members → leagues` for the current user, joins `sports_competitions` for display names, computes per-league member counts, and buckets each league into Active / Upcoming / Finished by `league_start_date` / `league_end_date` / `status`. Two filter rows added above the section list: **Source** (All / Created by me / Joined) and **Type** (All types / Season-Long / Match Night / Custom). Type filter chips and per-card type badges use the same colour system as the create-league.html Step 1 cards — lime for Season-Long, coral for Match Night, teal for Custom. Filters combine independently. Cards are the existing row layout (icon + name + badges + meta + Enter League button) — a brief experiment with a grid card style was reverted per user preference. **Critical fix**: the page was missing the `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` CDN tag → `window.sb` was undefined → status bar query and the new league-load both threw `TypeError: Cannot read properties of undefined (reading 'from')`. Added the CDN script before `supabase-client.js`.

**`leagues-hub.html` league type detection** — `leagueTypeKey(l)` returns `'season' | 'match' | 'custom'` from `creation_path` (Path A/B → season), then `league_start_date === league_end_date` → match, else custom. Used by both the Type filter and the per-card colored badge.

**`my-leagues.html` removed.** Three files updated to redirect to `leagues-hub.html` instead: `notifications.html` (3 fallback links), `league.html` (sidebar active marker + 2 post-action redirects in delete/leave league flows), `spontix-architecture.html` (3 architecture-map references). `git rm my-leagues.html` confirmed clean — no remaining references in any HTML or JS file. The leagues hub is now the single canonical leagues entry point.

**Clubs v1 shipped** (UI + structure + basic data flow only; no DB schema, no backend wiring):
- New page `clubs.html` (~660 lines, single file, mock data inline). Layout per spec: top header (name / member count / Invite button), then 2-column grid (collapses below 1100px). Left ~63%: dominant **Leaderboard** card (weekly / all-time tabs, podium highlight on top 3, "you" highlight) → **Activity feed** card (scrollable). Right ~37%: **Quick Actions** card (Play Battle Royale / Start Trivia / Create League — three vertically stacked buttons with type-colored icons) → **Members list** card (compact rows with avatar / name / rank). Mock club: 12 members, 8 activity items.
- Sidebar nav entry added: `Clubs` between Trivia and Find Venues, group icon (consistent with Leagues icon style).
- Club-game tagging mechanism: when a Quick Action is clicked, `sessionStorage` is set with `{ clubId, clubName, kind, ts }` under key `spontix_club_game`, AND the destination URL gets `?club=<clubId>` appended. Existing flows (BR, Trivia, Create League) currently **ignore** these signals — by design for v1. When club-game persistence ships, the resolver / leaderboard reads them.
- TODO block at bottom of `clubs.html` lists v2 backlog: real DB schema (`clubs`, `club_members`, `club_games`), persisting `clubId` on resulting BR/Trivia/League rows so the resolver can credit club leaderboard, real-time activity feed, roles + invites + kick/leave, multiple clubs per user (currently one hardcoded mock), club-vs-club competitions.

**Critical product rule documented in clubs.html header comment**: club leaderboard counts ONLY games played inside the club. Solo / public / external games must never count. Not enforceable in v1 (no club-game persistence) — explicit TODO.

---

Last updated 2026-05-04 — **Season-Long League rebuild shipped** (commits `b41fa90` → `74f6fd2`). Migration 051 applied ✅; `generate-questions` redeployed ✅. New canonical model implemented end-to-end per [`docs/LEAGUE_CREATION_FLOW.md`](docs/LEAGUE_CREATION_FLOW.md): three league types in Step 1 (Season-Long / Match Night / Custom), with Season-Long forking in Step 2 into **Path A (team-based, multi-competition)** or **Path B (competition-based)**.

**Migration 051** adds `creation_path TEXT CHECK IN ('team','competition')` and `api_sports_league_ids INTEGER[]` to `leagues`. Trivial backfill: existing rows mirror their `api_sports_league_id` into a one-element array. Legacy rows with NULL `creation_path` continue to work via the existing `api_sports_league_id` column. Two new indexes (creation_path partial, GIN on the array).

**`spontix-store.js`** maps both new fields in `_mapLeagueFromDb` (with legacy fallback `[api_sports_league_id]` when array is null) and `_mapLeagueToDb`.

**`create-league.html`** — new Season-Long fork (`#season-long-fork`):
- Path A: cross-competition team search (queries `sports_teams` filtered by sport + `ilike` name) → competition multi-select chips auto-detected from `sports_teams` registration union with `api_football_fixtures` future-fixture scan (per-comp fixture count + next kickoff shown) → preview card (loaded fixture count + practical date range + knockout-gap note when applicable).
- Path B: competition picker → preview card.
- Auto-derived dates: `league_start_date = today`, `league_end_date = max(kickoff_at)` of loaded fixtures (informational only per spec § R4). Manual date inputs hidden for Season-Long.
- Knockout-gap UX uses the conservative fallback wording mandated by spec § R3 — never "team still active in competition" until a real `team_still_active` signal is wired: `"No fixtures scheduled yet — competition availability detected. More fixtures may appear if the team progresses or data updates."`

**`generate-questions/index.ts`** SELECT extended with `creation_path` + `api_sports_league_ids`; filter accepts either legacy singular OR new array. New fan-out step expands each league row into one virtual entry per competition with `api_sports_league_id` overridden — downstream pipeline unchanged. Quota correctly cumulates by `league.id` across competitions.

**Three polish bugs caught during verification and fixed in the same sprint:**
- B1 (severe): `weeks` calc was reading the hidden date inputs for Season-Long → `ai_total_quota = weekly` (e.g. 10) instead of `weekly × ~30 weeks`. Fixed by recomputing `weeks` AFTER the date overrides + a `Math.max(weeks, 30)` floor for Season-Long. Verified in production: Season-Long rows now show `ai_total_quota = 300` (Elite tier).
- B2 (review screen): scope/team labels for Path A read legacy `leagueScope` and `selectedScopedTeam` instead of `seasonPath` / `slSelectedTeam`. Fixed.
- B3 (review screen): duration row hidden for Season-Long because date inputs were empty. Fixed — now shows derived range from `slLoadedFixtures` or knockout-gap copy.

**Two latent bugs fixed during the live smoke test:**
- Path A team search results were unclickable: `JSON.stringify(name)` produced `"Barcelona"` (with double quotes) inside an `onclick="..."` attribute that ALSO used double quotes → silent HTML break. Fixed by encoding inner quotes to `&quot;` via a `_attrJson` helper.
- Custom League insert failed with Postgres `23502` (NOT NULL violation): `ai_weekly_quota` and `ai_total_quota` columns are `NOT NULL` (default 0) but the launch payload sent `null` when AI questions were toggled off. Fixed by sending `0` instead of `null`. (Pre-existing bug, exposed by Custom systematic testing — never tripped because users had AI on by default.)

**Production-data verification (all four league types confirmed in DB):**

| Type | `creation_path` | `api_sports_league_ids` | Notes |
|---|---|---|---|
| Path A multi-comp (Barcelona + La Liga + UCL) | `team` | `[140, 2]` | Multi-comp persists |
| Path A single-comp (Barcelona + La Liga) | `team` | `[140]` | scoped_team_id=529 |
| Path B (La Liga) | `competition` | `[140]` | scoped_team_id=null |
| Match Night (Barcelona vs Real) | `null` | `[140]` | Legacy unaffected |

**Documentation locked in this sprint:**
- New: [`docs/LEAGUE_CREATION_FLOW.md`](docs/LEAGUE_CREATION_FLOW.md) — canonical spec for the three league types, R1–R5 lifecycle rules, League Completion Condition (fixture-source-exhaustion), data freshness rule, zero-fixtures UX rule, conservative `sports_teams`-registration fallback, storage shape (temporary `INTEGER[]` with future `league_competitions` join-table refactor noted). Five revisions during the spec-locking phase.
- New: [`docs/LEAGUE_COMPLETION_EVALUATOR_TODO.md`](docs/LEAGUE_COMPLETION_EVALUATOR_TODO.md) — evaluator backlog spec. Required external signals (`team_still_active`, `season_end_date`) NOT yet sourced; evaluator intentionally not built this sprint to avoid premature-completion risk.
- Updated: [`docs/GAMEPLAY_ARCHITECTURE.md`](docs/GAMEPLAY_ARCHITECTURE.md) Pillar 1, [`docs/GAME_ARCHITECTURE_MAP.md`](docs/GAME_ARCHITECTURE_MAP.md) Pillar 1, header pointer comment in `create-league.html`.

**Known limitations carried into production (documented):**
- Conservative `sports_teams`-registration fallback for Path A competition selection. Cup competitions may be sparsely populated in `sports_teams` — Path A will under-detect cup participation in those cases (separate task).
- Season-Long leagues stay `status='active'` indefinitely. No completion evaluator. Manual admin closure required if needed. Tracked in `LEAGUE_COMPLETION_EVALUATOR_TODO.md`.
- B1 quota floor of 30 weeks is a fixed constant; future refactor should source actual season length from `season_end_date` once that signal exists.

---

Last updated 2026-05-04 (BR lobby cinematic Step 1 — commits `dcf861f` → `6540f9e`). Step 1 of `br-lobby.html` rebuilt as the cinematic survival lobby originally shipped behind a preview flag: full-viewport animated background (`.pv-bg` lifted out of `#step-1` to `.main` level with `position: fixed; top:0; right:0; bottom:0; left:260px` so its glow + canvas particles span the entire viewport area next to the sidebar; `.show` class toggled by `goStep()` so it fades out on Step 2 / Waiting Room). Top steps-bar hidden via `.steps-bar { display: none !important; }` — the original `display:flex` rule lower in the file was winning by source order; `.step-pill` nodes remain in the DOM so the existing active-state JS keeps working. Mode-card system fixed: `selectMode()` was calling `.mode-card` selector but the cinematic cards use `.pv-mode` class — old `.selected` was never cleared, so both Classic and Ranked could be selected simultaneously and neither could be deselected. Now queries `.pv-mode`, supports click-again-to-deselect (clears selection + hides action row), and both cards are visually symmetric (`grid-template-columns: 1fr 1fr`, no permanent `scale(1.02)` or lime glow on Ranked at rest — "Recommended" badge is the only differentiator until clicked). All BR backend (migrations 042–050, RPCs, scoring) untouched.

Last updated 2026-05-04 — Continuation of the platform-wide UI sprint (commits `4ff076c` → `05ad70c`). New player surfaces and a critical BR fixture-list bug fix, **zero backend changes**: (1) Sidebar gets `Game Center` rename + new entries `Fixtures`, `Find Venues`, `Messages`, `Help`, `Support`. Profile footer becomes a 4-button action bar (Notifications / Messages / Support / Logout) with unread badges. (2) New `chat-popups.js` injects three sidebar popups on every player page — Notifications uses **real data** from `notifications` (migration 005), Messages + Support are clearly-labelled mock data. (3) New page `message-center.html` — modern 2-pane messenger (DMs + league chats), mock data, full conversation thread + composer + tabs. (4) New page `support.html` — contact form (Topic / Priority / Subject / Message + screenshot upload, 5 MB client-side limit) + Spontyx inbox + Quick Answers card linking to Help. (5) New page `help.html` — 7 categorised FAQ accordion with real-time search; **all answers are intentional `<em>— add answer —</em>` placeholders to fill in pre-launch.** Game Modes section follows the user's spec: each pillar gets *what is it / how does it work / how many players / what modes within it*. (6) `matches.html` (Fixtures) rebuilt as the central match-driven entry point: Sport + League chip filters cascading from real data, three primary CTAs per match (Create League / Enter Arena / Battle Royale) + Save (kept). (7) **Critical BR Step 2 fix**: SELECT was reading non-existent `league_name` column → entire query failed → empty state always shown. Fixed by mirroring `matches.html` SELECT and joining `sports_competitions` for canonical names. Window expanded -2h/+48h → -3h/+14d. (8) Dashboard "Ready to Play" gains Leagues card (4 cols); duplicate bottom 4-pillar grid removed. (9) Unified mode header now applied to: dashboard ("Game Center"), activity ("Your Games"), upcoming ("Schedule"), notifications ("Notifications"), venues ("Find Venues"), matches ("Fixtures"), leaderboard ("Leaderboard"). `.app-shell { flex: 1 }` promoted to global so all pages center consistently next to the sidebar. (10) BR vertical hierarchy under header (24/16/20/22 px). (11) `create-league.html`: Event League card hidden until NFL Draft 2027 launch. (12) **Leaderboard Phase 1** shipped — see `docs/LEADERBOARD_ARCHITECTURE.md` for the full audit; live activity strip, 3-axis filter system with disabled "Soon" chips for unbuilt boards, right context panel with Your Ranking / Your Ratings / Next Target, `?view=` deep links, `br-leaderboard.html` redirected to `leaderboard.html?view=br`. All existing dynamic IDs and JS functions preserved verbatim. Sole real-data new touch is the notifications popup (existing table); Messages/Support/Help-FAQ answers are demo content awaiting fill-in.

Last updated 2026-05-03 — UI overhaul sprint shipped (commits `d32781b` → `4ff076c`). Six surfaces redesigned, zero backend changes: (1) `leagues-hub.html` rebuilt as a hero + status bar + Active/Upcoming/Finished section list; sidebar init bug fixed (`SpontixSidebar.init()` was called with no args). (2) `multiplayer.html` (Arena) wrapped in app-shell so sidebar persists; `const SpontixSidebar` const-vs-window bug fixed; `.app-shell { flex:1 }` + `.main { width: calc(100vw - 260px) }` corrects centering inside the shell; Step 1 widened to 1180px with scaled cards + bounded CTA. (3) `br-lobby.html` reframed from 1v1/FFA to Classic/Ranked modes (UI-only — DB still writes `mode='ffa'` until a Phase 4 server-side gate ships); lobby sizing constants `BR_MIN=4 / TARGET=10 / MAX=12` with 60s auto-fill + 15s target countdown; Ranked-dominant card hierarchy + ambient live-feel row + lime radial glow. (4) `trivia.html` wrapped in app-shell; `#screen-hub` rebuilt as a 3-column command center (profile/stats/tier · 3 large mode cards · recent + performance + suggested); demo-nav debug strip removed. (5) `dashboard.html` rebuilt as a game control center: Player Status panel (Arena lime + BR coral rating split, Last 5 pips, Next-level unlocks) → Live activity strip → Ready to Play 3-card row; Your Plan tier panel with usage bars; pillar cards gain pulsing status sub-lines + hover lift/glow. (6) **Unified mode header** added in `styles.css` (`.mode-header`, `:root --mode-header-h: 76px`) and applied to all four game-mode pages — old per-page hero blocks (`.lh-hero`, `.arena-hero`, `.br-header`, `.topbar`) removed; per-mode icon tints (`.icon-leagues/arena/br/trivia`); inert "How to Play" chip wired in a future sprint. **All existing dynamic IDs and JS functions preserved.** `docs/GAMEPLAY_ARCHITECTURE.md` and `docs/BR_SESSION_SYSTEM.md` updated with the canonical "Battle Royale — Final Product Definition" (survival, no 1v1/FFA, Classic/Ranked only, 8–12 players, no-answer = damage) plus a five-item Phase 4 server-side enforcement TODO for production Ranked BR.

Last updated 2026-05-02 — Battle Royale Phase 3 ELO ratings deployed. Migration 050 (`update_br_ratings`) applied ✅. `update_br_ratings(p_session_id UUID)` SECURITY DEFINER RPC computes and writes ELO (SR) rating changes after a completed BR session. Reads placements from `br_session_players`, applies pairwise ELO against every other participant, then writes `br_rating_before/after/delta` to `br_session_players` and updates `users.br_rating/br_games_played/br_rating_updated_at`. ELO model: K-factor tiers (32 when `br_games_played < 5`, 24 when `< 20`, 20 when `≥ 20`); pairwise delta for each opponent = `K × (actual − expected)` where `expected = 1/(1 + 10^((opp_rating − own_rating)/400))`, actual = 1/0.5/0 for win/tie/loss; total delta normalised by `GREATEST(1, N−1)` to keep magnitude ~= 1v1 regardless of lobby size; rating floor 800 (starts at 1000); delta clamp [-100, +100]. Idempotent: returns `{skipped:true}` if any player already has `br_rating_before` set. Session must be `completed` and have ≥ 2 players with placements. GRANT EXECUTE to `authenticated, service_role`. All migrations 001–050 applied ✅.

Last updated 2026-05-02 — Migration 049: `BR_MATCH_LIVE` question type + BR pool INSERT RLS applied ✅. Two targeted changes: (1) `questions.question_type` CHECK constraint expanded to include `'BR_MATCH_LIVE'` — resolves DB constraint violations when the resolver or RPCs write BR question types; (2) authenticated INSERT RLS policy `br_pools_insert` added to `br_match_pools` — unblocks lobby creation from the browser (previously only `service_role` could insert, blocking `br-lobby.html`); (3) authenticated INSERT RLS policy `br_pool_questions_insert` added to `br_match_pool_questions` for future admin/seeding flows. All three changes are idempotent (wrapped in `DO $$ IF NOT EXISTS` guards).

Last updated 2026-05-02 — New `br-lobby.html`: full Battle Royale lobby page (1,110 lines). 3-step wizard flow: Step 1 (Match Selection — search/filter live and upcoming fixtures from `api_football_fixtures`), Step 2 (Config — player count 2–8, half scope Full/First/Second, question count), Step 3 (Waiting Room — Supabase Realtime on `br_session_players` channel, live player join list with avatars). Coral accent theme (`linear-gradient(135deg, var(--coral), #E84545)` icon glow). Standard platform layout: `<div id="sidebar-placeholder"></div>` + `<div class="main">` — removes double-offset bug that existed in prior page-wrap pattern. Uses `window.sb.auth.getUser()`, Supabase Realtime, `instantiate_br_session` RPC to transition session `waiting→active` when all players join. `sidebar.js` now links `Battle Royale → br-lobby.html`.

Last updated 2026-05-02 — New `br-session.html`: full Battle Royale session gameplay page (1,158 lines). Immersive dark theme with own CSS variables (`--bg: #080815`, `--card: #0f1020`, HP colour tiers: `--hp-green/#hp-yellow/#hp-red`). Sticky topbar with BR logo (red accent), session ID, round counter. HP bars for every player — colour coded green→yellow→red→eliminated as HP drops; smooth CSS transition on every HP change. Round-based question feed: one question per round, 30s answer window, answer locks on submit, round advances via `advance_br_session_round()` RPC. Real-time updates via three Supabase Realtime channels: `br_sessions` (status/round tracking), `br_session_players` (HP/elimination/placement), `questions` filtered by `br_session_id`. Eliminated players shown with skull icon + greyed HP bar; final placements rendered on session complete. Standalone page — no platform sidebar (full-screen immersive experience intentional).

Last updated 2026-05-02 — New `leagues-hub.html`: consolidated Leagues hub page (1,016 lines) replacing the separate `my-leagues.html` + `discover.html` split. Single page with two-tab layout: **My Leagues** (leagues you own or are a member of, with Create New League + Join a League action buttons) and **Discover** (public leagues with sport/competition/team filters). Stats row shows active count, total joined, weekly creation quota used, max members across leagues. `sidebar.js` now links `Leagues → leagues-hub.html` (previously `my-leagues.html`). Standard platform layout.

Last updated 2026-05-02 — `sidebar.js` navigation restructure. Player nav items reordered and expanded: Dashboard → Leagues (→ `leagues-hub.html`) → Arena (→ `multiplayer.html`) → Battle Royale (→ `br-lobby.html`, coral `BR` badge: `background:linear-gradient(135deg,#FF6B6B,#E84545)`). New section headers: `Rankings` (containing Leaderboard) and `Account`. Leagues badge injection updated to query `a[href="leagues-hub.html"]`. `Your Games` and other removed links cleaned up.

Last updated 2026-05-02 — `dashboard.html` 4-pillar game-mode card overhaul. Four equal-width game-mode cards displayed in a `repeat(4, 1fr)` grid (gap 14px) above the existing nav card section. Cards: **Leagues** (purple accent, →`leagues-hub.html`, icon 🏆, stat line shows active league count), **Arena** (lime accent, →`multiplayer.html`, icon ⚔️, "1v1 / 2v2 live duels"), **Battle Royale** (coral accent, →`br-lobby.html`, icon 💀, "Survive to win"), **Trivia** (teal accent, →`trivia.html`, icon 🧠, "Solo & party modes"). New CSS accent classes: `.coral-accent` (coral bg/glow), `.teal-accent` (teal bg/glow) added alongside existing `.purple-accent`. Cards use the standard `.nav-card` pattern with coloured left border, icon pill, title, subtitle, and → arrow.

Last updated 2026-05-02 — New docs directory populated with 4 architecture reference files (all untracked until this commit): `docs/ARENA_SESSION_SYSTEM.md` — authoritative reference for the full arena session system (lifecycle, tables, completion trigger, live generation, scoring, XP, ELO, spectator mode, RPCs, Realtime channels); `docs/BR_SESSION_SYSTEM.md` — authoritative reference for the server-authoritative BR session system (migrations 042–050, HP mechanics, round advancement RPC, ELO model, br-lobby/br-session frontend integration); `docs/GAMEPLAY_ARCHITECTURE.md` — cross-cutting gameplay architecture overview (question lifecycle, answer submission paths, scoring formula, multiplier systems, all three session types); `docs/GAME_ARCHITECTURE_MAP.md` — visual navigation map of all game modes, their frontend pages, backend tables, and RPCs.

Last updated 2026-05-01 — Battle Royale Phase 1 backend fully deployed. Migrations 042–048 all applied ✅. `resolve-questions` redeployed with BR support + `br_only=1` param. Deferred `br_sessions_update_own` RLS policy applied. Full deployment log: (042) `br_sessions` table — lobby-ID FK, lifecycle status, round tracking columns (`current_question_seq`, `last_processed_seq`, `total_questions`), winner FK, Realtime publication, select + insert RLS; (043) `br_session_players` — HP system (start=100, floor=0, cap=150), `current_streak`, `is_eliminated`, `placement`, `eliminated_at`, Realtime publication, read-all + own-insert/delete RLS, `idx_br_session_players_session_alive` partial index; (044) `questions.br_session_id` FK + `idx_questions_br_session` partial index + drops old strict `questions_exactly_one_owner` constraint + adds permissive `questions_session_exclusivity` (league_id OR arena_session_id OR br_session_id); (045) `player_answers.br_session_id` FK + `idx_player_answers_br_session` partial index + three-path `pa_insert_self` (PATH A: league member, PATH B: arena participant, PATH C: active BR player `is_eliminated=false`) + three-path `pa_select_member`; timing check uses subquery to `questions.answer_closes_at/deadline` (RLS `WITH CHECK` cannot reference cross-table columns directly); (046) `users.br_rating INTEGER DEFAULT 1000`, `br_games_played INTEGER DEFAULT 0`, `br_rating_updated_at TIMESTAMPTZ`; `br_session_players.br_rating_before/after/delta INTEGER`; leaderboard index `(br_rating DESC) WHERE br_games_played > 0`; (047) three SECURITY DEFINER RPCs: `instantiate_br_session(UUID,BIGINT,INTEGER)` — waiting→active, sets seq=1, records started_at; `finalize_br_session(UUID)` — internal helper, assigns placements, sets winner_user_id, marks completed; `advance_br_session_round(UUID,INTEGER,BOOLEAN=false)` — idempotent via `last_processed_seq` guard, applies HP deltas per player (wrong=-15, correct streak 2=+5/3+=+10, bonus question adds `br_correct_reward`), eliminates players (hp=0), assigns placement=survivors+1 for ties, advances seq, calls `finalize_br_session()` when ≤1 survivor or last question; (048) `br-resolve-every-minute` pg_cron job (`* * * * *`, jobid=9) — calls `resolve-questions?br_only=1` every minute for sub-60s round resolution; hourly resolver (job 3) retained as safety net — double-processing safe via idempotency guard. Deferred `br_sessions_update_own` UPDATE policy applied after both 042+043 confirmed present. Phase 3 `update_br_ratings()` RPC (writing actual ELO deltas to `users.br_rating`) remains a future sprint.

Last updated 2026-05-01 — Arena Session Completion Trigger (migration 039). `complete_arena_session(p_session_id UUID)` SECURITY DEFINER RPC is now the single authoritative write path for marking a session as completed. Four guards enforce correctness: session must exist, session must be `active`, at least 1 question must exist, 0 pending questions may remain; idempotent — already-completed/cancelled sessions return existing winner fields without re-writing. Winner logic: 1v1 compares `arena_session_players.score` (highest wins, tie = draw); 2v2 sums score by `team_number` (highest team wins, tie = draw). `resolve-questions/index.ts` calls `maybeCompleteArenaSession(sb, sessionId)` fire-and-forget helper after every terminal question transition (resolve + all post-arena-guard void paths: `resolution_deadline_passed`, `player_status_no_historical_data`, `no_match_id`, dead match statuses, `unresolvable`, `invalid_predicate`). Void paths that skip the check: `arena_session_status_lookup_failed` and `arena_session_not_active` (session isn't active; RPC guard handles safely). `arena-session.html` `renderFeed()` adds a client-side fallback: when `!hasActive && sessionData.status === 'active'` the holding card is shown AND a fire-and-forget RPC call is made — if the RPC completes the session, the Realtime subscription at line 1857 fires `showCompleteOverlay()` for all clients (players + spectators). `showCompleteOverlay()` is NEVER called directly from the fallback path. Three structured log events: `[arena-complete] completed`, `[arena-complete] pending`, `[arena-complete] no_questions`, `[arena-complete] skipped`. GRANT EXECUTE to `authenticated` + `service_role`. All migrations 001–039 applied ✅ (migration 039 must be run in Supabase SQL editor; `resolve-questions` must be redeployed).

Last updated 2026-05-01 — Arena Spectator Mode live. Migration 038 applied ✅. `arena_sessions.is_spectatable BOOLEAN NOT NULL DEFAULT false` — opt-in, fail-closed (private by default). Non-participants visiting an arena session URL are gated: if `is_spectatable = false` → static "Private Session" locked screen with back button, no redirect; if `is_spectatable = true` → `isSpectator = true`, purple spectator banner shown. Spectator rules in `arena-session.html`: answer buttons disabled + no `onclick` (triple-layered: JS guard in `handleAnswer()`, no click binding in `renderCard()`, DB RLS blocks insert); `spectatorHideOutcome = isSpectator && state !== 'resolved'` — correct answer never revealed until question resolves; `showCompleteOverlay()` spectator branch shows score + correct count only, skips `awardSessionXp()`, `updateArenaRatings()`, and `renderQuestionReview()`. No RLS changes — `pa_select_member` already blocks spectators from reading any `player_answers` rows. All migrations 001–038 applied ✅.

Last updated 2026-05-01 — Full deployment ✅. Commit `6784c7f` pushed to `main` on `combatdefenderweprotect-oss/Spontyx` (17 files, 2,877 insertions). All three Edge Functions deployed to `hdulhffpmuqepoqstsor`: (1) `resolve-questions` — full 6-multiplier scoring, clutch detection + XP via `clutch-detector.ts`, `increment_arena_player_score()` atomic arena scoreboard sync live, arena session status guard (fail-closed), AI REAL_WORLD fallback via `ai-verifier.ts`; (2) `generate-questions` — arena live generation loop, `live_only=1` URL param, `clutch_context` written at generation time; (3) `live-stats-poller` — fire-and-forget trigger to `generate-questions?live_only=1` after each fixture upsert. Smoke test confirmed resolver healthy: `{"ok":true,"resolved":0,"voided":1,"skipped":0,"errors":0,"total":1}`. All arena session features fully live: in-session history drawer, completion overlay question breakdown, 9-tier arena ELO rating, Arena leaderboard tab, XP bars on dashboard + profile. All migrations 001–037 applied ✅. All Edge Functions deployed ✅.

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
