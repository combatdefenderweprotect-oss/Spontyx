import type { NewsItem, LeagueWithConfig, SportsContext } from '../types.ts';
import { fetchAndScoreNews } from './google-news-rss.ts';

// ── Main entry point ──────────────────────────────────────────────────
// Uses Google News RSS — no API key required.
// apiKey param kept for backward compat; ignored.

export async function fetchNewsContext(
  league:      LeagueWithConfig,
  sportsCtx:   SportsContext,
  _apiKey?:    string,
  // Optional: top player names from team_players table (sorted by relevance_score DESC).
  // Enables the PLAYER BOOST query in google-news-rss.ts.
  // Pass up to 15 names. Ignored when empty or not provided.
  topPlayers?: string[],
): Promise<{ items: NewsItem[]; unavailable: boolean }> {
  try {
    // Derive knownTeams — all team names visible in this context for entity matching
    const knownTeams: string[] = [
      ...sportsCtx.upcomingMatches.flatMap((m) => [m.homeTeam.name, m.awayTeam.name]),
      ...(sportsCtx.standings?.map((s) => s.team.name).filter(Boolean) ?? []),
      ...(league.scoped_team_name ? [league.scoped_team_name] : []),
    ].filter((v, i, a) => v && a.indexOf(v) === i);  // unique, non-empty

    // Derive upcoming fixtures for the query builder
    const upcomingFixtures = sportsCtx.upcomingMatches.slice(0, 4).map((m) => ({
      teamA: m.homeTeam.name,
      teamB: m.awayTeam.name,
    }));

    // Detect league aliases from competition name variants
    const competitionName = sportsCtx.upcomingMatches[0]?.competition ?? league.sport;
    const leagueAliases: string[] = [];
    // Add common abbreviations for well-known leagues
    const LEAGUE_ALIASES: Record<string, string[]> = {
      'premier league':      ['PL', 'EPL'],
      'la liga':             ['LaLiga', 'Primera División'],
      'bundesliga':          ['Bundesliga'],
      'serie a':             ['Serie A'],
      'ligue 1':             ['Ligue 1'],
      'champions league':    ['UCL', 'UEFA Champions League'],
      'europa league':       ['UEL', 'UEFA Europa League'],
      'mls':                 ['Major League Soccer'],
      'nfl':                 ['National Football League'],
      'nba':                 ['National Basketball Association'],
      'nhl':                 ['National Hockey League'],
    };
    for (const [key, aliases] of Object.entries(LEAGUE_ALIASES)) {
      if (competitionName.toLowerCase().includes(key)) {
        leagueAliases.push(...aliases);
        break;
      }
    }

    const items = await fetchAndScoreNews({
      scopeType:        league.scope === 'team_specific' ? 'team' : 'league',
      sport:            league.sport,
      leagueName:       competitionName,
      leagueAliases,
      teamName:         league.scoped_team_name ?? undefined,
      teamAliases:      [],   // no aliases stored on league record yet
      upcomingFixtures,
      knownTeams,
      topPlayers:       (topPlayers ?? []).slice(0, 15),  // PLAYER BOOST
    });

    return { items, unavailable: false };
  } catch (err) {
    console.warn('[news-adapter] fetch failed:', err instanceof Error ? err.message : String(err));
    return { items: [], unavailable: true };
  }
}
