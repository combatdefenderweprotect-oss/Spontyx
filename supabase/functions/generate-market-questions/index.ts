// ════════════════════════════════════════════════════════════════════════
// Spontyx Market — generate-market-questions Edge Function
// ════════════════════════════════════════════════════════════════════════
// Generates pre-match prediction questions for upcoming PL and LaLiga
// fixtures involving the 6 target teams. Triggered daily by pg_cron at
// 08:00 UTC. Also callable on-demand via POST.
//
// Deploy:
//   supabase functions deploy generate-market-questions --no-verify-jwt
// ════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY        = Deno.env.get('OPENAI_API_KEY')!;

// ── Target scope ──────────────────────────────────────────────────────
const TARGET_LEAGUE_IDS = [39, 140];          // PL + LaLiga
const TARGET_TEAM_IDS   = new Set([           // Must involve at least one
  40,   // Liverpool
  42,   // Arsenal
  50,   // Man City
  49,   // Chelsea
  33,   // Man United
  541,  // Real Madrid
  529,  // Barcelona
]);

// ── Confidence XP map ─────────────────────────────────────────────────
const XP_BY_DIFFICULTY: Record<string, number> = {
  easy:   20,
  medium: 30,
  hard:   50,
};

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
    const now      = new Date();
    const horizonH = 72;
    const horizon  = new Date(now.getTime() + horizonH * 3600_000).toISOString();

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

    // ── 2. Filter for target teams ─────────────────────────────────────
    const relevant = (fixtures ?? []).filter((f: any) =>
      TARGET_TEAM_IDS.has(f.home_team_id) || TARGET_TEAM_IDS.has(f.away_team_id)
    );

    console.log(`[generate-market-questions] ${relevant.length} relevant fixtures`);

    let totalGenerated = 0;

    for (const fixture of relevant) {
      // Skip if questions already exist for this fixture
      const { count } = await sb
        .from('market_questions')
        .select('id', { count: 'exact', head: true })
        .eq('fixture_id', fixture.fixture_id)
        .in('status', ['draft', 'active', 'locked']);

      if ((count ?? 0) > 0) {
        console.log(`[generate-market-questions] skip fixture ${fixture.fixture_id} (has ${count} questions)`);
        continue;
      }

      const kickoff     = new Date(fixture.kickoff_at);
      const deadline30  = new Date(kickoff.getTime() - 30 * 60_000).toISOString();
      const deadline60  = new Date(kickoff.getTime() - 60 * 60_000).toISOString();
      const resolveAfter = new Date(kickoff.getTime() + 100 * 60_000).toISOString();

      const home = fixture.home_team_name;
      const away = fixture.away_team_name;

      const questions: any[] = [];

      // ── Match Result ────────────────────────────────────────────────
      questions.push({
        fixture_id: fixture.fixture_id,
        category: 'match_result',
        question_text: `Who wins: ${home} vs ${away}?`,
        answer_options: [
          { id: 'home', label: home + ' Win' },
          { id: 'draw', label: 'Draw' },
          { id: 'away', label: away + ' Win' },
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
          { id: 'home', label: home + ' lead' },
          { id: 'draw', label: 'Level at HT' },
          { id: 'away', label: away + ' lead' },
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
          { id: 'over', label: 'Over 2.5 goals' },
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

      // ── Real World Edge (AI-generated) ─────────────────────────────
      const rwQuestions = await generateRealWorldQuestions(home, away, fixture, OPENAI_API_KEY);
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

      // ── Mark featured (top 3 by xp_reward) ──────────────────────────
      // Map original indices sorted by xp_reward descending, then store
      // those original indices — NOT positions within the sorted array.
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
        console.log(`[generate-market-questions] fixture ${fixture.fixture_id}: ${withFeatured.length} questions`);
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
// OpenAI: generate Real World Edge questions
// ════════════════════════════════════════════════════════════════════════

async function generateRealWorldQuestions(
  home: string,
  away: string,
  fixture: any,
  apiKey: string,
): Promise<any[]> {
  try {
    const prompt = `You are a sports prediction analyst. Generate 2–3 pre-match prediction questions for the upcoming football match: ${home} vs ${away}.

These are "Real World Edge" questions — they must be grounded in real-world context: injuries, squad form, tactical matchups, key player availability, or head-to-head patterns.

Rules:
1. Each question must be binary or have 2–3 clear answer options
2. Each must include a short "context" (1–2 sentences explaining WHY this question matters right now)
3. Resolution must be objectively determinable from the final match stats/report
4. Specify source_confidence: low | medium | high

Return a JSON array with this exact shape (no markdown, no commentary):
[
  {
    "question_text": "...",
    "answer_options": [{"id": "a", "label": "..."}, {"id": "b", "label": "..."}],
    "correct_answer": null,
    "difficulty": "hard",
    "xp_reward": 50,
    "real_world_context": "...",
    "real_world_confidence": "medium",
    "resolution_rule": {"type": "ai_resolved", "resolution_note": "Determined from post-match stats/report"},
    "is_featured": false
  }
]`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1200,
      }),
    });

    if (!res.ok) {
      console.warn('[generate-market-questions] OpenAI error:', res.status);
      return [];
    }

    const json  = await res.json();
    const text  = json.choices?.[0]?.message?.content ?? '[]';
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];

  } catch (err: any) {
    console.warn('[generate-market-questions] OpenAI call failed:', err.message);
    return [];
  }
}
