// Live customers (Tele Caller, Approver, Manager, Admin, Superadmin): who has a vehicle now, for how long, and the calls made.
// Put this file in: assets/js/views/live.js
import { h, icon, btn, busy, chip, field, input, select, textarea, openSheet, toast, mount, emptyState, skeletonRows, fmtDateTimeY, fmtPhone, friendlyError, localInputValue, isoFromLocal } from '../core/ui.js';
import { sb, rpc } from '../core/supa.js';
import { state, can, whoName } from '../core/store.js';
import { dataTable } from '../core/table.js';
import { ageHours, fmtAge } from '../core/ageing.js';
import { openDeliveryDetail } from './deliveries.js';

const OUTCOMES = ['Spoke to customer', 'No answer', 'Switched off', 'Call back later', 'Promised to return', 'Needs extension', 'Problem with the vehicle', 'Other'];
const STATUS = { active: ['Live', 'blue'], pending: ['Waiting for approval', 'aqua'], pickup_pending: ['Pickup waiting', 'pink'] };
const FILTERS = [['all', 'All'], ['active', 'Live'], ['pending', 'Waiting for approval'], ['pickup_pending', 'Pickup waiting'], ['overdue', 'Overdue'], ['stale', 'Not called recently'], ['due', 'Call back due']];

export async function render(root) {
  if (!can.call()) return mount(root, emptyState('Not available', 'This page is for Tele Callers, Approvers, Managers and Admins.'));
  const gap = () => Number(state.settings?.call_gap_hours) || 24;
  const st = { rows: [], f: 'all', q: '' };
  const tiles = h('div', { class: 'ac-tiles', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin:.6rem 0' }); const body = h('div');
  const search = input({ type: 'search', placeholder: 'Search customer, mobile, vehicle or delivery number', 'aria-label': 'Search' });
  const chips = h('div', { class: 'filter-chips', role: 'group' }, FILTERS.map(([v, l]) => h('button', { type: 'button', class: 'fchip', dataset: { v }, 'aria-pressed': String(v === st.f), on: { click: () => { st.f = v; chips.querySelectorAll('.fchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); paint(); } } }, l)));
  const outH = (r) => ageHours(r.delivered_at || r.created_at);
  const overdueH = (r) => (r.return_due && r.d_status === 'active' ? (Date.now() - new Date(r.return_due).getTime()) / 3600000 : -1);
  const callAge = (r) => (r.last_at ? ageHours(r.last_at) : Infinity);
  const isStale = (r) => callAge(r) >= gap();
  const isDue = (r) => r.next_call_at && new Date(r.next_call_at).getTime() <= Date.now();
  const days = (hrs) => (Number.isFinite(hrs) ? (hrs / 24).toFixed(1) : '');

  const table = dataTable({ rowKey: 'delivery_id', storageKey: 'live', defaultSort: { key: 'over', dir: 'desc' }, empty: 'No customers match.', rowClick: (r) => openCall(r),
    rowClass: (r) => (overdueH(r) > 0 ? 'hot' : ''),
    columns: [
      { key: 'code', label: 'Delivery', nowrap: true, sort: (r) => r.code, render: (r) => h('span', null, h('strong', r.code), h('small', null, chip(...STATUS[r.d_status] || [r.d_status, 'neutral']))), csv: (r) => r.code },
      { key: 'cust', label: 'Customer', sort: (r) => (r.customer || '').toLowerCase(), render: (r) => h('span', null, h('strong', r.customer || '—'), r.mobile ? h('small', null, h('a', { href: `tel:${r.mobile}`, on: { click: (e) => e.stopPropagation() } }, fmtPhone(r.mobile))) : null, r.mobile2 ? h('small', null, h('a', { href: `tel:${r.mobile2}`, on: { click: (e) => e.stopPropagation() } }, fmtPhone(r.mobile2))) : null), csv: (r) => `${r.customer || ''} ${r.mobile || ''}` },
      { key: 'veh', label: 'Vehicle', nowrap: true, sort: (r) => r.vehicle || '', render: (r) => r.vehicle || '' },
      { key: 'out', label: 'With customer for', nowrap: true, sort: (r) => (r.d_status === 'pending' ? -1 : outH(r)), render: (r) => (r.d_status === 'pending' ? h('span', { class: 'muted' }, 'Not handed over yet') : h('span', null, h('strong', fmtAge(outH(r))), h('small', `${days(outH(r))} days`))), csv: (r) => (r.d_status === 'pending' ? '' : fmtAge(outH(r))) },
      { key: 'due', label: 'Return due', nowrap: true, sort: (r) => (r.return_due ? new Date(r.return_due).getTime() : null), render: (r) => (r.return_due ? h('span', null, fmtDateTimeY(r.return_due)) : ''), csv: (r) => (r.return_due ? fmtDateTimeY(r.return_due) : '') },
      { key: 'over', label: 'Overdue by', nowrap: true, sort: (r) => (overdueH(r) > 0 ? overdueH(r) : null), render: (r) => (overdueH(r) > 0 ? chip(`${fmtAge(overdueH(r))} (${days(overdueH(r))} d)`, 'pink', 'clock') : '—'), csv: (r) => (overdueH(r) > 0 ? fmtAge(overdueH(r)) : '') },
      { key: 'call', label: 'Last call', nowrap: true, sort: (r) => (r.last_at ? new Date(r.last_at).getTime() : null), render: (r) => (r.last_at ? h('span', { style: isStale(r) ? 'color:#e11d48;font-weight:600' : '' }, `${fmtAge(callAge(r))} ago`, h('small', whoName(r.last_by))) : chip('Never called', 'pink')), csv: (r) => (r.last_at ? fmtDateTimeY(r.last_at) : '') },
      { key: 'rem', label: 'Last remark', sort: (r) => r.last_remark || '', render: (r) => (r.last_remark ? h('span', null, h('strong', r.last_outcome), h('small', { style: 'white-space:normal' }, r.last_remark.length > 90 ? `${r.last_remark.slice(0, 90)}…` : r.last_remark)) : ''), csv: (r) => `${r.last_outcome || ''} ${r.last_remark || ''}`.trim() },
      { key: 'n', label: 'Calls', sort: (r) => r.remarks, render: (r) => String(r.remarks) },
      { key: 'next', label: 'Call back at', nowrap: true, sort: (r) => (r.next_call_at ? new Date(r.next_call_at).getTime() : null), render: (r) => (r.next_call_at ? h('span', { style: isDue(r) ? 'color:#e11d48;font-weight:600' : '' }, fmtDateTimeY(r.next_call_at)) : ''), csv: (r) => (r.next_call_at ? fmtDateTimeY(r.next_call_at) : '') },
    ] });

  const shown = () => { const q = st.q.toUpperCase(); return st.rows.filter(r => {
    if (st.f === 'active' || st.f === 'pending' || st.f === 'pickup_pending') { if (r.d_status !== st.f) return false; } else if (st.f === 'overdue') { if (!(overdueH(r) > 0)) return false; } else if (st.f === 'stale') { if (!isStale(r)) return false; } else if (st.f === 'due') { if (!isDue(r)) return false; }
    return !q || `${r.customer || ''} ${r.mobile || ''} ${r.mobile2 || ''} ${r.vehicle || ''} ${r.code}`.toUpperCase().includes(q); }); };
  function paint() {
    const t = (v, l) => h('div', { class: 'ac-tile', style: 'border:1px solid rgba(128,128,128,.28);border-radius:10px;padding:.5rem .7rem' }, h('small', { style: 'display:block;opacity:.7' }, l), h('strong', { style: 'font-size:1.05rem' }, String(v)));
    mount(tiles, t(st.rows.filter(r => r.d_status === 'active').length, 'Live now'), t(st.rows.filter(r => r.d_status !== 'active').length, 'Waiting (approval or pickup)'), t(st.rows.filter(r => overdueH(r) > 0).length, 'Overdue'), t(st.rows.filter(isStale).length, `Not called in ${gap()}+ hours`), t(st.rows.filter(isDue).length, 'Call back due'));
    table.setRows(shown());
  }
  async function load() { mount(body, skeletonRows(5)); try { st.rows = (await rpc('live_customers', {})) || []; } catch (e) { return mount(body, emptyState('Could not load', friendlyError(e) + ' If this is the first time, run the Stage 9 database script.', btn('Try again', { kind: 'primary', onClick: load }))); } mount(body, table.el); paint(); }
  search.addEventListener('input', () => { st.q = search.value.trim(); paint(); });

  // ---- one customer: the history of calls and a new remark
  async function openCall(r) {
    const outcome = select(OUTCOMES.map(o => ({ value: o, label: o })), { 'aria-label': 'What happened' }); const fOut = field('What happened on the call', outcome, { required: true });
    const remark = textarea({ rows: '3', placeholder: 'What did the customer say? When will the vehicle come back?' }); const fRem = field('Remark', remark, { required: true, hint: 'This is saved on the delivery and in the vehicle log.' });
    const next = input({ type: 'datetime-local' }); const fNext = field('Call again at (optional)', next);
    const hist = h('div', { class: 'stack-sm' });
    async function loadHist() {
      const { data, error } = await sb.from('call_remarks').select('*').eq('delivery_id', r.delivery_id).order('created_at', { ascending: false }).order('id', { ascending: false });
      mount(hist, h('strong', 'Earlier calls'), error ? h('p', { class: 'muted small' }, friendlyError(error)) : (data || []).length ? h('ul', { class: 'pay-list' }, data.map(x => h('li', { class: 'pay-row' }, h('div', null, h('strong', x.outcome), h('small', `${whoName(x.created_by)} · ${fmtDateTimeY(x.created_at)}${x.next_call_at ? ` · call again ${fmtDateTimeY(x.next_call_at)}` : ''}`), h('small', { style: 'white-space:pre-wrap;opacity:1' }, x.remark))))) : h('p', { class: 'muted small' }, 'No calls yet.'));
    }
    const save = btn('Save remark', { kind: 'primary', ic: 'check', onClick: (e) => { fRem.setError(''); if (!remark.value.trim()) return fRem.setError('Write a remark.');
      busy(e.currentTarget, async () => { try { await rpc('add_call_remark', { p_delivery: r.delivery_id, p_outcome: outcome.value, p_remark: remark.value.trim(), p_next_call: next.value ? isoFromLocal(next.value) : null }); toast('Remark saved'); s.close(); load(); } catch (err) { toast(friendlyError(err), 'error'); } }); } });
    const s = openSheet({ title: r.customer || r.code, subtitle: `${r.code}${r.vehicle ? ` · ${r.vehicle}` : ''}`, body: skeletonRows(4), footer: [btn('Close', { onClick: () => s.close() }), save], wide: true });
    const kv = (k, v) => (v ? h('div', { class: 'kv' }, h('dt', k), h('dd', v)) : null);
    mount(s.body, h('dl', { class: 'kvs' }, kv('Mobile', r.mobile ? h('a', { href: `tel:${r.mobile}` }, fmtPhone(r.mobile)) : null), kv('Second mobile', r.mobile2 ? h('a', { href: `tel:${r.mobile2}` }, fmtPhone(r.mobile2)) : null), kv('Vehicle', r.vehicle),
      kv('Handed over', r.delivered_at ? `${fmtDateTimeY(r.delivered_at)} (${fmtAge(outH(r))} ago)` : null), kv('Return due', r.return_due ? fmtDateTimeY(r.return_due) : null), kv('Overdue by', overdueH(r) > 0 ? fmtAge(overdueH(r)) : null)),
      h('div', { class: 'action-bar' }, btn('Open delivery', { ic: 'right', onClick: () => openDeliveryDetail(r.delivery_id) })),
      h('form', { class: 'stack', novalidate: true, on: { submit: (e) => e.preventDefault() } }, fOut, fRem, fNext), hist);
    await loadHist();
  }

  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Live customers'), h('p', { class: 'muted' }, 'Customers who have a vehicle now. Call them, then write what was said. Remarks are kept on the delivery and in the vehicle log.'))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), btn('Download as CSV', { ic: 'download', onClick: () => table.download('live-customers') })), chips, tiles, body);
  await load();
}
