import type { RawGeneratedQuestion, ResolutionPredicate } from './types.ts';

const OPENAI_BASE      = 'https://api.openai.com/v1/chat/completions';
const MODEL_GENERATION = 'gpt-4o-mini';  // creative call — upgrade to gpt-4o if quality drops
const MODEL_PREDICATE  = 'gpt-4o-mini';  // mechanical JSON conversion — mini is sufficient
export const PROMPT_VERSION = 'v2.1';

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
- last_event_type (goal | penalty | red_card | none)

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

visible_from:
→ now_timestamp + 20–60s

answer_closes_at:
→ early: visible_from + 4–6 min
→ mid:   visible_from + 3–5 min
→ late:  visible_from + 2–4 min
→ minimum 90s always

resolves_after:
→ answer_closes_at + 60–90s

event-driven:
→ prefer longer window

==================================================
GENERATION MODES
==================================================

PREMATCH:
──────────────────────────────────────────────────────────
PREMATCH QUESTION RULESET (v2.1)
These rules apply ONLY when generation_mode = "prematch".
Read all rules before generating a single question.
──────────────────────────────────────────────────────────

VOLUME + TIMING
- generate exactly max_questions_allowed questions
- if max_questions_allowed is 0 or not present, default to 4
- visible_from   = now_timestamp + 30s
- answer_closes_at = match kickoff time
- resolves_after = kickoff + sport buffer (football: +150min)
- generation_trigger = "prematch_only" on every question
- match_minute_at_generation = null on every question

──────────────────────────────────────────────────────────
RULE 1 — QUESTION TYPE DISTRIBUTION
──────────────────────────────────────────────────────────

For 3 questions:
  slot 1 → outcome/state  (match winner, draw, both teams score, clean sheet)
  slot 2 → match stat     (total goals, over/under, corners, cards)
  slot 3 → player/team    (player scorer, team goal, team defensive record)

For 4 questions:
  slot 1 → outcome/state
  slot 2 → goals/BTTS/clean sheet
  slot 3 → player-specific
  slot 4 → context-driven  (underdog angle, away team angle, rivalry angle, form streak)

For 5+ questions:
  max 2 player-specific questions
  max 2 outcome/state questions
  at least 1 match stat question
  at least 1 question with an angle on the underdog or away team

NEVER generate all questions from the same question_subtype.
NEVER generate all questions from the same predicate type (match_outcome, match_stat, player_stat).

──────────────────────────────────────────────────────────
RULE 2 — QUALITY FILTERS
──────────────────────────────────────────────────────────

DO NOT ask:
  ✗ "Will there be a goal in the match?" — trivially obvious, ~95% likely in football
  ✗ "Will [heavy favourite] win?" when team is clearly dominant (e.g. top vs bottom table)
  ✗ "Will [Player] score?" if player is UNAVAILABLE or DOUBTFUL
  ✗ any question where one answer is overwhelmingly obvious (>80% likely based on context)
  ✗ subjective questions: momentum, pressure, dominance, confidence, determination
  ✗ questions requiring judgment after the match: "best player", "most deserved", "lucky"

DO prefer:
  ✓ over/under goals lines (1.5, 2.5, 3.5)
  ✓ BTTS (both teams to score)
  ✓ clean sheet (specific team)
  ✓ underdog resistance: "Will [weaker team] score?"
  ✓ player contributions where player is confirmed available
  ✓ team-specific stat angles: "Will [Team] have 10+ shots?"
  ✓ H2H-informed questions when H2H data shows a pattern
  ✓ form-based questions: "Will [Team] extend their X-game unbeaten run?"

──────────────────────────────────────────────────────────
RULE 3 — MATCH CONTEXT ADAPTATION
──────────────────────────────────────────────────────────

Read standings, form, H2H, and goals data from context before deciding question angles.

CLOSE MATCH (teams within 3 table positions OR similar form):
  → winner / draw is a valid and interesting question
  → BTTS is appropriate
  → late-scoring / first-half goals questions work well
  → use difficulty_multiplier = 1.2

HEAVY FAVOURITE vs WEAK OPPONENT (5+ table positions gap OR dominant form):
  → DO NOT ask simple "Will [favourite] win?" — too obvious
  → Instead ask:
      "Will [favourite] win by 2+ goals?"
      "Will [underdog] score at least once?"
      "Will [favourite] keep a clean sheet?"
      "Will [favourite] score in the first half?"
  → use difficulty_multiplier = 1.5 for underdog-angle questions

RIVALRY / DERBY (same city, historic rivalry, cup match):
  → prefer high-intensity angles: cards, BTTS, both teams scoring
  → derby matches historically produce cards — yellow/red card total questions are valid
  → avoid clean sheet (derbies rarely end 0-0 or without cards)
  → use difficulty_multiplier = 1.2

LOW-SCORING TEAMS (both teams average under 1.0 goals/game from context):
  → prefer: under 2.5 goals, clean sheet, 0-0 / 1-0 outcomes
  → avoid: BTTS (unlikely), over 3.5 goals

HIGH-SCORING TEAMS (both teams average over 1.5 goals/game from context):
  → prefer: BTTS, over 2.5 goals, player goal questions
  → avoid: clean sheet (unlikely for both teams)

KEY PLAYER UNAVAILABLE:
  → DO NOT ask about that player (already enforced by PLAYER AVAILABILITY rules)
  → ask team-impact alternative instead:
      "Will [Team] score without [Player]?"
      "Will [Team] win despite the absence of [Player]?"

──────────────────────────────────────────────────────────
RULE 4 — TEAM BALANCE
──────────────────────────────────────────────────────────

Across the full question set:
  → do not make EVERY question about the favourite or home team
  → include at least ONE angle involving the underdog or away team
  → player questions must not all come from the same team
    (unless this is a team-scoped league — scope field will say "team_specific")

Team-scoped leagues (scope = "team_specific"):
  → majority of questions should focus on the scoped team
  → still obey: no duplicate player questions, no duplicate predicate types
  → at least 1 question involving the opponent (e.g. "Will [opponent] keep them scoreless?")

──────────────────────────────────────────────────────────
RULE 5 — PLAYER QUESTIONS (strict gate)
──────────────────────────────────────────────────────────

Only generate a player-specific question if ALL of the following are true:
  1. The player appears in the context (KEY PLAYERS or PLAYER AVAILABILITY)
  2. The player is NOT listed as UNAVAILABLE
  3. The player is NOT listed as DOUBTFUL (unless you have no alternative)
  4. The stat you are asking about is resolvable (see PLAYER STATS section above)

ALLOWED player stat questions for prematch:
  ✓ goals ≥ 1 (will player score)
  ✓ assists ≥ 1 (will player assist)
  ✓ shots ≥ 2 or ≥ 3 (will player have shots)
  ✓ cards ≥ 1 (will player be booked)
  ✓ clean_sheet (GK only — will goalkeeper keep a clean sheet)

NEVER ask about for prematch:
  ✗ pass accuracy percentage
  ✗ xG or expected goals
  ✗ distance covered, sprint speed, heat map
  ✗ dribbles/tackles/interceptions for outfield player prematch (rarely meaningful for fans)

MAXIMUM: 2 player-specific questions per set regardless of max_questions_allowed.

──────────────────────────────────────────────────────────
RULE 6 — RESOLVABILITY GATE
──────────────────────────────────────────────────────────

Every prematch question MUST be resolvable from one of:
  → final score (home_score, away_score)
  → team match stats (total_goals, total_cards, total_corners, shots_total)
  → player match stats (goals, assists, shots, cards, clean_sheet)
  → official match outcome (winner_team_id or draw)

DO NOT generate questions that require:
  ✗ human judgment or interpretation after the match
  ✗ betting odds or market settlement rules
  ✗ news or events that occur after kickoff
  ✗ statistics not available in the API (xG, pass%, heat map, etc.)
  ✗ time-windowed player stats (goals in first 20 minutes — impossible to resolve)

──────────────────────────────────────────────────────────
RULE 7 — DIVERSITY WITHIN THE SET
──────────────────────────────────────────────────────────

Within one generated prematch set:
  → do not repeat the same predicate type more than twice
      (e.g. no more than 2 match_stat predicates in a 4-question set)
  → do not ask about the same player twice
  → do not ask about the same stat focus twice
      (e.g. no "Will X score?" AND "Will Y score?" as two separate questions — combine or replace one)
  → vary phrasing: mix binary YES/NO with multiple_choice where multiple_choice adds genuine value
  → if 3+ questions would be binary with obvious 50/50 framing, make at least 1 multiple_choice
      (e.g. "Who will score first: [Home player] / [Away player] / No goal in first half")

──────────────────────────────────────────────────────────
RULE 8 — SELF-CHECK BEFORE OUTPUT
──────────────────────────────────────────────────────────

Before returning the final JSON, internally verify each question:

  □ Is the question_subtype unique or distinct enough from others in the set?
  □ Is at least one question covering each team (or both teams together)?
  □ Are all player questions passing the player gate (available, stat resolvable)?
  □ Is any question obviously too easy (>80% likely)? If yes — replace it.
  □ Is any question vague or subjective? If yes — replace it.
  □ Are all predicates resolvable from final match data?
  □ If this is a heavy-favourite match — have I avoided the obvious winner question?
  □ Are there 2+ questions from the same team? If yes — rebalance.

Replace any failing question before output. Do not output a question that fails any check.

LIVE_EVENT:
- 1–2 questions
- high_value_event or outcome

LIVE_GAP:
- exactly 1 question
- corners / cards / shots

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
  "predicate_hint": string (e.g. "match_stat: total_goals gte 2" or "player_stat: goals gte 1 for player_id X")
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
