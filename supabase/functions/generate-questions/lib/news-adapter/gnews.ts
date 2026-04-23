import type { NewsItem } from '../types.ts';

const BASE = 'https://gnews.io/api/v4/search';
const MAX_RESULTS_PER_QUERY = 3;
const MAX_AGE_DAYS = 7;

interface GNewsAdapterOptions {
  apiKey: string;
}

// ── Fetch news for a set of keyword queries ───────────────────────────

export async function fetchNewsForQueries(
  queries: string[],
  opts: GNewsAdapterOptions,
): Promise<NewsItem[]> {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const from   = cutoff.toISOString();

  const results = await Promise.allSettled(
    queries.map((q) => queryGNews(q, from, opts.apiKey)),
  );

  // Flatten, deduplicate by headline similarity, cap at 10
  const all: NewsItem[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      const key = normaliseHeadline(item.headline);
      if (!seen.has(key)) {
        seen.add(key);
        all.push(item);
      }
    }
  }

  // Sort by recency
  all.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return all.slice(0, 10);
}

// ── Single GNews API query ────────────────────────────────────────────

async function queryGNews(
  query: string,
  from: string,
  apiKey: string,
): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    q:        query,
    lang:     'en',
    max:      String(MAX_RESULTS_PER_QUERY),
    from,
    sortby:   'publishedAt',
    apikey:   apiKey,
  });

  const res = await fetch(`${BASE}?${params}`);
  if (!res.ok) {
    console.warn(`[gnews] query failed for "${query}": ${res.status}`);
    return [];
  }

  const json = await res.json();
  return ((json.articles ?? []) as any[]).map((a: any): NewsItem => ({
    headline:    a.title ?? '',
    summary:     truncate(a.description ?? a.content ?? '', 280),
    sourceName:  a.source?.name ?? 'Unknown',
    publishedAt: a.publishedAt ?? new Date().toISOString(),
    relevanceTag: `query:${query}`,
    url:          a.url ?? '',
  }));
}

// ── Build keyword queries from league/match context ───────────────────

export function buildNewsQueries(params: {
  sport: string;
  scope: 'full_league' | 'team_specific';
  competitionName: string;
  scopedTeamName?: string;
  upcomingMatchTeams: string[];   // team names from upcoming matches
  keyPlayerNames: string[];       // player names (max 5)
}): string[] {
  const queries: string[] = [];

  if (params.scope === 'team_specific' && params.scopedTeamName) {
    // Team-specific: focus on the team + key players
    queries.push(`${params.scopedTeamName} ${params.sport}`);
    queries.push(`${params.scopedTeamName} news`);
    for (const player of params.keyPlayerNames.slice(0, 3)) {
      queries.push(`${player} ${params.scopedTeamName}`);
    }
  } else {
    // Full league: focus on competition + upcoming matchups
    queries.push(`${params.competitionName} ${params.sport}`);
    // Top upcoming matchup
    if (params.upcomingMatchTeams.length >= 2) {
      queries.push(`${params.upcomingMatchTeams[0]} vs ${params.upcomingMatchTeams[1]}`);
    }
    // Second matchup if available
    if (params.upcomingMatchTeams.length >= 4) {
      queries.push(`${params.upcomingMatchTeams[2]} vs ${params.upcomingMatchTeams[3]}`);
    }
  }

  return queries;
}

// ── Helpers ───────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

function normaliseHeadline(h: string): string {
  // Lowercase + remove punctuation for dedup comparison
  return h.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
