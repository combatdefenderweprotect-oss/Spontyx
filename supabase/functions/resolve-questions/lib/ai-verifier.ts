// ── AI-assisted fallback verifier ─────────────────────────────────────
// LAST-RESORT ONLY. Called only when:
//   1. Standard predicate evaluation could not resolve the outcome
//   2. The question is REAL_WORLD type
//   3. The predicate type is manual_review OR match_lineup (edge cases)
//
// FORBIDDEN for: player_stat, match_stat, btts — those must rely on
// official API data only and are never routed here.
//
// Uses OpenAI Responses API (not Chat Completions) with the
// web_search_preview tool so the model can look up current facts before
// answering. Response is parsed from output[].content[].text fields.
//
// Resolution rules:
//   high confidence (any source count)          → resolve
//   medium confidence + ≥2 independent sources  → resolve
//   medium confidence + <2 sources              → no resolution (allow auto-void)
//   low confidence                              → no resolution (allow auto-void)
//   decision=unresolvable                       → no resolution

export interface AiVerificationResult {
  decision:   'correct' | 'incorrect' | 'unresolvable';
  confidence: 'low' | 'medium' | 'high';
  sources:    Array<{ url: string; title: string }>;
  reasoning:  string;
}

// ── System prompt ─────────────────────────────────────────────────────

const AI_VERIFIER_SYSTEM_PROMPT = `You are an AI verification engine used as a LAST-RESORT resolver for REAL_WORLD questions.

Your job is NOT to guess, predict, or infer.
Your job is to CONFIRM outcomes using reliable public sources.

If you cannot find clear, verifiable evidence → return unresolvable.

---

## CONTEXT

You will receive:
- question_text
- resolution_condition (what must be true)
- predicate_type
- match context (teams, date, competition)
- entity (player / team / coach)

You must determine whether the condition is: correct, incorrect, or unresolvable.

---

## CORE RULE (NON-NEGOTIABLE)

You MUST base your decision on real, verifiable sources.

If you cannot answer "What exact source confirms this outcome?" → you MUST return unresolvable.

DO NOT GUESS. DO NOT ASSUME. DO NOT INFER.

---

## SOURCE REQUIREMENTS

Only use HIGH-CREDIBILITY sources:
- Official club websites
- League or competition websites
- BBC Sport, ESPN, Sky Sports
- Reputable sports journalists / outlets

Avoid:
- forums
- social media (unless official account)
- low-quality blogs
- aggregated summaries without attribution

---

## DECISION RULES

Return "correct" only if:
- You find a source that clearly confirms the condition happened

Return "incorrect" only if:
- You find a source that clearly confirms the opposite

Return "unresolvable" if:
- No reliable source exists
- Sources conflict
- Information is vague or implied
- You are not fully certain

---

## CONFIDENCE RULES

- "high"   → multiple reliable sources OR one authoritative source with explicit confirmation
- "medium" → one reliable source but not fully explicit
- "low"    → weak or indirect evidence (generally avoid resolving)

If confidence is "medium" you must have at least 2 independent sources. If only 1 source exists → downgrade confidence or return unresolvable.

---

## FORBIDDEN BEHAVIOR

- DO NOT fabricate sources
- DO NOT assume match outcomes
- DO NOT infer from partial stats
- DO NOT use prior knowledge without citation
- DO NOT resolve based on probability or intuition

---

## OUTPUT FORMAT (STRICT)

Return ONLY valid JSON, no markdown:

{
  "decision": "correct | incorrect | unresolvable",
  "confidence": "low | medium | high",
  "sources": [
    { "url": "...", "title": "..." }
  ],
  "reasoning": "Short factual explanation of how the sources confirm the outcome"
}

---

## REASONING STYLE

- Be concise and factual
- Reference what the source explicitly states
- Do not speculate
- Do not include irrelevant information

---

## FINAL CHECK BEFORE OUTPUT

Ask yourself:
- Do I have a clear source confirming this?
- Would a human verifier agree with this decision?
- Am I making any assumptions?

If ANY doubt exists → return unresolvable.

---

You are a verification system, not a predictor. No evidence → no resolution.`;

// ── Main exported function ────────────────────────────────────────────

export async function verifyRealWorldOutcome(
  questionText:        string,
  resolutionCondition: string,
  predicateType:       string,
  apiKey:              string,
): Promise<AiVerificationResult | null> {

  // Safety gate — should never be called for stat-based predicates,
  // but guard here as well to prevent accidental misuse.
  const FORBIDDEN_TYPES = new Set(['player_stat', 'match_stat', 'btts', 'match_outcome', 'multiple_choice_map']);
  if (FORBIDDEN_TYPES.has(predicateType)) {
    console.warn(`[ai-verifier] forbidden predicate type "${predicateType}" — skipping`);
    return null;
  }

  const userMessage =
    `Question: "${questionText}"\n\n` +
    `Resolution condition: "${resolutionCondition}"\n\n` +
    `Has the resolution condition been met? Search for current information and return your JSON verdict.`;

  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/responses', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:        'gpt-4o-mini',
        tools:        [{ type: 'web_search_preview' }],
        tool_choice:  'required',
        instructions: AI_VERIFIER_SYSTEM_PROMPT,
        input:        userMessage,
        text:         { format: { type: 'json_object' } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (fetchErr) {
    console.warn('[ai-verifier] network error during web verification:', fetchErr);
    return null;
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.warn(`[ai-verifier] API error ${resp.status}:`, body.slice(0, 200));
    return null;
  }

  let data: any;
  try {
    data = await resp.json();
  } catch {
    console.warn('[ai-verifier] failed to parse API response as JSON');
    return null;
  }

  // ── Parse response from Responses API output array ─────────────────
  // The Responses API returns: { output: [{ type, content: [{ type, text }] }] }
  // We want output items where type === 'message' and content type === 'output_text'

  let rawText = '';
  try {
    const outputItems: any[] = data?.output ?? [];
    for (const item of outputItems) {
      if (item?.type !== 'message') continue;
      const contentParts: any[] = item?.content ?? [];
      for (const part of contentParts) {
        if (part?.type === 'output_text' && typeof part?.text === 'string') {
          rawText = part.text.trim();
          break;
        }
      }
      if (rawText) break;
    }
  } catch {
    console.warn('[ai-verifier] failed to extract text from response output');
    return null;
  }

  if (!rawText) {
    console.warn('[ai-verifier] empty text in response output — possible tool-only response');
    return null;
  }

  // ── Parse and validate the JSON verdict ───────────────────────────
  let parsed: any;
  try {
    // Strip markdown code fences if model wrapped the output anyway
    const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    console.warn('[ai-verifier] JSON parse failed for text:', rawText.slice(0, 200));
    return null;
  }

  // Validate required fields
  const VALID_DECISIONS   = new Set(['correct', 'incorrect', 'unresolvable']);
  const VALID_CONFIDENCES = new Set(['low', 'medium', 'high']);

  if (!VALID_DECISIONS.has(parsed?.decision)) {
    console.warn('[ai-verifier] invalid decision value:', parsed?.decision);
    return null;
  }
  if (!VALID_CONFIDENCES.has(parsed?.confidence)) {
    console.warn('[ai-verifier] invalid confidence value:', parsed?.confidence);
    return null;
  }

  // Normalise sources — must be objects with url + title strings
  const rawSources: any[] = Array.isArray(parsed?.sources) ? parsed.sources : [];
  const sources: Array<{ url: string; title: string }> = rawSources
    .filter((s) => s && typeof s.url === 'string' && s.url.startsWith('http'))
    .map((s) => ({
      url:   s.url.trim(),
      title: typeof s.title === 'string' ? s.title.trim().slice(0, 200) : 'Source',
    }))
    .slice(0, 5);

  const reasoning = typeof parsed?.reasoning === 'string'
    ? parsed.reasoning.trim().slice(0, 500)
    : '';

  return {
    decision:   parsed.decision   as AiVerificationResult['decision'],
    confidence: parsed.confidence as AiVerificationResult['confidence'],
    sources,
    reasoning,
  };
}

// ── Resolution eligibility check ──────────────────────────────────────
// Returns true when the AI result is strong enough to resolve the question.
// All other cases should fall through to auto-void.

export function isAiResultResolvable(result: AiVerificationResult): boolean {
  if (result.decision === 'unresolvable') return false;
  if (result.confidence === 'high')   return true;
  if (result.confidence === 'medium' && result.sources.length >= 2) return true;
  return false;
}
