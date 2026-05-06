// sync-fixtures Edge Function
// Owns all API-Football data fetching. Other Edge Functions (generate-questions,
// resolve-questions) read from the cache tables — they never call API-Football directly.
//
// Sync modes (pass as ?type= query param or JSON body { type }):
//   daily      — fetch upcoming fixtures + standings for PL + La Liga (run once/day)
//   prematch   — fetch lineups for matches kicking off within 2h (run every 30 min)
//   live       — fetch fixture status + events for relevant live matches (run every 1 min)
//   stats      — fetch statistics for relevant live matches (run every 3 min)
//
// "Relevant match" = saved by a user/venue OR referenced by an active league question
//                    OR currently live (status 1H, HT, 2H, ET, BT)
//
// Invoke manually (smoke test):
//   curl "https://hdulhffpmuqepoqstsor.supabase.co/functions/v1/sync-fixtures?type=daily" \
//     -H "Authorization: Bearer <CRON_SECRET>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Constants ─────────────────────────────────────────────────────────────

const BASE            = 'https://v3.football.api-sports.io';
const ACTIVE_LEAGUES  = [39, 140];  // Premier League, La Liga (config-driven in Sprint 2)
const LIVE_STATUSES   = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P']);

// Returns the API-Football season year for the currently active season.
// API-Football uses the year the season starts: 2025 = 2025/26, 2026 = 2026/27.
// Rule: if current UTC month >= July (month 6, 0-indexed), season = current year;
//       otherwise season = current year - 1.
function getCurrentSeason(): number {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
const CANCELLED_STATUSES = new Set(['PST', 'CANC', 'ABD', 'SUSP', 'INT', 'TBD']);

// ── Entry point ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Auth check — same CRON_SECRET used by all scheduled functions
  const auth = req.headers.get('Authorization') ?? '';
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  if (!auth.includes(secret)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const url    = new URL(req.url);
  const type   = url.searchParams.get('type') ?? (await req.json().catch(() => ({}))).type ?? '';

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const apiKey = Deno.env.get('API_SPORTS_KEY')!;

  try {
    switch (type) {
      case 'daily':       return jsonOk(await syncDaily(sb, apiKey));
      case 'prematch':    return jsonOk(await syncPrematch(sb, apiKey));
      case 'live':        return jsonOk(await syncLive(sb, apiKey));
      case 'stats':       return jsonOk(await syncStats(sb, apiKey));
      case 'season_meta': return jsonOk(await syncSeasonMeta(sb, apiKey));
      default:
        return new Response(
          JSON.stringify({ error: 'unknown type — use daily | prematch | live | stats | season_meta' }),
          { status: 400 },
        );
    }
  } catch (err) {
    console.error(`[sync-fixtures:${type}] fatal`, err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// MODE: daily
// Fetches upcoming fixtures (next 14 days) + standings for all active leagues.
// ─────────────────────────────────────────────────────────────────────────

async function syncDaily(sb: any, apiKey: string) {
  const headers = apiHeaders(apiKey);
  let totalRequests = 0;
  let fixturesSynced = 0;
  const errors: string[] = [];

  for (const leagueId of ACTIVE_LEAGUES) {
    // ── Fixtures ──
    try {
      const today = dateStr(new Date());
      const future = dateStr(addDays(new Date(), 14));
      const res = await fetch(
        `${BASE}/fixtures?league=${leagueId}&season=${getCurrentSeason()}&from=${today}&to=${future}`,
        { headers },
      );
      totalRequests++;
      if (!res.ok) throw new Error(`fixtures API ${res.status}`);

      const json = await res.json();
      const rows = (json.response ?? []).map(mapFixture);

      if (rows.length > 0) {
        const { error } = await sb.from('api_football_fixtures').upsert(rows, { onConflict: 'fixture_id' });
        if (error) throw error;
        fixturesSynced += rows.length;
      }

      await logSync(sb, 'daily_fixtures', null, leagueId, 'ok', 1, rows.length);
    } catch (err) {
      const msg = String(err);
      errors.push(`fixtures league ${leagueId}: ${msg}`);
      await logSync(sb, 'daily_fixtures', null, leagueId, 'error', 1, 0, msg);
    }

    // ── Standings ──
    try {
      const res = await fetch(
        `${BASE}/standings?league=${leagueId}&season=${getCurrentSeason()}`,
        { headers },
      );
      totalRequests++;
      if (!res.ok) throw new Error(`standings API ${res.status}`);

      const json = await res.json();
      const rows = mapStandings(json.response ?? [], leagueId);

      if (rows.length > 0) {
        const { error } = await sb.from('api_football_standings').upsert(rows, { onConflict: 'league_id,season,team_id' });
        if (error) throw error;
      }

      await logSync(sb, 'daily_standings', null, leagueId, 'ok', 1, rows.length);
    } catch (err) {
      const msg = String(err);
      errors.push(`standings league ${leagueId}: ${msg}`);
      await logSync(sb, 'daily_standings', null, leagueId, 'error', 1, 0, msg);
    }
  }

  // Bulk-propagate fixture_status for any league_fixtures rows whose fixture has
  // reached a terminal state in api_football_fixtures. This catches finishes that
  // happened outside the live sync window (e.g. daily catch-up after a midnight game).
  // Fire-and-forget — failure does not affect daily sync result.
  try {
    await bulkPropagateTerminalStatuses(sb);
  } catch (err) {
    console.warn('[sync-daily] bulk propagate terminal statuses failed:', err);
  }

  return { ok: true, type: 'daily', requests: totalRequests, fixturesSynced, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// MODE: prematch
// Fetches lineups for matches kicking off within the next 2 hours.
// Only relevant fixtures (saved/active league) get lineups fetched.
// ─────────────────────────────────────────────────────────────────────────

async function syncPrematch(sb: any, apiKey: string) {
  const headers = apiHeaders(apiKey);
  const now   = new Date();
  const in2h  = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  // Matches kicking off in the next 2h that we haven't got lineups for yet
  const { data: upcoming } = await sb
    .from('api_football_fixtures')
    .select('fixture_id')
    .eq('status_short', 'NS')
    .gte('kickoff_at', now.toISOString())
    .lte('kickoff_at', in2h.toISOString());

  const fixtureIds: number[] = (upcoming ?? []).map((r: any) => r.fixture_id);
  if (fixtureIds.length === 0) {
    await logSync(sb, 'pre_match_lineups', null, null, 'skipped', 0, 0);
    return { ok: true, type: 'prematch', skipped: true, reason: 'no upcoming matches in 2h window' };
  }

  // Skip any fixture that already has lineups
  const { data: existing } = await sb
    .from('api_football_lineups')
    .select('fixture_id')
    .in('fixture_id', fixtureIds);
  const alreadyHave = new Set((existing ?? []).map((r: any) => r.fixture_id));
  const toFetch = fixtureIds.filter((id) => !alreadyHave.has(id));

  if (toFetch.length === 0) {
    await logSync(sb, 'pre_match_lineups', null, null, 'skipped', 0, 0);
    return { ok: true, type: 'prematch', skipped: true, reason: 'lineups already cached' };
  }

  let totalRequests = 0;
  let synced = 0;
  const errors: string[] = [];

  for (const fixtureId of toFetch) {
    try {
      const res = await fetch(`${BASE}/fixtures/lineups?fixture=${fixtureId}`, { headers });
      totalRequests++;
      if (!res.ok) throw new Error(`lineups API ${res.status}`);

      const json = await res.json();
      const rows = (json.response ?? []).map((entry: any) => mapLineup(fixtureId, entry));

      if (rows.length > 0) {
        const { error } = await sb.from('api_football_lineups').upsert(rows, { onConflict: 'fixture_id,team_id' });
        if (error) throw error;
        synced += rows.length;
      }

      await logSync(sb, 'pre_match_lineups', fixtureId, null, 'ok', 1, rows.length);
    } catch (err) {
      const msg = String(err);
      errors.push(`lineups fixture ${fixtureId}: ${msg}`);
      await logSync(sb, 'pre_match_lineups', fixtureId, null, 'error', 1, 0, msg);
    }
  }

  return { ok: true, type: 'prematch', requests: totalRequests, synced, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// MODE: live
// Refreshes fixture status + events for relevant live matches.
// Exits immediately (0 API calls) if no relevant matches are found.
// ─────────────────────────────────────────────────────────────────────────

async function syncLive(sb: any, apiKey: string) {
  const fixtureIds = await getRelevantFixtureIds(sb);

  if (fixtureIds.length === 0) {
    await logSync(sb, 'live_status', null, null, 'skipped', 0, 0);
    return { ok: true, type: 'live', skipped: true, reason: 'no relevant live matches' };
  }

  const headers = apiHeaders(apiKey);
  let totalRequests = 0;
  let synced = 0;
  const errors: string[] = [];

  for (const fixtureId of fixtureIds) {
    // ── Fixture status + score ──
    try {
      const res = await fetch(`${BASE}/fixtures?id=${fixtureId}`, { headers });
      totalRequests++;
      if (!res.ok) throw new Error(`fixture API ${res.status}`);

      const json = await res.json();
      const fixture = json.response?.[0];
      if (fixture) {
        const row = mapFixture(fixture);
        const { error } = await sb.from('api_football_fixtures').upsert(row, { onConflict: 'fixture_id' });
        if (error) throw error;
        synced++;

        // Propagate fixture_status + finished_at into league_fixtures (migration 063).
        // Runs after every live upsert so league_fixtures stays current without a join.
        await propagateFixtureStatus(sb, fixtureId, row.status_short);
      }
    } catch (err) {
      errors.push(`status fixture ${fixtureId}: ${String(err)}`);
    }

    // ── Events (goals, cards, subs) ──
    try {
      const res = await fetch(`${BASE}/fixtures/events?fixture=${fixtureId}`, { headers });
      totalRequests++;
      if (!res.ok) throw new Error(`events API ${res.status}`);

      const json = await res.json();
      const rows = (json.response ?? []).map((e: any) => mapEvent(fixtureId, e));

      for (const row of rows) {
        // INSERT ... ON CONFLICT DO NOTHING — preserves existing events
        const { error } = await sb.from('api_football_events').upsert(row, {
          onConflict: 'fixture_id,time_elapsed,team_id,event_type,player_id',
          ignoreDuplicates: true,
        });
        if (error) console.warn(`[live-events] upsert warn fixture ${fixtureId}:`, error.message);
      }
    } catch (err) {
      errors.push(`events fixture ${fixtureId}: ${String(err)}`);
    }
  }

  await logSync(sb, 'live_status', null, null, 'ok', totalRequests, synced);
  return { ok: true, type: 'live', fixtures: fixtureIds.length, requests: totalRequests, synced, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// MODE: stats
// Refreshes team statistics for relevant live matches (every 3 min).
// ─────────────────────────────────────────────────────────────────────────

async function syncStats(sb: any, apiKey: string) {
  const fixtureIds = await getRelevantFixtureIds(sb);

  if (fixtureIds.length === 0) {
    await logSync(sb, 'live_stats', null, null, 'skipped', 0, 0);
    return { ok: true, type: 'stats', skipped: true, reason: 'no relevant live matches' };
  }

  const headers = apiHeaders(apiKey);
  let totalRequests = 0;
  let synced = 0;
  const errors: string[] = [];

  for (const fixtureId of fixtureIds) {
    try {
      const res = await fetch(`${BASE}/fixtures/statistics?fixture=${fixtureId}`, { headers });
      totalRequests++;
      if (!res.ok) throw new Error(`statistics API ${res.status}`);

      const json = await res.json();
      const rows = (json.response ?? []).map((entry: any) => mapStatistics(fixtureId, entry));

      if (rows.length > 0) {
        const { error } = await sb.from('api_football_statistics').upsert(rows, { onConflict: 'fixture_id,team_id' });
        if (error) throw error;
        synced += rows.length;
      }

      await logSync(sb, 'live_stats', fixtureId, null, 'ok', 1, rows.length);
    } catch (err) {
      const msg = String(err);
      errors.push(`stats fixture ${fixtureId}: ${msg}`);
      await logSync(sb, 'live_stats', fixtureId, null, 'error', 1, 0, msg);
    }
  }

  return { ok: true, type: 'stats', fixtures: fixtureIds.length, requests: totalRequests, synced, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// Relevant fixture resolver
// Returns fixture IDs that are currently live OR saved by users/venues
// OR referenced by active league questions.
// ─────────────────────────────────────────────────────────────────────────

async function getRelevantFixtureIds(sb: any): Promise<number[]> {
  const ids = new Set<number>();

  // 1. Currently live in our fixture cache
  const { data: live } = await sb
    .from('api_football_fixtures')
    .select('fixture_id')
    .in('status_short', [...LIVE_STATUSES]);
  (live ?? []).forEach((r: any) => ids.add(r.fixture_id));

  // 2. Saved by users or venues (kickoff in the past 3h — live window)
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data: saved } = await sb
    .from('saved_matches')
    .select('match_id')
    .gte('kickoff_at', threeHoursAgo);
  (saved ?? []).forEach((r: any) => {
    const n = parseInt(r.match_id, 10);
    if (!isNaN(n)) ids.add(n);
  });

  // 3. Referenced by active questions in leagues (open questions only)
  const { data: questions } = await sb
    .from('questions')
    .select('match_id')
    .eq('status', 'active')
    .not('match_id', 'is', null);
  (questions ?? []).forEach((r: any) => {
    const n = parseInt(r.match_id, 10);
    if (!isNaN(n)) ids.add(n);
  });

  return [...ids];
}

// ─────────────────────────────────────────────────────────────────────────
// MODE: season_meta
// Fetches official season start/end dates from API-Sports /leagues endpoint
// for each competition in ACTIVE_LEAGUES and writes them to sports_competitions.
//
// Populates:
//   sports_competitions.current_season_end    — official season end date
//   sports_competitions.season_end_synced_at  — timestamp of this sync
//
// The Season Long completion evaluator reads current_season_end to decide
// if a competition's season has officially concluded (Phase 2b+).
// NULL means unknown — evaluator must defer when NULL.
//
// Safe to run daily. Recommended cron: once per day at 03:00 UTC.
// Call manually: curl "...sync-fixtures?type=season_meta" -H "Authorization: Bearer <CRON_SECRET>"
// ─────────────────────────────────────────────────────────────────────────

async function syncSeasonMeta(sb: any, apiKey: string) {
  const headers = apiHeaders(apiKey);
  const season  = getCurrentSeason();
  const results: Array<{ leagueId: number; seasonEnd: string | null; status: string }> = [];
  const errors: string[] = [];
  let totalRequests = 0;

  for (const leagueId of ACTIVE_LEAGUES) {
    try {
      const res = await fetch(`${BASE}/leagues?id=${leagueId}&season=${season}`, { headers });
      totalRequests++;
      if (!res.ok) throw new Error(`leagues API ${res.status}`);

      const json  = await res.json();
      const entry = json.response?.[0];

      // API-Sports returns seasons[] array; find the one matching our season year.
      const seasonMeta = (entry?.seasons ?? []).find((s: any) => s.year === season);
      const seasonEnd: string | null = seasonMeta?.end ?? null; // format: "YYYY-MM-DD"

      if (seasonEnd) {
        const { error } = await sb
          .from('sports_competitions')
          .update({
            current_season_end:   seasonEnd,
            season_end_synced_at: new Date().toISOString(),
          })
          .eq('api_league_id', leagueId)
          .eq('api_provider', 'api-sports');

        if (error) throw error;
        results.push({ leagueId, seasonEnd, status: 'ok' });
        console.log(`[season_meta] league ${leagueId} — season end: ${seasonEnd}`);
      } else {
        // API returned no end date — leave existing value, do not overwrite with NULL.
        results.push({ leagueId, seasonEnd: null, status: 'no_end_date_in_api' });
        console.warn(`[season_meta] league ${leagueId} — API returned no season end date for season ${season}`);
      }

      await logSync(sb, 'season_meta', null, leagueId, 'ok', 1, 0);
    } catch (err) {
      const msg = String(err);
      errors.push(`season_meta league ${leagueId}: ${msg}`);
      results.push({ leagueId, seasonEnd: null, status: 'error' });
      console.error(`[season_meta] league ${leagueId} error:`, msg);
      await logSync(sb, 'season_meta', null, leagueId, 'error', 1, 0, msg);
    }
  }

  return { ok: true, type: 'season_meta', season, requests: totalRequests, results, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// Propagate a single fixture's status into league_fixtures (migration 063).
// Called by syncLive after each fixture upsert.
// ─────────────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO', 'CANC', 'ABD']);

async function propagateFixtureStatus(sb: any, fixtureId: number, statusShort: string | null) {
  if (!statusShort) return;

  const isTerminal = TERMINAL_STATUSES.has(statusShort);
  const update: Record<string, any> = { fixture_status: statusShort };
  if (isTerminal) update.finished_at = new Date().toISOString();

  const { error } = await sb
    .from('league_fixtures')
    .update(update)
    .eq('fixture_id', fixtureId)
    // Only update if status actually changed (skip if already terminal to preserve finished_at).
    .or(`fixture_status.is.null,fixture_status.neq.${statusShort}`);

  if (error) {
    console.warn(`[propagate] league_fixtures update failed for fixture ${fixtureId}:`, error.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Bulk-propagate terminal statuses from api_football_fixtures → league_fixtures.
// Called at the end of syncDaily to catch any finishes missed by live sync.
// Uses a raw SQL approach via RPC — falls back to a JS loop if RPC unavailable.
// ─────────────────────────────────────────────────────────────────────────

async function bulkPropagateTerminalStatuses(sb: any) {
  // Fetch all league_fixtures rows that don't yet have a terminal fixture_status.
  const { data: pending, error: fetchErr } = await sb
    .from('league_fixtures')
    .select('fixture_id')
    .or('fixture_status.is.null,fixture_status.not.in.(FT,AET,PEN,AWD,WO,CANC,ABD)');

  if (fetchErr) {
    console.warn('[bulk-propagate] fetch pending failed:', fetchErr.message);
    return;
  }
  if (!pending || pending.length === 0) return;

  const fixtureIds = (pending as any[]).map((r) => r.fixture_id);

  // Look up current status in api_football_fixtures.
  const { data: canonicalRows, error: canonErr } = await sb
    .from('api_football_fixtures')
    .select('fixture_id, status_short')
    .in('fixture_id', fixtureIds)
    .in('status_short', [...TERMINAL_STATUSES]);

  if (canonErr) {
    console.warn('[bulk-propagate] api_football_fixtures lookup failed:', canonErr.message);
    return;
  }
  if (!canonicalRows || canonicalRows.length === 0) return;

  // Update each fixture with a terminal status that hasn't been propagated yet.
  let updated = 0;
  for (const row of canonicalRows as any[]) {
    await propagateFixtureStatus(sb, row.fixture_id, row.status_short);
    updated++;
  }

  console.log(`[bulk-propagate] propagated terminal status for ${updated} fixture(s)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Row mappers
// ─────────────────────────────────────────────────────────────────────────

function mapFixture(f: any) {
  return {
    fixture_id:     f.fixture.id,
    league_id:      f.league?.id ?? null,
    season:         f.league?.season ?? getCurrentSeason(),
    kickoff_at:     f.fixture.date ?? null,
    status_short:   f.fixture.status?.short ?? null,
    status_elapsed: f.fixture.status?.elapsed ?? null,
    home_team_id:   f.teams?.home?.id ?? null,
    home_team_name: f.teams?.home?.name ?? null,
    away_team_id:   f.teams?.away?.id ?? null,
    away_team_name: f.teams?.away?.name ?? null,
    home_goals:     f.goals?.home ?? null,
    away_goals:     f.goals?.away ?? null,
    home_winner:    f.teams?.home?.winner ?? null,
    away_winner:    f.teams?.away?.winner ?? null,
    venue_name:     f.fixture?.venue?.name ?? null,
    referee:        f.fixture?.referee ?? null,
    round:          f.league?.round ?? null,
    raw_fixture:    f,
    synced_at:      new Date().toISOString(),
  };
}

function mapEvent(fixtureId: number, e: any) {
  return {
    fixture_id:    fixtureId,
    time_elapsed:  e.time?.elapsed ?? null,
    time_extra:    e.time?.extra ?? null,
    team_id:       e.team?.id ?? null,
    team_name:     e.team?.name ?? null,
    player_id:     e.player?.id ?? null,
    player_name:   e.player?.name ?? null,
    assist_id:     e.assist?.id ?? null,
    assist_name:   e.assist?.name ?? null,
    event_type:    e.type ?? null,
    event_detail:  e.detail ?? null,
    comments:      e.comments ?? null,
    synced_at:     new Date().toISOString(),
  };
}

function mapStatistics(fixtureId: number, entry: any) {
  const raw: any[] = entry.statistics ?? [];
  const get = (type: string) => {
    const s = raw.find((r: any) => r.type === type);
    return s ? (parseInt(String(s.value ?? '0'), 10) || 0) : 0;
  };
  return {
    fixture_id:      fixtureId,
    team_id:         entry.team?.id ?? null,
    team_name:       entry.team?.name ?? null,
    shots_total:     get('Total Shots'),
    shots_on:        get('Shots on Goal'),
    shots_off:       get('Shots off Goal'),
    corners:         get('Corner Kicks'),
    yellow_cards:    get('Yellow Cards'),
    red_cards:       get('Red Cards'),
    fouls:           get('Fouls'),
    offsides:        get('Offsides'),
    possession_pct:  parseInt(String(raw.find((r: any) => r.type === 'Ball Possession')?.value ?? '0'), 10) || 0,
    passes_total:    get('Total passes'),
    passes_accurate: get('Passes accurate'),
    raw_stats:       raw,
    synced_at:       new Date().toISOString(),
  };
}

function mapLineup(fixtureId: number, entry: any) {
  return {
    fixture_id:  fixtureId,
    team_id:     entry.team?.id ?? null,
    team_name:   entry.team?.name ?? null,
    formation:   entry.formation ?? null,
    coach_name:  entry.coach?.name ?? null,
    start_xi:    (entry.startXI ?? []).map((p: any) => ({
      id:     p.player?.id,
      name:   p.player?.name,
      number: p.player?.number,
      pos:    p.player?.pos,
      grid:   p.player?.grid,
    })),
    substitutes: (entry.substitutes ?? []).map((p: any) => ({
      id:     p.player?.id,
      name:   p.player?.name,
      number: p.player?.number,
      pos:    p.player?.pos,
    })),
    synced_at: new Date().toISOString(),
  };
}

function mapStandings(response: any[], leagueId: number): any[] {
  const rows: any[] = [];
  for (const group of response) {
    const table = group.league?.standings?.[0] ?? [];
    for (const entry of table) {
      rows.push({
        league_id:     leagueId,
        season:        group.league?.season ?? getCurrentSeason(),
        team_id:       entry.team?.id,
        team_name:     entry.team?.name,
        rank:          entry.rank,
        points:        entry.points,
        played:        entry.all?.played ?? 0,
        won:           entry.all?.win ?? 0,
        drawn:         entry.all?.draw ?? 0,
        lost:          entry.all?.lose ?? 0,
        goals_for:     entry.all?.goals?.for ?? 0,
        goals_against: entry.all?.goals?.against ?? 0,
        goal_diff:     entry.goalsDiff ?? 0,
        form:          entry.form ?? null,
        description:   entry.description ?? null,
        synced_at:     new Date().toISOString(),
      });
    }
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function apiHeaders(key: string) {
  return { 'x-apisports-key': key };
}

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function logSync(
  sb: any,
  syncType: string,
  fixtureId: number | null,
  leagueId: number | null,
  status: string,
  requests: number,
  synced: number,
  errorMsg?: string,
) {
  await sb.from('api_football_sync_log').insert({
    sync_type:       syncType,
    fixture_id:      fixtureId,
    league_id:       leagueId,
    status,
    requests_made:   requests,
    fixtures_synced: synced,
    error_message:   errorMsg ?? null,
  });
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}
