// ══════════════════════════════════════════════
// SPONTIX — Shared Utilities
// Include on every page: <script src="utils.js"></script>
// ══════════════════════════════════════════════

// ── Toggle Sidebar (mobile) ──
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ── Toast Notification ──
// Supports both .show and .active class names for backward compatibility
function showToast(msg, duration) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  t.classList.add('active');
  setTimeout(() => { t.classList.remove('show'); t.classList.remove('active'); }, duration || 3000);
}

// ── Badge Earned Notification ──
// Listens for badge-earned events fired by SpontixStore after games/actions
window.addEventListener('spontix-badge-earned', function(e) {
  if (!e.detail || !e.detail.badges) return;
  const badgeIds = e.detail.badges;
  if (typeof SpontixStore === 'undefined') return;

  badgeIds.forEach(function(id, idx) {
    const badge = SpontixStore.PLAYER_BADGES[id] || SpontixStore.VENUE_BADGES[id];
    if (!badge) return;
    setTimeout(function() {
      showBadgeNotification(badge);
    }, idx * 2500); // stagger multiple badges
  });
});

function showBadgeNotification(badge) {
  // Create or reuse badge notification element
  let el = document.getElementById('badge-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'badge-notification';
    el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-120px);z-index:9999;' +
      'background:linear-gradient(135deg,#22223A,#2A2A44);border:2px solid #A8E10C;border-radius:16px;padding:16px 24px;' +
      'display:flex;align-items:center;gap:14px;box-shadow:0 12px 40px rgba(0,0,0,0.5),0 0 30px rgba(168,225,12,0.15);' +
      'transition:transform 0.5s cubic-bezier(0.34,1.56,0.64,1);max-width:380px;';
    document.body.appendChild(el);
  }

  var colors = (typeof SpontixStore !== 'undefined' && SpontixStore.BADGE_COLORS[badge.color]) || { bg: 'rgba(168,225,12,0.12)', stroke: '#A8E10C' };
  var iconSvg = (typeof SpontixStore !== 'undefined' && SpontixStore.BADGE_ICONS[badge.icon]) || '';

  el.innerHTML =
    '<div style="width:48px;height:48px;border-radius:50%;background:' + colors.bg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="' + colors.stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconSvg + '</svg>' +
    '</div>' +
    '<div>' +
      '<div style="font-size:0.65rem;font-weight:800;color:#A8E10C;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Badge Earned!</div>' +
      '<div style="font-size:0.95rem;font-weight:700;color:#fff;">' + badge.name + '</div>' +
      '<div style="font-size:0.72rem;color:#8E8E93;">' + badge.desc + '</div>' +
    '</div>';

  // Animate in
  requestAnimationFrame(function() {
    el.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Animate out after 3s
  setTimeout(function() {
    el.style.transform = 'translateX(-50%) translateY(-120px)';
  }, 3000);
}

// ── Trophy Earned Notification ──
window.addEventListener('spontix-trophy-earned', function(e) {
  if (!e.detail || !e.detail.trophy) return;
  var t = e.detail.trophy;
  if (typeof SpontixStore === 'undefined') return;

  var def = t.custom ? { name: t.customData.name, icon: t.customData.icon, rarity: t.customData.rarity, desc: t.customData.desc } :
                       (SpontixStore.TROPHY_TYPES[t.type] || { name: 'Trophy', icon: 'trophy-gold', rarity: 'common', desc: '' });
  var rarity = SpontixStore.TROPHY_RARITY[def.rarity] || SpontixStore.TROPHY_RARITY.common;
  var iconSvg = SpontixStore.TROPHY_ICONS[def.icon] || SpontixStore.TROPHY_ICONS['trophy-gold'];

  // Create trophy notification (bigger than badge notification)
  var el = document.getElementById('trophy-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'trophy-notification';
    el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-160px);z-index:10000;' +
      'background:linear-gradient(135deg,#1A1A2E,#22223A);border:2px solid ' + rarity.color + ';border-radius:20px;padding:20px 28px;' +
      'display:flex;align-items:center;gap:16px;box-shadow:0 16px 50px rgba(0,0,0,0.6),0 0 40px ' + rarity.glow + ';' +
      'transition:transform 0.6s cubic-bezier(0.34,1.56,0.64,1);max-width:420px;';
    document.body.appendChild(el);
  } else {
    el.style.borderColor = rarity.color;
    el.style.boxShadow = '0 16px 50px rgba(0,0,0,0.6),0 0 40px ' + rarity.glow;
  }

  el.innerHTML =
    '<div style="width:56px;height:56px;border-radius:50%;background:' + rarity.glow + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;border:2px solid ' + rarity.color + ';">' +
      '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="' + rarity.color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + iconSvg + '</svg>' +
    '</div>' +
    '<div>' +
      '<div style="font-size:0.6rem;font-weight:800;color:' + rarity.color + ';text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px;">Trophy Earned!</div>' +
      '<div style="font-size:1.05rem;font-weight:800;color:#fff;">' + def.name + '</div>' +
      '<div style="font-size:0.72rem;color:#8E8E93;margin-top:2px;">' + (def.desc || '') + '</div>' +
      '<div style="font-size:0.6rem;font-weight:700;color:' + rarity.color + ';margin-top:4px;">' + rarity.label + '</div>' +
    '</div>';

  requestAnimationFrame(function() {
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(function() {
    el.style.transform = 'translateX(-50%) translateY(-160px)';
  }, 4000);
});
