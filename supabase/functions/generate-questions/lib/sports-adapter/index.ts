import type { SportsContext, LeagueWithConfig } from '../types.ts';
import { fetchFootballContext } from './football.ts';
import { fetchHockeyContext }   from './hockey.ts';
import { fetchTennisContext }   from './tennis.ts';

// ── Single entry point — routes by sport ─────────────────────────────

export async function fetchSportsContext(
  league: LeagueWithConfig,
  apiKey: string,
  sb: any,
): Promise<SportsContext> {
  const opts = {
    apiKey,
    sb,
    leagueId:  league.api_sports_league_id,
    season:    league.api_sports_season,
    teamId:    league.api_sports_team_id ?? undefined,
    scopeType: league.scope,
  };

  switch (league.sport) {
    case 'football':
      return fetchFootballContext(opts);
    case 'hockey':
      return fetchHockeyContext(opts);
    case 'tennis':
      return fetchTennisContext(opts);
    default:
      console.warn(`[sports-adapter] unsupported sport: ${league.sport}`);
      return { upcomingMatches: [], standings: [], form: [], keyPlayers: [], narrativeHooks: [] };
  }
}
