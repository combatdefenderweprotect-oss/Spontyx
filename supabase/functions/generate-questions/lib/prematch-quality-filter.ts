// ── Prematch quality pre-filter ───────────────────────────────────────
//
// Runs AFTER generateQuestions() (Call 1) and BEFORE convertToPredicate()
// (Call 2), so low-quality questions are discarded without spending tokens
// on predicate conversion.
//
// Does NOT replace the 5-stage predicate-validator. Both layers run.
// The validator enforces structural/schema correctness.
// This filter enforces editorial quality: diversity, balance, obviousness.
//
// Only applies to CORE_MATCH_PREMATCH questions (generation_trigger = 'prematch_only').
// Live and REAL_WORLD questions pass through unchanged.

import type { RawGeneratedQuestion } from './types.ts';

// ── Context supplied by the caller (built from sportsCtx in index.ts) ─

export interface PrematchBatchContext {
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  // Absolute difference between league table positions (|home_pos - away_pos|).
  // null = standings data unavailable for this match.
  standingGap: number | null;
  scopedTeamId: string | null;
  scopedTeamName: string | null;
}

// ── Minimal info about questions already committed from prior rounds ──

export interface PriorQuestionInfo {
  question_text: string;
  player_id?: string;   // first player_id in player_ids[], if any
}

// ── Rejection record (appended to result.rejectionLog) ───────────────

export interface PrematchRejection {
  question_text: string;
  reason: string;
  score: number;
}

// ── Scoring result ────────────────────────────────────────────────────

export interface QualityScore {
  score: number;       // 0–100
  reasons: string[];   // one entry per penalty applied
}

// ─────────────────────────────────────────────────────────────────────
// Score a single prematch question against already-accepted questions
// in the same batch and questions committed in prior retry rounds.
//
// accepted  = questions accepted so far in THIS filter pass (current round)
// prior     = validatedQuestions already committed from PRIOR retry rounds
// ─────────────────────────────────────────────────────────────────────

export function scorePrematchQuestionQuality(
  q: RawGeneratedQuestion,
  accepted: RawGeneratedQuestion[],
  prior: PriorQuestionInfo[],
  ctx: PrematchBatchContext,
): QualityScore {
  let score = 100;
  const reasons: string[] = [];

  // ── 1. Obvious winner question in heavy-favourite match ─────────────
  // If one team is 5+ table positions above the other, asking "who wins?"
  // is ~80%+ obvious and adds no value. Penalise heavily.
  if (isOutcomeWinnerQuestion(q) && ctx.standingGap !== null && ctx.standingGap >= 5) {
    score -= 35;
    reasons.push('obvious_winner_heavy_favourite');
  }

  // ── 2. No standings data + winner question ──────────────────────────
  // Without standings we can't know if it's obvious, so we treat it as
  // potentially obvious and apply a lighter penalty.
  if (isOutcomeWinnerQuestion(q) && ctx.standingGap === null) {
    score -= 20;
    reasons.push('winner_question_no_standings_context');
  }

  // ── 3. Near-duplicate of accepted question in THIS round ────────────
  for (const a of accepted) {
    if (textSimilarity(q.question_text, a.question_text) >= 0.65) {
      score -= 40;
      reasons.push('near_duplicate_in_batch');
      break;
    }
  }

  // ── 4. Near-duplicate of a committed question from a prior round ────
  for (const p of prior) {
    if (textSimilarity(q.question_text, p.question_text) >= 0.65) {
      score -= 40;
      reasons.push('near_duplicate_prior_round');
      break;
    }
  }

  // ── 5. Same player already appears in accepted or prior questions ───
  const qPlayer = extractPlayerId(q.predicate_hint ?? '');
  if (qPlayer) {
    const playerInAccepted = accepted.some(
      (a) => extractPlayerId(a.predicate_hint ?? '') === qPlayer,
    );
    const playerInPrior = prior.some((p) => p.player_id === qPlayer);
    if (playerInAccepted || playerInPrior) {
      score -= 30;
      reasons.push('duplicate_player');
    }
  }

  // ── 6. Over-represented question category ──────────────────────────
  // Count how many accepted + prior questions share the same category.
  // 2+ already accepted → this question is redundant.
  const sameCategory = [
    ...accepted.filter((a) => a.question_category === q.question_category),
  ].length;
  if (sameCategory >= 2) {
    score -= 20;
    reasons.push('over_represented_category');
  }

  // ── 7. Poor team balance ────────────────────────────────────────────
  // If all accepted questions so far focus on the same team, and this
  // question also focuses on that same team, penalise the imbalance.
  if (accepted.length >= 2) {
    const dominantTeam = getDominantTeam(accepted, ctx);
    if (dominantTeam && isSingleTeamFocused(q, dominantTeam, ctx)) {
      score -= 15;
      reasons.push('poor_team_balance');
    }
  }

  // ── 8. Generic / suspiciously short question ────────────────────────
  const wordCount = (q.question_text ?? '').trim().split(/\s+/).length;
  if (wordCount <= 7) {
    score -= 25;
    reasons.push('weak_short_question');
  }

  // ── 9. Missing resolvability signal ────────────────────────────────
  // predicate_hint must reference at least a stat field or team ID.
  // match_id gets backfilled later, so absence here is only a soft penalty.
  const hint = (q.predicate_hint ?? '').toLowerCase();
  const hasResolvableHint = hint.length > 5 && (
    hint.includes('total_') ||
    hint.includes('winner_team') ||
    hint.includes('player_stat') ||
    hint.includes('match_stat') ||
    hint.includes('match_outcome') ||
    hint.includes('clean_sheet') ||
    hint.includes('btts') ||
    hint.includes('goals') ||
    hint.includes('score')
  );
  if (!hasResolvableHint) {
    score -= 20;
    reasons.push('weak_resolvability_hint');
  }

  return { score: Math.max(0, score), reasons };
}

// ─────────────────────────────────────────────────────────────────────
// Filter a batch of raw questions.
//
// Returns { accepted, rejected } where rejected entries carry the reason
// and quality score for logging into result.rejectionLog.
//
// quotaRemaining = how many more questions we still need (used to decide
//                 whether to keep marginal-quality questions).
// ─────────────────────────────────────────────────────────────────────

export function filterPrematchBatch(
  rawQuestions: RawGeneratedQuestion[],
  ctx: PrematchBatchContext,
  prior: PriorQuestionInfo[],
  quotaRemaining: number,
): { accepted: RawGeneratedQuestion[]; rejected: PrematchRejection[] } {
  const accepted: RawGeneratedQuestion[] = [];
  const rejected: PrematchRejection[]    = [];

  // Count player-specific questions already committed in prior rounds
  let playerSpecificCount = prior.filter((p) =>
    // Prior questions don't carry question_category; use player_id presence as proxy
    p.player_id !== undefined && p.player_id !== null,
  ).length;

  for (const q of rawQuestions) {
    // Pass non-prematch questions through unchanged
    if (q.generation_trigger !== 'prematch_only') {
      accepted.push(q);
      continue;
    }

    // ── Player-specific cap: max 2 per full batch (accepted + prior) ──
    if (q.question_category === 'player_specific') {
      const playerSpecificInAccepted = accepted.filter(
        (a) => a.question_category === 'player_specific',
      ).length;
      if (playerSpecificCount + playerSpecificInAccepted >= 2) {
        rejected.push({
          question_text: q.question_text,
          reason: normalizeReason('too_many_player_specific'),
          score: 0,
        });
        continue;
      }
    }

    const { score, reasons } = scorePrematchQuestionQuality(q, accepted, prior, ctx);

    // Hard reject: score < 60
    if (score < 60) {
      rejected.push({
        question_text: q.question_text,
        reason: normalizeReason(reasons[0] ?? 'low_quality_score'),
        score,
      });
      continue;
    }

    // Marginal (60–75): keep only if we still need questions to fill quota
    if (score < 75 && accepted.length >= quotaRemaining) {
      rejected.push({
        question_text: q.question_text,
        reason: normalizeReason('marginal_not_needed'),
        score,
      });
      continue;
    }

    // Accept
    accepted.push(q);
    if (q.question_category === 'player_specific') {
      // track for cap purposes (the main counter is across prior rounds)
      // no need to increment playerSpecificCount here — accepted array is checked above
    }
  }

  return { accepted, rejected };
}

// ─────────────────────────────────────────────────────────────────────
// Compute standing position gap between home and away teams.
// Returns null if standings are unavailable or teams can't be found.
// ─────────────────────────────────────────────────────────────────────

export function computeStandingGap(
  standings: Array<{ position: number; team: { id: string; name: string } }>,
  match: { homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string } } | undefined,
): number | null {
  if (!standings.length || !match) return null;

  const find = (teamId: string, teamName: string) =>
    standings.find(
      (s) => s.team.id === teamId || s.team.name.toLowerCase() === teamName.toLowerCase(),
    );

  const homeEntry = find(match.homeTeam.id, match.homeTeam.name);
  const awayEntry = find(match.awayTeam.id, match.awayTeam.name);

  if (!homeEntry || !awayEntry) return null;
  return Math.abs(homeEntry.position - awayEntry.position);
}

// ── Reason normalization ──────────────────────────────────────────
// Maps internal scoring reason codes → canonical analytics reason names.
// These canonical names are used in the analytics SQL views.

const REASON_MAP: Record<string, string> = {
  obvious_winner_heavy_favourite:      'too_obvious',
  winner_question_no_standings_context: 'too_obvious',
  near_duplicate_in_batch:             'duplicate_question',
  near_duplicate_prior_round:          'duplicate_question',
  duplicate_player:                    'duplicate_question',
  too_many_player_specific:            'too_many_player_specific',
  poor_team_balance:                   'poor_team_balance',
  over_represented_category:           'low_quality_score',
  weak_short_question:                 'low_quality_score',
  weak_resolvability_hint:             'low_quality_score',
  marginal_not_needed:                 'low_quality_score',
  low_quality_score:                   'low_quality_score',
};

function normalizeReason(raw: string): string {
  return REASON_MAP[raw] ?? 'low_quality_score';
}

// ── Private helpers ───────────────────────────────────────────────────

// Detect if a question is specifically asking "who wins the match?"
function isOutcomeWinnerQuestion(q: RawGeneratedQuestion): boolean {
  if (q.question_category !== 'outcome_state') return false;
  const subtype = (q.question_subtype ?? '').toLowerCase();
  const text    = (q.question_text ?? '').toLowerCase();
  const hint    = (q.predicate_hint ?? '').toLowerCase();
  return (
    subtype.includes('winner') ||
    subtype.includes('win') ||
    text.includes('win the match') ||
    text.includes('win the game') ||
    text.includes('who will win') ||
    hint.includes('winner_team_id')
  );
}

// Extract the first player_id from a predicate_hint string.
// predicate_hint format: "player_stat: goals gte 1 for player_id 123456"
function extractPlayerId(hint: string): string | null {
  const m = hint.match(/player_id[:\s=]+(\d+)/i);
  return m ? m[1] : null;
}

// Compute word-overlap similarity between two question texts (Jaccard on 4+ char words).
function textSimilarity(a: string, b: string): number {
  const wordsOf = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/[\s\W]+/).filter((w) => w.length >= 4));
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  const union        = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

// Return the team name that dominates the accepted set, or null if balanced.
function getDominantTeam(
  accepted: RawGeneratedQuestion[],
  ctx: PrematchBatchContext,
): string | null {
  let homeCount = 0;
  let awayCount = 0;
  for (const q of accepted) {
    const text  = (q.question_text ?? '').toLowerCase();
    const hint  = (q.predicate_hint ?? '').toLowerCase();
    const mentions = (name: string) => name.length > 2 && (text.includes(name.toLowerCase()) || hint.includes(name.toLowerCase()));
    const isHome = mentions(ctx.homeTeamName);
    const isAway = mentions(ctx.awayTeamName);
    if (isHome && !isAway) homeCount++;
    if (isAway && !isHome) awayCount++;
  }
  // A team "dominates" if it appears in ALL accepted questions so far
  if (homeCount === accepted.length) return ctx.homeTeamName;
  if (awayCount === accepted.length) return ctx.awayTeamName;
  return null;
}

// Return true if the question focuses only on a specific team (dominantTeam).
function isSingleTeamFocused(
  q: RawGeneratedQuestion,
  dominantTeamName: string,
  ctx: PrematchBatchContext,
): boolean {
  if (!dominantTeamName || dominantTeamName.length < 2) return false;
  const text      = (q.question_text ?? '').toLowerCase();
  const hint      = (q.predicate_hint ?? '').toLowerCase();
  const lower     = dominantTeamName.toLowerCase();
  const otherName = dominantTeamName === ctx.homeTeamName
    ? ctx.awayTeamName.toLowerCase()
    : ctx.homeTeamName.toLowerCase();
  const mentionsDominant = text.includes(lower) || hint.includes(lower);
  const mentionsOther    = otherName.length > 2 && (text.includes(otherName) || hint.includes(otherName));
  return mentionsDominant && !mentionsOther;
}

// ═════════════════════════════════════════════════════════════════════
// PART 2 — Post-predicate strict filter
//
// Runs AFTER convertToPredicate (Call 2), before validateQuestion.
// This is the authoritative dedup layer: it operates on structured
// predicate objects, not text heuristics.
//
// Responsibilities:
//   • Market-type uniqueness (one question per market per match)
//   • Predicate fingerprint dedup (exact logical duplicates)
//   • Text similarity dedup against DB questions
//   • Heavy-favourite winner hard reject
//   • Lineup-aware player question gating
//   • Team balance enforcement (≤70% per team)
//
// MatchMarketState is initialised from existing DB rows and mutated
// on each accept — callers must pass the same object across all
// questions for a given (league, match).
// ═════════════════════════════════════════════════════════════════════

// ── Per-match dedup state ─────────────────────────────────────────────

export interface MatchMarketState {
  markets:      Set<string>;   // canonical market_type keys
  fingerprints: Set<string>;   // predicate fingerprints
  texts:        string[];      // question_text of accepted/existing questions
  playerIds:    Set<string>;   // player_ids of player-specific questions
  playerCount:  number;        // total player-specific questions (for cap)
}

// ── Lineup context ────────────────────────────────────────────────────

export interface LineupContext {
  minutesToKickoff:   number;       // minutes from now to kickoff
  lineupAvailable:    boolean;      // any playerAvailability with source='lineup'
  confirmedPlayerIds: Set<string>;  // player_ids confirmed as starting_xi or substitute
}

// ─────────────────────────────────────────────────────────────────────
// Derive a canonical market_type string from a resolved predicate.
// Returns null for predicates that cannot be classified (novel/unknown types).
// ─────────────────────────────────────────────────────────────────────

export function deriveMarketType(
  predicate: unknown,
  homeTeamId: string,
  awayTeamId: string,
): string | null {
  const p = predicate as any;
  if (!p || typeof p !== 'object') return null;
  const type = p.resolution_type as string;
  const bc   = p.binary_condition as any;

  switch (type) {
    case 'match_outcome': {
      if (!bc) return 'match_outcome';
      if (bc.field === 'winner_team_id') {
        if (String(bc.value) === String(homeTeamId)) return 'home_win';
        if (String(bc.value) === String(awayTeamId)) return 'away_win';
        return 'match_outcome';
      }
      if (bc.field === 'draw') return 'draw';
      return 'match_outcome';
    }

    case 'match_stat': {
      if (!bc) return 'match_stat';
      const field = bc.field as string;
      const op    = bc.operator as string;
      const val   = bc.value;
      if (field === 'total_goals') {
        // Normalise threshold to a .5 boundary so "> 2" and ">= 3" share a market key.
        const norm = (op === 'gt' || op === 'lte')
          ? Number(val) + 0.5
          : Number(val) - 0.5;
        const dir = (op === 'lt' || op === 'lte') ? 'under' : 'over';
        return `${dir}_goals:${norm}`;
      }
      if (field === 'total_cards')   return 'cards_total';
      if (field === 'total_corners') return 'corners_total';
      if (field === 'shots_total')   return 'shots_total';
      // home_score=0 means the home team scored 0 → away team kept a clean sheet
      if (field === 'home_score' && op === 'eq' && val === 0) return 'clean_sheet_away';
      // away_score=0 means the away team scored 0 → home team kept a clean sheet
      if (field === 'away_score' && op === 'eq' && val === 0) return 'clean_sheet_home';
      if (field === 'home_score') return `home_score:${op}:${val}`;
      if (field === 'away_score') return `away_score:${op}:${val}`;
      return `match_stat:${field}`;
    }

    case 'btts': return 'btts';

    case 'match_stat_window': {
      const field = p.field as string;
      return `${field}_window:${p.window_start_minute}-${p.window_end_minute}`;
    }

    case 'player_stat': {
      const field = bc?.field as string;
      const pid   = String(p.player_id ?? '');
      if (!pid) return 'player_stat';
      if (field === 'goals')                                return `player_goal:${pid}`;
      if (field === 'assists')                              return `player_assist:${pid}`;
      if (field === 'shots')                                return `player_shots:${pid}`;
      if (field === 'cards' || field === 'yellow_cards')    return `player_card:${pid}`;
      if (field === 'clean_sheet')                          return `player_clean_sheet:${pid}`;
      if (field === 'passes_total' || field === 'passes_key') return `player_passes:${pid}`;
      return `player_stat:${pid}:${field}`;
    }

    case 'player_status':
      return `player_status:${String(p.player_id ?? '')}`;

    case 'match_lineup':
      return `player_lineup:${String(p.player_id ?? '')}`;

    case 'multiple_choice_map':
      return `mc:${p.source}:${p.field}`;

    case 'manual_review':
      return `manual_review:${p.category ?? ''}`;

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Stable fingerprint of a predicate's logical identity.
// Two predicates that resolve to the same outcome produce the same key.
// ─────────────────────────────────────────────────────────────────────

export function predicateFingerprint(predicate: unknown): string {
  const p = predicate as any;
  if (!p || typeof p !== 'object') return '';
  const type = p.resolution_type as string;
  const bc   = p.binary_condition;

  const key = (parts: Record<string, unknown>) =>
    JSON.stringify(parts, Object.keys(parts).sort());

  switch (type) {
    case 'match_outcome':
    case 'match_stat':
      return key({ t: type, mid: p.match_id, field: bc?.field, op: bc?.operator, val: bc?.value });

    case 'match_stat_window':
      return key({ t: type, mid: p.match_id, field: p.field, op: p.operator, val: p.value,
                   ws: p.window_start_minute, we: p.window_end_minute });

    case 'btts':
      return key({ t: type, mid: p.match_id });

    case 'player_stat':
      return key({ t: type, mid: p.match_id, pid: p.player_id,
                   field: bc?.field, op: bc?.operator, val: bc?.value });

    case 'player_status':
      return key({ t: type, pid: p.player_id, field: bc?.field });

    case 'match_lineup':
      return key({ t: type, mid: p.match_id, pid: p.player_id, check: p.check });

    case 'multiple_choice_map': {
      const sortedOpts = [...(p.options ?? [])].sort((a: any, b: any) =>
        String(a.id).localeCompare(String(b.id)),
      );
      return key({ t: type, mid: p.match_id, source: p.source, field: p.field, opts: sortedOpts });
    }

    case 'manual_review':
      return key({ t: type, cat: p.category, desc: p.description });

    default:
      return JSON.stringify(p);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Build initial MatchMarketState from existing DB rows.
// Call once per (league, match) before generation; pass the same
// object to filterPrematchPostPredicate for the entire generation run.
// ─────────────────────────────────────────────────────────────────────

export function buildMatchMarketState(
  existingQuestions: Array<{
    question_text: string;
    resolution_predicate: unknown;
    player_ids?: string[] | null;
  }>,
  homeTeamId: string,
  awayTeamId: string,
): MatchMarketState {
  const state: MatchMarketState = {
    markets:      new Set(),
    fingerprints: new Set(),
    texts:        [],
    playerIds:    new Set(),
    playerCount:  0,
  };
  for (const q of existingQuestions) {
    const mt = deriveMarketType(q.resolution_predicate, homeTeamId, awayTeamId);
    if (mt) state.markets.add(mt);
    const fp = predicateFingerprint(q.resolution_predicate);
    if (fp) state.fingerprints.add(fp);
    if (q.question_text) state.texts.push(q.question_text);
    const isPlayer = isPlayerPredicate(q.resolution_predicate);
    if (isPlayer) {
      const pid = extractPlayerIdFromPredicate(q.resolution_predicate);
      if (pid) state.playerIds.add(pid);
      state.playerCount++;
    }
  }
  return state;
}

// ─────────────────────────────────────────────────────────────────────
// Post-predicate strict filter — the authoritative gate.
//
// Returns { accept: true } or { accept: false, reason: string }.
// On accept, mutates matchState so subsequent questions see the update.
// ─────────────────────────────────────────────────────────────────────

export function filterPrematchPostPredicate(
  raw: RawGeneratedQuestion,
  predicate: unknown,
  matchState: MatchMarketState,
  ctx: PrematchBatchContext,
  lineup: LineupContext,
  batchTarget: number,
): { accept: boolean; reason?: string } {
  if (raw.generation_trigger !== 'prematch_only') return { accept: true };

  const p          = predicate as any;
  const isPlayer   = isPlayerPredicate(predicate);
  const pid        = isPlayer ? extractPlayerIdFromPredicate(predicate) : null;

  // ── 1. Player question gating (lineup-aware) ──────────────────────
  if (isPlayer) {
    if (lineup.minutesToKickoff > 60) {
      // Far from kickoff: only allow if player is confirmed in lineup data.
      // "Strongly confirmed" = source=lineup AND status=starting|substitute.
      if (!pid || !lineup.confirmedPlayerIds.has(pid)) {
        return { accept: false, reason: 'player_question_too_early' };
      }
    } else {
      // ≤60 min: require lineup data to exist
      if (!lineup.lineupAvailable) {
        return { accept: false, reason: 'player_question_no_lineup' };
      }
      // Lineup present → player must be in confirmed set
      if (pid && !lineup.confirmedPlayerIds.has(pid)) {
        return { accept: false, reason: 'player_not_in_lineup' };
      }
    }

    // Player uniqueness across DB + current batch
    if (pid && matchState.playerIds.has(pid)) {
      return { accept: false, reason: 'duplicate_player_post' };
    }

    // Player cap: ≤5 target → max 1 player question; >5 → max 2
    const playerCap = batchTarget <= 5 ? 1 : 2;
    if (matchState.playerCount >= playerCap) {
      return { accept: false, reason: 'player_cap_exceeded' };
    }
  }

  // ── 2. Market-type uniqueness ─────────────────────────────────────
  const marketType = deriveMarketType(predicate, ctx.homeTeamId, ctx.awayTeamId);
  if (marketType && matchState.markets.has(marketType)) {
    return { accept: false, reason: 'duplicate_market' };
  }

  // ── 3. Heavy-favourite winner hard reject ─────────────────────────
  if (
    marketType &&
    (marketType === 'home_win' || marketType === 'away_win') &&
    ctx.standingGap !== null &&
    ctx.standingGap >= 5
  ) {
    return { accept: false, reason: 'heavy_favourite_winner' };
  }

  // ── 4. Predicate fingerprint dedup ────────────────────────────────
  const fp = predicateFingerprint(predicate);
  if (fp && matchState.fingerprints.has(fp)) {
    return { accept: false, reason: 'duplicate_predicate' };
  }

  // ── 5. Text similarity dedup (vs DB + current batch) ─────────────
  for (const existing of matchState.texts) {
    if (textSimilarity(raw.question_text, existing) >= 0.65) {
      return { accept: false, reason: 'duplicate_question_text' };
    }
  }

  // ── 6. Team balance: single team must not exceed 70% ─────────────
  // Only enforced once we have ≥3 questions (small batches are exempt).
  if (matchState.texts.length >= 2) {
    let homeCount = 0;
    let awayCount = 0;
    const homeL = ctx.homeTeamName.toLowerCase();
    const awayL = ctx.awayTeamName.toLowerCase();
    for (const t of matchState.texts) {
      const tl = t.toLowerCase();
      if (homeL.length > 2 && tl.includes(homeL)) homeCount++;
      if (awayL.length > 2 && tl.includes(awayL)) awayCount++;
    }
    // Count this candidate too
    const nl = (raw.question_text ?? '').toLowerCase();
    if (homeL.length > 2 && nl.includes(homeL)) homeCount++;
    if (awayL.length > 2 && nl.includes(awayL)) awayCount++;

    const total = matchState.texts.length + 1;
    if (homeCount / total > 0.70 || awayCount / total > 0.70) {
      return { accept: false, reason: 'team_imbalance' };
    }
  }

  // ── Accept: mutate state ──────────────────────────────────────────
  if (marketType) matchState.markets.add(marketType);
  if (fp)         matchState.fingerprints.add(fp);
  matchState.texts.push(raw.question_text ?? '');
  if (isPlayer) {
    if (pid) matchState.playerIds.add(pid);
    matchState.playerCount++;
  }

  return { accept: true };
}

// ── Reason normalization for post-filter ──────────────────────────────
// Maps post-filter reject codes → canonical analytics reason names
// (same canonical vocabulary as the pre-filter REASON_MAP above).

const POST_REASON_MAP: Record<string, string> = {
  player_question_too_early:  'too_many_player_specific',
  player_question_no_lineup:  'too_many_player_specific',
  player_not_in_lineup:       'too_many_player_specific',
  duplicate_player_post:      'duplicate_question',
  player_cap_exceeded:        'too_many_player_specific',
  duplicate_market:           'duplicate_question',
  heavy_favourite_winner:     'too_obvious',
  duplicate_predicate:        'duplicate_question',
  duplicate_question_text:    'duplicate_question',
  team_imbalance:             'poor_team_balance',
};

export function normalizePostFilterReason(reason: string): string {
  return POST_REASON_MAP[reason] ?? 'low_quality_score';
}

// ── Private helpers (post-filter) ─────────────────────────────────────

function isPlayerPredicate(predicate: unknown): boolean {
  const type = (predicate as any)?.resolution_type;
  return type === 'player_stat' || type === 'player_status' || type === 'match_lineup';
}

function extractPlayerIdFromPredicate(predicate: unknown): string | null {
  const p = predicate as any;
  if (!p) return null;
  return p.player_id ? String(p.player_id) : null;
}
