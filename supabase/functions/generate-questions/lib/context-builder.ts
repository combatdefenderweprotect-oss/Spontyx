import type {
  LeagueWithConfig,
  LeagueClassification,
  SportsContext,
  NewsItem,
  LiveMatchContext,
} from './types.ts';

// ── Sport-specific duration buffers (minutes after kickoff) ──────────
const RESOLVE_BUFFER: Record<string, number> = {
  football: 150,   // 90 min + extra time + post-match buffer
  hockey:   180,   // 3 periods + OT + buffer
  tennis:   240,   // long matches + buffer
};

// ── Live anchored-window constants ────────────────────────────────────
// These govern how prediction windows are computed for CORE_MATCH_LIVE questions.
// All values are injected into the context packet for live generation modes.
const LIVE_WINDOW = {
  timeDrivenStartBufferMinutes:    3,   // time-driven: add 3 min buffer after current match minute (matches docs/LIVE_QUESTION_SYSTEM.md minimum gap rule)
  eventDrivenStartBufferMinutes:   3,   // event-driven: add 3 min (longer — trigger event may already be visible)
  defaultWindowSizeMinutes:        5,   // width of the prediction window
  minimumWindowSizeMinutes:        3,
  maximumWindowSizeMinutes:        7,
  timeDrivenVisibleDelaySeconds:  20,   // time-driven: question appears 20s after generation
  eventDrivenVisibleDelaySeconds: 45,   // event-driven: longer delay to absorb broadcast lag
  timeDrivenSettleBufferSeconds:  90,   // resolves_after gap for time-driven questions
  eventDrivenSettleBufferSeconds: 120,  // resolves_after gap for event-driven questions
} as const;

/**
 * Converts a football match minute to a wall-clock UTC ISO timestamp.
 * Accounts for the halftime break: minutes 46+ have a 15-minute gap added.
 *
 * Example: kickoff=14:00 UTC, minute=63 → 14:00 + 63min + 15min(HT) = 16:58 UTC
 */
export function minuteToTimestamp(kickoffIso: string, minute: number): string {
  const kickoffMs     = new Date(kickoffIso).getTime();
  const halftimeGapMs = minute > 45 ? 15 * 60 * 1000 : 0;
  const offsetMs      = minute * 60 * 1000 + halftimeGapMs;
  return new Date(kickoffMs + offsetMs).toISOString();
}

// ── Map internal GenerationMode → new prompt's generation_mode string ─
function toPromptMode(mode: string): string {
  if (mode === 'match_preview' || mode === 'narrative_preview') return 'prematch';
  if (mode === 'narrative_only') return 'prematch';
  return mode; // pass through live_event, live_gap directly
}

// ── Build the full context packet string for OpenAI Call 1 (v1.2) ────

export function buildContextPacket(params: {
  league: LeagueWithConfig;
  classification: LeagueClassification;
  sportsCtx: SportsContext;
  newsItems: NewsItem[];
  recentQuestions: string[];
  questionsToGenerate: number;
  existingQuestionCount?: number;
  recentCategories?: string[];
  recentStatFocus?: string[];
  matchPhase?: 'early' | 'mid' | 'late' | null;
  lastEventType?: 'goal' | 'penalty' | 'red_card' | 'yellow_card' | 'none';
  activeQuestionCount?: number;
  maxActiveQuestions?: number;
  matchMinute?: number | null;   // current match minute — null for prematch, integer for live
}): string {
  const {
    league, classification, sportsCtx, newsItems, recentQuestions, questionsToGenerate,
    existingQuestionCount = 0,
    recentCategories = [],
    recentStatFocus = [],
    matchPhase = null,
    lastEventType = 'none',
    activeQuestionCount = 0,
    maxActiveQuestions = 3,
    matchMinute = null,
  } = params;
  const { generationMode, hoursUntilKickoff } = classification;

  const promptMode = toPromptMode(generationMode);
  const leagueType = league.league_end_date ? 'Type2_season' : 'Type1_single_match';
  const maxAllowed = questionsToGenerate;
  const targetLow = Math.max(1, Math.floor(questionsToGenerate * 0.6));
  const targetRange = `${targetLow}–${questionsToGenerate}`;

  const sections: string[] = [];

  // Primary match (most imminent)
  const primaryMatch = sportsCtx.upcomingMatches[0] ?? null;

  // ── Match context block ────────────────────────────────────────────
  const matchBlock: string[] = ['MATCH CONTEXT', '-------------'];
  matchBlock.push(`sport: ${league.sport}`);
  matchBlock.push(`league_type: ${leagueType}`);
  matchBlock.push(`generation_mode: ${promptMode}`);

  if (primaryMatch) {
    matchBlock.push(`match_id: ${primaryMatch.id}`);
    matchBlock.push(`home_team: ${primaryMatch.homeTeam.name} (id: ${primaryMatch.homeTeam.id})`);
    matchBlock.push(`away_team: ${primaryMatch.awayTeam.name} (id: ${primaryMatch.awayTeam.id})`);
    matchBlock.push(`competition: ${primaryMatch.competition}`);
    matchBlock.push(`kickoff: ${primaryMatch.kickoff}${hoursUntilKickoff !== null ? ' (' + hoursUntilKickoff + 'h away)' : ''}`);
  } else {
    matchBlock.push('match_id: null');
    matchBlock.push('(no upcoming match data)');
  }

  // Current time — OpenAI uses this to compute visible_from / answer_closes_at / resolves_after
  matchBlock.push(`now_timestamp: ${new Date().toISOString()}`);

  // Live fields — null for prematch; populated by live generation pipeline (post-MVP)
  matchBlock.push(`match_minute: ${matchMinute ?? 'null'}`);
  matchBlock.push(`match_phase: ${matchPhase ?? 'null'}`);
  matchBlock.push('current_score: null');
  matchBlock.push('recent_events: []');
  matchBlock.push(`last_event_type: ${lastEventType}`);
  matchBlock.push('is_close_game: null');
  matchBlock.push('is_blowout: false');

  // Pool control fields
  matchBlock.push(`existing_question_count: ${existingQuestionCount}`);
  matchBlock.push(`target_question_range: ${targetRange}`);
  matchBlock.push(`max_questions_allowed: ${maxAllowed}`);
  matchBlock.push(`question_budget_remaining: ${questionsToGenerate}`);

  // Active question control
  matchBlock.push(`active_question_count: ${activeQuestionCount}`);
  matchBlock.push(`max_active_questions: ${maxActiveQuestions}`);

  // Diversity fields
  matchBlock.push(`recent_question_categories: [${recentCategories.join(', ')}]`);
  matchBlock.push(`recent_stat_focus: [${recentStatFocus.join(', ')}]`);

  if (league.scope === 'team_specific' && league.scoped_team_name) {
    matchBlock.push(`scoped_team: ${league.scoped_team_name} (focus questions on this team)`);
  }

  sections.push(matchBlock.join('\n'));

  // ── Entity reference (IDs the model must use) ────────────────────
  if (sportsCtx.upcomingMatches.length > 0) {
    const idLines = ['ENTITY REFERENCE — use ONLY these IDs in predicate_hint', '---------------------------------------------------------'];
    for (const m of sportsCtx.upcomingMatches.slice(0, 3)) {
      idLines.push(`match_id: ${m.id}  |  ${m.homeTeam.name} (team_id: ${m.homeTeam.id}) vs ${m.awayTeam.name} (team_id: ${m.awayTeam.id})  |  kickoff: ${m.kickoff}`);
    }
    sections.push(idLines.join('\n'));
  }

  // ── Live window constants (live modes with known match minute only) ─
  // Pre-computes anchor points so OpenAI doesn't need to derive them from scratch.
  // Injected only when the match is in progress (matchMinute is a non-null integer).
  if (promptMode !== 'prematch' && matchMinute !== null && primaryMatch) {
    const isEventDriven    = lastEventType !== 'none';
    const startBuffer      = isEventDriven
      ? LIVE_WINDOW.eventDrivenStartBufferMinutes
      : LIVE_WINDOW.timeDrivenStartBufferMinutes;
    const windowStart      = matchMinute + startBuffer;
    const windowEnd        = windowStart + LIVE_WINDOW.defaultWindowSizeMinutes;
    const settleBuffer     = isEventDriven
      ? LIVE_WINDOW.eventDrivenSettleBufferSeconds
      : LIVE_WINDOW.timeDrivenSettleBufferSeconds;
    const visibleDelay     = isEventDriven
      ? LIVE_WINDOW.eventDrivenVisibleDelaySeconds
      : LIVE_WINDOW.timeDrivenVisibleDelaySeconds;
    const kickoff          = primaryMatch.kickoff;

    const wLines = ['LIVE WINDOW CONSTANTS', '---------------------'];
    wLines.push(`current_match_minute: ${matchMinute}`);
    wLines.push(`suggested_window_start_minute: ${windowStart}  (match_minute + ${startBuffer} min buffer)`);
    wLines.push(`suggested_window_end_minute: ${windowEnd}  (window_start + ${LIVE_WINDOW.defaultWindowSizeMinutes} min)`);
    wLines.push(`minimum_window_size_minutes: ${LIVE_WINDOW.minimumWindowSizeMinutes}`);
    wLines.push(`maximum_window_size_minutes: ${LIVE_WINDOW.maximumWindowSizeMinutes}`);
    wLines.push(`visible_from_delay_seconds: ${visibleDelay}`);
    wLines.push(`settle_buffer_seconds: ${settleBuffer}`);
    wLines.push(`answer_closes_at_for_window: ${minuteToTimestamp(kickoff, windowStart)}  (= kickoff + window_start_minute)`);
    wLines.push(`resolves_after_for_window: ${minuteToTimestamp(kickoff, windowEnd)}  + ${settleBuffer}s settle  = ${
      new Date(new Date(minuteToTimestamp(kickoff, windowEnd)).getTime() + settleBuffer * 1000).toISOString()
    }`);
    wLines.push('');
    wLines.push('TIMING RULE (STRICT):');
    wLines.push(`  answer_closes_at = kickoff + window_start_minute minutes  (pre-computed above)`);
    wLines.push(`  resolves_after   = kickoff + window_end_minute minutes + ${settleBuffer}s`);
    wLines.push(`  visible_from     = now_timestamp + ${visibleDelay}s`);
    wLines.push('  answer_closes_at must be BEFORE visible_from + answer window so users cannot answer DURING the predicted window');
    sections.push(wLines.join('\n'));
  }

  // ── Match analysis signals (prematch only) ───────────────────────
  // Compute explicit signals so the model does not need to do positional
  // arithmetic from the raw standings table — avoids unreliable model math.
  if (promptMode === 'prematch' && primaryMatch) {
    const hmId = String(primaryMatch.homeTeam.id);
    const awId = String(primaryMatch.awayTeam.id);

    // Search the full standings array (not the top-8-sliced view used below)
    const hmStanding = sportsCtx.standings.find((s) => String(s.team.id) === hmId);
    const awStanding = sportsCtx.standings.find((s) => String(s.team.id) === awId);

    const maLines: string[] = ['MATCH ANALYSIS', '--------------'];

    if (hmStanding && awStanding) {
      const gap       = Math.abs(hmStanding.position - awStanding.position);
      const hmHigher  = hmStanding.position < awStanding.position; // lower number = higher in table
      const favourite = hmHigher ? primaryMatch.homeTeam.name : primaryMatch.awayTeam.name;
      const underdog  = hmHigher ? primaryMatch.awayTeam.name  : primaryMatch.homeTeam.name;
      const matchType = gap >= 6 ? 'HEAVY_FAVOURITE' : gap <= 3 ? 'CLOSE_MATCH' : 'MODERATE';

      maLines.push(`home_position: ${hmStanding.position}  |  away_position: ${awStanding.position}`);
      maLines.push(`standing_gap: ${gap}  |  table_favourite: ${favourite}  |  table_underdog: ${underdog}`);
      maLines.push(`home_goal_diff: ${hmStanding.goalDifference >= 0 ? '+' : ''}${hmStanding.goalDifference}  |  away_goal_diff: ${awStanding.goalDifference >= 0 ? '+' : ''}${awStanding.goalDifference}`);
      maLines.push(`match_type: ${matchType}`);

      if (matchType === 'HEAVY_FAVOURITE') {
        maLines.push(`⚠ HEAVY FAVOURITE: Do NOT ask "Will ${favourite} win?" — ask about goal margin, clean sheet, or underdog scoring`);
      } else if (matchType === 'CLOSE_MATCH') {
        maLines.push(`✓ CLOSE MATCH: Winner / draw / 2+ goals questions are valid and interesting`);
      } else {
        maLines.push(`→ MODERATE: Apply standard question mix — both outcome and stat questions are appropriate`);
      }
    } else {
      // Standings incomplete — can't determine match type
      maLines.push('match_type: UNKNOWN (standings not available for one or both teams — apply MODERATE rules)');
      maLines.push('standing_gap: null');
    }

    sections.push(maLines.join('\n'));
  }

  // ── Key players ───────────────────────────────────────────────────
  if (sportsCtx.keyPlayers.length > 0) {
    const playerLines = ['KEY PLAYERS', '-----------'];
    for (const p of sportsCtx.keyPlayers.slice(0, 12)) {
      const statusNote = p.injuryStatus !== 'fit' ? ` [${p.injuryStatus}${p.injuryNote ? ': ' + p.injuryNote : ''}]` : '';
      const formNote   = p.recentForm ? ` — ${p.recentForm}` : '';
      playerLines.push(`player_id: ${p.id}  |  ${p.name}  |  ${p.teamName} (${p.teamId})${p.position ? '  |  ' + p.position : ''}${statusNote}${formNote}`);
    }
    sections.push(playerLines.join('\n'));
  }

  // ── Player availability ───────────────────────────────────────────
  const availability = sportsCtx.playerAvailability ?? [];
  if (availability.length > 0) {
    const unavailable = availability.filter((a) => a.status === 'unavailable');
    const doubtful    = availability.filter((a) => a.status === 'doubtful');
    const starters    = availability.filter((a) => a.status === 'starting').slice(0, 10);
    const substitutes = availability.filter((a) => a.status === 'substitute').slice(0, 10);

    const paLines: string[] = ['PLAYER AVAILABILITY', '-------------------'];
    let hasContent = false;

    if (unavailable.length > 0) {
      hasContent = true;
      paLines.push('BLOCKED — DO NOT generate any player-specific question about these players:');
      for (const p of unavailable) {
        const r = p.reason ? `  |  ${p.reason}` : '';
        paLines.push(`player_id: ${p.playerId}  |  ${p.playerName}  |  ${p.teamName}  |  UNAVAILABLE${r}`);
      }
    }

    if (doubtful.length > 0) {
      hasContent = true;
      paLines.push('DOUBTFUL — avoid player-specific questions; prefer team-based alternatives:');
      for (const p of doubtful) {
        const r = p.reason ? `  |  ${p.reason}` : '';
        paLines.push(`player_id: ${p.playerId}  |  ${p.playerName}  |  ${p.teamName}${r}`);
      }
    }

    // Only include confirmed lineup data when the match is ≤6h away.
    // For prematch questions generated 24–48h before kickoff, lineup data is
    // rarely available and including it makes prematch question quality worse —
    // OpenAI avoids player questions when starters are not confirmed yet.
    // Injuries/suspensions (unavailable/doubtful above) are always included.
    const includeLineup = hoursUntilKickoff !== null && hoursUntilKickoff <= 6;

    if (includeLineup && starters.length > 0) {
      hasContent = true;
      paLines.push('CONFIRMED STARTERS (lineup released — do NOT ask "Will X start?"):');
      for (const p of starters) {
        paLines.push(`player_id: ${p.playerId}  |  ${p.playerName}  |  ${p.teamName}  |  Starting XI`);
      }
    }

    if (includeLineup && substitutes.length > 0) {
      hasContent = true;
      paLines.push('CONFIRMED BENCH (lineup released — player is named substitute, NOT starting — do NOT ask "Will X start?"):');
      for (const p of substitutes) {
        paLines.push(`player_id: ${p.playerId}  |  ${p.playerName}  |  ${p.teamName}  |  Substitute`);
      }
    }

    if (hasContent) sections.push(paLines.join('\n'));
  }

  // ── Standings + form ─────────────────────────────────────────────
  if (sportsCtx.standings.length > 0 || sportsCtx.form.length > 0) {
    const sfLines: string[] = [];
    if (sportsCtx.standings.length > 0) {
      sfLines.push('STANDINGS (top 8)');
      sfLines.push('-----------------');
      for (const s of sportsCtx.standings.slice(0, 8)) {
        sfLines.push(`${s.position}. ${s.team.name.padEnd(22)} pts:${String(s.points).padStart(3)}  GD:${s.goalDifference >= 0 ? '+' : ''}${s.goalDifference}`);
      }
    }
    if (sportsCtx.form.filter((f) => f.last5.length > 0).length > 0) {
      sfLines.push('');
      sfLines.push('RECENT FORM (last 5)');
      sfLines.push('--------------------');
      for (const f of sportsCtx.form) {
        if (!f.last5.length) continue;
        sfLines.push(`${f.teamName}: ${f.last5.join(' ')}${f.homeRecord ? '  (home: ' + f.homeRecord + ')' : ''}`);
      }
    }
    if (sfLines.length > 0) sections.push(sfLines.join('\n'));
  }

  // ── Narrative hooks ───────────────────────────────────────────────
  if (sportsCtx.narrativeHooks.length > 0) {
    const hookLines = ['NARRATIVE HOOKS', '---------------'];
    for (const h of sportsCtx.narrativeHooks) hookLines.push(`- ${h}`);
    sections.push(hookLines.join('\n'));
  }

  // ── News ──────────────────────────────────────────────────────────
  if (newsItems.length > 0) {
    const newsLines = ['NEWS CONTEXT (anchor to stats/results, not news events)', '--------------------------------------------------------'];
    for (const item of newsItems) {
      const date = new Date(item.publishedAt).toISOString().split('T')[0];
      newsLines.push(`[${date}] ${item.headline} — ${item.summary}`);
    }
    sections.push(newsLines.join('\n'));
  }

  // ── Recent questions (dedup) ─────────────────────────────────────
  if (recentQuestions.length > 0) {
    const rqLines = ['RECENT QUESTIONS (do not repeat these)', '---------------------------------------'];
    for (const q of recentQuestions) rqLines.push(`- ${q}`);
    sections.push(rqLines.join('\n'));
  }

  return sections.filter(Boolean).join('\n\n');
}

// ── Build the predicate conversion prompt (Call 2) ────────────────────

export function buildPredicatePrompt(params: {
  questionText: string;
  type: 'binary' | 'multiple_choice';
  options: Array<{ id: string; text: string }> | null;
  resolutionRuleText: string;
  matches: SportsContext['upcomingMatches'];
  players: SportsContext['keyPlayers'];
  sport: string;
}): string {
  const { questionText, type, options, resolutionRuleText, matches, players, sport } = params;

  const matchRefs = matches
    .map((m) => `match_id: ${m.id}  |  ${m.homeTeam.name} (${m.homeTeam.id}) vs ${m.awayTeam.name} (${m.awayTeam.id})  |  kickoff: ${m.kickoff}`)
    .join('\n');

  const playerRefs = players
    .map((p) => `player_id: ${p.id}  |  ${p.name}  |  team: ${p.teamName} (${p.teamId})`)
    .join('\n');

  return `RESOLUTION RULE
---------------
${resolutionRuleText}

QUESTION
--------
Text: ${questionText}
Type: ${type}
${options ? 'Options:\n' + options.map((o) => `  ${o.id}: ${o.text}`).join('\n') : ''}

AVAILABLE ENTITY IDs
--------------------
Matches:
${matchRefs || '(none)'}

Players:
${playerRefs || '(none)'}

Sport: ${sport}

CRITICAL RULES
--------------
1. Questions about match winner or draw MUST use Shape A (match_outcome). NEVER use match_stat for winner/draw questions.
2. player_stat ALWAYS requires match_id. Never omit match_id for player_stat.
3. Use ONLY the entity IDs listed above. Do not invent IDs.

REQUIRED OUTPUT SCHEMA
-----------------------
Return ONE JSON object matching exactly one of these shapes:

Shape A — match_outcome (use for: "who wins", "will X win", "will there be a draw"):
{ "resolution_type":"match_outcome", "match_id":string, "sport":string,
  "binary_condition":{"field":"winner_team_id","operator":"eq","value":string} }

Shape B — match_stat (use for: goals total, cards, corners, scores — NOT for winner/draw):
{ "resolution_type":"match_stat", "match_id":string, "sport":string,
  "binary_condition":{"field":string,"operator":"eq"|"gt"|"gte"|"lt"|"lte","value":number} }

Shape C — player_stat (match_id is REQUIRED — never omit it):
{ "resolution_type":"player_stat", "match_id":string, "player_id":string, "sport":string,
  "binary_condition":{"field":string,"operator":"eq"|"gt"|"gte"|"lt"|"lte","value":number} }

Shape D — player_status:
{ "resolution_type":"player_status", "player_id":string, "sport":string,
  "check_at":ISO timestamp,
  "binary_condition":{"field":"injury_status","operator":"eq","value":string} }

Shape E — multiple_choice_map (use when type = multiple_choice):
{ "resolution_type":"multiple_choice_map",
  "source":"match_outcome"|"match_stat"|"player_stat",
  "match_id":string|null, "player_id":string|null, "sport":string,
  "field":string,
  "options":[{"id":string,"operator":"eq"|"gt"|"gte"|"lt"|"lte","value":number|string},...] }

Shape F — match_stat_window (use for live anchored-window questions):
  Trigger phrase: predicate_hint contains "match_stat_window:" and "from_minute" and "to_minute"
{ "resolution_type":"match_stat_window",
  "match_id":string, "sport":string,
  "field":"goals"|"cards",
  "operator":"eq"|"gt"|"gte"|"lt"|"lte",
  "value":number,
  "window_start_minute":integer,
  "window_end_minute":integer }
  Example hint: "match_stat_window: goals gte 1 from_minute 58 to_minute 63"
  → field="goals", operator="gte", value=1, window_start_minute=58, window_end_minute=63

Shape G — btts (use ONLY for "Will both teams score?"):
  Trigger phrase: predicate_hint contains "btts"
{ "resolution_type":"btts", "match_id":string, "sport":string }
  No binary_condition — the resolver evaluates home_score >= 1 AND away_score >= 1 directly.
  Example hint: "btts: both teams to score"

Valid fields:
  match_outcome:  winner_team_id, draw
  match_stat:     total_goals, total_cards, total_corners, home_score, away_score, shots_total
  player_stat:    goals, assists, shots, cards, minutes_played, clean_sheet
  player_status:  injury_status (values: "fit","injured","doubtful","suspended")
  match_stat_window: goals, cards  (only these two — no corners, no team-specific stats)
  btts:           (no field — resolves from match scores directly)

Return ONLY the JSON object. No explanation. No markdown.`;
}

// ── Compute resolves_after from kickoff + sport buffer ────────────────

export function computeResolvesAfter(kickoff: string, sport: string): string {
  const bufferMinutes = RESOLVE_BUFFER[sport] ?? 180;
  const d = new Date(kickoff);
  d.setMinutes(d.getMinutes() + bufferMinutes);
  return d.toISOString();
}

// ── Build live match context from live_match_stats + active questions ──
//
// Called by the live generation branch in index.ts for each in_progress fixture.
// Reads from two sources:
//   - live_match_stats: populated every minute by live-stats-poller
//   - questions: pending CORE_MATCH_LIVE questions for the league+match
//
// Returns null if live_match_stats has no row for this fixture yet (not yet polled).

export async function buildLiveContext(
  sb: any,
  leagueId: string,
  matchId: string,
  fixtureRow: any,  // row from api_football_fixtures
): Promise<LiveMatchContext | null> {

  // ── 1. Read live match stats ────────────────────────────────────────
  const { data: liveData, error: liveErr } = await sb
    .from('live_match_stats')
    .select('home_score, away_score, status, minute, events')
    .eq('fixture_id', parseInt(matchId, 10))
    .maybeSingle();

  if (liveErr) console.warn(`[buildLiveContext] live_match_stats read error for fixture ${matchId}:`, liveErr.message);
  if (!liveData) return null;  // not yet polled — skip gracefully

  const matchMinute    = liveData.minute  ?? 0;
  const homeScore      = liveData.home_score ?? 0;
  const awayScore      = liveData.away_score ?? 0;
  const scoreDiff      = Math.abs(homeScore - awayScore);
  const isCloseGame    = scoreDiff <= 1;
  const isBlowout      = scoreDiff >= 3;

  // Match phase: maps to the three phases used by buildContextPacket
  let matchPhase: LiveMatchContext['matchPhase'];
  if (matchMinute < 20)      matchPhase = 'early';
  else if (matchMinute < 70) matchPhase = 'mid';
  else                       matchPhase = 'late';

  // ── 2. Most recent LIVE question for this league+match ──────────────
  const { data: recentLiveRows } = await sb
    .from('questions')
    .select('match_minute_at_generation, created_at')
    .eq('league_id', leagueId)
    .eq('match_id', matchId)
    .eq('question_type', 'CORE_MATCH_LIVE')
    .order('created_at', { ascending: false })
    .limit(1);

  const lastGenerationMinute: number | null = recentLiveRows?.[0]?.match_minute_at_generation ?? null;

  // ── 3. Parse recent events from live_match_stats.events JSONB ───────
  type RawEvent = { time?: number; type?: string; detail?: string | null; team_id?: number };
  const allEvents: LiveMatchContext['recentEvents'] = (liveData.events ?? []).map((e: RawEvent) => ({
    time:    e.time    ?? 0,
    type:    e.type    ?? '',
    detail:  e.detail  ?? null,
    team_id: e.team_id ?? 0,
  }));

  // Events since last generation (or last 10 minutes if no prior LIVE question)
  const sinceMinute = lastGenerationMinute ?? Math.max(0, matchMinute - 10);
  const recentEvents = allEvents.filter((e) => e.time > sinceMinute && e.time <= matchMinute);

  // ── 4. Detect significant events (goal / penalty / red card / yellow card) ──
  // Own goals excluded — too rare and confusing for prediction questions
  const sigEvents = recentEvents
    .filter((e) =>
      (e.type === 'Goal'    && e.detail !== 'Own Goal') ||
      (e.type === 'Card'    && e.detail === 'Red Card') ||
      (e.type === 'Card'    && e.detail === 'Yellow Card') ||
      (e.type === 'Var'     && e.detail === 'Penalty Confirmed'),
    )
    .sort((a, b) => b.time - a.time);  // most recent first

  let lastEventType: LiveMatchContext['lastEventType']  = 'none';
  let lastEventMinute: number | null                    = null;

  if (sigEvents.length > 0) {
    const latest = sigEvents[0];
    if (latest.type === 'Goal') {
      lastEventType = 'goal';
    } else if (latest.type === 'Var') {
      lastEventType = 'penalty';
    } else if (latest.detail === 'Red Card') {
      lastEventType = 'red_card';
    } else {
      lastEventType = 'yellow_card';
    }
    lastEventMinute = latest.time;
  }

  const generationTrigger: LiveMatchContext['generationTrigger'] =
    lastEventType !== 'none' ? 'event_driven' : 'time_driven';

  // ── 5. Active prediction windows from pending LIVE questions ─────────
  const { data: activeQRows } = await sb
    .from('questions')
    .select('resolution_predicate, answer_closes_at')
    .eq('league_id', leagueId)
    .eq('match_id', matchId)
    .eq('question_type', 'CORE_MATCH_LIVE')
    .eq('resolution_status', 'pending')
    .gt('answer_closes_at', new Date().toISOString());

  const activeWindows: LiveMatchContext['activeWindows'] = [];
  for (const q of (activeQRows ?? [])) {
    const pred = q.resolution_predicate as any;
    if (
      pred?.resolution_type === 'match_stat_window' &&
      pred.window_start_minute != null &&
      pred.window_end_minute   != null
    ) {
      activeWindows.push({ start: pred.window_start_minute, end: pred.window_end_minute });
    }
  }

  const activeQuestionCount = (activeQRows ?? []).length;

  return {
    matchId,
    kickoff:              fixtureRow.kickoff_at,
    homeTeamId:           String(fixtureRow.home_team_id),
    homeTeamName:         fixtureRow.home_team_name,
    awayTeamId:           String(fixtureRow.away_team_id),
    awayTeamName:         fixtureRow.away_team_name,
    matchMinute,
    matchPhase,
    homeScore,
    awayScore,
    isCloseGame,
    isBlowout,
    recentEvents,
    lastEventType,
    lastEventMinute,
    activeWindows,
    activeQuestionCount,
    generationTrigger,
    lastGenerationMinute,
  };
}
