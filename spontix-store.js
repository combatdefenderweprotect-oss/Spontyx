// ══════════════════════════════════════════════
// SPONTIX STORE — Shared Persistence Layer
// ══════════════════════════════════════════════
// Include this at the top of every page's <script> tag.
// All pages read/write to the same localStorage keys.
//
// ── Auto-load Supabase SDK + client (if not already present) ──
// This means any page that includes spontix-store.js gets authenticated
// Supabase access for free — no need to add <script> tags page-by-page.
(function ensureSupabase() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.supabase && window.sb) return; // already loaded

  function injectClientScript() {
    if (document.querySelector('script[data-spontix-client]')) return;
    const s = document.createElement('script');
    s.src = 'supabase-client.js';
    s.setAttribute('data-spontix-client', '1');
    document.head.appendChild(s);
  }

  if (window.supabase) { injectClientScript(); return; }

  if (!document.querySelector('script[data-supabase-sdk]')) {
    const sdk = document.createElement('script');
    sdk.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    sdk.setAttribute('data-supabase-sdk', '1');
    sdk.onload = injectClientScript;
    document.head.appendChild(sdk);
  }
})();
//
// ──────────────────────────────────────────────────────────────────
// ARCHITECTURE NOTE — Identity model (added for backend readiness)
// ──────────────────────────────────────────────────────────────────
// Every user has a stable `userId` (UUID). Display fields like `handle`,
// `name`, `avatar` can change — `userId` is the immutable key.
//
// Every venue has a stable `venueId` (UUID) and an `ownerId` pointing
// to the user who owns it. Authorization checks (enforced in UI here,
// will move server-side with the backend) compare `currentUser.id`
// against `venue.ownerId` before allowing writes.
//
// `Session` holds the currently-signed-in user and the currently-
// selected venue (if the user owns/manages one). All SpontixStore
// functions that don't take an explicit userId default to Session.
// ──────────────────────────────────────────────────────────────────

// ── UUID helper ──
// Server-issuable UUIDs replace the old `'tr_' + Date.now()` pattern
// that would collide when two clients created an entity in the same ms.
function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ── AUTH GATE + TIER BOOTSTRAP ──
// Runs once per page load before any app code.
// 1. If no Supabase session → redirect to login.html
// 2. Force Elite tier until Stripe billing is wired up
// 3. Clear any stale demo session data
(function authGate() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    var path = (window.location.pathname || '').toLowerCase();
    var filename = path.split('/').pop() || '';

    // Pages that don't require auth
    var publicPages = ['login.html', 'index.html', 'waitlist.html', 'supabase-test.html', 'spontix-architecture.html', ''];
    if (publicPages.indexOf(filename) !== -1) return;

    // Fast pre-check: does a Supabase auth token exist in localStorage at all?
    // This avoids a flash of content for users with no session. The real
    // server-side validation below will catch deleted/expired accounts.
    var hasLocalToken = false;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        var raw = localStorage.getItem(key);
        if (raw && raw.indexOf('access_token') !== -1) { hasLocalToken = true; break; }
      }
    }

    // No token at all → redirect immediately
    if (!hasLocalToken) {
      window.location.href = 'login.html';
      return;
    }

    // Real user signed in — clear stale demo session only if it has a demo user ID
    var existingSession = null;
    try { existingSession = JSON.parse(localStorage.getItem('spontix_session') || 'null'); } catch (e) {}
    if (existingSession && (existingSession.userId === 'usr_bran' || existingSession.userId === 'usr_arena')) {
      localStorage.removeItem('spontix_session');
      existingSession = null;
    }

    // Role-based routing — keep players out of venue pages and vice versa
    var userRole = existingSession && existingSession.role;
    var isVenuePage = filename.indexOf('venue-') === 0;
    if (userRole === 'player' && isVenuePage) {
      window.location.href = 'dashboard.html';
      return;
    }
    if (userRole === 'venue-owner' && filename === 'dashboard.html') {
      window.location.href = 'venue-dashboard.html';
      return;
    }

    // Force Elite tier until Stripe billing is wired up.
    // Remove this block when real subscriptions land.
    var desiredTier = isVenuePage ? 'venue-elite' : 'elite';
    localStorage.setItem('spontix_user_tier', desiredTier);

    // Server-side validation: once the Supabase SDK is ready, call getUser()
    // which hits the Supabase API and returns an error for deleted accounts.
    // getSession() reads only from localStorage and cannot detect deleted users.
    window.addEventListener('load', function() {
      if (!window.sb || !window.sb.auth) return;
      window.sb.auth.getUser().then(function(result) {
        if (result.error || !result.data || !result.data.user) {
          // Token exists locally but the account is gone or the token is invalid.
          // Clear all local auth state and redirect.
          for (var j = localStorage.length - 1; j >= 0; j--) {
            var k = localStorage.key(j);
            if (k && k.startsWith('sb-')) localStorage.removeItem(k);
          }
          localStorage.removeItem('spontix_session');
          sessionStorage.removeItem('spontix_beta_access');
          window.location.href = 'waitlist.html';
        }
      }).catch(function() {
        // Network failure — do not log out, let the user continue offline.
      });
    });
  } catch (e) { /* no-op */ }
})();

// ── Hydrate session from Supabase (async) ──
// Runs as soon as the Supabase client is available. Populates spontix_session
// with the real userId + venueId so the rest of the app (which reads Session
// synchronously from localStorage) sees the right identity.
if (typeof window !== 'undefined') {
  window.addEventListener('load', async function hydrateSessionFromSupabase() {
    if (!window.sb || !window.sb.auth) return;
    try {
      const { data: { session } } = await window.sb.auth.getSession();
      if (!session || !session.user) return;

      // Look up the user's public profile + their first owned venue (if any)
      const [{ data: profile }, { data: venues }] = await Promise.all([
        window.sb.from('users').select('id, role, tier').eq('id', session.user.id).single(),
        window.sb.from('venues').select('id').eq('owner_id', session.user.id).limit(1),
      ]);

      const sessionObj = {
        userId:  session.user.id,
        venueId: venues && venues[0] ? venues[0].id : null,
        role:    profile ? profile.role : null,
      };
      localStorage.setItem('spontix_session', JSON.stringify(sessionObj));

      // PROTOTYPE: Don't overwrite the forced Elite tier from bootstrap.
      // Uncomment the line below when real Stripe billing is wired up.
      // if (profile && profile.tier) localStorage.setItem('spontix_user_tier', profile.tier);

      // Fetch full profile immediately so the sidebar shows the correct user right away
      // without waiting for the 1500ms cache-warm cycle.
      if (typeof SpontixStoreAsync !== 'undefined' && SpontixStoreAsync.getProfile) {
        SpontixStoreAsync.getProfile(session.user.id).then(function (playerProfile) {
          window.dispatchEvent(new CustomEvent('spontix-profile-refreshed', { detail: { profile: playerProfile } }));
        }).catch(function () { /* silent */ });
      }
    } catch (e) { /* silent — offline or unauthenticated */ }
  });
}

const SpontixStore = {
  // ── Keys ──
  KEYS: {
    player: 'spontix_player',
    gameHistory: 'spontix_game_history',
    leagues: 'spontix_leagues',
    matches: 'spontix_matches',
    reservations: 'spontix_reservations',
    venueProfile: 'spontix_venue_profile',
    venueEvents: 'spontix_venue_events',
    venueStats: 'spontix_venue_stats',
    role: 'spontix_user_role',
    tier: 'spontix_user_tier',
    badges: 'spontix_badges',
    venueBadges: 'spontix_venue_badges',
    trophies: 'spontix_trophies',
    venueTrophies: 'spontix_venue_trophies',
    customTrophies: 'spontix_custom_trophies',
    venuePhotos: 'spontix_venue_photos',
    users: 'spontix_users',
    venues: 'spontix_venues',
    session: 'spontix_session',
  },

  // ══════════════════════════════════════════════════════════════
  // USERS TABLE
  //
  // Backend-ready identity. Each user has a stable UUID. Seed data
  // includes the demo player ("Bran") plus 3 additional accounts so
  // cross-user scenarios (e.g., trophy delivery to other winners)
  // can actually be tested client-side.
  // ══════════════════════════════════════════════════════════════

  _seedUsers() {
    return [
      { id: 'usr_bran',   handle: '@bran_predicts', name: 'Bran',    email: 'bran@spontix.test',   role: 'player', avatar: 'B',  avatarColor: '#A8E10C', createdAt: '2026-03-01T00:00:00Z' },
      { id: 'usr_mia',    handle: '@mia_mvp',       name: 'Mia',     email: 'mia@spontix.test',    role: 'player', avatar: 'M',  avatarColor: '#FF6B6B', createdAt: '2026-03-05T00:00:00Z' },
      { id: 'usr_dan',    handle: '@hoops_dan',     name: 'Dan',     email: 'dan@spontix.test',    role: 'player', avatar: 'D',  avatarColor: '#4ECDC4', createdAt: '2026-02-20T00:00:00Z' },
      { id: 'usr_arena',  handle: '@arena_owner',   name: 'Jordan',  email: 'jordan@arenabar.test', role: 'venue-owner', avatar: 'J', avatarColor: '#7C5CFC', createdAt: '2026-02-01T00:00:00Z' },
    ];
  },

  getUsers() {
    const stored = localStorage.getItem(this.KEYS.users);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    const seed = this._seedUsers();
    localStorage.setItem(this.KEYS.users, JSON.stringify(seed));
    return seed;
  },

  getUserById(userId) {
    return this.getUsers().find(u => u.id === userId) || null;
  },

  getUserByHandle(handle) {
    return this.getUsers().find(u => u.handle === handle) || null;
  },

  // ══════════════════════════════════════════════════════════════
  // SESSION
  //
  // Tracks the currently-signed-in user and their active venue (if
  // they own one). Writes to localStorage so the selection persists
  // across page loads. Replaceable with a JWT/cookie session when
  // the backend lands — same interface.
  // ══════════════════════════════════════════════════════════════

  Session: {
    _cache: null,
    _read() {
      if (this._cache) return this._cache;
      try {
        const raw = localStorage.getItem(SpontixStore.KEYS.session);
        if (raw) this._cache = JSON.parse(raw);
      } catch (e) {}
      if (!this._cache) this._cache = { userId: null, venueId: null };
      return this._cache;
    },
    _write(s) {
      this._cache = s;
      localStorage.setItem(SpontixStore.KEYS.session, JSON.stringify(s));
    },

    getCurrentUserId()  { return this._read().userId; },
    getCurrentVenueId() { return this._read().venueId; },

    getCurrentUser() {
      const id = this.getCurrentUserId();
      return id ? SpontixStore.getUserById(id) : null;
    },

    getCurrentVenue() {
      const id = this.getCurrentVenueId();
      return id ? SpontixStore.getVenueById(id) : null;
    },

    // Demo login — picks which seed user is "me" for this session.
    // Kept for the localStorage-only prototype pages; real auth uses
    // loginWithEmail / signupWithEmail below.
    loginAs(userId) {
      const user = SpontixStore.getUserById(userId);
      if (!user) return null;
      const venue = SpontixStore.getVenuesByOwner(userId)[0] || null;
      this._write({ userId: user.id, venueId: venue ? venue.id : null });
      return user;
    },

    setActiveVenue(venueId) {
      const current = this._read();
      // Authz check — only the owner can activate a venue as "theirs"
      const venue = SpontixStore.getVenueById(venueId);
      if (!venue || venue.ownerId !== current.userId) return false;
      this._write({ ...current, venueId: venueId });
      return true;
    },

    // ── Real Supabase Auth wrappers ──
    // Thin convenience layer around window.sb.auth so call sites don't
    // need to reach into the Supabase client directly. Returns
    // { ok: true, user } on success or { ok: false, error } on failure.

    async loginWithEmail(email, password) {
      if (typeof window === 'undefined' || !window.sb) return { ok: false, error: 'supabase-not-ready' };
      const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: error.message };
      return { ok: true, user: data.user };
    },

    async signupWithEmail({ email, password, name, role, handle }) {
      if (typeof window === 'undefined' || !window.sb) return { ok: false, error: 'supabase-not-ready' };
      const safeHandle = handle || ('@' + (email || '').split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase());
      const { data, error } = await window.sb.auth.signUp({
        email,
        password,
        options: { data: { name, role: role || 'player', handle: safeHandle } },
      });
      if (error) return { ok: false, error: error.message };
      // Trigger auto-populates public.users but role lives outside the default
      // trigger — update it here so the user row matches what was requested.
      if (data && data.user && role) {
        try { await window.sb.from('users').update({ role }).eq('id', data.user.id); } catch (e) {}
      }
      return { ok: true, user: data.user, session: data.session };
    },

    async logout() {
      this._write({ userId: null, venueId: null });
      localStorage.removeItem('spontix_user_tier');
      localStorage.removeItem('spontix_player'); // clear cached player so next user doesn't see stale data
      sessionStorage.removeItem('spontix_beta_access'); // require beta password again after logout
      if (typeof window !== 'undefined' && window.sb && window.sb.auth) {
        try { await window.sb.auth.signOut(); } catch (e) {}
      }
      if (typeof window !== 'undefined') {
        window.location.href = 'waitlist.html';
      }
    },
  },

  // ── Default Player ──
  defaultPlayer() {
    return {
      name: '',
      handle: '',
      avatar: '',
      avatarColor: 'var(--lime)',
      profilePhotoType: 'color',
      profilePhotoId: 'color_lime',
      profilePhotoUrl: null,
      tier: localStorage.getItem('spontix_user_tier') || 'elite',
      joinedDate: '2026-03-01',
      totalPoints: 0,
      totalCorrect: 0,
      totalWrong: 0,
      bestStreak: 0,
      currentStreak: 0,
      gamesPlayed: 0,
      leaguesJoined: 0,
      teamsJoined: 0,
      teamWins: 0,
      badges: 0,
      trophies: 0,
      accuracy: { live: 0, prematch: 0, trivia: 0, news: 0 },
      accuracyCounts: { live: [0,0], prematch: [0,0], trivia: [0,0], news: [0,0] },
    };
  },

  // ── Get Player ──
  getPlayer() {
    const stored = localStorage.getItem(this.KEYS.player);
    if (stored) {
      try {
        const player = JSON.parse(stored);
        // Purge stale seed values so they never flash in the sidebar
        let dirty = false;
        if (player.name === 'Bran') { player.name = ''; dirty = true; }
        if (player.handle === '@bran_predicts') { player.handle = ''; dirty = true; }
        if (player.avatar === 'B' && !player.name) { player.avatar = ''; dirty = true; }
        const merged = { ...this.defaultPlayer(), ...player };
        // Persist the purge so we don't re-read stale values on the next page load
        if (dirty) this.savePlayer(merged);
        return merged;
      } catch (e) {}
    }
    // First time — initialize with seed data so pages aren't empty
    const seeded = this.defaultPlayer();
    seeded.totalPoints = 1240;
    seeded.totalCorrect = 97;
    seeded.totalWrong = 45;
    seeded.bestStreak = 7;
    seeded.currentStreak = 3;
    seeded.gamesPlayed = 12;
    seeded.leaguesJoined = 3;
    seeded.teamsJoined = 4;
    seeded.teamWins = 2;
    seeded.badges = 6;
    seeded.trophies = 4;
    seeded.accuracy = { live: 72, prematch: 61, trivia: 85, news: 54 };
    seeded.accuracyCounts = { live: [36,50], prematch: [30,49], trivia: [23,27], news: [8,16] };
    this.savePlayer(seeded);

    // Also seed game history
    if (!localStorage.getItem(this.KEYS.gameHistory)) {
      this.saveGameHistory(this.seedGameHistory());
    }

    return seeded;
  },

  // ── Save Player ──
  savePlayer(player) {
    try {
      localStorage.setItem(this.KEYS.player, JSON.stringify(player));
    } catch (e) {
      // Quota exceeded — retry without the large data URL so at minimum
      // name/handle/tier are cached for instant sidebar render next load
      try {
        var slim = Object.assign({}, player);
        if (slim.profilePhotoUrl && slim.profilePhotoUrl.startsWith('data:')) {
          slim = Object.assign({}, slim, { profilePhotoUrl: null });
        }
        localStorage.setItem(this.KEYS.player, JSON.stringify(slim));
      } catch (e2) { /* silent */ }
    }
  },

  // ── ELO calculation (Battle Royale) ──
  // Standard Elo with K=32. For multi-player BR we treat every opponent as
  // having the "average" pool Elo (passed in). actualScore is linear: 1 for
  // first place, 0 for last. Returns integer delta (can be negative).
  _calculateEloChange(myElo, rank, totalPlayers, avgOpponentElo) {
    if (!totalPlayers || totalPlayers < 2) return 0;
    var K = 32;
    var oElo = avgOpponentElo || 1000;
    var expected = 1 / (1 + Math.pow(10, (oElo - myElo) / 400));
    var actualScore = 1 - (rank - 1) / (totalPlayers - 1);
    return Math.round(K * (actualScore - expected));
  },

  // Returns { tier, label, minElo, color } for a given elo rating (BR tiers)
  getEloTier(elo) {
    if (elo >= 4000) return { tier: 'champion', label: 'Champion', color: 'var(--champion)',    minElo: 4000 };
    if (elo >= 3000) return { tier: 'diamond',  label: 'Diamond',  color: 'var(--diamond)',     minElo: 3000 };
    if (elo >= 2000) return { tier: 'platinum', label: 'Platinum', color: 'var(--platinum)',    minElo: 2000 };
    if (elo >= 1500) return { tier: 'gold',     label: 'Gold',     color: 'var(--gold-c)',       minElo: 1500 };
    if (elo >= 1000) return { tier: 'silver',   label: 'Silver',   color: 'var(--off-white)',    minElo: 1000 };
    return              { tier: 'bronze',   label: 'Bronze',   color: '#cd7f32',              minElo: 0    };
  },

  // ── Update player after a game ──
  recordGameResult(result) {
    // result = { matchTitle, matchScore, points, correct, wrong, bestStreak, questionTypes, date }
    const player = this.getPlayer();

    player.totalPoints += result.points;
    player.totalCorrect += result.correct;
    player.totalWrong += result.wrong;
    player.gamesPlayed += 1;
    player.currentStreak = result.endStreak || 0;
    if (result.bestStreak > player.bestStreak) player.bestStreak = result.bestStreak;

    // Update accuracy per question type
    if (result.questionTypes) {
      Object.keys(result.questionTypes).forEach(type => {
        const qt = result.questionTypes[type];
        if (player.accuracyCounts[type]) {
          player.accuracyCounts[type][0] += qt.correct;
          player.accuracyCounts[type][1] += qt.total;
          player.accuracy[type] = player.accuracyCounts[type][1] > 0
            ? Math.round(player.accuracyCounts[type][0] / player.accuracyCounts[type][1] * 100) : 0;
        }
      });
    }

    this.savePlayer(player);

    // Add to game history
    const history = this.getGameHistory();
    history.unshift({
      id: 'g_' + uuid().slice(0, 8),
      matchTitle: result.matchTitle || 'Unknown Match',
      matchScore: result.matchScore || '? — ?',
      points: result.points,
      correct: result.correct,
      wrong: result.wrong,
      total: result.correct + result.wrong,
      bestStreak: result.bestStreak,
      rank: result.rank || null,
      totalPlayers: result.totalPlayers || null,
      date: result.date || new Date().toISOString(),
    });
    // Keep last 50 games
    this.saveGameHistory(history.slice(0, 50));

    // ── Check badges after game ──
    const newBadges = this.checkAllPlayerBadges(result);
    if (newBadges.length > 0 && typeof window !== 'undefined') {
      // Fire custom event so pages can show a toast/notification
      window.dispatchEvent(new CustomEvent('spontix-badge-earned', { detail: { badges: newBadges } }));
    }

    return player;
  },

  // ── Game History ──
  getGameHistory() {
    const stored = localStorage.getItem(this.KEYS.gameHistory);
    if (stored) {
      try { return JSON.parse(stored); } catch (e) {}
    }
    return this.seedGameHistory();
  },

  saveGameHistory(history) {
    localStorage.setItem(this.KEYS.gameHistory, JSON.stringify(history));
  },

  seedGameHistory() {
    return [
      { id: 'g_seed_1', matchTitle: 'Barcelona vs Real Madrid', matchScore: '2 — 1', points: 185, correct: 6, wrong: 2, total: 8, bestStreak: 4, rank: 2, totalPlayers: 8, date: '2026-04-12T20:30:00Z' },
      { id: 'g_seed_2', matchTitle: 'Arsenal vs Man City', matchScore: '0 — 0', points: 95, correct: 4, wrong: 4, total: 8, bestStreak: 2, rank: 4, totalPlayers: 8, date: '2026-04-11T17:00:00Z' },
      { id: 'g_seed_3', matchTitle: 'Bayern vs Inter Milan', matchScore: '3 — 2', points: 210, correct: 7, wrong: 1, total: 8, bestStreak: 5, rank: 1, totalPlayers: 6, date: '2026-04-09T21:00:00Z' },
      { id: 'g_seed_4', matchTitle: 'Liverpool vs Dortmund', matchScore: '4 — 3', points: 150, correct: 5, wrong: 3, total: 8, bestStreak: 3, rank: 3, totalPlayers: 10, date: '2026-04-07T20:00:00Z' },
      { id: 'g_seed_5', matchTitle: 'PSG vs Atlético Madrid', matchScore: '1 — 1', points: 120, correct: 5, wrong: 3, total: 8, bestStreak: 3, rank: 2, totalPlayers: 6, date: '2026-04-05T21:00:00Z' },
    ];
  },

  // ── Computed Stats ──
  getWinRate(player) {
    const total = player.totalCorrect + player.totalWrong;
    return total > 0 ? Math.round(player.totalCorrect / total * 100) : 0;
  },

  getTierLabel(tier) {
    const labels = {
      'starter': 'Starter (Free)',
      'pro': 'Pro ($5.99/mo)',
      'elite': 'Elite ($14.99/mo)',
      'venue-starter': 'Venue Starter',
      'venue-pro': 'Venue Pro',
      'venue-elite': 'Venue Elite',
    };
    return labels[tier] || tier;
  },

  formatDate(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now - d;
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH < 1) return Math.floor(diffMs / 60000) + 'm ago';
    if (diffH < 24) return Math.floor(diffH) + 'h ago';
    if (diffH < 48) return 'Yesterday';
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return diffD + 'd ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },

  formatNumber(n) {
    return n.toLocaleString();
  },

  // ══════════════════════════════════════════
  // PHASE 2 — LEAGUES & MATCHES
  // ══════════════════════════════════════════

  // ── Leagues ──
  //
  // Returns leagues with computed `isOwner` / `isMember` flags decorated
  // based on the current session. Pass `{ raw: true }` to skip decoration
  // when you need the underlying row (e.g. for a mutation before save).
  //
  // Backend equivalent: GET /leagues returns the same shape with flags
  // computed server-side from the authenticated user.
  getLeagues(opts) {
    const raw = opts && opts.raw;
    let rows;
    const stored = localStorage.getItem(this.KEYS.leagues);
    if (stored) {
      try { rows = JSON.parse(stored); } catch (e) {}
    }
    if (!rows) {
      rows = this.seedLeagues();
      this.saveLeagues(rows);
    }
    // Legacy-data migration: ensure every row has memberUserIds & ownerId.
    // Rows from earlier seeds had isOwner/isMember flags baked in against
    // Bran specifically; lift those into the new fields.
    const bran = 'usr_bran';
    let migrated = false;
    rows.forEach(l => {
      if (!l.memberUserIds) {
        l.memberUserIds = [];
        if (l.isMember) l.memberUserIds.push(bran);
        migrated = true;
      }
      if (!l.ownerId) {
        l.ownerId = l.isOwner ? bran : null;
        migrated = true;
      }
      // Strip the stale flags from persisted data
      if ('isOwner' in l || 'isMember' in l) {
        delete l.isOwner; delete l.isMember;
        migrated = true;
      }
    });
    if (migrated) this.saveLeagues(rows);

    if (raw) return rows;

    // Decorate each row for the UI
    const uid = this.Session.getCurrentUserId();
    return rows.map(l => ({
      ...l,
      isOwner:  !!uid && l.ownerId === uid,
      isMember: !!uid && (l.ownerId === uid || (l.memberUserIds || []).indexOf(uid) !== -1),
    }));
  },

  saveLeagues(leagues) {
    localStorage.setItem(this.KEYS.leagues, JSON.stringify(leagues));
  },

  // ══════════════════════════════════════════════════════════════
  // LEAGUE MEMBERSHIP — backend-ready model
  //
  // Ownership and membership are NOT stored per-row as "isOwner"/"isMember"
  // (those would be wrong because the same row describes different things
  // to different users). Instead:
  //   • league.ownerId       → immutable owner UUID
  //   • league.memberUserIds → array of user UUIDs
  //
  // For backwards compatibility, getLeagues() decorates each row with
  // `isOwner` / `isMember` computed from the current session. UI code that
  // reads these flags keeps working unchanged. Backend will return these
  // the same way via a request-scoped computation.
  // ══════════════════════════════════════════════════════════════

  // Pure helpers (computed — no mutation)
  isLeagueOwner(league, userId)  {
    if (!league) return false;
    const uid = userId || this.Session.getCurrentUserId();
    return !!uid && league.ownerId === uid;
  },
  isLeagueMember(league, userId) {
    if (!league) return false;
    const uid = userId || this.Session.getCurrentUserId();
    if (!uid) return false;
    const ids = league.memberUserIds || [];
    return ids.indexOf(uid) !== -1 || league.ownerId === uid;
  },

  getMyLeagues() {
    const uid = this.Session.getCurrentUserId();
    return this.getLeagues().filter(l => this.isLeagueMember(l, uid) || this.isLeagueOwner(l, uid));
  },

  getDiscoverLeagues() {
    const uid = this.Session.getCurrentUserId();
    return this.getLeagues().filter(l => !this.isLeagueMember(l, uid) && !this.isLeagueOwner(l, uid));
  },

  joinLeague(leagueId) {
    const leagues = this.getLeagues({ raw: true });
    const league = leagues.find(l => l.id === leagueId);
    const uid = this.Session.getCurrentUserId();
    if (!league || !uid) return league;
    if (!league.memberUserIds) league.memberUserIds = [];
    if (league.memberUserIds.indexOf(uid) === -1 && league.ownerId !== uid) {
      league.memberUserIds.push(uid);
      league.members = (league.members || 0) + 1;
      this.saveLeagues(leagues);
      const p = this.getPlayer();
      p.leaguesJoined += 1;
      this.savePlayer(p);
      this.checkAndAwardPlayerBadge('league_rookie', p.leaguesJoined);
      if (league.mode === 'team') {
        const teamCount = this.getMyLeagues().filter(l => l.mode === 'team').length;
        this.checkAndAwardPlayerBadge('team_player', teamCount);
      }
      const uniqueSports = [...new Set(this.getMyLeagues().map(l => l.sport))].length;
      this.checkAndAwardPlayerBadge('multi_sport', uniqueSports);
    }
    return league;
  },

  leaveLeague(leagueId) {
    const leagues = this.getLeagues({ raw: true });
    const league = leagues.find(l => l.id === leagueId);
    const uid = this.Session.getCurrentUserId();
    if (!league || !uid || !league.memberUserIds) return league;
    const idx = league.memberUserIds.indexOf(uid);
    if (idx >= 0) {
      league.memberUserIds.splice(idx, 1);
      league.members = Math.max(0, (league.members || 1) - 1);
      this.saveLeagues(leagues);
    }
    return league;
  },

  createLeague(data) {
    const currentUser = this.Session.getCurrentUser();
    const ownerId = currentUser ? currentUser.id : null;
    const league = {
      id: 'lg_' + uuid().slice(0, 8),
      name: data.name,
      sport: data.sport || 'Football',
      region: data.region || 'Europe',
      type: data.type || 'public',
      mode: data.mode || 'individual',
      team: data.team || null,
      members: 1,
      maxMembers: data.maxMembers || 50,
      // Authoritative ownership + membership (server-side authz compares
      // currentUserId against ownerId / memberUserIds). isOwner/isMember
      // are NOT stored — they're decorated onto read results by getLeagues().
      ownerId: ownerId,
      memberUserIds: ownerId ? [] : [],   // owner is implicitly a member
      status: 'active',
      stage: 'Matchday 1',
      yourRank: 1,
      yourPoints: 0,
      teamName: data.teamName || null,
      teamRank: null,
      createdAt: new Date().toISOString(),
      createdBy: currentUser ? currentUser.handle : '@bran_predicts',
      trophy: data.trophy || { type: 'league_champion', name: 'League Champion', desc: 'Won a full league season', icon: 'trophy-gold', rarity: 'legendary', custom: false },
    };
    // Use raw getter for the mutation so we don't write decorated flags
    const leaguesRaw = this.getLeagues({ raw: true });
    leaguesRaw.unshift(league);
    this.saveLeagues(leaguesRaw);
    const p = this.getPlayer();
    p.leaguesJoined += 1;
    this.savePlayer(p);
    // Check league badges
    this.checkAndAwardPlayerBadge('league_rookie', p.leaguesJoined);
    return league;
  },

  seedLeagues() {
    return [
      { id: 'lg_laliga', name: 'LaLiga Legends 24/25', sport: 'Football', region: 'Europe', type: 'public', mode: 'individual', team: 'Barcelona', members: 8, maxMembers: 20, isOwner: true, isMember: true, status: 'active', stage: 'Matchday 28', yourRank: 1, yourPoints: 1240, teamName: null, teamRank: null, createdAt: '2026-03-01T10:00:00Z', createdBy: '@bran_predicts' },
      { id: 'lg_ucl', name: 'UCL Knockout Crew', sport: 'Football', region: 'Europe', type: 'private', mode: 'team', team: null, members: 3, maxMembers: 12, isOwner: true, isMember: true, status: 'active', stage: 'Quarter-finals', yourRank: 1, yourPoints: 980, teamName: 'Team Alpha', teamRank: 1, createdAt: '2026-02-15T10:00:00Z', createdBy: '@bran_predicts' },
      { id: 'lg_draft', name: 'Draft Night Crew', sport: 'Basketball', region: 'North America', type: 'private', mode: 'team', team: 'Lakers', members: 3, maxMembers: 8, isOwner: false, isMember: true, status: 'active', stage: 'Week 14', yourRank: 5, yourPoints: 740, teamName: 'Team Bravo', teamRank: 3, createdAt: '2026-01-20T10:00:00Z', createdBy: '@hoops_dan' },
      { id: 'lg_fanatics', name: 'La Liga Fanatics', sport: 'Football', region: 'Europe', type: 'public', mode: 'individual', team: 'Barcelona', members: 890, maxMembers: 1000, isOwner: false, isMember: true, status: 'active', stage: 'Matchday 28', yourRank: 24, yourPoints: 2180, teamName: null, teamRank: null, createdAt: '2025-08-01T10:00:00Z', createdBy: '@futbol_guru' },
      { id: 'lg_champions', name: 'Champions Bundle', sport: 'Football', region: 'Europe', type: 'public', mode: 'individual', team: null, members: 234, maxMembers: 500, isOwner: false, isMember: true, status: 'active', stage: 'Round of 16', yourRank: 8, yourPoints: 1560, teamName: null, teamRank: null, createdAt: '2025-09-15T10:00:00Z', createdBy: '@ucl_king' },
      { id: 'lg_hala', name: 'Hala Madrid Global', sport: 'Football', region: 'Europe', type: 'public', mode: 'individual', team: 'Real Madrid', members: 342, maxMembers: 500, isOwner: false, isMember: false, status: 'active', stage: 'Matchday 30', yourRank: null, yourPoints: null, teamName: null, teamRank: null, createdAt: '2026-03-10T10:00:00Z', createdBy: '@madridista_99' },
      { id: 'lg_lakers', name: 'Lakers Nation Predictions', sport: 'Basketball', region: 'North America', type: 'public', mode: 'team', team: 'Lakers', members: 189, maxMembers: 300, isOwner: false, isMember: false, status: 'active', stage: 'Playoff Round 1', yourRank: null, yourPoints: null, teamName: null, teamRank: null, createdAt: '2026-02-01T10:00:00Z', createdBy: '@showtime_fan' },
      { id: 'lg_dub', name: 'Dub Nation Picks', sport: 'Basketball', region: 'North America', type: 'public', mode: 'individual', team: 'Warriors', members: 567, maxMembers: 750, isOwner: false, isMember: false, status: 'active', stage: 'Week 18', yourRank: null, yourPoints: null, teamName: null, teamRank: null, createdAt: '2025-11-01T10:00:00Z', createdBy: '@bay_area_hoops' },
      { id: 'lg_slam', name: 'Grand Slam Guessers', sport: 'Tennis', region: 'Europe', type: 'public', mode: 'individual', team: null, members: 120, maxMembers: 200, isOwner: false, isMember: false, status: 'active', stage: 'Roland Garros', yourRank: null, yourPoints: null, teamName: null, teamRank: null, createdAt: '2026-01-15T10:00:00Z', createdBy: '@ace_predictor' },
      { id: 'lg_citizens', name: 'Citizens Inner Circle', sport: 'Football', region: 'Europe', type: 'private', mode: 'team', team: 'Man City', members: 9, maxMembers: 9, isOwner: false, isMember: false, status: 'active', stage: 'Matchday 28', yourRank: null, yourPoints: null, teamName: null, teamRank: null, createdAt: '2025-10-01T10:00:00Z', createdBy: '@mcfc_die_hard' },
      // ── Completed Leagues (History) ──
      { id: 'lg_pl2324', name: 'Premier League 23/24', sport: 'Football', region: 'Europe', type: 'public', mode: 'individual', team: null, members: 12, maxMembers: 50, isOwner: true, isMember: true, status: 'completed', stage: 'Ended', yourRank: 1, yourPoints: 4560, totalPoints: 4560, accuracy: 72, teamName: null, teamRank: null, createdAt: '2023-09-01T10:00:00Z', createdBy: '@bran_predicts' },
      { id: 'lg_wc2022', name: 'World Cup 2022 Preds', sport: 'Football', region: 'Europe', type: 'public', mode: 'individual', team: null, members: 456, maxMembers: 1000, isOwner: false, isMember: true, status: 'completed', stage: 'Ended', yourRank: 3, yourPoints: 3890, totalPoints: 3890, accuracy: 68, teamName: null, teamRank: null, createdAt: '2022-11-01T10:00:00Z', createdBy: '@world_cup_guru' },
      { id: 'lg_summer22', name: 'Summer Olympics 2024', sport: 'General', region: 'Global', type: 'public', mode: 'individual', team: null, members: 18, maxMembers: 100, isOwner: false, isMember: true, status: 'completed', stage: 'Ended', yourRank: 6, yourPoints: 2100, totalPoints: 2100, accuracy: 58, teamName: null, teamRank: null, createdAt: '2024-04-01T10:00:00Z', createdBy: '@olympics_fan' },
      { id: 'lg_euro24', name: 'Euro 2024 Showdown', sport: 'Football', region: 'Europe', type: 'public', mode: 'individual', team: null, members: 64, maxMembers: 200, isOwner: true, isMember: true, status: 'completed', stage: 'Ended', yourRank: 2, yourPoints: 5210, totalPoints: 5210, accuracy: 69, teamName: null, teamRank: null, createdAt: '2024-06-01T10:00:00Z', createdBy: '@bran_predicts' },
    ];
  },

  // ── Matches ──
  getMatches() {
    const stored = localStorage.getItem(this.KEYS.matches);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    const seed = this.seedMatches();
    this.saveMatches(seed);
    return seed;
  },

  saveMatches(matches) {
    localStorage.setItem(this.KEYS.matches, JSON.stringify(matches));
  },

  getUpcomingMatches() {
    return this.getMatches().filter(m => m.status === 'upcoming' || m.status === 'live');
  },

  seedMatches() {
    const today = new Date();
    const d = (offset, h, m) => { const dt = new Date(today); dt.setDate(dt.getDate() + offset); dt.setHours(h, m, 0, 0); return dt.toISOString(); };
    return [
      { id: 'm_1', home: 'Atletico Madrid', away: 'Sevilla', sport: 'Football', league: 'La Liga', leagueId: 'lg_laliga', time: d(0, 20, 0), status: 'upcoming', score: null, mates: 3, preQs: 1, notified: false, favorited: true },
      { id: 'm_2', home: 'LA Lakers', away: 'Golden State Warriors', sport: 'Basketball', league: 'NBA', leagueId: 'lg_draft', time: d(0, 21, 30), status: 'upcoming', score: null, mates: 7, preQs: 0, notified: false, favorited: true },
      { id: 'm_3', home: 'Real Madrid', away: 'Man City', sport: 'Football', league: 'Champions League', leagueId: 'lg_ucl', time: d(1, 21, 0), status: 'upcoming', score: null, mates: 3, preQs: 2, notified: false, favorited: true },
      { id: 'm_4', home: 'Valencia', away: 'Real Betis', sport: 'Football', league: 'La Liga', leagueId: 'lg_fanatics', time: d(1, 21, 0), status: 'upcoming', score: null, mates: 5, preQs: 0, notified: true, favorited: false },
      { id: 'm_5', home: 'Manchester City', away: 'Arsenal', sport: 'Football', league: 'Premier League', leagueId: 'lg_champions', time: d(2, 15, 0), status: 'upcoming', score: null, mates: 2, preQs: 1, notified: false, favorited: true },
      { id: 'm_6', home: 'Barcelona', away: 'Real Sociedad', sport: 'Football', league: 'La Liga', leagueId: 'lg_laliga', time: d(2, 18, 0), status: 'upcoming', score: null, mates: 3, preQs: 0, notified: false, favorited: false },
      { id: 'm_7', home: 'Liverpool', away: 'Man City', sport: 'Football', league: 'Premier League', leagueId: null, time: d(0, 17, 30), status: 'live', score: '2 — 1', minute: 58, mates: 4, preQs: 0, notified: false, favorited: true },
      { id: 'm_8', home: 'Barcelona', away: 'Real Madrid', sport: 'Football', league: 'La Liga', leagueId: 'lg_laliga', time: d(0, 21, 0), status: 'live', score: '1 — 0', minute: 32, mates: 6, preQs: 0, notified: false, favorited: true },
      { id: 'm_9', home: 'Arsenal', away: 'Chelsea', sport: 'Football', league: 'Premier League', leagueId: null, time: d(0, 17, 30), status: 'upcoming', score: null, mates: 0, preQs: 0, notified: false, favorited: false },
      { id: 'm_10', home: 'Juventus', away: 'Napoli', sport: 'Football', league: 'Serie A', leagueId: null, time: d(1, 18, 45), status: 'upcoming', score: null, mates: 0, preQs: 0, notified: false, favorited: false },
      { id: 'm_11', home: 'Bayern Munich', away: 'Dortmund', sport: 'Football', league: 'Bundesliga', leagueId: null, time: d(2, 20, 0), status: 'upcoming', score: null, mates: 1, preQs: 0, notified: false, favorited: false },
      { id: 'm_12', home: 'LA Lakers', away: 'Boston Celtics', sport: 'Basketball', league: 'NBA', leagueId: null, time: d(1, 1, 0), status: 'upcoming', score: null, mates: 2, preQs: 0, notified: false, favorited: false },
    ];
  },

  toggleFavoriteMatch(matchId) {
    const matches = this.getMatches();
    const m = matches.find(x => x.id === matchId);
    if (m) { m.favorited = !m.favorited; this.saveMatches(matches); }
    return m;
  },

  toggleNotifyMatch(matchId) {
    const matches = this.getMatches();
    const m = matches.find(x => x.id === matchId);
    if (m) { m.notified = !m.notified; this.saveMatches(matches); }
    return m;
  },

  // ── Reservations ──
  getReservations() {
    const stored = localStorage.getItem(this.KEYS.reservations);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    return [];
  },

  saveReservations(reservations) {
    localStorage.setItem(this.KEYS.reservations, JSON.stringify(reservations));
  },

  reserveSpot(venueName, eventName) {
    const res = this.getReservations();
    res.unshift({ id: 'r_' + uuid().slice(0, 8), venue: venueName, event: eventName, date: new Date().toISOString(), status: 'confirmed' });
    this.saveReservations(res);
    return res[0];
  },

  formatMatchTime(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = d - now;
    const diffH = diffMs / (1000 * 60 * 60);
    const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (diffH < 0) return timeStr;
    if (diffH < 1) return 'in ' + Math.ceil(diffMs / 60000) + 'min';
    if (diffH < 24) return 'in ' + Math.round(diffH) + 'h';
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return 'Tomorrow · ' + timeStr;
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
    return dayName + ' · ' + timeStr;
  },

  // ══════════════════════════════════════════
  // TIER GATING — Feature Limits & Checks
  // ══════════════════════════════════════════

  TIER_LIMITS: {
    // ── Player Tiers ──
    // Pricing: Starter=Free, Pro=€7.99/mo, Elite=€19.99/mo
    // See docs/TIER_ARCHITECTURE.md for full rationale and feature gate matrix.
    'starter': {
      label: 'Starter',
      price: 0,
      // ── Leagues ──
      leaguesCreatePerWeek: 1,
      leaguesJoinMax: 3,
      leagueMaxPlayers: 10,
      teamMaxTeams: 2,
      teamMaxPlayers: 3,
      // ── Question Lanes (canonical: CORE_MATCH_PREMATCH / CORE_MATCH_LIVE / REAL_WORLD) ──
      liveQuestionsEnabled: false,        // CORE_MATCH_LIVE locked for league creation
      liveQuestionsPerMatch: 3,           // Starter: 3 live answer submissions per match
      realWorldQuestionsEnabled: false,   // REAL_WORLD locked
      realWorldQuestionsPerMonth: 0,
      aiQuestionsPerMonth: 30,
      aiWeeklyQuota: 2,              // per-league weekly AI question budget (matches Edge Function)
      questionTypes: ['pre-match', 'halftime'], // legacy compat
      // ── Game Modes ──
      battleRoyalePerDay: 3,
      triviaModesAllowed: ['solo'],
      triviaGamesPerDay: 5,
      // ── Mechanics ──
      riskyAnswers: false,
      streakBonuses: false,
      liveStats: false,
      bettingPredictions: false,
      seasonLong: false,
      customQuestions: false,
      scheduleQuestions: false,
      // ── UX / Display ──
      customLeagueThemes: false,
      adFree: false,
      fullMatchSchedule: false,
      leagueAdminTools: false,
      badges: false,
      venueReservations: false,
      advancedAnalytics: false,
      predictionHistoryExport: false,
      earlyAccess: false,
      // ── Customization ──
      customPhotoUpload: false,       // profile photo upload locked
      customLeagueCoverPhoto: false,  // league cover photo locked
      // ── Trophies ──
      trophyPresets: ['league_champion'],
      customTrophyCreation: false,
      trophiesAllowed: true,
    },
    'pro': {
      label: 'Pro',
      price: 7.99,
      // ── Leagues ──
      leaguesCreatePerWeek: 5,
      leaguesJoinMax: 20,
      leagueMaxPlayers: 40,
      teamMaxTeams: 6,
      teamMaxPlayers: 5,
      // ── Question Lanes ──
      liveQuestionsEnabled: true,           // CORE_MATCH_LIVE unlocked
      liveQuestionsPerMatch: Infinity,      // Pro: unlimited live answers
      realWorldQuestionsEnabled: 'limited', // REAL_WORLD: limited quota
      realWorldQuestionsPerMonth: 10,
      aiQuestionsPerMonth: 400,
      aiWeeklyQuota: 5,
      questionTypes: ['pre-match', 'halftime', 'live', 'prediction', 'news', 'history'],
      // ── Game Modes ──
      battleRoyalePerDay: Infinity,
      triviaModesAllowed: ['solo', '1v1'],
      triviaGamesPerDay: Infinity,
      // ── Mechanics ──
      riskyAnswers: true,
      streakBonuses: true,
      liveStats: false,
      bettingPredictions: false,
      seasonLong: false,
      customQuestions: false,
      scheduleQuestions: false,
      // ── UX / Display ──
      customLeagueThemes: true,
      adFree: true,
      fullMatchSchedule: true,
      leagueAdminTools: false,
      badges: true,
      venueReservations: true,
      advancedAnalytics: false,
      predictionHistoryExport: false,
      earlyAccess: false,
      // ── Customization ──
      customPhotoUpload: true,
      customLeagueCoverPhoto: true,
      // ── Trophies ──
      trophyPresets: ['league_champion', 'league_podium', 'league_runner_up', 'undefeated_season', 'season_champion'],
      customTrophyCreation: false,
      trophiesAllowed: true,
    },
    'elite': {
      label: 'Elite',
      price: 19.99,
      // ── Leagues ──
      leaguesCreatePerWeek: Infinity,
      leaguesJoinMax: Infinity,
      leagueMaxPlayers: 100,
      teamMaxTeams: Infinity,
      teamMaxPlayers: 10,
      // ── Question Lanes ──
      liveQuestionsEnabled: true,      // CORE_MATCH_LIVE full
      liveQuestionsPerMatch: Infinity, // Elite: unlimited live answers
      realWorldQuestionsEnabled: true, // REAL_WORLD full + priority
      realWorldQuestionsPerMonth: Infinity,
      aiQuestionsPerMonth: 1500,
      aiWeeklyQuota: 10,
      questionTypes: ['pre-match', 'halftime', 'live', 'prediction', 'news', 'history', 'custom'],
      // ── Game Modes ──
      battleRoyalePerDay: Infinity,
      triviaModesAllowed: ['solo', '1v1', 'party-room'],
      triviaGamesPerDay: Infinity,
      // ── Mechanics ──
      riskyAnswers: true,
      streakBonuses: true,
      liveStats: true,
      bettingPredictions: true,
      seasonLong: true,
      customQuestions: true,
      scheduleQuestions: true,
      // ── UX / Display ──
      customLeagueThemes: true,
      adFree: true,
      fullMatchSchedule: true,
      leagueAdminTools: true,
      badges: true,
      venueReservations: true,
      advancedAnalytics: true,
      predictionHistoryExport: true,
      earlyAccess: true,
      // ── Customization ──
      customPhotoUpload: true,
      customLeagueCoverPhoto: true,
      // ── Trophies ──
      trophyPresets: ['league_champion', 'league_podium', 'league_runner_up', 'undefeated_season', 'season_champion', 'trivia_perfect', 'trivia_streak_10'],
      customTrophyCreation: true,
      trophiesAllowed: true,
    },
    // ── Venue Tiers ──
    // Pricing: Venue Starter=Free, Venue Pro=€29.99/mo, Venue Elite=€79.99/mo
    // See docs/TIER_ARCHITECTURE.md for full rationale and feature gate matrix.
    'venue-starter': {
      label: 'Venue Starter',
      price: 0,
      // ── Events ──
      eventsPerMonth: 2,
      eventsPerWeek: 1,           // legacy compat key
      maxParticipants: 25,
      concurrentEvents: 1,
      teamMaxTeams: 4,
      teamMaxPlayers: 4,
      // ── Question Lanes ──
      liveQuestionsEnabled: false,       // AI live questions locked
      realWorldQuestionsEnabled: false,  // Real World locked
      realWorldQuestionsPerMonth: 0,
      aiQuestionsPerMonth: 0,            // no AI on free — pre-made bank only
      aiPreviewPerEvent: 3,              // 3 AI-style preview questions per event
      questionTypes: ['pre-match', 'halftime'],
      customQuestionsLive: false,
      questionBank: false,               // pre-made question bank locked
      aiBulkGeneration: false,
      sponsoredQuestions: false,
      // ── Live Floor ──
      liveFloor: 'basic',
      tvDisplayMode: false,
      tableMap: false,
      teamsManagement: false,
      eventScheduling: false,
      playerInviteTools: false,
      nfcJoin: false,
      // ── Branding ──
      customBranding: false,
      whiteLabelOption: false,
      removeSpontixBranding: false,
      // ── Analytics ──
      basicAnalytics: false,
      advancedAnalytics: false,
      apiAccess: false,
      multiVenue: false,
      prizeManagement: false,
      liveStatsTV: false,
      adFree: false,
      // ── Trophies ──
      trophyPresets: [],
      customTrophyCreation: false,
      customTrophyMax: 0,
      canAwardTrophies: false,
      // ── Photos ──
      photoCustomUpload: false,
      photoPresetsAllowed: true,
      photoMaxCustom: 0,
    },
    'venue-pro': {
      label: 'Venue Pro',
      price: 29.99,
      // ── Events ──
      eventsPerMonth: Infinity,
      eventsPerWeek: Infinity,
      maxParticipants: 150,
      aiPreviewPerEvent: Infinity,       // Pro: unlimited AI questions per event
      concurrentEvents: 5,
      teamMaxTeams: 12,
      teamMaxPlayers: 6,
      // ── Question Lanes ──
      liveQuestionsEnabled: true,           // AI live questions enabled
      realWorldQuestionsEnabled: 'limited', // Real World: limited quota
      realWorldQuestionsPerMonth: 20,
      aiQuestionsPerMonth: 300,
      questionTypes: ['pre-match', 'halftime', 'live', 'prediction', 'news', 'trivia'],
      customQuestionsLive: true,
      questionBank: true,
      aiBulkGeneration: false,
      sponsoredQuestions: false,
      // ── Live Floor ──
      liveFloor: 'full',
      tvDisplayMode: true,
      tableMap: true,
      teamsManagement: true,
      eventScheduling: true,
      playerInviteTools: true,
      nfcJoin: true,
      // ── Branding ──
      customBranding: true,
      whiteLabelOption: false,
      removeSpontixBranding: true,
      // ── Analytics ──
      basicAnalytics: true,
      advancedAnalytics: true,
      apiAccess: false,
      multiVenue: false,
      prizeManagement: false,
      liveStatsTV: false,
      adFree: true,
      // ── Trophies ──
      trophyPresets: ['venue_event_champion', 'venue_regular', 'trivia_1v1_champion', 'trivia_party_winner', 'trivia_perfect'],
      customTrophyCreation: false,
      customTrophyMax: 5,
      canAwardTrophies: true,
      // ── Photos ──
      photoCustomUpload: true,
      photoPresetsAllowed: true,
      photoMaxCustom: 8,
    },
    'venue-elite': {
      label: 'Venue Elite',
      price: 79.99,
      // ── Events ──
      eventsPerMonth: Infinity,
      eventsPerWeek: Infinity,
      maxParticipants: 500,
      aiPreviewPerEvent: Infinity,       // Elite: unlimited AI questions per event
      concurrentEvents: Infinity,
      teamMaxTeams: Infinity,
      teamMaxPlayers: Infinity,
      // ── Question Lanes ──
      liveQuestionsEnabled: true,      // full AI live questions
      realWorldQuestionsEnabled: true, // Real World full + priority
      realWorldQuestionsPerMonth: Infinity,
      aiQuestionsPerMonth: 1000,
      questionTypes: ['pre-match', 'halftime', 'live', 'prediction', 'news', 'trivia', 'custom', 'sponsored'],
      customQuestionsLive: true,
      questionBank: true,
      aiBulkGeneration: true,
      sponsoredQuestions: true,
      // ── Live Floor ──
      liveFloor: 'full',
      tvDisplayMode: true,
      tableMap: true,
      teamsManagement: true,
      eventScheduling: true,
      playerInviteTools: true,
      nfcJoin: true,
      // ── Branding ──
      customBranding: true,
      whiteLabelOption: true,
      removeSpontixBranding: true,
      // ── Analytics ──
      basicAnalytics: true,
      advancedAnalytics: true,
      apiAccess: true,
      multiVenue: true,
      prizeManagement: true,
      liveStatsTV: true,
      adFree: true,
      // ── Trophies ──
      trophyPresets: ['venue_event_champion', 'venue_regular', 'trivia_1v1_champion', 'trivia_party_winner', 'trivia_perfect', 'trivia_streak_10', 'br_champion', 'br_flawless'],
      customTrophyCreation: true,
      customTrophyMax: Infinity,
      canAwardTrophies: true,
      // ── Photos ──
      photoCustomUpload: true,
      photoPresetsAllowed: true,
      photoMaxCustom: Infinity,
    },
  },

  // Get limits for the current user's tier
  getTierLimits(tier) {
    tier = tier || this.getPlayer().tier || 'starter';
    return this.TIER_LIMITS[tier] || this.TIER_LIMITS['starter'];
  },

  // Check if a specific boolean feature is allowed
  canUse(feature, tier) {
    const limits = this.getTierLimits(tier);
    return !!limits[feature];
  },

  // Check if a question type is allowed
  canUseQuestionType(qType, tier) {
    const limits = this.getTierLimits(tier);
    return limits.questionTypes.includes(qType);
  },

  // Get the minimum tier needed for a feature (for upgrade prompts)
  getMinTierFor(feature, isVenue) {
    const tiers = isVenue
      ? ['venue-starter', 'venue-pro', 'venue-elite']
      : ['starter', 'pro', 'elite'];
    for (const t of tiers) {
      if (this.TIER_LIMITS[t][feature]) return this.TIER_LIMITS[t].label;
    }
    return 'Elite';
  },

  // Get numeric limit for a feature
  getLimit(feature, tier) {
    const limits = this.getTierLimits(tier);
    return limits[feature];
  },

  // Show upgrade toast with tier name
  showUpgradePrompt(featureName, requiredTier) {
    const msg = 'Upgrade to ' + requiredTier + ' to unlock ' + featureName;
    if (typeof showToast === 'function') {
      showToast(msg, 'upgrade');
    } else {
      alert(msg);
    }
    return false;
  },

  formatMatchDate(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    if (isToday) return 'Today';
    if (isTomorrow) return 'Tomorrow';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  },

  // ══════════════════════════════════════════
  // PHASE 3 — VENUE DATA
  // ══════════════════════════════════════════

  // ── Venue Profile ──
  // Default demo venue name. Must match one of the SEED_VENUES in venues.html
  // so photos, badges, and trophies written by the venue dashboard surface
  // to players in the venue search. Changing this name breaks the demo flow.
  DEFAULT_VENUE_NAME: 'Arena Bar & Grill',

  // ══════════════════════════════════════════════════════════════
  // VENUES TABLE (backend-ready)
  //
  // Proper venue records with stable UUIDs + ownerId. The legacy
  // `venueProfile` (single-record per localStorage) is kept as a
  // convenience wrapper around the current user's venue, but the
  // canonical source of truth is this table.
  // ══════════════════════════════════════════════════════════════

  // ── Canonical seed venue IDs ──
  // These UUIDs MUST match the ones inserted by backend/migrations/001_initial_schema.sql.
  // Any place in the codebase that needs to refer to a specific seed venue
  // should use SpontixStore.VENUE_IDS.ARENA (etc.) rather than a hardcoded string.
  VENUE_IDS: {
    PENALTY:  '11111111-1111-1111-1111-111111111101',
    SCORE:    '11111111-1111-1111-1111-111111111102',
    DUGOUT:   '11111111-1111-1111-1111-111111111103',
    ARENA:    '11111111-1111-1111-1111-111111111104',
    FULLTIME: '11111111-1111-1111-1111-111111111105',
    FINAL:    '11111111-1111-1111-1111-111111111106',
  },

  _seedVenues() {
    // Six demo venues, mirroring the DB seed exactly. The ARENA venue is
    // "owned" by the demo venue-owner account for the prototype bootstrap;
    // all others have owner_id = null (system venues for discovery).
    const V = this.VENUE_IDS;
    return [
      { id: V.PENALTY,  ownerId: null,        venueName: 'The Penalty Box',       city: 'London',     type: 'Sports Bar', hours: '12:00 - 00:00', capacity: 120, createdAt: '2025-10-01T00:00:00Z' },
      { id: V.SCORE,    ownerId: null,        venueName: 'Score Sports Lounge',   city: 'Manchester', type: 'Sports Bar', hours: '11:00 - 01:00', capacity: 200, createdAt: '2025-11-01T00:00:00Z' },
      { id: V.DUGOUT,   ownerId: null,        venueName: 'The Dugout',            city: 'Liverpool',  type: 'Pub',        hours: '11:00 - 00:00', capacity: 80,  createdAt: '2025-09-15T00:00:00Z' },
      { id: V.ARENA,    ownerId: 'usr_arena', venueName: 'Arena Bar & Grill',     city: 'Birmingham', type: 'Restaurant', hours: '11:00 - 23:00', capacity: 150, createdAt: '2026-02-01T00:00:00Z' },
      { id: V.FULLTIME, ownerId: null,        venueName: 'Full Time Sports Café', city: 'Leeds',      type: 'Sports Bar', hours: '10:00 - 00:00', capacity: 100, createdAt: '2025-12-10T00:00:00Z' },
      { id: V.FINAL,    ownerId: null,        venueName: 'The Final Whistle',     city: 'Dublin',     type: 'Pub',        hours: '12:00 - 01:30', capacity: 80,  createdAt: '2025-08-20T00:00:00Z' },
    ];
  },

  // Helper: get a venue's stable ID from its display name. Used by
  // legacy call sites that still pass names. Prefer venueId elsewhere.
  getVenueIdByName(venueName) {
    const v = this.getVenues().find(x => x.venueName === venueName);
    return v ? v.id : null;
  },

  getVenues() {
    const stored = localStorage.getItem(this.KEYS.venues);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    const seed = this._seedVenues();
    localStorage.setItem(this.KEYS.venues, JSON.stringify(seed));
    return seed;
  },

  saveVenues(venues) {
    localStorage.setItem(this.KEYS.venues, JSON.stringify(venues));
  },

  getVenueById(venueId) {
    return this.getVenues().find(v => v.id === venueId) || null;
  },

  getVenuesByOwner(ownerId) {
    return this.getVenues().filter(v => v.ownerId === ownerId);
  },

  createVenue(data, ownerId) {
    const owner = ownerId || this.Session.getCurrentUserId();
    if (!owner) throw new Error('createVenue: no ownerId provided and no session');
    const venues = this.getVenues();
    const v = {
      id: 'ven_' + uuid().slice(0, 8),
      ownerId: owner,
      venueName: data.venueName,
      city: data.city || '',
      type: data.type || 'Sports Bar',
      hours: data.hours || '',
      capacity: data.capacity || 50,
      createdAt: new Date().toISOString(),
    };
    venues.push(v);
    this.saveVenues(venues);
    return v;
  },

  updateVenue(venueId, patch, actorUserId) {
    const venue = this.getVenueById(venueId);
    if (!venue) return { error: 'not-found' };
    const actor = actorUserId || this.Session.getCurrentUserId();
    if (venue.ownerId !== actor) return { error: 'forbidden' };
    Object.assign(venue, patch);
    const venues = this.getVenues().map(v => v.id === venueId ? venue : v);
    this.saveVenues(venues);
    return venue;
  },

  // Legacy single-record accessor. Now a thin wrapper that resolves
  // the current session's active venue from the Venues table. Kept
  // so existing pages (venue-dashboard.html, etc.) don't need to be
  // rewritten — but new code should prefer getVenueById / Session.
  getVenueProfile() {
    const activeId = this.Session.getCurrentVenueId();
    if (activeId) {
      const v = this.getVenueById(activeId);
      if (v) return v;
    }
    // Fallback: return the first venue owned by the current user, if any.
    const uid = this.Session.getCurrentUserId();
    if (uid) {
      const owned = this.getVenuesByOwner(uid);
      if (owned[0]) return owned[0];
    }
    // Backwards-compat: read the old single-venue key if still present.
    const stored = localStorage.getItem(this.KEYS.venueProfile);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    // Last-resort fallback to the seed venue so demo flow never breaks.
    return this.getVenueById(this.VENUE_IDS.ARENA);
  },

  saveVenueProfile(profile) {
    localStorage.setItem(this.KEYS.venueProfile, JSON.stringify(profile));
  },

  // ── Venue Events ──
  getVenueEvents() {
    const stored = localStorage.getItem(this.KEYS.venueEvents);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    const seed = this.seedVenueEvents();
    this.saveVenueEvents(seed);
    return seed;
  },

  saveVenueEvents(events) {
    localStorage.setItem(this.KEYS.venueEvents, JSON.stringify(events));
  },

  createVenueEvent(data) {
    const events = this.getVenueEvents();
    const activeVenue = this.Session.getCurrentVenue();
    const ownerId = this.Session.getCurrentUserId();
    const ev = {
      id: 've_' + uuid().slice(0, 8),
      // Backend authz: venueId identifies which venue owns this event,
      // hostUserId identifies who created it. Both are required for
      // server-side authorization of edit / end / award actions.
      venueId: activeVenue ? activeVenue.id : null,
      hostUserId: ownerId,
      name: data.name,
      matchTitle: data.matchTitle || '',
      date: data.date,
      time: data.time || '20:00',
      sport: data.sport || 'Football',
      maxPlayers: data.maxPlayers || 50,
      registered: 0,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      // Trophy configured by venue at creation. Null = no trophy for winners.
      // Shape when present:
      //   { kind: 'preset', type: 'venue_event_champion' }
      //   { kind: 'custom', customTrophyId: 'vct_...' }   // references venueCustomTrophies
      //   { kind: 'ai', name, desc, icon, rarity }        // AI-generated inline
      trophy: data.trophy || null,
    };
    events.unshift(ev);
    this.saveVenueEvents(events);
    // Check venue badges
    this.checkAndAwardVenueBadge('first_event', events.length);
    this.checkAndAwardVenueBadge('regular_host', events.length);
    this.checkAndAwardVenueBadge('hundred_events', events.length);
    const uniqueSports = [...new Set(events.map(e => e.sport))].length;
    this.checkAndAwardVenueBadge('multi_sport_venue', uniqueSports);
    return ev;
  },

  seedVenueEvents() {
    const today = new Date();
    const d = (offset) => { const dt = new Date(today); dt.setDate(dt.getDate() + offset); return dt.toISOString().split('T')[0]; };
    return [
      { id: 've_1', name: 'El Clásico Night', matchTitle: 'Barcelona vs Real Madrid', date: d(0), time: '21:00', sport: 'Football', maxPlayers: 40, registered: 32, status: 'live', createdAt: '2026-04-10T10:00:00Z' },
      { id: 've_2', name: 'Champions League Semi', matchTitle: 'Real Madrid vs Man City', date: d(1), time: '21:00', sport: 'Football', maxPlayers: 50, registered: 18, status: 'scheduled', createdAt: '2026-04-09T10:00:00Z' },
      { id: 've_3', name: 'Premier League Sunday', matchTitle: 'Arsenal vs Chelsea', date: d(3), time: '16:30', sport: 'Football', maxPlayers: 40, registered: 5, status: 'scheduled', createdAt: '2026-04-08T10:00:00Z' },
      { id: 've_4', name: 'NBA Playoffs Watch Party', matchTitle: 'Lakers vs Celtics', date: d(5), time: '01:00', sport: 'Basketball', maxPlayers: 30, registered: 12, status: 'scheduled', createdAt: '2026-04-07T10:00:00Z' },
    ];
  },

  // ── Venue Stats ──
  getVenueStats() {
    const stored = localStorage.getItem(this.KEYS.venueStats);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    // Compute from live session data if available
    const players = JSON.parse(localStorage.getItem('spontix_live_players') || '[]');
    const answers = JSON.parse(localStorage.getItem('spontix_live_answers') || '{}');
    const questions = JSON.parse(localStorage.getItem('spontix_live_questions') || '[]');
    const totalAnswers = Object.values(answers).reduce((sum, q) => sum + Object.keys(q).length, 0);
    return {
      totalPlayers: players.length || 47,
      totalTeams: 6,
      totalQuestions: questions.length || 14,
      totalAnswers: totalAnswers || 186,
      eventsHosted: 12,
      avgPlayersPerEvent: 28,
      totalRevenue: 0,
    };
  },

  saveVenueStats(stats) {
    localStorage.setItem(this.KEYS.venueStats, JSON.stringify(stats));
  },

  // ── All registered venues (for player discovery) ──
  getAllVenues() {
    const venues = [];
    // Registered venue from localStorage
    const profile = this.getVenueProfile();
    if (profile && profile.venueName) {
      venues.push({
        ...profile,
        name: profile.venueName,
        type: profile.venueType || 'Venue',
        events: this.getVenueEvents().filter(e => e.status === 'scheduled' || e.status === 'live'),
        isRegistered: true,
      });
    }
    return venues;
  },

  // ══════════════════════════════════════════════
  // BADGES & ACHIEVEMENTS SYSTEM
  // ══════════════════════════════════════════════

  // ── localStorage keys ──
  // Player: 'spontix_badges'        → { earned: { badgeId: { date, progress } }, progress: { badgeId: number } }
  // Venue:  'spontix_venue_badges'   → same structure

  // ═══════════════════════
  //  PLAYER BADGE DEFINITIONS
  // ═══════════════════════
  PLAYER_BADGES: {
    // ── SHORT-TERM (achievable in first session or first few games) ──
    first_blood:     { id: 'first_blood',     name: 'First Blood',       desc: 'Answer your first question',                  icon: 'star',       color: 'lime',   category: 'quick-start', threshold: 1,   stat: 'totalCorrect' },
    getting_started: { id: 'getting_started', name: 'Getting Started',   desc: 'Play your first match',                       icon: 'play',       color: 'teal',   category: 'quick-start', threshold: 1,   stat: 'gamesPlayed' },
    league_rookie:   { id: 'league_rookie',   name: 'League Rookie',     desc: 'Join your first league',                      icon: 'users',      color: 'purple', category: 'quick-start', threshold: 1,   stat: 'leaguesJoined' },
    hot_streak:      { id: 'hot_streak',      name: 'Hot Streak',        desc: 'Get 5 correct answers in a row',              icon: 'zap',        color: 'purple', category: 'quick-start', threshold: 5,   stat: 'bestStreak' },
    bold_move:       { id: 'bold_move',       name: 'Bold Move',         desc: 'Win a Risky Answer',                          icon: 'heart',      color: 'coral',  category: 'quick-start', threshold: 1,   stat: 'riskyWins' },
    social_player:   { id: 'social_player',   name: 'Social Player',     desc: 'Share a result or invite a friend',           icon: 'share',      color: 'teal',   category: 'quick-start', threshold: 1,   stat: 'shares' },

    // ── MEDIUM-TERM (days to weeks of play) ──
    squad_leader:    { id: 'squad_leader',    name: 'Squad Leader',      desc: 'Create a league with 5+ players',             icon: 'crown',      color: 'teal',   category: 'social', threshold: 1,   stat: 'leaguesCreatedWith5' },
    team_player:     { id: 'team_player',     name: 'Team Player',       desc: 'Join 3+ team leagues',                        icon: 'users',      color: 'purple', category: 'social', threshold: 3,   stat: 'teamLeaguesJoined' },
    century_club:    { id: 'century_club',    name: 'Century Club',      desc: 'Answer 100 questions',                        icon: 'bar-chart',  color: 'purple', category: 'grind',  threshold: 100, stat: 'totalAnswered' },
    sharpshooter:    { id: 'sharpshooter',    name: 'Sharpshooter',      desc: 'Reach 75% overall accuracy',                  icon: 'target',     color: 'lime',   category: 'skill',  threshold: 75,  stat: 'overallAccuracy' },
    champion:        { id: 'champion',        name: 'Champion',          desc: 'Finish 1st place in a league',                icon: 'trophy',     color: 'lime',   category: 'skill',  threshold: 1,   stat: 'firstPlaceFinishes' },
    perfect_game:    { id: 'perfect_game',    name: 'Perfect Game',      desc: 'Answer every question right in a match',      icon: 'check-circle', color: 'lime', category: 'skill',  threshold: 1,   stat: 'perfectGames' },
    inferno:         { id: 'inferno',         name: 'Inferno',           desc: 'Get a 10-answer streak',                      icon: 'flame',      color: 'coral',  category: 'skill',  threshold: 10,  stat: 'bestStreak' },
    br_survivor:     { id: 'br_survivor',     name: 'BR Survivor',       desc: 'Win a Battle Royale game',                    icon: 'shield',     color: 'coral',  category: 'br',     threshold: 1,   stat: 'brWins' },
    br_veteran:      { id: 'br_veteran',      name: 'BR Veteran',        desc: 'Play 10 Battle Royale games',                 icon: 'swords',     color: 'coral',  category: 'br',     threshold: 10,  stat: 'brGamesPlayed' },
    trivia_master:   { id: 'trivia_master',   name: 'Trivia Master',     desc: 'Win 5 Trivia 1v1 duels',                      icon: 'brain',      color: 'teal',   category: 'trivia', threshold: 5,   stat: 'trivia1v1Wins' },
    trivia_streak:   { id: 'trivia_streak',   name: 'Quiz Whiz',         desc: 'Answer 10 trivia questions in a row correctly', icon: 'lightning', color: 'teal',   category: 'trivia', threshold: 10,  stat: 'triviaStreak' },
    venue_explorer:  { id: 'venue_explorer',  name: 'Venue Explorer',    desc: 'Play at 3 different venues',                  icon: 'map-pin',    color: 'purple', category: 'social', threshold: 3,   stat: 'uniqueVenuesPlayed' },
    night_owl:       { id: 'night_owl',       name: 'Night Owl',         desc: 'Play a game after midnight',                  icon: 'moon',       color: 'purple', category: 'fun',    threshold: 1,   stat: 'nightGames' },
    early_bird:      { id: 'early_bird',      name: 'Early Bird',        desc: 'Answer a pre-match question before kick-off', icon: 'sunrise',    color: 'lime',   category: 'fun',    threshold: 1,   stat: 'preMatchAnswers' },

    // ── LONG-TERM (weeks to months) ──
    marathon:        { id: 'marathon',        name: 'Marathon',           desc: 'Play every matchday for 30 days straight',    icon: 'calendar',   color: 'teal',   category: 'grind',  threshold: 30,  stat: 'consecutiveDays' },
    thousand_club:   { id: 'thousand_club',   name: 'Thousand Club',     desc: 'Answer 1,000 questions',                      icon: 'bar-chart',  color: 'lime',   category: 'grind',  threshold: 1000, stat: 'totalAnswered' },
    five_k:          { id: 'five_k',          name: '5K Legend',          desc: 'Earn 5,000 total points',                     icon: 'award',      color: 'lime',   category: 'grind',  threshold: 5000, stat: 'totalPoints' },
    ten_k:           { id: 'ten_k',           name: '10K Master',        desc: 'Earn 10,000 total points',                    icon: 'award',      color: 'coral',  category: 'grind',  threshold: 10000, stat: 'totalPoints' },
    dynasty:         { id: 'dynasty',         name: 'Dynasty',           desc: 'Win 3 leagues',                               icon: 'trophy',     color: 'coral',  category: 'skill',  threshold: 3,   stat: 'firstPlaceFinishes' },
    season_warrior:  { id: 'season_warrior',  name: 'Season Warrior',    desc: 'Complete a full season-long league',           icon: 'flag',       color: 'purple', category: 'grind',  threshold: 1,   stat: 'seasonsCompleted' },
    multi_sport:     { id: 'multi_sport',     name: 'Multi-Sport',       desc: 'Play leagues in 3+ different sports',          icon: 'globe',      color: 'teal',   category: 'social', threshold: 3,   stat: 'uniqueSports' },
    br_legend:       { id: 'br_legend',       name: 'BR Legend',         desc: 'Win 10 Battle Royale games',                  icon: 'shield',     color: 'coral',  category: 'br',     threshold: 10,  stat: 'brWins' },
    all_rounder:     { id: 'all_rounder',     name: 'All-Rounder',       desc: 'Earn badges in 5 different categories',        icon: 'compass',    color: 'purple', category: 'meta',   threshold: 5,   stat: 'uniqueBadgeCategories' },
    og_player:       { id: 'og_player',       name: 'OG Player',         desc: 'Be active for 6+ months',                     icon: 'clock',      color: 'lime',   category: 'grind',  threshold: 180, stat: 'daysActive' },
  },

  // ═══════════════════════
  //  VENUE BADGE DEFINITIONS
  // ═══════════════════════
  VENUE_BADGES: {
    // ── Quick wins ──
    first_event:       { id: 'first_event',       name: 'First Event',       desc: 'Host your first Spontix event',              icon: 'calendar',   color: 'purple', category: 'getting-started', threshold: 1,   stat: 'eventsHosted' },
    full_house:        { id: 'full_house',         name: 'Full House',        desc: 'Hit max capacity at an event',               icon: 'users',      color: 'lime',   category: 'getting-started', threshold: 1,   stat: 'fullCapacityEvents' },
    question_creator:  { id: 'question_creator',   name: 'Question Creator',  desc: 'Create 10 custom questions',                 icon: 'edit',       color: 'teal',   category: 'content',  threshold: 10,  stat: 'customQuestionsCreated' },

    // ── Growth ──
    crowd_puller:      { id: 'crowd_puller',       name: 'Crowd Puller',      desc: 'Host 100+ total players across events',      icon: 'trending-up', color: 'lime',  category: 'growth',   threshold: 100,  stat: 'totalPlayersHosted' },
    regular_host:      { id: 'regular_host',       name: 'Regular Host',      desc: 'Host 10 events',                             icon: 'repeat',     color: 'purple', category: 'growth',   threshold: 10,  stat: 'eventsHosted' },
    weekly_warrior:    { id: 'weekly_warrior',      name: 'Weekly Warrior',    desc: 'Host events for 4 consecutive weeks',        icon: 'calendar',   color: 'teal',   category: 'consistency', threshold: 4, stat: 'consecutiveWeeksHosted' },
    crowd_favourite:   { id: 'crowd_favourite',     name: 'Crowd Favourite',   desc: 'Get 50+ total reservations',                 icon: 'heart',      color: 'coral',  category: 'growth',   threshold: 50,  stat: 'totalReservations' },
    multi_sport_venue: { id: 'multi_sport_venue',   name: 'Multi-Sport Venue', desc: 'Host events for 3+ different sports',        icon: 'globe',      color: 'teal',   category: 'content',  threshold: 3,   stat: 'uniqueSportsHosted' },

    // ── Quality & Engagement ──
    five_star:         { id: 'five_star',           name: 'Five Star',         desc: 'Average player rating of 4.5+',              icon: 'star',       color: 'lime',   category: 'quality',  threshold: 4.5, stat: 'avgRating' },
    engagement_king:   { id: 'engagement_king',     name: 'Engagement King',   desc: '90%+ answer rate at an event',               icon: 'activity',   color: 'lime',   category: 'quality',  threshold: 90,  stat: 'bestAnswerRate' },
    return_customers:  { id: 'return_customers',    name: 'Return Customers',  desc: '30% of players return for a second event',   icon: 'refresh',    color: 'teal',   category: 'quality',  threshold: 30,  stat: 'returnPlayerRate' },
    tv_master:         { id: 'tv_master',           name: 'TV Master',         desc: 'Use TV Display mode at 5 events',            icon: 'monitor',    color: 'purple', category: 'tech',     threshold: 5,   stat: 'tvModeEvents' },
    table_pro:         { id: 'table_pro',           name: 'Table Pro',         desc: 'Set up and use table map at 3 events',       icon: 'grid',       color: 'purple', category: 'tech',     threshold: 3,   stat: 'tableMapEvents' },

    // ── Long-term / prestige ──
    hundred_events:    { id: 'hundred_events',      name: 'Century Venue',     desc: 'Host 100 events',                            icon: 'award',      color: 'coral',  category: 'prestige', threshold: 100, stat: 'eventsHosted' },
    thousand_players:  { id: 'thousand_players',     name: '1K Players',        desc: 'Host 1,000+ total players',                  icon: 'trending-up', color: 'coral', category: 'prestige', threshold: 1000, stat: 'totalPlayersHosted' },
    community_hub:     { id: 'community_hub',       name: 'Community Hub',     desc: 'Host events every week for 3 months',        icon: 'home',       color: 'purple', category: 'prestige', threshold: 12,  stat: 'consecutiveWeeksHosted' },
    venue_elite:       { id: 'venue_elite',         name: 'Elite Venue',       desc: 'Earn 10+ venue badges',                      icon: 'diamond',    color: 'lime',   category: 'meta',     threshold: 10,  stat: 'totalVenueBadgesEarned' },
  },

  // ═══════════════════════
  //  BADGE ICONS (SVG paths)
  // ═══════════════════════
  BADGE_ICONS: {
    'star':         '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    'play':         '<polygon points="5 3 19 12 5 21 5 3"/>',
    'users':        '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
    'zap':          '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    'heart':        '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>',
    'share':        '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    'crown':        '<path d="M2 20h20L19 8l-5 6-2-8-2 8-5-6z"/><rect x="2" y="20" width="20" height="2" rx="1"/>',
    'bar-chart':    '<path d="M18 20V10M12 20V4M6 20V14"/>',
    'target':       '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'trophy':       '<path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/>',
    'check-circle': '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    'flame':        '<path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>',
    'shield':       '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'swords':       '<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19.5 17.5L8 6V3h3l11.5 11.5"/><path d="M8 19l6-6"/>',
    'brain':        '<path d="M9.5 2A5.5 5.5 0 004 7.5c0 1.5.6 2.8 1.6 3.8L12 18l6.4-6.7A5.5 5.5 0 0014.5 2"/><path d="M12 2v16"/>',
    'lightning':    '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    'map-pin':      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
    'moon':         '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
    'sunrise':      '<path d="M17 18a5 5 0 00-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/>',
    'calendar':     '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'flag':         '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    'globe':        '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>',
    'compass':      '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    'clock':        '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'award':        '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>',
    'edit':         '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    'trending-up':  '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    'repeat':       '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    'activity':     '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    'refresh':      '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
    'monitor':      '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    'grid':         '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    'home':         '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'diamond':      '<path d="M2.7 10.3a2.41 2.41 0 000 3.41l7.59 7.59a2.41 2.41 0 003.41 0l7.59-7.59a2.41 2.41 0 000-3.41L13.7 2.71a2.41 2.41 0 00-3.41 0z"/>',
  },

  // ═══════════════════════
  //  BADGE COLOR MAP
  // ═══════════════════════
  BADGE_COLORS: {
    lime:   { bg: 'rgba(168,225,12,0.12)',  stroke: '#A8E10C' },
    purple: { bg: 'rgba(124,92,252,0.12)',  stroke: '#7C5CFC' },
    coral:  { bg: 'rgba(255,107,107,0.12)', stroke: '#FF6B6B' },
    teal:   { bg: 'rgba(78,205,196,0.12)',  stroke: '#4ECDC4' },
  },

  // ═══════════════════════
  //  BADGE DATA OPERATIONS
  // ═══════════════════════

  getPlayerBadges() {
    const stored = localStorage.getItem('spontix_badges');
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    // Seed some earned badges for demo
    const seed = this._seedPlayerBadges();
    this.savePlayerBadges(seed);
    return seed;
  },

  savePlayerBadges(data) {
    localStorage.setItem('spontix_badges', JSON.stringify(data));
  },

  _seedPlayerBadges() {
    return {
      earned: {
        first_blood:     { date: '2026-03-15' },
        getting_started: { date: '2026-03-15' },
        league_rookie:   { date: '2026-03-16' },
        hot_streak:      { date: '2026-03-22' },
        bold_move:       { date: '2026-04-01' },
        squad_leader:    { date: '2026-04-03' },
        champion:        { date: '2026-04-08' },
        century_club:    { date: '2026-04-09' },
        team_player:     { date: '2026-04-10' },
        early_bird:      { date: '2026-04-11' },
      },
      progress: {
        inferno: 7,
        marathon: 12,
        perfect_game: 0,    // best was 7/8
        sharpshooter: 68,   // current accuracy
        five_k: 1240,
        thousand_club: 142,
        br_veteran: 3,
        br_survivor: 0,
        trivia_master: 2,
        venue_explorer: 1,
        multi_sport: 2,
        night_owl: 0,
        social_player: 0,
      },
    };
  },

  getVenueBadges() {
    const stored = localStorage.getItem('spontix_venue_badges');
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    const seed = this._seedVenueBadges();
    this.saveVenueBadges(seed);
    return seed;
  },

  saveVenueBadges(data) {
    localStorage.setItem('spontix_venue_badges', JSON.stringify(data));
  },

  _seedVenueBadges() {
    return {
      earned: {
        first_event:      { date: '2026-03-20' },
        full_house:       { date: '2026-04-01' },
        question_creator: { date: '2026-04-05' },
        regular_host:     { date: '2026-04-10' },
      },
      progress: {
        crowd_puller: 47,
        weekly_warrior: 2,
        crowd_favourite: 18,
        multi_sport_venue: 2,
        five_star: 4.2,
        engagement_king: 82,
        return_customers: 22,
        tv_master: 1,
        table_pro: 0,
        hundred_events: 12,
        thousand_players: 47,
        community_hub: 2,
      },
    };
  },

  // ── Check & award a player badge ──
  checkAndAwardPlayerBadge(badgeId, currentValue) {
    const badge = this.PLAYER_BADGES[badgeId];
    if (!badge) return false;
    const data = this.getPlayerBadges();
    if (data.earned[badgeId]) return false; // already earned

    data.progress[badgeId] = currentValue;

    if (currentValue >= badge.threshold) {
      data.earned[badgeId] = { date: new Date().toISOString().split('T')[0] };
      this.savePlayerBadges(data);
      // Update player badge count
      const player = this.getPlayer();
      player.badges = Object.keys(data.earned).length;
      this.savePlayer(player);
      return true; // newly earned!
    }
    this.savePlayerBadges(data);
    return false;
  },

  // ── Check & award a venue badge ──
  checkAndAwardVenueBadge(badgeId, currentValue) {
    const badge = this.VENUE_BADGES[badgeId];
    if (!badge) return false;
    const data = this.getVenueBadges();
    if (data.earned[badgeId]) return false;

    data.progress[badgeId] = currentValue;

    if (currentValue >= badge.threshold) {
      data.earned[badgeId] = { date: new Date().toISOString().split('T')[0] };
      this.saveVenueBadges(data);
      return true;
    }
    this.saveVenueBadges(data);
    return false;
  },

  // ── Run all player badge checks after a game result ──
  checkAllPlayerBadges(result) {
    const player = this.getPlayer();
    const totalAnswered = player.totalCorrect + player.totalWrong;
    const overallAccuracy = totalAnswered > 0 ? Math.round(player.totalCorrect / totalAnswered * 100) : 0;
    const badgeData = this.getPlayerBadges();
    const earned = [];

    const checks = {
      first_blood:     player.totalCorrect,
      getting_started: player.gamesPlayed,
      league_rookie:   player.leaguesJoined,
      hot_streak:      player.bestStreak,
      century_club:    totalAnswered,
      thousand_club:   totalAnswered,
      sharpshooter:    overallAccuracy,
      inferno:         player.bestStreak,
      five_k:          player.totalPoints,
      ten_k:           player.totalPoints,
    };

    // Check if this game was perfect
    if (result && result.wrong === 0 && result.correct >= 5) {
      checks.perfect_game = 1;
    }
    // Night owl check
    if (result) {
      const hour = new Date().getHours();
      if (hour >= 0 && hour < 5) checks.night_owl = 1;
    }

    Object.keys(checks).forEach(badgeId => {
      if (!badgeData.earned[badgeId]) {
        const didEarn = this.checkAndAwardPlayerBadge(badgeId, checks[badgeId]);
        if (didEarn) earned.push(badgeId);
      }
    });

    return earned; // array of newly earned badge IDs
  },

  // ── Run all venue badge checks after an event ──
  checkAllVenueBadges() {
    const stats = this.getVenueStats();
    const badgeData = this.getVenueBadges();
    const earned = [];

    const checks = {
      first_event:      stats.eventsHosted,
      regular_host:     stats.eventsHosted,
      hundred_events:   stats.eventsHosted,
      crowd_puller:     stats.totalPlayers || 0,
      thousand_players: stats.totalPlayers || 0,
    };

    Object.keys(checks).forEach(badgeId => {
      if (!badgeData.earned[badgeId]) {
        const didEarn = this.checkAndAwardVenueBadge(badgeId, checks[badgeId]);
        if (didEarn) earned.push(badgeId);
      }
    });

    return earned;
  },

  // ── Get ordered list of all badges (earned first, then locked sorted by progress) ──
  getPlayerBadgeList() {
    const data = this.getPlayerBadges();
    const allBadges = Object.values(this.PLAYER_BADGES);
    const earnedList = [];
    const lockedList = [];

    allBadges.forEach(badge => {
      const e = data.earned[badge.id];
      if (e) {
        earnedList.push({ ...badge, earned: true, earnedDate: e.date, progress: badge.threshold, progressPct: 100 });
      } else {
        const prog = data.progress[badge.id] || 0;
        const pct = Math.min(100, Math.round((prog / badge.threshold) * 100));
        lockedList.push({ ...badge, earned: false, progress: prog, progressPct: pct });
      }
    });

    // Sort earned by date desc, locked by progress desc
    earnedList.sort((a, b) => new Date(b.earnedDate) - new Date(a.earnedDate));
    lockedList.sort((a, b) => b.progressPct - a.progressPct);

    return [...earnedList, ...lockedList];
  },

  getVenueBadgeList() {
    const data = this.getVenueBadges();
    const allBadges = Object.values(this.VENUE_BADGES);
    const earnedList = [];
    const lockedList = [];

    allBadges.forEach(badge => {
      const e = data.earned[badge.id];
      if (e) {
        earnedList.push({ ...badge, earned: true, earnedDate: e.date, progress: badge.threshold, progressPct: 100 });
      } else {
        const prog = data.progress[badge.id] || 0;
        const pct = Math.min(100, Math.round((prog / badge.threshold) * 100));
        lockedList.push({ ...badge, earned: false, progress: prog, progressPct: pct });
      }
    });

    earnedList.sort((a, b) => new Date(b.earnedDate) - new Date(a.earnedDate));
    lockedList.sort((a, b) => b.progressPct - a.progressPct);

    return [...earnedList, ...lockedList];
  },

  // ── Render a single badge card as HTML ──
  renderBadgeCard(badge) {
    const colors = this.BADGE_COLORS[badge.color] || this.BADGE_COLORS.lime;
    const iconSvg = this.BADGE_ICONS[badge.icon] || this.BADGE_ICONS.star;
    const lockedClass = badge.earned ? '' : ' locked';
    const iconBg = badge.earned ? colors.bg : 'rgba(255,255,255,0.05)';
    const iconStroke = badge.earned ? colors.stroke : '#3A3A4A';

    let bottomHtml = '';
    if (badge.earned) {
      const d = new Date(badge.earnedDate);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      bottomHtml = '<div class="badge-earned-date">Earned ' + dateStr + '</div>';
    } else if (badge.progressPct > 0) {
      const fillColor = colors.stroke;
      bottomHtml = '<div class="badge-progress">' +
        '<div class="badge-progress-track"><div class="badge-progress-fill" style="width:' + badge.progressPct + '%; background:' + fillColor + ';"></div></div>' +
        '<div class="badge-progress-label">' + badge.progress + ' / ' + badge.threshold + '</div>' +
        '</div>';
    } else {
      bottomHtml = '<div class="badge-progress-label" style="margin-top:8px;">Not started</div>';
    }

    return '<div class="badge-card' + lockedClass + '">' +
      '<div class="badge-icon" style="background:' + iconBg + ';">' +
        '<svg viewBox="0 0 24 24" stroke="' + iconStroke + '" stroke-linecap="round" stroke-linejoin="round">' + iconSvg + '</svg>' +
      '</div>' +
      '<div class="badge-name">' + badge.name + '</div>' +
      '<div class="badge-desc">' + badge.desc + '</div>' +
      bottomHtml +
    '</div>';
  },

  // ── Render badge mini-pills for venue cards (compact) ──
  renderVenueBadgePills(venueId) {
    // Prefer REAL stored badge data when this venue is the current one
    // (i.e. the user's own registered venue). Falls back to a deterministic
    // hash-based set for the other seed venues so the grid still looks alive.
    const profile = (() => { try { return this.getVenueProfile(); } catch (e) { return null; } })();
    let earnedList = null;
    if (profile && profile.venueName === venueId) {
      const earnedMap = this.getVenueBadges();
      const allDefs = Object.values(this.VENUE_BADGES);
      earnedList = allDefs.filter(b => earnedMap[b.id]);
    }

    const allBadges = Object.values(this.VENUE_BADGES);
    let badgesToShow;
    let earnedCount;
    if (earnedList && earnedList.length > 0) {
      badgesToShow = earnedList;
      earnedCount = earnedList.length;
    } else {
      // Hash-based synthetic fallback for seed venues
      const hash = venueId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      earnedCount = 2 + (hash % 5);
      badgesToShow = [];
      for (let i = 0; i < earnedCount; i++) badgesToShow.push(allBadges[i % allBadges.length]);
    }

    const pills = [];
    for (let i = 0; i < Math.min(badgesToShow.length, 4); i++) {
      const b = badgesToShow[i];
      const colors = this.BADGE_COLORS[b.color] || this.BADGE_COLORS.purple;
      pills.push('<span class="venue-badge-pill" style="background:' + colors.bg + '; color:' + colors.stroke + '; border: 1px solid ' + colors.stroke + '22;">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="' + colors.stroke + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + (this.BADGE_ICONS[b.icon] || '') + '</svg>' +
        b.name + '</span>');
    }
    if (earnedCount > 4) {
      pills.push('<span class="venue-badge-pill more">+' + (earnedCount - 4) + ' more</span>');
    }
    return pills.join('');
  },

  // ── Get seed venue badge data (for the discover page demo) ──
  getSeedVenueBadgeCount(venueName) {
    const hash = venueName.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return 2 + (hash % 5);
  },

  // ══════════════════════════════════════════════════════════
  //  TROPHIES SYSTEM
  //  Trophies are distinct from badges: they represent
  //  concrete competitive wins (league champion, BR winner,
  //  trivia champ, venue tournament winner).
  //  Venues can also create custom trophies for their events.
  // ══════════════════════════════════════════════════════════

  // ── Trophy rarity tiers ──
  TROPHY_RARITY: {
    common:    { label: 'Common',    color: '#8E8E93', glow: 'rgba(142,142,147,0.2)' },
    rare:      { label: 'Rare',      color: '#4ECDC4', glow: 'rgba(78,205,196,0.25)' },
    epic:      { label: 'Epic',      color: '#7C5CFC', glow: 'rgba(124,92,252,0.3)' },
    legendary: { label: 'Legendary', color: '#FFD93D', glow: 'rgba(255,217,61,0.35)' },
  },

  // ── Trophy type definitions (platform-awarded) ──
  TROPHY_TYPES: {
    // League trophies
    league_champion: {
      id: 'league_champion', name: 'League Champion',
      desc: 'Finished 1st place in a league',
      icon: 'trophy-gold', rarity: 'epic', category: 'league',
      repeatable: true,
    },
    league_runner_up: {
      id: 'league_runner_up', name: 'Runner Up',
      desc: 'Finished 2nd place in a league',
      icon: 'trophy-silver', rarity: 'rare', category: 'league',
      repeatable: true,
    },
    league_podium: {
      id: 'league_podium', name: 'On the Podium',
      desc: 'Finished top 3 in a league',
      icon: 'trophy-bronze', rarity: 'common', category: 'league',
      repeatable: true,
    },
    season_champion: {
      id: 'season_champion', name: 'Season Champion',
      desc: 'Won a full season-long league',
      icon: 'crown-gold', rarity: 'legendary', category: 'league',
      repeatable: true,
    },
    undefeated_season: {
      id: 'undefeated_season', name: 'Undefeated',
      desc: 'Finished a season without a single last-place matchday',
      icon: 'shield-star', rarity: 'legendary', category: 'league',
      repeatable: true,
    },

    // Battle Royale trophies
    br_champion: {
      id: 'br_champion', name: 'Battle Royale Champion',
      desc: 'Won a Battle Royale game — last player standing',
      icon: 'skull-crown', rarity: 'epic', category: 'battle-royale',
      repeatable: true,
    },
    br_flawless: {
      id: 'br_flawless', name: 'Flawless Victory',
      desc: 'Won a BR without losing a single life',
      icon: 'diamond', rarity: 'legendary', category: 'battle-royale',
      repeatable: true,
    },
    br_sprint_king: {
      id: 'br_sprint_king', name: 'Sprint King',
      desc: 'Won a Sprint mode Battle Royale',
      icon: 'lightning-bolt', rarity: 'rare', category: 'battle-royale',
      repeatable: true,
    },
    br_final15: {
      id: 'br_final15', name: 'Final 15 Victor',
      desc: 'Won a Final 15 Battle Royale',
      icon: 'fire-trophy', rarity: 'rare', category: 'battle-royale',
      repeatable: true,
    },

    // Trivia trophies
    trivia_1v1_champion: {
      id: 'trivia_1v1_champion', name: '1v1 Duel Champion',
      desc: 'Won a Trivia 1v1 Duel',
      icon: 'swords-cross', rarity: 'common', category: 'trivia',
      repeatable: true,
    },
    trivia_party_winner: {
      id: 'trivia_party_winner', name: 'Party Champion',
      desc: 'Won a Trivia Party Room game',
      icon: 'party-trophy', rarity: 'rare', category: 'trivia',
      repeatable: true,
    },
    trivia_perfect: {
      id: 'trivia_perfect', name: 'Perfect Score',
      desc: '100% accuracy in a trivia game',
      icon: 'star-circle', rarity: 'epic', category: 'trivia',
      repeatable: true,
    },
    trivia_streak_10: {
      id: 'trivia_streak_10', name: 'Unstoppable',
      desc: 'Won 10 trivia games in a row',
      icon: 'flame-gold', rarity: 'legendary', category: 'trivia',
      repeatable: false,
    },

    // Venue trophies (platform-awarded for venue events)
    venue_event_champion: {
      id: 'venue_event_champion', name: 'Venue Night Champion',
      desc: 'Won first place at a venue event',
      icon: 'building-trophy', rarity: 'rare', category: 'venue',
      repeatable: true,
    },
    venue_regular: {
      id: 'venue_regular', name: 'Venue Regular',
      desc: 'Won at the same venue 3 times',
      icon: 'home-star', rarity: 'epic', category: 'venue',
      repeatable: true,
    },

    // Special / milestone trophies
    first_win: {
      id: 'first_win', name: 'First Victory',
      desc: 'Your very first competitive win',
      icon: 'trophy-spark', rarity: 'common', category: 'milestone',
      repeatable: false,
    },
    ten_wins: {
      id: 'ten_wins', name: 'Decade of Wins',
      desc: 'Won 10 competitive events',
      icon: 'trophy-stack', rarity: 'rare', category: 'milestone',
      repeatable: false,
    },
    fifty_wins: {
      id: 'fifty_wins', name: 'Half Century',
      desc: 'Won 50 competitive events',
      icon: 'trophy-gold-glow', rarity: 'epic', category: 'milestone',
      repeatable: false,
    },
    hundred_wins: {
      id: 'hundred_wins', name: 'Centurion',
      desc: 'Won 100 competitive events',
      icon: 'crown-diamond', rarity: 'legendary', category: 'milestone',
      repeatable: false,
    },
  },

  // ── Trophy SVG Icons ──
  TROPHY_ICONS: {
    'trophy-gold':     '<path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22M18 2H6v7a6 6 0 0012 0V2z"/>',
    'trophy-silver':   '<path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18M4 22h16M10 15V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22M14 15V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22M18 2H6v7a6 6 0 0012 0V2z"/><line x1="10" y1="7" x2="14" y2="7"/>',
    'trophy-bronze':   '<path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18M4 22h16M10 15V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22M14 15V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22M18 2H6v7a6 6 0 0012 0V2z"/><circle cx="12" cy="6" r="2"/>',
    'crown-gold':      '<path d="M2 20h20L19 8l-5 6-2-8-2 8-5-6z"/><rect x="2" y="20" width="20" height="2" rx="1"/><circle cx="12" cy="4" r="1.5"/>',
    'shield-star':     '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polygon points="12 8 13.5 11 17 11.5 14.5 13.5 15 17 12 15.5 9 17 9.5 13.5 7 11.5 10.5 11"/>',
    'skull-crown':     '<circle cx="12" cy="12" r="8"/><path d="M8 10h0M16 10h0M9 15c1.5 1 4.5 1 6 0"/><path d="M7 4l2 3M17 4l-2 3M12 2v3"/>',
    'diamond':         '<path d="M2.7 10.3a2.41 2.41 0 000 3.41l7.59 7.59a2.41 2.41 0 003.41 0l7.59-7.59a2.41 2.41 0 000-3.41L13.7 2.71a2.41 2.41 0 00-3.41 0z"/><path d="M12 7v10M7 12h10"/>',
    'lightning-bolt':  '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    'fire-trophy':     '<path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>',
    'swords-cross':    '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4"/><path d="M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4"/>',
    'party-trophy':    '<path d="M5.8 11.3L2 22l10.7-3.8M12 2v3M4.93 4.93l2.12 2.12M2 12h3M19.07 4.93l-2.12 2.12M22 12h-3"/><circle cx="12" cy="12" r="4"/>',
    'star-circle':     '<circle cx="12" cy="12" r="10"/><polygon points="12 6 13.8 9.6 17.8 10.2 15 13 15.6 17 12 15.2 8.4 17 9 13 6.2 10.2 10.2 9.6"/>',
    'flame-gold':      '<path d="M12 2C6.5 7 4 10 4 13a8 8 0 0016 0c0-3-2.5-6-8-11z"/><path d="M10 16a2 2 0 004 0c0-1-1-2-2-3-1 1-2 2-2 3z"/>',
    'building-trophy': '<path d="M3 21h18M5 21V7l8-4 8 4v14"/><rect x="9" y="13" width="6" height="8"/><path d="M12 9v2"/>',
    'home-star':       '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polygon points="12 10 13 13 16 13 13.5 15 14.5 18 12 16 9.5 18 10.5 15 8 13 11 13"/>',
    'trophy-spark':    '<path d="M18 2H6v7a6 6 0 0012 0V2z"/><path d="M4 22h16"/><path d="M10 15V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22M14 15V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M21 5l-2 2M3 5l2 2M12 0v2"/>',
    'trophy-stack':    '<path d="M18 5H6v5a6 6 0 0012 0V5z"/><path d="M4 22h16M10 16v2c0 1-1 2-3 4M14 16v2c0 1 1 2 3 4"/><rect x="8" y="2" width="8" height="3" rx="1"/>',
    'trophy-gold-glow':'<path d="M18 2H6v7a6 6 0 0012 0V2z"/><path d="M4 22h16M10 15V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22M14 15V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><circle cx="12" cy="6" r="2"/><path d="M1 8h3M20 8h3M3 3l2 2M19 3l-2 2"/>',
    'crown-diamond':   '<path d="M2 17h20L19 6l-5 5-2-7-2 7-5-5z"/><rect x="2" y="17" width="20" height="3" rx="1"/><path d="M12 2l1 3h3l-2 2 1 3-3-2-3 2 1-3-2-2h3z"/>',
    // Custom trophy base (for AI-generated)
    'custom':          '<path d="M18 2H6v7a6 6 0 0012 0V2z"/><path d="M4 22h16M10 15v3a2 2 0 01-2 2H7M14 15v3a2 2 0 002 2h1"/><path d="M9 6h6M12 4v5"/>',
  },

  // ═══════════════════════
  //  TROPHY DATA OPERATIONS
  // ═══════════════════════

  getTrophies() {
    const stored = localStorage.getItem(this.KEYS.trophies);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    const seed = this._seedTrophies();
    this.saveTrophies(seed);
    return seed;
  },

  saveTrophies(data) {
    localStorage.setItem(this.KEYS.trophies, JSON.stringify(data));
  },

  _seedTrophies() {
    return [
      {
        id: 'tr_1', type: 'league_champion', date: '2026-04-08',
        context: { leagueName: 'LaLiga Legends 24/25', season: 'Matchday 28', rank: 1, totalPlayers: 8 },
        custom: false,
      },
      {
        id: 'tr_2', type: 'season_champion', date: '2024-05-20',
        context: { leagueName: 'Premier League 23/24', season: 'Full Season', rank: 1, totalPlayers: 12 },
        custom: false,
      },
      {
        id: 'tr_3', type: 'br_champion', date: '2026-03-28',
        context: { mode: 'Full BR', players: 64, match: 'Barcelona vs Real Madrid' },
        custom: false,
      },
      {
        id: 'tr_4', type: 'trivia_1v1_champion', date: '2026-04-05',
        context: { opponent: 'AlexR', score: '8 — 5', category: 'Football' },
        custom: false,
      },
      {
        id: 'tr_5', type: 'league_runner_up', date: '2024-08-15',
        context: { leagueName: 'Euro 2024 Showdown', season: 'Tournament', rank: 2, totalPlayers: 64 },
        custom: false,
      },
      {
        id: 'tr_6', type: 'venue_event_champion', date: '2026-04-12',
        context: { venueName: 'The Penalty Box', eventName: 'El Clásico Night', players: 32 },
        custom: false,
      },
      {
        id: 'tr_7', type: 'first_win', date: '2026-03-15',
        context: { event: 'First ever Spontix win' },
        custom: false,
      },
      // A custom venue-created trophy
      {
        id: 'tr_8', type: 'custom', date: '2026-04-12',
        custom: true,
        customData: {
          name: 'El Clásico King',
          desc: 'Dominated the El Clásico Night at The Penalty Box',
          icon: 'crown-gold',
          rarity: 'epic',
          venueName: 'The Penalty Box',
          category: 'venue',
        },
        context: { venueName: 'The Penalty Box', eventName: 'El Clásico Night' },
      },
    ];
  },

  // ── Award a trophy ──
  //
  // NOTE: In this client-only prototype, trophies are always written to the
  // current-session user's trophy list. When the backend lands, this becomes
  // POST /users/:winnerUserId/trophies and server-side authz verifies that
  // the caller is allowed to award (e.g., the league's creator / event host).
  awardTrophy(type, context) {
    const trophies = this.getTrophies();
    const trophyDef = this.TROPHY_TYPES[type];

    // For non-repeatable trophies, check if already earned
    if (trophyDef && !trophyDef.repeatable) {
      if (trophies.some(t => t.type === type)) return null;
    }

    const trophy = {
      id: 'tr_' + uuid().slice(0, 8),
      type: type,
      recipientUserId: this.Session.getCurrentUserId() || null,
      date: new Date().toISOString().split('T')[0],
      context: context || {},
      custom: false,
    };

    trophies.unshift(trophy);
    this.saveTrophies(trophies);

    // Update player trophy count
    const player = this.getPlayer();
    player.trophies = trophies.length;
    this.savePlayer(player);

    // Check milestone trophies
    const totalWins = trophies.filter(t =>
      ['league_champion','season_champion','br_champion','br_flawless','br_sprint_king','br_final15',
       'trivia_1v1_champion','trivia_party_winner','venue_event_champion'].includes(t.type)
    ).length;
    if (totalWins === 1) this.awardTrophy('first_win', { event: 'First competitive win' });
    if (totalWins === 10) this.awardTrophy('ten_wins', { event: '10 total wins' });
    if (totalWins === 50) this.awardTrophy('fifty_wins', { event: '50 total wins' });
    if (totalWins === 100) this.awardTrophy('hundred_wins', { event: '100 total wins' });

    // Fire notification event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('spontix-trophy-earned', { detail: { trophy } }));
    }

    return trophy;
  },

  // ── Award a custom venue trophy ──
  awardCustomTrophy(customData, context) {
    const trophies = this.getTrophies();
    const trophy = {
      id: 'tr_custom_' + uuid().slice(0, 8),
      type: 'custom',
      recipientUserId: this.Session.getCurrentUserId() || null,
      date: new Date().toISOString().split('T')[0],
      custom: true,
      customData: {
        name: customData.name || 'Custom Trophy',
        desc: customData.desc || 'A unique trophy',
        icon: customData.icon || 'custom',
        rarity: customData.rarity || 'rare',
        venueName: customData.venueName || '',
        venueId: customData.venueId || null,
        category: 'venue',
      },
      context: context || {},
    };

    trophies.unshift(trophy);
    this.saveTrophies(trophies);

    const player = this.getPlayer();
    player.trophies = trophies.length;
    this.savePlayer(player);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('spontix-trophy-earned', { detail: { trophy } }));
    }

    return trophy;
  },

  // ══════════════════════════════════════════════════════════════
  // TROPHY ROUTING — ensures trophies land in the RIGHT player's
  // trophy room, not the league/venue creator's.
  //
  // Backend-ready: routing is keyed on `userId` (immutable UUID),
  // not on `handle` (user-editable display name). Callers that still
  // pass a handle are resolved to an id via getUserByHandle; this
  // keeps legacy call sites working while making the new contract
  // what the backend will implement.
  //
  // On the backend: these become POST /awards/... endpoints that the
  // server authorizes against league.ownerId / event.hostOwnerId,
  // look up the winner by userId, and fan out via push/websocket.
  // ══════════════════════════════════════════════════════════════

  // Resolve a winner to { id, handle } from either shape.
  _resolveWinner(winnerIdOrHandle) {
    if (!winnerIdOrHandle) return null;
    if (typeof winnerIdOrHandle === 'object' && winnerIdOrHandle.id) return winnerIdOrHandle;
    // Looks like a userId (usr_*) — try id first, then fall back to handle lookup
    let user = this.getUserById(winnerIdOrHandle);
    if (!user) user = this.getUserByHandle(winnerIdOrHandle);
    return user;
  },

  // Award league winner based on the trophy configured at league creation.
  //
  // `winner` may be a userId string, a handle string, or a user object.
  // Returns the trophy when the current session IS the winner (trophy
  // was placed in this user's room); returns null + enqueues a remote
  // dispatch when the winner is a different user.
  awardLeagueWinnerTrophy(leagueId, winner) {
    const leagues = this.getLeagues();
    const league = leagues.find(l => l.id === leagueId);
    if (!league || !league.trophy) return null;

    const winnerUser = this._resolveWinner(winner);
    const currentUserId = this.Session.getCurrentUserId();

    if (winnerUser && winnerUser.id !== currentUserId) {
      this._queueRemoteTrophy(winnerUser.id, league.trophy, { leagueName: league.name, leagueId: league.id });
      return null;
    }
    return this._awardConfiguredTrophy(league.trophy, { leagueName: league.name, leagueId: league.id, event: 'League Champion' });
  },

  // Award venue event winner based on the trophy configured for the event.
  awardVenueEventTrophy(eventId, winner, customTrophyOrPresetType) {
    const profile = this.getVenueProfile();
    const venueName = profile ? profile.venueName : '';
    const venueId = profile ? profile.id : null;

    // Resolve trophy: either a custom venue trophy object or a preset type string
    let trophyConfig;
    if (typeof customTrophyOrPresetType === 'object' && customTrophyOrPresetType) {
      trophyConfig = { ...customTrophyOrPresetType, custom: true };
    } else {
      const def = this.TROPHY_TYPES[customTrophyOrPresetType || 'venue_event_champion'];
      if (!def) return null;
      trophyConfig = { type: customTrophyOrPresetType || 'venue_event_champion', name: def.name, desc: def.desc, icon: def.icon, rarity: def.rarity, custom: false };
    }

    const winnerUser = this._resolveWinner(winner);
    const currentUserId = this.Session.getCurrentUserId();

    if (winnerUser && winnerUser.id !== currentUserId) {
      this._queueRemoteTrophy(winnerUser.id, trophyConfig, { venueName, venueId, eventId });
      if (trophyConfig.custom && trophyConfig.id) this._incrementVenueTrophyAwardCount(trophyConfig.id);
      return null;
    }
    if (trophyConfig.custom && trophyConfig.id) this._incrementVenueTrophyAwardCount(trophyConfig.id);
    return this._awardConfiguredTrophy(trophyConfig, { venueName, venueId, eventId, event: trophyConfig.name });
  },

  // Internal: award a trophy whose shape is { type?, name, desc, icon, rarity, custom }
  _awardConfiguredTrophy(trophyConfig, context) {
    if (trophyConfig.custom) {
      return this.awardCustomTrophy({
        name: trophyConfig.name,
        desc: trophyConfig.desc,
        icon: trophyConfig.icon,
        rarity: trophyConfig.rarity,
        venueName: trophyConfig.venueName || (context && context.venueName) || '',
        venueId: trophyConfig.venueId || (context && context.venueId) || null,
      }, context);
    }
    return this.awardTrophy(trophyConfig.type, context);
  },

  // Internal: remote fan-out queue. Persists pending trophies destined
  // for other users so the backend can drain them on launch. Keyed on
  // userId (immutable) — NOT handle (which users can change).
  _queueRemoteTrophy(winnerUserId, trophyConfig, context) {
    const key = 'spontix_remote_trophy_queue';
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    queue.unshift({ winnerUserId, trophy: trophyConfig, context, queuedAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(queue.slice(0, 50)));
  },

  _incrementVenueTrophyAwardCount(customTrophyId) {
    const trophies = this.getVenueCustomTrophies();
    const t = trophies.find(x => x.id === customTrophyId);
    if (t) {
      t.timesAwarded = (t.timesAwarded || 0) + 1;
      this.saveVenueCustomTrophies(trophies);
    }
  },

  // ── Get trophy list with full display data ──
  getTrophyList(filter) {
    const trophies = this.getTrophies();
    let list = trophies.map(t => {
      if (t.custom && t.customData) {
        return {
          ...t,
          name: t.customData.name,
          desc: t.customData.desc,
          icon: t.customData.icon,
          rarity: t.customData.rarity,
          category: t.customData.category || 'venue',
          venueName: t.customData.venueName || '',
        };
      }
      const def = this.TROPHY_TYPES[t.type] || {};
      return {
        ...t,
        name: def.name || t.type,
        desc: def.desc || '',
        icon: def.icon || 'trophy-gold',
        rarity: def.rarity || 'common',
        category: def.category || 'other',
      };
    });

    if (filter && filter !== 'all') {
      list = list.filter(t => t.category === filter);
    }

    return list;
  },

  // ── Count trophies by rarity ──
  getTrophyStats() {
    const trophies = this.getTrophies();
    const stats = { total: trophies.length, common: 0, rare: 0, epic: 0, legendary: 0 };
    trophies.forEach(t => {
      const rarity = t.custom ? (t.customData && t.customData.rarity || 'common') : (this.TROPHY_TYPES[t.type] || {}).rarity || 'common';
      stats[rarity] = (stats[rarity] || 0) + 1;
    });
    return stats;
  },

  // ── Render a trophy card HTML ──
  renderTrophyCard(trophy) {
    const rarity = this.TROPHY_RARITY[trophy.rarity] || this.TROPHY_RARITY.common;
    const iconSvg = this.TROPHY_ICONS[trophy.icon] || this.TROPHY_ICONS['trophy-gold'];
    const d = new Date(trophy.date);
    const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    // Context subtitle
    let subtitle = '';
    if (trophy.context) {
      if (trophy.context.leagueName) subtitle = trophy.context.leagueName;
      else if (trophy.context.venueName) subtitle = trophy.context.venueName;
      else if (trophy.context.mode) subtitle = trophy.context.mode;
      else if (trophy.context.opponent) subtitle = 'vs ' + trophy.context.opponent;
      else if (trophy.context.event) subtitle = trophy.context.event;
    }
    if (trophy.venueName && !subtitle) subtitle = trophy.venueName;

    return '<div class="trophy-card" data-rarity="' + trophy.rarity + '" data-category="' + trophy.category + '">' +
      '<div class="trophy-glow" style="background:' + rarity.glow + ';"></div>' +
      '<div class="trophy-icon" style="background:' + rarity.glow + '; border-color:' + rarity.color + ';">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="' + rarity.color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + iconSvg + '</svg>' +
      '</div>' +
      '<div class="trophy-rarity-tag" style="color:' + rarity.color + '; background:' + rarity.glow + ';">' + rarity.label + '</div>' +
      '<div class="trophy-name">' + trophy.name + '</div>' +
      (subtitle ? '<div class="trophy-subtitle">' + subtitle + '</div>' : '') +
      '<div class="trophy-date">' + dateStr + '</div>' +
      (trophy.custom ? '<div class="trophy-custom-tag">Custom</div>' : '') +
    '</div>';
  },

  // ── Render compact trophy pills for leaderboards/profiles ──
  renderTrophyPills(maxShow) {
    const trophies = this.getTrophies();
    maxShow = maxShow || 3;
    const pills = [];
    trophies.slice(0, maxShow).forEach(t => {
      const def = t.custom ? { rarity: t.customData.rarity, icon: t.customData.icon, name: t.customData.name } :
                             (this.TROPHY_TYPES[t.type] || { rarity: 'common', icon: 'trophy-gold', name: t.type });
      const rarity = this.TROPHY_RARITY[def.rarity] || this.TROPHY_RARITY.common;
      const iconSvg = this.TROPHY_ICONS[def.icon] || this.TROPHY_ICONS['trophy-gold'];
      pills.push('<span class="trophy-pill" title="' + (def.name || '') + '" style="border-color:' + rarity.color + '33;">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="' + rarity.color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + iconSvg + '</svg>' +
      '</span>');
    });
    if (trophies.length > maxShow) {
      pills.push('<span class="trophy-pill trophy-pill-more">+' + (trophies.length - maxShow) + '</span>');
    }
    return pills.join('');
  },

  // ── Custom Trophy Templates (for AI generation) ──
  CUSTOM_TROPHY_TEMPLATES: [
    { name: 'The Dominator', desc: 'Absolute dominance in every round', icon: 'crown-gold', rarity: 'legendary' },
    { name: 'Comeback King', desc: 'Came from behind to claim victory', icon: 'fire-trophy', rarity: 'epic' },
    { name: 'The Regular', desc: 'A familiar face and a consistent winner', icon: 'home-star', rarity: 'rare' },
    { name: 'Speed Demon', desc: 'Fastest average answer time', icon: 'lightning-bolt', rarity: 'epic' },
    { name: 'The Underdog', desc: 'Won despite the lowest pre-game rating', icon: 'shield-star', rarity: 'epic' },
    { name: 'Table Captain', desc: 'Led their table team to victory', icon: 'building-trophy', rarity: 'rare' },
    { name: 'Crowd Pleaser', desc: 'Most cheered player of the night', icon: 'party-trophy', rarity: 'rare' },
    { name: 'The Professor', desc: 'Highest accuracy of the event', icon: 'star-circle', rarity: 'epic' },
    { name: 'Iron Will', desc: 'Never changed an answer — and won', icon: 'shield-star', rarity: 'legendary' },
    { name: 'Hat-Trick Hero', desc: 'Won 3 events in a row', icon: 'crown-gold', rarity: 'legendary' },
  ],

  // ── Generate AI custom trophy (tier-gated) ──
  generateAITrophy(userPrompt, venueName) {
    // Pick a random template as "AI-generated" result
    const templates = this.CUSTOM_TROPHY_TEMPLATES;
    const base = templates[Math.floor(Math.random() * templates.length)];
    return {
      name: userPrompt ? (userPrompt.slice(0, 40)) : base.name,
      desc: base.desc,
      icon: base.icon,
      rarity: base.rarity,
      venueName: venueName || '',
    };
  },

  // ── Venue custom trophies management ──
  getVenueCustomTrophies() {
    const stored = localStorage.getItem(this.KEYS.customTrophies);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    // Seed with some venue-created trophies
    const seed = [
      { id: 'vct_1', name: 'El Clásico King', desc: 'Dominated the El Clásico Night', icon: 'crown-gold', rarity: 'epic', venueName: 'The Penalty Box', createdAt: '2026-04-10', timesAwarded: 3 },
      { id: 'vct_2', name: 'Pub Quiz Master', desc: 'Unbeatable at The Dugout', icon: 'star-circle', rarity: 'rare', venueName: 'The Dugout', createdAt: '2026-04-01', timesAwarded: 5 },
      { id: 'vct_3', name: 'Arena Champion', desc: 'Best player at Arena Bar & Grill', icon: 'building-trophy', rarity: 'rare', venueName: 'Arena Bar & Grill', createdAt: '2026-03-15', timesAwarded: 8 },
    ];
    this.saveVenueCustomTrophies(seed);
    return seed;
  },

  saveVenueCustomTrophies(data) {
    localStorage.setItem(this.KEYS.customTrophies, JSON.stringify(data));
  },

  createVenueCustomTrophy(data) {
    const trophies = this.getVenueCustomTrophies();
    const activeVenue = this.Session.getCurrentVenue();
    const trophy = {
      id: 'vct_' + uuid().slice(0, 8),
      // Authoritative link — survives venue renames and is backend-safe
      venueId: activeVenue ? activeVenue.id : (data.venueId || null),
      createdByUserId: this.Session.getCurrentUserId() || null,
      name: data.name,
      desc: data.desc || '',
      icon: data.icon || 'custom',
      rarity: data.rarity || 'rare',
      venueName: data.venueName || (activeVenue ? activeVenue.venueName : ''),
      createdAt: new Date().toISOString().split('T')[0],
      timesAwarded: 0,
    };
    trophies.unshift(trophy);
    this.saveVenueCustomTrophies(trophies);
    return trophy;
  },

  // ══════════════════════════════════════════════════════════════
  // PREMADE TITLE PHOTO LIBRARY
  //
  // Stock photos available to every venue tier (including Free).
  // These are pre-baked SVG illustrations kept inline so the app
  // works offline and in the sandboxed demo environment.
  // ══════════════════════════════════════════════════════════════

  PREMADE_PHOTOS: [
    {
      id: 'preset_sportsbar_neon',
      label: 'Sports Bar · Neon',
      dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2E1065"/><stop offset="1" stop-color="#EC4899"/></linearGradient></defs>' +
        '<rect width="400" height="220" fill="url(#g)"/>' +
        '<circle cx="80" cy="60" r="30" fill="#F472B6" opacity="0.55"/>' +
        '<circle cx="330" cy="170" r="45" fill="#A8E10C" opacity="0.35"/>' +
        '<rect x="60" y="150" width="80" height="40" rx="4" fill="#1A1A2E" opacity="0.5"/>' +
        '<rect x="150" y="150" width="80" height="40" rx="4" fill="#1A1A2E" opacity="0.5"/>' +
        '<rect x="240" y="150" width="80" height="40" rx="4" fill="#1A1A2E" opacity="0.5"/>' +
        '</svg>'
      )
    },
    {
      id: 'preset_pub_cosy',
      label: 'Pub · Cosy',
      dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#78350F"/><stop offset="1" stop-color="#431407"/></linearGradient></defs>' +
        '<rect width="400" height="220" fill="url(#g)"/>' +
        '<rect x="40" y="40" width="50" height="80" rx="4" fill="#FBBF24" opacity="0.6"/>' +
        '<rect x="100" y="40" width="50" height="80" rx="4" fill="#FBBF24" opacity="0.5"/>' +
        '<rect x="0" y="150" width="400" height="70" fill="#1C1917" opacity="0.55"/>' +
        '<circle cx="280" cy="110" r="25" fill="#FBBF24" opacity="0.7"/>' +
        '</svg>'
      )
    },
    {
      id: 'preset_stadium',
      label: 'Stadium · Lights',
      dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0C4A6E"/><stop offset="1" stop-color="#064E3B"/></linearGradient></defs>' +
        '<rect width="400" height="220" fill="url(#g)"/>' +
        '<ellipse cx="200" cy="200" rx="180" ry="40" fill="#14532D"/>' +
        '<rect x="190" y="140" width="20" height="80" fill="#F1F5F9"/>' +
        '<circle cx="100" cy="50" r="6" fill="#FEF08A"/>' +
        '<circle cx="200" cy="40" r="6" fill="#FEF08A"/>' +
        '<circle cx="300" cy="50" r="6" fill="#FEF08A"/>' +
        '<rect x="160" y="170" width="80" height="30" rx="2" fill="none" stroke="#F1F5F9" stroke-width="1.5"/>' +
        '</svg>'
      )
    },
    {
      id: 'preset_lounge_teal',
      label: 'Lounge · Teal',
      dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#134E4A"/><stop offset="1" stop-color="#0F172A"/></linearGradient></defs>' +
        '<rect width="400" height="220" fill="url(#g)"/>' +
        '<circle cx="340" cy="70" r="60" fill="#4ECDC4" opacity="0.2"/>' +
        '<rect x="50" y="120" width="110" height="50" rx="25" fill="#4ECDC4" opacity="0.35"/>' +
        '<rect x="180" y="120" width="110" height="50" rx="25" fill="#4ECDC4" opacity="0.25"/>' +
        '</svg>'
      )
    },
    {
      id: 'preset_rooftop',
      label: 'Rooftop · Sunset',
      dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F59E0B"/><stop offset="0.5" stop-color="#DC2626"/><stop offset="1" stop-color="#4C1D95"/></linearGradient></defs>' +
        '<rect width="400" height="220" fill="url(#g)"/>' +
        '<circle cx="320" cy="80" r="35" fill="#FEF3C7" opacity="0.9"/>' +
        '<rect x="0" y="160" width="400" height="60" fill="#1C1917"/>' +
        '<rect x="30" y="120" width="20" height="50" fill="#1C1917"/>' +
        '<rect x="60" y="100" width="20" height="70" fill="#1C1917"/>' +
        '<rect x="90" y="130" width="20" height="40" fill="#1C1917"/>' +
        '</svg>'
      )
    },
    {
      id: 'preset_gameday_green',
      label: 'Gameday · Pitch',
      dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#166534"/><stop offset="1" stop-color="#052E16"/></linearGradient></defs>' +
        '<rect width="400" height="220" fill="url(#g)"/>' +
        '<rect x="40" y="40" width="320" height="140" fill="none" stroke="#F1F5F9" stroke-width="2" opacity="0.7"/>' +
        '<line x1="200" y1="40" x2="200" y2="180" stroke="#F1F5F9" stroke-width="2" opacity="0.7"/>' +
        '<circle cx="200" cy="110" r="30" fill="none" stroke="#F1F5F9" stroke-width="2" opacity="0.7"/>' +
        '<circle cx="200" cy="110" r="5" fill="#F1F5F9" opacity="0.9"/>' +
        '</svg>'
      )
    },
  ],

  getPremadePhotos() { return this.PREMADE_PHOTOS; },

  // ── Player Avatar Colors ──
  // Used in the "Color" tab of the avatar picker. Each entry defines a gradient
  // background for the player's avatar circle and the text color for the initial.
  PLAYER_AVATAR_COLORS: [
    { id: 'color_lime',    label: 'Lime',    gradient: 'linear-gradient(135deg, #A8E10C, #4ECDC4)', textColor: 'var(--navy)' },
    { id: 'color_purple',  label: 'Purple',  gradient: 'linear-gradient(135deg, #7C5CFC, #A855F7)', textColor: '#fff' },
    { id: 'color_coral',   label: 'Coral',   gradient: 'linear-gradient(135deg, #FF6B6B, #FF8E53)', textColor: 'var(--navy)' },
    { id: 'color_teal',    label: 'Teal',    gradient: 'linear-gradient(135deg, #4ECDC4, #2196F3)', textColor: 'var(--navy)' },
    { id: 'color_gold',    label: 'Gold',    gradient: 'linear-gradient(135deg, #FFD93D, #F97316)', textColor: 'var(--navy)' },
    { id: 'color_pink',    label: 'Pink',    gradient: 'linear-gradient(135deg, #EC4899, #8B5CF6)', textColor: '#fff' },
    { id: 'color_blue',    label: 'Blue',    gradient: 'linear-gradient(135deg, #3B82F6, #1E3A8A)', textColor: '#fff' },
    { id: 'color_orange',  label: 'Orange',  gradient: 'linear-gradient(135deg, #F97316, #EF4444)', textColor: 'var(--navy)' },
  ],

  // ── Player Preset Avatars ──
  // Used in the "Presets" tab. Curated gradient vibes — the player's initial
  // is displayed over the gradient at the center of the circle.
  PLAYER_PRESET_AVATARS: [
    { id: 'preset_galaxy',   label: 'Galaxy',   gradient: 'linear-gradient(135deg, #0f0c29, #302b63, #7C5CFC)', textColor: '#fff' },
    { id: 'preset_sunset',   label: 'Sunset',   gradient: 'linear-gradient(135deg, #F59E0B, #EF4444, #7C3AED)', textColor: '#fff' },
    { id: 'preset_ocean',    label: 'Ocean',    gradient: 'linear-gradient(135deg, #4ECDC4, #2196F3, #0d47a1)', textColor: '#fff' },
    { id: 'preset_fire',     label: 'Fire',     gradient: 'linear-gradient(135deg, #FFD93D, #FF6B6B, #EF4444)', textColor: 'var(--navy)' },
    { id: 'preset_forest',   label: 'Forest',   gradient: 'linear-gradient(135deg, #A8E10C, #22c55e, #166534)', textColor: 'var(--navy)' },
    { id: 'preset_midnight', label: 'Midnight', gradient: 'linear-gradient(135deg, #0f172a, #1e293b, #475569)', textColor: '#fff' },
    { id: 'preset_rose',     label: 'Rose',     gradient: 'linear-gradient(135deg, #fda4af, #EC4899, #9d174d)', textColor: '#fff' },
    { id: 'preset_aurora',   label: 'Aurora',   gradient: 'linear-gradient(135deg, #4ECDC4, #A8E10C, #7C5CFC)', textColor: 'var(--navy)' },
  ],

  // ── Player Avatar Style Helper ──
  // Returns a style descriptor for the player's current avatar choice.
  // Result shape: { type: 'image'|'gradient', src?, gradient?, textColor?, initial }
  getPlayerAvatarStyle(player) {
    var type    = (player && player.profilePhotoType) || 'color';
    var id      = (player && player.profilePhotoId)   || 'color_lime';
    var url     = (player && player.profilePhotoUrl)  || null;
    var initial = player ? ((player.name || player.avatar || 'P')[0].toUpperCase()) : 'P';

    if (type === 'custom' && url) {
      return { type: 'image', src: url, initial: initial };
    }
    if (type === 'preset') {
      var preset = this.PLAYER_PRESET_AVATARS.find(function (p) { return p.id === id; });
      if (preset) return { type: 'gradient', gradient: preset.gradient, textColor: preset.textColor, initial: initial };
    }
    // Color (default)
    var color = this.PLAYER_AVATAR_COLORS.find(function (c) { return c.id === id; }) || this.PLAYER_AVATAR_COLORS[0];
    return { type: 'gradient', gradient: color.gradient, textColor: color.textColor || 'var(--navy)', initial: initial };
  },

  // ── Universal page-wide avatar applicator ──
  // Add class "av-self" to any element that should show the current user's avatar.
  // Add class "av-user" + data-name="XY" for other players (deterministic gradient).
  // Call once after DOM is ready; auto-called on load + spontix-profile-refreshed.
  applyAvatarsToPage() {
    if (typeof document === 'undefined') return;
    var self = this;
    var player = this.getPlayer();
    document.querySelectorAll('.av-self').forEach(function(el) {
      self._applyAvatarToEl(el, player);
    });
    document.querySelectorAll('.av-user[data-name]').forEach(function(el) {
      self._applyNameGradientToEl(el, el.getAttribute('data-name') || el.textContent || '?');
    });
  },

  // Applies the current user's avatar style to a DOM element.
  _applyAvatarToEl(el, player) {
    var style = this.getPlayerAvatarStyle(player);
    if (style.type === 'image') {
      el.style.background  = 'none';
      el.style.overflow    = 'hidden';
      el.style.padding     = '0';
      el.innerHTML = '<img src="' + style.src + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" alt="' + style.initial + '" />';
    } else {
      el.style.background = style.gradient;
      el.style.color      = style.textColor || 'var(--navy)';
      // Only replace text content if it looks like a stale initial (≤2 chars, no image child)
      if (!el.querySelector('img') && el.textContent.trim().length <= 3) {
        el.textContent = style.initial;
      }
    }
  },

  // Applies a deterministic gradient to a simulated-player avatar element.
  _applyNameGradientToEl(el, name) {
    var opts = [
      { g: 'linear-gradient(135deg,#7C5CFC,#A855F7)', c: '#fff' },
      { g: 'linear-gradient(135deg,#4ECDC4,#2196F3)', c: 'var(--navy)' },
      { g: 'linear-gradient(135deg,#FF6B6B,#FF8E53)', c: 'var(--navy)' },
      { g: 'linear-gradient(135deg,#FFD93D,#F97316)', c: 'var(--navy)' },
      { g: 'linear-gradient(135deg,#EC4899,#8B5CF6)', c: '#fff' },
      { g: 'linear-gradient(135deg,#3B82F6,#1E3A8A)', c: '#fff' },
      { g: 'linear-gradient(135deg,#A8E10C,#22c55e)', c: 'var(--navy)' },
      { g: 'linear-gradient(135deg,#F59E0B,#EF4444)', c: '#fff' },
    ];
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    var opt = opts[Math.abs(hash) % opts.length];
    el.style.background = opt.g;
    el.style.color      = opt.c;
  },

  // Renders an avatar element as an HTML string at the given pixel size.
  // Use innerHTML to inject — includes sizing, border-radius, etc.
  renderPlayerAvatarEl(player, sizePx) {
    var style = this.getPlayerAvatarStyle(player);
    var size = sizePx || 80;
    if (style.type === 'image') {
      return '<img src="' + style.src + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;flex-shrink:0;display:block;" alt="' + style.initial + '" />';
    }
    var fontSize = Math.round(size * 0.38);
    return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + style.gradient + ';display:flex;align-items:center;justify-content:center;font-size:' + fontSize + 'px;font-weight:900;color:' + (style.textColor || 'var(--navy)') + ';flex-shrink:0;">' + style.initial + '</div>';
  },

  // ══════════════════════════════════════════════════════════════
  // VENUE FACILITY PHOTOS
  //
  // Data shape (per venueName):
  //   { photos: [{ id, dataUrl, uploadedAt, isPreset }], titlePhotoId, useTitlePhoto }
  //
  // Photos are stored as base64 data URLs. localStorage has ~5MB limit,
  // so we downscale client-side before saving (see venue-dashboard.html).
  // Tier gating (enforced here + in UI):
  //   • venue-starter → can only pick from PREMADE_PHOTOS
  //   • venue-pro/elite → can upload custom photos too
  // ══════════════════════════════════════════════════════════════

  // Internal: one-time migration from name-keyed to venueId-keyed storage.
  // Runs on first read; no-op thereafter. Safe to remove after ~6 weeks
  // once all local clients have upgraded.
  _migrateVenuePhotosToVenueId(all) {
    let migrated = false;
    const result = {};
    Object.keys(all).forEach((key) => {
      if (key.indexOf('ven_') === 0) {
        // Already a venueId
        result[key] = all[key];
      } else {
        // Legacy: key is a venue name — map to venueId
        const id = this.getVenueIdByName(key);
        if (id) {
          result[id] = all[key];
          migrated = true;
        } else {
          // Orphaned — preserve under the old key so we don't silently lose data
          result[key] = all[key];
        }
      }
    });
    if (migrated) {
      try { localStorage.setItem(this.KEYS.venuePhotos, JSON.stringify(result)); } catch (e) {}
    }
    return result;
  },

  _getAllVenuePhotos() {
    const stored = localStorage.getItem(this.KEYS.venuePhotos);
    if (stored) {
      try { return this._migrateVenuePhotosToVenueId(JSON.parse(stored)); } catch (e) {}
    }
    return {};
  },

  _saveAllVenuePhotos(all) {
    try {
      localStorage.setItem(this.KEYS.venuePhotos, JSON.stringify(all));
      return true;
    } catch (e) {
      console.warn('Venue photo storage full:', e);
      return false;
    }
  },

  // Resolves either a venueId or a venue name to a venueId. Legacy callers
  // still pass names; new code should pass venueId directly.
  _resolveVenueKey(venueIdOrName) {
    if (!venueIdOrName) return null;
    if (typeof venueIdOrName === 'string' && venueIdOrName.indexOf('ven_') === 0) return venueIdOrName;
    return this.getVenueIdByName(venueIdOrName);
  },

  // All public photo accessors accept either venueId (preferred) or
  // venue name (legacy). Internally everything is venueId-keyed.
  getVenuePhotoConfig(venueIdOrName) {
    const venueId = this._resolveVenueKey(venueIdOrName);
    if (!venueId) return { photos: [], titlePhotoId: null, useTitlePhoto: false };
    const all = this._getAllVenuePhotos();
    return all[venueId] || { photos: [], titlePhotoId: null, useTitlePhoto: false };
  },

  addVenuePhoto(venueIdOrName, dataUrl, opts) {
    opts = opts || {};
    const venueId = this._resolveVenueKey(venueIdOrName);
    if (!venueId) return { error: 'not-found' };
    const tier = opts.tier || localStorage.getItem(this.KEYS.tier) || 'venue-starter';
    const limits = this.TIER_LIMITS[tier] || this.TIER_LIMITS['venue-starter'];

    if (!limits.photoCustomUpload) {
      return { error: 'tier', requiredTier: 'venue-pro' };
    }

    const all = this._getAllVenuePhotos();
    const config = all[venueId] || { photos: [], titlePhotoId: null, useTitlePhoto: false };

    const customCount = config.photos.filter(p => !p.isPreset).length;
    if (limits.photoMaxCustom !== Infinity && customCount >= limits.photoMaxCustom) {
      return { error: 'limit', max: limits.photoMaxCustom, requiredTier: 'venue-elite' };
    }

    const photo = {
      id: 'ph_' + uuid().slice(0, 8),
      dataUrl,
      uploadedAt: new Date().toISOString(),
      isPreset: false,
    };
    config.photos.unshift(photo);
    if (!config.titlePhotoId) config.titlePhotoId = photo.id;
    all[venueId] = config;
    const saved = this._saveAllVenuePhotos(all);
    return saved ? photo : { error: 'storage' };
  },

  selectPresetPhoto(venueIdOrName, presetId) {
    const venueId = this._resolveVenueKey(venueIdOrName);
    if (!venueId) return null;
    const preset = this.PREMADE_PHOTOS.find(p => p.id === presetId);
    if (!preset) return null;

    const all = this._getAllVenuePhotos();
    const config = all[venueId] || { photos: [], titlePhotoId: null, useTitlePhoto: false };

    let existing = config.photos.find(p => p.isPreset && p.presetId === presetId);
    if (!existing) {
      existing = {
        id: 'preset_' + presetId + '_' + uuid().slice(0, 6),
        dataUrl: preset.dataUrl,
        uploadedAt: new Date().toISOString(),
        isPreset: true,
        presetId: presetId,
        label: preset.label,
      };
      config.photos.unshift(existing);
    }
    config.titlePhotoId = existing.id;
    config.useTitlePhoto = true;
    all[venueId] = config;
    this._saveAllVenuePhotos(all);
    return existing;
  },

  removeVenuePhoto(venueIdOrName, photoId) {
    const venueId = this._resolveVenueKey(venueIdOrName);
    if (!venueId) return;
    const all = this._getAllVenuePhotos();
    const config = all[venueId];
    if (!config) return;
    config.photos = config.photos.filter(p => p.id !== photoId);
    if (config.titlePhotoId === photoId) {
      config.titlePhotoId = config.photos[0] ? config.photos[0].id : null;
      if (!config.titlePhotoId) config.useTitlePhoto = false;
    }
    all[venueId] = config;
    this._saveAllVenuePhotos(all);
  },

  setVenueTitlePhoto(venueIdOrName, photoId) {
    const venueId = this._resolveVenueKey(venueIdOrName);
    if (!venueId) return;
    const all = this._getAllVenuePhotos();
    const config = all[venueId] || { photos: [], titlePhotoId: null, useTitlePhoto: false };
    config.titlePhotoId = photoId;
    all[venueId] = config;
    this._saveAllVenuePhotos(all);
  },

  setVenueUseTitlePhoto(venueIdOrName, useIt) {
    const venueId = this._resolveVenueKey(venueIdOrName);
    if (!venueId) return;
    const all = this._getAllVenuePhotos();
    const config = all[venueId] || { photos: [], titlePhotoId: null, useTitlePhoto: false };
    config.useTitlePhoto = !!useIt;
    all[venueId] = config;
    this._saveAllVenuePhotos(all);
  },

  // Returns a CSS background string for the venue card header:
  // either a url(data:...) if title photo is set AND enabled, else null.
  // Accepts venueId (preferred) or legacy venue name.
  getVenueTitlePhotoUrl(venueIdOrName) {
    const config = this.getVenuePhotoConfig(venueIdOrName);
    if (!config.useTitlePhoto || !config.titlePhotoId) return null;
    const photo = config.photos.find(p => p.id === config.titlePhotoId);
    return photo ? photo.dataUrl : null;
  },
};

// ══════════════════════════════════════════════════════════════════════
// SPONTIX STORE — ASYNC INTERFACE
//
// Every public method of SpontixStore is also exposed via SpontixStoreAsync,
// returning a Promise. New code (and code being migrated to the backend)
// should call `await SpontixStoreAsync.getX()` instead of `SpontixStore.getX()`.
//
// Today this is just a thin Promise wrapper around the synchronous
// localStorage implementation — both calls return the same data, just
// through different shapes. When the backend lands:
//
//   1. SpontixStoreAsync internals are rewritten to issue fetch() calls.
//   2. Sync SpontixStore.* paths are deleted (or kept as a read-only
//      offline cache, depending on app architecture).
//   3. Pages that already call SpontixStoreAsync.* keep working unchanged.
//
// The wrapper preserves `this` so methods using `this.getLeagues()` etc.
// internally still resolve correctly. Errors are surfaced as rejections.
// ══════════════════════════════════════════════════════════════════════

const SpontixStoreAsync = (function buildAsyncWrapper() {
  const wrapper = {};
  // Pass through nested namespaces (Session, KEYS, TIER_LIMITS, etc.) by reference
  // so callers can still read `SpontixStoreAsync.Session.getCurrentUserId()`
  // synchronously when they need the session id without a Promise.
  ['KEYS', 'TIER_LIMITS', 'TROPHY_TYPES', 'TROPHY_RARITY', 'TROPHY_ICONS',
   'PLAYER_BADGES', 'VENUE_BADGES', 'BADGE_ICONS', 'BADGE_COLORS',
   'PREMADE_PHOTOS', 'CUSTOM_TROPHY_TEMPLATES', 'DEFAULT_VENUE_NAME', 'Session',
   'PLAYER_AVATAR_COLORS', 'PLAYER_PRESET_AVATARS',
  ].forEach(ns => { if (ns in SpontixStore) wrapper[ns] = SpontixStore[ns]; });

  // Wrap every function-valued property of SpontixStore in a Promise-returning version.
  Object.keys(SpontixStore).forEach(function(key) {
    const fn = SpontixStore[key];
    if (typeof fn !== 'function') return;
    if (key.charAt(0) === '_') return; // skip internals (still accessible via SpontixStore directly)

    wrapper[key] = function(...args) {
      // Use microtask so callers always see consistent async behavior,
      // even though the underlying call is synchronous today. This catches
      // bugs where code accidentally assumed sync semantics from an async
      // call site — they'll surface now, not later when the real backend
      // lands and latency is real.
      return new Promise((resolve, reject) => {
        try {
          const result = fn.apply(SpontixStore, args);
          // Already a promise? (e.g. future async helpers) — just chain.
          if (result && typeof result.then === 'function') {
            result.then(resolve, reject);
          } else {
            resolve(result);
          }
        } catch (err) {
          reject(err);
        }
      });
    };
  });

  return wrapper;
})();

// ══════════════════════════════════════════════════════════════════════
// BACKEND PORTING LAYER — Venues domain
//
// The rest of the app uses the sync SpontixStore API. To keep it working
// while data migrates to Postgres, we maintain a localStorage-backed
// cache that an async Supabase fetch populates on page load and after
// every write. Call sites that want live data can await
// `SpontixStoreAsync.getVenues()` directly.
//
// Naming convention:
//   Database columns are snake_case (venue_name, owner_id).
//   Client objects are camelCase (venueName, ownerId).
//   `_mapVenueFromDb` / `_mapVenueToDb` handle the conversion.
// ══════════════════════════════════════════════════════════════════════

SpontixStore._mapVenueFromDb = function (row) {
  if (!row) return null;
  return {
    id:          row.id,
    ownerId:     row.owner_id,
    venueName:   row.venue_name,
    city:        row.city,
    country:     row.country,
    type:        row.type,
    hours:       row.hours,
    capacity:    row.capacity,
    address:     row.address,
    lat:         row.lat,
    lng:         row.lng,
    sports:      row.sports || [],
    description: row.description,
    color:       row.color,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
};

SpontixStore._mapVenueToDb = function (v) {
  const out = {};
  if (v.id !== undefined)          out.id = v.id;
  if (v.ownerId !== undefined)     out.owner_id = v.ownerId;
  if (v.venueName !== undefined)   out.venue_name = v.venueName;
  if (v.city !== undefined)        out.city = v.city;
  if (v.country !== undefined)     out.country = v.country;
  if (v.type !== undefined)        out.type = v.type;
  if (v.hours !== undefined)       out.hours = v.hours;
  if (v.capacity !== undefined)    out.capacity = v.capacity;
  if (v.address !== undefined)     out.address = v.address;
  if (v.lat !== undefined)         out.lat = v.lat;
  if (v.lng !== undefined)         out.lng = v.lng;
  if (v.sports !== undefined)      out.sports = v.sports;
  if (v.description !== undefined) out.description = v.description;
  if (v.color !== undefined)       out.color = v.color;
  return out;
};

// ── Override the async venue methods to hit Supabase ──
// These also refresh the localStorage cache so the sync API sees fresh data.
SpontixStoreAsync.getVenues = async function () {
  if (typeof window === 'undefined' || !window.sb) {
    // Supabase not yet loaded — fall back to cached/seed data
    return SpontixStore.getVenues();
  }
  const { data, error } = await window.sb
    .from('venues')
    .select('*')
    .order('venue_name');
  if (error) {
    console.warn('[SpontixStoreAsync.getVenues] Supabase error, falling back to cache:', error);
    return SpontixStore.getVenues();
  }
  const venues = data.map(SpontixStore._mapVenueFromDb);
  // Update the localStorage cache so sync reads see the same data
  localStorage.setItem(SpontixStore.KEYS.venues, JSON.stringify(venues));
  return venues;
};

SpontixStoreAsync.getVenueById = async function (venueId) {
  if (typeof window === 'undefined' || !window.sb) return SpontixStore.getVenueById(venueId);
  const { data, error } = await window.sb.from('venues').select('*').eq('id', venueId).maybeSingle();
  if (error) {
    console.warn('[SpontixStoreAsync.getVenueById] Supabase error:', error);
    return SpontixStore.getVenueById(venueId);
  }
  return SpontixStore._mapVenueFromDb(data);
};

SpontixStoreAsync.getVenuesByOwner = async function (ownerId) {
  const uid = ownerId || (SpontixStore.Session && SpontixStore.Session.getCurrentUserId());
  if (!uid) return [];
  if (typeof window === 'undefined' || !window.sb) return SpontixStore.getVenuesByOwner(uid);
  const { data, error } = await window.sb.from('venues').select('*').eq('owner_id', uid);
  if (error) {
    console.warn('[SpontixStoreAsync.getVenuesByOwner] Supabase error:', error);
    return SpontixStore.getVenuesByOwner(uid);
  }
  return (data || []).map(SpontixStore._mapVenueFromDb);
};

SpontixStoreAsync.createVenue = async function (data, ownerId) {
  const uid = ownerId || (SpontixStore.Session && SpontixStore.Session.getCurrentUserId());
  if (!uid) return { ok: false, error: 'no-session' };
  if (typeof window === 'undefined' || !window.sb) {
    // Offline / SDK not ready — fall back to the local-only create
    const v = SpontixStore.createVenue(data, uid);
    return { ok: true, data: v };
  }
  const row = SpontixStore._mapVenueToDb({ ...data, ownerId: uid });
  const { data: inserted, error } = await window.sb.from('venues').insert(row).select().single();
  if (error) return { ok: false, error: error.message };
  // Refresh the cache so the sync API picks up the new venue
  await SpontixStoreAsync.getVenues();
  return { ok: true, data: SpontixStore._mapVenueFromDb(inserted) };
};

SpontixStoreAsync.updateVenue = async function (venueId, patch, actorUserId) {
  const actor = actorUserId || (SpontixStore.Session && SpontixStore.Session.getCurrentUserId());
  if (!actor) return { ok: false, error: 'no-session' };
  if (typeof window === 'undefined' || !window.sb) {
    const result = SpontixStore.updateVenue(venueId, patch, actor);
    return result && !result.error ? { ok: true, data: result } : { ok: false, error: result && result.error };
  }
  // RLS on the venues table enforces that only the owner can update — we
  // don't need an additional client-side authz check, but we still send
  // the actor id for audit/logging purposes in the future.
  const { data: updated, error } = await window.sb
    .from('venues')
    .update(SpontixStore._mapVenueToDb(patch))
    .eq('id', venueId)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  await SpontixStoreAsync.getVenues();
  return { ok: true, data: SpontixStore._mapVenueFromDb(updated) };
};

// ══════════════════════════════════════════════════════════════════════
// LEAGUES — Supabase mapping & async overrides
// ══════════════════════════════════════════════════════════════════════
//   Database columns are snake_case (owner_id, max_members).
//   Client objects are camelCase (ownerId, maxMembers).
//   `_mapLeagueFromDb` / `_mapLeagueToDb` handle the conversion.
//   league_members is a separate join table — membership data is fetched
//   alongside leagues and merged into the client object.
// ══════════════════════════════════════════════════════════════════════

SpontixStore._mapLeagueFromDb = function (row, memberUserIds) {
  if (!row) return null;
  return {
    id:             row.id,
    ownerId:        row.owner_id,
    name:           row.name,
    sport:          row.sport        || 'Football',
    region:         row.region       || 'Europe',
    type:           row.type         || 'public',
    mode:           row.mode         || 'individual',
    team:           row.team         || null,
    members:        (memberUserIds || []).length + 1,  // +1 for owner (implicit member)
    maxMembers:     row.max_members  || 50,
    memberUserIds:  memberUserIds    || [],
    status:         row.status       || 'active',
    stage:          row.stage        || 'Matchday 1',
    trophy:         row.trophy       || null,
    joinPassword:   row.join_password || null,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
    // AI / sports config (migration 002)
    scope:               row.scope                || 'full_league',
    scopedTeamId:        row.scoped_team_id       || null,
    scopedTeamName:      row.scoped_team_name     || null,
    apiSportsLeagueId:   row.api_sports_league_id || null,
    apiSportsTeamId:     row.api_sports_team_id   || null,
    apiSportsSeason:     row.api_sports_season    || null,
    leagueStartDate:     row.league_start_date    || null,
    leagueEndDate:       row.league_end_date      || null,
    aiQuestionsEnabled:  row.ai_questions_enabled || false,
    aiWeeklyQuota:       row.ai_weekly_quota      || null,
    aiTotalQuota:        row.ai_total_quota       || null,
  };
};

SpontixStore._mapLeagueToDb = function (l) {
  const out = {};
  if (l.ownerId !== undefined)    out.owner_id    = l.ownerId;
  if (l.name !== undefined)       out.name        = l.name;
  if (l.sport !== undefined)      out.sport       = l.sport;
  if (l.region !== undefined)     out.region      = l.region;
  if (l.type !== undefined)       out.type        = l.type;
  if (l.mode !== undefined)       out.mode        = l.mode;
  if (l.team !== undefined)       out.team        = l.team;
  if (l.maxMembers !== undefined) out.max_members = l.maxMembers;
  if (l.status !== undefined)     out.status      = l.status;
  if (l.stage !== undefined)      out.stage       = l.stage;
  if (l.trophy !== undefined)     out.trophy      = l.trophy;
  if (l.joinPassword !== undefined) out.join_password = l.joinPassword;
  // AI / sports config (camelCase input, snake_case output)
  if (l.scope !== undefined)               out.scope                = l.scope;
  if (l.scopedTeamId !== undefined)        out.scoped_team_id       = l.scopedTeamId;
  if (l.scopedTeamName !== undefined)      out.scoped_team_name     = l.scopedTeamName;
  if (l.apiSportsLeagueId !== undefined)   out.api_sports_league_id = l.apiSportsLeagueId;
  if (l.apiSportsTeamId !== undefined)     out.api_sports_team_id   = l.apiSportsTeamId;
  if (l.apiSportsSeason !== undefined)     out.api_sports_season    = l.apiSportsSeason;
  if (l.leagueStartDate !== undefined)     out.league_start_date    = l.leagueStartDate;
  if (l.leagueEndDate !== undefined)       out.league_end_date      = l.leagueEndDate;
  if (l.aiQuestionsEnabled !== undefined)  out.ai_questions_enabled = l.aiQuestionsEnabled;
  if (l.aiWeeklyQuota !== undefined)       out.ai_weekly_quota      = l.aiWeeklyQuota;
  if (l.aiTotalQuota !== undefined)        out.ai_total_quota       = l.aiTotalQuota;
  return out;
};

// ── Override the async league methods to hit Supabase ──

SpontixStoreAsync.getLeagues = async function () {
  if (typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getLeagues();
  }
  // 1. Fetch all leagues
  const { data: leagueRows, error } = await window.sb
    .from('leagues')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[SpontixStoreAsync.getLeagues] Supabase error, falling back:', error);
    return SpontixStore.getLeagues();
  }
  // 2. Fetch all league_members rows in one go
  const leagueIds = leagueRows.map(r => r.id);
  let memberMap = {};  // league_id → [user_id, ...]
  if (leagueIds.length > 0) {
    const { data: memberRows, error: mErr } = await window.sb
      .from('league_members')
      .select('league_id, user_id')
      .in('league_id', leagueIds);
    if (!mErr && memberRows) {
      memberRows.forEach(function (m) {
        if (!memberMap[m.league_id]) memberMap[m.league_id] = [];
        memberMap[m.league_id].push(m.user_id);
      });
    }
  }
  // 3. Map to client shape + decorate isOwner/isMember for the current user
  const uid = SpontixStore.Session.getCurrentUserId();
  const leagues = leagueRows.map(function (row) {
    const mIds = memberMap[row.id] || [];
    const league = SpontixStore._mapLeagueFromDb(row, mIds);
    league.isOwner  = !!uid && league.ownerId === uid;
    league.isMember = !!uid && (league.ownerId === uid || mIds.indexOf(uid) !== -1);
    return league;
  });
  // 4. Update localStorage cache so sync reads see fresh data
  localStorage.setItem(SpontixStore.KEYS.leagues, JSON.stringify(leagues));
  return leagues;
};

SpontixStoreAsync.getMyLeagues = async function () {
  const all = await SpontixStoreAsync.getLeagues();
  return all.filter(function (l) { return l.isOwner || l.isMember; });
};

SpontixStoreAsync.getDiscoverLeagues = async function () {
  const all = await SpontixStoreAsync.getLeagues();
  return all.filter(function (l) { return !l.isOwner && !l.isMember; });
};

SpontixStoreAsync.createLeague = async function (data) {
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };
  if (typeof window === 'undefined' || !window.sb) {
    const l = SpontixStore.createLeague(data);
    return { ok: true, data: l };
  }
  const row = SpontixStore._mapLeagueToDb({
    ownerId:    uid,
    name:       data.name || 'Untitled League',
    sport:      data.sport || 'Football',
    region:     data.region || 'Europe',
    type:       data.type || 'public',
    mode:       data.mode || 'individual',
    team:       data.team || null,
    maxMembers:   data.maxMembers || 50,
    trophy:       data.trophy || null,
    joinPassword: data.joinPassword || null,
    // AI / sports config — create-league.html sends these as snake_case
    scope:               data.scope               || null,
    scopedTeamId:        data.scoped_team_id      || null,
    scopedTeamName:      data.scoped_team_name    || null,
    apiSportsLeagueId:   data.api_sports_league_id || null,
    apiSportsTeamId:     data.api_sports_team_id  || null,
    apiSportsSeason:     data.api_sports_season   || null,
    leagueStartDate:     data.league_start_date   || null,
    leagueEndDate:       data.league_end_date     || null,
    aiQuestionsEnabled:  data.ai_questions_enabled || false,
    aiWeeklyQuota:       data.ai_weekly_quota     || null,
    aiTotalQuota:        data.ai_total_quota      || null,
  });
  const { data: inserted, error } = await window.sb
    .from('leagues')
    .insert(row)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  // Add owner to league_members so RLS policies (player_answers, etc.) treat them as a member
  await window.sb.from('league_members').insert({ league_id: inserted.id, user_id: uid });
  // Refresh cache
  await SpontixStoreAsync.getLeagues();
  return { ok: true, data: SpontixStore._mapLeagueFromDb(inserted, [uid]) };
};

SpontixStoreAsync.joinLeague = async function (leagueId, password) {
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };
  if (typeof window === 'undefined' || !window.sb) {
    const l = SpontixStore.joinLeague(leagueId);
    return { ok: true, data: l };
  }
  // Fetch the league to check type and password
  const { data: league, error: fetchErr } = await window.sb
    .from('leagues')
    .select('type, join_password')
    .eq('id', leagueId)
    .single();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  // Verify password for private leagues
  if (league.type === 'private') {
    if (!password) return { ok: false, error: 'wrong-password' };
    if (league.join_password && league.join_password !== password) {
      return { ok: false, error: 'wrong-password' };
    }
  }
  // Insert into league_members
  const { error } = await window.sb
    .from('league_members')
    .insert({ league_id: leagueId, user_id: uid });
  if (error) {
    if (error.code === '23505') return { ok: true, data: null }; // already a member
    return { ok: false, error: error.message };
  }
  await SpontixStoreAsync.getLeagues();
  return { ok: true };
};

SpontixStoreAsync.leaveLeague = async function (leagueId) {
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };
  if (typeof window === 'undefined' || !window.sb) {
    const l = SpontixStore.leaveLeague(leagueId);
    return { ok: true, data: l };
  }
  // Delete from league_members (RLS: user can only delete their own row)
  const { error } = await window.sb
    .from('league_members')
    .delete()
    .eq('league_id', leagueId)
    .eq('user_id', uid);
  if (error) return { ok: false, error: error.message };
  // Refresh cache
  await SpontixStoreAsync.getLeagues();
  return { ok: true };
};

SpontixStoreAsync.deleteLeague = async function (leagueId) {
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };
  if (typeof window === 'undefined' || !window.sb) {
    // Fall back to sync delete from localStorage
    const leagues = SpontixStore.getLeagues({ raw: true });
    const idx = leagues.findIndex(function (l) { return l.id === leagueId; });
    if (idx >= 0) { leagues.splice(idx, 1); SpontixStore.saveLeagues(leagues); }
    return { ok: true };
  }
  // RLS: only owner can delete
  const { error } = await window.sb
    .from('leagues')
    .delete()
    .eq('id', leagueId);
  if (error) return { ok: false, error: error.message };
  await SpontixStoreAsync.getLeagues();
  return { ok: true };
};

// ══════════════════════════════════════════════════════════════════════
// VENUE EVENTS — Supabase mapping & async overrides
// ══════════════════════════════════════════════════════════════════════
//   Database columns are snake_case (venue_id, host_user_id, max_players).
//   Client objects are camelCase (venueId, hostUserId, maxPlayers).
//   `_mapEventFromDb` / `_mapEventToDb` handle the conversion.
// ══════════════════════════════════════════════════════════════════════

SpontixStore._mapEventFromDb = function (row) {
  if (!row) return null;
  return {
    id:          row.id,
    venueId:     row.venue_id,
    hostUserId:  row.host_user_id,
    name:        row.name,
    matchTitle:  row.match_title  || '',
    date:        row.date,
    time:        row.time         || '20:00',
    sport:       row.sport        || 'Football',
    maxPlayers:  row.max_players  || 50,
    registered:  row.registered   || 0,
    status:      row.status       || 'scheduled',
    trophy:      row.trophy       || null,
    createdAt:   row.created_at,
  };
};

SpontixStore._mapEventToDb = function (e) {
  var out = {};
  if (e.venueId !== undefined)    out.venue_id      = e.venueId;
  if (e.hostUserId !== undefined) out.host_user_id   = e.hostUserId;
  if (e.name !== undefined)       out.name           = e.name;
  if (e.matchTitle !== undefined) out.match_title    = e.matchTitle;
  if (e.date !== undefined)       out.date           = e.date;
  if (e.time !== undefined)       out.time           = e.time;
  if (e.sport !== undefined)      out.sport          = e.sport;
  if (e.maxPlayers !== undefined) out.max_players    = e.maxPlayers;
  if (e.registered !== undefined) out.registered     = e.registered;
  if (e.status !== undefined)     out.status         = e.status;
  if (e.trophy !== undefined)     out.trophy         = e.trophy;
  return out;
};

// ── Override the async event methods to hit Supabase ──

SpontixStoreAsync.getVenueEvents = async function (venueId) {
  if (typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getVenueEvents();
  }
  var query = window.sb.from('venue_events').select('*').order('date', { ascending: true });
  // If a venueId is provided, filter to that venue; otherwise return all
  // events visible to the user (for venue owners, this is typically their own).
  if (venueId) {
    query = query.eq('venue_id', venueId);
  }
  var result = await query;
  if (result.error) {
    console.warn('[SpontixStoreAsync.getVenueEvents] Supabase error, falling back:', result.error);
    return SpontixStore.getVenueEvents();
  }
  var events = (result.data || []).map(SpontixStore._mapEventFromDb);
  // Update localStorage cache so sync reads see fresh data
  localStorage.setItem(SpontixStore.KEYS.venueEvents, JSON.stringify(events));
  return events;
};

SpontixStoreAsync.createVenueEvent = async function (data) {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };
  // Resolve the venue that owns this event
  var activeVenue = SpontixStore.Session.getCurrentVenue();
  var venueId = (activeVenue && activeVenue.id) ? activeVenue.id : null;
  if (!venueId) {
    // Try to find venue by owner
    if (typeof window !== 'undefined' && window.sb) {
      var vResult = await window.sb.from('venues').select('id').eq('owner_id', uid).limit(1).maybeSingle();
      if (vResult.data) venueId = vResult.data.id;
    }
  }
  if (!venueId) return { ok: false, error: 'no-venue' };

  if (typeof window === 'undefined' || !window.sb) {
    var ev = SpontixStore.createVenueEvent(data);
    return { ok: true, data: ev };
  }
  var row = SpontixStore._mapEventToDb({
    venueId:    venueId,
    hostUserId: uid,
    name:       data.name || 'Untitled Event',
    matchTitle: data.matchTitle || '',
    date:       data.date || new Date().toISOString().split('T')[0],
    time:       data.time || '20:00',
    sport:      data.sport || 'Football',
    maxPlayers: data.maxPlayers || 50,
    status:     'scheduled',
    trophy:     data.trophy || null,
  });
  var insertResult = await window.sb.from('venue_events').insert(row).select().single();
  if (insertResult.error) return { ok: false, error: insertResult.error.message };
  // Refresh cache
  await SpontixStoreAsync.getVenueEvents(venueId);
  return { ok: true, data: SpontixStore._mapEventFromDb(insertResult.data) };
};

SpontixStoreAsync.updateVenueEvent = async function (eventId, patch) {
  if (typeof window === 'undefined' || !window.sb) {
    // Sync fallback: update in localStorage
    var events = SpontixStore.getVenueEvents();
    var ev = events.find(function (e) { return e.id === eventId; });
    if (ev) {
      Object.assign(ev, patch);
      SpontixStore.saveVenueEvents(events);
    }
    return { ok: true, data: ev };
  }
  var dbPatch = SpontixStore._mapEventToDb(patch);
  var result = await window.sb
    .from('venue_events')
    .update(dbPatch)
    .eq('id', eventId)
    .select()
    .single();
  if (result.error) return { ok: false, error: result.error.message };
  // Refresh cache
  await SpontixStoreAsync.getVenueEvents();
  return { ok: true, data: SpontixStore._mapEventFromDb(result.data) };
};

SpontixStoreAsync.deleteVenueEvent = async function (eventId) {
  if (typeof window === 'undefined' || !window.sb) {
    var events = SpontixStore.getVenueEvents();
    var idx = events.findIndex(function (e) { return e.id === eventId; });
    if (idx >= 0) { events.splice(idx, 1); SpontixStore.saveVenueEvents(events); }
    return { ok: true };
  }
  var result = await window.sb.from('venue_events').delete().eq('id', eventId);
  if (result.error) return { ok: false, error: result.error.message };
  await SpontixStoreAsync.getVenueEvents();
  return { ok: true };
};

// ══════════════════════════════════════════════════════════════════════
// USER PROFILE — Supabase mapping & async overrides
// ══════════════════════════════════════════════════════════════════════
//   Reads/writes public.users. The sync `getPlayer()` stays for
//   backwards compat; the async layer syncs to/from Supabase.
// ══════════════════════════════════════════════════════════════════════

SpontixStore._mapUserFromDb = function (row) {
  if (!row) return null;
  return {
    id:             row.id,
    name:           row.name || 'Player',
    handle:         row.handle ? row.handle.replace(/^@/, '') : '',
    email:          row.email || '',
    role:           row.role || 'player',
    avatar:            row.avatar || (row.name ? row.name[0].toUpperCase() : 'P'),
    avatarColor:       row.avatar_color || 'var(--lime)',
    profilePhotoType:  row.profile_photo_type || 'color',
    profilePhotoId:    row.profile_photo_id   || 'color_lime',
    profilePhotoUrl:   row.profile_photo_url  || null,
    tier:           row.tier || 'starter',
    joinedDate:     row.created_at ? row.created_at.split('T')[0] : '',
    totalPoints:    row.total_points || 0,
    totalCorrect:   row.total_correct || 0,
    totalWrong:     row.total_wrong || 0,
    bestStreak:     row.best_streak || 0,
    currentStreak:  row.current_streak || 0,
    gamesPlayed:    row.games_played || 0,
    leaguesJoined:  row.leagues_joined || 0,
    teamsJoined:    row.teams_joined || 0,
    teamWins:       row.team_wins || 0,
    badges:         row.badges_count || 0,
    trophies:       row.trophies_count || 0,
    accuracy:       row.accuracy || { live: 0, prematch: 0, trivia: 0, news: 0 },
  };
};

SpontixStore._mapUserToDb = function (p) {
  var out = {};
  if (p.name !== undefined)          out.name           = p.name;
  if (p.handle !== undefined)        out.handle          = p.handle.replace(/^@/, '');
  if (p.email !== undefined)         out.email           = p.email;
  if (p.avatar !== undefined)             out.avatar              = p.avatar;
  if (p.avatarColor !== undefined)        out.avatar_color        = p.avatarColor;
  if (p.profilePhotoType !== undefined)   out.profile_photo_type  = p.profilePhotoType;
  if (p.profilePhotoId !== undefined)     out.profile_photo_id    = p.profilePhotoId;
  if (p.profilePhotoUrl !== undefined)    out.profile_photo_url   = p.profilePhotoUrl;
  if (p.totalPoints !== undefined)   out.total_points    = p.totalPoints;
  if (p.totalCorrect !== undefined)  out.total_correct   = p.totalCorrect;
  if (p.totalWrong !== undefined)    out.total_wrong     = p.totalWrong;
  if (p.bestStreak !== undefined)    out.best_streak     = p.bestStreak;
  if (p.currentStreak !== undefined) out.current_streak  = p.currentStreak;
  if (p.gamesPlayed !== undefined)   out.games_played    = p.gamesPlayed;
  if (p.leaguesJoined !== undefined) out.leagues_joined  = p.leaguesJoined;
  if (p.teamsJoined !== undefined)   out.teams_joined    = p.teamsJoined;
  if (p.teamWins !== undefined)      out.team_wins       = p.teamWins;
  if (p.badges !== undefined)        out.badges_count    = p.badges;
  if (p.trophies !== undefined)      out.trophies_count  = p.trophies;
  if (p.accuracy !== undefined)      out.accuracy        = p.accuracy;
  return out;
};

SpontixStoreAsync.getProfile = async function (userId) {
  var uid = userId || SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getPlayer();
  }
  var result = await window.sb.from('users').select('*').eq('id', uid).maybeSingle();
  if (result.error || !result.data) {
    console.warn('[SpontixStoreAsync.getProfile] error:', result.error);
    return SpontixStore.getPlayer();
  }
  var profile = SpontixStore._mapUserFromDb(result.data);
  // Update localStorage cache so sync getPlayer() sees fresh data
  var current = SpontixStore.getPlayer();
  var merged = Object.assign({}, current, profile);
  // Preserve the forced Elite tier from authGate — DB tier column is null until Stripe lands
  var forcedTier = localStorage.getItem('spontix_user_tier');
  if (forcedTier) merged.tier = forcedTier;
  SpontixStore.savePlayer(merged);
  return merged;
};

SpontixStoreAsync.updateProfile = async function (patch) {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };

  // Update local player immediately
  var player = SpontixStore.getPlayer();
  Object.assign(player, patch);
  SpontixStore.savePlayer(player);

  if (typeof window === 'undefined' || !window.sb) {
    return { ok: true, data: player };
  }
  var dbPatch = SpontixStore._mapUserToDb(patch);
  var result = await window.sb.from('users').update(dbPatch).eq('id', uid).select().single();
  if (result.error) return { ok: false, error: result.error.message };
  return { ok: true, data: SpontixStore._mapUserFromDb(result.data) };
};

// ── Player avatar async setters ──
// All three delegate to updateProfile after updating the local store.

SpontixStoreAsync.setPlayerAvatarColor = async function (colorId) {
  return await SpontixStoreAsync.updateProfile({
    profilePhotoType: 'color',
    profilePhotoId:   colorId,
    profilePhotoUrl:  null,
  });
};

SpontixStoreAsync.setPlayerAvatarPreset = async function (presetId) {
  return await SpontixStoreAsync.updateProfile({
    profilePhotoType: 'preset',
    profilePhotoId:   presetId,
    profilePhotoUrl:  null,
  });
};

// Uploads to Supabase Storage bucket 'user-photos' (must exist + be public),
// then saves the CDN URL. Falls back to storing the data URL locally if
// the bucket doesn't exist yet.
SpontixStoreAsync.uploadPlayerPhoto = async function (dataUrl) {
  var uid = SpontixStore.Session.getCurrentUserId();

  // Attempt Storage upload if Supabase is available
  if (uid && typeof window !== 'undefined' && window.sb) {
    try {
      var blob = SpontixStore._dataUrlToBlob(dataUrl);
      var fileName = uid + '/profile.jpg';  // fixed name — upsert replaces previous
      var uploadResult = await window.sb.storage
        .from('user-photos')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

      if (!uploadResult.error) {
        var urlResult = window.sb.storage.from('user-photos').getPublicUrl(fileName);
        dataUrl = urlResult.data.publicUrl; // replace with CDN URL
      } else {
        console.warn('[uploadPlayerPhoto] Storage error (falling back to data URL):', uploadResult.error);
      }
    } catch (e) {
      console.warn('[uploadPlayerPhoto] Storage exception (falling back to data URL):', e);
    }
  }

  return await SpontixStoreAsync.updateProfile({
    profilePhotoType: 'custom',
    profilePhotoId:   null,
    profilePhotoUrl:  dataUrl,
  });
};

// ══════════════════════════════════════════════════════════════════════
// RESERVATIONS — Supabase mapping & async overrides
// ══════════════════════════════════════════════════════════════════════

SpontixStore._mapReservationFromDb = function (row) {
  if (!row) return null;
  return {
    id:       row.id,
    userId:   row.user_id,
    venueId:  row.venue_id,
    eventId:  row.event_id,
    status:   row.status || 'confirmed',
    date:     row.reserved_at,
    // Client code also uses venue/event names — look them up from cache
    venue:    '',
    event:    '',
  };
};

SpontixStore._mapReservationToDb = function (r) {
  var out = {};
  if (r.userId !== undefined)  out.user_id   = r.userId;
  if (r.venueId !== undefined) out.venue_id   = r.venueId;
  if (r.eventId !== undefined) out.event_id   = r.eventId;
  if (r.status !== undefined)  out.status     = r.status;
  return out;
};

SpontixStoreAsync.getReservations = async function (userId) {
  var uid = userId || SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getReservations();
  }
  var result = await window.sb
    .from('reservations')
    .select('*')
    .eq('user_id', uid)
    .order('reserved_at', { ascending: false });
  if (result.error) {
    console.warn('[SpontixStoreAsync.getReservations] error:', result.error);
    return SpontixStore.getReservations();
  }
  var reservations = (result.data || []).map(SpontixStore._mapReservationFromDb);
  // Enrich with venue names from cache
  var venues = SpontixStore.getVenues ? SpontixStore.getVenues() : [];
  reservations.forEach(function (r) {
    var v = venues.find(function (v) { return v.id === r.venueId; });
    if (v) r.venue = v.venueName || v.name || '';
  });
  localStorage.setItem(SpontixStore.KEYS.reservations, JSON.stringify(reservations));
  return reservations;
};

SpontixStoreAsync.reserveSpot = async function (venueId, eventId, venueName, eventName) {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };
  if (typeof window === 'undefined' || !window.sb) {
    var r = SpontixStore.reserveSpot(venueName || '', eventName || '');
    return { ok: true, data: r };
  }
  var row = {
    user_id:  uid,
    venue_id: venueId || null,
    event_id: eventId || null,
    status:   'confirmed',
  };
  var result = await window.sb.from('reservations').insert(row).select().single();
  if (result.error) return { ok: false, error: result.error.message };
  await SpontixStoreAsync.getReservations(uid);
  return { ok: true, data: SpontixStore._mapReservationFromDb(result.data) };
};

SpontixStoreAsync.cancelReservation = async function (reservationId) {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    // Sync fallback: remove from localStorage
    var res = SpontixStore.getReservations();
    var idx = res.findIndex(function (r) { return r.id === reservationId; });
    if (idx >= 0) { res.splice(idx, 1); SpontixStore.saveReservations(res); }
    return { ok: true };
  }
  var result = await window.sb.from('reservations').delete().eq('id', reservationId);
  if (result.error) return { ok: false, error: result.error.message };
  await SpontixStoreAsync.getReservations(uid);
  return { ok: true };
};

// ══════════════════════════════════════════════════════════════════════
// GAME HISTORY — Supabase mapping & async overrides
// ══════════════════════════════════════════════════════════════════════

SpontixStore._mapGameHistoryFromDb = function (row) {
  if (!row) return null;
  return {
    id:           row.id,
    userId:       row.user_id,
    matchTitle:   row.match_title || 'Unknown Match',
    matchScore:   row.match_score || '? — ?',
    points:       row.points || 0,
    correct:      row.correct || 0,
    wrong:        row.wrong || 0,
    total:        (row.correct || 0) + (row.wrong || 0),
    bestStreak:   row.best_streak || 0,
    endStreak:    row.end_streak || 0,
    questionTypes: row.question_types || null,
    rank:         row.rank || null,
    totalPlayers: row.total_players || null,
    date:         row.played_at,
  };
};

SpontixStore._mapGameHistoryToDb = function (g) {
  var out = {};
  if (g.userId !== undefined)       out.user_id        = g.userId;
  if (g.matchTitle !== undefined)   out.match_title     = g.matchTitle;
  if (g.matchScore !== undefined)   out.match_score     = g.matchScore;
  if (g.points !== undefined)       out.points          = g.points;
  if (g.correct !== undefined)      out.correct         = g.correct;
  if (g.wrong !== undefined)        out.wrong           = g.wrong;
  if (g.bestStreak !== undefined)   out.best_streak     = g.bestStreak;
  if (g.endStreak !== undefined)    out.end_streak      = g.endStreak;
  if (g.questionTypes !== undefined) out.question_types = g.questionTypes;
  if (g.rank !== undefined)         out.rank            = g.rank;
  if (g.totalPlayers !== undefined) out.total_players   = g.totalPlayers;
  if (g.eloBefore !== undefined)    out.elo_before      = g.eloBefore;
  if (g.eloAfter !== undefined)     out.elo_after       = g.eloAfter;
  return out;
};

SpontixStoreAsync.getGameHistory = async function (userId) {
  var uid = userId || SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getGameHistory();
  }
  var result = await window.sb
    .from('game_history')
    .select('*')
    .eq('user_id', uid)
    .order('played_at', { ascending: false })
    .limit(50);
  if (result.error) {
    console.warn('[SpontixStoreAsync.getGameHistory] error:', result.error);
    return SpontixStore.getGameHistory();
  }
  var history = (result.data || []).map(SpontixStore._mapGameHistoryFromDb);
  localStorage.setItem(SpontixStore.KEYS.gameHistory, JSON.stringify(history));
  return history;
};

SpontixStoreAsync.recordGameResult = async function (resultData) {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.recordGameResult(resultData);
  }
  // Update localStorage stats synchronously first
  var player = SpontixStore.recordGameResult(resultData);

  // ── ELO calculation (BR only) — must happen BEFORE game_history insert ──
  var eloResult = null;
  var userUpdate = {
    total_points:   player.totalPoints,
    total_correct:  player.totalCorrect,
    total_wrong:    player.totalWrong,
    best_streak:    player.bestStreak,
    current_streak: player.currentStreak,
    games_played:   player.gamesPlayed,
    accuracy:       player.accuracy,
    updated_at:     new Date().toISOString(),
  };

  if (resultData.gameType === 'battle_royale' && resultData.rank && resultData.totalPlayers) {
    var profileRes = await window.sb.from('users').select('elo_rating,games_played').eq('id', uid).single();
    var currentElo    = (profileRes.data && profileRes.data.elo_rating)   || 1000;
    var gamesPlayedDB = (profileRes.data && profileRes.data.games_played) || 0;

    if (typeof BRElo !== 'undefined') {
      var brResult = BRElo.calculateSinglePlayer({
        playerElo:       currentElo,
        gamesPlayed:     gamesPlayedDB,
        placement:       resultData.rank,
        lobbySize:       resultData.totalPlayers,
        avgOpponentsElo: resultData.avgOpponentsElo || 1000,
      });
      eloResult = { eloChange: brResult.eloChange, newElo: brResult.newElo, prevElo: currentElo };
    } else {
      var change = SpontixStore._calculateEloChange(currentElo, resultData.rank, resultData.totalPlayers);
      eloResult = { eloChange: change, newElo: Math.max(0, currentElo + change), prevElo: currentElo };
    }
    userUpdate.elo_rating = eloResult.newElo;
  }

  // Persist the game_history row (includes elo_before/elo_after for BR games)
  var row = SpontixStore._mapGameHistoryToDb({
    userId:        uid,
    matchTitle:    resultData.matchTitle || 'Unknown Match',
    matchScore:    resultData.matchScore || '? — ?',
    points:        resultData.points || 0,
    correct:       resultData.correct || 0,
    wrong:         resultData.wrong || 0,
    bestStreak:    resultData.bestStreak || 0,
    endStreak:     resultData.endStreak || 0,
    questionTypes: resultData.questionTypes || null,
    rank:          resultData.rank || null,
    totalPlayers:  resultData.totalPlayers || null,
    eloBefore:     eloResult ? eloResult.prevElo : undefined,
    eloAfter:      eloResult ? eloResult.newElo  : undefined,
  });
  await window.sb.from('game_history').insert(row).catch(function (err) {
    console.warn('[SpontixStoreAsync.recordGameResult] game_history insert error:', err);
  });

  // Sync accumulated stats + new ELO back to public.users
  await window.sb.from('users').update(userUpdate).eq('id', uid).catch(function (err) {
    console.warn('[SpontixStoreAsync.recordGameResult] users update error:', err);
  });

  return Object.assign({}, player, eloResult ? { eloChange: eloResult.eloChange, newElo: eloResult.newElo, prevElo: eloResult.prevElo } : {});
};

// ══════════════════════════════════════════════════════════════════════
// LEADERBOARDS — Supabase async functions
// ══════════════════════════════════════════════════════════════════════

// Deterministic bg style string from a player name (same gradient palette
// as _applyNameGradientToEl so avatar colors are consistent everywhere).
SpontixStore._nameToBgStyle = function (name) {
  var opts = [
    { g: 'linear-gradient(135deg,#7C5CFC,#A855F7)', c: '#fff' },
    { g: 'linear-gradient(135deg,#4ECDC4,#2196F3)', c: 'var(--navy)' },
    { g: 'linear-gradient(135deg,#FF6B6B,#FF8E53)', c: 'var(--navy)' },
    { g: 'linear-gradient(135deg,#FFD93D,#F97316)', c: 'var(--navy)' },
    { g: 'linear-gradient(135deg,#EC4899,#8B5CF6)', c: '#fff' },
    { g: 'linear-gradient(135deg,#3B82F6,#1E3A8A)', c: '#fff' },
    { g: 'linear-gradient(135deg,#A8E10C,#22c55e)', c: 'var(--navy)' },
    { g: 'linear-gradient(135deg,#F59E0B,#EF4444)', c: '#fff' },
  ];
  var hash = 0;
  for (var i = 0; i < (name || '').length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  var opt = opts[Math.abs(hash) % opts.length];
  return 'background:' + opt.g + ';color:' + opt.c + ';';
};

// Convert a DB users row + optional period-stats into the leaderboard player shape.
SpontixStore._mapLbEntry = function (row, uid, ps) {
  var name = row.name || row.handle || 'Player';
  var parts = name.trim().split(/\s+/);
  var initials = parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  var allTotal = (row.total_correct || 0) + (row.total_wrong || 0);
  var allAcc = allTotal > 0 ? Math.round(row.total_correct / allTotal * 100) : 0;
  ps = ps || {};
  var w = ps.week || {}, m = ps.month || {}, s = ps.season || {};
  return {
    id:        row.id,
    name:      name,
    handle:    row.handle ? ('@' + row.handle.replace(/^@/, '')) : '',
    initials:  initials,
    bg:        SpontixStore._nameToBgStyle(name),
    you:       row.id === uid,
    tier:      row.tier,
    eloRating: row.elo_rating || 1000,
    pts:     { week: w.pts    || 0, month: m.pts    || 0, season: s.pts    || 0, all: row.total_points || 0 },
    acc:     { week: w.acc    || 0, month: m.acc    || 0, season: s.acc    || 0, all: allAcc },
    streak:  { week: w.streak || 0, month: m.streak || 0, season: s.streak || 0, all: row.best_streak  || 0 },
    qs:      { week: w.qs     || 0, month: m.qs     || 0, season: s.qs     || 0, all: allTotal },
    created: { week: 0,             month: 0,              season: 0,             all: row.leagues_joined || 0 },
    leagues: [],
  };
};

// Fetch all player rankings. All-time stats come from public.users; period
// stats (week/month/season) are aggregated from game_history in one extra query.
SpontixStoreAsync.getLeaderboard = async function (opts) {
  opts = opts || {};
  var limit = opts.limit || 100;
  if (typeof window === 'undefined' || !window.sb) return [];

  // 1. All player profiles ordered by all-time points
  var usersRes = await window.sb
    .from('users')
    .select('id,name,handle,avatar,avatar_color,tier,total_points,total_correct,total_wrong,best_streak,current_streak,games_played,accuracy,leagues_joined,trophies_count,elo_rating')
    .eq('role', 'player')
    .order('total_points', { ascending: false })
    .limit(limit);
  if (usersRes.error || !usersRes.data) return [];

  // 2. Game history for the last ~4 months (covers season window)
  var seasonCutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  var ghRes = await window.sb
    .from('game_history')
    .select('user_id,points,correct,wrong,best_streak,played_at')
    .gte('played_at', seasonCutoff);

  // 3. Aggregate period stats per user
  var now = Date.now();
  var weekMs  = 7  * 24 * 60 * 60 * 1000;
  var monthMs = 30 * 24 * 60 * 60 * 1000;
  var periodMap = {};
  (ghRes.data || []).forEach(function (g) {
    if (!periodMap[g.user_id]) {
      periodMap[g.user_id] = {
        week:   { pts: 0, cor: 0, tot: 0, streak: 0 },
        month:  { pts: 0, cor: 0, tot: 0, streak: 0 },
        season: { pts: 0, cor: 0, tot: 0, streak: 0 },
      };
    }
    var age = now - new Date(g.played_at).getTime();
    var add = function (b) {
      b.pts += g.points || 0;
      b.cor += g.correct || 0;
      b.tot += (g.correct || 0) + (g.wrong || 0);
      if ((g.best_streak || 0) > b.streak) b.streak = g.best_streak;
    };
    add(periodMap[g.user_id].season);
    if (age <= monthMs) add(periodMap[g.user_id].month);
    if (age <= weekMs)  add(periodMap[g.user_id].week);
  });

  // 4. Build leaderboard entries
  var uid = SpontixStore.Session.getCurrentUserId();
  var toAcc = function (b) { return b.tot > 0 ? Math.round(b.cor / b.tot * 100) : 0; };
  return usersRes.data.map(function (row) {
    var p = periodMap[row.id];
    var ps = p ? {
      week:   { pts: p.week.pts,   acc: toAcc(p.week),   streak: p.week.streak,   qs: p.week.tot   },
      month:  { pts: p.month.pts,  acc: toAcc(p.month),  streak: p.month.streak,  qs: p.month.tot  },
      season: { pts: p.season.pts, acc: toAcc(p.season), streak: p.season.streak, qs: p.season.tot },
    } : null;
    return SpontixStore._mapLbEntry(row, uid, ps);
  });
};

// Fetch members of a league sorted by all-time total_points.
SpontixStoreAsync.getLeagueLeaderboard = async function (leagueId) {
  if (!leagueId || typeof window === 'undefined' || !window.sb) return [];
  // Members
  var memRes = await window.sb.from('league_members').select('user_id').eq('league_id', leagueId);
  if (memRes.error) return [];
  // Also include the league owner (may not have a members row)
  var lgRes = await window.sb.from('leagues').select('owner_id').eq('id', leagueId).single();
  var ids = (memRes.data || []).map(function (r) { return r.user_id; });
  if (lgRes.data && lgRes.data.owner_id && ids.indexOf(lgRes.data.owner_id) === -1) {
    ids.push(lgRes.data.owner_id);
  }
  if (!ids.length) return [];
  var uid = SpontixStore.Session.getCurrentUserId();
  var usersRes = await window.sb
    .from('users')
    .select('id,name,handle,avatar,avatar_color,tier,total_points,total_correct,total_wrong,best_streak,games_played,accuracy,leagues_joined,elo_rating')
    .in('id', ids)
    .order('total_points', { ascending: false });
  return (usersRes.data || []).map(function (row) {
    return SpontixStore._mapLbEntry(row, uid, null);
  });
};


// ══════════════════════════════════════════════════════════════════════
// VENUE PHOTOS — Supabase mapping & async overrides
// ══════════════════════════════════════════════════════════════════════
//   Two tables:
//   1. `venue_photos` — photo rows (storage_url holds data URL for now)
//   2. `venue_photo_config` — title photo settings (one row per venue)
//   Client shape: { photos: [...], titlePhotoId, useTitlePhoto }
// ══════════════════════════════════════════════════════════════════════

SpontixStore._mapPhotoFromDb = function (row) {
  if (!row) return null;
  return {
    id:         row.id,
    venueId:    row.venue_id,
    dataUrl:    row.storage_url,
    isPreset:   row.is_preset || false,
    presetId:   row.preset_id || null,
    label:      row.label || null,
    uploadedAt: row.uploaded_at,
  };
};

SpontixStore._mapPhotoToDb = function (p, venueId) {
  var out = {};
  if (venueId !== undefined)       out.venue_id    = venueId;
  if (p.dataUrl !== undefined)     out.storage_url  = p.dataUrl;
  if (p.isPreset !== undefined)    out.is_preset    = p.isPreset;
  if (p.presetId !== undefined)    out.preset_id    = p.presetId;
  if (p.label !== undefined)       out.label        = p.label;
  return out;
};

// ── Async photo overrides ──

SpontixStoreAsync.getVenuePhotoConfig = async function (venueId) {
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getVenuePhotoConfig(vid);
  }
  // Fetch photos and config in parallel
  var pResult = await window.sb
    .from('venue_photos')
    .select('*')
    .eq('venue_id', vid)
    .order('uploaded_at', { ascending: false });
  var cResult = await window.sb
    .from('venue_photo_config')
    .select('*')
    .eq('venue_id', vid)
    .maybeSingle();

  if (pResult.error) {
    console.warn('[SpontixStoreAsync.getVenuePhotoConfig] photos error:', pResult.error);
    return SpontixStore.getVenuePhotoConfig(vid);
  }

  var photos = (pResult.data || []).map(SpontixStore._mapPhotoFromDb);
  var config = cResult.data || {};
  var result = {
    photos: photos,
    titlePhotoId: config.title_photo_id || null,
    useTitlePhoto: config.use_title_photo || false,
  };
  // Update localStorage cache
  var all = SpontixStore._getAllVenuePhotos();
  all[vid] = result;
  SpontixStore._saveAllVenuePhotos(all);
  return result;
};

// Helper: convert a base64 data URL to a Blob for Storage upload
SpontixStore._dataUrlToBlob = function (dataUrl) {
  var parts = dataUrl.split(',');
  var mime = parts[0].match(/:(.*?);/)[1];
  var b64 = atob(parts[1]);
  var arr = new Uint8Array(b64.length);
  for (var i = 0; i < b64.length; i++) arr[i] = b64.charCodeAt(i);
  return new Blob([arr], { type: mime });
};

SpontixStoreAsync.addVenuePhoto = async function (venueId, dataUrl, opts) {
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.addVenuePhoto(vid, dataUrl, opts);
  }
  // Tier check stays client-side
  var tier = (opts && opts.tier) || localStorage.getItem(SpontixStore.KEYS.tier) || 'venue-starter';
  var limits = SpontixStore.TIER_LIMITS[tier] || SpontixStore.TIER_LIMITS['venue-starter'];
  if (!limits.photoCustomUpload) return { error: 'tier', requiredTier: 'venue-pro' };

  // Check limit
  var currentConfig = await SpontixStoreAsync.getVenuePhotoConfig(vid);
  var customCount = currentConfig.photos.filter(function (p) { return !p.isPreset; }).length;
  if (limits.photoMaxCustom !== Infinity && customCount >= limits.photoMaxCustom) {
    return { error: 'limit', max: limits.photoMaxCustom, requiredTier: 'venue-elite' };
  }

  // Upload to Supabase Storage bucket 'venue-photos'
  var fileName = vid + '/' + Date.now() + '.jpg';
  var blob = SpontixStore._dataUrlToBlob(dataUrl);
  var uploadResult = await window.sb.storage
    .from('venue-photos')
    .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
  if (uploadResult.error) {
    console.warn('[addVenuePhoto] Storage upload error:', uploadResult.error);
    return { error: 'storage', message: uploadResult.error.message };
  }

  // Get the public CDN URL
  var urlResult = window.sb.storage.from('venue-photos').getPublicUrl(fileName);
  var cdnUrl = urlResult.data.publicUrl;

  // Insert row with CDN URL (not base64)
  var row = SpontixStore._mapPhotoToDb({
    dataUrl:  cdnUrl,
    isPreset: false,
  }, vid);
  var result = await window.sb.from('venue_photos').insert(row).select().single();
  if (result.error) return { error: 'storage', message: result.error.message };

  var photo = SpontixStore._mapPhotoFromDb(result.data);

  // Auto-set as title if first photo
  if (currentConfig.photos.length === 0) {
    await SpontixStoreAsync.setVenueTitlePhoto(vid, photo.id);
    await SpontixStoreAsync.setVenueUseTitlePhoto(vid, true);
  }
  // Refresh cache
  await SpontixStoreAsync.getVenuePhotoConfig(vid);
  return photo;
};

SpontixStoreAsync.selectPresetPhoto = async function (venueId, presetId) {
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.selectPresetPhoto(vid, presetId);
  }
  var preset = SpontixStore.PREMADE_PHOTOS.find(function (p) { return p.id === presetId; });
  if (!preset) return null;

  var row = SpontixStore._mapPhotoToDb({
    dataUrl:  preset.dataUrl,
    isPreset: true,
    presetId: presetId,
    label:    preset.label,
  }, vid);
  var result = await window.sb.from('venue_photos').insert(row).select().single();
  if (result.error) {
    console.warn('[SpontixStoreAsync.selectPresetPhoto] error:', result.error);
    return SpontixStore.selectPresetPhoto(vid, presetId);
  }
  var photo = SpontixStore._mapPhotoFromDb(result.data);
  // Auto-set as title + enable
  await SpontixStoreAsync.setVenueTitlePhoto(vid, photo.id);
  await SpontixStoreAsync.setVenueUseTitlePhoto(vid, true);
  await SpontixStoreAsync.getVenuePhotoConfig(vid);
  return photo;
};

SpontixStoreAsync.removeVenuePhoto = async function (venueId, photoId) {
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.removeVenuePhoto(vid, photoId);
  }
  var result = await window.sb.from('venue_photos').delete().eq('id', photoId);
  if (result.error) {
    console.warn('[SpontixStoreAsync.removeVenuePhoto] error:', result.error);
    return SpontixStore.removeVenuePhoto(vid, photoId);
  }
  // Check if deleted photo was the title — reset if so
  var cResult = await window.sb
    .from('venue_photo_config')
    .select('title_photo_id')
    .eq('venue_id', vid)
    .maybeSingle();
  if (cResult.data && cResult.data.title_photo_id === photoId) {
    // Find next photo to be title
    var remaining = await window.sb.from('venue_photos').select('id').eq('venue_id', vid).limit(1);
    var nextId = (remaining.data && remaining.data[0]) ? remaining.data[0].id : null;
    await window.sb.from('venue_photo_config').upsert({
      venue_id: vid,
      title_photo_id: nextId,
      use_title_photo: !!nextId,
    }, { onConflict: 'venue_id' });
  }
  await SpontixStoreAsync.getVenuePhotoConfig(vid);
};

SpontixStoreAsync.setVenueTitlePhoto = async function (venueId, photoId) {
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.setVenueTitlePhoto(vid, photoId);
  }
  await window.sb.from('venue_photo_config').upsert({
    venue_id: vid,
    title_photo_id: photoId,
  }, { onConflict: 'venue_id' });
};

SpontixStoreAsync.setVenueUseTitlePhoto = async function (venueId, useIt) {
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.setVenueUseTitlePhoto(vid, useIt);
  }
  await window.sb.from('venue_photo_config').upsert({
    venue_id: vid,
    use_title_photo: !!useIt,
  }, { onConflict: 'venue_id' });
};

// ══════════════════════════════════════════════════════════════════════
// TROPHIES — Supabase mapping & async overrides
// ══════════════════════════════════════════════════════════════════════
//   Two tables:
//   1. `trophies` — awarded trophies (a user's Trophy Room)
//   2. `venue_custom_trophies` — venue-designed trophy templates
// ══════════════════════════════════════════════════════════════════════

SpontixStore._mapTrophyFromDb = function (row) {
  if (!row) return null;
  return {
    id:              row.id,
    recipientUserId: row.recipient_user_id,
    type:            row.type,
    custom:          row.custom || false,
    customData:      row.custom_data || null,
    context:         row.context || {},
    date:            row.awarded_at ? row.awarded_at.split('T')[0] : new Date().toISOString().split('T')[0],
  };
};

SpontixStore._mapTrophyToDb = function (t) {
  var out = {};
  if (t.recipientUserId !== undefined) out.recipient_user_id = t.recipientUserId;
  if (t.type !== undefined)            out.type              = t.type;
  if (t.custom !== undefined)          out.custom            = t.custom;
  if (t.customData !== undefined)      out.custom_data       = t.customData;
  if (t.context !== undefined)         out.context           = t.context;
  return out;
};

SpontixStore._mapVenueCustomTrophyFromDb = function (row) {
  if (!row) return null;
  return {
    id:              row.id,
    venueId:         row.venue_id,
    createdByUserId: row.created_by_user_id,
    name:            row.name,
    desc:            row.description || '',
    icon:            row.icon || 'custom',
    rarity:          row.rarity || 'rare',
    timesAwarded:    row.times_awarded || 0,
    createdAt:       row.created_at,
    // Client code also expects venueName — we don't store it in this table,
    // so it's set to empty. Pages that need it can look up the venue.
    venueName:       '',
  };
};

SpontixStore._mapVenueCustomTrophyToDb = function (t) {
  var out = {};
  if (t.venueId !== undefined)         out.venue_id           = t.venueId;
  if (t.createdByUserId !== undefined) out.created_by_user_id = t.createdByUserId;
  if (t.name !== undefined)            out.name               = t.name;
  if (t.desc !== undefined)            out.description        = t.desc;
  if (t.icon !== undefined)            out.icon               = t.icon;
  if (t.rarity !== undefined)          out.rarity             = t.rarity;
  if (t.timesAwarded !== undefined)    out.times_awarded      = t.timesAwarded;
  return out;
};

// ── Async trophy overrides ──

SpontixStoreAsync.getTrophies = async function (userId) {
  var uid = userId || SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getTrophies();
  }
  var result = await window.sb
    .from('trophies')
    .select('*')
    .eq('recipient_user_id', uid)
    .order('awarded_at', { ascending: false });
  if (result.error) {
    console.warn('[SpontixStoreAsync.getTrophies] Supabase error:', result.error);
    return SpontixStore.getTrophies();
  }
  var trophies = (result.data || []).map(SpontixStore._mapTrophyFromDb);
  // Update localStorage cache so sync reads see fresh data
  localStorage.setItem(SpontixStore.KEYS.trophies, JSON.stringify(trophies));
  return trophies;
};

SpontixStoreAsync.awardTrophy = async function (type, context, recipientUserId) {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.awardTrophy(type, context);
  }
  var targetId = recipientUserId || uid;
  var crossUser = targetId !== uid;

  // For self-awards, check non-repeatable guard
  if (!crossUser) {
    var def = SpontixStore.TROPHY_TYPES[type];
    if (def && !def.repeatable) {
      var existing = await SpontixStoreAsync.getTrophies(uid);
      if (existing.some(function (t) { return t.type === type; })) return null;
    }
  }

  var result;
  if (crossUser) {
    // Cross-user award — use the security-definer RPC that bypasses RLS
    result = await window.sb.rpc('award_trophy_to_winner', {
      p_winner_id:   targetId,
      p_type:        type,
      p_custom:      false,
      p_custom_data: {},
      p_context:     context || {},
    });
  } else {
    var row = {
      recipient_user_id: uid,
      type:              type,
      custom:            false,
      context:           context || {},
    };
    result = await window.sb.from('trophies').insert(row).select().single();
  }

  if (result.error) {
    console.warn('[SpontixStoreAsync.awardTrophy] error:', result.error);
    return SpontixStore.awardTrophy(type, context);
  }
  await SpontixStoreAsync.getTrophies(targetId);
  var trophy = SpontixStore._mapTrophyFromDb(result.data);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('spontix-trophy-earned', { detail: { trophy: trophy } }));
  }
  return trophy;
};

SpontixStoreAsync.awardCustomTrophy = async function (customData, context, recipientUserId) {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.awardCustomTrophy(customData, context);
  }
  var targetId = recipientUserId || uid;
  var crossUser = targetId !== uid;

  var result;
  if (crossUser) {
    // Cross-user award via security-definer RPC
    result = await window.sb.rpc('award_trophy_to_winner', {
      p_winner_id:   targetId,
      p_type:        'custom',
      p_custom:      true,
      p_custom_data: customData || {},
      p_context:     context || {},
    });
  } else {
    var row = {
      recipient_user_id: uid,
      type:              'custom',
      custom:            true,
      custom_data:       customData || {},
      context:           context || {},
    };
    result = await window.sb.from('trophies').insert(row).select().single();
  }

  if (result.error) {
    console.warn('[SpontixStoreAsync.awardCustomTrophy] error:', result.error);
    return SpontixStore.awardCustomTrophy(customData, context);
  }
  await SpontixStoreAsync.getTrophies(targetId);
  var trophy = SpontixStore._mapTrophyFromDb(result.data);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('spontix-trophy-earned', { detail: { trophy: trophy } }));
  }
  return trophy;
};

// ── Async league winner trophy awarding ──
// Fetches the league from Supabase, resolves the trophy config, and awards
// it to the winner (cross-user if needed via the RPC).
SpontixStoreAsync.awardLeagueWinnerTrophy = async function (leagueId, winnerUserId) {
  if (!leagueId || !winnerUserId) return null;
  var leagues = await SpontixStoreAsync.getLeagues().catch(function () { return []; });
  var league = leagues.find(function (l) { return l.id === leagueId; });
  if (!league || !league.trophy) return null;

  var ctx = { leagueName: league.name, leagueId: league.id, event: 'League Champion' };
  if (league.trophy.custom) {
    return SpontixStoreAsync.awardCustomTrophy({
      name:      league.trophy.name,
      desc:      league.trophy.desc,
      icon:      league.trophy.icon,
      rarity:    league.trophy.rarity,
    }, ctx, winnerUserId);
  }
  return SpontixStoreAsync.awardTrophy(league.trophy.type, ctx, winnerUserId);
};

// ── Async venue event trophy awarding ──
// Awards a trophy (preset or custom) to a winner player.
// customTrophyOrPresetType: custom trophy object OR preset type string.
SpontixStoreAsync.awardVenueEventTrophy = async function (eventId, winnerUserId, customTrophyOrPresetType) {
  if (!winnerUserId) return null;
  var profile = SpontixStore.getVenueProfile();
  var venueName = profile ? profile.venueName : '';
  var venueId   = profile ? profile.id : null;
  var ctx = { venueName: venueName, venueId: venueId, eventId: eventId };

  if (typeof customTrophyOrPresetType === 'object' && customTrophyOrPresetType) {
    var cd = { ...customTrophyOrPresetType };
    cd.venueName = venueName;
    cd.venueId   = venueId;
    return SpontixStoreAsync.awardCustomTrophy(cd, { ...ctx, event: cd.name }, winnerUserId);
  }
  var presetType = customTrophyOrPresetType || 'venue_event_champion';
  return SpontixStoreAsync.awardTrophy(presetType, { ...ctx, event: presetType }, winnerUserId);
};

// ── Drain the remote trophy queue ──
// The sync layer queues cross-user trophies in localStorage when Supabase
// wasn't available. On next page load (with a live session), we flush them.
SpontixStoreAsync.drainRemoteTrophyQueue = async function () {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) return;
  var key = 'spontix_remote_trophy_queue';
  var queue = [];
  try { queue = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  if (!queue.length) return;

  var remaining = [];
  for (var i = 0; i < queue.length; i++) {
    var item = queue[i];
    try {
      var tc = item.trophy || {};
      var res;
      if (tc.custom) {
        res = await window.sb.rpc('award_trophy_to_winner', {
          p_winner_id:   item.winnerUserId,
          p_type:        'custom',
          p_custom:      true,
          p_custom_data: { name: tc.name, desc: tc.desc, icon: tc.icon, rarity: tc.rarity,
                           venueName: tc.venueName || '', venueId: tc.venueId || null },
          p_context:     item.context || {},
        });
      } else {
        res = await window.sb.rpc('award_trophy_to_winner', {
          p_winner_id:   item.winnerUserId,
          p_type:        tc.type || 'venue_event_champion',
          p_custom:      false,
          p_custom_data: {},
          p_context:     item.context || {},
        });
      }
      if (res.error) {
        console.warn('[drainRemoteTrophyQueue] RPC error — keeping item:', res.error);
        remaining.push(item);
      }
    } catch (e) {
      console.warn('[drainRemoteTrophyQueue] exception — keeping item:', e);
      remaining.push(item);
    }
  }
  localStorage.setItem(key, JSON.stringify(remaining));
};

// ── Venue custom trophies (templates) ──

SpontixStoreAsync.getVenueCustomTrophies = async function (venueId) {
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getVenueCustomTrophies();
  }
  var result = await window.sb
    .from('venue_custom_trophies')
    .select('*')
    .eq('venue_id', vid)
    .order('created_at', { ascending: false });
  if (result.error) {
    console.warn('[SpontixStoreAsync.getVenueCustomTrophies] error:', result.error);
    return SpontixStore.getVenueCustomTrophies();
  }
  var trophies = (result.data || []).map(SpontixStore._mapVenueCustomTrophyFromDb);
  // Enrich with venueName if we have it
  var activeVenue2 = SpontixStore.Session.getCurrentVenue();
  if (activeVenue2) {
    var vName = '';
    var profile = SpontixStore.getVenueProfile();
    if (profile) vName = profile.venueName || '';
    trophies.forEach(function (t) { t.venueName = vName; });
  }
  localStorage.setItem(SpontixStore.KEYS.customTrophies, JSON.stringify(trophies));
  return trophies;
};

SpontixStoreAsync.createVenueCustomTrophy = async function (data) {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };
  var vid = null;
  var activeVenue = SpontixStore.Session.getCurrentVenue();
  if (activeVenue) vid = activeVenue.id;
  if (!vid && typeof window !== 'undefined' && window.sb) {
    var vResult = await window.sb.from('venues').select('id').eq('owner_id', uid).limit(1).maybeSingle();
    if (vResult.data) vid = vResult.data.id;
  }
  if (!vid) return { ok: false, error: 'no-venue' };

  if (typeof window === 'undefined' || !window.sb) {
    var t = SpontixStore.createVenueCustomTrophy(data);
    return { ok: true, data: t };
  }
  var row = SpontixStore._mapVenueCustomTrophyToDb({
    venueId:         vid,
    createdByUserId: uid,
    name:            data.name || 'Custom Trophy',
    desc:            data.desc || '',
    icon:            data.icon || 'custom',
    rarity:          data.rarity || 'rare',
  });
  var result = await window.sb.from('venue_custom_trophies').insert(row).select().single();
  if (result.error) return { ok: false, error: result.error.message };
  await SpontixStoreAsync.getVenueCustomTrophies(vid);
  return { ok: true, data: SpontixStore._mapVenueCustomTrophyFromDb(result.data) };
};

// ══════════════════════════════════════════════════════════════════════
// BADGES — Supabase mapping & async overrides
// ══════════════════════════════════════════════════════════════════════
//   DB stores one row per badge: (user_id, badge_id, progress, earned, earned_at)
//   Client uses a single object: { earned: { badgeId: { date } }, progress: { badgeId: number } }
//   The mapping functions convert between these two shapes.
// ══════════════════════════════════════════════════════════════════════

// Convert an array of DB rows into the client { earned, progress } shape
SpontixStore._mapPlayerBadgesFromDb = function (rows) {
  var result = { earned: {}, progress: {} };
  (rows || []).forEach(function (r) {
    result.progress[r.badge_id] = r.progress || 0;
    if (r.earned) {
      result.earned[r.badge_id] = { date: r.earned_at ? r.earned_at.split('T')[0] : new Date().toISOString().split('T')[0] };
    }
  });
  return result;
};

// Same conversion for venue badges
SpontixStore._mapVenueBadgesFromDb = SpontixStore._mapPlayerBadgesFromDb;

// ── Async player badge overrides ──

SpontixStoreAsync.getPlayerBadges = async function () {
  var uid = SpontixStore.Session.getCurrentUserId();
  if (!uid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getPlayerBadges();
  }
  var result = await window.sb
    .from('player_badges')
    .select('*')
    .eq('user_id', uid);
  if (result.error) {
    console.warn('[SpontixStoreAsync.getPlayerBadges] Supabase error:', result.error);
    return SpontixStore.getPlayerBadges();
  }
  var data = SpontixStore._mapPlayerBadgesFromDb(result.data);
  // Update localStorage cache
  localStorage.setItem(SpontixStore.KEYS.badges, JSON.stringify(data));
  return data;
};

SpontixStoreAsync.checkAndAwardPlayerBadge = async function (badgeId, currentValue) {
  var uid = SpontixStore.Session.getCurrentUserId();
  var badge = SpontixStore.PLAYER_BADGES[badgeId];
  if (!badge || !uid) return false;
  if (typeof window === 'undefined' || !window.sb) {
    return SpontixStore.checkAndAwardPlayerBadge(badgeId, currentValue);
  }
  var earned = currentValue >= badge.threshold;
  var row = {
    user_id:   uid,
    badge_id:  badgeId,
    progress:  currentValue,
    earned:    earned,
  };
  if (earned) row.earned_at = new Date().toISOString();

  // Upsert: insert or update if already exists
  var result = await window.sb
    .from('player_badges')
    .upsert(row, { onConflict: 'user_id,badge_id' });
  if (result.error) {
    console.warn('[SpontixStoreAsync.checkAndAwardPlayerBadge] error:', result.error);
    return SpontixStore.checkAndAwardPlayerBadge(badgeId, currentValue);
  }
  // Refresh cache
  await SpontixStoreAsync.getPlayerBadges();
  return earned;
};

// ── Async venue badge overrides ──

SpontixStoreAsync.getVenueBadges = async function (venueId) {
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.getVenueBadges();
  }
  var result = await window.sb
    .from('venue_badges')
    .select('*')
    .eq('venue_id', vid);
  if (result.error) {
    console.warn('[SpontixStoreAsync.getVenueBadges] Supabase error:', result.error);
    return SpontixStore.getVenueBadges();
  }
  var data = SpontixStore._mapVenueBadgesFromDb(result.data);
  localStorage.setItem(SpontixStore.KEYS.venueBadges, JSON.stringify(data));
  return data;
};

SpontixStoreAsync.checkAndAwardVenueBadge = async function (badgeId, currentValue, venueId) {
  var badge = SpontixStore.VENUE_BADGES[badgeId];
  if (!badge) return false;
  var vid = venueId;
  if (!vid) {
    var activeVenue = SpontixStore.Session.getCurrentVenue();
    vid = activeVenue ? activeVenue.id : null;
  }
  if (!vid || typeof window === 'undefined' || !window.sb) {
    return SpontixStore.checkAndAwardVenueBadge(badgeId, currentValue);
  }
  var earned = currentValue >= badge.threshold;
  var row = {
    venue_id:  vid,
    badge_id:  badgeId,
    progress:  currentValue,
    earned:    earned,
  };
  if (earned) row.earned_at = new Date().toISOString();

  var result = await window.sb
    .from('venue_badges')
    .upsert(row, { onConflict: 'venue_id,badge_id' });
  if (result.error) {
    console.warn('[SpontixStoreAsync.checkAndAwardVenueBadge] error:', result.error);
    return SpontixStore.checkAndAwardVenueBadge(badgeId, currentValue);
  }
  await SpontixStoreAsync.getVenueBadges(vid);
  return earned;
};

// ── Auto-apply avatars on every page ──
// Runs once when the DOM is interactive, and again whenever a profile is saved.
if (typeof window !== 'undefined') {
  // DOMContentLoaded fires before images load, so avatars in static HTML get styled immediately.
  window.addEventListener('DOMContentLoaded', function () {
    if (typeof SpontixStore !== 'undefined' && SpontixStore.applyAvatarsToPage) {
      SpontixStore.applyAvatarsToPage();
    }
  });
  // Re-apply whenever the user saves a new profile photo (fired by saveAvatarChoice).
  window.addEventListener('spontix-profile-refreshed', function () {
    if (typeof SpontixStore !== 'undefined' && SpontixStore.applyAvatarsToPage) {
      SpontixStore.applyAvatarsToPage();
    }
  });
}

// ── Cache warming ──
// On every page load, refresh all domain caches in the background.
// Pages using the sync API see cached data immediately; ~300ms later
// they can re-render with fresh data from Supabase.
if (typeof window !== 'undefined') {
  window.addEventListener('load', function warmCaches() {
    // Defer so the Supabase SDK has time to load and the user can interact
    // with the page before re-renders kick in from fresh data.
    setTimeout(function () {
      if (window.sb) {
        SpontixStoreAsync.getVenues().then(function (venues) {
          window.dispatchEvent(new CustomEvent('spontix-venues-refreshed', { detail: { venues } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getLeagues().then(function (leagues) {
          window.dispatchEvent(new CustomEvent('spontix-leagues-refreshed', { detail: { leagues } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getVenueEvents().then(function (events) {
          window.dispatchEvent(new CustomEvent('spontix-events-refreshed', { detail: { events } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getPlayerBadges().then(function (badges) {
          window.dispatchEvent(new CustomEvent('spontix-player-badges-refreshed', { detail: { badges } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getVenueBadges().then(function (badges) {
          window.dispatchEvent(new CustomEvent('spontix-venue-badges-refreshed', { detail: { badges } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getTrophies().then(function (trophies) {
          window.dispatchEvent(new CustomEvent('spontix-trophies-refreshed', { detail: { trophies } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getVenueCustomTrophies().then(function (trophies) {
          window.dispatchEvent(new CustomEvent('spontix-venue-custom-trophies-refreshed', { detail: { trophies } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getVenuePhotoConfig().then(function (config) {
          window.dispatchEvent(new CustomEvent('spontix-venue-photos-refreshed', { detail: { config } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getReservations().then(function (reservations) {
          window.dispatchEvent(new CustomEvent('spontix-reservations-refreshed', { detail: { reservations } }));
        }).catch(function () { /* silent */ });

        SpontixStoreAsync.getGameHistory().then(function (history) {
          window.dispatchEvent(new CustomEvent('spontix-game-history-refreshed', { detail: { history } }));
        }).catch(function () { /* silent */ });

        // Flush any cross-user trophies that were queued while offline.
        SpontixStoreAsync.drainRemoteTrophyQueue().catch(function () { /* silent */ });

        // Note: getProfile() is intentionally NOT here — it fires immediately in
        // hydrateSessionFromSupabase (on the 'load' event) so the sidebar avatar
        // shows the correct user without the 1500ms cache-warm delay.
      }
    }, 1500);
  });
}

// ══════════════════════════════════════════════════════════════════════
// NOTIFICATIONS — Supabase async overrides
// ══════════════════════════════════════════════════════════════════════
// Notifications are written exclusively by Postgres SECURITY DEFINER
// triggers (005_notifications.sql). These functions only read + mutate
// state — they never insert new notification rows directly.

SpontixStoreAsync.getNotifications = async function (filter) {
  // filter: 'all' | 'live' | 'question' | 'league' | 'social' | 'system'
  if (typeof window === 'undefined' || !window.sb) return [];

  var query = window.sb
    .from('notifications')
    .select('id, type, category, title, body, actor_user_id, related_id, related_type, context, read, created_at')
    .order('created_at', { ascending: false })
    .limit(60);

  if (filter && filter !== 'all') {
    query = query.eq('category', filter);
  }

  var { data, error } = await query;
  if (error) {
    console.warn('[SpontixStoreAsync.getNotifications] error:', error);
    return [];
  }
  return data || [];
};

SpontixStoreAsync.getUnreadNotificationCount = async function () {
  if (typeof window === 'undefined' || !window.sb) return 0;
  var { count, error } = await window.sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('read', false);
  if (error) return 0;
  return count || 0;
};

SpontixStoreAsync.markNotificationRead = async function (notifId) {
  if (typeof window === 'undefined' || !window.sb || !notifId) return;
  await window.sb
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', notifId)
    .eq('read', false);   // no-op if already read
};

SpontixStoreAsync.markAllNotificationsRead = async function () {
  if (typeof window === 'undefined' || !window.sb) return;
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return;
  await window.sb
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('user_id', uid)
    .eq('read', false);
};

SpontixStoreAsync.dismissNotification = async function (notifId) {
  if (typeof window === 'undefined' || !window.sb || !notifId) return;
  await window.sb.from('notifications').delete().eq('id', notifId);
};

SpontixStoreAsync.dismissAllNotifications = async function () {
  if (typeof window === 'undefined' || !window.sb) return;
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return;
  await window.sb.from('notifications').delete().eq('user_id', uid);
};

// ─────────────────────────────────────────────────────────────────────────────
// Saved Matches  (migration 009)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save a football fixture to the user's personal schedule (player) or
 * venue schedule (venue). Returns { ok, data, error }.
 *
 * data shape expected:
 *   { matchId, homeTeam, awayTeam, competition, apiLeagueId, kickoffAt, venueId? }
 */
SpontixStoreAsync.saveMatch = async function (data) {
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };

  const row = {
    user_id:       uid,
    venue_id:      data.venueId || null,
    match_id:      String(data.matchId),
    home_team:     data.homeTeam || '',
    away_team:     data.awayTeam || '',
    competition:   data.competition || null,
    api_league_id: data.apiLeagueId ? parseInt(data.apiLeagueId) : null,
    kickoff_at:    data.kickoffAt || null,
    notes:         data.notes || null,
  };

  if (typeof window === 'undefined' || !window.sb) {
    // Offline fallback — store in localStorage
    const key = 'spontix_saved_matches';
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
    if (!saved.find(s => s.match_id === row.match_id)) {
      saved.unshift({ ...row, id: 'sm_' + Math.random().toString(36).slice(2), created_at: new Date().toISOString() });
      localStorage.setItem(key, JSON.stringify(saved));
    }
    return { ok: true, data: row };
  }

  const { data: result, error } = await window.sb
    .from('saved_matches')
    .insert(row)
    .select()
    .single();

  if (error && error.code === '23505') return { ok: true, data: row, alreadySaved: true }; // unique conflict
  if (error) { console.warn('[saveMatch]', error.message); return { ok: false, error: error.message }; }
  return { ok: true, data: result };
};

/**
 * Remove a saved match by match_id (not the row id).
 */
SpontixStoreAsync.unsaveMatch = async function (matchId) {
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return { ok: false, error: 'no-session' };

  if (typeof window === 'undefined' || !window.sb) {
    const key = 'spontix_saved_matches';
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
    localStorage.setItem(key, JSON.stringify(saved.filter(s => s.match_id !== String(matchId))));
    return { ok: true };
  }

  const { error } = await window.sb
    .from('saved_matches')
    .delete()
    .eq('user_id', uid)
    .eq('match_id', String(matchId));

  if (error) { console.warn('[unsaveMatch]', error.message); return { ok: false, error: error.message }; }
  return { ok: true };
};

/**
 * Get all saved matches for the current user, ordered by kickoff ascending.
 * Pass { venueId } to get venue-specific saves only.
 */
SpontixStoreAsync.getSavedMatches = async function (opts) {
  const uid = SpontixStore.Session.getCurrentUserId();
  if (!uid) return [];

  if (typeof window === 'undefined' || !window.sb) {
    const key = 'spontix_saved_matches';
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
    if (opts && opts.venueId) saved = saved.filter(s => s.venue_id === opts.venueId);
    return saved.sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
  }

  let query = window.sb
    .from('saved_matches')
    .select('*')
    .eq('user_id', uid)
    .order('kickoff_at', { ascending: true });

  if (opts && opts.venueId) {
    query = query.eq('venue_id', opts.venueId);
  }

  const { data, error } = await query;
  if (error) { console.warn('[getSavedMatches]', error.message); return []; }
  return data || [];
};

// Make both available globally so any page can pick its style.
if (typeof window !== 'undefined') {
  window.SpontixStore = SpontixStore;
  window.SpontixStoreAsync = SpontixStoreAsync;
}
