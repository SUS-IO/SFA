// Unfinished forms are kept on this device so work can be continued later.
// Saved per signed-in user. Photos and payment screenshots cannot be kept, so they must be added again.
import { state } from './store.js';
const TTL = 3 * 24 * 3600 * 1000;      // a draft older than 3 days is dropped
const key = (k) => `sfa-draft:${state.me?.id || 'anon'}:${k}`;
export function saveDraft(k, data) {
  try { localStorage.setItem(key(k), JSON.stringify({ v: 1, at: Date.now(), data })); return true; } catch { return false; }
}
export function loadDraft(k) {
  try {
    const raw = localStorage.getItem(key(k)); if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || Date.now() - o.at > TTL) { localStorage.removeItem(key(k)); return null; }
    return o;
  } catch { return null; }
}
export function clearDraft(k) { try { localStorage.removeItem(key(k)); } catch { /* ignore */ } }
// remove every draft of this user (used when signing out is not wanted; kept for completeness)
export function clearAllDrafts() { try { const p = `sfa-draft:${state.me?.id || 'anon'}:`; Object.keys(localStorage).filter(x => x.startsWith(p)).forEach(x => localStorage.removeItem(x)); } catch { /* ignore */ } }
