// A table that sorts when you click a column heading, can tick rows, and can be downloaded as a CSV (opens in Excel).
// Put this file in: assets/js/core/table.js
import { h } from './ui.js';

let styled = false;
export function ensureTableStyles() {
  if (styled || typeof document === 'undefined') return; styled = true;
  const el = document.createElement('style'); el.id = 'dt-styles';
  el.textContent = `
.dt-wrap{border:1px solid var(--line,#e3e6eb);border-radius:16px;overflow:auto;max-height:calc(100vh - 250px);min-height:200px;margin-top:.5rem;background:#fff;box-shadow:var(--shadow,none)}
.dt{width:100%;border-collapse:separate;border-spacing:0;font-size:.92rem;min-width:900px}
.dt th,.dt td{padding:.7rem .85rem;text-align:left;vertical-align:top;border-top:1px solid var(--line,#e3e6eb)}
.dt thead th{position:sticky;top:0;z-index:2;border-top:0;background:#F1F3F6;color:var(--charcoal,#3b424c);font-size:.74rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;box-shadow:inset 0 -2px 0 var(--line-2,#cdd2d9)}
.dt th button{all:unset;cursor:pointer;display:inline-flex;gap:.35rem;align-items:center;letter-spacing:inherit;text-transform:inherit}
.dt th button:hover{color:var(--crimson,#8e1a2d)}
.dt th button:focus-visible{outline:2px solid var(--crimson,#8e1a2d);outline-offset:2px}
.dt th .arr{opacity:.35;font-size:.7rem}
.dt th[aria-sort="ascending"],.dt th[aria-sort="descending"]{color:var(--crimson,#8e1a2d);background:#F9E9EC;box-shadow:inset 0 -3px 0 var(--crimson,#8e1a2d)}
.dt th[aria-sort="ascending"] .arr,.dt th[aria-sort="descending"] .arr{opacity:1}
.dt tbody tr:nth-child(even) td{background:#FAFBFC}
.dt td.sorted{background:rgba(142,26,45,.05)!important;font-weight:600}
.dt td small{display:block;opacity:.72;margin-top:.1rem}
.dt td.nowrap{white-space:nowrap}
.dt tr.hot td{background:rgba(232,89,12,.09)!important}
.dt tr.clk{cursor:pointer}
.dt tr.clk:hover td{background:#F7ECEE!important}
.dt tr.sel td{background:rgba(142,26,45,.12)!important}
.dt .ck{width:34px}
.dt input[type=checkbox]{width:18px;height:18px;accent-color:var(--crimson,#8e1a2d)}
.dt-empty{padding:2rem;text-align:center;opacity:.75}
.dt-count{font-size:.8rem;color:var(--ink-2,#66707b);margin:.25rem .1rem}
`;
  document.head.append(el);
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
const blank = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));
function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator ? collator.compare(String(a), String(b)) : String(a).localeCompare(String(b));
}

// columns: [{ key, label, sort: (row) => number|string|null  (omit for a column that cannot sort), render: (row) => Node|string,
//             csv: (row) => string (default: the sort value), nowrap }]
export function dataTable({ columns, rowKey = 'id', defaultSort = null, selectable = false, selected = new Set(), onSelect = null, rowClass = null,
  empty = 'Nothing to show.', storageKey = null, rowClick = null, serverKeys = null, onServerSort = null }) {
  ensureTableStyles();
  let rows = [], sort = defaultSort ? { ...defaultSort } : null, shown = [];
  let serverMode = false;           // when on, columns named in serverKeys are sorted by the owner (database), not here
  if (storageKey) { try { const s = JSON.parse(sessionStorage.getItem(`dt:${storageKey}`) || 'null'); if (s && columns.some(c => c.key === s.key && c.sort)) sort = s; } catch { /* ignore */ } }
  const head = h('thead'), body = h('tbody'), table = h('table', { class: 'dt' }, head, body), el = h('div', { class: 'dt-wrap' }, table);
  let allBox = null;

  const sorted = () => {
    const col = sort && columns.find(c => c.key === sort.key && c.sort);
    if (!col || (serverMode && serverKeys && serverKeys[sort.key])) return [...rows];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return rows.map((r, i) => ({ r, i, v: col.sort(r) })).sort((x, y) => {
      const bx = blank(x.v), by = blank(y.v);
      if (bx || by) return bx && by ? x.i - y.i : bx ? 1 : -1;       // empty values always last
      return (compare(x.v, y.v) * dir) || (x.i - y.i);
    }).map(o => o.r);
  };
  function setSort(key) {
    sort = sort && sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
    if (storageKey) { try { sessionStorage.setItem(`dt:${storageKey}`, JSON.stringify(sort)); } catch { /* ignore */ } }
    if (serverMode && serverKeys && serverKeys[sort.key]) { paintHead(); onServerSort?.(serverKeys[sort.key], sort.dir); return; }
    paint();
  }
  function paintHead() {
    allBox = selectable ? h('input', { type: 'checkbox', 'aria-label': 'Select all shown', on: { change: (e) => { shown.forEach(r => (e.target.checked ? selected.add(r[rowKey]) : selected.delete(r[rowKey]))); paint(); onSelect?.(); } } }) : null;
    head.replaceChildren(h('tr', selectable ? h('th', { class: 'ck' }, allBox) : null, columns.map(c => {
      const on = sort && sort.key === c.key;
      return h('th', { scope: 'col', 'aria-sort': on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        c.sort ? h('button', { type: 'button', title: 'Click to sort', on: { click: () => setSort(c.key) } }, c.label, h('span', { class: 'arr', 'aria-hidden': 'true' }, on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕')) : c.label);
    })));
  }
  function paint() {
    shown = sorted(); paintHead();
    if (!shown.length) { body.replaceChildren(h('tr', h('td', { colspan: String(columns.length + (selectable ? 1 : 0)), class: 'dt-empty' }, empty))); return; }
    body.replaceChildren(...shown.map(r => {
      const k = r[rowKey]; const cls = [rowClass?.(r) || '', selected.has(k) ? 'sel' : ''].join(' ').trim();
      const box = selectable ? h('input', { type: 'checkbox', 'aria-label': 'Select row', on: { change: (e) => { e.target.checked ? selected.add(k) : selected.delete(k); tr.classList.toggle('sel', e.target.checked); syncAll(); onSelect?.(); } } }) : null;
      if (box) box.checked = selected.has(k);
      const tr = h('tr', { class: cls + (rowClick ? ' clk' : ''), on: rowClick ? { click: (e) => { if (e.target.closest('a,button,input,select,label')) return; rowClick(r); } } : {} }, selectable ? h('td', { class: 'ck' }, box) : null, columns.map(c => h('td', { class: c.nowrap ? 'nowrap' : '' }, c.render ? c.render(r) : String(c.sort?.(r) ?? ''))));
      return tr;
    }));
    if (sort && columns.some(c => c.key === sort.key && c.sort)) { const ci = columns.findIndex(c => c.key === sort.key) + (selectable ? 1 : 0) + 1; body.querySelectorAll(`tr > td:nth-child(${ci})`).forEach(td => td.classList.add('sorted')); }
    syncAll();
  }
  function syncAll() { if (allBox) allBox.checked = shown.length > 0 && shown.every(r => selected.has(r[rowKey])); }
  function toCsv() {
    const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cols = columns.filter(c => c.csv || c.sort);
    return '﻿' + [cols.map(c => esc(c.label)).join(','), ...sorted().map(r => cols.map(c => esc(c.csv ? c.csv(r) : (() => { const v = c.sort(r); return blank(v) ? '' : v; })())).join(','))].join('\r\n');
  }
  function download(name = 'table') {
    const url = URL.createObjectURL(new Blob([toCsv()], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `${name}.csv` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  paint();
  return { el, setServerMode(on) { serverMode = !!on; }, sortState: () => sort, setRows(r) { rows = r; paint(); }, repaint: paint, shown: () => shown, selected, toCsv, download };
}
