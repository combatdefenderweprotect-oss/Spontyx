import type {
  LeagueWithConfig,
  LeagueClassification,
  SportsContext,
  NewsItem,
} from './types.ts';

// ── Sport-specific duration buffers (minutes after kickoff) ──────────
const RESOLVE_BUFFER: Record<string, number> = {
  football: 150,   // 90 min + extra time + post-match buffer
  hockey:   180,   // 3 periods + OT + buffer
  tennis:   240,   // long matches + buffer
};

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
  lastEventType?: 'goal' | 'penalty' | 'red_card' | 'none';
  activeQuestionCount?: number;
  maxActiveQuestions?: number;
}): string {
  const {
    league, classification, sportsCtx, newsItems, recentQuestions, questionsToGenerate,
    existingQuestionCount = 0,
    recentCategories = [],
    recentStatFocus = [],
    matchPhase = null,
    lastEventType = 'none',
    activeQuestionCount = 0,
    maxActiveQuestions = 2,  // MVP: hard cap at 2; post-launch target is 3
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

  // Live fields — null/defaults for prematch generation
  matchBlock.push('match_minute: null');
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

Valid fields:
  match_outcome:  winner_team_id, draw
  match_stat:     total_goals, total_cards, total_corners, home_score, away_score
  player_stat:    goals, assists, shots, cards, minutes_played, clean_sheet
  player_status:  injury_status (values: "fit","injured","doubtful","suspended")

Return ONLY the JSON object. No explanation. No markdown.`;
}

// ── Compute resolves_after from kickoff + sport buffer ────────────────

export function computeResolvesAfter(kickoff: string, sport: string): string {
  const bufferMinutes = RESOLVE_BUFFER[sport] ?? 180;
  const d = new Date(kickoff);
  d.setMinutes(d.getMinutes() + bufferMinutes);
  return d.toISOString();
}
