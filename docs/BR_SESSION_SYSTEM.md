# Battle Royale Session System

Last updated: 2026-05-06 — v2 fully deployed. Segment-based survival, live pipeline questions, pairwise ELO. Migrations 040–075 applied. Edge Functions redeployed. Esports card lobby live.

---

## Product Definition

**Survival model:**
- One shared lobby per session, multiple players, sequential questions
- Every player must answer every question
- Wrong answer or no answer (timeout) → HP loss — silence is not safe
- HP = 0 → eliminated; placement assigned in elimination order
- Session ends when the match segment ends (HT for first_half, FT for second_half) via the resolver cron — not by question count

**Modes:**
- `mode` column — gameplay format: `ffa`, `1v1`, `2v2` (ffa is the standard BR format)
- `rating_mode` column — ELO gate: `classic` (no rating impact) or `ranked` (pairwise ELO applied at session end)

These are independent. A player can play `ffa` classic or `ffa` ranked.

**Player count:**
- Minimum 4 players with placements for ELO to apply (enforced in `update_br_ratings`)
- Target 8–12 players. No hardcoded upper limit in DB; `BR_MAX_PLAYERS = 12` enforced client-side only (Phase 4 will move this server-side)

**What BR is NOT:** not Arena, not a match format, not a configurable duel. Arena UI patterns (format cards, duel framing, player-count pickers) are forbidden in BR pages.

---

## Architecture — Deployed State

### Session lifecycle

```
waiting  →  active  →  completed
                   ↘  cancelled
```

- **waiting** — players join via `br-lobby.html`. Session has `segment_scope`, `rating_mode`, `match_id`.
- **active** — `instantiate_br_session()` fires when the match segment starts (via `runBrLifecycle()` in resolver). Questions start flowing from `generate-questions`.
- **completed** — `finalize_br_session()` fires when the segment ends. Placements written. ELO applied if ranked + ≥4 players.
- **cancelled** — `finalize_br_session()` can cancel stuck sessions.

### Question source (v2 — no pool)

Questions are generated directly into the `questions` table by the `generate-questions` Edge Function BR pass. There is no pre-generated pool. `br_match_pools` and `br_match_pool_questions` tables are dormant (schema preserved, not used).

- `question_type = 'BR_MATCH_LIVE'`
- `br_session_id` FK on the `questions` row binds the question to the session
- Generator runs every 6 hours (cron) + every 1 minute (br-resolve-every-minute triggers generation indirectly via resolver)
- **Predicate allowlist (v1):** only `match_stat_window` with `field IN ('goals', 'cards')` — all other predicates are rejected at generation time
- **Segment window validation:** first_half questions must have `window_end ≤ 45`; second_half questions must have `window_start ≥ 46 AND window_end ≤ 90` — no cross-boundary questions

### Segment model

`br_sessions.segment_scope` defines when the session runs:

| Value | Segment | Ends when |
|---|---|---|
| `first_half` | H1 (0'–45') | Match status reaches `HT`, `2H`, `FT`, `AET`, `PEN`, `FT_PEN`, `ABD` |
| `second_half` | H2 (45'–90') | Match status reaches `FT`, `AET`, `PEN`, `FT_PEN`, `ABD` |
| `period_1/2/3` | Hockey periods | Future — adapter not yet active |
| `quarter_1/2/3/4` | Basketball quarters | Future |
| `set_1–5` | Tennis sets | Future |

Football v1 uses `first_half` and `second_half` only.

### Late-join enforcement

Hard DB-level via `enforce_br_late_join()` trigger on `br_session_players`. Rejects INSERT if `br_sessions.status != 'waiting'`. No application-level bypass possible.

---

## DB Schema — Key Columns

### `br_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `match_id` | BIGINT | FK → api_football_fixtures |
| `status` | TEXT | `waiting / active / completed / cancelled` |
| `mode` | TEXT | `ffa / 1v1 / 2v2` — gameplay format |
| `rating_mode` | TEXT | `classic / ranked` — ELO gate |
| `segment_scope` | TEXT | `first_half / second_half / …` |
| `segment_ends_at` | TIMESTAMPTZ | Written by `instantiate_br_session`; kickoff + segment end minute |
| `pool_id` | BIGINT | Nullable — dormant in v2 |
| `current_question_seq` | INT | Monotonically increasing; UI routes on this |
| `last_processed_seq` | INT | Idempotency guard for `advance_br_session_round` |
| `winner_user_id` | UUID | Written by `finalize_br_session` |
| `started_at / completed_at` | TIMESTAMPTZ | |

### `br_session_players`

| Column | Type | Notes |
|---|---|---|
| `session_id / user_id` | UUID | Composite PK |
| `hp` | INT | Start 100, cap 150, floor 0 |
| `is_eliminated` | BOOLEAN | |
| `eliminated_at` | TIMESTAMPTZ | |
| `current_streak` | INT | Correct answer streak |
| `placement` | INT | Final rank |
| `hp_at_elimination` | INT | Exact HP at elimination (may be negative) |
| `eliminated_at_seq` | INT | Which round they were eliminated |
| `avg_response_ms` | INT | Average answer time — tie-breaker |
| `correct_answer_count` | INT | Correct answers total — tie-breaker |
| `br_rating_before / after / delta` | INT | ELO snapshot; written by `update_br_ratings` |

---

## RPCs (SECURITY DEFINER)

### `instantiate_br_session(p_session_id UUID)`

- Called by `runBrLifecycle()` when match segment starts
- Transitions `status = 'active'`, sets `current_question_seq = 1`, `last_processed_seq = 0`
- Computes and writes `segment_ends_at` (kickoff + 45 or 90 minutes)
- No `p_pool_id` or `p_total_questions` — v2 is pool-free

### `advance_br_session_round(p_session_id UUID, p_question_seq INTEGER, p_is_voided BOOLEAN DEFAULT false)`

- **Idempotency guard:** `last_processed_seq >= p_question_seq` → immediate return (no-op)
- If voided: advance `current_question_seq`, update `last_processed_seq`, skip HP
- Otherwise: applies `V1_WRONG_DAMAGE = −15` for wrong/no answer; `br_correct_reward = 0` for correct
- Marks HP ≤ 0 players as eliminated; writes `hp_at_elimination`, `eliminated_at_seq`
- Applies streak bonuses to survivors: 2-correct → +5 HP; 3+ → +10 HP; clamped at 150
- Writes `correct_answer_count` and `avg_response_ms` per player
- If ≤1 survivor: calls `finalize_br_session()`
- Otherwise: advances `current_question_seq`, updates `last_processed_seq`

### `finalize_br_session(p_session_id UUID)`

- **Idempotency guard:** `status IN ('completed', 'cancelled')` → return `already_finalized`
- Ranks survivors: HP desc → correct_answer_count desc → avg_response_ms asc → current_streak desc
- Writes `placement` to all `br_session_players` rows
- Sets `winner_user_id`, `status = 'completed'`, `completed_at = now()` on session
- Calls `update_br_ratings(p_session_id)` when `rating_mode = 'ranked'`

### `update_br_ratings(p_session_id UUID)`

- Restricted to `service_role` only — `REVOKE EXECUTE FROM authenticated`
- **Ranked gate:** returns `{skipped: true, reason: 'not_ranked'}` if `rating_mode != 'ranked'`
- **Minimum players gate:** requires ≥4 players with placements; returns `{skipped: true, reason: 'insufficient_players'}` otherwise
- **Idempotency guard:** `br_rating_before IS NOT NULL` on any row → returns `already_processed`
- **Algorithm:** pairwise ELO — each player compared vs every other participant
  - Expected: `1 / (1 + 10^((opp_rating - own_rating) / 400))`
  - Actual: 1 (win), 0.5 (tie placement), 0 (loss)
  - Delta pair: `K × (actual − expected)`
  - Total delta: sum across all opponents, normalised by `(N−1)`
  - Rounded, then clamped `±18`
  - Rating floor: 800
- **K-factor:** `< 10 games → 40`, `< 30 games → 30`, `≥ 30 games → 20`
- Writes `br_rating_before/after/delta` on `br_session_players`
- Updates `users.br_rating`, `br_games_played`, `br_rating_updated_at`

---

## Resolver Integration — `runBrLifecycle()`

Called by `resolve-questions` Edge Function when invoked with `?br_only=1` (1-minute cron job 9).

**Lock phase** — fires `instantiate_br_session` when conditions are met:
- `segment_scope = 'first_half'` AND match status = `'1H'` → instantiate
- `segment_scope = 'second_half'` AND match status = `'2H'` → instantiate

**Segment-end phase** — fires `finalize_br_session` when:
- `first_half` session AND match status in `['HT', '2H', 'FT', 'AET', 'PEN', 'FT_PEN', 'ABD']`
- `second_half` session AND match status in `['FT', 'AET', 'PEN', 'FT_PEN', 'ABD']`

The regular hourly resolver also processes BR questions as a safety net. Double-processing is safe due to `last_processed_seq` idempotency guard.

---

## Generator Integration

**BR pass** in `generate-questions/index.ts` (after REAL_WORLD pass):

1. Finds `active` BR sessions whose match has live stats
2. Checks late-minute cutoff: skips when `matchMinute >= 43` (H1) or `>= 87` (H2)
3. Skips sessions with `segment_scope = 'first_half'` when match is in HT or later
4. Builds same `LiveContext` as `CORE_MATCH_LIVE`
5. Generates question via OpenAI (same prompts)
6. Applies predicate allowlist: rejects if not `match_stat_window` with `field IN ('goals', 'cards')`
7. Applies segment window validation: H1 requires `window_end ≤ 45`; H2 requires `window_start ≥ 46 AND window_end ≤ 90`
8. Clutch threshold: `matchMinute >= 35` (H1) or `>= 80` (H2)
9. Writes directly to `questions` table with `br_session_id`, `question_type = 'BR_MATCH_LIVE'`

Log prefix: `[br-gen]`

---

## HP Model

| Event | HP change |
|---|---|
| Wrong answer | −15 |
| No answer (timeout) | −15 (same as wrong) |
| Correct answer | 0 (standard questions) |
| Streak 2 correct | +5 (surviving players only, after damage) |
| Streak 3+ correct | +10 (surviving players only, after damage) |

HP start: 100. HP cap: 150. HP floor: 0 (eliminated).

---

## Placement Ranking Priority

1. Alive vs eliminated (alive ranks higher)
2. HP remaining (higher is better)
3. `correct_answer_count` (higher is better)
4. `avg_response_ms` (lower is better)
5. `current_streak` (higher is better)

Eliminated players tie-break by `hp_at_elimination` desc then `eliminated_at_seq` asc.

---

## Migrations Applied

| Migration | Description |
|---|---|
| 040 | `br_match_pools` table (dormant in v2) |
| 041 | `br_match_pool_questions` table (dormant in v2) |
| 042 | `br_sessions` table — base schema |
| 043 | `br_session_players` + late-join trigger |
| 044 | `questions` alterations: `correct_answer` nullable, `br_session_id` FK |
| 045 | `player_answers` RLS PATH C for BR |
| 046 | `users.br_rating`, `br_games_played`, `br_rating_updated_at`; snapshot columns on `br_session_players` |
| 047 | BR RPCs v1 (superseded by 072) |
| 048 | 1-minute BR cron (`br-resolve-every-minute`) |
| 069 | `half_scope` → `segment_scope`; `pool_id` nullable; `rating_mode` added; `full_match` dropped from CHECK |
| 070 | Pool tables: `half_scope` → `segment_scope` (schema consistency) |
| 071 | `br_session_players`: `hp_at_elimination`, `eliminated_at_seq`, `avg_response_ms`, `correct_answer_count` |
| 072 | RPCs v2: pool-free `instantiate_br_session`, segment-aware `advance_br_session_round`, updated `finalize_br_session` |
| 073 | `update_br_ratings` v2: pairwise ELO, K=40/30/20, clamp ±18, floor 800, rated gate, min-player gate |
| 074 | Dropped stale `instantiate_br_session(uuid, bigint, integer)` v1 overload |
| 075 | `join_br_session(UUID)` + `leave_br_session(UUID)` SECURITY DEFINER RPCs — replace client-side inserts blocked by RLS |

---

## Join / Leave RPCs (migration 075)

Client calls `sb.rpc('join_br_session', { p_session_id })` — never inserts into `br_session_players` directly.

| RPC | Behaviour |
|---|---|
| `join_br_session(UUID)` | Checks `status = 'waiting'`, inserts caller into `br_session_players` (`ON CONFLICT DO NOTHING`). Returns `{ok, reason?}`. |
| `leave_br_session(UUID)` | Deletes caller's row. No-op if not present. Called on `pagehide` via `fetch keepalive`. |

Both are SECURITY DEFINER — bypasses the RLS WITH CHECK that blocked direct client inserts.

---

## Lobby Size Enforcement (Production TODO — Phase 4)

Client-side constants only (`BR_MIN_PLAYERS=4`, `BR_MAX_PLAYERS=12`). Server-side enforcement deferred:

- `instantiate_br_session` should reject when player count < min
- `join_br_session` should gate on max players (currently no cap check)
- `update_br_ratings` min-player check (already enforced at ≥4) is the safety net for now

---

## Key Constants

| Constant | Value | Location |
|---|---|---|
| Standard wrong damage | −15 | `advance_br_session_round` `V1_WRONG_DAMAGE` |
| Standard correct reward | 0 | `br_correct_reward` column default |
| HP start | 100 | `br_session_players.hp` default |
| HP cap | 150 | `advance_br_session_round` clamp |
| Streak 2-correct bonus | +5 HP | `advance_br_session_round` |
| Streak 3+ bonus | +10 HP | `advance_br_session_round` |
| BR rating floor | 800 | `update_br_ratings` `RATING_FLOOR` |
| ELO clamp | ±18 | `update_br_ratings` `DELTA_CLAMP_MAX` |
| K-factor (<10 games) | 40 | `update_br_ratings` |
| K-factor (<30 games) | 30 | `update_br_ratings` |
| K-factor (≥30 games) | 20 | `update_br_ratings` |
| Min players for ELO | 4 | `update_br_ratings` `MIN_PLAYERS_RANKED` |
| H1 late-minute cutoff | 43 | `generate-questions` BR pass |
| H2 late-minute cutoff | 87 | `generate-questions` BR pass |
| H1 clutch threshold | 35' | `generate-questions` BR pass |
| H2 clutch threshold | 80' | `generate-questions` BR pass |
