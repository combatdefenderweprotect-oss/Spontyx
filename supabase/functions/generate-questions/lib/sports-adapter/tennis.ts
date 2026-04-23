import type { SportsContext } from '../types.ts';

// Tennis adapter — stub for MVP.
// API-Tennis (v1.tennis.api-sports.io) structures data around tournaments,
// not traditional league standings. Full implementation is a separate sprint.

interface TennisAdapterOptions {
  apiKey: string;
  leagueId: number;
  season: number;
  scopeType: 'full_league' | 'team_specific';
}

export async function fetchTennisContext(_opts: TennisAdapterOptions): Promise<SportsContext> {
  // TODO: Implement tennis adapter in a future sprint.
  // API endpoints to target:
  //   GET /tournaments?type=atp&season={year}  → upcoming tournaments
  //   GET /fixtures?tournament={id}&season={year}&status=NS  → upcoming matches
  //   GET /rankings?type=atp  → ATP/WTA rankings
  console.warn('[tennis-adapter] stub — returning empty context');
  return {
    upcomingMatches: [],
    standings:       [],
    form:            [],
    keyPlayers:      [],
    narrativeHooks:  [],
  };
}
