# Leaderboard Architecture

**Status:** Design + audit document. No implementation yet.

This document defines the full leaderboard system Spontyx wants to ship and audits what currently exists in `leaderboard.html` against that target. **Do not implement UI changes from this document — it exists to ground the redesign.**

---

## 1. Purpose of Leaderboards

Leaderboards are not just tables. They are a core engagement loop that must produce:

- **Competition** — players measure themselves against others, not just the game
- **Status** — visible identity (rank tier, badge, podium position) that the player carries across the platform
- **Progression** — a clear next target one tier or N rating points away
- **Daily / weekly return motivation** — surfaces that reset (Weekly, Rising, Speed) give players a reason to come back even after they've stopped grinding the all-time chart
- **Multiple ways to win** — if there is only one ladder, only the top 1% feel rewarded. Special leaderboards (clutch, survival, consistency, friends) let mid-rank players still own a board

A good leaderboard system is asymmetric: most players will never crack the top 100 globally, but **every** player should be able to find a leaderboard they're competitive on.

---

## 2. Leaderboard Types

### Core (one per pillar + one combined)

| # | Leaderboard | Pillar |
|---|---|---|
| 1 | **Arena ELO** | Arena (1v1 / 2v2 duels) |
| 2 | **Battle Royale ELO** | Battle Royale (survival sessions) |
| 3 | **Combined Competitive Rank** | Cross-pillar (weighted) |
| 4 | **Leagues Points** | Leagues (cumulative across leagues) |
| 5 | **Trivia Knowledge** | Trivia (solo / duel / party) |

### Special (cross-cutting, time-bound, or filtered)

| # | Leaderboard | What it surfaces |
|---|---|---|
| 6 | **Weekly Ranking** | Top points / wins this calendar week (resets Mon 00:00 UTC) |
| 7 | **Rising Players** | Biggest ELO / rating jumps over the last 7 days |
| 8 | **Speed Leaderboard** | Average answer time on correct answers (Trivia + Live) |
| 9 | **Clutch Leaderboard** | Sum of `is_clutch` correct answers (existing column on `player_answers`) |
| 10 | **Survival Leaderboard** | Avg HP retained / longest survival streak in BR |
| 11 | **Consistency Leaderboard** | Players whose 7-day accuracy variance is lowest above a min-games threshold |
| 12 | **Friends Leaderboard** | Players you share a league with, ranked on the chosen metric |
| 13 | **My Leagues Leaderboard** | Per-league standings for leagues the player is a member of |

---

## 3. Logic Per Leaderboard

For each entry: scope, metric, filter axes, current connection status, what's missing.

### 3.1 Arena ELO

- **Mode:** Arena
- **Metric:** `users.arena_rating` (integer, default 500)
- **Population filter:** `arena_games_played > 0`
- **Sort:** `arena_rating DESC`
- **Tier mapping (already in code):** Rookie / Bronze / Silver / Gold / Platinum / Diamond / Master / Grandmaster / Legend (9 tiers, breakpoints 800/1100/1400/1700/1900/2200/2600/3000)
- **Filter axes wanted:** scope (Global / Friends / My Leagues) · timeframe (Week / Month / Season / All Time)
- **Connection status today:** ✅ **Connected.** `loadArenaLeaderboard()` reads `users` directly. Podium + table render. Sticky-card-when-rank-≥-11 implemented.
- **Missing:**
  - Timeframe filtering (week/month/season) — currently always all-time
  - Friends scope (no friend list connected to Arena view)
  - Trend arrow (`+18 SR last 7d`) — would need a new `arena_rating_history` table or derive from `arena_session_players.arena_rating_delta` aggregated by date

### 3.2 Battle Royale ELO

- **Mode:** Battle Royale
- **Metric:** `users.br_rating` (integer, default 1000, floor 800)
- **Population filter:** `br_games_played > 0`
- **Sort:** `br_rating DESC`
- **Tier mapping (already in code):** Iron / Bronze / Silver / Gold / Platinum / Diamond / Elite / Master (8 tiers, breakpoints 900/1100/1300/1500/1700/1900/2100)
- **Filter axes wanted:** scope · timeframe
- **Connection status today:** ✅ **Connected.** `loadBrLeaderboard()` reads `users` directly. Podium + table render.
- **Missing:**
  - Timeframe filtering
  - Friends scope
  - Trend arrow — could derive from `br_session_players.br_rating_delta` (column exists per migration 046)

### 3.3 Combined Competitive Rank

- **Mode:** Cross-pillar
- **Metric:** weighted composite — see §6 for the proposed formula
- **Sort:** composite DESC
- **Connection status today:** ❌ **Not built.** No tab, no DB column, no derivation
- **Missing:** everything — formula must be locked first, then either computed at read-time (cheap, no schema change) or materialised into `users.combined_rating` (requires migration + a refresh job)

### 3.4 Leagues Points

- **Mode:** Leagues
- **Metric (current):** `users.total_points` (lifetime aggregate written by the resolver into `player_answers.points_earned`, then summed by historical jobs into `users.total_points`)
- **Sort:** `total_points DESC`
- **Filter axes wanted:** scope (Global / Friends / My Leagues) · timeframe (Week / Month / Season / All Time)
- **Connection status today:** ✅ **Mostly connected** for Global tab via `SpontixStoreAsync.getLeaderboard()` — joins `users` + `game_history` to compute period-window stats (week / month / season). The 5 category chips (Pts / Wins / Streak / Acc / 1v1?) drive `currentCat` which switches the rank metric.
- **Missing:**
  - Per-league standings tab on this page (only "My Leagues list" sidebar exists; no global leagues comparison)
  - Confirm that the resolver actually maintains `users.total_points` in real time vs only `player_answers.points_earned`. If only the answer rows are authoritative, the leaderboard should aggregate from `player_answers` not `users.total_points` (otherwise stale).

### 3.5 Trivia Knowledge

- **Mode:** Trivia
- **Metric:** undefined in schema today — there is no `users.trivia_rating` or `trivia_score` column
- **Sort wanted:** trivia rating DESC
- **Connection status today:** ❌ **Not built.** Trivia gameplay is currently a client-side simulation (`trivia.html` has its own question bank in JS, no Supabase writes from the play screens). No backend rating.
- **Missing:**
  - DB column for trivia rating
  - Server-side trivia answer recording
  - Aggregation job or read-time computation

### 3.6 Weekly Ranking

- **Metric:** points earned in the current ISO week
- **Connection status today:** ⚠️ **Partial.** `getLeaderboard()` already buckets `game_history` rows into `week / month / season` windows and exposes `entry.pts.week` to the renderer. The "This Week" time chip exists in the UI and toggles `currentTime`, but the chip → render path only re-sorts the existing array; resets / week-roll-over UX isn't shown.
- **Missing:**
  - Visible "Resets in Xd Yh" countdown
  - "Last week's winners" archive (no DB record of past weeks today)
  - Currently bucketed from `game_history.played_at` only — Arena/BR sessions write to other tables (`arena_sessions`, `br_sessions`) so they would NOT count toward Weekly today unless `game_history` is populated for those modes too

### 3.7 Rising Players

- **Metric:** delta in rating over last N days (Arena `arena_rating_delta`, BR `br_rating_delta`, or trivia)
- **Connection status today:** ❌ **Not built.** No tab. Delta columns exist on `arena_session_players` + `br_session_players` (per-session deltas) but no "Rising Players" aggregation.
- **Missing:** read-time aggregation `SUM(delta) WHERE created_at > now() - interval '7 days' GROUP BY user_id ORDER BY sum DESC`. Doable today, no schema change.

### 3.8 Speed Leaderboard

- **Metric:** avg ms-to-answer on correct submissions
- **Connection status today:** ⚠️ **Data exists, no UI.** `player_answers.created_at` minus `questions.visible_from` gives time-to-answer. No tab or aggregation today.
- **Missing:** UI tab + aggregation query. No schema change required.

### 3.9 Clutch Leaderboard

- **Metric:** count of `player_answers WHERE is_clutch = true AND is_correct = true` per user
- **Connection status today:** ⚠️ **Data exists, no UI.** `is_clutch` column populated by the resolver via `clutch-detector.ts`. Existing `users.clutch_answers` counter (migration 032) already aggregates this.
- **Missing:** UI tab. The data is one query away (`SELECT id, handle, clutch_answers FROM users WHERE clutch_answers > 0 ORDER BY clutch_answers DESC LIMIT 100`).

### 3.10 Survival Leaderboard

- **Metric:** avg HP retained at session end OR best placement-rate in BR
- **Connection status today:** ⚠️ **Partial.** Per-session HP/placement lives on `br_session_players` (`hp`, `placement`, `is_eliminated`). No aggregation exists.
- **Missing:** read-time aggregation. No schema change required.

### 3.11 Consistency Leaderboard

- **Metric:** lowest stddev of accuracy over last N games, gated on min games played
- **Connection status today:** ❌ **Not built.** Game history rows exist but no consistency calc.
- **Missing:** computation logic (read-time JS) + UI tab. No schema change required but heavier compute — cache strongly recommended if scaled.

### 3.12 Friends Leaderboard

- **Definition:** "friends" today is implicitly defined as *players you share a league with* (no friend table)
- **Connection status today:** ✅ **Connected.** `renderFriendsLeaderboard()` filters `players` by intersection with `leagueMemberMap[my_league_ids]`. Uses the same `currentCat` / `currentTime` filters as Global.
- **Missing:**
  - Real friend graph (a `friendships` or `follows` table) — currently anyone in a shared league qualifies, which is broad
  - Per-mode friends views (the friends list is metric-agnostic but doesn't switch by Arena/BR/Trivia)

### 3.13 My Leagues Leaderboard

- **Definition:** per-league standings for leagues the user belongs to
- **Connection status today:** ⚠️ **Side-loaded list only.** Sidebar shows the user's leagues (`SpontixStoreAsync.getMyLeagues()`); per-league member ranks come from `getLeagueLeaderboard(leagueId)`. There is no consolidated "all my leagues + my rank in each" view on the leaderboard page.
- **Missing:** consolidated panel showing each league + my rank/score in it. Data is all there — purely UI.

---

## 4. UI Structure

Proposed page layout for `leaderboard.html` (target — not current):

```
┌──────────────────────────────────────────────────────────────┐
│ MODE HEADER (unified .mode-header — gold trophy icon)        │
├──────────────────────────────────────────────────────────────┤
│ Search                                                        │
├──────────────────────────────────────────────────────────────┤
│ LIVE ACTIVITY STRIP                                           │
│ 12 in Arena · 8 in BR · 3 leagues live · 142 online           │
├──────────────────────────────────────────────────────────────┤
│ TOP 3 PODIUM — visual stage; per-board accent color           │
│   2nd          1st 👑          3rd                            │
├──────────────────────────────────────────────────────────────┤
│ FILTER ROW                                                    │
│ Scope:     [ Global ] Friends   My Leagues                    │
│ Mode:      Arena · BR · Combined · Leagues · Trivia · Special │
│ Time:      Week · Month · Season · All Time                   │
│ Metric:    [contextual — only shown when relevant]            │
├──────────────────────┬───────────────────────────────────────┤
│ MAIN LIST            │ RIGHT PANEL                            │
│ (player cards, NOT a │ ┌─ Your Ranking ──────────────────┐   │
│ flat table)          │ │ Global #437  ·  Arena #82       │   │
│                      │ │ BR #210      ·  Combined #—     │   │
│ Rank · Avatar · Name │ └─────────────────────────────────┘   │
│ Tier · Metric · Δ    │ ┌─ Your Ratings ──────────────────┐   │
│ "You" row pinned     │ │ Arena 1240 SR  Gold              │   │
│ visually + badged    │ │ BR    980      Silver            │   │
│                      │ │ Trivia —       (not implemented) │   │
│                      │ └─────────────────────────────────┘   │
│                      │ ┌─ Next Target ───────────────────┐   │
│                      │ │ +60 SR to Platinum               │   │
│                      │ │ Rival: @marko (1245) — beat them │   │
│                      │ └─────────────────────────────────┘   │
│                      │ ┌─ Goals (static for MVP) ────────┐   │
│                      │ │ Climb to top 100 Arena           │   │
│                      │ │ 5-game BR win streak             │   │
│                      │ └─────────────────────────────────┘   │
└──────────────────────┴───────────────────────────────────────┘
```

### Section requirements

1. **Header** — unified `.mode-header` (gold trophy icon, title "Leaderboard", subtitle "See where you stand. Climb the ranks.")
2. **Top 3 Podium** — already implemented for Arena and BR; needs to be the default treatment for every leaderboard tab. Per-board color: gold for global, lime for Arena, coral for BR, purple for Leagues, teal for Trivia.
3. **Live Activity Strip** — 3-4 pulsing pills above the podium (matches dashboard pattern). Static counts acceptable until real metrics wired.
4. **Filter system** — three orthogonal axes (Scope · Mode · Timeframe) plus a contextual metric selector when the active board has multiple metrics (e.g. Leagues = Pts / Wins / Streak / Acc).
5. **Main list — player cards, not table.** Rank pill, avatar with tier ring, name, primary metric, trend arrow (Δ over chosen timeframe), tier badge. "You" row gets a lime border + "(You)" tag and pins to viewport when scrolled past.
6. **Right panel** — always-on context: "Your Ranking" (your numeric rank in each board), "Your Ratings" (Arena / BR / Combined / Trivia), "Next Target" (closest tier breakpoint + a rival within ±5 ranks of you), "Goals" (static for MVP).

---

## 5. Data Connection Status

Audit table — what exists today vs what's needed.

| Leaderboard | Data source | Connected today? | Missing |
|---|---|---|---|
| **Arena ELO** | `users.arena_rating` + `arena_games_played` | ✅ Connected (live data, podium + table render) | Timeframe filter; Friends scope; trend arrow |
| **BR ELO** | `users.br_rating` + `br_games_played` | ✅ Connected (live data, podium + table render) | Timeframe filter; Friends scope; trend arrow |
| **Combined Rank** | n/a — no column | ❌ Not built | Formula must be locked (§6); read-time computation OR new column + refresh job |
| **Leagues Points** | `users.total_points` + `game_history` per-window aggregation in `getLeaderboard()` | ✅ Connected for Global; ⚠️ Per-league standings consolidated view missing | Verify `users.total_points` is kept in sync by the resolver (vs only `player_answers.points_earned`) |
| **Trivia Knowledge** | none | ❌ Not built | DB column + server-side trivia answer recording + aggregation. Trivia gameplay is currently client-only simulation. |
| **Weekly Ranking** | `game_history.played_at` bucketed in `getLeaderboard()` | ⚠️ Partial — buckets exist; reset countdown + winners archive missing; Arena/BR sessions don't write to `game_history` so they don't count | Resets countdown UI; decide whether Arena/BR sessions should write to `game_history` for this view to be cross-mode |
| **Rising Players** | `arena_session_players.arena_rating_delta` + `br_session_players.br_rating_delta` | ❌ Not built (no UI) | Aggregation query (`SUM(delta) GROUP BY user_id WHERE created_at > now() - interval '7 days'`); UI tab |
| **Speed** | `player_answers.created_at` − `questions.visible_from` | ⚠️ Data exists, no UI | Aggregation + tab (no schema change) |
| **Clutch** | `users.clutch_answers` (already aggregated) | ⚠️ Data exists, no UI | UI tab — single-query render |
| **Survival** | `br_session_players.hp` + `placement` + `is_eliminated` | ⚠️ Data exists, no UI | Per-user aggregation + tab (no schema change) |
| **Consistency** | `game_history` rows | ❌ Not built | Stddev computation (read-time JS or new column) + tab |
| **Friends** | derived from shared `league_members` | ✅ Connected (proxy definition) | Real friend graph table (currently "anyone you share a league with" qualifies, which is broad) |
| **My Leagues** | `getMyLeagues()` + `getLeagueLeaderboard(leagueId)` | ⚠️ List shown; consolidated standings view missing | Pure UI — no backend changes needed |

**Reality check on what's "live" today:**

- **Working with real data:** Arena ELO tab, BR ELO tab, Global tab, Friends tab (proxy definition), My Leagues sidebar list
- **Static / placeholder:** Time-chip filtering (Week/Month/Season/All Time) re-sorts the same already-loaded array using `entry[currentCat][currentTime]` keys — but only for Global and Friends views; Arena and BR ignore time chips entirely
- **Not implemented at all:** Combined Rank, Trivia Knowledge, Rising, Speed, Clutch board, Survival board, Consistency, "Last week's winners", trend arrows

---

## 6. Combined Competitive Rank — Cross-Mode Logic

**Status:** future — formula not yet locked, no implementation.

A Combined Competitive Rank is the single number that says "how good are you across the platform". It must:

- Reward breadth (a player who's strong in Arena AND BR ranks higher than a player who's only strong in one)
- Not let a single mode dominate (a Legend in Arena who never plays BR shouldn't auto-top the combined board)
- Have a clear floor — players who haven't played a mode contribute 0 from that mode, but aren't penalised

### Proposed formula (DRAFT — not implemented)

```
combined_rating =
    arena_weight   × normalise(arena_rating, 500..3000)
  + br_weight      × normalise(br_rating,    800..3000)
  + trivia_weight  × normalise(trivia_rating, /* once it exists */)
  + leagues_weight × normalise(leagues_perf,  /* TBD */)
```

with `normalise(x, lo, hi) = clamp((x - lo) / (hi - lo), 0, 1)` returning a 0..1 score per pillar, then a weighted sum scaled to 0..3000.

Initial weight proposal (subject to testing): Arena 0.35 · BR 0.35 · Leagues 0.20 · Trivia 0.10. Trivia is low because it's the easiest to grind today; raise once trivia rating gates difficulty.

### Implementation paths

| Path | Pros | Cons |
|---|---|---|
| **Read-time computation** in JS on the leaderboard page | No schema change, no migration, no refresh job | Slow at large `users` counts (1000+ rows); does N writes worth of math per page load |
| **Materialised column** `users.combined_rating` + a Postgres function refreshed by a cron job | Cheap reads; sortable directly | Migration + RPC + cron job; goes stale between refreshes |
| **Database view** `analytics_combined_rank` | No materialisation overhead; always fresh | Unsortable in O(log n) without an index; refresh-on-read cost grows with the user count |

**Recommendation when we do build it:** start with read-time computation (path 1) on the top-100 only, defer materialisation until performance forces it.

---

## 7. Mode-Specific Metrics

What each board's primary + secondary metrics should display.

### Arena

| Metric | Source | Status |
|---|---|---|
| Arena Rating (SR) | `users.arena_rating` | ✅ |
| Tier | `getArenaTier(rating)` | ✅ |
| Recent Δ | `arena_session_players.arena_rating_delta` last 7d | ❌ not aggregated |
| Win/Loss trend | derived from `arena_sessions` outcomes | ❌ not displayed |

### Battle Royale

| Metric | Source | Status |
|---|---|---|
| BR Rating | `users.br_rating` | ✅ |
| Tier | `getBrTier(rating)` | ✅ |
| Avg placement | `AVG(br_session_players.placement)` | ❌ not aggregated |
| Survival rate | `1 - (eliminated_sessions / total_sessions)` | ❌ |
| Wins | placements where `placement = 1` | ❌ |
| Top-3 finishes | placements where `placement <= 3` | ❌ |

### Leagues

| Metric | Source | Status |
|---|---|---|
| Total points | `users.total_points` | ✅ |
| Accuracy | `users.accuracy` | ✅ |
| Leagues won | end-of-league rank=1 — no historical record today | ❌ |
| Open questions answered | `COUNT(player_answers)` | ✅ via aggregation |
| League-specific rank | `getLeagueLeaderboard(leagueId)` | ✅ per-league |

### Trivia

| Metric | Source | Status |
|---|---|---|
| Knowledge score | none | ❌ no schema |
| Accuracy | none | ❌ no schema |
| Avg answer speed | none | ❌ no schema |
| Difficulty-weighted score | none | ❌ no schema |

### Special

| Metric | Source | Status |
|---|---|---|
| Fastest answers | `player_answers.created_at` − `questions.visible_from` | ⚠️ derivable |
| Clutch score | `users.clutch_answers` | ✅ aggregated |
| Biggest weekly riser | `SUM(arena_rating_delta + br_rating_delta) WHERE created_at > now() - 7d` | ⚠️ derivable |
| Consistency | stddev of accuracy over last N games | ❌ not computed |

---

## 8. What Should NOT Be Done Yet

Hard rules for the redesign sprint:

- **Do not fake core competitive rankings.** Arena and BR ELO must always read live data; if the board can't be populated yet (Trivia, Combined), show a "Coming soon" empty state, not placeholder rows.
- **Do not mix Arena and BR ELO into a single number** without the locked Combined formula (§6). Cross-mode ranking is a real product decision, not a UI decoration.
- **Do not remove existing working leaderboards.** The Arena and BR tabs work today and ship live data; they stay.
- **Do not break current leaderboard tabs.** `switchView()`, `selectCat()`, `selectTime()`, `loadArenaLeaderboard()`, `loadBrLeaderboard()`, `getLeaderboard()` are all live — don't rename, don't change return shapes.
- **Do not create backend changes before documenting missing data.** Every new tab that needs a new query/migration goes through this doc first; we add the column/view/RPC explicitly.
- **Do not start on Trivia Knowledge leaderboard** until trivia gameplay actually writes to the server. Today it's a client-only simulation — there's literally nothing to rank.

---

## 9. Implementation Readiness

Three buckets:

### A. Can ship UI-only now (no backend changes, no new queries)

- New unified mode-header on the page
- Live Activity Strip (static counts acceptable for MVP, same pattern as dashboard)
- Right panel "Your Ranking" + "Your Ratings" — reads existing `users.arena_rating` / `br_rating` / `total_points` / `accuracy`
- Right panel "Next Target" — pure JS computation against existing tier breakpoints
- Player-card list styling (replace the current `<table>` with card rows)
- Visual consistency: timeframe + scope + mode filter row using the same chip system as elsewhere

### B. Needs new query (data exists, just not surfaced)

- Clutch Leaderboard tab — single `SELECT` from `users.clutch_answers`
- Speed Leaderboard tab — aggregation of `player_answers` join `questions`
- Survival Leaderboard tab — aggregation of `br_session_players`
- Rising Players tab — aggregation of `arena_session_players.arena_rating_delta` + `br_session_players.br_rating_delta` over last 7d
- Trend arrows on Arena/BR rows — same delta sources
- Per-league standings consolidated view — uses existing `getLeagueLeaderboard()` once per league

### C. Needs backend work (new column / migration / RPC / job)

- Combined Rank — formula lock + decision on read-time vs materialised column (§6)
- Trivia Knowledge — server-side trivia answer recording (currently client-only) + new `users.trivia_rating` column + aggregation
- Leagues-won counter — historical "league finished, who was rank 1" needs either an event log or end-of-league snapshot table
- Real friend graph — `friendships` table (today: proxy via shared league membership)
- Last week's winners archive — weekly snapshot job into a `weekly_leaderboard_archive` table
- Weekly ranking that includes Arena + BR sessions — either write Arena/BR session results into `game_history` too, or change `getLeaderboard()` to aggregate from three tables instead of one

### Recommended implementation order

1. **Phase 1 (UI-only, no backend):** Mode header + live strip + right panel + player-card list + tier-tier filter polish on existing Arena / BR / Global / Friends / Leagues tabs. This makes the page feel modern without touching data.
2. **Phase 2 (additive new queries, no migrations):** Add Clutch + Speed + Survival + Rising tabs. Add trend arrows on Arena/BR rows. Add per-league consolidated standings.
3. **Phase 3 (backend):** Lock Combined Rank formula, decide read-time vs materialised, ship it. Add `weekly_leaderboard_archive` table + weekly snapshot job. Begin server-side trivia recording.
4. **Phase 4 (new product surface):** Trivia Knowledge tab, real friend graph, leagues-won historical counter.

---

## Appendix — current implementation map

Files and functions backing the live boards today (do not break these in the redesign):

| Surface | File | Function | Source |
|---|---|---|---|
| Global / Leagues / Friends views | `leaderboard.html` | `loadLeaderboardData()` → `SpontixStoreAsync.getLeaderboard()` | `users` + `game_history` (4-month season window) |
| Per-league member rank | `leaderboard.html` | `SpontixStoreAsync.getLeagueLeaderboard(leagueId)` | `league_members` + `users` |
| Arena tab | `leaderboard.html` | `loadArenaLeaderboard()` | `users WHERE arena_games_played > 0 ORDER BY arena_rating DESC` |
| BR tab | `leaderboard.html` | `loadBrLeaderboard()` | `users WHERE br_games_played > 0 ORDER BY br_rating DESC` |
| Filter chips | `leaderboard.html` | `switchView()` `selectCat()` `selectTime()` | client-side state machine; rerender only |

Tier mapping helpers (do not duplicate):

- Arena: `getArenaTier(rating)` in `leaderboard.html`, `dashboard.html`, `arena-session.html`, `profile.html` — **9 tiers** (Rookie / Bronze / Silver / Gold / Platinum / Diamond / Master / Grandmaster / Legend)
- BR: `getBrTier(rating)` in `leaderboard.html` — **8 tiers** (Iron / Bronze / Silver / Gold / Platinum / Diamond / Elite / Master)
