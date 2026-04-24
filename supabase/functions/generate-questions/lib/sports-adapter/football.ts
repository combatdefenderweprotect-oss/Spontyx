import type { SportMatch, SportPlayer, StandingsEntry, TeamForm, SportsContext } from '../types.ts';

const BASE = 'https://v3.football.api-sports.io';

interface FootballAdapterOptions {
  apiKey: string;
  sb: any;             // Supabase client — used to read from cache tables
  leagueId: number;
  season: number;
  teamId?: number;     // set for team_specific scope
  scopeType: 'full_league' | 'team_specific';
}

// ── Main entry point ──────────────────────────────────────────────────

export async function fetchFootballContext(opts: FootballAdapterOptions): Promise<SportsContext> {
  const headers = { 'x-apisports-key': opts.apiKey };

  // Fixtures and standings read from the DB cache (populated by sync-fixtures).
  // Injuries and top scorers still hit the API directly (not cached yet).
  const [fixturesRes, standingsRes, injuriesRes] = await Promise.allSettled([
    fetchUpcomingFixturesFromCache(opts),
    fetchStandingsFromCache(opts),
    fetchInjuries(opts, headers),
  ]);

  const upcomingMatches = fixturesRes.status === 'fulfilled' ? fixturesRes.value : [];
  const standings       = standingsRes.status === 'fulfilled' ? standingsRes.value : [];
  const injuredPlayers  = injuriesRes.status === 'fulfilled' ? injuriesRes.value : [];

  const form = standings.slice(0, 10).map((s) => buildFormFromStandings(s));

  const keyPlayers = await fetchKeyPlayers(opts, headers, upcomingMatches, injuredPlayers);

  const narrativeHooks = deriveNarrativeHooks(upcomingMatches, standings, keyPlayers);

  return { upcomingMatches, standings, form, keyPlayers, narrativeHooks };
}

// ── Upcoming fixtures — reads from api_football_fixtures cache ────────

async function fetchUpcomingFixturesFromCache(opts: FootballAdapterOptions): Promise<SportMatch[]> {
  const now    = new Date().toISOString();
  const in7d   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  let query = opts.sb
    .from('api_football_fixtures')
    .select('fixture_id, home_team_id, home_team_name, away_team_id, away_team_name, kickoff_at, venue_name, round')
    .eq('status_short', 'NS')
    .gte('kickoff_at', now)
    .lte('kickoff_at', in7d)
    .order('kickoff_at', { ascending: true })
    .limit(5);

  if (opts.scopeType === 'team_specific' && opts.teamId) {
    query = query.or(`home_team_id.eq.${opts.teamId},away_team_id.eq.${opts.teamId}`);
  } else {
    query = query.eq('league_id', opts.leagueId);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[football-adapter] fixture cache read error:', error.message);
    // Fall back to direct API call if cache read fails
    return fetchUpcomingFixturesFromAPI(opts, { 'x-apisports-key': opts.apiKey });
  }

  if (!data || data.length === 0) {
    console.warn('[football-adapter] fixture cache empty for league', opts.leagueId, '— falling back to API');
    return fetchUpcomingFixturesFromAPI(opts, { 'x-apisports-key': opts.apiKey });
  }

  return data.map((row: any): SportMatch => ({
    id:          String(row.fixture_id),
    sport:       'football',
    homeTeam:    { id: String(row.home_team_id), name: row.home_team_name },
    awayTeam:    { id: String(row.away_team_id), name: row.away_team_name },
    kickoff:     row.kickoff_at,
    competition: `League ${opts.leagueId}`,
    venue:       row.venue_name ?? undefined,
    status:      'not_started',
  }));
}

// ── Standings — reads from api_football_standings cache ───────────────

async function fetchStandingsFromCache(opts: FootballAdapterOptions): Promise<StandingsEntry[]> {
  const { data, error } = await opts.sb
    .from('api_football_standings')
    .select('team_id, team_name, rank, points, played, won, drawn, lost, goal_diff, form')
    .eq('league_id', opts.leagueId)
    .eq('season', opts.season)
    .order('rank', { ascending: true })
    .limit(20);

  if (error || !data || data.length === 0) {
    if (error) console.warn('[football-adapter] standings cache read error:', error.message);
    return fetchStandingsFromAPI(opts, { 'x-apisports-key': opts.apiKey });
  }

  let table = data as any[];
  if (opts.scopeType === 'team_specific' && opts.teamId) {
    const idx = table.findIndex((r: any) => r.team_id === opts.teamId);
    if (idx >= 0) {
      const start = Math.max(0, idx - 3);
      const end   = Math.min(table.length, idx + 4);
      table = table.slice(start, end);
    } else {
      table = table.slice(0, 8);
    }
  } else {
    table = table.slice(0, 8);
  }

  return table.map((r: any): StandingsEntry => ({
    position:       r.rank,
    team:           { id: String(r.team_id), name: r.team_name },
    points:         r.points,
    played:         r.played,
    won:            r.won,
    drawn:          r.drawn,
    lost:           r.lost,
    goalDifference: r.goal_diff,
  }));
}

// ── API fallbacks (used only when cache is empty / cold start) ────────

async function fetchUpcomingFixturesFromAPI(
  opts: FootballAdapterOptions,
  headers: Record<string, string>,
): Promise<SportMatch[]> {
  const params = new URLSearchParams({ next: '10', status: 'NS' });
  if (opts.scopeType === 'team_specific' && opts.teamId) {
    params.set('team', String(opts.teamId));
  } else {
    params.set('league', String(opts.leagueId));
    params.set('season', String(opts.season));
  }

  const res = await fetch(`${BASE}/fixtures?${params}`, { headers });
  if (!res.ok) throw new Error(`fixtures API error: ${res.status}`);
  const json = await res.json();

  return ((json.response ?? []) as any[])
    .filter((f: any) => {
      const kickoff = new Date(f.fixture?.date ?? '').getTime();
      const now = Date.now();
      return kickoff > now && kickoff <= now + 7 * 24 * 60 * 60 * 1000;
    })
    .slice(0, 5)
    .map((f: any): SportMatch => ({
      id:          String(f.fixture.id),
      sport:       'football',
      homeTeam:    { id: String(f.teams.home.id), name: f.teams.home.name },
      awayTeam:    { id: String(f.teams.away.id), name: f.teams.away.name },
      kickoff:     f.fixture.date,
      competition: f.league?.name ?? 'Unknown',
      venue:       f.fixture.venue?.name,
      status:      'not_started',
    }));
}

async function fetchStandingsFromAPI(
  opts: FootballAdapterOptions,
  headers: Record<string, string>,
): Promise<StandingsEntry[]> {
  const params = new URLSearchParams({
    league: String(opts.leagueId),
    season: String(opts.season),
  });
  const res = await fetch(`${BASE}/standings?${params}`, { headers });
  if (!res.ok) return [];
  const json = await res.json();

  const table: any[] = json.response?.[0]?.league?.standings?.[0] ?? [];

  let filtered = table;
  if (opts.scopeType === 'team_specific' && opts.teamId) {
    const idx = table.findIndex((r: any) => r.team.id === opts.teamId);
    if (idx >= 0) {
      const start = Math.max(0, idx - 3);
      const end   = Math.min(table.length, idx + 4);
      filtered = table.slice(start, end);
    } else {
      filtered = table.slice(0, 8);
    }
  } else {
    filtered = table.slice(0, 8);
  }

  return filtered.map((r: any): StandingsEntry => ({
    position:       r.rank,
    team:           { id: String(r.team.id), name: r.team.name },
    points:         r.points,
    played:         r.all?.played ?? 0,
    won:            r.all?.win    ?? 0,
    drawn:          r.all?.draw   ?? 0,
    lost:           r.all?.lose   ?? 0,
    goalDifference: r.goalsDiff   ?? 0,
  }));
}

// ── Injuries — still direct API (not cached) ──────────────────────────

async function fetchInjuries(
  opts: FootballAdapterOptions,
  headers: Record<string, string>,
): Promise<SportPlayer[]> {
  const today = new Date().toISOString().split('T')[0];
  const params = new URLSearchParams({
    league: String(opts.leagueId),
    season: String(opts.season),
    date:   today,
  });
  const res = await fetch(`${BASE}/injuries?${params}`, { headers });
  if (!res.ok) return [];
  const json = await res.json();

  return ((json.response ?? []) as any[])
    .filter((r: any) => {
      if (opts.scopeType === 'team_specific' && opts.teamId) {
        return r.team?.id === opts.teamId;
      }
      return true;
    })
    .slice(0, 20)
    .map((r: any): SportPlayer => ({
      id:           String(r.player.id),
      name:         r.player.name,
      teamId:       String(r.team.id),
      teamName:     r.team.name,
      position:     r.player.type,
      injuryStatus: mapInjuryReason(r.player.reason),
      injuryNote:   r.player.reason ?? undefined,
    }));
}

// ── Key players: top scorers + injured — still direct API ─────────────

async function fetchKeyPlayers(
  opts: FootballAdapterOptions,
  headers: Record<string, string>,
  upcomingMatches: SportMatch[],
  injuredPlayers: SportPlayer[],
): Promise<SportPlayer[]> {
  const params = new URLSearchParams({
    league: String(opts.leagueId),
    season: String(opts.season),
  });
  const res = await fetch(`${BASE}/players/topscorers?${params}`, { headers });

  let topScorers: SportPlayer[] = [];
  if (res.ok) {
    const json = await res.json();
    topScorers = ((json.response ?? []) as any[])
      .filter((r: any) => {
        if (opts.scopeType === 'team_specific' && opts.teamId) {
          return r.statistics?.[0]?.team?.id === opts.teamId;
        }
        const matchTeamIds = upcomingMatches.flatMap((m) => [m.homeTeam.id, m.awayTeam.id]);
        return matchTeamIds.includes(String(r.statistics?.[0]?.team?.id));
      })
      .slice(0, 8)
      .map((r: any): SportPlayer => {
        const stats = r.statistics?.[0] ?? {};
        return {
          id:           String(r.player.id),
          name:         r.player.name,
          teamId:       String(stats.team?.id ?? ''),
          teamName:     stats.team?.name ?? '',
          position:     r.player.position,
          injuryStatus: 'fit',
          recentForm:   `${stats.goals?.total ?? 0} goals this season`,
        };
      });
  }

  const injuredIds = new Set(injuredPlayers.map((p) => p.id));
  return [
    ...injuredPlayers.slice(0, 5),
    ...topScorers.filter((p) => !injuredIds.has(p.id)).slice(0, 7),
  ].slice(0, 12);
}

// ── Helpers ───────────────────────────────────────────────────────────

function deriveNarrativeHooks(
  matches: SportMatch[],
  standings: StandingsEntry[],
  players: SportPlayer[],
): string[] {
  const hooks: string[] = [];

  if (matches.length >= 1 && standings.length >= 2) {
    const top2ids = standings.slice(0, 2).map((s) => s.team.id);
    for (const m of matches) {
      if (top2ids.includes(m.homeTeam.id) && top2ids.includes(m.awayTeam.id)) {
        const gap = standings[0].points - standings[1].points;
        hooks.push(
          `Top-of-table clash: ${m.homeTeam.name} vs ${m.awayTeam.name} — ${gap === 0 ? 'level on points' : `${Math.abs(gap)} point gap`}`,
        );
      }
    }
  }

  const bottom3 = standings.slice(-3).map((s) => s.team.id);
  for (const m of matches) {
    if (bottom3.includes(m.homeTeam.id) || bottom3.includes(m.awayTeam.id)) {
      hooks.push(`Relegation battle: ${m.homeTeam.name} vs ${m.awayTeam.name}`);
      break;
    }
  }

  for (const p of players) {
    if (p.injuryStatus === 'doubtful' || p.injuryStatus === 'injured') {
      hooks.push(`${p.name} (${p.teamName}) is listed as ${p.injuryStatus}${p.injuryNote ? ': ' + p.injuryNote : ''}`);
      if (hooks.length >= 6) break;
    }
  }

  return hooks.slice(0, 6);
}

function buildFormFromStandings(s: StandingsEntry): TeamForm {
  return { teamId: s.team.id, teamName: s.team.name, last5: [] };
}

function mapInjuryReason(reason: string | null): SportPlayer['injuryStatus'] {
  if (!reason) return 'fit';
  const r = reason.toLowerCase();
  if (r.includes('suspend')) return 'suspended';
  if (r.includes('doubt'))   return 'doubtful';
  return 'injured';
}
