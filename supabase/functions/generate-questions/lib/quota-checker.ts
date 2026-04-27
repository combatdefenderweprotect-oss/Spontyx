import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type {
  LeagueWithConfig,
  LeagueClassification,
  MatchClassification,
  GenerationMode,
  QuotaCheck,
} from './types.ts';
import type { SportMatch } from './types.ts';

// Max LIVE questions to attempt per league per run (prevents flooding a league mid-match).
// This cap applies to CORE_MATCH_LIVE only. CORE_MATCH_PREMATCH uses the league's
// prematch_question_budget instead — set isPrematch=true to bypass this cap.
const PER_RUN_CAP = 3;

// ── Classify a league by imminence of next match ──────────────────────

export function classifyLeague(
  league: LeagueWithConfig,
  upcomingMatches: SportMatch[],
): LeagueClassification {
  if (!upcomingMatches.length) {
    return {
      league,
      classification: 'NONE',
      priorityScore: 0,
      earliestKickoff: null,
      hoursUntilKickoff: null,
      generationMode: 'narrative_only',
    };
  }

  // Sort ascending — find soonest match
  const sorted = [...upcomingMatches].sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime(),
  );
  const earliest = sorted[0];
  const now = Date.now();
  const kickoffMs = new Date(earliest.kickoff).getTime();
  const hoursUntil = Math.max(0, (kickoffMs - now) / (1000 * 60 * 60));

  let classification: MatchClassification;
  let priorityScore: number;
  let generationMode: GenerationMode;

  if (hoursUntil <= 24) {
    classification = 'IMMINENT';
    priorityScore = 3;
    generationMode = 'match_preview';
  } else if (hoursUntil <= 72) {
    classification = 'UPCOMING';
    priorityScore = 2;
    generationMode = 'match_preview';
  } else if (hoursUntil <= 168) { // 7 days
    classification = 'DISTANT';
    priorityScore = 1;
    generationMode = 'narrative_preview';
  } else {
    classification = 'NONE';
    priorityScore = 0;
    generationMode = 'narrative_only';
  }

  // Within same priority tier, tiebreak by soonest kickoff
  // (encoded as fractional offset — smaller hours = slightly higher score)
  const tiebreaker = priorityScore > 0 ? (1 - Math.min(hoursUntil, 168) / 168) * 0.99 : 0;

  return {
    league,
    classification,
    priorityScore: priorityScore + tiebreaker,
    earliestKickoff: earliest.kickoff,
    hoursUntilKickoff: Math.round(hoursUntil),
    generationMode,
  };
}

// ── Sort league classifications by priority (highest first) ──────────

export function sortLeaguesByPriority(
  leagues: LeagueClassification[],
): LeagueClassification[] {
  return [...leagues].sort((a, b) => b.priorityScore - a.priorityScore);
}

// ── Check quota for a league — returns how many to generate this run ──

export async function checkQuota(
  sb: SupabaseClient,
  league: LeagueWithConfig,
  isPrematch = false,
): Promise<QuotaCheck> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // League hasn't started yet
  if (league.league_start_date && today < league.league_start_date) {
    return {
      quotaTotal: league.ai_total_quota,
      quotaUsedTotal: 0,
      quotaUsedThisWeek: 0,
      questionsToGenerate: 0,
      skipReason: 'league_not_started',
    };
  }

  // League has ended
  if (league.league_end_date && today > league.league_end_date) {
    return {
      quotaTotal: league.ai_total_quota,
      quotaUsedTotal: 0,
      quotaUsedThisWeek: 0,
      questionsToGenerate: 0,
      skipReason: 'league_ended',
    };
  }

  // Rate limit: max 1 CORE_MATCH_LIVE question per 3 minutes per league (MVP safety rule).
  // This rule applies ONLY to CORE_MATCH_LIVE. CORE_MATCH_PREMATCH and REAL_WORLD are
  // NOT governed by this limit (REAL_WORLD has its own separate daily cap).
  // Scoped to CORE_MATCH_LIVE via match_minute_at_generation IS NOT NULL
  // (live questions always have this set; prematch questions always have it null).
  // Migration 010 adds the canonical question_type column — this filter remains correct
  // as a secondary guard and matches the backfill logic in that migration.
  const rateLimitCutoff = new Date(now.getTime() - 3 * 60 * 1000).toISOString();
  const { data: recentQ, error: recentErr } = await sb
    .from('questions')
    .select('created_at')
    .eq('league_id', league.id)
    .eq('source', 'ai_generated')
    .not('match_minute_at_generation', 'is', null)
    .gte('created_at', rateLimitCutoff)
    .limit(1);

  if (!recentErr && recentQ && recentQ.length > 0) {
    return {
      quotaTotal: league.ai_total_quota,
      quotaUsedTotal: 0,
      quotaUsedThisWeek: 0,
      questionsToGenerate: 0,
      skipReason: 'rate_limit_3min_live',
    };
  }

  // Count all-time AI questions for this league
  const { count: totalCount, error: totalErr } = await sb
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', league.id)
    .eq('source', 'ai_generated');

  if (totalErr) throw new Error(`quota total count failed: ${totalErr.message}`);
  const quotaUsedTotal = totalCount ?? 0;

  // If total quota exhausted, skip
  if (quotaUsedTotal >= league.ai_total_quota) {
    return {
      quotaTotal: league.ai_total_quota,
      quotaUsedTotal,
      quotaUsedThisWeek: 0,
      questionsToGenerate: 0,
      skipReason: 'quota_reached',
    };
  }

  // Count this week's questions (Monday 00:00 UTC → now)
  const weekStart = getMondayUTC(now).toISOString();
  const { count: weekCount, error: weekErr } = await sb
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', league.id)
    .eq('source', 'ai_generated')
    .gte('created_at', weekStart);

  if (weekErr) throw new Error(`quota week count failed: ${weekErr.message}`);
  const quotaUsedThisWeek = weekCount ?? 0;

  const weeklyRemaining = league.ai_weekly_quota - quotaUsedThisWeek;
  const totalRemaining = league.ai_total_quota - quotaUsedTotal;

  // For prematch, bypass PER_RUN_CAP — the effective cap is prematch_question_budget
  // applied in index.ts (leagueQuotaCap). For live, PER_RUN_CAP prevents flooding.
  const cap = isPrematch ? Infinity : PER_RUN_CAP;
  const questionsToGenerate = Math.min(weeklyRemaining, totalRemaining, cap);

  return {
    quotaTotal: league.ai_total_quota,
    quotaUsedTotal,
    quotaUsedThisWeek,
    questionsToGenerate: Math.max(0, questionsToGenerate),
  };
}

// ── Fetch recent question texts (dedup check for AI prompt) ──────────

export async function getRecentQuestionTexts(
  sb: SupabaseClient,
  leagueId: string,
  limit = 10,
): Promise<string[]> {
  const { data, error } = await sb
    .from('questions')
    .select('question_text, created_at')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []).map((q) => q.question_text);
}

// ── Utility: get Monday 00:00 UTC for the current week ───────────────

function getMondayUTC(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Tier → weekly quota lookup ────────────────────────────────────────

export function getWeeklyQuotaForTier(tier: string): number {
  switch (tier) {
    case 'elite': return 10;
    case 'pro':   return 5;
    default:      return 2;   // starter
  }
}

// ── Real World quota check ────────────────────────────────────────────
// Enforces per-tier Real World question limits before questions are attached.
// Called once per league per generation run — does NOT block CORE_MATCH questions.

export async function checkRealWorldQuota(
  sb: SupabaseClient,
  leagueId: string,
  ownerTier: string,
): Promise<{ allowed: boolean; skipReason?: string }> {
  // Step 1: Daily cap — MVP safety rule, applies to ALL tiers including elite.
  // Max 1 REAL_WORLD question per league per day.
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { count: dailyCount, error: dailyErr } = await sb
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('question_type', 'REAL_WORLD')
    .gte('created_at', todayStart);
  if (!dailyErr && (dailyCount ?? 0) >= 1) {
    return { allowed: false, skipReason: 'real_world_daily_cap' };
  }

  // Step 2: Tier rule
  if (ownerTier === 'elite') return { allowed: true };
  if (ownerTier !== 'pro') {
    return { allowed: false, skipReason: 'real_world_tier_locked' };
  }
  // Pro: check monthly usage for this league
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { count, error } = await sb
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('question_type', 'REAL_WORLD')
    .gte('created_at', monthStart);
  if (error) {
    console.warn('[real_world_quota] count query failed:', error.message);
    return { allowed: false, skipReason: 'real_world_quota_check_failed' };
  }
  const RW_PRO_MONTHLY_LIMIT = 10;
  if ((count ?? 0) >= RW_PRO_MONTHLY_LIMIT) {
    return { allowed: false, skipReason: 'real_world_quota_reached' };
  }
  return { allowed: true };
}
