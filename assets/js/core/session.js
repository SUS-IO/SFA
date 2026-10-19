// Sign in / out, the 6-hour limit, and the first-login password rule.
import { sb, cfg, store } from './supa.js';
import { state } from './store.js';
import { friendlyError } from './ui.js';

const KEY = 'sfa_login_at';
const limitMs = () => (Number(store.getItem('sfa_session_hours')) || Number(cfg.SESSION_HOURS) || 6) * 3600 * 1000;   // the Admin's setting is remembered here after sign-in
export const loginAt = () => Number(store.getItem(KEY)) || 0;
export const msLeft = () => Math.max(0, loginAt() + limitMs() - Date.now());

async function loadProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function signIn(userIdRaw, password) {
  const id = String(userIdRaw || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{2,20}$/.test(id)) throw new Error('Enter your User ID, for example EX1.');
  if (!password) throw new Error('Enter your password.');
  const { data, error } = await sb.auth.signInWithPassword({ email: `${id}@${cfg.EMAIL_DOMAIN}`, password });
  if (error) {
    if (/banned/i.test(error.message)) throw new Error('Your account is switched off. Ask an Admin.');
    throw new Error(friendlyError(error));
  }
  store.setItem(KEY, String(Date.now()));
  const profile = await loadProfile(data.user.id).catch(() => null);
  if (!profile || !profile.active) {
    await sb.auth.signOut();
    store.removeItem(KEY);
    throw new Error(profile ? 'Your account is switched off. Ask an Admin.' : 'Your account is not set up yet. Ask an Admin.');
  }
  state.me = profile;
  return profile;
}

// Called on page load: keep the user signed in only if the 6 hours are not over.
export async function restore() {
  const { data } = await sb.auth.getSession();
  if (!data?.session) return null;
  if (!loginAt() || msLeft() <= 0) { await signOut(); return { expired: true }; }
  const profile = await loadProfile(data.session.user.id).catch(() => null);
  if (!profile || !profile.active) { await signOut(); return null; }
  state.me = profile;
  return profile;
}

export async function signOut() {
  try { await sb.auth.signOut(); } catch { /* ignore */ }
  store.removeItem(KEY);
  state.me = null;
}

export function watchExpiry(onExpire) {
  const check = async () => {
    if (state.me && msLeft() <= 0) { await signOut(); onExpire(); }
  };
  const t = setInterval(check, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  return () => clearInterval(t);
}

export async function changePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendlyError(error));
  const { error: e2 } = await sb.rpc('mark_password_changed');
  if (e2) throw e2;
  if (state.me) state.me.must_change_password = false;
}
