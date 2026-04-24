import type { SportMatch, SportPlayer, StandingsEntry, TeamForm, SportsContext } from '../types.ts';
import type { PlayerAvailabilityStatus } from '../types.ts';

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

  // Phase 1: fixtures + standings in parallel (availability needs fixture IDs)
  const [fixturesRes, standingsRes] = await Promise.allSettled([
    fetchUpcomingFixturesFromCache(opts),
    fetchStandingsFromCache(opts),
  ]);

  const upcomingMatches = fixturesRes.status === 'fulfilled' ? fixturesRes.value : [];
  const standings       = standingsRes.status === 'fulfilled' ? standingsRes.value : [];

  // Phase 2: player data using fixture IDs — all in parallel
  const [injuriesRes, lineupsRes, topScorersRes] = await Promise.allSettled([
    fetchInjuriesByFixtures(upcomingMatches, headers),
    fetchLineups(upcomingMatches, headers),
    fetchTopScorers(opts, headers, upcomingMatches),
  ]);

  const injuryAvailability = injuriesRes.status === 'fulfilled' ? injuriesRes.value : [];
  const lineupAvailability = lineupsRes.status === 'fulfilled' ? lineupsRes.value : [];
  const topScorers         = topScorersRes.status === 'fulfilled' ? topScorersRes.value : [];

  // Merge: lineup data takes precedence over injury report for same player+fixture
  const playerAvailability = mergeAvailability(injuryAvailability, lineupAvailability);

  // Build keyPlayers (SportPlayer[]) for entity validation + narrative hooks
  const keyPlayers = buildKeyPlayers(playerAvailability, topScorers);

  const form           = standings.slice(0, 10).map((s) => buildFormFromStandings(s));
  const narrativeHooks = deriveNarrativeHooks(upcomingMatches, standings, keyPlayers);

  return { upcomingMatches, standings, form, keyPlayers, narrativeHooks, playerAvailability };
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

// ── Injuries — fixture-specific (replaces league+date fetch) ──────────
// Calls /injuries?fixture=X for each upcoming fixture in parallel.
// More precise than the league+date approach: injuries/suspensions are
// reported per fixture, so this gives us the exact availability status
// for each match rather than a league-wide snapshot.

async function fetchInjuriesByFixtures(
  fixtures: SportMatch[],
  headers: Record<string, string>,
): Promise<PlayerAvailabilityStatus[]> {
  if (fixtures.length === 0) return [];

  const results = await Promise.allSettled(
    fixtures.map(async (fixture) => {
      const res = await fetch(`${BASE}/injuries?fixture=${fixture.id}`, { headers });
      if (!res.ok) return { fixtureId: fixture.id, items: [] as any[] };
      const json = await res.json();
      return { fixtureId: fixture.id, items: (json.response ?? []) as any[] };
    })
  );

  const seen = new Set<string>(); // dedup by fixtureId:playerId
  const availability: PlayerAvailabilityStatus[] = [];

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { fixtureId, items } = r.value;

    for (const item of items) {
      const playerId = String(item.player?.id ?? '');
      if (!playerId || playerId === 'undefined' || playerId === 'null') continue;

      const key = `${fixtureId}:${playerId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const injuryStatus = mapInjuryReason(item.player?.reason);
      const status: PlayerAvailabilityStatus['status'] =
        injuryStatus === 'injured' || injuryStatus === 'suspended' ? 'unavailable'
        : injuryStatus === 'doubtful' ? 'doubtful'
        : 'available';

      availability.push({
        playerId,
        playerName: item.player?.name ?? '',
        teamId:     String(item.team?.id ?? ''),
        teamName:   item.team?.name ?? '',
        fixtureId,
        status,
        reason:     item.player?.reason ?? undefined,
        source:     'injury_report',
      });
    }
  }

  return availability;
}

// ── Lineups — only for fixtures kicking off within 2 hours ────────────
// Lineups are typically published ~1 hour before kickoff. Fetching them
// for distant fixtures would always return empty responses.

async function fetchLineups(
  fixtures: SportMatch[],
  headers: Record<string, string>,
): Promise<PlayerAvailabilityStatus[]> {
  const now = Date.now();
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  const imminentFixtures = fixtures.filter((f) => {
    const ko = new Date(f.kickoff).getTime();
    return ko > now && ko <= now + TWO_HOURS_MS;
  });

  if (imminentFixtures.length === 0) return [];

  const results = await Promise.allSettled(
    imminentFixtures.map(async (fixture) => {
      const res = await fetch(`${BASE}/fixtures/lineups?fixture=${fixture.id}`, { headers });
      if (!res.ok) return { fixtureId: fixture.id, teams: [] as any[] };
      const json = await res.json();
      return { fixtureId: fixture.id, teams: (json.response ?? []) as any[] };
    })
  );

  const availability: PlayerAvailabilityStatus[] = [];

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { fixtureId, teams } = r.value;

    for (const team of teams) {
      const teamId   = String(team.team?.id ?? '');
      const teamName = team.team?.name ?? '';

      for (const entry of (team.startXI ?? [])) {
        const playerId = String(entry.player?.id ?? '');
        if (!playerId || playerId === 'undefined') continue;
        availability.push({
          playerId,
          playerName: entry.player?.name ?? '',
          teamId, teamName, fixtureId,
          status: 'starting',
          source: 'lineup',
        });
      }

      for (const entry of (team.substitutes ?? [])) {
        const playerId = String(entry.player?.id ?? '');
        if (!playerId || playerId === 'undefined') continue;
        availability.push({
          playerId,
          playerName: entry.player?.name ?? '',
          teamId, teamName, fixtureId,
          status: 'substitute',
          source: 'lineup',
        });
      }
    }
  }

  return availability;
}

// ── Merge availability: lineup takes precedence over injury report ─────

function mergeAvailability(
  injuryAvailability: PlayerAvailabilityStatus[],
  lineupAvailability: PlayerAvailabilityStatus[],
): PlayerAvailabilityStatus[] {
  const lineupKeys = new Set(lineupAvailability.map((a) => `${a.fixtureId}:${a.playerId}`));
  return [
    ...lineupAvailability,
    // Exclude injury entries for players already confirmed in lineup data
    ...injuryAvailability.filter((a) => !lineupKeys.has(`${a.fixtureId}:${a.playerId}`)),
  ];
}

// ── Top scorers — direct API (not cached) ─────────────────────────────

async function fetchTopScorers(
  opts: FootballAdapterOptions,
  headers: Record<string, string>,
  upcomingMatches: SportMatch[],
): Promise<SportPlayer[]> {
  const params = new URLSearchParams({
    league: String(opts.leagueId),
    season: String(opts.season),
  });
  const res = await fetch(`${BASE}/players/topscorers?${params}`, { headers });
  if (!res.ok) return [];

  const json = await res.json();
  return ((json.response ?? []) as any[])
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

// ── Build keyPlayers (SportPlayer[]) from availability + top scorers ──
// Preserves the SportPlayer[] format consumed by entity validation
// and narrative hooks. Injured/suspended players are included so the
// context packet still shows their status, and the validator can block
// questions about them.

function buildKeyPlayers(
  playerAvailability: PlayerAvailabilityStatus[],
  topScorers: SportPlayer[],
): SportPlayer[] {
  const injuredOrDoubtful: SportPlayer[] = playerAvailability
    .filter((a) => a.status === 'unavailable' || a.status === 'doubtful')
    .slice(0, 10)
    .map((a): SportPlayer => ({
      id:           a.playerId,
      name:         a.playerName,
      teamId:       a.teamId,
      teamName:     a.teamName,
      injuryStatus: a.status === 'unavailable'
        ? (a.reason?.toLowerCase().includes('suspend') ? 'suspended' : 'injured')
        : 'doubtful',
      injuryNote:   a.reason,
    }));

  const injuredIds = new Set(injuredOrDoubtful.map((p) => p.id));

  return [
    ...injuredOrDoubtful.slice(0, 5),
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
