// Rent grid (Manager, Admin, Superadmin): every vehicle in a row, every day in a column,
// showing the money received against the amount as per the vehicle master slab.
// Put this file in: assets/js/views/rentgrid.js
import { h, btn, field, input, select, mount, emptyState, skeletonRows, friendlyError, fmtMoney, downloadText } from '../core/ui.js';
import { sb, fetchAll } from '../core/supa.js';
import { can, model } from '../core/store.js';
import { rateFor } from '../core/masters.js';
import { headGroup } from '../core/slab.js';

const IST = 5.5 * 3600e3, DAY = 86400e3, MAX_DAYS = 62;
const istDay = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
const addDays = (d, n) => istDay(new Date(`${d}T00:00:00+05:30`).getTime() + n * DAY);
const dayIdx = (d) => Math.round(new Date(`${d}T00:00:00Z`).getTime() / DAY);
const N = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const money = (v) => fmtMoney(r2(v));
const OUT = ['booked', 'booking_pending', 'cancelled'];
const HEADS = ['Rent', 'Deposit', 'Other charges'];
const csvCell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

let styled = false;
function ensureStyles() {
  if (styled) return; styled = true;
  const el = document.createElement('style');
  el.textContent = `
.rg-wrap{overflow:auto;max-height:calc(100vh - 330px);min-height:160px;border:1px solid var(--line,#e3e6eb);border-radius:14px;background:var(--surface,#fff)}
.rg{border-collapse:separate;border-spacing:0;font-size:13px;min-width:100%}
.rg th,.rg td{padding:7px 9px;border-top:1px solid var(--line,#e3e6eb);border-left:1px solid var(--line,#e3e6eb);text-align:right;white-space:nowrap;vertical-align:middle}
.rg thead th{position:sticky;top:0;z-index:3;background:#2A2E33;color:#E9ECEF;font-size:11px;letter-spacing:.05em;text-transform:uppercase;border-top:0;text-align:center}
.rg thead th small{display:block;opacity:.6;font-weight:500;letter-spacing:0;text-transform:none}
.rg thead th.we{background:#3A1F26}
.rg .veh{position:sticky;left:0;z-index:2;text-align:left;background:var(--surface,#fff);border-left:0;min-width:170px;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.rg thead th.veh{z-index:4;background:#2A2E33;box-shadow:inset 4px 0 0 var(--crimson,#8e1a2d);text-align:left}
.rg .veh small{display:block;color:var(--ink-2,#66707b)}
.rg td.c{min-width:78px}.rg td.c b{display:block}.rg td.c small{display:block;color:var(--ink-2,#66707b)}
.rg td.ok{background:rgba(12,122,76,.12)}.rg td.less{background:rgba(232,89,12,.14)}.rg td.more{background:rgba(37,99,168,.12)}.rg td.none{color:var(--ink-2,#66707b);text-align:center}
.rg td.tot small{display:block;text-align:right}
.rg .tot{position:sticky;right:0;background:var(--surface,#fff);font-weight:700;min-width:120px;z-index:1}
.rg thead th.tot{z-index:4;background:#3A1F26}
.rg tfoot td{position:sticky;bottom:0;z-index:2;background:var(--wash,#f1f3f6);font-weight:700}
.rg tfoot td.veh{z-index:5}
.rg-key{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-2,#66707b);align-items:center}
.rg-key i{display:inline-block;width:14px;height:14px;border-radius:4px;margin-right:5px;vertical-align:-2px}
.rg-heads{display:flex;gap:14px;flex-wrap:wrap;align-items:center}.rg-heads label{display:flex;gap:6px;align-items:center;font-size:14px}
`;
  document.head.append(el);
}

export async function render(root) {
  if (!can.manager()) return mount(root, emptyState('The Rent grid is for Managers and above', 'Only a Manager, Admin or Superadmin can open this page.'));
  ensureStyles();
  const today = istDay();
  const from = input({ type: 'date', value: today.slice(0, 8) + '01', 'aria-label': 'From day' }), to = input({ type: 'date', value: today, 'aria-label': 'To day' });
  const search = input({ type: 'search', placeholder: 'Search vehicle number', 'aria-label': 'Search vehicle' });
  const modelSel = select([{ value: '', label: 'All models' }], { 'aria-label': 'Model' });
  const modeSel = select([{ value: 'both', label: 'Received and slab' }, { value: 'rec', label: 'Received only' }, { value: 'exp', label: 'Slab only' }, { value: 'diff', label: 'Difference only' }], { 'aria-label': 'What to show' });
  const onlyDiff = h('input', { type: 'checkbox', id: 'rg-diff' }); const heads = new Map(HEADS.map(k => [k, h('input', { type: 'checkbox', checked: k === 'Rent', id: `rg-${k}` })]));
  const body = h('div'); const tiles = h('div', { class: 'stat-row' });
  let data = null;

  async function load() {
    let f = from.value, t = to.value; if (!f || !t || f > t) return mount(body, emptyState('Check the dates', 'The From day must be on or before the To day.'));
    let clipped = false; if (dayIdx(t) - dayIdx(f) + 1 > MAX_DAYS) { f = addDays(t, -(MAX_DAYS - 1)); from.value = f; clipped = true; }
    mount(body, skeletonRows(6));
    try {
      const startIso = `${f}T00:00:00+05:30`, endIso = new Date(new Date(`${t}T00:00:00+05:30`).getTime() + DAY).toISOString();
      const [vehicles, money_, overlap] = await Promise.all([
        fetchAll(() => sb.from('vehicles').select('*').order('number')),
        fetchAll(() => sb.from('money_entries').select('id,delivery_id,entry_type,purpose,amount,status,paid_on').gte('paid_on', startIso).lt('paid_on', endIso).eq('entry_type', 'Income').neq('status', 'void').order('id')),
        fetchAll(() => sb.from('deliveries').select('id,code,status,vehicle_id,booking_vehicle_id,delivered_at,return_due,days,rent,deposit,delivery_charges,advance_pickup_charges,trip_type').lt('delivered_at', endIso).gte('return_due', startIso).order('id'))]);
      const have = new Map(overlap.map(d => [d.id, d])); const need = [...new Set(money_.map(m => m.delivery_id).filter(id => id && !have.has(id)))];
      for (let i = 0; i < need.length; i += 150) { const { data: more, error } = await sb.from('deliveries').select('id,code,status,vehicle_id,booking_vehicle_id,delivered_at,return_due,days,rent,deposit,delivery_charges,advance_pickup_charges,trip_type').in('id', need.slice(i, i + 150)); if (error) throw error; more.forEach(d => have.set(d.id, d)); }
      const ids = [...have.keys()]; const ext = [];
      for (let i = 0; i < ids.length; i += 150) { const { data: e, error } = await sb.from('extensions').select('delivery_id,extra_days,status').eq('status', 'approved').in('delivery_id', ids.slice(i, i + 150)); if (error) throw error; ext.push(...e); }
      data = { f, t, clipped, vehicles, money: money_, deliveries: [...have.values()], ext };
      const ms = [...new Map(vehicles.map(v => [v.model_id, v.model_id])).keys()].filter(Boolean);
      modelSel.replaceChildren(...[{ value: '', label: 'All models' }, ...ms.map(id => ({ value: String(id), label: model(id)?.name || `Model ${id}` }))].map(o => h('option', { value: o.value }, o.label)));
      paint();
    } catch (e) { mount(body, emptyState('Could not load the grid', friendlyError(e))); }
  }

  function build() {
    const { f, t, vehicles, money: mon, deliveries, ext } = data;
    const days = []; for (let d = f; d <= t; d = addDays(d, 1)) days.push(d);
    const col = new Map(days.map((d, i) => [d, i]));
    const on = (k) => heads.get(k).checked;
    const vmap = new Map(vehicles.map(v => [v.id, v]));
    const rows = new Map(); const row = (vid) => { if (!rows.has(vid)) rows.set(vid, { v: vmap.get(vid), rec: days.map(() => 0), exp: days.map(() => 0) }); return rows.get(vid); };
    const extDays = new Map(); ext.forEach(e => extDays.set(e.delivery_id, (extDays.get(e.delivery_id) || 0) + N(e.extra_days)));
    const dmap = new Map(deliveries.map(d => [d.id, d]));
    for (const d of deliveries) {
      if (OUT.includes(d.status) || !d.delivered_at) continue; const vid = d.vehicle_id || d.booking_vehicle_id; if (!vid || !vmap.has(vid)) continue;
      const total = N(d.days) + (extDays.get(d.id) || 0), r = row(vid), start = istDay(new Date(d.delivered_at).getTime());
      if (on('Rent') && total >= 1) { const rate = rateFor(vmap.get(vid), total, d.trip_type || 'local'); if (rate != null) for (let i = 0; i < total; i++) { const c = col.get(addDays(start, i)); if (c != null) r.exp[c] += rate; } }
      const c0 = col.get(start);
      if (c0 != null) { if (on('Deposit')) r.exp[c0] += N(d.deposit); if (on('Other charges')) r.exp[c0] += N(d.delivery_charges) + N(d.advance_pickup_charges); }
    }
    for (const m of mon) {
      const d = dmap.get(m.delivery_id); const vid = d && (d.vehicle_id || d.booking_vehicle_id); if (!vid || !vmap.has(vid)) continue; if (!on(headGroup(m.purpose))) continue;
      const c = col.get(istDay(new Date(m.paid_on).getTime())); if (c != null) row(vid).rec[c] += N(m.amount);
    }
    let list = [...rows.values()].filter(r => r.v);
    const q = search.value.trim().toLowerCase(); if (q) list = list.filter(r => String(r.v.number).toLowerCase().includes(q));
    if (modelSel.value) list = list.filter(r => String(r.v.model_id) === modelSel.value);
    list.forEach(r => { r.tr = r.rec.reduce((a, b) => a + b, 0); r.te = r.exp.reduce((a, b) => a + b, 0); r.td = r.tr - r.te; });
    if (onlyDiff.checked) list = list.filter(r => Math.abs(r.td) >= 0.5);
    list.sort((a, b) => String(a.v.number).localeCompare(String(b.v.number)));
    return { days, list };
  }

  function cell(rec, exp, mode, cls = 'c') {
    const d = r2(rec - exp), none = !rec && !exp; const tone = none ? 'none' : Math.abs(d) < 0.5 ? 'ok' : d < 0 ? 'less' : 'more';
    if (none) return h('td', { class: `${cls} none` }, '·');
    if (mode === 'rec') return h('td', { class: `${cls} ${tone}` }, h('b', money(rec)));
    if (mode === 'exp') return h('td', { class: `${cls} ${tone}` }, h('b', money(exp)));
    if (mode === 'diff') return h('td', { class: `${cls} ${tone}` }, h('b', d === 0 ? '0' : `${d > 0 ? '+' : '-'}${money(Math.abs(d))}`));
    return h('td', { class: `${cls} ${tone}` }, h('b', money(rec)), h('small', `slab ${money(exp)}`));
  }

  function paint() {
    if (!data) return; const mode = modeSel.value; const { days, list } = build();
    const sumR = list.reduce((a, r) => a + r.tr, 0), sumE = list.reduce((a, r) => a + r.te, 0);
    const tile = (n, l) => h('div', { class: 'stat' }, h('span', { class: 'stat-txt' }, h('em', l), h('strong', n)));
    mount(tiles, tile(String(list.length), 'vehicles with activity'), tile(money(sumR), 'received'), tile(money(sumE), 'as per slab'), tile(`${sumR - sumE < 0 ? '-' : sumR - sumE > 0 ? '+' : ''}${money(Math.abs(sumR - sumE))}`, 'difference'));
    if (!list.length) return mount(body, data.clipped ? h('p', { class: 'muted small' }, `Showing the last ${MAX_DAYS} days.`) : null, emptyState('Nothing to show', 'No vehicle had rent, deposit or other charges in these dates with the chosen filters.'));
    const dayName = (d) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
    const head = h('tr', h('th', { class: 'veh' }, 'Vehicle'), days.map(d => { const we = ['Sat', 'Sun'].includes(dayName(d)); return h('th', { class: we ? 'we' : '' }, d.slice(8) + '/' + d.slice(5, 7), h('small', dayName(d))); }), h('th', { class: 'tot' }, 'Total', h('small', mode === 'both' ? 'received / slab' : '')));
    const totCell = (r, rec, exp) => { const d = r2(rec - exp); return h('td', { class: 'tot' }, h('div', money(rec)), h('small', { class: 'muted' }, `slab ${money(exp)}`), h('small', { style: `color:${Math.abs(d) < 0.5 ? '#0c7a4c' : d < 0 ? 'var(--danger,#b42318)' : 'var(--info,#2563a8)'}` }, Math.abs(d) < 0.5 ? 'Matches' : d < 0 ? `${money(-d)} short` : `${money(d)} extra`)); };
    const foot = h('tr', h('td', { class: 'veh' }, 'All vehicles'), days.map((_, i) => cell(list.reduce((a, r) => a + r.rec[i], 0), list.reduce((a, r) => a + r.exp[i], 0), mode)), totCell(null, sumR, sumE));
    mount(body, data.clipped ? h('p', { class: 'muted small' }, `The range was shortened to ${MAX_DAYS} days.`) : null,
      h('div', { class: 'rg-wrap' }, h('table', { class: 'rg' }, h('thead', head), h('tbody', list.map(r => h('tr', h('td', { class: 'veh' }, h('strong', r.v.number), h('small', model(r.v.model_id)?.name || '')), r.rec.map((v, i) => cell(v, r.exp[i], mode)), totCell(r, r.tr, r.te)))), h('tfoot', foot))),
      h('div', { class: 'rg-key', style: 'margin-top:10px' }, h('span', h('i', { style: 'background:rgba(12,122,76,.35)' }), 'Received matches the slab'), h('span', h('i', { style: 'background:rgba(232,89,12,.4)' }), 'Received is less than the slab'), h('span', h('i', { style: 'background:rgba(37,99,168,.35)' }), 'Received is more than the slab'),
        h('span', 'Slab rent is spread over each day of the rental (all days, including extensions). Money is shown on the day it was received.')));
  }

  function csv() {
    if (!data) return; const { days, list } = build();
    const lines = [['Vehicle', 'Model', ...days.map(d => `${d} received`), ...days.map(d => `${d} slab`), 'Total received', 'Total slab', 'Difference']];
    list.forEach(r => lines.push([r.v.number, model(r.v.model_id)?.name || '', ...r.rec.map(r2), ...r.exp.map(r2), r2(r.tr), r2(r.te), r2(r.td)]));
    downloadText(`rent-grid-${data.f}-to-${data.t}.csv`, lines.map(l => l.map(csvCell).join(',')).join('\r\n'));
  }

  [search, modelSel, modeSel, onlyDiff, ...heads.values()].forEach(el => el.addEventListener(el === search ? 'input' : 'change', paint));
  [from, to].forEach(el => el.addEventListener('change', load));
  mount(root, h('div', { class: 'panel' },
    h('div', { class: 'toolbar' }, field('From', from), field('To', to), field('Vehicle', search), field('Model', modelSel), field('Show', modeSel), btn('Download as CSV', { ic: 'download', onClick: csv })),
    h('div', { class: 'rg-heads', style: 'margin-bottom:12px' }, h('strong', 'Money type:'), ...HEADS.map(k => h('label', { for: `rg-${k}` }, heads.get(k), k)), h('label', { for: 'rg-diff' }, onlyDiff, 'Only vehicles with a difference')),
    h('p', { class: 'muted small' }, `Pick up to ${MAX_DAYS} days. Rent is compared with the slab in the vehicle master (by total days, per trip kind). Deposit and other charges are compared with what was set on the delivery.`),
    tiles, body));
  await load();
}
