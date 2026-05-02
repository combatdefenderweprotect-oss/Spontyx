# Battle Royale Session System — Implementation Plan

Last updated: 2026-05-01 — Phase 1 migrations 040–047 written. Cron migration 048 written. `spontix-store.js` updated. Edge Function changes + deployment pending.

---

## Status

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Security guardrails + architecture design | ✅ Complete |
| Phase 1 | Foundation infrastructure (schema, RPCs, resolver, pool generation) | 🔄 In progress |
| Phase 2 | Client gameplay page (`br-session.html`) | 🔲 Not started |
| Phase 3 | BR ratings, leaderboard, profile integration | 🔲 Not started |

---

## Architecture Decisions (locked)

These decisions are final. Do not re-open without a documented reason.

### Session model
- Sessions are **question-count based**, not clock-based. Classic BR = 4 questions. Ranked BR = 5 questions.
- One active question at a time. Flow: appear → answer → resolve → HP damage → elimination check → streak update → next question.
- `current_question_seq` is the single source of truth for UI routing. The UI shows only the question matching this sequence number.

### Question source
- BR questions are generated from live match data, identical pipeline to `CORE_MATCH_LIVE`.
- Question type: `BR_MATCH_LIVE` (new value in `questions.question_type` CHECK constraint).
- Questions are stored in a shared `br_match_pool_questions` table per match. Multiple sessions share one pool; each session reads independently.
- Pool expiry: `kickoff + 130 minutes` (covers full match including extra time).

### Timing model
- All questions receive all three timestamps at instantiation: `visible_from`, `answer_closes_at`, `resolves_after`. The invariant that all timestamps are always populated is maintained.
- Timestamps are pre-computed via `minuteToTimestamp(kickoff, minute)`.
- **No clamping of `visible_from` to now().** Stale questions (answer window already closed at instantiation time) are skipped by the activation guard in `advance_br_session_round()`. The instantiation guard ensures at least 2 valid questions exist before the session goes active.

### `correct_answer` nullability
- `questions.correct_answer` is nullable for BR questions. Drop the NOT NULL constraint (Option A).
- Correctness is determined post-hoc via predicate evaluation. The resolver writes `is_correct` to `player_answers`. `correct_answer` on the questions row is never read for BR resolution.
- Any UI displaying `correct_answer` must handle NULL. BR questions never appear in league or arena feeds, so this is unreachable from existing UI.

### HP survival model
- All players start at 100 HP. Cap: 150 HP. Floor: 0 HP (eliminated).
- Standard wrong answer / no answer: −15 HP (configurable via `br_wrong_damage` on question row).
- Standard correct answer: 0 HP reward (standard questions have `br_correct_reward = 0`).
- Streak bonuses applied after damage and elimination, to surviving players only: 2 correct in a row → +5 HP; 3+ correct → +10 HP. Both clamped at 150.
- No-answer is treated as wrong answer. HP damage is applied regardless of whether the player submitted.

### Risk/Bonus mechanics
- Schema columns included in Phase 1: `br_question_type`, `br_wrong_damage`, `br_correct_reward`.
- Phase 1 pool generation produces only `br_question_type = 'standard'` questions.
- `advance_br_session_round()` already reads `br_wrong_damage` and applies it — standard weighted damage works immediately.
- Risk/Bonus activation in a future phase requires only a pool generation configuration change. No RPC modification needed.
- Bonus uniqueness: partial unique index `UNIQUE (pool_id) WHERE br_question_type = 'bonus'` — at most 1 bonus question per pool. Included in Phase 1 schema even though Bonus questions will not be generated yet.

### Placement ranking priority
1. Alive vs eliminated
2. Remaining HP (higher is better)
3. Correct answer count (higher is better)
4. Average response time in ms (lower is better)
5. `hp_at_elimination` captures the exact HP value at elimination (may be negative). Used for tie-breaking among eliminated players from the same round.

### Eliminated players
- All players eliminated in the same round receive the same provisional placement.
- If all players are eliminated in the same round, `finalize_br_session()` is called immediately. Placements are assigned by elimination round + `hp_at_elimination`.
- If the session runs all questions without full elimination, surviving players are ranked by HP → correct answers → avg response time.

### Late join
- Hard DB-level enforcement via Postgres trigger on `br_session_players`.
- Trigger rejects INSERT if `br_sessions.status != 'waiting'` for the target session.
- No application-level bypass possible.

### Stuck session detection
- Stuck condition (both must be true): `last_processed_seq < current_question_seq` AND current question's `resolves_after < now() - 10 minutes`.
- Normal post-round state is `last_processed_seq = N`, `current_question_seq = N+1`. This does NOT satisfy the stuck condition.
- Only sessions where the current round has not been processed despite being 10+ minutes overdue are terminated.
- Stuck sessions are cancelled via `finalize_br_session()` with cancellation reason logged.

### Cron schedule
- A 1-minute BR-only cron (`resolve-questions?br_only=1`) is required. Without it, up to 60 minutes of dead time exists between rounds on the hourly cron.
- The regular hourly resolver also processes BR questions (safety net). Double-processing is safe due to the `last_processed_seq` idempotency guard in `advance_br_session_round()`.

### BR rating
- Separate from `arena_rating`. Stored in `users.br_rating` (DEFAULT 500, floor 0).
- Placement-weighted ELO: `actualScore = (lobbySize - placement) / (lobbySize - 1)`, `expectedScore = 1 / (1 + 10^((avgOpponentsRating - playerRating) / 400))`, `eloChange = K × (actualScore - expectedScore)`.
- K-factor: 32 (< 10 games), 24 (10–29 games), 20 (≥ 30 games).
- Delta clamped ±18. Rating floor 0.
- Only Ranked BR sessions affect `br_rating`. Classic BR does not.
- `update_br_ratings()` RPC is a Phase 3 deliverable.

### Security status of existing `br-elo.js`
- `br-elo.js` is CLIENT-TRUSTED. Placement is reported from the browser — any player can manipulate their JS state.
- Acceptable uses: visual display only, prototype demos, development testing.
- Never use for competitive prizes, rare trophies, paid rewards, or any integrity-sensitive ranked feature.
- `br-elo.js` will remain in the codebase as the display layer. Do not remove it. Do not change its logic.
- The new server-authoritative `br_rating` system (Phase 3) is the correct ranking mechanism.

---

## Phase 1 — Foundation Infrastructure

**Scope:** Full foundational infrastructure. A BR session can be created, instantiated, run through all rounds via the resolver, and finalized with placement rankings. No client gameplay page in Phase 1. Phase 2 adds `br-session.html`. Phase 3 adds `update_br_ratings()` and leaderboard integration.

---

### Migrations

Run in the Supabase SQL editor in order. Migration 046 is independent and can run at any point. Migration 047 must run after the resolver Edge Function is deployed.

- [x] **Migration 040 — `br_match_pools`** ✅ Written
  - File: `backend/migrations/040_br_match_pools.sql`

- [x] **Migration 041 — `br_match_pool_questions`** ✅ Written
  - File: `backend/migrations/041_br_match_pool_questions.sql`

- [x] **Migration 042 — `br_sessions`** ✅ Written
  - File: `backend/migrations/042_br_sessions.sql`

- [x] **Migration 043 — `br_session_players`** ✅ Written — includes late-join trigger `enforce_br_late_join()`
  - File: `backend/migrations/043_br_session_players.sql`

- [x] **Migration 044 — `questions` table alterations** ✅ Written
  - `correct_answer` made nullable. `br_session_id` FK added. Three-way exclusivity CHECK added.
  - File: `backend/migrations/044_br_questions_alterations.sql`

- [x] **Migration 045 — `player_answers` RLS PATH C** ✅ Written
  - `br_session_id` column + index added to `player_answers`. `pa_insert_self` and `pa_select_member` extended.
  - File: `backend/migrations/045_br_player_answers_rls.sql`

- [x] **Migration 046 — `users` table additions** ✅ Written
  - `br_rating` (DEFAULT 1000), `br_games_played`, `br_rating_updated_at` on `users`. Snapshot columns on `br_session_players`.
  - ⚠️ NOTE: DEFAULT is 1000 (not 500 as listed in the constants table below — 1000 matches `arena_rating` start convention; floor is 0).
  - File: `backend/migrations/046_br_users_columns.sql`

- [x] **Migration 047 — BR RPCs** ✅ Written
  - `instantiate_br_session()`, `advance_br_session_round()`, `finalize_br_session()` SECURITY DEFINER functions.
  - ⚠️ NOTE: The original plan reserved 047 for the cron job. The RPCs file took this slot; cron moved to 048.
  - File: `backend/migrations/047_br_rpcs.sql`

- [x] **Migration 048 — 1-minute BR cron job** ✅ Written *(run after resolver deploy)*
  - `cron.schedule('br-resolve-every-minute', '* * * * *', ...)` — hits `resolve-questions?br_only=1`.
  - Replace `<<YOUR_CRON_SECRET>>` before running.
  - File: `backend/migrations/048_br_cron.sql`

---

### Postgres RPCs (SECURITY DEFINER)

Write these as part of the migrations or as standalone SQL. Run before Phase 1 smoke test.

- [ ] **`instantiate_br_session(p_session_id, p_match_id, p_half_scope, p_mode)`**
  - Reads matching pool (`status = 'ready'`, correct `half_scope`, not stale).
  - Validates minimum 2 pool questions have valid future answer windows (`MIN_ANSWER_WINDOW_SECONDS = 60` remaining at call time).
  - Fails with cancellation reason `insufficient_pool_questions` if fewer than 2 valid questions.
  - For each valid pool question, inserts a row into `questions` with all three timestamps pre-computed, `br_session_id = p_session_id`, `question_type = 'BR_MATCH_LIVE'`, `resolution_status = 'pending'`, `correct_answer = NULL`.
  - Sets `br_sessions.status = 'active'`, `current_question_seq = 1`, `last_processed_seq = 0`.

- [ ] **`advance_br_session_round(p_session_id, p_question_seq, p_is_voided DEFAULT false)`**
  - **Idempotency guard:** if `last_processed_seq >= p_question_seq`, return immediately (no-op).
  - If `p_is_voided = true`: skip HP calculations, advance `current_question_seq` to next question, update `last_processed_seq`, return.
  - Otherwise: read all `player_answers` for this question + session. For each non-eliminated player: apply `br_wrong_damage` (wrong or no answer) or `br_correct_reward` (correct); clamp HP at 150.
  - Mark players with HP ≤ 0 as eliminated: set `is_eliminated = true`, `hp_at_elimination` (exact value, may be negative), `eliminated_at_seq`.
  - Apply streak bonuses to surviving players after all damage: update `current_streak` per player; 2 in a row → +5 HP; 3+ → +10 HP; clamp at 150.
  - If all players eliminated OR max sequence reached: call `finalize_br_session()`.
  - Otherwise: advance `current_question_seq` to next unvoided question; update `last_processed_seq = p_question_seq`.

- [ ] **`finalize_br_session(p_session_id)`** *(internal — called by `advance_br_session_round()`)*
  - Assigns final placements: surviving players ranked by HP desc → correct answers desc → `avg_response_ms` asc. Eliminated players retain provisional placements from their elimination round; ties broken by `hp_at_elimination` desc.
  - Writes `game_history` rows for all players (placement, correct answers, session type, source_session_id).
  - Sets `br_sessions.status = 'completed'`, `completed_at = now()`.

---

### Edge Function changes

- [ ] **`supabase/functions/resolve-questions/index.ts`**
  - Add `br_only` URL param: when set to `'1'`, filter the questions SELECT to `br_session_id IS NOT NULL` only. The regular cron does not pass this param and processes all question types as before.
  - Add `br_session_id`, `br_question_seq`, `br_question_type` to the questions SELECT.
  - Add `question_text`, `resolution_condition` to SELECT (already present from REAL_WORLD addition — verify).
  - After `markCorrectAnswers()`: if `q.br_session_id` is set, call `advance_br_session_round(q.br_session_id, q.br_question_seq)`.
  - If `evaluatePredicate()` returns `unresolvable` past grace period for a BR question: call `advance_br_session_round(q.br_session_id, q.br_question_seq, p_is_voided = true)` instead of standard void.
  - Add stuck session watchdog query at start of each run:
    - Find sessions where `last_processed_seq < current_question_seq` AND current question's `resolves_after < now() - 10 minutes`.
    - For each: log stuck session, call `finalize_br_session()` with cancellation status, increment a `stuck_sessions_terminated` counter in the run stats.

- [ ] **`supabase/functions/generate-questions/lib/predicate-validator.ts`**
  - Add `'BR_MATCH_LIVE'` to the `validTypes` array.
  - In `checkLiveTiming()`: treat `BR_MATCH_LIVE` identically to `CORE_MATCH_LIVE` for timing validation.
  - In `checkEntities()`: when `question_type = 'BR_MATCH_LIVE'` and predicate type is `player_stat`, apply the same exemption as `REAL_WORLD` player_stat (player may not be in the injury list).

- [ ] **`supabase/functions/generate-questions/lib/types.ts`**
  - Add `BrPoolQuestion` interface: all fields from `br_match_pool_questions`.
  - Extend `GenerationMode` union to include `'br_pool'` for logging purposes.
  - No new predicate interfaces needed — BR uses existing `match_stat_window`, `btts`, `match_stat`, etc.

- [ ] **`supabase/functions/generate-questions/index.ts`**
  - Add BR pool generation pass after the REAL_WORLD pass (before `finaliseRun()`).
  - Pass logic: find active BR sessions (`status = 'active'`) whose associated match has live stats. For each session without a `pool_id`, or whose pool is stale: generate questions using the same live context builder and OpenAI calls as `CORE_MATCH_LIVE`. Write results to `br_match_pool_questions` (not `questions`). Mark pool `status = 'ready'`.
  - Pool generation produces only `br_question_type = 'standard'` rows in Phase 1.
  - Skip sessions whose match is not live or whose kickoff is past pool expiry (`kickoff + 130 minutes`).
  - Log prefix: `[br-pool]`.

---

### `spontix-store.js` changes

- [ ] Add `br_rating`, `br_games_played`, `br_rating_updated_at` to `_mapUserFromDb()`.

---

### Deployment order

- [ ] Run migrations 040–045 in Supabase SQL editor in order
- [ ] Run migration 046 (`users` columns) — can be done in parallel with 040–045
- [ ] Deploy updated `generate-questions` Edge Function (BR pool pass + validator addition)
- [ ] **Smoke test:** confirm `br_match_pool_questions` rows are written for at least one active match
- [ ] Deploy updated `resolve-questions` Edge Function (BR dispatch block + stuck session watchdog)
- [ ] **Smoke test:** manually insert a `br_sessions` row, call `instantiate_br_session()`, confirm `questions` rows exist with all three timestamps and `correct_answer = NULL`
- [ ] Run migration 047 (1-minute cron) — only after resolver deploy is verified
- [ ] **End-to-end test:** a BR session runs through all rounds and reaches `status = 'completed'` with valid placements in `br_session_players`

---

### Risk controls

**Risk 1 — Questions CHECK constraint breaks existing rows**
The three-way CHECK is additive. All existing rows satisfy it. Before running Migration 044: `SELECT COUNT(*) FROM questions WHERE league_id IS NULL AND arena_session_id IS NULL` — must return 0. Only then proceed.

**Risk 2 — `correct_answer DROP NOT NULL` breaks existing callers**
Before running Migration 044: grep all files for `correct_answer`. Audit each callsite. The resolver never reads `correct_answer` for resolution logic. League and arena feeds never show BR questions. If any callsite is ambiguous, add explicit `WHERE br_session_id IS NULL` filter before proceeding.

**Risk 3 — Regular hourly resolver double-processes BR rounds**
The hourly resolver will also process BR questions and call `advance_br_session_round()`. The idempotency guard (`last_processed_seq >= p_question_seq` → immediate return) makes the double-call a no-op. No data integrity risk.

**Risk 4 — BR pool generation pass interferes with existing generation**
The BR pool pass runs after all existing passes and writes exclusively to `br_match_pool_questions`. It does not write to `questions`, does not modify `generation_runs` or `generation_run_leagues`. Complete isolation.

**Risk 5 — `BR_MATCH_LIVE` validator addition affects existing questions**
`validTypes` gains one entry. No existing entry is modified. All existing `CORE_MATCH_LIVE` and `CORE_MATCH_PREMATCH` questions validate identically. The `BR_MATCH_LIVE` path is only reachable from the BR pool generation pass.

**Risk 6 — PATH C RLS creates unintended `player_answers` permissions**
PATH C applies only when `br_session_id IS NOT NULL`. It cannot overlap with PATH A (league) or PATH B (arena). After Migration 045: attempt an insert as an eliminated player — must be rejected at the DB level before deploying any application code.

**Risk 7 — Stuck session watchdog terminates healthy sessions**
Corrected condition requires `last_processed_seq < current_question_seq` AND `resolves_after < now() - 10 minutes`. A session in normal inter-round wait satisfies neither. A session within 10 minutes of resolver lag satisfies only the second. Only sessions stalled 10+ minutes past resolution are terminated.

**Risk 8 — Migration 044 table-lock duration**
Create the `br_session_id` index `CONCURRENTLY` before adding the FK constraint. Run during off-peak hours. At current data volumes on the free tier, each ALTER operation completes in under 5 seconds. Monitor the Supabase dashboard for lock wait times.

---

## Phase 2 — Client gameplay page (future)

To be planned after Phase 1 is verified end-to-end.

Scope will include:
- `br-session.html` — full gameplay page, Realtime subscriptions for `br_sessions`, `br_session_players`, `questions`, `player_answers`
- HP bar display, elimination animations, streak indicator, comeback indicator
- Question feed restricted to `current_question_seq`
- `multiplayer.html` routing: lobby full → `createArenaSession()` already handles 1v1/2v2; BR will need a parallel `createBrSession()` call

---

## Phase 3 — BR ratings and leaderboard (future)

To be planned after Phase 2 is verified.

Scope will include:
- `update_br_ratings(p_session_id)` SECURITY DEFINER RPC — placement-weighted ELO
- `br_ratings_before/after/delta` snapshot columns on `br_session_players`
- BR leaderboard tab in `leaderboard.html`
- BR tier display on `profile.html` and `dashboard.html`
- `br-leaderboard.html` history tab update to show server-authoritative results

---

## Key constants (Phase 1 defaults)

| Constant | Value | Location |
|---|---|---|
| `MIN_SESSION_QUESTIONS` | 2 | `instantiate_br_session()` |
| `MIN_ANSWER_WINDOW_SECONDS` | 60 | `instantiate_br_session()` |
| `POOL_EXPIRY_MINUTES_AFTER_KICKOFF` | 130 | `br_match_pools.expires_at` |
| Standard wrong damage | −15 | `br_match_pool_questions.br_wrong_damage` default |
| Standard correct reward | 0 | `br_match_pool_questions.br_correct_reward` default |
| HP start | 100 | `br_session_players.hp` default |
| HP cap | 150 | `advance_br_session_round()` clamp |
| Streak 2-correct bonus | +5 HP | `advance_br_session_round()` |
| Streak 3+ bonus | +10 HP | `advance_br_session_round()` |
| Stuck session grace | 10 minutes | Stuck session watchdog |
| Classic BR questions | 4 | Session configuration |
| Ranked BR questions | 5 | Session configuration |
| BR rating floor | 500 | `users.br_rating` DEFAULT |
| BR ELO clamp | ±18 | `update_br_ratings()` — Phase 3 |
| BR K-factor (<10 games) | 32 | `update_br_ratings()` — Phase 3 |
| BR K-factor (10–29 games) | 24 | `update_br_ratings()` — Phase 3 |
| BR K-factor (≥30 games) | 20 | `update_br_ratings()` — Phase 3 |
