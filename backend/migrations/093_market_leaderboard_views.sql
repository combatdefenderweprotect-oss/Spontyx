-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 093: Spontyx Market — Leaderboard Views
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Weekly profit leaderboard ─────────────────────────────────────
-- Net coins won this week (Monday–Sunday UTC)

CREATE OR REPLACE VIEW public.market_lb_weekly_profit AS
SELECT
  mt.user_id,
  u.handle,
  u.name,
  u.avatar,
  u.avatar_color,
  SUM(CASE WHEN mt.type = 'win_profit'  THEN mt.amount ELSE 0 END)
  + SUM(CASE WHEN mt.type = 'loss_deduct' THEN mt.amount ELSE 0 END) AS net_coins,
  COUNT(*) FILTER (WHERE mt.type = 'win_profit')  AS wins,
  COUNT(*) FILTER (WHERE mt.type = 'loss_deduct') AS losses
FROM   public.market_transactions mt
JOIN   public.users u ON u.id = mt.user_id
WHERE  mt.created_at >= date_trunc('week', now() AT TIME ZONE 'UTC')
  AND  mt.type IN ('win_profit', 'loss_deduct')
GROUP  BY mt.user_id, u.handle, u.name, u.avatar, u.avatar_color
HAVING COUNT(*) >= 5
ORDER  BY net_coins DESC;

-- ── 2. All-time accuracy leaderboard ─────────────────────────────────

CREATE OR REPLACE VIEW public.market_lb_accuracy AS
SELECT
  mp.user_id,
  u.handle,
  u.name,
  u.avatar,
  u.avatar_color,
  COUNT(*)                                       AS total,
  COUNT(*) FILTER (WHERE mp.status = 'won')      AS wins,
  ROUND(
    COUNT(*) FILTER (WHERE mp.status = 'won') * 100.0
    / NULLIF(COUNT(*) FILTER (WHERE mp.status IN ('won','lost')), 0),
    1
  )                                              AS accuracy_pct
FROM   public.market_predictions mp
JOIN   public.users u ON u.id = mp.user_id
WHERE  mp.status IN ('won','lost')
GROUP  BY mp.user_id, u.handle, u.name, u.avatar, u.avatar_color
HAVING COUNT(*) FILTER (WHERE mp.status IN ('won','lost')) >= 20
ORDER  BY accuracy_pct DESC, wins DESC;

-- ── 3. XP leaderboard ────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.market_lb_xp AS
SELECT
  mw.user_id,
  u.handle,
  u.name,
  u.avatar,
  u.avatar_color,
  mw.xp_total,
  mw.streak_correct
FROM   public.market_wallets mw
JOIN   public.users u ON u.id = mw.user_id
WHERE  mw.xp_total > 0
ORDER  BY mw.xp_total DESC;

-- ── 4. Bold performance leaderboard ──────────────────────────────────

CREATE OR REPLACE VIEW public.market_lb_bold AS
SELECT
  mp.user_id,
  u.handle,
  u.name,
  u.avatar,
  u.avatar_color,
  COUNT(*)                                        AS bold_total,
  COUNT(*) FILTER (WHERE mp.status = 'won')       AS bold_wins,
  ROUND(
    COUNT(*) FILTER (WHERE mp.status = 'won') * 100.0
    / NULLIF(COUNT(*), 0),
    1
  )                                               AS bold_pct,
  SUM(mp.reward_on_win) FILTER (WHERE mp.status = 'won') AS bold_profit
FROM   public.market_predictions mp
JOIN   public.users u ON u.id = mp.user_id
WHERE  mp.confidence = 'bold'
GROUP  BY mp.user_id, u.handle, u.name, u.avatar, u.avatar_color
HAVING COUNT(*) >= 5
ORDER  BY bold_pct DESC, bold_wins DESC;

-- ── 5. Match league leaderboard helper ───────────────────────────────

CREATE OR REPLACE FUNCTION public.get_match_league_leaderboard(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id',    u.id,
      'handle',     u.handle,
      'name',       u.name,
      'avatar',     u.avatar,
      'avatar_color', u.avatar_color,
      'wins',       wins,
      'losses',     losses,
      'profit',     profit,
      'final_rank', m.final_rank,
      'coins_won',  m.coins_won
    ) ORDER BY wins DESC, profit DESC
  ) INTO v_result
  FROM public.market_match_league_members m
  JOIN public.users u ON u.id = m.user_id
  JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE mp.status = 'won')  AS wins,
      COUNT(*) FILTER (WHERE mp.status = 'lost') AS losses,
      COALESCE(SUM(mp.reward_on_win) FILTER (WHERE mp.status = 'won'), 0)
      - COALESCE(SUM(mp.max_loss)    FILTER (WHERE mp.status = 'lost'), 0) AS profit
    FROM public.market_predictions mp
    JOIN public.market_questions   mq ON mq.id = mp.question_id
    JOIN public.market_match_leagues ml ON ml.fixture_id = mq.fixture_id
    WHERE mp.user_id = m.user_id AND ml.id = p_league_id
  ) stats ON true
  WHERE m.match_league_id = p_league_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_match_league_leaderboard(uuid) TO authenticated;

-- ── 6. Grant select on views to authenticated ────────────────────────

GRANT SELECT ON public.market_lb_weekly_profit TO authenticated;
GRANT SELECT ON public.market_lb_accuracy       TO authenticated;
GRANT SELECT ON public.market_lb_xp             TO authenticated;
GRANT SELECT ON public.market_lb_bold           TO authenticated;
