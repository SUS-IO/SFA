// A table that sorts when you click a column heading, can tick rows, and can be downloaded as a CSV (opens in Excel).
// Put this file in: assets/js/core/table.js
import { h } from './ui.js';

let styled = false;
export function ensureTableStyles() {
  if (styled || typeof document === 'undefined') return; styled = true;
  const el = document.createElement('style'); el.id = 'dt-styles';
  el.textContent = `
.dt-wrap{border:1px solid rgba(128,128,128,.28);border-radius:12px;overflow:auto;max-height:72vh;margin-top:.5rem;background:var(--surface,transparent)}
.dt{width:100%;border-collapse:separate;border-spacing:0;font-size:.92rem;min-width:900px}
.dt th,.dt td{padding:.6rem .75rem;text-align:left;vertical-align:top;border-top:1px solid rgba(128,128,128,.2)}
.dt thead th{position:sticky;top:0;z-index:2;border-top:0;background:var(--surface-2,#eef1f6);font-size:.78rem;font-weight:600;white-space:nowrap}
@media (prefers-color-scheme: dark){.dt thead th{background:#1d2230}}
:root[data-theme="dark"] .dt thead th{background:#1d2230}
:root[data-theme="light"] .dt thead th{background:#eef1f6}
.dt th button{all:unset;cursor:pointer;display:inline-flex;gap:.3rem;align-items:center}
.dt th button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.dt th .arr{opacity:.3;font-size:.7rem}
.dt th[aria-sort="ascending"] .arr,.dt th[aria-sort="descending"] .arr{opacity:1}
.dt td small{display:block;opacity:.72;margin-top:.1rem}
.dt td.nowrap{white-space:nowrap}
.dt tr.hot td{background:rgba(242,106,141,.09)}
.dt tr.clk{cursor:pointer}
.dt tr.clk:hover td{background:rgba(128,128,128,.1)}
.dt tr.sel td{background:rgba(66,133,244,.1)}
.dt .ck{width:34px}
.dt input[type=checkbox]{width:18px;height:18px}
.dt-empty{padding:1.5rem;text-align:center;opacity:.75}
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
  empty = 'Nothing to show.', storageKey = null, rowClick = null }) {
  ensureTableStyles();
  let rows = [], sort = defaultSort ? { ...defaultSort } : null, shown = [];
  if (storageKey) { try { const s = JSON.parse(sessionStorage.getItem(`dt:${storageKey}`) || 'null'); if (s && columns.some(c => c.key === s.key && c.sort)) sort = s; } catch { /* ignore */ } }
  const head = h('thead'), body = h('tbody'), table = h('table', { class: 'dt' }, head, body), el = h('div', { class: 'dt-wrap' }, table);
  let allBox = null;

  const sorted = () => {
    const col = sort && columns.find(c => c.key === sort.key && c.sort);
    if (!col) return [...rows];
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
  return { el, setRows(r) { rows = r; paint(); }, repaint: paint, shown: () => shown, selected, toCsv, download };
}
