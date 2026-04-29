import type { MatchStats, TeamStatBlock, PlayerStatBlock, MatchEvent } from '../predicate-evaluator.ts';

const FOOTBALL_BASE = 'https://v3.football.api-sports.io';

const FINISHED_STATUSES  = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
const CANCELLED_STATUSES = new Set(['PST', 'CANC', 'ABD', 'TBD', 'SUSP']);

export async function fetchFootballMatchStats(
  matchId:          string,
  apiKey:           string,
  needsPlayerStats: boolean,
  sb?:              any,   // Supabase client — used to read from cache tables
): Promise<MatchStats | null> {

  // ── 1. Fixture status + score from cache ─────────────────────────────
  let statusShort: string;
  let homeTeamId: string;
  let awayTeamId: string;
  let homeScore:  number;
  let awayScore:  number;
  let homeWins:   boolean;
  let awayWins:   boolean;

  const cachedFixture = sb ? await readFixtureFromCache(sb, matchId) : null;

  // Bug 5 fix: if the cache reports a finished status but null scores, the poller
  // hasn't written scores yet (race condition). Fall through to the API so we get
  // accurate scores rather than coercing null → 0 (which breaks BTTS / match_stat).
  const cacheIsIncomplete =
    cachedFixture !== null &&
    FINISHED_STATUSES.has(cachedFixture.status_short ?? '') &&
    cachedFixture.home_goals === null &&
    cachedFixture.away_goals === null;

  if (cachedFixture && !cacheIsIncomplete) {
    statusShort = cachedFixture.status_short ?? '';
    homeTeamId  = String(cachedFixture.home_team_id ?? '');
    awayTeamId  = String(cachedFixture.away_team_id ?? '');
    homeScore   = cachedFixture.home_goals ?? 0;
    awayScore   = cachedFixture.away_goals ?? 0;
    homeWins    = cachedFixture.home_winner === true;
    awayWins    = cachedFixture.away_winner === true;
    console.log(`[football-stats] fixture ${matchId} read from cache (status: ${statusShort})`);
  } else {
    if (cacheIsIncomplete) {
      console.warn(`[football-stats] fixture ${matchId} cache has FT status but null scores — falling back to API`);
    }
    // Fall back to direct API call
    console.log(`[football-stats] fixture ${matchId} cache miss — calling API`);
    const fixtureData = await fetchFixtureFromAPI(matchId, apiKey);
    if (!fixtureData) return null;

    statusShort = fixtureData.fixture?.status?.short ?? '';
    homeTeamId  = String(fixtureData.teams?.home?.id ?? '');
    awayTeamId  = String(fixtureData.teams?.away?.id ?? '');
    homeScore   = fixtureData.score?.fulltime?.home ?? fixtureData.goals?.home ?? 0;
    awayScore   = fixtureData.score?.fulltime?.away ?? fixtureData.goals?.away ?? 0;
    homeWins    = fixtureData.teams?.home?.winner === true;
    awayWins    = fixtureData.teams?.away?.winner === true;
  }

  const finished    = FINISHED_STATUSES.has(statusShort);
  const cancelled   = CANCELLED_STATUSES.has(statusShort);
  const isDraw      = finished && !homeWins && !awayWins;
  const winnerTeamId = homeWins ? homeTeamId : awayWins ? awayTeamId : null;

  // ── 2. Team statistics from cache ─────────────────────────────────────
  const teamStats: Record<string, TeamStatBlock> = {};

  const cachedStats = sb ? await readStatsFromCache(sb, matchId) : null;

  if (cachedStats && cachedStats.length > 0) {
    for (const row of cachedStats) {
      const teamId = String(row.team_id ?? '');
      if (teamId) {
        teamStats[teamId] = {
          yellow_cards: row.yellow_cards ?? 0,
          red_cards:    row.red_cards    ?? 0,
          corners:      row.corners      ?? 0,
          shots_total:  row.shots_total  ?? 0,
          shots_on:     row.shots_on     ?? 0,
        };
      }
    }
    console.log(`[football-stats] team stats for ${matchId} read from cache`);
  } else {
    // Fall back to direct API call
    const statsData = await fetchStatsFromAPI(matchId, apiKey);
    for (const entry of statsData) {
      const teamId = String(entry.team?.id ?? '');
      const raw    = entry.statistics ?? [];
      const block: TeamStatBlock = {
        yellow_cards: 0,
        red_cards:    0,
        corners:      0,
        shots_total:  0,
        shots_on:     0,
      };
      for (const s of raw) {
        const val = s.value ?? 0;
        switch (s.type) {
          case 'Yellow Cards':  block.yellow_cards = Number(val); break;
          case 'Red Cards':     block.red_cards    = Number(val); break;
          case 'Corner Kicks':  block.corners      = Number(val); break;
          case 'Total Shots':   block.shots_total  = Number(val); break;
          case 'Shots on Goal': block.shots_on     = Number(val); break;
        }
      }
      if (teamId) teamStats[teamId] = block;
    }
  }

  // ── 3. Events from live_match_stats (for match_stat_window predicates) ──
  // Events are stored in live_match_stats.events JSONB by the live-stats-poller.
  // Each event has: time (minute), type ("Goal"|"Card"|...), detail, team_id.
  // We read them here so the resolver can evaluate anchored-window live questions.
  let events: MatchEvent[] | undefined;
  if (sb) {
    const cachedEvents = await readEventsFromCache(sb, matchId);
    if (cachedEvents) {
      events = cachedEvents;
      console.log(`[football-stats] events for ${matchId} read from cache (${events.length} events)`);
    }
  }

  // ── 4. Lineups from live_match_stats (for match_lineup predicates) ──────
  // Lineups are populated once per fixture by the live-stats-poller.
  // Used to resolve REAL_WORLD questions like "Will Player X start?"
  let lineups: any | undefined;
  if (sb) {
    const cachedLineups = await readLineupsFromCache(sb, matchId);
    if (cachedLineups) {
      lineups = cachedLineups;
      console.log(`[football-stats] lineups for ${matchId} read from cache`);
    }
  }

  // ── 5. Player statistics — always from API (not cached) ───────────────
  // Player-level stats (goals, assists, minutes, clean sheets) require the
  // /fixtures/players endpoint which we don't cache. Called only when the
  // predicate type is player_stat (rare in MVP).
  const playerStats: Record<string, PlayerStatBlock> = {};

  if (needsPlayerStats) {
    const headers = { 'x-apisports-key': apiKey };
    const playersRes = await fetch(`${FOOTBALL_BASE}/fixtures/players?fixture=${matchId}`, { headers });
    if (playersRes.ok) {
      const playersJson = await playersRes.json();
      for (const teamEntry of (playersJson.response ?? [])) {
        const teamId = String(teamEntry.team?.id ?? '');
        for (const p of (teamEntry.players ?? [])) {
          const playerId      = String(p.player?.id ?? '');
          const stat          = p.statistics?.[0] ?? {};
          const minutesPlayed = stat.games?.minutes ?? 0;
          const isGK          = stat.games?.position === 'G';
          const oppScore      = teamId === homeTeamId ? awayScore : homeScore;
          const cleanSheet    = isGK && minutesPlayed >= 60 && oppScore === 0;

          playerStats[playerId] = {
            goals:               stat.goals?.total         ?? 0,
            assists:             stat.goals?.assists       ?? 0,
            shots:               stat.shots?.total         ?? 0,
            yellow_cards:        stat.cards?.yellow        ?? 0,
            red_cards:           stat.cards?.red           ?? 0,
            minutes_played:      minutesPlayed,
            clean_sheet:         cleanSheet,
            // Extended stats
            passes_total:        stat.passes?.total        ?? null,
            passes_key:          stat.passes?.key          ?? null,
            dribbles_attempts:   stat.dribbles?.attempts   ?? null,
            dribbles_success:    stat.dribbles?.success    ?? null,
            tackles:             stat.tackles?.total       ?? null,
            interceptions:       stat.tackles?.interceptions ?? null,
            duels_total:         stat.duels?.total         ?? null,
            duels_won:           stat.duels?.won           ?? null,
          };
        }
      }
    }
  }

  return {
    finished:    finished || cancelled,
    status:      statusShort,
    homeTeamId,
    awayTeamId,
    homeScore:   Number(homeScore),
    awayScore:   Number(awayScore),
    winnerTeamId,
    isDraw,
    teamStats,
    playerStats,
    events,    // undefined if no cache hit — evaluator handles gracefully
    lineups,   // undefined if not yet polled or cache miss
  };
}

// ── Cache readers ─────────────────────────────────────────────────────

// Reads the events timeline from live_match_stats (populated by live-stats-poller).
// Returns null if the fixture is not in the cache or has no events yet.
async function readEventsFromCache(sb: any, matchId: string): Promise<MatchEvent[] | null> {
  const { data, error } = await sb
    .from('live_match_stats')
    .select('events')
    .eq('fixture_id', parseInt(matchId, 10))
    .maybeSingle();

  if (error || !data || !data.events) return null;
  // events is a JSONB array; map to the MatchEvent shape used by the evaluator
  return (data.events as any[]).map((e: any) => ({
    time:      e.time      ?? 0,
    extra:     e.extra     ?? null,
    type:      e.type      ?? '',
    detail:    e.detail    ?? null,
    team_id:   e.team_id   ?? 0,
    team_name: e.team_name ?? '',
  }));
}

// Reads lineups from live_match_stats (populated once per fixture by the poller).
async function readLineupsFromCache(sb: any, matchId: string): Promise<any | null> {
  const { data, error } = await sb
    .from('live_match_stats')
    .select('lineups')
    .eq('fixture_id', parseInt(matchId, 10))
    .maybeSingle();

  if (error || !data || !data.lineups) return null;
  return data.lineups; // raw JSONB array — evalMatchLineup handles parsing
}

async function readFixtureFromCache(sb: any, matchId: string): Promise<any | null> {
  const { data, error } = await sb
    .from('api_football_fixtures')
    .select('status_short, home_team_id, away_team_id, home_goals, away_goals, home_winner, away_winner')
    .eq('fixture_id', parseInt(matchId, 10))
    .single();

  if (error || !data) return null;
  return data;
}

async function readStatsFromCache(sb: any, matchId: string): Promise<any[]> {
  const { data, error } = await sb
    .from('api_football_statistics')
    .select('team_id, yellow_cards, red_cards, corners, shots_total, shots_on')
    .eq('fixture_id', parseInt(matchId, 10));

  if (error || !data || data.length === 0) return [];
  return data;
}

// ── API fallbacks ─────────────────────────────────────────────────────

async function fetchFixtureFromAPI(matchId: string, apiKey: string): Promise<any | null> {
  const res = await fetch(`${FOOTBALL_BASE}/fixtures?id=${matchId}`, {
    headers: { 'x-apisports-key': apiKey },
  });
  if (!res.ok) {
    console.warn(`[football-stats] fixture API ${res.status} for match ${matchId}`);
    return null;
  }
  const json = await res.json();
  const fixture = json.response?.[0];
  if (!fixture) {
    console.warn(`[football-stats] no fixture data for match ${matchId}`);
    return null;
  }
  return fixture;
}

async function fetchStatsFromAPI(matchId: string, apiKey: string): Promise<any[]> {
  const res = await fetch(`${FOOTBALL_BASE}/fixtures/statistics?fixture=${matchId}`, {
    headers: { 'x-apisports-key': apiKey },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.response ?? [];
}
