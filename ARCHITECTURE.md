# Spontix — Architecture Notes

This document captures the client-side architecture in its current (prototype) state
and outlines the migration path to a real backend. It focuses on the identity and
authorization model introduced to make the frontend backend-ready.

## 1. Identity Model

### Users

Every user has a stable UUID (`userId`). Display fields like `handle`, `name`, and
`avatar` are mutable; `userId` is the immutable key used for every foreign relation.

```js
{
  id: 'usr_bran',                // immutable UUID, server-issued in prod
  handle: '@bran_predicts',      // display, user-editable
  name: 'Bran',
  email: 'bran@spontix.test',
  role: 'player' | 'venue-owner',
  avatar: 'B',
  avatarColor: '#A8E10C',
  createdAt: ISO8601,
}
```

Stored in `localStorage['spontix_users']` (seeded with 4 demo accounts). Access via
`SpontixStore.getUsers()`, `getUserById(userId)`, `getUserByHandle(handle)`.

### Venues

Venues have a stable UUID (`venueId`) and an explicit `ownerId` pointing at the user
who owns them. One user can own multiple venues (multi-venue is an Elite tier feature).

```js
{
  id: 'ven_arena',               // immutable UUID
  ownerId: 'usr_arena',          // FK → users.id
  venueName: 'Arena Bar & Grill',
  city, type, hours, capacity,
  createdAt,
}
```

Stored in `localStorage['spontix_venues']`. Access via `SpontixStore.getVenues()`,
`getVenueById(venueId)`, `getVenuesByOwner(ownerId)`, `createVenue(data)`,
`updateVenue(venueId, patch, actorUserId)`.

The old single-record `venueProfile` key is kept as a backwards-compat accessor that
now resolves to the active venue via `Session.getCurrentVenueId()`.

### Session

`SpontixStore.Session` holds the currently-authenticated user and their active venue.
It is the bridge between "which user is acting" and every write path.

```js
SpontixStore.Session.getCurrentUserId()   // → 'usr_bran' | null
SpontixStore.Session.getCurrentUser()     // → full user record | null
SpontixStore.Session.getCurrentVenueId()  // → 'ven_arena' | null
SpontixStore.Session.getCurrentVenue()    // → full venue record | null
SpontixStore.Session.loginAs(userId)      // demo login, returns user or null
SpontixStore.Session.setActiveVenue(vId)  // authz: checks venue.ownerId === user
SpontixStore.Session.logout()
```

Persists to `localStorage['spontix_session']`. Replaceable with a JWT/cookie on the
backend — the interface stays the same.

## 2. Authorization Pattern

Every write path that touches owned data (venues, leagues, events, custom trophies)
follows this pattern:

1. Resolve the acting user via `Session.getCurrentUserId()`.
2. Load the target resource.
3. Compare `resource.ownerId === actingUserId` (or `hostUserId`, depending on resource).
4. Return `{ error: 'forbidden' }` on mismatch, perform the write on match.

On the backend this becomes a middleware + row-level security pattern. The error
shapes already match what a real API would return, so client code won't need to
change when the switch happens.

## 3. Trophy Routing

Trophies are awarded by user ID, not by handle (which is user-editable). The routing
helpers — `awardLeagueWinnerTrophy(leagueId, winner)` and `awardVenueEventTrophy(eventId,
winner, trophyCfg)` — accept a `userId`, `handle`, or full user object and resolve
via `_resolveWinner()`.

When the current session IS the winner, the trophy is written to the user's trophy
list. When the winner is a different user, the trophy is enqueued in
`spontix_remote_trophy_queue` keyed by `winnerUserId` — this represents the backend
fan-out (push/websocket) that will deliver the trophy to that user's client.

Custom trophies carry `venueId` (not just `venueName`) so they survive venue renames.

## 4. Tier Enforcement (three-layer defense)

Every gated feature is defended at three layers so bypass attempts at any one layer
fail safely:

1. **UI layer** — controls are visually locked (badges, dashed borders, disabled state).
2. **Handler layer** — click handlers route Starter-tier users to the upgrade modal
   instead of executing the action.
3. **Store layer** — functions like `addVenuePhoto` return typed errors
   (`{ error: 'tier' }`, `{ error: 'limit' }`) when called programmatically by an
   unauthorized tier.

The backend will mirror layer 3 exactly (server-side tier checks), and layers 1+2
become a UX nicety rather than a security boundary.

## 5. Prototype Bootstrap

`spontix-store.js` starts with an IIFE `bootstrapPrototype()` that, on every page load:

1. Forces tier to `elite` (player pages) or `venue-elite` (venue pages).
2. Auto-signs-in `usr_bran` on player pages, `usr_arena` on venue pages.

This entire block must be **deleted** when real auth lands. Search for the comment
`PROTOTYPE BOOTSTRAP` to find it.

## 6. Storage Keys (full inventory)

```
spontix_player             → legacy single-player profile (Bran)
spontix_users              → Users table (new)
spontix_venues             → Venues table (new)
spontix_session            → { userId, venueId } (new)
spontix_user_tier          → current tier string
spontix_leagues            → player's leagues
spontix_matches            → active matches
spontix_reservations       → spot reservations
spontix_venue_profile      → legacy single-venue record (kept for compat)
spontix_venue_events       → events hosted by current venue
spontix_venue_stats        → aggregated venue stats
spontix_game_history       → per-user completed games
spontix_badges             → player badges earned
spontix_venue_badges       → venue badges earned
spontix_trophies           → current user's trophy room
spontix_venue_trophies     → (unused — venue badges use separate key)
spontix_custom_trophies    → venue-created custom trophy catalogue
spontix_venue_photos       → { [venueName]: { photos, titlePhotoId, useTitlePhoto } }
spontix_remote_trophy_queue → trophies pending delivery to other users
spontix_br_total           → battle royale games played counter
```

On the backend these become database tables. Table names map directly from key names
(drop the `spontix_` prefix, pluralise).

## 7. Backend Migration Path

Suggested order of work:

1. **Auth** — signup, login, sessions. Replace `Session.loginAs()` and the
   `bootstrapPrototype()` IIFE with a real token exchange.
2. **Users & Venues tables** — mirror the seed data shape. Add row-level security
   on `venues` so only owners can update.
3. **Port reads to API** — switch `getUsers`, `getVenues`, etc. to REST calls. Keep
   writes in localStorage initially to reduce blast radius.
4. **Port writes to API** — one domain at a time (venues → events → leagues → trophies).
5. **Subscriptions & tiers** — Stripe webhooks populate a `subscriptions` table;
   `spontix_user_tier` becomes a read-only cache refreshed from `GET /me`.
6. **Object storage for photos** — move `addVenuePhoto` to an upload endpoint that
   stores originals in S3/R2 and returns a CDN URL. Keep the client-side resize step
   on the upload pipeline.
7. **Websockets for live gameplay** — live.html, battle-royale.html, trivia.html,
   venue-live-floor.html need server-authoritative state. Winner determination moves
   server-side; client awardTrophy calls are removed (server awards on game end).
8. **Cross-user fan-out** — drain `spontix_remote_trophy_queue` via push/websocket
   so trophies land in other users' rooms in real time.

## 8. Async / Sync — Promise interface

Every public `SpontixStore` method is also exposed via `SpontixStoreAsync`,
which returns a Promise. Use the async form for any **new** code; existing
pages can keep using the sync form unchanged.

```js
// Old (sync, localStorage):
const venues = SpontixStore.getVenues();

// New (async, localStorage today, HTTP later):
const venues = await SpontixStoreAsync.getVenues();
```

When the backend lands, `SpontixStoreAsync` internals get rewritten to issue
`fetch()` calls. Sync `SpontixStore.*` either gets deleted or kept as a
read-only offline cache. **Pages that already call `SpontixStoreAsync.*` need
no changes.**

The async wrapper deliberately uses microtasks so async code paths exhibit
async-shaped behavior **today** — bugs that assumed sync semantics from an
async call site surface now (during prototype testing) rather than at
backend cutover (with real network latency).

Namespaces like `Session`, `KEYS`, `TIER_LIMITS` pass through synchronously
on `SpontixStoreAsync` for convenience — they're config / state, not data.

## 9. Photo storage — venueId-keyed

Venue photos are keyed by `venueId` (not `venueName`). The lookup is
rename-safe: changing a venue's display name doesn't orphan its photos.

A one-time migration in `_migrateVenuePhotosToVenueId()` runs on first read
to lift any name-keyed records into venueId-keyed ones. Safe to remove
from the codebase ~6 weeks after deploy once all clients have upgraded.

All public photo methods (`addVenuePhoto`, `removeVenuePhoto`,
`setVenueTitlePhoto`, `setVenueUseTitlePhoto`, `selectPresetPhoto`,
`getVenuePhotoConfig`, `getVenueTitlePhotoUrl`) accept either form and
internally resolve to a venueId via `_resolveVenueKey()`.

## 10. League ownership / membership — computed, not stored

`isOwner` and `isMember` are **never persisted** on league rows (those would
be wrong because the same row describes different things to different users).

Stored fields:
  - `league.ownerId`        — immutable owner UUID
  - `league.memberUserIds`  — array of member UUIDs

Read decoration: `getLeagues()` walks each row and adds computed `isOwner` /
`isMember` flags based on the current session, so existing UI code that
reads `l.isOwner` keeps working unchanged. Pass `{ raw: true }` to
`getLeagues()` to skip the decoration when you need the underlying row
for a mutation (`createLeague`, `joinLeague`, `leaveLeague` already do this).

Backend equivalent: `GET /leagues` returns rows with the same decorated
flags computed server-side from the authenticated user.

A one-time migration in `getLeagues()` lifts legacy `isOwner`/`isMember`
flags into the new `ownerId`/`memberUserIds` model on first read.

## 11. Known Gaps (intentionally out of scope for prototype)

- No password hashing / real auth
- No server-side winner verification
- Photos capped by localStorage (~5MB per domain)
- Client-trusted tier checks (bypassable via DevTools — fine for prototype, not production)
- Live games are single-player simulations; no real multi-user state sync
- No audit log for authorization decisions
