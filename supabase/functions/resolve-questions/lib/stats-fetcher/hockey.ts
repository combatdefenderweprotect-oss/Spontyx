import type { MatchStats, TeamStatBlock } from '../predicate-evaluator.ts';

const HOCKEY_BASE = 'https://v1.hockey.api-sports.io';

const FINISHED_STATUSES = new Set(['FT', 'FT OT', 'FT SO', 'After OT', 'After SO']);
const CANCELLED_STATUSES = new Set(['PST', 'CANC', 'ABD']);

export async function fetchHockeyMatchStats(
  matchId: string,
  apiKey:  string,
): Promise<MatchStats | null> {
  const headers = { 'x-apisports-key': apiKey };

  const res = await fetch(`${HOCKEY_BASE}/games?id=${matchId}`, { headers });
  if (!res.ok) {
    console.warn(`[hockey-stats] game fetch failed (${res.status}) for match ${matchId}`);
    return null;
  }

  const json  = await res.json();
  const game  = json.response?.[0];
  if (!game) {
    console.warn(`[hockey-stats] no game data for match ${matchId}`);
    return null;
  }

  const statusLong  = game.status?.long  ?? '';
  const statusShort = game.status?.short ?? '';
  const finished    = FINISHED_STATUSES.has(statusLong) || FINISHED_STATUSES.has(statusShort);
  const cancelled   = CANCELLED_STATUSES.has(statusShort);

  const homeTeamId = String(game.teams?.home?.id ?? '');
  const awayTeamId = String(game.teams?.away?.id ?? '');
  const homeScore  = game.scores?.home ?? 0;
  const awayScore  = game.scores?.away ?? 0;

  const isDraw        = false;  // hockey never draws — OT/SO decides
  const winnerTeamId  = homeScore > awayScore ? homeTeamId
                      : awayScore > homeScore ? awayTeamId
                      : null;

  // Hockey team stats endpoint is limited — just return empty blocks
  // Player stats aren't available per-game in the free tier
  const teamStats: Record<string, TeamStatBlock> = {
    [homeTeamId]: { yellow_cards: 0, red_cards: 0, corners: 0, shots_total: 0, shots_on: 0 },
    [awayTeamId]: { yellow_cards: 0, red_cards: 0, corners: 0, shots_total: 0, shots_on: 0 },
  };

  return {
    finished:    finished || cancelled,
    status:      statusShort || statusLong,
    homeTeamId,
    awayTeamId,
    homeScore:   Number(homeScore),
    awayScore:   Number(awayScore),
    winnerTeamId,
    isDraw,
    teamStats,
    playerStats: {},  // not available for hockey in free tier
  };
}
