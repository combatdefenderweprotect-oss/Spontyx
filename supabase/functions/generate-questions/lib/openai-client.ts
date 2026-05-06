import type { RawGeneratedQuestion, RawRealWorldQuestion, ResolutionPredicate, NewsItem, EnrichedNewsItem, RwContextResult, RwQualityResult } from './types.ts';

const OPENAI_BASE      = 'https://api.openai.com/v1/chat/completions';
const MODEL_GENERATION = 'gpt-4o-mini';  // creative call — upgrade to gpt-4o if quality drops
const MODEL_PREDICATE  = 'gpt-4o-mini';  // mechanical JSON conversion — mini is sufficient
export const PROMPT_VERSION = 'v2.9';

// ── System prompt for Call 1 (question generation) ───────────────────

const GENERATION_SYSTEM_PROMPT = `You are generating structured live sports prediction questions for Spontix.

Your goal is to generate HIGH-QUALITY, FAIR, RELEVANT, and FULLY RESOLVABLE questions
for a real-time sports prediction engine.

==================================================
CONTEXT INPUT
==================================================

- sport (soccer | hockey)
- league_type (Type1_single_match OR Type2_season)
- generation_mode (prematch OR live_event OR live_gap)

- match_id
- match_minute
- match_phase (early | mid | late)

- current_score
- home_team
- away_team

- recent_events
- last_event_type (goal | penalty | red_card | yellow_card | none)

- recent_questions
- recent_question_categories
- recent_stat_focus

- existing_question_count
- target_question_range
- max_questions_allowed

- active_question_count
- max_active_questions

- is_close_game
- is_blowout

- now_timestamp (ISO)

==================================================
PLAYER AVAILABILITY (CRITICAL — read before generating)
==================================================

The context may include a PLAYER AVAILABILITY section.

BLOCKED players (status: UNAVAILABLE):
→ DO NOT generate ANY question mentioning or depending on them
→ Blocked: scoring, assisting, receiving a card, starting, any stat
→ Generate a team-based alternative instead:
   "Will [Team] score without [Player]?"
   "Will [Team] win despite missing [Player]?"

DOUBTFUL players:
→ AVOID player-specific questions
→ If you must reference them, frame around the team

CONFIRMED STARTERS (when lineup section is present):
→ DO NOT ask "Will X start?" — the answer is already confirmed
→ "Will X score?" is ALLOWED only if X is listed as Starting XI or substitute
→ If lineup is confirmed and a player is NOT listed → treat as BLOCKED

If no PLAYER AVAILABILITY section is present:
→ Proceed normally, but avoid players flagged as injured in KEY PLAYERS

==================================================
PLAYER STATS — WHAT IS RESOLVABLE (READ CAREFULLY)
==================================================

All player stats are CUMULATIVE MATCH TOTALS only.
There are NO per-minute or time-window breakdowns for individual players.

AVAILABLE player_stat fields (use these exact names in predicate_hint):

  ALWAYS AVAILABLE:
  - goals              → total goals scored
  - assists            → total assists
  - shots              → total shots (on + off target)
  - cards              → yellow + red combined
  - minutes_played     → minutes on pitch
  - clean_sheet        → boolean (GK only, min 60 min played, 0 goals against)

  AVAILABLE when API returns data (may be null for some players):
  - passes_total       → total passes attempted
  - passes_key         → key passes (leading directly to a shot)
  - dribbles_attempts  → dribble attempts
  - dribbles_success   → successful dribbles
  - tackles            → total tackles
  - interceptions      → total interceptions
  - duels_total        → total duels contested
  - duels_won          → duels won

HARD LIMITS — NEVER violate these:
  ✗ DO NOT ask "will player X have Y passes in minutes 15–20" — time windows for player stats are impossible to resolve
  ✗ DO NOT ask about passes/tackles/dribbles in a specific half — only full-match totals are available
  ✗ DO NOT use player stats for hockey questions — not available in free tier, will be voided
  ✗ DO NOT ask about xG, expected goals, progressive passes — not in API response
  ✗ DO NOT ask about distance covered, sprint speed, heat maps — not in API response

GOOD question examples (full match total):
  ✓ "Will [Player] complete 40+ passes in the match?"
  ✓ "Will [Player] make 3+ key passes?"
  ✓ "Will [Player] attempt 5+ dribbles?"
  ✓ "Will [Player] win 6+ duels?"
  ✓ "Will [Player] make 2+ tackles?"

BAD question examples (impossible to resolve):
  ✗ "Will [Player] make 3 passes in the first 20 minutes?"
  ✗ "Will [Player] have more passes in the first half?"
  ✗ "Will [Player] complete 80% of his passes?" — accuracy% not a stat field

predicate_hint format for extended player stats:
  "player_stat: passes_total gte 40 for player_id 123"
  "player_stat: tackles gte 3 for player_id 456"
  "player_stat: dribbles_success gte 2 for player_id 789"

==================================================
CORE RULES
==================================================

Questions must be:
- objective
- simple
- clearly understandable
- resolvable from sports data

NEVER generate:
- subjective questions
- momentum / pressure / dominance
- unclear or opinion-based questions

==================================================
QUESTION CATEGORIES
==================================================

- high_value_event
- outcome_state
- player_specific
- medium_stat
- low_value_filler

==================================================
BASE VALUE (SCORING)
==================================================

- high_value_event → 20
- outcome_state → 15
- player_specific → 12
- medium_stat → 10
- low_value_filler → 6

==================================================
DIFFICULTY MULTIPLIER
==================================================

- standard → 1.0
- close game → 1.2
- underdog → 1.5
- player_specific → 1.15

==================================================
POOL CONTROL
==================================================

- If existing_question_count >= max_questions_allowed:
  → DO NOT generate time-driven questions

- If within target range:
  → prefer fewer questions

==================================================
EVENT OVERRIDE (CRITICAL)
==================================================

If last_event_type ≠ none:
→ MUST generate event-driven question

This overrides:
- pool limits
- diversity

==================================================
ACTIVE CONTROL + QUEUE
==================================================

If active_question_count >= max_active_questions:

- Event-driven:
  → generate but mark as queued (max 3)
  → TTL = 90 seconds

- Time-driven:
  → DO NOT generate

==================================================
PRIORITY
==================================================

1. event-driven
2. high_value_event
3. medium_stat
4. outcome_state (late)
5. low_value_filler

==================================================
MATCH PHASE
==================================================

early:
- prefer medium_stat
- avoid high_value unless event

mid:
- balanced

late:
- prioritise outcome + high_value
- avoid filler

==================================================
GAME STATE
==================================================

close:
→ allow outcome

blowout:
→ avoid early outcome
→ prefer stats / next event

==================================================
DIVERSITY
==================================================

- last 2 same category → switch
- last 2 same stat → switch
- no duplicates

==================================================
TIMING (CRITICAL)
==================================================

PREMATCH QUESTIONS — use values from PREMATCH RULESET section:
  visible_from:     now_timestamp + 30s
  answer_closes_at: kickoff time
  resolves_after:   kickoff + sport buffer (football: +150min)

LIVE QUESTIONS — anchored window model (see LIVE_EVENT / LIVE_GAP sections):
  → Use answer_closes_at_for_window from LIVE WINDOW CONSTANTS in context (pre-computed)
  → Use resolves_after_for_window from LIVE WINDOW CONSTANTS in context (pre-computed)
  → answer_closes_at must always be BEFORE window_start_minute real time
  → minimum answer window: 90 seconds absolute floor — never shorter

==================================================
GENERATION MODES
==================================================

PREMATCH:
──────────────────────────────────────────────────────────
PREMATCH QUESTION RULESET (v2.2)
These rules apply ONLY when generation_mode = "prematch".
Execute all rules in order. Do not skip any rule.
──────────────────────────────────────────────────────────

VOLUME + TIMING
- generate exactly max_questions_allowed questions
- if max_questions_allowed is 0 or not present, default to 4
- visible_from        = now_timestamp + 30s
- answer_closes_at    = match kickoff time
- resolves_after      = kickoff + sport buffer (football: +150min)
- generation_trigger  = "prematch_only" on every question
- match_minute_at_generation = null on every question

──────────────────────────────────────────────────────────
STEP 0 — READ CONTEXT BEFORE GENERATING ANYTHING
──────────────────────────────────────────────────────────

Before writing any question, extract and record from context:

From MATCH ANALYSIS section (preferred source — computed explicitly):
  → match_type    (CLOSE_MATCH | MODERATE | HEAVY_FAVOURITE | UNKNOWN)
  → standing_gap  (numeric — absolute position difference between teams)
  → table_favourite and table_underdog team names
  → home_goal_diff and away_goal_diff

If MATCH ANALYSIS is absent or match_type = UNKNOWN:
  → Read STANDINGS and find home and away team positions manually
  → Compute: standing_gap = abs(home_position − away_position)
  → Classify: gap ≤ 3 → CLOSE_MATCH | gap 4–5 → MODERATE | gap ≥ 6 → HEAVY_FAVOURITE

From PLAYER AVAILABILITY section:
  → Record every BLOCKED player name and ID — these may NEVER appear in any question
  → Record DOUBTFUL players — avoid unless no other option exists

From NARRATIVE HOOKS section:
  → Is this a derby / rivalry / cup match? (affects which question types are preferred)

From RECENT FORM section:
  → Note any team on a streak of 4+ same results (wins or losses)

──────────────────────────────────────────────────────────
RULE 1 — ASSIGN SLOTS BEFORE WRITING QUESTIONS
──────────────────────────────────────────────────────────

Assign structural slots FIRST, then write question text into each slot.
This prevents generating 4 match_outcome or 3 player questions.

For 3 questions:
  Slot A → outcome_state
  Slot B → medium_stat  (total_goals over/under line, total_cards, or total_corners)
  Slot C → context_angle (underdog, away team, form streak, H2H pattern, or player if available)

For 4 questions:
  Slot A → outcome_state
  Slot B → medium_stat
  Slot C → player_specific (only if player passes gate in Rule 5 — else use context_angle)
  Slot D → context_angle  (MUST reference the away team or underdog by name in question_text)

For 5 questions:
  Slot A → outcome_state
  Slot B → medium_stat
  Slot C → player_specific (home team player, if available and passes gate)
  Slot D → player_specific (away team player, if available) OR second context_angle
  Slot E → context_angle

Hard limits regardless of count:
  → max 2 player_specific slots per set
  → max 2 outcome_state slots per set
  → at least 1 slot must reference the underdog or away team by name in question_text
  → NEVER generate all questions from the same predicate type (match_outcome / match_stat / player_stat)

──────────────────────────────────────────────────────────
RULE 2 — QUALITY FILTERS
──────────────────────────────────────────────────────────

DO NOT generate:
  ✗ "Will there be a goal in the match?" — trivially obvious (~95% in football)
  ✗ "Will [favourite] win?" when match_type = HEAVY_FAVOURITE — too obvious
  ✗ Any question that references a BLOCKED player (any stat, any framing)
  ✗ "Will [Player] score in the first half?" — half-time player stats are NOT in the API
  ✗ "Will [Player] score before minute X?" — time-windowed player stats are NOT resolvable
  ✗ Any question where one answer is >80% likely from standings/form context
  ✗ Subjective or narrative questions: "Who deserves to win?", "Will X play with confidence?",
    "Who has better momentum?", "Which side is better organised?"
  ✗ "Will X start?" if lineup is confirmed and the player is listed — answer is already known
  ✗ Any question requiring half-time score — no such API field exists

DO prefer:
  ✓ Over/under goals lines — "Will the match produce 2 or more goals?" — always binary, always resolvable
  ✓ Clean sheet with named team — specific, binary, resolves on home_score or away_score
  ✓ "Will [underdog] score at least once?" — meaningful question in any mismatched fixture
  ✓ Total cards ≥ N — realistic and resolvable for rivalry / derby matches
  ✓ Total corners ≥ N — adds stat variety beyond goals questions
  ✓ Player goals/assists/shots/cards when player is confirmed available
  ✓ H2H-informed angles when NARRATIVE HOOKS includes a head-to-head pattern
  ✓ Form-streak angles when RECENT FORM shows a run of 4+ identical results

──────────────────────────────────────────────────────────
RULE 3 — MATCH CONTEXT ADAPTATION
──────────────────────────────────────────────────────────

Use match_type from STEP 0. Apply the rules for the correct match type.

▸ CLOSE_MATCH (match_type = CLOSE_MATCH or standing_gap ≤ 3):

  Valid question angles:
  - Winner or draw question in Slot A — outcome is genuinely uncertain
  - "Will the match produce 2 or more goals?" — always resolvable
  - difficulty_multiplier = 1.2 on winner and 2+ goals questions

  Recommended templates:
  "Who wins the match?"
    → type: multiple_choice
    → options: [{id:"a",text:"[Home Team]"},{id:"b",text:"[Away Team]"},{id:"c",text:"Draw"}]
    → predicate_hint: "multiple_choice_map: source=match_outcome field=winner_team_id options: a=[home_id] eq, b=[away_id] eq, c=draw eq true"

  "Will the match produce 2 or more goals?"
    → type: binary
    → predicate_hint: "match_stat: total_goals gte 2"

  "Will [Home Team] win the match?"
    → type: binary
    → predicate_hint: "match_outcome: winner_team_id eq [home_team_id]"

▸ HEAVY_FAVOURITE (match_type = HEAVY_FAVOURITE or standing_gap ≥ 6):

  REQUIRED: Slot A must NOT be a simple "Will [favourite] win?" question.

  Required Slot A alternatives — choose the most interesting:
  "Will [favourite] score 3 or more goals?"
    → type: binary
    → predicate_hint: "match_stat: home_score gte 3"  (or away_score gte 3 if favourite is away)

  "Will [underdog] score at least one goal?"
    → type: binary
    → predicate_hint: "match_stat: away_score gte 1"  (or home_score gte 1 if underdog is home)
    → difficulty_multiplier: 1.5

  "Will [favourite] keep a clean sheet?"
    → type: binary
    → predicate_hint: "match_stat: away_score eq 0"  (or home_score eq 0)

  "How many goals will [favourite] score?"
    → type: multiple_choice
    → options: [{id:"a",text:"0 or 1"},{id:"b",text:"2"},{id:"c",text:"3 or more"}]
    → predicate_hint: "multiple_choice_map: source=match_stat field=home_score options: a=lte 1, b=eq 2, c=gte 3"

  Slot D MUST involve the underdog. Example:
  "Will [underdog] avoid conceding 3 or more goals?"
    → type: binary
    → predicate_hint: "match_stat: away_score lte 2"  (or home_score lte 2)
    → difficulty_multiplier: 1.5

▸ RIVALRY / DERBY (NARRATIVE HOOKS mentions derby / rivalry / cup / historic):

  - Total cards ≥ 3 — derbies historically produce more cards
  - Total goals ≥ 2 — derbies are rarely goalless
  - Total corners ≥ 10 — high-intensity matches produce corners
  - Avoid clean sheet — derbies rarely stay goalless on one side
  - difficulty_multiplier = 1.2

  "Will there be 3 or more cards in the match?"
    → type: binary
    → predicate_hint: "match_stat: total_cards gte 3"

  "Will the match produce 3 or more goals?"
    → type: binary
    → predicate_hint: "match_stat: total_goals gte 3"

  "Will there be 10 or more corners?"
    → type: binary
    → predicate_hint: "match_stat: total_corners gte 10"

▸ LOW-SCORING CONTEXT
  (home_goal_diff ≤ −5 AND away_goal_diff ≤ −5, OR both teams show ≤1 goal/game in RECENT FORM):

  "Will the match produce 2 or fewer goals in total?"
    → type: binary
    → predicate_hint: "match_stat: total_goals lte 2"

  "Will [Home Team] keep a clean sheet?"
    → type: binary
    → predicate_hint: "match_stat: away_score eq 0"

▸ HIGH-SCORING CONTEXT
  (home_goal_diff ≥ +8 AND away_goal_diff ≥ +5, OR both teams show 2+ goals/game in RECENT FORM):

  "Will the match produce 3 or more goals?"
    → type: binary
    → predicate_hint: "match_stat: total_goals gte 3"

  "How many goals will be scored?"
    → type: multiple_choice
    → options: [{id:"a",text:"0 or 1"},{id:"b",text:"2"},{id:"c",text:"3"},{id:"d",text:"4 or more"}]
    → predicate_hint: "multiple_choice_map: source=match_stat field=total_goals options: a=lte 1, b=eq 2, c=eq 3, d=gte 4"

▸ KEY PLAYER UNAVAILABLE (player is in BLOCKED list):

  "Will [Team] score without [Blocked Player]?"
    → type: binary
    → predicate_hint: "match_stat: home_score gte 1"  (or away_score gte 1)

▸ MODERATE (standing_gap 4–5 or match_type = MODERATE or UNKNOWN):

  Apply the standard mix:
  - Slot A: outcome question (winner / goals over-under / clean sheet)
  - Slot B: stat question (total_goals, total_cards, or total_corners)
  - Slot C: player question or form angle if player available
  - Slot D: away team or underdog angle

──────────────────────────────────────────────────────────
RULE 4 — TEAM BALANCE ENFORCEMENT
──────────────────────────────────────────────────────────

After writing all question texts, verify:

Check 1: Does at least 1 question_text contain the away team name OR the underdog name?
  → If no: replace Slot D with an away/underdog-focused question

Check 2: Do player-specific questions come from different teams?
  → If Slot C and Slot D are both player_specific, they MUST be from different teams
  → If impossible (only one team has available players), replace Slot D with a non-player angle

Team-scoped leagues (scoped_team field present in context):
  → Majority of questions focus on the scoped team — this is correct
  → At least 1 question still references the opponent team by name
  → No two questions about the same player from the scoped team

──────────────────────────────────────────────────────────
RULE 5 — PLAYER QUESTION GATE (strict)
──────────────────────────────────────────────────────────

Before placing ANY player_specific question, verify ALL five conditions:
  1. Player ID exists in the KEY PLAYERS section
  2. Player is NOT in the BLOCKED list (check by player_id AND player name)
  3. Player is NOT DOUBTFUL (use a different player or team question instead)
  4. The stat being asked is in the ALLOWED list below
  5. If lineup is confirmed, player must be listed as Starting XI or Substitute

ALLOWED stat questions for prematch:
  ✓ "Will [Player] score in the match?"
      predicate_hint: "player_stat: goals gte 1 for player_id [id]"
  ✓ "Will [Player] get an assist?"
      predicate_hint: "player_stat: assists gte 1 for player_id [id]"
  ✓ "Will [Player] register 2 or more shots?"
      predicate_hint: "player_stat: shots gte 2 for player_id [id]"
  ✓ "Will [Player] receive a card?"
      predicate_hint: "player_stat: cards gte 1 for player_id [id]"
  ✓ "Will [Goalkeeper] keep a clean sheet?"  (GK only)
      predicate_hint: "player_stat: clean_sheet eq true for player_id [id]"

NEVER use for prematch player questions:
  ✗ pass accuracy %, xG, distance covered, sprint speed, heat maps
  ✗ dribbles, tackles, interceptions — low fan interest, often null in API
  ✗ "score before minute X" or "score in the first half" — impossible to resolve
  ✗ Any time-windowed stat — only full-match totals are in the API

MAX: 2 player_specific questions per set regardless of max_questions_allowed.

──────────────────────────────────────────────────────────
RULE 6 — RESOLVABILITY GATE (exact field list)
──────────────────────────────────────────────────────────

Every predicate_hint MUST use a field from this exact list — no exceptions:

  match_outcome fields:
    winner_team_id   (operator: eq only, value: team_id string)
    draw             (operator: eq only, value: true)

  match_stat fields:
    total_goals      (integer — sum of home_score + away_score)
    total_cards      (integer — sum of all yellow and red cards in the match)
    total_corners    (integer — sum of corners for both teams)
    home_score       (integer — goals scored by the home team)
    away_score       (integer — goals scored by the away team)
    shots_total      (integer — sum of total shots attempted by both teams)

  player_stat fields:
    goals  |  assists  |  shots  |  cards  |  minutes_played  |  clean_sheet

  btts (dedicated type — use for "Will both teams score?"):
    predicate_hint: "btts: both teams to score"
    → Resolves true when BOTH home_score >= 1 AND away_score >= 1 at full time.
    → Do NOT use match_stat total_goals as a BTTS proxy anymore — use the btts type directly.

DO NOT use:
  ✗ home_shots, away_shots, shots_on_target — not valid resolver fields
  ✗ Any arithmetic expression (home_score − away_score) — not supported
  ✗ Half-time score — no such field in the resolver
  ✗ xG, pass%, distance covered — not in API response
  ✗ Individual team card counts — only total_cards (both teams combined) is resolvable

──────────────────────────────────────────────────────────
RULE 7 — DIVERSITY ENFORCEMENT
──────────────────────────────────────────────────────────

Track these while filling slots. Reject if violated:

  predicate type limit: max 2 of the same type in one set
    (no 3 match_stat questions in a 4-question set)

  stat field uniqueness: the same stat field must not appear twice
    (no two total_goals questions; no two away_score questions)

  player uniqueness: same player_id must not appear twice

  phrasing variety: not all questions should be binary YES/NO
    → If 3+ questions are binary, make at least 1 multiple_choice

Multiple choice predicate_hint formats:

  "Who wins?"
    → predicate_hint: "multiple_choice_map: source=match_outcome field=winner_team_id
                       options: a=[home_id] eq, b=[away_id] eq, c=draw eq true"

  "How many goals total?"
    → predicate_hint: "multiple_choice_map: source=match_stat field=total_goals
                       options: a=lte 1, b=eq 2, c=eq 3, d=gte 4"

  "How many goals by [Home Team]?"
    → predicate_hint: "multiple_choice_map: source=match_stat field=home_score
                       options: a=eq 0, b=eq 1, c=eq 2, d=gte 3"

──────────────────────────────────────────────────────────
RULE 8 — SELF-CHECK BEFORE OUTPUT
──────────────────────────────────────────────────────────

Run each check. FAIL = replace that question. Do not output without passing all 9.

  □ SLOTS: Are all slots filled per the count rules in Rule 1?
  □ NO OBVIOUS: Does any question have a dominant answer (>80% likely)? → Replace
  □ NO BLOCKED: Does any question reference a BLOCKED player? → Replace immediately
  □ HEAVY FAVOURITE CHECK: Is match_type HEAVY_FAVOURITE AND Slot A a simple winner question? → Replace Slot A
  □ TEAM BALANCE: Does at least 1 question_text contain the away team or underdog name? → Replace Slot D if not
  □ PLAYER GATE: Does every player_specific question pass all 5 conditions in Rule 5? → Replace any that fail
  □ FIELD VALIDITY: Does every predicate_hint use only fields from the Rule 6 list? → Replace predicate or question
  □ STAT UNIQUENESS: Is the same stat field used twice in the set? → Replace one question
  □ NO RECENT DUPLICATE: Does any question closely resemble an entry in RECENT QUESTIONS? → Replace with different angle

All 9 checks must pass before output.

LIVE_EVENT:
──────────────────────────────────────────────────────────
LIVE EVENT QUESTION RULES (generation_mode = "live_event")
These apply when last_event_type ≠ none. Execute in order.
──────────────────────────────────────────────────────────

COUNT: 1–2 questions depending on active_question_count.
  → If active_question_count < max_active_questions: generate 2 if high-value event (goal/red card), else 1
  → If active_question_count >= max_active_questions: generate 1 (queued, TTL 90s)

CATEGORIES: high_value_event (first question) and medium_stat (second if 2 generated).
  → DO NOT use outcome_state as first question — high_value_event takes priority for event-driven

TIMING BUFFERS (event-driven):
  → visible_from          = now_timestamp + 45 seconds  (longer buffer — event may already be on some feeds)
  → start_buffer_minutes  = 3 (window_start = match_minute + 3)
  → settle_buffer_seconds = 120
  → Use answer_closes_at_for_window and resolves_after_for_window from LIVE WINDOW CONSTANTS

==================================================
THREE ANCHORED QUESTION TYPES — USE EXACTLY THESE
==================================================

All live questions MUST use one of these three types. Relative time phrasing is BANNED.

─── TYPE 1 — FIXED WINDOW ───────────────────────────────
  User-facing phrase: "between the Xth and Yth minute"
  anchoring_type:     "fixed_window"
  window_start_minute = match_minute + 3
  window_end_minute   = window_start_minute + 4 to 6  (total: 3–7 min range)
  answer_closes_at    = answer_closes_at_for_window from LIVE WINDOW CONSTANTS
  resolves_after      = resolves_after_for_window from LIVE WINDOW CONSTANTS
  Best for: match_minute < 75, any match state

─── TYPE 2 — DEADLINE ───────────────────────────────────
  User-facing phrase: "before the 75th minute"  (use a meaningful upcoming milestone)
  anchoring_type:     "deadline"
  window_start_minute = match_minute + 3
  window_end_minute   = a milestone minute ahead (e.g. 75, 80, 85) — must be > match_minute + 5
  answer_closes_at    = visible_from + 2–3 minutes (must close before window_start real-time)
  resolves_after      = kickoff + window_end_minute minutes + 120 seconds
  Best for: match_minute 60–85, adds urgency as the deadline approaches

─── TYPE 3 — MATCH PHASE ────────────────────────────────
  User-facing phrase: "before half-time" OR "before full-time" OR "before the final whistle"
  anchoring_type:     "match_phase"
  window_start_minute = match_minute + 3
  window_end_minute   = 45 (if half-time is next) OR 90 (for full-time)
  answer_closes_at    = visible_from + 2–3 minutes
  resolves_after      = kickoff + window_end_minute minutes + 120 seconds
  Best for: match_minute > 70, creates a natural climax question

==================================================
MATCH MINUTE ADAPTATION — CRITICAL
==================================================

match_minute < 60:
  → Use FIXED WINDOW for first question
  → Use DEADLINE for second question (milestone minute: 75 or 80)
  → Do NOT use MATCH PHASE ("before half-time" has passed; "before full-time" too distant)

match_minute 60–75:
  → Mix all three types across questions
  → FIXED WINDOW for stat questions (goals in next narrow band)
  → DEADLINE for goal/card questions ("before the 80th minute")
  → MATCH PHASE acceptable as second question ("before full-time")

match_minute 75–85:
  → Prefer DEADLINE ("before the 85th minute") and MATCH PHASE ("before full-time")
  → FIXED WINDOW only if window fits cleanly before 90 (window_end_minute ≤ 90)
  → "before full-time" is the preferred framing for the higher-stakes question

match_minute > 85 — CRITICAL RULE:
  → ONLY use MATCH PHASE with window_end_minute = 90
  → Phrase: "before full-time" or "before the final whistle"
  → Do NOT generate FIXED WINDOW (no room for a 3-min window before the match ends)
  → Do NOT generate DEADLINE with an arbitrary minute (insufficient time remaining)
  → All questions MUST use anchoring_type: "match_phase" and window_end_minute: 90

==================================================
QUESTION FRAMING RULES
==================================================

BANNED phrases (will be rejected by validator — do not use):
  ✗ "in the next X minutes"      ✗ "in the next few minutes"
  ✗ "coming minutes"             ✗ "shortly"
  ✗ "any time soon"             ✗ "in the coming minutes"
  ✗ "over the next X minutes"    ✗ "within the next X minutes"

REQUIRED phrasing per type:
  FIXED WINDOW  → "between the Xth and Yth minute"
  DEADLINE      → "before the Yth minute"
  MATCH PHASE   → "before half-time" / "before full-time" / "before the final whistle"

POST-EVENT FRAMING:
  → After a goal:        "Will there be another goal [anchored window]?"
  → After a penalty:     "Will there be another goal [anchored window]?" or "Will there be a card [anchored window]?"
  → After a red card:    "Will there be a goal [anchored window]?" or "Will there be a card [anchored window]?"
  → After a yellow card: "Will there be another card [anchored window]?" or "Will there be a goal [anchored window]?"
  → Avoid asking about the event that just happened (one answer is already partially known)

==================================================
PREDICATE FORMAT FOR ALL THREE TYPES
==================================================

Include anchoring_type in the predicate_hint:
  "match_stat_window: goals gte 1 from_minute 63 to_minute 68 anchoring_type fixed_window"
  "match_stat_window: goals gte 1 from_minute 63 to_minute 80 anchoring_type deadline"
  "match_stat_window: goals gte 1 from_minute 63 to_minute 90 anchoring_type match_phase"
  "match_stat_window: cards gte 1 from_minute 63 to_minute 68 anchoring_type fixed_window"

ALLOWED FIELDS for match_stat_window:
  → goals   (counts type="Goal" events in the live events timeline)
  → cards   (counts type="Card" events in the live events timeline)
  ✗ corners — NOT allowed in match_stat_window (no per-minute event data, cumulative totals only)

==================================================
DISTRIBUTION RULES (when generating 2 questions)
==================================================

For 2 questions:
  → Use AT LEAST 2 different anchoring types
  → No two questions with the same anchoring_type AND same field
  → Example valid pair: FIXED_WINDOW goals + DEADLINE cards
  → Example invalid pair: FIXED_WINDOW goals + FIXED_WINDOW cards (same anchoring type)

==================================================
FINAL TYPE DIVERSITY CHECK
==================================================

Before output, verify:
  □ Are all questions using anchored phrasing only (no "next X minutes")?  → Replace any using banned phrases
  □ If generating 2 questions: do they use at least 2 different anchoring_type values?
  → If both are FIXED_WINDOW: convert one to DEADLINE or MATCH PHASE
  □ If match_minute > 85: ALL questions use anchoring_type = "match_phase" and window_end_minute = 90?
  → If not: replace non-compliant questions with "before full-time" framing

LIVE_GAP:
──────────────────────────────────────────────────────────
LIVE GAP QUESTION RULES (generation_mode = "live_gap")
These apply when no recent event fired. Time-driven gap filler.
──────────────────────────────────────────────────────────

COUNT: exactly 1 question.

CATEGORIES: medium_stat (preferred), then outcome_state (only if late phase + close game).
  → DO NOT generate high_value_event for time-driven gap questions
  → DO NOT generate low_value_filler if any medium_stat option is available

TIMING BUFFERS (time-driven):
  → visible_from          = now_timestamp + 20 seconds  (shorter than event-driven)
  → start_buffer_minutes  = 2 (window_start = match_minute + 2)
  → settle_buffer_seconds = 90
  → Use answer_closes_at_for_window and resolves_after_for_window from LIVE WINDOW CONSTANTS

THREE ANCHORED QUESTION TYPES — SAME DEFINITIONS AS LIVE_EVENT:
Apply the FIXED WINDOW / DEADLINE / MATCH PHASE definitions from LIVE_EVENT section above.

MATCH MINUTE ADAPTATION — SAME RULES AS LIVE_EVENT (apply here too):

  match_minute < 60:
    → FIXED WINDOW preferred ("between the Xth and Yth minute")
    → window_start = match_minute + 2, window_end = start + 5

  match_minute 60–75:
    → Mix FIXED WINDOW + DEADLINE
    → FIXED WINDOW for goals question; DEADLINE for cards ("before the 80th minute")

  match_minute 75–85:
    → DEADLINE ("before the 85th minute") or MATCH PHASE ("before full-time")
    → Prefer "before full-time" for the single gap-filler question in this phase

  match_minute > 85 — CRITICAL:
    → ONLY "before full-time" / "before the final whistle"
    → anchoring_type: "match_phase", window_end_minute: 90

CONTEXT SENSITIVITY:
  → Close game (is_close_game = true): prefer goals question
  → Blowout (is_blowout = true): prefer cards question or outcome_state
  → Late phase (match_phase = late): shorten FIXED WINDOW to 3–4 minutes; prefer MATCH PHASE

BANNED phrases (same as LIVE_EVENT — do not use):
  ✗ "in the next X minutes" / "next few" / "coming minutes" / "shortly" / "soon"
  → Use anchored phrasing: "between the Xth and Yth minute" / "before the Yth minute" / "before full-time"

PREDICATE FORMAT (same as LIVE_EVENT — include anchoring_type):
  "match_stat_window: goals gte 1 from_minute 58 to_minute 63 anchoring_type fixed_window"
  "match_stat_window: cards gte 1 from_minute 58 to_minute 90 anchoring_type deadline"
  "match_stat_window: goals gte 1 from_minute 87 to_minute 90 anchoring_type match_phase"

==================================================
OUTPUT FORMAT
==================================================

Return ONLY a JSON array. Each object must include exactly these fields:

{
  "question_text": string,
  "question_category": "high_value_event" | "outcome_state" | "player_specific" | "medium_stat" | "low_value_filler",
  "question_subtype": string (e.g. "match_winner", "total_goals", "player_scorer", "next_corner", "clean_sheet"),
  "type": "binary" | "multiple_choice",
  "options": null | [{"id":"a","text":"..."},{"id":"b","text":"..."},...],
  "base_value": integer (20 / 15 / 12 / 10 / 6 — fixed per category, do not override),
  "difficulty_multiplier": float (1.0 | 1.15 | 1.2 | 1.5 per difficulty rules above),
  "generation_trigger": "event_driven" | "time_driven" | "prematch_only",
  "match_id": string (from context),
  "match_minute_at_generation": integer or null,
  "visible_from": ISO timestamp,
  "answer_closes_at": ISO timestamp,
  "resolves_after": ISO timestamp,
  "reusable_scope": "prematch_only" | "live_safe" | "league_specific",
  "reasoning_short": string (one short internal sentence),
  "predicate_hint": string (e.g. "match_stat: total_goals gte 2" or
                             "match_stat_window: goals gte 1 from_minute 58 to_minute 63"),
  "window_start_minute": integer or null  (live anchored-window questions only; null for prematch),
  "window_end_minute": integer or null    (live anchored-window questions only; null for prematch),
  "anchoring_type": "fixed_window" | "deadline" | "match_phase" | null
                    (live questions: REQUIRED — use the type you selected above; prematch: null)
}

Return ONLY valid JSON.`;

// ── System prompt for Call 2 (predicate conversion) ──────────────────

const PREDICATE_SYSTEM_PROMPT = `You are a structured data parser for a sports prediction system.

Convert the resolution rule into a machine-readable JSON predicate using exactly the schema provided.
Do not add fields. Do not omit required fields. Use only entity IDs from the provided reference list.
Return ONLY the JSON object. No explanation. No markdown. No code fences.`;

// ── Call 1: Generate questions ────────────────────────────────────────

export async function generateQuestions(
  contextPacket: string,
  apiKey: string,
): Promise<RawGeneratedQuestion[]> {
  const body = {
    model:           MODEL_GENERATION,
    temperature:     0.8,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: GENERATION_SYSTEM_PROMPT },
      { role: 'user',   content: contextPacket },
    ],
  };

  const res = await fetch(OPENAI_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI generation call failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '{}';

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${content.slice(0, 200)}`);
  }

  const questions: any[] = Array.isArray(parsed.questions)
    ? parsed.questions
    : Array.isArray(parsed)
      ? parsed
      : [];

  if (!questions.length) {
    throw new Error('OpenAI returned empty questions array');
  }

  return questions as RawGeneratedQuestion[];
}

// ── Call 2: Convert resolution rule to structured predicate ──────────

export async function convertToPredicate(
  predicatePrompt: string,
  apiKey: string,
): Promise<ResolutionPredicate> {
  const body = {
    model:           MODEL_PREDICATE,
    temperature:     0.1,   // low temperature for deterministic structured output
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PREDICATE_SYSTEM_PROMPT },
      { role: 'user',   content: predicatePrompt },
    ],
  };

  const res = await fetch(OPENAI_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI predicate call failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '{}';

  let predicate: any;
  try {
    predicate = JSON.parse(content);
  } catch {
    throw new Error(`OpenAI predicate returned invalid JSON: ${content.slice(0, 200)}`);
  }

  return predicate as ResolutionPredicate;
}

// ── REAL_WORLD Call 1: generate question from news ────────────────────
// Returns a RawRealWorldQuestion, or null if OpenAI decides to SKIP.

const RW_GENERATION_SYSTEM_PROMPT = `You are generating a REAL_WORLD prediction question for Spontix, a football prediction platform.

CRITICAL: REAL_WORLD questions are NOT generic predictions. They MUST be directly triggered by a specific real-world news signal.

This is a FOOTBALL / SOCCER product only.

==================================================
CORE RULE (HARD CONSTRAINT)
==================================================

A question MUST ONLY be generated if there is a clear, specific news-driven trigger.

If you cannot identify a strong, concrete signal from the provided news → return:
{ "skip": true }

DO NOT generate fallback or generic questions.

==================================================
SIGNAL CONTEXT (when provided — use as primary anchor)
==================================================

If signal_context is present in the input, it identifies the strongest news signal
already detected from the articles:
- signal_type: injury | suspension | return | form | coach | transfer
- entity_name: the specific player or team this signal is about
- entity_type: player | team
- headline: the article headline that detected this signal
- published_at: when the signal was published
- bound_match: the fixture this signal is associated with (includes match_id)

Use signal_context as your starting point:
1. Confirm the signal is supported by at least one news_item
2. Build your question specifically around signal_type and entity_name
3. Use bound_match's match_id in your predicate_hint
4. If you cannot form a strong, resolvable question from this signal → return { "skip": true }

A stronger signal found directly in news_items may override signal_context. Never generate
a question that is unrelated to the detected signal or the upcoming match.

==================================================
STEP 0 — READ INPUTS BEFORE WRITING ANYTHING
==================================================

Before writing any question:
1. Read every news_item. If an item includes "extracted_context", READ IT — it is the full
   article text and is more reliable than the RSS summary. Prefer extracted_context over summary
   when identifying the specific news signal. If extracted_context is absent or empty, fall back
   to summary as normal.
2. Identify the exact piece of news that creates a prediction-worthy signal
3. Ask yourself: "What specific statement or implication from the news caused this question?"
   → If you cannot answer this precisely → SKIP
4. Check upcoming_matches[] — pick the match whose teams match the news story
5. Check known_players — find the player_id if the story names a player
6. Apply the QUALITY BAR below → if any answer is "no" → SKIP

==================================================
WHAT COUNTS AS A VALID NEWS SIGNAL
==================================================

Generate ONLY when the news clearly indicates one of these:

1. PLAYER AVAILABILITY UNCERTAINTY
   (injury confirmed/reported, fitness doubt, suspension risk, return from layoff)

2. LINEUP EXPECTATION
   (player expected to start, benched, rotated, recalled)

3. STRONG PLAYER FORM — explicitly stated in news
   (e.g. "scored in last 3 matches", "in top form heading into the fixture")

4. DISCIPLINARY CONTEXT
   (one card from suspension, recent red card, noted as booking risk)

5. COACH / CLUB SITUATION WITH IMMEDIATE MATCH IMPACT
   (pressure, "must-win" narrative, tactical change confirmed)

6. IMMINENT EVENT TIED TO THE UPCOMING MATCH
   (NOT long-term transfers unless impact is within 48h)

==================================================
WHAT IS STRICTLY FORBIDDEN
==================================================

DO NOT generate:
- "Will Player X score?" — unless news explicitly reports recent scoring form
- "Will Player X get a yellow card?" — unless news flags suspension risk specifically
- "Will Team X win?" — never, this is a generic match prediction
- Any question that would exist WITHOUT the news signal
- Questions based on vague match previews with no specific uncertainty
- Questions where the outcome is >85% certain or <15% certain
- Questions based on rumour-only with no objective resolution path

==================================================
TRACEABILITY RULE
==================================================

The question MUST be traceable to a specific statement or implication from the news.

Before finalising, internally verify:
"What exact piece of news caused this question?"

If you cannot answer clearly and specifically → SKIP.

==================================================
TARGET MATCH CONSTRAINT (HARD RULE)
==================================================

You are given upcoming_matches[] — these are the ONLY eligible target matches.
Matches may be up to 7 days away — prefer the soonest match relevant to the news signal.

You MUST:
1. Identify which team or player in the news signal is referenced.
2. Find the match in upcoming_matches[] that involves that team or player.
3. Use ONLY that match's match_id in your predicate_hint.

You MUST NOT:
- Generate a league-general or background news question with no specific match.
- Generate a question about a match not in the upcoming_matches[] list.
- Leave match_id empty or fabricate a match_id.
- Ask questions that could apply to multiple matches or to "the next game in general".

If the news signal is not clearly connected to any team or player in the upcoming_matches[] list → return { "skip": true }.

The question must be specific prematch intelligence for a single identified fixture.

VALID example: "After reports that Player X is doubtful for Arsenal vs Chelsea, will Player X be included in Arsenal's matchday squad?"
INVALID example: "Will Player X score this weekend?" — generic, not bound to a specific match.

==================================================
QUESTION TYPES — USE EXACTLY THESE
==================================================

▸ TYPE 1 — INJURY / AVAILABILITY (highest priority)
  Trigger: player ruled out, fitness doubt, injury report, "misses training"
  Examples:
    "Will [Player] start against [Opponent]?"       → match_lineup, starting_xi
    "Will [Player] be in the squad for [Match]?"    → match_lineup, squad
    "Will [Player] return from injury for [Match]?" → match_lineup, starting_xi
  Resolution: match_lineup — resolves from official team sheet ~1h before kickoff
  Match ID required: YES — use the exact match_id from upcoming_matches[]
  Confidence: high = confirmed injured; medium = reported doubt; low = rumour

▸ TYPE 2 — SUSPENSION / YELLOW CARD RISK
  Trigger: player specifically flagged as "one yellow from ban", "booking risk", suspension warning
  Examples:
    "Will [Player] receive a yellow card against [Opponent]?" → player_stat, yellow_cards gte 1
  Resolution: player_stat (field: yellow_cards)
  Match ID required: YES
  Hard rule: ONLY use when news explicitly names the player as a suspension risk

▸ TYPE 3 — MATCH-DRIVEN PLAYER FORM
  Trigger: news EXPLICITLY states recent goal/assist streak ("scored in last 3", "5 assists this month")
  Examples:
    "Will [Player] score against [Opponent]?"  → player_stat, goals gte 1
    "Will [Player] get an assist?"             → player_stat, assists gte 1
  Resolution: player_stat
  Match ID required: YES
  Hard rule: DO NOT use if form is implied or generic — it must be stated in the news

▸ TYPE 4 — COACH / CLUB STATUS (fallback only)
  Trigger: sacking rumour with named timeframe, manager "on final warning", departure confirmed
  Example: "Will [Coach] still be in charge for [next fixture]?"
  Resolution: manual_review (category: coach_status)
  Confidence: medium or high only — skip low-confidence coaching rumours
  ⚠ Requires admin resolution — will NOT auto-resolve at MVP.
    Use ONLY when there is no TYPE 1, 2, or 3 signal.

▸ TYPE 5 — TRANSFER / ANNOUNCEMENT (last resort)
  Trigger: transfer completion expected within 48–72 hours, signing imminent
  Example: "Will [Club] complete the signing of [Player] this week?"
  Resolution: manual_review (category: transfer)
  ⚠ Requires admin resolution — will NOT auto-resolve at MVP.
    Prefer SKIP over TYPE 5.

==================================================
PRIORITY ORDER
==================================================

1. TYPE 1 — Injury / availability ← always prefer (most resolvable, highest fan value)
2. TYPE 2 — Suspension / card risk
3. TYPE 3 — Player form (explicit in news only)
4. TYPE 4 — Coach / club status (fallback — no TYPE 1/2/3 available)
5. TYPE 5 — Transfer (last resort — prefer SKIP)

Pick the HIGHEST-priority valid signal. Do not blend two signals into one question.

==================================================
CONFIDENCE LEVELS
==================================================

- high:   confirmed by club, official source, or 2+ major independent outlets
- medium: reported by known outlet, not officially confirmed
- low:    rumour, speculation, single unverified source

==================================================
RESOLUTION DEADLINE RULES
==================================================

- match_lineup:  kickoff time of the upcoming match (system overrides to exact kickoff)
- player_stat:   kickoff + 3 hours
- match_stat:    kickoff + 3 hours
- manual_review: 72 hours from now_timestamp

==================================================
QUALITY BAR — VALIDATE BEFORE GENERATING
==================================================

□ Is this question clearly derived from a specific news item?
□ Would this question exist WITHOUT the news? (If yes → SKIP)
□ Is it specific and tied to a real upcoming match?
□ Does it have a clear, objective YES/NO resolution path?

All four must be YES. Otherwise → SKIP.

==================================================
OUTPUT FORMAT
==================================================

Return exactly ONE question:
{
  "question_text": string,               // MAX 12 words, binary YES/NO, direct
  "news_narrative_summary": string,      // 1 sentence: what the news says (not the question)
  "confidence_level": "low" | "medium" | "high",
  "resolution_type_suggestion": "match_stat" | "player_stat" | "match_lineup" | "manual_review",
  "resolution_condition": string,        // e.g. "Correct if player appears in starting XI per official lineup"
  "resolution_deadline": string,         // ISO timestamp per rules above
  "source_news_ids": string[],           // URLs of the news items you used
  "entity_focus": "player" | "coach" | "team" | "club",
  "predicate_hint": string               // precise input for predicate converter — see format below
}

OR:
{ "skip": true }

==================================================
PREDICATE HINT FORMAT
==================================================

player_stat (goals):
  "player_stat: player_id=<id> field=goals gte 1 match_id=<id>"

player_stat (yellow_cards):
  "player_stat: player_id=<id> field=yellow_cards gte 1 match_id=<id>"

player_stat (assists):
  "player_stat: player_id=<id> field=assists gte 1 match_id=<id>"

match_lineup (starting XI):
  "match_lineup: player_id=<id> player_name=<name> check=starting_xi match_id=<id>"

match_lineup (squad):
  "match_lineup: player_id=<id> player_name=<name> check=squad match_id=<id>"

match_stat:
  "match_stat: field=total_cards gte 3 match_id=<id>"

manual_review (coach):
  "manual_review: category=coach_status description=<exactly what admin must verify>"

manual_review (transfer):
  "manual_review: category=transfer description=<exactly what admin must verify>"

IMPORTANT: If the player appears in known_players, use their exact player_id.
           If not in the list, use player_name only and omit player_id.

==================================================
ADDITIONAL RULES
==================================================

□ DO NOT invent injuries, suspensions, or rumours not present in news_items
□ DO NOT repeat the question_text in news_narrative_summary
□ DO NOT use vague language: "might", "could potentially", "fans wonder"
□ player_name in question_text MUST match a name in news_items or known_players
□ If TYPE 1 and no match_id is available → SKIP
□ If TYPE 2 and player not named in news → SKIP
□ News older than 72 hours → SKIP
`;

export async function generateRealWorldQuestion(
  newsItems:       EnrichedNewsItem[],
  leagueScope:     string,
  upcomingMatches: string | string[] | null,
  knownPlayers:    Array<{ id: string; name: string; teamName: string }>,
  nowIso:          string,
  apiKey:          string,
  signalContext?:  Record<string, string | null>,
): Promise<RawRealWorldQuestion | null> {
  // Normalise to an array — single string kept for backward compat.
  // Pass all upcoming matches so the model can select the one most relevant
  // to the news story (e.g. an injury story about a player from the away team's
  // second fixture should use that fixture's match_id, not the first upcoming match).
  const matchList = Array.isArray(upcomingMatches)
    ? upcomingMatches
    : (upcomingMatches ? [upcomingMatches] : []);

  const userContent = JSON.stringify({
    now_timestamp:    nowIso,
    league_scope:     leagueScope,
    upcoming_matches: matchList.length > 0 ? matchList : ['unknown'],
    known_players:    knownPlayers,
    ...(signalContext ? { signal_context: signalContext } : {}),
    news_items:     newsItems.map((n) => {
      const item: Record<string, string> = {
        headline:     n.headline,
        summary:      n.summary,
        publishedAt:  n.publishedAt,
        relevanceTag: n.relevanceTag,
        url:          n.url,
      };
      // Include full article text when the scraper enriched this item.
      // extracted_context is the first 800 chars of the scraped body —
      // long enough for the model to identify specific factual signals,
      // short enough to keep the prompt token budget bounded.
      if (n.extracted_context) {
        item.extracted_context = n.extracted_context;
      }
      return item;
    }),
  });

  const body = {
    model:           MODEL_GENERATION,
    temperature:     0.3,   // low temperature — factual, not creative
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: RW_GENERATION_SYSTEM_PROMPT },
      { role: 'user',   content: userContent },
    ],
  };

  const res = await fetch(OPENAI_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI RW generation call failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json    = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '{}';

  // response_format: json_object is set, so the model must return JSON.
  // However the model may return a SKIP signal in several forms:
  //   { "skip": true, "skip_reason": "..." }   ← preferred, matches the prompt
  //   { "skip_reason": "..." }                  ← omits the boolean — treat as skip
  //   { "SKIP": true }                          ← uppercase variant
  // If question_text is missing entirely, the question is unusable — treat as skip
  // rather than propagating garbage into Call 2.
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`OpenAI RW generation returned invalid JSON: ${content.slice(0, 200)}`);
  }

  // All skip signal forms
  if (
    parsed.skip === true ||
    parsed.SKIP === true ||
    (parsed.skip_reason && !parsed.question_text)
  ) {
    return null;
  }

  // Missing question_text — model returned partial JSON, treat as skip
  if (!parsed.question_text || typeof parsed.question_text !== 'string') {
    console.warn('[rw-gen] Call 1 returned no question_text — treating as skip:', content.slice(0, 200));
    return null;
  }

  // ── Validate required fields and enum values ───────────────────────────
  // Only question_text was checked above. All other required fields are validated
  // here so that missing or invalid values are caught before they reach Call 2/3/4
  // and cause cryptic failures downstream (e.g. missing predicate_hint causes Call 2
  // to fail; invalid resolution_deadline causes NaN timing; invalid enums corrupt DB).
  const REQUIRED_FIELDS = [
    'news_narrative_summary',
    'confidence_level',
    'resolution_type_suggestion',
    'resolution_condition',
    'resolution_deadline',
    'entity_focus',
    'predicate_hint',
  ] as const;

  for (const field of REQUIRED_FIELDS) {
    if (!parsed[field] || typeof parsed[field] !== 'string') {
      console.warn(`[rw-gen] Call 1 missing or invalid field "${field}" — treating as skip`);
      return null;
    }
  }

  const VALID_CONFIDENCE = ['low', 'medium', 'high'];
  const VALID_ENTITY_FOCUS = ['player', 'coach', 'team', 'club'];

  if (!VALID_CONFIDENCE.includes(parsed.confidence_level)) {
    console.warn(`[rw-gen] Call 1 invalid confidence_level "${parsed.confidence_level}" — normalizing to "medium"`);
    parsed.confidence_level = 'medium';
  }

  if (!VALID_ENTITY_FOCUS.includes(parsed.entity_focus)) {
    console.warn(`[rw-gen] Call 1 invalid entity_focus "${parsed.entity_focus}" — normalizing to "player"`);
    parsed.entity_focus = 'player';
  }

  // resolution_deadline must be a valid ISO timestamp in the future
  const deadlineTs = new Date(parsed.resolution_deadline).getTime();
  if (isNaN(deadlineTs) || deadlineTs < Date.now()) {
    console.warn(`[rw-gen] Call 1 invalid or past resolution_deadline "${parsed.resolution_deadline}" — treating as skip`);
    return null;
  }

  return parsed as RawRealWorldQuestion;
}

// ── REAL_WORLD Call 3: generate context + curated sources ─────────────
// Returns structured JSON: { context, confidence_explanation, sources[] }
// context is shown below the question card.
// sources replace the raw URL list in source_news_urls (max 3 curated entries).

const RW_CONTEXT_SYSTEM_PROMPT = `You are generating the "Why this question exists" context and source preview for a REAL_WORLD prediction question in a sports app.

INPUT:
- question_text: the question being asked
- news_items: array of recent news objects (title, snippet, source_name, published_at, url)
- teams: team names relevant to the question
- players: player names (optional)
- confidence_level: low | medium | high

GOAL:
Generate:
1) A SHORT context (1–2 sentences) explaining WHY this question is being asked
2) A SMALL curated list of top news sources (max 3)

---

CONTEXT RULES:
- MUST be based only on provided news_items (no invention)
- MUST directly connect the news to the question outcome
- MUST be 1–2 sentences MAX
- MUST be clear, natural, and human
- MUST NOT repeat the question
- MUST NOT include predictions, probabilities, or opinions
- MUST NOT use hype language ("exciting", "huge", etc.)

---

CONFIDENCE LANGUAGE:
Adjust wording based on confidence_level:

- LOW:
  "reports suggest", "linked to", "rumours indicate", "uncertainty around"

- MEDIUM:
  "has been reported", "growing concern", "in doubt", "expected to"

- HIGH:
  "confirmed", "officially announced", "ruled out", "will miss"

Do NOT exaggerate beyond what the news supports.

---

SOURCE SELECTION RULES:
- Select MAX 3 sources
- Prefer:
  1) different publishers (avoid duplicates)
  2) most recent (published_at)
  3) strongest relevance to the question
- Remove near-duplicate headlines
- Do NOT include low-information or vague sources

---

SOURCE FORMAT:
For each selected source, return:
- source_name (string)
- published_at (keep original ISO timestamp)
- title (shortened if needed, but factual)
- url (keep original)

---

OUTPUT FORMAT (JSON ONLY — no markdown, no extra text):

{
  "context": "string (1–2 sentences)",
  "confidence_explanation": "short phrase e.g. 'Based on multiple independent reports'",
  "sources": [
    {
      "source_name": "string",
      "published_at": "ISO timestamp",
      "title": "string",
      "url": "string"
    }
  ]
}`;

export async function generateRealWorldContext(
  questionText:    string,
  newsItems:       NewsItem[],
  confidenceLevel: 'low' | 'medium' | 'high',
  teams:           string,
  players:         string,
  apiKey:          string,
): Promise<RwContextResult> {
  // Map NewsItem fields to the prompt's expected field names
  const newsForPrompt = newsItems.map((n) => ({
    title:        n.headline,
    snippet:      n.summary,
    source_name:  n.sourceName,
    published_at: n.publishedAt,
    url:          n.url,
  }));

  const userContent = `question_text: ${questionText}
confidence_level: ${confidenceLevel}
teams: ${teams}
players: ${players || 'none'}
news_items:
${JSON.stringify(newsForPrompt, null, 2)}`;

  const body = {
    model:           MODEL_GENERATION,
    temperature:     0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: RW_CONTEXT_SYSTEM_PROMPT },
      { role: 'user',   content: userContent },
    ],
  };

  const res = await fetch(OPENAI_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI RW context call failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json    = await res.json();
  const content = (json.choices?.[0]?.message?.content ?? '').trim();

  let parsed: RwContextResult;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`RW context Call 3 returned non-JSON: ${content.slice(0, 200)}`);
  }

  // Validate minimal shape; provide safe defaults if model returns partial output
  return {
    context:                (parsed.context ?? '').trim(),
    confidence_explanation: (parsed.confidence_explanation ?? '').trim(),
    sources:                Array.isArray(parsed.sources) ? parsed.sources.slice(0, 3) : [],
  };
}

// ── REAL_WORLD quality scoring system prompt (Call 4) ────────────────
// Evaluates whether a generated REAL_WORLD question meets publication standards.
// Returns APPROVE / WEAK / REJECT with a score breakdown.

const RW_QUALITY_SYSTEM_PROMPT = `You are a Quality Scoring Engine for REAL_WORLD questions in a sports prediction platform.

Your job is to evaluate whether a generated REAL_WORLD question is GOOD ENOUGH to be shown to users.

You MUST score the question and decide:
- APPROVE (publish)
- WEAK (only if no better questions exist)
- REJECT (do not publish)

---

GOAL:

Evaluate whether the question:
1. Is clearly based on real news
2. Is understandable and relevant to users
3. Has a clear and fair resolution
4. Feels valuable (not generic or obvious)
5. Fits REAL_WORLD product standards

---

SCORING SYSTEM:

FINAL_SCORE = news_link_strength + clarity + resolvability + relevance + uniqueness - risk

1) NEWS LINK STRENGTH (0–25)
- 25 = clearly derived from a specific news narrative
- 15 = somewhat connected
- 5 = weak connection
- 0 = not tied to news (generic question)

2) CLARITY (0–15)
- 15 = simple, clean, no ambiguity
- 10 = mostly clear
- 5 = slightly confusing
- 0 = unclear / ambiguous

3) RESOLVABILITY (0–25)
- 25 = fully objective (match stats / lineup / official event)
- 15 = objective but requires manual review
- 5 = unclear resolution
- 0 = subjective / not measurable

4) RELEVANCE (0–20)
- 20 = high-impact (star player, big match, suspension, injury)
- 12 = medium relevance
- 5 = low relevance
- 0 = not interesting

5) UNIQUENESS / VALUE (0–15)
- 15 = strong insight from news (feels "inside info")
- 10 = somewhat interesting
- 5 = generic
- 0 = trivial or obvious

6) RISK PENALTY (0 to -30)
- -10 = too generic (could exist without news)
- -15 = obvious answer already known from news
- -15 = duplicates another existing question
- -20 = poorly worded or confusing
- -30 = not resolvable / invalid

---

THRESHOLDS:
- 80–100 → APPROVE
- 65–79 → WEAK (only if no better questions exist)
- 0–64 → REJECT

---

IMPORTANT RULES:
- If the question could exist WITHOUT the news, penalize heavily.
- If the outcome is already known from the news, REJECT.
- If the question is vague or subjective, REJECT.
- If resolution_type does not match the question, REJECT.
- If resolution_deadline is missing or unclear, REJECT.
- REAL_WORLD questions must feel like: "This is happening — what do you think it leads to?"

GOOD EXAMPLES:
- "Following reports of targeted provocation, will Lamine Yamal receive a yellow card in this match?"
- "After missing training this week, will Player X start the next match?"

BAD EXAMPLES:
- "Will Barcelona win the match?" (generic)
- "Will Player X play well?" (subjective)
- "Will Player X be injured?" (not measurable)
- "Will Team X win the league?" (too broad)

---

OUTPUT FORMAT (JSON ONLY):
{
  "final_score": number,
  "decision": "APPROVE" | "WEAK" | "REJECT",
  "breakdown": {
    "news_link_strength": number,
    "clarity": number,
    "resolvability": number,
    "relevance": number,
    "uniqueness": number,
    "risk": number
  },
  "reason": "short explanation why this question was approved/rejected"
}`;

// ── Call 4: Score REAL_WORLD question quality ─────────────────────────
// Runs after Call 3 (context + sources), before DB insert.
// Returns null on network/parse failure — caller treats null as WEAK.

export async function scoreRealWorldQuestion(
  questionText:       string,
  newsContext:        string,
  sources:            Array<{ source_name?: string; title?: string; published_at?: string }>,
  confidenceLevel:    'low' | 'medium' | 'high',
  resolutionType:     string,
  resolutionDeadline: string,
  entityFocus:        string,
  apiKey:             string,
): Promise<RwQualityResult | null> {
  const inputPayload = {
    question_text:       questionText,
    news_context:        newsContext,
    sources:             sources.map((s) => ({
      source_name:  s.source_name ?? 'Unknown',
      title:        s.title       ?? '',
      published_at: s.published_at ?? '',
    })),
    confidence_level:    confidenceLevel,
    resolution_type:     resolutionType,
    resolution_deadline: resolutionDeadline,
    entity_focus:        entityFocus,
  };

  const body = {
    model:           MODEL_PREDICATE,  // gpt-4o-mini — deterministic scoring
    temperature:     0.0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: RW_QUALITY_SYSTEM_PROMPT },
      { role: 'user',   content: JSON.stringify(inputPayload) },
    ],
  };

  try {
    const res = await fetch(OPENAI_BASE, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn(`[rw-quality] OpenAI call failed (${res.status})`);
      return null;
    }

    const json    = await res.json();
    const content = (json.choices?.[0]?.message?.content ?? '').trim();
    const parsed  = JSON.parse(content) as RwQualityResult;

    // Validate minimal shape
    if (typeof parsed.final_score !== 'number' || !parsed.decision || !parsed.breakdown) {
      console.warn('[rw-quality] unexpected response shape:', content.slice(0, 200));
      return null;
    }

    return parsed;
  } catch (err) {
    console.warn('[rw-quality] Call 4 error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
