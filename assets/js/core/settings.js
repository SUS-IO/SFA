// Settings an Admin can change without touching code: time limits, categories, payment accounts.
// Put this file in: assets/js/core/settings.js
import { sb, cfg, store } from './supa.js';
import { state } from './store.js';
import { setStaleHours } from './ageing.js';

export const SESSION_KEY = 'sfa_session_hours';
export const ACCOUNT_MODES = ['UPI', 'Online', 'Card', 'Bank Transfer', 'Cheque'];
const DEFAULTS = { session_hours: 6, stale_hours: 4 };
state.settings = { ...DEFAULTS }; state.lists = [];

export function applySettings() {
  const s = state.settings;
  const sh = Number(s.session_hours); if (sh > 0) { cfg.SESSION_HOURS = sh; try { store.setItem(SESSION_KEY, String(sh)); } catch { /* ignore */ } }
  const st = Number(s.stale_hours); if (st > 0) setStaleHours(st);
}
// Loads the numbers and the lists. If the Stage 7 database script has not been run yet, the old fixed values stay in use.
export async function loadSettings() {
  try {
    const [a, b] = await Promise.all([sb.from('app_settings').select('key,value'), sb.from('app_lists').select('*').order('sort').order('label')]);
    if (!a.error && a.data) { const o = { ...DEFAULTS }; a.data.forEach(r => { o[r.key] = Number(r.value); }); state.settings = o; }
    if (!b.error && b.data) state.lists = b.data;
  } catch { /* keep the defaults */ }
  applySettings();
}
const byOrder = (x, y) => (x.sort - y.sort) || String(x.label).localeCompare(String(y.label));
export const listItems = (list, { parent = null, mode = null, all = false } = {}) =>
  (state.lists || []).filter(l => l.list === list && (parent === null ? l.parent_id === null : l.parent_id === parent) && (mode === null || l.mode === mode) && (all || l.active)).sort(byOrder);
export const accountsFor = (mode) => listItems('account', { mode });
export const categoriesFor = (type) => listItems(type === 'Income' ? 'income_category' : 'expense_category');
export const subCategoriesOf = (id) => (state.lists || []).filter(l => l.parent_id === id && l.active).sort(byOrder);
