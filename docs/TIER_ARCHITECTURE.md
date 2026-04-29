# Spontix Tier Architecture

Last updated: 2026-04-29 (v7 — play_mode vs tier distinction)

This document is the authoritative reference for all tier logic in Spontix. All pricing, feature gates, limits, and upgrade copy must be derived from this file. The implementation lives in `TIER_LIMITS` in `spontix-store.js`.

---

## Core Monetization Rule

Spontix question lanes are monetized in strict order:

| Lane | Tier access | Rationale |
|---|---|---|
| `CORE_MATCH_PREMATCH` | Starter, Pro, Elite | Entry-level value — taste of the product |
| `CORE_MATCH_LIVE` | Starter (limited, 3/match), Pro, Elite | Core product differentiator — the upgrade hook |
| `REAL_WORLD` | Pro (limited), Elite (full) | Premium intelligence layer — high cost, high perceived value |

**Real World questions cost money to generate (OpenAI + API-Sports calls) and must never be treated as free default content.**

The upgrade hook for Starter → Pro is always "Remove Live Prediction Limits". Every upgrade prompt should reinforce the 3/match cap.

---

## Player Tiers

### Starter — Free

Purpose: let users experience the product, hit meaningful limits, and understand what they're missing.

| Feature | Value |
|---|---|
| Price | Free |
| Create leagues / week | 1 |
| Join leagues | 3 |
| Max players in own league | 10 |
| AI questions / month | 30 |
| **CORE_MATCH_PREMATCH** | ✅ enabled |
| **CORE_MATCH_LIVE** | ⚠️ limited (3 answers/match) |
| **REAL_WORLD** | 🔒 locked |
| Real World questions / month | 0 |
| Battle Royale / day | 3 |
| Battle Royale / month | — (uses daily cap) |
| Trivia modes | Solo only |
| Trivia games / day | 5 |
| Trivia games / month | — (uses daily cap) |
| 1v1 trivia | 🔒 locked |
| Streak bonuses | 🔒 locked |
| Risky answers | 🔒 locked |
| Live stats feed | 🔒 locked |
| Betting-style predictions | 🔒 locked |
| Custom photo upload | 🔒 locked |
| Custom league cover photo | 🔒 locked |
| Advanced analytics | 🔒 locked |
| Prediction history export | 🔒 locked |
| Ad-free | No |

**What Starter users should see:** Live questions are accessible but capped at 3 answers per match — buttons disable at the limit with a "Live answers: 3/3" indicator and an "Upgrade" link. Real World questions show a locked state. Upgrade prompt copy: *"Remove Live Prediction Limits with Pro"*.

---

### Pro — €7.99 / month

Purpose: unlock the core live experience. This is the primary revenue tier.

| Feature | Value |
|---|---|
| Price | €7.99/mo |
| Create leagues / week | 5 |
| Join leagues | 20 |
| Max players in own league | 40 |
| AI questions / month | 400 |
| **CORE_MATCH_PREMATCH** | ✅ enabled |
| **CORE_MATCH_LIVE** | ✅ enabled |
| **REAL_WORLD** | ⚠️ limited |
| Real World questions / month | 10 |
| Battle Royale / day | — (uses monthly cap) |
| **Battle Royale / month** | **50** |
| Trivia modes | Solo + 1v1 |
| Trivia games / day | — (uses monthly cap) |
| **Trivia games / month** | **100** |
| 1v1 trivia | ✅ |
| Streak bonuses | ✅ |
| Risky answers | ✅ |
| Live stats feed | 🔒 locked (Elite) |
| Betting-style predictions | 🔒 locked (Elite) |
| Custom photo upload | ✅ |
| Custom league cover photo | ✅ |
| Advanced analytics | 🔒 locked (Elite) |
| Ad-free | ✅ |

**Pro uses monthly caps, not daily.** A Pro user who plays 10 BR games in one day is not blocked — only the 50/month total is enforced. This feels significantly more generous than Starter's daily 3/day cap.

**Cost logic:** 400 AI questions × ~$0.003 ≈ $1.20 + API calls ~$1.50 = ~$2.70/month cost at ~65% margin.

**Upgrade copy:** *"Unlock Live Match Predictions with Pro"*

---

### Elite — €19.99 / month

Purpose: power users, league organizers, high-engagement fans who want everything.

| Feature | Value |
|---|---|
| Price | €19.99/mo |
| Create leagues / week | Unlimited |
| Join leagues | Unlimited |
| Max players in own league | 100 |
| AI questions / month | 1,500 |
| **CORE_MATCH_PREMATCH** | ✅ enabled |
| **CORE_MATCH_LIVE** | ✅ enabled |
| **REAL_WORLD** | ✅ full + priority |
| Real World questions / month | Unlimited |
| Battle Royale | Unlimited (fair-use) |
| Trivia modes | Solo + 1v1 + Party Room |
| Trivia games | Unlimited (fair-use) |
| Streak bonuses | ✅ |
| Risky answers | ✅ |
| Live stats feed | ✅ |
| Betting-style predictions | ✅ |
| Season-long competitions | ✅ |
| Custom questions | ✅ |
| Custom photo upload | ✅ |
| Custom league cover photo | ✅ |
| Custom trophy creation | ✅ |
| Advanced analytics | ✅ |
| Prediction history export | ✅ |
| Early access to new features | ✅ |
| Ad-free | ✅ |

**Elite uses fair-use protection, not monthly counters.** There is no hard monthly BR or trivia cap. Instead, a short cooldown (20–30s) is enforced between sessions to prevent abuse. The UI uses neutral language — never "limit reached". See the Elite Fair-Use section below.

**Cost logic:** 1,500 AI questions × ~$0.003 ≈ $4.50 + API calls ~$4.00 = ~$8.50/month cost at ~57% margin.

**Upgrade copy from Pro:** *"Make your league yours with Elite"* / *"Unlock AI News & Rumour Intelligence"*

---

## Elite Fair-Use Model

Elite BR and trivia games are technically unlimited but protected by a session cooldown. This prevents uncontrolled compute costs while keeping the "unlimited" promise honest for real users.

### How it works

1. **Game start:** a 30-second cooldown is written to localStorage (`spontix_br_cooldown` / `spontix_trivia_cooldown`) as a Unix timestamp.
2. **Game completion:** the cooldown is reset to 20 seconds from completion time (not from start time).
3. **Next session attempt:** if the cooldown has not expired, the start is blocked with a neutral message.
4. **Normal use:** a user who plays one game every few minutes will never see the cooldown — 20–30 seconds is unnoticeable at normal pace.

### UX language — MANDATORY

**Use neutral, forward-looking language. Never imply a limit has been reached.**

| ✅ Correct | ❌ Wrong |
|---|---|
| "Preparing your next match… ready in 12s" | "You reached your unlimited limit" |
| "Preparing your next game… ready in 8s" | "Too many games — try again soon" |
| "Getting everything ready…" | "Fair-use limit reached" |
| (disappears automatically after countdown) | (shows an upgrade modal) |

### Implementation

```js
// localStorage keys
'spontix_br_cooldown'      // Unix timestamp — cooldown expires when Date.now() > this value
'spontix_trivia_cooldown'  // same pattern for trivia

// On game start (Elite only):
localStorage.setItem('spontix_br_cooldown', (Date.now() + 30000).toString());

// On game completion (victory screen):
localStorage.setItem('spontix_br_cooldown', (Date.now() + 20000).toString());

// On next session attempt:
const cooldownUntil = parseInt(localStorage.getItem('spontix_br_cooldown') || '0');
const remaining = cooldownUntil - Date.now();
if (remaining > 0) {
  showToast('Preparing your next match… ready in ' + Math.ceil(remaining / 1000) + 's');
  return;
}
```

Cooldown keys in `TIER_LIMITS` (used for feature detection, not the timer itself):
- `battleRoyaleFairUse: true` on Elite
- `triviaFairUse: true` on Elite

---

## Venue Tiers

### Venue Starter — Free

Purpose: let venues test Spontix at a single event with no commitment.

| Feature | Value |
|---|---|
| Price | Free |
| Events / month | 2 |
| Max participants / event | 25 |
| AI questions / month | 0 (pre-made bank only) |
| **CORE_MATCH_LIVE AI** | 🔒 locked |
| **REAL_WORLD** | 🔒 locked |
| Real World questions / month | 0 |
| Custom branding | 🔒 locked |
| Custom photos | 🔒 locked |
| Custom trophies | 🔒 locked |
| Can award trophies | No |
| Analytics | 🔒 locked |
| TV display mode | 🔒 locked |
| Floor map | 🔒 locked |
| Multi-venue | 🔒 locked |

**Why no AI on free:** each AI-enabled event costs ~$0.15–0.30 in generation + API resolver calls. Cannot absorb at scale. Pre-made question bank gives the UX without the cost.

---

### Venue Pro — €29.99 / month

Purpose: regular sports bars running recurring events who want AI to handle question generation.

| Feature | Value |
|---|---|
| Price | €29.99/mo |
| Events / month | Unlimited |
| Max participants / event | 150 |
| AI questions / month | 300 |
| **CORE_MATCH_PREMATCH AI** | ✅ enabled |
| **CORE_MATCH_LIVE AI** | ✅ enabled |
| **REAL_WORLD** | ⚠️ limited |
| Real World questions / month | 20 |
| Custom photos | ✅ (up to 8) |
| Custom trophies | ✅ (up to 5) |
| Can award trophies | ✅ |
| Basic + advanced analytics | ✅ |
| TV display mode | ✅ |
| Floor map | ✅ |
| Custom branding | ✅ |
| White-label | 🔒 locked (Elite) |
| Multi-venue | 🔒 locked (Elite) |
| Sponsored questions | 🔒 locked (Elite) |
| API access | 🔒 locked (Elite) |

**Cost logic:** 300 AI questions × ~$0.003 ≈ $0.90 + API calls for ~25 events × $0.20 = $5.90/month cost at ~80% margin.

**Upgrade copy:** *"Let AI run your match night"*

---

### Venue Elite — €79.99 / month

Purpose: large venues, multi-location operators, hospitality groups.

| Feature | Value |
|---|---|
| Price | €79.99/mo |
| Events / month | Unlimited |
| Max participants / event | 500 |
| AI questions / month | 1,000 |
| **CORE_MATCH_PREMATCH AI** | ✅ full |
| **CORE_MATCH_LIVE AI** | ✅ full |
| **REAL_WORLD** | ✅ full + priority |
| Real World questions / month | Unlimited |
| Custom photos | Unlimited |
| Custom trophies | Unlimited |
| Can award trophies | ✅ |
| Analytics + CRM export | ✅ |
| TV display + live stats | ✅ |
| Floor map | ✅ |
| Custom branding | ✅ |
| White-label option | ✅ |
| Multi-venue management | ✅ |
| Sponsored question slots | ✅ |
| API access | ✅ |
| AI bulk generation | ✅ |
| Priority support | ✅ |

**Cost logic:** 1,000 AI questions × ~$0.003 ≈ $3 + high-volume API + infrastructure = ~$18/month cost at ~77% margin.

---

## Feature Gate Matrix

### Player gates — key fields in `TIER_LIMITS`

| Key | Starter | Pro | Elite |
|---|---|---|---|
| `liveQuestionsEnabled` | `true` | `true` | `true` |
| `liveQuestionsMode` | `'limited'` | `'full'` | `'full'` |
| `liveQuestionsPerMatch` | `3` | `-1` | `-1` |
| `realWorldQuestionsEnabled` | `false` | `'limited'` | `true` |
| `realWorldQuestionsPerMonth` | `0` | `10` | `-1` |
| `aiQuestionsPerMonth` | `30` | `400` | `1500` |
| `aiWeeklyQuota` | `2` | `5` | `10` |
| `leaguesCreatePerWeek` | `1` | `5` | `-1` |
| `leaguesJoinMax` | `3` | `20` | `-1` |
| `leagueMaxPlayers` | `10` | `40` | `100` |
| `battleRoyalePerDay` | `3` | `null` | `null` |
| `battleRoyalePerMonth` | `null` | `50` | `-1` |
| `battleRoyaleFairUse` | `false` | `false` | `true` |
| `triviaGamesPerDay` | `5` | `null` | `null` |
| `triviaGamesPerMonth` | `null` | `100` | `-1` |
| `triviaFairUse` | `false` | `false` | `true` |
| `triviaModesAllowed` | `['solo']` | `['solo','1v1']` | `['solo','1v1','party-room']` |
| `riskyAnswers` | `false` | `true` | `true` |
| `streakBonuses` | `false` | `true` | `true` |
| `liveStats` | `false` | `false` | `true` |
| `bettingPredictions` | `false` | `false` | `true` |
| `customPhotoUpload` | `false` | `true` | `true` |
| `customLeagueCoverPhoto` | `false` | `true` | `true` |
| `customTrophyCreation` | `false` | `false` | `true` |
| `advancedAnalytics` | `false` | `false` | `true` |
| `predictionHistoryExport` | `false` | `false` | `true` |

**`null` means "this tier uses a different limit type".** For game modes:
- Starter: `battleRoyalePerDay = 3`, `battleRoyalePerMonth = null` → use the daily counter
- Pro: `battleRoyalePerDay = null`, `battleRoyalePerMonth = 50` → use the monthly counter
- Elite: `battleRoyalePerDay = null`, `battleRoyalePerMonth = -1`, `battleRoyaleFairUse = true` → no counter, fair-use only

**`-1` means unlimited** (for monthly counters — Elite tier gets `-1` meaning fair-use applies, not a hard monthly cap).

### Venue gates — key fields in `TIER_LIMITS`

| Key | Venue Starter | Venue Pro | Venue Elite |
|---|---|---|---|
| `eventsPerMonth` | `2` | `-1` | `-1` |
| `maxParticipants` | `25` | `150` | `500` |
| `aiQuestionsPerMonth` | `0` | `300` | `1000` |
| `aiPreviewPerEvent` | `3` | `-1` | `-1` |
| `liveQuestionsEnabled` | `false` | `true` | `true` |
| `realWorldQuestionsEnabled` | `false` | `'limited'` | `true` |
| `realWorldQuestionsPerMonth` | `0` | `20` | `-1` |
| `canAwardTrophies` | `false` | `true` | `true` |
| `customTrophyMax` | `0` | `5` | `-1` |
| `photoMaxCustom` | `0` | `8` | `-1` |
| `customBranding` | `false` | `true` | `true` |
| `whiteLabelOption` | `false` | `false` | `true` |
| `multiVenue` | `false` | `false` | `true` |
| `sponsoredQuestions` | `false` | `false` | `true` |
| `apiAccess` | `false` | `false` | `true` |
| `basicAnalytics` | `false` | `true` | `true` |
| `advancedAnalytics` | `false` | `true` | `true` |

---

## Upgrade Modal Copy

Use these strings in `SpontixSidebar.showUpgradeModal()` calls:

| Trigger | Required tier | Description |
|---|---|---|
| Live answer limit reached (Starter) | Pro | "Remove Live Prediction Limits with Pro" |
| Real World questions locked | Pro / Elite | "Unlock AI News & Rumour Intelligence" |
| Custom photo upload locked | Pro | "Upgrade to Pro to upload a custom profile photo" |
| Custom trophy creation locked | Elite | "Make your league yours with Elite" |
| 1v1 trivia locked | Pro | "Challenge friends with 1v1 trivia on Pro" |
| Party Room trivia locked | Elite | "Unlock Party Room trivia with Elite" |
| Live stats locked | Elite | "Unlock live stats with Elite" |
| BR daily limit reached (Starter) | Pro | "You used your 3 Battle Royale matches for today. Remove limits with Pro." |
| BR monthly limit reached (Pro) | Elite | "You used your 50 Battle Royale games this month. Upgrade to Elite for unlimited play." |
| Trivia daily limit reached (Starter) | Pro | "You used your 5 trivia games for today. Remove limits with Pro." |
| Trivia monthly limit reached (Pro) | Elite | "You used your 100 trivia games this month. Upgrade to Elite for unlimited play." |
| Elite BR/Trivia cooldown active | — | **Toast only** (no modal): "Preparing your next match… ready in Xs" |
| Venue AI questions locked | Venue Pro | "Let AI run your match night" |
| Venue branding locked | Venue Pro | "Make it yours — custom branding on Venue Pro" |
| Venue white-label locked | Venue Elite | "Remove all Spontyx branding with Elite" |

---

## Implementation Notes

### Central source of truth

`TIER_LIMITS` in `spontix-store.js` is the single source of truth for all tier logic. **Do not hardcode tier values anywhere else.** Always read from `SpontixStore.getTierLimits(tier)`.

### Tier resolution

```js
const player = SpontixStore.getPlayer();
const tier   = player?.tier || 'starter';
const limits = SpontixStore.getTierLimits(tier);
```

For venues:
```js
const tier   = localStorage.getItem('spontix_user_tier') || 'venue-starter';
const limits = SpontixStore.getTierLimits(tier);
```

### Three enforcement layers (all three must apply)

1. **UI** — controls are visually locked with a tier badge. User sees what they're missing.
2. **Handler** — click handlers call `SpontixSidebar.showUpgradeModal()` instead of executing.
3. **Store** — functions return `{ error: 'tier' }` when called on an ineligible tier.

### `liveQuestionsEnabled` + `liveQuestionsMode` — two-key live gate

`liveQuestionsEnabled` is `true` for all three player tiers. Starter can see and answer LIVE questions in a limited way. Use `liveQuestionsMode` to distinguish:

| Tier | `liveQuestionsEnabled` | `liveQuestionsMode` | `liveQuestionsPerMatch` |
|---|---|---|---|
| Starter | `true` | `'limited'` | `3` |
| Pro | `true` | `'full'` | `-1` |
| Elite | `true` | `'full'` | `-1` |

**Creating a league with live mode** requires `liveQuestionsMode !== 'limited'` — Starter cannot create live-mode leagues, only participate in them up to the per-match limit.

```js
// Gate for creating a live-mode league (Pro+ only)
const canCreateLive = limits.liveQuestionsEnabled && limits.liveQuestionsMode !== 'limited';

// Gate for answering a live question (all tiers — use liveQuestionsPerMatch for cap)
const perMatchLimit = limits.liveQuestionsPerMatch; // -1 = unlimited
```

### Game mode limit resolution — 3-way pattern

The same pattern is used for both BR and Trivia:

```js
// Starter: daily cap
if (limits.battleRoyalePerDay !== null) {
  // enforce daily counter: spontix_br_day_DATESTRING

// Pro: monthly cap
} else if (limits.battleRoyalePerMonth !== null && limits.battleRoyalePerMonth !== -1) {
  // enforce monthly counter: spontix_br_month_YYYY_M

// Elite: fair-use
} else if (limits.battleRoyaleFairUse) {
  // check spontix_br_cooldown timestamp
  // show toast if still cooling down, set 30s cooldown at game start
}
```

**`null` on a `PerDay` key = "don't use a daily counter — look at the monthly key instead."**
**`-1` on a `PerMonth` key = "no monthly counter — fair-use only."**
**`true` on `FairUse` key = "enforce the cooldown pattern."**

### localStorage keys for game mode counters

| Key pattern | Used for |
|---|---|
| `spontix_br_day_${new Date().toDateString()}` | Starter BR daily counter |
| `spontix_br_month_${year}_${month}` | Pro BR monthly counter |
| `spontix_br_cooldown` | Elite BR fair-use cooldown (Unix timestamp) |
| `spontix_trivia_day_${new Date().toDateString()}` | Starter trivia daily counter |
| `spontix_trivia_month_${year}_${month}` | Pro trivia monthly counter |
| `spontix_trivia_cooldown` | Elite trivia fair-use cooldown (Unix timestamp) |

### `-1` means unlimited

All numeric limits use `-1` to represent "no limit" (replacing `Infinity`). Every limit check must use `!== -1` instead of `isFinite()` or `!== Infinity`.

```js
// Correct
if (limits.eventsPerMonth !== -1) { /* enforce the limit */ }

// Wrong
if (isFinite(limits.eventsPerMonth)) { /* old pattern — do not use */ }
if (limits.eventsPerMonth !== Infinity) { /* old pattern — do not use */ }
```

### `null` means "use a different counter type"

For game mode limits, `null` signals that this counter type is not applicable for this tier. The 3-way check pattern above handles this correctly.

### `aiWeeklyQuota` — per-league AI generation budget

`aiWeeklyQuota` (Starter: 2, Pro: 5, Elite: 10) is written to `leagues.ai_weekly_quota` at creation time by `create-league.html:launchLeague()`. The Edge Function reads `leagues.ai_weekly_quota` directly. This means the budget is locked to the tier at creation — upgrading after creation does not automatically increase the quota. Post-launch, a migration or admin tool will be needed to update `ai_weekly_quota` when a user upgrades.

### `realWorldQuestionsEnabled` — three states

- `false` — fully locked (Starter)
- `'limited'` — quota-capped (Pro: 10/month player, 20/month venue)
- `true` — full access (Elite)

### Elite tier forcing (MVP)

`authGate()` in `spontix-store.js` currently forces `elite` / `venue-elite` for all users until Stripe billing is wired. When Stripe lands, remove the forced tier assignment and read the real tier from the `users` table.

---

## Question Intensity System (migration 017)

Added 2026-04-27. Defines how many questions are targeted per match, controlled by a preset selected at league/event creation.

### Intensity presets

| Preset | Prematch budget | Live budget | Access |
|---|---|---|---|
| `casual` | 3 | 5 | All tiers |
| `standard` | 4 | 8 | All tiers (default) |
| `hardcore` | 6 | 12 | Pro+ player / Venue Pro+ |

Prematch budget = target number of `CORE_MATCH_PREMATCH` questions generated before kick-off.  
Live budget = target number of `CORE_MATCH_LIVE` questions generated during the match.

These are targets, not hard caps — actual volume is further constrained by the AI weekly quota per league and pool availability.

### Tier access to presets

**Statement 1: Tier gates which presets are selectable.**

| Tier | `allowedIntensityPresets` | `intensityConfigurable` |
|---|---|---|
| Starter | `['casual', 'standard']` | `false` — fixed at `standard` |
| Pro | `['casual', 'standard', 'hardcore']` | `true` |
| Elite | `['casual', 'standard', 'hardcore']` | `true` |
| Venue Starter | `['casual']` | `false` — fixed at `casual` |
| Venue Pro | `['casual', 'standard']` | `true` |
| Venue Elite | `['casual', 'standard', 'hardcore']` | `true` |

`intensityConfigurable: false` means the UI should not show a preset picker — the league/event is locked to the `defaultIntensityPreset` for that tier.

### clampIntensity() — enforcement function

**Statement 2: `clampIntensity(requestedPreset, tier)` is the single gate for preset validation.**

Defined in `spontix-store.js` alongside `TIER_LIMITS`. Call this before saving a league or event to the DB.

```js
// Returns: { ok: true, preset, prematch, live }
// Or:      { ok: false, error: 'preset_not_allowed', allowed: [...], fallback: '...' }
const result = SpontixStore.clampIntensity('hardcore', 'starter');
// → { ok: false, error: 'preset_not_allowed', allowed: ['casual','standard'], fallback: 'standard' }

const result = SpontixStore.clampIntensity('standard', 'pro');
// → { ok: true, preset: 'standard', prematch: 4, live: 8 }
```

If `ok: false`, show an upgrade prompt and use `result.fallback` as the saved preset.

Save `result.prematch` → `leagues.prematch_question_budget`, `result.live` → `leagues.live_question_budget`.

### Pool generation target

**Statement 3: The pool is generated to satisfy the HIGHEST-budget co-profile league, not the generating league's own budget.**

When the generation pipeline generates a canonical question pool for a match, multiple leagues may share that same pool. They share it only if they have an identical generation profile (all 8 PoolCacheKey fields: match_id, sport, league_type, phase_scope, mode, scope, scoped_team_id, prompt_version).

The pool is generated at `poolGenerationTarget = max(prematch_question_budget)` across all co-profile leagues in the current run batch, with a fallback of 8.

Each league then gets its own slice capped at `min(quota.questionsToGenerate, league.prematch_question_budget)`.

This means: if League A has CASUAL (prematch=3) and League B has HARDCORE (prematch=6) and they share the same profile, one OpenAI call produces 6 canonical questions. League A gets 3, League B gets 6.

### Venue Starter AI preview (aiPreviewPerEvent)

`aiPreviewPerEvent: 3` on `venue-starter` limits each venue event to 3 total AI questions. Venue events map to their own `league_id` in the generation pipeline — the league_id is the correct unit for this cap (not event_id, which does not appear in the `questions` table).

Enforcement is in `generate-questions/index.ts`: before Phase A, if the owner tier is `venue-starter`, the pipeline counts `questions WHERE league_id = league.id AND source = 'ai_generated'`. If the count is ≥ 3, the league is skipped with `skipReason: 'venue_ai_preview_cap'`.

### DB columns (migration 017)

| Table | Column | Type | Default | Notes |
|---|---|---|---|---|
| `leagues` | `question_intensity_preset` | `TEXT` CHECK | `'standard'` | |
| `leagues` | `prematch_question_budget` | `INTEGER` | `4` | STANDARD default |
| `leagues` | `live_question_budget` | `INTEGER` | `8` | STANDARD default |
| `venue_events` | `question_intensity_preset` | `TEXT` CHECK | `'standard'` | |
| `venue_events` | `prematch_question_budget` | `INTEGER` | `4` | |
| `venue_events` | `live_question_budget` | `INTEGER` | `8` | |

---

## Pre-Match Scheduling System (migration 018)

Added 2026-04-27. Gives league owners control over WHEN pre-match questions become visible in the feed before kickoff.

### Two modes

| Mode | Behaviour | Tier |
|---|---|---|
| `automatic` | Questions appear as soon as they are generated (within 24–48h of kickoff). Default for all tiers. | All |
| `manual` | Questions appear exactly at `kickoff − offset_hours`. Tier-gated. | Pro+ |

### Allowed publish offsets (manual mode)

| Offset | Meaning | Tier |
|---|---|---|
| `48h` | Questions visible 48 hours before kickoff | Elite only |
| `24h` | Questions visible 24 hours before kickoff | Pro, Elite |
| `12h` | Questions visible 12 hours before kickoff | Pro, Elite |
| `6h` | Questions visible 6 hours before kickoff — maximum match-day intensity | Elite only |

### `TIER_LIMITS` keys

| Key | Type | Starter | Pro | Elite |
|---|---|---|---|---|
| `prematchSchedulingEnabled` | `boolean` | `false` | `true` | `true` |
| `allowedPrematchOffsets` | `number[]` | `[]` | `[24, 12]` | `[48, 24, 12, 6]` |

### Generation logic (Edge Function)

- **Automatic**: match is eligible when kickoff is ≤ 48h away. `visible_from = now`.
- **Manual**: match is eligible when `now >= kickoff − offset_hours`. `visible_from = kickoff − offset_hours` (clamped to now if the publish window is already past — handles late-creation edge case).
- **Both modes**: never generate after kickoff. `kickoff <= now` → ineligible.
- If no matches are in the publish window, the league is skipped with `skipReason: 'no_matches_in_publish_window'`.

### Pool reuse

Pool questions store the canonical `opens_at` from the first league that triggered generation. When a second league reuses the pool (via `attachPoolQuestionsToLeague`), `visible_from` and `opens_at` are recomputed per-league using `computeLeagueVisibleFrom(league, kickoff)`. This means two leagues watching the same match but with different scheduling modes each get the correct publish time. `deadline` (= kickoff) is shared across leagues — it does not change.

### DB columns (migration 018)

| Table | Column | Type | Default | Notes |
|---|---|---|---|---|
| `leagues` | `prematch_generation_mode` | `TEXT` CHECK | `'automatic'` | `'automatic'` or `'manual'` |
| `leagues` | `prematch_publish_offset_hours` | `INTEGER` CHECK | `24` | Allowed: 48/24/12/6 |

### Enforcement

- **Frontend UI** (`create-league.html`): timing section shown only when prematch questions are relevant (Match Night prematch/hybrid, or season league with AI enabled). Manual card and individual offset pills visually locked for ineligible tiers. `renderPrematchTimingTierLocks()` re-evaluates on every view.
- **Frontend handler** (`launchLeague`): `prematch_generation_mode` and `prematch_publish_offset_hours` sent to `SpontixStoreAsync.createLeague` → persisted to DB.
- **Edge Function** (`generate-questions`): `isMatchEligibleForPrematch()` filters matches before pool operations. `computeVisibleFrom()` sets the correct `visible_from` at generation time.

---

## Enforcement Status

### Currently enforced (frontend UI + handler)
- Live mode league creation locked in `create-league.html` (question mode selector) via `liveQuestionsMode !== 'limited'` — Starter can join live leagues but cannot create them
- Custom photo upload locked in `profile.html` (Upload Photo tab) via `customPhotoUpload`
- Custom trophy creation locked in `profile.html` (Trophy AI CTA) via `customTrophyCreation`
- Season-long league locked in `create-league.html` (Step 0 type selector — "Elite" badge)
- Upgrade modal pricing uses correct €7.99 / €19.99 / €29.99 / €79.99 values
- No hardcoded `tier === 'elite'` comparisons remain — all checks use `SpontixStore.getTierLimits(tier)` boolean keys
- **Pre-Match Scheduling** — `create-league.html`: timing section hidden unless prematch questions are relevant; Manual card locked for Starter; offset pills 48h/6h locked for Pro; `renderPrematchTimingTierLocks()` called on every show. `launchLeague()` persists `prematch_generation_mode` + `prematch_publish_offset_hours` to DB.
- **BR tier gate** — `battle-royale.html:joinGame()` enforces 3-way logic: Starter daily (`spontix_br_day_*`), Pro monthly (`spontix_br_month_*`), Elite fair-use (`spontix_br_cooldown`). Victory screen resets Elite cooldown to 20s on completion.
- **Trivia tier gate** — `trivia.html:startGame()` enforces same 3-way logic: Starter daily (`spontix_trivia_day_*`), Pro monthly (`spontix_trivia_month_*`), Elite fair-use (`spontix_trivia_cooldown`). Results screen resets Elite cooldown to 20s on completion.

### Currently enforced (frontend handler — Supabase-backed)

These limits are now read from Supabase on every check — not from localStorage. They cannot be bypassed by clearing local state.

- `leagueMaxPlayers` (`max_members`) — `SpontixStoreAsync.joinLeague()` counts current `league_members` from Supabase before inserting. Returns `{ ok: false, error: 'league-full' }` if at capacity. `discover.html` shows a toast; does not fall back to localStorage join.
- `leaguesJoinMax` — `SpontixStoreAsync.joinLeague()` counts all `league_members` rows for the current user from Supabase. Returns `{ ok: false, error: 'join-limit-reached' }` if at the tier limit. `discover.html` shows the upgrade modal.
- `leaguesCreatePerWeek` — `create-league.html:launchLeague()` queries `leagues WHERE owner_id = uid AND created_at > 7 days ago` from Supabase before creating. `my-leagues.html:applyLeagueTierGating()` does the same query to gate the Create button in the UI. Both fall back to localStorage only when Supabase is unavailable (offline path).
- `liveQuestionsPerMatch` — `league.html:handleAnswer()` counts LIVE answers for the current match from `currentQuestions` + `myAnswers` already in memory (no DB round-trip). localStorage counter removed. Additionally, `renderOptions()` visually disables answer buttons and shows a "Live answers: X / 3" indicator when the limit is reached — so the gate is visible before the user clicks.
- `eventsPerMonth` — `venue-create-event.html` counts events created this calendar month from Supabase before allowing creation. Uses `eventsPerMonth` key (canonical); legacy `eventsPerWeek` alias retained in `TIER_LIMITS` for backwards compatibility only.

### Currently enforced (Edge Function — server-side)
- `realWorldQuestionsPerMonth` — enforced in `generate-questions` Edge Function via `checkRealWorldQuota()` in `lib/quota-checker.ts`. Two sequential checks: (1) **daily cap** — max 1 REAL_WORLD question per league per UTC day, applies to ALL tiers including Elite (`real_world_daily_cap`); (2) **tier rule** — Starter: fully blocked (`real_world_tier_locked`), Pro: 10/month per league (`real_world_quota_reached` when limit hit), Elite: unlimited beyond the daily cap. Quota checked against `questions` table count. Owner tier resolved from `users.tier` via `owner_id` on `leagues`.
- `aiWeeklyQuota` — `leagues.ai_weekly_quota` column is set at creation time from `TIER_LIMITS.aiWeeklyQuota` (Starter: 2, Pro: 5, Elite: 10). The generation Edge Function reads this column directly — it is not re-derived from the owner's live tier.

### Currently enforced (Edge Function — REAL_WORLD pipeline)

These rules govern what REAL_WORLD questions are generated and how they are validated.

- **4-call pipeline** — Call 1 (generate from news) → Call 2 (convert to predicate) → Call 3 (context + curated sources via Google News RSS) → Call 4 (quality gate: APPROVE ≥80 / WEAK 65–79 / REJECT <65). No GNews API key required — Google News RSS adapter runs unconditionally.
- **`yellow_cards` field** — `player_stat` predicates may use `field = 'yellow_cards'` (validates separately from the combined `cards` field). Both are valid: `yellow_cards` = only yellow; `cards` = yellow + red. Supported in both `predicate-validator.ts` (`VALID_FIELDS.player_stat`) and `predicate-evaluator.ts` (`getPlayerStatValue()`).
- **`MATCH_REQUIRED_TYPES` guard** — `match_lineup`, `player_stat`, `match_stat`, and `btts` predicates require an upcoming match. If no upcoming match exists for the league, questions with these predicate types are skipped (not inserted). Prevents silent void cycles from `no_match_id` resolver errors.
- **`match_lineup` near-kickoff guard** — if the kickoff is less than **60 minutes** away, generation is skipped immediately after the `MATCH_REQUIRED_TYPES` check. Lineups are released ~1h before kickoff — generating after that window produces an un-answerable question. Guard runs before any API call so no tokens are consumed. (Previously 30min matching checkTemporal floor — extended to 60min in 6th audit pass.)
- **`match_lineup` `check` field normalisation** — if Call 2 returns a `match_lineup` predicate without a `check` field, it is defaulted to `'squad'` before `validateQuestion()` runs. The resolver's `pred.check ?? 'squad'` fallback was unreachable because the validator ran first and rejected `undefined`.
- **`match_lineup` `resolution_deadline` backfill** — after Call 2, `manual_review` predicates lack a `resolution_deadline` field (Call 2 builds from `predicate_hint` which carries no deadline). Backfilled from `rawRW.resolution_deadline` before `validateQuestion()` runs — without this, all `manual_review` questions fail `checkSchema` post-Call-4 and are silently rejected.
- **`evalMatchLineup` partial lineup handling** — if the API returns fewer than 2 team entries, the evaluator first checks whether the player IS in the available entry. If found → returns `correct` immediately. If not found → returns `unresolvable('lineups_incomplete')` so the resolver retries next cycle. Prevents both wrong-NO resolution and unnecessary retries when the answer is already deterministic.
- **`entity_focus` cross-validation** — after Call 2 resolves the predicate type, `entity_focus` is normalised to match: player predicates (`match_lineup`, `player_stat`) force `entity_focus = 'player'`; team predicates (`match_stat`, `btts`) force `entity_focus = 'team'`. Mismatches are corrected silently with a warning log, not rejected. The normalised value (`normalisedEntityFocus`) is passed to Call 4 — the quality scorer no longer penalises mismatches that have already been corrected.
- **`scoped_team_name` in Call 3 context** — team-scoped leagues include the league's `scoped_team_name` in the `rwTeams` context string sent to Call 3. Ensures team-specific leagues without an upcoming match still receive correctly targeted context for the news snippet and source curation.
- **REAL_WORLD player database** (migration 026) — `team_players` table tracks player relevance scores (starters +10, subs +4, goals +8, assists +6, cards +5). The PLAYER BOOST RSS query in `google-news-rss.ts` uses the top-8 players per team (by relevance, last 90 days) to surface injury/availability signals for high-relevance players.
- **Per-league WEAK counter** — Call 4 WEAK decisions (score 65–79) are published only if no APPROVE question was generated for that specific league in the same run (`rwLeagueGenerated === 0`). The counter is per-league (not global run count) — a PREMATCH or LIVE question generated earlier in the run does not block REAL_WORLD WEAK publishing.
- **`mergedKnownPlayers` in Call 1** — `generateRealWorldQuestion()` receives a merged player list combining `team_players` DB entries (all squad members sorted by relevance score) and `keyPlayers` (injury/fitness focus list). Fit players not on the injury list now have their `player_id` available in Call 1, enabling Call 2 to build valid predicates for TYPE 2/3 questions. Previously only `keyPlayers` (~5–15 injured/doubtful players) were passed, causing all TYPE 2/3 predicates about fit players to fail entity validation.
- **All upcoming matches passed to Call 1** — `upcoming_matches[]` (up to 3 matches with `match_id`) replaces single `upcoming_match` string. The model selects the most relevant fixture for the news story. Post-Call-2, `upcomingMatch` is resolved by matching the predicate's `match_id` against all upcoming matches (falls back to `[0]` if no ID match). Prevents ID fabrication that was passing schema validation but resolving against wrong fixtures.
- **Daily cap fail-safe** — `checkRealWorldQuota()`: DB error on the daily cap count query now returns `{ allowed: false, skipReason: 'real_world_quota_check_failed' }` instead of silently allowing through (was fail-open). Both count queries changed from `select('*')` to `select('id')` to avoid fetching full row data.
- **Extended player_stat VALID_FIELDS** — `predicate-validator.ts`: `passes_total`, `passes_key`, `dribbles_attempts`, `dribbles_success`, `tackles`, `interceptions`, `duels_total`, `duels_won` added to `VALID_FIELDS.player_stat`. These fields are populated by the player stats API and stored in `PlayerStatBlock` in the evaluator — they were always resolvable but silently rejected by logic_validation when used in TYPE 2/3 RW questions.
- **`standings` field fix in news adapter** — `news-adapter/index.ts`: `sportsCtx.teamStandings` (non-existent field) replaced with `sportsCtx.standings?.map(s => s.team.name)`. Was silently stripping all standings team names from `knownTeams` — both the PLAYER BOOST query and entity matching had no standings team context.

### Currently enforced (resolver — scoring formula)

- **Full scoring formula** — all 6 multipliers active in `resolve-questions/index.ts`: `base_value × time_pressure × difficulty × streak × comeback × clutch`. MVP bypass constants (`difficulty_mvp = 1.0`, `comeback_mvp = 1.0`, `clutch_mvp = 1.0`) have been removed. `multiplier_breakdown` JSONB reflects real computed values (no `mvp_bypass: true` flag).
- **`manual_review` skip logging** — the resolver logs `[resolve] skipping manual_review question {id} (pending admin action, deadline=...)` for every skipped manual review question, making resolver output transparent in Edge Function logs.
- **Lineup retry not void** — when `evaluatePredicate` returns `unresolvable` with reason `lineups_not_available` or `lineups_incomplete`, the resolver increments `skipped` and continues (retries next cycle) rather than voiding. Lineups may not be in `live_match_stats` yet — voiding on the first attempt discards valid `match_lineup` questions before kickoff.
- **`manual_review` timing** — `resolvesAfter = resolution_deadline` (not `deadline + 1h`). The auto-void fires when `now > deadline + 1h grace`. Setting `resolvesAfter = deadline` ensures the question enters the resolver one hour before auto-void fires, giving the admin the full grace window.
- **`match_lineup` timing** — `resolution_deadline = kickoff` (not `kickoff - 30min`); `resolvesAfter = kickoff`. Auto-void fires at `kickoff + 1h` (was `kickoff + 30min` when deadline was kickoff-30min). The old `resolvesAfter = kickoff + 60min` caused the question to enter the resolver 30 minutes after auto-void; updated to `kickoff` in 5th pass. 6th pass also corrected the deadline from `kickoff - 30min` to `kickoff` — gives the resolver a full hour of retries before auto-void fires.
- **Null score FT fallback** — `resolve-questions/lib/stats-fetcher/football.ts`: if `api_football_fixtures` has a finished status (`FT`/`AET`/`PEN`) but `home_goals` and `away_goals` are both `null` (poller race condition), the cache is treated as incomplete and the resolver falls back to a direct API call. Previously `null` was coerced to `0`, producing incorrect BTTS (`0:0 = false`) and wrong match_stat scores.

### Currently enforced (Edge Function — server-side, added 2026-04-27)
- **Pre-Match Scheduling publish window** — `generate-questions` Edge Function: `isMatchEligibleForPrematch()` filters each match before pool operations using `league.prematch_generation_mode` and `league.prematch_publish_offset_hours`. Automatic: match must be ≤ 48h away. Manual: `now >= kickoff − offset_hours`. After kickoff: always ineligible. Leagues with no eligible matches are skipped with `no_matches_in_publish_window`. `computeVisibleFrom()` sets `visible_from` at generation time; `computeLeagueVisibleFrom()` in `pool-manager.ts` overrides `visible_from` per-league for pool-reused questions.
- `aiPreviewPerEvent` — Venue Starter capped at 3 total AI questions per league_id in `generate-questions` Edge Function. Before Phase A, counts `questions WHERE league_id = league.id AND source = 'ai_generated'`. If count ≥ 3, skips with `skipReason: 'venue_ai_preview_cap'`. Each venue event maps to its own `league_id` — enforcing by `league_id` is the correct mechanism. UI-only gate in `venue-live-floor.html` is retained for real-time feedback.

### Frontend handler only — backend RLS enforcement needed post-launch
- `aiQuestionsPerMonth` — generation pipeline uses `leagues.ai_weekly_quota` (set at creation), not a live tier check.
- BR and Trivia game counters (`battleRoyalePerDay`, `battleRoyalePerMonth`, `triviaGamesPerDay`, `triviaGamesPerMonth`) — localStorage only. Clearable by the user. Post-launch: move to Supabase-backed counters.

### Not yet wired (post-launch)
- Stripe billing → real tier reads from `users.tier`
- RLS policies mirroring tier limits for league creation and membership at DB level
- Venue event count enforcement at DB level (currently only frontend-checked)

---

## CORE_MATCH_LIVE — Product Definition

`CORE_MATCH_LIVE` is the **primary monetization driver** of Spontix. It is not a premium add-on — it is the core product experience that differentiates Starter from paid tiers.

### What LIVE is

Live questions are generated **during a match**, based on live match state (score, clock, events). They have short answer windows (2–5 min), resolve within minutes, and are designed to create moment-by-moment tension alongside the broadcast.

This is what makes Spontix a second-screen live experience rather than a prediction app. LIVE is the product.

### Why LIVE is the upgrade hook

Starter users can **see** live questions and **answer up to 3 per match**. They experience the product but hit a clear, meaningful wall at exactly the moment they're most engaged. The cap is not arbitrary — 3 questions is enough to feel the experience and want more.

The upgrade CTA is always: **"Remove Live Prediction Limits — Go Pro"**.

### LIVE is NOT REAL_WORLD

| | CORE_MATCH_LIVE | REAL_WORLD |
|---|---|---|
| Based on | Live match state | News, transfers, injuries |
| Timing | During the match | Days/weeks before |
| Cost driver | API polling + OpenAI | Google News RSS + OpenAI (4 calls) |
| Tier gate | Starter (limited) → Pro | Pro (limited) → Elite |
| Volume | 8–12 per match (standard) | 1 per league per day max |
| Priority in feed | Highest | Lowest |

REAL_WORLD is premium because of cost and editorial complexity. LIVE is gated because it is the core value proposition. These are different rationales and must never be confused.

### Tier behavior — LIVE

| Tier | LIVE access | Details |
|---|---|---|
| **Starter** | Limited | Can see all live questions; can answer max 3 per match (`liveQuestionsPerMatch: 3`) |
| **Pro** | Full | Unlimited live answers; can create live-mode leagues |
| **Elite** | Full + advanced | Unlimited; live stats tab; enhanced scoring feedback; advanced predictions |

### Venue tier behavior — LIVE

| Venue tier | LIVE behavior |
|---|---|
| Venue Starter | AI preview only (max 3 questions total per league via `aiPreviewPerEvent`); no live-mode leagues |
| Venue Pro | Full live question generation for their leagues |
| Venue Elite | Full live + priority generation slot |

### LIVE feed priority — MANDATORY

`CORE_MATCH_LIVE` **always** renders first in the question feed. This is enforced in `league.html` via `lanePriority` sort. REAL_WORLD must never appear above a live question. This rule is permanent.

---

## LIVE Cost Logic

Understanding the cost model is essential for knowing why tier limits exist and why LIVE cannot be unlimited for all tiers.

### API cost per live match

The `live-stats-poller` Edge Function runs every minute during a live fixture. Per 90-minute match:

| Call type | Frequency | ~Requests |
|---|---|---|
| `/fixtures` (score + status) | Every minute | 90 |
| `/fixtures/events` | Every minute | 90 |
| `/fixtures/statistics` | Every minute (×2 teams) | 180 |
| `/fixtures/players` | Every 3 minutes when live | ~30 |
| `/fixtures/lineups` | Once | 1 |
| `/predictions` | Once | 1 |
| `/fixtures/headtohead` | Once | 1 |
| **Total per match** | | **~305 requests** |

API-Sports Pro plan: 7,500 requests/day. One live match = ~305 requests = 4% of daily budget. At scale, this is a real constraint.

### OpenAI cost per live question

Each `CORE_MATCH_LIVE` question requires two OpenAI calls (Call 1: generation, Call 2: predicate). At `gpt-4o-mini` pricing, each question costs approximately **$0.001–$0.003**. At 8 questions per match, that is ~$0.02 per match per league.

At 50 active leagues with live matches simultaneously: ~$1/match cycle. This is manageable but must be rate-limited per league (max 1 new live question per 3 minutes per league).

### Why Starter must be limited

Unlimited Starter access to live questions would mean:
- Full API polling cost for every Starter league
- Full OpenAI generation cost with no revenue
- No meaningful upgrade incentive

The 3-answer cap creates engagement without full cost exposure. The server still generates and delivers all live questions — the cap only limits how many the user can answer. This is intentional: they see what they're missing.

### Why rate limiting exists (1 per 3 min per league)

The 3-minute rate limit per league is a **safety rule**, not a tier rule. It applies to ALL tiers including Elite. Purpose:
- Prevents question flooding mid-match
- Preserves question quality (low-value filler is always worse than waiting)
- Keeps the active question count manageable (MVP cap: 2 active at once)
- Reduces OpenAI cost

---

---

## Play Mode vs Subscription Tier (migration 029)

`play_mode` and subscription tier are **completely independent systems**. They must never be confused.

### What `play_mode` controls

`play_mode = 'singleplayer' | 'multiplayer'` on the `leagues` table.

- **`multiplayer`** (default) — social competition: leaderboard, invite friends, shared session, invite card visible.
- **`singleplayer`** — solo session: just the player vs the match. `max_members = 1`, no leaderboard, invite card hidden.

This is a **gameplay mode** switch — it controls the social experience and UI, not feature availability.

### What subscription tier controls

Tier controls **what content and how much** the player can access — identically in both play modes:

| Limit | Singleplayer | Multiplayer |
|---|---|---|
| `liveQuestionsPerMatch` | Same cap (Starter: 3, Pro/Elite: unlimited) | Same cap |
| `realWorldQuestionsEnabled` | Same gate (Starter: locked, Pro: limited, Elite: full) | Same gate |
| `leaguesCreatePerWeek` | Same limit | Same limit |
| `liveQuestionsMode` | Same ('limited' for Starter, 'full' for Pro+) | Same |
| All other `TIER_LIMITS` fields | Unchanged | Unchanged |

### Critical rules

1. **Never create separate tier limits for singleplayer.** Always read from `TIER_LIMITS` via `SpontixStore.getTierLimits(tier)`.
2. **Never silently allow features in singleplayer that are locked in multiplayer.** If Starter can't access REAL_WORLD in multiplayer, they can't in singleplayer either.
3. **Tier upgrade prompts must mention both modes** so users understand the upgrade benefit applies everywhere.
4. `play_mode` is NOT a subscription tier. There is no "singleplayer tier" or "multiplayer tier".

### Implementation locations

- DB: `leagues.play_mode TEXT NOT NULL DEFAULT 'multiplayer' CHECK (play_mode IN ('singleplayer','multiplayer'))` — migration 029
- Store: `_mapLeagueFromDb` maps `play_mode → playMode`, `_mapLeagueToDb` maps back
- Creation wizard: `sessionType` JS variable (`create-league.html`); `launchLeague()` writes `playMode: sessionType`
- League view: `league.html` reads `league.playMode` — hides invite card, shows "Solo" tag, adjusts stat mode label
- All tier gates in `create-league.html` apply to both modes via the same `getTierLimits()` call

### Enforcement status

| Feature | Both modes? | How enforced |
|---|---|---|
| `liveQuestionsPerMatch` cap (Starter: 3) | ✅ Yes | In-memory count from `currentQuestions + myAnswers` in `league.html` |
| REAL_WORLD toggle lock (Starter) | ✅ Yes | `toggleAIQuestions()` + `applyRealWorldTierGating()` in `create-league.html` |
| Live/Hybrid creation gate (Pro+) | ✅ Yes | `applyMatchNightTierGating()` in `create-league.html` |
| `leaguesCreatePerWeek` cap | ✅ Yes | Supabase count in `launchLeague()` |
| `maxMembers = 1` for singleplayer | N/A | Enforced in `launchLeague()` when `sessionType === 'singleplayer'` |

---

## Future Upgrade Paths

- **Streak shield** — optional Elite feature: protects streak on one wrong answer per match
- **Private leagues** — Elite: leagues not discoverable in public search
- **Priority Real World generation** — Elite leagues get first slot in each generation cycle
- **Venue sponsored questions** — Venue Elite: venue sells branded question slots to drink brands etc.
- **Venue API access** — Venue Elite: embed Spontyx question feed in venue's own app or screen system
- **Server-side game counters** — move BR and Trivia monthly/daily counters to Supabase for tamper-resistance
