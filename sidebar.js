// ══════════════════════════════════════════════
// SPONTIX — Shared Sidebar
// Usage:  <script src="sidebar.js"></script>
//         <script>SpontixSidebar.init({ type: 'player', active: 'dashboard.html' });</script>
//   or:   <script>SpontixSidebar.init({ type: 'venue', active: 'venue-dashboard.html' });</script>
// ══════════════════════════════════════════════

const SpontixSidebar = {

  // ── Player Navigation ──
  playerNav: [
    { section: 'Main' },
    { label: 'Home', href: 'dashboard.html', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    { label: 'My Leagues', href: 'my-leagues.html', icon: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>', badge: '3', badgeClass: 'lime' },
    { label: 'Discover', href: 'discover.html', icon: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
    { label: 'Create League', href: 'create-league.html', icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>' },

    { section: 'Live' },
    { label: 'Your Games', href: 'activity.html', icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', badge: '2' },
    { label: 'Schedule', href: 'upcoming.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { label: 'Browse Matches', href: 'matches.html', icon: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="12.01"/>' },
    { label: 'Venues & Bars', href: 'venues.html', icon: '<path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M9 21v-4h6v4"/><rect x="9" y="9" width="2" height="2"/><rect x="13" y="9" width="2" height="2"/><rect x="9" y="13" width="2" height="2"/><rect x="13" y="13" width="2" height="2"/>' },

    { section: 'Game Modes' },
    { label: 'Battle Royale', href: 'battle-royale.html', icon: '<circle cx="12" cy="10" r="8"/><path d="M12 18v4"/><path d="M8 22h8"/><circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.5" fill="currentColor" stroke="none"/>', badge: 'BR', badgeStyle: 'background:linear-gradient(135deg,#FF6B6B,#E84545);' },
    { label: 'Trivia', href: 'trivia.html', icon: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },

    { section: 'You' },
    { label: 'Leaderboards', href: 'leaderboard.html', icon: '<path d="M18 20V10M12 20V4M6 20V14"/>' },
    { label: 'Profile', href: 'profile.html', icon: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  ],

  // ── Venue Navigation ──
  venueNav: [
    { section: 'Command Centre' },
    { label: 'Dashboard', href: 'venue-dashboard.html', icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>' },
    { label: 'Live Floor', href: 'venue-live-floor.html', icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', badge: '3' },

    { section: 'Events' },
    { label: "Tonight's Events", href: 'venue-tonights-events.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', badge: '2', badgeClass: 'orange' },
    { label: 'Schedule', href: 'venue-schedule.html', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', minTier: 'venue-pro' },
    { label: 'Create Event', href: 'venue-create-event.html', icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>' },
    { label: 'Question Bank', href: 'venue-questions.html', icon: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>', minTier: 'venue-pro' },

    { section: 'Teams & Tables' },
    { label: 'Teams', href: 'venue-teams.html', icon: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>', minTier: 'venue-pro' },
    { label: 'Table Map', href: 'venue-table-map.html', icon: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/>', minTier: 'venue-pro' },

    { section: 'Insights' },
    { label: 'Analytics', href: 'venue-analytics.html', icon: '<path d="M18 20V10M12 20V4M6 20V14"/>', minTier: 'venue-pro' },
    { label: 'Billing', href: 'venue-billing.html', icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>' },

    { section: 'Venue' },
    { label: 'Profile', href: 'venue-profile.html', icon: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  ],

  // ── Build & Inject Sidebar ──
  init(opts) {
    // opts = { type: 'player'|'venue', active: 'filename.html' }
    const type = opts.type || 'player';
    const active = opts.active || '';
    const nav = type === 'venue' ? this.venueNav : this.playerNav;
    const isVenue = type === 'venue';

    // Determine current tier for nav gating
    const currentTier = (typeof localStorage !== 'undefined' && localStorage.getItem('spontix_user_tier')) || (isVenue ? 'venue-starter' : 'starter');
    const tierRank = { 'starter': 0, 'pro': 1, 'elite': 2, 'venue-starter': 0, 'venue-pro': 1, 'venue-elite': 2 };
    const userRank = tierRank[currentTier] || 0;

    // Build nav links HTML
    let navHTML = '';
    for (const item of nav) {
      if (item.section) {
        navHTML += '<div class="sidebar-section">' + item.section.replace('&', '&amp;') + '</div>\n';
        continue;
      }
      const isActive = active === item.href;
      let badgeHTML = '';
      const isLocked = item.minTier && userRank < (tierRank[item.minTier] || 0);
      if (isLocked) {
        badgeHTML = '<span class="badge" style="background:linear-gradient(135deg,#7C5CFC,#A855F7);font-size:0.5rem;padding:1px 5px;">PRO</span>';
      } else if (item.badge) {
        const cls = item.badgeClass ? ' ' + item.badgeClass : '';
        const style = item.badgeStyle ? ' style="' + item.badgeStyle + '"' : '';
        badgeHTML = '<span class="badge' + cls + '"' + style + '>' + item.badge + '</span>';
      }
      const lockedStyle = isLocked ? ' style="opacity:0.55;"' : '';
      navHTML += '<a href="' + item.href + '" class="sidebar-link' + (isActive ? ' active' : '') + '"' + lockedStyle + '>' +
        '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">' + item.icon + '</svg>' +
        item.label + badgeHTML + '</a>\n';
    }

    // Upgrade box
    let upgradeHTML = '';
    if (isVenue) {
      upgradeHTML = '<div class="sidebar-upgrade">' +
        '<div class="sidebar-upgrade-title">Upgrade to Venue Pro</div>' +
        '<div class="sidebar-upgrade-text">Let AI run your match night — live questions, TV mode, analytics, 150 players.</div>' +
        '<button class="sidebar-upgrade-btn" onclick="showToast(\'Venue upgrade flow coming soon!\')">Upgrade — €29.99/mo</button>' +
        '</div>';
    } else {
      upgradeHTML = '<div class="sidebar-upgrade">' +
        '<div class="sidebar-upgrade-title">Upgrade to Pro</div>' +
        '<div class="sidebar-upgrade-text">Unlock Live Match Predictions — live questions, 1v1 trivia, streak bonuses.</div>' +
        '<button class="sidebar-upgrade-btn">Upgrade — €7.99/mo</button>' +
        '</div>';
    }

    // Profile — read cached player once so name + avatar use the same data
    const _cachedPlayer = !isVenue && typeof SpontixStore !== 'undefined' ? SpontixStore.getPlayer() : null;
    const profileName = isVenue
      ? (typeof SpontixStore !== 'undefined' ? SpontixStore.DEFAULT_VENUE_NAME : 'Arena Bar & Grill')
      : (_cachedPlayer ? (_cachedPlayer.handle || _cachedPlayer.name || '') : '');
    const currentTierLabel = (typeof SpontixStore !== 'undefined' && SpontixStore.getTierLabel) ? SpontixStore.getTierLabel(localStorage.getItem('spontix_user_tier') || (isVenue ? 'venue-starter' : 'starter')) : (isVenue ? 'Venue Starter' : 'Starter');
    const profileTier = currentTierLabel;
    const profileLink = isVenue ? 'venue-profile.html' : 'profile.html';
    const venueClass = isVenue ? ' sidebar-venue' : '';

    // Build avatar HTML — for players, use photo config from store
    let avatarInnerHTML = isVenue ? 'TC' : '';
    let avatarExtraStyle = '';
    if (!isVenue && _cachedPlayer && typeof SpontixStore !== 'undefined' && SpontixStore.getPlayerAvatarStyle) {
      const player = _cachedPlayer;
      const avStyle = SpontixStore.getPlayerAvatarStyle(player);
      if (avStyle.type === 'image') {
        avatarInnerHTML = '<img src="' + avStyle.src + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="' + avStyle.initial + '" />';
        avatarExtraStyle = ' style="background:none;padding:0;"';
      } else {
        avatarInnerHTML = avStyle.initial;
        avatarExtraStyle = ' style="background:' + avStyle.gradient + ';color:' + (avStyle.textColor || 'var(--navy)') + ';"';
      }
    }

    var trophyCountHTML = '';
    if (!isVenue && typeof SpontixStore !== 'undefined') {
      var tCount = SpontixStore.getTrophies().length;
      if (tCount > 0) {
        trophyCountHTML = '<div style="display:flex;align-items:center;gap:4px;margin-top:2px;">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2Z"/></svg>' +
          '<span style="font-size:0.6rem;font-weight:700;color:#FFD700;">' + tCount + '</span></div>';
      }
    }

    const profileHTML = '<a href="' + profileLink + '" class="sidebar-profile" style="text-decoration:none;color:inherit;">' +
      '<div class="sidebar-avatar"' + avatarExtraStyle + '>' + avatarInnerHTML + '</div>' +
      '<div class="sidebar-profile-info">' +
      '<div class="sidebar-profile-name">' + profileName + '</div>' +
      '<div class="sidebar-profile-tier">' + profileTier + '</div>' +
      trophyCountHTML +
      '</div>' +
      '<button onclick="event.preventDefault(); event.stopPropagation(); if (window.SpontixStore && SpontixStore.Session) SpontixStore.Session.logout(); else window.location.href=\'login.html\';" ' +
        'title="Sign out" ' +
        'style="margin-left:auto;background:transparent;border:none;padding:6px;border-radius:6px;cursor:pointer;color:inherit;opacity:0.55;transition:opacity 0.15s,background 0.15s;" ' +
        'onmouseover="this.style.opacity=1;this.style.background=\'rgba(255,255,255,0.06)\'" ' +
        'onmouseout="this.style.opacity=0.55;this.style.background=\'transparent\'">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>' +
        '</svg>' +
      '</button>' +
      '</a>';

    // Logo
    const logoExtra = isVenue ? '<span class="venue-tag">Venue</span>' : '';
    const logoHTML = '<a href="index.html" class="sidebar-logo"><img src="spontyx-logo.svg" alt="Spontyx" class="sidebar-logo-img">' + logoExtra + '</a>';

    // Full sidebar
    const sidebarHTML = '<aside class="sidebar' + venueClass + '" id="sidebar">' +
      logoHTML +
      '<nav class="sidebar-nav">' + navHTML + '</nav>' +
      upgradeHTML +
      profileHTML +
      '</aside>';

    // Find the target: either a placeholder div or inject before .main
    const placeholder = document.getElementById('sidebar-placeholder');
    if (placeholder) {
      placeholder.outerHTML = sidebarHTML;
    } else {
      // Insert at start of body
      document.body.insertAdjacentHTML('afterbegin', sidebarHTML);
    }

    // Hydrate profile from SpontixStore if available
    if (typeof SpontixStore !== 'undefined') {
      if (!isVenue) {
        const player = SpontixStore.getPlayer();
        const nameEl = document.querySelector('.sidebar-profile-name');
        const tierEl = document.querySelector('.sidebar-profile-tier');
        const avatarEl = document.querySelector('.sidebar-avatar');
        const displayName = player.handle || player.name;
        if (nameEl && displayName) nameEl.textContent = displayName;
        if (tierEl) tierEl.textContent = SpontixStore.getTierLabel(localStorage.getItem('spontix_user_tier') || player.tier);
        // Render avatar with photo support
        if (avatarEl && SpontixStore.getPlayerAvatarStyle) {
          SpontixSidebar._applyPlayerAvatar(avatarEl, player);
        } else if (avatarEl && player.avatar) {
          avatarEl.textContent = player.avatar;
        }
        // Hide upgrade box if already pro or elite — use forced tier key, not DB tier
        const _effectiveTier = localStorage.getItem('spontix_user_tier') || player.tier;
        if (_effectiveTier === 'pro' || _effectiveTier === 'elite') {
          const upg = document.querySelector('.sidebar-upgrade');
          if (upg) upg.style.display = 'none';
        }
      } else {
        const venue = SpontixStore.getVenueProfile();
        if (venue) {
          const nameEl = document.querySelector('.sidebar-profile-name');
          const avatarEl = document.querySelector('.sidebar-avatar');
          if (nameEl && venue.venueName) nameEl.textContent = venue.venueName;
          if (avatarEl && venue.venueName) avatarEl.textContent = venue.venueName.substring(0, 2).toUpperCase();
        }
        // Hide upgrade box if venue is pro or elite
        const vTier = localStorage.getItem('spontix_user_tier') || 'venue-starter';
        if (vTier === 'venue-pro' || vTier === 'venue-elite') {
          const upg = document.querySelector('.sidebar-upgrade');
          if (upg) upg.style.display = 'none';
        }
      }
    }

    // Inject upgrade modal CSS + HTML once
    if (!document.getElementById('tier-gate-styles')) {
      const gateCSS = document.createElement('style');
      gateCSS.id = 'tier-gate-styles';
      gateCSS.textContent = `
        .tier-gate-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:none;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;backdrop-filter:blur(4px);}
        .tier-gate-overlay.visible{opacity:1}
        .tier-gate-modal{background:#1A1A2E;border-radius:16px;padding:32px;max-width:420px;width:90%;text-align:center;border:1px solid rgba(124,92,252,0.3);box-shadow:0 20px 60px rgba(0,0,0,0.5);}
        .tier-gate-icon{width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#7C5CFC,#A855F7);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;}
        .tier-gate-title{font-size:1.2rem;font-weight:800;color:#fff;margin-bottom:8px;}
        .tier-gate-desc{font-size:0.85rem;color:#8E8EA0;line-height:1.5;margin-bottom:24px;}
        .tier-gate-desc strong{color:#A8E10C;}
        .tier-gate-btn{display:inline-block;padding:12px 28px;border-radius:10px;font-weight:700;font-size:0.9rem;border:none;cursor:pointer;transition:all .2s;}
        .tier-gate-btn.primary{background:linear-gradient(135deg,#7C5CFC,#A855F7);color:#fff;}
        .tier-gate-btn.primary:hover{transform:translateY(-2px);box-shadow:0 4px 20px rgba(124,92,252,0.4);}
        .tier-gate-btn.secondary{background:transparent;color:#8E8EA0;margin-left:12px;}
        .tier-gate-btn.secondary:hover{color:#fff;}
        .tier-gate-features{text-align:left;margin:0 0 20px;padding:0;list-style:none;}
        .tier-gate-features li{padding:6px 0;font-size:0.8rem;color:#ccc;border-bottom:1px solid rgba(255,255,255,0.05);}
        .tier-gate-features li::before{content:'✓ ';color:#A8E10C;font-weight:700;}
        .tier-locked-banner{background:linear-gradient(135deg,rgba(124,92,252,0.12),rgba(168,225,12,0.06));border:1px solid rgba(124,92,252,0.25);border-radius:14px;padding:32px;text-align:center;margin:24px auto;max-width:560px;}
        .tier-locked-banner h3{font-size:1.1rem;font-weight:800;color:#fff;margin:0 0 8px;}
        .tier-locked-banner p{font-size:0.82rem;color:#8E8EA0;margin:0 0 18px;line-height:1.5;}
        .tier-locked-banner .tier-gate-btn{margin:0 6px;}
      `;
      document.head.appendChild(gateCSS);

      // Upgrade modal container
      const modalDiv = document.createElement('div');
      modalDiv.id = 'tier-gate-overlay';
      modalDiv.className = 'tier-gate-overlay';
      modalDiv.onclick = function(e) { if (e.target === this) SpontixSidebar.closeUpgradeModal(); };
      modalDiv.innerHTML = `<div class="tier-gate-modal">
        <div class="tier-gate-icon" id="tg-icon">🔒</div>
        <div class="tier-gate-title" id="tg-title">Upgrade Required</div>
        <div class="tier-gate-desc" id="tg-desc">This feature requires a higher plan.</div>
        <ul class="tier-gate-features" id="tg-features"></ul>
        <div>
          <button class="tier-gate-btn primary" id="tg-upgrade-btn" onclick="SpontixSidebar.handleUpgrade()">Upgrade Now</button>
          <button class="tier-gate-btn secondary" onclick="SpontixSidebar.closeUpgradeModal()">Maybe Later</button>
        </div>
      </div>`;
      document.body.appendChild(modalDiv);
    }
  },

  // ── Upgrade Modal API ──
  _upgradeTarget: null,

  showUpgradeModal(opts) {
    // opts = { feature, requiredTier, description, benefits[], isVenue, icon }
    const overlay = document.getElementById('tier-gate-overlay');
    if (!overlay) return;
    const isVenue = opts.isVenue || false;
    const tierName = opts.requiredTier || (isVenue ? 'Venue Pro' : 'Pro');
    const price = tierName.includes('Elite')
      ? (isVenue ? '€79.99/mo' : '€19.99/mo')
      : (isVenue ? '€29.99/mo' : '€7.99/mo');

    document.getElementById('tg-icon').textContent = opts.icon || '🔒';
    document.getElementById('tg-title').textContent = 'Upgrade to ' + tierName;
    document.getElementById('tg-desc').innerHTML = opts.description ||
      ('Unlock <strong>' + (opts.feature || 'this feature') + '</strong> and more with ' + tierName + '.');

    const featList = document.getElementById('tg-features');
    featList.innerHTML = '';
    if (opts.benefits && opts.benefits.length) {
      opts.benefits.forEach(b => {
        const li = document.createElement('li');
        li.textContent = b;
        featList.appendChild(li);
      });
    }

    document.getElementById('tg-upgrade-btn').textContent = 'Upgrade — ' + price;
    this._upgradeTarget = isVenue ? 'venue-billing.html' : 'profile.html';

    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('visible'));
  },

  closeUpgradeModal() {
    const overlay = document.getElementById('tier-gate-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    setTimeout(() => overlay.style.display = 'none', 200);
  },

  handleUpgrade() {
    this.closeUpgradeModal();
    window.location.href = this._upgradeTarget || 'profile.html';
  },

  // ── Page-Level Gate: blocks entire page for tier-restricted features ──
  gatePage(opts) {
    // opts = { feature, requiredTier, isVenue, description, benefits[], redirectLabel }
    // Returns true if gated (user cannot access), false if allowed
    if (typeof SpontixStore === 'undefined') return false;
    const tier = (localStorage.getItem('spontix_user_tier') || 'starter');
    const limits = SpontixStore.getTierLimits(tier);
    const featureVal = limits[opts.feature];

    // If the feature is truthy (boolean true or non-zero/non-empty), user can access
    if (featureVal === true || featureVal === 'full' || (typeof featureVal === 'number' && featureVal > 0)) {
      return false; // not gated
    }

    // Feature is locked — replace main content with locked banner
    const mainEl = document.querySelector('.main-content') || document.querySelector('.main') || document.querySelector('.content');
    if (mainEl) {
      mainEl.innerHTML = `
        <div class="tier-locked-banner" style="margin-top:60px;">
          <div style="font-size:48px;margin-bottom:16px;">${opts.icon || '🔒'}</div>
          <h3>${opts.title || (opts.feature + ' requires ' + (opts.requiredTier || 'Pro'))}</h3>
          <p>${opts.description || 'Upgrade your plan to access this feature.'}</p>
          <button class="tier-gate-btn primary" onclick="window.location.href='${opts.isVenue ? 'venue-billing.html' : 'profile.html'}'">
            Upgrade to ${opts.requiredTier || 'Pro'}
          </button>
          <button class="tier-gate-btn secondary" onclick="window.location.href='${opts.isVenue ? 'venue-dashboard.html' : 'dashboard.html'}'">
            Back to Dashboard
          </button>
        </div>`;
    }
    return true; // gated
  },

  // ── Player avatar helper ──
  // Applies the correct visual (image or gradient) to any sidebar-avatar element.
  _applyPlayerAvatar(avatarEl, player) {
    if (!avatarEl || typeof SpontixStore === 'undefined' || !SpontixStore.getPlayerAvatarStyle) return;
    const avStyle = SpontixStore.getPlayerAvatarStyle(player);
    if (avStyle.type === 'image') {
      avatarEl.style.background = 'none';
      avatarEl.style.padding = '0';
      avatarEl.innerHTML = '<img src="' + avStyle.src + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="' + avStyle.initial + '" />';
    } else {
      avatarEl.style.background = avStyle.gradient;
      avatarEl.style.color = avStyle.textColor || 'var(--navy)';
      avatarEl.style.padding = '';
      avatarEl.textContent = avStyle.initial;
    }
  },

  // ── Inline element gate: lock a button/link with upgrade prompt on click ──
  lockElement(el, opts) {
    // opts = { feature, requiredTier, isVenue, description, benefits[], icon }
    if (!el) return;
    el.style.opacity = '0.5';
    el.style.position = 'relative';
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';

    // Add lock badge
    const badge = document.createElement('span');
    badge.textContent = opts.requiredTier || 'Pro';
    badge.style.cssText = 'position:absolute;top:-6px;right:-6px;background:linear-gradient(135deg,#7C5CFC,#A855F7);color:#fff;font-size:0.55rem;font-weight:800;padding:2px 6px;border-radius:6px;text-transform:uppercase;z-index:2;';
    el.style.position = 'relative';
    el.appendChild(badge);

    // Override click
    el.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      SpontixSidebar.showUpgradeModal(opts);
    }, true);
  }
};

// Re-render the sidebar avatar whenever a profile save fires (e.g. from avatar picker).
if (typeof window !== 'undefined') {
  window.addEventListener('spontix-profile-refreshed', function (e) {
    if (typeof SpontixStore === 'undefined') return;
    // Only update if this is a player sidebar (not venue)
    if (document.querySelector('.sidebar-venue')) return;
    var avatarEl = document.querySelector('.sidebar-avatar');
    if (!avatarEl) return;
    // Prefer event.detail.profile (may include photo URL not yet in localStorage)
    var player = (e && e.detail && e.detail.profile) || SpontixStore.getPlayer();
    SpontixSidebar._applyPlayerAvatar(avatarEl, player);
    // Also update name/tier in case they changed
    var nameEl = document.querySelector('.sidebar-profile-name');
    var tierEl = document.querySelector('.sidebar-profile-tier');
    var displayName = player.handle || player.name;
    if (nameEl && displayName) nameEl.textContent = displayName;
    if (tierEl && SpontixStore.getTierLabel) tierEl.textContent = SpontixStore.getTierLabel(localStorage.getItem('spontix_user_tier') || player.tier);
  });
}
