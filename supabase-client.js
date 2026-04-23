// ══════════════════════════════════════════════════════════════════════
// SPONTIX — Supabase Client
// ══════════════════════════════════════════════════════════════════════
// Include on every page AFTER the Supabase CDN script tag:
//
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase-client.js"></script>
//
// After load, `window.sb` is the ready-to-use Supabase client. Example:
//
//   const { data, error } = await sb.from('venues').select('*');
//
// ══════════════════════════════════════════════════════════════════════

(function () {
  // ── Configuration ──
  // These values are safe to ship to the browser. The publishable key is
  // designed to be public — security is enforced by Postgres Row Level
  // Security policies, not by key secrecy.
  const SUPABASE_URL = 'https://hdulhffpmuqepoqstsor.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_P-FAJ7Jp5IomFiiqEfB_qg_PKv24KS5';

  if (typeof window === 'undefined') return;

  if (!window.supabase || !window.supabase.createClient) {
    console.error(
      '[supabase-client] window.supabase not found. Did you include the Supabase CDN script BEFORE supabase-client.js?\n' +
      'Add: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'
    );
    return;
  }

  // ── Create the client ──
  // autoRefreshToken + persistSession make auth "just work" across tabs and
  // page reloads. detectSessionInUrl enables OAuth redirect callbacks later.
  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  // Small debug helper — call sbPing() from the browser console to test the
  // connection. Returns a Promise that resolves to either venue rows or an error.
  window.sbPing = async function () {
    const { data, error } = await window.sb
      .from('venues')
      .select('id, venue_name, city')
      .limit(20);
    if (error) {
      console.error('[sbPing] failed:', error);
      return { ok: false, error };
    }
    console.log('[sbPing] ok — rows:', data);
    return { ok: true, data };
  };

  console.log('[supabase-client] ready. Call sbPing() to test the connection.');
})();
