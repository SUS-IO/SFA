// Supabase client. The login is kept in localStorage, so closing the tab or the browser does NOT sign the user out.
// The person is signed out only when the session length set by the Admin (Settings > Time limits, default 6 hours) is over (session.js).
const C = Object.assign({ APP_NAME: 'SFA Bike', EMAIL_DOMAIN: 'sfabike.app', SESSION_HOURS: 6 }, window.SFA_CONFIG || {});
export const cfg = C;
export const configured = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY && !/YOUR[-_]|PASTE_/.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY));

function sessionStore() {
  try { const k = '__t'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return window.localStorage; }
  catch { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; }
}
export const store = sessionStore();

export const sb = configured
  ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      auth: { storage: store, storageKey: 'sfa-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

// Fetch every row of a query, past the 1000-row API limit.
export async function fetchAll(makeQuery, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await makeQuery().range(from, from + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}
export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}
