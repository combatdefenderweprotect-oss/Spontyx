// ══════════════════════════════════════════════
// SPONTYX — Sidebar action popups
// Provides Notifications · Messages · Support popups anchored to the
// sidebar profile-footer action buttons rendered by sidebar.js.
// Load AFTER sidebar.js: <script src="chat-popups.js"></script>
// Notifications use real data from the `notifications` table.
// Messages + Support are mock data — clearly labeled — until backend
// ships. Replacing mocks is a single function rewrite.
// ══════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──
  var openPopup     = null;        // 'notifications' | 'messages' | 'support' | null
  var notifData     = [];          // populated from Supabase
  var unreadNotif   = 0;
  var quickReplyOpenFor = null;    // conversation id

  // ── Mock data (clearly labeled — replace when backend ships) ──
  var MOCK_CONVERSATIONS = [
    { id: 'c1', kind: 'dm',     name: 'Marcus K.',           handle: '@marc_predicts', color: 'purple', unread: 2,
      last: 'You owe me a rematch in BR 😤', time: '2m ago' },
    { id: 'c2', kind: 'league', name: 'LaLiga Legends 24/25', leagueId: 'L1',           color: 'lime',   unread: 5,
      last: 'Jake R: who else picked Vinícius for the equaliser?', time: '14m ago' },
    { id: 'c3', kind: 'dm',     name: 'Ines L.',             handle: '@ines_trivia',   color: 'coral',  unread: 0,
      last: 'gg, see you next week', time: 'Yesterday' },
    { id: 'c4', kind: 'league', name: 'UCL Knockout Crew',   leagueId: 'L2',           color: 'purple', unread: 0,
      last: 'Marcus T: fixture moved to Wed 8pm', time: '2d ago' },
    { id: 'c5', kind: 'dm',     name: 'Jake R.',             handle: '@jake_risky',    color: 'teal',   unread: 0,
      last: 'You took the corners over again you maniac', time: '3d ago' },
  ];

  var MOCK_SUPPORT_INBOX = [
    { id: 's1', title: 'Welcome to Spontyx Beta',
      body: 'Thanks for joining the beta. Reach out any time using the form below — we read every message.',
      time: 'Today', unread: true },
    { id: 's2', title: 'Pro Trial active',
      body: 'You have full Pro features for 14 days. After that you stay on Pro at €7.99/mo or roll back to Starter.',
      time: '2d ago', unread: false },
  ];

  // ── Helpers ──
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function timeAgo(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var diff = Math.max(0, Date.now() - t) / 1000;
    if (diff < 60)        return Math.floor(diff) + 's ago';
    if (diff < 3600)      return Math.floor(diff / 60)   + 'm ago';
    if (diff < 86400)     return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return new Date(t).toLocaleDateString();
  }

  // ── Notification icon by event type ──
  var NOTIF_ICON = {
    member_joined:    { letter: '👥', cls: '' },
    question_new:     { letter: '?',  cls: 'teal' },
    question_resolved:{ letter: '✓',  cls: '' },
    trophy_awarded:   { letter: '🏆', cls: 'coral' },
    badge_earned:     { letter: '🎖', cls: 'purple' },
  };
  function iconFor(type) { return NOTIF_ICON[type] || { letter: '•', cls: '' }; }

  // ── Real notifications query (uses existing `notifications` table) ──
  async function loadNotifications() {
    notifData = [];
    if (typeof window.sb === 'undefined' || !window.sb) return;
    if (typeof SpontixStore === 'undefined' || !SpontixStore.Session) return;
    var uid = SpontixStore.Session.getCurrentUserId();
    if (!uid) return;
    try {
      var r = await window.sb
        .from('notifications')
        .select('id, kind, title, body, is_read, created_at, context')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(15);
      if (r && r.data) {
        notifData = r.data;
        unreadNotif = notifData.filter(function (n) { return !n.is_read; }).length;
        renderBadge('sb-notif-badge', unreadNotif);
      }
    } catch (e) {
      console.warn('[popups] notifications load failed', e);
    }
  }

  function renderBadge(id, n) {
    var b = el(id);
    if (!b) return;
    if (!n || n <= 0) { b.hidden = true; b.textContent = ''; }
    else { b.hidden = false; b.textContent = n > 9 ? '9+' : String(n); }
  }

  // ── Mark all notifications read ──
  async function markAllNotificationsRead() {
    if (!notifData.length) return;
    var ids = notifData.filter(function (n) { return !n.is_read; }).map(function (n) { return n.id; });
    if (!ids.length) return;
    try {
      await window.sb.from('notifications').update({ is_read: true }).in('id', ids);
      notifData.forEach(function (n) { n.is_read = true; });
      unreadNotif = 0;
      renderBadge('sb-notif-badge', 0);
      renderNotificationsBody();
    } catch (e) { console.warn('[popups] mark-read failed', e); }
  }

  // ── Render bodies ──
  function renderNotificationsBody() {
    var body = el('sb-popup-notifications-body');
    if (!body) return;
    if (!notifData.length) {
      body.innerHTML = '<div class="sb-row-empty">No notifications yet — play a match to start the buzz.</div>';
      return;
    }
    body.innerHTML = notifData.slice(0, 8).map(function (n) {
      var icn = iconFor(n.kind);
      return ''
        + '<div class="sb-row' + (n.is_read ? '' : ' unread') + '">'
        +   '<div class="sb-row-icon ' + icn.cls + '">' + icn.letter + '</div>'
        +   '<div class="sb-row-info">'
        +     '<div class="sb-row-title">' + esc(n.title || 'Update') + '</div>'
        +     (n.body ? '<div class="sb-row-sub">' + esc(n.body) + '</div>' : '')
        +     '<div class="sb-row-time">' + esc(timeAgo(n.created_at)) + '</div>'
        +   '</div>'
        + '</div>';
    }).join('');
  }

  function renderMessagesBody() {
    var body = el('sb-popup-messages-body');
    if (!body) return;
    var unread = MOCK_CONVERSATIONS.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    renderBadge('sb-msg-badge', unread);
    body.innerHTML = MOCK_CONVERSATIONS.map(function (c) {
      var initials = c.name.split(' ').map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase();
      var kindBadge = c.kind === 'league'
        ? '<span style="font-size:0.55rem;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--purple);margin-left:6px;">League</span>'
        : '';
      return ''
        + '<div class="sb-row' + (c.unread ? ' unread' : '') + '" data-conv="' + esc(c.id) + '">'
        +   '<div class="sb-row-icon ' + esc(c.color) + '">' + esc(initials) + '</div>'
        +   '<div class="sb-row-info">'
        +     '<div class="sb-row-title">' + esc(c.name) + kindBadge + '</div>'
        +     '<div class="sb-row-sub">' + esc(c.last) + '</div>'
        +     '<div class="sb-row-time">' + esc(c.time) + (c.unread ? ' · <span style="color:var(--lime);font-weight:700;">' + c.unread + ' new</span>' : '') + '</div>'
        +   '</div>'
        + '</div>'
        + '<div class="sb-row-quickreply" data-reply-for="' + esc(c.id) + '">'
        +   '<input type="text" placeholder="Quick reply to ' + esc(c.name) + '…" />'
        +   '<button type="button">Send</button>'
        + '</div>';
    }).join('');

    // Wire quick-reply: click row → toggle inline reply input below it
    body.querySelectorAll('.sb-row[data-conv]').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-conv');
        body.querySelectorAll('.sb-row-quickreply').forEach(function (q) {
          q.classList.toggle('open', q.getAttribute('data-reply-for') === id && quickReplyOpenFor !== id);
        });
        quickReplyOpenFor = (quickReplyOpenFor === id) ? null : id;
      });
    });
    body.querySelectorAll('.sb-row-quickreply button').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var input = btn.previousElementSibling;
        if (input && input.value.trim()) {
          showToast('Sent (demo) — wire backend in a future sprint');
          input.value = '';
          var wrap = btn.closest('.sb-row-quickreply');
          if (wrap) wrap.classList.remove('open');
        }
      });
    });
  }

  function renderSupportBody() {
    var body = el('sb-popup-support-body');
    if (!body) return;
    var inboxRows = MOCK_SUPPORT_INBOX.map(function (m) {
      return ''
        + '<div class="sb-row' + (m.unread ? ' unread' : '') + '">'
        +   '<div class="sb-row-icon coral">!</div>'
        +   '<div class="sb-row-info">'
        +     '<div class="sb-row-title">' + esc(m.title) + '</div>'
        +     '<div class="sb-row-sub">' + esc(m.body) + '</div>'
        +     '<div class="sb-row-time">' + esc(m.time) + '</div>'
        +   '</div>'
        + '</div>';
    }).join('');
    body.innerHTML = ''
      + '<div class="sb-support-section-title">Inbox from Spontyx</div>'
      + inboxRows
      + '<div class="sb-support-section-title">Contact support</div>'
      + '<div class="sb-support">'
      +   '<textarea placeholder="What can we help with? Bug, feature request, anything…"></textarea>'
      +   '<div class="sb-support-actions">'
      +     '<button type="button" class="sb-support-send">Send to support</button>'
      +   '</div>'
      + '</div>';
    body.querySelector('.sb-support-send').addEventListener('click', function () {
      var ta = body.querySelector('textarea');
      if (ta && ta.value.trim()) {
        showToast('Thanks — we\'ll get back to you soon (demo)');
        ta.value = '';
      }
    });
  }

  // ── Open / close popup ──
  function openPopupKind(kind) {
    closeAllPopups();
    openPopup = kind;
    var p = el('sb-popup-' + kind);
    if (p) p.classList.add('show');
    var btn = document.querySelector('.sb-action[data-popup="' + kind + '"]');
    if (btn) btn.classList.add('is-open');

    if (kind === 'notifications') { loadNotifications().then(renderNotificationsBody); }
    if (kind === 'messages')      { renderMessagesBody(); }
    if (kind === 'support')       { renderSupportBody(); }
  }
  function closeAllPopups() {
    document.querySelectorAll('.sb-popup').forEach(function (p) { p.classList.remove('show'); });
    document.querySelectorAll('.sb-action').forEach(function (b) { b.classList.remove('is-open'); });
    openPopup = null;
    quickReplyOpenFor = null;
  }
  function togglePopup(kind) {
    if (openPopup === kind) closeAllPopups();
    else                    openPopupKind(kind);
  }

  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tmo);
    t._tmo = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  // ── Inject popup containers ──
  function injectPopups() {
    if (document.getElementById('sb-popup-notifications')) return;
    var html = ''
      // Notifications
      + '<div class="sb-popup" id="sb-popup-notifications" role="dialog" aria-label="Notifications">'
      +   '<div class="sb-popup-head">'
      +     '<div class="sb-popup-title">🔔 Notifications</div>'
      +     '<button class="sb-popup-mark-read" type="button" id="sb-mark-all-notif">Mark all read</button>'
      +   '</div>'
      +   '<div class="sb-popup-list" id="sb-popup-notifications-body"><div class="sb-row-empty">Loading…</div></div>'
      +   '<div class="sb-popup-foot"><a href="notifications.html">View all notifications →</a></div>'
      + '</div>'
      // Messages
      + '<div class="sb-popup" id="sb-popup-messages" role="dialog" aria-label="Messages">'
      +   '<div class="sb-popup-head">'
      +     '<div class="sb-popup-title">✉️ Messages</div>'
      +   '</div>'
      +   '<div class="sb-popup-list" id="sb-popup-messages-body"></div>'
      +   '<div class="sb-demo-note">Demo data — backend ships in a future sprint.</div>'
      +   '<div class="sb-popup-foot"><a href="message-center.html">Open Message Center →</a></div>'
      + '</div>'
      // Support
      + '<div class="sb-popup" id="sb-popup-support" role="dialog" aria-label="Support">'
      +   '<div class="sb-popup-head">'
      +     '<div class="sb-popup-title">🛟 Support</div>'
      +   '</div>'
      +   '<div class="sb-popup-list" id="sb-popup-support-body"></div>'
      +   '<div class="sb-demo-note">Demo data — support backend ships in a future sprint.</div>'
      + '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  // ── Wire triggers ──
  function wire() {
    injectPopups();

    document.querySelectorAll('.sb-action[data-popup]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        togglePopup(btn.getAttribute('data-popup'));
      });
    });

    var markBtn = document.getElementById('sb-mark-all-notif');
    if (markBtn) markBtn.addEventListener('click', markAllNotificationsRead);

    // Click outside closes
    document.addEventListener('click', function (e) {
      if (!openPopup) return;
      var inside = e.target.closest('.sb-popup, .sb-action');
      if (!inside) closeAllPopups();
    });

    // ESC closes
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openPopup) closeAllPopups();
    });

    // Initial badge load (no popup open)
    loadNotifications();
    // Mock messages count seeded immediately
    var unreadMsg = MOCK_CONVERSATIONS.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    renderBadge('sb-msg-badge', unreadMsg);
  }

  // Sidebar renders on DOMContentLoaded; wire on the next tick to ensure
  // .sb-action buttons exist in the DOM.
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(wire, 0); });
    } else {
      setTimeout(wire, 0);
    }
  }
  init();

  // Expose for debugging
  window.SpontixPopups = {
    open:  openPopupKind,
    close: closeAllPopups,
    refreshNotifications: function () { loadNotifications().then(renderNotificationsBody); },
  };
})();
