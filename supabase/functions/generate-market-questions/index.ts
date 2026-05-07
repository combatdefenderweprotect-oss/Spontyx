// ════════════════════════════════════════════════════════════════════════
// Spontyx Market — generate-market-questions Edge Function
// ════════════════════════════════════════════════════════════════════════
// Pipeline:
//   1. Fetch upcoming PL/LaLiga fixtures involving target teams
//   2. For each fixture, query Google News RSS (3 queries: broad, signal, match-specific)
//   3. Parse + deduplicate articles by Jaccard title similarity
//   4. Pass top headlines to OpenAI → 2-3 grounded Real World Edge questions
//   5. Generate template questions for match_result, goals, team_stats, player_prediction
//   6. Insert all questions with status='active'
//
// Deploy:
//   supabase functions deploy generate-market-questions --no-verify-jwt
// ════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY       = Deno.env.get('OPENAI_API_KEY')!;

// ── Target scope ──────────────────────────────────────────────────────
const TARGET_LEAGUE_IDS = [39, 140];
const TARGET_TEAM_IDS   = new Set([40, 42, 50, 49, 33, 541, 529]);

// ── News fetch config ─────────────────────────────────────────────────
const GOOGLE_NEWS_RSS_BASE = 'https://news.google.com/rss/search';
const FETCH_TIMEOUT_MS     = 8_000;
const MAX_AGE_DAYS         = 5;
const DEDUP_THRESHOLD      = 0.45;
const SIGNAL_TERMS =
  'injury OR injured OR doubtful OR "ruled out" OR suspended OR suspension ' +
  'OR lineup OR "starting XI" OR transfer OR fitness OR unavailable OR "will miss"';

// ════════════════════════════════════════════════════════════════════════
// Entry
// ════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }
  const forceFixtureId: number | null = (body.fixture_id as number) ?? null;

  console.log('[generate-market-questions] start', { forceFixtureId });

  try {
    // ── 1. Fetch upcoming fixtures ─────────────────────────────────────
    const now     = new Date();
    const horizon = new Date(now.getTime() + 72 * 3600_000).toISOString();

    let fixtureQuery = sb
      .from('api_football_fixtures')
      .select('fixture_id, league_id, kickoff_at, home_team_id, home_team_name, away_team_id, away_team_name, venue_name, raw_fixture')
      .in('league_id', TARGET_LEAGUE_IDS)
      .in('status_short', ['NS', 'TBD'])
      .gt('kickoff_at', now.toISOString())
      .lte('kickoff_at', horizon)
      .order('kickoff_at');

    if (forceFixtureId) {
      fixtureQuery = sb
        .from('api_football_fixtures')
        .select('fixture_id, league_id, kickoff_at, home_team_id, home_team_name, away_team_id, away_team_name, venue_name, raw_fixture')
        .eq('fixture_id', forceFixtureId);
    }

    const { data: fixtures, error: fErr } = await fixtureQuery;
    if (fErr) throw fErr;

    const relevant = (fixtures ?? []).filter((f: any) =>
      TARGET_TEAM_IDS.has(f.home_team_id) || TARGET_TEAM_IDS.has(f.away_team_id)
    );

    console.log(`[generate-market-questions] ${relevant.length} relevant fixtures`);

    let totalGenerated = 0;

    for (const fixture of relevant) {
      // Skip if questions already exist
      const { count } = await sb
        .from('market_questions')
        .select('id', { count: 'exact', head: true })
        .eq('fixture_id', fixture.fixture_id)
        .in('status', ['draft', 'active', 'locked']);

      if ((count ?? 0) > 0) {
        console.log(`[generate-market-questions] skip fixture ${fixture.fixture_id} (${count} questions exist)`);
        continue;
      }

      const kickoff     = new Date(fixture.kickoff_at);
      const deadline30  = new Date(kickoff.getTime() - 30 * 60_000).toISOString();
      const deadline60  = new Date(kickoff.getTime() - 60 * 60_000).toISOString();
      const resolveAfter = new Date(kickoff.getTime() + 100 * 60_000).toISOString();

      const home = fixture.home_team_name as string;
      const away = fixture.away_team_name as string;

      const questions: any[] = [];

      // ── Match Result ────────────────────────────────────────────────
      questions.push({
        fixture_id: fixture.fixture_id,
        category: 'match_result',
        question_text: `Who wins: ${home} vs ${away}?`,
        answer_options: [
          { id: 'home', label: `${home} Win` },
          { id: 'draw', label: 'Draw' },
          { id: 'away', label: `${away} Win` },
        ],
        difficulty: 'medium',
        xp_reward: 30,
        resolution_source: 'match_result',
        resolution_rule: { type: 'match_result', home_team_id: fixture.home_team_id, away_team_id: fixture.away_team_id },
        deadline_at: deadline30,
        resolves_after: resolveAfter,
        status: 'active',
      });

      questions.push({
        fixture_id: fixture.fixture_id,
        category: 'match_result',
        question_text: `Who leads at half-time: ${home} vs ${away}?`,
        answer_options: [
          { id: 'home', label: `${home} lead` },
          { id: 'draw', label: 'Level at HT' },
          { id: 'away', label: `${away} lead` },
        ],
        difficulty: 'hard',
        xp_reward: 50,
        resolution_source: 'match_stats',
        resolution_rule: { type: 'first_half_result' },
        deadline_at: deadline30,
        resolves_after: new Date(kickoff.getTime() + 50 * 60_000).toISOString(),
        status: 'active',
      });

      // ── Goals ───────────────────────────────────────────────────────
      questions.push({
        fixture_id: fixture.fixture_id,
        category: 'goals',
        question_text: `Total goals in ${home} vs ${away}: Over or Under 2.5?`,
        answer_options: [
          { id: 'over',  label: 'Over 2.5 goals' },
          { id: 'under', label: 'Under 2.5 goals' },
        ],
        difficulty: 'easy',
        xp_reward: 20,
        resolution_source: 'match_result',
        resolution_rule: { type: 'total_goals', operator: 'over_under', threshold: 2.5 },
        deadline_at: deadline30,
        resolves_after: resolveAfter,
        status: 'active',
      });

      questions.push({
        fixture_id: fixture.fixture_id,
        category: 'goals',
        question_text: `Will both ${home} and ${away} score?`,
        answer_options: [
          { id: 'yes', label: 'Yes — BTTS' },
          { id: 'no',  label: 'No — at least one clean sheet' },
        ],
        difficulty: 'medium',
        xp_reward: 30,
        resolution_source: 'match_result',
        resolution_rule: { type: 'btts' },
        deadline_at: deadline30,
        resolves_after: resolveAfter,
        status: 'active',
      });

      // ── Team Stats ──────────────────────────────────────────────────
      questions.push({
        fixture_id: fixture.fixture_id,
        category: 'team_stats',
        question_text: `Which team has more possession: ${home} or ${away}?`,
        answer_options: [
          { id: 'home', label: home },
          { id: 'away', label: away },
        ],
        difficulty: 'medium',
        xp_reward: 25,
        resolution_source: 'match_stats',
        resolution_rule: { type: 'team_more_possession', home_team_id: fixture.home_team_id, away_team_id: fixture.away_team_id },
        deadline_at: deadline30,
        resolves_after: resolveAfter,
        status: 'active',
      });

      questions.push({
        fixture_id: fixture.fixture_id,
        category: 'team_stats',
        question_text: `Total corners in ${home} vs ${away}: Over or Under 9.5?`,
        answer_options: [
          { id: 'over',  label: 'Over 9.5 corners' },
          { id: 'under', label: 'Under 9.5 corners' },
        ],
        difficulty: 'hard',
        xp_reward: 45,
        resolution_source: 'match_stats',
        resolution_rule: { type: 'total_corners', operator: 'over_under', threshold: 9.5 },
        deadline_at: deadline30,
        resolves_after: resolveAfter,
        status: 'active',
      });

      // ── Player Predictions (from lineup if available) ───────────────
      const lineups: any[] = fixture.raw_fixture?.lineups ?? [];
      const homePlayers: any[] = lineups.find((l: any) => l.team?.id === fixture.home_team_id)?.startXI ?? [];
      const awayPlayers: any[] = lineups.find((l: any) => l.team?.id === fixture.away_team_id)?.startXI ?? [];
      const allPlayers = [...homePlayers, ...awayPlayers].slice(0, 6);

      for (const entry of allPlayers) {
        const player = entry.player;
        if (!player?.id || !player?.name) continue;
        questions.push({
          fixture_id: fixture.fixture_id,
          category: 'player_prediction',
          question_text: `Will ${player.name} score in ${home} vs ${away}?`,
          answer_options: [
            { id: 'yes', label: 'Yes — scores' },
            { id: 'no',  label: 'No — does not score' },
          ],
          difficulty: 'hard',
          xp_reward: 50,
          resolution_source: 'player_stats',
          resolution_rule: { type: 'player_goal', player_id: player.id, player_name: player.name },
          deadline_at: deadline30,
          resolves_after: resolveAfter,
          status: 'active',
        });
      }

      // ── Real World Edge — News-grounded questions ───────────────────
      const rwQuestions = await generateRealWorldFromNews(home, away, fixture.fixture_id, OPENAI_API_KEY);
      for (const rwQ of rwQuestions) {
        questions.push({
          ...rwQ,
          fixture_id: fixture.fixture_id,
          category: 'real_world_edge',
          resolution_source: 'ai_resolved',
          deadline_at: deadline60,
          resolves_after: resolveAfter,
          status: 'active',
        });
      }

      // ── Mark featured (top 3 by xp_reward — original indices) ───────
      const featuredIndices = new Set<number>(
        questions
          .map((q, i) => ({ xp: q.xp_reward, i }))
          .sort((a, b) => b.xp - a.xp)
          .slice(0, 3)
          .map(({ i }) => i)
      );
      const withFeatured = questions.map((q, i) => ({
        ...q,
        is_featured: featuredIndices.has(i),
        answer_options: JSON.stringify(q.answer_options),
        resolution_rule: JSON.stringify(q.resolution_rule),
      }));

      // ── Insert ──────────────────────────────────────────────────────
      const { error: insertErr } = await sb
        .from('market_questions')
        .insert(withFeatured);

      if (insertErr) {
        console.error(`[generate-market-questions] insert error fixture ${fixture.fixture_id}:`, insertErr);
      } else {
        totalGenerated += withFeatured.length;
        console.log(`[generate-market-questions] fixture ${fixture.fixture_id}: ${withFeatured.length} questions (${rwQuestions.length} RW)`);
      }
    }

    return new Response(JSON.stringify({ ok: true, fixtures: relevant.length, questions: totalGenerated }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[generate-market-questions] fatal:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ════════════════════════════════════════════════════════════════════════
// Real World Edge — news pipeline
// ════════════════════════════════════════════════════════════════════════

interface NewsArticle {
  title:       string;
  snippet:     string;
  sourceName:  string;
  url:         string;
  publishedAt: string;
}

async function generateRealWorldFromNews(
  home:      string,
  away:      string,
  fixtureId: number,
  apiKey:    string,
): Promise<any[]> {
  // ── Step 1: Fetch news articles about this match ──────────────────
  const articles = await fetchMatchNews(home, away);
  console.log(`[rw-news] fixture ${fixtureId}: ${articles.length} articles for ${home} vs ${away}`);

  if (!articles.length) {
    console.warn(`[rw-news] no articles found for ${home} vs ${away}, skipping RW questions`);
    return [];
  }

  // ── Step 2: Format headlines as context for OpenAI ────────────────
  const newsContext = articles.slice(0, 8).map((a, i) =>
    `[${i + 1}] "${a.title}" — ${a.sourceName} (${formatAge(a.publishedAt)})\n    ${a.snippet}`
  ).join('\n\n');

  // ── Step 3: OpenAI generates grounded questions ───────────────────
  const prompt = `You are a sports prediction analyst creating REAL WORLD EDGE questions for a prediction market.

Match: ${home} vs ${away}

Here are the latest real news articles about these teams:

${newsContext}

Your task:
1. Read the news carefully
2. Create exactly 2-3 prediction questions GROUNDED in this specific news
3. Each question must be directly resolvable by watching the match or checking the final match stats
4. Each question must reference the real-world context (injury, lineup, form, tactical situation)

Rules:
- Questions must be YES/NO or have 2 clear options
- The correct answer must be determinable from the final match data alone
- Include a "real_world_context" field explaining the news angle (1-2 sentences, cite source if possible)
- Include "real_world_confidence": "high" (clear confirmed news) | "medium" (rumour/likely) | "low" (speculation)
- Include "resolution_note" describing exactly how to verify the answer post-match
- Do NOT ask about things unresolvable from match stats (e.g. "will player X train tomorrow?")

Return ONLY a JSON array, no markdown:
[
  {
    "question_text": "...",
    "answer_options": [{"id": "yes", "label": "..."}, {"id": "no", "label": "..."}],
    "difficulty": "hard",
    "xp_reward": 50,
    "real_world_context": "...",
    "real_world_confidence": "medium",
    "resolution_rule": {
      "type": "ai_resolved",
      "resolution_note": "Check if X happened in the final match stats/report"
    },
    "is_featured": false
  }
]`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 1600,
      }),
    });

    if (!res.ok) {
      console.warn(`[rw-news] OpenAI error ${res.status}`);
      return [];
    }

    const json   = await res.json();
    const text   = json.choices?.[0]?.message?.content ?? '[]';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return Array.isArray(parsed) ? parsed : [];

  } catch (err: any) {
    console.warn('[rw-news] OpenAI call failed:', err.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════
// Google News RSS fetch + parse + deduplicate
// ════════════════════════════════════════════════════════════════════════

async function fetchMatchNews(home: string, away: string): Promise<NewsArticle[]> {
  // Three targeted queries:
  // 1. Broad — either team with news signal keywords
  // 2. Match-specific — both teams together
  // 3. Signal — injury/lineup/suspension focus
  const queries = [
    `("${home}" OR "${away}") AND (${SIGNAL_TERMS})`,
    `"${home}" AND "${away}"`,
    `"${home}" AND (${SIGNAL_TERMS})`,
    `"${away}" AND (${SIGNAL_TERMS})`,
  ];

  const urls = queries.map(q =>
    `${GOOGLE_NEWS_RSS_BASE}?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
  );

  // Fetch all feeds concurrently
  const allArticles = (await Promise.all(urls.map(fetchRssFeed))).flat();

  // Filter by age
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000);
  const fresh  = allArticles.filter(a => new Date(a.publishedAt) >= cutoff);

  // Deduplicate by title similarity
  const deduped = deduplicateByJaccard(fresh);

  // Sort: signal keywords first, then by freshness
  return deduped.sort((a, b) => {
    const aSignal = hasSignal(a.title + ' ' + a.snippet) ? 1 : 0;
    const bSignal = hasSignal(b.title + ' ' + b.snippet) ? 1 : 0;
    if (aSignal !== bSignal) return bSignal - aSignal;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

async function fetchRssFeed(url: string): Promise<NewsArticle[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssXml(xml);
  } catch {
    return [];
  }
}

function parseRssXml(xml: string): NewsArticle[] {
  const articles: NewsArticle[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const block   = m[1];
    const title   = stripCdata(extractTag(block, 'title'));
    const link    = stripCdata(extractTag(block, 'link'));
    const pubDate = extractTag(block, 'pubDate');
    const desc    = stripCdata(extractTag(block, 'description'));
    if (!title || !link) continue;

    // "Headline - Source Name" format
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
      snippet:     desc.slice(0, 280),
      sourceName:  sourceName || 'Unknown',
      url:         link,
      publishedAt: parseRssDate(pubDate),
    });
  }
  return articles;
}

function deduplicateByJaccard(articles: NewsArticle[]): NewsArticle[] {
  const seen: string[] = [];
  const result: NewsArticle[] = [];
  for (const a of articles) {
    const norm = normalise(a.title);
    const isDup = seen.some(s => jaccardSim(norm, s) >= DEDUP_THRESHOLD);
    if (!isDup) { seen.push(norm); result.push(a); }
  }
  return result;
}

function jaccardSim(a: string, b: string): number {
  const wA = new Set(a.split(' ').filter(w => w.length > 3));
  const wB = new Set(b.split(' ').filter(w => w.length > 3));
  if (!wA.size || !wB.size) return 0;
  const inter = [...wA].filter(w => wB.has(w)).length;
  return inter / new Set([...wA, ...wB]).size;
}

function hasSignal(text: string): boolean {
  const t = text.toLowerCase();
  return ['injur', 'lineup', 'doubt', 'ruled out', 'suspend', 'miss', 'unavail', 'fitness'].some(k => t.includes(k));
}

// ── XML helpers ───────────────────────────────────────────────────────
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  return (re.exec(xml)?.[1] ?? '').trim();
}

function extractSourceTag(block: string): string {
  return (/<source[^>]*>([^<]+)<\/source>/i.exec(block)?.[1] ?? '').trim();
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
}

function parseRssDate(raw: string): string {
  try { return new Date(raw).toISOString(); } catch { return new Date().toISOString(); }
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function formatAge(iso: string): string {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600_000);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
