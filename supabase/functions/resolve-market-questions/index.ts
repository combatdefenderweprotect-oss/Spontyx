// ════════════════════════════════════════════════════════════════════════
// Spontyx Market — resolve-market-questions Edge Function
// ════════════════════════════════════════════════════════════════════════
// Resolves locked market questions whose resolves_after time has passed
// and whose fixture is finished (FT / AET / PEN).
//
// ai_resolved questions (Real World Edge) are resolved via post-match
// Google News scraping → OpenAI determination of the correct answer.
//
// Triggered by pg_cron every 15 minutes.
// Also callable on-demand via POST with optional { question_id }.
//
// Deploy:
//   supabase functions deploy resolve-market-questions --no-verify-jwt
// ════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY       = Deno.env.get('OPENAI_API_KEY')!;

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const VOID_AFTER_HOURS  = 24;

// ── News config ───────────────────────────────────────────────────────
const GOOGLE_NEWS_RSS_BASE = 'https://news.google.com/rss/search';
const FETCH_TIMEOUT_MS     = 8_000;
const DEDUP_THRESHOLD      = 0.45;

Deno.serve(async (req: Request) => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }
  const forceQuestionId: string | null = (body.question_id as string) ?? null;

  // Lock questions past deadline first
  await sb.rpc('lock_market_questions_past_deadline');

  console.log('[resolve-market-questions] start', { forceQuestionId });

  try {
    // ── 1. Fetch questions due for resolution ──────────────────────────
    let query = sb
      .from('market_questions')
      .select('*')
      .eq('status', 'locked')
      .lte('resolves_after', new Date().toISOString());

    if (forceQuestionId) {
      query = sb.from('market_questions').select('*').eq('id', forceQuestionId);
    }

    const { data: questions, error: qErr } = await query;
    if (qErr) throw qErr;

    console.log(`[resolve-market-questions] ${questions?.length ?? 0} questions to resolve`);

    const stats = { resolved: 0, voided: 0, skipped: 0, errors: 0 };

    for (const q of questions ?? []) {
      try {
        // ── 2. Load fixture ─────────────────────────────────────────────
        const { data: fixture } = await sb
          .from('api_football_fixtures')
          .select('status_short, home_goals, away_goals, home_winner, away_winner, home_team_name, away_team_name, raw_fixture')
          .eq('fixture_id', q.fixture_id)
          .single();

        if (!fixture) {
          console.warn(`[resolve-market-questions] fixture ${q.fixture_id} not found, skipping`);
          stats.skipped++;
          continue;
        }

        // ── 3. Check if match is finished ───────────────────────────────
        if (!FINISHED_STATUSES.has(fixture.status_short)) {
          const resolveAge = Date.now() - new Date(q.resolves_after).getTime();
          if (resolveAge > VOID_AFTER_HOURS * 3600_000) {
            await sb.rpc('void_market_question', { p_question_id: q.id });
            console.warn(`[resolve-market-questions] voided ${q.id} (match not finished after ${VOID_AFTER_HOURS}h)`);
            stats.voided++;
          } else {
            stats.skipped++;
          }
          continue;
        }

        // ── 4. Determine correct answer ─────────────────────────────────
        const rule = q.resolution_rule ?? {};
        let correctAnswer: string | null = null;

        if (rule.type === 'ai_resolved') {
          // Post-match AI resolution via news scraping
          correctAnswer = await resolveAiQuestion(q, fixture.home_team_name, fixture.away_team_name);
          if (correctAnswer === null) {
            console.warn(`[resolve-market-questions] AI could not resolve ${q.id}, skipping`);
            stats.skipped++;
            continue;
          }
        } else {
          correctAnswer = determineCorrectAnswer(q, fixture);
          if (correctAnswer === null) {
            console.warn(`[resolve-market-questions] cannot resolve ${q.id} (rule: ${rule.type})`);
            stats.skipped++;
            continue;
          }
        }

        // ── 5. Resolve via RPC ──────────────────────────────────────────
        const { data: result, error: rErr } = await sb.rpc('resolve_market_question', {
          p_question_id:    q.id,
          p_correct_answer: correctAnswer,
        });

        if (rErr) {
          console.error(`[resolve-market-questions] RPC error for ${q.id}:`, rErr);
          stats.errors++;
        } else {
          console.log(`[resolve-market-questions] resolved ${q.id} → ${correctAnswer} (wins:${result?.wins}, losses:${result?.losses})`);
          stats.resolved++;
        }

      } catch (qErr: any) {
        console.error(`[resolve-market-questions] error on question ${q.id}:`, qErr.message);
        stats.errors++;
      }
    }

    console.log('[resolve-market-questions] done', stats);
    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[resolve-market-questions] fatal:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ════════════════════════════════════════════════════════════════════════
// AI resolution — post-match news → OpenAI determination
// ════════════════════════════════════════════════════════════════════════

async function resolveAiQuestion(question: any, home: string, away: string): Promise<string | null> {
  const answerOptions: Array<{ id: string; label: string }> =
    typeof question.answer_options === 'string'
      ? JSON.parse(question.answer_options)
      : question.answer_options ?? [];

  const rule = typeof question.resolution_rule === 'string'
    ? JSON.parse(question.resolution_rule)
    : question.resolution_rule ?? {};

  console.log(`[ai-resolve] fetching post-match news for ${home} vs ${away}`);
  const articles = await fetchPostMatchNews(home, away);
  console.log(`[ai-resolve] ${articles.length} post-match articles`);

  if (!articles.length) {
    console.warn(`[ai-resolve] no post-match news found for ${home} vs ${away}, cannot resolve`);
    return null;
  }

  const newsContext = articles.slice(0, 8).map((a, i) =>
    `[${i + 1}] "${a.title}" — ${a.sourceName} (${formatAge(a.publishedAt)})\n    ${a.snippet}`
  ).join('\n\n');

  const optionList = answerOptions.map(o => `  - "${o.id}": ${o.label}`).join('\n');
  const resolutionNote = rule.resolution_note ?? '';
  const rwContext = question.real_world_context ?? '';

  const prompt = `You are resolving a sports prediction question based on post-match reports.

Match: ${home} vs ${away} (FINISHED)

Question: "${question.question_text}"
${rwContext ? `Context: ${rwContext}` : ''}
${resolutionNote ? `Resolution guidance: ${resolutionNote}` : ''}

Answer options:
${optionList}

Post-match news articles:
${newsContext}

Based on these post-match reports, determine which answer option is correct.

Respond with ONLY the id of the correct answer (e.g. "yes" or "no" or "home" or "away").
Do not include any other text, explanation, or formatting — just the bare id string.
If you cannot determine the answer with reasonable confidence from the articles, respond with the single word: unknown`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 20,
      }),
    });

    if (!res.ok) {
      console.warn(`[ai-resolve] OpenAI error ${res.status}`);
      return null;
    }

    const json   = await res.json();
    const answer = (json.choices?.[0]?.message?.content ?? '').trim().toLowerCase().replace(/[^a-z_]/g, '');

    if (!answer || answer === 'unknown') {
      console.warn(`[ai-resolve] OpenAI could not determine answer for question ${question.id}`);
      return null;
    }

    // Validate the answer is one of the known option ids
    const validIds = answerOptions.map((o: any) => o.id.toLowerCase());
    if (!validIds.includes(answer)) {
      console.warn(`[ai-resolve] OpenAI returned unexpected answer "${answer}" for question ${question.id}, valid: ${validIds.join(', ')}`);
      return null;
    }

    console.log(`[ai-resolve] question ${question.id} → "${answer}" (from ${articles.length} articles)`);
    return answer;

  } catch (err: any) {
    console.warn('[ai-resolve] OpenAI call failed:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Post-match Google News fetching
// ════════════════════════════════════════════════════════════════════════

async function fetchPostMatchNews(home: string, away: string): Promise<NewsArticle[]> {
  const POST_MATCH_TERMS =
    '"match report" OR result OR highlights OR scored OR "full time" OR "final score" ' +
    'OR "hat trick" OR goals OR winner OR defeat OR victory';

  const queries = [
    `"${home}" AND "${away}" AND (${POST_MATCH_TERMS})`,
    `"${home}" AND "${away}"`,
    `"${home}" AND (${POST_MATCH_TERMS})`,
    `"${away}" AND (${POST_MATCH_TERMS})`,
  ];

  const urls = queries.map(q =>
    `${GOOGLE_NEWS_RSS_BASE}?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
  );

  const allArticles = (await Promise.all(urls.map(fetchRssFeed))).flat();

  // Allow articles up to 48h old (post-match window)
  const cutoff = new Date(Date.now() - 48 * 3600_000);
  const fresh  = allArticles.filter(a => new Date(a.publishedAt) >= cutoff);

  const deduped = deduplicateByJaccard(fresh);

  // Sort: post-match signal keywords first, then freshest
  return deduped.sort((a, b) => {
    const aSignal = hasPostMatchSignal(a.title + ' ' + a.snippet) ? 1 : 0;
    const bSignal = hasPostMatchSignal(b.title + ' ' + b.snippet) ? 1 : 0;
    if (aSignal !== bSignal) return bSignal - aSignal;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

function hasPostMatchSignal(text: string): boolean {
  const t = text.toLowerCase();
  return ['match report', 'full time', 'final score', 'highlights', 'hat trick', 'player of the match'].some(k => t.includes(k));
}

// ════════════════════════════════════════════════════════════════════════
// Resolution logic — deterministic per rule type
// ════════════════════════════════════════════════════════════════════════

function determineCorrectAnswer(question: any, fixture: any): string | null {
  const rule = question.resolution_rule ?? {};
  const type = rule.type as string;

  switch (type) {
    case 'match_result': {
      if (fixture.home_winner === true)  return 'home';
      if (fixture.away_winner === true)  return 'away';
      if (fixture.home_goals !== null && fixture.away_goals !== null) return 'draw';
      return null;
    }

    case 'first_half_result': {
      const ht = fixture.raw_fixture?.score?.halftime;
      if (!ht) return null;
      if (ht.home > ht.away) return 'home';
      if (ht.away > ht.home) return 'away';
      return 'draw';
    }

    case 'total_goals': {
      const total = (fixture.home_goals ?? 0) + (fixture.away_goals ?? 0);
      const threshold = rule.threshold as number;
      if (total > threshold)  return 'over';
      if (total < threshold)  return 'under';
      return null;
    }

    case 'btts': {
      if (fixture.home_goals === null || fixture.away_goals === null) return null;
      return (fixture.home_goals > 0 && fixture.away_goals > 0) ? 'yes' : 'no';
    }

    case 'team_more_possession': {
      const stats = extractStatistics(fixture.raw_fixture);
      const homePoss = parseFloat(stats.home?.['Ball Possession'] ?? '0');
      const awayPoss = parseFloat(stats.away?.['Ball Possession'] ?? '0');
      if (!homePoss && !awayPoss) return null;
      if (homePoss > awayPoss) return 'home';
      if (awayPoss > homePoss) return 'away';
      return null;
    }

    case 'team_more_corners': {
      const stats = extractStatistics(fixture.raw_fixture);
      const homeC = parseInt(stats.home?.['Corner Kicks'] ?? '0', 10);
      const awayC = parseInt(stats.away?.['Corner Kicks'] ?? '0', 10);
      if (homeC === awayC) return null;
      return homeC > awayC ? 'home' : 'away';
    }

    case 'total_corners': {
      const stats = extractStatistics(fixture.raw_fixture);
      const total = parseInt(stats.home?.['Corner Kicks'] ?? '0', 10)
                  + parseInt(stats.away?.['Corner Kicks'] ?? '0', 10);
      const threshold = rule.threshold as number;
      if (total > threshold)  return 'over';
      if (total < threshold)  return 'under';
      return null;
    }

    case 'player_goal': {
      const playerId = rule.player_id as number;
      const events: any[] = fixture.raw_fixture?.events ?? [];
      const scored = events.some((e: any) =>
        e.type === 'Goal' && e.player?.id === playerId && e.detail !== 'Own Goal'
      );
      return scored ? 'yes' : 'no';
    }

    case 'player_assist': {
      const playerId = rule.player_id as number;
      const events: any[] = fixture.raw_fixture?.events ?? [];
      const assisted = events.some((e: any) =>
        e.type === 'Goal' && e.assist?.id === playerId
      );
      return assisted ? 'yes' : 'no';
    }

    case 'player_card': {
      const playerId = rule.player_id as number;
      const events: any[] = fixture.raw_fixture?.events ?? [];
      const carded = events.some((e: any) =>
        e.type === 'Card' && e.player?.id === playerId
      );
      return carded ? 'yes' : 'no';
    }

    default:
      console.warn(`[resolve-market-questions] unknown rule type: ${type}`);
      return null;
  }
}

function extractStatistics(rawFixture: any): { home: Record<string, string>; away: Record<string, string> } {
  const result: { home: Record<string, string>; away: Record<string, string> } = { home: {}, away: {} };
  if (!rawFixture?.statistics) return result;

  for (const teamStats of rawFixture.statistics as any[]) {
    const side = teamStats.team?.id === rawFixture.teams?.home?.id ? 'home' : 'away';
    for (const s of teamStats.statistics ?? []) {
      result[side][s.type] = String(s.value ?? '0').replace('%', '');
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════
// Google News RSS utilities (shared with generate function)
// ════════════════════════════════════════════════════════════════════════

interface NewsArticle {
  title:       string;
  snippet:     string;
  sourceName:  string;
  url:         string;
  publishedAt: string;
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
    const norm  = normalise(a.title);
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
