import type { MatchStats, TeamStatBlock, PlayerStatBlock } from '../predicate-evaluator.ts';

const FOOTBALL_BASE = 'https://v3.football.api-sports.io';

// Statuses that mean the match is fully finished
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
// Statuses that mean the match will never finish as planned — void
const CANCELLED_STATUSES = new Set(['PST', 'CANC', 'ABD', 'TBD', 'SUSP']);

export async function fetchFootballMatchStats(
  matchId:        string,
  apiKey:         string,
  needsPlayerStats: boolean,
): Promise<MatchStats | null> {
  const headers = { 'x-apisports-key': apiKey };

  // Parallel fetch: fixture + team statistics (+ players if needed)
  const fetches: Promise<Response>[] = [
    fetch(`${FOOTBALL_BASE}/fixtures?id=${matchId}`, { headers }),
    fetch(`${FOOTBALL_BASE}/fixtures/statistics?fixture=${matchId}`, { headers }),
  ];
  if (needsPlayerStats) {
    fetches.push(fetch(`${FOOTBALL_BASE}/fixtures/players?fixture=${matchId}`, { headers }));
  }

  const responses = await Promise.all(fetches);
  const [fixtureRes, statsRes, playersRes] = responses;

  if (!fixtureRes.ok) {
    console.warn(`[football-stats] fixture fetch failed (${fixtureRes.status}) for match ${matchId}`);
    return null;
  }

  const fixtureJson = await fixtureRes.json();
  const fixture = fixtureJson.response?.[0];
  if (!fixture) {
    console.warn(`[football-stats] no fixture data for match ${matchId}`);
    return null;
  }

  const statusShort = fixture.fixture?.status?.short ?? '';
  const finished    = FINISHED_STATUSES.has(statusShort);
  const cancelled   = CANCELLED_STATUSES.has(statusShort);

  const homeTeamId = String(fixture.teams?.home?.id ?? '');
  const awayTeamId = String(fixture.teams?.away?.id ?? '');
  const homeScore  = fixture.score?.fulltime?.home ?? fixture.goals?.home ?? 0;
  const awayScore  = fixture.score?.fulltime?.away ?? fixture.goals?.away ?? 0;

  const homeWins = fixture.teams?.home?.winner === true;
  const awayWins = fixture.teams?.away?.winner === true;
  const isDraw   = finished && !homeWins && !awayWins;
  const winnerTeamId = homeWins ? homeTeamId : awayWins ? awayTeamId : null;

  // Build team stats from statistics response
  const teamStats: Record<string, TeamStatBlock> = {};
  if (statsRes?.ok) {
    const statsJson = await statsRes.json();
    for (const entry of (statsJson.response ?? [])) {
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

  // Build player stats from players response
  const playerStats: Record<string, PlayerStatBlock> = {};
  if (needsPlayerStats && playersRes?.ok) {
    const playersJson = await playersRes.json();
    for (const teamEntry of (playersJson.response ?? [])) {
      const teamId = String(teamEntry.team?.id ?? '');
      for (const p of (teamEntry.players ?? [])) {
        const playerId = String(p.player?.id ?? '');
        const stat     = p.statistics?.[0] ?? {};

        const yellowCards = stat.cards?.yellow ?? 0;
        const redCards    = stat.cards?.red    ?? 0;
        const minutesPlayed = stat.games?.minutes ?? 0;

        // Clean sheet: goalkeeper who played and conceded 0 goals on their side
        const isGK = stat.games?.position === 'G';
        const oppScore = teamId === homeTeamId ? awayScore : homeScore;
        const cleanSheet = isGK && minutesPlayed >= 60 && oppScore === 0;

        playerStats[playerId] = {
          goals:          stat.goals?.total    ?? 0,
          assists:        stat.goals?.assists  ?? 0,
          shots:          stat.shots?.total    ?? 0,
          yellow_cards:   yellowCards,
          red_cards:      redCards,
          minutes_played: minutesPlayed,
          clean_sheet:    cleanSheet,
        };
      }
    }
  }

  return {
    finished:    finished || cancelled,  // cancelled = finished for our purposes (will void)
    status:      statusShort,
    homeTeamId,
    awayTeamId,
    homeScore:   Number(homeScore),
    awayScore:   Number(awayScore),
    winnerTeamId,
    isDraw,
    teamStats,
    playerStats,
  };
}
