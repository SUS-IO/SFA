import { h, icon, btn, busy, chip, statusBadge, sectionBlock, openSheet, confirmDialog, toast, mount, emptyState, skeletonRows, debounce, input, localInputValue, isoFromLocal,
  fmtDateTime, fmtDateTimeY, fmtPhone, fmtMoney, friendlyError } from '../core/ui.js';
import { sb, rpc } from '../core/supa.js';
import { state, can, whoName, loc, model } from '../core/store.js';
import { signedUrls, lightbox } from '../core/images.js';
import { deliveryChip, DELIVERY_LABEL, moneyChip, signed, acknowledgeMoney, disputeMoney, voidMoney, approveMoney } from '../core/ops.js';
import { openDeliveryForm, openExtendForm, openAssignSwap, openDoSwap, openPickupForm, openMoneyForm } from './delivery_forms.js';

const PAGE = 40;
const COLS = 'id,code,status,customer_id,vehicle_id,model_id,booking_for,booking_text,delivered_at,return_due,days,created_by,created_at,approved_at,reviewed_at';
const FILTERS = [['all', 'All'], ['booking_pending', 'Bookings to approve'], ['booked', 'Booked'], ['pending', 'Waiting for approval'], ['active', 'Out now'], ['pickup_pending', 'Pickup waiting'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];
const inIds = (ids) => [...new Set(ids.filter(Boolean))];

export async function loadMaps(rows) {
  const [cs, vs] = await Promise.all([
    inIds(rows.map(r => r.customer_id)).length ? sb.from('customers').select('id,name,mobile,customer_type,nationality,status').in('id', inIds(rows.map(r => r.customer_id))) : { data: [] },
    inIds(rows.map(r => r.vehicle_id)).length ? sb.from('vehicles').select('id,number,model_id').in('id', inIds(rows.map(r => r.vehicle_id))) : { data: [] },
  ]);
  return { customers: new Map((cs.data || []).map(c => [c.id, c])), vehicles: new Map((vs.data || []).map(v => [v.id, v])) };
}
const overdue = (d) => d.status === 'active' && d.return_due && new Date(d.return_due) < new Date();

// ---- photo sets: labelled thumbnails (also reads older records that have fewer photos) ----------
const SET_LABEL = { odometer: 'Odometer', front: 'Front', back: 'Rear', left: 'Left side', right: 'Right side' };
export function photoSetView(set, title) {
  if (!set || typeof set !== 'object') return null;
  const items = [];
  for (const k of ['odometer', 'front', 'back', 'left', 'right']) if (set[k]) items.push([set[k], SET_LABEL[k]]);
  (set.extra || []).forEach((p, i) => items.push([p, `Additional ${i + 1}`]));
  (set.helmets || []).forEach((p, i) => items.push([p, `Helmet ${i + 1}`]));
  if (!items.length) return null;
  return h('div', { class: 'swap-photos' }, h('strong', title), h('div', { class: 'photo-multi viewer' }, items.map(([path, label]) =>
    h('div', { class: 'tile filled', dataset: { path, cap: `${title}: ${label}` } }, icon('image', 22), h('span', { class: 'thumb-label' }, label)))));
}
export function hydrateTiles(root, code) {
  const tiles = [...root.querySelectorAll('.tile[data-path]')]; const paths = tiles.map(t => t.dataset.path).filter(Boolean);
  if (!paths.length) return;
  signedUrls(paths).then(map => tiles.forEach(t => { const u = map[t.dataset.path]; if (u && !t.querySelector('img')) { t.prepend(h('img', { src: u, alt: t.dataset.cap })); t.style.cursor = 'zoom-in'; t.addEventListener('click', () => lightbox(u, `${code} ${t.dataset.cap}`)); } })).catch(() => {});
}
const legacySet = (arr) => (arr?.length ? { extra: arr } : null);

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
      const qs = [base().ilike('booking_text', `%${term}%`).range(0, 99)];
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
          h('span', { class: 'cell' }, c ? h('span', null, h('strong', c.name), h('small', { class: 'cell-note' }, fmtPhone(c.mobile))) : d.booking_text ? h('span', { class: 'prewrap clamp' }, d.booking_text) : '…'),
          h('span', { class: 'cell cell-mono' }, v ? `${v.number}` : ''),
          h('span', { class: 'cell' }, deliveryChip(d.status), overdue(d) ? chip('Overdue', 'pink', 'clock') : null),
          h('span', { class: 'cell cell-sub' }, ['booked', 'booking_pending'].includes(d.status) ? `Planned ${fmtDateTime(d.booking_for)}` : d.return_due ? fmtDateTime(d.return_due) : ''), icon('right', 16, 'row-go')); }));
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
        d.customer_id ? sb.from('customers').select('id,name,mobile,customer_type,nationality,status,customer_image').eq('id', d.customer_id).maybeSingle() : { data: null },
        d.vehicle_id ? sb.from('vehicles').select('id,number,model_id').eq('id', d.vehicle_id).maybeSingle() : { data: null },
        sb.from('delivery_helmets').select('helmet_id,returned_at').eq('delivery_id', id),
        sb.from('money_entries').select('*').eq('delivery_id', id).order('created_at', { ascending: true }).order('id', { ascending: true }),
        sb.from('extensions').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        sb.from('swaps').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        sb.from('pickups').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        ['booked', 'booking_pending'].includes(d.status) || (d.status === 'cancelled' && !d.vehicle_id) ? Promise.resolve(null) : rpc('delivery_bill', { p_id: id })]);
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
    const canApproveFor = () => can.approve();
    s.el.querySelector('.sheet-head h2').textContent = d.code; s.el.querySelector('.sheet-head p')?.remove();
    const sub = h('p', `${x.customer?.name || (d.booking_text || '').split('\n')[0]}${x.vehicle ? `, ${x.vehicle.number}` : ''}`); s.el.querySelector('.sheet-titles').append(sub);

    const blockers = [];
    if (waiting.length) blockers.push(`Waiting for ${[...new Set(waiting.map(m => who_(m.cash_user)))].join(' and ')} to acknowledge ${fmtMoney(waiting.reduce((a, m) => a + Number(m.amount), 0))} cash.`);
    if (disputed.length) blockers.push('A payment was disputed. A Manager must void it before this can be approved.');
    if (d.status === 'pending' && x.customer && x.customer.status !== 'active') blockers.push('The customer is still waiting for approval in the Customer Master. Approve them first.');
    if (d.status === 'pending') { const got = entries.filter(m => m.ref_kind === 'delivery' && m.entry_type === 'Income').reduce((a2, m) => a2 + Number(m.amount), 0); const need = Number(d.total_amount) + Number(d.other_charges_amount);
      if (Math.abs(got - need) > 0.001) blockers.push(`Received ${fmtMoney(got)} but the amount charged is ${fmtMoney(need)}. They must be equal.`); }

    const kv = (k, v) => (v === null || v === undefined || v === '' ? null : h('div', { class: 'kv' }, h('dt', k), h('dd', v)));
    const top = h('div', { class: 'detail-top' }, deliveryChip(d.status), overdue(d) ? chip('Overdue', 'pink', 'clock') : null, x.customer?.customer_type === 'foreign' ? chip('Foreign customer', 'aqua') : null);
    const actions = []; const A = (label, o) => actions.push(btn(label, o));
    const primary = [];
    const P = (label, o) => primary.push(btn(label, { kind: 'primary', ...o }));
    const ap = can.approve();
    const activeExt = x.extensions.filter(e => e.status === 'approved');
    const advIn = x.money.filter(m => m.entry_type === 'Income' && m.purpose === 'Booking advance' && m.status !== 'void').reduce((a2, m) => a2 + Number(m.amount), 0);
    const advOut = x.money.filter(m => m.entry_type === 'Expense' && m.purpose === 'Booking refund' && m.status !== 'void').reduce((a2, m) => a2 + Number(m.amount), 0);
    const advLeft = Math.max(0, Math.round((advIn - advOut) * 100) / 100);
    if (['booking_pending', 'booked'].includes(d.status)) A('Receive booking amount', { ic: 'wallet', onClick: () => openMoneyForm({ delivery: d, preset: { type: 'Income', purpose: 'Booking advance' }, onDone: reload }) });
    if (d.status === 'cancelled' && advLeft > 0) P('Refund booking amount', { ic: 'wallet', onClick: () => openMoneyForm({ delivery: d, preset: { type: 'Expense', purpose: 'Booking refund', amount: String(advLeft) }, onDone: reload }) });
    if (d.status === 'booking_pending') {
      if (ap) P('Approve booking', { ic: 'check', onClick: () => approve('approve_booking', d.id, 'booking', 'Once approved, the vehicle can be handed over.') });
      if (d.created_by === me || ap) A('Edit booking', { ic: 'edit', onClick: () => editBooking(d) });
      if (d.created_by === me || ap) A('Cancel booking', { ic: 'ban', onClick: () => cancel(d) });
    }
    if (d.status === 'booked') {
      P('Hand over', { ic: 'bike', onClick: () => openDeliveryForm({ mode: 'deliver', booking: d, onDone: reload }) });
      A('Cancel booking', { ic: 'ban', onClick: () => cancel(d) });
    }
    if (d.status === 'pending') {
      if (ap) {
        if (!d.reviewed_at) P('Step 1: I have reviewed the details', { ic: 'check', onClick: () => review('review_delivery', d.id, 'delivery', 'I have checked the booking details, customer, vehicle, helmets, address, charges and payments.') });
        else P('Step 2: Confirm vehicle delivered', { ic: 'check', disabled: blockers.length > 0, onClick: () => approve('approve_delivery', d.id, 'delivery', 'Confirm the vehicle and helmets were physically handed over to the customer.') });
      }
      if (d.created_by === me || can.manager()) A('Edit details', { ic: 'edit', onClick: () => editCharges(d) });
      if (can.manager()) A('Reverse delivery', { ic: 'undo', onClick: () => cancel(d) });
    }
    if (d.status === 'active') {
      P('Pick up', { ic: 'bike', onClick: () => openPickupForm({ delivery: d, rentalDays: d.days + activeExt.reduce((a2, e) => a2 + e.extra_days, 0), helmetsOut: x.helmets.filter(hh => !hh.returned_at), onDone: reload }) });
      A('Extend', { ic: 'clock', onClick: () => openExtendForm({ delivery: d, onDone: reload }) });
      if (can.assignSwap() && !liveSwap && !doneSwap) A('Assign a swap', { ic: 'move', onClick: () => openAssignSwap({ delivery: d, onDone: reload }) });
    }
    if (d.status === 'pickup_pending' && live) {
      if (ap) P('Approve pickup', { ic: 'check', disabled: blockers.length > 0 || x.extensions.some(e => e.status === 'pending'), onClick: () => approve('approve_pickup', live.id, 'pickup', 'The vehicle goes back to Ready and the delivery is closed.') });
      if (can.manager()) A('Cancel pickup', { ic: 'undo', onClick: () => cancelPickup(live) });
    }
    if (['pickup_pending', 'closed'].includes(d.status) && x.bill && Number(d.deposit) - Number(x.bill.deposit_refunded) > 0)
      A('Refund deposit', { ic: 'wallet', onClick: () => openMoneyForm({ delivery: d, preset: { type: 'Expense', purpose: 'Refundable Deposit', amount: String(Math.max(0, Number(d.deposit) - Number(x.bill.deposit_refunded) - Number(x.bill.extra_km_charge) - Number(x.bill.pickup_other_charges))) }, onDone: reload }) });
    if (!['cancelled', 'booking_pending', 'booked'].includes(d.status)) A('Add payment', { ic: 'plus', onClick: () => openMoneyForm({ delivery: d, onDone: reload }) });
    A('Copy number', { ic: 'copy', onClick: () => navigator.clipboard?.writeText(d.code).then(() => toast('Copied')) });

    const billBox = x.bill ? h('div', { class: 'bill' },
      row('Total amount', x.bill.total_amount), x.bill.other_charges > 0 ? row(d.other_charges_text || 'Other charges', x.bill.other_charges) : null,
      x.bill.extensions > 0 ? row('Extensions', x.bill.extensions) : null, x.bill.extension_pending > 0 ? row('Extension waiting for approval (not counted yet)', x.bill.extension_pending, 'muted') : null, x.bill.extra_km_charge > 0 ? row('Extra km', x.bill.extra_km_charge) : null,
      x.bill.pickup_other_charges > 0 ? row('Other charges at return', x.bill.pickup_other_charges) : null,
      row('Total bill', x.bill.charges, 'strong'), row('Received', x.bill.paid), x.bill.awaiting_ack > 0 ? row('Cash waiting for acknowledgement', x.bill.awaiting_ack, 'muted') : null,
      x.bill.deposit_refunded > 0 ? row('Deposit given back', x.bill.deposit_refunded, 'muted') : null,
      row(x.bill.balance_due < 0 ? (live ? 'To give back to the customer' : 'Overpaid') : 'Balance to collect', Math.abs(x.bill.balance_due), x.bill.balance_due > 0 ? 'due' : 'ok')) : null;

    const dPhotoSet = photoSetView(d.photo_set || legacySet(d.photos), 'Vehicle at handover');
    mount(s.body, top,
      blockers.length && !['closed', 'cancelled', 'booked', 'booking_pending'].includes(d.status) ? h('div', { class: 'callout' }, icon('info', 18), h('span', blockers.join(' '))) : null,
      d.status === 'cancelled' && advLeft > 0 ? h('div', { class: 'callout' }, icon('alert', 18), h('span', `The customer paid ${fmtMoney(advIn)} as a booking advance. ${fmtMoney(advLeft)} still has to be refunded.`)) : null,
      d.status === 'pending' ? h('div', { class: 'steps' }, h('span', { class: `step ${d.reviewed_at ? 'done' : 'now'}` }, '1  Review all details'), h('span', { class: `step ${d.reviewed_at ? 'now' : ''}` }, '2  Confirm physical delivery')) : null,
      h('div', { class: 'action-bar' }, actions),
      sectionBlock('Details', h('dl', { class: 'kvs' },
        kv('Booking details (typed at booking)', d.booking_text ? h('span', { class: 'prewrap' }, d.booking_text) : null),
        kv('Customer', x.customer ? h('span', null, x.customer.name, h('small', { class: 'cell-note' }, fmtPhone(x.customer.mobile)), x.customer.status === 'pending' ? chip('Waiting for approval', 'pink') : null) : null),
        ['booked', 'booking_pending'].includes(d.status) ? kv('Planned delivery', fmtDateTimeY(d.booking_for)) : null, d.booking_approved_at ? kv('Booking approved by', `${whoName(d.booking_approved_by)}, ${fmtDateTimeY(d.booking_approved_at)}`) : null,
        kv('Vehicle', x.vehicle ? `${x.vehicle.number}, ${model(x.vehicle.model_id)?.name || ''}` : null), kv('Helmets', x.helmets.length ? h('span', null, x.helmets.map(hh => chip(hh.code + (hh.returned_at ? ', returned' : ''), hh.returned_at ? 'neutral' : 'blue'))) : (['booked', 'booking_pending'].includes(d.status) ? null : 'None')),
        kv('Handed over', d.handover_mode === 'office' ? 'The customer collected it at the Office' : d.handover_mode === 'delivery' ? 'We delivered it to the customer' : null), kv('Delivered', d.delivered_at ? fmtDateTimeY(d.delivered_at) : null), kv(d.handover_mode === 'office' ? 'Collected at' : 'Delivery location', d.delivery_place), kv('Current address', d.current_address), kv('Taken from', loc(d.from_location_id)?.name),
        d.reviewed_at ? kv('Details reviewed by', `${whoName(d.reviewed_by)}, ${fmtDateTimeY(d.reviewed_at)}`) : null,
        kv('Return due', d.return_due ? fmtDateTimeY(d.return_due) : null), kv('Days', d.days ? `${d.days}${activeExt.length ? ` + ${activeExt.reduce((a, e) => a + e.extra_days, 0)} extended` : ''}` : null),
        kv('Km limit', d.km_limit_per_day ? `${d.km_limit_per_day} km per day, ${fmtMoney(d.extra_km_rate)} per extra km` : null), kv('Odometer out', d.odometer_out !== null ? `${d.odometer_out} km${d.km_before_current ? ` (after swap; ${d.km_before_current} km used before)` : ''}` : null),
        kv('Added by', `${whoName(d.created_by)}, ${fmtDateTimeY(d.created_at)}`), d.approved_at ? kv('Approved by', `${whoName(d.approved_by)}, ${fmtDateTimeY(d.approved_at)}`) : null,
        d.status === 'cancelled' ? kv('Cancelled', `${d.cancel_reason} (${whoName(d.cancelled_by)})`) : null, kv('Note', d.note))),
      !['booked', 'booking_pending'].includes(d.status) ? sectionBlock('Charges', h('dl', { class: 'kvs' }, kv('Rent', fmtMoney(d.rent)), kv('Deposit', fmtMoney(d.deposit)), kv('Delivery charges', fmtMoney(d.delivery_charges)), kv('Advance pickup charges', fmtMoney(d.advance_pickup_charges))), billBox) : null,
      sectionBlock(`Payments (${x.money.length})`, x.money.length ? h('ul', { class: 'pay-list' }, x.money.map(m => payRow(m, d))) : h('p', { class: 'muted' }, 'No payments yet.')),
      x.extensions.length ? sectionBlock('Extensions', h('ul', { class: 'pay-list' }, x.extensions.map(e => h('li', { class: 'pay-row' }, h('div', null, h('strong', `Until ${fmtDateTime(e.new_return_due)}: ${fmtMoney(e.amount)} flat`),
        h('small', `Was due ${fmtDateTime(e.old_return_due)}, +${e.extra_days} day${e.extra_days === 1 ? '' : 's'}. Added by ${whoName(e.created_by)}.${e.status === 'pending' ? ' Takes effect when approved.' : ''}${e.note ? ' ' + e.note : ''}`)),
        h('div', { class: 'pay-act' }, e.status === 'approved' ? statusBadge('active', 'Approved') : e.status === 'cancelled' ? chip('Cancelled', 'neutral') : chip('Waiting for approval', 'blue'),
          e.status === 'pending' && ap ? btn('Approve', { small: true, kind: 'primary', onClick: () => approve('approve_extension', e.id, 'extension', 'The new return date takes effect.') }) : null,
          e.status === 'pending' && (e.created_by === me || ap) || (e.status === 'approved' && can.manager() && d.status === 'active') ? btn('Cancel', { small: true, onClick: () => cancelExt(e) }) : null))))) : null,
      x.swaps.length ? sectionBlock('Swaps', h('ul', { class: 'pay-list' }, x.swaps.map(w => swapRow(w, d, x)))) : null,
      x.pickups.length ? sectionBlock('Pickup', h('ul', { class: 'pay-list' }, x.pickups.map(k => h('li', { class: 'pay-row stacked' }, h('div', { class: 'pay-row-top' }, h('div', null, h('strong', `Picked up at ${k.return_place || loc(k.return_location_id)?.name || ''}, ${fmtDateTime(k.returned_at)}`),
        h('small', `${k.km_used} km used, ${k.allowed_km} km allowed over ${k.rental_days} days. ${k.extra_km} km extra = ${fmtMoney(k.extra_km_charge)}${k.other_charges_amount > 0 ? `. ${k.other_charges_text || 'Other'}: ${fmtMoney(k.other_charges_amount)}` : ''}.${k.condition_note ? ' ' + k.condition_note : ''}`), h('small', `By ${whoName(k.created_by)}`)),
        h('div', { class: 'pay-act' }, k.status === 'approved' ? statusBadge('active', 'Approved') : k.status === 'cancelled' ? chip('Cancelled', 'neutral') : chip('Waiting for approval', 'blue'))),
        photoSetView(k.photo_set || legacySet(k.photos), 'Photos at return'))))) : null,
      dPhotoSet ? sectionBlock('Photos at handover', dPhotoSet) : null);
    hydrateTiles(s.body, d.code);
    mount(s.foot, ...(primary.length ? primary : [btn('Close', { onClick: () => s.close() })]));
  }
  const who_ = (id) => state.profileMap.get(id)?.user_name || 'the cash holder';
  const row = (k, v, cls = '') => h('div', { class: `bill-row ${cls}` }, h('span', k), h('strong', fmtMoney(v)));

  function payRow(m, cur) {
    const me = state.me.id;
    return h('li', { class: `pay-row ${m.status === 'void' ? 'is-void' : ''}` },
      h('div', null, h('strong', `${m.purpose}`), h('small', `${m.entry_type}, ${m.via}${m.cash_user ? `, cash held by ${who_(m.cash_user)}` : ''}. Added by ${whoName(m.created_by)} on ${fmtDateTime(m.created_at)}.${m.dispute_reason ? ' Dispute: ' + m.dispute_reason : ''}${m.void_reason ? ' Void: ' + m.void_reason : ''}`)),
      h('div', { class: 'pay-act' }, h('span', { class: `amt ${m.entry_type === 'Expense' ? 'neg' : ''}` }, signed(m)), moneyChip(m),
        m.status === 'pending_ack' && m.cash_user === me ? [btn('Acknowledge', { small: true, kind: 'primary', onClick: () => acknowledgeMoney(m, reload) }), btn('Dispute', { small: true, onClick: () => disputeMoney(m, reload) })] : null,
        m.status === 'pending' && m.ref_kind === 'delivery' && can.approve() && cur.status !== 'pending' ? btn('Approve', { small: true, kind: 'primary', onClick: () => approveMoney(m, reload) }) : null,
        m.status !== 'void' && can.manager() ? btn('Void', { small: true, onClick: () => voidMoney(m, reload) }) : null));
  }
  function swapRow(w, d, x) {
    const me = state.me.id; const label = { assigned: 'Assigned', done: w.reviewed_at ? 'Reviewed, waiting for your confirmation' : 'Done, waiting for review', approved: 'Approved', cancelled: 'Cancelled' }[w.status];
    const details = w.status === 'assigned' ? null : h('div', { class: 'swap-details' },
      h('dl', { class: 'kvs' },
        h('div', { class: 'kv' }, h('dt', 'Swap location'), h('dd', w.swap_place || '')), h('div', { class: 'kv' }, h('dt', 'Current address'), h('dd', { class: 'prewrap' }, w.current_address || '')),
        h('div', { class: 'kv' }, h('dt', 'Old vehicle'), h('dd', `${x.vmap.get(w.old_vehicle_id) || ''}, reading ${w.odometer_in_old} km`)), h('div', { class: 'kv' }, h('dt', 'New vehicle'), h('dd', `${x.vmap.get(w.new_vehicle_id) || ''}, reading ${w.odometer_out_new} km`)),
        w.note ? h('div', { class: 'kv' }, h('dt', 'Note'), h('dd', w.note)) : null,
        w.reviewed_at ? h('div', { class: 'kv' }, h('dt', 'Reviewed by'), h('dd', `${whoName(w.reviewed_by)}, ${fmtDateTimeY(w.reviewed_at)}`)) : null),
      photoSetView(w.photos_old, 'Old bike received back'), photoSetView(w.photos_new, 'New bike given'));
    if (details) queueMicrotask(() => hydrateTiles(details, d.code));
    return h('li', { class: 'pay-row stacked' }, h('div', { class: 'pay-row-top' }, h('div', null, h('strong', w.status === 'assigned' ? `To be done by ${who_(w.assigned_to)}` : `${x.vmap.get(w.old_vehicle_id) || ''} replaced by ${x.vmap.get(w.new_vehicle_id) || ''}`),
      h('small', `Assigned by ${whoName(w.assigned_by)}${w.reason ? `. ${w.reason}` : ''}${w.done_by ? `. Done by ${whoName(w.done_by)}` : ''}`)),
      h('div', { class: 'pay-act' }, chip(label, w.status === 'approved' || w.status === 'cancelled' ? 'neutral' : 'blue'),
        w.status === 'assigned' && (w.assigned_to === me || can.admin()) ? btn('Do the swap', { small: true, kind: 'primary', onClick: () => openDoSwap({ swap: w, delivery: d, onDone: reload }) }) : null,
        w.status === 'done' && can.approve() && !w.reviewed_at ? btn('Step 1: I have reviewed the details', { small: true, kind: 'primary', onClick: () => review('review_swap', w.id, 'swap', 'I have checked the new and old vehicle, readings, address, location, all the photos (odometer and four sides of each bike) and the payments.') }) : null,
        w.status === 'done' && can.approve() && w.reviewed_at ? btn('Step 2: Confirm swap', { small: true, kind: 'primary', onClick: () => approve('approve_swap', w.id, 'swap', 'The new vehicle goes to the customer and the old one goes back to its Office.') }) : null,
        w.status === 'assigned' && (w.assigned_by === me || can.manager()) || (w.status === 'done' && can.manager()) ? btn('Cancel', { small: true, onClick: () => cancelSwap(w) }) : null)),
      details);
  }

  const approve = (fn, rid, what, msg) => confirmDialog({ title: `Confirm this ${what}?`, message: `${msg || ''} Its payments are approved with it.`.trim(), confirmLabel: 'Confirm' }).then(async (r) => { if (!r) return;
    try { await rpc(fn, { p_id: rid }); toast('Done'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } });
  const review = (fn, rid, what, msg) => confirmDialog({ title: `Review this ${what}`, message: `Scroll through every detail on this screen first. ${msg}`, confirmLabel: 'Yes, reviewed' }).then(async (r) => { if (!r) return;
    try { await rpc(fn, { p_id: rid }); toast('Marked as reviewed. Now confirm it.'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } });
  const cancel = (d) => confirmDialog({ title: ['booked', 'booking_pending'].includes(d.status) ? 'Cancel this booking?' : 'Reverse this delivery?', message: ['booked', 'booking_pending'].includes(d.status) ? 'The booking is cancelled.' : 'The vehicle and helmets go back to their Office and its payments are voided.', confirmLabel: 'Yes, cancel it', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return;
      try { await rpc('cancel_delivery', { p_id: d.id, p_reason: r.text }); toast('Cancelled'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } });
  function editBooking(d) {
    const text = h('textarea', { class: 'input', rows: '4' }); text.value = d.booking_text || '';
    const when = input({ type: 'datetime-local', value: d.booking_for ? localInputValue(new Date(d.booking_for)) : '' });
    const save = btn('Save', { kind: 'primary', type: 'submit' }); save.setAttribute('form', 'edit-bk'); const err = h('p', { class: 'field-error', hidden: true });
    const form = h('form', { id: 'edit-bk', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); busy(save, async () => { try {
      await rpc('update_booking', { p_id: d.id, p: { booking_text: text.value.trim(), booking_for: isoFromLocal(when.value) } }); toast('Saved'); e2.close(); await reload(); } catch (e) { err.textContent = friendlyError(e); err.hidden = false; } }); } } },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Customer name and contact details'), text), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Planned delivery'), when), err);
    const e2 = openSheet({ title: 'Edit booking', subtitle: d.code, body: form, footer: [btn('Cancel', { onClick: () => e2.close() }), save] });
  }
  const cancelExt = (e) => confirmDialog({ title: 'Cancel this extension?', message: 'The return date goes back and its payments are voided.', confirmLabel: 'Cancel extension', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_extension', { p_id: e.id, p_reason: r.text }); toast('Extension cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  const cancelSwap = (w) => confirmDialog({ title: 'Cancel this swap?', confirmLabel: 'Cancel swap', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_swap', { p_id: w.id, p_reason: r.text }); toast('Swap cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  const cancelPickup = (k) => confirmDialog({ title: 'Cancel this pickup?', message: 'The vehicle and helmets go back to the customer on record and the pickup payments are voided.', confirmLabel: 'Cancel pickup', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_pickup', { p_id: k.id, p_reason: r.text }); toast('Pickup cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  function editCharges(d) {
    const mk = (v) => input({ inputmode: 'decimal', value: String(v ?? 0) });
    const f = { delivery_place: input({ value: d.delivery_place || '' }), current_address: input({ value: d.current_address || '' }), days: input({ inputmode: 'numeric', value: String(d.days) }), rent: mk(d.rent), deposit: mk(d.deposit), delivery_charges: mk(d.delivery_charges), advance_pickup_charges: mk(d.advance_pickup_charges), extra_km_rate: mk(d.extra_km_rate), other_charges_amount: mk(d.other_charges_amount) };
    const lab = { delivery_place: 'Delivery location', current_address: 'Current address', days: 'Days', rent: 'Rent', deposit: 'Deposit', delivery_charges: 'Delivery charges', advance_pickup_charges: 'Advance pickup charges', extra_km_rate: 'Extra km rate', other_charges_amount: 'Other charges' };
    const err = h('p', { class: 'field-error', hidden: true });
    const save = btn('Save', { kind: 'primary', type: 'submit' }); save.setAttribute('form', 'edit-ch');
    const form = h('form', { id: 'edit-ch', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); busy(save, async () => { try {
      await rpc('update_delivery', { p_id: d.id, p: Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value.trim()])) }); toast('Saved'); e2.close(); await reload(); } catch (e) { err.textContent = friendlyError(e); err.hidden = false; } }); } } },
      h('div', { class: 'grid-2' }, Object.entries(f).map(([k, i]) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, lab[k]), i))), err);
    const e2 = openSheet({ title: 'Edit details', subtitle: d.code, body: form, footer: [btn('Cancel', { onClick: () => e2.close() }), save] });
  }
  await paint();
  return s;
}
