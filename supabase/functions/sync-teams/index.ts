// sync-teams Edge Function
// Fetches every team for every active competition from API-Sports
// and upserts them into public.sports_teams.
//
// Invoke manually:
//   curl -X POST https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/sync-teams \
//     -H "Authorization: Bearer <CRON_SECRET>"
//
// Safe to re-run — fully idempotent via ON CONFLICT upsert.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const HOCKEY_BASE   = 'https://v1.hockey.api-sports.io';

interface Competition {
  id: string;
  sport: string;
  api_league_id: number;
  api_season: number;
  name: string;
}

interface TeamRow {
  sport: string;
  name: string;
  short_name: string | null;
  api_provider: string;
  api_team_id: number;
  api_league_id: number;
  country: string | null;
  is_active: boolean;
}

// ── Fetch all teams for a football competition ─────────────────────────

async function fetchFootballTeams(leagueId: number, season: number, apiKey: string): Promise<TeamRow[]> {
  const url = `${FOOTBALL_BASE}/teams?league=${leagueId}&season=${season}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (!res.ok) throw new Error(`Football teams API error: ${res.status}`);
  const data = await res.json();

  if (!Array.isArray(data.response)) return [];

  return data.response.map((item: any) => ({
    sport:        'football',
    name:         item.team?.name ?? 'Unknown',
    short_name:   item.team?.code ?? null,
    api_provider: 'api-sports',
    api_team_id:  item.team?.id,
    api_league_id: leagueId,
    country:      item.team?.country ?? null,
    is_active:    true,
  })).filter((t: TeamRow) => t.api_team_id != null);
}

// ── Fetch all teams for a hockey competition ───────────────────────────

async function fetchHockeyTeams(leagueId: number, season: number, apiKey: string): Promise<TeamRow[]> {
  const url = `${HOCKEY_BASE}/teams?league=${leagueId}&season=${season}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (!res.ok) throw new Error(`Hockey teams API error: ${res.status}`);
  const data = await res.json();

  if (!Array.isArray(data.response)) return [];

  return data.response.map((item: any) => ({
    sport:        'hockey',
    name:         item.name ?? 'Unknown',
    short_name:   item.code ?? null,
    api_provider: 'api-sports',
    api_team_id:  item.id,
    api_league_id: leagueId,
    country:      item.country?.name ?? null,
    is_active:    true,
  })).filter((t: TeamRow) => t.api_team_id != null);
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Auth check
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const auth = req.headers.get('Authorization') ?? '';
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabaseUrl     = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiSportsKey    = Deno.env.get('API_SPORTS_KEY') ?? '';

  if (!apiSportsKey) {
    return new Response(JSON.stringify({ error: 'API_SPORTS_KEY not set' }), { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  // Load all active competitions
  const { data: competitions, error: compErr } = await sb
    .from('sports_competitions')
    .select('id, sport, api_league_id, api_season, name')
    .eq('is_active', true);

  if (compErr || !competitions) {
    return new Response(JSON.stringify({ error: 'Failed to load competitions', detail: compErr }), { status: 500 });
  }

  const results: Record<string, { inserted: number; errors: string[] }> = {};

  for (const comp of competitions as Competition[]) {
    const label = `${comp.name} (${comp.sport} league ${comp.api_league_id} s${comp.api_season})`;
    results[label] = { inserted: 0, errors: [] };

    try {
      let teams: TeamRow[] = [];

      if (comp.sport === 'football') {
        teams = await fetchFootballTeams(comp.api_league_id, comp.api_season, apiSportsKey);
      } else if (comp.sport === 'hockey') {
        teams = await fetchHockeyTeams(comp.api_league_id, comp.api_season, apiSportsKey);
      } else {
        results[label].errors.push(`Sport '${comp.sport}' not yet supported — skipped`);
        continue;
      }

      if (teams.length === 0) {
        results[label].errors.push('API returned 0 teams — check league ID and season');
        continue;
      }

      // Upsert in batches of 50
      for (let i = 0; i < teams.length; i += 50) {
        const batch = teams.slice(i, i + 50);
        const { error: upsertErr } = await sb
          .from('sports_teams')
          .upsert(batch, { onConflict: 'sport,api_provider,api_team_id,api_league_id' });

        if (upsertErr) {
          results[label].errors.push(`Batch upsert error: ${upsertErr.message}`);
        } else {
          results[label].inserted += batch.length;
        }
      }
    } catch (err: any) {
      results[label].errors.push(err.message ?? String(err));
    }
  }

  const totalInserted = Object.values(results).reduce((s, r) => s + r.inserted, 0);

  return new Response(JSON.stringify({ ok: true, total_upserted: totalInserted, competitions: results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
