# REAL_WORLD Question System

**Status: ✅ Fully deployed — pipeline live, resolver active, feed rendering**  
Last updated: 2026-05-06 — Migration 055: `real_world_enabled` per-league flag and `real_world_questions_per_week` user cap now stored on `leagues` table and enforced in `checkRealWorldQuota()`. Create League UI exposes Real World as a selectable Question Type card (Pro+) with a 1–3/week intensity slider. `real_world_enabled` defaults `true` for backward compat. — Previous: Three pre-live generation gaps fixed: **(G-1)** `targetMatches` filter and early-exit moved to immediately after `fetchSportsContext` — news fetch and team_players DB query now skipped when no 7-day fixture exists. **(G-2)** Call 2 (`buildPredicatePrompt`) now receives `targetMatches` instead of all upcoming matches — prevents match binding failure on fixtures outside the 7-day window. **(G-3)** Shape H (`match_lineup`) added to `buildPredicatePrompt` REQUIRED OUTPUT SCHEMA — Call 2 now has explicit field list and worked example for TYPE 1 questions. Also: weekly cap updated from 1/day to 3/week (Monday 00:00 UTC boundary). — Previous: Sprint 1 cleanup (log key renamed; `manual_review` reframed as "blocked until admin UI ships"). — Previous: Two critical bugs fixed: **(F-1)** `match_lineup` `resolvesAfter` was `kickoff` instead of `kickoff + 91min` — silent Stage 3 failure for all TYPE 1 questions. **(F-2/F-3)** `manual_review` skipped at generation + resolver — prevents quota burn and hourly OpenAI loops. Bounded retry loop (MAX_RW_RETRIES=3) and AI-assisted fallback for `match_lineup` post-deadline remain active (since 2026-04-29). `player_stat` 30-min API-lag grace window added to resolver (skip instead of void within 30 min of `resolves_after`).

This document is the authoritative reference for the `REAL_WORLD` question lane. Read it before building, modifying, or debugging any part of the REAL_WORLD pipeline.

For tier pricing and monetization rules, see `docs/TIER_ARCHITECTURE.md`.  
For prematch questions, see `docs/PREMATCH_QUALITY_ANALYTICS.md`.  
For live questions, see `docs/LIVE_QUESTION_SYSTEM.md`.

---

## 1. What REAL_WORLD Questions Are

### Definition

`REAL_WORLD` questions are a **premium intelligence layer** built from real-world developments outside the live match event stream. They are based on news, injuries, transfers, coach situations, lineup expectations, and official announcements — not match events or statistics.

They are NOT core match questions. They are a premium add-on.

### Examples

- Will Player X start the next match?
- Will Coach X be sacked before the next fixture?
- Will Player Y miss the upcoming match through injury?
- Will Player Z maintain his scoring form and get on the scoresheet?

### What makes them different from CORE_MATCH questions

| | CORE_MATCH_PREMATCH | CORE_MATCH_LIVE | REAL_WORLD |
|---|---|---|---|
| Generated | Before kickoff | During match | Based on news signals |
| Data source | Sports API (fixtures, standings, injuries) | Live match state | Google News RSS + player DB |
| Answer window | Until kickoff | 2–5 minutes | Hours to days |
| Resolves | Post-match (~2–3h after kickoff) | Within minutes of closing | At `resolution_deadline` |
| Feed priority | 2nd | **1st — always** | 3rd |
| Tier gate | All tiers | Starter (limited) / Pro / Elite | Pro (limited) / Elite (full) |
| Pool reuse | Yes | No | No |
| Match required | Yes (`match_id` NOT NULL) | Yes | Yes — bound to 7-day target match (`match_id` NOT NULL) |
| Volume | Up to weekly quota | Up to 3 active / 3-min rate limit | **Max 3 per league per week** |

### Critical product rule

**Spontix is a Core Match Questions product. REAL_WORLD is a premium intelligence add-on. This relationship must never be reversed.**

REAL_WORLD questions must never:
- Replace or crowd out `CORE_MATCH_LIVE` or `CORE_MATCH_PREMATCH` questions
- Appear above a live question in the feed
- Be the primary content type for any league

---

## 2. Tier Gating

| Tier | Access | Limit |
|---|---|---|
| Starter | 🔒 Locked | 0 — shown as locked state in feed |
| Pro | ⚠️ Limited | 10 REAL_WORLD questions per league per month |
| Elite | ✅ Full | Unlimited (weekly cap still applies) |

### Per-league opt-in: `real_world_enabled` (migration 055)

Each league has a `real_world_enabled BOOLEAN NOT NULL DEFAULT true` column. The REAL_WORLD generation pass is skipped entirely if `real_world_enabled = false`. Default is `true` so leagues created before the UI update continue receiving REAL_WORLD questions. The Create League UI sets this field when the user toggles the Real World question type card — deselecting Real World sets it to `false`.

Also skipped (regardless of flag): `question_style = 'live'` — live-only leagues never receive REAL_WORLD questions.

### User-controlled weekly intensity: `real_world_questions_per_week` (migration 055)

Each league stores `real_world_questions_per_week INTEGER DEFAULT 2 CHECK (1–3)`. This is the creator's chosen intensity:
- 1 = Low (max 1 REAL_WORLD question per week for this league)
- 2 = Medium (default)
- 3 = High (max 3 — same as platform cap)

The effective weekly limit is `MIN(user_cap, platform_cap=3)`. Skip reasons:
- `real_world_user_weekly_cap` — user's chosen cap hit before platform cap
- `real_world_weekly_cap` — platform cap hit

### Weekly cap — applies to ALL tiers including Elite

**Max 3 REAL_WORLD questions per league per ISO week (Monday 00:00 UTC through Sunday 23:59 UTC).** This is a production safety rule, not a monetization rule. It prevents flooding and cost overruns. A bug in the pipeline cannot produce more than 3 questions per league per week.

### Quota check flow (`checkRealWorldQuota()` in `lib/quota-checker.ts`)

1. **User + platform weekly cap** — effective limit = `MIN(league.real_world_questions_per_week ?? 2, 3)`. Count `REAL_WORLD` questions since Monday 00:00 UTC. If ≥ limit → `real_world_user_weekly_cap` or `real_world_weekly_cap`
2. **Tier check** — Starter: `real_world_tier_locked`. Pro: count this month → block if ≥ 10 (`real_world_quota_reached`). Elite: allowed.
3. **Fail-safe** — DB error on either count query → `real_world_quota_check_failed` (fail-closed, not fail-open)

---

## 3. Generation Pipeline — 4 Calls

The full pipeline runs inside `generate-questions/index.ts` in the **REAL_WORLD pass** — a separate loop that runs after the prematch and live loops, before `finaliseRun()`.

```
For each ai-enabled football league:
  ① checkRealWorldQuota()          — weekly cap (3/week) + tier gate
  ② fetchSportsContext()           — upcoming matches, standings, injuries, keyPlayers
  ③ Select 7-day target matches    — filter upcomingMatches to 0 < kickoff ≤ 7 days; SKIP if none
  ④ fetchNewsContext()             — Google News RSS (BROAD + SIGNAL + PLAYER BOOST)
  ⑤ mergeKnownPlayers()            — team_players DB + keyPlayers combined
  ⑥ enrichArticlesWithScraper()    — deep-read top 5 candidates via scraper service (optional)
  ⑦ Call 1: generateRealWorldQuestion()   — generate question bound to a target match
  ⑧ Call 2: convertToPredicate()         — convert to structured resolution predicate
  ⑨ Hard binding validation        — predicate.match_id must match a 7-day target match; SKIP if not
  ⑨b blocked — admin UI required  — skip `manual_review` predicate type; continue retry loop (no admin review UI — always auto-voids)
  ⑩ Call 3: generateRealWorldContext()   — curated sources + context snippet
  ⑪ Call 4: scoreRealWorldQuestion()     — quality gate: APPROVE / WEAK / REJECT
  ⑫ validateQuestion()                    — 4-stage validator
  ⑬ INSERT into questions table (match_id always NOT NULL)
```

### Article Enrichment Layer (`enrichArticlesWithScraper()`)

The Google News RSS adapter is the **discovery layer** — it surfaces candidate articles quickly using RSS feeds. The scraper service is the **enrichment layer** — it deep-reads the full article body for the top-ranked candidates so Call 1 has more signal than a 280-character RSS snippet.

**How it works:**

1. After news discovery and scoring, the top candidates (max 5 unique URLs) are sent to the scraper service concurrently.
2. The scraper renders each page via headless Chromium and extracts clean article text using Mozilla Readability.
3. `extracted_context` (first 800 chars of the extracted body) is attached to each article before it is passed to Call 1.
4. If the scraper is unreachable, times out (10s), or returns an extraction failure, the article falls back to its RSS `summary` — the pipeline continues uninterrupted.

**Key design constraints:**
- Max 5 articles enriched per league per run — bounds cost and latency
- Enrichment runs once per league, not per retry attempt — the same URL is never scraped twice in a single run
- `extracted_text` is capped at 3,000 chars by the scraper service; `extracted_context` is capped at 800 chars by the integration layer
- Extracted text is **ephemeral** — it is never stored in the database; it lives only in memory for the duration of the generation run
- Call 1 is instructed to prefer `extracted_context` over `summary` when identifying the specific news signal

**Call 1 prompt instruction (STEP 0):**
> If a news_item includes "extracted_context", READ IT — it is the full article text and is more reliable than the RSS summary. Prefer extracted_context over summary when identifying the specific news signal.

**Log events:**

| Event | When |
|---|---|
| `real_world_article_scrape_attempt` | Before each scraper HTTP request |
| `real_world_article_scrape_success` | Article text extracted successfully |
| `real_world_article_scrape_failed` | Network error, timeout, or non-200 response |
| `real_world_article_scrape_fallback_to_rss` | Scraper returned a failure extraction_status |

**Environment variables required:**
- `SCRAPER_API_URL` — full base URL of the scraper service (e.g. `https://spontyx-scraper-service-production.up.railway.app`)
- `SCRAPER_API_KEY` — value passed as `x-scraper-key` header

If either variable is absent, enrichment is skipped entirely and the pipeline behaves exactly as before deployment of the scraper. This makes the scraper a safe, optional enhancement with no downside if unavailable.

### Call 1 — Generate (`generateRealWorldQuestion()`)

**Model:** `gpt-4o-mini`, `temperature: 0.9`  
**Prompt version:** v2.9  
**Input:**
- Scored news articles from Google News RSS (BROAD + SIGNAL + PLAYER BOOST)
- `league_scope` — string describing the league (e.g. "Premier League, team-specific: Arsenal")
- `upcoming_matches[]` — **7-day target matches only** (filtered from upcomingMatches before this call; 0 < kickoff ≤ 7 days)
- `known_players[]` — `mergedKnownPlayers` (team_players DB top-8 per team + keyPlayers injury list), deduplicated by player ID
- `now_timestamp` — current UTC time

**Output:** `RawRealWorldQuestion` with:
- `question_text` — the question (binary YES/NO)
- `news_narrative_summary` — why this question is worth asking
- `confidence_level` — `low | medium | high`
- `resolution_type_suggestion` — hint for Call 2
- `resolution_condition` — human-readable resolution criteria
- `resolution_deadline` — ISO timestamp when it must resolve
- `entity_focus` — `player | coach | team | club`
- `predicate_hint` — structured hint for Call 2

#### v2.9 prompt structure — CORE RULE, TRACEABILITY RULE, TARGET MATCH CONSTRAINT

The v2.9 prompt opens with a non-negotiable hard constraint:

> **CORE RULE (HARD CONSTRAINT):** A question MUST ONLY be generated if there is a clear, specific news-driven trigger. If no strong, concrete signal exists → return `{ "skip": true }`. DO NOT generate fallback or generic questions.

**STEP 0 — explicit pre-writing checklist:**
1. Read every news item headline + summary
2. Identify the exact piece of news that creates a prediction-worthy signal
3. Ask: "What specific statement or implication from the news caused this question?" → if unanswerable → SKIP
4. Check upcoming_matches[] — pick the match whose teams match the news story
5. Check known_players — find the player_id if the story names a player
6. Apply the QUALITY BAR — if any answer is "no" → SKIP

**WHAT COUNTS AS A VALID NEWS SIGNAL (6 categories):**
1. Player availability uncertainty (injury confirmed/reported, fitness doubt, suspension risk, return from layoff)
2. Lineup expectation (player expected to start, benched, rotated, recalled)
3. Strong player form — explicitly stated in news (e.g. "scored in last 3 matches")
4. Disciplinary context (one card from suspension, noted booking risk)
5. Coach / club situation with immediate match impact (pressure, tactical change confirmed)
6. Imminent event tied to the upcoming match (NOT long-term transfers unless within 48h)

**WHAT IS STRICTLY FORBIDDEN:**
- "Will Player X score?" — unless news explicitly reports recent scoring form
- "Will Player X get a yellow card?" — unless news flags suspension risk specifically
- "Will Team X win?" — never (generic match prediction)
- Any question that would exist WITHOUT the news signal
- Questions based on vague match previews with no specific uncertainty
- Questions where the outcome is >85% or <15% certain
- Questions based on rumour-only with no objective resolution path

**TRACEABILITY RULE:**
> The question MUST be traceable to a specific statement or implication from the news. Before finalising, the model internally verifies: "What exact piece of news caused this question?" — if unanswerable → SKIP.

**TARGET MATCH CONSTRAINT (HARD RULE — added v2.9):**
- Model must identify which team or player the news references and find that entity's match in `upcoming_matches[]`
- The selected `match_id` is mandatory in `predicate_hint` — omission or fabrication → `{ "skip": true }`
- If the news signal is not clearly connected to any team or player in the listed matches → skip
- Questions that could apply to multiple matches or to "the next game in general" are forbidden
- Valid: "After reports Player X is doubtful for Arsenal vs Chelsea, will Player X be in the squad?" ✓
- Invalid: "Will Player X score this weekend?" ✗ — generic, not bound to a specific match

**QUALITY BAR — all 4 must be YES before generating:**
- Is this question clearly derived from a specific news item?
- Would this question exist WITHOUT the news? (If yes → SKIP)
- Is it specific and tied to a real upcoming match?
- Does it have a clear, objective YES/NO resolution path?

**5 question types in priority order:**

| Priority | Type | Resolution predicate | Hard rule |
|---|---|---|---|
| 1 (highest) | Injury / availability | `match_lineup` | Use whenever player in news as injured/doubtful/suspended + upcoming match exists |
| 2 | Suspension / yellow card risk | `player_stat` (yellow_cards) | ONLY when news explicitly names player as suspension risk |
| 3 | Match-driven player form | `player_stat` (goals/assists) | ONLY when form is explicitly stated in news, not implied |
| 4 | Coach / club status | `manual_review` (coach_status) | FALLBACK ONLY — **blocked until admin review UI ships** (always auto-voids) |
| 5 (lowest) | Transfer / announcement | `manual_review` (transfer) | LAST RESORT — **blocked until admin review UI ships** (always auto-voids) |

**Skip conditions:**
- Model returns `{ skip: true }`, `{ skip_reason: "..." }`, `{ SKIP: true }`, or missing `question_text` → skip
- Any of 7 required fields missing, invalid, or past-dated → skip
- QUALITY BAR fails on any of 4 checks → skip

### Call 2 — Predicate (`convertToPredicate()`)

**Model:** `gpt-4o-mini`, `temperature: 0.1`  
**Input:** `predicate_hint` from Call 1 output  
**Output:** structured `ResolutionPredicate` (one of 5 types)

After Call 2:
- **Hard binding validation**: `rwPredicate.match_id` is looked up against the `targetMatches` (7-day window) list only — **no fallback to `[0]`**. If the ID is missing or doesn't match any target match → skip with `real_world_match_binding_failed`. This is the enforcement point for the TARGET MATCH CONSTRAINT.
- `entity_focus` is cross-validated against predicate type and normalised:
  - `match_lineup` / `player_stat` → must be `'player'`
  - `match_stat` / `btts` / `match_outcome` → must be `'team'`
  - `manual_review` → accepted as-is
- `player_ids` extracted from predicate and written to `questions.player_ids`
- **`match_lineup` deadline override**: `resolution_deadline` overridden to `upcomingMatch.kickoff` regardless of what Call 1 returned
- **Near-kickoff guard**: if `match_lineup` and < 60 min to kickoff → skip (lineups released ~1h before kickoff; near-kickoff = guaranteed `checkTemporal` failure)
- **`manual_review` backfill**: `resolution_deadline` copied from `rawRW.resolution_deadline` into the predicate object (Call 2 doesn't include it; needed for `checkSchema`)

### Call 3 — Context + Sources (`generateRealWorldContext()`)

**Model:** `gpt-4o-mini`, `temperature: 0.3`, `response_format: json_object`  
**Input:** news items, question text, league teams, top players  
**Output:** `RwContextResult` — `{ context, confidence_explanation, sources[] }`

- `context` — 1–2 sentence fact-based explanation of why the question exists (shown to users in feed)
- `sources[]` — up to 3 curated news sources: `{ source_name, published_at, title, url }`, different publishers, most recent, relevance-ranked
- Pre-seeded from `rawRW.news_narrative_summary` before the call — if Call 3 fails on a network error, `rwContextText` is still meaningful
- Source fallback: if Call 3 returns no sources, falls back to enriched `NewsItem` objects from the news fetch (title, source_name, published_at)

### Call 4 — Quality Gate (`scoreRealWorldQuestion()`)

**Model:** `gpt-4o-mini`, `temperature: 0.0`, `response_format: json_object`  
**Input:** question text, context, sources, confidence level, resolution type, deadline, entity focus  
**Output:** `RwQualityResult` — `{ final_score, decision, breakdown, reason }`

**6-dimension scoring (max 100):**

| Dimension | Range | What it measures |
|---|---|---|
| `news_link_strength` | 0–25 | How tightly the question is derived from the news |
| `clarity` | 0–15 | Ease of understanding |
| `resolvability` | 0–25 | Objective resolution path exists |
| `relevance` | 0–20 | Fan interest and impact |
| `uniqueness` | 0–15 | Real insight vs generic question |
| `risk` (penalty) | −30–0 | Genericness, obviousness, invalidity |

**Decision thresholds:**

| Score | Decision | Action |
|---|---|---|
| 80–100 | APPROVE | Always publish |
| 65–79 | WEAK | Publish only if `rwLeagueApproved === 0` for this league this run |
| 0–64 | REJECT | Discard, log, continue |
| null (network fail) | Treat as WEAK (score=65) | Safe fallback — bad network day never silently empties the feed |

**WEAK fairness rule:** `rwLeagueApproved` is a per-league counter (reset to 0 for every league in the loop). A PREMATCH or LIVE question generated earlier in the same run does NOT block REAL_WORLD WEAK publishing. Only an APPROVE from the same league's REAL_WORLD pass blocks it.

**`btts` → `'match_stat'`** passed to Call 4 scorer — the quality prompt doesn't list `btts` as a known type and would apply a risk penalty; mapping to the semantically equivalent `match_stat` prevents false REJECT outcomes.

---

## 4. Resolution Predicates

Five predicate types are supported. Each has different timing, resolver behaviour, and auto-void rules.

### `match_lineup`

**What it resolves:** Did player X appear in the starting XI or squad for a specific match?

```json
{
  "resolution_type": "match_lineup",
  "match_id": "1391140",
  "sport": "football",
  "player_id": "12345",
  "player_name": "Marcus Rashford",
  "check": "starting_xi"
}
```

**Timing:**
- `resolution_deadline` = `kickoff` (overridden from Call 1 output)
- `answer_closes_at` = `deadline` (kickoff)
- `resolves_after` = `kickoff + 91min` — **note:** must be `kickoff + 91min`, not `kickoff`. Bug existed pre-2026-05-05 (set to bare `kickoff`), causing every `match_lineup` question to fail Stage 3 `checkTemporal` silently. Fixed in `generate-questions/index.ts`.
- Auto-void fires at: `kickoff + 1h`
- Near-kickoff guard: skipped if < 60 min to kickoff

**Resolver:** reads `live_match_stats.lineups`. Returns:
- `correct` if player found in `startXI` or `substitutes`
- `incorrect` if both teams' lineups present and player not found
- `unresolvable('lineups_not_available')` — retried next cycle (lineups not in cache yet)
- `unresolvable('lineups_incomplete')` — retried next cycle (only one team's lineup present) unless player found in available data

### `player_stat`

**What it resolves:** Did player X achieve a specific stat threshold in a match?

```json
{
  "resolution_type": "player_stat",
  "match_id": "1391140",
  "sport": "football",
  "player_id": "12345",
  "player_name": "Marcus Rashford",
  "field": "yellow_cards",
  "operator": "gte",
  "value": 1
}
```

**Valid fields:** `goals`, `assists`, `shots`, `cards`, `yellow_cards`, `minutes_played`, `clean_sheet`, `passes_total`, `passes_key`, `dribbles_attempts`, `dribbles_success`, `tackles`, `interceptions`, `duels_total`, `duels_won`

**Timing:**
- `answer_closes_at` = kickoff
- `resolves_after` = `deadline + 30min`
- Auto-void fires at: `deadline + 1h`

**Resolver:** reads player stats from `live_match_stats.player_stats` (populated by live-stats-poller from `/fixtures/players` endpoint).

**API-lag grace window (30 min post `resolves_after`):** If the resolver returns `player_not_in_stats` or `player_stat_unavailable` and fewer than 30 minutes have elapsed since `resolves_after`, the question is skipped (retried next hourly cycle) instead of immediately voided. This covers the typical API-Sports propagation delay (~10–15 min post-FT). After 30 minutes the grace expires and the question voids normally. Log events: `player_stat_lag_skip` (skipping) and `player_stat_lag_grace_expired` (voiding after grace).

### `match_stat`

**What it resolves:** Did a specific team stat meet a threshold?

**Timing:** same as `player_stat` — `answer_closes_at` = kickoff, `resolves_after` = `deadline + 30min`.

**Resolver:** reads `live_match_stats.team_stats`.

### `btts`

**What it resolves:** Did both teams score in the match?

```json
{
  "resolution_type": "btts",
  "match_id": "1391140",
  "sport": "football"
}
```

**Timing:** same as `player_stat` — `answer_closes_at` = kickoff, `resolves_after` = `deadline + 30min`.

**Resolver:** `home_score >= 1 && away_score >= 1` → correct. Otherwise → incorrect.

### `manual_review`

**What it resolves:** Admin-confirmed outcomes (coach sacking, transfer completion, disciplinary).

```json
{
  "resolution_type": "manual_review",
  "category": "coach_status",
  "description": "Will Mikel Arteta be sacked before the next Premier League fixture?",
  "resolution_deadline": "2026-05-05T18:00:00Z",
  "source_urls": ["https://..."]
}
```

**Timing:**
- `answer_closes_at` = kickoff of the bound match (users cannot change their answer once the match starts)
- `resolves_after` = `deadline + 91min`
- Auto-void fires at: `deadline + 1h`

**Generation guard:** After Call 2 and hard binding validation, any `manual_review` result is skipped with log key `real_world_attempt_skip_manual_review` and the retry loop continues. This prevents the daily quota from being consumed by a question that will always auto-void, and gives the retry loop a chance to find a TYPE 1–3 question instead.

**Resolver:** skips immediately (logged as `[resolve] skipping manual_review question X (pending admin action, deadline=...)`). No AI verifier call. If deadline passes without admin resolution, auto-void fires at `deadline + 1h`. No admin review UI exists — `manual_review` questions cannot be resolved by any path; they always auto-void.

**Restore path:** Remove the generation guard block and re-add `tryAiVerification` in the resolver when the admin review UI is shipped.

---

## 5. Timing Model

Every REAL_WORLD question carries all three mandatory timestamps, and is hard-bound to a specific match kicking off within 7 days of generation.

| Timestamp | Purpose |
|---|---|
| `visible_from` | When the question appears in the feed (= `now` at generation) |
| `answer_closes_at` | Last moment a user can submit (kickoff for all match-bound types) |
| `resolves_after` | When the resolver evaluates the outcome (always strictly after `answer_closes_at`) |

### `answer_closes_at` by predicate type

| Predicate | `answer_closes_at` | Rationale |
|---|---|---|
| `match_lineup` | kickoff | Lineups released ~1h before kickoff; users answer until then |
| `player_stat` | kickoff | Close before live match data can influence answers |
| `match_stat` | kickoff | Same as player_stat |
| `btts` | kickoff | Same as player_stat |
| `manual_review` | kickoff | Users cannot change answer once the bound match starts |

### Auto-void rule

The resolver voids any question where:
```
now > resolution_deadline + 1 hour
```
This applies to all predicate types. It prevents dead questions from sitting in `pending` indefinitely after their deadline passes.

### 7-day match binding rule

REAL_WORLD questions may only be generated when at least one upcoming match kicks off within 7 days. The filter runs immediately after `fetchSportsContext` — before `fetchNewsContext` and the `team_players` DB query, so no RSS quota is burned for leagues with no 7-day fixture. The pipeline:
1. Filters `upcomingMatches` to `0 < msUntilKickoff ≤ SEVEN_DAYS_MS (7 × 24h)` → `targetMatches`
2. If `targetMatches` is empty → skip this league for the current run (log: `no upcoming match within 7 days`)
3. Passes only `targetMatches` to Call 1 and Call 2 — the model selects the one relevant to the news signal
4. After Call 2, validates `predicate.match_id` is in `targetMatches` — no fallback

---

## 6. News Fetching — Google News RSS

No API key required. Three RSS queries are built and fetched in parallel.

### Query types (`lib/news-adapter/google-news-rss.ts`)

**BROAD** — wide net for the league or team:
```
("Premier League" OR "EPL") (team_A OR team_B OR ...)
```

**SIGNAL** — same scope, keyword-anchored:
```
("Premier League" OR ...) AND (injury OR "ruled out" OR suspension OR transfer OR coach OR lineup OR ...)
```

**PLAYER BOOST** — targeted player signals (when `topPlayers` is non-empty):
```
("Player1" OR "Player2" OR ...) AND (TeamName) AND (injury OR ...)
```

Caps at 12 player names. Anchored to team context to suppress cross-league false positives.

### Scoring pipeline (per article)

| Dimension | Max | What it measures |
|---|---|---|
| RELEVANCE | 25 | Team match in headline |
| FRESHNESS | 15 | <6h=15, <24h=12, <48h=8, <72h=4, else=1 |
| CREDIBILITY | 20 | Known source tier (BBC/Sky/ESPN=20, tabloids=12, unknown=8) |
| RESOLVABILITY | 25 | Injury/lineup signal=22–25, coach=18, transfer=15, other=5 |
| IMPACT | 15 | Named player=12, coach story=10, multi-team=10 |
| RISK | −30–0 | Clickbait, <50 chars, irrelevant topic |

**Thresholds:** ≥80=GENERATE, 65–79=MAYBE, 50–64=CONTEXT_ONLY, <50=SKIP  
Only GENERATE articles are passed to Call 1. Falls back to MAYBE only when no GENERATE exists.  
Cap: 10 articles per run. Deduplication by Jaccard word similarity (threshold 0.50).

---

## 7. Player Database

Migration 026 created three tables that power the PLAYER BOOST query and known_players context.

### Tables

**`teams`** — `PRIMARY KEY (sport, external_team_id)`. Auto-populated from lineups.

**`players`** — `PRIMARY KEY (sport, external_player_id)`. Auto-populated from lineups.

**`team_players`** — `PRIMARY KEY (sport, external_team_id, external_player_id)`. Tracks `relevance_score`, `last_seen_at`, `position`, `shirt_number`, `source`.

### Relevance scoring

| Event | Score contribution |
|---|---|
| Starting XI (lineup) | +10 (base) |
| Substitute (lineup) | +4 (base) |
| Goal scored | +8 cumulative |
| Assist | +6 cumulative |
| Card received | +5 cumulative |
| Cap | 100 |

### Data flow

`live-stats-poller` → detects lineups + match events → calls `sync_lineup_players()` RPC + `sync_match_events()` RPC → updates `team_players` relevance scores.

`generate-questions` REAL_WORLD pass → queries `team_players WHERE last_seen_at > now() - 90 days ORDER BY relevance_score DESC LIMIT 8` per team → combines both teams → passes to `fetchNewsContext()` as `topPlayers` → used in PLAYER BOOST RSS query.

### `mergedKnownPlayers`

Before Call 1, two player sources are merged and deduplicated by player ID:
1. **team_players DB** — top-8 by relevance from each team in upcoming match (covers full fit squad)
2. **`sportsCtx.keyPlayers`** — injury/fitness/suspension list from the sports adapter (~5–15 players)

This ensures both squad players (TYPE 2/3 questions) and injured players (TYPE 1 questions) are available to Call 1. Without the merge, TYPE 2/3 player predicates would fail entity validation because fit squad players have no entry in `keyPlayers`.

---

## 8. Validation (4-Stage Validator)

All REAL_WORLD questions pass through the same 4-stage validator as CORE_MATCH questions, with two REAL_WORLD-specific exemptions.

### Stage 1 — `checkSchema`

Validates: correct `resolution_type`, required fields present, correct types, `match_id` present (required for all REAL_WORLD types — see binding rule below), `binary_condition` present for `match_stat`/`player_stat`.

Special handling:
- `btts` — early return before binary_condition check (no `binary_condition` field)
- `match_stat_window` — early return (no `binary_condition` field)
- `manual_review` — early return before `sport` field check (no `sport` field)
- `match_lineup` — early return, validates `match_id`, `player_id`, `player_name`, `check` field

### Stage 2 — `checkEntities`

Validates: `match_id` exists in `sportsCtx.upcomingMatches`, team IDs and player IDs exist in context.

**REAL_WORLD exemptions:**
- `match_lineup` predicates — `player_id` check skipped (TYPE 1 questions are specifically about players who may not be in `keyPlayers` because they're injured/suspended)
- `player_stat` predicates when `questionType === 'REAL_WORLD'` — `player_id` check skipped (TYPE 2/3 questions target fit squad players not on the injury list)

### Stage 3 — `checkTemporal`

Validates: `opens_at` within 7 days, `deadline` in future, `resolves_after >= deadline + 90min`.

`manual_review` `resolution_deadline` backfill (happens before this stage): the deadline is copied from `rawRW.resolution_deadline` into the predicate object so `checkSchema` can find it.

### Stage 4 — `checkLogic`

Validates: field names are in `VALID_FIELDS`, operator is valid, value is a number, `match_stat_window` window sizes are correct.

**`player_stat` VALID_FIELDS:**
`goals`, `assists`, `shots`, `cards`, `yellow_cards`, `minutes_played`, `clean_sheet`, `passes_total`, `passes_key`, `dribbles_attempts`, `dribbles_success`, `tackles`, `interceptions`, `duels_total`, `duels_won`

### Hard match binding rule (pre-validation, runs after Call 2)

This check runs **before** the 4-stage validator and is the enforcement point for the TARGET MATCH CONSTRAINT from the v2.9 prompt.

```
skip reason: real_world_match_binding_failed
```

Triggered when either:
1. `rwPredicate.match_id` is absent or empty string, OR
2. `rwPredicate.match_id` does not match any match in `targetMatches` (the 7-day filtered list)

```typescript
const upcomingMatch = rwPredicateMatchId
  ? (targetMatches.find((m) => String(m.id) === rwPredicateMatchId) ?? null)
  : null;

if (!upcomingMatch) {
  // skip — real_world_match_binding_failed
}
```

No fallback is attempted. A question with a match_id outside the 7-day window, a fabricated ID, or no ID at all is discarded at this point. This ensures `match_id` on every inserted REAL_WORLD question is a valid, known, upcoming-within-7-days match.

---

## 9. Resolver Behaviour

The resolver (`resolve-questions/index.ts`) runs every hour via pg_cron. For REAL_WORLD questions:

### Auto-void check (runs first)

```typescript
if (q.resolution_deadline && now > new Date(q.resolution_deadline).getTime() + 60 * 60 * 1000) {
  // void the question
}
```

Fires before predicate evaluation. Any REAL_WORLD question past its deadline+1h is voided immediately.

### `manual_review` — blocked until admin review UI ships

`manual_review` questions are blocked at two points:

**Generation guard (before insert):** After Call 2 returns a `manual_review` predicate, a hard skip fires immediately — the retry loop continues searching for TYPE 1–3 questions. Log event: `real_world_attempt_skip_manual_review`.

**Resolver:** logged and skipped — no AI verifier call.

```typescript
if (pred.resolution_type === 'manual_review') {
  console.log(`[resolve] skipping manual_review question ${q.id} (pending admin action, deadline=${q.resolution_deadline ?? 'none'})`);
  runStats.skipped++;
  continue;
}
```

If a `manual_review` question exists in the DB (created before 2026-05-05), it stays `pending` until `deadline + 1h`, then auto-voids. No AI verifier is called.

### `match_lineup` — AI fallback after deadline passes

If `evalMatchLineup` returns `unresolvable` (reason: `lineups_not_available` or `lineups_incomplete`):

- **Deadline has not passed** → skip (retry next hourly cycle). Lineups usually arrive ~1h before kickoff.
- **Deadline has passed + REAL_WORLD** → attempt AI web verification before voiding.
- **Deadline has passed + not REAL_WORLD**, or AI could not resolve → void with `unresolvable` reason.

Optimistic check is still active: if the player IS found in partial lineup data (one team returned, player is on that team) → resolves as `correct` immediately rather than waiting for both teams.

### AI fallback resolution — rules and log events

**Allowed predicate types:** `manual_review`, `match_lineup`

**Forbidden predicate types:** `player_stat`, `match_stat`, `btts`, `match_outcome`, `multiple_choice_map` — these must rely on official API data only. The verifier returns `null` for these immediately.

**Resolution rules:**

| AI result | Action |
|---|---|
| `high` confidence (any source count) | Resolve — `resolution_source = 'ai_web_verification'` |
| `medium` confidence + ≥2 sources | Resolve — `resolution_source = 'ai_web_verification'` |
| `medium` confidence + <2 sources | Return false → allow auto-void |
| `low` confidence | Return false → allow auto-void |
| `decision = unresolvable` | Return false → allow auto-void |
| null (network/parse failure) | Return false → allow auto-void |

**Log events (all include `question_id`, `predicate_type`, `decision`, `confidence`, `source_count`):**

| Event | When |
|---|---|
| `real_world_ai_resolution_attempt` | Before calling the verifier |
| `real_world_ai_resolution_success` | Strong result — question resolved |
| `real_world_ai_resolution_failed` | Null result, network error, or insufficient confidence/sources |
| `real_world_ai_resolution_voided` | AI ran but result is `unresolvable` or `low` confidence |

**Implementation:** `supabase/functions/resolve-questions/lib/ai-verifier.ts`

Uses the OpenAI **Responses API** (`POST /v1/responses`) — not Chat Completions — with `tools: [{ type: 'web_search_preview' }]` and `tool_choice: 'required'`. Response parsed from `output[].content[].text`. 30s timeout. Requires `OPENAI_API_KEY` in Supabase Secrets (already present from generate-questions).

**Verifier system prompt** (`AI_VERIFIER_SYSTEM_PROMPT` in `ai-verifier.ts`) — strict verification-only framing:
- Identity: "verification engine, not a predictor" — explicitly not a guesser or predictor
- Core rule: model must be able to answer "What exact source confirms this?" before deciding — otherwise `unresolvable`
- Source requirements: official club/league sites, BBC Sport, ESPN, Sky Sports, reputable journalists only; forums, low-quality blogs, unattributed aggregators forbidden
- Decision rules: `correct` requires explicit confirmation; `incorrect` requires explicit counter-confirmation; `unresolvable` on any ambiguity, conflict, or vague implication
- Confidence: `high` = multiple reliable sources or one authoritative explicit source; `medium` = one source but not fully explicit (requires ≥2 independent sources to resolve); `low` = weak/indirect evidence
- Forbidden: fabricating sources, assuming match outcomes, inferring from partial stats, using prior knowledge without citation, resolving by probability or intuition
- Final self-check: three questions the model must answer before outputting; any doubt → `unresolvable`

**Resolution priority order (complete):**

1. Standard predicate evaluation (official API data)
2. Retry cycles (lineups: skip until cache populated; manual_review: skip — no admin review UI)
3. AI web verification — last resort, REAL_WORLD + **`match_lineup` post-deadline only** (`manual_review` bypassed — no admin review UI)
4. Auto-void (`resolution_deadline + 1h` grace)

---

## 10. Feed Rendering (league.html)

### Card anatomy

```
[ REAL WORLD badge ]  [ engagement badges ]  [ time remaining ]
Premium intelligence · AI-sourced  [ HIGH confidence ]
"Why this question exists — the Call 3 context snippet."
─────────────────────────────────────────────────────────
Question text
─────────────────────────────────────────────────────────
[ Yes ]  [ No ]
─────────────────────────────────────────────────────────
[ 🕐 4m 30s left ]                    [ Up to 15 pts ]
🗓 Resolves by 2 May 2026  ·  📰 BBC Sport · Haaland ruled out...
```

### Confidence badge colours

| Level | Colour |
|---|---|
| `high` | Lime (`#A8E10C`) |
| `medium` | Orange (`#FF9F43`) |
| `low` | Coral (`#FF6B6B`) |

### Source links

Call 3 returns structured sources: `{ source_name, published_at, title, url }`. Up to 3 sources rendered as individual titled links: `📰 [Article title] · Publisher`. Titles truncated to 55 chars.

Legacy fallback (questions generated before Call 3 structured output): plain URL strings → generic "View sources (N)" link.

### Feed priority

REAL_WORLD cards are always last in the feed. Enforced by `lanePriority` in `loadAndRenderQuestions()`:
```javascript
const lanePriority = { 'LIVE': 0, 'PREMATCH': 1, 'REAL_WORLD': 2 };
```
A REAL_WORLD card never appears above a CORE_MATCH card.

### DB columns fetched

```javascript
'rw_context', 'confidence_level', 'entity_focus', 'resolution_deadline',
'source_news_urls', 'question_type', 'match_id'
```

---

## 11. Database Columns

All on the `questions` table:

| Column | Type | Description |
|---|---|---|
| `question_type` | TEXT | Always `'REAL_WORLD'` |
| `source_badge` | TEXT | Always `'REAL WORLD'` |
| `resolution_condition` | TEXT | Human-readable resolution criteria (shown to users) |
| `resolution_deadline` | TIMESTAMPTZ | Hard deadline — auto-void fires at deadline+1h |
| `source_news_urls` | JSONB | Array of `{ url, title, source_name, published_at }` objects |
| `entity_focus` | TEXT | `player \| coach \| team \| club` |
| `confidence_level` | TEXT | `low \| medium \| high` |
| `rw_context` | TEXT | Call 3 context snippet (shown to users) |
| `rw_quality_score` | INTEGER | Call 4 raw score (0–100) |
| `rw_quality_breakdown` | JSONB | `{ news_link_strength, clarity, resolvability, relevance, uniqueness, risk }` |
| `narrative_context` | TEXT | News narrative summary (Call 1 output) |
| `match_id` | TEXT | **NOT NULL — always required.** All REAL_WORLD questions are hard-bound to a 48h target match. |
| `player_ids` | TEXT[] | Extracted from predicate after Call 2 |

---

## 12. Analytics

### Views (migration 025 + 027)

**`analytics_realworld_summary`** — one row per day:
```sql
SELECT * FROM analytics_realworld_summary ORDER BY day DESC;
```
Columns: `day`, `total_generated`, `player_questions`, `coach_questions`, `team_questions`, `club_questions`, `high_confidence`, `medium_confidence`, `low_confidence`, `lineup_questions`, `manual_review_questions`, `match_stat_questions`, `player_stat_questions`, `btts_questions`, `approve_count`, `weak_count`, `reject_count`, `unknown_score_count`, `avg_quality_score`, `with_context`, `with_deadline`, `with_resolution_condition`, `with_source_urls`, `pending`, `resolved`, `voided`, `overdue_pending`

**`analytics_realworld_questions`** — one row per question:
```sql
SELECT * FROM analytics_realworld_questions LIMIT 20;
```
Columns: `id`, `created_at`, `league_name`, `question_text`, `entity_focus`, `confidence_level`, `resolution_condition`, `resolution_deadline`, `predicate_type`, `manual_review_category`, `rw_context`, `has_context`, `source_url_count`, `rw_quality_score`, `quality_decision`, `rw_quality_breakdown`, `answer_closes_at`, `resolves_after`, `ai_prompt_version`, `deadline_status`

### Key monitoring queries

```sql
-- Daily health check
SELECT day, total_generated, approve_count, weak_count, reject_count, avg_quality_score
FROM analytics_realworld_summary ORDER BY day DESC LIMIT 7;

-- Questions with overdue deadlines (resolver should have voided these)
SELECT id, question_text, entity_focus, resolution_deadline
FROM analytics_realworld_questions WHERE deadline_status = 'overdue';

-- Questions without context (Call 3 failed silently)
SELECT id, question_text, confidence_level
FROM analytics_realworld_questions WHERE has_context = false;

-- Quality score distribution
SELECT quality_decision, count(*), round(avg(rw_quality_score))
FROM analytics_realworld_questions GROUP BY quality_decision;

-- Rejection log (from generation_run_leagues)
SELECT league_id, rejection_log
FROM generation_run_leagues
WHERE rejection_log IS NOT NULL
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC LIMIT 10;
```

### Monitoring thresholds

| Metric | Green | Yellow | Red |
|---|---|---|---|
| `approve_count / total_generated` | > 60% | 40–60% | < 40% |
| `avg_quality_score` | > 75 | 65–75 | < 65 |
| `overdue_pending` | 0 | 1–2 | > 2 |
| `has_context = false` | 0 | 1–2 | > 2 |

---

## 13. File Map

| File | Role |
|---|---|
| `generate-questions/index.ts` | REAL_WORLD generation pass (~lines 2196–2760); `targetMatches` early-exit at ~line 2253 |
| `lib/openai-client.ts` | `generateRealWorldQuestion()` (Call 1), `generateRealWorldContext()` (Call 3), `scoreRealWorldQuestion()` (Call 4), `RW_GENERATION_SYSTEM_PROMPT`, `RW_CONTEXT_SYSTEM_PROMPT`, `RW_QUALITY_SYSTEM_PROMPT` |
| `lib/context-builder.ts` | `buildPredicatePrompt()` — Call 2 schema including Shape H (`match_lineup`) at ~line 490; `buildContextPacket()` for prematch/live |
| `lib/predicate-validator.ts` | `validateQuestion()` — all 4 stages; REAL_WORLD exemptions in `checkEntities` |
| `lib/quota-checker.ts` | `checkRealWorldQuota()` — weekly cap (3/week) + tier gate |
| `lib/news-adapter/google-news-rss.ts` | RSS fetch, scoring, dedup, entity extraction, PLAYER BOOST query |
| `lib/news-adapter/index.ts` | `fetchNewsContext()` wrapper — derives `knownTeams`, `leagueAliases`, passes `topPlayers` |
| `lib/types.ts` | `RawRealWorldQuestion`, `RwContextResult`, `RwQualityResult`, `MatchLineupPredicate`, `ManualReviewPredicate` |
| `resolve-questions/index.ts` | Deadline auto-void, `manual_review` skip, `LINEUP_RETRY_REASONS` |
| `resolve-questions/lib/predicate-evaluator.ts` | `evalMatchLineup()`, `evalBtts()`, `case 'manual_review'` |
| `resolve-questions/lib/stats-fetcher/football.ts` | `readLineupsFromCache()` |
| `live-stats-poller/index.ts` | `sync_lineup_players()` + `sync_match_events()` RPC calls |
| `league.html` | REAL_WORLD card rendering — `rw-card` CSS class, context snippet, confidence badge, source links, deadline |
| `backend/migrations/024_realworld_fields.sql` | `resolution_condition`, `resolution_deadline`, `source_news_urls`, `entity_focus`, `confidence_level`, `rw_context` columns |
| `backend/migrations/025_realworld_analytics_views.sql` | Original analytics views |
| `backend/migrations/026_realworld_player_database.sql` | `teams`, `players`, `team_players` tables + `sync_lineup_players` + `sync_match_events` RPCs |
| `backend/migrations/027_rw_quality_score.sql` | `rw_quality_score`, `rw_quality_breakdown` columns + rebuilt analytics views |

---

## 14. Known Limitations

| Limitation | Impact | Fix |
|---|---|---|
| `manual_review` blocked until admin UI ships | Generator skips `manual_review` before insert (no weekly quota burn); resolver skips without AI call. Questions always auto-void at `deadline+1h`. No admin review UI exists. | Remove generation guard and restore AI verifier in resolver when admin UI ships |
| Bounded retry loop active | System attempts up to 3 ranked news batches per league per run. REJECT questions are never published. Best WEAK published only if no APPROVE was found and `rwLeagueApproved === 0`. Items sorted by news quality score so attempt 1 has the strongest signals. | — |
| `rw_quality_breakdown` not shown in feed | Users see confidence badge but not why the question was scored | Surface breakdown in feed or admin view |
| Player DB cold-start | Fresh deployment has no `team_players` data — no PLAYER BOOST until poller runs for a live match. Also: `match_lineup` TYPE 1 questions for players absent from `mergedKnownPlayers` will have no `player_id` in the predicate_hint — Stage 1 schema check will reject them until the player DB is seeded. | Expected — populate naturally from first live match |
| `player_stat` API-lag false-void (mitigated) | API-Sports `/fixtures/players` can take 10–15 min to populate post-FT. Grace window (30 min post `resolves_after`) skips instead of voiding on `player_not_in_stats` / `player_stat_unavailable`. After 30 min, question voids. | Grace window active in resolver — no further action needed |
| Football only | `sport !== 'football'` guard skips all non-football leagues | By design until sport adapters are verified end-to-end |
| `match_lineup.check` defaults to `'squad'` | If Call 2 omits the field, question resolves as `correct` if player is anywhere in squad, not just starting XI. Shape H (explicit Call 2 schema) reduces this risk significantly. | Starting XI questions use correct value; monitor Call 2 output |
