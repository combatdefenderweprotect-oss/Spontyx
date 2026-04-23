import type { SportsContext } from '../types.ts';

const BASE = 'https://v1.hockey.api-sports.io';

interface HockeyAdapterOptions {
  apiKey: string;
  leagueId: number;
  season: number;
  teamId?: number;
  scopeType: 'full_league' | 'team_specific';
}

// ── Main entry point ──────────────────────────────────────────────────

export async function fetchHockeyContext(opts: HockeyAdapterOptions): Promise<SportsContext> {
  const headers = { 'x-apisports-key': opts.apiKey };

  const [fixturesRes, standingsRes] = await Promise.allSettled([
    fetchUpcomingGames(opts, headers),
    fetchStandings(opts, headers),
  ]);

  const upcomingMatches = fixturesRes.status === 'fulfilled' ? fixturesRes.value : [];
  const standings       = standingsRes.status === 'fulfilled' ? standingsRes.value : [];

  return {
    upcomingMatches,
    standings,
    form: [],
    keyPlayers: [],
    narrativeHooks: deriveNarrativeHooks(upcomingMatches, standings),
  };
}

async function fetchUpcomingGames(opts: HockeyAdapterOptions, headers: Record<string, string>) {
  const params = new URLSearchParams({ league: String(opts.leagueId), season: String(opts.season) });
  if (opts.scopeType === 'team_specific' && opts.teamId) {
    params.set('team', String(opts.teamId));
  }
  const res = await fetch(`${BASE}/games?${params}&status=NS`, { headers });
  if (!res.ok) return [];
  const json = await res.json();
  const now = Date.now();
  return ((json.response ?? []) as any[])
    .filter((g: any) => {
      const t = new Date(g.date ?? '').getTime();
      return t > now && t <= now + 7 * 24 * 60 * 60 * 1000;
    })
    .slice(0, 5)
    .map((g: any) => ({
      id:          String(g.id),
      sport:       'hockey',
      homeTeam:    { id: String(g.teams.home.id), name: g.teams.home.name },
      awayTeam:    { id: String(g.teams.away.id), name: g.teams.away.name },
      kickoff:     g.date,
      competition: g.league?.name ?? 'NHL',
      status:      'not_started' as const,
    }));
}

async function fetchStandings(opts: HockeyAdapterOptions, headers: Record<string, string>) {
  const params = new URLSearchParams({ league: String(opts.leagueId), season: String(opts.season) });
  const res = await fetch(`${BASE}/standings?${params}`, { headers });
  if (!res.ok) return [];
  const json = await res.json();
  return ((json.response ?? []) as any[]).slice(0, 8).map((r: any) => ({
    position:       r.position,
    team:           { id: String(r.team.id), name: r.team.name },
    points:         r.points,
    played:         r.games?.played ?? 0,
    won:            r.games?.win    ?? 0,
    drawn:          0,
    lost:           r.games?.lose   ?? 0,
    goalDifference: (r.goals?.for ?? 0) - (r.goals?.against ?? 0),
  }));
}

function deriveNarrativeHooks(matches: any[], standings: any[]): string[] {
  const hooks: string[] = [];
  if (standings.length >= 2) {
    const top2 = standings.slice(0, 2).map((s: any) => s.team.id);
    for (const m of matches) {
      if (top2.includes(m.homeTeam.id) && top2.includes(m.awayTeam.id)) {
        hooks.push(`Top-of-conference matchup: ${m.homeTeam.name} vs ${m.awayTeam.name}`);
      }
    }
  }
  return hooks;
}
