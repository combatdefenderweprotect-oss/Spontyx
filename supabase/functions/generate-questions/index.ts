import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { LeagueWithConfig, ValidatedQuestion, RejectionLogEntry, LeagueRunResult } from './lib/types.ts';
import { classifyLeague, sortLeaguesByPriority, checkQuota, getRecentQuestionTexts, checkRealWorldQuota } from './lib/quota-checker.ts';
import { fetchSportsContext } from './lib/sports-adapter/index.ts';
import { fetchNewsContext }   from './lib/news-adapter/index.ts';
import { buildContextPacket, buildPredicatePrompt, computeResolvesAfter } from './lib/context-builder.ts';
import { generateQuestions, convertToPredicate, PROMPT_VERSION } from './lib/openai-client.ts';
import { validateQuestion } from './lib/predicate-validator.ts';
import {
  buildCacheKey, getLeagueType, getPhaseScope, getMode,
  findReadyPools, getOrClaimPool, getPoolQuestions,
  storePoolQuestions, markPoolReady, markPoolFailed,
  attachPoolQuestionsToLeague,
  type MatchPool,
} from './lib/pool-manager.ts';

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

// ── Environment variables ─────────────────────────────────────────────
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY    = Deno.env.get('OPENAI_API_KEY')!;
const API_SPORTS_KEY    = Deno.env.get('API_SPORTS_KEY')!;
const GNEWS_API_KEY     = Deno.env.get('GNEWS_API_KEY')!;

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
    const { data: leagues, error: leagueErr } = await sb
      .from('leagues')
      .select(`
        id, name, sport, scope,
        scoped_team_id, scoped_team_name,
        api_sports_league_id, api_sports_team_id, api_sports_season,
        ai_weekly_quota, ai_total_quota,
        league_start_date, league_end_date, owner_id
      `)
      .eq('ai_questions_enabled', true)
      .not('api_sports_league_id', 'is', null);

    if (leagueErr) throw new Error(`league fetch failed: ${leagueErr.message}`);
    if (!leagues || !leagues.length) {
      await finaliseRun(sb, runId, runStats, 'completed');
      return new Response(JSON.stringify({ ok: true, message: 'no enabled leagues' }), { status: 200 });
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

    // ── Process each league ───────────────────────────────────────────
    for (const cls of sorted) {
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

      // Quota check
      let quota;
      try {
        quota = await checkQuota(sb, league);
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

      runStats.leaguesProcessed++;

      // Step 1: Fetch sports context
      let sportsCtx;
      try {
        sportsCtx = await fetchSportsContext(league, API_SPORTS_KEY);
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

      const upcomingMatchIds = sportsCtx.upcomingMatches.map((m) => m.id).filter(Boolean);

      const baseKey = {
        sport:         league.sport,
        leagueType:    getLeagueType(league),
        phaseScope:    getPhaseScope(league),
        mode:          getMode(league),
        promptVersion: PROMPT_VERSION,
      };

      // Phase A: reuse existing ready pools
      const existingPools = await findReadyPools(sb, upcomingMatchIds, baseKey);
      let totalAttached = 0;

      const ownerTier = ownerTierMap.get(league.owner_id ?? '') ?? 'starter';
      const rwQuota = await checkRealWorldQuota(sb, league.id, ownerTier);

      for (const [matchId, pool] of existingPools) {
        if (totalAttached >= quota.questionsToGenerate) break;
        let poolQs = await getPoolQuestions(sb, pool.id, baseKey.mode);
        if (!rwQuota.allowed) {
          poolQs = poolQs.filter((pq) => computeLane(pq.matchMinuteAtGeneration, pq.matchId) !== 'REAL_WORLD');
        }
        const attached = await attachPoolQuestionsToLeague(
          sb, poolQs, league, runId, PROMPT_VERSION,
          recentQuestions, totalAttached, quota.questionsToGenerate,
        );
        if (attached > 0) {
          console.log(`[pool] reused ${attached} questions for league ${league.id} from match ${matchId}`);
          totalAttached += attached;
        }
      }

      // Phase B: generate for uncovered matches
      const coveredIds = new Set(existingPools.keys());
      const uncoveredMatches = sportsCtx.upcomingMatches.filter(
        (m) => m.id && !coveredIds.has(m.id),
      );

      if (uncoveredMatches.length > 0 && totalAttached < quota.questionsToGenerate) {
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

          // Derive diversity signals from recent question texts (best-effort heuristics)
          const recentCategories = deriveRecentCategories(recentQuestions);
          const recentStatFocus  = deriveRecentStatFocus(recentQuestions);

          const contextPacket = buildContextPacket({
            league,
            classification:        cls,
            sportsCtx:             filteredCtx,
            newsItems,
            recentQuestions,
            questionsToGenerate:   quota.questionsToGenerate - totalAttached,
            existingQuestionCount: totalAttached,
            recentCategories,
            recentStatFocus,
          });

          // Generate + validate (with retry)
          const validatedQuestions: ValidatedQuestion[] = [];
          let attempt = 0;
          while (
            validatedQuestions.length < (quota.questionsToGenerate - totalAttached) &&
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

            for (const raw of rawQuestions) {
              if (validatedQuestions.length >= (quota.questionsToGenerate - totalAttached)) break;

              // ── Fill system-computed fields ────────────────────────────
              raw.event_type         = CATEGORY_EVENT_TYPE[raw.question_category] ?? 'time_window';
              raw.narrative_context  = raw.reasoning_short ?? '';
              raw.resolution_rule_text = raw.predicate_hint ?? '';

              // Timing: for prematch, override OpenAI timestamps with authoritative values.
              // OpenAI can approximate but doesn't know exact server time or kickoff offset.
              const now = new Date().toISOString();
              const firstMatch = filteredCtx.upcomingMatches[0];
              const kickoff = firstMatch?.kickoff ?? now;

              // opens_at / visible_from — use OpenAI value if reasonable, else now
              const aiVisibleFrom = raw.visible_from ? new Date(raw.visible_from).getTime() : 0;
              const nowMs = Date.now();
              raw.visible_from = (aiVisibleFrom > nowMs && aiVisibleFrom < nowMs + 120_000)
                ? raw.visible_from  // within 2 min — accept OpenAI's value
                : now;              // else: open immediately
              raw.opens_at = raw.visible_from;

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

          // Filter out REAL_WORLD questions if league owner's tier doesn't allow them
          if (!rwQuota.allowed) {
            const beforeFilter = validatedQuestions.length;
            const filtered = validatedQuestions.filter((q) => q.question_type !== 'REAL_WORLD');
            const dropped = beforeFilter - filtered.length;
            if (dropped > 0) {
              console.log(`[real_world_quota] dropped ${dropped} REAL_WORLD question(s) for league ${league.id}: ${rwQuota.skipReason}`);
              result.questionsRejected += dropped;
            }
            validatedQuestions.splice(0, validatedQuestions.length, ...filtered);
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
              // Attach from pool to this league with per-league constraint checks
              const poolQs = await getPoolQuestions(sb, pool.id, baseKey.mode);
              const attached = await attachPoolQuestionsToLeague(
                sb, poolQs, league, runId, PROMPT_VERSION,
                recentQuestions, totalAttached, quota.questionsToGenerate,
              );
              totalAttached += attached;
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

      result.questionsGenerated = totalAttached;
      runStats.generated       += totalAttached;
      runStats.rejected        += result.questionsRejected;

      result.durationMs = Date.now() - leagueStart;
      await writeLeagueResult(sb, runId, result);
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
