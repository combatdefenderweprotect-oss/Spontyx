# League Creation Flow — Canonical Specification

**Last updated: 2026-05-04**
**Status: Implementation shipped. Verified in production.** Migration 051 applied. Edge function `generate-questions` redeployed. All four league types (Path A multi-comp, Path A single-comp, Path B, Match Night, Custom) confirmed creating and persisting correctly. The Completion Evaluator (§ League Completion Evaluation) is documented but **not yet built** — see [`LEAGUE_COMPLETION_EVALUATOR_TODO.md`](LEAGUE_COMPLETION_EVALUATOR_TODO.md).

This document is the single source of truth for the three league types Spontix supports at creation time. Any change to league creation behaviour, Step 1 copy, fixture loading, or league lifecycle must be reflected here first.

When this doc and the code disagree, **this doc wins** — fix the code.

---

## The three league types

Step 1 of `create-league.html` presents exactly three type cards. They are not variants of one system. They have different lifecycles, different fixture sources, different validation rules, and different generation behaviour.

| Type | Scope | Fixture source | Lifecycle | Tier |
|---|---|---|---|---|
| **Season-Long League** | A team's full remaining season OR a competition's full remaining season | Auto-loaded from `api_football_fixtures`, past matches excluded | Ends when the underlying fixture source is genuinely exhausted (see lifecycle rules) | Elite only |
| **Match Night** | One specific fixture | User-picked single fixture (any competition incl. cups) | Ends when that single match resolves | All tiers (subject to `liveQuestionsEnabled` for live mode) |
| **Custom League** | Anything that isn't Season-Long or Match Night | Creator-defined: custom date range, hand-picked fixtures, special rules | Ends on creator-defined end date | All tiers |

Manual fixture picking is a **Custom League** affordance. Season-Long never permits it. Match Night picks exactly one fixture and is not "manual picking" in the multi-match sense.

---

## Season-Long League — definition

> A structured competition automatically populated with all remaining current-season fixtures for either (A) a chosen team across one or more of its competitions, or (B) a chosen competition in full. Past fixtures are excluded. Fixtures are not manually picked. The league remains active until the underlying fixture source is genuinely exhausted: for Path A, until the team is eliminated from every selected competition or all selected competition seasons have officially concluded; for Path B, until the competition season has officially concluded. A temporary absence of scheduled fixtures (e.g. between knockout rounds) does NOT end the league.

Two creation paths. The user picks one in Step 2.

### Path A — Team-based season league

1. User picks a team (e.g. Barcelona) via a cross-competition team picker.
2. System detects every competition where the team has remaining current-season participation. This is a union of:
   - Competitions where the team has at least one fixture with `kickoff_at >= now()` in `api_football_fixtures`, AND
   - Knockout competitions where the team is still alive in the bracket but no future fixture has been drawn yet (knockout-patience rule — see lifecycle).
3. User multi-selects one, several, or all of those competitions.
4. League is created. Fixture set = all remaining current-season fixtures for the selected team in the selected competitions.

Examples:
- Barcelona + La Liga
- Barcelona + La Liga + Champions League
- Barcelona + all available competitions

### Path B — Competition-based season league

1. User picks a competition (e.g. La Liga).
2. League is created. Fixture set = all remaining current-season fixtures in that competition.

Examples:
- La Liga full season league = all remaining La Liga fixtures.
- Champions League full season league = all remaining UCL fixtures.

---

## Lifecycle rules (apply to both paths)

### R1 — Past exclusion (hard rule)

Every fixture query for a Season-Long league applies `kickoff_at >= now()`. Past fixtures are never included. This is enforced at:
- Creation time (initial fixture load)
- Generation time (`generate-questions` may not generate prematch questions for fixtures whose kickoff has passed)
- Any UI surface that displays the league's fixture list

### R2 — League Completion Condition (fixture-source-exhaustion)

A Season-Long league ends only when the underlying fixture source is genuinely empty for the rest of the season. The `league_end_date` field is informational only. This rule is referred to throughout the codebase and other docs as the **League Completion Condition (fixture-source-exhaustion)**.

**Path A end condition** — ALL of the selected competitions must satisfy at least one of:
- The team has been eliminated from this competition this season, OR
- This competition's current season has officially concluded.

**Path B end condition** — the selected competition's current season has officially concluded.

A temporary absence of scheduled fixtures does NOT end the league. See R3.

### R3 — Knockout patience (the critical edge case)

For knockout competitions (Champions League, Copa del Rey, FA Cup, World Cup, etc.), there will be periods where the team is still in the tournament but no future fixture is yet scheduled — between rounds, before draws, before qualification is confirmed.

The system **must not** interpret "zero scheduled future fixtures right now" as "competition finished for this team." A correct evaluation requires three signals per (team, competition) pair:

| Signal | Meaning | Source |
|---|---|---|
| `has_future_fixture` | A fixture with `kickoff_at >= now()` exists in `api_football_fixtures` | DB query — already available |
| `team_still_active` | The team has not been eliminated from this competition this season | **Required external signal — see Data Dependencies** |
| `season_ended` | The competition's current season has officially concluded | **Required external signal — see Data Dependencies** |

End for this (team, competition) pair = `(NOT team_still_active) OR season_ended`.

The league ends when ALL selected (team, competition) pairs are in an end state.

**UX rule — zero fixtures with possible active participation:**

If a team has zero scheduled future fixtures in a competition AND we have any signal of possible participation (whether a confirmed `team_still_active` signal OR the conservative `sports_teams`-registration fallback):

- The UI MUST NOT display "0 fixtures" or any other terminal/empty-state message.
- The UI MUST NOT claim with certainty that the team is still active unless a real `team_still_active` signal is available.
- Copy varies by signal source:
  - **With confirmed `team_still_active` signal**: "No fixtures scheduled yet — team still active in competition."
  - **With conservative fallback only (registered in `sports_teams`, no confirmed active signal)**: "No fixtures scheduled yet — competition availability detected. More fixtures may appear if the team progresses or data updates."
- This applies on the league page, the fixtures list, the create-league preview/summary step, and any dashboard widget that surfaces fixture counts for the league.
- The fixture count number should either be hidden or shown alongside the explanatory copy — never standalone.
- Until the `team_still_active` signal exists, all production UI MUST use the fallback copy. See § Data dependencies.

### R4 — Practical end date

`league_end_date` is set at creation time to a best-effort practical end:
- Path A: `max(kickoff_at)` across all loaded fixtures, or the latest known season end across selected competitions, whichever is later.
- Path B: the competition's official season end if known, else `max(kickoff_at)`.

This date is informational only. It must not be used as the authoritative end signal — R2 is authoritative. The date may be re-derived periodically as new fixtures (knockout draws, schedule additions) appear.

### R5 — Mid-season creation

Season-Long leagues created mid-season cover the **remainder of the current season only**. There is no option to start a Season-Long league for the next season. If a user creates a Barcelona league in March, they get the rest of this season — not next August onward.

---

## League Completion Evaluation

Season-Long leagues must be evaluated periodically by a system process. This is the runtime mechanism that enforces R2 (the League Completion Condition).

A league is marked as `completed` when:

**Path A (Team-based)** — ALL selected (team, competition) pairs satisfy at least one of:
- The team is eliminated from this competition this season, OR
- This competition's current season has officially ended.

**Path B (Competition-based)**:
- The selected competition's current season has officially ended.

**Critical rules for the evaluator:**
- Completion MUST NOT be inferred from fixture presence alone. "No upcoming fixtures" is **not** a valid completion signal.
- The evaluator must consult the external `team_still_active` and `season_ended` signals (see § Data dependencies). Without those signals, the evaluator must default to "still active" (permissive fallback) — never auto-complete.
- **Data freshness — defer over premature completion.** Completion evaluation must be based on the latest synchronized snapshot of fixture and competition data. If any of the following is true for a (team, competition) pair, the evaluator MUST defer completion for that league and re-evaluate on the next cycle — never mark `completed`:
  - The fixture sync for the competition is delayed beyond its expected SLA (e.g. last successful API-Sports `/fixtures` poll older than the freshness threshold for that competition).
  - The standings or knockout-bracket sync for the competition is incomplete or stale.
  - The `team_still_active` or `season_ended` signal returned an error, a null/unknown value, or has not been refreshed within its expected window.
  - Any selected competition's data layer is in a known degraded state (sync job failure, API quota exhaustion, rate limit, partial response).
  Deferral is the safe default. A league incorrectly marked `completed` cannot be auto-recovered (completion is one-way, see below); a league that stays open one extra cycle costs nothing.
- Completion is one-way: once a league is marked `completed`, the evaluator does not re-open it.

**Implementation note (documentation only — no code yet):**
- This should be handled by a scheduled process — either an extension of the existing resolver cron, a dedicated `evaluate-season-leagues` Edge Function on its own pg_cron schedule, or a small RPC invoked nightly.
- Suggested cadence: once per hour (cheap query) or once per day (sufficient for season granularity). Final cadence to be decided at implementation time.
- Must be idempotent — re-running over an already-completed league is a no-op.

---

## Match Night — definition

> A league bound to one specific fixture. The creator picks a fixture from any competition (league, cup, friendly), questions are generated for that match, the league resolves when the match completes.

Rules:
- Exactly one fixture, picked by the creator.
- Cup matches are valid Match Night fixtures.
- Lifecycle: ends when that fixture's resolution window passes.
- This is the closed-session "Type 1" pattern in `CLAUDE.md` legacy terminology.

---

## Custom League — definition

> A flexible league that doesn't fit Season-Long or Match Night. The creator may define custom date ranges, hand-pick a set of fixtures, apply special scoring, or restrict to specific opponents.

Rules:
- Manual fixture picking is permitted here and only here.
- Custom date ranges are permitted here and only here.
- Lifecycle: ends on the creator-defined `league_end_date`.
- This is the catch-all bucket for anything that isn't a structured season or a single match.

---

## Comparison matrix

| Concept | Season-Long | Match Night | Custom |
|---|---|---|---|
| Number of fixtures | Many (auto) | 1 | Creator-defined |
| Fixture selection | Auto (team or competition) | User picks 1 | User picks N or defines range |
| Past fixtures | Always excluded | N/A (single fixture) | Creator's choice |
| End condition | League Completion Condition (fixture-source-exhaustion, R2) | Single fixture resolves | Creator-defined date |
| Multi-competition | Path A: yes | No | Creator's choice |
| Knockout-aware | Yes (R3) | No | Creator's choice |
| Tier gate | Elite | All tiers | All tiers |
| Generation pacing | Continuous (Type 2 in legacy terminology) | Closed session (Type 1) | Continuous |

---

## Validation rules

### Season-Long, Path A
- `creation_path = 'team'`
- `scoped_team_id` required, must resolve to a row in `sports_teams`.
- ≥1 competition selected. Each selected competition must satisfy: `has_future_fixture = true` OR `team_still_active = true`. A competition with neither is not selectable.
- Block creation if zero selected competitions are in an active state — message: "This team's season has ended for the selected competitions."

### Season-Long, Path B
- `creation_path = 'competition'`
- Exactly one competition selected.
- No team scope.
- Block creation if `season_ended = true` for the selected competition — message: "This competition's season has ended."

### Match Night
- Exactly one `fixture_id` from `api_football_fixtures`, with `kickoff_at >= now()` (or within a small lookback if the match is currently live).

### Custom
- Either ≥1 manually selected fixture, OR a `(start_date, end_date)` range covering at least one upcoming fixture.

---

## Storage (proposed shape, for implementation phase)

This section is implementation guidance. It is not yet in the schema.

| Column | Type | Purpose |
|---|---|---|
| `creation_path` | `TEXT CHECK IN ('team','competition')` | Distinguishes Path A from Path B for Season-Long leagues. NULL for Match Night and Custom. |
| `api_sports_league_ids` | `INTEGER[]` | Multi-competition support for Path A. Path B writes a single-element array. Match Night/Custom may be NULL or single-element. **This is a temporary structure for launch speed. The long-term preferred solution is a normalized join table (e.g. `league_competitions(league_id, api_sports_league_id)`) which gives clean indexing, easier joins, and per-competition metadata.** Refactor planned post-launch. |
| `api_sports_league_id` | `INTEGER` | **Retained as legacy / convenience for the primary competition.** New code reads `api_sports_league_ids` first; falls back to this. Will be removed in a later refactor. |
| `scoped_team_id` | `UUID` (existing) | Required for Path A. NULL for Path B. |
| `league_end_date` | `DATE` (existing) | Informational only for Season-Long (R4). Authoritative for Custom. |

The `INTEGER[]` array is the launch shape. A normalised `league_competitions` join table is a future refactor; do not block launch on it.

Existing `leagues` rows are treated as legacy (single-competition, no `creation_path`). No backfill is required. New creations use the new shape.

---

## Data dependencies (TODO before full production)

The R3 knockout-patience rule and the League Completion Evaluation process both require two external signals that are **not yet available in our data model**. These must be sourced before Season-Long Path A can correctly handle cup competitions in production.

> **Without these signals, knockout competitions cannot be fully resolved correctly and require fallback behavior.** The launch fallback is permissive (assume "still active" until proven otherwise). The League Completion Evaluator will never auto-complete a Path A league while the fallback is in effect for any of its selected competitions — completion in that case must be triggered manually or wait for the official season end.

### Required: `team_still_active(sport, team_id, competition_id, season)`

A reliable boolean indicating whether a team is still in a knockout competition. Candidate sources:
- API-Sports `/fixtures` filtered by team + competition + season — if the team's most recent fixture in this competition is a loss in the elimination round, mark eliminated.
- API-Sports knockout bracket data — direct lookup of bracket position.
- A periodic sync job that materialises this into a `team_competition_status` table.

Until this signal exists, Path A cup-competition handling has two safe fallbacks:
1. **Conservative `sports_teams`-registration fallback (recommended for launch)**: a competition is treated as "possibly available" for a team if the team has a row in `sports_teams` for that `(api_team_id, api_league_id)`. This proxy is correct for league competitions (registration ≈ participation for the season) and acceptable for cups (registration indicates the team entered the competition). It is NOT a confirmation of current active participation. UI copy MUST reflect this uncertainty: "competition availability detected. More fixtures may appear if the team progresses or data updates." — never "team still active in competition."
2. **Strict fallback**: require an active future fixture for any selectable competition. Excludes cups during draw gaps. Bad UX for knockout fans.

Launch position: ship with the conservative `sports_teams`-registration fallback (option 1). The Completion Evaluator must NOT auto-complete a Path A league while running on this fallback — it can only defer or wait for a manual trigger / official season end signal.

### Required: `season_end_date(sport, competition_id, season)`

A reliable end date per competition per season. Candidate sources:
- A new column on `sports_competitions`: `current_season_end DATE`.
- API-Sports `/leagues` endpoint — returns season start/end metadata.
- Derived: `max(kickoff_at)` across all known fixtures for the season — unreliable for cups whose final fixture isn't scheduled yet.

Until this signal exists, R4's practical end date is derived from `max(kickoff_at)` only.

---

## What this spec explicitly forbids

Season-Long League MUST NEVER mean:
- One match (that's Match Night).
- Manual fixture picking as the primary selection mechanism (that's Custom).
- A user-defined date range (that's Custom).
- A normal Match Night with a longer date range.
- A league that ends because "no fixtures are scheduled right now" while the team is still in a competition (violates R3).

Match Night MUST NEVER mean:
- Multiple fixtures.
- A fixture range.

Custom League MUST NEVER mean:
- An automatic season fixture pull (that's Season-Long).

---

## Cross-references

- `CLAUDE.md` — Two League Types section is being replaced by the three-type model defined here. Type 1 (legacy) ≈ Match Night. Type 2 (legacy) ≈ Season-Long + Custom for generation pacing purposes.
- `docs/GAMEPLAY_ARCHITECTURE.md` — Pillar 1 (Leagues) references this spec as the source of truth for league formats.
- `docs/GAME_ARCHITECTURE_MAP.md` — Leagues node references this spec.
- `create-league.html` — header comment points here.

---

## Change log

- **2026-05-04** — Initial canonical spec written. Path A / Path B defined. R1–R5 lifecycle rules locked. Data dependencies documented. No code changes yet.
- **2026-05-04 (revision 2)** — Added "League Completion Evaluation" section. Renamed R2 to "League Completion Condition (fixture-source-exhaustion)". Annotated `api_sports_league_ids INTEGER[]` as a temporary launch shape with a normalised `league_competitions` join table as the long-term target. Added zero-fixtures UX rule under R3. Clarified data dependency fallback wording. Mirrored gaps update into `GAMEPLAY_ARCHITECTURE.md` Pillar 1 and `GAME_ARCHITECTURE_MAP.md` Pillar 1.
- **2026-05-04 (revision 3)** — Added "Data freshness — defer over premature completion" rule to the League Completion Evaluation section. Evaluator must defer completion when fixture sync, standings sync, or external signals are stale, errored, or in a degraded state — never auto-complete on incomplete data.
- **2026-05-04 (revision 4)** — Tightened zero-fixtures UX copy. The conservative `sports_teams`-registration fallback (used until `team_still_active` signal exists) MUST NOT use certainty language. Production UI copy is "No fixtures scheduled yet — competition availability detected. More fixtures may appear if the team progresses or data updates." The certainty wording "team still active in competition" is reserved for when a real `team_still_active` signal is wired.
- **2026-05-05 (revision 7)** — **`prematch_questions_per_match` shipped.** Migration 053 adds user-controlled per-match question count (1–10, default 5). Exposed as a range slider in create-league Step 3. Written to `leagues.prematch_questions_per_match` at creation. `prematch_question_budget` kept as legacy fallback. Pipeline now counts existing CORE_MATCH_PREMATCH rows per (league_id, match_id) before generating — only the shortfall is produced. Phase D fallback templates fill any remaining gap after AI retries (zero AI quota). Full spec in [docs/QUESTION_SYSTEM.md](QUESTION_SYSTEM.md) "Per-match question count" and "Fallback templates".
- **2026-05-05 (revision 6)** — **Demand-driven pre-match generation shipped.** League creation now fires `ensure-prematch` (a JWT-authenticated edge function wrapper) immediately after the league row is inserted. `league.html` also fires `ensure-prematch` on every page open. The wrapper validates RLS access, debounces (5 min recent-generation check), then invokes `generate-questions` with `{ league_id }`. `generate-questions` accepts an optional POST body to narrow the league fetch and (optionally) the eligible-matches list to a single fixture; the no-body cron path is unchanged. Cron job `generate-questions-every-6h` is preserved unchanged as a backstop. All three league types (Season-Long, Match Night, Custom) flow through the same path — no special branching. Match Night CORE_MATCH_PREMATCH still attaches against `league_id` (no Arena coupling). Idempotency stays delegated to `prematch_question_budget`, pool fingerprint dedup, and the Jaccard near-duplicate filter — no new lock table introduced. Full lane spec moved into [docs/QUESTION_SYSTEM.md](QUESTION_SYSTEM.md) under "CORE_MATCH_PREMATCH triggers (event-driven primary, cron backstop)".
- **2026-05-04 (revision 5)** — **Implementation shipped to production.** Migration 051 applied (creation_path + api_sports_league_ids[] + GIN index + creation_path partial index + trivial backfill into one-element arrays for legacy rows). `generate-questions` edge function redeployed with multi-competition fan-out. `create-league.html` Season-Long fork live (Path A team search + multi-select competition picker + preview; Path B competition picker + preview; auto-derived dates). `spontix-store.js` mapping bidirectional. Two latent bugs caught and fixed during the live smoke test: (1) Path A team-search results were unclickable due to `JSON.stringify` quotes breaking the `onclick` attribute — fixed via `&quot;` encoding helper; (2) Custom League insert failed with Postgres `23502` because `ai_weekly_quota`/`ai_total_quota` are NOT NULL but the launch payload sent `null` when AI questions were toggled off — fixed by sending `0` (column default). Production-data verification: Path A multi-comp persists `[140, 2]`; Path A single-comp persists `[140]`; Path B persists `[140]` with creation_path='competition'; Match Night persists `[140]` with creation_path=null; Season-Long rows show ai_total_quota=300 (B1 fix verified). Conservative `sports_teams`-registration fallback active in production. Completion evaluator NOT shipped — see TODO doc.
