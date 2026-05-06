# League Creation Flow — Canonical Specification

**Last updated: 2026-05-06**
**Status: Implementation shipped. Verified in production.** Migrations 051–063 applied. All Edge Functions deployed. All four league types (Path A multi-comp, Path A single-comp, Path B, Match Night, Custom) confirmed creating and persisting correctly. Completion Evaluator Phase 2b live for Path B (competition-based) leagues — see [`LEAGUE_COMPLETION_EVALUATOR_TODO.md`](LEAGUE_COMPLETION_EVALUATOR_TODO.md). Path A evaluator pending `sync-team-status` job (Phase 2c).

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

**Implementation status (2026-05-06):**
- **Path B (competition-based): LIVE.** `evaluate-season-leagues` Edge Function deployed. Runs daily at 04:00 UTC (pg_cron job 11). Decision tree: all `league_fixtures` terminal → `current_season_end` past → no pending questions → finalize. Idempotent — `.neq('lifecycle_status','completed')` guard on all writes.
- **Path A (team-based): NOT YET IMPLEMENTED.** Requires `team_competition_status` sync job. Path A leagues stay `lifecycle_status='active'` until Phase 2c ships.
- State machine uses `leagues.lifecycle_status`: `active → awaiting_fixtures → pending_resolution → completed`. See [`LEAGUE_COMPLETION_EVALUATOR_TODO.md`](LEAGUE_COMPLETION_EVALUATOR_TODO.md) for full backlog.

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

## Data dependencies — implementation status

### Signal 1 — `team_still_active` → `team_competition_status` table — ❌ NOT YET POPULATED

Required for Path A evaluator (Phase 2c). Table exists (migration 062) but is empty. The `sync-team-status` job is not yet built. Path A leagues cannot auto-complete until this signal exists.

Until this signal exists, the Completion Evaluator skips all Path A leagues entirely. UI copy must reflect uncertainty: "competition availability detected. More fixtures may appear if the team progresses or data updates." — never "team still active in competition."

### Signal 2 — `season_end_date` → `sports_competitions.current_season_end` — ✅ LIVE

Migration 061 applied. Populated by `sync-fixtures?type=season_meta` (cron job 10, daily 03:00 UTC). Currently covers Premier League (39) and La Liga (140) only — `ACTIVE_LEAGUES` constant in `sync-fixtures/index.ts`. Other competitions return `NULL` → evaluator defers for those leagues.

Do NOT derive `current_season_end` from `max(kickoff_at)` — unreliable for cups whose final isn't scheduled yet.

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
- **2026-05-06 (revision 10)** — **Migration 056: league_code + Invite step production cleanup.** `league_code TEXT UNIQUE` added to `public.leagues`. 6-char alphanumeric code (charset excludes O/0, I/1). PL/pgSQL backfill assigns codes to all existing leagues with collision retry. Unique constraint + index applied post-backfill. Invite step (Step 4) cleaned: removed placeholder users, social share buttons (WhatsApp/iMessage/Discord), Copy Link button. Kept: League Code display + Copy Code (real clipboard API with `execCommand` fallback). `create-league.html` generates code client-side on Step 3 entry; sends as `league_code` in insert payload; retries up to 10 times on unique_violation. `spontix-store.js` maps `leagueCode` ↔ `league_code` in all three mapping locations. Semantic note: `league_code` is the universal shareable invite code for all leagues; `join_password` (migration 002) remains a separate private-league access gate. Applied in production.
- **2026-05-06 (revision 9)** — **Step 3 Question Types redesign shipped.** "Question Style" (prematch/live/hybrid radio) and "Question Types" (chip grid) removed. Replaced by a single unified **Question Types** multi-select card section shared across all three league types. Four cards: Pre-match (all tiers), Live in-game (Pro+), Real World (Pro+), Custom Questions (Elite+). Quantity sliders (prematch QPM, live QPM, realworld QPW) appear conditionally directly below the cards. "Hybrid" card removed — users select Pre-match + Live individually for the same effect. Pre-Match Question Timing UI removed (timing is pipeline-controlled). `matchNightMode` variable replaced by `selectedQTypes` object. `launchLeague` derives `question_style`, `real_world_enabled`, `real_world_questions_per_week`, `custom_questions_enabled` from card state. No migration (uses migration 055 columns).
- **2026-05-06 (revision 8)** — **Migration 055: universal question configuration.** Four columns added to `leagues`: `question_style` (prematch/live/hybrid), `real_world_enabled` (BOOLEAN default true), `real_world_questions_per_week` (1–3 cap), `custom_questions_enabled`. Generator lane gating wired: prematch lane skips when `question_style='live'`; live lane skips when `question_style='prematch'`; REAL_WORLD lane skips when `real_world_enabled=false` or `question_style='live'`. `checkRealWorldQuota()` accepts user-chosen weekly cap. Applied in production.
- **2026-05-05 (revision 7)** — **`prematch_questions_per_match` shipped.** Migration 053 adds user-controlled per-match question count (1–10, default 5). Exposed as a range slider in create-league Step 3. Written to `leagues.prematch_questions_per_match` at creation. `prematch_question_budget` kept as legacy fallback. Pipeline now counts existing CORE_MATCH_PREMATCH rows per (league_id, match_id) before generating — only the shortfall is produced. Phase D fallback templates fill any remaining gap after AI retries (zero AI quota). Full spec in [docs/QUESTION_SYSTEM.md](QUESTION_SYSTEM.md) "Per-match question count" and "Fallback templates".
- **2026-05-05 (revision 6)** — **Demand-driven pre-match generation shipped.** League creation now fires `ensure-prematch` (a JWT-authenticated edge function wrapper) immediately after the league row is inserted. `league.html` also fires `ensure-prematch` on every page open. The wrapper validates RLS access, debounces (5 min recent-generation check), then invokes `generate-questions` with `{ league_id }`. `generate-questions` accepts an optional POST body to narrow the league fetch and (optionally) the eligible-matches list to a single fixture; the no-body cron path is unchanged. Cron job `generate-questions-every-6h` is preserved unchanged as a backstop. All three league types (Season-Long, Match Night, Custom) flow through the same path — no special branching. Match Night CORE_MATCH_PREMATCH still attaches against `league_id` (no Arena coupling). Idempotency stays delegated to `prematch_question_budget`, pool fingerprint dedup, and the Jaccard near-duplicate filter — no new lock table introduced. Full lane spec moved into [docs/QUESTION_SYSTEM.md](QUESTION_SYSTEM.md) under "CORE_MATCH_PREMATCH triggers (event-driven primary, cron backstop)".
- **2026-05-04 (revision 5)** — **Implementation shipped to production.** Migration 051 applied (creation_path + api_sports_league_ids[] + GIN index + creation_path partial index + trivial backfill into one-element arrays for legacy rows). `generate-questions` edge function redeployed with multi-competition fan-out. `create-league.html` Season-Long fork live (Path A team search + multi-select competition picker + preview; Path B competition picker + preview; auto-derived dates). `spontix-store.js` mapping bidirectional. Two latent bugs caught and fixed during the live smoke test: (1) Path A team-search results were unclickable due to `JSON.stringify` quotes breaking the `onclick` attribute — fixed via `&quot;` encoding helper; (2) Custom League insert failed with Postgres `23502` because `ai_weekly_quota`/`ai_total_quota` are NOT NULL but the launch payload sent `null` when AI questions were toggled off — fixed by sending `0` (column default). Production-data verification: Path A multi-comp persists `[140, 2]`; Path A single-comp persists `[140]`; Path B persists `[140]` with creation_path='competition'; Match Night persists `[140]` with creation_path=null; Season-Long rows show ai_total_quota=300 (B1 fix verified). Conservative `sports_teams`-registration fallback active in production. Completion evaluator NOT shipped — see TODO doc.
