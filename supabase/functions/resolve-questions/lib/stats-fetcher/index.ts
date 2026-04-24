import type { MatchStats } from '../predicate-evaluator.ts';
import { fetchFootballMatchStats } from './football.ts';
import { fetchHockeyMatchStats }   from './hockey.ts';

export interface FetchParams {
  sport:            string;
  matchId:          string;
  needsPlayerStats: boolean;
  apiKey:           string;
  sb?:              any;   // Supabase client for cache reads
}

export async function fetchMatchStats(params: FetchParams): Promise<MatchStats | null> {
  const { sport, matchId, needsPlayerStats, apiKey, sb } = params;

  switch (sport) {
    case 'football':
      return fetchFootballMatchStats(matchId, apiKey, needsPlayerStats, sb);
    case 'hockey':
      // Hockey player stats not available in free tier; needsPlayerStats is ignored
      return fetchHockeyMatchStats(matchId, apiKey);
    case 'tennis':
      // Tennis doesn't use match_id-based resolution in v1 — void
      console.warn(`[stats-fetcher] tennis resolution not implemented`);
      return null;
    default:
      console.warn(`[stats-fetcher] unknown sport: ${sport}`);
      return null;
  }
}

// Does this predicate need player-level stats from the API?
export function needsPlayerStats(pred: any): boolean {
  const type = pred?.resolution_type;
  return (
    type === 'player_stat' ||
    (type === 'multiple_choice_map' && pred?.source === 'player_stat')
  );
}
