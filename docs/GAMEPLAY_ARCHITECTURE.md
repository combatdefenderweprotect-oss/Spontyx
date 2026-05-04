# Spontix — Gameplay Architecture
## Product Source of Truth

**Last updated: 2026-05-01**
**Status: Authoritative. All future frontend, navigation, and product work must align with this document.**

---

## Overview

Spontix is organised around **four gameplay pillars**. Every page, navigation entry, dashboard card, and leaderboard tab must map cleanly to one of these pillars.

The old labels — singleplayer / multiplayer / party — are **not** top-level product architecture. They exist only as sub-options inside a pillar where applicable.

| Pillar | Core Identity | Backend | Frontend |
|---|---|---|---|
| **Leagues** | Prediction competitions, short or long | ✅ Fully live | ⚠️ Correct but missing hub |
| **Arena** | Real-time competitive duels | ✅ Fully live | ⚠️ Exists but hidden and incomplete |
| **Battle Royale** | Survival elimination with live questions | ✅ Fully live | ⚠️ Wired, untested with real questions |
| **Trivia** | Knowledge quiz system | ❌ Not built | ❌ Simulation only |

---

## Pillar 1 — Leagues

### What Leagues is

Leagues is the **prediction competition pillar**. Players predict match outcomes and events, accumulate points, and compete on a leaderboard. The competition can be as short as one match or as long as a full season. It can be played alone or against friends, strangers, or venue audiences.

The defining characteristic of Leagues: questions are generated before or during a match, answers are locked before resolution, and scoring is applied automatically when the match result is confirmed. It is prediction, not reaction.

### Core gameplay loop

1. A league is created for a specific match, gameweek, or season
2. Questions are generated (AI-assisted, match-bound)
3. Players answer questions before or during the match
4. The resolver automatically scores all answers after the match
5. Players accumulate points and climb the leaderboard
6. The competition closes at the end of the defined scope (match, gameweek, season)

### League formats — the full pillar

> **Canonical spec for league creation:** [`docs/LEAGUE_CREATION_FLOW.md`](LEAGUE_CREATION_FLOW.md). The summary below references it. If this section and the spec disagree, the spec wins.

Leagues is not one product. The Step 1 of `create-league.html` presents three primary types, each with a fixed lifecycle:

| Type | Scope | Fixture source | Lifecycle | Tier |
|---|---|---|---|---|
| **Season-Long League** | Path A: a team's full remaining season across one/many/all of its competitions. Path B: a competition's full remaining season. | Auto-loaded from `api_football_fixtures`, past matches always excluded | Ends when the underlying fixture source is genuinely exhausted (team eliminated from all selected competitions OR all selected seasons have officially concluded). Knockout draw gaps do NOT end the league. | Elite |
| **Match Night** | One specific fixture, any competition incl. cups | Single user-picked fixture | Ends when that match resolves | All tiers |
| **Custom League** | Flexible catch-all — custom date ranges, hand-picked fixtures, special rules | Creator-defined | Ends on creator-defined date | All tiers |

All three use the same question system (`CORE_MATCH_PREMATCH`, `CORE_MATCH_LIVE`, `REAL_WORLD`), the same scoring formula, and the same leaderboard infrastructure.

**Season-Long has critical lifecycle rules** that distinguish it from any time-bound concept:
- **R1 — Past exclusion**: every fixture query enforces `kickoff_at >= now()`.
- **R2 — Fixture-source exhaustion**: end condition is fixture exhaustion, not a date. The `league_end_date` field is informational only.
- **R3 — Knockout patience**: a temporary absence of scheduled fixtures (between knockout rounds, before draws) does NOT end the league. The league ends only when the team is eliminated from ALL selected competitions OR ALL selected seasons have officially concluded. Requires external `team_still_active` and `season_ended` signals — see the canonical spec for the data dependency TODO.
- **R5 — Mid-season creation**: covers remainder of current season only. No "next season" option.

Other formats listed in earlier versions of this doc (Solo Match Prediction, Match League, Gameweek League, Venue League) are play-mode and audience-source variants that map onto the three creation types above:
- **Solo / multiplayer / friends-only** = `play_mode` toggle + privacy setting on any of the three types.
- **Venue audience** = a Match Night created by a venue with QR/PIN entry.
- **Gameweek** = a Custom League with a one-round date range.

### Why a player plays Leagues

You pick a match you actually care about and you put your knowledge on the line before it kicks off. You build a streak of correct predictions, watch your position move on a leaderboard your friends are also on, and come back after the final whistle to see how you did. The satisfaction is in being right about something real — a specific scorer, a result, a stat — and proving it before it happened. Leagues rewards patience and sports knowledge over reaction speed. You are not racing anyone in the moment; you are committing to a prediction and waiting for the world to prove you right.

### User entry points

| Entry point | Who it is for | How they arrive |
|---|---|---|
| **Solo** | Player who wants to predict a match alone | `play_mode = singleplayer` in create flow; no invitation needed |
| **Friends** | Private group competing on a shared match | Create league → share invite code or link |
| **Public / Open** | Player who wants to compete with strangers | Discover page → join any public league |
| **Venue** | Pub or sports bar audience playing during an event | Venue creates a Match Night league; audience joins via QR code or PIN |

### What differentiates Leagues from other pillars

- **Not real-time reactive** — players predict, not react in competition against an opponent in the same moment
- **Not elimination** — wrong answers cost points but do not remove a player
- **Not knowledge-based** — questions are match-specific predictions, not general knowledge
- **Persistent** — a league outlives any single session; history and standings accumulate over its lifetime

### Current state — what exists

**Backend:** Fully live. Questions, answers, scoring, RLS, resolver, leaderboard — all working.

**Frontend (what is correct):**
- `league.html` — full gameplay page with question feed, leaderboard, stats, Realtime subscription
- `create-league.html` — 5-step wizard supporting multiple league types
- `discover.html` — public league discovery
- `my-leagues.html` — player's joined and owned leagues
- The wizard supports solo/multiplayer play mode, half-scope, question mode, prematch scheduling, AI quota

**Frontend (what is wrong or missing):**
- There is no **Leagues hub page** — the pillar has no landing or entry point that communicates its full scope
- A new user cannot tell from the navigation that Leagues includes solo prediction, match nights, season leagues, venue events, and friend groups
- The sidebar entry goes directly to `my-leagues.html` — skipping the pillar concept entirely
- The `create-league.html` wizard buries all format variation inside a single flow rather than presenting distinct products
- The three creation types (Season-Long, Match Night, Custom) and their play-mode variants (Solo, Friends, Venue) are never surfaced by name on the hub
- A player arriving at `my-leagues.html` sees a list of leagues — they have no understanding of what Leagues is as a product

### Target state — what Leagues should look like

**Leagues hub page (to be created):**
- Entry point for the entire pillar
- Shows the player's active leagues grouped by format
- Has clear creation-type cards: Season-Long League, Match Night, Custom League — each linking to the spec'd flow in [`docs/LEAGUE_CREATION_FLOW.md`](LEAGUE_CREATION_FLOW.md)
- Each format card links to a context-appropriate creation or discovery flow
- CTA paths: "Play solo", "Create a league", "Join a public league", "Find a venue"
- Sidebar entry "Leagues" links here, not to `my-leagues.html`

**Sub-pages remain but become secondary:**
- ~~`my-leagues.html`~~ — **removed 2026-05-04.** Leagues-hub now serves as the canonical entry point with real-data Active/Upcoming/Finished sections, Source filter (All/Created/Joined), and Type filter (Season-Long/Match Night/Custom) with colored badges.
- `discover.html` — "Discover" section, reachable from the hero CTA
- `create-league.html` — reached from a format-specific CTA, not as the primary entry

### Status (2026-05-04)

- ✅ **Season-Long creation flow shipped** — Path A (team-based, multi-competition) and Path B (competition-based) both live and verified in production data. Migration 051 applied; `generate-questions` redeployed with multi-competition fan-out. See [`LEAGUE_CREATION_FLOW.md`](LEAGUE_CREATION_FLOW.md) revision 5.
- ✅ Match Night and Custom League continue working unchanged.

### Gaps / next steps

- **League Completion Evaluator not built.** Season-Long leagues created today stay `status='active'` indefinitely. Manual admin closure required if needed. Backlog: [`LEAGUE_COMPLETION_EVALUATOR_TODO.md`](LEAGUE_COMPLETION_EVALUATOR_TODO.md).
- **External signals `team_still_active` and `season_end_date` not yet sourced.** Production currently uses the conservative `sports_teams`-registration fallback for Path A competition detection (UI copy avoids certainty wording). Knockout competitions cannot be fully resolved correctly without these signals.
- **Cup coverage in `sports_teams` may be sparse.** If a team's cup registration row isn't in `sports_teams`, Path A under-detects cup participation. Sync coverage is a separate task.
- **Match Night session pacing** (legacy "Type 1") — fixed question budget, chaining, match summary card — designed in `SESSION_CONTINUATION_DESIGN.txt`, not built.
- **Leagues hub page** not built — `my-leagues.html` is still the de facto pillar entry.

---

## Pillar 2 — Arena

### What Arena is

Arena is the **competitive duel pillar**. Two or four players are matched in real time and answer the same live match questions simultaneously. The player or team with the highest score at the end wins. Arena is head-to-head competition where your score directly beats or loses to a specific opponent in the same session.

The defining characteristic of Arena: you know who you are playing against, you are both answering the same questions at the same time, and there is a winner and a loser.

### Core gameplay loop

1. A player enters the Arena and selects a format (1v1 or 2v2)
2. A context layer is chosen or assigned (Casual, Ranked, or Private)
3. Players are matched to a live football match and enter a session
4. Both players answer the same AI-generated live questions simultaneously
5. Points are awarded per question; the running score is visible during the session
6. The session ends when all questions are resolved; the higher score wins
7. ELO rating is updated (Ranked only); XP is awarded to all participants

### Formats

| Format | Players | Team structure |
|---|---|---|
| **1v1** | 2 players | Individual vs individual |
| **2v2** | 4 players | Team A vs Team B |

### Context layers

| Context | Matchmaking | ELO | Stakes |
|---|---|---|---|
| **Casual** | Open queue, any skill level | Not affected | Play for fun, XP only |
| **Ranked** | Skill-matched queue | Updated after every session | Competitive ladder, affects tier |
| **Private** | Invite link only | Not affected | Friends, no ladder impact |

The format and context layer are **independent axes**. A Ranked 1v1 is different from a Casual 1v1. A Private 2v2 is different from a Ranked 2v2.

### Why a player plays Arena

You want to beat a specific person right now. Not in a standings table that settles after the final whistle — right now, question by question, while the match is live. You see their score updating in real time. You know who you are playing. When you answer a question correctly and close a 15-point gap, you feel it immediately. Arena is the pillar for players who want a head-to-head result in one sitting, with real stakes attached. Ranked adds ELO and a ladder that tracks your skill across many sessions. Casual drops the pressure but keeps the direct competition.

### What differentiates Arena from other pillars

- **Not long-term** — each session is self-contained; no persistent league, no accumulating history
- **Not elimination** — wrong answers cost points but do not remove a player from the session
- **Not knowledge-based** — questions are live match predictions, same engine as Leagues
- **Opponent-aware** — you see your opponent's score in real time; the competition is directly personal

### Current state — what exists

**Backend:** Fully live. `arena_sessions`, `arena_session_players`, ELO (`update_arena_ratings`), XP (`award_xp`), spectator mode, session completion trigger — all working.

**Frontend (what is correct):**
- `multiplayer.html` — matchmaking lobby with 1v1/2v2 format cards, match selection, waiting room
- `arena-session.html` — full gameplay page: question feed, scoreboard, Realtime, completion overlay, history drawer, clutch/streak/comeback UI
- ELO rating displayed in completion overlay and on profile
- Arena leaderboard tab in `leaderboard.html`
- Arena History tab in `profile.html`

**Frontend (what is wrong or missing):**
- **Arena is not in the sidebar** — a player on `dashboard.html` has no direct navigation path to Arena
- **No dashboard card for Arena** — Arena is invisible as a pillar on the home screen
- The page is named `multiplayer.html` — the pillar identity "Arena" is not the primary label
- **Casual / Ranked / Private context layers do not exist in the UI** — there is a format selector (1v1/2v2) but no context selector; all sessions are currently treated the same regardless of stakes
- The waiting room and session page do not communicate which context layer is active
- ELO is calculated but never framed as "this is a Ranked session" vs "this is a Casual session"
- There is no Arena hub or landing — the player goes directly into matchmaking without seeing the pillar concept

### UX order — context before format

**Context layer is selected first, format second.** The reason: context (Casual / Ranked / Private) determines the emotional stakes of the session before the player commits to a match. A player deciding whether to enter Ranked needs to make that choice before they pick a format or a match — not after. Choosing a match first creates the wrong commitment order. Format (1v1 / 2v2) is a structural preference the player can decide once they know the stakes.

### Target state — what Arena should look like

**Arena entry point (`multiplayer.html` reframed as Arena):**
- Labeled "Arena" as the primary pillar name
- Step 1: Context layer selection (Casual / Ranked / Private) — before format or match selection
- Step 2: Format selection (1v1 / 2v2)
- Step 3: Match selection + half-scope configuration
- Step 4: Waiting room / matchmaking

**Session (`arena-session.html`):**
- Top bar shows context label ("Ranked 1v1" or "Casual 2v2") throughout the session
- Ranked sessions show ELO stakes before the session begins ("You are risking ±N SR")

**Navigation:**
- Sidebar entry "Arena" links to `multiplayer.html`
- Dashboard card for Arena with player's current tier and rating

---

## Pillar 3 — Battle Royale

### Battle Royale — Final Product Definition

**This is the canonical model. The previous lobby model using 1v1 / FFA was incorrect and is replaced by this structure.**

Battle Royale is a single survival session. Not a match format. Not Arena. Not a configurable duel. One lobby, multiple players, sequential questions, HP damage, elimination over time, last player alive wins.

**Survival model — locked rules:**
- One shared lobby per session. All players answer the same sequence of questions.
- Every player must answer every question.
- **Wrong answer = HP loss.**
- **No answer (timeout) = same damage as a wrong answer.** This is a deliberate design choice: silence is not a safe option, it is a loss.
- HP reaches 0 → player is eliminated and assigned a placement in elimination order.
- Session ends when one player remains OR the question budget is exhausted; if exhausted, remaining players are placed by HP descending.

**Modes — exactly two:**
| Mode | Rating impact | Use case |
|---|---|---|
| **Classic** | None | Casual survival, no ELO pressure |
| **Ranked** | ELO applied via `update_br_ratings()` | Competitive survival |

Gameplay is identical between modes. Only the rating consequence differs. There are no other modes. There is no "1v1", no "duel", no "FFA", no "format". Player count is whatever joins the lobby.

**Target player count:**
- MVP can operate with 4 players.
- System and UI must be designed for **8–12 players** as the target lobby size.
- No hardcoded player limits in the UI. The waiting room must scale visually from a handful of players to a full dozen without breaking layout.

**UI/UX principles — what BR must feel like:**
- Entering a dangerous environment, not configuring a match
- Multiple players, not pairs — a group survival, not a duel
- Tension and elimination risk are the dominant emotions
- "Last one standing" framing throughout — never "winner" or "highest score"
- HP visualisation, elimination moments, and the shrinking lobby are the core visceral signals

**What Battle Royale is NOT:**
- It is NOT Arena. Arena is competitive duels (1v1 / 2v2). BR is survival.
- It is NOT a match format. There is one format: survival.
- It does NOT have player-count selection. The lobby fills with whoever joins.
- It does NOT use any Arena UI patterns (format cards, duel framing, player-count pickers).

---

### What Battle Royale is

Battle Royale is the **survival elimination pillar**. Multiple players enter a lobby, all start with 100 HP, and answer the same sequential questions. Wrong answers reduce HP; correct answers can restore it. Players are eliminated when their HP reaches zero. The last player standing wins.

The defining characteristic of Battle Royale: participation is time-limited by HP, not by session end. You can be eliminated mid-session. The competition is not just about scoring the most points — it is about surviving longer than everyone else.

### Core gameplay loop

1. Multiple players join a BR lobby and a session is instantiated
2. All players start at 100 HP
3. A question is delivered to all active (non-eliminated) players simultaneously
4. Wrong answer: −15 HP. Correct answer with a streak: +5 or +10 HP (bonus)
5. Players eliminated when HP = 0; they receive a placement based on elimination order
6. The session ends when one player remains or all questions are exhausted
7. ELO is updated via pairwise calculation; XP is awarded by placement

### Why a player plays Battle Royale

Every question feels life-or-death. You are not losing points — you are watching your HP drain, knowing that hitting zero means you are out while the others keep playing. The pacing is different from any other pillar: the lobby goes quiet, a question drops, everyone answers, and then you see the HP deltas. One wrong answer shrinks your cushion. A correct answer on a streak can claw back HP. A good run keeps you alive longer; a bad one ends your game while the session continues without you. The leaderboard is not points — it is who is still standing. That distinction changes how every question feels.

### Pacing and tension

Battle Royale plays in rounds. Each round is one question delivered to all surviving players simultaneously. There is no action between questions — just the wait before the next one drops, watching the HP bars of the people you need to outlast. The tension compounds as the lobby shrinks. Being the last survivor in a 10-person lobby is a fundamentally different feeling from winning an Arena duel. The survival arc — full HP → pressure → clutch streaks → elimination watch — is the product.

### What differentiates Battle Royale from other pillars

- **Elimination** — wrong answers have real consequences; you can be removed from the game
- **Survival mechanic** — HP is a resource to manage, not just a score
- **Sequential questions** — all players answer the same question before the next is released
- **Placement-based** — not highest score wins, but last surviving wins; placement is the outcome metric

### Current state — what exists

**Backend:** Fully live. `br_sessions`, `br_session_players`, HP system, `advance_br_session_round()`, `finalize_br_session()`, `instantiate_br_session()`, `update_br_ratings()`, BR ELO columns, question generation (`BR_MATCH_LIVE` type) — all working.

**Frontend (what is correct):**
- `br-lobby.html` — BR lobby: join/create session, player list, start trigger
- `br-session.html` — BR gameplay: HP bars, question card, elimination banner, completion overlay with placements + ELO deltas

**Frontend (what is wrong or missing):**
- **BR is not properly surfaced in navigation** — sidebar links to `battle-royale.html` (old 3,109-line client simulation), not `br-lobby.html`
- **No dashboard card for BR** — BR is invisible as a pillar on the home screen
- **`battle-royale.html` is a client simulation** — uses `Math.random()`, not connected to the server-authoritative BR system; must not be extended or treated as current
- **`br-leaderboard.html`** reads from the old `br-elo.js` simulation, not from `users.br_rating`; must be retired
- **No BR tab in `leaderboard.html`** — the BR rating system exists but is not exposed in the global leaderboard
- **No BR stats on `profile.html`** — `br_rating` and `br_games_played` exist on `users` table but are not displayed
- **XP not called on BR session completion** — `award_xp()` is wired to Arena only; BR sessions do not award XP
- Sessions have not been tested with real AI-generated questions end-to-end (generation now wired; first live test pending)

### Target state — what Battle Royale should look like

- Sidebar entry "Battle Royale" links to `br-lobby.html`
- Dashboard card for BR showing player's BR rating
- `leaderboard.html` has a BR tab reading `users.br_rating DESC WHERE br_games_played > 0`
- `profile.html` shows `br_rating`, `br_games_played`, and BR session history
- `br-session.html` calls `award_xp()` on session completion (placement-based XP)
- `battle-royale.html` — redirect to `br-lobby.html` at top of file; remove from sidebar
- `br-leaderboard.html` — retired; replaced by the BR tab in `leaderboard.html`

---

## Pillar 4 — Trivia

### What Trivia is

Trivia is the **knowledge quiz pillar**. Players answer sports knowledge questions — not match-specific predictions, but general sports facts, history, player records, and rule-based questions. The format can be solo (time attack), 1v1 duel, or party (multiple players).

The defining characteristic of Trivia: questions test existing knowledge, not future predictions. There is no match to resolve against. Answers are right or wrong immediately.

### Why a player plays Trivia

You want to test what you actually know about the sport — not what will happen, but what has happened and what the rules are. It is the pillar for players who want a quick, self-contained challenge with no match dependency and no waiting for results. The faster you answer, the more you score. A 1v1 Trivia duel is a pure knowledge race. Trivia rewards the fans who have been watching football for decades, not just the match prediction analysts.

### What differentiates Trivia from other pillars

- **Not prediction** — questions have a known correct answer that does not depend on a future match
- **Not elimination** — wrong answers are scored but do not remove the player
- **Not match-bound** — no API-Sports integration needed for question resolution
- **Speed-scored** — faster correct answers score higher than slower correct answers

### Current state — what exists

**Backend:** Nothing. No `trivia_sessions` table, no `trivia_questions` table, no server-authoritative state, no matchmaking, no real opponent system.

**Frontend (`trivia.html`):**
- Solo / 1v1 Duel / Party mode selector
- Timer, scoring display, streak tracking
- Tier gating (Starter daily cap, Pro monthly cap, Elite fair-use cooldown)
- Static hardcoded question bank (JS array inside the page)
- `simulateDuelOpponent()` — opponent uses `Math.random()`
- `simulatePartyScores()` — other players' scores use `Math.random()`

The current page is a UI demo. Nothing is connected to a real backend. No game results are saved. No leaderboard exists. No real opponent is ever matched.

### Target state — what Trivia should look like

Trivia requires a full backend build before it can be a real pillar:
- `trivia_sessions` table — one row per game
- `trivia_questions` table — curated question bank, not hardcoded JS
- Server-authoritative scoring — not client-calculated
- Real matchmaking for 1v1 Duel mode
- Game history saved to DB
- Leaderboard tab for Trivia
- XP awarded on completion

**This is a separate sprint.** No Trivia backend work should begin until the other three pillars are fully surfaced in the frontend.

---

## Clubs (social layer, v1 — 2026-05-04)

### What Clubs is

Clubs is a **social competitive layer on top of the four gameplay pillars**, not a fifth pillar. A Club is a private group of users who play together (Leagues, Arena, Battle Royale, Trivia) and compete on a shared leaderboard.

### Critical product rule

> **Club leaderboard counts ONLY games played inside the club.** Solo games, public games, and games outside the club must never count. Currently NOT enforceable — see TODO below.

### Current state — what exists

**Frontend:** `clubs.html` page (v1, mock data) with the canonical layout:
- Top: club header (name / member count / Invite button)
- Below: 2-column grid (collapses below 1100px)
  - Left ~63%: Leaderboard (weekly / all-time tabs, podium highlight) → Activity feed
  - Right ~37%: Quick Actions (BR / Trivia / Create League) → Members list
- Sidebar nav entry: `Clubs` between Trivia and Find Venues

**Club-game tagging mechanism (stub):** Quick Actions set `sessionStorage.spontix_club_game = { clubId, clubName, kind, ts }` and append `?club=<clubId>` to the destination URL. Existing flows currently ignore these signals — by design for v1.

### Not built yet (v2 backlog)

- DB schema: `clubs`, `club_members`, `club_games` (game-id reference + winner + points)
- Persisting `clubId` on resulting BR / Trivia / League rows so the resolver credits club leaderboard
- Leaderboard query that aggregates from `club_games` only — never from regular game rows
- Real-time activity feed (Realtime on `club_games`)
- Roles (admin / member), invite tokens, kick / leave
- Multiple clubs per user (currently one hardcoded mock club)
- Club-vs-club competitions (post-v2)

---

## Navigation — Current vs Target

### Current state (broken)

```
Sidebar:
  Dashboard
  Your Games    → activity.html
  My Leagues    → my-leagues.html
  Discover      → discover.html
  Matches       → matches.html
  Schedule      → upcoming.html
  Leaderboard   → leaderboard.html
  Battle Royale → battle-royale.html    ← WRONG: old client simulation
  Trivia        → trivia.html
  Profile       → profile.html
  Notifications → notifications.html
```

Problems:
- Arena is completely absent from navigation
- Battle Royale links to the wrong page (old simulation)
- Leagues has no hub — sidebar goes directly to `my-leagues.html`
- No pillar structure is visible in the sidebar

### Target state

```
Sidebar:
  Dashboard
  ─────────────────────── (pillar section)
  Leagues       → leagues-hub.html (new)   or my-leagues.html as interim
  Arena         → multiplayer.html          ← ADD
  Battle Royale → br-lobby.html             ← CHANGE
  Trivia        → trivia.html
  ─────────────────────── (utility section)
  Leaderboard   → leaderboard.html
  Matches       → matches.html
  Schedule      → upcoming.html
  Profile       → profile.html
  Notifications → notifications.html
```

Notes:
- "Your Games" (`activity.html`) role is unclear in the 4-pillar architecture; audit before keeping or removing
- `battle-royale.html` — add a redirect to `br-lobby.html` at the top; remove from sidebar
- `br-leaderboard.html` — retire; remove from any nav references

---

## Dashboard — Current vs Target

### Current state

| Card | Exists | Links to |
|---|---|---|
| My Leagues | ✅ | `my-leagues.html` |
| Trivia | ✅ | `trivia.html` |
| Arena | ❌ | — |
| Battle Royale | ❌ | — |

### Target state

| Card | Status | Links to | Shows |
|---|---|---|---|
| Leagues | ✅ Update | Leagues hub | Active league count, next question due |
| Arena | ❌ Add | `multiplayer.html` | Player's current tier and rating |
| Battle Royale | ❌ Add | `br-lobby.html` | Player's BR rating |
| Trivia | ✅ Keep | `trivia.html` | Games remaining in tier quota |

---

## Leaderboard — Current vs Target

| Tab | Status |
|---|---|
| Global | ✅ Live |
| My Leagues | ✅ Live |
| Friends | ✅ Live |
| Arena | ✅ Live — reads `users.arena_rating DESC WHERE arena_games_played > 0` |
| Battle Royale | ❌ Missing — needs tab reading `users.br_rating DESC WHERE br_games_played > 0` |
| Trivia | ❌ Blocked — no backend |

---

## Profile — Current vs Target

| Section | Status |
|---|---|
| XP bar + level | ✅ Live |
| Arena tier badge | ✅ Live |
| Arena rating | ✅ Live |
| Arena History tab | ✅ Live |
| BR rating (`users.br_rating`) | ❌ Missing |
| BR games played | ❌ Missing |
| BR session history | ❌ Missing |
| Trivia stats | ❌ Blocked — no backend |

---

## Cross-Pillar Systems

### XP

`award_xp()` RPC exists and is idempotent. Currently only called from Arena.

| Pillar | XP wired |
|---|---|
| Leagues | ❌ Not called |
| Arena | ✅ Win=50, Draw=25, Loss=15 |
| Battle Royale | ❌ Not called — suggested: 1st=75, 2nd=40, 3rd=20, eliminated=10 |
| Trivia | ❌ Blocked — no backend |

### ELO / Rating

| Pillar | Rating system | Status |
|---|---|---|
| Leagues | Points only, no ELO | ✅ By design |
| Arena | `users.arena_rating` — K-factor ELO, 9-tier display | ✅ Live |
| Battle Royale | `users.br_rating` — pairwise ELO, columns exist | ✅ Backend live, ❌ profile not showing |
| Trivia | None defined | ❌ Blocked |

**Critical rule: `arena_rating` and `br_rating` are completely independent rating systems. Never read one to compute the other.**

### Notifications

| Pillar | Notifications |
|---|---|
| Leagues | ✅ Migration 005 — question new, question resolved, member joined |
| Arena | ✅ Deep-link push notifications for arena sessions |
| Battle Royale | ❌ Not wired |
| Trivia | ❌ Blocked |

---

## Pages — Status and Action Required

| Page | Pillar | Status | Action |
|---|---|---|---|
| `league.html` | Leagues | ✅ Correct | No change needed |
| `create-league.html` | Leagues | ✅ Correct | No change needed |
| `discover.html` | Leagues | ✅ Correct | No change needed |
| `my-leagues.html` | Leagues | ✅ Correct | Remains; hub will link to it |
| `multiplayer.html` | Arena | ⚠️ Exists, hidden | Add to sidebar; rebrand as "Arena"; add Casual/Ranked/Private layer |
| `arena-session.html` | Arena | ✅ Correct | Add context label to top bar |
| `br-lobby.html` | Battle Royale | ✅ Correct | Wire to sidebar |
| `br-session.html` | Battle Royale | ✅ Correct | Wire `award_xp()` on completion |
| `battle-royale.html` | — | ❌ Old simulation | Add redirect to `br-lobby.html`; remove from sidebar |
| `br-leaderboard.html` | — | ❌ Old simulation | Retire; remove from any nav references |
| `trivia.html` | Trivia | ⚠️ Demo only | Keep UI; do not wire backend until sprint planned |
| `leaderboard.html` | Cross-pillar | ⚠️ Missing BR tab | Add BR tab |
| `profile.html` | Cross-pillar | ⚠️ Missing BR stats | Add `br_rating`, `br_games_played`, BR history |
| `dashboard.html` | Cross-pillar | ⚠️ Missing Arena + BR cards | Add both pillar cards |
| `live.html` | Unknown | ❓ Unclear | Audit — likely retire if unused |

---

## What Is Fully Live vs What Is Not

| Component | Fully Live | Partially Built | Not Built |
|---|---|---|---|
| Leagues gameplay | ✅ | | |
| Leagues question generation | ✅ | | |
| Leagues resolver | ✅ | | |
| Arena matchmaking | ✅ | | |
| Arena gameplay | ✅ | | |
| Arena ELO + XP | ✅ | | |
| Arena spectator | ✅ | | |
| Arena leaderboard | ✅ | | |
| BR backend (DB, RPCs, ELO) | ✅ | | |
| BR question generation | ✅ | | |
| BR lobby + session pages | | ✅ wired, first live test pending | |
| BR navigation | | | ❌ links to old simulation |
| BR leaderboard tab | | | ❌ |
| BR profile stats | | | ❌ |
| BR XP wiring | | | ❌ |
| Arena visible in nav | | | ❌ |
| Arena context layers (Casual/Ranked/Private) | | | ❌ |
| Dashboard 4-pillar cards | | | ❌ |
| Leagues hub page | | | ❌ |
| Trivia UI demo | | ✅ demo only | |
| Trivia backend | | | ❌ |

---

## Implementation Priority Order

Work must proceed in this order. Do not skip ahead.

1. **Navigation fix** — change sidebar BR link to `br-lobby.html`; add Arena entry to sidebar; add redirect in `battle-royale.html`
2. **Dashboard 4-pillar cards** — add Arena card (→ `multiplayer.html`) and BR card (→ `br-lobby.html`)
3. **BR leaderboard tab** — add BR tab to `leaderboard.html`
4. **BR profile stats** — add `br_rating`, `br_games_played`, BR history to `profile.html`
5. **BR XP wiring** — call `award_xp()` from `br-session.html` completion overlay
6. **Arena context layers** — add Casual / Ranked / Private selection to `multiplayer.html`
7. **Arena session context label** — show "Ranked 1v1" / "Casual 2v2" in `arena-session.html` top bar
8. **Leagues hub** — create a hub page for the Leagues pillar surfacing all formats
9. **Retire `br-leaderboard.html`** — remove from any nav references once BR leaderboard tab is live
10. **Trivia backend** — full build; separate sprint; do not begin until items 1–8 are complete

---

## What Must Never Happen

- `arena_rating` and `br_rating` must never be confused or cross-computed
- `battle-royale.html` must never be extended — it is the old simulation
- Trivia must not be wired to a partial backend — it is either a full build or a demo
- The old labels singleplayer / multiplayer / party must not appear as top-level navigation or dashboard labels
- Leagues must not be described or treated as just "my-leagues / discover / create"
- Arena must not be treated as just "multiplayer.html"
