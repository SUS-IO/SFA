import { h, icon, btn, busy, chip, segmented, mount, emptyState, skeletonRows, fmtDateTime, fmtMoney, friendlyError, input, debounce } from '../core/ui.js';
import { sb, rpc } from '../core/supa.js';
import { state, can, whoName } from '../core/store.js';
import { moneyChip, signed, transferChip, acknowledgeMoney, disputeMoney, voidMoney, approveMoney, acknowledgeTransfer, disputeTransfer, approveTransfer, voidTransfer } from '../core/ops.js';
import { openMoneyForm, openTransferForm } from './delivery_forms.js';
import { openDeliveryDetail } from './deliveries.js';

const PAGE = 50;
const STATUS = [['all', 'All'], ['pending_ack', 'Waiting for acknowledgement'], ['pending', 'Waiting for approval'], ['approved', 'Approved'], ['disputed', 'Disputed'], ['void', 'Void']];

export async function render(root, params) {
  const TABS = [{ value: 'entries', label: 'Income and expenses' }, { value: 'transfers', label: 'Cash handovers' }, { value: 'cash', label: 'Cash in hand' }];
  const panel = h('div', { class: 'money-panel' });
  const tabs = segmented(TABS, TABS.some(t => t.value === params.sub) ? params.sub : 'entries', (v) => show(v));
  const actions = h('div', { class: 'page-actions' }, btn('Hand over cash', { ic: 'move', onClick: () => openTransferForm({ onDone: () => show(tabs.get()) }) }),
    btn('Add other income or expense', { kind: 'primary', ic: 'plus', onClick: () => openMoneyForm({ onDone: () => show(tabs.get()) }) }));
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Money'), h('p', { class: 'muted' }, 'Payments, cash handovers and who holds the cash.')), actions), h('div', { class: 'toolbar' }, tabs), panel);
  async function show(tab) { history.replaceState(null, '', `#/money/${tab}`); mount(panel, skeletonRows(5)); try { await ({ entries: entriesTab, transfers: transfersTab, cash: cashTab })[tab](panel); } catch (e) { mount(panel, emptyState('Could not load this tab', friendlyError(e), btn('Try again', { kind: 'primary', onClick: () => show(tab) }))); } }
  await show(tabs.get());
}

async function entriesTab(panel) {
  const st = { status: 'all', type: 'all', mine: false, q: '', rows: [], total: 0, codes: new Map() };
  const list = h('div', { class: 'rows rows-money', role: 'list' }); const more = h('div', { class: 'more-wrap' }); const count = h('p', { class: 'result-count' });
  const chips = h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Filter by status' }, STATUS.map(([v, l]) => h('button', { type: 'button', class: 'fchip', dataset: { v }, 'aria-pressed': String(v === st.status), on: { click: () => { st.status = v; chips.querySelectorAll('.fchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); load(true); } } }, l)));
  const typeSel = h('select', { class: 'input select', 'aria-label': 'Income or expense' }, [['all', 'Income and expense'], ['Income', 'Income only'], ['Expense', 'Expense only']].map(([v, l]) => h('option', { value: v }, l)));
  const mine = h('label', { class: 'check' }, h('input', { type: 'checkbox' }), h('span', 'Cash held by me'));
  const search = input({ type: 'search', placeholder: 'Search by what it is for', 'aria-label': 'Search payments' });
  typeSel.addEventListener('change', () => { st.type = typeSel.value; load(true); }); mine.firstChild.addEventListener('change', () => { st.mine = mine.firstChild.checked; load(true); });
  search.addEventListener('input', debounce(() => { st.q = search.value; load(true); }, 300));
  async function load(reset) {
    if (reset) { st.rows = []; mount(list, skeletonRows(6)); more.replaceChildren(); }
    try {
      let q = sb.from('money_entries').select('*', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }).range(st.rows.length, st.rows.length + PAGE - 1);
      if (st.status !== 'all') q = q.eq('status', st.status); if (st.type !== 'all') q = q.eq('entry_type', st.type); if (st.mine) q = q.eq('cash_user', state.me.id);
      const term = st.q.replace(/[,()%*\\]/g, ' ').trim(); if (term) q = q.ilike('purpose', `%${term}%`);
      const { data, error, count: c } = await q; if (error) throw error; st.rows.push(...data); st.total = c ?? st.rows.length;
      const ids = [...new Set(data.map(r => r.delivery_id).filter(Boolean))].filter(i => !st.codes.has(i));
      if (ids.length) (await sb.from('deliveries').select('id,code').in('id', ids)).data?.forEach(d => st.codes.set(d.id, d.code));
    } catch (e) { return mount(list, h('div', { class: 'empty' }, h('h3', 'Could not load payments'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: () => load(true) }))); }
    paint();
  }
  function paint() {
    count.textContent = st.total ? `${st.total} entr${st.total === 1 ? 'y' : 'ies'}` : '';
    if (!st.rows.length) { mount(list, emptyState('No entries', st.status !== 'all' || st.q || st.type !== 'all' || st.mine ? 'Nothing matches these filters.' : 'Payments from deliveries show up here. Add only income and expenses that are not part of a delivery.')); more.replaceChildren(); return; }
    mount(list, h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', 'When'), h('span', 'For'), h('span', 'Amount'), h('span', 'Cash held by'), h('span', 'Status')),
      st.rows.map(m => h('div', { class: `row ${m.status === 'void' ? 'is-void' : ''}`, role: 'listitem' },
        h('span', { class: 'cell cell-sub' }, fmtDateTime(m.created_at), h('small', { class: 'cell-note' }, `by ${whoName(m.created_by)}`)),
        h('span', { class: 'cell cell-main' }, h('strong', m.purpose), h('small', null, m.entry_type, ' · ', m.via, m.delivery_id && st.codes.get(m.delivery_id) ? [' · ', h('a', { href: `#/deliveries?open=${m.delivery_id}`, on: { click: (e) => { e.preventDefault(); openDeliveryDetail(m.delivery_id, { onChange: () => load(true) }); } } }, st.codes.get(m.delivery_id)) ] : '')),
        h('span', { class: `cell amt ${m.entry_type === 'Expense' ? 'neg' : ''}` }, signed(m)),
        h('span', { class: 'cell cell-sub' }, m.cash_user ? whoName(m.cash_user) : 'Company account'),
        h('span', { class: 'cell cell-actions' }, moneyChip(m), actionsFor(m)))));
    more.replaceChildren(st.rows.length < st.total ? btn(`Show more (${st.total - st.rows.length} left)`, { onClick: (e) => busy(e.currentTarget, () => load(false)) }) : '');
  }
  const after = () => load(true);
  function actionsFor(m) {
    const me = state.me.id; const out = [];
    if (m.status === 'pending_ack' && m.cash_user === me) out.push(btn('Acknowledge', { small: true, kind: 'primary', onClick: () => acknowledgeMoney(m, after) }), btn('Dispute', { small: true, onClick: () => disputeMoney(m, after) }));
    if (m.status === 'pending' && can.approve() && (m.created_by !== me || can.superadmin()) && !m.ref_kind) out.push(btn('Approve', { small: true, kind: 'primary', onClick: () => approveMoney(m, after) }));
    if (m.status === 'pending' && m.ref_kind && m.delivery_id) out.push(btn('Open delivery', { small: true, onClick: () => openDeliveryDetail(m.delivery_id, { onChange: after }) }));
    if (m.status !== 'void' && can.manager()) out.push(btn('Void', { small: true, onClick: () => voidMoney(m, after) }));
    return out;
  }
  mount(panel, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), typeSel, mine), chips, count, list, more);
  await load(true);
}

async function transfersTab(panel) {
  const { data, error } = await sb.from('cash_transfers').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200); if (error) throw error;
  const me = state.me.id; const after = () => transfersTab(panel).catch(() => {});
  if (!data.length) return mount(panel, emptyState('No cash handovers yet', 'When cash passes from one person to another, record it here.'));
  mount(panel, h('div', { class: 'rows rows-transfers', role: 'list' },
    h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', 'When'), h('span', 'From'), h('span', 'To'), h('span', 'Amount'), h('span', 'Status')),
    data.map(t => h('div', { class: `row ${t.status === 'void' ? 'is-void' : ''}`, role: 'listitem' },
      h('span', { class: 'cell cell-sub' }, fmtDateTime(t.created_at)), h('span', { class: 'cell cell-main' }, h('strong', whoName(t.created_by)), t.note ? h('small', t.note) : null),
      h('span', { class: 'cell' }, t.kind === 'bank' ? 'Bank deposit (old)' : whoName(t.to_user)), h('span', { class: 'cell amt' }, fmtMoney(t.amount)),
      h('span', { class: 'cell cell-actions' }, transferChip(t),
        t.status === 'pending_ack' && t.to_user === me ? [btn('Acknowledge', { small: true, kind: 'primary', onClick: () => acknowledgeTransfer(t, after) }), btn('Dispute', { small: true, onClick: () => disputeTransfer(t, after) })] : null,
        t.status === 'pending' && t.kind === 'bank' && can.approve() && (t.created_by !== me || can.superadmin()) ? btn('Approve', { small: true, kind: 'primary', onClick: () => approveTransfer(t, after) }) : null,
        t.status !== 'void' && can.manager() ? btn('Void', { small: true, onClick: () => voidTransfer(t, after) }) : null)))));
}

async function cashTab(panel) {
  const rows = await rpc('cash_summary', {}); const me = state.me.id;
  const withMoney = rows.filter(r => Number(r.collected) || Number(r.paid_out) || Number(r.sent) || Number(r.received) || Number(r.awaiting_ack));
  const total = withMoney.reduce((a, r) => a + Number(r.in_hand), 0);
  mount(panel, h('div', { class: 'callout' }, icon('info', 18), h('span', 'Only cash that the holder has acknowledged counts. Cash handed to someone else counts for them once they acknowledge it.')),
    h('p', { class: 'cash-total' }, 'Cash with the team: ', h('strong', fmtMoney(total))),
    withMoney.length ? h('div', { class: 'rows rows-cash', role: 'list' },
      h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', 'Person'), h('span', 'Collected'), h('span', 'Paid out'), h('span', 'Handed over'), h('span', 'Received'), h('span', 'In hand')),
      withMoney.sort((a, b) => Number(b.in_hand) - Number(a.in_hand)).map(r => h('div', { class: `row ${r.user_id === me ? 'me' : ''}`, role: 'listitem' },
        h('span', { class: 'cell cell-main' }, h('strong', whoName(r.user_id)), Number(r.awaiting_ack) ? h('small', `${fmtMoney(r.awaiting_ack)} waiting for them to acknowledge`) : null),
        h('span', { class: 'cell amt' }, fmtMoney(r.collected)), h('span', { class: 'cell amt' }, fmtMoney(r.paid_out)), h('span', { class: 'cell amt' }, fmtMoney(r.sent)), h('span', { class: 'cell amt' }, fmtMoney(r.received)),
        h('span', { class: `cell amt strong ${Number(r.in_hand) < 0 ? 'neg' : ''}` }, fmtMoney(r.in_hand))))) : emptyState('No cash yet', 'Cash payments will appear here once they are acknowledged.'));
}
