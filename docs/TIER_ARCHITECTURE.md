# Spontix Tier Architecture

Last updated: 2026-04-24

This document is the authoritative reference for all tier logic in Spontix. All pricing, feature gates, limits, and upgrade copy must be derived from this file. The implementation lives in `TIER_LIMITS` in `spontix-store.js`.

---

## Core Monetization Rule

Spontix question lanes are monetized in strict order:

| Lane | Tier access | Rationale |
|---|---|---|
| `CORE_MATCH_PREMATCH` | Starter, Pro, Elite | Entry-level value — taste of the product |
| `CORE_MATCH_LIVE` | **Pro, Elite only** | Core product differentiator — the upgrade hook |
| `REAL_WORLD` | Pro (limited), Elite (full) | Premium intelligence layer — high cost, high perceived value |

**Real World questions cost money to generate (OpenAI + API-Sports calls) and must never be treated as free default content.**

The upgrade hook for Starter → Pro is always "Unlock Live Match Predictions". Every locked-feature prompt should reinforce this.

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
| **CORE_MATCH_LIVE** | 🔒 locked (preview only) |
| **REAL_WORLD** | 🔒 locked |
| Real World questions / month | 0 |
| Battle Royale / day | 3 |
| Trivia modes | Solo only |
| Trivia games / day | 5 |
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

**What Starter users should see:** locked Live and Real World options with upgrade prompts. Clicking them triggers `SpontixSidebar.showUpgradeModal()` with copy: *"Unlock Live Match Predictions with Pro"*.

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
| Battle Royale / day | Unlimited |
| Trivia modes | Solo + 1v1 |
| Trivia games / day | Unlimited |
| 1v1 trivia | ✅ |
| Streak bonuses | ✅ |
| Risky answers | ✅ |
| Live stats feed | 🔒 locked (Elite) |
| Betting-style predictions | 🔒 locked (Elite) |
| Custom photo upload | ✅ |
| Custom league cover photo | ✅ |
| Advanced analytics | 🔒 locked (Elite) |
| Ad-free | ✅ |

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
| Battle Royale / day | Unlimited |
| Trivia modes | Solo + 1v1 + Party Room |
| Trivia games / day | Unlimited |
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

**Cost logic:** 1,500 AI questions × ~$0.003 ≈ $4.50 + API calls ~$4.00 = ~$8.50/month cost at ~57% margin.

**Upgrade copy from Pro:** *"Make your league yours with Elite"* / *"Unlock AI News & Rumour Intelligence"*

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
| `liveQuestionsEnabled` | `false` | `true` | `true` |
| `realWorldQuestionsEnabled` | `false` | `'limited'` | `true` |
| `realWorldQuestionsPerMonth` | `0` | `10` | `Infinity` |
| `aiQuestionsPerMonth` | `30` | `400` | `1500` |
| `leaguesCreatePerWeek` | `1` | `5` | `Infinity` |
| `leaguesJoinMax` | `3` | `20` | `Infinity` |
| `leagueMaxPlayers` | `10` | `40` | `100` |
| `battleRoyalePerDay` | `3` | `Infinity` | `Infinity` |
| `triviaGamesPerDay` | `5` | `Infinity` | `Infinity` |
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

### Venue gates — key fields in `TIER_LIMITS`

| Key | Venue Starter | Venue Pro | Venue Elite |
|---|---|---|---|
| `eventsPerMonth` | `2` | `Infinity` | `Infinity` |
| `maxParticipants` | `25` | `150` | `500` |
| `aiQuestionsPerMonth` | `0` | `300` | `1000` |
| `liveQuestionsEnabled` | `false` | `true` | `true` |
| `realWorldQuestionsEnabled` | `false` | `'limited'` | `true` |
| `realWorldQuestionsPerMonth` | `0` | `20` | `Infinity` |
| `canAwardTrophies` | `false` | `true` | `true` |
| `customTrophyMax` | `0` | `5` | `Infinity` |
| `photoMaxCustom` | `0` | `8` | `Infinity` |
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

| Trigger | Title | Description |
|---|---|---|
| Live questions locked | Upgrade to Pro | "Unlock Live Match Predictions with Pro" |
| Real World questions locked | Upgrade to Pro / Elite | "Unlock AI News & Rumour Intelligence" |
| Custom photo upload locked | Upgrade to Pro | "Upgrade to Pro to upload a custom profile photo" |
| Custom trophy creation locked | Upgrade to Elite | "Make your league yours with Elite" |
| 1v1 trivia locked | Upgrade to Pro | "Challenge friends with 1v1 trivia on Pro" |
| Live stats locked | Upgrade to Elite | "Unlock live stats with Elite" |
| Venue AI questions locked | Upgrade to Venue Pro | "Let AI run your match night" |
| Venue branding locked | Upgrade to Venue Pro | "Make it yours — custom branding on Venue Pro" |
| Venue white-label locked | Upgrade to Venue Elite | "Remove all Spontyx branding with Elite" |

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

### `liveQuestionsEnabled` — the primary gate key

This boolean is the canonical check for whether a user can access `CORE_MATCH_LIVE` questions. Always check this key rather than comparing tier strings or tier rank numbers.

```js
// Correct
if (!limits.liveQuestionsEnabled) { /* show upgrade modal */ }

// Wrong — hardcoded tier comparison, brittle
if (tier === 'starter') { /* show upgrade modal */ }
```

### `realWorldQuestionsEnabled` — three states

- `false` — fully locked (Starter)
- `'limited'` — quota-capped (Pro: 10/month player, 20/month venue)
- `true` — full access (Elite)

### Elite tier forcing (MVP)

`authGate()` in `spontix-store.js` currently forces `elite` / `venue-elite` for all users until Stripe billing is wired. When Stripe lands, remove the forced tier assignment and read the real tier from the `users` table.

---

## Enforcement Status

### Currently enforced (frontend UI + handler)
- Live questions locked in `create-league.html` (question mode selector)
- Custom photo upload locked in `profile.html` (Upload Photo tab)
- Season-long league locked in `create-league.html` (Step 0 type selector — "Elite" badge)
- Upgrade modal pricing uses correct €7.99 / €19.99 / €29.99 / €79.99 values

### UI-only — backend RLS enforcement needed post-launch
- `leaguesCreatePerWeek` — checked in handler but not enforced at DB level
- `leaguesJoinMax` — checked in handler but not enforced at DB level
- `leagueMaxPlayers` — checked in handler but not enforced at DB level
- `aiQuestionsPerMonth` — generation pipeline uses quota from `leagues.ai_weekly_quota` (set at creation), not from live tier check
- `realWorldQuestionsPerMonth` — not yet enforced in generation pipeline
- `battleRoyalePerDay` / `triviaGamesPerDay` — checked in handler only

### Not yet wired (post-launch)
- Stripe billing → real tier reads from `users.tier`
- RLS policies mirroring tier limits for league creation and membership
- Real World question quota enforcement in `generate-questions` Edge Function
- Venue event count enforcement at DB level

---

## Future Upgrade Paths

- **Streak shield** — optional Elite feature: protects streak on one wrong answer per match
- **Private leagues** — Elite: leagues not discoverable in public search
- **Priority Real World generation** — Elite leagues get first slot in each generation cycle
- **Venue sponsored questions** — Venue Elite: venue sells branded question slots to drink brands etc.
- **Venue API access** — Venue Elite: embed Spontyx question feed in venue's own app or screen system
