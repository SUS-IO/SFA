// Accounts (Admin and Superadmin): review the money in three steps and see what is still unreviewed.
//   1 By delivery   2 By user and day   3 Day summary   4 Cash waiting to be acknowledged   5 All payments
// Put this file in: assets/js/views/accounts.js
import { h, icon, btn, busy, chip, field, input, select, segmented, openSheet, toast, mount, emptyState, skeletonRows, fmtDateTimeY, fmtMoney, friendlyError, confirmDialog } from '../core/ui.js';
import { sb, rpc, fetchAll } from '../core/supa.js';
import { state, can, whoName } from '../core/store.js';
import { dataTable } from '../core/table.js';
import { fmtAge } from '../core/ageing.js';
import { moneyChip } from '../core/ops.js';
import { fmtDay } from '../core/masters.js';
import { openEntry, paymentsTab } from './finance.js';
import { openDeliveryDetail } from './deliveries.js';

const IST = 5.5 * 3600e3;
const istDay = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
const shift = (day, n) => istDay(new Date(`${day}T00:00:00+05:30`).getTime() + n * 86400e3);
const dayLabel = (d) => `${fmtDay(d)} ${new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}`;
const N = (v) => Number(v) || 0;
const money = (v) => fmtMoney(N(v));
const nameOf = (id) => (id ? whoName(id) : '');
const shortName = (id) => state.profiles.find(p => p.id === id)?.user_name || 'Someone';
const KIND_LABEL = { booking: 'Booking', delivery: 'Delivery handover', extension: 'Extension', swap: 'Swap', pickup: 'Pickup' };
const refGroup = (m) => (m.purpose === 'Booking advance' || m.purpose === 'Booking refund' ? 'Booking' : KIND_LABEL[m.ref_kind] || (m.ref_kind ? m.ref_kind : 'Delivery handover'));
const GROUP_ORDER = ['Booking', 'Delivery handover', 'Extension', 'Swap', 'Pickup'];

let styled = false;
function ensureStyles() {
  if (styled) return; styled = true;
  const el = document.createElement('style');
  el.textContent = `
.ac-card{border:1px solid rgba(128,128,128,.28);border-radius:14px;padding:1rem;margin:.75rem 0}
.ac-bar{display:grid;grid-template-columns:130px 1fr 120px;gap:.6rem;align-items:center;margin:.35rem 0;font-size:.9rem}
.ac-track{height:9px;border-radius:9px;background:rgba(128,128,128,.18);overflow:hidden}.ac-fill{height:100%;border-radius:9px}
.ac-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.6rem;margin-top:.8rem}
.ac-tile{border:1px solid rgba(128,128,128,.28);border-radius:10px;padding:.5rem .7rem}.ac-tile small{display:block;opacity:.7}.ac-tile strong{font-size:1.05rem}
.ac-two{display:grid;grid-template-columns:1fr 1fr;border:1px solid rgba(128,128,128,.28);border-radius:14px;overflow:hidden;margin:.75rem 0}
@media (max-width:760px){.ac-two{grid-template-columns:1fr}}
.ac-col{min-width:0}.ac-col+.ac-col{border-left:1px solid rgba(128,128,128,.28)}
@media (max-width:760px){.ac-col+.ac-col{border-left:0;border-top:1px solid rgba(128,128,128,.28)}}
.ac-head{display:flex;justify-content:space-between;align-items:center;padding:.7rem .9rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:.85rem}
.ac-in .ac-head{background:rgba(16,185,129,.13)}.ac-out .ac-head{background:rgba(242,106,141,.14)}
.ac-row{display:flex;gap:.6rem;justify-content:space-between;padding:.65rem .9rem;border-top:1px solid rgba(128,128,128,.2)}
.ac-row.clk{cursor:pointer}.ac-row.clk:hover{background:rgba(128,128,128,.08)}
.ac-row small{display:block;opacity:.72;margin-top:.1rem}.ac-row .amt{font-weight:700;white-space:nowrap;text-align:right}
.ac-in .amt{color:#059669}.ac-out .amt{color:#e11d48}
.ac-bf{background:rgba(128,128,128,.08)}.ac-foot{display:flex;justify-content:space-between;padding:.8rem .9rem;border-top:1px solid rgba(128,128,128,.28);font-weight:700;background:rgba(128,128,128,.1)}
.ac-final{display:flex;justify-content:space-between;padding:.9rem;background:#1c2233;color:#fff;font-weight:700;border-radius:0 0 12px 12px}
.ac-final span:last-child{color:#34d399}
.ac-users{display:flex;gap:.4rem;flex-wrap:wrap;margin:.5rem 0}
`;
  document.head.append(el);
}

export async function render(root, params) {
  if (!can.admin()) return mount(root, emptyState('Accounts are for Admins', 'Only an Admin or Superadmin can open this page.'));
  ensureStyles();
  const TABS = [{ value: 'delivery', label: '1 · By delivery' }, { value: 'user', label: '2 · By user and day' }, { value: 'days', label: '3 · Day summary' }, { value: 'cash', label: 'Cash waiting' }, { value: 'payments', label: 'All payments' }];
  const panel = h('div');
  const tabs = segmented(TABS, TABS.some(t => t.value === params.sub) ? params.sub : 'delivery', (v) => show(v));
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Accounts'), h('p', { class: 'muted' }, 'Step 1: check every delivery\'s money. Step 2: check each person\'s day. Step 3: see which days are reviewed.'))), h('div', { class: 'toolbar' }, tabs), panel);
  const nav = { go: (tab, opts) => { tabs.dataset.value = tab; [...tabs.children].forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === tab))); show(tab, opts); } };
  async function show(tab, opts = {}) {
    history.replaceState(null, '', `#/accounts/${tab}`); mount(panel, skeletonRows(5));
    try { await ({ delivery: deliveryTab, user: userTab, days: daysTab, cash: cashTab, payments: paymentsTab })[tab](panel, { ...opts, nav }); }
    catch (e) { mount(panel, emptyState('Could not load this tab', friendlyError(e) + ' If this is the first time, run the Stage 8 database script.', btn('Try again', { kind: 'primary', onClick: () => show(tab, opts) }))); }
  }
  await show(tabs.get());
}

const rangeBar = (st, onChange, extra = []) => {
  const from = input({ type: 'date', value: st.from }), to = input({ type: 'date', value: st.to });
  const go = () => { st.from = from.value || st.from; st.to = to.value || st.to; if (st.to < st.from) return toast('The last day must not be before the first day.', 'error'); onChange(); };
  from.addEventListener('change', go); to.addEventListener('change', go);
  const quick = (l, a, b) => btn(l, { small: true, onClick: () => { from.value = st.from = a; to.value = st.to = b; onChange(); } });
  const t = istDay();
  return h('div', { class: 'toolbar' }, field('From', from), field('To', to), quick('Today', t, t), quick('Yesterday', shift(t, -1), shift(t, -1)), quick('Last 7 days', shift(t, -6), t), quick('This month', t.slice(0, 8) + '01', t), ...extra);
};
const tile = (v, l) => h('div', { class: 'ac-tile' }, h('small', l), h('strong', v));

// =============================================================================================== 1. by delivery
async function deliveryTab(panel) {
  const st = { from: shift(istDay(), -6), to: istDay(), review: 'todo', q: '', rows: [] };
  const selected = new Set(); const tiles = h('div', { class: 'ac-tiles' }); const body = h('div'); const bar = h('div', { class: 'mv-bar', hidden: true });
  const reviewSel = select([{ value: 'todo', label: 'Not reviewed yet' }, { value: 'all', label: 'All' }, { value: 'done', label: 'Reviewed' }], { value: st.review, 'aria-label': 'Review status' });
  const search = input({ type: 'search', placeholder: 'Search delivery number, customer or vehicle' });
  const state_ = (r) => (r.awaiting > 0 ? 'wait' : r.unreviewed > 0 ? 'todo' : 'done');
  const table = dataTable({ rowKey: 'delivery_id', selectable: true, selected, storageKey: 'acct-del', defaultSort: { key: 'last', dir: 'desc' }, empty: 'No deliveries match.', onSelect: paintBar, rowClick: (r) => openDeliveryReview(r.delivery_id, load),
    columns: [
      { key: 'code', label: 'Delivery', nowrap: true, sort: (r) => r.code, render: (r) => h('span', null, h('strong', r.code), h('small', r.d_status.replace('_', ' '))), csv: (r) => r.code },
      { key: 'cust', label: 'Customer', sort: (r) => r.customer.toLowerCase(), render: (r) => r.customer || '—' },
      { key: 'veh', label: 'Vehicle', nowrap: true, sort: (r) => r.vehicle, render: (r) => r.vehicle },
      { key: 'charges', label: 'Charges', nowrap: true, sort: (r) => N(r.charges), render: (r) => money(r.charges) },
      { key: 'paid', label: 'Received', nowrap: true, sort: (r) => N(r.paid), render: (r) => money(r.paid) },
      { key: 'bal', label: 'Balance', nowrap: true, sort: (r) => N(r.charges) - N(r.paid), render: (r) => { const b = N(r.charges) - N(r.paid); return b > 0.005 ? chip(`Short ${money(b)}`, 'pink') : b < -0.005 ? chip(`Extra ${money(-b)}`, 'blue') : 'Tallied'; }, csv: (r) => N(r.charges) - N(r.paid) },
      { key: 'inc', label: 'Income', nowrap: true, sort: (r) => N(r.income), render: (r) => money(r.income) },
      { key: 'exp', label: 'Expense', nowrap: true, sort: (r) => N(r.expense), render: (r) => money(r.expense) },
      { key: 'rev', label: 'Review', sort: (r) => ({ wait: 0, todo: 1, done: 2 })[state_(r)], render: (r) => { const s = state_(r); return s === 'done' ? chip('Reviewed', 'aqua', 'check') : s === 'wait' ? chip(`${r.awaiting} awaiting cash acknowledgement`, 'pink') : chip(`${r.unreviewed} to review`, 'blue'); }, csv: (r) => state_(r) },
      { key: 'last', label: 'Last payment', nowrap: true, sort: (r) => new Date(r.last_paid).getTime(), render: (r) => fmtDateTimeY(r.last_paid), csv: (r) => fmtDateTimeY(r.last_paid) }] });
  function shown() { const q = st.q.toUpperCase(); return st.rows.filter(r => (st.review === 'all' || (st.review === 'done' ? state_(r) === 'done' : state_(r) !== 'done')) && (!q || `${r.code} ${r.customer} ${r.vehicle}`.toUpperCase().includes(q))); }
  function paintBar() { const n = selected.size; bar.hidden = !n; if (!n) return; mount(bar, h('strong', `${n} selected`), btn('Mark as reviewed', { kind: 'primary', ic: 'check', onClick: reviewSelected }), btn('Clear', { onClick: () => { selected.clear(); table.repaint(); paintBar(); } })); }
  async function reviewSelected() {
    const ids = [...selected]; if (!(await confirmDialog({ title: `Mark ${ids.length} deliver${ids.length === 1 ? 'y' : 'ies'} as reviewed?`, message: 'You are confirming that the amounts, modes, transaction ids, proofs and dates of all their payments are checked.', confirmLabel: 'Mark reviewed' }))) return;
    let ok = 0; const bad = [];
    for (const id of ids) { try { await rpc('acct_review_delivery', { p_delivery: id, p_note: null }); ok++; } catch (e) { bad.push(`${st.rows.find(r => r.delivery_id === id)?.code}: ${friendlyError(e)}`); } }
    toast(`${ok} reviewed${bad.length ? `, ${bad.length} not done. ${bad[0]}` : ''}`, bad.length ? 'error' : 'success'); selected.clear(); load();
  }
  function paint() {
    const list = shown(); for (const id of [...selected]) if (!list.some(r => r.delivery_id === id)) selected.delete(id);
    const todo = st.rows.filter(r => state_(r) !== 'done');
    mount(tiles, tile(String(st.rows.length), 'deliveries with payments'), tile(String(todo.length), 'still to review'), tile(money(st.rows.reduce((a, r) => a + N(r.income), 0)), 'income'), tile(money(st.rows.reduce((a, r) => a + N(r.expense), 0)), 'expenses'));
    table.setRows(list); paintBar();
  }
  async function load() { mount(body, skeletonRows(5)); st.rows = (await rpc('acct_delivery_review', { p_from: st.from, p_to: st.to })) || []; mount(body, table.el); paint(); }
  reviewSel.addEventListener('change', () => { st.review = reviewSel.value; paint(); }); search.addEventListener('input', () => { st.q = search.value.trim(); paint(); });
  mount(panel, rangeBar(st, load, []), h('div', { class: 'toolbar' }, reviewSel, h('div', { class: 'search' }, icon('search', 18), search), btn('Download as CSV', { ic: 'download', onClick: () => table.download(`accounts-by-delivery-${st.from}-to-${st.to}`) })),
    h('p', { class: 'muted small' }, 'Days are by payment date. Open a delivery to see its booking, delivery, extension, swap and pickup payments one by one.'), tiles, bar, body);
  await load();
}

// ---- one delivery: all of its money by booking / delivery / extension / swap / pickup
export async function openDeliveryReview(id, onChange) {
  const s = openSheet({ title: 'Delivery accounts', body: skeletonRows(5), footer: [], wide: true });
  async function paint() {
    try {
      const [dRes, mRes, bill] = await Promise.all([sb.from('deliveries').select('id,code,status,customer_id,vehicle_id,booking_vehicle_id,booking_name').eq('id', id).maybeSingle(),
        sb.from('money_entries').select('*').eq('delivery_id', id).order('paid_on').order('id'), rpc('delivery_bill', { p_id: id }).catch(() => null)]);
      if (dRes.error) throw dRes.error; if (mRes.error) throw mRes.error; draw(dRes.data, mRes.data, bill);
    } catch (e) { mount(s.body, emptyState('Could not load', friendlyError(e))); }
  }
  const after = async () => { await paint(); onChange?.(); };
  function draw(d, ms, bill) {
    s.el.querySelector('.sheet-head h2').textContent = d.code;
    const live = ms.filter(m => m.status !== 'void'); const todo = live.filter(m => m.fin_status === 'unreviewed'); const wait = live.filter(m => ['pending_ack', 'disputed'].includes(m.status));
    const groups = new Map(); live.forEach(m => { const g = refGroup(m); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m); });
    const order = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 99) % 99 - (GROUP_ORDER.indexOf(b) + 99) % 99);
    const sign = (m) => `${m.entry_type === 'Expense' ? '-' : '+'}${money(m.amount)}`;
    const acts = [btn('Mark all reviewed', { kind: 'primary', ic: 'check', disabled: !todo.length || wait.length > 0, onClick: (e) => busy(e.currentTarget, async () => { try { const n = await rpc('acct_review_delivery', { p_delivery: id, p_note: null }); toast(`${n} payment${n === 1 ? '' : 's'} reviewed`); await after(); } catch (err) { toast(friendlyError(err), 'error'); } })}),
      btn('Open delivery', { ic: 'right', onClick: () => openDeliveryDetail(id) })];
    mount(s.body,
      h('div', { class: 'detail-top' }, chip(d.status.replace('_', ' '), 'neutral'), todo.length ? chip(`${todo.length} to review`, 'blue') : chip('All reviewed', 'aqua', 'check'), wait.length ? chip(`${wait.length} waiting for cash acknowledgement`, 'pink') : null),
      h('div', { class: 'action-bar' }, acts),
      bill ? h('div', { class: 'ac-tiles' }, tile(money(bill.charges), 'Charges'), tile(money(bill.paid), 'Received'), tile(money(bill.awaiting_ack), 'Cash awaiting acknowledgement'), tile(money(bill.deposit_refunded), 'Deposit refunded'), tile(money(bill.balance_due), 'Balance due')) : null,
      order.length ? order.map(g => { const rows = groups.get(g); const inc = rows.filter(r => r.entry_type === 'Income').reduce((a, r) => a + N(r.amount), 0), exp = rows.filter(r => r.entry_type === 'Expense').reduce((a, r) => a + N(r.amount), 0);
        return h('div', { class: 'ac-card' }, h('div', { style: 'display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap' }, h('strong', g), h('span', { class: 'muted' }, `In ${money(inc)}${exp ? ` · Out ${money(exp)}` : ''}`)),
          rows.map(m => h('div', { class: 'ac-row clk', on: { click: () => openEntry(m.id, after) } },
            h('span', null, h('strong', m.purpose), h('small', [fmtDateTimeY(m.paid_on), ' · ', m.via, m.account ? ` (${m.account})` : '', m.txn_ref ? ` · ${m.txn_ref}` : '', ' · by ', nameOf(m.created_by), m.cash_user ? ` · cash with ${shortName(m.cash_user)}` : ''].join(''))),
            h('span', { style: 'text-align:right' }, h('strong', sign(m)), h('small', null, moneyChip(m), ' ', m.fin_status === 'unreviewed' ? chip('To review', 'blue') : chip(m.fin_status === 'modified' ? 'Corrected' : 'Reviewed', 'aqua'))))));
      }) : emptyState('No payments', 'Nothing has been received or paid for this delivery.'));
  }
  await paint(); return s;
}

// =============================================================================================== 2. by user and day
async function userTab(panel, opts) {
  const st = { day: opts.day || istDay(), uid: opts.uid || null, users: [] };
  const dayIn = input({ type: 'date', value: st.day }); const who = select([], { 'aria-label': 'Person' }); const body = h('div');
  const go = (n) => { st.day = shift(st.day, n); dayIn.value = st.day; st.uid = null; load(); };
  async function load() {
    mount(body, skeletonRows(5));
    const rows = (await rpc('acct_day_users', { p_from: st.day, p_to: st.day })) || []; st.users = rows.filter(r => r.entries > 0 || N(r.opening) !== 0);
    if (!st.users.length) { who.replaceChildren(h('option', { value: '' }, 'No activity')); return mount(body, emptyState('Nothing on this day', 'No money was received, paid or handed over on this day.')); }
    if (!st.uid || !st.users.some(u => u.uid === st.uid)) st.uid = st.users.find(u => !u.reviewed_at || u.stale)?.uid || st.users[0].uid;
    who.replaceChildren(...st.users.map(u => h('option', { value: u.uid }, `${shortName(u.uid)} — ${u.reviewed_at && !u.stale ? 'reviewed' : u.stale ? 'changed after review' : `${u.unrev_delivery + u.unrev_other} to review`}`))); who.value = st.uid;
    await drawUser();
  }
  async function drawUser() {
    const u = st.users.find(x => x.uid === st.uid); if (!u) return;
    const [ev, opening] = await Promise.all([rpc('acct_user_day', { p_day: st.day, p_user: st.uid }), rpc('acct_user_opening', { p_day: st.day, p_user: st.uid })]);
    const rows = ev || []; const cash = (r) => !r.noncash;
    const inc = rows.filter(r => (r.kind === 'Income' && cash(r)) || r.kind === 'Received'), out = rows.filter(r => (r.kind === 'Expense' && cash(r)) || r.kind === 'Handed over'), dig = rows.filter(r => r.noncash);
    const counted = (r) => !r.awaiting && !r.disputed; const sum = (l, f = counted) => l.filter(f).reduce((a, r) => a + N(r.amount), 0);
    const incSum = sum(inc), outSum = out.reduce((a, r) => a + (r.kind === 'Handed over' || counted(r) ? N(r.amount) : 0), 0), balance = N(opening) + incSum - outSum;
    const scale = Math.max(incSum, outSum, Math.abs(balance), 1);
    const bar = (label, v, color) => h('div', { class: 'ac-bar' }, h('span', label), h('div', { class: 'ac-track' }, h('div', { class: 'ac-fill', style: `width:${Math.min(100, Math.abs(v) / scale * 100)}%;background:${color}` })), h('strong', { style: 'text-align:right' }, money(v)));
    const pend = rows.filter(r => r.awaiting);
    const rowEl = (r, side) => {
      const title = r.src === 'transfer' ? r.seg : `${r.purpose}${r.sub_category ? ` · ${r.sub_category}` : ''}`;
      const sub = [fmtDateTimeY(r.paid_on).replace(/^\d+ \w+ \d+,? ?/, ''), r.src === 'money' ? `by ${shortName(r.created_by)}` : '', r.mode !== 'Cash' ? `${r.mode}${r.account ? ` (${r.account})` : ''}${r.txn_ref ? ` ${r.txn_ref}` : ''}` : '', r.awaiting ? 'Awaiting acknowledgement' : r.disputed ? 'Disputed' : (r.ack_at ? `Acknowledged by ${shortName(r.ack_by)}` : '')].filter(Boolean).join(' · ');
      const chipEl = r.src === 'transfer' ? (r.awaiting ? chip('Awaiting', 'pink') : chip('Done', 'aqua')) : r.fin_status === 'unreviewed' ? chip('To review', 'blue') : chip(r.fin_status === 'modified' ? 'Corrected' : 'Reviewed', 'aqua', 'check');
      return h('div', { class: `ac-row ${r.src === 'money' ? 'clk' : ''}`, on: r.src === 'money' ? { click: () => openEntry(r.src_id, drawUser) } : {} },
        h('span', null, h('strong', title), r.delivery_code ? h('small', null, h('a', { href: `#/deliveries?open=${r.delivery_id}`, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); openDeliveryReview(r.delivery_id, drawUser); } } }, r.delivery_code), r.ref_kind ? ` · ${KIND_LABEL[r.ref_kind] || r.ref_kind}` : '') : null, h('small', sub)),
        h('span', { class: 'amt' }, `${money(r.amount)}`, h('small', null, chipEl)));
    };
    const reviewed = u.reviewed_at && !u.stale;
    const blockers = u.unrev_delivery > 0 ? `${u.unrev_delivery} delivery payment${u.unrev_delivery === 1 ? '' : 's'} not reviewed yet. Review them under “1 · By delivery” first.` : '';
    const acts = [reviewed ? btn('Reopen this day', { ic: 'undo', onClick: async () => { const r = await confirmDialog({ title: 'Reopen this day?', message: 'It goes back to the review list.', confirmLabel: 'Reopen', reason: { label: 'Reason', required: true } }); if (!r) return; try { await rpc('acct_reopen_user_day', { p_day: st.day, p_user: st.uid, p_reason: r.text }); toast('Reopened'); await load(); } catch (e) { toast(friendlyError(e), 'error'); } } })
      : btn(`Mark ${shortName(st.uid)}'s day as reviewed`, { kind: 'primary', ic: 'check', disabled: !!blockers, onClick: (e) => busy(e.currentTarget, async () => { try { await rpc('acct_review_user_day', { p_day: st.day, p_user: st.uid, p_note: null }); toast('Day reviewed'); await load(); } catch (err) { toast(friendlyError(err), 'error'); } }) }),
      blockers ? btn('Go to deliveries', { onClick: () => opts.nav.go('delivery') }) : null];
    mount(body,
      h('div', { class: 'ac-card' }, h('strong', `${nameOf(st.uid)} · ${dayLabel(st.day)}`),
        bar('Income', incSum, '#10b981'), bar('Outflow', outSum, '#f43f5e'), bar('Net cash in hand', balance, '#111827'),
        h('div', { class: 'ac-tiles' }, tile(String(pend.length), 'Pending acknowledgement'), tile(String(rows.filter(r => r.kind === 'Income' && counted(r)).length), 'Receipts'), tile(String(rows.filter(r => r.kind === 'Expense').length), 'Expenses'),
          tile(money(sum(rows.filter(r => r.kind === 'Handed over'), () => true)), 'Handovers'), tile(money(sum(dig.filter(r => r.kind === 'Income'), () => true)), 'Digital'))),
      h('div', { class: 'detail-top' }, reviewed ? chip(`Reviewed by ${shortName(u.reviewed_by)}, ${fmtDateTimeY(u.reviewed_at)}`, 'aqua', 'check') : u.stale ? chip('Changed after it was reviewed', 'pink') : chip('Not reviewed', 'blue'), blockers ? h('span', { class: 'muted small' }, blockers) : null),
      h('div', { class: 'action-bar' }, acts),
      h('div', { class: 'ac-two' },
        h('div', { class: 'ac-col ac-in' }, h('div', { class: 'ac-head' }, h('span', 'Income'), chip(`${inc.length} rows`, 'neutral')),
          h('div', { class: 'ac-row ac-bf' }, h('span', null, h('strong', 'Brought forward'), h('small', `Previous day closing · ${dayLabel(shift(st.day, -1))}`)), h('span', { class: 'amt', style: 'color:#b45309' }, money(opening))),
          inc.length ? inc.map(r => rowEl(r)) : h('div', { class: 'ac-row muted' }, 'No cash income.'),
          h('div', { class: 'ac-foot' }, h('span', 'Gross collections'), h('span', money(incSum)))),
        h('div', { class: 'ac-col ac-out' }, h('div', { class: 'ac-head' }, h('span', 'Outflow'), chip(`${out.length} rows`, 'neutral')),
          out.length ? out.map(r => rowEl(r)) : h('div', { class: 'ac-row muted' }, 'No cash outflow.'),
          h('div', { class: 'ac-foot', style: 'margin-top:auto' }, h('span', 'Grand total outflow'), h('span', money(outSum))))),
      h('div', { class: 'ac-final' }, h('span', 'Accumulated balance'), h('span', money(balance))),
      dig.length ? h('div', { class: 'ac-card' }, h('strong', 'Digital payments (UPI, Online, Card, Bank Transfer, Cheque) — not part of cash in hand'), dig.map(r => rowEl(r))) : null);
  }
  dayIn.addEventListener('change', () => { st.day = dayIn.value || st.day; st.uid = null; load(); }); who.addEventListener('change', () => { st.uid = who.value; drawUser(); });
  mount(panel, h('div', { class: 'toolbar' }, btn('‹ Previous day', { small: true, onClick: () => go(-1) }), field('Day', dayIn), btn('Next day ›', { small: true, onClick: () => go(1) }), btn('Today', { small: true, onClick: () => { st.day = istDay(); dayIn.value = st.day; st.uid = null; load(); } }), field('Person', who)),
    h('p', { class: 'muted small' }, 'Delivery payments are reviewed in step 1. Here you check each person\'s other income and expenses, handovers and cash balance, then mark the day reviewed.'), body);
  await load();
}

// =============================================================================================== 3. day summary
async function daysTab(panel, opts) {
  const st = { from: shift(istDay(), -13), to: istDay(), rows: [] }; const tiles = h('div', { class: 'ac-tiles' }); const body = h('div');
  const dayRows = () => { const m = new Map(); st.rows.forEach(r => { const d = String(r.day).slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d).push(r); }); return [...m].map(([day, us]) => {
    const active = us.filter(u => u.entries > 0); const done = active.filter(u => u.reviewed_at && !u.stale);
    return { day, users: active, n: active.length, done: done.length, inc: active.reduce((a, u) => a + N(u.income_cash) + N(u.income_digital), 0), out: active.reduce((a, u) => a + N(u.expense_cash) + N(u.expense_digital), 0), ho: active.reduce((a, u) => a + N(u.handed_over), 0),
      close: active.reduce((a, u) => a + N(u.closing), 0), pend: active.reduce((a, u) => a + N(u.pending_amt), 0), todo: active.reduce((a, u) => a + u.unrev_delivery + u.unrev_other, 0), stale: active.some(u => u.stale) }; }).filter(d => d.n > 0); };
  const table = dataTable({ rowKey: 'day', storageKey: 'acct-days', defaultSort: { key: 'day', dir: 'desc' }, empty: 'No activity in these days.', rowClick: (r) => openDay(r),
    columns: [
      { key: 'day', label: 'Day', nowrap: true, sort: (r) => r.day, render: (r) => dayLabel(r.day), csv: (r) => r.day },
      { key: 'status', label: 'Accounts', sort: (r) => r.done / r.n, render: (r) => (r.done === r.n ? chip('Reviewed', 'aqua', 'check') : r.stale ? chip('Changed after review', 'pink') : r.done ? chip(`${r.done} of ${r.n} reviewed`, 'blue') : chip('Not reviewed', 'pink')), csv: (r) => (r.done === r.n ? 'Reviewed' : `${r.done}/${r.n}`) },
      { key: 'people', label: 'People', sort: (r) => r.n, render: (r) => `${r.done}/${r.n} reviewed` },
      { key: 'inc', label: 'Income', nowrap: true, sort: (r) => r.inc, render: (r) => money(r.inc) },
      { key: 'out', label: 'Expenses', nowrap: true, sort: (r) => r.out, render: (r) => money(r.out) },
      { key: 'ho', label: 'Handed over', nowrap: true, sort: (r) => r.ho, render: (r) => money(r.ho) },
      { key: 'pend', label: 'Cash awaiting acknowledgement', nowrap: true, sort: (r) => r.pend, render: (r) => (r.pend ? chip(money(r.pend), 'pink') : '—'), csv: (r) => r.pend },
      { key: 'todo', label: 'Payments to review', sort: (r) => r.todo, render: (r) => (r.todo ? String(r.todo) : '—'), csv: (r) => r.todo },
      { key: 'close', label: 'Cash with the team at close', nowrap: true, sort: (r) => r.close, render: (r) => money(r.close) }] });
  function openDay(d) {
    const sh = openSheet({ title: dayLabel(d.day), subtitle: `${d.done} of ${d.n} people reviewed`, wide: true, footer: [],
      body: h('div', { class: 'stack' }, d.users.map(u => h('div', { class: 'ac-card', style: 'display:flex;gap:1rem;justify-content:space-between;flex-wrap:wrap;align-items:center' },
        h('span', null, h('strong', nameOf(u.uid)), h('small', { style: 'display:block;opacity:.75' }, `Closing ${money(u.closing)} · ${u.entries} entr${u.entries === 1 ? 'y' : 'ies'}${u.pending_n ? ` · ${money(u.pending_amt)} awaiting acknowledgement` : ''}${u.unrev_delivery + u.unrev_other ? ` · ${u.unrev_delivery + u.unrev_other} to review` : ''}`)),
        h('span', null, u.reviewed_at && !u.stale ? chip(`Reviewed by ${shortName(u.reviewed_by)}`, 'aqua', 'check') : u.stale ? chip('Changed after review', 'pink') : chip('Not reviewed', 'blue'), ' ', btn('Open', { small: true, kind: 'primary', onClick: () => { sh.close(); opts.nav.go('user', { day: d.day, uid: u.uid }); } }))))) });
  }
  function paint() { const ds = dayRows(); const full = ds.filter(d => d.done === d.n).length;
    mount(tiles, tile(String(ds.length), 'days with activity'), tile(String(full), 'days fully reviewed'), tile(String(ds.length - full), 'days still to review'), tile(money(ds.reduce((a, d) => a + d.pend, 0)), 'cash awaiting acknowledgement'));
    table.setRows(ds); }
  async function load() { mount(body, skeletonRows(5)); st.rows = (await rpc('acct_day_users', { p_from: st.from, p_to: st.to })) || []; mount(body, table.el); paint(); }
  mount(panel, rangeBar(st, load, [btn('Download as CSV', { ic: 'download', onClick: () => table.download(`accounts-days-${st.from}-to-${st.to}`) })]), tiles, body);
  await load();
}

// =============================================================================================== 4. cash waiting to be acknowledged
async function cashTab(panel) {
  const rows = (await rpc('acct_pending_ack', {})) || []; const now = Date.now(); const hrs = (r) => (now - new Date(r.created_at).getTime()) / 3600000;
  const per = new Map(); rows.forEach(r => { const k = r.to_uid; if (!per.has(k)) per.set(k, { to: k, amount: 0, n: 0, oldest: 0, from: new Map() }); const p = per.get(k); p.amount += N(r.amount); p.n++; p.oldest = Math.max(p.oldest, hrs(r)); p.from.set(r.from_uid, (p.from.get(r.from_uid) || 0) + N(r.amount)); });
  const people = [...per.values()].map(p => ({ ...p, split: [...p.from].map(([f, a]) => `${shortName(f)} ${money(a)}`).join(' · ') }));
  const t1 = dataTable({ rowKey: 'to', storageKey: 'acct-cash-people', defaultSort: { key: 'amt', dir: 'desc' }, empty: 'Nothing is waiting.',
    columns: [{ key: 'who', label: 'Must acknowledge', sort: (r) => shortName(r.to).toLowerCase(), render: (r) => h('strong', nameOf(r.to)), csv: (r) => nameOf(r.to) },
      { key: 'amt', label: 'Amount waiting', nowrap: true, sort: (r) => r.amount, render: (r) => h('strong', money(r.amount)), csv: (r) => r.amount }, { key: 'n', label: 'Entries', sort: (r) => r.n, render: (r) => String(r.n) },
      { key: 'from', label: 'Split by who gave it', sort: (r) => r.split, render: (r) => r.split }, { key: 'age', label: 'Oldest waiting', nowrap: true, sort: (r) => r.oldest, render: (r) => h('span', { style: r.oldest >= 24 ? 'color:#e11d48;font-weight:600' : '' }, fmtAge(r.oldest)), csv: (r) => fmtAge(r.oldest) }] });
  const t2 = dataTable({ rowKey: 'src_id', storageKey: 'acct-cash-rows', defaultSort: { key: 'age', dir: 'desc' }, empty: 'Nothing is waiting.', rowClick: (r) => (r.src === 'money' ? openEntry(r.src_id, () => {}) : null),
    columns: [{ key: 'what', label: 'What', sort: (r) => r.what, render: (r) => chip(r.what, r.what === 'Cash handover' ? 'blue' : 'neutral') },
      { key: 'from', label: 'Given by', sort: (r) => shortName(r.from_uid).toLowerCase(), render: (r) => nameOf(r.from_uid) }, { key: 'to', label: 'To acknowledge', sort: (r) => shortName(r.to_uid).toLowerCase(), render: (r) => nameOf(r.to_uid) },
      { key: 'amt', label: 'Amount', nowrap: true, sort: (r) => N(r.amount), render: (r) => h('strong', money(r.amount)), csv: (r) => r.amount }, { key: 'for', label: 'For', sort: (r) => `${r.delivery_code || ''}${r.purpose || ''}`, render: (r) => h('span', null, r.purpose || '', r.delivery_code ? h('small', r.delivery_code) : null), csv: (r) => `${r.purpose || ''} ${r.delivery_code || ''}` },
      { key: 'when', label: 'Since', nowrap: true, sort: (r) => new Date(r.created_at).getTime(), render: (r) => fmtDateTimeY(r.created_at), csv: (r) => fmtDateTimeY(r.created_at) },
      { key: 'age', label: 'Waiting', nowrap: true, sort: (r) => hrs(r), render: (r) => fmtAge(hrs(r)), csv: (r) => fmtAge(hrs(r)) }] });
  t1.setRows(people); t2.setRows(rows);
  mount(panel, h('div', { class: 'ac-tiles' }, tile(money(rows.reduce((a, r) => a + N(r.amount), 0)), 'Cash waiting for acknowledgement'), tile(String(rows.length), 'entries'), tile(String(people.length), 'people who must acknowledge')),
    h('h3', 'Who must acknowledge, and who gave it'), t1.el, h('h3', 'Every entry waiting'), h('div', { class: 'toolbar' }, btn('Download as CSV', { ic: 'download', onClick: () => t2.download('cash-waiting') })), t2.el);
}
