# Arena Session System

**Status:** Production ✅  
**Migrations:** 033, 034, 035, 036, 037, 038, 039 — all applied  
**Edge Functions:** `resolve-questions`, `generate-questions`, `live-stats-poller` — all deployed  

---

## 1. Overview

Arena Sessions are short-lived competitive multiplayer game sessions (1v1 or 2v2) that are completely separate from leagues. A session is created when a matchmaking lobby fills, players answer live questions together, and the session completes automatically when all questions resolve.

**Key distinction:** `leagues` = persistent long-term competition. `arena_sessions` = ephemeral live game. They must never be mixed. Questions, answers, and scoring are isolated per session.

---

## 2. Tables

### `arena_sessions`
One row per lobby game.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Session identifier |
| `lobby_id` | UUID → match_lobbies | Source lobby |
| `match_id` | TEXT | API-Sports fixture ID |
| `half_scope` | TEXT | `full_match \| first_half \| second_half` |
| `mode` | TEXT | `1v1 \| 2v2` |
| `status` | TEXT | `waiting → active → completed \| cancelled` |
| `home/away_team_name` | TEXT | |
| `kickoff_at` | TIMESTAMPTZ | |
| `api_league_id` | INT | |
| `winner_user_id` | UUID | NULL = draw (1v1) |
| `winning_team_number` | INT | NULL = draw (2v2) |
| `is_spectatable` | BOOLEAN | DEFAULT false — opt-in spectator mode |
| `started_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | |

### `arena_session_players`
Per-player state within a session.

| Column | Type | Notes |
|---|---|---|
| `session_id` | UUID → arena_sessions | |
| `user_id` | UUID → auth.users | |
| `team_number` | INT | 1 or 2 (2v2 only) |
| `score` | INT | Updated atomically by `increment_arena_player_score()` |
| `correct_answers` | INT | |
| `total_answers` | INT | |
| `arena_rating_before/after/delta` | INT | ELO snapshot columns |
| `joined_at` | TIMESTAMPTZ | |

### `questions` / `player_answers` dual-path
Both tables accept either `league_id` OR `arena_session_id` — a CHECK constraint enforces exactly one is set.

---

## 3. Session Lifecycle

```
match_lobbies (waiting) → fills to capacity
  → createArenaSession() in multiplayer.html
    → INSERT arena_sessions (status='waiting')
    → INSERT arena_session_players (all lobby members)
    → UPDATE match_lobbies.arena_session_id
    → redirect all players → arena-session.html?id=<sessionId>

arena-session.html loads
  → sets session status = 'active' on first player join
  → starts Realtime subscriptions (3 channels)
  → live-stats-poller triggers generate-questions?live_only=1
  → questions INSERT with arena_session_id (no league_id)

players answer questions → player_answers INSERT with arena_session_id

resolve-questions runs hourly
  → resolves/voids questions with arena_session_id
  → after each terminal transition → maybeCompleteArenaSession()

complete_arena_session() RPC fires
  → when 0 pending questions remain
  → marks arena_sessions.status = 'completed'
  → writes winner_user_id / winning_team_number

Realtime subscription (arena_sessions table) fires
  → showCompleteOverlay() called on all connected clients
  → award_xp() + update_arena_ratings() called in Promise.all
```

---

## 4. Session Completion Trigger

### `complete_arena_session(p_session_id UUID)` — migration 039

SECURITY DEFINER RPC. The single authoritative write path for marking a session completed.

**Four guards (in order):**
1. Session must exist
2. Session must have `status = 'active'` (idempotent: already completed/cancelled → return existing winner fields)
3. At least 1 question must exist for this session
4. 0 questions with `resolution_status = 'pending'` may remain

**Winner logic:**
- `1v1` — compare `arena_session_players.score`; highest wins; tie = draw (both winner fields NULL)
- `2v2` — sum score by `team_number`; highest team wins; tie = draw

**Returns JSONB:**
```json
{ "completed": true, "winner_user_id": "...", "winning_team_number": null, "total_questions": 5 }
{ "completed": false, "reason": "questions_still_pending", "pending_count": 2 }
{ "completed": false, "reason": "no_questions" }
{ "completed": false, "reason": "already_done", "winner_user_id": "..." }
```

### `maybeCompleteArenaSession(sb, sessionId)` — resolve-questions/index.ts

Fire-and-forget TypeScript helper. Wraps the RPC call with structured logging. Called after every terminal question transition in the resolver.

**Called after:** resolve path + all post-arena-guard void paths:
- `resolution_deadline_passed`
- `player_status_no_historical_data`
- `no_match_id`
- Dead match statuses (`PST`, `CANC`, `ABD`, `SUSP`)
- `unresolvable`
- `invalid_predicate` (pre-try-catch)

**NOT called after:**
- `arena_session_status_lookup_failed` — session lookup failed; RPC would error
- `arena_session_not_active` — session already inactive; RPC guard handles safely

**Log events:**
```
[arena-complete] completed — session=<id> winner_user_id=<id|draw> winning_team=<n|n/a> total_questions=5
[arena-complete] pending — session=<id> pending=2 total=5
[arena-complete] no_questions — session=<id>
[arena-complete] skipped — session=<id> reason=already_done
```

### Client-side fallback — arena-session.html

When `loadQuestions()` renders and `!hasActive && sessionData.status === 'active'`:
1. Shows holding card ("Next moment dropping soon")
2. Fires `complete_arena_session()` RPC as fire-and-forget

If the RPC completes the session, the Realtime subscription fires `showCompleteOverlay()` for all clients. `showCompleteOverlay()` is **never** called directly from the fallback path — Realtime is the sole overlay trigger.

---

## 5. Live Question Generation

The `generate-questions` Edge Function has a dedicated arena session generation loop that runs when invoked with `?live_only=1`.

**Trigger:** `live-stats-poller` fires `generate-questions?live_only=1` after each fixture upsert (fire-and-forget).

**Loop behaviour:**
- Fetches all `arena_sessions WHERE status='active'`
- Cross-references `live_match_stats` — skips sessions whose match isn't live
- Safety checks: HT skip, ≥89 min reject, 3-question active cap, 3-min rate limit (time-driven; event-driven bypasses)
- Inserts questions with `arena_session_id` only — no `league_id`
- `question_type = 'CORE_MATCH_LIVE'`, `source_badge = 'LIVE'`

---

## 6. Answer Submission

`player_answers` for arena sessions are submitted with `arena_session_id` (no `league_id`). RLS enforces two paths:

- **PATH A** — league member (standard league flow)
- **PATH B** — arena session participant (arena flow)

Both paths enforce:
- One answer per user per question (`UNIQUE (question_id, user_id)`)
- Answer window must be open (`answer_closes_at > now()`)

---

## 7. Scoring

Same formula as league questions: `base_value × time_pressure × difficulty × streak × comeback × clutch`

Arena-specific additions:
- `clutch_context` JSONB on questions includes `session_scope` (half_scope value)
- `increment_arena_player_score(p_session_id, p_user_id, p_points)` RPC (migration 037) — atomically updates `arena_session_players.score` and `correct_answers` after each correct answer is scored

---

## 8. XP Awards — migration 035

Called in `showCompleteOverlay()` via `award_xp()` RPC:

| Result | XP | `event_type` |
|---|---|---|
| Win | 50 | `arena_win` |
| Draw | 25 | `arena_draw` |
| Loss | 15 | `arena_loss` |

Idempotent via `source_id = sessionId`. Spectators skip XP.

---

## 9. Arena ELO Rating — migration 036

`update_arena_ratings(p_session_id UUID)` RPC called in `Promise.all` with `award_xp()`.

- K-factor tiers: K=32 (<10 games), K=24 (10–29), K=20 (≥30)
- 2v2: team average rating used
- Rating floor: 500
- Repeat-opponent rolling-24h penalty: ×0.5 before clamp (minimum ±1)
- Idempotent: `arena_rating_before IS NOT NULL` guard

9 visual tiers: Rookie (≥500), Bronze (≥800), Silver (≥1100), Gold (≥1400), Platinum (≥1700), Diamond (≥1900), Master (≥2200), Grandmaster (≥2600), Legend (≥3000)

---

## 10. Spectator Mode — migration 038

`arena_sessions.is_spectatable BOOLEAN NOT NULL DEFAULT false` — opt-in, fail-closed.

**Private (default):** non-participants see a static "Private Session" locked screen.  
**Public:** `isSpectator = true`, purple banner shown. Answer buttons disabled (triple-layered: JS guard, no click binding, DB RLS blocks insert). Correct answer hidden until question resolves. Completion overlay shows score + correct count only — skips XP, ratings, and question review.

---

## 11. RPCs Summary

| RPC | Migration | Purpose |
|---|---|---|
| `complete_arena_session(p_session_id)` | 039 | Mark session completed, determine winner |
| `increment_arena_player_score(session_id, user_id, points)` | 037 | Atomic scoreboard update |
| `update_arena_ratings(p_session_id)` | 036 | ELO recalculation post-session |
| `award_xp(user_id, amount, event_type, source_type, source_id)` | 035 | XP award with idempotency |

All RPCs: `GRANT EXECUTE TO authenticated, service_role`.

---

## 12. Realtime Channels (arena-session.html)

| Channel | Table | Filter | Action |
|---|---|---|---|
| Session status | `arena_sessions` | `id=eq.{sessionId}` | `completed`/`cancelled` → `showCompleteOverlay()` |
| Questions | `questions` | `arena_session_id=eq.{sessionId}` | New question → `loadQuestions()` |
| Scoreboard | `arena_session_players` | `session_id=eq.{sessionId}` | Score change → `loadPlayers()` → `renderScoreboard()` |

---

## 13. Key Files

| File | Purpose |
|---|---|
| `arena-session.html` | Live gameplay page — questions, answers, scoreboard, completion overlay, history drawer |
| `multiplayer.html` | Matchmaking lobby → `createArenaSession()` |
| `supabase/functions/resolve-questions/index.ts` | Resolver — `maybeCompleteArenaSession()` hook on all void paths |
| `supabase/functions/generate-questions/index.ts` | Arena live generation loop (`?live_only=1`) |
| `backend/migrations/033_arena_sessions.sql` | Core tables: `arena_sessions`, `arena_session_players` |
| `backend/migrations/034_match_lobbies_arena_session_id.sql` | FK from lobby → session |
| `backend/migrations/035_xp_system.sql` | `award_xp()` RPC |
| `backend/migrations/036_arena_elo.sql` | `update_arena_ratings()` RPC |
| `backend/migrations/037_arena_score_increment.sql` | `increment_arena_player_score()` RPC |
| `backend/migrations/038_arena_spectator.sql` | `is_spectatable` column |
| `backend/migrations/039_complete_arena_session.sql` | `complete_arena_session()` RPC |
