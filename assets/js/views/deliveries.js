import { h, icon, btn, busy, chip, statusBadge, sectionBlock, openSheet, confirmDialog, toast, mount, emptyState, skeletonRows, debounce, input,
  fmtDateTime, fmtDateTimeY, fmtPhone, fmtMoney, friendlyError } from '../core/ui.js';
import { sb, rpc } from '../core/supa.js';
import { state, can, whoName, loc, model } from '../core/store.js';
import { signedUrls, lightbox } from '../core/images.js';
import { deliveryChip, DELIVERY_LABEL, moneyChip, signed, acknowledgeMoney, disputeMoney, voidMoney } from '../core/ops.js';
import { openDeliveryForm, openExtendForm, openAssignSwap, openDoSwap, openPickupForm, openMoneyForm } from './delivery_forms.js';

const PAGE = 40;
const COLS = 'id,code,status,customer_id,vehicle_id,model_id,booking_for,delivered_at,return_due,days,created_by,created_at,approved_at';
const FILTERS = [['all', 'All'], ['booked', 'Booked'], ['pending', 'Waiting for approval'], ['active', 'Out now'], ['pickup_pending', 'Pickup waiting'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];
const inIds = (ids) => [...new Set(ids.filter(Boolean))];

export async function loadMaps(rows) {
  const [cs, vs] = await Promise.all([
    inIds(rows.map(r => r.customer_id)).length ? sb.from('customers').select('id,name,mobile,customer_type,nationality,status').in('id', inIds(rows.map(r => r.customer_id))) : { data: [] },
    inIds(rows.map(r => r.vehicle_id)).length ? sb.from('vehicles').select('id,number,model_id').in('id', inIds(rows.map(r => r.vehicle_id))) : { data: [] },
  ]);
  return { customers: new Map((cs.data || []).map(c => [c.id, c])), vehicles: new Map((vs.data || []).map(v => [v.id, v])) };
}
const overdue = (d) => ['pending', 'active'].includes(d.status) && d.return_due && new Date(d.return_due) < new Date();

export async function render(root, params) {
  const st = { status: FILTERS.some(f => f[0] === params.status) ? params.status : 'all', q: '', items: [], maps: { customers: new Map(), vehicles: new Map() }, total: 0, loading: false };
  const list = h('div', { class: 'rows rows-deliveries', role: 'list' }); const moreWrap = h('div', { class: 'more-wrap' }); const countEl = h('p', { class: 'result-count', 'aria-live': 'polite' });
  const search = input({ type: 'search', placeholder: 'Search by delivery number, customer, mobile or vehicle', 'aria-label': 'Search deliveries', enterkeyhint: 'search' });
  const chips = h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Filter by status' }, FILTERS.map(([v, l]) =>
    h('button', { type: 'button', class: 'fchip', dataset: { v }, 'aria-pressed': String(st.status === v), on: { click: () => { st.status = v; chips.querySelectorAll('.fchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.status))); load(true); } } }, l)));

  async function fetchRows(reset) {
    const term = st.q.replace(/[,()%*\\]/g, ' ').trim();
    const base = () => { let q = sb.from('deliveries').select(COLS, { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }); if (st.status !== 'all') q = q.eq('status', st.status); return q; };
    if (!term) { const from = reset ? 0 : st.items.length; const { data, error, count } = await base().range(from, from + PAGE - 1); if (error) throw error; return { rows: data, total: count ?? data.length }; }
    let found = [];
    if (/^dl\d*$/i.test(term)) { const { data, error } = await base().ilike('code', `${term}%`).range(0, 99); if (error) throw error; found = data; }
    else {
      const digits = term.replace(/[\s()-]/g, '');
      const [c, v] = await Promise.all([
        /^\+?\d{3,}$/.test(digits) ? sb.from('customers').select('id').ilike('mobile', `%${digits}%`).limit(20) : sb.from('customers').select('id').ilike('name', `%${term}%`).limit(20),
        sb.from('vehicles').select('id').ilike('number', `%${term}%`).limit(20)]);
      const qs = [];
      if (c.data?.length) qs.push(base().in('customer_id', c.data.map(x => x.id)).range(0, 99));
      if (v.data?.length) qs.push(base().in('vehicle_id', v.data.map(x => x.id)).range(0, 99));
      const res = await Promise.all(qs); const seen = new Set();
      for (const r of res) { if (r.error) throw r.error; for (const x of r.data) if (!seen.has(x.id)) { seen.add(x.id); found.push(x); } }
      found.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    }
    return { rows: found, total: found.length, all: true };
  }
  async function load(reset) {
    if (st.loading) return; st.loading = true;
    if (reset) { st.items = []; mount(list, skeletonRows(6)); moreWrap.replaceChildren(); }
    try {
      const r = await fetchRows(reset); st.items = r.all ? r.rows : [...st.items, ...r.rows]; st.total = r.total;
      const m = await loadMaps(r.rows); m.customers.forEach((v, k) => st.maps.customers.set(k, v)); m.vehicles.forEach((v, k) => st.maps.vehicles.set(k, v));
    } catch (e) { st.loading = false; return mount(list, h('div', { class: 'empty' }, h('h3', 'Could not load deliveries'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: () => load(true) }))); }
    st.loading = false; paint();
  }
  function paint() {
    countEl.textContent = st.total ? `${st.total} deliver${st.total === 1 ? 'y' : 'ies'}` : '';
    if (!st.items.length) { mount(list, st.q || st.status !== 'all' ? emptyState('No deliveries match', 'Try a different search or filter.') : emptyState('No deliveries yet', 'Start with a new delivery, or save a booking to hand over later.', btn('New delivery', { kind: 'primary', ic: 'plus', onClick: () => openNew('deliver') }))); moreWrap.replaceChildren(); return; }
    mount(list, h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', 'Delivery'), h('span', 'Customer'), h('span', 'Vehicle'), h('span', 'Status'), h('span', 'Return due')),
      st.items.map(d => { const c = st.maps.customers.get(d.customer_id), v = st.maps.vehicles.get(d.vehicle_id);
        return h('a', { class: 'row', role: 'listitem', href: `#/deliveries?open=${d.id}`, on: { click: (e) => { e.preventDefault(); openDetail(d.id); } } },
          h('span', { class: 'cell cell-main' }, h('strong', { class: 'code' }, d.code), h('small', fmtDateTime(d.delivered_at || d.booking_for || d.created_at))),
          h('span', { class: 'cell' }, c ? h('span', null, h('strong', c.name), h('small', { class: 'cell-note' }, fmtPhone(c.mobile))) : '…'),
          h('span', { class: 'cell cell-mono' }, v ? `${v.number}` : d.status === 'booked' ? (d.model_id ? model(d.model_id)?.name : 'Not chosen') : ''),
          h('span', { class: 'cell' }, deliveryChip(d.status), overdue(d) ? chip('Overdue', 'pink', 'clock') : null),
          h('span', { class: 'cell cell-sub' }, d.status === 'booked' ? `Planned ${fmtDateTime(d.booking_for)}` : d.return_due ? fmtDateTime(d.return_due) : ''), icon('right', 16, 'row-go')); }));
    moreWrap.replaceChildren(!st.q && st.items.length < st.total ? btn(`Show more (${st.total - st.items.length} left)`, { onClick: (e) => busy(e.currentTarget, () => load(false)) }) : '');
  }
  const openNew = (mode) => openDeliveryForm({ mode, onDone: (id) => { load(true); openDetail(id); } });
  search.addEventListener('input', debounce(() => { st.q = search.value; load(true); }, 300));
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Deliveries'), h('p', { class: 'muted' }, 'Hand over vehicles, extend, swap and pick up.')),
    h('div', { class: 'page-actions' }, btn('New booking', { ic: 'clock', onClick: () => openNew('booking') }), btn('New delivery', { kind: 'primary', ic: 'plus', onClick: () => openNew('deliver') }))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), chips), countEl, list, moreWrap);
  await load(true);
  if (params.open) openDetail(Number(params.open));
  if (params.new) openNew(params.new === 'booking' ? 'booking' : 'deliver');

  // ---------------------------------------------------------------- detail
  function openDetail(id) { return openDeliveryDetail(id, { onChange: () => load(true) }); }
}

// Opened from the list, the To do page, and the dashboard.
export async function openDeliveryDetail(id, { onChange } = {}) {
  const s = openSheet({ title: 'Delivery', body: skeletonRows(5), footer: [], wide: true });
  const reload = async () => { await paint(); onChange?.(); };
  async function paint() {
    try {
      const { data: d, error } = await sb.from('deliveries').select('*').eq('id', id).maybeSingle(); if (error) throw error; if (!d) throw new Error('This delivery was not found.');
      const [cRes, vRes, hRes, mRes, eRes, wRes, kRes, bill] = await Promise.all([
        sb.from('customers').select('id,name,mobile,customer_type,nationality').eq('id', d.customer_id).maybeSingle(),
        d.vehicle_id ? sb.from('vehicles').select('id,number,model_id').eq('id', d.vehicle_id).maybeSingle() : { data: null },
        sb.from('delivery_helmets').select('helmet_id,returned_at').eq('delivery_id', id),
        sb.from('money_entries').select('*').eq('delivery_id', id).order('created_at', { ascending: true }).order('id', { ascending: true }),
        sb.from('extensions').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        sb.from('swaps').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        sb.from('pickups').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        d.status === 'booked' ? Promise.resolve(null) : rpc('delivery_bill', { p_id: id })]);
      for (const r of [cRes, hRes, mRes, eRes, wRes, kRes]) if (r.error) throw r.error;
      let helmets = []; if (hRes.data.length) { const { data } = await sb.from('helmets').select('id,code').in('id', hRes.data.map(x => x.helmet_id)); helmets = hRes.data.map(x => ({ ...x, code: data?.find(y => y.id === x.helmet_id)?.code || `#${x.helmet_id}` })); }
      const vehicleIds = [...new Set(wRes.data.flatMap(w => [w.old_vehicle_id, w.new_vehicle_id]).filter(Boolean))]; const vmap = new Map();
      if (vehicleIds.length) (await sb.from('vehicles').select('id,number').in('id', vehicleIds)).data?.forEach(v => vmap.set(v.id, v.number));
      draw(d, { customer: cRes.data, vehicle: vRes.data, helmets, money: mRes.data, extensions: eRes.data, swaps: wRes.data, pickups: kRes.data, bill, vmap });
    } catch (e) { mount(s.body, h('div', { class: 'empty' }, icon('alert', 28), h('h3', 'Could not load this delivery'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: paint }))); }
  }

  function draw(d, x) {
    const me = state.me.id; const live = x.pickups.find(p => p.status !== 'cancelled'); const liveSwap = x.swaps.find(w => w.status === 'assigned'); const doneSwap = x.swaps.find(w => w.status === 'done');
    const entries = x.money.filter(m => m.status !== 'void');
    const waiting = entries.filter(m => m.status === 'pending_ack'), disputed = entries.filter(m => m.status === 'disputed');
    const canApproveFor = (creator) => can.approve() && (creator !== me || can.superadmin());
    s.el.querySelector('.sheet-head h2').textContent = d.code; s.el.querySelector('.sheet-head p')?.remove();
    const sub = h('p', `${x.customer?.name || ''}${x.vehicle ? `, ${x.vehicle.number}` : ''}`); s.el.querySelector('.sheet-titles').append(sub);

    const blockers = [];
    if (waiting.length) blockers.push(`Waiting for ${[...new Set(waiting.map(m => who_(m.cash_user)))].join(' and ')} to acknowledge ${fmtMoney(waiting.reduce((a, m) => a + Number(m.amount), 0))} cash.`);
    if (disputed.length) blockers.push('A payment was disputed. A Manager must void it before this can be approved.');
    const kv = (k, v) => (v === null || v === undefined || v === '' ? null : h('div', { class: 'kv' }, h('dt', k), h('dd', v)));
    const top = h('div', { class: 'detail-top' }, deliveryChip(d.status), overdue(d) ? chip('Overdue', 'pink', 'clock') : null, x.customer?.customer_type === 'foreign' ? chip('Foreign customer', 'aqua') : null);
    const actions = []; const A = (label, o) => actions.push(btn(label, o));
    const primary = [];
    const P = (label, o) => primary.push(btn(label, { kind: 'primary', ...o }));
    if (d.status === 'booked') {
      P('Hand over now', { ic: 'bike', onClick: () => openDeliveryForm({ mode: 'deliver', booking: { ...d, customer: x.customer }, onDone: reload }) });
      A('Add advance payment', { ic: 'plus', onClick: () => openMoneyForm({ delivery: d, onDone: reload }) });
      A('Cancel booking', { ic: 'ban', onClick: () => cancel(d) });
    }
    if (d.status === 'pending' || (d.status === 'pickup_pending' && !d.approved_at)) {
      if (canApproveFor(d.created_by)) P('Approve delivery', { ic: 'check', disabled: blockers.length > 0, onClick: () => approve('approve_delivery', d.id, 'delivery') });
      if (d.status === 'pending' && (d.created_by === me || can.manager())) A('Edit charges', { ic: 'edit', onClick: () => editCharges(d) });
      if (d.status === 'pending' && can.manager()) A('Reverse delivery', { ic: 'undo', onClick: () => cancel(d) });
    }
    if (['pending', 'active'].includes(d.status)) {
      P(liveSwap || doneSwap ? 'Pick up' : 'Pick up', { ic: 'bike', kind: d.status === 'active' ? 'primary' : 'secondary', onClick: () => openPickupForm({ delivery: d, rentalDays: d.days + x.extensions.filter(e => e.status !== 'cancelled').reduce((a, e) => a + e.extra_days, 0), helmetsOut: x.helmets.filter(hh => !hh.returned_at), onDone: reload }) });
      A('Extend', { ic: 'clock', onClick: () => openExtendForm({ delivery: d, onDone: reload }) });
      if (can.assignSwap() && !liveSwap && !doneSwap) A('Assign a swap', { ic: 'move', onClick: () => openAssignSwap({ delivery: d, onDone: reload }) });
    }
    if (d.status === 'pickup_pending' && live) {
      if (canApproveFor(live.created_by)) P('Approve pickup', { ic: 'check', disabled: blockers.length > 0 || !d.approved_at || !!doneSwap || x.extensions.some(e => e.status === 'pending'), onClick: () => approve('approve_pickup', live.id, 'pickup') });
      if (can.manager()) A('Cancel pickup', { ic: 'undo', onClick: () => cancelPickup(live) });
    }
    if (d.status !== 'cancelled') A('Add payment', { ic: 'plus', onClick: () => openMoneyForm({ delivery: d, onDone: reload }) });
    A('Copy number', { ic: 'copy', onClick: () => navigator.clipboard?.writeText(d.code).then(() => toast('Copied')) });
        if (!blockers.length && (d.status === 'pending' || (d.status === 'pickup_pending' && !d.approved_at)) && d.created_by === me && can.approve() && !can.superadmin()) blockers.push('You made this entry, so another approver must approve it.');

    const billBox = x.bill ? h('div', { class: 'bill' },
      row('Total amount', x.bill.total_amount), x.bill.other_charges > 0 ? row(d.other_charges_text || 'Other charges', x.bill.other_charges) : null,
      x.bill.extensions > 0 ? row('Extensions', x.bill.extensions) : null, x.bill.extra_km_charge > 0 ? row('Extra km', x.bill.extra_km_charge) : null,
      x.bill.pickup_other_charges > 0 ? row('Other charges at return', x.bill.pickup_other_charges) : null,
      row('Total bill', x.bill.charges, 'strong'), row('Received', x.bill.paid), x.bill.awaiting_ack > 0 ? row('Cash waiting for acknowledgement', x.bill.awaiting_ack, 'muted') : null,
      x.bill.deposit_refunded > 0 ? row('Deposit given back', x.bill.deposit_refunded, 'muted') : null,
      row(x.bill.balance_due < 0 ? 'Overpaid' : 'Balance to collect', Math.abs(x.bill.balance_due), x.bill.balance_due > 0 ? 'due' : 'ok')) : null;

    const photoPaths = d.photos || [];
    mount(s.body, top,
      blockers.length && !['closed', 'cancelled', 'booked'].includes(d.status) ? h('div', { class: 'callout' }, icon('info', 18), h('span', blockers.join(' '))) : null,
      h('div', { class: 'action-bar' }, actions),
      sectionBlock('Details', h('dl', { class: 'kvs' },
        kv('Customer', x.customer ? h('span', null, x.customer.name, h('small', { class: 'cell-note' }, fmtPhone(x.customer.mobile))) : null),
        d.status === 'booked' ? kv('Planned delivery', fmtDateTimeY(d.booking_for)) : null, d.status === 'booked' ? kv('Model wanted', d.model_id ? model(d.model_id)?.name : 'Not decided') : null, kv('Booking note', d.booking_note),
        kv('Vehicle', x.vehicle ? `${x.vehicle.number}, ${model(x.vehicle.model_id)?.name || ''}` : null), kv('Helmets', x.helmets.length ? h('span', null, x.helmets.map(hh => chip(hh.code + (hh.returned_at ? ', returned' : ''), hh.returned_at ? 'neutral' : 'blue'))) : (d.status === 'booked' ? null : 'None')),
        kv('Delivered', d.delivered_at ? fmtDateTimeY(d.delivered_at) : null), kv('Delivered to', d.delivery_place), kv('Taken from', loc(d.from_location_id)?.name),
        kv('Return due', d.return_due ? fmtDateTimeY(d.return_due) : null), kv('Days', d.days ? `${d.days}${x.extensions.filter(e => e.status !== 'cancelled').length ? ` + ${x.extensions.filter(e => e.status !== 'cancelled').reduce((a, e) => a + e.extra_days, 0)} extended` : ''}` : null),
        kv('Km limit', d.km_limit_per_day ? `${d.km_limit_per_day} km per day, ${fmtMoney(d.extra_km_rate)} per extra km` : null), kv('Odometer out', d.odometer_out !== null ? `${d.odometer_out} km${d.km_before_current ? ` (after swap; ${d.km_before_current} km used before)` : ''}` : null),
        kv('Added by', `${whoName(d.created_by)}, ${fmtDateTimeY(d.created_at)}`), d.approved_at ? kv('Approved by', `${whoName(d.approved_by)}, ${fmtDateTimeY(d.approved_at)}`) : null,
        d.status === 'cancelled' ? kv('Cancelled', `${d.cancel_reason} (${whoName(d.cancelled_by)})`) : null, kv('Note', d.note))),
      d.status !== 'booked' ? sectionBlock('Charges', h('dl', { class: 'kvs' }, kv('Rent', fmtMoney(d.rent)), kv('Deposit', fmtMoney(d.deposit)), kv('Delivery charges', fmtMoney(d.delivery_charges)), kv('Advance pickup charges', fmtMoney(d.advance_pickup_charges))), billBox) : null,
      sectionBlock(`Payments (${x.money.length})`, x.money.length ? h('ul', { class: 'pay-list' }, x.money.map(m => payRow(m))) : h('p', { class: 'muted' }, 'No payments yet.')),
      x.extensions.length ? sectionBlock('Extensions', h('ul', { class: 'pay-list' }, x.extensions.map(e => h('li', { class: 'pay-row' }, h('div', null, h('strong', `+${e.extra_days} day${e.extra_days === 1 ? '' : 's'} at ${fmtMoney(e.rent_per_day)}`), h('small', `${fmtMoney(e.amount)}, back by ${fmtDateTime(e.new_return_due)}, added by ${whoName(e.created_by)}`)),
        h('div', { class: 'pay-act' }, e.status === 'approved' ? statusBadge('active', 'Approved') : e.status === 'cancelled' ? chip('Cancelled', 'neutral') : chip('Waiting for approval', 'blue'),
          e.status === 'pending' && canApproveFor(e.created_by) ? btn('Approve', { small: true, kind: 'primary', onClick: () => approve('approve_extension', e.id, 'extension') }) : null,
          e.status !== 'cancelled' && can.manager() && !['closed', 'cancelled'].includes(d.status) ? btn('Cancel', { small: true, onClick: () => cancelExt(e) }) : null))))) : null,
      x.swaps.length ? sectionBlock('Swaps', h('ul', { class: 'pay-list' }, x.swaps.map(w => swapRow(w, d, x)))) : null,
      x.pickups.length ? sectionBlock('Pickup', h('ul', { class: 'pay-list' }, x.pickups.map(k => h('li', { class: 'pay-row' }, h('div', null, h('strong', `Returned to ${loc(k.return_location_id)?.name || ''}, ${fmtDateTime(k.returned_at)}`),
        h('small', `${k.km_used} km used, ${k.allowed_km} km allowed over ${k.rental_days} days. ${k.extra_km} km extra = ${fmtMoney(k.extra_km_charge)}${k.other_charges_amount > 0 ? `. ${k.other_charges_text || 'Other'}: ${fmtMoney(k.other_charges_amount)}` : ''}.${k.condition_note ? ' ' + k.condition_note : ''}`), h('small', `By ${whoName(k.created_by)}`)),
        h('div', { class: 'pay-act' }, k.status === 'approved' ? statusBadge('active', 'Approved') : k.status === 'cancelled' ? chip('Cancelled', 'neutral') : chip('Waiting for approval', 'blue')))))) : null,
      photoPaths.length ? sectionBlock('Photos at delivery', h('div', { class: 'photo-multi viewer', id: 'dl-photos' }, photoPaths.map(() => h('div', { class: 'tile filled' }, icon('image', 22))))) : null);
    if (photoPaths.length) signedUrls(photoPaths).then(map => { const tiles = s.body.querySelectorAll('#dl-photos .tile'); photoPaths.forEach((p, i) => { if (map[p] && tiles[i]) { const img = h('img', { src: map[p], alt: `Delivery photo ${i + 1}` }); tiles[i].prepend(img); tiles[i].addEventListener('click', () => lightbox(map[p], `${d.code} photo ${i + 1}`)); tiles[i].style.cursor = 'zoom-in'; } }); }).catch(() => {});
    mount(s.foot, ...(primary.length ? primary : [btn('Close', { onClick: () => s.close() })]));
  }
  const who_ = (id) => state.profileMap.get(id)?.user_name || 'the cash holder';
  const row = (k, v, cls = '') => h('div', { class: `bill-row ${cls}` }, h('span', k), h('strong', fmtMoney(v)));

  function payRow(m) {
    const me = state.me.id;
    return h('li', { class: `pay-row ${m.status === 'void' ? 'is-void' : ''}` },
      h('div', null, h('strong', `${m.purpose}`), h('small', `${m.entry_type}, ${m.via}${m.cash_user ? `, cash held by ${who_(m.cash_user)}` : ''}. Added by ${whoName(m.created_by)} on ${fmtDateTime(m.created_at)}.${m.dispute_reason ? ' Dispute: ' + m.dispute_reason : ''}${m.void_reason ? ' Void: ' + m.void_reason : ''}`)),
      h('div', { class: 'pay-act' }, h('span', { class: `amt ${m.entry_type === 'Expense' ? 'neg' : ''}` }, signed(m)), moneyChip(m),
        m.status === 'pending_ack' && m.cash_user === me ? [btn('Acknowledge', { small: true, kind: 'primary', onClick: () => acknowledgeMoney(m, reload) }), btn('Dispute', { small: true, onClick: () => disputeMoney(m, reload) })] : null,
        m.status !== 'void' && can.manager() ? btn('Void', { small: true, onClick: () => voidMoney(m, reload) }) : null));
  }
  function swapRow(w, d, x) {
    const me = state.me.id; const label = { assigned: 'Assigned', done: 'Done, waiting for approval', approved: 'Approved', cancelled: 'Cancelled' }[w.status];
    return h('li', { class: 'pay-row' }, h('div', null, h('strong', w.status === 'assigned' ? `To be done by ${who_(w.assigned_to)}` : `${x.vmap.get(w.old_vehicle_id) || ''} replaced by ${x.vmap.get(w.new_vehicle_id) || ''}`),
      h('small', `Assigned by ${whoName(w.assigned_by)}${w.reason ? `. ${w.reason}` : ''}${w.done_by ? `. Done by ${whoName(w.done_by)}; old vehicle to ${loc(w.old_return_location)?.name || ''}` : ''}`)),
      h('div', { class: 'pay-act' }, chip(label, w.status === 'approved' ? 'neutral' : w.status === 'cancelled' ? 'neutral' : 'blue'),
        w.status === 'assigned' && (w.assigned_to === me || can.admin()) ? btn('Do the swap', { small: true, kind: 'primary', onClick: () => openDoSwap({ swap: w, delivery: d, onDone: reload }) }) : null,
        w.status === 'assigned' && (w.assigned_by === me || can.manager()) ? btn('Cancel', { small: true, onClick: () => cancelSwap(w) }) : null,
        w.status === 'done' && can.approve() && (w.done_by !== me || can.superadmin()) ? btn('Approve', { small: true, kind: 'primary', onClick: () => approve('approve_swap', w.id, 'swap') }) : null));
  }

  const approve = (fn, rid, what) => confirmDialog({ title: `Approve this ${what}?`, message: 'Its payments are approved with it.', confirmLabel: 'Approve' }).then(async (r) => { if (!r) return;
    try { await rpc(fn, { p_id: rid }); toast('Approved'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } });
  const cancel = (d) => confirmDialog({ title: d.status === 'booked' ? 'Cancel this booking?' : 'Reverse this delivery?', message: d.status === 'booked' ? 'Its advance payments are voided. Refund the customer from Money if needed.' : 'The vehicle and helmets go back to an Office and its payments are voided.', confirmLabel: 'Yes, cancel it', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; let where = null;
      if (d.status === 'pending') { where = await chooseOffice(); if (!where) return; }
      try { await rpc('cancel_delivery', { p_id: d.id, p_reason: r.text, p_return_location: where }); toast('Cancelled'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } });
  const cancelExt = (e) => confirmDialog({ title: 'Cancel this extension?', message: 'The return date goes back and its payments are voided.', confirmLabel: 'Cancel extension', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_extension', { p_id: e.id, p_reason: r.text }); toast('Extension cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  const cancelSwap = (w) => confirmDialog({ title: 'Cancel this swap?', confirmLabel: 'Cancel swap', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_swap', { p_id: w.id, p_reason: r.text }); toast('Swap cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  const cancelPickup = (k) => confirmDialog({ title: 'Cancel this pickup?', message: 'The vehicle and helmets go back to the customer on record and the pickup payments are voided.', confirmLabel: 'Cancel pickup', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_pickup', { p_id: k.id, p_reason: r.text }); toast('Pickup cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  function chooseOffice() {
    return new Promise((resolve) => {
      const offices = state.locations.filter(l => l.active && l.type === 'Office');
      const sel = h('select', { class: 'input select', 'aria-label': 'Office' }, offices.map(l => h('option', { value: String(l.id) }, l.name)));
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      const ok = btn('Confirm', { kind: 'primary', onClick: () => { fin(Number(sel.value)); dlg.close(); } });
      const dlg = openSheet({ title: 'Where are they back at?', body: h('div', { class: 'confirm' }, h('p', 'Choose the office the vehicle and helmets are now at.'), sel), footer: [btn('Cancel', { onClick: () => dlg.close() }), ok], onClose: () => fin(null) });
      dlg.el.classList.add('dialog');
    });
  }
  function editCharges(d) {
    const mk = (v) => input({ inputmode: 'decimal', value: String(v ?? 0) });
    const f = { days: input({ inputmode: 'numeric', value: String(d.days) }), rent: mk(d.rent), deposit: mk(d.deposit), delivery_charges: mk(d.delivery_charges), advance_pickup_charges: mk(d.advance_pickup_charges), extra_km_rate: mk(d.extra_km_rate), other_charges_amount: mk(d.other_charges_amount) };
    const lab = { days: 'Days', rent: 'Rent', deposit: 'Deposit', delivery_charges: 'Delivery charges', advance_pickup_charges: 'Advance pickup charges', extra_km_rate: 'Extra km rate', other_charges_amount: 'Other charges' };
    const err = h('p', { class: 'field-error', hidden: true });
    const save = btn('Save', { kind: 'primary', type: 'submit' }); save.setAttribute('form', 'edit-ch');
    const form = h('form', { id: 'edit-ch', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); busy(save, async () => { try {
      await rpc('update_delivery', { p_id: d.id, p: Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value.trim()])) }); toast('Saved'); e2.close(); await reload(); } catch (e) { err.textContent = friendlyError(e); err.hidden = false; } }); } } },
      h('div', { class: 'grid-2' }, Object.entries(f).map(([k, i]) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, lab[k]), i))), err);
    const e2 = openSheet({ title: 'Edit charges', subtitle: d.code, body: form, footer: [btn('Cancel', { onClick: () => e2.close() }), save] });
  }
  await paint();
  return s;
}
