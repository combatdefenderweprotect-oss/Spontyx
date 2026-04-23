import type { NewsItem, LeagueWithConfig, SportsContext } from '../types.ts';
import { fetchNewsForQueries, buildNewsQueries } from './gnews.ts';

// ── Main entry point — routes by configured provider ─────────────────
// Adding a new provider: implement its module, add a case here.

export async function fetchNewsContext(
  league: LeagueWithConfig,
  sportsCtx: SportsContext,
  apiKey: string,
): Promise<{ items: NewsItem[]; unavailable: boolean }> {
  if (!apiKey) {
    console.warn('[news-adapter] no API key configured — skipping news');
    return { items: [], unavailable: true };
  }

  try {
    const queries = buildNewsQueries({
      sport:             league.sport,
      scope:             league.scope,
      competitionName:   sportsCtx.upcomingMatches[0]?.competition ?? league.sport,
      scopedTeamName:    league.scoped_team_name ?? undefined,
      upcomingMatchTeams: sportsCtx.upcomingMatches.flatMap((m) => [
        m.homeTeam.name,
        m.awayTeam.name,
      ]),
      keyPlayerNames: sportsCtx.keyPlayers
        .filter((p) => p.injuryStatus !== 'fit' || p.recentForm)
        .slice(0, 5)
        .map((p) => p.name),
    });

    const items = await fetchNewsForQueries(queries, { apiKey });
    return { items, unavailable: false };
  } catch (err) {
    console.warn('[news-adapter] fetch failed:', err);
    return { items: [], unavailable: true };
  }
}
