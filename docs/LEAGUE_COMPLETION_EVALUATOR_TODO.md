# League Completion Evaluator — TODO

**Status: NOT IMPLEMENTED.** This file is the implementation backlog for the Season-Long League Completion Evaluator described in [`LEAGUE_CREATION_FLOW.md`](LEAGUE_CREATION_FLOW.md) § League Completion Evaluation.

The evaluator is intentionally NOT in the launch sprint because the required external signals (`team_still_active`, `season_end_date`) do not yet exist in our data model. Shipping a partial evaluator risks premature completion of active leagues — the canonical spec explicitly forbids "no upcoming fixtures" as a completion signal.

This doc captures everything needed to build it later without re-deriving the spec.

---

## What it must do

A scheduled process that periodically evaluates Season-Long leagues and marks them `status = 'completed'` when — and only when — the spec's completion conditions are met.

### Path A (team-based) completion

For every selected `(team, competition)` pair, the league completes only when ALL pairs satisfy at least one of:
- `team_still_active = false` (team eliminated from this competition this season), OR
- `season_ended = true` (this competition's current season has officially concluded).

### Path B (competition-based) completion

The league completes only when `season_ended = true` for the selected competition.

### Hard rules (from spec)

- **Never** infer completion from fixture presence alone. "No upcoming fixtures" is NOT a valid completion signal.
- **Defer over premature completion.** If any input signal is stale, errored, missing, or in a degraded state, the evaluator MUST defer (re-evaluate next cycle) and leave the league `active`. See spec § Data freshness.
- **Completion is one-way.** Once marked `completed`, the evaluator must not re-open the league.
- **Idempotent.** Re-running over an already-completed league is a no-op.

---

## Required external signals (data dependencies)

Both signals are NOT YET AVAILABLE. Until they are, the evaluator can be partially built but MUST NOT auto-complete any Path A league.

### Signal 1 — `team_still_active(sport, team_id, competition_id, season) → boolean | null`

Reliable indicator that a team is still in a knockout competition.

**Candidate sources:**
- API-Sports `/fixtures` filtered by team + competition + season — if the team's most recent fixture is a loss in the elimination round, mark eliminated. Brittle for byes, draws, partial data.
- API-Sports knockout bracket data — direct lookup of bracket position. More authoritative but coverage varies by competition.
- A periodic sync job that materialises this into a new `team_competition_status(sport, team_id, competition_id, season, status, last_synced_at)` table. Status enum: `'active' | 'eliminated' | 'unknown'`. Recommended approach.

**Returns `null` when unknown.** The evaluator MUST treat `null` as "defer" — never as "active" or "eliminated" for the purposes of completing a league.

### Signal 2 — `season_end_date(sport, competition_id, season) → date | null`

End date per competition per season.

**Candidate sources:**
- Add `current_season_end DATE` column to `sports_competitions`. Populated from API-Sports `/leagues` endpoint metadata via a daily sync.
- Derived: `max(kickoff_at)` across all known fixtures for the season — unreliable for cups whose final isn't scheduled yet. Use only as a last-resort fallback.

**Returns `null` when unknown.** The evaluator MUST defer rather than infer.

---

## Known limitations (launch fallback)

For launch we ship with the conservative `sports_teams`-registration fallback documented in the spec § Data dependencies. This means:

- **Path A competition selection** treats a team as "possibly available" in a competition if the team has a row in `sports_teams` for that `(api_team_id, api_league_id)`. This is registration ≠ confirmed active participation.
- **Production UI copy reflects the uncertainty**: "No fixtures scheduled yet — competition availability detected. More fixtures may appear if the team progresses or data updates." Never "team still active in competition" until the real signal exists.
- **The Completion Evaluator MUST NOT auto-complete a Path A league while running on this fallback.** Any league using the fallback for any of its selected competitions is permanently "defer" until a real `team_still_active` signal lands.
- The `sports_teams` table may be sparse for cup competitions if the seed/sync job hasn't populated cup teams. Path A's competition list will under-detect cup participation in that case. Sync coverage is a separate task tracked outside this doc.

These limitations are acceptable for launch because:
1. False early-end is the worst failure mode (permanently breaks user trust). False late-end is recoverable (manual admin closure if needed).
2. Path B (competition-based) is unaffected — `season_end_date` from `sports_competitions` (once added) is the only signal needed and is much easier to source.
3. Most launch users will create competition-based leagues; team-based knockout edge cases are a smaller share.

---

## Implementation outline (when ready)

### Schema additions (proposed)

- New table `team_competition_status(sport, api_team_id, api_league_id, season, status, last_synced_at)` — primary key `(sport, api_team_id, api_league_id, season)`. Status: `'active' | 'eliminated' | 'unknown'`.
- New column `sports_competitions.current_season_end DATE` — nullable, populated by a daily sync.
- Optional: new column `leagues.last_completion_check_at TIMESTAMPTZ` — debugging aid showing when the evaluator last ran for this league.

### Evaluator function

`evaluate_league_completion(league_id UUID) RETURNS JSONB` (SECURITY DEFINER RPC, or as logic inside an Edge Function).

Pseudocode:

```
function evaluate(league):
  if league.status != 'active': return { skipped: true, reason: 'not_active' }
  if league.creation_path is null: return { skipped: true, reason: 'not_season_long' }   # legacy / Custom / Match Night

  comp_ids = league.api_sports_league_ids ?? [league.api_sports_league_id]
  if not comp_ids: return { deferred: true, reason: 'no_competitions' }

  # Freshness check — if ANY data layer for ANY selected comp is stale/error → defer.
  for comp_id in comp_ids:
    if fixture_sync_stale(league.sport, comp_id): return { deferred: true, reason: 'fixture_sync_stale' }
    if standings_sync_stale(league.sport, comp_id): return { deferred: true, reason: 'standings_sync_stale' }

  if league.creation_path == 'team':
    team_id = league.scoped_team_id
    all_done = true
    for comp_id in comp_ids:
      active = team_still_active(league.sport, team_id, comp_id, current_season)
      season_end = season_end_date(league.sport, comp_id, current_season)
      if active is null or season_end is null:
        return { deferred: true, reason: 'unknown_signal', comp_id }
      ended = (active == false) or (season_end < today)
      if not ended: all_done = false; break
    if all_done:
      mark_completed(league)
      return { completed: true }
    return { deferred: true, reason: 'still_active' }

  if league.creation_path == 'competition':
    comp_id = comp_ids[0]
    season_end = season_end_date(league.sport, comp_id, current_season)
    if season_end is null: return { deferred: true, reason: 'unknown_season_end' }
    if season_end < today:
      mark_completed(league)
      return { completed: true }
    return { deferred: true, reason: 'season_in_progress' }
```

### Schedule

- Suggested cadence: once per hour (cheap query) or once per day (sufficient for season granularity). Final cadence at implementation time.
- Could ride on an existing pg_cron job or be its own dedicated cron (recommended for clear logging).
- Each invocation must log: total leagues evaluated, completed count, deferred count, deferred reasons distribution.

### Idempotency

- Wrap the `mark_completed(league)` write in a `WHERE status = 'active'` clause so re-running over an already-completed league is a no-op.
- Never re-open a `completed` league regardless of subsequent signal changes.

### Manual override

- Admin should have a way to manually mark a league `completed` if signals never arrive (e.g. data source permanently unavailable). Out of scope for this doc — design when the evaluator ships.

---

## Files that will need to change when this is built

- `backend/migrations/052+` — `team_competition_status` table, `sports_competitions.current_season_end` column.
- New sync job — populates `team_competition_status` from API-Sports.
- New Edge Function `evaluate-season-leagues/` — or a new RPC + pg_cron entry.
- `docs/LEAGUE_CREATION_FLOW.md` — flip the "Without these signals…" callouts once both are wired.
- This file — update status from "NOT IMPLEMENTED" to "Implemented in migration NNN".

---

## What is implemented today (launch)

Nothing on the evaluator side. Specifically:

- ❌ No scheduled job evaluates Season-Long leagues for completion.
- ❌ No `team_still_active` signal.
- ❌ No `season_end_date` signal.
- ✅ `creation_path` and `api_sports_league_ids[]` are persisted on `leagues` (migration 051) so the evaluator has the inputs it needs once built.
- ✅ `league_end_date` is auto-derived as `max(kickoff_at)` of loaded fixtures at creation time. Per spec § R4 this is informational only — NOT a completion signal.

A Season-Long league created today remains `status = 'active'` indefinitely until the evaluator ships or an admin manually completes it.
