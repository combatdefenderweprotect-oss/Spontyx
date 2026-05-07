# Spontyx Market — Prediction Market System
## Canonical Specification

**Status:** Active development  
**Migrations:** 085–093  
**Pages:** `market.html`, `market-match.html`, `market-wallet.html`  
**Edge Functions:** `generate-market-questions`, `resolve-market-questions`

---

## 1. Product Identity

Spontyx Market is a **skill-based sports prediction game** — not a gambling product. Players stake virtual coins on structured prediction questions, choosing their confidence level and accepting asymmetric risk/reward. Real-world knowledge, data literacy, and strategic risk management determine outcomes.

**Sport:** Soccer only (extensible)  
**Leagues:** Premier League (API id=39), LaLiga (API id=140)  
**Target teams (MVP):** Real Madrid (541), Barcelona (529), Liverpool (40), Arsenal (42), Manchester City (50), Chelsea (49), Manchester United (33)  
**Question types:** Pre-match only (live questions are a future phase)

---

## 2. Wallet System

### Fields (table: `market_wallets`)

| Field | Type | Description |
|---|---|---|
| `balance_total` | NUMERIC(12,2) | Real net coins owned. Updated on win/loss/bonus. |
| `balance_reserved` | NUMERIC(12,2) | Coins locked in open predictions (max_loss amounts). |
| `balance_available` | NUMERIC(12,2) | balance_total − balance_reserved. Spendable coins. |
| `xp_total` | INTEGER | Market XP. Never decreases. Tracked separately from coins. |
| `streak_correct` | INTEGER | Current consecutive correct predictions (for challenges). |
| `last_bonus_at` | TIMESTAMPTZ | When the user last claimed their daily bonus. |

**Starting balance:** 1,000 coins on wallet creation (triggered by new user creation).

### Invariant

`balance_available = balance_total − balance_reserved` must always hold. All wallet mutations happen inside SECURITY DEFINER RPCs that update all three fields atomically.

---

## 3. Confidence Model

| Confidence | Max Loss | Win Reward |
|---|---|---|
| SAFE | 0.5 × stake | 0.5 × stake |
| CONFIDENT | 1.0 × stake | 1.0 × stake |
| BOLD | 1.5 × stake | 2.0 × stake |

**Max loss is what gets reserved on placement.** The user must have `balance_available >= max_loss` to place a prediction. Negative balances are impossible by design.

### Example — stake 50, BOLD

| Event | balance_total | balance_reserved | balance_available |
|---|---|---|---|
| Before | 1000 | 0 | 1000 |
| After placement | 1000 | +75 | 925 |
| After WIN | +100 → 1100 | −75 → 0 | 1100 |
| After LOSE (from placement) | −75 → 925 | −75 → 0 | 925 |

---

## 4. Transaction Ledger

Every wallet mutation produces a `market_transactions` row.

| Type | Meaning |
|---|---|
| `stake_reserved` | Coins reserved when placing a prediction |
| `win_profit` | Coins credited on a correct prediction |
| `loss_deduct` | Coins deducted on an incorrect prediction |
| `refund` | Reserved coins released when a question is voided |
| `daily_bonus` | Daily login bonus (+100 coins) |
| `entry_fee` | Coins deducted to join a Match League |
| `entry_refund` | Entry fee returned if Match League is cancelled |

---

## 5. Question Categories

Questions are grouped into six categories per match, displayed in this UI order:

| Category | Description | Deadline | XP |
|---|---|---|---|
| `real_world_edge` | AI + news/data contextual questions; highest value | kickoff − 60 min | 50 |
| `featured` | AI-curated top 3–5 questions per match | kickoff − 30 min | 35 |
| `match_result` | Win/draw/loss outcomes | kickoff − 30 min | 20 |
| `goals` | Over/under, BTTS, first scorer category | kickoff − 30 min | 20 |
| `team_stats` | Corners, cards, possession, shots | kickoff − 30 min | 15 |
| `player_prediction` | Goalscorer, assist, card predictions | kickoff − 30 min | 25 |

### Question fields (table: `market_questions`)

```
id, fixture_id, category, question_text, answer_options JSONB,
correct_answer, difficulty, xp_reward,
real_world_context (explanation), real_world_confidence (low/medium/high),
resolution_source, resolution_rule JSONB,
deadline_at, resolves_after, status,
is_featured BOOLEAN, created_at, updated_at
```

### Question status lifecycle

```
draft → active → locked → resolved
                        ↘ void
```

- `draft`: generated but not yet published
- `active`: visible to users, predictions accepted
- `locked`: deadline passed, no new predictions
- `resolved`: correct_answer determined, all predictions settled
- `void`: cancelled; all reserved coins refunded

---

## 6. Prediction Lifecycle

### Status values

| Status | Meaning |
|---|---|
| `placed` | Prediction submitted, question still active |
| `locked` | Question past deadline, awaiting resolution |
| `won` | Correct answer — profit credited |
| `lost` | Wrong answer — loss deducted |
| `void` | Question voided — reserved coins returned |
| `refunded` | Admin refund outside normal void flow |

### Placement constraints

- One prediction per user per question (`UNIQUE (user_id, question_id)`)
- User must have `balance_available >= max_loss` at time of placement
- `deadline_at > now()` enforced in RPC before insert

---

## 7. Core RPCs

### `place_market_prediction(p_question_id, p_answer, p_stake, p_confidence)`

1. Load question — must be status `active`, `deadline_at > now()`
2. Compute `max_loss` and `reward_on_win` from confidence multipliers
3. Lock wallet row (`FOR UPDATE`) — verify `balance_available >= max_loss`
4. Insert prediction
5. Update wallet: `balance_reserved += max_loss`, `balance_available -= max_loss`
6. Insert transaction: type `stake_reserved`
7. Return `{ ok, prediction_id, max_loss, reward_on_win, new_available }`

### `resolve_market_question(p_question_id, p_correct_answer)`

1. Lock question (`FOR UPDATE`) — must be `locked` status
2. Set `status = 'resolved'`, `correct_answer = p_correct_answer`
3. For each prediction (status in `placed`, `locked`):
   - **WIN**: `balance_total += reward_on_win`, `balance_reserved -= max_loss`, `balance_available += max_loss + reward_on_win`, status = `won`, insert `win_profit` tx, award XP
   - **LOSE**: `balance_total -= max_loss`, `balance_reserved -= max_loss`, status = `lost`, insert `loss_deduct` tx
4. Return count of wins/losses

### `void_market_question(p_question_id)`

1. Set question `status = 'void'`
2. For each open prediction: `balance_reserved -= max_loss`, `balance_available += max_loss`, status = `void`
3. Insert `refund` transaction per prediction

### `claim_daily_bonus()`

1. Check `last_bonus_at` is null or < today's date (UTC)
2. Award 100 coins: `balance_total += 100`, `balance_available += 100`
3. Set `last_bonus_at = now()`
4. Insert `daily_bonus` transaction

### `join_match_league(p_match_league_id)`

1. Load league — must be `status = 'open'`, `fixture.kickoff_at > now()`
2. Check user not already a member
3. Check `balance_available >= entry_fee`
4. Deduct entry fee: `balance_available -= entry_fee`, `balance_total -= entry_fee`
5. Insert member row
6. Insert `entry_fee` transaction

---

## 8. Resolution Rules

Resolution rules are stored as JSONB in `market_questions.resolution_rule`.

| `type` | Fields | Resolution logic |
|---|---|---|
| `match_result` | `home_team_id`, `away_team_id` | Check `home_winner`/`away_winner` columns |
| `first_half_result` | — | Check `raw_fixture->'score'->'halftime'` |
| `total_goals` | `operator` (over/under), `threshold` | `home_goals + away_goals` vs threshold |
| `btts` | — | `home_goals > 0 AND away_goals > 0` |
| `team_more_corners` | `home_team_id`, `away_team_id` | Corner stat from fixture statistics |
| `team_more_possession` | — | Possession stat from fixture statistics |
| `player_goal` | `player_id`, `player_name` | Match events: type=`Goal`, player_id match |
| `player_assist` | `player_id`, `player_name` | Match events: type=`Goal`, assist player_id match |
| `player_card` | `player_id`, `player_name` | Match events: type=`Card` |
| `ai_resolved` | `resolution_note` | Manual or AI resolver for real_world_edge questions |

---

## 9. Match Leagues

Match Leagues are per-fixture entry competitions. Users pay an entry fee to join a closed leaderboard. The player with the highest prediction score for that match wins.

### Tables

- `market_match_leagues` — league definition with entry_fee, max_participants, reward_coins, reward_xp
- `market_match_league_members` — member rows with final_rank, coins_won, xp_won

### Status lifecycle

`open → closed (at kickoff) → resolved (after match)`

---

## 10. Trophies

Trophies are awarded automatically when a user crosses a defined threshold.

### Trophy categories

| Trophy | Trigger |
|---|---|
| Real World Edge – Insider | 5 correct real_world_edge predictions |
| Real World Edge – Oracle | 20 correct real_world_edge predictions |
| Bold Master | 10 BOLD predictions won |
| Accuracy Star | 80%+ accuracy over 20+ predictions |
| Hot Streak | 5 consecutive correct predictions |
| El Clásico Champion | Correct match result for El Clásico |
| Derby Winner | Correct match result for a derby match |
| High Roller | Placed BOLD stake ≥ 200 coins |
| Market Veteran | 100 total predictions placed |

---

## 11. Daily Challenges

Daily challenges reset at 00:00 UTC each day.

| Challenge | Goal | Reward |
|---|---|---|
| Daily Predictor | Place 5 predictions | +100 coins, +25 XP |
| On Fire | Win 3 predictions | +150 coins, +40 XP |
| Risk Taker | Place 1 BOLD prediction | +75 coins, +20 XP |
| Real World Scout | Answer 2 real_world_edge questions | +200 coins, +50 XP |
| Match League Entry | Join 1 Match League | +50 coins, +15 XP |

---

## 12. Leaderboards

| Leaderboard | Metric | Filter |
|---|---|---|
| Weekly Profit | Net coins won this week | Min 5 predictions |
| All-Time Accuracy | Correct % | Min 20 predictions |
| XP Ranking | market_wallets.xp_total | None |
| Bold Performance | BOLD wins / BOLD total | Min 5 BOLD placed |

---

## 13. XP Rewards

| Action | XP |
|---|---|
| Correct prediction (easy) | 10 |
| Correct prediction (medium) | 20 |
| Correct prediction (hard) | 30 |
| Correct real_world_edge | 50 |
| Correct featured question | 35 |
| BOLD win | +15 bonus on top of difficulty XP |
| Daily challenge complete | 15–50 per challenge |

---

## 14. Question Generation (Edge Function: `generate-market-questions`)

Triggered by pg_cron daily at 08:00 UTC. Also callable on-demand via POST.

1. Query `api_football_fixtures` — upcoming 72h, league_id IN (39, 140)
2. Filter to matches involving at least one target team
3. Skip fixtures already having market questions
4. Generate questions per fixture:
   - **Template questions** (match_result, goals, team_stats): built from fixture data
   - **Player predictions**: built from lineup data if available in raw_fixture
   - **Real World Edge** (2–3 per match): OpenAI call with match context, news headlines
5. Set `is_featured = true` on top 3–5 questions per fixture (highest difficulty)
6. Insert with `status = 'draft'`, then set to `active` after validation
7. `deadline_at = kickoff_at - interval '30 minutes'` (60min for real_world_edge)
8. `resolves_after = kickoff_at + interval '95 minutes'` (approx. full-time)

---

## 15. Question Resolution (Edge Function: `resolve-market-questions`)

Triggered by pg_cron every 15 minutes.

1. Fetch questions WHERE `status = 'locked'` AND `resolves_after <= now()`
2. For each question, load fixture from `api_football_fixtures`
3. Apply `resolution_rule` to determine `correct_answer`
4. Call `resolve_market_question(question_id, correct_answer)` RPC
5. Skip questions where fixture is not yet finished (`status_short NOT IN ('FT','AET','PEN')`)
6. Log all outcomes; void questions where data is unavailable after 24h grace period

---

## 16. Migration Map

| Migration | Contents |
|---|---|
| 085 | `market_wallets` table, creation trigger, seed balance |
| 086 | `market_transactions` ledger |
| 087 | `market_questions` table, indexes, RLS |
| 088 | `market_predictions` table, UNIQUE constraint, RLS |
| 089 | `market_match_leagues` + `market_match_league_members` |
| 090 | `market_trophies` + `market_user_trophies` |
| 091 | `market_daily_challenges` + `market_user_challenge_progress` |
| 092 | Core RPCs: place_prediction, resolve_market_question, void_market_question, claim_daily_bonus, join_match_league |
| 093 | Market leaderboard views, XP event integration |
