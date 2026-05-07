-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 092: Spontyx Market — Core RPCs
-- ════════════════════════════════════════════════════════════════════════
-- All RPCs are SECURITY DEFINER and use atomic wallet mutations.
-- Negative balances are impossible by design.
-- ════════════════════════════════════════════════════════════════════════

-- ── Helper: compute confidence multipliers ────────────────────────────

CREATE OR REPLACE FUNCTION public.market_confidence_multipliers(
  p_confidence text
)
RETURNS TABLE (loss_mult numeric, win_mult numeric)
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE p_confidence
      WHEN 'safe'      THEN 0.5
      WHEN 'confident' THEN 1.0
      WHEN 'bold'      THEN 1.5
    END,
    CASE p_confidence
      WHEN 'safe'      THEN 0.5
      WHEN 'confident' THEN 1.0
      WHEN 'bold'      THEN 2.0
    END;
$$;

-- ── Helper: increment daily challenge progress ────────────────────────

CREATE OR REPLACE FUNCTION public.market_advance_challenge(
  p_user_id      uuid,
  p_goal_type    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT mdc.slug, mdc.goal_count, mdc.reward_coins, mdc.reward_xp
    FROM   public.market_daily_challenges mdc
    WHERE  mdc.goal_type = p_goal_type
  LOOP
    -- Upsert progress row
    INSERT INTO public.market_user_challenge_progress
      (user_id, challenge_slug, challenge_date, progress)
    VALUES (p_user_id, v_rec.slug, current_date, 1)
    ON CONFLICT (user_id, challenge_slug, challenge_date)
    DO UPDATE SET progress = market_user_challenge_progress.progress + 1
    WHERE NOT market_user_challenge_progress.completed;

    -- Check completion
    UPDATE public.market_user_challenge_progress p
    SET    completed    = true,
           completed_at = now()
    WHERE  p.user_id        = p_user_id
      AND  p.challenge_slug = v_rec.slug
      AND  p.challenge_date = current_date
      AND  p.progress      >= v_rec.goal_count
      AND  NOT p.completed;

    IF FOUND THEN
      -- Award reward
      UPDATE public.market_wallets
      SET    balance_total     = balance_total + v_rec.reward_coins,
             balance_available = balance_available + v_rec.reward_coins,
             xp_total          = xp_total + v_rec.reward_xp
      WHERE  user_id = p_user_id;

      INSERT INTO public.market_transactions
        (user_id, type, amount, note)
      VALUES (p_user_id, 'admin_credit', v_rec.reward_coins,
              'Daily challenge reward: ' || v_rec.slug);

      -- Mark reward claimed
      UPDATE public.market_user_challenge_progress
      SET    reward_claimed = true
      WHERE  user_id        = p_user_id
        AND  challenge_slug = v_rec.slug
        AND  challenge_date = current_date;
    END IF;
  END LOOP;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 1. place_market_prediction
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.place_market_prediction(
  p_question_id  uuid,
  p_answer       text,
  p_stake        numeric,
  p_confidence   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_question      public.market_questions%ROWTYPE;
  v_wallet        public.market_wallets%ROWTYPE;
  v_loss_mult     numeric;
  v_win_mult      numeric;
  v_max_loss      numeric;
  v_reward_on_win numeric;
  v_pred_id       uuid;
BEGIN
  -- Auth check
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Validate params
  IF p_stake <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_stake');
  END IF;
  IF p_confidence NOT IN ('safe', 'confident', 'bold') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_confidence');
  END IF;

  -- Load and lock question
  SELECT * INTO v_question
  FROM   public.market_questions
  WHERE  id = p_question_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;
  IF v_question.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_active');
  END IF;
  IF v_question.deadline_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deadline_passed');
  END IF;

  -- Validate answer option
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_question.answer_options) opt
    WHERE opt->>'id' = p_answer
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_answer');
  END IF;

  -- Compute amounts
  SELECT loss_mult, win_mult INTO v_loss_mult, v_win_mult
  FROM   public.market_confidence_multipliers(p_confidence);

  v_max_loss      := round(p_stake * v_loss_mult, 2);
  v_reward_on_win := round(p_stake * v_win_mult,  2);

  -- Lock wallet and check balance
  SELECT * INTO v_wallet
  FROM   public.market_wallets
  WHERE  user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wallet_not_found');
  END IF;
  IF v_wallet.balance_available < v_max_loss THEN
    RETURN jsonb_build_object(
      'ok',        false,
      'reason',    'insufficient_balance',
      'available', v_wallet.balance_available,
      'required',  v_max_loss
    );
  END IF;

  -- Insert prediction (unique constraint enforces one per question)
  BEGIN
    INSERT INTO public.market_predictions
      (user_id, question_id, fixture_id, selected_answer, stake,
       confidence, max_loss, reward_on_win, status)
    VALUES
      (v_user_id, p_question_id, v_question.fixture_id, p_answer, p_stake,
       p_confidence, v_max_loss, v_reward_on_win, 'placed')
    RETURNING id INTO v_pred_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_predicted');
  END;

  -- Update wallet: reserve max_loss
  UPDATE public.market_wallets
  SET    balance_reserved   = balance_reserved   + v_max_loss,
         balance_available  = balance_available  - v_max_loss
  WHERE  user_id = v_user_id;

  -- Record transaction
  INSERT INTO public.market_transactions
    (user_id, type, amount, reserved_delta, balance_after, prediction_id, note)
  VALUES
    (v_user_id, 'stake_reserved', 0, v_max_loss,
     v_wallet.balance_available - v_max_loss,
     v_pred_id,
     'Reserved for ' || p_confidence || ' prediction (stake ' || p_stake || ')');

  -- Advance challenge progress: predictions_placed
  PERFORM public.market_advance_challenge(v_user_id, 'predictions_placed');

  IF p_confidence = 'bold' THEN
    PERFORM public.market_advance_challenge(v_user_id, 'bold_placed');
  END IF;

  IF v_question.category = 'real_world_edge' THEN
    PERFORM public.market_advance_challenge(v_user_id, 'real_world_answered');
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'prediction_id', v_pred_id,
    'max_loss',     v_max_loss,
    'reward_on_win', v_reward_on_win,
    'new_available', v_wallet.balance_available - v_max_loss
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_market_prediction(uuid, text, numeric, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 2. resolve_market_question
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_market_question(
  p_question_id    uuid,
  p_correct_answer text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question  public.market_questions%ROWTYPE;
  v_pred      public.market_predictions%ROWTYPE;
  v_wins      integer := 0;
  v_losses    integer := 0;
  v_xp_award  integer;
BEGIN
  -- Lock question — idempotency guard
  SELECT * INTO v_question
  FROM   public.market_questions
  WHERE  id = p_question_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;
  IF v_question.status = 'resolved' THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_resolved');
  END IF;
  IF v_question.status NOT IN ('locked', 'active', 'resolving') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status', 'status', v_question.status);
  END IF;

  -- Mark question resolved
  UPDATE public.market_questions
  SET    status         = 'resolved',
         correct_answer = p_correct_answer,
         resolved_at    = now()
  WHERE  id = p_question_id;

  -- Compute XP for this question
  v_xp_award := v_question.xp_reward;

  -- Settle each prediction
  FOR v_pred IN
    SELECT * FROM public.market_predictions
    WHERE  question_id = p_question_id
      AND  status IN ('placed', 'locked')
    FOR UPDATE
  LOOP
    IF v_pred.selected_answer = p_correct_answer THEN
      -- WIN
      UPDATE public.market_predictions
      SET    status      = 'won',
             resolved_at = now()
      WHERE  id = v_pred.id;

      UPDATE public.market_wallets
      SET    balance_total      = balance_total     + v_pred.reward_on_win,
             balance_reserved   = balance_reserved  - v_pred.max_loss,
             balance_available  = balance_available + v_pred.max_loss + v_pred.reward_on_win,
             xp_total           = xp_total          + v_xp_award
                                + CASE WHEN v_pred.confidence = 'bold' THEN 15 ELSE 0 END,
             streak_correct     = streak_correct + 1
      WHERE  user_id = v_pred.user_id;

      INSERT INTO public.market_transactions
        (user_id, type, amount, reserved_delta, prediction_id, note)
      VALUES
        (v_pred.user_id, 'win_profit', v_pred.reward_on_win, -v_pred.max_loss,
         v_pred.id, 'Win: ' || v_pred.confidence || ' prediction');

      -- Check trophy: first_win, bold_master, hot_streak, etc. (lightweight check)
      PERFORM public.market_check_trophies(v_pred.user_id, 'win', v_pred.confidence,
               v_question.category);

      -- Advance win challenge
      PERFORM public.market_advance_challenge(v_pred.user_id, 'predictions_won');

      v_wins := v_wins + 1;
    ELSE
      -- LOSE
      UPDATE public.market_predictions
      SET    status      = 'lost',
             resolved_at = now()
      WHERE  id = v_pred.id;

      UPDATE public.market_wallets
      SET    balance_total     = balance_total    - v_pred.max_loss,
             balance_reserved  = balance_reserved - v_pred.max_loss,
             -- available is unchanged: total decreased, reserved decreased by same amount
             streak_correct    = 0
      WHERE  user_id = v_pred.user_id;

      INSERT INTO public.market_transactions
        (user_id, type, amount, reserved_delta, prediction_id, note)
      VALUES
        (v_pred.user_id, 'loss_deduct', -v_pred.max_loss, -v_pred.max_loss,
         v_pred.id, 'Loss: ' || v_pred.confidence || ' prediction');

      v_losses := v_losses + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',     true,
    'wins',   v_wins,
    'losses', v_losses
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3. void_market_question
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.void_market_question(p_question_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pred   public.market_predictions%ROWTYPE;
  v_count  integer := 0;
BEGIN
  -- Mark question void
  UPDATE public.market_questions
  SET    status = 'void'
  WHERE  id = p_question_id
    AND  status NOT IN ('resolved', 'void');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_resolved_or_void');
  END IF;

  -- Release reserved funds for all open predictions
  FOR v_pred IN
    SELECT * FROM public.market_predictions
    WHERE  question_id = p_question_id
      AND  status IN ('placed', 'locked')
    FOR UPDATE
  LOOP
    UPDATE public.market_predictions
    SET    status      = 'void',
           resolved_at = now()
    WHERE  id = v_pred.id;

    UPDATE public.market_wallets
    SET    balance_reserved  = balance_reserved  - v_pred.max_loss,
           balance_available = balance_available + v_pred.max_loss
    WHERE  user_id = v_pred.user_id;

    INSERT INTO public.market_transactions
      (user_id, type, amount, reserved_delta, prediction_id, note)
    VALUES
      (v_pred.user_id, 'refund', 0, -v_pred.max_loss, v_pred.id,
       'Void: question cancelled');

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'refunded_count', v_count);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 4. claim_daily_bonus
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.claim_daily_market_bonus()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_wallet  public.market_wallets%ROWTYPE;
  v_bonus   numeric := 100.00;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_wallet
  FROM   public.market_wallets
  WHERE  user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wallet_not_found');
  END IF;

  -- Check if already claimed today
  IF v_wallet.last_bonus_at IS NOT NULL
     AND v_wallet.last_bonus_at >= date_trunc('day', now() AT TIME ZONE 'UTC') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed_today',
      'next_bonus_at', date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day');
  END IF;

  -- Award bonus
  UPDATE public.market_wallets
  SET    balance_total     = balance_total     + v_bonus,
         balance_available = balance_available + v_bonus,
         last_bonus_at     = now()
  WHERE  user_id = v_user_id;

  INSERT INTO public.market_transactions
    (user_id, type, amount, note)
  VALUES
    (v_user_id, 'daily_bonus', v_bonus, 'Daily login bonus');

  RETURN jsonb_build_object(
    'ok',        true,
    'bonus',     v_bonus,
    'new_total', v_wallet.balance_total + v_bonus
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_daily_market_bonus() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 5. join_match_league
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.join_market_match_league(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_league  public.market_match_leagues%ROWTYPE;
  v_fixture public.api_football_fixtures%ROWTYPE;
  v_wallet  public.market_wallets%ROWTYPE;
  v_count   integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_league FROM public.market_match_leagues WHERE id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'league_not_found');
  END IF;
  IF v_league.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'league_not_open');
  END IF;

  -- Check kickoff hasn't passed
  SELECT * INTO v_fixture FROM public.api_football_fixtures WHERE fixture_id = v_league.fixture_id;
  IF v_fixture.kickoff_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_started');
  END IF;

  -- Check max participants
  IF v_league.max_participants IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM   public.market_match_league_members
    WHERE  match_league_id = p_league_id;
    IF v_count >= v_league.max_participants THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'league_full');
    END IF;
  END IF;

  -- Check not already member
  IF EXISTS (
    SELECT 1 FROM public.market_match_league_members
    WHERE match_league_id = p_league_id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_joined');
  END IF;

  -- Check balance
  SELECT * INTO v_wallet FROM public.market_wallets WHERE user_id = v_user_id FOR UPDATE;
  IF v_wallet.balance_available < v_league.entry_fee THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
      'available', v_wallet.balance_available, 'required', v_league.entry_fee);
  END IF;

  -- Deduct entry fee (permanent, not reserved)
  UPDATE public.market_wallets
  SET    balance_total     = balance_total     - v_league.entry_fee,
         balance_available = balance_available - v_league.entry_fee
  WHERE  user_id = v_user_id;

  INSERT INTO public.market_transactions
    (user_id, type, amount, match_league_id, note)
  VALUES
    (v_user_id, 'entry_fee', -v_league.entry_fee, p_league_id,
     'Entry fee: ' || v_league.name);

  -- Add member
  INSERT INTO public.market_match_league_members (match_league_id, user_id)
  VALUES (p_league_id, v_user_id);

  -- Advance challenge
  PERFORM public.market_advance_challenge(v_user_id, 'league_joined');

  RETURN jsonb_build_object('ok', true, 'entry_fee', v_league.entry_fee);
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_market_match_league(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 6. market_check_trophies (called after a win)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.market_check_trophies(
  p_user_id   uuid,
  p_event     text,     -- 'win'
  p_confidence text,
  p_category  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet  public.market_wallets%ROWTYPE;
  v_wins    integer;
  v_bold_wins integer;
  v_total   integer;
  v_rw_wins integer;
  v_player_wins integer;
BEGIN
  SELECT * INTO v_wallet FROM public.market_wallets WHERE user_id = p_user_id;

  -- First win
  SELECT COUNT(*) INTO v_wins FROM public.market_predictions
  WHERE user_id = p_user_id AND status = 'won';

  IF v_wins = 1 THEN
    INSERT INTO public.market_user_trophies (user_id, trophy_slug)
    VALUES (p_user_id, 'first_win') ON CONFLICT DO NOTHING;
  END IF;

  -- Hot streak
  IF v_wallet.streak_correct >= 5 THEN
    INSERT INTO public.market_user_trophies (user_id, trophy_slug)
    VALUES (p_user_id, 'hot_streak') ON CONFLICT DO NOTHING;
  END IF;
  IF v_wallet.streak_correct >= 10 THEN
    INSERT INTO public.market_user_trophies (user_id, trophy_slug)
    VALUES (p_user_id, 'inferno') ON CONFLICT DO NOTHING;
  END IF;

  -- Bold master
  IF p_confidence = 'bold' THEN
    SELECT COUNT(*) INTO v_bold_wins FROM public.market_predictions
    WHERE user_id = p_user_id AND status = 'won' AND confidence = 'bold';
    IF v_bold_wins >= 10 THEN
      INSERT INTO public.market_user_trophies (user_id, trophy_slug)
      VALUES (p_user_id, 'bold_master') ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Real World Insider / Oracle
  IF p_category = 'real_world_edge' THEN
    SELECT COUNT(*) INTO v_rw_wins FROM public.market_predictions mp
    JOIN public.market_questions mq ON mq.id = mp.question_id
    WHERE mp.user_id = p_user_id AND mp.status = 'won' AND mq.category = 'real_world_edge';
    IF v_rw_wins >= 5 THEN
      INSERT INTO public.market_user_trophies (user_id, trophy_slug)
      VALUES (p_user_id, 'real_world_insider') ON CONFLICT DO NOTHING;
    END IF;
    IF v_rw_wins >= 20 THEN
      INSERT INTO public.market_user_trophies (user_id, trophy_slug)
      VALUES (p_user_id, 'real_world_oracle') ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Market Veteran
  SELECT COUNT(*) INTO v_total FROM public.market_predictions
  WHERE user_id = p_user_id;
  IF v_total >= 100 THEN
    INSERT INTO public.market_user_trophies (user_id, trophy_slug)
    VALUES (p_user_id, 'market_veteran') ON CONFLICT DO NOTHING;
  END IF;

  -- Lineup Expert
  IF p_category = 'player_prediction' THEN
    SELECT COUNT(*) INTO v_player_wins FROM public.market_predictions mp
    JOIN public.market_questions mq ON mq.id = mp.question_id
    WHERE mp.user_id = p_user_id AND mp.status = 'won' AND mq.category = 'player_prediction';
    IF v_player_wins >= 10 THEN
      INSERT INTO public.market_user_trophies (user_id, trophy_slug)
      VALUES (p_user_id, 'lineup_expert') ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$$;

-- ── RPC: get_market_wallet ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_market_wallet()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_wallet  public.market_wallets%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_wallet FROM public.market_wallets WHERE user_id = v_user_id;
  IF NOT FOUND THEN
    -- Auto-create
    INSERT INTO public.market_wallets (user_id) VALUES (v_user_id)
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_wallet;
  END IF;

  RETURN jsonb_build_object(
    'ok',               true,
    'balance_total',    v_wallet.balance_total,
    'balance_reserved', v_wallet.balance_reserved,
    'balance_available',v_wallet.balance_available,
    'xp_total',         v_wallet.xp_total,
    'streak_correct',   v_wallet.streak_correct,
    'last_bonus_at',    v_wallet.last_bonus_at,
    'can_claim_bonus',  (v_wallet.last_bonus_at IS NULL OR
                         v_wallet.last_bonus_at < date_trunc('day', now() AT TIME ZONE 'UTC'))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_market_wallet() TO authenticated;

-- ── RPC: get_fixture_market_summary ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_fixture_market_summary(p_fixture_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_q_count        integer;
  v_rw_count       integer;
  v_user_exposure  numeric;
BEGIN
  SELECT COUNT(*)
  INTO   v_q_count
  FROM   public.market_questions
  WHERE  fixture_id = p_fixture_id AND status IN ('active','locked');

  SELECT COUNT(*)
  INTO   v_rw_count
  FROM   public.market_questions
  WHERE  fixture_id = p_fixture_id AND status IN ('active','locked')
    AND  category = 'real_world_edge';

  -- User's total max_loss exposure on this fixture
  SELECT COALESCE(SUM(mp.max_loss), 0)
  INTO   v_user_exposure
  FROM   public.market_predictions mp
  WHERE  mp.user_id    = v_user_id
    AND  mp.fixture_id = p_fixture_id
    AND  mp.status     IN ('placed','locked');

  RETURN jsonb_build_object(
    'question_count',   v_q_count,
    'rw_count',         v_rw_count,
    'user_exposure',    v_user_exposure
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_fixture_market_summary(integer) TO authenticated;
