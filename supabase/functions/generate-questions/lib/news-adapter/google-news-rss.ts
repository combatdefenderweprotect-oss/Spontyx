/**
 * Google News RSS adapter — fully automatic, no API key required.
 *
 * Pipeline:
 *   1. Build BROAD + SIGNAL RSS queries from league config
 *   2. Fetch + parse RSS XML concurrently
 *   3. Deduplicate by Jaccard similarity (same story → keep best version)
 *   4. Extract entities (teams, players, coach, topic)
 *   5. Score each article (relevance + freshness + credibility + resolvability + impact − risk)
 *   6. Filter to GENERATE / MAYBE tier; return as NewsItem[]
 */

import type { NewsItem } from '../types.ts';

// ── Constants ──────────────────────────────────────────────────────────

const GOOGLE_NEWS_RSS_BASE  = 'https://news.google.com/rss/search';
const MAX_AGE_DAYS          = 5;
const MAX_ARTICLES_PER_FEED = 15;
const FETCH_TIMEOUT_MS      = 8_000;
const DEDUP_THRESHOLD       = 0.50;  // Jaccard ≥ 0.5 → same story

// ── Internal types ─────────────────────────────────────────────────────

interface RssArticle {
  title:       string;
  sourceName:  string;
  url:         string;
  publishedAt: string;  // ISO
  snippet:     string;
}

interface ExtractedEntities {
  teams:   string[];
  players: string[];
  coach:   boolean;
  topic:   'injury' | 'lineup' | 'suspension' | 'transfer' | 'coach' | 'other';
}

interface ScoredArticle extends RssArticle {
  entities:   ExtractedEntities;
  finalScore: number;
  decision:   'GENERATE' | 'MAYBE' | 'CONTEXT_ONLY' | 'SKIP';
}

// ── Public params type ────────────────────────────────────────────────

export interface NewsQueryParams {
  scopeType:        'team' | 'league';
  sport:            string;
  leagueName:       string;
  leagueAliases:    string[];
  teamName?:        string;
  teamAliases?:     string[];
  upcomingFixtures: Array<{ teamA: string; teamB: string }>;
  knownTeams:       string[];   // all team names for entity matching
  // Optional: top players by relevance_score from team_players table.
  // When provided, a third PLAYER BOOST query is added covering these names
  // to surface injury/availability/form news for the most relevant individuals.
  // Use top 10–15 players from both teams combined (already filtered and ranked
  // by the caller). Never send the full squad — signal quality degrades rapidly
  // beyond 15 names.
  topPlayers?:      string[];
}

// ── STEP 1: Query builder ─────────────────────────────────────────────

const SIGNAL_TERMS =
  'injury OR questionable OR doubtful OR "ruled out" OR inactive OR ' +
  'suspension OR transfer OR contract OR coach OR lineup OR "will miss"';

export function buildRssUrls(params: NewsQueryParams): string[] {
  let broadQuery: string;
  let signalQuery: string;

  if (params.scopeType === 'team' && params.teamName) {
    const teamTerms = orTerms([params.teamName, ...(params.teamAliases ?? [])]);
    broadQuery  = teamTerms;
    signalQuery = `${teamTerms} AND (${SIGNAL_TERMS})`;
  } else {
    const leagueTerms  = orTerms([params.leagueName, ...(params.leagueAliases ?? [])]);
    const fixtureTeams = params.upcomingFixtures
      .slice(0, 3)
      .flatMap((f) => [f.teamA, f.teamB])
      .filter(Boolean);

    const allTerms = fixtureTeams.length > 0
      ? `(${leagueTerms} OR ${fixtureTeams.map((t) => `"${t}"`).join(' OR ')})`
      : leagueTerms;

    broadQuery  = allTerms;
    signalQuery = `${allTerms} AND (${SIGNAL_TERMS})`;
  }

  const urls = [buildRssUrl(broadQuery), buildRssUrl(signalQuery)];

  // ── PLAYER BOOST query (optional, soccer-first) ───────────────────────
  // When the caller supplies top players from the team_players table, add a
  // third query that targets those specific names with the signal keywords.
  // This surfaces injury / availability / form news for the most relevant
  // players — which is the primary driver of high-value REAL_WORLD questions.
  //
  // Scope: take up to 12 player names to keep query length reasonable.
  // The names are pre-sorted by relevance_score DESC by the caller — pick the
  // top of the list for the highest signal-to-noise ratio.
  const players = (params.topPlayers ?? []).slice(0, 12).filter(Boolean);
  if (players.length > 0) {
    // Build player terms: "Lamine Yamal" OR "Pedri" OR "Lewandowski" ...
    const playerTerms  = players.map((n) => `"${n}"`).join(' OR ');

    // Anchor to the team context to avoid false positives from other leagues
    const contextTerms = params.scopeType === 'team' && params.teamName
      ? `"${params.teamName}"`
      : params.upcomingFixtures.length > 0
        ? `("${params.upcomingFixtures[0].teamA}" OR "${params.upcomingFixtures[0].teamB}")`
        : `"${params.leagueName}"`;

    const playerBoostQuery = `(${playerTerms}) AND ${contextTerms} AND (${SIGNAL_TERMS})`;
    urls.push(buildRssUrl(playerBoostQuery));
  }

  return urls;
}

function orTerms(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean))];
  return unique.length === 1
    ? `"${unique[0]}"`
    : `(${unique.map((n) => `"${n}"`).join(' OR ')})`;
}

function buildRssUrl(query: string): string {
  return `${GOOGLE_NEWS_RSS_BASE}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

// ── STEP 2: Fetch + parse RSS ─────────────────────────────────────────

async function fetchRssFeed(url: string): Promise<RssArticle[]> {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[google-news-rss] feed ${res.status}: ${url.slice(0, 80)}`);
      return [];
    }

    const xml = await res.text();
    return parseRssXml(xml);
  } catch (err) {
    console.warn('[google-news-rss] fetch error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

function parseRssXml(xml: string): RssArticle[] {
  const articles: RssArticle[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];

    const title   = stripCdata(extractTag(block, 'title'));
    const link    = stripCdata(extractTag(block, 'link'));
    const pubDate = extractTag(block, 'pubDate');
    const desc    = stripCdata(extractTag(block, 'description'));

    if (!title || !link) continue;

    // Google News title format: "Headline - Source Name"
    // Also check for explicit <source> tag
    let headline   = title;
    let sourceName = stripCdata(extractSourceTag(block));

    if (!sourceName) {
      const dash = title.lastIndexOf(' - ');
      if (dash > 10) {
        headline   = title.slice(0, dash).trim();
        sourceName = title.slice(dash + 3).trim();
      }
    }

    articles.push({
      title:       headline,
      sourceName:  sourceName || 'Unknown',
      url:         link,
      publishedAt: parseRssDate(pubDate),
      snippet:     truncate(desc, 280),
    });
  }

  return articles;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m  = re.exec(xml);
  return m ? m[1].trim() : '';
}

function extractSourceTag(block: string): string {
  const m = /<source[^>]*>([^<]+)<\/source>/i.exec(block);
  return m ? m[1].trim() : '';
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function parseRssDate(raw: string): string {
  if (!raw) return new Date().toISOString();
  try { return new Date(raw).toISOString(); }
  catch { return new Date().toISOString(); }
}

// ── STEP 3: Deduplication ─────────────────────────────────────────────

function deduplicateArticles(articles: RssArticle[]): RssArticle[] {
  const groups: RssArticle[][] = [];

  for (const article of articles) {
    const norm = normalise(article.title);
    const group = groups.find(
      (g) => jaccardSimilarity(norm, normalise(g[0].title)) >= DEDUP_THRESHOLD,
    );
    if (group) {
      group.push(article);
    } else {
      groups.push([article]);
    }
  }

  // From each group pick best: prefer newer first; break ties by source credibility
  return groups.map((g) =>
    g.sort((a, b) => {
      const timeDiff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      if (Math.abs(timeDiff) > 3_600_000) return timeDiff > 0 ? 1 : -1;
      return credibilityRank(b.sourceName) - credibilityRank(a.sourceName);
    })[0],
  );
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const wA  = new Set(a.split(' ').filter((w) => w.length > 3));
  const wB  = new Set(b.split(' ').filter((w) => w.length > 3));
  if (wA.size === 0 || wB.size === 0) return 0;
  const inter = [...wA].filter((w) => wB.has(w)).length;
  return inter / new Set([...wA, ...wB]).size;
}

// ── STEP 4: Entity extraction ─────────────────────────────────────────

const INJURY_KWORDS     = ['injury', 'injured', 'fitness', 'doubtful', 'ruled out', 'miss', 'doubt', 'hamstring', 'knee', 'ankle', 'muscle', 'strain', 'knock', 'sidelined', 'unavailable', 'inactive', 'questionable'];
const LINEUP_KWORDS     = ['lineup', 'line-up', 'starting xi', 'starting eleven', 'team sheet', 'squad', 'selection'];
const SUSPENSION_KWORDS = ['suspend', 'ban', 'red card', 'yellow card', 'banned', 'disciplinary', 'accumulation'];
const TRANSFER_KWORDS   = ['transfer', 'sign', 'deal', 'fee', 'move', 'bid', 'contract', 'extension', 'release', 'free agent', 'loan', 'deadline day'];
const COACH_KWORDS      = ['manager', 'coach', 'head coach', 'sacked', 'dismissed', 'resigned', 'appointed', 'interim'];

const PERSON_STOPWORDS = new Set([
  'the', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but',
  'is', 'are', 'was', 'will', 'be', 'have', 'has', 'had', 'not',
  'with', 'from', 'this', 'that', 'his', 'her', 'their', 'its',
  'vs', 'fc', 'united', 'city', 'real', 'atletico', 'ac', 'sc',
]);

function extractEntities(article: RssArticle, knownTeams: string[]): ExtractedEntities {
  const text = (article.title + ' ' + article.snippet).toLowerCase();

  const teams = knownTeams.filter((t) => text.includes(t.toLowerCase()));
  const coach = COACH_KWORDS.some((k) => text.includes(k));
  const topic = detectTopic(text);

  // Heuristic player detection: consecutive "Firstname Lastname" Title Case pairs in the headline
  const players = (article.title.match(/\b[A-Z][a-zéáóúíàè]+ [A-Z][a-zéáóúíàè]+\b/g) ?? [])
    .filter((name) => {
      const parts = name.toLowerCase().split(' ');
      return (
        !PERSON_STOPWORDS.has(parts[0]) &&
        !PERSON_STOPWORDS.has(parts[1]) &&
        !knownTeams.some((t) => {
          const tl = t.toLowerCase();
          return tl.includes(name.toLowerCase()) || name.toLowerCase().includes(tl.split(' ')[0]);
        })
      );
    })
    .slice(0, 3);

  return { teams, players, coach, topic };
}

function detectTopic(text: string): ExtractedEntities['topic'] {
  if (INJURY_KWORDS.some((k)     => text.includes(k))) return 'injury';
  if (LINEUP_KWORDS.some((k)     => text.includes(k))) return 'lineup';
  if (SUSPENSION_KWORDS.some((k) => text.includes(k))) return 'suspension';
  if (TRANSFER_KWORDS.some((k)   => text.includes(k))) return 'transfer';
  if (COACH_KWORDS.some((k)      => text.includes(k))) return 'coach';
  return 'other';
}

// ── STEP 5: Scoring ───────────────────────────────────────────────────

const HIGH_CRED = new Set([
  'bbc sport', 'bbc news', 'sky sports', 'espn', 'the guardian', 'the telegraph',
  'the times', 'the athletic', 'marca', 'as', 'goal.com', 'goal', 'transfermarkt',
  'reuters', 'ap news', 'associated press', 'fabrizio romano',
  'mlssoccer', 'nfl.com', 'nba.com', 'nhl.com', 'sport bild',
  "l'equipe", 'gazzetta dello sport', 'corriere dello sport',
]);

const MED_CRED = new Set([
  'mirror', 'sun', 'daily mail', 'metro', 'express', 'evening standard',
  'talksport', 'givemesport', '90min', 'fourfourtwo', 'sportbible',
  'calciomercato', 'footmercato', 'footballtransfers',
]);

function credibilityRank(sourceName: string): number {
  const l = sourceName.toLowerCase();
  if ([...HIGH_CRED].some((s) => l.includes(s))) return 2;
  if ([...MED_CRED].some((s)  => l.includes(s))) return 1;
  return 0;
}

function credibilityScore(sourceName: string): number {
  switch (credibilityRank(sourceName)) {
    case 2:  return 20;
    case 1:  return 12;
    default: return 8;
  }
}

function scoreArticle(article: RssArticle, entities: ExtractedEntities): number {
  const text   = (article.title + ' ' + article.snippet).toLowerCase();
  const ageHrs = (Date.now() - new Date(article.publishedAt).getTime()) / 3_600_000;

  // RELEVANCE (0–25)
  let relevance = 0;
  if (entities.teams.length >= 1) relevance += 15;
  if (entities.teams.length >= 2) relevance += 5;
  const allSignals = [...INJURY_KWORDS, ...LINEUP_KWORDS, ...SUSPENSION_KWORDS, ...TRANSFER_KWORDS, ...COACH_KWORDS];
  if (allSignals.some((k) => text.includes(k))) relevance += 10;
  relevance = Math.min(25, relevance);

  // FRESHNESS (0–15)
  const freshness =
    ageHrs < 6   ? 15 :
    ageHrs < 24  ? 12 :
    ageHrs < 48  ? 8  :
    ageHrs < 72  ? 4  : 1;

  // CREDIBILITY (0–20)
  const credibility = credibilityScore(article.sourceName);

  // RESOLVABILITY (0–25)
  const resolvability =
    entities.topic === 'injury'     ? 25 :
    entities.topic === 'lineup'     ? 22 :
    entities.topic === 'suspension' ? 22 :
    entities.topic === 'coach'      ? 18 :
    entities.topic === 'transfer'   ? 15 : 5;

  // IMPACT (0–15)
  let impact = 5;
  if (entities.players.length > 0) impact = 12;
  if (entities.coach)               impact = Math.max(impact, 10);
  if (entities.teams.length >= 2)   impact = Math.max(impact, 10);

  // RISK (−30 to 0)
  let risk = 0;
  const CLICKBAIT = ['shocking', 'bombshell', 'sensational', 'incredible', 'unbelievable'];
  if (CLICKBAIT.some((k) => text.includes(k)))                          risk -= 10;
  if ((article.title + article.snippet).length < 50)                   risk -= 15;
  if (entities.topic === 'other' && entities.teams.length === 0)        risk -= 20;

  return Math.max(0, Math.min(100,
    relevance + freshness + credibility + resolvability + impact + risk,
  ));
}

function decisionFromScore(score: number): ScoredArticle['decision'] {
  if (score >= 80) return 'GENERATE';
  if (score >= 65) return 'MAYBE';
  if (score >= 50) return 'CONTEXT_ONLY';
  return 'SKIP';
}

// ── STEP 6+7: Main entry point ────────────────────────────────────────

export async function fetchAndScoreNews(params: NewsQueryParams): Promise<NewsItem[]> {
  const urls      = buildRssUrls(params);
  const cutoffMs  = Date.now() - MAX_AGE_DAYS * 24 * 3_600_000;

  // Fetch all feeds concurrently
  const feeds = await Promise.allSettled(urls.map(fetchRssFeed));
  let articles: RssArticle[] = feeds
    .filter((r): r is PromiseFulfilledResult<RssArticle[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((a) => new Date(a.publishedAt).getTime() > cutoffMs);

  articles = deduplicateArticles(articles);

  // Score all
  const scored: ScoredArticle[] = articles.map((a) => {
    const entities = extractEntities(a, params.knownTeams);
    const score    = scoreArticle(a, entities);
    return { ...a, entities, finalScore: score, decision: decisionFromScore(score) };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Select GENERATE tier; fall back to MAYBE if no GENERATE exists
  const generate = scored.filter((a) => a.decision === 'GENERATE');
  const maybe    = scored.filter((a) => a.decision === 'MAYBE');
  const selected = generate.length > 0 ? generate : maybe;

  if (selected.length === 0) {
    console.log('[google-news-rss] no high-value signals after scoring — skipping');
    return [];
  }

  console.log(
    `[google-news-rss] ${articles.length} articles → ${scored.length} scored → ` +
    `${generate.length} GENERATE + ${maybe.length} MAYBE → ${selected.length} passed`,
  );

  return selected.slice(0, 10).map((a): NewsItem => ({
    headline:     a.title,
    summary:      a.snippet,
    sourceName:   a.sourceName,
    publishedAt:  a.publishedAt,
    relevanceTag: `topic:${a.entities.topic}`,
    url:          a.url,
  }));
}
