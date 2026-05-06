# League Completion Evaluator — Status & Backlog

**Last updated: 2026-05-06**

**Status: PHASE 2b LIVE (Path B — competition-based only).** Path A (team-based) not yet implemented.

This doc tracks implementation status and the remaining backlog for the Season-Long League Completion Evaluator described in [`LEAGUE_CREATION_FLOW.md`](LEAGUE_CREATION_FLOW.md) § League Completion Evaluation.

---

## What it must do

A scheduled process that periodically evaluates Season-Long leagues and marks them `lifecycle_status = 'completed'` when — and only when — the spec's completion conditions are met.

### Path A (team-based) completion — NOT YET IMPLEMENTED

For every selected `(team, competition)` pair, the league completes only when ALL pairs satisfy at least one of:
- `team_still_active = false` (team eliminated from this competition this season), OR
- `season_ended = true` (this competition's current season has officially concluded).

### Path B (competition-based) completion — LIVE (Phase 2b)

The league completes only when:
1. All `league_fixtures` rows for the league are in a terminal status (FT/AET/PEN/CANC/ABD/AWD/WO). PST (postponed) is not terminal.
2. `sports_competitions.current_season_end` is present, synced within 48h, and <= today.
3. No pending questions remain for the league.

### Hard rules (from spec)

- **Never** infer completion from fixture presence alone. "No upcoming fixtures" is NOT a valid completion signal.
- **Defer over premature completion.** If any input signal is stale, errored, missing, or in a degraded state, the evaluator MUST defer (re-evaluate next cycle). See spec § Data freshness.
- **Completion is one-way.** Once marked `completed`, the evaluator must not re-open the league.
- **Idempotent.** Re-running over an already-completed league is a no-op (`.neq('lifecycle_status','completed')` guard on all writes).

---

## External signals — implementation status

### Signal 1 — `team_still_active` → `team_competition_status` table — ❌ NOT YET POPULATED

**Schema:** `team_competition_status(sport, api_team_id, api_league_id, season, status, last_synced_at)` — migration 062 applied. Table exists but is empty. No sync job yet.

**Status enum:** `active | eliminated | unknown`. Evaluator treats `NULL` (no row) and `'unknown'` identically: DEFER.

**Needed for:** Path A evaluator (Phase 2c). Path B does not use this signal.

**Remaining work:** build `sync-team-status` Edge Function that queries API-Sports per (team, competition, season) and writes status rows. Schedule daily.

### Signal 2 — `season_end_date` → `sports_competitions.current_season_end` — ✅ LIVE

**Schema:** `current_season_end DATE`, `season_end_synced_at TIMESTAMPTZ` — migration 061 applied.

**Populated by:** `sync-fixtures?type=season_meta` — calls API-Sports `/leagues` for each competition in `ACTIVE_LEAGUES` (currently PL=39, La Liga=140). Runs daily at 03:00 UTC (cron job 10).

**Current values (seeded 2026-05-06):**
- Premier League (39): `2026-05-24`
- La Liga (140): `2026-05-24`

**Evaluator freshness check:** defers if `season_end_synced_at` is older than 48h.

**Limitation:** only competitions in `ACTIVE_LEAGUES` array are synced. Other competitions (UCL, UEL, etc.) will have `NULL` → evaluator defers for those leagues.

---

## Known limitations

- **Path A (team-based) evaluator not yet built.** Team-based Season Long leagues remain at `lifecycle_status='active'` indefinitely until Phase 2c ships or an admin manually completes them.
- **`team_competition_status` table is empty.** Nothing writes to it yet — `sync-team-status` job not built.
- **`season_meta` only covers ACTIVE_LEAGUES (PL + La Liga).** Leagues built on UCL, UEL, Bundesliga, etc. will have `current_season_end = NULL` → evaluator defers for those.
- **PST (postponed) fixtures block completion.** A permanently postponed fixture with no reschedule will hold the league open indefinitely. Admin override path not yet built.
- **No admin manual-completion UI.** If signals never arrive, admin must run a direct SQL update. Out of scope for Phase 2b.

---

## What is implemented (2026-05-06)

### Phase 2a — Schema + sync foundations ✅

| Item | Migration | Status |
|---|---|---|
| `leagues.lifecycle_status` (`active`/`awaiting_fixtures`/`pending_resolution`/`completed`/`archived`) | 060 | ✅ Live |
| `leagues.last_completion_check_at`, `completion_deferred_reason` | 060 | ✅ Live |
| `sports_competitions.current_season_end`, `season_end_synced_at` | 061 | ✅ Live, seeded for PL + La Liga |
| `team_competition_status` table | 062 | ✅ Exists, empty |
| `league_fixtures.fixture_status`, `finished_at` | 063 | ✅ Live, populated by sync |
| `sync-fixtures?type=season_meta` | — | ✅ Deployed, cron job 10 at 03:00 UTC |
| `syncLive` → `propagateFixtureStatus()` | — | ✅ Live — updates `league_fixtures` per fixture after every live upsert |
| `syncDaily` → `bulkPropagateTerminalStatuses()` | — | ✅ Live — daily catch-up |

### Phase 2b — Competition-based evaluator ✅

**Edge Function:** `supabase/functions/evaluate-season-leagues/index.ts`

**Deployed:** 2026-05-06, `--no-verify-jwt`

**Cron:** job 11, daily at 04:00 UTC (runs after season_meta at 03:00 UTC)

**Scope:** `league_type='season_long'` + `creation_path='competition'` only. Path A explicitly skipped.

**Decision tree (per league):**
1. All `league_fixtures.fixture_status` terminal? (FT/AET/PEN/CANC/ABD/AWD/WO) — PST is NOT terminal → defer `fixtures_not_complete`
2. `current_season_end` present + synced ≤ 48h? → defer `season_end_unknown` / `season_end_data_stale`
3. `current_season_end <= today`? → defer `season_end_future`
4. No pending questions? → defer `pending_questions:N`
5. Finalize → `lifecycle_status='completed'`

**Finalization:** sums `player_answers.points_earned` per league member from resolved questions. RANK() with tie sharing. Writes `final_points`/`final_rank` to `league_members`. Writes `completed_at`, `winner_user_id`, `lifecycle_status='completed'` to `leagues`.

**Idempotency:** `.neq('lifecycle_status','completed')` guard on every write.

**Dry run:** `?dry_run=1` — all reads execute, zero writes.

**Verified:** dry run returned `{ evaluated: 0, message: 'no eligible leagues' }` — correct (no season_long competition leagues exist yet in prod).

## Remaining backlog

### Phase 2c — Path A (team-based) evaluator

**Blocked on:** `sync-team-status` job that populates `team_competition_status`.

**Required work:**
1. Build `sync-team-status` Edge Function — queries API-Sports per (team, competition, season), writes `team_competition_status` rows. Recommended daily schedule.
2. Add Path A branch to `evaluate-season-leagues` — loops over all selected competitions, checks `team_competition_status.status` for each, defers on `unknown` or stale.
3. Extend `season_meta` sync to cover all competitions in `api_sports_league_ids` arrays across active leagues (not just `ACTIVE_LEAGUES` constant).

### Phase 2d — Edge case handling

- **PST fixture that never reschedules:** admin override SQL, or auto-void after configurable timeout.
- **Admin manual-completion UI:** direct `lifecycle_status` override for stuck leagues.
- **14-day drain timeout:** flag leagues stuck in `pending_resolution` for admin review.
- **Expand `ACTIVE_LEAGUES` season_meta coverage** to UCL, UEL, Bundesliga, Serie A, Ligue 1.

---

## Files changed

| File | Change |
|---|---|
| `backend/migrations/060–063` | Schema additions (lifecycle_status, season_end, team_competition_status, fixture_status) |
| `supabase/functions/sync-fixtures/index.ts` | `season_meta` mode + `propagateFixtureStatus` + `bulkPropagateTerminalStatuses` |
| `supabase/functions/evaluate-season-leagues/index.ts` | New — Phase 2b evaluator |
| `docs/LEAGUE_CREATION_FLOW.md` | Implementation note updated |
| This file | Status updated from NOT IMPLEMENTED → Phase 2b live |
