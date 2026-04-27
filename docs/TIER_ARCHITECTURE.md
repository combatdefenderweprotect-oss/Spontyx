# Spontix Tier Architecture

Last updated: 2026-04-27 (v3)

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

## Enforcement Status

### Currently enforced (frontend UI + handler)
- Live mode league creation locked in `create-league.html` (question mode selector) via `liveQuestionsMode !== 'limited'` — Starter can join live leagues but cannot create them
- Custom photo upload locked in `profile.html` (Upload Photo tab) via `customPhotoUpload`
- Custom trophy creation locked in `profile.html` (Trophy AI CTA) via `customTrophyCreation`
- Season-long league locked in `create-league.html` (Step 0 type selector — "Elite" badge)
- Upgrade modal pricing uses correct €7.99 / €19.99 / €29.99 / €79.99 values
- No hardcoded `tier === 'elite'` comparisons remain — all checks use `SpontixStore.getTierLimits(tier)` boolean keys
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

### Frontend handler only — backend RLS enforcement needed post-launch
- `aiPreviewPerEvent` — Venue Starter limited to 3 AI question pushes per event in `venue-live-floor.html`. Tracked per-event in handler; no DB enforcement.
- `aiQuestionsPerMonth` — generation pipeline uses `leagues.ai_weekly_quota` (set at creation), not a live tier check.
- BR and Trivia game counters (`battleRoyalePerDay`, `battleRoyalePerMonth`, `triviaGamesPerDay`, `triviaGamesPerMonth`) — localStorage only. Clearable by the user. Post-launch: move to Supabase-backed counters.

### Not yet wired (post-launch)
- Stripe billing → real tier reads from `users.tier`
- RLS policies mirroring tier limits for league creation and membership at DB level
- Venue event count enforcement at DB level (currently only frontend-checked)

---

## Future Upgrade Paths

- **Streak shield** — optional Elite feature: protects streak on one wrong answer per match
- **Private leagues** — Elite: leagues not discoverable in public search
- **Priority Real World generation** — Elite leagues get first slot in each generation cycle
- **Venue sponsored questions** — Venue Elite: venue sells branded question slots to drink brands etc.
- **Venue API access** — Venue Elite: embed Spontyx question feed in venue's own app or screen system
- **Server-side game counters** — move BR and Trivia monthly/daily counters to Supabase for tamper-resistance
