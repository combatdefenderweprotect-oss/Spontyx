/**
 * live-stats-poller — Edge Function
 *
 * Polls API-Sports for live / upcoming / recently-finished football fixtures
 * and upserts the results to the `live_match_stats` Supabase table.
 *
 * Triggered every minute via pg_cron (see migration 015_live_match_stats.sql).
 * Auth: Bearer token checked against CRON_SECRET env var.
 *
 * Strategy
 * ─────────
 * 1. Find which fixtures to poll:
 *    a. Distinct match_id values from questions with status=pending (active leagues)
 *    b. fixture_id values from leagues that are currently active (league_start ≤ today ≤ league_end)
 * 2. For each fixture, check last_polled_at — skip if polled within 25 seconds (cron overlap guard).
 * 3. Call API-Sports endpoints:
 *    - /fixtures          — every cycle (score, status, minute)
 *    - /fixtures/events   — every cycle when live or finished
 *    - /fixtures/statistics — every cycle when live or finished (two calls: one per team)
 *    - /fixtures/players  — every ~3 min when live; once when finished
 *    - /fixtures/lineups    — once per fixture (lineups_polled flag)
 *    - /predictions         — once per fixture (predictions_polled flag)
 *    - /fixtures/headtohead — once per fixture (h2h_polled flag)
 *    - /injuries            — once per fixture (injuries_polled flag)
 *    - /odds                — once per fixture (odds_polled flag)
 *    - /sidelined           — once per fixture, per injured player up to 5 (sidelined_polled flag)
 * 4. Upsert to live_match_stats.
 *
 * API cost per live match
 * ───────────────────────
 * Per 1-minute cycle: fixtures(1) + events(1) + stats(2) = 4 reqs
 * Player stats every 3 min: 1 req per 3 cycles
 * One-time: lineups(1) + predictions(1) + h2h(1) + injuries(1) + odds(1) + sidelined(up to 5) = 9–10 reqs
 * 90-minute match total: ~375 requests  (well within Pro plan 7,500/day)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Constants ────────────────────────────────────────────────────────────────

const API_KEY         = Deno.env.get('API_SPORTS_KEY') || ''
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const CRON_SECRET     = Deno.env.get('CRON_SECRET') || ''
const API_BASE        = 'https://v3.football.api-sports.io'

/** Statuses that mean the match is currently being played */
const LIVE_STATUSES   = new Set(['1H', '2H', 'HT', 'ET', 'P', 'BT', 'INT'])
/** Statuses that mean the match has finished */
const DONE_STATUSES   = new Set(['FT', 'AET', 'PEN'])
/** Do not poll these — cancelled / abandoned / postponed */
const DEAD_STATUSES   = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO'])

// ── API helper ───────────────────────────────────────────────────────────────

async function apiGet(endpoint: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'x-apisports-key': API_KEY },
  })
  if (!res.ok) throw new Error(`API-Sports ${res.status} on ${endpoint}`)
  const body = await res.json()
  return body.response ?? []
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Auth check
  const auth = req.headers.get('Authorization') ?? ''
  if (!CRON_SECRET || !auth.includes(CRON_SECRET)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  const sb  = createClient(SUPABASE_URL, SERVICE_KEY)
  const now = new Date()

  // ── 1. Collect fixture IDs to poll ──────────────────────────────────────

  const fixtureIds = new Set<number>()

  // From active questions (pending, resolves_after within last 4 hours — covers live + just-finished)
  const { data: activeQs } = await sb
    .from('questions')
    .select('match_id')
    .eq('resolution_status', 'pending')
    .not('match_id', 'is', null)
    .gte('resolves_after', new Date(now.getTime() - 4 * 3600 * 1000).toISOString())

  for (const q of activeQs ?? []) {
    const id = parseInt(q.match_id)
    if (!isNaN(id)) fixtureIds.add(id)
  }

  // From leagues with fixture_id and active date range
  const today = now.toISOString().split('T')[0]
  const { data: activeLeagues } = await sb
    .from('leagues')
    .select('fixture_id')
    .not('fixture_id', 'is', null)
    .lte('league_start_date', today)
    .gte('league_end_date', today)

  for (const l of activeLeagues ?? []) {
    if (l.fixture_id) fixtureIds.add(l.fixture_id)
  }

  if (fixtureIds.size === 0) {
    return new Response(
      JSON.stringify({ ok: true, polled: 0, skipped: 0, errors: 0, message: 'No active fixtures' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 2. Poll each fixture ─────────────────────────────────────────────────

  const stats = { polled: 0, skipped: 0, errors: 0 }

  for (const fixtureId of fixtureIds) {
    try {
      // Check existing row — skip if polled within 25s (prevents cron overlap double-poll)
      const { data: existing } = await sb
        .from('live_match_stats')
        .select('status, lineups_polled, predictions_polled, h2h_polled, injuries_polled, odds_polled, sidelined_polled, home_team_id, away_team_id, last_polled_at')
        .eq('fixture_id', fixtureId)
        .maybeSingle()

      if (existing?.last_polled_at) {
        const ageMs = now.getTime() - new Date(existing.last_polled_at).getTime()
        if (ageMs < 25_000) { stats.skipped++; continue }
      }

      // ── 2a. Core fixture data (score, status, minute) ──────────────────
      const fixtures = await apiGet(`/fixtures?id=${fixtureId}`)
      if (!fixtures.length) { stats.skipped++; continue }

      const f          = fixtures[0]
      const status     = f.fixture.status.short as string
      const minute     = f.fixture.status.elapsed as number | null
      const homeScore  = f.goals.home  ?? 0
      const awayScore  = f.goals.away  ?? 0
      const homeId     = f.teams.home.id  as number
      const awayId     = f.teams.away.id  as number
      const isLive     = LIVE_STATUSES.has(status)
      const isDone     = DONE_STATUSES.has(status)
      const isDead     = DEAD_STATUSES.has(status)

      if (isDead) { stats.skipped++; continue }

      const update: Record<string, unknown> = {
        fixture_id:       fixtureId,
        status,
        minute:           minute ?? null,
        home_team_id:     homeId,
        away_team_id:     awayId,
        home_team_name:   f.teams.home.name,
        away_team_name:   f.teams.away.name,
        home_logo:        f.teams.home.logo ?? null,
        away_logo:        f.teams.away.logo ?? null,
        home_score:       homeScore,
        away_score:       awayScore,
        competition_name: f.league?.name ?? null,
        kickoff_at:       f.fixture.date ?? null,
        last_polled_at:   now.toISOString(),
        updated_at:       now.toISOString(),
      }

      // ── 2b. Events + team stats — every cycle when live or done ─────────
      if (isLive || isDone) {
        const [eventsRes, homeStatsRes, awayStatsRes] = await Promise.allSettled([
          apiGet(`/fixtures/events?fixture=${fixtureId}`),
          apiGet(`/fixtures/statistics?fixture=${fixtureId}&team=${homeId}`),
          apiGet(`/fixtures/statistics?fixture=${fixtureId}&team=${awayId}`),
        ])

        if (eventsRes.status === 'fulfilled' && eventsRes.value.length) {
          update.events = eventsRes.value.map((e: any) => ({
            time:         e.time.elapsed,
            extra:        e.time.extra ?? null,
            type:         e.type,
            detail:       e.detail ?? null,
            team_id:      e.team.id,
            team_name:    e.team.name,
            player_name:  e.player?.name  ?? null,
            player_id:    e.player?.id    ?? null,
            assist_name:  e.assist?.name  ?? null,
            assist_id:    e.assist?.id    ?? null,
          }))
        }

        const parseTeamStats = (res: PromiseSettledResult<any[]>) => {
          if (res.status !== 'fulfilled' || !res.value.length) return {}
          const s = res.value[0]?.statistics ?? []
          const get = (type: string) => s.find((x: any) => x.type === type)?.value ?? null
          return {
            shots_total:       get('Total Shots'),
            shots_on_goal:     get('Shots on Goal'),
            possession:        get('Ball Possession'),
            corners:           get('Corner Kicks'),
            fouls:             get('Fouls'),
            yellow_cards:      get('Yellow Cards'),
            red_cards:         get('Red Cards'),
            offsides:          get('Offsides'),
            saves:             get('Goalkeeper Saves'),
            passes_total:      get('Total passes'),
            passes_accuracy:   get('Passes accurate'),
          }
        }

        update.team_stats = {
          home: parseTeamStats(homeStatsRes),
          away: parseTeamStats(awayStatsRes),
        }
      }

      // ── 2c. Player stats — every ~3 min when live; once when done ───────
      const lastPolled      = existing?.last_polled_at ? new Date(existing.last_polled_at).getTime() : 0
      const playerStaleMs   = now.getTime() - lastPolled
      const shouldPollPlayers = isDone || (isLive && playerStaleMs > 170_000)

      if (shouldPollPlayers) {
        const playerRes = await apiGet(`/fixtures/players?fixture=${fixtureId}`).catch(() => [])
        if (playerRes.length >= 1) {
          const mapTeamPlayers = (team: any) => (team?.players ?? []).map((p: any) => {
            const s = p.statistics?.[0] ?? {}
            return {
              id:                  p.player.id,
              name:                p.player.name,
              number:              p.player.number ?? null,
              pos:                 s.games?.position ?? null,
              minutes:             s.games?.minutes  ?? null,
              rating:              s.games?.rating   ?? null,
              goals:               s.goals?.total    ?? null,
              assists:             s.goals?.assists  ?? null,
              shots_total:         s.shots?.total    ?? null,
              shots_on_goal:       s.shots?.on       ?? null,
              saves:               s.goals?.saves    ?? null,
              fouls_committed:     s.fouls?.committed ?? null,
              fouls_drawn:         s.fouls?.drawn     ?? null,
              yellow_cards:        s.cards?.yellow    ?? null,
              red_cards:           s.cards?.red       ?? null,
              penalties_scored:    s.penalty?.scored  ?? null,
              penalties_missed:    s.penalty?.missed  ?? null,
              penalties_saved:     s.penalty?.saved   ?? null,
              // Extended stats
              passes_total:        s.passes?.total      ?? null,
              passes_key:          s.passes?.key        ?? null,
              dribbles_attempts:   s.dribbles?.attempts ?? null,
              dribbles_success:    s.dribbles?.success  ?? null,
              tackles:             s.tackles?.total     ?? null,
              interceptions:       s.tackles?.interceptions ?? null,
              duels_total:         s.duels?.total       ?? null,
              duels_won:           s.duels?.won         ?? null,
            }
          })
          update.player_stats = {
            home: mapTeamPlayers(playerRes[0]),
            away: mapTeamPlayers(playerRes[1] ?? playerRes[0]),
          }
        }
      }

      // ── 2d. Injuries — fetch once ────────────────────────────────────────
      if (!existing?.injuries_polled) {
        const injuriesRes = await apiGet(`/injuries?fixture=${fixtureId}`).catch(() => [])
        if (injuriesRes.length) {
          update.injuries = injuriesRes.map((i: any) => ({
            player_id:   i.player?.id    ?? null,
            player_name: i.player?.name  ?? null,
            team_id:     i.team?.id      ?? null,
            team_name:   i.team?.name    ?? null,
            reason:      i.player?.reason ?? null,
            type:        i.player?.type   ?? null,
          }))
          update.injuries_polled = true

          // ── 2d-ii. Sidelined — fetch once for each injured player (cap 5) ──
          if (!existing?.sidelined_polled) {
            const injuredIds: number[] = (update.injuries as any[])
              .filter((i: any) => i.player_id)
              .map((i: any) => i.player_id)
              .slice(0, 5)

            if (injuredIds.length) {
              const sidelinedData: Record<number, any[]> = {}
              await Promise.allSettled(
                injuredIds.map(async (playerId: number) => {
                  const res = await apiGet(`/sidelined?player=${playerId}`).catch(() => [])
                  if (res.length) {
                    sidelinedData[playerId] = res.map((s: any) => ({
                      reason: s.fixture?.reason ?? null,
                      start:  s.fixture?.date   ?? null,
                      end:    s.fixture?.end     ?? null,
                    }))
                  }
                })
              )
              if (Object.keys(sidelinedData).length > 0) {
                update.sidelined         = sidelinedData
                update.sidelined_polled  = true
              }
            }
          }
        }
      }

      // ── 2e. Odds — fetch once ─────────────────────────────────────────────
      if (!existing?.odds_polled) {
        const oddsRes = await apiGet(`/odds?fixture=${fixtureId}`).catch(() => [])
        if (oddsRes.length) {
          const bookmaker = oddsRes[0]?.bookmakers?.[0]
          const bets      = bookmaker?.bets ?? []
          const findBet   = (name: string) => bets.find((b: any) => b.name === name)

          update.odds = {
            bookmaker:        bookmaker?.name ?? null,
            match_winner:     findBet('Match Winner')?.values     ?? null,
            over_under:       findBet('Goals Over/Under')?.values ?? null,
            both_teams_score: findBet('Both Teams Score')?.values ?? null,
          }
          update.odds_polled = true
        }
      }

      // ── 2g. Lineups — fetch once ─────────────────────────────────────────
      if (!existing?.lineups_polled) {
        const lineupsRes = await apiGet(`/fixtures/lineups?fixture=${fixtureId}`).catch(() => [])
        if (lineupsRes.length >= 2) {
          const mapLineup = (team: any) => ({
            formation:  team.formation   ?? null,
            coach:      team.coach?.name ?? null,
            players: (team.startXI ?? []).map((p: any) => ({
              id:     p.player.id,
              name:   p.player.name,
              number: p.player.number,
              pos:    p.player.pos,
              grid:   p.player.grid ?? null,
            })),
            substitutes: (team.substitutes ?? []).map((p: any) => ({
              id:     p.player.id,
              name:   p.player.name,
              number: p.player.number,
              pos:    p.player.pos,
            })),
          })
          update.lineups         = { home: mapLineup(lineupsRes[0]), away: mapLineup(lineupsRes[1]) }
          update.lineups_polled  = true

          // ── Sync team_players from lineups (once per fixture) ─────────────
          // Upserts teams, players, and team_players (starters +10, subs +4).
          // Uses GREATEST() so existing relevance_scores are never downgraded.
          const homeTeam = lineupsRes[0]
          const awayTeam = lineupsRes[1]
          const lineupPlayers = [
            ...(homeTeam.startXI ?? []).map((p: any) => ({
              player_id:   String(p.player.id),
              player_name: p.player.name ?? '',
              team_id:     String(homeId),
              pos:         p.player.pos  ?? null,
              number:      p.player.number ?? null,
              is_starter:  true,
            })),
            ...(homeTeam.substitutes ?? []).map((p: any) => ({
              player_id:   String(p.player.id),
              player_name: p.player.name ?? '',
              team_id:     String(homeId),
              pos:         p.player.pos  ?? null,
              number:      p.player.number ?? null,
              is_starter:  false,
            })),
            ...(awayTeam.startXI ?? []).map((p: any) => ({
              player_id:   String(p.player.id),
              player_name: p.player.name ?? '',
              team_id:     String(awayId),
              pos:         p.player.pos  ?? null,
              number:      p.player.number ?? null,
              is_starter:  true,
            })),
            ...(awayTeam.substitutes ?? []).map((p: any) => ({
              player_id:   String(p.player.id),
              player_name: p.player.name ?? '',
              team_id:     String(awayId),
              pos:         p.player.pos  ?? null,
              number:      p.player.number ?? null,
              is_starter:  false,
            })),
          ].filter((p) => p.player_id && p.player_id !== 'null')

          if (lineupPlayers.length > 0) {
            const { error: rpcErr } = await sb.rpc('sync_lineup_players', {
              p_sport:     'football',
              p_home_id:   String(homeId),
              p_home_name: String(update.home_team_name ?? ''),
              p_away_id:   String(awayId),
              p_away_name: String(update.away_team_name ?? ''),
              p_players:   lineupPlayers,
            })
            if (rpcErr) {
              console.warn('[live-stats-poller] sync_lineup_players failed:', rpcErr.message)
            } else {
              console.log(`[live-stats-poller] synced ${lineupPlayers.length} lineup players for fixture ${fixtureId}`)
            }
          }
        }
      }

      // ── 2h. Predictions — fetch once ─────────────────────────────────────
      if (!existing?.predictions_polled) {
        const predRes = await apiGet(`/predictions?fixture=${fixtureId}`).catch(() => [])
        if (predRes.length) {
          const pred = predRes[0]
          update.predictions = {
            winner_team_id:  pred.predictions?.winner?.id   ?? null,
            winner_name:     pred.predictions?.winner?.name ?? null,
            home_win_pct:    pred.predictions?.percent?.home ?? null,
            draw_pct:        pred.predictions?.percent?.draw ?? null,
            away_win_pct:    pred.predictions?.percent?.away ?? null,
            advice:          pred.predictions?.advice       ?? null,
            goals_home:      pred.predictions?.goals?.home  ?? null,
            goals_away:      pred.predictions?.goals?.away  ?? null,
            under_over:      pred.predictions?.under_over   ?? null,
            form_home:       pred.teams?.home?.last_5?.form ?? null,
            form_away:       pred.teams?.away?.last_5?.form ?? null,
            att_home:        pred.teams?.home?.last_5?.att  ?? null,
            att_away:        pred.teams?.away?.last_5?.att  ?? null,
            def_home:        pred.teams?.home?.last_5?.def  ?? null,
            def_away:        pred.teams?.away?.last_5?.def  ?? null,
          }
          update.predictions_polled = true
        }
      }

      // ── 2i. Head-to-head — fetch once ────────────────────────────────────
      if (!existing?.h2h_polled && homeId && awayId) {
        const h2hRes = await apiGet(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`).catch(() => [])
        if (h2hRes.length) {
          update.head_to_head = h2hRes.map((m: any) => ({
            date:         m.fixture.date,
            home_team:    m.teams.home.name,
            home_team_id: m.teams.home.id,
            away_team:    m.teams.away.name,
            away_team_id: m.teams.away.id,
            home_score:   m.goals.home ?? 0,
            away_score:   m.goals.away ?? 0,
            winner_id:    m.teams.home.winner ? m.teams.home.id
                          : m.teams.away.winner ? m.teams.away.id
                          : null,
          }))
          update.h2h_polled = true
        }
      }

      // ── 3. Upsert ─────────────────────────────────────────────────────────
      const { error } = await sb.from('live_match_stats').upsert(update)
      if (error) {
        console.error(`[live-stats-poller] upsert failed fixture=${fixtureId}:`, error.message)
        stats.errors++
      } else {
        stats.polled++
      }

      // ── 4. Sync team_players from events (once, when match is done) ───────
      // Bumps relevance scores: goal scorer +8, assist +6, card +5.
      // Capped at 100. Guarded by events_synced flag to prevent re-incrementing.
      if (isDone && !existing?.events_synced && update.events) {
        const rawEvents = update.events as any[]
        const eventPayload = rawEvents
          .filter((e) => e.player_id && e.team_id)
          .map((e) => ({
            player_id:      String(e.player_id),
            team_id:        String(e.team_id),
            event_type:     e.type ?? '',
            assist_id:      e.assist_id ? String(e.assist_id) : null,
            assist_team_id: e.assist_id ? String(e.team_id)   : null, // assist is always same team for now
          }))
          .filter((e) => e.event_type === 'Goal' || e.event_type === 'Card')

        if (eventPayload.length > 0) {
          const { error: evtErr } = await sb.rpc('sync_match_events', {
            p_sport:   'football',
            p_events:  eventPayload,
          })
          if (evtErr) {
            console.warn(`[live-stats-poller] sync_match_events failed fixture=${fixtureId}:`, evtErr.message)
          } else {
            // Mark events synced so we don't re-increment on next poll
            await sb.from('live_match_stats')
              .update({ events_synced: true })
              .eq('fixture_id', fixtureId)
            console.log(`[live-stats-poller] synced ${eventPayload.length} events for fixture ${fixtureId}`)
          }
        } else {
          // No scorable events — mark synced anyway to skip future attempts
          await sb.from('live_match_stats')
            .update({ events_synced: true })
            .eq('fixture_id', fixtureId)
        }
      }

    } catch (err) {
      console.error(`[live-stats-poller] error fixture=${fixtureId}:`, err)
      stats.errors++
    }
  }

  return new Response(
    JSON.stringify({ ok: true, fixtures: fixtureIds.size, ...stats }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
