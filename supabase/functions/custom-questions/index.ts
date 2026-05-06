/**
 * custom-questions — Edge Function for admin-created custom league questions.
 *
 * Supported actions (POST body.action):
 *   create         — admin creates + publishes a custom question
 *   submit_answer  — member submits answer (single or multi choice)
 *   resolve        — admin resolves with correct answers + scores all players
 *   void           — admin voids question, zeroes any earned points
 *
 * Auth: JWT required for all actions. Checks are done inside each handler.
 * DB writes use service_role key (bypasses RLS). Permission guards are
 * enforced in-function by querying the leagues / league_members tables.
 *
 * Deploy:
 *   supabase functions deploy custom-questions --no-verify-jwt
 *   (JWT verification is done manually inside the function)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Environment ────────────────────────────────────────────────────────────
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ── Constants ──────────────────────────────────────────────────────────────
const SCORING_PRESETS: Record<string, { correct: number; wrong: number }> = {
  safe:      { correct: 10, wrong:   0 },
  balanced:  { correct: 15, wrong:  -5 },
  risk:      { correct: 25, wrong: -10 },
  high_risk: { correct: 40, wrong: -25 },
};

// Tier limits for how many custom questions an admin can create
const TIER_LIMITS: Record<string, { per_day: number; per_match: number }> = {
  starter:       { per_day: 2,  per_match: 3 },
  pro:           { per_day: 5,  per_match: 5 },
  elite:         { per_day: 10, per_match: 8 },
  // Venue tiers inherit the player-equivalent limits
  'venue-starter': { per_day: 2,  per_match: 3 },
  'venue-pro':     { per_day: 5,  per_match: 5 },
  'venue-elite':   { per_day: 10, per_match: 8 },
};

const MIN_DEADLINE_SECS = 15;
const MAX_DEADLINE_SECS = 300;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

// ── Helpers ────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function err(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

// ── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST',
      },
    });
  }

  if (req.method !== 'POST') return err('method_not_allowed', 405);

  // ── Auth: extract and verify JWT ──────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return err('unauthorized', 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: { user }, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !user) return err('unauthorized', 401);

  // ── Parse body ────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('invalid_json');
  }

  const action = body.action as string | undefined;
  switch (action) {
    case 'create':        return handleCreate(sb, user.id, body);
    case 'submit_answer': return handleSubmitAnswer(sb, user.id, body);
    case 'resolve':       return handleResolve(sb, user.id, body);
    case 'void':          return handleVoid(sb, user.id, body);
    default:              return err('unknown_action');
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  CREATE — admin creates and immediately publishes a custom question
// ════════════════════════════════════════════════════════════════════════════
async function handleCreate(sb: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>): Promise<Response> {
  const {
    league_id,
    question_text,
    custom_question_type,
    options,
    scoring_preset,
    deadline_seconds,
    match_id,
  } = body as {
    league_id: string;
    question_text: string;
    custom_question_type: 'single' | 'multi';
    options: string[];
    scoring_preset: string;
    deadline_seconds: number;
    match_id?: number;
  };

  // ── Validate presence ─────────────────────────────────────────────────
  if (!league_id)       return err('league_id required');
  if (!question_text?.trim()) return err('question_text required');
  if (!custom_question_type || !['single', 'multi'].includes(custom_question_type)) {
    return err('custom_question_type must be single or multi');
  }
  if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return err(`options must be an array of ${MIN_OPTIONS}–${MAX_OPTIONS} strings`);
  }
  if (!scoring_preset || !SCORING_PRESETS[scoring_preset]) {
    return err('scoring_preset must be one of: safe, balanced, risk, high_risk');
  }
  const deadlineSecs = Number(deadline_seconds);
  if (!Number.isFinite(deadlineSecs) || deadlineSecs < MIN_DEADLINE_SECS || deadlineSecs > MAX_DEADLINE_SECS) {
    return err(`deadline_seconds must be between ${MIN_DEADLINE_SECS} and ${MAX_DEADLINE_SECS}`);
  }

  // Sanitise options
  const cleanOptions = (options as unknown[]).map((o) => String(o).trim()).filter(Boolean);
  if (cleanOptions.length < MIN_OPTIONS) return err('At least 2 non-empty options required');
  // Commas in labels would corrupt the comma-joined answer field used as fallback
  if (cleanOptions.some((o) => o.includes(','))) return err('option labels must not contain commas');

  // ── Check: user is league owner ───────────────────────────────────────
  const { data: league, error: leagueErr } = await sb
    .from('leagues')
    .select('id, owner_id')
    .eq('id', league_id)
    .single();

  if (leagueErr || !league) return err('league not found', 404);
  if (league.owner_id !== userId) return err('forbidden: not league owner', 403);

  // ── Tier limit check ──────────────────────────────────────────────────
  const { data: userRow } = await sb
    .from('users')
    .select('tier')
    .eq('id', userId)
    .single();

  const tier = (userRow?.tier as string | undefined) ?? 'starter';
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS['starter'];

  // Count today's custom questions created by this admin for this league
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count: todayCount } = await sb
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', league_id)
    .eq('source', 'custom')
    .eq('created_by_user_id', userId)
    .gte('created_at', todayStart.toISOString());

  if ((todayCount ?? 0) >= limits.per_day) {
    return err(`tier_limit_exceeded: max ${limits.per_day} custom questions per day for ${tier} tier`, 429);
  }

  // Per-match limit (only when match_id is provided)
  if (match_id) {
    const { count: matchCount } = await sb
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', league_id)
      .eq('source', 'custom')
      .eq('match_id', match_id);

    if ((matchCount ?? 0) >= limits.per_match) {
      return err(`tier_limit_exceeded: max ${limits.per_match} custom questions per match for ${tier} tier`, 429);
    }
  }

  // ── Compute timing ────────────────────────────────────────────────────
  const now = new Date();
  const answerClosesAt = new Date(now.getTime() + deadlineSecs * 1000);
  // resolves_after = far future (custom questions resolve on admin action, not cron)
  const resolvesAfter = new Date(answerClosesAt.getTime() + 365 * 24 * 60 * 60 * 1000);

  const preset = SCORING_PRESETS[scoring_preset];

  // ── Insert question ───────────────────────────────────────────────────
  const { data: question, error: insertErr } = await sb
    .from('questions')
    .insert({
      league_id,
      question_text:          question_text.trim(),
      type:                   'multiple_choice',
      question_type:          'CUSTOM',
      event_type:             'custom',
      source:                 'custom',
      custom_question_type,
      custom_options:         cleanOptions,
      custom_points_correct:  preset.correct,
      custom_points_wrong:    preset.wrong,
      created_by_user_id:     userId,
      custom_resolution_status: 'pending',
      resolution_status:      'pending',
      // Timing (three-timestamp model)
      visible_from:           now.toISOString(),
      answer_closes_at:       answerClosesAt.toISOString(),
      resolves_after:         resolvesAfter.toISOString(),
      // Match context (optional — for per-match tier limit tracking)
      ...(match_id ? { match_id: String(match_id) } : {}),
      // Scoring metadata — flat for custom questions (no multipliers)
      base_value: preset.correct,
    })
    .select('id, question_text, answer_closes_at, custom_options, custom_points_correct, custom_points_wrong')
    .single();

  if (insertErr || !question) {
    console.error('[custom-questions] create insert error:', insertErr);
    return err('insert failed', 500);
  }

  // ── Audit event ───────────────────────────────────────────────────────
  await sb.from('custom_question_events').insert({
    question_id: question.id,
    action:      'created',
    payload:     { scoring_preset, deadline_seconds: deadlineSecs, options: cleanOptions, custom_question_type },
    created_by:  userId,
  });

  console.log(`[custom-questions] created question=${question.id} league=${league_id} type=${custom_question_type} preset=${scoring_preset} deadline=${deadlineSecs}s`);

  return json({ ok: true, question });
}

// ════════════════════════════════════════════════════════════════════════════
//  SUBMIT ANSWER — member submits answer to a custom question
// ════════════════════════════════════════════════════════════════════════════
async function handleSubmitAnswer(sb: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>): Promise<Response> {
  const { question_id, selected_options } = body as {
    question_id: string;
    selected_options: string[];
  };

  if (!question_id)    return err('question_id required');
  if (!Array.isArray(selected_options) || selected_options.length === 0) {
    return err('selected_options must be a non-empty array');
  }

  // ── Fetch question ────────────────────────────────────────────────────
  const { data: q, error: qErr } = await sb
    .from('questions')
    .select('id, league_id, source, custom_question_type, custom_options, answer_closes_at, resolution_status')
    .eq('id', question_id)
    .single();

  if (qErr || !q) return err('question not found', 404);
  if (q.source !== 'custom') return err('not a custom question');
  if (q.resolution_status !== 'pending') return err('question is closed');

  // ── Deadline check ────────────────────────────────────────────────────
  const closesAt = q.answer_closes_at ? new Date(q.answer_closes_at) : null;
  if (!closesAt || Date.now() > closesAt.getTime()) {
    return err('answer window closed', 409);
  }

  // ── Membership check ──────────────────────────────────────────────────
  const { data: membership } = await sb
    .from('league_members')
    .select('user_id')
    .eq('league_id', q.league_id)
    .eq('user_id', userId)
    .single();

  if (!membership) return err('not a league member', 403);

  // ── Validate selected options against allowed options ─────────────────
  const allowedOptions: string[] = Array.isArray(q.custom_options) ? q.custom_options : [];
  const invalidOpts = (selected_options as string[]).filter((o) => !allowedOptions.includes(o));
  if (invalidOpts.length > 0) {
    return err(`invalid options: ${invalidOpts.join(', ')}`);
  }

  // Single-choice: only one option allowed
  if (q.custom_question_type === 'single' && selected_options.length > 1) {
    return err('single_choice: only one option allowed');
  }

  // ── Check not already answered ────────────────────────────────────────
  const { data: existing } = await sb
    .from('player_answers')
    .select('id')
    .eq('question_id', question_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) return err('already answered', 409);

  // ── Insert answer ─────────────────────────────────────────────────────
  // Use first option as 'answer' for backwards-compat; selected_options holds the truth.
  const { error: insertErr } = await sb
    .from('player_answers')
    .insert({
      question_id,
      user_id:          userId,
      league_id:        q.league_id,
      answer:           selected_options.join(','),
      selected_options: selected_options,
      answered_at:      new Date().toISOString(),
      points_earned:    0,
    });

  if (insertErr) {
    // Unique violation = race condition, answer already saved
    if (insertErr.code === '23505') return err('already answered', 409);
    console.error('[custom-questions] submit_answer insert error:', insertErr);
    return err('insert failed', 500);
  }

  await sb.from('custom_question_events').insert({
    question_id,
    action:     'answered',
    payload:    { answered: true },
    created_by: userId,
  });

  return json({ ok: true });
}

// ════════════════════════════════════════════════════════════════════════════
//  RESOLVE — admin marks correct answer(s) and scores all players
// ════════════════════════════════════════════════════════════════════════════
async function handleResolve(sb: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>): Promise<Response> {
  const { question_id, correct_answers } = body as {
    question_id: string;
    correct_answers: string[];
  };

  if (!question_id) return err('question_id required');
  if (!Array.isArray(correct_answers) || correct_answers.length === 0) {
    return err('correct_answers must be a non-empty array');
  }

  // ── Fetch question ────────────────────────────────────────────────────
  const { data: q, error: qErr } = await sb
    .from('questions')
    .select([
      'id', 'league_id', 'source', 'custom_question_type',
      'custom_options', 'answer_closes_at', 'custom_resolution_status',
      'custom_points_correct', 'custom_points_wrong',
    ].join(', '))
    .eq('id', question_id)
    .single();

  if (qErr || !q) return err('question not found', 404);
  if (q.source !== 'custom') return err('not a custom question');

  // ── Admin guard ───────────────────────────────────────────────────────
  const { data: league } = await sb
    .from('leagues')
    .select('owner_id')
    .eq('id', q.league_id)
    .single();

  if (!league || league.owner_id !== userId) return err('forbidden: not league owner', 403);

  // ── State guards ──────────────────────────────────────────────────────
  if (q.custom_resolution_status !== 'pending') {
    return err(`already ${q.custom_resolution_status}`, 409);
  }

  // Deadline must have passed (admin cannot resolve before deadline)
  const closesAt = q.answer_closes_at ? new Date(q.answer_closes_at) : null;
  if (!closesAt) return err('invalid question: missing answer_closes_at', 500);
  if (Date.now() < closesAt.getTime()) {
    return err('answer window still open — wait for the deadline', 409);
  }

  // ── Validate correct_answers against allowed options ──────────────────
  const allowedOptions: string[] = Array.isArray(q.custom_options) ? q.custom_options : [];
  const invalidAnswers = (correct_answers as string[]).filter((a) => !allowedOptions.includes(a));
  if (invalidAnswers.length > 0) {
    return err(`invalid correct_answers: ${invalidAnswers.join(', ')}`);
  }

  // ── Atomic claim: mark resolved before scoring to prevent double-award ─
  // UPDATE with WHERE custom_resolution_status='pending' is the idempotency
  // guard. Only the first concurrent request will find and update the row;
  // any duplicate will get 0 rows back and return 409.
  const now = new Date().toISOString();
  const { data: claimedRows, error: claimErr } = await sb
    .from('questions')
    .update({
      custom_correct_answers:   correct_answers,
      custom_resolution_status: 'resolved',
      resolution_status:        'resolved',
      resolution_outcome:       correct_answers[0] ?? null,
      resolved_by_user_id:      userId,
      resolved_at:              now,
    })
    .eq('id', question_id)
    .eq('custom_resolution_status', 'pending')
    .select('id');

  if (claimErr) {
    console.error('[custom-questions] resolve claim error:', claimErr);
    return err('claim failed', 500);
  }
  if (!claimedRows || claimedRows.length === 0) {
    // Another request already claimed this question
    return err('already resolved or voided', 409);
  }

  // Normalise: sort for consistent comparison
  const correctSorted = [...correct_answers].sort();

  // ── Fetch all player answers ──────────────────────────────────────────
  const { data: playerAnswers, error: paErr } = await sb
    .from('player_answers')
    .select('id, user_id, selected_options, answer')
    .eq('question_id', question_id);

  if (paErr) {
    console.error('[custom-questions] resolve fetch answers error:', paErr);
    return err('failed to fetch answers', 500);
  }

  const answers = playerAnswers ?? [];

  // ── Score each answer (strict exact match) ────────────────────────────
  const pointsCorrect = q.custom_points_correct ?? 10;
  const pointsWrong   = q.custom_points_wrong   ?? 0;

  const updates: Array<{ id: string; is_correct: boolean; points_earned: number }> = [];

  for (const pa of answers) {
    // Normalise selected_options from DB (may be stored as JSONB array or comma-string)
    let selectedRaw: string[] = [];
    if (Array.isArray(pa.selected_options)) {
      selectedRaw = pa.selected_options as string[];
    } else if (typeof pa.answer === 'string' && pa.answer) {
      selectedRaw = pa.answer.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    const selectedSorted = [...selectedRaw].sort();

    // Strict: exact match of the sorted arrays
    const isCorrect =
      selectedSorted.length === correctSorted.length &&
      selectedSorted.every((v, i) => v === correctSorted[i]);

    updates.push({
      id:           pa.id,
      is_correct:   isCorrect,
      points_earned: isCorrect ? pointsCorrect : pointsWrong,
    });
  }

  // ── Batch update player_answers ───────────────────────────────────────
  // Supabase client doesn't support bulk UPDATE with per-row values, so we
  // use individual updates. For typical custom question batches (<100 answers)
  // this is fine; revisit with a raw SQL function if leagues grow large.
  const updateErrors: string[] = [];
  for (const u of updates) {
    const { error: upErr } = await sb
      .from('player_answers')
      .update({
        is_correct:    u.is_correct,
        points_earned: u.points_earned,
        multiplier_breakdown: {
          model:   'custom_flat',
          correct: u.is_correct,
          points:  u.points_earned,
        },
      })
      .eq('id', u.id);

    if (upErr) {
      console.error(`[custom-questions] resolve update player_answer ${u.id} error:`, upErr);
      updateErrors.push(u.id);
    }
  }

  // ── Audit event ───────────────────────────────────────────────────────
  const correctCount = updates.filter((u) => u.is_correct).length;
  await sb.from('custom_question_events').insert({
    question_id,
    action:     'resolved',
    payload:    { correct_answers, total_answers: updates.length, correct_count: correctCount, update_errors: updateErrors },
    created_by: userId,
  });

  console.log(`[custom-questions] resolved question=${question_id} answers=${updates.length} correct=${correctCount} errors=${updateErrors.length}`);

  return json({
    ok: true,
    total_answers: updates.length,
    correct_count: correctCount,
    scored:        updates.map((u) => ({ id: u.id, is_correct: u.is_correct, points_earned: u.points_earned })),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  VOID — admin voids a custom question (zeroes any earned points)
// ════════════════════════════════════════════════════════════════════════════
async function handleVoid(sb: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>): Promise<Response> {
  const { question_id } = body as { question_id: string };

  if (!question_id) return err('question_id required');

  // ── Fetch question ────────────────────────────────────────────────────
  const { data: q, error: qErr } = await sb
    .from('questions')
    .select('id, league_id, source, custom_resolution_status')
    .eq('id', question_id)
    .single();

  if (qErr || !q) return err('question not found', 404);
  if (q.source !== 'custom') return err('not a custom question');

  // ── Admin guard ───────────────────────────────────────────────────────
  const { data: league } = await sb
    .from('leagues')
    .select('owner_id')
    .eq('id', q.league_id)
    .single();

  if (!league || league.owner_id !== userId) return err('forbidden: not league owner', 403);

  if (q.custom_resolution_status === 'voided') return err('already voided', 409);

  // ── Zero out any points already awarded ───────────────────────────────
  if (q.custom_resolution_status === 'resolved') {
    const { error: zeroErr } = await sb
      .from('player_answers')
      .update({ points_earned: 0, is_correct: false, multiplier_breakdown: { model: 'custom_flat', voided: true } })
      .eq('question_id', question_id);

    if (zeroErr) {
      console.error('[custom-questions] void zero points error:', zeroErr);
    }
  }

  // ── Mark question voided ──────────────────────────────────────────────
  const { error: qUpErr } = await sb
    .from('questions')
    .update({
      custom_resolution_status: 'voided',
      resolution_status:        'voided',
    })
    .eq('id', question_id);

  if (qUpErr) {
    console.error('[custom-questions] void question update error:', qUpErr);
    return err('question update failed', 500);
  }

  await sb.from('custom_question_events').insert({
    question_id,
    action:     'voided',
    payload:    { previous_status: q.custom_resolution_status },
    created_by: userId,
  });

  console.log(`[custom-questions] voided question=${question_id}`);

  return json({ ok: true });
}
