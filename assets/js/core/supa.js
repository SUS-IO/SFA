// Supabase client. The login lives in sessionStorage, so closing the tab or
// browser signs the user out. A 6-hour limit (session.js) applies on top.
const C = Object.assign({ APP_NAME: 'SFA Bike', EMAIL_DOMAIN: 'sfabike.app', SESSION_HOURS: 6 }, window.SFA_CONFIG || {});
export const cfg = C;
export const configured = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY && !/YOUR-/.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY));

function sessionStore() {
  try { const k = '__t'; window.sessionStorage.setItem(k, '1'); window.sessionStorage.removeItem(k); return window.sessionStorage; }
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
