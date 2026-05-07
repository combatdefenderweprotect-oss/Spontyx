# Spontix — Trivia System

**Status:** Production ✅ (Solo + Ranked Duel live; Party + Event not yet implemented)
**Last updated: 2026-05-07**
**Migrations:** 076–084 — all applied

---

## 1. Overview

Trivia is Spontix's **knowledge quiz pillar** — standalone sports knowledge questions with no dependency on live match data. Players answer multiple-choice questions in one of four modes, earn XP, build streaks, and compete on a rating ladder via Ranked Duel.

Unlike Leagues, Arena, and Battle Royale, Trivia answers are evaluated immediately on submission — there is no prediction mechanic, no resolver job, and no sports API dependency.

**Live today:**
- Solo: up to 25 questions, sport-filtered, difficulty-selected, fully server-persisted
- Ranked Duel: atomic matchmaking via `pair_trivia_queue()`, real-time opponent score tracking via Supabase Realtime, Elo rating applied by `finalize_duel()`

**Not yet implemented:**
- Party (multiplayer lobby, host-controlled)
- Event (host-managed trivia event rooms)
- Friend Duel (private room, no rating change)
- AI question generation (Edge Function + credits system DB is built but not wired to a generator)

---

## 2. Database Schema

### 2.1 Question Bank

#### `trivia_questions`
One row per question. The canonical source of truth for all trivia content.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `sport` | TEXT | `soccer\|nfl\|nba\|mlb\|college_football\|f1\|tennis\|mma` |
| `category` | TEXT | Sub-topic label |
| `event` | TEXT | `world_cup_2026` or NULL |
| `difficulty` | TEXT | `easy\|medium\|hard` (no adaptive/escalating — these do not exist) |
| `question` | TEXT | ≥15 chars |
| `options` | JSONB | Array of exactly 4 strings |
| `correct_index` | INT | 0–3 |
| `explanation` | TEXT | Optional post-answer context |
| `source_type` | TEXT | `manual\|ai\|user\|event` |
| `approval_state` | TEXT | `pending\|playable_private\|approved_public\|rejected\|auto_suppressed` |
| `quality_score` | NUMERIC(3,1) | 0–10, used for pool selection |
| `times_used` / `correct_rate` | INT / NUMERIC | Updated per-session for quality tracking |
| `promotion_eligible` | BOOLEAN | Set when private AI question meets public threshold |

**RLS:** `approved_public` rows are readable by all authenticated users. Owners read their own `playable_private` rows. No authenticated write policies — Edge Functions use service role.

**Serving index:** `idx_tq_public_pool` on `(sport, difficulty) WHERE approval_state = 'approved_public'` — main pool query.

#### `trivia_question_sets`
Named curated sets, used as `question_set_id` on rooms and sessions.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `sport` / `event` / `scope_type` | TEXT | Taxonomy mirrors questions |
| `question_ids` | UUID[] | Ordered array |
| `question_count` | INT (generated) | `array_length(question_ids, 1)` |
| `visibility` | TEXT | `private\|public\|event_only` |
| `ai_prompt_hash` | TEXT | Dedup key for AI-generated sets |

---

### 2.2 Sessions

#### `trivia_sessions`
One row per game played, all modes.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → auth.users | |
| `mode` | TEXT | `solo\|ranked_duel\|friend_duel\|party\|event` |
| `sport` | TEXT | DB key at session creation |
| `difficulty` | TEXT | `easy\|medium\|hard\|mixed` (adaptive/escalating not used) |
| `total_rounds` / `timer_seconds` | INT | Snapshotted at session start — not re-derived from config |
| `is_ranked` | BOOLEAN | TRUE only for ranked_duel |
| `correct_count` / `wrong_count` | INT | Set by `complete_trivia_session()` |
| `total_xp_earned` | INT | After all multipliers |
| `accuracy` | NUMERIC(5,4) | 0.0–1.0 |
| `stars` | INT | 0–3 (solo only) |
| `result_status` | TEXT | `completed\|abandoned\|win\|loss\|draw` |
| `rating_delta` / `pre_game_rating` | INT | Set by `finalize_duel()` for ranked sessions |
| `xp_source_breakdown` | JSONB | Per-session XP audit record |
| `room_id` | UUID FK → trivia_rooms | Ranked duel sessions only |
| `best_streak_in_session` | INT | Used by finalize_duel for stats |
| `completed` | BOOLEAN | Set atomically by `complete_trivia_session()` |

**RLS:** Users read and insert only their own rows. No direct UPDATE — all writes via SECURITY DEFINER RPCs.

#### `trivia_session_answers`
One row per question per session.

| Column | Type | Notes |
|---|---|---|
| `session_id` | UUID FK → trivia_sessions | Cascade delete |
| `question_id` | UUID FK → trivia_questions | |
| `question_index` | INT | 0-based position; unique per session |
| `chosen_index` | INT | NULL = timed out |
| `is_correct` | BOOLEAN | NULL if timed out |
| `response_time_ms` | INT | |
| `base_xp` / `speed_multiplier` / `streak_multiplier` / `final_xp_awarded` | INT/NUMERIC | Per-answer XP breakdown |

**RLS:** Users read own answers; `tsa_select_duel_room_participant` (migration 084) allows both players in a ranked_duel room to read each other's answers — required for Realtime opponent score tracking.

---

### 2.3 Player Stats & Ratings

#### `trivia_player_stats`
One row per player. Aggregate lifetime stats.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID PK | |
| `xp_total` | INT | Never resets |
| `xp_this_week` | INT | Reset every Monday 00:00 UTC by pg_cron |
| `games_played` / `games_solo` / `games_duel` / `games_party` / `games_event` | INT | Mode counters |
| `correct_total` / `wrong_total` | INT | All-time |
| `best_single_game_score` | INT | Highest `total_xp_earned` in one session |
| `best_accuracy` | NUMERIC(5,4) | Personal best |
| `perfect_games` | INT | Sessions with `wrong_count = 0` |
| `best_in_session_streak` | INT | Longest correct streak in a single session |
| `last_played_at` | TIMESTAMPTZ | |

Level is **not** stored — computed client-side from `xp_total` via the `levels[]` array in `trivia.html`.

**RLS:** Public read (leaderboard). Users insert/update own row. Service role via RPCs is the preferred write path.

#### `trivia_player_ratings`
Global Elo rating. One row per player, never reset.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID PK | |
| `rating` / `peak_rating` | INT | Starting value: 800; floor: 400 |
| `ranked_duels` / `wins` / `losses` / `draws` | INT | |

**RLS:** Public read. No direct write — SECURITY DEFINER only.

#### `trivia_sport_ratings`
Per-player per-sport ratings. PK: `(user_id, sport)`.

Mirrors `trivia_player_ratings` columns. Updated in the same `finalize_duel()` transaction with the same Elo delta.

#### `trivia_event_ratings`
Per-player per-event ratings. PK: `(user_id, event)`. Currently supports `world_cup_2026`. `season_start`/`season_end` are snapshotted at row creation.

---

### 2.4 Ranked Duel Infrastructure

#### `trivia_rooms`
One row per Ranked Duel match. Created atomically by `pair_trivia_queue()`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `sport` / `event` | TEXT | Question scope |
| `question_ids` | UUID[] | Ordered set of 10 IDs, same for both players |
| `total_rounds` / `timer_seconds` | INT | Always 10 / 15 (enforced by config) |
| `player1_id` / `player2_id` | UUID FK → auth.users | Assigned by queue join order |
| `player1_session_id` / `player2_session_id` | UUID FK → trivia_sessions | Written by pair_trivia_queue |
| `status` | TEXT | `waiting\|active\|completed\|abandoned` |
| `winner_id` / `is_draw` / `finalized_at` | | Set by `finalize_duel()` |

**RLS:** Both players read their own room. No INSERT/UPDATE — SECURITY DEFINER only.

#### `trivia_duel_queue`
One active entry per player. Matchmaker reads `waiting` rows.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID FK | Unique partial index: one waiting entry per user |
| `sport` | TEXT | Must match for pairing |
| `rating_snapshot` | INT | At queue join — for future ELO-balanced pairing |
| `status` | TEXT | `waiting\|matched\|cancelled\|expired` |
| `matched_room_id` | UUID FK → trivia_rooms | Set on match |
| `expires_at` | TIMESTAMPTZ | `joined_at + 5 minutes` |

**RLS:** Users read their own entry. Users insert own entry. Users can update own `waiting` entry to `cancelled` only. `pair_trivia_queue()` and `cancel_trivia_queue()` are SECURITY DEFINER.

**Expiry:** pg_cron job (`trivia-expire-duel-queue`, every minute) marks stale `waiting` rows as `expired`. Also checked inline by `pair_trivia_queue()`.

---

### 2.5 Daily Challenges

#### `trivia_daily_challenges`
One row per calendar day. Admin-written (service role).

| Column | Type | Notes |
|---|---|---|
| `challenge_date` | DATE UNIQUE | |
| `sport` / `difficulty` | TEXT | |
| `question_ids` | UUID[] | Pre-selected question set |
| `bonus_xp_multiplier` | NUMERIC(4,2) | 1.0–3.0, default 1.5 |
| `total_rounds` / `timer_seconds` | INT | |

**RLS:** Authenticated users read only. No write policies.

#### `trivia_daily_completions`
One row per `(user_id, challenge_id)`. Immutable.

| Column | Type | Notes |
|---|---|---|
| `user_id` / `challenge_id` | UUID PK | |
| `session_id` | UUID FK → trivia_sessions | |
| `xp_earned` / `correct_count` / `stars` | INT | |

**RLS:** Authenticated users read all (daily leaderboard). Users insert own row only. No UPDATE.

---

### 2.6 AI Credit System

Three tables for tracking AI question generation costs. DB built in migration 081; Edge Function generator not yet wired.

| Table | Purpose |
|---|---|
| `trivia_ai_credit_wallets` | Per-user balance ledger |
| `trivia_ai_credit_transactions` | Immutable debit/credit audit trail |
| `trivia_ai_generation_logs` | Per-generation-job record; FK wired into `trivia_questions.generation_log_id` |

All writes via SECURITY DEFINER RPCs or service role (Edge Functions). No user-facing write policies.

---

## 3. Game Modes

| Mode | Status | Rating | Questions | Timer |
|---|---|---|---|---|
| `solo` | ✅ Live | XP only | 10/15/25 (configurable) | 20s (default) |
| `ranked_duel` | ✅ Live | Elo + XP | 10 (fixed) | 15s (fixed) |
| `friend_duel` | ❌ Not built | XP only | 5/10/15 | 20s |
| `party` | ❌ Not built | XP only | 10/15/20/30 | 20s |
| `event` | ❌ Not built | XP only | 10/20/30/50 | 20s |

Config source: [`trivia-config.js`](../trivia-config.js) — single source of truth for timers, round counts, XP multipliers, and win conditions.

### Solo flow
1. Player selects sport (or "All") + difficulty + round count on the Setup screen
2. `loadQuestionsFromDB()` fetches `approved_public` questions from `trivia_questions`
3. Session row inserted into `trivia_sessions`; answers inserted per-question into `trivia_session_answers`
4. On completion: `complete_trivia_session()` RPC marks session complete + upserts `trivia_player_stats`

### Ranked Duel flow
```
Player A joins queue → INSERT trivia_duel_queue (status='waiting')
                                         │
                    pair_trivia_queue() polling (2s interval)
                                         │
              Opponent found (FOR UPDATE SKIP LOCKED)
                                         │
                        CREATE trivia_rooms + 2 trivia_sessions
                        Mark both queue entries 'matched'
                        Return { room_id, session_id, opponent_id, question_ids }
                                         │
                Both players load to duel-play screen
                Both subscribe to Realtime postgres_changes on trivia_session_answers
                (filtered by room via tsa_select_duel_room_participant policy)
                                         │
                Player answers question → INSERT trivia_session_answers
                Opponent's panel updates in real time
                                         │
                Session ends → complete_trivia_session() (skips stats — deferred to finalize)
                                         │
                finalize_duel(room_id) → determines winner → applies Elo → upserts stats
```

**Race safety:** `pair_trivia_queue()` uses `FOR UPDATE SKIP LOCKED` on both queue rows — prevents two concurrent calls from pairing the same opponent.

**Idempotency:** `finalize_duel()` checks `room.status = 'completed'` before acting; safe to call from both players concurrently.

---

## 4. RPCs

| RPC | Migration | Security | Purpose |
|---|---|---|---|
| `upsert_trivia_player_stats_after_session(...)` | 077 | SECURITY DEFINER | Atomic CREATE OR UPDATE on `trivia_player_stats` after solo/party/event session |
| `complete_trivia_session(...)` | 077a, updated 079 | SECURITY DEFINER | Marks session completed; skips stats for ranked (deferred to finalize_duel) |
| `finalize_duel(p_room_id)` | 079 | SECURITY DEFINER | Determines win/loss/draw, applies Elo to all 3 rating tables, upserts both players' stats, marks room completed |
| `pair_trivia_queue()` | 083 | SECURITY DEFINER | Atomic matchmaker: picks oldest waiting opponent, creates room + sessions, marks queue entries matched |
| `cancel_trivia_queue()` | 083 | SECURITY DEFINER | Cancels caller's waiting queue entry; idempotent |

### `complete_trivia_session` parameters
```
p_session_id        UUID
p_correct_count     INT
p_wrong_count       INT
p_total_xp_earned   INT
p_accuracy          NUMERIC (0.0–1.0)
p_stars             INT (0–3)
p_avg_response_ms   INT
p_duration_seconds  INT
p_xp_breakdown      JSONB
p_best_streak       INT
p_perfect_game      BOOLEAN
p_mode              TEXT
```
Returns: `{ ok: true, stats: {...} }` or `{ ok: false, reason: '...' }`

### `finalize_duel` winner logic
- **Primary:** `correct_count` — higher wins
- **Tiebreak 1:** `avg_response_ms` — lower wins (faster answerer)
- **Tiebreak 2:** if both NULL or equal → draw

---

## 5. XP Scoring System

XP is computed client-side per question and summed into a session total. The `finalize_duel()` RPC trusts the `total_xp_earned` value passed by `complete_trivia_session()`.

### Per-question XP
```
final_xp = floor(base_xp × speed_mult × streak_mult)
```

| Component | Values |
|---|---|
| `base_xp` | Easy: 5, Medium: 10, Hard: 20 |
| `speed_mult` | ≤5s → 1.5×, ≤10s → 1.2×, else → 1.0× |
| `streak_mult` | streak ≥8 → 1.4×, ≥5 → 1.25×, ≥3 → 1.1×, else → 1.0× |

### Session total XP
```
session_xp = sum(final_xp per correct answer)
           × mode_multiplier
           × perfect_game_bonus (if wrong_count = 0)
```

| Mode | Multiplier |
|---|---|
| solo | 1.0× |
| ranked_duel | 1.0× |
| friend_duel | 0.8× |
| party | 0.6× |
| event | 0.5× |

`XP_PERFECT_GAME_BONUS = 1.3×` (applied after mode multiplier when `wrong_count = 0`).

### XP breakdown storage
`trivia_sessions.xp_source_breakdown` (JSONB) and per-answer columns on `trivia_session_answers` (`base_xp`, `speed_multiplier`, `streak_multiplier`, `final_xp_awarded`) store the full audit trail for results screen display and anti-farming review.

---

## 6. Elo Rating System

Only `ranked_duel` affects Elo. All other modes earn XP only.

### Rating tiers
| Tier | Rating range |
|---|---|
| Bronze | < 900 (starting tier) |
| Silver | 900–1099 |
| Gold | 1100–1299 |
| Platinum | 1300–1499 |
| Diamond | 1500–1699 |
| Elite | 1700+ |

Starting rating: **800**. Rating floor: **400**. No season resets on `trivia_player_ratings` or `trivia_sport_ratings`.

### K-factor ladder
| Games played | K |
|---|---|
| < 20 | 40 |
| 20–49 | 30 |
| ≥ 50 | 20 |

### Elo formula (applied by `finalize_duel`)
```
expected1 = 1 / (1 + 10^((rating2 − rating1) / 400))
delta1    = round(K1 × (actual1 − expected1))
delta2    = round(K2 × (actual2 − expected2))
new_r1    = max(400, rating1 + delta1)
new_r2    = max(400, rating2 + delta2)
```
`actual` = 1.0 (win), 0.5 (draw), 0.0 (loss).

`finalize_duel()` applies the same delta to:
1. `trivia_player_ratings` (global)
2. `trivia_sport_ratings` (per sport)
3. `trivia_event_ratings` (per event, only if room has an event tag)

DB helper function: `get_trivia_rating_tier(INT) → TEXT` (migration 078).

---

## 7. Level System

Levels are computed **client-side only** from `trivia_player_stats.xp_total`. Not stored in the DB.

| Level | Title | XP required |
|---|---|---|
| 1 | Rookie | 0 |
| 2 | Fan | 100 |
| 3 | Supporter | 250 |
| 4 | Enthusiast | 500 |
| 5 | Buff | 800 |
| 6 | Analyst | 1200 |
| 7 | Expert | 1700 |
| 8 | Pundit | 2300 |
| 9 | Specialist | 3000 |
| 10 | Mastermind | 3800 |
| 11 | Sage | 4700 |
| 12 | Scholar | 5700 |
| 13 | Veteran | 6800 |
| 14 | Legend | 8000 |
| 15 | Champion | 10000 |

---

## 8. Realtime Channels

| Channel | Table | Event | Consumer |
|---|---|---|---|
| `postgres_changes` | `trivia_duel_queue` | INSERT/UPDATE | Duel lobby: detect match status change |
| `postgres_changes` | `trivia_session_answers` | INSERT | Duel play: live opponent score updates |

Both tables added to `supabase_realtime` publication in migration 084. The `tsa_select_duel_room_participant` RLS policy (migration 084) scopes answer visibility to participants of the same room.

---

## 9. Question Bank — Approval States

Questions flow through an approval pipeline before reaching the public pool:

```
manual / user submission
  → pending
  → playable_private   (owner can play; quality signals accumulate)
  → approved_public    (visible in all public games)
  
AI-generated
  → playable_private   (quality tested in private games)
  → promotion_eligible → approved_public

rejected / auto_suppressed
  → removed from all pools
```

`pair_trivia_queue()` requires `approval_state = 'approved_public'` and a minimum pool of 10 questions per sport before creating a room.

---

## 10. UI Screens

All screens live in [`trivia.html`](../trivia.html), toggled by `goScreen(id)`. No page reload.

| Screen ID | Purpose |
|---|---|
| `screen-hub` | Main hub: player stats card, mode selection (Solo/Duel), recent games, performance panel, next game suggestion |
| `screen-setup` (inline in hub) | Sport chips + difficulty selector + round count picker |
| `screen-solo` | Solo play: question card, answer buttons, timer ring, streak indicator |
| `screen-duel-lobby` | Ranked Duel: waiting for match, polling `pair_trivia_queue()` every 2s, opponent details on match |
| `screen-duel-play` | Duel play: same question card UI as solo, opponent score panel with real-time updates |
| `screen-party-lobby` | Coming soon placeholder — redirects with toast |
| `screen-party-play` | Legacy screen (placeholder data — not wired) |
| `screen-results` | Session results: score, stars, XP breakdown, rating delta (for duel), level-up animation |

### Hub stats panel
Populated by `loadHubStats()` on page load:
- `trivia_player_stats` — XP total, games, accuracy
- `trivia_sessions` (last 7) — recent game list, performance spark chart, suggested next difficulty

### Sport selector
Six chips with `data-sport` attributes mapping directly to DB sport keys: `soccer`, `nfl`, `nba`, `mma`, `tennis`, `f1`. `selectedTopic` stores the raw DB key (no translation layer needed).

### Difficulty selector
Three options: `easy`, `medium`, `hard`. `mixed` is used internally for ranked duel (DB value) but is not a user-selectable option in the current UI.

---

## 11. pg_cron Jobs (Trivia)

| Job name | Schedule | Action |
|---|---|---|
| `trivia-expire-duel-queue` | Every minute | Marks `waiting` queue entries `expired` where `expires_at < NOW()` |
| `trivia-reset-xp-weekly` | Monday 00:00 UTC | Resets `xp_this_week = 0` on all `trivia_player_stats` rows |

Both scheduled in migration 082.

---

## 12. Key Files

| File | Role |
|---|---|
| [`trivia.html`](../trivia.html) | All UI screens, game logic, Supabase calls, Realtime subscriptions |
| [`trivia-config.js`](../trivia-config.js) | Central config: timers, round counts, XP multipliers, win conditions (loaded before trivia.html) |
| [`leaderboard.html`](../leaderboard.html) | Trivia leaderboard tab — `trivia_player_ratings` global + per-sport via `trivia_sport_ratings` |
| `backend/migrations/076_trivia_questions_sets.sql` | Question bank tables |
| `backend/migrations/077_trivia_sessions_stats.sql` | Sessions, answers, player stats + `upsert_trivia_player_stats_after_session` |
| `backend/migrations/077a_complete_trivia_session_rpc.sql` | `complete_trivia_session` RPC (v1) |
| `backend/migrations/078_trivia_ratings.sql` | Rating tables + `get_trivia_rating_tier()` helper |
| `backend/migrations/079_trivia_rooms_duel.sql` | Rooms, queue, `finalize_duel`, updated `complete_trivia_session` |
| `backend/migrations/080_trivia_events.sql` | Event tables (`trivia_events`, `trivia_event_participants`) |
| `backend/migrations/081_trivia_ai_credits.sql` | AI credit wallet + transaction + generation log tables |
| `backend/migrations/082_trivia_daily_cron.sql` | Daily challenges, completions, pg_cron jobs |
| `backend/migrations/083_pair_trivia_queue.sql` | `pair_trivia_queue()` + `cancel_trivia_queue()` RPCs |
| `backend/migrations/084_realtime_policies.sql` | Realtime publication + `tsa_select_duel_room_participant` RLS policy |

---

## 13. Migration Map

| Migration | Summary |
|---|---|
| 076 | `trivia_questions`, `trivia_question_sets`, `set_updated_at()` trigger |
| 077 | `trivia_sessions`, `trivia_session_answers`, `trivia_player_stats`, `upsert_trivia_player_stats_after_session()` |
| 077a | `complete_trivia_session()` RPC v1 |
| 078 | `trivia_player_ratings`, `trivia_sport_ratings`, `trivia_event_ratings`, `get_trivia_rating_tier()` |
| 079 | `trivia_rooms`, `trivia_duel_queue`, `finalize_duel()`, updated `complete_trivia_session()` (ranked skip) |
| 080 | `trivia_events`, `trivia_event_participants` |
| 081 | `trivia_ai_credit_wallets`, `trivia_ai_credit_transactions`, `trivia_ai_generation_logs` |
| 082 | `trivia_daily_challenges`, `trivia_daily_completions`, pg_cron: expire queue + reset weekly XP |
| 083 | `pair_trivia_queue()`, `cancel_trivia_queue()` |
| 084 | Realtime publication for `trivia_duel_queue` + `trivia_session_answers`; `tsa_select_duel_room_participant` RLS |
