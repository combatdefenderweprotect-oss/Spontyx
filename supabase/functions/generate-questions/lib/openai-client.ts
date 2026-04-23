import type { RawGeneratedQuestion, ResolutionPredicate } from './types.ts';

const OPENAI_BASE      = 'https://api.openai.com/v1/chat/completions';
const MODEL_GENERATION = 'gpt-4o-mini';  // creative call — upgrade to gpt-4o if quality drops
const MODEL_PREDICATE  = 'gpt-4o-mini';  // mechanical JSON conversion — mini is sufficient
export const PROMPT_VERSION = 'v1.7';

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
- exactly 5 questions
- winner, goals, BTTS, player
- visible_from = now_timestamp + 30s
- answer_closes_at = match kickoff time
- resolves_after = kickoff + sport buffer

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
