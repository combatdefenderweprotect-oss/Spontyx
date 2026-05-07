/**
 * join-arena-queue — Arena v1 matchmaking entry point.
 *
 * Supported actions (POST body.action):
 *   join          — enter the queue for a fixture + phase; pair if opponent waiting
 *   cancel_queue  — cancel the caller's current waiting entry
 *
 * Auth: JWT required. Verified manually via sb.auth.getUser().
 *
 * join validation order:
 *   1. JWT present + valid
 *   2. Required fields: fixture_id, phase (H1|H2), arena_mode (ranked|casual)
 *   3. Fixture has a live_match_stats row (fixture must be tracked)
 *   4. Phase window:
 *        H1 → status='1H', minute 0–25
 *        H2 → status='2H', minute 45–65
 *   5. Minimum viable question estimate (≥4 at 1 per 3 min) — implicit in window,
 *      enforced explicitly as a safety net
 *   6. pair_arena_queue RPC — handles duplicate guard + atomic pairing
 *
 * Returns:
 *   { ok: true, status: 'matched', session_id: '<uuid>' }
 *   { ok: true, status: 'waiting', queue_id:   '<uuid>' }
 *   { ok: false, error: '<code>' }
 *
 * Error codes:
 *   unauthorized | missing_action | unknown_action | invalid_json
 *   missing_fixture_id | invalid_fixture_id | invalid_phase | invalid_arena_mode
 *   fixture_not_live | outside_join_window | insufficient_questions
 *   already_in_queue | queue_error | cancel_failed
 *
 * Deploy:
 *   supabase functions deploy join-arena-queue --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Environment ───────────────────────────────────────────────────────────────
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ── Window constants ──────────────────────────────────────────────────────────
// H1: match must be status '1H', elapsed minute 0–25.
const H1_MINUTE_MAX = 25;
// H2: match must be status '2H', elapsed minute 45–65.
const H2_MINUTE_MIN = 45;
const H2_MINUTE_MAX = 65;

// Minimum questions a session must be able to generate (1 per 3 minutes).
// At H1 cutoff (minute 25): ~20 min to HT → ~6 questions ✓
// At H2 cutoff (minute 65): ~25 min to FT → ~8 questions ✓
// Window guards above make this redundant in practice; kept as explicit safety net.
const MIN_QUESTIONS_VIABLE = 4;
const MINS_PER_QUESTION    = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
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

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return err('unauthorized', 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return err('unauthorized', 401);

  const userId = user.id;

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('invalid_json');
  }

  const action = body.action as string | undefined;
  if (!action) return err('missing_action');

  // ── Action: cancel_queue ──────────────────────────────────────────────────
  if (action === 'cancel_queue') {
    const queueId = (body.queue_id as string) ?? null;
    const { data, error: cancelErr } = await sb.rpc('cancel_arena_queue', {
      p_user_id:  userId,
      p_queue_id: queueId,
    });
    if (cancelErr) {
      console.warn('[join-arena-queue] cancel_arena_queue error', cancelErr.message);
      return err('cancel_failed', 500);
    }
    return json({ ok: true, ...(data as object) });
  }

  // ── Action: join ──────────────────────────────────────────────────────────
  if (action !== 'join') return err('unknown_action');

  // ── 3. Field validation ───────────────────────────────────────────────────
  const fixtureIdRaw = body.fixture_id;
  const sport        = typeof body.sport === 'string' ? body.sport : 'football';
  const phase        = body.phase        as string | undefined;
  const arenaMode    = body.arena_mode   as string | undefined;

  if (fixtureIdRaw == null)                       return err('missing_fixture_id');
  if (!['H1', 'H2'].includes(phase ?? ''))        return err('invalid_phase');
  if (!['ranked', 'casual'].includes(arenaMode ?? '')) return err('invalid_arena_mode');

  const fid = Number(fixtureIdRaw);
  if (!Number.isInteger(fid) || fid <= 0)         return err('invalid_fixture_id');

  // ── 4. Fixture liveness check ─────────────────────────────────────────────
  // live_match_stats is the authoritative real-time source. If the fixture has
  // no row here it has never been tracked by the poller — we cannot validate
  // the match minute or guarantee question generation.
  const { data: lms, error: lmsErr } = await sb
    .from('live_match_stats')
    .select('fixture_id, status, minute, home_team_name, away_team_name, kickoff_at')
    .eq('fixture_id', fid)
    .single();

  if (lmsErr || !lms) return err('fixture_not_live');

  const matchStatus = lms.status  as string;
  const minute      = (lms.minute as number) ?? 0;

  // ── 5. Phase window validation ────────────────────────────────────────────
  if (phase === 'H1') {
    if (matchStatus !== '1H')         return err('outside_join_window', 422);
    if (minute > H1_MINUTE_MAX)       return err('outside_join_window', 422);
  } else {
    // H2
    if (matchStatus !== '2H')         return err('outside_join_window', 422);
    if (minute < H2_MINUTE_MIN)       return err('outside_join_window', 422);
    if (minute > H2_MINUTE_MAX)       return err('outside_join_window', 422);
  }

  // ── 6. Minimum viable question count ─────────────────────────────────────
  // Remaining minutes until the half ends.
  const halfEndMinute    = phase === 'H1' ? 45 : 90;
  const remainingMinutes = halfEndMinute - minute;
  const estimatedQuestions = Math.floor(remainingMinutes / MINS_PER_QUESTION);

  if (estimatedQuestions < MIN_QUESTIONS_VIABLE) {
    console.warn(
      `[join-arena-queue] insufficient_questions fixture=${fid} phase=${phase}` +
      ` minute=${minute} remaining=${remainingMinutes} estimated=${estimatedQuestions}`,
    );
    return err('insufficient_questions', 422);
  }

  // ── 7. Atomic pairing via RPC ─────────────────────────────────────────────
  // pair_arena_queue handles:
  //   - duplicate queue guard (already_in_queue)
  //   - SKIP LOCKED opponent claim
  //   - arena_session + arena_session_players creation
  //   - queue entry status updates
  const { data: pairResult, error: pairErr } = await sb.rpc('pair_arena_queue', {
    p_user_id:      userId,
    p_fixture_id:   fid,
    p_sport:        sport,
    p_phase:        phase,
    p_arena_mode:   arenaMode,
    p_match_minute: minute,
    p_home_team:    lms.home_team_name ?? null,
    p_away_team:    lms.away_team_name ?? null,
    p_kickoff_at:   lms.kickoff_at     ?? null,
  });

  if (pairErr) {
    console.warn('[join-arena-queue] pair_arena_queue error', pairErr.message);
    return err('queue_error', 500);
  }

  const result = pairResult as {
    status:     string;
    session_id?: string;
    queue_id?:  string;
    reason?:    string;
  };

  if (result.status === 'error') {
    if (result.reason === 'already_in_queue') return err('already_in_queue', 409);
    console.warn('[join-arena-queue] rpc error reason', result.reason);
    return err(result.reason ?? 'queue_error', 500);
  }

  // status: 'matched' | 'waiting'
  return json({ ok: true, ...result });
});
