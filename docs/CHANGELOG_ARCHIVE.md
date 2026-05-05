# Spontix Changelog — Archive

Full historical log of older changes. For recent updates, see [CHANGELOG_RECENT.md](CHANGELOG_RECENT.md).

---

## Update Log

### 2026-05-04 — Platform-wide UI continuation: popups, messaging, help center, fixtures, BR fixes

Continuation of the 2026-05-03 sprint. **Zero backend, no migrations, no RPC changes, no routing rename.** Everything below is UI/UX, sidebar nav additions, three new player pages, and one defensive bug-fix for the leaderboard popup data.

**Sidebar (`sidebar.js`):**
- `Dashboard` label → **`Game Center`** (href and icon unchanged so all existing links still work).
- New player nav entries:
  - **Fixtures** (→ `matches.html`) under the schedule cluster
  - **Find Venues** (→ `venues.html`) under new "Play in Person" section header
  - **Messages** (→ `message-center.html`), **Help** (→ `help.html`), **Support** (→ `support.html`) under the Account section
- Profile footer restructured: avatar + name/tier on top row, then a 4-button **action bar** below (🔔 Notifications · ✉️ Messages · 🛟 Support · ⏏ Logout). Logout merged into the same row instead of a one-off button. Unread badges on the notifications + messages buttons.
- Sidebar.js auto-loads `chat-popups.js` once per page (player nav only) so every shell page gets the popup widgets without manual `<script>` tags.

**`chat-popups.js` (new — popup widgets for the sidebar action bar):**
- Three popups injected into `<body>` on first sidebar render: Notifications, Messages, Support.
- **Notifications popup**: real data from `notifications` table (migration 005 triggers populate it). Shows last 8 items, "Mark all read" runs an `update is_read = true` against actual rows, badge count from unread, footer link → `notifications.html`.
- **Messages popup**: 5 mock conversations. Click any row → expands inline quick-reply input + Send button. Clearly labelled "Demo data — backend ships in a future sprint". Footer link → `message-center.html`.
- **Support popup**: 2-row mock inbox + textarea contact form. Footer link → `support.html`.
- Click-outside / ESC closes. `window.SpontixPopups` exposed for debugging.

**`message-center.html` (new):**
- Unified mode header (purple `.icon-messages` tint) + tabs (All / Direct / Leagues) + modern 2-pane messenger:
  - **Left**: conversations list with search input + "New message" button
  - **Right**: active thread with avatars, day separators, you/them bubbles, online status, composer with Send button + Enter shortcut
- Mobile: list and thread swap; back arrow returns to list
- 5 mock conversations, 5 mock threads with realistic banter (player DMs + league chats)
- Sending a message updates the local thread + bumps the list preview; toast notes that the backend ships later
- Width: full content area (`width: 100%`, no `max-width` cap)

**`support.html` (new):**
- Unified mode header (teal help icon) + 2-column layout: contact form on the left, Spontyx inbox on the right
- **Contact form**: Topic + Priority on a single 2-column row · Subject input · Message textarea · screenshot upload field (PNG/JPG, 5 MB client-side limit, drag-or-click drop zone with filename + clear button after pick) · Send button + "We typically respond in under 24h" hint inline
- **Inbox**: 3 mock system messages with read/unread state
- Width: fills available space (`width: 100%`, breakpoint 1100px for stack)
- Form alignment uses `.sp-field` flex-column wrappers so labels sit cleanly above inputs (was inconsistent with bare `<div>` wrappers before)

**`help.html` (new) + `support.html` Quick Answers card:**
- Shared accordion + search system (`.help-*` classes in `styles.css`) — used on both pages so styling is one source of truth
- **`help.html`** is the full FAQ encyclopedia: 7 grouped category cards with real-time search across category title + question text + answer text:
  - Spontyx Basics · **Game Modes** (Leagues / Arena / Battle Royale / Trivia subsections — each gets 4 questions: *what is it · how does it work · how many players · what modes/sub-modes within it*) · Scoring & Multipliers · Leaderboards · Account & Tiers · Real-World Questions · Venues & Events
- **`support.html`** Quick Answers card: same accordion system but a 6-question hand-picked subset + "See all answers →" link to `help.html`
- All answers are intentionally `<em class="placeholder">— add answer —</em>` stubs for fill-in pre-launch. The user will populate real copy at the end.
- Demo-data note on `help.html`: "Answers fill in pre-launch."

**`matches.html` (Fixtures) — mode-driven entry-point redesign:**
- Old `.page-header` ("Browse Matches") replaced with the unified `.mode-header` (lime `.icon-fixtures` tint, title "Fixtures", subtitle "All upcoming matches across every sport. Pick one and choose how you want to play it.")
- Filter bar restructured into the same chip system used on BR Step 2 + leaderboard: search input + Sport row (Football today, multi-sport ready) + League row (dynamic chips from real `api_football_fixtures` + `sports_competitions` join). Sport→League cascade rebuilds available leagues; orphaned selections fall back to "All"
- Removed: right sidebar (Overview stats + Competitions list — duplicated by chips), date-tabs (out of scope per the user's filter spec)
- Per-card actions row: replaced the single "Match Live" button with **three primary CTAs + Save**:
  - 🟣 **Create League** → `create-league.html?prefill_match=1&...` (existing prefill flow, pre-binds the match)
  - 🟢 **Enter Arena** → `multiplayer.html`
  - 🔴 **Battle Royale** → `br-lobby.html`
  - 🔖 **Save** (kept) — adds match to Schedule; post-save inline CTA flow preserved
- Actions row uses `flex-wrap` so it stacks gracefully on narrow screens

**`br-lobby.html` Step 2 (Battlefield) — finally working:**
- **Critical fix**: SELECT was `select('..., league_name')` but `api_football_fixtures` has **no** `league_name` column (only `league_id`). Postgres rejected the column → entire SELECT failed → empty state always shown regardless of how many fixtures existed. Now mirrors `matches.html` exactly: `fixture_id, league_id, kickoff_at, status_short, home_team_name, away_team_name, round`.
- Window expanded from `-2h to +48h` (limit 60) → `-3h to +14d` (limit 200) — same as Fixtures.
- League names canonicalised via `sports_competitions` join (`compById[league_id]`) → display chip names match Fixtures exactly.
- Errors now surface in the empty-state message instead of being swallowed under generic copy.
- BR Step 2 chip system itself (Sport / League cascading) was added in the prior session pass; now actually populates because the underlying query works.

**Unified mode header now applied to:**
- `dashboard.html` ("Game Center", lime icon) — replaces `.topbar` + "Welcome back, Bran" page-header. Subtitle dynamic: "Welcome back, {name} — your platform-wide control center." `#dash-welcome-name` span hydrated by both `hydrateFromStore()` and `applyRealProfile()`. Hidden legacy `.page-header h1 span` kept as a safety net for any unseen JS targeting it.
- `activity.html` ("Your Games", coral icon — lightning bolt)
- `upcoming.html` ("Schedule", teal icon — calendar)
- `notifications.html` ("Notifications", coral bell). Also fixed missing `supabase-client.js` + `spontix-store.js` script tags that prevented the sidebar profile from rendering on this page.
- `venues.html` ("Find Venues", gold pin)
- `matches.html` ("Fixtures", lime clock)
- `leaderboard.html` ("Leaderboard", gold trophy) — Phase 1 redesign per `docs/LEADERBOARD_ARCHITECTURE.md`. See its own dedicated entry below.

**Mode header consistency fixes:**
- `.app-shell { flex: 1; min-width: 0; width: 100% }` promoted to global in `styles.css` — was previously only scoped to `multiplayer.html`. Without it, body `display: flex` made `.app-shell` a flex item with default `flex: 0 1 auto` that could collapse, leaving `.main` narrower than the area next to the sidebar. This was why Leagues looked off-centre vs Arena.
- BR `.main { padding: 28px 40px }` was wrapping the unified `.mode-header`, pushing it 40px inward vs Arena/Trivia. Fixed: `.main { padding: 0 0 40px }` + sibling selector `.main > *:not(.mode-header):not(.br-bg-glow) { padding-left: 40px; padding-right: 40px }` so the mode header is full-width like the other pages while BR's content beneath keeps the same 40px (16px mobile) inset.
- `.icon-messages` (purple), `.icon-yourgames` (coral), `.icon-schedule` (teal), `.icon-gamecenter` (lime), `.icon-fixtures` (lime), `.icon-help` (teal), `.icon-leaderboard` (gold), `.icon-venues` (gold), `.icon-br` (coral), `.icon-arena` (lime), `.icon-leagues` (purple), `.icon-trivia` (teal) — full per-page tint palette for the shared `.mode-icon`.

**Battle Royale lobby vertical hierarchy under header:**
- Players row was sitting flush against the mode-header — cramped vs Arena and Trivia which already breathe via internal top padding.
- Hierarchy applied (header → context → rules → interaction):
  - header → `.br-live-row` (players online): 24px medium
  - `.br-live-row` → `.br-tension` (survival strip): 16px small
  - `.br-tension` → `.steps-bar`: 20px larger (kept)
  - `.steps-bar` → step content: 22px (kept)
- Also removed a previously-dead `.main > .mode-header + *:not(.br-bg-glow) { margin-top }` rule (the absolutely-positioned `.br-bg-glow` sits between the header and the next element in DOM, so the adjacent-sibling selector never matched).

**Dashboard Ready-to-Play consolidation:**
- "Ready to Play" grid expanded from 3 → 4 columns. Added **Leagues** card (purple icon) so all four pillar destinations are reachable from one row.
- Removed the bottom 4-pillar `.action-cards-grid` block entirely. It was duplicating the same destinations and made the page feel longer than necessary. Single, clear mode-entry surface now.
- Responsive: 4 cols ≥1100px → 2 cols 600–1099 → 1 col <600.

**`create-league.html`: Event League hidden:**
- Event League card commented out of Step 1 (debut at NFL Draft 2027). Players now see three types: Season-Long, Match Night, Custom.
- The `'event'` value is still in the `typeNames` map and `selectType()` accepts any string, so any prefilled URL with `league_type=event` continues to work and re-enabling the card is purely an HTML uncomment.

**Leaderboard Phase 1** — see commit `406bbca` and the dedicated `docs/LEADERBOARD_ARCHITECTURE.md` for the full audit. Highlights: unified mode header, live activity strip, 3-axis filter system (Scope · Mode · Time) with disabled "Soon" chips for Combined / Trivia / Rising / Speed / Clutch / Survival / Consistency, two-column grid (main list + 320px right context panel), pre-load Arena + BR data on init so the right panel populates without tab switches, `?view=` URL deep-link param, `br-leaderboard.html` redirect to `leaderboard.html?view=br`. Existing `loadLeaderboardData` / `loadArenaLeaderboard` / `loadBrLeaderboard` / `getLeagueLeaderboard` / `SpontixStoreAsync.getLeaderboard` and all render functions preserved verbatim.

**Constraints honoured across the sprint:**
- Zero backend / Supabase / RPC / migration / routing changes
- All existing dynamic IDs preserved (`activity-alert`, `dash-xp-*`, `dash-arena-*`, `dash-trophy-count`, `badge-live`, `nav-games-sub`, `nav-schedule-sub`, `mp-page-title`)
- All existing JS functions untouched (`selectMode`, `selectFormat`, `enterLobby`, `handleBack`, `goStep`, `goScreen`, `tryInstantiate`, `refreshWaitingRoom`, `switchView`, `selectTime`, `selectCat`, `loadArenaLeaderboard`, `loadBrLeaderboard`, etc.)
- DB CHECK constraints (e.g. `br_sessions.mode IN ('1v1','ffa','2v2')`) untouched — Classic vs Ranked distinction is client-side only with the Phase 4 migration TODO documented in `docs/BR_SESSION_SYSTEM.md`
- Notifications popup is the **only** new piece touching real data (uses the existing `notifications` table from migration 005). Messages + Support popups + Message Center page + Help/FAQ answers are all explicitly labelled "Demo data" / "Answers fill in pre-launch"

---

### 2026-05-03 — UI overhaul sprint: dashboard, mode pages, unified header

**Scope:** UI/UX/layout only across the four game-mode pages and the dashboard. **Zero backend, JS logic, Supabase, RPC, migration, or routing changes.** All existing dynamic IDs and hydration paths preserved.

**`leagues-hub.html` — full redesign (commits `d32781b` → `ef38aa0`):**
- Replaced static "My Leagues" stat boxes with a hero panel: title + subtitle + two prominent CTAs (Create League / Discover Leagues).
- New 3-pill **Game Status Bar** (`🔥 N leagues live`, `⚡ N questions waiting`, `🏆 N leagues joined`) hydrated by lightweight Supabase queries on `league_members` + `questions`. Live count = open questions where `question_type='CORE_MATCH_LIVE'` or `match_minute_at_generation` is set.
- Replaced Created/Joined/History tabs with status-grouped sections: **Active / Upcoming / Finished**. Active section title has pulsing coral dot.
- New 4-column league cards (icon | info | rank | Enter League CTA). Hover lift + glow. Coral live-edge accent + pulsing LIVE badge for active games. Solo cards show "Solo" badge + teal Solo rank label.
- Mobile: stacks to single column under 720px.
- Discover tab dropped from this page; reached only via the hero CTA to `discover.html`.
- Added explicit `.content { flex:1; width:100%; padding:28px 36px 48px }` to fill the full available area next to the sidebar (no max-width cap).
- Sidebar init bug fixed: `SpontixSidebar.init()` was called with no args; now passes `{ type:'player', active:'leagues-hub.html' }`.

**`multiplayer.html` (Arena) — shell + layout fixes (commits `a0f8005` → `1ab6aa7`):**
- Wrapped in standard `<div class="app-shell"><div id="sidebar-placeholder"></div><main class="main">...</main></div>` so the persistent sidebar renders. Removed the page's old `#app { display: block !important; width: 100% !important; margin-left: 0 !important }` overrides that forced full-width.
- **`const SpontixSidebar` doesn't attach to window** — sidebar.js uses `const`, which stays in script-tag scope. Fixed init to call `SpontixSidebar.init(...)` by bare name inside try/catch (the same pattern every other page uses).
- Stop overriding shared `.main`. Constraints moved onto `.mp-page { flex:1; min-height:100vh; max-height:100vh; overflow:hidden }` so `.main`'s shared rules from `styles.css` (margin-left:260px, flex column) stay intact.
- **Centering fix**: `.app-shell` had no rule and was defaulting to `flex: 0 1 auto` inside the body's flex row, collapsing `.main`. Added `.app-shell { flex:1; width:100%; min-width:0 }` and `.main { width:calc(100vw - 260px); max-width:calc(100vw - 260px) }` (mobile breakpoint goes 100vw). Content now centers within the area between sidebar and right edge.
- Step 1 widened to `.s1-inner { max-width: 1180px; padding: 36px 48px 64px }` so Arena onboarding fills the shell. Format cards scaled (min-height 230→300px, padding 32→40px, watermark 8→11rem, `format-name` 2→2.4rem). CTA wrapped in `.s1-cta-row` and capped 320–420px wide with lime glow + hover lift.

**`br-lobby.html` — Battle Royale lobby UX overhaul (commits `08d3b3f` → `b2dcf88`):**
- Replaced 1v1/FFA "format" cards with **Classic / Ranked** modes (Classic = casual, Ranked = ELO applies). Both UI modes still write `mode='ffa'` to `br_sessions` because the DB CHECK constraint (`'1v1' | 'ffa' | '2v2'`) is unchanged in this UI pass — the Classic vs Ranked distinction is client-side only (Phase 4 server-side gate is documented in `docs/BR_SESSION_SYSTEM.md`).
- Step pills relabelled: Mode → Battlefield → Scope → Waiting Room.
- Header tension strip: `💀 Players get eliminated · ⚡ No answer = HP loss · 🏆 Only one survives` with two-tone gradient + pulsing coral dot.
- Step 2: "Choose your battlefield" framing.
- Step 3: de-emphasized "Match scope" with compact half cards.
- CTA: "Enter Battle Royale →" / dynamically swaps to "Enter Ranked Survival →" when Ranked is selected.
- **Lobby sizing constants (UI-only enforcement, see `docs/BR_SESSION_SYSTEM.md` for Phase 4 server-side TODO):** `BR_MIN_PLAYERS=4`, `BR_TARGET_PLAYERS=10`, `BR_MAX_PLAYERS=12`, `BR_FILL_TIMEOUT_MS=60000`, `BR_TARGET_COUNTDOWN_MS=15000`. 60s auto-fill timer when min reached, 15s auto-start at target, immediate at max. Manual "Start now" button between min and max.
- Waiting room: replaced duel/FFA split with a single scaling 4–12 avatar grid + live X/N counter + countdown banner.
- **Polish pass (Ranked-dominant hierarchy)**: Ranked card visually dominant (scale 1.025 baseline, 1.045 hover, larger title, "Recommended" ribbon, lime glow); Classic recessed (opacity 0.78). Asymmetric grid `1fr / 1.08fr`. New ambient "live-feel" row above tension strip (`1,247 players online · 18 lobbies forming · ~8 min avg survival` — atmospheric placeholders, no queries). Subtle lime radial glow positioned behind the mode-card decision area.

**`docs/GAMEPLAY_ARCHITECTURE.md` — Battle Royale Final Product Definition added** at the top of Pillar 3. Locks: survival model, no-answer = damage rule, Classic / Ranked modes only, 8–12 player target, UI/UX principles, explicit list of what BR is NOT, and explicit statement that the previous 1v1/FFA model was incorrect and is replaced.

**`docs/BR_SESSION_SYSTEM.md` — Lobby Sizing section + Phase 4 TODO**: same canonical block placed after the title, plus a five-item server-side enforcement TODO covering min/max enforcement, host eligibility, full-lobby blocking via `join_br_session()` RPC, and the Ranked rating validity gate (`update_br_ratings()` must verify `≥ BR_MIN_PLAYERS` participants before applying ELO).

**`trivia.html` — shell wrap + 3-column hub (commits `82062ec`, `d3e4297`):**
- Page had no `styles.css` link, no `app-shell` wrapper, no `SpontixSidebar.init` call — fixed all three so the sidebar renders. Same const-vs-window pattern as Arena fix.
- `#screen-hub` rebuilt as a 3-column command center: **Left** profile + 2×2 stats + tier/quota pill, **Center** "Choose your challenge" headline + 3 large equal mode cards (Solo/Duel/Party with mode-color hover glow), **Right** Recent Games + Performance panel (Latest / Best run / 7-day accuracy + static spark bars) + Suggested Next pill.
- Tablet (720–1099px) → left + center top row, right wraps below; Mobile (<720) → fully stacked.
- Removed demo-nav (debug screen jumper) HTML, CSS, and the JS that highlighted its buttons inside `goScreen()`.
- All 7 gameplay screens (setup, solo play, duel lobby/play, party lobby/play, results), `selectMode()`, scoring, timer logic, and JS state untouched.

**`dashboard.html` — game control center rebuild (commit `4161170`):**
- Above-the-fold reordered: **Player Status → Live Strip → Ready to Play**, with Game Modes + Your Plan sitting lower.
- **Player Status panel** (rebuild of `.profile-preview`): kept avatar/name/handle/tier + XP bar; removed Win Rate / Best Streak / Trophies stat tiles per spec; added Arena (lime) | Battle Royale (coral) rating split with defaults visible always (`Rookie · 500 SR` / `Rookie · 500 BR`). All `dash-arena-*` IDs preserved for existing hydration; new `dash-br-*` IDs added so future BR rating hydration is wire-ready. Last 5 W/L pip row + Next-level-unlocks pills (More daily games / Ranked access / Higher limits).
- **Live activity strip**: `12 in Arena · 8 in Battle Royale · 3 leagues live` — pulsing colored dots (lime / coral / purple), atmospheric.
- **Ready to Play**: 3 large CTA cards above the existing pillar grid — Join Arena / Enter Battle Royale / Continue Trivia. Hover lift + scale + accent-color glow.
- **For You**: existing `#activity-alert` div preserved exactly so dynamic JS injection still works.
- **Game Modes pillar cards**: existing 4 cards kept; added pulsing status sub-line to each (`Leaderboards live` / `Ranked ready` / `Session available` / `Daily challenges available`); hover translateY(-2px) + scale 1.015 + soft shadow.
- **Your Plan** (new tier panel): tier pill + "Resets in 7h 23m" + 4 usage rows with lime→teal progress bars (warn variant for near-cap rows). Static placeholder note: *"UI placeholder · live usage data wires up in a later sprint"* makes it visually obvious this is not real data.
- **JS selector updates** (presentation only — same data flow): `.profile-preview-name/handle/tier` → `.ps-name/.ps-handle/.ps-tier`; removed stale Win-Rate / Best-Streak stat-tile writes; `renderArenaRating()` updated so badge `className` writes `ps-rating-tier <tier-cls>` to keep styling consistent in the new panel; trophy hydration kept safe via hidden `#dash-trophy-count` element.

**Unified Mode Header — `styles.css` + 4 pages (commit `4ff076c`):**
- New shared `.mode-header` system in `styles.css`: title + subtitle + per-mode icon chip + inert `How to Play` button. `:root --mode-header-h: 76px` exposed so dependent layouts can subtract it. Per-mode icon tints only — main palette (dark + lime) unchanged: `.icon-leagues` (purple), `.icon-arena` (lime), `.icon-br` (coral), `.icon-trivia` (teal).
- **Old per-page hero blocks removed** (single source of truth): `.lh-hero` (Leagues), `.arena-hero` + `.mp-topbar` (Arena), `.br-header` (BR), `.topbar` (Trivia).
- **`leagues-hub.html`**: title block replaced; Create/Discover CTAs preserved in a slim action row beneath the new header.
- **`multiplayer.html`**: `mp-topbar` removed; back button (`handleBack()`) rehoused as a small chip inside `mode-header-left`. `.mp-page` height envelope updated to `calc(100vh - var(--mode-header-h))` so step flow fits without overflow. `arena-hero` block removed from Step 1. Hidden `#mp-page-title` kept so any stray JS reads still resolve.
- **`br-lobby.html`**: skull header replaced; tension strip and step pills unchanged.
- **`trivia.html`**: old `.topbar` (Back / Sports Knowledge / Trivia [Quiz]) replaced; `.screen` `min-height` updated from `calc(100vh - 54px)` to `calc(100vh - var(--mode-header-h, 76px))` so screens fit cleanly.
- **`How to Play` button is fully inert** — no `onclick`, no modal, no nav. Hover glow only. Wired in a future sprint.

**Constraints honoured across the whole sprint:**
- Zero backend / Supabase / RPC / migration / routing changes
- All existing dynamic IDs preserved (`activity-alert`, `dash-xp-*`, `dash-arena-*`, `dash-trophy-count`, `badge-live`, `nav-games-sub`, `nav-schedule-sub`, `mp-page-title`)
- All existing JS functions untouched (`selectMode`, `selectFormat`, `enterLobby`, `handleBack`, `goStep`, `goScreen`, `tryInstantiate`, `refreshWaitingRoom`, etc.)
- DB CHECK constraints (e.g. `br_sessions.mode IN ('1v1','ffa','2v2')`) untouched — Classic vs Ranked distinction is client-side only with the Phase 4 migration TODO documented

---

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

