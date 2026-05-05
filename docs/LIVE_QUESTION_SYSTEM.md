# LIVE Question System

**Status: UI ✅ | Resolver ✅ | Generation ✅ | Quality Filter ✅ Complete**  
Last updated: 2026-05-05 — Sprint 1 cleanup: `MVP_MAX_ACTIVE_LIVE` renamed to `MAX_ACTIVE_LIVE_QUESTIONS`, `sport_not_supported_mvp` renamed to `sport_not_supported`. No logic change. — Previous: Holding states + Moment Feeling Layer deployed (frontend only). Five-priority contextual holding card system (NS → HT → Late → Budget → Default) with per-state animations. Moment Feeling Layer: flash overlay, `.live-question-enter` entrance animation, and `getLiveContextText()` context banner for every new LIVE question arrival. `spontixTrack()` analytics hook wired to all holding states and LIVE question events. `live_match_stats` fetch extended to include `home_score, away_score` for score-aware copy. Budget fallback: `live_questions_per_match ?? live_question_budget ?? 6`. Monetization upsell placeholder (disabled) added to budget-exhausted card. No migration, no Supabase function deploy. — Previous: Window overlap guard (v65), live quality & diversity filter (v66).

This document is the authoritative reference for the `CORE_MATCH_LIVE` question lane. Read it before building, modifying, or debugging any part of the live question system.

For tier pricing and monetization rules, see `docs/TIER_ARCHITECTURE.md`.  
For the post-MVP activation plan, see `## LIVE SYSTEM — POST-MVP ACTIVATION PLAN` in `CLAUDE.md`.  
For prematch quality analytics (the model this system mirrors), see `docs/PREMATCH_QUALITY_ANALYTICS.md`.

---

## 1. System Overview

### What LIVE questions are

`CORE_MATCH_LIVE` questions are generated **during a match**, based on live match state. They are time-bounded — question appears, answer window opens, window closes, resolver fires within minutes. The entire lifecycle from generation to resolution happens inside a single match.

They are the product. Not an add-on.

### Difference from other lanes

| | CORE_MATCH_PREMATCH | CORE_MATCH_LIVE | REAL_WORLD |
|---|---|---|---|
| Generated | Before kickoff | During match | Based on news/events |
| Data source | Sports API (fixtures, standings) | Live match state (score, events, clock) | GNews + transfers |
| Answer window | Until kickoff | 2–5 minutes | Hours to days |
| Resolves | Post-match (~2–3h after kickoff) | Within minutes of closing | At `resolution_deadline` |
| Feed priority | 2nd | **1st — always** | 3rd |
| Tier gate | All tiers | Starter (limited) → Pro | Pro (limited) → Elite |
| Pool reuse | Yes (shared across leagues) | No (live state is unique per moment) | No |

### Feed priority — non-negotiable

`CORE_MATCH_LIVE` questions always render first. This is enforced by `lanePriority` in `league.html`. No question from another lane may appear above a live question. If this rule is ever broken, it is a bug.

---

## 2. Generation Model

### Current state (deployed ✅)

The generation pipeline **does** produce `CORE_MATCH_LIVE` questions. The full live generation loop is implemented in `generate-questions/index.ts` and runs every time the Edge Function fires.

**How it works:**
1. `fetchInProgressFixturesFromCache(sb, leagueId, teamId?, scopeType)` — queries `live_match_stats WHERE status IN ('1H', 'HT', '2H', 'ET')` and cross-references `api_football_fixtures` for league/team scope filtering. **Does NOT query `api_football_fixtures.status_short`** (that field is only ever `NS` — live statuses are maintained in `live_match_stats` by the poller).
2. `buildLiveContext(sb, leagueId, matchId, fixtureRow)` — returns `LiveMatchContext | null`. Reads `live_match_stats` for score/minute/events, derives recent events (goals/red cards since last generation), detects `generationTrigger` (event_driven vs time_driven), reads active question windows.
3. Live questions skip the pool system entirely — live state is unique per moment, nothing to reuse.
4. All 5 safety checks enforced in order: HT skip → no live stats → ≥89 hard reject → active cap → rate limit (time-driven only; event-driven bypasses).

**Deployed:** `generate-questions` Edge Function includes the live generation loop. Confirmed working end-to-end.

### Generation model

Two trigger types — both required:

#### Time-driven (primary, reliable)

- Fires on the clock when no event-driven question has fired for 8–12 minutes
- Gap threshold: 8 min (early phase), 10 min (mid phase), 6 min (late phase)
- Question types: "Will there be a goal between the 36th and 41st minute?", "Will a goal be scored before the 75th minute?", "Will there be a card before the 80th minute?"
- Rate limit: max 1 per 3 minutes per league (safety rule — applies to all tiers)
- These are inherently fair — no user has an information advantage. The trigger is the clock.

#### Event-driven (secondary, high-value)

- Event detection fires immediately on goals and red cards (MVP); penalties added post-MVP. Question publication is delayed by 45–60 seconds to absorb broadcast and API latency differences.
- Bypasses the 3-minute rate limit — events fire regardless of recent generation
- Uses longer answer windows than time-driven (compensates for broadcast lag)
- `window_start_minute` must be ≥ `match_minute_at_generation + 3` for all event-driven questions — this ensures the triggering event is never inside the prediction window and users cannot gain advantage from faster feeds (see EVENT WINDOW SAFETY RULE in Section 4)
- Triggers a question with `generation_trigger: 'event_driven'` and `last_event_type` set in context
- Question types: "Will [team] score again before full-time?", "Will there be another card before the final whistle?", "Who scores next?"

### How generation is triggered (deployed ✅)

```
pg_cron (every 6h) → generate-questions Edge Function
  → [prematch loop runs first]
  → [REAL_WORLD loop runs second]
  → [live loop runs third, after prematch + RW]
  → for each league with ai_questions_enabled (football only):
      ① fetchInProgressFixturesFromCache() — queries live_match_stats for 1H/HT/2H/ET fixtures
      ② HT skip — status_short === 'HT' → skip with 'halftime_pause'
      ③ buildLiveContext() — reads live_match_stats; null return → skip with 'no_live_stats_available'
         also fetches all CORE_MATCH_LIVE questions for this league+match → populates matchQuestions
      ④ ≥89 hard reject — match_minute ≥ 89 → skip with 'match_minute_too_late'
      ⑤ active cap check — activeQuestionCount ≥ 2 → skip with 'active_question_cap_reached'
      ⑥ budget check (ALL triggers) — generatedMinutes.length >= liveBudget → skip with 'live_budget_reached'
         liveBudget = live_questions_per_match ?? live_question_budget ?? 6
      ⑦ pre-HT quota (ALL triggers) — matchMinute < 45 && preHtGenerated >= floor(budget/2) → skip with 'pre_ht_quota_full'
      ⑧ slot eligibility (time-driven only) — no planned slot within ±2 min of current minute → skip with 'no_slot_due'
         planned slots from computePlannedSlots(budget): floor(N/2) pre-HT in [10–40], ceil(N/2) post-HT in [55–85]
         slot coverage window ±5 min; event questions naturally suppress nearby slots
      ⑨ rate limit check (time-driven only) — CORE_MATCH_LIVE generated in last 3 min → skip
         (event-driven bypasses checks ⑧ and ⑨)
      ⑩ buildContextPacket() — live fields populated from LiveMatchContext
         recentCategories populated from matchQuestions market keys (last 5 non-voided)
      ⑪ generateQuestions() — Call 1 (gpt-4o-mini), generates exactly 1 question
      ⑫ convertToPredicate() — Call 2
      ⑬ validateQuestion() — 6-stage validator (schema, entity, temporal, logic, live_timing, availability)
      ⑭ window overlap guard — rejects match_stat_window whose [start,end] overlaps any pending window
         stage: live_timing_validation, code: live_window_overlap
      ⑮ checkLiveQuality() — live quality & diversity filter (lib/live-quality-filter.ts)
         stage: live_quality — see §7 for rejection codes
      ⑯ timing: answer_closes_at = minuteToTimestamp(kickoff, window_start_minute) for match_stat_window
      ⑰ insert into questions with question_type = 'CORE_MATCH_LIVE', pool bypassed
```

Note: live questions do NOT use the pool system. Live state is unique to each moment — there is nothing to reuse.

### Live context fields

These fields are populated by `buildLiveContext()` in `context-builder.ts` for every live generation cycle:

| Field | Source | Notes |
|---|---|---|
| `match_minute` | `live_match_stats.minute` | Current match clock |
| `current_score` | `live_match_stats.home_score : away_score` | Live score |
| `match_phase` | Derived from `match_minute` | early (0–20) / mid (20–70) / late (70+) |
| `recent_events` | `live_match_stats.events` JSONB | Events since last generation |
| `last_event_type` | Most recent significant event | `'goal'` / `'red_card'` / `'penalty'` / `'yellow_card'` / `'none'` |
| `is_close_game` | `\|home_score - away_score\| <= 1` | Boolean |
| `is_blowout` | `\|home_score - away_score\| >= 3` | Boolean |
| `activeWindows` | Pending CORE_MATCH_LIVE questions | `[{start, end}]` — used for overlap guard |
| `matchQuestions` | All CORE_MATCH_LIVE questions for this league+match | `[{question_text, resolution_predicate, match_minute_at_generation, resolution_status}]` — ordered oldest-first; used by live quality filter for consecutive-market and diversity checks |

### Match phase rules

| Phase | Minutes | Anchoring type | Question priority |
|---|---|---|---|
| Early | 0–20 | FIXED WINDOW + DEADLINE | Medium/low — let match settle |
| Mid | 20–60 | FIXED WINDOW + DEADLINE | Full mix |
| Late-early | 60–75 | All three types | Full mix; MATCH PHASE now valid |
| Late | 75–85 | DEADLINE + MATCH PHASE | High-value; "before full-time" preferred |
| Final | 85–90 | **MATCH PHASE only** | "Before full-time" / "before the final whistle" exclusively |

---

## 3. Tier Integration

### Player tiers

| Tier | See live questions | Answer live questions | Create live leagues |
|---|---|---|---|
| Starter | ✅ All visible | ✅ Max 3 per match | ❌ |
| Pro | ✅ | ✅ Unlimited | ✅ |
| Elite | ✅ | ✅ Unlimited | ✅ + live stats tab |

**Starter answer cap enforcement** (already implemented):
- `league.html:getLiveQuotaState()` — counts answered LIVE questions for current match from in-memory `myAnswers`
- `renderOptions()` — visually disables answer buttons when cap reached; shows "Live answers: X / 3"
- `handleAnswer()` — blocks submission if cap reached; shows upgrade modal
- Cap: `TIER_LIMITS.liveQuestionsPerMatch = 3` for Starter; `-1` (unlimited) for Pro/Elite

**Starter cannot create live-mode leagues** (already implemented):
- `create-league.html` question mode selector: `limits.liveQuestionsMode !== 'limited'` gate
- Starter sees the "Live" mode card with a lock badge; clicking it opens the upgrade modal

### Venue tiers

| Venue tier | Live generation |
|---|---|
| Venue Starter | AI preview only (3 questions total per league); no live-mode generation |
| Venue Pro | Full live generation for owned leagues |
| Venue Elite | Full live + priority generation slot (future) |

### Two types of limits — never confuse them

**Safety rules** (apply to ALL tiers, no exceptions):
- Max 3 active questions per league at any time (`MAX_ACTIVE_LIVE_QUESTIONS = 3` in `generate-questions/index.ts`; `maxActiveQuestions = 3` in context packet)
- Max 1 new time-driven live question per 3 minutes per league
- Minimum 90-second answer window
- No generation after match ends (`status = 'FT'`)
- No LIVE question without a `match_id`
- No generation during half-time (`status = 'HT'`)

**Monetization rules** (apply per tier):
- Starter: 3 live answers per match
- Pro/Elite: unlimited answers
- Starter: cannot create live-mode leagues

---

## 4. Timing Model

Every `CORE_MATCH_LIVE` question requires all three timestamps. No exceptions.

| Timestamp | Purpose | Value |
|---|---|---|
| `visible_from` | When question appears in feed | `now + 20–45s` (absorb delivery lag; longer for event-driven) |
| `answer_closes_at` | Authoritative answer lock | Must be BEFORE `window_start_minute` real match time — derived from the match clock, not from `visible_from` |
| `resolves_after` | When resolver evaluates outcome | `kickoff + window_end_minute (real clock) + 90–120s` safety buffer |

### Rules

- `resolves_after` must be strictly after `answer_closes_at`. Always.
- `visible_from` must never be set in the past at generation time.
- `answer_closes_at` must be before `window_start_minute` in real match time — so users cannot answer while watching the window play out.
- `answer_closes_at` is derived from the match clock (kickoff + match-minute-to-real-time conversion), not from an arbitrary duration added to `visible_from`.
- The RLS insert policy on `player_answers` enforces `coalesce(answer_closes_at, deadline) > now()` at the DB level — answers after close are rejected server-side.
- UI hides the question card before `visible_from` and locks answer controls at `answer_closes_at`.
- Minimum answer window: **90 seconds** — absolute floor; no question may be answerable for less.

### MINIMUM WINDOW GAP — HARD RULE

For ALL LIVE questions:

**`window_start_minute − match_minute_at_generation` must be ≥ 3**

This guarantees:
- `visible_from` delay (20–45 seconds) is absorbed
- A minimum 90-second answer window fits before the prediction window begins
- A safety buffer exists between the current match state and the prediction window

If this condition cannot be met:
- Select a later `window_start_minute` (see WINDOW SELECTION PRIORITY RULE below)
- OR reject the question entirely

**Exception — late match (match_minute ≥ 87):** use a minimum gap of 1 minute (see LATE MATCH EDGE CASE RULE and LATE MATCH GENERATION RULE below). The 90-second answer window constraint still applies; if it cannot fit, reject the question.

This replaces the previous 2-minute gap assumption. A 2-minute gap is insufficient: `visible_from` delay (up to 45s) + minimum answer window (90s) = 135 seconds minimum, which exceeds a 2-minute (120s) gap when the delay is at the high end.

### LIVE WINDOW VALIDATION — HARD RULE

A LIVE question is **INVALID** if:

- `answer_closes_at` cannot be at least 90 seconds after `visible_from`
- **AND** still occur before `window_start_minute` in real match time

If BOTH conditions cannot be satisfied simultaneously:
- The system must select a later `window_start_minute` (see WINDOW SELECTION PRIORITY RULE below)
- OR reject the question entirely

This rule is enforced by the `live_timing_validation` stage in `validateQuestion()`. The `answer_window_overlap` rejection code fires when `window_start_minute − match_minute_at_generation < 3`, ensuring there is always enough clock time for a valid answer window before the prediction window opens. If a valid window cannot be constructed, the question must not be generated.

### REAL-TIME VALIDATION RULE

All timing must be validated in real match time (kickoff + elapsed minutes, accounting for the halftime break via `minuteToTimestamp()`):

- `answer_closes_at` must be before `window_start_minute` real clock time
- `answer_closes_at − visible_from` must be ≥ 90 seconds

If BOTH cannot be satisfied simultaneously, the question is invalid and must be rejected or shifted to a later window. Timing math must never be done in match-minute space alone — the halftime gap (typically 15 minutes) must be factored in for all second-half windows.

### EVENT WINDOW SAFETY RULE

For all event-driven questions:

**`window_start_minute` must be ≥ `match_minute_at_generation + 3`**

This ensures:
- The triggering event (goal, red card) is never inside the prediction window
- Users on faster feeds cannot answer with knowledge of the triggering event's consequences already visible in the window

If this cannot be satisfied:
- Shift `window_start_minute` forward until the condition is met (see WINDOW SELECTION PRIORITY RULE below)
- OR reject the question

This is a stricter version of the MINIMUM WINDOW GAP rule applied specifically to event-driven questions. It cannot be bypassed even when the event-driven rate limit bypass is active.

### WINDOW SELECTION PRIORITY RULE

When selecting a prediction window, the system must choose the **earliest valid non-overlapping window** that satisfies ALL constraints simultaneously:

- minimum gap (≥3 minutes, or ≥1 when match_minute ≥ 87)
- ≥90-second answer window fits before `window_start_minute` real clock time
- no overlap with currently active questions (see NO OVERLAPPING WINDOWS in Section 6)
- valid anchoring type for the current match phase
- event safety (if event-driven): `window_start_minute ≥ match_minute_at_generation + 3`

If multiple valid windows exist:

→ **always select the one closest to the current match minute**

This ensures:
- continuous engagement — questions cover the next available moments, not distant ones
- no artificial dead zones between questions
- predictable question pacing that users can follow

If no valid window can be found that satisfies all constraints, do not generate. Show the holding card.

### LATE MATCH EDGE CASE RULE

If `match_minute_at_generation ≥ 87`:

```
window_start_minute = match_minute + 1   (minimum gap reduced from 3 to 1)
window_end_minute   = 90
anchoring_type      = match_phase
phrase              = "before full-time" or "before the final whistle"
```

Constraints that still apply:
- `answer_closes_at − visible_from` must be ≥ 90 seconds
- `answer_closes_at` must be before `window_start_minute` real clock time
- If BOTH cannot be satisfied → reject the question; do not generate

If `match_minute_at_generation ≥ 89`, no valid question can be constructed. Reject immediately and show the holding card. Do not attempt generation in the final minute.

All questions after minute 87 must use `anchoring_type = match_phase` and `window_end_minute = 90`. No FIXED WINDOW or DEADLINE questions are valid after minute 85.

### LATE MATCH GENERATION RULE

If `match_minute_at_generation ≥ 87`:

- The system **MUST** attempt to construct a valid MATCH PHASE question (`anchoring_type = match_phase`, `window_end_minute = 90`)
- If a valid ≥90-second answer window **CANNOT** be constructed before `window_start_minute` real clock time:

  → generation **MUST** be skipped entirely  
  → **NO retries**  
  → **NO alternative window shifting**  
  → **NO fallback question types**

  The system must show the holding card instead.

If `match_minute_at_generation ≥ 89`:

→ Skip generation immediately without any attempt. Show the holding card.

**Rationale:** at minute 87 there are only ~3 real clock minutes remaining (accounting for halftime gap). Attempting retries or shifting windows at this point produces rushed, low-quality questions that may not resolve correctly. The holding card is always the safer outcome in the final minutes of a match.

### Three anchored question types (prompt v2.4)

All live questions use exactly one of three types. Relative time phrasing ("next 5 minutes", "coming minutes", "shortly", "soon") is permanently banned — it creates unfair advantages for users on low-latency feeds.

#### Type 1 — FIXED WINDOW
- **Phrase:** "between the 60th and 65th minute"
- **`anchoring_type`:** `fixed_window`
- `window_start_minute` = match_minute + 3 (minimum)
- `window_end_minute` = start + 4–6 (total range: 3–7 minutes)
- Best for: match_minute < 75, any match state

#### Type 2 — DEADLINE
- **Phrase:** "before the 75th minute"
- **`anchoring_type`:** `deadline`
- `window_start_minute` = match_minute + 3 (minimum)
- `window_end_minute` = upcoming milestone (75, 80, 85) — must be > match_minute + 5
- Best for: match_minute 60–85, adds urgency as deadline approaches

#### Type 3 — MATCH PHASE
- **Phrase:** "before half-time" / "before full-time" / "before the final whistle"
- **`anchoring_type`:** `match_phase`
- `window_start_minute` = match_minute + 3 (minimum; reduced to +1 only when match_minute ≥ 87)
- `window_end_minute` = 45 (half-time) or 90 (full-time)
- Best for: match_minute > 70; mandatory after match_minute > 85

### Match minute adaptation

| Match minute | Allowed types | Notes |
|---|---|---|
| < 60 | FIXED WINDOW + DEADLINE | "Before full-time" too distant to be tense |
| 60–75 | All three types | Mix freely; full variety available |
| 75–85 | DEADLINE + MATCH PHASE | FIXED WINDOW only if window fits before 90 |
| 85–87 | **MATCH PHASE only** | "Before full-time"; `window_start = match_minute + 3` |
| 87–89 | **MATCH PHASE only** | "Before full-time"; `window_start = match_minute + 1`; reject if 90s window cannot fit |
| ≥ 89 | **Reject** | No valid window can be constructed; show holding card |

The ≥ 85 minute MATCH PHASE rule is absolute. No FIXED WINDOW or DEADLINE questions in the final minutes — there is no room for a valid window before the match ends.

### Timing examples

**Time-driven FIXED WINDOW (minute 34):**
```
window_start_minute = 37   (match_minute + 3 — minimum gap)
window_end_minute   = 42
visible_from        = kickoff + 34:20   (now + 20s delay)
answer_closes_at    = kickoff + 36:30   (derived from window_start real time − 30s;
                                         gives ~2m 10s answer window — comfortably above 90s floor)
resolves_after      = kickoff + 42min + 90s → resolver fires after window closes
```
`answer_closes_at` is derived from `window_start_minute` converted to real clock time. The 3-minute gap (34 → 37) guarantees: 20s delivery delay + 90s minimum answer window + 30s safety buffer before window opens.

**Event-driven DEADLINE (goal at minute 67):**
```
window_start_minute = 70   (match_minute + 3 — EVENT WINDOW SAFETY RULE applies)
window_end_minute   = 80
visible_from        = kickoff + 67:45   (now + 45s — longer buffer for event-driven)
answer_closes_at    = kickoff + 69:15   (derived from window_start real time − 45s;
                                         gives ~90s answer window with 45s buffer before window opens)
resolves_after      = kickoff + 80min + 120s → resolver fires after window closes
```
The triggering goal at minute 67 is outside the prediction window (70–80). Users who saw the goal cannot use that knowledge to predict events inside the window.

**Late-phase MATCH PHASE (minute 87):**
```
window_start_minute = 88   (match_minute + 1 — LATE MATCH EDGE CASE RULE applies)
window_end_minute   = 90
visible_from        = kickoff + 87:20   (now + 20s delay)
answer_closes_at    = kickoff + 87:50   (derived from window_start real time − 10s;
                                         equals visible_from + 30s — WARNING: below 90s floor)
```
At minute 87 with a 20s delay, `visible_from + 90s = 88:50` but `window_start real time ≈ 88:00` (accounting for HT gap). The 90-second floor cannot be met. **This question must be rejected.** Per the LATE MATCH GENERATION RULE: skip entirely, no retries, no alternative window shifting. Show the holding card instead.

Correct behaviour at minute 87: if the 90-second answer window cannot fit before `window_start_minute` real clock time, the question is invalid. Do not generate. At minute 89 or later: always reject immediately.

### Why anchored windows

Users watch on different feeds with different latency (TV: 5–30s, streaming: 10–60s, in-person: real-time). "Will there be a goal between the 60th and 65th minute?" is a specific window that is either over or not — equally fair regardless of feed delay. Every user has the same information when they answer. Relative phrasing ("will there be a goal soon?") is unfair — a user on a 60-second delay has already seen part of that window before the question arrives.

---

## 5. Question Types

### Allowed patterns

All live questions use anchored match-minute windows. Relative time phrasing ("next X minutes", "coming minutes", "shortly", "soon") is banned at the validator level.

**Stat questions — FIXED WINDOW** (valid in any state, best before minute 75):
- "Will there be a goal between the 36th and 41st minute?"
- "Will there be a card between the 63rd and 68th minute?"

**Stat questions — DEADLINE** (valid minute 60–85, adds urgency):
- "Will there be a goal before the 75th minute?"
- "Will there be a card before the 80th minute?"

**Stat questions — MATCH PHASE** (valid from minute 70, climax framing):
- "Will there be a goal before full-time?"
- "Will there be another card before the final whistle?"
- "Will there be a goal before half-time?" (if still first half)

**Outcome questions** (valid in close games, ≤1 goal margin):
- "Will [team] win the match?"
- "Will there be an equaliser before full-time?"
- "Will [team] keep a clean sheet?"

**Player questions** (when player is confirmed starting):
- "Will [player] score before full-time?"

### Forbidden patterns

These are always wrong for live questions — never generate them:

- **Relative time phrasing** — "next 5 minutes", "coming minutes", "shortly", "soon", "over the next X minutes" — validator rejects these with `relative_time_window_rejected`
- Answer window shorter than 90 seconds
- Window that starts in the past (`window_start_minute ≤ match_minute`) — validator rejects with `invalid_live_window`
- Window gap less than 3 minutes from current match minute (`window_start_minute − match_minute < 3`) — validator rejects with `answer_window_overlap`
- Questions about events that have already happened (past tense)
- Questions requiring subjective interpretation ("Will [team] dominate possession?")
- Time window questions in dead games (3-0 in the 88th minute — equaliser questions are meaningless)
- Player stat questions for confirmed substitutes or absent players
- Corners in `match_stat_window` predicate — corners are cumulative totals only, no per-minute event data available from the API
- Any question generated at match_minute ≥ 89

### Blowout adaptation (mandatory)

Never stop generating in blowout matches. Adapt the question type:

| Score margin | Valid question types | Avoid |
|---|---|---|
| ≤1 goal | Everything | Nothing |
| 2 goals | Stats, player, next-event, total goals | Equaliser questions |
| 3+ goals | Stats, player, next-goal scorer, total goals | Winner, equaliser, clean sheet |

Players are still competing against each other for league points even in a 4-0 match. Silence is always wrong.

---

## 6. Safety Rules

### Max active questions

**3 active questions** per league at any time (`MAX_ACTIVE_LIVE_QUESTIONS = 3` in `index.ts`; `maxActiveQuestions = 3` in the context packet).

Enforced via:
1. `activeQuestionCount` from `buildLiveContext()` — reads pending CORE_MATCH_LIVE questions with open answer windows; skips generation if count ≥ 2 (enforced at index.ts safety check step ⑤)
2. `maxActiveQuestions` field in the context packet sent to OpenAI — model respects this in generation

The `CLAUDE.md` system rules state max 3 active questions. Both the safety check (≥ 2 triggers skip) and the context packet (max = 3) are consistent with this cap.

### Budget and slot enforcement

Generation for a given match is governed by four ordered checks. All use a single DB query for `match_minute_at_generation` values per (league, match) at the start of the cycle.

**1. Budget check (all triggers)**  
`liveBudget = live_questions_per_match ?? live_question_budget ?? 6` (read order; soccer-specific column, migration 054).  
If `generatedMinutes.length >= liveBudget` → skip `live_budget_reached`.  
User sets budget via the Live QPM slider (1–10, default 6) in create-league Step 3.

**2. Pre-HT quota (all triggers)**  
`preHtMax = floor(liveBudget / 2)`.  
If `matchMinute < 45 && preHtGenerated >= preHtMax` → skip `pre_ht_quota_full`.  
Prevents the first half from consuming the full budget, leaving the second half empty.

**3. Slot eligibility (time-driven only)**  
`computePlannedSlots(budget)` returns soccer-specific planned minute targets:  
- Pre-HT: `floor(N/2)` slots distributed evenly across minutes 10–40  
- Post-HT: `ceil(N/2)` slots distributed evenly across minutes 55–85  

A slot is "covered" if any generated question's minute is within ±5 min. A slot is "due" if it's uncovered and within ±2 min of the current match minute. If no due slot exists → skip `no_slot_due`.  
The ±5 min coverage window naturally suppresses nearby slots — an event question at minute 38 covers the slot at 40 without extra logic.

**4. Rate limit (time-driven only, safety net)**  
Max 1 new CORE_MATCH_LIVE question per 3 minutes per league. Preserved as a final backstop.  
Check: `questions WHERE league_id = ? AND question_type = 'CORE_MATCH_LIVE' AND created_at > now() - 3 minutes`.

**Event-driven** bypasses checks 3 and 4 (slot eligibility + rate limit). Budget and pre-HT quota apply to all triggers.

If no valid question can be generated in a cycle: skip. Show holding card.

### NO OVERLAPPING WINDOWS — HARD RULE

No two active `CORE_MATCH_LIVE` questions may have overlapping prediction windows.

Before inserting a new question, check all currently active questions (those with `resolution_status = 'pending'` and `answer_closes_at > now()`) for the same league. A new question's `[window_start_minute, window_end_minute]` range must not overlap with any active question's window.

#### OVERLAP RESOLUTION RULE

If a generated question overlaps with any active question:

1. Attempt a **SINGLE** window shift forward to the next valid non-overlapping window (per the WINDOW SELECTION PRIORITY RULE: earliest valid window closest to the current match minute)

2. Re-validate **ALL** constraints after the shift:
   - minimum 3-minute gap (`window_start_minute − match_minute_at_generation ≥ 3`, or ≥ 1 when match_minute ≥ 87)
   - ≥90-second answer window fits before `window_start_minute` real clock time
   - event safety (if event-driven): `window_start_minute ≥ match_minute_at_generation + 3`
   - match phase constraints for current match minute

3. If the shifted window **STILL overlaps** OR **violates any rule**:

   → **reject the question**

Additional constraints:
- **Never** attempt multiple shifts — one shift attempt only
- **Never** compress `window_end_minute − window_start_minute` below the allowed minimum for the anchoring type (3 minutes)
- **Never** override `anchoring_type` to resolve an overlap — the type must remain appropriate for the current match phase

This rule applies across all anchoring types:
- Two FIXED WINDOW questions cannot share any minutes in their prediction range
- A DEADLINE question cannot overlap with a FIXED WINDOW question's range
- A MATCH PHASE question (e.g. 87–90) cannot overlap with any other question using the same minute range

Questions without a `match_stat_window` predicate (outcome, player, team questions) are not subject to this rule — they resolve from match-wide stats and do not compete for a specific time window.

### Fallback rules

1. No active live question → show contextual holding card (5-priority system — see UI holding states below)
2. Generation fails (API error, OpenAI error, validation failure) → log silently, show holding card
3. Match state unavailable → skip live generation entirely for this cycle; do not void existing questions
4. All retries exhausted → skip; do not generate a low-quality filler question
5. `match_minute ≥ 89` → skip generation entirely; show "Match almost over" holding card until final whistle

### UI holding states (priority order)

When no active LIVE question exists, `league.html` shows exactly one contextual card determined by this priority:

| Priority | Condition | State class | Title |
|---|---|---|---|
| 1 | `live_match_stats.status = 'NS'` | `.holding-ns` | Match hasn't started yet |
| 2 | `live_match_stats.status = 'HT'` | `.holding-ht` | Half-time break |
| 3 | `minute ≥ 89` AND status in `2H/ET/P` | `.holding-late` | Match almost over |
| 4 | LIVE questions generated ≥ budget | `.holding-budget` | All live questions used |
| 5 | default | `.holding-card` (default) | Waiting for the next live moment… |

Match stats are fetched from `live_match_stats` (columns: `status, minute, home_score, away_score`) inside `loadAndRenderQuestions` when `!hasActive`. The fetch uses the most frequent LIVE-question `match_id`, falling back to any question's `match_id` so the NS state works before LIVE questions exist. Budget fallback: `live_questions_per_match ?? live_question_budget ?? 6`.

The budget-exhausted card includes a disabled "Unlock extra questions" button — a future Stripe hook placeholder. No payment logic is implemented.

**A skipped cycle is always correct.** A bad question destroys trust. A missing question for 5 minutes does not.

### Rate limit does NOT apply to prematch or REAL_WORLD

The 3-minute live rate limit applies to `CORE_MATCH_LIVE` only. Do not apply it to prematch generation cycles or REAL_WORLD generation. These are separate pipelines.

---

## 7. Analytics

The live analytics layer is **deployed** (migration 023). It mirrors the prematch quality analytics structure (`docs/PREMATCH_QUALITY_ANALYTICS.md`, migration 020).

### Validation stages and their rejection codes

Three stages fire for live questions. `live_timing_validation` and the window overlap code are in `predicate-validator.ts` / `index.ts`; `live_quality` is in `lib/live-quality-filter.ts`.

#### Stage: `live_timing_validation` (implemented — predicate-validator.ts + index.ts)

Runs for all live questions (skips prematch). Catches timing and structural violations that the prompt alone cannot fully prevent.

| Rejection code | Condition | Location |
|---|---|---|
| `relative_time_window_rejected` | `question_text` contains banned relative phrases: "next X minutes", "within X minutes", "coming minutes", "shortly", "soon", "over the next X minutes" | `checkLiveTiming` in predicate-validator.ts |
| `time_phrasing_requires_window_predicate` | Question text references an anchored time window but predicate is `match_stat` (full-match totals) | `checkLiveTiming` in predicate-validator.ts |
| `invalid_live_window` | `window_start_minute ≤ match_minute_at_generation` | `checkLiveTiming` in predicate-validator.ts |
| `answer_window_overlap` | `window_start_minute − match_minute_at_generation < 3` (or < 1 when match_minute ≥ 87) | `checkLiveTiming` in predicate-validator.ts |
| `live_window_overlap` | New question's `[window_start, window_end]` overlaps any existing pending `match_stat_window` for the same league+match | window overlap guard in index.ts (deployed v65) |

#### Skip reason codes (generation loop — logged to `liveResult.skipReason`)

These are set in `index.ts` before the AI call.

| Skip code | Condition |
|---|---|
| `halftime_pause` | Match status is 'HT' |
| `no_live_stats_available` | `buildLiveContext()` returned null |
| `match_minute_too_late` | `matchMinute ≥ 89` |
| `active_question_cap_reached` | `activeQuestionCount ≥ 2` |
| `live_budget_reached` | `generatedMinutes.length >= liveBudget` |
| `pre_ht_quota_full` | First half and pre-HT generated count ≥ `floor(budget/2)` |
| `no_slot_due` | Time-driven; no planned slot within ±2 min of current match minute |
| `rate_limit_3min_live` | Time-driven; CORE_MATCH_LIVE generated within last 3 min |
| `sport_not_supported` | League sport is not football |

#### Stage: `live_quality` ✅ implemented — lib/live-quality-filter.ts

Runs after `validateQuestion()` and the window overlap guard, before DB insert. Code-enforced — no prompt dependence. Only applies to league CORE_MATCH_LIVE (soccer). Arena and BR are not affected.

Rejection log entry shape:
```json
{
  "attempt": 1,
  "stage": "live_quality",
  "question_text": "Will [team] win the match?",
  "error": "blowout_outcome_reject: winner question when score diff is 3 (3–0) — outcome too obvious",
  "reason": "blowout_outcome_reject",
  "score": 0,
  "fixture_id": "1234567",
  "timestamp": "2026-05-05T20:00:00.000Z"
}
```

### live_quality rejection codes (deployed v1)

**Hard reject rules** — always reject, no score threshold:

| Code | Condition |
|---|---|
| `already_resolved_clean_sheet` | `clean_sheet_home` predicate AND `awayScore > 0` — OR — `clean_sheet_away` predicate AND `homeScore > 0` |
| `already_resolved_btts` | `btts` predicate AND `homeScore > 0` AND `awayScore > 0` |
| `blowout_outcome_reject` | `match_outcome_winner` predicate AND `scoreDiff ≥ 3` |
| `equaliser_blowout_reject` | Question text matches equaliser/comeback phrasing AND `scoreDiff ≥ 2` |
| `consecutive_same_market` | Same market key as last non-voided question AND `generationTrigger = 'time_driven'` |

**Soft scoring rule** (event-driven only — v1 infrastructure, never rejects in v1):

| Code | Penalty | v1 outcome |
|---|---|---|
| `event_driven_consecutive_same_market` | −30 | score = 70, above threshold (50) → allowed; event reactions may reuse the same market |

### Market key taxonomy (deriveLiveMarketKey)

Used by the live quality filter to classify predicates for consecutive and diversity checks:

| Key | Predicate type | Condition |
|---|---|---|
| `goals_window` | `match_stat_window` | `field = 'goals'` |
| `cards_window` | `match_stat_window` | `field = 'cards'` |
| `match_outcome_winner` | `match_outcome` | `binary_condition.field = 'winner_team_id'` |
| `draw` | `match_outcome` | `binary_condition.field = 'draw'` |
| `clean_sheet_home` | `match_stat` | `field='away_score', op='eq', value=0` |
| `clean_sheet_away` | `match_stat` | `field='home_score', op='eq', value=0` |
| `btts` | `btts` | — |
| `total_goals` | `match_stat` | `field='total_goals'` |
| `player_goal` | `player_stat` | `field='goals'` |
| `player_card` | `player_stat` | `field='cards'` / `'yellow_cards'` |

### Frontend analytics hooks (`spontixTrack`)

Lightweight fire-and-forget helper in `league.html`. Logs to console and delegates to `window.spontixAnalytics(event, data)` if defined — wire any provider (Posthog, Amplitude, etc.) there without touching `league.html`.

| Event | Fired when | Key payload fields |
|---|---|---|
| `holding_state_shown` | Any holding card branch rendered | `state` (`ns`/`ht`/`late`/`budget`/`default`), `leagueId` |
| `live_budget_exhausted_shown` | Budget-exhausted branch only | `leagueId`, `budget` |
| `live_question_shown` | New LIVE question detected post-render | `questionId`, `eventType`, `minute`, `leagueId` |
| `live_context_banner_shown` | Alongside `live_question_shown` | `contextText`, `leagueId` |

No network calls. No external dependencies. All events are fire-and-forget; errors in the delegate are caught silently.

### Key metrics to track

| Metric | Definition | Target |
|---|---|---|
| `live_generation_rate` | Questions generated per match per league | 6–12 (standard budget) |
| `live_rejection_rate` | Rejected / (generated + rejected) × 100 | < 35% |
| `avg_live_quality_score` | Mean score of rejected questions | > 45 |
| `time_window_distribution` | Distribution of answer window lengths (buckets: <90s / 90s–2m / 2–5m / 5m+) | Mostly 2–5m |
| `question_type_distribution` | % outcome / stat / player / next-event | No single type > 50% |
| `event_vs_time_ratio` | % event-driven vs time-driven | Depends on match; monitor for balance |

### Analytics views (deployed — migration 023 ✅)

`analytics_live_quality_summary` and `analytics_live_rejection_reasons` views are live. Both views are empty until the first CORE_MATCH_LIVE generation cycle fires with an in-progress match.

```sql
-- Daily health
SELECT * FROM analytics_live_quality_summary ORDER BY day DESC LIMIT 7;

-- Rejection detail
SELECT day, stage, error, question_text
FROM analytics_live_rejection_reasons
ORDER BY day DESC LIMIT 20;
```

The `analytics_live_quality_summary` view sources from `generation_run_leagues` filtered to live generation modes (`live_gap`, `live_event`). The `analytics_live_rejection_reasons` view extracts individual rejection log entries from the same source.

The `live_quality` stage is now implemented and its rejection entries flow into `analytics_live_rejection_reasons` immediately. No additional migration is needed — the view already captures all rejection log entries regardless of stage.

---

## Pre-Launch Validation Checklist

**The live generation pipeline is deployed.** Use this checklist during first live-match validation (requires an in-progress fixture in a league with `ai_questions_enabled = true`). Each item requires a verified pass before declaring the LIVE system production-ready.

### 1. Generation

- [ ] Live questions are actually generated when a match is `in_progress`
- [ ] `match_id` is present on every generated live question (never null)
- [ ] `match_minute_at_generation` is populated and reflects the actual match clock at generation time
- [ ] `question_type = 'CORE_MATCH_LIVE'` is set correctly on every live question
- [ ] Time-driven rate limit works: triggering generation twice within 3 minutes produces only 1 new question
- [ ] Event-driven bypass works: a simulated goal event triggers a question even when a time-driven question was just generated
- [ ] Generation skips when 2 active questions already exist in the league
- [ ] Generation skips when match is finished (`status = 'FT'`)
- [ ] Generation skips when `match_minute ≥ 89` — no question is generated in the final minute
- [ ] At `match_minute ≥ 87`: only MATCH PHASE questions attempted; if 90s window cannot fit → skip entirely, no retries, no fallback
- [ ] `live_questions_per_match` is respected: generation stops when budget is reached for the match (skip reason `live_budget_reached`)
- [ ] Pre-HT quota enforced: first half generates at most `floor(budget/2)` questions (skip reason `pre_ht_quota_full`)
- [ ] Time-driven slot pacing: questions land near planned slots; two consecutive time-driven questions are not within 5 minutes of each other
- [ ] Event-driven bypasses slot check and rate limit; does NOT bypass budget or pre-HT quota
- [ ] Live QPM slider (1–10) in create-league Step 3 saves correctly to `live_questions_per_match` column

### 2. Timing and anchored windows

- [ ] `visible_from` is always in the future at generation time (never past-dated)
- [ ] `answer_closes_at` is always ≥ `visible_from + 90 seconds`
- [ ] `resolves_after` is always strictly after `answer_closes_at`
- [ ] `answer_closes_at` is derived from `window_start_minute` real match time (via `minuteToTimestamp()`) — not from `visible_from + arbitrary duration`
- [ ] `answer_closes_at` is before `window_start_minute` real clock time — users cannot answer during the prediction window
- [ ] If a ≥90-second answer window cannot fit before `window_start_minute`, the question is rejected (or a single window shift is attempted per OVERLAP RESOLUTION RULE) — never silently truncated
- [ ] RLS policy correctly rejects `player_answers` insert after `answer_closes_at` — verified by attempting a late submission via the Supabase client
- [ ] UI hides question card before `visible_from`
- [ ] UI locks answer controls at `answer_closes_at` — timer hits zero, buttons disabled, cannot submit
- [ ] No live question text contains banned relative phrases ("next X minutes", "shortly", "coming minutes", "soon", "over the next") — verify in generated question text
- [ ] `window_start_minute` is always > `match_minute_at_generation` — window never starts in the past
- [ ] `window_start_minute − match_minute_at_generation` is always ≥ 3 (or ≥ 1 when match_minute ≥ 87) — enforced by `answer_window_overlap` rejection
- [ ] Event-driven questions: `window_start_minute ≥ match_minute_at_generation + 3` — triggering event is never inside the prediction window
- [ ] No two active questions in the same league have overlapping `[window_start_minute, window_end_minute]` ranges
- [ ] Overlap resolution is deterministic: only one window shift attempted; if still invalid → reject; window size never compressed; anchoring type never changed
- [ ] Window selection always picks the earliest valid window closest to the current match minute
- [ ] `anchoring_type` is present on every live `match_stat_window` predicate (`fixed_window` / `deadline` / `match_phase`)
- [ ] Questions after minute 85 all use `match_phase` with `window_end_minute = 90` and "before full-time" phrasing
- [ ] Questions at minute 87–88 are rejected if the 90-second answer floor cannot be met before `window_start_minute` real clock time — no retries attempted
- [ ] FIXED WINDOW questions have `window_end_minute - window_start_minute` in the 3–7 minute range
- [ ] DEADLINE questions have `window_end_minute - window_start_minute` between 3 and 45 minutes
- [ ] When 2 questions are generated simultaneously, they use at least 2 different `anchoring_type` values
- [ ] No `match_stat_window` question uses `field = 'corners'` — corners are cumulative-only; only `goals` and `cards` are valid

### 3. Tier Enforcement

- [ ] Starter user: can see all 3 live questions if 3 exist
- [ ] Starter user: answer buttons disabled after 3rd answer with "Live answers: 3 / 3" indicator
- [ ] Starter user: upgrade modal fires when attempting 4th answer
- [ ] Pro user: can answer all live questions in a match with no cap
- [ ] Elite user: same as Pro — no cap
- [ ] Verify enforcement survives a page refresh (in-memory count re-derived from `myAnswers`)

### 4. UI

- [ ] `CORE_MATCH_LIVE` questions always appear first in the question feed (above prematch and real world)
- [ ] Holding card shows correct contextual state (not generic): NS before kickoff; HT during half-time; "Match almost over" at ≥89'; budget-exhausted when LIVE questions hit budget; default otherwise
- [ ] Holding card disappears immediately when a new live question becomes active
- [ ] Each holding state has the correct per-state animation (grey pulse for NS, amber for HT, coral for late)
- [ ] Budget-exhausted card shows disabled "Unlock extra questions" button only — no onclick, no payment logic
- [ ] On new LIVE question arrival (Realtime): moment flash (`#moment-flash`) appears briefly at top of screen and auto-dismisses within 1.7s
- [ ] Moment flash does NOT fire on first page load — only on Realtime-triggered re-renders that introduce a genuinely new question ID
- [ ] Primary active LIVE question card animates in (`live-question-enter`: 280ms fade + slide-up)
- [ ] Live context banner (`.live-context-banner`) appears above primary LIVE question text, e.g. "▸ After that goal…" — varies by `event_type` and match minute
- [ ] Console shows `[spontix:track]` events: `holding_state_shown`, `live_question_shown`, `live_context_banner_shown`, `live_budget_exhausted_shown`
- [ ] `LIVE` lane badge renders correctly (red dot + "LIVE" label)
- [ ] HIGH VALUE / CLUTCH / FAST badges appear on correct questions
- [ ] Timer bar counts down smoothly; turns red and pulses when < 60 seconds remaining
- [ ] Optimistic answer highlight shows immediately on tap (no perceptible lag)
- [ ] Resolved cards show correct / incorrect state with points breakdown
- [ ] Live window strip renders on active `match_stat_window` cards: "Prediction window: X'–Y'" and "Answers lock before X'"
- [ ] Window strip shows correct label per `anchoring_type`: "X'–Y'" (fixed), "Before Y'" (deadline), "Before full-time" (match_phase)
- [ ] Window strip uses goal emoji (⚽) for `field = 'goals'` and card emoji (🟨) for `field = 'cards'`

### 5. Resolver

- [ ] Live questions with `resolves_after` in the past are picked up by the hourly resolver
- [ ] `match_stat` predicates (total_goals, total_cards, etc.) evaluate correctly against post-match stats
- [ ] `match_stat_window` predicates evaluate correctly: counts goal/card events within `[window_start_minute, window_end_minute]` from `live_match_stats.events`
- [ ] `player_stat` predicates evaluate correctly (goals, assists, cards for a specific player)
- [ ] `match_outcome` predicates evaluate correctly (winner_team_id eq / draw)
- [ ] No question is resolved twice (idempotency): run the resolver twice on the same question set, verify `resolved:0` on the second run
- [ ] `player_answers.points_earned` is correctly set for all correct answers (non-zero)
- [ ] Wrong answers receive `points_earned = 0`
- [ ] `multiplier_breakdown` JSONB is written on every answer

### 6. Edge Cases

- [ ] Match postponed/cancelled mid-generation: questions are voided, not resolved; players refunded
- [ ] `live_match_stats` row missing for the fixture: generation skips gracefully, no error surfaced to users
- [ ] All questions voided in a match: leaderboard shows 0 pts for everyone, no negative values
- [ ] Match goes to extra time: questions with `resolves_after` during normal time still resolve correctly from final stats
- [ ] Two leagues follow the same match: each gets independent `questions` rows with independent `player_answers`; scoring is per-league not shared
- [ ] Rapid events (goal at 67', red card at 68'): only one event-driven question fires (the higher-priority one); the second is queued or dropped
- [ ] App open during match, no network: polling fails silently, holding card shown, no crash
- [ ] Generation attempt at match_minute ≥ 89: question is rejected immediately; holding card shown; no error surfaced
- [ ] Generation attempt at match_minute 87–88 that cannot fit 90s window: skipped entirely, no retries, no fallback question type, holding card shown
- [ ] Two simultaneously generated questions: their prediction windows do not overlap; if they would, a single window shift is attempted; if still overlapping → one is rejected
- [ ] Window selection always uses the earliest valid non-overlapping window closest to the current match minute — verified by inspecting `window_start_minute` values across consecutive generated questions
