// ensure-prematch — demand-driven pre-match question orchestrator.
//
// Public, JWT-authenticated wrapper around generate-questions. Called from:
//   - create-league.html, immediately after a league row is inserted.
//   - league.html,        on every page load.
//
// Cron job (generate-questions-every-6h) is preserved unchanged as a backstop.
// This wrapper does NOT redesign generate-questions, the resolver, or any
// pillar-specific systems (Arena / BR / Trivia). It only:
//   1. Validates the caller can read the target league (RLS via user JWT).
//   2. Debounces — skips invocation if generation has already run for this
//      league within the last 5 minutes (covers tab refreshes / double-clicks).
//   3. Invokes generate-questions with body { league_id, [match_id] }.
//
// Idempotency is delegated to generate-questions, which already enforces
// per-league `prematch_question_budget` + pool fingerprint dedup +
// prematch-quality-filter Jaccard dedup. We do not write a new lock table.
//
// Spec: docs/QUESTION_SYSTEM.md, docs/LEAGUE_CREATION_FLOW.md.

// @ts-expect-error — Deno std import (resolved at deploy time)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-expect-error — Deno global
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
// @ts-expect-error — Deno global
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// @ts-expect-error — Deno global
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!;
// @ts-expect-error — Deno global
const CRON_SECRET       = Deno.env.get('CRON_SECRET')!;

const DEBOUNCE_MINUTES = 5;

// CORS preflight headers — page is same-origin in production but we keep these
// permissive for local dev served via python http.server.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

// @ts-expect-error — Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json(405, { ok: false, error: 'method_not_allowed' });

  // ── 1. Auth — require a valid Supabase JWT ──────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json(401, { ok: false, error: 'missing_bearer' });
  }

  // ── 2. Parse body ───────────────────────────────────────────────────
  let body: { league_id?: string; match_id?: string } = {};
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'invalid_json' }); }

  const leagueId = typeof body.league_id === 'string' ? body.league_id : '';
  const matchId  = typeof body.match_id  === 'string' ? body.match_id  : '';
  if (!leagueId) return json(400, { ok: false, error: 'missing_league_id' });

  // ── 3. Verify caller has read access to the league ──────────────────
  // Use the user's JWT against the anon client so RLS applies. If the user
  // can't read this league, RLS returns 0 rows and we reject.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: leagueRow, error: leagueErr } = await userClient
    .from('leagues')
    .select('id, ai_questions_enabled, prematch_question_budget')
    .eq('id', leagueId)
    .maybeSingle();

  if (leagueErr) return json(500, { ok: false, error: 'league_lookup_failed', detail: leagueErr.message });
  if (!leagueRow) return json(403, { ok: false, error: 'league_not_accessible' });
  if (!leagueRow.ai_questions_enabled) return json(200, { ok: true, status: 'ai_disabled' });

  // ── 4. Debounce — skip if generation ran very recently for this league ─
  // Service-role client for the dedup check (we want raw counts, not RLS).
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const sinceIso = new Date(Date.now() - DEBOUNCE_MINUTES * 60_000).toISOString();
  const { count: recentCount, error: recentErr } = await adminClient
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('question_type', 'CORE_MATCH_PREMATCH')
    .gte('created_at', sinceIso);

  if (recentErr) {
    // Non-fatal — fall through and let generate-questions decide.
    console.warn('[ensure-prematch] debounce check failed:', recentErr.message);
  } else if ((recentCount ?? 0) > 0) {
    return json(200, { ok: true, status: 'recent', recent_count: recentCount });
  }

  // ── 5. Forward to generate-questions ────────────────────────────────
  // We use the CRON_SECRET bearer — generate-questions already accepts that,
  // and we never expose it client-side. The wrapper is the only public surface.
  const upstreamPayload: Record<string, string> = { league_id: leagueId };
  if (matchId) upstreamPayload.match_id = matchId;

  const upstreamUrl = `${SUPABASE_URL}/functions/v1/generate-questions`;
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(upstreamPayload),
    });
  } catch (e) {
    console.error('[ensure-prematch] upstream invoke failed:', e);
    return json(502, { ok: false, error: 'upstream_unreachable' });
  }

  const upstreamText = await upstreamRes.text();
  let upstreamBody: unknown;
  try { upstreamBody = JSON.parse(upstreamText); } catch { upstreamBody = upstreamText; }

  if (!upstreamRes.ok) {
    return json(502, { ok: false, error: 'upstream_failed', upstream_status: upstreamRes.status, upstream_body: upstreamBody });
  }

  return json(200, {
    ok:           true,
    status:       'invoked',
    league_id:    leagueId,
    match_id:     matchId || null,
    upstream:     upstreamBody,
  });
});
