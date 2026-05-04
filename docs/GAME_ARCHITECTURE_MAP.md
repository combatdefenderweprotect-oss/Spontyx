# Spontix — Game Architecture Map

**Last updated: 2026-05-01**

Full implementation status across all 4 gameplay pillars. This document is the single source of truth for what is built, what is partial, and what is not started. Update it every sprint.

---

## The 4-Pillar Model

| Pillar | Core mechanic | Win condition | Match dependency | Rating system |
|---|---|---|---|---|
| **Leagues** | Predict outcomes, accumulate points | Highest cumulative score | Yes (PREMATCH + LIVE + REAL_WORLD) | Cumulative leaderboard |
| **Arena** | Predict in real-time, short session | Higher session score (1v1 / 2v2) | Yes (CORE_MATCH_LIVE) | ELO (9 tiers) |
| **Battle Royale** | Answer or lose HP, last survivor wins | Outlast all opponents | Yes (BR_MATCH_LIVE — sequential) | BR Rating (separate from Arena ELO) |
| **Trivia** | Answer knowledge questions | Correct answers / speed | No (independent of match data) | TBD |

---

## Pillar 1 — Leagues

> **Canonical creation spec:** [`docs/LEAGUE_CREATION_FLOW.md`](LEAGUE_CREATION_FLOW.md) — three types (Season-Long / Match Night / Custom), Path A (team) vs Path B (competition) for Season-Long, fixture-source-exhaustion lifecycle, knockout patience rule, data dependency TODO.

### What it is
Long-term competitive prediction leagues. Players join a league tied to a sport / competition / team and answer prediction questions across multiple matches over a season or a single-match window. Points accumulate over time. Three creation types: Season-Long (auto-populated season fixtures), Match Night (single fixture), Custom (creator-defined). Season-Long ends only when the underlying fixture source is exhausted (team eliminated from all selected competitions, or seasons concluded) — never on a temporary draw gap.

### Backend status

| Component | Status | Location |
|---|---|---|
| `leagues` table | ✅ Live | migration 001 |
| `league_members` table | ✅ Live | migration 001 |
| `questions` table (league path) | ✅ Live | migration 002 + 006 + 010 |
| `player_answers` table (league path) | ✅ Live | migration 004 + 006 |
| CORE_MATCH_PREMATCH generation | ✅ Live | `generate-questions/index.ts` |
| CORE_MATCH_LIVE generation | ✅ Live | `generate-questions/index.ts` |
| REAL_WORLD generation | ✅ Live | `generate-questions/index.ts` |
| Full resolver (all predicate types) | ✅ Live | `resolve-questions/index.ts` |
| 6-multiplier scoring formula | ✅ Live | `resolve-questions/index.ts` |
| Pre-match scheduling (offset hours) | ✅ Live | migration 018 |
| Question pool system (reuse) | ✅ Live | `lib/pool-manager.ts` |
| Prematch quality filter (v2.2) | ✅ Live | `lib/prematch-quality-filter.ts` |
| Realtime publication | ✅ Live | migration 028 |
| Arena session status guard in resolver | ✅ Live | `resolve-questions/index.ts` |
| `complete_arena_session()` RPC hook | ✅ Live | migration 039 |
| League cascade delete | ✅ Live | migration 019 |
| Play mode (solo / multiplayer) | ✅ Live | migration 029 |
| Live stats feed cache | ✅ Live | migration 015 + `live-stats-poller` |
| AI REAL_WORLD quality gate (Call 4) | ✅ Live | `openai-client.ts` |
| REAL_WORLD player database | ✅ Live | migration 026 |
| AI web fallback resolution | ✅ Live | `lib/ai-verifier.ts` |
| Scraper enrichment (article context) | ✅ Live | `lib/news-adapter/google-news-rss.ts` |
| `rw_quality_score` DB columns | ✅ Live | migration 027 |

### Frontend status

| Page / Feature | Status |
|---|---|
| `league.html` — Realtime feed + leaderboard + stats tab | ✅ Live |
| `create-league.html` — 5-step wizard | ✅ Live |
| `discover.html` — public league discovery | ✅ Live |
| ~~`my-leagues.html`~~ | 🗑 Removed 2026-05-04 — folded into `leagues-hub.html` |
| `leagues-hub.html` — real-data Active/Upcoming/Finished + Source filter (All/Created/Joined) + Type filter (Season-Long/Match Night/Custom) with colored badges | ✅ Live |
| `activity.html` — open question alerts | ✅ Live |
| Pre-match status strip (lifecycle UX) | ✅ Live |
| REAL_WORLD card (context + confidence + sources) | ✅ Live |
| Live window strip (anchored minute windows) | ✅ Live |
| In-session question history drawer | ✅ (built in arena-session.html; not in league.html) |
| Match summary card (session end card) | ❌ Not built |
| Question chaining UI (what's next prompt) | ❌ Not built |
| Deep-link from push notifications | ❌ Not built |

### Gaps / next steps
- Session pacing for Match Night (legacy "Type 1") leagues — fixed question budget, chaining, match summary card — is designed in `SESSION_CONTINUATION_DESIGN.txt` but not built
- Season-Long + Custom (legacy "Type 2") pacing is effectively what runs today
- ✅ **Season-Long creation flow rebuilt and shipped (2026-05-04)** per [`LEAGUE_CREATION_FLOW.md`](LEAGUE_CREATION_FLOW.md). Migration 051 + edge function fan-out + UI fork live. Path A multi-comp, Path A single-comp, Path B all verified in production. Match Night and Custom unaffected.
- **Completion Evaluator NOT built.** Season-Long leagues stay `active` indefinitely until built. Tracked in [`LEAGUE_COMPLETION_EVALUATOR_TODO.md`](LEAGUE_COMPLETION_EVALUATOR_TODO.md).
- **Data dependency**: `team_still_active` and `season_end_date` external signals not yet sourced. Production runs on the conservative `sports_teams`-registration fallback for Path A. UI copy never claims active participation with certainty.
- **Cup coverage in `sports_teams`** may be sparse — Path A will under-detect cup participation in those cases (separate sync-job task).

---

## Pillar 2 — Arena

### What it is
Short competitive sessions, matchmaking-based. Players enter a lobby, get matched, and compete answering CORE_MATCH_LIVE questions for the duration of a match half or full match. Session ends when questions are exhausted or the match ends. Score is compared at end. ELO rating updates after each session.

### Backend status

| Component | Status | Location |
|---|---|---|
| `arena_sessions` table | ✅ Live | migration 033 |
| `arena_session_players` table | ✅ Live | migration 033 |
| `match_lobbies` + `match_lobby_players` tables | ✅ Live | migration 030 |
| `match_lobbies.player_count` trigger (denormalized) | ✅ Live | migration 031 |
| `match_lobbies.arena_session_id` FK | ✅ Live | migration 034 |
| `arena_sessions.is_spectatable` | ✅ Live | migration 038 |
| Arena session live question generation | ✅ Live | `generate-questions/index.ts` (arena loop) |
| `complete_arena_session()` RPC | ✅ Live | migration 039 |
| `increment_arena_player_score()` RPC | ✅ Live | migration 037 |
| `award_xp()` RPC | ✅ Live | migration 035 |
| `update_arena_ratings()` ELO RPC | ✅ Live | migration 036 |
| `users.arena_rating`, `arena_games_played` | ✅ Live | migration 036 |
| `arena_session_players.arena_rating_before/after/delta` | ✅ Live | migration 036 |
| Arena session status guard in resolver | ✅ Live | `resolve-questions/index.ts` |
| `maybeCompleteArenaSession()` hook in resolver | ✅ Live | `resolve-questions/index.ts` |
| Realtime on `arena_sessions` + `arena_session_players` | ✅ Live | migration 033 |
| RLS: session participants only, spectator read | ✅ Live | migration 033 + 038 |
| Push notifications for arena sessions | ✅ Live | `resolve-questions/index.ts` (deep-link routing) |

### Frontend status

| Page / Feature | Status |
|---|---|
| `multiplayer.html` — matchmaking lobby (3-step flow) | ✅ Live |
| `multiplayer.html` — live interest signals (Ready/Trending/queue) | ✅ Live |
| `multiplayer.html` — sport filter + competition filter | ✅ Live |
| `multiplayer.html` — 2v2 team auto/invite options | ✅ Live |
| `arena-session.html` — question feed, answer submission | ✅ Live |
| `arena-session.html` — scoreboard + Realtime | ✅ Live |
| `arena-session.html` — Streak / Comeback / Clutch badges | ✅ Live |
| `arena-session.html` — complete overlay + ELO delta pill | ✅ Live |
| `arena-session.html` — question results breakdown | ✅ Live |
| `arena-session.html` — question history drawer | ✅ Live |
| `arena-session.html` — spectator mode | ✅ Live |
| `arena-session.html` — XP awarded + pill display | ✅ Live |
| `leaderboard.html` — Arena tab | ✅ Live |
| `profile.html` — Arena tier badge (9 tiers) | ✅ Live |
| `dashboard.html` — Arena tier + XP bar | ✅ Live |
| `profile.html` — Arena History tab | ✅ Live |

### Gaps / next steps
- 2v2 team assignment edge cases (reported in prior sprint, fixed in 037)
- No dedicated "Arena match history" screen beyond the profile tab
- Spectator join flow requires knowing the session URL — no discovery/browse for spectatable sessions

---

## Pillar 3 — Battle Royale

### What it is
HP-based survival game. Players start with 100 HP. Each round, one question is asked. Wrong answer or no answer = HP damage (-15 default). Correct answer = no damage + streak HP bonuses. HP hits 0 = eliminated. Last player standing wins. Placement assigned at elimination time.

### Backend status

| Component | Status | Location |
|---|---|---|
| `br_sessions` table | ✅ Live | migration 042 |
| `br_session_players` table (HP, streak, elimination, placement) | ✅ Live | migration 043 |
| `questions.br_session_id` FK + index | ✅ Live | migration 044 |
| `questions_session_exclusivity` CHECK (3-way) | ✅ Live | migration 044 |
| `player_answers.br_session_id` FK + index | ✅ Live | migration 045 |
| `pa_insert_self` 3-path RLS (league / arena / BR) | ✅ Live | migration 045 |
| `pa_select_member` 3-path RLS | ✅ Live | migration 045 |
| `users.br_rating`, `br_games_played`, `br_rating_updated_at` | ✅ Live | migration 046 |
| `br_session_players.br_rating_before/after/delta` | ✅ Live | migration 046 |
| `instantiate_br_session()` RPC | ✅ Live | migration 047 |
| `advance_br_session_round()` RPC (idempotent) | ✅ Live | migration 047 |
| `finalize_br_session()` RPC (internal) | ✅ Live | migration 047 |
| `br-resolve-every-minute` cron (job 9) | ✅ Live | migration 048 |
| `resolve-questions?br_only=1` param | ✅ Live | `resolve-questions/index.ts` |
| `br_sessions_update_own` RLS policy | ✅ Live | applied manually post-043 |
| Realtime on `br_sessions` + `br_session_players` | ✅ Live | migration 042–043 |
| **BR_MATCH_LIVE question generation** | ❌ Not built | `generate-questions/index.ts` |
| **`update_br_ratings()` ELO write RPC** | ❌ Not built | Phase 3 placeholder in 047 |
| **BR match pool / question bank** | ❌ Not built | needs design |

### Frontend status

| Page / Feature | Status |
|---|---|
| `battle-royale.html` — old client-side simulation | ✅ Exists (NOT connected to new backend) |
| `br-leaderboard.html` — ELO history (client-side) | ✅ Exists (reads `game_history`, not `br_sessions`) |
| **New BR session lobby** | ❌ Not built |
| **New BR gameplay page** (connected to `br_sessions`) | ❌ Not built |
| **BR HP display + round timer** | ❌ Not built |
| **BR elimination / placement screen** | ❌ Not built |
| **BR leaderboard using `users.br_rating`** | ❌ Not built |
| **BR profile stats / history** | ❌ Not built |

### What the old `battle-royale.html` does vs the new backend

| | Old (`battle-royale.html`) | New (migrations 042–048) |
|---|---|---|
| HP tracking | Client-side JS only | `br_session_players.hp` in Postgres |
| Placement | Browser reports it | Server computes via `advance_br_session_round()` |
| Questions | Simulated / static | Real `BR_MATCH_LIVE` questions (not yet generated) |
| Cheating risk | High — player can manipulate JS | None — server-authoritative |
| ELO | `br-elo.js` + `game_history` | `users.br_rating` (write not yet implemented) |

**Critical**: the old `battle-royale.html` is still the only live BR experience. The new backend is complete but has no frontend. Do not remove the old page until the new gameplay page is built and tested.

### Gaps / next steps (in order)
1. BR_MATCH_LIVE question generation in `generate-questions`
2. New BR session lobby page (format select → match select → waiting room → start)
3. New BR gameplay page connected to `br_sessions` + `advance_br_session_round()`
4. `update_br_ratings()` RPC (Phase 3 — ELO writes to `users.br_rating`)
5. BR leaderboard tab in `leaderboard.html` (reads `users.br_rating`)
6. Retire or redirect `battle-royale.html` once new flow is tested

---

## Pillar 4 — Trivia

### What it is
Knowledge-based question sessions, independent of live match data. Players answer general sports knowledge questions (or themed trivia). No prediction mechanic, no resolver, no sports API dependency. Questions have a known correct answer at generation time. Sessions are real-time (all players answer simultaneously within a time window per question).

### Backend status

| Component | Status | Notes |
|---|---|---|
| `trivia_sessions` table | ❌ Not built | needs design |
| `trivia_questions` table | ❌ Not built | different schema from `questions` — no prediction predicate |
| `trivia_answers` table | ❌ Not built | answer at submission, not at resolution |
| Trivia session lifecycle RPCs | ❌ Not built | |
| Rating / scoring system | ❌ Not designed | ELO? separate leaderboard? XP only? |
| Question generation pipeline | ❌ Not built | completely separate from prediction pipeline |
| Resolver | ❌ Not applicable | answers are correct/incorrect at submit time |

### Frontend status

| Page / Feature | Status |
|---|---|
| `trivia.html` — Solo/1v1/Party selector (client simulation) | ✅ Exists (no backend) |
| Server-authoritative trivia session | ❌ Not built |

### What needs to be decided before building
1. **Question source** — AI-generated from sports knowledge? Curated static bank? Both?
2. **Session type** — Real-time (all answer simultaneously) or async (individual pace)?
3. **Rating system** — Separate ELO? Shared XP only? Unranked?
4. **Question schema** — Static correct answer stored at creation. No predicate. No resolver.
5. **Match dependency** — Themed trivia tied to an upcoming match? Or fully standalone?

### Infrastructure notes
- Cannot share the `questions` table without adding a 4th discriminator column and weakening the `questions_session_exclusivity` CHECK constraint
- Cannot use the existing resolver — trivia answers are evaluated at submission, not after a sports API call
- The timing model (`visible_from` / `answer_closes_at` / `resolves_after`) does not apply — replace with per-round timers managed by the session
- XP (`award_xp()` RPC) can be reused for trivia rewards
- Tier gating infrastructure can be reused (already has trivia daily/monthly counters in `TIER_LIMITS`)

---

## Clubs (social layer, v1 — 2026-05-04)

Not a pillar — a **social layer on top of the four pillars**. Private groups of users who play together and compete on a shared leaderboard.

### Status

| Component | Status | Location |
|---|---|---|
| `clubs.html` page (mock data, 2-column layout) | ✅ Live | new file |
| Sidebar nav entry | ✅ Live | `sidebar.js` |
| Quick-action club-game tagging (sessionStorage + `?club=` URL param) | ✅ Live (write-side) | `clubs.html` |
| Quick-action consumers (BR / Trivia / Create League read club marker) | ❌ Not built | by design for v1 |
| `clubs` / `club_members` / `club_games` tables | ❌ Not built | future migration |
| Club leaderboard aggregation (only club games count) | ❌ Not built | depends on `club_games` |
| Real-time activity feed | ❌ Not built | future Realtime |
| Roles, invites, kick/leave | ❌ Not built | v2 |
| Multiple clubs per user | ❌ Not built | currently one hardcoded mock |
| Club-vs-club competitions | ❌ Not designed | post-v2 |

### Critical product rule

Club leaderboard MUST count only games played inside the club. Solo / public / external games never count. Cannot be enforced until `club_games` persistence ships — explicit TODO documented in `clubs.html`.

---

## Cross-pillar infrastructure (shared systems)

| System | Leagues | Arena | BR | Trivia |
|---|---|---|---|---|
| `questions` table | ✅ | ✅ | ✅ | ❌ (needs own) |
| `player_answers` table | ✅ | ✅ | ✅ | ❌ (needs own) |
| Resolver (`resolve-questions`) | ✅ | ✅ | ✅ | ❌ (not needed) |
| `generate-questions` Edge Function | ✅ | ✅ | ❌ (not yet) | ❌ (not yet, different pipeline) |
| `live-stats-poller` | ✅ | ✅ | ✅ | ❌ |
| `award_xp()` RPC | — | ✅ | ❌ (not yet wired) | ❌ (not yet) |
| ELO rating | — | ✅ Arena ELO | ❌ BR ELO (columns exist, write not built) | ❌ TBD |
| Realtime subscriptions | ✅ | ✅ | ✅ | ❌ (not yet) |
| Tier gating (`TIER_LIMITS`) | ✅ | ✅ | ✅ (daily counter) | ✅ (daily/monthly counter) |
| Push notifications | ❌ | ✅ | ❌ | ❌ |
| XP bar + level display | ✅ | ✅ | ❌ | ❌ |

---

## Implementation priority map

### Phase: now (immediately actionable — backend exists, just needs frontend)
- BR gameplay page (connects `br_sessions` + `advance_br_session_round()` — backend is ready)
- BR session lobby (matchmaking into a `br_sessions` row)
- BR_MATCH_LIVE question generation

### Phase: next (backend partially exists, needs completion)
- `update_br_ratings()` RPC (Phase 3 — columns exist, function not written)
- BR leaderboard (`leaderboard.html` new tab using `users.br_rating`)
- BR profile stats

### Phase: design-first (needs decisions before touching code)
- Trivia session schema (DB design, question format, scoring model)
- Trivia question generation approach
- Trivia rating system

### Phase: post-launch / polish
- League session pacing for Type 1 (question chaining, match summary card)
- Spectatable session browser (discovery of live spectatable arena sessions)
- Cross-pillar activity feed (shows what mode you have active right now)

---

## Summary: one-line status per pillar

| Pillar | Backend | Frontend | Rating | Ready for players? |
|---|---|---|---|---|
| **Leagues** | ✅ Complete | ✅ Complete | Cumulative leaderboard | ✅ Yes |
| **Arena** | ✅ Complete | ✅ Complete | ✅ ELO live | ✅ Yes |
| **Battle Royale** | ✅ Phase 1 complete | ❌ Old simulation only | ❌ Columns exist, writes not built | ❌ No (backend not connected) |
| **Trivia** | ❌ Not started | ⚠️ Simulation only | ❌ Not designed | ❌ No |
