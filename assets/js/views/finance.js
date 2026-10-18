// Finance (Admin and Superadmin): the day table with drill-down, and every payment to review, acknowledge and correct.
// Put this file in: assets/js/views/finance.js
import { h, icon, btn, busy, chip, field, input, select, textarea, segmented, openSheet, toast, mount, emptyState, skeletonRows, debounce,
  fmtDateTimeY, fmtMoney, friendlyError, localInputValue, isoFromLocal, confirmDialog, statusBadge, num } from '../core/ui.js';
import { sb, rpc, fetchAll } from '../core/supa.js';
import { state, can, whoName } from '../core/store.js';
import { signedUrls, lightbox } from '../core/images.js';
import { moneyChip } from '../core/ops.js';
import { VIAS, userOptions } from '../core/payments.js';
import { fmtDay } from '../core/masters.js';
import { dataTable } from '../core/table.js';
import { openDeliveryDetail } from './deliveries.js';

const IST = 5.5 * 3600e3;
const istDay = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
const shift = (day, n) => istDay(new Date(`${day}T00:00:00+05:30`).getTime() + n * 86400e3);
const startOf = (day) => `${day}T00:00:00+05:30`;
const N = (v) => Number(v) || 0;
const money = (v) => fmtMoney(N(v));
const FIN = { unreviewed: ['Not reviewed', 'pink'], reviewed: ['Reviewed', 'blue'], modified: ['Corrected', 'aqua'] };
const finChip = (s) => { const [t, k] = FIN[s] || FIN.unreviewed; return chip(t, k); };
const dayLabel = (d) => `${fmtDay(d)} ${new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}`;

export async function render(root, params) {
  if (!can.admin()) return mount(root, emptyState('Finance is for Admins', 'Only an Admin or Superadmin can open this page.'));
  const TABS = [{ value: 'days', label: 'Day table' }, { value: 'payments', label: 'All payments' }];
  const panel = h('div');
  const tabs = segmented(TABS, params.sub === 'payments' ? 'payments' : 'days', (v) => show(v));
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Finance'), h('p', { class: 'muted' }, 'Each person\'s cash day by day, and every payment to review, acknowledge and correct.'))), h('div', { class: 'toolbar' }, tabs), panel);
  async function show(tab) { mount(panel, skeletonRows(5)); try { await (tab === 'days' ? daysTab : paymentsTab)(panel); } catch (e) { mount(panel, emptyState('Could not load this tab', friendlyError(e), btn('Try again', { kind: 'primary', onClick: () => show(tab) }))); } }
  await show(tabs.get());
}

// =============================================================================================== day table
async function daysTab(panel) {
  const st = { from: shift(istDay(), -13), to: istDay(), user: 'all', rows: [], level: 'days', day: null, uid: null, group: null, events: [] };
  const crumbs = h('div', { class: 'toolbar', style: 'flex-wrap:wrap;gap:.25rem' }); const body = h('div'); const tiles = h('div', { class: 'stat-row' });
  const from = input({ type: 'date', value: st.from, 'aria-label': 'From day' }), to = input({ type: 'date', value: st.to, 'aria-label': 'To day' });
  const people = select([{ value: 'all', label: 'Everyone' }, ...userOptions().map(o => ({ value: o.value, label: o.label }))], { 'aria-label': 'Person' });
  let table = null;
  const nameOf = (id) => (id ? whoName(id) : 'Unknown');

  async function load() {
    st.from = from.value || st.from; st.to = to.value || st.to;
    if (st.to < st.from) return toast('The last day must not be before the first day.', 'error');
    mount(body, skeletonRows(5));
    try { st.rows = (await rpc('finance_day_table', { p_from: st.from, p_to: st.to })) || []; } catch (e) { return mount(body, emptyState('Could not load the day table', friendlyError(e) + ' If this is the first time, run the Stage 5 database script.', btn('Try again', { kind: 'primary', onClick: load }))); }
    st.level = 'days'; st.day = st.uid = st.group = null; draw();
  }
  const sum = (rows, k) => rows.reduce((a, r) => a + N(r[k]), 0);
  const visibleRows = () => st.rows.filter(r => st.user === 'all' || r.uid === st.user);

  function crumbBar() {
    const items = [['All days', () => { st.level = 'days'; st.day = st.uid = st.group = null; draw(); }]];
    if (st.day) items.push([dayLabel(st.day), () => { st.level = 'day'; st.uid = st.group = null; draw(); }]);
    if (st.uid) items.push([nameOf(st.uid), () => { st.level = 'user'; st.group = null; draw(); }]);
    if (st.group) items.push([st.group.label, null]);
    mount(crumbs, items.flatMap(([t, fn], i) => [i ? h('span', { class: 'muted' }, '›') : null, fn ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: fn } }, t) : h('strong', t)]));
  }
  const totalsTiles = (rows) => mount(tiles,
    ...[['Opening cash', sum(rows, 'opening')], ['Cash income', sum(rows, 'cash_income')], ['Cash expenses', sum(rows, 'cash_expense')], ['Handed over', sum(rows, 'handed_over')], ['Received', sum(rows, 'received')], ['Closing cash', sum(rows, 'closing')]]
      .map(([l, v]) => h('div', { class: 'stat' }, h('strong', money(v)), h('span', l))));

  const cashCols = (extra = []) => [...extra,
    { key: 'opening', label: 'Opening cash', sort: (r) => N(r.opening), render: (r) => money(r.opening), nowrap: true },
    { key: 'ci', label: 'Cash income', sort: (r) => N(r.cash_income), render: (r) => money(r.cash_income), nowrap: true },
    { key: 'ce', label: 'Cash expenses', sort: (r) => N(r.cash_expense), render: (r) => money(r.cash_expense), nowrap: true },
    { key: 'ho', label: 'Handed over', sort: (r) => N(r.handed_over), render: (r) => money(r.handed_over), nowrap: true },
    { key: 'rc', label: 'Received', sort: (r) => N(r.received), render: (r) => money(r.received), nowrap: true },
    { key: 'cl', label: 'Closing cash', sort: (r) => N(r.closing), render: (r) => h('strong', money(r.closing)), nowrap: true },
    { key: 'nci', label: 'Non-cash income', sort: (r) => N(r.noncash_income), render: (r) => money(r.noncash_income), nowrap: true },
    { key: 'nce', label: 'Non-cash expenses', sort: (r) => N(r.noncash_expense), render: (r) => money(r.noncash_expense), nowrap: true },
    { key: 'n', label: 'Entries', sort: (r) => N(r.entries), render: (r) => String(r.entries) }];

  async function draw() {
    crumbBar(); table = null;
    const rows = visibleRows();
    if (st.level === 'days') {
      const by = new Map(); rows.forEach(r => { const o = by.get(r.day) || { day: r.day, opening: 0, cash_income: 0, cash_expense: 0, handed_over: 0, received: 0, closing: 0, noncash_income: 0, noncash_expense: 0, entries: 0, people: 0 };
        for (const k of ['opening', 'cash_income', 'cash_expense', 'handed_over', 'received', 'closing', 'noncash_income', 'noncash_expense', 'entries']) o[k] += N(r[k]); o.people++; by.set(r.day, o); });
      const days = [...by.values()];
      mount(tiles); totalsTiles(rows.length ? days.filter(d => d.day === st.to) : []);
      table = dataTable({ columns: cashCols([{ key: 'day', label: 'Day', sort: (r) => r.day, render: (r) => h('strong', dayLabel(r.day)), csv: (r) => r.day, nowrap: true }, { key: 'p', label: 'People', sort: (r) => r.people, render: (r) => String(r.people) }]),
        rowKey: 'day', defaultSort: { key: 'day', dir: 'desc' }, storageKey: 'fin-days', rowClick: (r) => { st.level = 'day'; st.day = r.day; draw(); }, empty: 'No cash or payments in these days.' });
      table.setRows(days); mount(body, h('p', { class: 'muted small' }, 'Click a day to see each person. Tiles show the last day of the range.'), table.el); return;
    }
    if (st.level === 'day') {
      const dr = rows.filter(r => r.day === st.day); totalsTiles(dr);
      table = dataTable({ columns: cashCols([{ key: 'who', label: 'Person', sort: (r) => nameOf(r.uid), render: (r) => h('strong', nameOf(r.uid)), csv: (r) => nameOf(r.uid) }]), rowKey: 'uid', defaultSort: { key: 'who', dir: 'asc' }, storageKey: 'fin-day',
        rowClick: (r) => { st.level = 'user'; st.uid = r.uid; draw(); }, empty: 'Nobody had cash or payments on this day.' });
      table.setRows(dr); mount(body, h('p', { class: 'muted small' }, 'Click a person to see what made up their day.'), table.el); return;
    }
    // person and day
    const one = st.rows.filter(r => r.day === st.day && r.uid === st.uid); totalsTiles(one);
    mount(body, skeletonRows(3));
    try { st.events = (await rpc('finance_events', { p_day: st.day, p_user: st.uid })) || []; } catch (e) { return mount(body, emptyState('Could not load', friendlyError(e))); }
    if (st.level === 'user') {
      const groups = new Map();
      st.events.forEach(e => { const key = `${e.kind}|${e.seg}|${e.mode}`; const g = groups.get(key) || { key, kind: e.kind, seg: e.seg, mode: e.mode, count: 0, amount: 0, cash: 0 }; g.count++; g.amount += N(e.amount); g.cash += N(e.cash_delta); groups.set(key, g); });
      table = dataTable({ columns: [
        { key: 'kind', label: 'Type', sort: (r) => r.kind, render: (r) => chip(r.kind, r.kind === 'Income' || r.kind === 'Received' ? 'blue' : 'pink') },
        { key: 'seg', label: 'For', sort: (r) => r.seg, render: (r) => h('strong', r.seg) },
        { key: 'mode', label: 'Paid by', sort: (r) => r.mode, render: (r) => r.mode },
        { key: 'count', label: 'Entries', sort: (r) => r.count, render: (r) => String(r.count) },
        { key: 'amount', label: 'Amount', sort: (r) => r.amount, render: (r) => money(r.amount), nowrap: true },
        { key: 'cash', label: 'Effect on cash', sort: (r) => r.cash, render: (r) => (r.cash ? `${r.cash > 0 ? '+' : '-'}${money(Math.abs(r.cash))}` : 'Not cash'), csv: (r) => r.cash, nowrap: true }],
        rowKey: 'key', defaultSort: { key: 'kind', dir: 'asc' }, storageKey: 'fin-user', rowClick: (r) => { st.level = 'seg'; st.group = { key: r.key, label: `${r.kind}: ${r.seg} (${r.mode})` }; draw(); }, empty: 'Nothing on this day.' });
      table.setRows([...groups.values()]); mount(body, h('p', { class: 'muted small' }, 'Click a line to see the payments behind it.'), table.el); return;
    }
    // entries behind one line
    const list = st.events.filter(e => `${e.kind}|${e.seg}|${e.mode}` === st.group.key);
    table = dataTable({ columns: entryCols(), rowKey: 'src_id', defaultSort: { key: 'paid', dir: 'asc' }, storageKey: 'fin-seg', empty: 'Nothing here.',
      rowClick: (r) => (r.src === 'money' ? openEntry(r.src_id, () => draw()) : toast('This is a cash handover. See Money, then Cash handovers.')) });
    table.setRows(list); mount(body, h('p', { class: 'muted small' }, 'Click a payment to see its proof, acknowledge it or correct it.'), table.el);
  }
  function entryCols() {
    return [
      { key: 'sys', label: 'Entered in system', sort: (r) => new Date(r.created_at).getTime(), render: (r) => fmtDateTimeY(r.created_at), nowrap: true },
      { key: 'paid', label: 'Payment date', sort: (r) => new Date(r.paid_on).getTime(), render: (r) => fmtDateTimeY(r.paid_on), nowrap: true },
      { key: 'for', label: 'For', sort: (r) => r.purpose || r.seg, render: (r) => h('span', null, h('strong', r.purpose || r.seg), r.code ? h('small', r.code) : null) },
      { key: 'by', label: 'Entered by', sort: (r) => nameOf(r.created_by), render: (r) => nameOf(r.created_by) },
      { key: 'mode', label: 'Paid by', sort: (r) => r.mode, render: (r) => h('span', null, r.mode, r.txn_ref ? h('small', r.txn_ref) : null) },
      { key: 'del', label: 'Delivery', sort: (r) => r.delivery_code || '', render: (r) => (r.delivery_code ? h('a', { href: `#/deliveries?open=${r.delivery_id}`, on: { click: (e) => { e.preventDefault(); openDeliveryDetail(r.delivery_id); } } }, r.delivery_code) : '') },
      { key: 'amt', label: 'Amount', sort: (r) => N(r.amount), render: (r) => h('strong', `${r.kind === 'Expense' || r.kind === 'Handed over' ? '-' : '+'}${money(r.amount)}`), nowrap: true },
      { key: 'fin', label: 'Finance', sort: (r) => r.fin_status || '', render: (r) => (r.src === 'money' ? finChip(r.fin_status) : '') }];
  }

  from.addEventListener('change', load); to.addEventListener('change', load); people.addEventListener('change', () => { st.user = people.value; if (st.level !== 'days') { st.level = 'days'; st.day = st.uid = st.group = null; } draw(); });
  const csv = btn('Download as CSV', { ic: 'download', onClick: () => (table ? table.download(`finance-${st.level}-${st.from}-to-${st.to}`) : toast('Nothing to download yet.')) });
  mount(panel, h('div', { class: 'toolbar' }, field('From', from), field('To', to), field('Person', people), csv),
    h('div', { class: 'callout' }, icon('info', 18), h('span', 'Cash is what each person holds: cash payments received, minus cash paid out, minus cash handed over, plus cash received from others. Payments by UPI, card or bank are shown as non-cash. Days are by payment date.')),
    tiles, crumbs, body);
  await load();
}

// =============================================================================================== all payments
async function paymentsTab(panel) {
  const st = { from: shift(istDay(), -29), to: istDay(), type: 'all', mode: 'all', fin: 'unreviewed', user: 'all', q: '', void: false, rows: [], codes: new Map() };
  const from = input({ type: 'date', value: st.from }), to = input({ type: 'date', value: st.to });
  const type = select([['all', 'Income and expense'], ['Income', 'Income only'], ['Expense', 'Expense only']].map(([value, label]) => ({ value, label })));
  const mode = select([{ value: 'all', label: 'Any mode' }, ...VIAS.map(v => ({ value: v, label: v }))]);
  const fin = select([['all', 'All'], ['unreviewed', 'Not reviewed'], ['reviewed', 'Reviewed'], ['modified', 'Corrected']].map(([value, label]) => ({ value, label })), { value: st.fin });
  const people = select([{ value: 'all', label: 'Anyone' }, ...userOptions().map(o => ({ value: o.value, label: o.label }))]);
  const search = input({ type: 'search', placeholder: 'Search what it is for or the transaction id' });
  const showVoid = h('label', { class: 'check' }, h('input', { type: 'checkbox' }), h('span', 'Show voided'));
  const tiles = h('div', { class: 'stat-row' }); const bar = h('div', { class: 'mv-bar', hidden: true }); const body = h('div'); const count = h('p', { class: 'result-count' });
  const selected = new Set(); let table = null;

  const entered = (m) => whoName(m.created_by);
  const cols = [
    { key: 'sys', label: 'Entered in system', sort: (r) => new Date(r.created_at).getTime(), render: (r) => h('span', null, fmtDateTimeY(r.created_at), h('small', entered(r))), csv: (r) => fmtDateTimeY(r.created_at), nowrap: true },
    { key: 'paid', label: 'Payment date', sort: (r) => new Date(r.paid_on).getTime(), render: (r) => fmtDateTimeY(r.paid_on), csv: (r) => fmtDateTimeY(r.paid_on), nowrap: true },
    { key: 'type', label: 'Type', sort: (r) => r.entry_type, render: (r) => chip(r.entry_type, r.entry_type === 'Income' ? 'blue' : 'pink') },
    { key: 'for', label: 'For', sort: (r) => r.purpose, render: (r) => h('span', null, h('strong', r.purpose), h('small', r.code)), csv: (r) => `${r.purpose} (${r.code})` },
    { key: 'mode', label: 'Paid by', sort: (r) => r.via, render: (r) => h('span', null, r.via, r.txn_ref ? h('small', r.txn_ref) : null), csv: (r) => `${r.via} ${r.txn_ref || ''}`.trim() },
    { key: 'amt', label: 'Amount', sort: (r) => N(r.amount) * (r.entry_type === 'Expense' ? -1 : 1), render: (r) => h('strong', `${r.entry_type === 'Expense' ? '-' : '+'}${money(r.amount)}`), csv: (r) => r.amount, nowrap: true },
    { key: 'holder', label: 'Cash held by', sort: (r) => (r.cash_user ? whoName(r.cash_user) : ''), render: (r) => (r.cash_user ? whoName(r.cash_user) : 'Company account'), csv: (r) => (r.cash_user ? whoName(r.cash_user) : '') },
    { key: 'del', label: 'Delivery', sort: (r) => st.codes.get(r.delivery_id) || '', render: (r) => (r.delivery_id && st.codes.get(r.delivery_id) ? h('a', { href: `#/deliveries?open=${r.delivery_id}`, on: { click: (e) => { e.preventDefault(); openDeliveryDetail(r.delivery_id); } } }, st.codes.get(r.delivery_id)) : ''), csv: (r) => st.codes.get(r.delivery_id) || '' },
    { key: 'status', label: 'Status', sort: (r) => r.status, render: (r) => moneyChip(r), csv: (r) => r.status },
    { key: 'fin', label: 'Finance', sort: (r) => r.fin_status, render: (r) => finChip(r.fin_status), csv: (r) => r.fin_status }];
  table = dataTable({ columns: cols, rowKey: 'id', defaultSort: { key: 'paid', dir: 'desc' }, selectable: true, selected, storageKey: 'fin-payments', onSelect: paintBar, empty: 'No payments match.',
    rowClick: (r) => openEntry(r.id, load), rowClass: (r) => (r.status === 'void' ? 'void' : '') });

  const shown = () => st.rows.filter(m => {
    if (st.q) { const t = `${m.purpose} ${m.txn_ref || ''} ${m.code} ${st.codes.get(m.delivery_id) || ''} ${m.via_note || ''}`.toUpperCase(); if (!t.includes(st.q.toUpperCase())) return false; }
    return true;
  });
  function paintBar() {
    const n = selected.size; bar.hidden = n === 0; if (!n) return;
    mount(bar, h('strong', `${n} selected`), btn('Acknowledge as reviewed', { kind: 'primary', ic: 'check', onClick: () => acknowledge([...selected]) }), btn('Clear', { onClick: () => { selected.clear(); table.repaint(); paintBar(); } }));
  }
  async function acknowledge(ids) {
    const ok = await confirmDialog({ title: `Acknowledge ${ids.length} payment${ids.length === 1 ? '' : 's'}?`, message: 'You are confirming that you have checked the amount, mode, transaction id, proof and date. Payments already reviewed or corrected are skipped.', confirmLabel: 'Acknowledge' });
    if (!ok) return;
    try { const n = await rpc('finance_acknowledge', { p_ids: ids, p_note: null }); toast(`${n} acknowledged`); selected.clear(); await load(); } catch (e) { toast(friendlyError(e), 'error'); }
  }
  function paint() {
    const list = shown(); for (const id of [...selected]) if (!list.some(r => r.id === id)) selected.delete(id);
    const live = list.filter(m => m.status !== 'void'); const un = live.filter(m => m.fin_status === 'unreviewed');
    const inc = live.filter(m => m.entry_type === 'Income').reduce((a, m) => a + N(m.amount), 0), exp = live.filter(m => m.entry_type === 'Expense').reduce((a, m) => a + N(m.amount), 0);
    mount(tiles, ...[[money(inc), 'income'], [money(exp), 'expenses'], [money(inc - exp), 'net'], [`${un.length} (${money(un.reduce((a, m) => a + (m.entry_type === 'Income' ? 1 : -1) * N(m.amount), 0))})`, 'not reviewed yet']].map(([v, l]) => h('div', { class: 'stat' }, h('strong', v), h('span', l))));
    count.textContent = `${list.length} payment${list.length === 1 ? '' : 's'}`; table.setRows(list); paintBar();
  }
  async function load() {
    st.from = from.value || st.from; st.to = to.value || st.to; mount(body, skeletonRows(5));
    try {
      st.rows = await fetchAll(() => {
        let q = sb.from('money_entries').select('*').gte('paid_on', startOf(st.from)).lt('paid_on', startOf(shift(st.to, 1))).order('paid_on', { ascending: false }).order('id', { ascending: false });
        if (st.type !== 'all') q = q.eq('entry_type', st.type); if (st.mode !== 'all') q = q.eq('via', st.mode); if (st.fin !== 'all') q = q.eq('fin_status', st.fin);
        if (st.user !== 'all') q = q.or(`cash_user.eq.${st.user},created_by.eq.${st.user}`); if (!st.void) q = q.neq('status', 'void'); return q; });
      const ids = [...new Set(st.rows.map(r => r.delivery_id).filter(Boolean))];
      for (let i = 0; i < ids.length; i += 200) (await sb.from('deliveries').select('id,code').in('id', ids.slice(i, i + 200))).data?.forEach(d => st.codes.set(d.id, d.code));
    } catch (e) { return mount(body, emptyState('Could not load payments', friendlyError(e) + ' If this is the first time, run the Stage 5 database script.', btn('Try again', { kind: 'primary', onClick: load }))); }
    mount(body, table.el); paint();
  }
  [from, to, type, mode, fin, people].forEach(el => el.addEventListener('change', () => { st.type = type.value; st.mode = mode.value; st.fin = fin.value; st.user = people.value; selected.clear(); load(); }));
  showVoid.firstChild.addEventListener('change', () => { st.void = showVoid.firstChild.checked; load(); });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); paint(); }, 200));
  mount(panel, h('div', { class: 'toolbar' }, field('From payment date', from), field('To', to), field('Reviewed?', fin), field('Person', people)),
    h('div', { class: 'toolbar' }, type, mode, h('div', { class: 'search' }, icon('search', 18), search), showVoid, btn('Download as CSV', { ic: 'download', onClick: () => table.download(`payments-${st.from}-to-${st.to}`) })),
    tiles, count, bar, body);
  await load();
}

// =============================================================================================== one payment: proof, acknowledge, correct
export async function openEntry(id, onChange) {
  const s = openSheet({ title: 'Payment', body: skeletonRows(4), footer: [], wide: true });
  async function paint() {
    try {
      const { data: m, error } = await sb.from('money_entries').select('*').eq('id', id).maybeSingle(); if (error) throw error; if (!m) throw new Error('This payment was not found.');
      const [dRes, eRes, gRes] = await Promise.all([m.delivery_id ? sb.from('deliveries').select('id,code,status').eq('id', m.delivery_id).maybeSingle() : { data: null },
        sb.from('money_edits').select('*').eq('money_id', id).order('edited_at', { ascending: false }).then(r => (r.error ? { data: [] } : r)),
        m.pay_group ? sb.from('money_entries').select('id,purpose,amount,status').eq('pay_group', m.pay_group).order('id') : { data: [] }]);
      draw(m, dRes.data, eRes.data || [], gRes.data || []);
    } catch (e) { mount(s.body, emptyState('Could not load', friendlyError(e))); }
  }
  const after = async () => { await paint(); onChange?.(); };
  function draw(m, d, edits, group) {
    s.el.querySelector('.sheet-head h2').textContent = m.code;
    const kv = (k, v) => (v === null || v === undefined || v === '' ? null : h('div', { class: 'kv' }, h('dt', k), h('dd', v)));
    const proof = h('div', { class: 'stack-sm' }, h('strong', 'Proof'));
    if (m.receipt) { proof.append(h('p', { class: 'muted small' }, 'Loading…')); signedUrls([m.receipt]).then(u => { const url = u[m.receipt]; proof.lastChild.remove(); if (!url) return proof.append(h('p', { class: 'muted small' }, 'The proof could not be opened.'));
      const img = h('img', { src: url, alt: 'Payment proof', style: 'max-width:240px;max-height:240px;border-radius:10px;cursor:zoom-in' }); img.addEventListener('click', () => lightbox(url, `${m.code} proof`)); proof.append(img); }).catch(() => {}); }
    else proof.append(h('p', { class: 'muted small' }, m.via === 'Cash' ? 'Cash payment, no proof photo.' : 'No proof photo is attached.'));
    const acts = [];
    if (m.status !== 'void') {
      if (m.fin_status === 'unreviewed') acts.push(btn('Acknowledge as reviewed', { kind: 'primary', ic: 'check', onClick: async () => { try { await rpc('finance_acknowledge', { p_ids: [m.id], p_note: null }); toast('Acknowledged'); await after(); } catch (e) { toast(friendlyError(e), 'error'); } } }));
      else acts.push(btn('Mark as not reviewed', { ic: 'undo', onClick: async () => { const r = await confirmDialog({ title: 'Mark as not reviewed?', message: 'It goes back to the review list.', confirmLabel: 'Yes', reason: { label: 'Reason', required: true } }); if (!r) return; try { await rpc('finance_reopen', { p_ids: [m.id], p_reason: r.text }); toast('Done'); await after(); } catch (e) { toast(friendlyError(e), 'error'); } } }));
      acts.push(btn('Correct this payment', { ic: 'edit', onClick: () => openEdit(m, after) }));
    }
    if (d) acts.push(btn(`Open ${d.code}`, { ic: 'right', onClick: () => openDeliveryDetail(d.id) }));
    mount(s.body,
      h('div', { class: 'detail-top' }, chip(m.entry_type, m.entry_type === 'Income' ? 'blue' : 'pink'), moneyChip(m), finChip(m.fin_status)),
      h('div', { class: 'action-bar' }, acts),
      h('dl', { class: 'kvs' },
        kv('Amount', `${m.entry_type === 'Expense' ? '-' : '+'}${fmtMoney(m.amount)}`), kv('For', m.purpose), kv('Paid by', m.via), kv('Transaction ID / UTR', m.txn_ref), kv('Paid into / note', m.via_note),
        kv('Cash held by', m.cash_user ? whoName(m.cash_user) : m.via === 'Cash' ? '' : 'Company account'),
        kv('Payment date (can be corrected)', fmtDateTimeY(m.paid_on)), kv('Entered in the system (fixed)', `${fmtDateTimeY(m.created_at)}, ${whoName(m.created_by)}`),
        group.length > 1 ? kv('Part of one payment', group.map(g => `${g.purpose} ${fmtMoney(g.amount)}`).join(', ')) : null,
        kv('Delivery', d ? d.code : null), m.ack_at ? kv('Cash acknowledged', `${whoName(m.ack_by)}, ${fmtDateTimeY(m.ack_at)}`) : null, m.approved_at ? kv('Approved', `${whoName(m.approved_by)}, ${fmtDateTimeY(m.approved_at)}`) : null,
        m.fin_at ? kv('Finance', `${FIN[m.fin_status]?.[0] || ''} by ${whoName(m.fin_by)}, ${fmtDateTimeY(m.fin_at)}${m.fin_note ? `. ${m.fin_note}` : ''}`) : null,
        m.dispute_reason ? kv('Disputed', m.dispute_reason) : null, m.void_reason ? kv('Voided', m.void_reason) : null),
      proof,
      edits.length ? h('div', { class: 'stack-sm' }, h('strong', 'Corrections'), h('ul', { class: 'pay-list' }, edits.map(e => h('li', { class: 'pay-row' }, h('div', null,
        h('strong', `${whoName(e.edited_by)}, ${fmtDateTimeY(e.edited_at)}`), h('small', `Reason: ${e.reason}`), h('small', changeText(e.old_values, e.new_values))))))) : null);
  }
  const LAB = { amount: 'Amount', purpose: 'For', via: 'Paid by', txn_ref: 'Transaction ID', via_note: 'Paid into', cash_user: 'Cash holder', paid_on: 'Payment date' };
  const show = (k, v) => (v === undefined ? 'none' : k === 'paid_on' ? fmtDateTimeY(v) : k === 'cash_user' ? whoName(v) : k === 'amount' ? fmtMoney(v) : String(v));
  const changeText = (o, n) => Object.keys({ ...o, ...n }).filter(k => JSON.stringify(o[k]) !== JSON.stringify(n[k])).map(k => `${LAB[k] || k}: ${show(k, o[k])} to ${show(k, n[k])}`).join('. ');

  function openEdit(m, done) {
    const when = input({ type: 'datetime-local', value: localInputValue(new Date(m.paid_on)) }); const fWhen = field('Payment date', when, { hint: 'The date the money was really received. The time it was entered in the system never changes.' });
    const amt = input({ inputmode: 'decimal', value: String(m.amount) }); const fAmt = field('Amount', amt, { required: true });
    const purpose = input({ value: m.purpose }); const fPurpose = field('For', purpose, { required: true });
    const via = select(VIAS.map(v => ({ value: v, label: v })), { value: m.via }); const fVia = field('Paid by', via);
    const txn = input({ value: m.txn_ref || '' }); const fTxn = field('Transaction ID / UTR', txn);
    const note = input({ value: m.via_note || '' }); const fNote = field('Paid into / note', note);
    const holder = select(userOptions({ blank: true }), { value: m.cash_user || '' }); const fHolder = field('Cash held by', holder, { required: true });
    const reason = textarea({ rows: '2', placeholder: 'Why is this being corrected?' }); const fReason = field('Reason for the correction', reason, { required: true });
    const err = h('p', { class: 'field-error', hidden: true });
    const sync = () => { const c = via.value === 'Cash'; fHolder.hidden = !c; fTxn.hidden = c; fNote.hidden = c; }; via.addEventListener('change', sync); sync();
    const save = btn('Save correction', { kind: 'primary', type: 'submit' }); save.setAttribute('form', 'fin-edit');
    const form = h('form', { id: 'fin-edit', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); err.hidden = true; [fAmt, fPurpose, fReason].forEach(f => f.setError(''));
      let ok = true; if (!(num(amt.value) > 0)) { fAmt.setError('Enter an amount above zero.'); ok = false; } if (!purpose.value.trim()) { fPurpose.setError('Say what it is for.'); ok = false; } if (!reason.value.trim()) { fReason.setError('Write the reason.'); ok = false; } if (!ok) return;
      busy(save, async () => { try {
        await rpc('finance_update_money', { p_id: m.id, p: { amount: String(num(amt.value)), purpose: purpose.value.trim(), via: via.value, txn_ref: txn.value.trim(), via_note: note.value.trim(), cash_user: via.value === 'Cash' ? holder.value : '', paid_on: isoFromLocal(when.value), reason: reason.value.trim() } });
        toast('Corrected. The old values are kept in the list of corrections.'); e2.close(); await done(); } catch (e) { err.textContent = friendlyError(e); err.hidden = false; } }); } } },
      h('div', { class: 'callout' }, icon('info', 18), h('span', `Entered in the system on ${fmtDateTimeY(m.created_at)} by ${whoName(m.created_by)}. That time cannot be changed.`)),
      fWhen, h('div', { class: 'grid-2' }, fAmt, fVia), fPurpose, fHolder, fTxn, fNote, fReason, err);
    const e2 = openSheet({ title: 'Correct this payment', subtitle: m.code, body: form, footer: [btn('Cancel', { onClick: () => e2.close() }), save] });
  }
  await paint();
  return s;
}
