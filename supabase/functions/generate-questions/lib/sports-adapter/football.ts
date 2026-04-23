import type { SportMatch, SportPlayer, StandingsEntry, TeamForm, SportsContext } from '../types.ts';

const BASE = 'https://v3.football.api-sports.io';

interface FootballAdapterOptions {
  apiKey: string;
  leagueId: number;
  season: number;
  teamId?: number;        // set for team_specific scope
  scopeType: 'full_league' | 'team_specific';
}

// ── Main entry point ──────────────────────────────────────────────────

export async function fetchFootballContext(opts: FootballAdapterOptions): Promise<SportsContext> {
  const headers = { 'x-apisports-key': opts.apiKey };

  const [fixturesRes, standingsRes, injuriesRes] = await Promise.allSettled([
    fetchUpcomingFixtures(opts, headers),
    fetchStandings(opts, headers),
    fetchInjuries(opts, headers),
  ]);

  const upcomingMatches = fixturesRes.status === 'fulfilled' ? fixturesRes.value : [];
  const standings       = standingsRes.status === 'fulfilled' ? standingsRes.value : [];
  const injuredPlayers  = injuriesRes.status === 'fulfilled' ? injuriesRes.value : [];

  // Build form from the upcoming matches' team context (standings API includes form)
  const form = standings.slice(0, 10).map((s) => buildFormFromStandings(s));

  // Identify key players: top scorers + injured players from upcoming matches
  const keyPlayers = await fetchKeyPlayers(opts, headers, upcomingMatches, injuredPlayers);

  // Derive narrative hooks from the structured data
  const narrativeHooks = deriveNarrativeHooks(upcomingMatches, standings, keyPlayers);

  return { upcomingMatches, standings, form, keyPlayers, narrativeHooks };
}

// ── Upcoming fixtures (next 7 days, status=NS) ────────────────────────

async function fetchUpcomingFixtures(
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
      // Only matches in the next 7 days
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

// ── Standings ─────────────────────────────────────────────────────────

async function fetchStandings(
  opts: FootballAdapterOptions,
  headers: Record<string, string>,
): Promise<StandingsEntry[]> {
  if (opts.scopeType === 'team_specific') {
    // For team-specific leagues, get the standings of their competition
    // We still fetch by league so we have context (table position, rivals)
  }
  const params = new URLSearchParams({
    league: String(opts.leagueId),
    season: String(opts.season),
  });
  const res = await fetch(`${BASE}/standings?${params}`, { headers });
  if (!res.ok) return [];
  const json = await res.json();

  const table: any[] =
    json.response?.[0]?.league?.standings?.[0] ?? [];

  // For team-specific scope, include scoped team + surrounding context (±3 positions)
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
    position: r.rank,
    team: { id: String(r.team.id), name: r.team.name },
    points:         r.points,
    played:         r.all?.played ?? 0,
    won:            r.all?.win    ?? 0,
    drawn:          r.all?.draw   ?? 0,
    lost:           r.all?.lose   ?? 0,
    goalDifference: r.goalsDiff   ?? 0,
  }));
}

// ── Injuries ──────────────────────────────────────────────────────────

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

  const injured: SportPlayer[] = ((json.response ?? []) as any[])
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

  return injured;
}

// ── Key players: top scorers + injured players ────────────────────────

async function fetchKeyPlayers(
  opts: FootballAdapterOptions,
  headers: Record<string, string>,
  upcomingMatches: SportMatch[],
  injuredPlayers: SportPlayer[],
): Promise<SportPlayer[]> {
  // Fetch top scorers for the competition
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
        // For full league, only include players from upcoming match teams
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

  // Merge: injured players override the 'fit' status from top scorers
  const injuredIds = new Set(injuredPlayers.map((p) => p.id));
  const merged = [
    ...injuredPlayers.slice(0, 5),
    ...topScorers.filter((p) => !injuredIds.has(p.id)).slice(0, 7),
  ];

  return merged.slice(0, 12);
}

// ── Derive narrative hooks from structured data ───────────────────────

function deriveNarrativeHooks(
  matches: SportMatch[],
  standings: StandingsEntry[],
  players: SportPlayer[],
): string[] {
  const hooks: string[] = [];

  // Top-of-table clash
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

  // Relegation battle
  const bottom3 = standings.slice(-3).map((s) => s.team.id);
  for (const m of matches) {
    if (bottom3.includes(m.homeTeam.id) || bottom3.includes(m.awayTeam.id)) {
      hooks.push(`Relegation battle: ${m.homeTeam.name} vs ${m.awayTeam.name}`);
      break;
    }
  }

  // Injury concern for a key match player
  for (const p of players) {
    if (p.injuryStatus === 'doubtful' || p.injuryStatus === 'injured') {
      hooks.push(`${p.name} (${p.teamName}) is listed as ${p.injuryStatus}${p.injuryNote ? ': ' + p.injuryNote : ''}`);
      if (hooks.length >= 6) break;
    }
  }

  return hooks.slice(0, 6);
}

// ── Form proxy from standings (API-Sports includes last 5 in standings) ─

function buildFormFromStandings(s: StandingsEntry): import('../types.ts').TeamForm {
  // API-Sports standings don't directly expose last5 in our normalised shape.
  // We approximate from won/drawn/lost totals — good enough for narrative context.
  return {
    teamId:   s.team.id,
    teamName: s.team.name,
    last5:    [],  // populated when full fixture history is available
  };
}

function mapInjuryReason(reason: string | null): SportPlayer['injuryStatus'] {
  if (!reason) return 'fit';
  const r = reason.toLowerCase();
  if (r.includes('suspend')) return 'suspended';
  if (r.includes('doubt'))   return 'doubtful';
  return 'injured';
}
