// Ageing of vehicles and helmets that are not with a customer, and the "needs an update" popup.
// Put this file in: assets/js/core/ageing.js
import { h, btn, openSheet } from './ui.js';
import { rpc } from './supa.js';
import { state, can, placeOf } from './store.js';

export const STALE_HOURS = 4;          // an asset not updated for this long needs attention
const CHECK_EVERY_MS = 5 * 60 * 1000;  // how often the popup looks
const SNOOZE_MIN = 30;                 // "remind me later"

export const ageHours = (ts) => (ts ? Math.max(0, (Date.now() - new Date(ts).getTime()) / 3600000) : Infinity);
export function fmtAge(hours) {
  if (!Number.isFinite(hours)) return 'Never';
  const mins = Math.max(1, Math.round(hours * 60));
  if (mins < 60) return `${mins} min`;
  if (mins < 24 * 60) { const hh = Math.floor(mins / 60), mm = mins % 60; return mm ? `${hh} h ${mm} min` : `${hh} h`; }
  const d = Math.floor(mins / 1440), hh = Math.round((mins - d * 1440) / 60);
  return hh ? `${d} d ${hh} h` : `${d} d`;
}
export async function fetchBoard() { return (await rpc('asset_board', {})) || []; }

// Small stylesheet for the Asset movement screen and the popup (kept here so no CSS file has to change).
export function ensureAgeingStyles() {
  if (document.getElementById('mv-styles')) return;
  const css = `
.mv-bar{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;padding:.6rem .9rem;margin:.75rem 0;border:1px solid rgba(128,128,128,.35);border-radius:12px;background:rgba(128,128,128,.1);position:sticky;top:.5rem;z-index:5}
.mv-bar[hidden]{display:none}
.mv-bar strong{margin-right:auto}
.mv-table{border:1px solid rgba(128,128,128,.28);border-radius:12px;overflow:hidden;margin-top:.5rem}
.mv-row{display:grid;grid-template-columns:36px minmax(80px,.9fr) minmax(90px,.9fr) minmax(130px,1.2fr) minmax(150px,1.4fr) minmax(120px,1.1fr) minmax(110px,.9fr);gap:.75rem;align-items:center;padding:.65rem .9rem;border-top:1px solid rgba(128,128,128,.2)}
.mv-row.nm{grid-template-columns:36px minmax(80px,.9fr) minmax(130px,1.2fr) minmax(150px,1.4fr) minmax(120px,1.1fr) minmax(110px,.9fr)}
.mv-row.mv-head{border-top:0;font-size:.8rem;font-weight:600;opacity:.75}
.mv-row.stale{background:rgba(242,106,141,.09)}
.mv-row small{display:block;opacity:.72;margin-top:.1rem}
.mv-row input[type=checkbox]{width:18px;height:18px}
.mv-c{min-width:0;overflow-wrap:anywhere}
.mv-hist{display:inline-block;margin-left:.5rem;font-size:.85rem}
.mv-pop{list-style:none;margin:.75rem 0 0;padding:0}
.mv-pop li{display:flex;gap:.75rem;align-items:baseline;padding:.4rem 0;border-top:1px solid rgba(128,128,128,.2)}
.mv-pop li span:nth-child(2){flex:1;opacity:.8}
.mv-age{font-weight:600;color:#C2365A}
@media (max-width:760px){
  .mv-row,.mv-row.nm{grid-template-columns:30px 1fr auto}
  .mv-row.mv-head{display:none}
  .mv-row>*:nth-child(n+4){grid-column:2 / -1}
}`;
  const el = document.createElement('style'); el.id = 'mv-styles'; el.textContent = css; document.head.append(el);
}

// ---------------------------------------------------------------- popup watcher
let timer = null, first = null, popupOpen = false, snoozeUntil = 0;
try { snoozeUntil = Number(sessionStorage.getItem('mv_snooze') || 0) || 0; } catch { /* ignore */ }
const snooze = () => { snoozeUntil = Date.now() + SNOOZE_MIN * 60000; try { sessionStorage.setItem('mv_snooze', String(snoozeUntil)); } catch { /* ignore */ } };

async function check() {
  if (popupOpen || document.hidden || !state.me || !can.approve() || Date.now() < snoozeUntil) return;
  const rows = (await fetchBoard()).filter(r => ageHours(r.last_at) >= STALE_HOURS);
  if (!rows.length || popupOpen) return;
  rows.sort((a, b) => new Date(a.last_at) - new Date(b.last_at));
  showPopup(rows);
}
const onVisible = () => { if (!document.hidden) check().catch(() => {}); };

export function startAgeingWatch() {
  stopAgeingWatch();
  if (!state.me || !can.approve()) return;          // Approver, Manager, Admin, Superadmin
  first = setTimeout(() => check().catch(() => {}), 4000);
  timer = setInterval(() => check().catch(() => {}), CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
}
export function stopAgeingWatch() {
  clearTimeout(first); clearInterval(timer); first = timer = null;
  document.removeEventListener('visibilitychange', onVisible);
}

function showPopup(rows) {
  popupOpen = true;
  const v = rows.filter(r => r.kind === 'vehicle').length, hm = rows.length - v;
  const parts = [v ? `${v} vehicle${v === 1 ? '' : 's'}` : null, hm ? `${hm} helmet${hm === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
  const where = (r) => placeOf({ current_state: r.current_state, current_location_id: r.location_id, current_location_text: r.location_text }).label;
  const s = openSheet({
    title: 'Assets need an update',
    onClose: () => { popupOpen = false; snooze(); },
    body: h('div', { class: 'confirm' },
      h('p', `${parts} ${rows.length === 1 ? 'has' : 'have'} not been updated for more than ${STALE_HOURS} hours. Please check them and update.`),
      h('ul', { class: 'mv-pop' },
        rows.slice(0, 8).map(r => h('li', null, h('strong', r.code), h('span', where(r)), h('span', { class: 'mv-age' }, fmtAge(ageHours(r.last_at))))),
        rows.length > 8 ? h('li', null, h('span', `and ${rows.length - 8} more`)) : null)),
    footer: [btn(`Remind me in ${SNOOZE_MIN} minutes`, { onClick: () => s.close() }),
      btn('Review now', { kind: 'primary', ic: 'eye', onClick: () => { s.close(); location.hash = '#/movement?stale=1'; } })],
  });
  s.el.classList.add('dialog');
}
