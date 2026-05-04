# League Scoring V2

**Status: implemented 2026-05-04. Pending deploy.**
**Migration: 052_league_scoring_v2.sql**

This document is the canonical spec for how Leagues score answers. Any change to League scoring must update this doc first. Arena and Battle Royale are NOT covered here — they keep their existing scoring engines unchanged.

---

## Scope

V2 applies to **every league-bound question** — that is, every `questions` row where `league_id IS NOT NULL`. This includes all three league creation types:

- Season-Long
- Match Night
- Custom

Arena (`questions.arena_session_id`) and Battle Royale (`questions.br_session_id`) are explicitly out of scope. The resolver branches by scope; League V2 is reached only when the question has `league_id` set.

---

## What V2 removes from League scoring

The V1 league formula was:

```
points = base_value × time_pressure × difficulty × streak × comeback × clutch
```

V2 **deletes the entire multi-multiplier stack for leagues**. None of these apply to league questions any more:

- Time-pressure multiplier (1.0–1.5×) — was rewarding speed
- Streak multiplier (1.0–1.3×)
- Comeback multiplier (1.0–1.3×)
- Clutch multiplier (1.0–1.25×)
- Difficulty multiplier (1.0–1.5×)
- Base-value tiers (6 / 10 / 12 / 15 / 20)

These remain in the codebase for Arena and BR — do not delete the helper functions.

---

## What V2 introduces

### Flat scoring with optional Confidence

Every league answer scores the same way: a fixed integer based on correctness and (optionally) the player's pre-submitted confidence level.

```
calculateLeagueAnswerPoints(isCorrect, confidenceLevel) → integer
```

| Confidence | Correct | Wrong |
|---|---|---|
| Normal     | +10 | 0 |
| High       | +15 | -5 |
| Very High  | +20 | -10 |

Negative scores are allowed. A player's cumulative league score CAN go down.

### Creator-controlled toggle

Each league has `leagues.confidence_scoring_enabled BOOLEAN DEFAULT false`. Set at creation time in `create-league.html`.

- **OFF (default)**: every answer scores as Normal regardless of any per-answer `confidence_level` value.
- **ON**: the player must pick Normal / High / Very High before submitting. Their selection is honored at resolve time.

### Per-answer confidence

`player_answers.confidence_level TEXT DEFAULT 'normal'` — captured at submission time. Allowed values: `'normal' | 'high' | 'very_high'`.

Even when the league has confidence scoring OFF, the column is still written with `'normal'` (the default) so historical records stay consistent. The resolver ignores the value when the league flag is OFF.

---

## UI rules

### League page (`league.html`)

When `currentLeague.confidenceScoringEnabled === true`:

1. Render a Confidence selector strip ABOVE the answer buttons. Three chips: Normal / High / Very High with their point pairs.
2. Default selection is Normal.
3. Player can change selection up until they click an answer button.
4. Clicking an answer button locks both the answer AND the chosen confidence — neither can be changed afterwards.
5. Once locked, the selector renders read-only with a "Confidence (locked)" label.

When `confidenceScoringEnabled === false`: the strip is not rendered. Player just answers.

Wording rules:
- Use "Confidence", never "Risk".
- No betting / odds / gambling language.
- Show point values explicitly ("+15 / -5") not implied multipliers.

### Create-league page

Single toggle row labelled "Confidence Scoring" under Game Mechanics. Default OFF.

The previous toggles (Risky Answers, Streak Bonuses, Live Stats Feed, Betting-Style Predictions) were **never wired to scoring** in V1 — pure UI mock. They are removed entirely from this screen as of V2.

### Review screen

Single row: `Confidence Scoring: On — players pick Normal / High / Very High per answer` OR `Off — flat +10 / 0`.

---

## Resolver rules

`supabase/functions/resolve-questions/index.ts → markCorrectAnswers()`:

1. Pull `confidence_level` from each `player_answers` row.
2. If `q.league_id` is set:
   - Fetch `leagues.confidence_scoring_enabled` once per league per resolve cycle.
   - For each answer, compute `effectiveConf = confidenceEnabled ? (a.confidence_level ?? 'normal') : 'normal'`.
   - Apply `calculateLeagueAnswerPoints(isCorrect, effectiveConf)`.
   - Write `points_earned` and a `multiplier_breakdown` JSONB with `model: 'league_v2'` for audit.
   - Skip the legacy multiplier formula entirely.
3. If `q.arena_session_id` or `q.br_session_id` is set: fall through to the legacy V1 formula. Unchanged.

The leagues lookup can fail-closed: if the read errors, the resolver defaults to `confidenceEnabled = false` (Normal scoring) and logs the error. No question is ever skipped because of a missing config row.

---

## Backward compatibility

- Already-resolved answers (`is_correct IS NOT NULL`, `points_earned` set) are not re-scored. Historical leaderboards stay stable.
- In-flight unresolved answers in pre-V2 leagues: at next resolver run, they will score under V2 (flat +10 / 0 since `confidence_scoring_enabled` defaults to false on existing rows). Mid-league scoring jump is acceptable per launch decision.
- Arena and BR session players: untouched.

---

## Changes to other docs

- `CLAUDE.md` — top of update log: V2 entry.
- `docs/GAMEPLAY_ARCHITECTURE.md` — Pillar 1 scoring section flips from V1 formula to V2.
- `docs/TIER_ARCHITECTURE.md` — `riskyAnswers` and `streakBonuses` per-tier flags are now dead config (read nowhere). Note kept for cleanup.
- The legacy "scoring system" section in `CLAUDE.md` (V1 formula details, multiplier tables) remains for Arena/BR reference.

---

## Test cases (manual smoke)

| # | Setup | Expected |
|---|---|---|
| 1 | League with `confidence_scoring_enabled = false`, player answers correctly | `points_earned = 10` |
| 2 | Same league, player answers wrong | `points_earned = 0` |
| 3 | League with confidence enabled, Normal correct | `+10` |
| 4 | Same, Normal wrong | `0` |
| 5 | High correct | `+15` |
| 6 | High wrong | `-5` |
| 7 | Very High correct | `+20` |
| 8 | Very High wrong | `-10` |
| 9 | `confidence_level = NULL` (legacy row) | scored as Normal |
| 10 | League has confidence OFF but answer has `confidence_level='high'` | scored as Normal (resolver forces it) |
| 11 | Arena session question, any confidence value | legacy formula runs unchanged |
| 12 | BR session question | legacy formula runs unchanged |
| 13 | Two consecutive wrong High answers | total goes from 0 → -5 → -10 |
| 14 | League leaderboard sums all `points_earned`, including negatives | total can be negative |

---

## Change log

- **2026-05-04 (revision 1)** — Initial V2 spec written and implemented. Migration 052 (additive only). Resolver branched by scope. UI: confidence selector in `league.html`, single toggle in `create-league.html`, dead mechanics removed.
