import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { LeagueWithConfig, ValidatedQuestion, RejectionLogEntry, LeagueRunResult, SportsContext, LeagueClassification, GenerationMode, SportMatch, NewsItem, EnrichedNewsItem } from './lib/types.ts';
import { classifyLeague, sortLeaguesByPriority, checkQuota, getRecentQuestionTexts, checkRealWorldQuota } from './lib/quota-checker.ts';
import { fetchSportsContext } from './lib/sports-adapter/index.ts';
import { fetchInProgressFixturesFromCache } from './lib/sports-adapter/football.ts';
import { fetchNewsContext }   from './lib/news-adapter/index.ts';
import { buildContextPacket, buildPredicatePrompt, computeResolvesAfter, buildLiveContext, minuteToTimestamp } from './lib/context-builder.ts';
import { generateQuestions, convertToPredicate, generateRealWorldQuestion, generateRealWorldContext, scoreRealWorldQuestion, PROMPT_VERSION } from './lib/openai-client.ts';
import { validateQuestion } from './lib/predicate-validator.ts';
import {
  buildCacheKey, getLeagueType, getPhaseScope, getMode,
  findReadyPools, getOrClaimPool, getPoolQuestions,
  storePoolQuestions, markPoolReady, markPoolFailed,
  attachPoolQuestionsToLeague,
  type MatchPool,
} from './lib/pool-manager.ts';
import {
  filterPrematchBatch, computeStandingGap,
  filterPrematchPostPredicate, deriveMarketType, buildMatchMarketState,
  normalizePostFilterReason,
  type PrematchBatchContext, type PriorQuestionInfo,
  type MatchMarketState, type LineupContext,
} from './lib/prematch-quality-filter.ts';

const MAX_RETRIES = 3;

// ── Category → scoring metadata ───────────────────────────────────────

const CATEGORY_BASE_VALUE: Record<string, number> = {
  high_value_event: 20,
  outcome_state:    15,
  player_specific:  12,
  medium_stat:      10,
  low_value_filler:  6,
};

// ── Lane detection (mirrors detectLane() in league.html) ─────────────

type QuestionLane = 'CORE_MATCH_PREMATCH' | 'CORE_MATCH_LIVE' | 'REAL_WORLD';

function computeLane(
  matchMinuteAtGeneration: number | null | undefined,
  matchId: string | null | undefined,
): QuestionLane {
  if (matchMinuteAtGeneration != null) return 'CORE_MATCH_LIVE';
  if (matchId != null)                 return 'CORE_MATCH_PREMATCH';
  return 'REAL_WORLD';
}

const LANE_SOURCE_BADGE: Record<QuestionLane, string> = {
  CORE_MATCH_LIVE:    'LIVE',
  CORE_MATCH_PREMATCH: 'PRE-MATCH',
  REAL_WORLD:         'REAL WORLD',
};

const CATEGORY_EVENT_TYPE: Record<string, string> = {
  high_value_event: 'goal',
  outcome_state:    'clean_sheet',
  player_specific:  'next_scorer',
  medium_stat:      'stat_threshold',
  low_value_filler: 'time_window',
};

// ── Live difficulty multiplier ────────────────────────────────────────
// Returns 1.0 / 1.2 / 1.5 based on category + predicate + live context.
// Only used for CORE_MATCH_LIVE arena session inserts — never prematch.
// HARD (1.5): genuinely rare — player-specific, red card, penalty, player_stat predicate.
// MEDIUM (1.2): next-goal/next-scorer outcome, close-game state, high_value_event that isn't rare.
// EASY (1.0): broad time-window fillers, unclear or unclassifiable signals.

function getLiveDifficultyMultiplier(
  raw: any,
  predicate: any,
  liveCtx: { isCloseGame: boolean; lastEventType: string | null },
): 1.0 | 1.2 | 1.5 {
  try {
    const category     = (raw.question_category as string) ?? '';
    const predType     = (predicate?.resolution_type  as string) ?? '';
    const lastEvent    = (liveCtx.lastEventType       as string) ?? '';
    const hasPlayerId  = !!(predicate?.player_id);

    // ── HARD — genuinely rare ─────────────────────────────────────────
    if (category === 'player_specific')         return 1.5;
    if (hasPlayerId)                             return 1.5;
    if (predType === 'player_stat')              return 1.5;
    if (lastEvent === 'red_card')                return 1.5;
    if (lastEvent === 'penalty')                 return 1.5;

    // ── MEDIUM — specific + contextual ───────────────────────────────
    // Next-goal / next-scorer outcome (outcome_state + close game)
    if (category === 'outcome_state' && liveCtx.isCloseGame) return 1.2;
    // High-value event in a close game (e.g. "will there be another goal?")
    if (category === 'high_value_event' && liveCtx.isCloseGame) return 1.2;
    // Medium stat question in a close game
    if (category === 'medium_stat' && liveCtx.isCloseGame) return 1.2;

    // ── EASY — default ────────────────────────────────────────────────
    return 1.0;
  } catch {
    return 1.0;
  }
}

// ── Environment variables ─────────────────────────────────────────────
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY    = Deno.env.get('OPENAI_API_KEY')!;
const API_SPORTS_KEY    = Deno.env.get('API_SPORTS_KEY')!;
const GNEWS_API_KEY     = Deno.env.get('GNEWS_API_KEY') ?? ''  // Optional — Google News RSS needs no key;
const SCRAPER_API_URL   = Deno.env.get('SCRAPER_API_URL') ?? '';   // e.g. https://spontyx-scraper-service-production.up.railway.app
const SCRAPER_API_KEY   = Deno.env.get('SCRAPER_API_KEY') ?? '';   // x-scraper-key header value

// ── Main handler ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Accept both GET (from pg_net cron) and POST (for manual triggers)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Optional: simple bearer token to prevent unauthorised manual triggers
  const authHeader = req.headers.get('Authorization') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const triggerType = req.method === 'POST' ? 'manual' : 'scheduled';

  // ?live_only=1 — called by live-stats-poller every minute after live fixture upserts.
  // Skips prematch loop and REAL_WORLD loop; runs only the league + arena session live passes.
  const url      = new URL(req.url);
  const liveOnly = url.searchParams.get('live_only') === '1';

  // Optional POST body — used by ensure-prematch wrapper for demand-driven prematch
  // generation. When `league_id` is set, restricts the league fetch to that single
  // league. When `match_id` is also set, downstream eligibleMatches are filtered
  // to that single fixture. Cron path (no body) preserves the original behaviour.
  let targetLeagueId: string | null = null;
  let targetMatchId:  string | null = null;
  if (req.method === 'POST') {
    try {
      const body = await req.clone().json().catch(() => null);
      if (body && typeof body === 'object') {
        if (typeof body.league_id === 'string' && body.league_id.length > 0) targetLeagueId = body.league_id;
        if (typeof body.match_id  === 'string' && body.match_id.length  > 0) targetMatchId  = body.match_id;
      }
    } catch (_) { /* ignore — empty body is allowed */ }
  }

  // ── Create run record ───────────────────────────────────────────────
  const { data: runData, error: runErr } = await sb
    .from('generation_runs')
    .insert({ status: 'running', trigger_type: triggerType, prompt_version: PROMPT_VERSION })
    .select('id')
    .single();

  if (runErr || !runData) {
    console.error('[generate-questions] failed to create run record:', runErr);
    return new Response('Failed to create run', { status: 500 });
  }

  const runId = runData.id as string;
  const runStats = { leaguesEvaluated: 0, leaguesSkipped: 0, leaguesProcessed: 0, generated: 0, rejected: 0 };

  try {
    // ── Fetch all AI-enabled leagues ──────────────────────────────────
    // Migration 051 added creation_path + api_sports_league_ids[] to support
    // Season-Long Path A multi-competition leagues. Spec: docs/LEAGUE_CREATION_FLOW.md.
    let leagueQuery = sb
      .from('leagues')
      .select(`
        id, name, sport, scope, session_type,
        scoped_team_id, scoped_team_name,
        api_sports_league_id, api_sports_team_id, api_sports_season,
        creation_path, api_sports_league_ids,
        ai_weekly_quota, ai_total_quota,
        league_start_date, league_end_date, owner_id,
        prematch_question_budget, prematch_questions_per_match, live_question_budget, live_questions_per_match,
        prematch_generation_mode, prematch_publish_offset_hours,
        created_at
      `)
      .eq('ai_questions_enabled', true)
      // Accept either the legacy singular or the new array column.
      .or('api_sports_league_id.not.is.null,api_sports_league_ids.not.is.null');

    // Demand-driven path (ensure-prematch wrapper): narrow to a single league.
    if (targetLeagueId) leagueQuery = leagueQuery.eq('id', targetLeagueId);

    const { data: leagueRows, error: leagueErr } = await leagueQuery;

    if (leagueErr) throw new Error(`league fetch failed: ${leagueErr.message}`);
    if (!leagueRows || !leagueRows.length) {
      await finaliseRun(sb, runId, runStats, 'completed');
      return new Response(JSON.stringify({ ok: true, message: 'no enabled leagues' }), { status: 200 });
    }

    // ── Fan out multi-competition leagues into per-competition virtual entries ──
    // For each league, the effective competition list is api_sports_league_ids when
    // populated, otherwise [api_sports_league_id]. Each (league, competition) pair
    // becomes one virtual entry the rest of the pipeline can process unchanged.
    // Path B and legacy single-competition rows produce exactly one entry — identical
    // to pre-migration-051 behaviour. Path A produces N entries for an N-competition
    // selection. Question writes still use league.id, so all generated questions land
    // under the same league row.
    const leagues: LeagueWithConfig[] = [];
    for (const lr of (leagueRows as any[])) {
      const compIds: number[] = Array.isArray(lr.api_sports_league_ids) && lr.api_sports_league_ids.length > 0
        ? lr.api_sports_league_ids.filter((x: any) => x != null)
        : (lr.api_sports_league_id != null ? [lr.api_sports_league_id] : []);
      if (compIds.length === 0) continue;
      for (const compId of compIds) {
        leagues.push({ ...lr, api_sports_league_id: compId } as LeagueWithConfig);
      }
    }

    if (leagues.length === 0) {
      await finaliseRun(sb, runId, runStats, 'completed');
      return new Response(JSON.stringify({ ok: true, message: 'no resolvable competitions' }), { status: 200 });
    }

    runStats.leaguesEvaluated = leagues.length;

    // Build owner tier map for Real World quota enforcement
    const ownerIds = [...new Set((leagues as LeagueWithConfig[]).map((l) => l.owner_id).filter(Boolean) as string[])];
    const ownerTierMap = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: ownerRows } = await sb.from('users').select('id, tier').in('id', ownerIds);
      for (const row of ownerRows ?? []) {
        ownerTierMap.set(row.id, row.tier ?? 'starter');
      }
    }

    // ── Classify leagues by match imminence ───────────────────────────
    const classifications = await Promise.all(
      (leagues as LeagueWithConfig[]).map(async (league) => {
        try {
          const ctx = await fetchSportsContext(league, API_SPORTS_KEY, sb);
          return classifyLeague(league, ctx.upcomingMatches);
        } catch (err) {
          console.warn(`[classify] failed for league ${league.id}:`, err);
          return classifyLeague(league, []);
        }
      }),
    );

    // Sort highest priority first
    const sorted = sortLeaguesByPriority(classifications);

    // ── Process each league (prematch pass) ──────────────────────────
    // Skipped when live_only=1 (called from live-stats-poller every minute)
    if (!liveOnly) for (const cls of sorted) {
      const leagueStart = Date.now();
      const { league } = cls;
      const result: LeagueRunResult = {
        leagueId:              league.id,
        sport:                 league.sport,
        generationMode:        cls.generationMode,
        earliestMatchKickoff:  cls.earliestKickoff,
        hoursUntilKickoff:     cls.hoursUntilKickoff,
        priorityScore:         cls.priorityScore,
        quotaTotal:            0,
        quotaUsedTotal:        0,
        quotaUsedThisWeek:     0,
        questionsRequested:    0,
        questionsGenerated:    0,
        questionsRejected:     0,
        rejectionLog:          [],
        skipped:               false,
        newsItemsFetched:      0,
        newsUnavailable:       false,
        newsSnapshot:          [],
        durationMs:            0,
      };

      // MVP: football only — hockey/tennis adapters not ready for live launch.
      // Leave this guard in place until each sport is verified end-to-end.
      // To enable a sport post-MVP: remove it from this list.
      const MVP_UNSUPPORTED_SPORTS = ['hockey', 'tennis', 'other'];
      if (MVP_UNSUPPORTED_SPORTS.includes(league.sport)) {
        result.skipped    = true;
        result.skipReason = 'sport_not_supported_mvp';
        runStats.leaguesSkipped++;
        await writeLeagueResult(sb, runId, result);
        continue;
      }

      // Skip NONE — no matches in next 7 days
      if (cls.classification === 'NONE') {
        result.skipped    = true;
        result.skipReason = 'no_upcoming_matches';
        runStats.leaguesSkipped++;
        await writeLeagueResult(sb, runId, result);
        continue;
      }

      // Fix 5: Skip DISTANT — match is 3–7 days away; prematch questions must not
      // be generated this far out. Automatic window opens at 48h; manual window
      // opens at kickoff − offset_hours (max 48h). Neither applies at 3-7 days.
      if (cls.classification === 'DISTANT') {
        result.skipped    = true;
        result.skipReason = 'match_too_distant';
        runStats.leaguesSkipped++;
        await writeLeagueResult(sb, runId, result);
        continue;
      }

      // Quota check
      let quota;
      try {
        quota = await checkQuota(sb, league, /* isPrematch */ true);
      } catch (err) {
        console.warn(`[quota] failed for league ${league.id}:`, err);
        result.skipped    = true;
        result.skipReason = 'quota_reached';
        await writeLeagueResult(sb, runId, result);
        continue;
      }

      result.quotaTotal         = quota.quotaTotal;
      result.quotaUsedTotal     = quota.quotaUsedTotal;
      result.quotaUsedThisWeek  = quota.quotaUsedThisWeek;
      result.questionsRequested = quota.questionsToGenerate;

      if (quota.questionsToGenerate <= 0) {
        result.skipped    = true;
        result.skipReason = quota.skipReason ?? 'quota_reached';
        runStats.leaguesSkipped++;
        await writeLeagueResult(sb, runId, result);
        continue;
      }

      // ── Venue Starter AI preview cap ─────────────────────────────────
      // Venue Starter: aiPreviewPerEvent = 3 total AI questions per event.
      // Each venue event maps to its own league_id in the generation pipeline,
      // so enforcing by league_id count is the correct mechanism.
      // We check the owner's tier for the venue-starter limit; non-venue owners skip.
      const ownerTierForCap = ownerTierMap.get(league.owner_id ?? '') ?? 'starter';
      if (ownerTierForCap === 'venue-starter') {
        const AI_PREVIEW_CAP = 3; // matches aiPreviewPerEvent in TIER_LIMITS
        const { count: existingAiCount, error: capErr } = await sb
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', league.id)
          .eq('source', 'ai_generated');

        if (!capErr && (existingAiCount ?? 0) >= AI_PREVIEW_CAP) {
          result.skipped    = true;
          result.skipReason = 'venue_ai_preview_cap';
          console.log(`[venue-starter] league ${league.id} hit aiPreviewPerEvent cap (${existingAiCount}/${AI_PREVIEW_CAP})`);
          runStats.leaguesSkipped++;
          await writeLeagueResult(sb, runId, result);
          continue;
        }
      }

      runStats.leaguesProcessed++;

      // Step 1: Fetch sports context
      let sportsCtx;
      try {
        sportsCtx = await fetchSportsContext(league, API_SPORTS_KEY, sb);
      } catch (err) {
        console.warn(`[sports] failed for league ${league.id}:`, err);
        result.skipped    = true;
        result.skipReason = 'no_upcoming_matches';
        await writeLeagueResult(sb, runId, result);
        continue;
      }

      // Step 2: Fetch news context (non-blocking)
      const { items: newsItems, unavailable: newsUnavailable } = await fetchNewsContext(
        league,
        sportsCtx,
        GNEWS_API_KEY,
      );
      result.newsItemsFetched = newsItems.length;
      result.newsUnavailable  = newsUnavailable;
      result.newsSnapshot     = newsItems.slice(0, 10).map((n) => ({
        headline:     n.headline,
        source:       n.sourceName,
        publishedAt:  n.publishedAt,
        relevanceTag: n.relevanceTag,
      }));

      // Step 3: Fetch recent questions for dedup
      const recentQuestions = await getRecentQuestionTexts(sb, league.id);

      // Step 3b: Filter matches by pre-match publish window.
      // automatic: within 48h of kickoff; manual: now >= kickoff − offset_hours.
      // Never generate after kickoff (handled inside isMatchEligibleForPrematch).
      const nowMs = Date.now();
      const eligibleMatches = sportsCtx.upcomingMatches
        .filter((m) => !targetMatchId || String(m.id) === String(targetMatchId))
        .filter((m) => isMatchEligibleForPrematch(m.kickoff, league, nowMs));

      if (!eligibleMatches.length) {
        result.skipped    = true;
        result.skipReason = 'no_matches_in_publish_window';
        runStats.leaguesSkipped++;
        console.log(`[schedule] league ${league.id} — no matches in publish window (mode=${league.prematch_generation_mode ?? 'automatic'})`);
        await writeLeagueResult(sb, runId, result);
        continue;
      }

      // Replace sportsCtx with publish-window-filtered variant for all phases below.
      const filteredSportsCtxBySchedule = { ...sportsCtx, upcomingMatches: eligibleMatches };

      // Steps 4–6: Pool-aware generation
      //
      // Phase A — Reuse: find ready pools for upcoming matches and attach directly.
      //           No OpenAI call. One pool may serve 15 leagues watching the same match.
      //
      // Phase B — Generate: for matches with no pool, claim the pool (race-safe),
      //           call OpenAI once, store canonical questions in match_pool_questions.
      //
      // Phase C — Attach: for each newly generated pool, create league-specific
      //           question rows in the questions table with timing + dedup checks.

      const upcomingMatchIds = filteredSportsCtxBySchedule.upcomingMatches.map((m) => m.id).filter(Boolean);

      // ── Per-match target (migration 053) ──────────────────────────────
      // prematch_questions_per_match is the user-chosen count (1–10, default 5).
      // Falls back to prematch_question_budget (intensity preset, legacy) then 5.
      const perMatchTarget: number =
        league.prematch_questions_per_match ?? league.prematch_question_budget ?? 5;

      // ── Per-(league, match_id) existing count — idempotency guard ─────
      // Count actual CORE_MATCH_PREMATCH rows already in the questions table for
      // each eligible match. Skip the match entirely if already at target.
      // This prevents double-generation on cron+demand-driven concurrent runs and
      // on repeated ensure-prematch calls (tab refresh, league re-opens, etc.).
      const matchShortfalls = new Map<string, number>(); // matchId → questions still needed
      for (const m of filteredSportsCtxBySchedule.upcomingMatches) {
        if (!m.id) continue;
        const { count: existing, error: cntErr } = await sb
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', league.id)
          .eq('match_id', String(m.id))
          .eq('question_type', 'CORE_MATCH_PREMATCH')
          .neq('resolution_status', 'voided');
        if (cntErr) {
          console.warn(`[prematch-count] count query failed for match ${m.id}:`, cntErr.message);
          matchShortfalls.set(String(m.id), perMatchTarget); // assume full shortfall on error
        } else {
          const shortfall = Math.max(0, perMatchTarget - (existing ?? 0));
          matchShortfalls.set(String(m.id), shortfall);
          if (shortfall === 0) {
            console.log(`[prematch-count] league ${league.id} match ${m.id} already at target (${existing}/${perMatchTarget}), skipping`);
          }
        }
      }

      // ── Pre-fetch existing questions for market/predicate dedup ──────
      // Fetches full question data (not just count) for matches that still
      // need questions. Used to initialise MatchMarketState for the
      // post-predicate strict filter and for the market-aware fallback.
      // Only fetches matches with shortfall > 0 to minimise DB calls.
      const existingQsByMatch = new Map<string, MatchMarketState>();
      for (const m of filteredSportsCtxBySchedule.upcomingMatches) {
        if (!m.id || (matchShortfalls.get(String(m.id)) ?? 0) <= 0) continue;
        const { data: existingQs } = await sb
          .from('questions')
          .select('question_text, resolution_predicate, player_ids')
          .eq('league_id', league.id)
          .eq('match_id', String(m.id))
          .eq('question_type', 'CORE_MATCH_PREMATCH')
          .neq('resolution_status', 'voided');
        existingQsByMatch.set(
          String(m.id),
          buildMatchMarketState(existingQs ?? [], m.homeTeam.id, m.awayTeam.id),
        );
      }

      // Total AI-generated questions needed this run (across all eligible matches).
      // Capped by weekly/total quota — fallback templates cover any remaining shortfall
      // without consuming AI quota.
      const totalShortfall = Array.from(matchShortfalls.values()).reduce((s, n) => s + n, 0);
      if (totalShortfall === 0) {
        result.skipped    = true;
        result.skipReason = 'prematch_target_already_met';
        runStats.leaguesSkipped++;
        await writeLeagueResult(sb, runId, result);
        continue;
      }

      // AI quota cap applies only to AI-generated questions; fallback templates are zero-cost.
      const leagueQuotaCap = Math.min(quota.questionsToGenerate, totalShortfall);

      const baseKey = {
        sport:         league.sport,
        leagueType:    getLeagueType(league),
        phaseScope:    getPhaseScope(league),
        mode:          getMode(league),
        promptVersion: PROMPT_VERSION,
        scope:         (league.scope ?? 'full_league') as 'full_league' | 'team_specific',
        scopedTeamId:  league.scoped_team_id ?? null,
      };

      // Phase A: reuse existing ready pools (operating on schedule-filtered matches)
      // Only query pools for matches that still have a shortfall.
      const matchIdsWithShortfall = upcomingMatchIds.filter((id) => (matchShortfalls.get(id) ?? 0) > 0);
      const existingPools = await findReadyPools(sb, matchIdsWithShortfall, baseKey);
      let totalAttached = 0;

      for (const [matchId, pool] of existingPools) {
        if (totalAttached >= leagueQuotaCap) break;
        // Respect per-match shortfall: don't attach more than the match still needs.
        const matchCap = Math.min(matchShortfalls.get(matchId) ?? 0, leagueQuotaCap - totalAttached);
        if (matchCap <= 0) continue;
        // Note: no REAL_WORLD filter needed here — prematch pool questions are always
        // CORE_MATCH_PREMATCH (computeLane returns REAL_WORLD only when matchId is null
        // AND no matchMinute, which never applies to pool questions). The previous
        // checkRealWorldQuota call + filter was dead code that ran an unnecessary DB
        // query without ever removing any questions.
        const poolQs = await getPoolQuestions(sb, pool.id, baseKey.mode);
        const attached = await attachPoolQuestionsToLeague(
          sb, poolQs, league, runId, PROMPT_VERSION,
          recentQuestions, totalAttached, totalAttached + matchCap,
        );
        if (attached > 0) {
          console.log(`[pool] reused ${attached} questions for league ${league.id} from match ${matchId}`);
          totalAttached += attached;
          matchShortfalls.set(matchId, Math.max(0, (matchShortfalls.get(matchId) ?? 0) - attached));
        }
      }

      // Phase B: generate for uncovered matches (only schedule-eligible matches)
      const coveredIds = new Set(existingPools.keys());
      const uncoveredMatches = filteredSportsCtxBySchedule.upcomingMatches.filter(
        (m) => m.id && !coveredIds.has(m.id) && (matchShortfalls.get(String(m.id)) ?? 0) > 0,
      );

      if (uncoveredMatches.length > 0 && totalAttached < leagueQuotaCap) {
        // Race-safe pool claim: whichever process inserts first owns generation
        const claimedPools = new Map<string, MatchPool>();
        for (const match of uncoveredMatches) {
          const key = buildCacheKey(match.id, league, PROMPT_VERSION);
          // Pool expires at kickoff — prematch questions invalid once match starts
          const { pool, isNew } = await getOrClaimPool(sb, key, runId, match.kickoff);
          if (isNew && pool) claimedPools.set(match.id, pool);
        }

        if (claimedPools.size > 0) {
          // Build context targeting only the matches we own
          const filteredCtx = {
            ...sportsCtx,
            upcomingMatches: uncoveredMatches.filter((m) => claimedPools.has(m.id)),
          };

          // Build prematch quality batch context from the first match.
          // Used ONLY by the pre-predicate batch filter (filterPrematchBatch),
          // which operates on coarse text/category signals where first-match
          // approximation is acceptable. The strict post-predicate filter
          // uses a per-match ctx built inside the per-question loop below.
          const firstMatchForQuality = filteredCtx.upcomingMatches[0];
          const prematchBatchCtx: PrematchBatchContext | null = firstMatchForQuality ? {
            homeTeamId:    firstMatchForQuality.homeTeam.id,
            homeTeamName:  firstMatchForQuality.homeTeam.name,
            awayTeamId:    firstMatchForQuality.awayTeam.id,
            awayTeamName:  firstMatchForQuality.awayTeam.name,
            standingGap:   computeStandingGap(sportsCtx.standings, firstMatchForQuality),
            scopedTeamId:  league.scoped_team_id ?? null,
            scopedTeamName: league.scoped_team_name ?? null,
          } : null;

          // ── Per-match context builders (used in the per-question loop) ─
          // standingGap, market-type team IDs, and lineup state must reflect
          // the question's own match — not the first match in the batch.
          const buildPerMatchCtx = (matchId: string): PrematchBatchContext | null => {
            const m = filteredCtx.upcomingMatches.find((x) => x.id === matchId);
            if (!m) return null;
            return {
              homeTeamId:     m.homeTeam.id,
              homeTeamName:   m.homeTeam.name,
              awayTeamId:     m.awayTeam.id,
              awayTeamName:   m.awayTeam.name,
              standingGap:    computeStandingGap(sportsCtx.standings, m),
              scopedTeamId:   league.scoped_team_id ?? null,
              scopedTeamName: league.scoped_team_name ?? null,
            };
          };
          const buildPerMatchLineupCtx = (matchId: string): LineupContext => {
            const m = filteredCtx.upcomingMatches.find((x) => x.id === matchId);
            const kMs = m ? new Date(m.kickoff).getTime() : Infinity;
            const minutesToKickoff = kMs === Infinity
              ? Infinity
              : Math.max(0, (kMs - Date.now()) / 60_000);
            const matchAvailability = (filteredCtx.playerAvailability ?? [])
              .filter((a) => a.fixtureId === matchId);
            const confirmedPlayerIds = new Set<string>(
              matchAvailability
                .filter((a) => a.source === 'lineup' &&
                               (a.status === 'starting' || a.status === 'substitute'))
                .map((a) => a.playerId),
            );
            return {
              minutesToKickoff,
              lineupAvailable: matchAvailability.some((a) => a.source === 'lineup'),
              confirmedPlayerIds,
            };
          };

          // ── Pool generation target (Fix 2 — corrected patch) ──────────
          // The pool must be large enough to satisfy ANY league that shares the
          // EXACT same generation profile (all 8 PoolCacheKey fields).
          // We find all co-profile leagues among the current run batch and take
          // the maximum prematch budget, falling back to 8 (STANDARD live budget).
          //
          // Only leagues with identical: sport, leagueType, phaseScope, mode,
          // scope, scopedTeamId, promptVersion qualify as co-profile.
          // matchId is already fixed per uncoveredMatch — so the profile check
          // implicitly covers all 8 key fields.
          const poolGenerationTarget = computePoolGenerationTarget(
            filteredCtx.upcomingMatches.map((m) => m.id),
            league,
            leagues as LeagueWithConfig[],
          );

          // Derive diversity signals from recent question texts (best-effort heuristics)
          const recentCategories = deriveRecentCategories(recentQuestions);
          const recentStatFocus  = deriveRecentStatFocus(recentQuestions);

          const contextPacket = buildContextPacket({
            league,
            classification:        cls,
            sportsCtx:             filteredCtx,
            newsItems,
            recentQuestions,
            // Use poolGenerationTarget — not the per-league quota — so the pool
            // is large enough to serve the highest-budget co-profile league.
            questionsToGenerate:   poolGenerationTarget - totalAttached,
            existingQuestionCount: totalAttached,
            recentCategories,
            recentStatFocus,
          });

          // Generate + validate (with retry)
          const validatedQuestions: ValidatedQuestion[] = [];
          let attempt = 0;
          while (
            validatedQuestions.length < (poolGenerationTarget - totalAttached) &&
            attempt < MAX_RETRIES
          ) {
            attempt++;

            let rawQuestions;
            try {
              rawQuestions = await generateQuestions(contextPacket, OPENAI_API_KEY);
            } catch (err) {
              result.rejectionLog.push({ attempt, stage: 'question_generation', error: String(err) });
              result.questionsRejected++;
              continue;
            }

            // ── Prematch quality pre-filter ──────────────────────────
            // Runs before predicate conversion (Call 2) to avoid spending
            // tokens on low-quality questions. Only filters prematch_only
            // questions; live/REAL_WORLD pass through unchanged.
            if (prematchBatchCtx) {
              const quotaRemaining = (poolGenerationTarget - totalAttached) - validatedQuestions.length;
              const priorInfo: PriorQuestionInfo[] = validatedQuestions.map((vq) => ({
                question_text: vq.question_text,
                player_id:     vq.player_ids?.[0] ?? undefined,
              }));
              const filterResult = filterPrematchBatch(
                rawQuestions, prematchBatchCtx, priorInfo, Math.max(1, quotaRemaining),
              );
              for (const r of filterResult.rejected) {
                console.log(
                  `[prematch_quality] rejected "${r.question_text.slice(0, 70)}" ` +
                  `— ${r.reason} (score=${r.score})`,
                );
                result.rejectionLog.push({
                  attempt,
                  stage:         'prematch_quality',
                  question_text: r.question_text,
                  error:         `${r.reason} (score=${r.score})`,
                  // ── Structured fields for analytics views ──────────────
                  reason:        r.reason,
                  score:         r.score,
                  fixture_id:    firstMatchForQuality?.id ?? null,
                  timestamp:     new Date().toISOString(),
                });
                result.questionsRejected++;
              }
              rawQuestions = filterResult.accepted;
              if (rawQuestions.length === 0) {
                console.log(`[prematch_quality] all questions rejected in attempt ${attempt}, retrying`);
                continue; // trigger next while-loop iteration
              }
            }

            for (const raw of rawQuestions) {
              if (validatedQuestions.length >= (poolGenerationTarget - totalAttached)) break;

              // ── Fill system-computed fields ────────────────────────────
              raw.event_type         = CATEGORY_EVENT_TYPE[raw.question_category] ?? 'time_window';
              raw.narrative_context  = raw.reasoning_short ?? '';
              raw.resolution_rule_text = raw.predicate_hint ?? '';

              // Timing: for prematch, override OpenAI timestamps with authoritative values.
              // OpenAI can approximate but doesn't know exact server time or kickoff offset.
              const now = new Date().toISOString();
              const firstMatch = filteredCtx.upcomingMatches[0];
              const kickoff = firstMatch?.kickoff ?? now;

              // opens_at / visible_from — determined by league's scheduling mode:
              //   automatic: publish immediately (now)
              //   manual:    publish at kickoff − offset_hours (clamped to now if past)
              const computedVisibleFrom = computeVisibleFrom(league, kickoff);
              raw.visible_from = computedVisibleFrom;
              raw.opens_at = computedVisibleFrom;

              // answer_closes_at / deadline — for prematch: kickoff is the hard close
              raw.answer_closes_at = kickoff;
              raw.deadline         = kickoff;

              // ── Convert predicate_hint to structured predicate (Call 2) ─
              let predicate;
              try {
                const predicatePrompt = buildPredicatePrompt({
                  questionText:       raw.question_text,
                  type:               raw.type,
                  options:            raw.options,
                  resolutionRuleText: raw.predicate_hint ?? '',
                  matches:            filteredCtx.upcomingMatches,
                  players:            filteredCtx.keyPlayers,
                  sport:              league.sport,
                });
                predicate = await convertToPredicate(predicatePrompt, OPENAI_API_KEY);
              } catch (err) {
                result.rejectionLog.push({ attempt, stage: 'predicate_parse', question_text: raw.question_text, error: String(err) });
                result.questionsRejected++;
                continue;
              }

              // ── Resolve match_id: OpenAI output → predicate → first match ─
              const predAny = predicate as any;
              if (!raw.match_id && predAny.match_id) {
                raw.match_id = String(predAny.match_id);
              }
              if (!raw.match_id && filteredCtx.upcomingMatches.length > 0) {
                raw.match_id = filteredCtx.upcomingMatches[0].id;
              }

              // ── Derive team_ids from match ────────────────────────────
              const matchForTeams = filteredCtx.upcomingMatches.find((m) => m.id === raw.match_id);
              raw.team_ids  = matchForTeams
                ? [matchForTeams.homeTeam.id, matchForTeams.awayTeam.id]
                : [];
              raw.player_ids = predAny.player_id ? [String(predAny.player_id)] : [];

              // ── Compute resolves_after — always use system value for correctness ─
              // OpenAI's resolves_after is aspirational; we override with kickoff + sport buffer
              // to guarantee it's after the match ends regardless of what OpenAI computed.
              const primaryMatch = filteredCtx.upcomingMatches.find((m) => m.id === raw.match_id);
              raw.resolves_after = primaryMatch
                ? computeResolvesAfter(primaryMatch.kickoff, league.sport)
                : computeResolvesAfter(raw.deadline, league.sport);

              // ── Post-predicate strict filter ───────────────────────────
              // Market dedup, predicate fingerprint dedup, text dedup,
              // heavy-favourite hard reject, lineup-aware player gating,
              // and team balance — all operating on the resolved predicate.
              // This runs before validateQuestion so schema errors in
              // already-filtered questions are never wasted on token cost.
              if (raw.generation_trigger === 'prematch_only' && raw.match_id) {
                const matchState = existingQsByMatch.get(raw.match_id);
                const perMatchCtx = buildPerMatchCtx(raw.match_id);
                if (matchState && perMatchCtx) {
                  const perMatchLineupCtx = buildPerMatchLineupCtx(raw.match_id);
                  const postResult = filterPrematchPostPredicate(
                    raw, predicate, matchState, perMatchCtx, perMatchLineupCtx, perMatchTarget,
                  );
                  if (!postResult.accept) {
                    const reason = postResult.reason ?? 'post_predicate_reject';
                    console.log(
                      `[prematch_post] rejected "${(raw.question_text ?? '').slice(0, 70)}" — ${reason}`,
                    );
                    result.rejectionLog.push({
                      attempt,
                      stage:         'prematch_quality_post',
                      question_text: raw.question_text,
                      error:         reason,
                      reason:        normalizePostFilterReason(reason),
                      score:         0,
                    });
                    result.questionsRejected++;
                    continue;
                  }
                }
              }

              const rejection = validateQuestion(raw, predicate, filteredCtx, league, attempt);
              if (rejection) {
                result.rejectionLog.push(rejection);
                result.questionsRejected++;
                continue;
              }

              // base_value: prefer OpenAI's value; fall back to category lookup
              const baseValue = (raw.base_value && raw.base_value > 0)
                ? raw.base_value
                : (CATEGORY_BASE_VALUE[raw.question_category] ?? 6);

              const lane = computeLane(raw.match_minute_at_generation, raw.match_id);

              validatedQuestions.push({
                league_id:                  league.id,
                source:                     'ai_generated',
                generation_run_id:          runId,
                question_text:              raw.question_text,
                type:                       raw.type,
                options:                    raw.options ?? null,
                sport:                      league.sport,
                match_id:                   raw.match_id ?? null,
                team_ids:                   raw.team_ids,
                player_ids:                 raw.player_ids,
                event_type:                 raw.event_type,
                narrative_context:          raw.narrative_context,
                opens_at:                   raw.opens_at,
                deadline:                   raw.deadline,
                resolves_after:             raw.resolves_after,
                resolution_rule_text:       raw.resolution_rule_text,
                resolution_predicate:       predicate,
                resolution_status:          'pending',
                ai_model:                   'gpt-4o-mini',
                ai_prompt_version:          PROMPT_VERSION,
                question_type:              lane,
                source_badge:               LANE_SOURCE_BADGE[lane],
                base_value:                 baseValue,
                difficulty_multiplier:      raw.difficulty_multiplier ?? 1.0,
                reuse_scope:                raw.reusable_scope ?? 'prematch_only',
                visible_from:               raw.visible_from,
                answer_closes_at:           raw.answer_closes_at,
                match_minute_at_generation: raw.match_minute_at_generation ?? null,
                generation_trigger:         raw.generation_trigger ?? 'time_driven',
              });
            }
          }

          // Phase C: group by match_id → store in pool → attach to league
          const byMatch = new Map<string, ValidatedQuestion[]>();
          for (const q of validatedQuestions) {
            const mid = q.match_id ?? '_no_match';
            if (!byMatch.has(mid)) byMatch.set(mid, []);
            byMatch.get(mid)!.push(q);
          }

          for (const [matchId, matchQuestions] of byMatch) {
            const pool = claimedPools.get(matchId);

            if (!pool) {
              // No pool claimed for this match_id — insert directly
              const { error: directErr } = await sb.from('questions').insert(matchQuestions);
              if (!directErr) totalAttached += matchQuestions.length;
              continue;
            }

            // Store canonical questions in pool (fingerprint dedup applied on upsert)
            const stored = await storePoolQuestions(sb, pool.id, matchQuestions);

            if (stored.length > 0) {
              await markPoolReady(sb, pool.id, stored.length);
              // Attach from pool to this league with per-league constraint checks.
              // Cap respects both the per-match shortfall and the AI quota ceiling.
              const phaseB_matchCap = Math.min(
                matchShortfalls.get(matchId) ?? 0,
                leagueQuotaCap - totalAttached,
              );
              const poolQs = await getPoolQuestions(sb, pool.id, baseKey.mode);
              const attached = await attachPoolQuestionsToLeague(
                sb, poolQs, league, runId, PROMPT_VERSION,
                recentQuestions, totalAttached, totalAttached + phaseB_matchCap,
              );
              totalAttached += attached;
              if (attached > 0) {
                matchShortfalls.set(matchId, Math.max(0, (matchShortfalls.get(matchId) ?? 0) - attached));
              }
            } else {
              await markPoolFailed(sb, pool.id);
            }
          }

          // Mark failed any pools where no questions were generated
          for (const [matchId, pool] of claimedPools) {
            if (!byMatch.has(matchId)) await markPoolFailed(sb, pool.id);
          }
        }
      }

      // ── Phase D: Market-aware fallback template fill ─────────────────
      //
      // After Phases A–C, any match still short of its per-match target
      // is filled with deterministic hardcoded templates.
      //
      // Rules:
      //   • source = 'fallback_template' — NOT counted against AI quota
      //   • Respects market_type uniqueness — skips any template whose
      //     market is already present in existing questions for the match
      //   • Skips home_win / away_win when standingGap >= 5 (heavy favourite)
      //   • Stops as soon as target is reached OR no valid templates remain
      //   • Logs target_unmet if target cannot be reached without violating rules
      //
      // Only fires for CORE_MATCH_PREMATCH. Live / REAL_WORLD unaffected.
      let fallbackAttached = 0;
      for (const m of filteredSportsCtxBySchedule.upcomingMatches) {
        if (!m.id) continue;
        const remaining = matchShortfalls.get(String(m.id)) ?? 0;
        if (remaining <= 0) continue;

        const homeTeam = m.homeTeam?.name ?? 'Home';
        const awayTeam = m.awayTeam?.name ?? 'Away';
        const homeId   = String(m.homeTeam?.id ?? '');
        const awayId   = String(m.awayTeam?.id ?? '');
        const kickoff  = m.kickoff ?? new Date().toISOString();
        const matchGap = computeStandingGap(sportsCtx.standings, m);

        // 11 distinct markets ordered by diversity value.
        // Markets are paired with their predicate for resolver compatibility.
        const ALL_FALLBACK_TEMPLATES = [
          { market: 'btts',           text: 'Will both teams score?',                          predicate: { resolution_type: 'btts',         match_id: String(m.id) } },
          { market: 'over_goals:2.5', text: 'Will there be over 2.5 goals in this match?',     predicate: { resolution_type: 'match_stat',    match_id: String(m.id), binary_condition: { field: 'total_goals', operator: 'gt',  value: 2 } } },
          { market: 'over_goals:1.5', text: 'Will there be at least 2 goals scored?',          predicate: { resolution_type: 'match_stat',    match_id: String(m.id), binary_condition: { field: 'total_goals', operator: 'gt',  value: 1 } } },
          { market: 'over_goals:3.5', text: 'Will there be more than 3 goals in the match?',   predicate: { resolution_type: 'match_stat',    match_id: String(m.id), binary_condition: { field: 'total_goals', operator: 'gt',  value: 3 } } },
          { market: 'clean_sheet_home', text: `Will ${homeTeam} keep a clean sheet?`,          predicate: { resolution_type: 'match_stat',    match_id: String(m.id), binary_condition: { field: 'away_score',  operator: 'eq',  value: 0 } } },
          { market: 'clean_sheet_away', text: `Will ${awayTeam} keep a clean sheet?`,          predicate: { resolution_type: 'match_stat',    match_id: String(m.id), binary_condition: { field: 'home_score',  operator: 'eq',  value: 0 } } },
          { market: 'cards_total',    text: 'Will there be more than 3 yellow cards?',         predicate: { resolution_type: 'match_stat',    match_id: String(m.id), binary_condition: { field: 'total_cards', operator: 'gt',  value: 3 } } },
          { market: 'corners_total',  text: 'Will there be more than 8 corners in total?',     predicate: { resolution_type: 'match_stat',    match_id: String(m.id), binary_condition: { field: 'total_corners', operator: 'gt', value: 8 } } },
          { market: 'home_win',       text: `Will ${homeTeam} win the match?`,                 predicate: { resolution_type: 'match_outcome', match_id: String(m.id), binary_condition: { field: 'winner_team_id', operator: 'eq', value: homeId } } },
          { market: 'away_win',       text: `Will ${awayTeam} win the match?`,                 predicate: { resolution_type: 'match_outcome', match_id: String(m.id), binary_condition: { field: 'winner_team_id', operator: 'eq', value: awayId } } },
          { market: 'draw',           text: 'Will the match end in a draw?',                   predicate: { resolution_type: 'match_outcome', match_id: String(m.id), binary_condition: { field: 'draw', operator: 'eq', value: true } } },
        ];

        // Fresh fetch of all existing questions for this match (Phase A + B included).
        // Rebuilds market state so we don't duplicate markets introduced by AI generation.
        const { data: allExistingQs } = await sb
          .from('questions')
          .select('question_text, resolution_predicate, player_ids')
          .eq('league_id', league.id)
          .eq('match_id', String(m.id))
          .eq('question_type', 'CORE_MATCH_PREMATCH')
          .neq('resolution_status', 'voided');
        const fallbackState = buildMatchMarketState(allExistingQs ?? [], homeId, awayId);

        const computedVisibleFrom = computeVisibleFrom(league, kickoff);

        const toInsert = [];
        for (const tpl of ALL_FALLBACK_TEMPLATES) {
          if (toInsert.length >= remaining) break;

          // Skip if market already used (by AI questions or prior fallback runs)
          if (fallbackState.markets.has(tpl.market)) continue;

          // Skip winner markets in heavy-favourite matches
          if (
            matchGap !== null && matchGap >= 5 &&
            (tpl.market === 'home_win' || tpl.market === 'away_win')
          ) continue;

          // Skip exact text duplicates (idempotent re-run safety)
          if (fallbackState.texts.some(
            (t) => t.toLowerCase().trim() === tpl.text.toLowerCase().trim(),
          )) continue;

          toInsert.push({
            league_id:             league.id,
            source:                'fallback_template',
            generation_run_id:     runId,
            question_text:         tpl.text,
            type:                  'binary',
            options:               [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
            sport:                 league.sport,
            match_id:              String(m.id),
            team_ids:              [homeId, awayId].filter(Boolean),
            question_type:         'CORE_MATCH_PREMATCH',
            source_badge:          'PRE-MATCH',
            resolution_predicate:  tpl.predicate,
            resolution_status:     'pending',
            visible_from:          computedVisibleFrom,
            opens_at:              computedVisibleFrom,
            answer_closes_at:      kickoff,
            deadline:              kickoff,
            resolves_after:        kickoff,
            ai_prompt_version:     PROMPT_VERSION,
            base_value:            10,
            difficulty_multiplier: 1.0,
          });
          // Mark market used so subsequent templates in this loop don't collide
          fallbackState.markets.add(tpl.market);
        }

        if (toInsert.length > 0) {
          const { error: fbErr } = await sb.from('questions').insert(toInsert);
          if (fbErr) {
            console.warn(`[fallback] insert failed for league ${league.id} match ${m.id}:`, fbErr.message);
          } else {
            fallbackAttached += toInsert.length;
            matchShortfalls.set(String(m.id), Math.max(0, remaining - toInsert.length));
            console.log(`[fallback] inserted ${toInsert.length} template question(s) for league ${league.id} match ${m.id}`);
          }
        }

        // Log target_unmet if we could not reach the target without violating rules.
        // This is acceptable — quality takes precedence over count.
        const finalShortfall = matchShortfalls.get(String(m.id)) ?? 0;
        if (finalShortfall > 0) {
          const totalInserted = perMatchTarget - finalShortfall;
          console.warn(
            `[prematch] target_unmet league=${league.id} match=${m.id} inserted=${totalInserted} target=${perMatchTarget}`,
          );
        }
      }

      result.questionsGenerated = totalAttached + fallbackAttached;
      runStats.generated       += totalAttached + fallbackAttached;
      runStats.rejected        += result.questionsRejected;

      result.durationMs = Date.now() - leagueStart;
      await writeLeagueResult(sb, runId, result);
    }

    // ── Live generation pass ──────────────────────────────────────────
    // ── Soccer-only live question slot planner ──────────────────────────
    // Distributes N planned match-minute positions across a soccer match arc.
    // floor(N/2) slots pre-HT (minutes 10–40), ceil(N/2) post-HT (minutes 55–85).
    //
    // SOCCER-SPECIFIC: assumes a 90-min match with two halves and a halftime break.
    // Do NOT reuse for other sports — they require separate slot logic.
    //
    // Examples:
    //   budget 1  → [70]
    //   budget 6  → [10, 25, 40, 55, 70, 85]
    //   budget 10 → [10, 18, 25, 33, 40, 55, 63, 70, 78, 85]
    function computePlannedSlots(budget: number): number[] {
      const n = Math.max(1, Math.min(10, budget));
      const preCount  = Math.floor(n / 2);
      const postCount = Math.ceil(n / 2);

      function distributeEvenly(count: number, from: number, to: number): number[] {
        if (count === 0) return [];
        if (count === 1) return [Math.round((from + to) / 2)];
        return Array.from({ length: count }, (_, i) =>
          Math.round(from + i * (to - from) / (count - 1))
        );
      }

      return [
        ...distributeEvenly(preCount,  10, 40),
        ...distributeEvenly(postCount, 55, 85),
      ];
    }

    // Detect in_progress football matches and generate exactly 1 CORE_MATCH_LIVE
    // question per eligible league per match. Runs after the prematch loop.
    //
    // Unlike prematch, live questions:
    //   - Bypass the pool system (not reused across leagues)
    //   - Are always question_type = CORE_MATCH_LIVE
    //   - Use timing anchored to match minute (not kickoff offset)
    //   - Are rate-limited to 1 per 3 min (time-driven); event-driven bypasses this
    //   - Are skipped at ≥89 min or during HT
    //
    // Max active questions per league — matches maxActiveQuestions in context-builder.ts.
    const MVP_MAX_ACTIVE_LIVE = 3;

    for (const league of (leagues as LeagueWithConfig[])) {
      // MVP: football only
      if (league.sport !== 'football') continue;

      // Fetch in_progress fixtures for this league from cache
      let inProgressFixtures: any[];
      try {
        inProgressFixtures = await fetchInProgressFixturesFromCache(
          sb,
          league.api_sports_league_id,
          league.api_sports_team_id ?? undefined,
          (league.scope ?? 'full_league') as 'full_league' | 'team_specific',
        );
      } catch (err) {
        console.warn(`[live-gen] fixture fetch failed for league ${league.id}:`, err);
        continue;
      }

      if (!inProgressFixtures.length) continue;

      for (const fixture of inProgressFixtures) {
        const matchId   = String(fixture.fixture_id);
        const leagueStart = Date.now();

        const liveResult: LeagueRunResult = {
          leagueId:             league.id,
          sport:                league.sport,
          generationMode:       'live_gap' as GenerationMode,
          earliestMatchKickoff: fixture.kickoff_at,
          hoursUntilKickoff:    0,
          priorityScore:        4, // live always higher than IMMINENT (3)
          quotaTotal:           league.ai_total_quota,
          quotaUsedTotal:       0,
          quotaUsedThisWeek:    0,
          questionsRequested:   1,
          questionsGenerated:   0,
          questionsRejected:    0,
          rejectionLog:         [],
          skipped:              false,
          newsItemsFetched:     0,
          newsUnavailable:      true,
          newsSnapshot:         [],
          durationMs:           0,
        };

        // Explicit HT skip — no play happening during half-time break
        if (fixture.status_short === 'HT') {
          liveResult.skipped    = true;
          liveResult.skipReason = 'halftime_pause';
          runStats.leaguesSkipped++;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        // Build live context from live_match_stats + active questions
        let liveCtx;
        try {
          liveCtx = await buildLiveContext(sb, league.id, matchId, fixture);
        } catch (err) {
          console.warn(`[live-gen] buildLiveContext failed for league ${league.id} match ${matchId}:`, err);
          liveCtx = null;
        }

        if (!liveCtx) {
          liveResult.skipped    = true;
          liveResult.skipReason = 'no_live_stats_available';
          runStats.leaguesSkipped++;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        // Hard skip at ≥89 min — insufficient match time for a valid anchored window
        if (liveCtx.matchMinute >= 89) {
          liveResult.skipped    = true;
          liveResult.skipReason = 'match_minute_too_late';
          runStats.leaguesSkipped++;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        // Active question cap — enforce MVP max 2 per league
        if (liveCtx.activeQuestionCount >= MVP_MAX_ACTIVE_LIVE) {
          liveResult.skipped    = true;
          liveResult.skipReason = 'active_question_cap_reached';
          runStats.leaguesSkipped++;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        // ── Budget + slot enforcement (soccer live pacing) ───────────────
        // Fetch all CORE_MATCH_LIVE questions already generated for this
        // league+match in one query — used for budget, pre-HT quota, and slot
        // coverage checks below.
        const { data: generatedRows } = await sb
          .from('questions')
          .select('match_minute_at_generation')
          .eq('league_id', league.id)
          .eq('match_id', matchId)
          .eq('question_type', 'CORE_MATCH_LIVE');

        const generatedMinutes: number[] = (generatedRows ?? [])
          .map((r: any) => r.match_minute_at_generation as number | null)
          .filter((m): m is number => m != null);

        // Budget: live_questions_per_match (user-chosen) → legacy live_question_budget → 6
        const liveBudget = league.live_questions_per_match ?? league.live_question_budget ?? 6;

        if (generatedMinutes.length >= liveBudget) {
          liveResult.skipped    = true;
          liveResult.skipReason = 'live_budget_reached';
          runStats.leaguesSkipped++;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        // First-half quota: protect second-half pacing by capping pre-HT questions.
        // Events in the first half cannot consume more than floor(budget/2) slots.
        const preHtMax       = Math.floor(liveBudget / 2);
        const preHtGenerated = generatedMinutes.filter((m) => m < 45).length;
        if (liveCtx.matchMinute < 45 && preHtGenerated >= preHtMax) {
          liveResult.skipped    = true;
          liveResult.skipReason = 'pre_ht_quota_full';
          runStats.leaguesSkipped++;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        // Slot eligibility (time-driven only): only generate near a planned slot.
        // Event-driven questions bypass slot timing — they fire on new match events.
        // A slot is "covered" if a question was generated within ±5 min of it.
        // This also provides natural slot suppression after event questions:
        // an event at minute 38 covers the slot at minute 40 (|38-40|=2 ≤ 5).
        if (liveCtx.generationTrigger === 'time_driven') {
          const slots       = computePlannedSlots(liveBudget);
          const curMin      = liveCtx.matchMinute;
          const isCovered   = (slot: number) =>
            generatedMinutes.some((m) => Math.abs(m - slot) <= 5);
          const dueSlots    = slots.filter(
            (s) => !isCovered(s) && s >= curMin - 5,
          );

          const nextSlot = dueSlots[0] ?? null;
          if (nextSlot === null || Math.abs(curMin - nextSlot) > 2) {
            liveResult.skipped    = true;
            liveResult.skipReason = 'no_slot_due';
            runStats.leaguesSkipped++;
            await writeLeagueResult(sb, runId, liveResult);
            continue;
          }
        }

        // Rate limit: max 1 CORE_MATCH_LIVE per 3 min per league (time-driven only).
        // Event-driven questions bypass this limit.
        // Kept as a final safety net against double-firing within a slot window.
        if (liveCtx.generationTrigger === 'time_driven') {
          const rateLimitCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
          const { data: recentLiveQ } = await sb
            .from('questions')
            .select('id')
            .eq('league_id', league.id)
            .eq('question_type', 'CORE_MATCH_LIVE')
            .gte('created_at', rateLimitCutoff)
            .limit(1);

          if (recentLiveQ && recentLiveQ.length > 0) {
            liveResult.skipped    = true;
            liveResult.skipReason = 'rate_limit_3min_live';
            runStats.leaguesSkipped++;
            await writeLeagueResult(sb, runId, liveResult);
            continue;
          }
        }

        const generationMode: GenerationMode =
          liveCtx.generationTrigger === 'event_driven' ? 'live_event' : 'live_gap';
        liveResult.generationMode = generationMode;

        // Minimal SportsContext for context packet — just the live match
        const liveSportsCtx: SportsContext = {
          upcomingMatches: [{
            id:          matchId,
            sport:       'football',
            homeTeam:    { id: liveCtx.homeTeamId, name: liveCtx.homeTeamName },
            awayTeam:    { id: liveCtx.awayTeamId, name: liveCtx.awayTeamName },
            kickoff:     liveCtx.kickoff,
            competition: String(league.api_sports_league_id),
            status:      'in_progress',
          }],
          standings:          [],
          form:               [],
          keyPlayers:         [],
          narrativeHooks:     [],
          playerAvailability: [],
        };

        const liveCls: LeagueClassification = {
          league,
          classification:    'IMMINENT',
          priorityScore:     4,
          earliestKickoff:   liveCtx.kickoff,
          hoursUntilKickoff: 0,
          generationMode,
        };

        const recentQuestions = await getRecentQuestionTexts(sb, league.id, 5);

        // Summarise active windows for context
        const activeWindowsStr = liveCtx.activeWindows.length > 0
          ? liveCtx.activeWindows.map((w) => `${w.start}–${w.end}`).join(', ')
          : 'none';

        // Build context packet — live fields are populated here
        const baseContextPacket = buildContextPacket({
          league,
          classification:      liveCls,
          sportsCtx:           liveSportsCtx,
          newsItems:           [],
          recentQuestions,
          questionsToGenerate: 1,
          existingQuestionCount: liveCtx.activeQuestionCount,
          recentCategories:    [],
          recentStatFocus:     [],
          matchPhase:          liveCtx.matchPhase,
          lastEventType:       liveCtx.lastEventType,
          activeQuestionCount: liveCtx.activeQuestionCount,
          maxActiveQuestions:  MVP_MAX_ACTIVE_LIVE,
          matchMinute:         liveCtx.matchMinute,
        });

        // Append live score + active windows as a dedicated section
        const liveStateSuffix = [
          'LIVE MATCH STATE',
          '-----------------',
          `current_score: ${liveCtx.homeScore}–${liveCtx.awayScore} (home–away)`,
          `is_close_game: ${liveCtx.isCloseGame}`,
          `is_blowout: ${liveCtx.isBlowout}`,
          `generation_trigger: ${liveCtx.generationTrigger}`,
          `last_event_type: ${liveCtx.lastEventType}`,
          liveCtx.lastEventMinute != null
            ? `last_event_minute: ${liveCtx.lastEventMinute}`
            : 'last_event_minute: null',
          `active_prediction_windows: [${activeWindowsStr}]`,
        ].join('\n');

        const fullContextPacket = baseContextPacket + '\n\n' + liveStateSuffix;

        // ── Generate exactly 1 LIVE question ───────────────────────────
        runStats.leaguesProcessed++;
        let rawQuestions;
        try {
          rawQuestions = await generateQuestions(fullContextPacket, OPENAI_API_KEY);
        } catch (err) {
          liveResult.rejectionLog.push({
            attempt: 1, stage: 'question_generation', error: String(err),
          });
          liveResult.questionsRejected++;
          liveResult.durationMs = Date.now() - leagueStart;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        if (!rawQuestions.length) {
          liveResult.skipped    = true;
          liveResult.skipReason = 'no_questions_generated';
          liveResult.durationMs = Date.now() - leagueStart;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        // Take only the first question — live generation always produces exactly 1
        const raw = rawQuestions[0];

        // Fill system-computed fields
        raw.event_type             = CATEGORY_EVENT_TYPE[raw.question_category] ?? 'time_window';
        raw.narrative_context      = raw.reasoning_short ?? '';
        raw.resolution_rule_text   = raw.predicate_hint  ?? '';
        raw.match_minute_at_generation = liveCtx.matchMinute;
        raw.match_id               = matchId;
        raw.team_ids               = [liveCtx.homeTeamId, liveCtx.awayTeamId];
        raw.player_ids             = [];

        // Live timing — visible_from: delayed by broadcast lag buffer
        const isEventDriven     = liveCtx.generationTrigger === 'event_driven';
        const visibleDelayMs    = (isEventDriven ? 45 : 20) * 1000;
        raw.visible_from        = new Date(Date.now() + visibleDelayMs).toISOString();
        raw.opens_at            = raw.visible_from;

        // Default answer_closes_at: visible_from + 3 minutes
        // Overridden below if the predicate is match_stat_window
        raw.answer_closes_at    = new Date(Date.now() + visibleDelayMs + 3 * 60 * 1000).toISOString();
        raw.deadline            = raw.answer_closes_at;

        // resolves_after: after match ends (kickoff + sport buffer)
        raw.resolves_after      = computeResolvesAfter(liveCtx.kickoff, league.sport);

        // ── Convert predicate_hint → structured predicate (Call 2) ─────
        let predicate;
        try {
          const predicatePrompt = buildPredicatePrompt({
            questionText:       raw.question_text,
            type:               raw.type,
            options:            raw.options,
            resolutionRuleText: raw.predicate_hint ?? '',
            matches:            liveSportsCtx.upcomingMatches,
            players:            [],
            sport:              league.sport,
          });
          predicate = await convertToPredicate(predicatePrompt, OPENAI_API_KEY);
        } catch (err) {
          liveResult.rejectionLog.push({
            attempt: 1, stage: 'predicate_parse',
            question_text: raw.question_text, error: String(err),
          });
          liveResult.questionsRejected++;
          liveResult.durationMs = Date.now() - leagueStart;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        // For match_stat_window: compute timing from window minutes
        const predAny = predicate as any;
        if (
          predAny.resolution_type === 'match_stat_window' &&
          predAny.window_start_minute != null &&
          predAny.window_end_minute   != null
        ) {
          // answer_closes_at = real clock time at window_start_minute
          // (user must answer BEFORE the prediction window opens)
          raw.answer_closes_at = minuteToTimestamp(liveCtx.kickoff, predAny.window_start_minute);
          raw.deadline         = raw.answer_closes_at;
          raw.window_start_minute = predAny.window_start_minute;
          raw.window_end_minute   = predAny.window_end_minute;
          // resolves_after = clock time at window_end_minute + settle buffer
          const settleMs = (isEventDriven ? 120 : 90) * 1000;
          raw.resolves_after = new Date(
            new Date(minuteToTimestamp(liveCtx.kickoff, predAny.window_end_minute)).getTime() + settleMs,
          ).toISOString();
        }

        // player_ids from predicate if present
        raw.player_ids = predAny.player_id ? [String(predAny.player_id)] : [];

        // ── Validate ───────────────────────────────────────────────────
        const rejection = validateQuestion(raw, predicate, liveSportsCtx, league, 1);
        if (rejection) {
          liveResult.rejectionLog.push(rejection);
          liveResult.questionsRejected++;
          liveResult.durationMs = Date.now() - leagueStart;
          await writeLeagueResult(sb, runId, liveResult);
          continue;
        }

        const baseValue = (raw.base_value && raw.base_value > 0)
          ? raw.base_value
          : (CATEGORY_BASE_VALUE[raw.question_category] ?? 6);

        // ── Insert directly into questions (no pool for live) ──────────
        const liveQuestion: ValidatedQuestion = {
          league_id:                  league.id,
          source:                     'ai_generated',
          generation_run_id:          runId,
          question_text:              raw.question_text,
          type:                       raw.type,
          options:                    raw.options ?? null,
          sport:                      league.sport,
          match_id:                   matchId,
          team_ids:                   raw.team_ids,
          player_ids:                 raw.player_ids,
          event_type:                 raw.event_type,
          narrative_context:          raw.narrative_context,
          opens_at:                   raw.opens_at,
          deadline:                   raw.deadline,
          resolves_after:             raw.resolves_after,
          resolution_rule_text:       raw.resolution_rule_text,
          resolution_predicate:       predicate,
          resolution_status:          'pending',
          ai_model:                   'gpt-4o-mini',
          ai_prompt_version:          PROMPT_VERSION,
          question_type:              'CORE_MATCH_LIVE',
          source_badge:               'LIVE',
          base_value:                 baseValue,
          difficulty_multiplier:      raw.difficulty_multiplier ?? 1.0,
          reuse_scope:                'live_safe',
          visible_from:               raw.visible_from,
          answer_closes_at:           raw.answer_closes_at,
          match_minute_at_generation: liveCtx.matchMinute,
          generation_trigger:         liveCtx.generationTrigger,
          // Snapshot of match state at generation time — used by resolver
          // for clutch answer detection (migration 032).
          clutch_context: {
            match_minute_at_generation:  liveCtx.matchMinute,
            home_goals_at_generation:    liveCtx.homeScore,
            away_goals_at_generation:    liveCtx.awayScore,
            session_scope:               'full_match',
          },
        };

        const { error: insertErr } = await sb.from('questions').insert(liveQuestion);
        if (insertErr) {
          console.error(`[live-gen] insert failed for league ${league.id}:`, insertErr.message);
          liveResult.questionsRejected++;
        } else {
          liveResult.questionsGenerated = 1;
          runStats.generated++;
          console.log(
            `[live-gen] CORE_MATCH_LIVE generated for league ${league.id} ` +
            `(match ${matchId}, minute=${liveCtx.matchMinute}, trigger=${liveCtx.generationTrigger})`,
          );
        }

        liveResult.durationMs = Date.now() - leagueStart;
        await writeLeagueResult(sb, runId, liveResult);
      }
    }

    // ── Arena session live generation pass ────────────────────────────
    // Runs for active arena_sessions (Live Multiplayer games).
    // Mirrors the league live loop but uses arena_session_id instead of league_id.
    // Questions go directly into `questions.arena_session_id` with no league_id.
    {
      // Fetch all active arena sessions
      const { data: activeSessions } = await sb
        .from('arena_sessions')
        .select('id, match_id, half_scope, mode, kickoff_at, api_league_id')
        .eq('status', 'active');

      if (activeSessions && activeSessions.length > 0) {
        // Get the set of currently live fixture IDs so we can cross-reference
        const { data: liveFixtures } = await sb
          .from('live_match_stats')
          .select('fixture_id, status, minute, home_score, away_score, home_team_id, away_team_id, kickoff_at')
          .in('status', ['1H', '2H', 'ET']);

        const liveFixtureMap = new Map<string, any>();
        for (const f of liveFixtures ?? []) {
          liveFixtureMap.set(String(f.fixture_id), f);
        }

        for (const session of activeSessions) {
          const sessionMatchId = String(session.match_id);
          const fixture = liveFixtureMap.get(sessionMatchId);

          // Skip if the match isn't currently live in the poller cache
          if (!fixture) continue;
          if (fixture.status === 'HT') continue;

          // Build live context scoped to this arena session
          let sessionLiveCtx;
          try {
            sessionLiveCtx = await buildLiveContext(sb, '', sessionMatchId, fixture, session.id);
          } catch (err) {
            console.warn(`[arena-gen] buildLiveContext failed for session ${session.id}:`, err);
            continue;
          }

          if (!sessionLiveCtx) continue;
          if (sessionLiveCtx.matchMinute >= 89) continue;
          if (sessionLiveCtx.activeQuestionCount >= MVP_MAX_ACTIVE_LIVE) continue;
          // TODO: enforce arena density per half_scope with session question counters in future sprint

          // Rate limit for time-driven (event-driven bypasses)
          if (sessionLiveCtx.generationTrigger === 'time_driven') {
            const rateLimitCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
            const { data: recentLiveQ } = await sb
              .from('questions')
              .select('id')
              .eq('arena_session_id', session.id)
              .eq('question_type', 'CORE_MATCH_LIVE')
              .gte('created_at', rateLimitCutoff)
              .limit(1);

            if (recentLiveQ && recentLiveQ.length > 0) continue;
          }

          // Fetch player count for arena context (best-effort — defaults to 2 on error)
          const { count: arenaPlayerCount } = await sb
            .from('arena_session_players')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', session.id);

          const generationMode: GenerationMode =
            sessionLiveCtx.generationTrigger === 'event_driven' ? 'live_event' : 'live_gap';

          const sessionSportsCtx: SportsContext = {
            upcomingMatches: [{
              id:          sessionMatchId,
              sport:       'football',
              homeTeam:    { id: sessionLiveCtx.homeTeamId, name: sessionLiveCtx.homeTeamName },
              awayTeam:    { id: sessionLiveCtx.awayTeamId, name: sessionLiveCtx.awayTeamName },
              kickoff:     sessionLiveCtx.kickoff,
              competition: String(session.api_league_id ?? ''),
              status:      'in_progress',
            }],
            standings:          [],
            form:               [],
            keyPlayers:         [],
            narrativeHooks:     [],
            playerAvailability: [],
          };

          // Use a minimal league-like object for buildContextPacket
          const fakeLeague: LeagueWithConfig = {
            id:                    session.id,
            name:                  `Arena Session ${session.id.slice(0, 8)}`,
            sport:                 'football',
            scope:                 'full_league',
            scoped_team_id:        null,
            scoped_team_name:      null,
            api_sports_league_id:  session.api_league_id ?? null,
            api_sports_team_id:    null,
            api_sports_season:     null,
            ai_weekly_quota:       -1,
            ai_total_quota:        -1,
            league_start_date:     null,
            league_end_date:       null,
            owner_id:              null,
            prematch_question_budget: 0,
            live_question_budget:  20,
            prematch_generation_mode: 'automatic',
            prematch_publish_offset_hours: 24,
            created_at:            null,
          } as any;

          const sessionCls: LeagueClassification = {
            league:            fakeLeague,
            classification:    'IMMINENT',
            priorityScore:     5, // arena sessions get highest priority
            earliestKickoff:   sessionLiveCtx.kickoff,
            hoursUntilKickoff: 0,
            generationMode,
          };

          const activeWindowsStr = sessionLiveCtx.activeWindows.length > 0
            ? sessionLiveCtx.activeWindows.map((w) => `${w.start}–${w.end}`).join(', ')
            : 'none';

          const arenaGameContext = {
            source:             'arena_session' as const,
            arenaSessionId:     session.id,
            mode:               session.mode      as string,
            halfScope:          (session.half_scope ?? 'full_match') as string,
            playerCount:        arenaPlayerCount ?? 2,
            competitive_format: true,
          };

          const baseContextPacket = buildContextPacket({
            league:              fakeLeague,
            classification:      sessionCls,
            sportsCtx:           sessionSportsCtx,
            newsItems:           [],
            recentQuestions:     [],
            questionsToGenerate: 1,
            existingQuestionCount: sessionLiveCtx.activeQuestionCount,
            recentCategories:    [],
            recentStatFocus:     [],
            matchPhase:          sessionLiveCtx.matchPhase,
            lastEventType:       sessionLiveCtx.lastEventType,
            activeQuestionCount: sessionLiveCtx.activeQuestionCount,
            maxActiveQuestions:  MVP_MAX_ACTIVE_LIVE,
            matchMinute:         sessionLiveCtx.matchMinute,
            gameContext:         arenaGameContext,
          });

          const liveStateSuffix = [
            'LIVE MATCH STATE',
            '-----------------',
            `current_score: ${sessionLiveCtx.homeScore}–${sessionLiveCtx.awayScore} (home–away)`,
            `is_close_game: ${sessionLiveCtx.isCloseGame}`,
            `is_blowout: ${sessionLiveCtx.isBlowout}`,
            `generation_trigger: ${sessionLiveCtx.generationTrigger}`,
            `last_event_type: ${sessionLiveCtx.lastEventType}`,
            sessionLiveCtx.lastEventMinute != null
              ? `last_event_minute: ${sessionLiveCtx.lastEventMinute}`
              : 'last_event_minute: null',
            `active_prediction_windows: [${activeWindowsStr}]`,
          ].join('\n');

          const fullContextPacket = baseContextPacket + '\n\n' + liveStateSuffix;

          let rawQuestions;
          try {
            rawQuestions = await generateQuestions(fullContextPacket, OPENAI_API_KEY);
          } catch (err) {
            console.warn(`[arena-gen] generateQuestions failed for session ${session.id}:`, err);
            continue;
          }

          if (!rawQuestions.length) continue;

          const raw = rawQuestions[0];

          raw.event_type                = CATEGORY_EVENT_TYPE[raw.question_category] ?? 'time_window';
          raw.narrative_context         = raw.reasoning_short ?? '';
          raw.resolution_rule_text      = raw.predicate_hint  ?? '';
          raw.match_minute_at_generation = sessionLiveCtx.matchMinute;
          raw.match_id                  = sessionMatchId;
          raw.team_ids                  = [sessionLiveCtx.homeTeamId, sessionLiveCtx.awayTeamId];
          raw.player_ids                = [];

          const isEventDriven   = sessionLiveCtx.generationTrigger === 'event_driven';
          const visibleDelayMs  = (isEventDriven ? 45 : 20) * 1000;
          raw.visible_from      = new Date(Date.now() + visibleDelayMs).toISOString();
          raw.opens_at          = raw.visible_from;

          // Arena-specific answer windows: shorter than league defaults.
          // Clutch threshold mirrors isClutchAnswer() in clutch-detector.ts.
          const arenaHalfScope    = (session.half_scope ?? 'full_match') as string;
          const clutchMinute      = arenaHalfScope === 'first_half' ? 35 : 80;
          const isArenaClutch     = sessionLiveCtx.matchMinute != null &&
                                    sessionLiveCtx.matchMinute >= clutchMinute;
          const answerWindowMs    = isArenaClutch
            ? (isEventDriven ? 90 : 60) * 1000    // 60–90s in clutch window
            : (isEventDriven ? 120 : 90) * 1000;  // 90s time-driven, 120s event-driven

          raw.answer_closes_at  = new Date(Date.now() + visibleDelayMs + answerWindowMs).toISOString();
          raw.deadline          = raw.answer_closes_at;
          raw.resolves_after    = computeResolvesAfter(sessionLiveCtx.kickoff, 'football');

          let sessionPredicate;
          try {
            const predicatePrompt = buildPredicatePrompt({
              questionText:       raw.question_text,
              type:               raw.type,
              options:            raw.options,
              resolutionRuleText: raw.predicate_hint ?? '',
              matches:            sessionSportsCtx.upcomingMatches,
              players:            [],
              sport:              'football',
            });
            sessionPredicate = await convertToPredicate(predicatePrompt, OPENAI_API_KEY);
          } catch (err) {
            console.warn(`[arena-gen] convertToPredicate failed for session ${session.id}:`, err);
            continue;
          }

          const predAny = sessionPredicate as any;
          if (
            predAny.resolution_type === 'match_stat_window' &&
            predAny.window_start_minute != null &&
            predAny.window_end_minute   != null
          ) {
            raw.answer_closes_at = minuteToTimestamp(sessionLiveCtx.kickoff, predAny.window_start_minute);
            raw.deadline         = raw.answer_closes_at;
            raw.window_start_minute = predAny.window_start_minute;
            raw.window_end_minute   = predAny.window_end_minute;
            const settleMs = (isEventDriven ? 120 : 90) * 1000;
            raw.resolves_after = new Date(
              new Date(minuteToTimestamp(sessionLiveCtx.kickoff, predAny.window_end_minute)).getTime() + settleMs,
            ).toISOString();
          }

          raw.player_ids = predAny.player_id ? [String(predAny.player_id)] : [];

          const sessionRejection = validateQuestion(raw, sessionPredicate, sessionSportsCtx, fakeLeague, 1);
          if (sessionRejection) {
            console.log(`[arena-gen] question rejected for session ${session.id}: ${sessionRejection.stage}`);
            continue;
          }

          const baseValue = (raw.base_value && raw.base_value > 0)
            ? raw.base_value
            : (CATEGORY_BASE_VALUE[raw.question_category] ?? 6);

          const arenaQuestion: ValidatedQuestion = {
            arena_session_id:           session.id,
            // league_id intentionally omitted — CHECK constraint requires exactly one owner
            source:                     'ai_generated',
            generation_run_id:          runId,
            question_text:              raw.question_text,
            type:                       raw.type,
            options:                    raw.options ?? null,
            sport:                      'football',
            match_id:                   sessionMatchId,
            team_ids:                   raw.team_ids,
            player_ids:                 raw.player_ids,
            event_type:                 raw.event_type,
            narrative_context:          raw.narrative_context,
            opens_at:                   raw.opens_at,
            deadline:                   raw.deadline,
            resolves_after:             raw.resolves_after,
            resolution_rule_text:       raw.resolution_rule_text,
            resolution_predicate:       sessionPredicate,
            resolution_status:          'pending',
            ai_model:                   'gpt-4o-mini',
            ai_prompt_version:          PROMPT_VERSION,
            question_type:              'CORE_MATCH_LIVE',
            source_badge:               'LIVE',
            base_value:                 baseValue,
            difficulty_multiplier:      getLiveDifficultyMultiplier(raw, sessionPredicate, sessionLiveCtx),
            reuse_scope:                'live_safe',
            visible_from:               raw.visible_from,
            answer_closes_at:           raw.answer_closes_at,
            match_minute_at_generation: sessionLiveCtx.matchMinute,
            generation_trigger:         sessionLiveCtx.generationTrigger,
            clutch_context: {
              match_minute_at_generation: sessionLiveCtx.matchMinute,
              home_goals_at_generation:   sessionLiveCtx.homeScore,
              away_goals_at_generation:   sessionLiveCtx.awayScore,
              session_scope:              (session.half_scope as any) ?? 'full_match',
            },
          } as any;

          const { error: arenaInsertErr } = await sb.from('questions').insert(arenaQuestion);
          if (arenaInsertErr) {
            console.error(`[arena-gen] insert failed for session ${session.id}:`, arenaInsertErr.message);
          } else {
            runStats.generated++;
            console.log(
              `[arena-gen] CORE_MATCH_LIVE generated for arena session ${session.id} ` +
              `(match ${sessionMatchId}, minute=${sessionLiveCtx.matchMinute}, trigger=${sessionLiveCtx.generationTrigger})`,
            );
          }
        }
      }
    }

    // ── BR session live generation pass ──────────────────────────────
    // Runs for active br_sessions (Battle Royale games).
    // Mirrors the arena session live loop but uses br_session_id and
    // question_type: 'BR_MATCH_LIVE'. BR sessions have no half_scope;
    // questions are always generated for the full match context.
    // Skipped when liveOnly is false (only runs during live-stats-poller trigger
    // and the regular cron cycle — same as arena pass).
    {
      const { data: activeBrSessions } = await sb
        .from('br_sessions')
        .select('id, match_id, api_league_id, started_at')
        .eq('status', 'active');

      if (activeBrSessions && activeBrSessions.length > 0) {
        const { data: liveFixturesBr } = await sb
          .from('live_match_stats')
          .select('fixture_id, status, minute, home_score, away_score, home_team_id, away_team_id, kickoff_at')
          .in('status', ['1H', '2H', 'ET']);

        const liveFixtureMapBr = new Map<string, any>();
        for (const f of liveFixturesBr ?? []) {
          liveFixtureMapBr.set(String(f.fixture_id), f);
        }

        for (const brSession of activeBrSessions) {
          const brMatchId = String(brSession.match_id);
          const brFixture = liveFixtureMapBr.get(brMatchId);

          // Skip if match isn't currently live in the poller cache
          if (!brFixture) continue;
          if (brFixture.status === 'HT') {
            console.log(`[br-gen] skipping session ${brSession.id}: halftime_pause`);
            continue;
          }

          // Build live context scoped to this BR session
          let brLiveCtx;
          try {
            brLiveCtx = await buildLiveContext(sb, '', brMatchId, brFixture, undefined);
          } catch (err) {
            console.warn(`[br-gen] buildLiveContext failed for session ${brSession.id}:`, err);
            continue;
          }

          if (!brLiveCtx) {
            console.log(`[br-gen] skipping session ${brSession.id}: no_live_stats_available`);
            continue;
          }
          if (brLiveCtx.matchMinute >= 89) {
            console.log(`[br-gen] skipping session ${brSession.id}: match_minute_too_late (${brLiveCtx.matchMinute})`);
            continue;
          }
          if (brLiveCtx.activeQuestionCount >= MVP_MAX_ACTIVE_LIVE) {
            // activeQuestionCount counts arena questions — for BR, count separately
            const { count: brActiveCount } = await sb
              .from('questions')
              .select('*', { count: 'exact', head: true })
              .eq('br_session_id', brSession.id)
              .eq('resolution_status', 'pending')
              .gt('answer_closes_at', new Date().toISOString());

            if ((brActiveCount ?? 0) >= MVP_MAX_ACTIVE_LIVE) {
              console.log(`[br-gen] skipping session ${brSession.id}: active_question_cap_reached (${brActiveCount})`);
              continue;
            }
          }

          // Rate limit for time-driven (event-driven bypasses)
          if (brLiveCtx.generationTrigger === 'time_driven') {
            const brRateLimitCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
            const { data: recentBrQ } = await sb
              .from('questions')
              .select('id')
              .eq('br_session_id', brSession.id)
              .eq('question_type', 'BR_MATCH_LIVE')
              .gte('created_at', brRateLimitCutoff)
              .limit(1);

            if (recentBrQ && recentBrQ.length > 0) {
              console.log(`[br-gen] skipping session ${brSession.id}: rate_limit_3min_live`);
              continue;
            }
          }

          // Count alive players for context
          const { count: brAliveCount } = await sb
            .from('br_session_players')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', brSession.id)
            .eq('is_eliminated', false);

          const brGenerationMode: GenerationMode =
            brLiveCtx.generationTrigger === 'event_driven' ? 'live_event' : 'live_gap';

          const brSportsCtx: SportsContext = {
            upcomingMatches: [{
              id:          brMatchId,
              sport:       'football',
              homeTeam:    { id: brLiveCtx.homeTeamId, name: brLiveCtx.homeTeamName },
              awayTeam:    { id: brLiveCtx.awayTeamId, name: brLiveCtx.awayTeamName },
              kickoff:     brLiveCtx.kickoff,
              competition: String(brSession.api_league_id ?? ''),
              status:      'in_progress',
            }],
            standings:          [],
            form:               [],
            keyPlayers:         [],
            narrativeHooks:     [],
            playerAvailability: [],
          };

          const brFakeLeague: LeagueWithConfig = {
            id:                    brSession.id,
            name:                  `BR Session ${brSession.id.slice(0, 8)}`,
            sport:                 'football',
            scope:                 'full_league',
            scoped_team_id:        null,
            scoped_team_name:      null,
            api_sports_league_id:  brSession.api_league_id ?? null,
            api_sports_team_id:    null,
            api_sports_season:     null,
            ai_weekly_quota:       -1,
            ai_total_quota:        -1,
            league_start_date:     null,
            league_end_date:       null,
            owner_id:              null,
            prematch_question_budget: 0,
            live_question_budget:  20,
            prematch_generation_mode: 'automatic',
            prematch_publish_offset_hours: 24,
            created_at:            null,
          } as any;

          const brSessionCls: LeagueClassification = {
            league:            brFakeLeague,
            classification:    'IMMINENT',
            priorityScore:     5,
            earliestKickoff:   brLiveCtx.kickoff,
            hoursUntilKickoff: 0,
            generationMode:    brGenerationMode,
          };

          const brActiveWindowsStr = brLiveCtx.activeWindows.length > 0
            ? brLiveCtx.activeWindows.map((w) => `${w.start}–${w.end}`).join(', ')
            : 'none';

          const brGameContext = {
            source:             'br_session' as const,
            brSessionId:        brSession.id,
            mode:               'battle_royale',
            halfScope:          'full_match',
            playerCount:        brAliveCount ?? 2,
            competitive_format: true,
          };

          const brBaseContextPacket = buildContextPacket({
            league:              brFakeLeague,
            classification:      brSessionCls,
            sportsCtx:           brSportsCtx,
            newsItems:           [],
            recentQuestions:     [],
            questionsToGenerate: 1,
            existingQuestionCount: brLiveCtx.activeQuestionCount,
            recentCategories:    [],
            recentStatFocus:     [],
            matchPhase:          brLiveCtx.matchPhase,
            lastEventType:       brLiveCtx.lastEventType,
            activeQuestionCount: brLiveCtx.activeQuestionCount,
            maxActiveQuestions:  MVP_MAX_ACTIVE_LIVE,
            matchMinute:         brLiveCtx.matchMinute,
            gameContext:         brGameContext,
          });

          const brLiveStateSuffix = [
            'LIVE MATCH STATE',
            '-----------------',
            `current_score: ${brLiveCtx.homeScore}–${brLiveCtx.awayScore} (home–away)`,
            `is_close_game: ${brLiveCtx.isCloseGame}`,
            `is_blowout: ${brLiveCtx.isBlowout}`,
            `generation_trigger: ${brLiveCtx.generationTrigger}`,
            `last_event_type: ${brLiveCtx.lastEventType}`,
            brLiveCtx.lastEventMinute != null
              ? `last_event_minute: ${brLiveCtx.lastEventMinute}`
              : 'last_event_minute: null',
            `active_prediction_windows: [${brActiveWindowsStr}]`,
            `alive_players: ${brAliveCount ?? 'unknown'}`,
          ].join('\n');

          const brFullContextPacket = brBaseContextPacket + '\n\n' + brLiveStateSuffix;

          let brRawQuestions;
          try {
            brRawQuestions = await generateQuestions(brFullContextPacket, OPENAI_API_KEY);
          } catch (err) {
            console.warn(`[br-gen] generateQuestions failed for session ${brSession.id}:`, err);
            continue;
          }

          if (!brRawQuestions.length) continue;

          const brRaw = brRawQuestions[0];

          brRaw.event_type                = CATEGORY_EVENT_TYPE[brRaw.question_category] ?? 'time_window';
          brRaw.narrative_context         = brRaw.reasoning_short ?? '';
          brRaw.resolution_rule_text      = brRaw.predicate_hint  ?? '';
          brRaw.match_minute_at_generation = brLiveCtx.matchMinute;
          brRaw.match_id                  = brMatchId;
          brRaw.team_ids                  = [brLiveCtx.homeTeamId, brLiveCtx.awayTeamId];
          brRaw.player_ids                = [];

          const brIsEventDriven  = brLiveCtx.generationTrigger === 'event_driven';
          const brVisibleDelayMs = (brIsEventDriven ? 45 : 20) * 1000;
          brRaw.visible_from     = new Date(Date.now() + brVisibleDelayMs).toISOString();
          brRaw.opens_at         = brRaw.visible_from;

          // BR sessions always span full_match — use standard clutch threshold (minute >= 80)
          const isBrClutch      = brLiveCtx.matchMinute != null && brLiveCtx.matchMinute >= 80;
          const brAnswerWindowMs = isBrClutch
            ? (brIsEventDriven ? 90 : 60) * 1000
            : (brIsEventDriven ? 120 : 90) * 1000;

          brRaw.answer_closes_at = new Date(Date.now() + brVisibleDelayMs + brAnswerWindowMs).toISOString();
          brRaw.deadline         = brRaw.answer_closes_at;
          brRaw.resolves_after   = computeResolvesAfter(brLiveCtx.kickoff, 'football');

          let brPredicate;
          try {
            const brPredicatePrompt = buildPredicatePrompt({
              questionText:       brRaw.question_text,
              type:               brRaw.type,
              options:            brRaw.options,
              resolutionRuleText: brRaw.predicate_hint ?? '',
              matches:            brSportsCtx.upcomingMatches,
              players:            [],
              sport:              'football',
            });
            brPredicate = await convertToPredicate(brPredicatePrompt, OPENAI_API_KEY);
          } catch (err) {
            console.warn(`[br-gen] convertToPredicate failed for session ${brSession.id}:`, err);
            continue;
          }

          const brPredAny = brPredicate as any;
          if (
            brPredAny.resolution_type === 'match_stat_window' &&
            brPredAny.window_start_minute != null &&
            brPredAny.window_end_minute   != null
          ) {
            brRaw.answer_closes_at  = minuteToTimestamp(brLiveCtx.kickoff, brPredAny.window_start_minute);
            brRaw.deadline          = brRaw.answer_closes_at;
            brRaw.window_start_minute = brPredAny.window_start_minute;
            brRaw.window_end_minute   = brPredAny.window_end_minute;
            const brSettleMs = (brIsEventDriven ? 120 : 90) * 1000;
            brRaw.resolves_after = new Date(
              new Date(minuteToTimestamp(brLiveCtx.kickoff, brPredAny.window_end_minute)).getTime() + brSettleMs,
            ).toISOString();
          }

          brRaw.player_ids = brPredAny.player_id ? [String(brPredAny.player_id)] : [];

          const brRejection = validateQuestion(brRaw, brPredicate, brSportsCtx, brFakeLeague, 1);
          if (brRejection) {
            console.log(`[br-gen] question rejected for session ${brSession.id}: ${brRejection.stage}`);
            continue;
          }

          const brBaseValue = (brRaw.base_value && brRaw.base_value > 0)
            ? brRaw.base_value
            : (CATEGORY_BASE_VALUE[brRaw.question_category] ?? 6);

          const brQuestion: ValidatedQuestion = {
            br_session_id:              brSession.id,
            // league_id and arena_session_id intentionally omitted —
            // CHECK constraint requires exactly one of the three owner columns.
            source:                     'ai_generated',
            generation_run_id:          runId,
            question_text:              brRaw.question_text,
            type:                       brRaw.type,
            options:                    brRaw.options ?? null,
            sport:                      'football',
            match_id:                   brMatchId,
            team_ids:                   brRaw.team_ids,
            player_ids:                 brRaw.player_ids,
            event_type:                 brRaw.event_type,
            narrative_context:          brRaw.narrative_context,
            opens_at:                   brRaw.opens_at,
            deadline:                   brRaw.deadline,
            resolves_after:             brRaw.resolves_after,
            resolution_rule_text:       brRaw.resolution_rule_text,
            resolution_predicate:       brPredicate,
            resolution_status:          'pending',
            ai_model:                   'gpt-4o-mini',
            ai_prompt_version:          PROMPT_VERSION,
            question_type:              'BR_MATCH_LIVE',
            source_badge:               'LIVE',
            base_value:                 brBaseValue,
            difficulty_multiplier:      getLiveDifficultyMultiplier(brRaw, brPredicate, brLiveCtx),
            reuse_scope:                'live_safe',
            visible_from:               brRaw.visible_from,
            answer_closes_at:           brRaw.answer_closes_at,
            match_minute_at_generation: brLiveCtx.matchMinute,
            generation_trigger:         brLiveCtx.generationTrigger,
            clutch_context: {
              match_minute_at_generation: brLiveCtx.matchMinute,
              home_goals_at_generation:   brLiveCtx.homeScore,
              away_goals_at_generation:   brLiveCtx.awayScore,
              session_scope:              'full_match',
            },
          } as any;

          const { error: brInsertErr } = await sb.from('questions').insert(brQuestion);
          if (brInsertErr) {
            console.error(`[br-gen] insert failed for session ${brSession.id}:`, brInsertErr.message);
          } else {
            runStats.generated++;
            console.log(
              `[br-gen] BR_MATCH_LIVE generated for br session ${brSession.id} ` +
              `(match ${brMatchId}, minute=${brLiveCtx.matchMinute}, trigger=${brLiveCtx.generationTrigger})`,
            );
          }
        }
      }
    }

    // ── REAL_WORLD generation pass ────────────────────────────────────
    // Skipped when live_only=1 (called from live-stats-poller every minute).
    // Runs after prematch and live passes. One REAL_WORLD question per
    // league per day (enforced by checkRealWorldQuota). Questions are
    // generated from news signals via a 4-call pipeline:
    //   Call 1 (generateRealWorldQuestion) — question + resolution metadata
    //   Call 2 (convertToPredicate)        — structured resolution predicate
    //   Call 3 (generateRealWorldContext)  — user-facing "why this exists" snippet
    //   Call 4 (scoreRealWorldQuestion)    — quality gate: APPROVE / WEAK / REJECT
    //
    // Unlike prematch/live, REAL_WORLD:
    //   - REQUIRES a match_id bound to a 48h target match (hard constraint)
    //   - Uses resolution_deadline (not resolves_after from match) for voiding
    //   - Is never pooled — always league-specific
    //   - Requires confidence_level, entity_focus, rw_context, source_news_urls

    // MAX_RW_RETRIES controls how many ranked news batches to try per league.
    // Items returned from the news adapter are sorted by finalScore DESC (highest quality
    // articles first). Splitting into up to 3 chunks gives each attempt a progressively
    // lower-quality news slice — the first attempt gets the strongest signals.
    const MAX_RW_RETRIES = 3;

    if (!liveOnly) for (const league of (leagues as LeagueWithConfig[])) {
      // Football only (same MVP guard as other passes)
      if (league.sport !== 'football') continue;

      // solo_match leagues block REAL_WORLD — it's a personal match session,
      // not a community intelligence layer.
      if ((league as any).session_type === 'solo_match') continue;

      // Per-league APPROVE counter for WEAK fairness.
      // WEAK questions (score 65–79) are only published when no APPROVE was generated
      // for THIS league in this run. The counter is reset for every league so each
      // league is evaluated independently — using the global runStats.generated would
      // incorrectly penalise leagues that ran later in the same cycle.
      let rwLeagueApproved = 0;

      // ── REAL_WORLD quota check ────────────────────────────────────────
      const ownerTierRW = ownerTierMap.get(league.owner_id ?? '') ?? 'starter';
      const rwQ = await checkRealWorldQuota(sb, league.id, ownerTierRW);
      if (!rwQ.allowed) {
        continue;
      }

      // ── Fetch news context (REAL_WORLD lives and dies by news signal) ─
      let sportsCtxRW: SportsContext;
      try {
        sportsCtxRW = await fetchSportsContext(league, API_SPORTS_KEY, sb);
      } catch {
        continue;
      }

      // ── Fetch top players for PLAYER BOOST query ──────────────────────
      // Reads from team_players table (auto-populated by live-stats-poller).
      // Provides up to 15 player names from both upcoming match teams,
      // sorted by relevance_score DESC. Players not seen in >90 days excluded.
      // Enables a third RSS query targeting specific player names — surfaces
      // injury/availability/form news that broad queries often miss.
      // rwTopPlayers: names only — used for the PLAYER BOOST RSS news query.
      // rwKnownPlayersForCall1: { id, name } objects — passed to Call 1 so the model
      //   can embed player_id in the predicate_hint for fit (non-injured) players.
      //   Previously, known_players came only from sportsCtxRW.keyPlayers (injury/fitness
      //   list, ~5–15 players). A news story about a fully fit squad player (TYPE 2/3)
      //   produced no player_id in the hint → Call 2 couldn't build a valid player_stat
      //   predicate → validator rejected with schema error. Now we include all players
      //   from team_players (relevance-ranked from live match data).
      const rwTopPlayers: string[] = [];
      const rwKnownPlayersForCall1: Array<{ id: string; name: string }> = [];
      const rwUpcomingMatch = sportsCtxRW.upcomingMatches[0] ?? null;
      if (rwUpcomingMatch && league.sport === 'football') {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
        const teamIds = [rwUpcomingMatch.homeTeam.id, rwUpcomingMatch.awayTeam.id].filter(Boolean);
        for (const teamId of teamIds) {
          const { data: tps } = await sb
            .from('team_players')
            .select('external_player_id, players(name)')
            .eq('sport', 'football')
            .eq('external_team_id', String(teamId))
            .gte('last_seen_at', ninetyDaysAgo)
            .order('relevance_score', { ascending: false })
            .limit(8);
          if (tps) {
            for (const tp of tps) {
              const playerName = (tp as any).players?.name;
              const playerId   = String((tp as any).external_player_id ?? '');
              if (playerName) {
                rwTopPlayers.push(playerName);
                if (playerId) rwKnownPlayersForCall1.push({ id: playerId, name: playerName });
              }
            }
          }
        }
        if (rwTopPlayers.length > 0) {
          console.log(`[rw-gen] PLAYER BOOST: ${rwTopPlayers.length} players for league ${league.id}: ${rwTopPlayers.slice(0, 5).join(', ')}...`);
        }
      }
      // Merge team_players entries with the existing injury-list keyPlayers.
      // keyPlayers are already { id, name } shaped; dedup by id.
      const rwKnownPlayersMap = new Map<string, { id: string; name: string }>();
      for (const p of rwKnownPlayersForCall1) rwKnownPlayersMap.set(p.id, p);
      for (const p of (sportsCtxRW.keyPlayers ?? [])) {
        const pid = String((p as any).id ?? (p as any).playerId ?? '');
        const pname = (p as any).name ?? (p as any).playerName ?? '';
        if (pid && pname) rwKnownPlayersMap.set(pid, { id: pid, name: pname });
      }
      const mergedKnownPlayers = Array.from(rwKnownPlayersMap.values());

      const { items: rwNewsItems, unavailable: rwNewsUnavailable } = await fetchNewsContext(
        league, sportsCtxRW, GNEWS_API_KEY, rwTopPlayers,
      );

      // Skip if news is unavailable or there are no articles — REAL_WORLD
      // must be grounded in actual news signal, not invented from thin air.
      if (rwNewsUnavailable || rwNewsItems.length === 0) {
        console.log(`[rw-gen] league ${league.id} — skipping REAL_WORLD (skipReason: no_news_signal, items=${rwNewsItems.length}, unavailable=${rwNewsUnavailable})`);
        continue;
      }

      // ── Select target matches (48h window) ───────────────────────────
      // REAL_WORLD questions must be hard-bound to a specific upcoming match.
      // Only matches kicking off within the next 48 hours are eligible targets.
      // If the news refers to Team X or Player Y, Call 1 must pick the match
      // whose teams include that entity — the 48h filter prevents binding to
      // distant fixtures that would produce a misleadingly long answer window.
      const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
      const targetMatches = sportsCtxRW.upcomingMatches.filter((m) => {
        const msUntil = new Date(m.kickoff).getTime() - Date.now();
        return msUntil > 0 && msUntil <= FORTY_EIGHT_HOURS_MS;
      });

      if (targetMatches.length === 0) {
        console.log(
          `[rw-gen] league ${league.id} — no upcoming match within 48h — skipping REAL_WORLD ` +
          `(next match: ${sportsCtxRW.upcomingMatches[0]?.kickoff ?? 'none'})`,
        );
        continue;
      }

      // Build match strings from the 48h target set only.
      // Each string includes match_id so the model embeds it verbatim in predicate_hint,
      // preventing ID fabrication that passes schema validation but resolves against
      // the wrong fixture.
      const upcomingMatchStrings = targetMatches.map((m) =>
        `${m.homeTeam.name} vs ${m.awayTeam.name} (kickoff: ${m.kickoff}, match_id: ${m.id})`
      );

      // leagueScope string: "full_league" or "team_specific:TeamName"
      // Built once per league — constant across all retry attempts.
      const leagueScopeStr = league.scope === 'team_specific' && league.scoped_team_name
        ? `team_specific:${league.scoped_team_name}`
        : 'full_league';

      // ── Split news into ranked attempt groups ─────────────────────────
      // News items are already sorted by finalScore DESC from the adapter.
      // Splitting into up to MAX_RW_RETRIES chunks gives each attempt a
      // progressively lower-quality news slice — attempt 1 gets the strongest
      // signals, attempt 2 gets the next batch, etc.
      // chunkSize: divide articles evenly across attempts, at least 1 per group.
      // Empty groups (when item count < MAX_RW_RETRIES) are filtered out.
      const rwChunkSize  = Math.max(1, Math.ceil(rwNewsItems.length / MAX_RW_RETRIES));
      const rwNewsGroups: NewsItem[][] = Array.from({ length: MAX_RW_RETRIES }, (_, i) => {
        const start = i * rwChunkSize;
        return rwNewsItems.slice(start, start + rwChunkSize);
      }).filter((g) => g.length > 0);

      // ── Article enrichment: deep-read top candidates with scraper ──────
      // Runs once per league (not per retry attempt) so the same URL is never
      // scraped more than once per run.  The enrichment map is keyed by URL;
      // inside the retry loop each attemptItems array is converted to enriched
      // versions before being sent to Call 1.
      // Falls back silently to RSS summary when the scraper is unavailable.
      const enrichedNewsItems: EnrichedNewsItem[] = await enrichArticlesWithScraper(rwNewsItems, league.id);
      // Re-chunk from the enriched list (same order, same sizes).
      const rwEnrichedGroups: EnrichedNewsItem[][] = Array.from({ length: MAX_RW_RETRIES }, (_, i) => {
        const start = i * rwChunkSize;
        return enrichedNewsItems.slice(start, start + rwChunkSize);
      }).filter((g) => g.length > 0);

      // weakCandidate: holds the best WEAK result seen so far across all attempts.
      // Published after the retry loop ONLY if no APPROVE was found and
      // rwLeagueApproved === 0 (same condition that gated WEAK publishing before).
      // Shape mirrors the fields needed for buildRwQuestion().
      let weakCandidate: {
        rawRW: any; rwPredicate: any; rwPredType: string;
        upcomingMatch: SportMatch; normalisedEntityFocus: string; rwPlayerIds: string[];
        rwContextText: string; sourceUrls: Array<Record<string, string>>;
        rwScore: number; rwQuality: any;
        answerClosesAt: string; resolvesAfter: string; nowRW: Date;
        attemptNum: number;
      } | null = null;

      // ── Retry loop: up to MAX_RW_RETRIES ranked news batches ─────────
      for (let attemptNum = 0; attemptNum < rwEnrichedGroups.length; attemptNum++) {
        const attemptItems = rwEnrichedGroups[attemptNum];
        const attemptLabel = `league ${league.id} attempt ${attemptNum + 1}/${rwEnrichedGroups.length}`;

        // ── Call 1: Generate REAL_WORLD question from this news batch ──
        let rawRW;
        try {
          rawRW = await generateRealWorldQuestion(
            attemptItems,
            leagueScopeStr,
            upcomingMatchStrings.length > 0 ? upcomingMatchStrings : null,
            mergedKnownPlayers,
            new Date().toISOString(),
            OPENAI_API_KEY,
          );
        } catch (err) {
          console.warn(`[rw-gen] ${attemptLabel} — Call 1 failed:`, err);
          continue;
        }

        // null return = OpenAI deliberately skipped (news signal too weak)
        if (!rawRW) {
          console.log(`[rw-gen] real_world_attempt_skip — ${attemptLabel} (model skipped: weak news signal)`);
          continue;
        }

        // ── Call 2: Convert predicate_hint → structured predicate ──────
        let rwPredicate;
        try {
          const predicatePrompt = buildPredicatePrompt({
            questionText:       rawRW.question_text,
            type:               'binary',
            options:            [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }],
            resolutionRuleText: rawRW.predicate_hint,
            matches:            sportsCtxRW.upcomingMatches,
            players:            sportsCtxRW.keyPlayers,
            sport:              league.sport,
          });
          rwPredicate = await convertToPredicate(predicatePrompt, OPENAI_API_KEY);
        } catch (err) {
          console.warn(`[rw-gen] ${attemptLabel} — Call 2 failed:`, err);
          continue;
        }

        const rwPredType = (rwPredicate as any).resolution_type;

        // ── Hard match binding: predicate must reference a 48h target match ─
        // Call 1 was given ONLY the 48h target matches and instructed to embed the
        // match_id of the one relevant to the news signal. Call 2 extracts that ID
        // into the predicate. Validate that it maps to one of our target matches.
        // No fallback to [0] — a missing or mismatched match_id means the question
        // is not news-signal-bound to a specific fixture and must be rejected.
        const rwPredicateMatchId = String((rwPredicate as any).match_id ?? '');
        const upcomingMatch = rwPredicateMatchId
          ? (targetMatches.find((m) => String(m.id) === rwPredicateMatchId) ?? null)
          : null;

        if (!upcomingMatch) {
          const bindReason = !rwPredicateMatchId
            ? 'predicate has no match_id'
            : `predicate match_id "${rwPredicateMatchId}" not in 48h target matches [${targetMatches.map((m) => m.id).join(', ')}]`;
          console.log(`[rw-gen] real_world_attempt_binding_failed — ${attemptLabel}: ${bindReason}`);
          continue;
        }

        // ── match_lineup near-kickoff guard ────────────────────────────
        // match_lineup deadline = kickoff. checkTemporal enforces deadline >= now + 30 min.
        // Skip if < 60 min to kickoff (lineups are released ~1h before kickoff).
        if (rwPredType === 'match_lineup') {
          // Override resolution_deadline to kickoff (not kickoff - 30min).
          rawRW.resolution_deadline = upcomingMatch.kickoff;
          const minsUntilKickoff = (new Date(upcomingMatch.kickoff).getTime() - Date.now()) / 60_000;
          if (minsUntilKickoff < 60) {
            console.log(
              `[rw-gen] real_world_attempt_skip — ${attemptLabel}: match_lineup kickoff too close ` +
              `(${minsUntilKickoff.toFixed(1)} min, need 60+)`,
            );
            continue;
          }
        }

        // ── match_lineup `check` field normalisation ───────────────────
        if (rwPredType === 'match_lineup' && !(rwPredicate as any).check) {
          (rwPredicate as any).check = 'squad';
        }

        // ── manual_review `resolution_deadline` backfill ──────────────
        if (rwPredType === 'manual_review' && !(rwPredicate as any).resolution_deadline) {
          (rwPredicate as any).resolution_deadline = rawRW.resolution_deadline;
        }

        // ── Cross-validate entity_focus against predicate type ─────────
        const rwEntityFocus = rawRW.entity_focus;
        const PLAYER_PRED_TYPES = ['match_lineup', 'player_stat'];
        const TEAM_PRED_TYPES   = ['match_stat', 'btts', 'match_outcome', 'match_stat_window'];
        let normalisedEntityFocus = rwEntityFocus;
        if (PLAYER_PRED_TYPES.includes(rwPredType) && !['player'].includes(rwEntityFocus)) {
          console.warn(`[rw-gen] entity_focus "${rwEntityFocus}" mismatch for ${rwPredType} — normalising to "player"`);
          normalisedEntityFocus = 'player';
        } else if (TEAM_PRED_TYPES.includes(rwPredType) && !['team', 'club'].includes(rwEntityFocus)) {
          console.warn(`[rw-gen] entity_focus "${rwEntityFocus}" mismatch for ${rwPredType} — normalising to "team"`);
          normalisedEntityFocus = 'team';
        }

        // ── Call 3: Generate context + curated sources ─────────────────
        // Pre-seed from Call 1 narrative so Call 4 always has meaningful context
        // even when Call 3 fails (network error). Call 3 result overwrites when present.
        let rwContextText = rawRW.news_narrative_summary ?? '';
        let sourceUrls: Array<Record<string, string>> = [];

        const rwTeams = [
          upcomingMatch.homeTeam.name, upcomingMatch.awayTeam.name,
          ...(league.scoped_team_name ? [league.scoped_team_name] : []),
          ...(sportsCtxRW.standings?.slice(0, 2).map((s) => s.team.name) ?? []),
        ].filter(Boolean).join(', ') || 'Unknown';

        const rwPlayers = sportsCtxRW.keyPlayers
          ?.slice(0, 5)
          .map((p: any) => p.name ?? p.playerName ?? '')
          .filter(Boolean)
          .join(', ') ?? '';

        try {
          const rwCtxResult = await generateRealWorldContext(
            rawRW.question_text,
            attemptItems,
            rawRW.confidence_level,
            rwTeams,
            rwPlayers,
            OPENAI_API_KEY,
          );
          rwContextText = rwCtxResult.context || rwContextText;
          if (rwCtxResult.sources.length > 0) {
            sourceUrls = rwCtxResult.sources as Array<Record<string, string>>;
          }
        } catch (err) {
          console.warn(`[rw-gen] ${attemptLabel} — Call 3 failed:`, err);
        }

        // Fallback: build enriched source objects from NewsItem data.
        if (sourceUrls.length === 0) {
          sourceUrls = attemptItems
            .slice(0, 3)
            .map((n) => ({
              url:          n.url ?? '',
              title:        n.headline,
              source_name:  n.sourceName,
              published_at: n.publishedAt,
            }))
            .filter((s) => s.url) as Array<Record<string, string>>;
        }

        // ── Call 4: Quality scoring gate ───────────────────────────────
        const rwQuality = await scoreRealWorldQuestion(
          rawRW.question_text,
          rwContextText || rawRW.news_narrative_summary,
          sourceUrls as Array<{ source_name?: string; title?: string; published_at?: string }>,
          rawRW.confidence_level,
          // btts → pass as 'match_stat' so the quality scorer recognises it
          rwPredType === 'btts' ? 'match_stat' : (rwPredicate as any).resolution_type,
          rawRW.resolution_deadline,
          normalisedEntityFocus,
          OPENAI_API_KEY,
        );

        const rwScore    = rwQuality?.final_score ?? 65;
        const rwDecision = rwQuality?.decision    ?? 'WEAK';

        console.log(
          `[rw-quality] ${attemptLabel} score=${rwScore} decision=${rwDecision}` +
          (rwQuality ? ` reason="${rwQuality.reason}"` : ' (call failed — defaulting to WEAK)'),
        );

        if (rwDecision === 'REJECT') {
          console.log(`[rw-gen] real_world_attempt_reject — ${attemptLabel}: score=${rwScore}`);
          continue;
        }

        // ── Build timing ───────────────────────────────────────────────
        const nowRW      = new Date();
        const deadlineMs = new Date(rawRW.resolution_deadline).getTime();
        let answerClosesAt: string;
        let resolvesAfter: string;

        if (rwPredType === 'match_lineup') {
          answerClosesAt = new Date(Math.max(deadlineMs, nowRW.getTime())).toISOString();
          const kickoffForLineup = new Date(upcomingMatch.kickoff).getTime();
          resolvesAfter = new Date(kickoffForLineup).toISOString();
        } else if (rwPredType === 'player_stat' || rwPredType === 'match_stat' || rwPredType === 'btts') {
          const kickoffMs = new Date(upcomingMatch.kickoff).getTime();
          answerClosesAt = new Date(Math.max(kickoffMs, nowRW.getTime())).toISOString();
          resolvesAfter  = new Date(deadlineMs + 30 * 60 * 1000).toISOString();
        } else {
          const kickoffMs = new Date(upcomingMatch.kickoff).getTime();
          answerClosesAt = new Date(Math.max(kickoffMs, nowRW.getTime())).toISOString();
          resolvesAfter  = new Date(deadlineMs + 91 * 60 * 1000).toISOString();
        }

        // ── Validate via the standard 4-stage validator ────────────────
        const rwPlayerIds: string[] = [];
        if ((rwPredicate as any).player_id) rwPlayerIds.push(String((rwPredicate as any).player_id));

        const rawForValidation = {
          question_text:              rawRW.question_text,
          type:                       'binary',
          options:                    [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }],
          match_id:                   upcomingMatch.id,
          team_ids:                   [upcomingMatch.homeTeam.id, upcomingMatch.awayTeam.id],
          player_ids:                 rwPlayerIds,
          event_type:                 'time_window',
          opens_at:                   nowRW.toISOString(),
          deadline:                   answerClosesAt,
          resolves_after:             resolvesAfter,
          resolution_rule_text:       rawRW.resolution_condition,
          narrative_context:          rawRW.news_narrative_summary,
          visible_from:               nowRW.toISOString(),
          answer_closes_at:           answerClosesAt,
          match_minute_at_generation: null,
          base_value:                 10,
          difficulty_multiplier:      1.0,
          reusable_scope:             'league_specific',
        };

        const rwRejection = validateQuestion(rawForValidation as any, rwPredicate, sportsCtxRW, league, attemptNum + 1, 'REAL_WORLD');
        if (rwRejection) {
          console.log(`[rw-gen] real_world_attempt_reject — ${attemptLabel}: validation failed: ${rwRejection.error}`);
          continue;
        }

        // ── APPROVE → publish immediately and break the retry loop ─────
        if (rwDecision === 'APPROVE') {
          console.log(`[rw-gen] real_world_attempt_approve_published — ${attemptLabel}: score=${rwScore}, match=${upcomingMatch.id}`);
          const { error: rwInsertErr } = await sb.from('questions').insert(
            buildRwQuestion(league, runId, rawRW, rwPredicate, upcomingMatch,
              normalisedEntityFocus, rwPlayerIds, rwContextText, sourceUrls,
              answerClosesAt, resolvesAfter, nowRW, rwScore, rwQuality),
          );
          if (!rwInsertErr) {
            rwLeagueApproved++;
            runStats.generated++;
            console.log(
              `[rw-gen] REAL_WORLD generated for league ${league.id} ` +
              `(score=${rwScore}, decision=APPROVE, match=${upcomingMatch.id})`,
            );
          } else {
            console.error(`[rw-gen] insert failed for league ${league.id}:`, rwInsertErr.message);
          }
          break; // stop retrying — APPROVE found
        }

        // ── WEAK → store as best candidate, continue searching for APPROVE
        if (!weakCandidate || rwScore > weakCandidate.rwScore) {
          weakCandidate = {
            rawRW, rwPredicate, rwPredType, upcomingMatch,
            normalisedEntityFocus, rwPlayerIds, rwContextText, sourceUrls,
            rwScore, rwQuality, answerClosesAt, resolvesAfter, nowRW, attemptNum,
          };
          console.log(`[rw-gen] real_world_attempt_weak_stored — ${attemptLabel}: score=${rwScore}`);
        }
      } // end retry loop

      // ── After all attempts: publish best WEAK if no APPROVE was found ─
      if (rwLeagueApproved === 0 && weakCandidate !== null) {
        const {
          rawRW, rwPredicate, upcomingMatch, normalisedEntityFocus, rwPlayerIds,
          rwContextText, sourceUrls, rwScore, rwQuality, answerClosesAt, resolvesAfter, nowRW, attemptNum,
        } = weakCandidate;
        console.log(
          `[rw-gen] real_world_best_weak_published — league ${league.id}: ` +
          `score=${rwScore}, match=${upcomingMatch.id}, attempt=${attemptNum + 1}`,
        );
        const { error: rwInsertErr } = await sb.from('questions').insert(
          buildRwQuestion(league, runId, rawRW, rwPredicate, upcomingMatch,
            normalisedEntityFocus, rwPlayerIds, rwContextText, sourceUrls,
            answerClosesAt, resolvesAfter, nowRW, rwScore, rwQuality),
        );
        if (!rwInsertErr) {
          runStats.generated++;
          console.log(
            `[rw-gen] REAL_WORLD generated for league ${league.id} ` +
            `(score=${rwScore}, decision=WEAK, match=${upcomingMatch.id})`,
          );
        } else {
          console.error(`[rw-gen] insert failed for league ${league.id}:`, rwInsertErr.message);
        }
      } else if (rwLeagueApproved === 0) {
        console.log(
          `[rw-gen] real_world_no_valid_candidate_after_retries — league ${league.id}: ` +
          `all ${rwNewsGroups.length} attempt(s) exhausted`,
        );
      }
    }

    await finaliseRun(sb, runId, runStats, 'completed');
    return new Response(
      JSON.stringify({ ok: true, run_id: runId, ...runStats }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('[generate-questions] fatal error:', err);
    await sb
      .from('generation_runs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_summary: { message: String(err) } })
      .eq('id', runId);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────

// enrichArticlesWithScraper: deep-reads the top-ranked candidate articles using the
// spontyx-scraper-service, attaching full article text to each item before Call 1.
//
// Rules:
// - Max 5 unique URLs per league per run (keeps cost and latency bounded)
// - 10-second timeout per article (scraper is fast; stale pages get dropped)
// - extracted_context = first 800 chars of extracted_text (sent to OpenAI)
// - Never throws — any failure falls back to the original NewsItem unchanged
// - Does not store extracted text anywhere; ephemeral per-run enrichment only
async function enrichArticlesWithScraper(
  articles: NewsItem[],
  leagueId: string,
): Promise<EnrichedNewsItem[]> {
  if (!SCRAPER_API_URL || !SCRAPER_API_KEY) {
    // Scraper not configured — return articles unmodified (safe no-op)
    return articles as EnrichedNewsItem[];
  }

  // Collect up to 5 unique URLs from the candidate list (articles are already
  // sorted best-first by the news adapter's relevance scorer).
  const seenUrls  = new Set<string>();
  const toEnrich: NewsItem[] = [];
  for (const a of articles) {
    if (!a.url || seenUrls.has(a.url)) continue;
    seenUrls.add(a.url);
    toEnrich.push(a);
    if (toEnrich.length >= 5) break;
  }

  // Build the enrichment map: url → EnrichedNewsItem
  const enrichMap = new Map<string, Partial<EnrichedNewsItem>>();

  await Promise.all(toEnrich.map(async (article) => {
    console.log(`[rw-scraper] real_world_article_scrape_attempt — league ${leagueId} url=${article.url} source=${article.sourceName}`);
    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(`${SCRAPER_API_URL}/scrape`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-scraper-key': SCRAPER_API_KEY,
        },
        body:    JSON.stringify({ url: article.url }),
        signal:  controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        console.warn(`[rw-scraper] real_world_article_scrape_failed — league ${leagueId} url=${article.url} status=${res.status} error=${errText.slice(0, 120)}`);
        enrichMap.set(article.url, { extraction_status: 'failed', scraper_error: `HTTP ${res.status}` });
        return;
      }

      const json: {
        success: boolean;
        extraction_status: string;
        extracted_text?: string;
        error?: string | null;
      } = await res.json();

      if (!json.success || !json.extracted_text) {
        const reason = json.error ?? `extraction_status=${json.extraction_status}`;
        console.log(`[rw-scraper] real_world_article_scrape_fallback_to_rss — league ${leagueId} url=${article.url} reason=${reason}`);
        enrichMap.set(article.url, {
          extraction_status: (json.extraction_status as EnrichedNewsItem['extraction_status']) ?? 'failed',
          scraper_error: json.error ?? null,
        });
        return;
      }

      const extracted_text    = json.extracted_text.slice(0, 3_000);
      const extracted_context = extracted_text.slice(0, 800);
      console.log(`[rw-scraper] real_world_article_scrape_success — league ${leagueId} url=${article.url} chars=${extracted_text.length}`);
      enrichMap.set(article.url, {
        extracted_text,
        extracted_context,
        extraction_status: (json.extraction_status as EnrichedNewsItem['extraction_status']) ?? 'success',
        scraper_error: null,
      });
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError';
      const errMsg    = isTimeout ? 'timeout after 10s' : String(err?.message ?? err);
      console.warn(`[rw-scraper] real_world_article_scrape_failed — league ${leagueId} url=${article.url} error=${errMsg}`);
      enrichMap.set(article.url, { extraction_status: 'failed', scraper_error: errMsg });
    }
  }));

  // Merge enrichment fields back onto every article in the original list order.
  return articles.map((a): EnrichedNewsItem => ({
    ...a,
    ...(a.url ? enrichMap.get(a.url) ?? {} : {}),
  }));
}

// buildRwQuestion: assembles the questions table insert object for a REAL_WORLD question.
// Called from both the APPROVE publish path and the WEAK fallback publish path to avoid
// duplicating the ~40-field insert object.
function buildRwQuestion(
  league: LeagueWithConfig,
  runId: string,
  rawRW: any,
  rwPredicate: any,
  upcomingMatch: SportMatch,
  normalisedEntityFocus: string,
  rwPlayerIds: string[],
  rwContextText: string,
  sourceUrls: Array<Record<string, string>>,
  answerClosesAt: string,
  resolvesAfter: string,
  nowRW: Date,
  rwScore: number,
  rwQuality: any,
) {
  return {
    league_id:                  league.id,
    source:                     'ai_generated',
    generation_run_id:          runId,
    question_text:              rawRW.question_text,
    type:                       'binary',
    options:                    [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }],
    sport:                      league.sport,
    match_id:                   upcomingMatch.id,
    team_ids:                   [upcomingMatch.homeTeam.id, upcomingMatch.awayTeam.id],
    player_ids:                 rwPlayerIds,
    event_type:                 'time_window',
    narrative_context:          rawRW.news_narrative_summary,
    opens_at:                   nowRW.toISOString(),
    deadline:                   answerClosesAt,
    resolves_after:             resolvesAfter,
    resolution_rule_text:       rawRW.resolution_condition,
    resolution_predicate:       rwPredicate,
    resolution_status:          'pending',
    ai_model:                   'gpt-4o-mini',
    ai_prompt_version:          PROMPT_VERSION,
    question_type:              'REAL_WORLD',
    source_badge:               'REAL WORLD',
    base_value:                 10,
    difficulty_multiplier:      1.0,
    reuse_scope:                'league_specific',
    visible_from:               nowRW.toISOString(),
    answer_closes_at:           answerClosesAt,
    match_minute_at_generation: null,
    generation_trigger:         'time_driven',
    // ── REAL_WORLD-specific fields (migration 024) ──────────────────
    resolution_condition:       rawRW.resolution_condition,
    resolution_deadline:        rawRW.resolution_deadline,
    source_news_urls:           sourceUrls,
    entity_focus:               normalisedEntityFocus,
    confidence_level:           rawRW.confidence_level,
    rw_context:                 rwContextText || null,
    // ── Quality gate metadata (Call 4, migration 027) ───────────────
    rw_quality_score:           rwScore,
    rw_quality_breakdown:       rwQuality?.breakdown ?? null,
  };
}

// Compute the pool generation target for a set of match IDs being claimed this cycle.
//
// The pool must be large enough to serve the HIGHEST-budget league among all leagues
// that share the EXACT same PoolCacheKey generation profile.
//
// Eligibility: a league is co-profile with the current league if it has identical:
//   sport, leagueType (type1/type2), phaseScope, mode, scope, scopedTeamId, promptVersion
//   AND covers at least one of the uncoveredMatchIds.
//
// Returns max(prematch_question_budget) across eligible leagues, floored at 8.
// The fallback of 8 matches the STANDARD live budget — safe default if no budget data.
function computePoolGenerationTarget(
  _uncoveredMatchIds: (string | undefined)[],  // reserved for future per-match scoping
  currentLeague: LeagueWithConfig,
  allLeagues: LeagueWithConfig[],
): number {
  const FALLBACK = 8;

  const coProfileBudgets = allLeagues
    .filter((l) => {
      // Must share all profile fields except matchId
      if (l.sport         !== currentLeague.sport)         return false;
      if (getLeagueType(l) !== getLeagueType(currentLeague)) return false;
      if (getPhaseScope(l) !== getPhaseScope(currentLeague)) return false;
      if (getMode(l)       !== getMode(currentLeague))       return false;
      if (l.scope          !== currentLeague.scope)          return false;
      if ((l.scoped_team_id ?? null) !== (currentLeague.scoped_team_id ?? null)) return false;
      // Must be watching at least one of the uncovered matches
      // (league is included; exact matchId is fixed per pool claim so this is sufficient)
      return true;
    })
    // prematch_questions_per_match (migration 053) takes priority over prematch_question_budget.
    .map((l) => l.prematch_questions_per_match ?? l.prematch_question_budget ?? FALLBACK)
    .filter((b) => b > 0);

  return coProfileBudgets.length ? Math.max(...coProfileBudgets) : FALLBACK;
}

// Heuristic: infer category labels from recent question texts for diversity hints.
// Not perfect — avoids needing to store category per question in the DB for now.
function deriveRecentCategories(questions: string[]): string[] {
  const cats: string[] = [];
  for (const q of questions.slice(-3)) {
    const lower = q.toLowerCase();
    if (lower.includes('score') || lower.includes('goal') || lower.includes('penalty') || lower.includes('red card')) {
      cats.push('high_value_event');
    } else if (lower.includes('win') || lower.includes('clean sheet') || lower.includes('draw') || lower.includes('equaliser')) {
      cats.push('outcome_state');
    } else if (lower.includes('corner') || lower.includes('card') || lower.includes('shot')) {
      cats.push('medium_stat');
    } else {
      cats.push('low_value_filler');
    }
  }
  return [...new Set(cats)]; // dedupe
}

// Heuristic: infer stat focus labels from recent question texts.
function deriveRecentStatFocus(questions: string[]): string[] {
  const stats: string[] = [];
  for (const q of questions.slice(-3)) {
    const lower = q.toLowerCase();
    if (lower.includes('corner')) stats.push('corners');
    if (lower.includes('card') || lower.includes('yellow') || lower.includes('red')) stats.push('cards');
    if (lower.includes('shot')) stats.push('shots');
    if (lower.includes('goal')) stats.push('goals');
    if (lower.includes('clean sheet')) stats.push('clean_sheet');
  }
  return [...new Set(stats)];
}

async function writeLeagueResult(sb: any, runId: string, r: LeagueRunResult) {
  const { error } = await sb.from('generation_run_leagues').insert({
    run_id:                   runId,
    league_id:                r.leagueId,
    sport:                    r.sport,
    generation_mode:          r.generationMode,
    earliest_match_kickoff:   r.earliestMatchKickoff,
    hours_until_kickoff:      r.hoursUntilKickoff,
    league_priority_score:    Math.floor(r.priorityScore),
    quota_total:              r.quotaTotal,
    quota_used_total:         r.quotaUsedTotal,
    quota_used_this_week:     r.quotaUsedThisWeek,
    questions_requested:      r.questionsRequested,
    questions_generated:      r.questionsGenerated,
    questions_rejected:       r.questionsRejected,
    rejection_log:            r.rejectionLog.length ? r.rejectionLog : null,
    skipped:                  r.skipped,
    skip_reason:              r.skipReason ?? null,
    news_items_fetched:       r.newsItemsFetched,
    news_unavailable:         r.newsUnavailable,
    news_snapshot:            r.newsSnapshot.length ? r.newsSnapshot : null,
    duration_ms:              r.durationMs,
  });
  if (error) console.warn('[writeLeagueResult] insert error:', error);
}

// ── Pre-match publish window check ───────────────────────────────────
//
// Returns true if a prematch question SHOULD be generated for this match
// right now, given the league's scheduling mode.
//
// automatic: normal window is kickoff-48h → kickoff-24h (questions published at
//            the 48h mark). Late-creation fallback: if the league was created
//            AFTER the normal window opened (i.e. created within 24h of kickoff),
//            allow generation immediately so new leagues don't miss prematch.
// manual:    eligible when now >= kickoff − offset_hours (publish window has opened)
//
// Both modes: reject if kickoff is already in the past.

function isMatchEligibleForPrematch(
  kickoff: string,
  league: LeagueWithConfig,
  nowMs: number,
): boolean {
  const kickoffMs = new Date(kickoff).getTime();
  if (isNaN(kickoffMs)) return false;
  // Never generate after kickoff
  if (kickoffMs <= nowMs) return false;

  const mode = league.prematch_generation_mode ?? 'automatic';

  if (mode === 'manual') {
    const offset = league.prematch_publish_offset_hours ?? 24;
    const publishWindowStartMs = kickoffMs - offset * 3600 * 1000;
    return nowMs >= publishWindowStartMs;
  }

  // Automatic: normal window is 24h–48h before kickoff
  const hoursUntilKickoff = (kickoffMs - nowMs) / (1000 * 3600);
  if (hoursUntilKickoff >= 24 && hoursUntilKickoff <= 48) return true;

  // Late-creation fallback: league was created after the normal window opened
  // (i.e. league.created_at is within the last 24h AND match is <24h away).
  // This ensures a league created hours before kickoff still gets prematch questions.
  if (hoursUntilKickoff > 0 && hoursUntilKickoff < 24) {
    const leagueCreatedMs = new Date(league.created_at ?? 0).getTime();
    const normalWindowOpenMs = kickoffMs - 48 * 3600 * 1000; // 48h before kickoff
    // If league was created after the normal window opened, allow generation now
    if (leagueCreatedMs > normalWindowOpenMs) return true;
  }

  return false;
}

// ── Per-league visible_from computation ───────────────────────────────
//
// For pool-reused questions, visible_from must be recomputed per league
// because different leagues may have different scheduling modes — even
// when they share the same canonical pool question.
//
// automatic: visible_from = now (question appears immediately after attach)
// manual:    visible_from = kickoff − offset_hours (clamped to now if past)
//
// kickoff = the question's deadline (= kickoff stored on the pool question).

export function computeVisibleFrom(league: LeagueWithConfig, kickoff: string): string {
  const now = new Date();
  const mode = league.prematch_generation_mode ?? 'automatic';
  if (mode === 'manual') {
    const offset = league.prematch_publish_offset_hours ?? 24;
    const visMs = new Date(kickoff).getTime() - offset * 3600 * 1000;
    // Clamp: never set visible_from in the past
    return new Date(Math.max(visMs, now.getTime())).toISOString();
  }
  return now.toISOString();
}

async function finaliseRun(sb: any, runId: string, stats: any, status: string) {
  await sb.from('generation_runs').update({
    status,
    completed_at:        new Date().toISOString(),
    leagues_evaluated:   stats.leaguesEvaluated,
    leagues_skipped:     stats.leaguesSkipped,
    leagues_processed:   stats.leaguesProcessed,
    questions_generated: stats.generated,
    questions_rejected:  stats.rejected,
  }).eq('id', runId);
}
