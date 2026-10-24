import { h, icon, btn, busy, chip, statusBadge, sectionBlock, openSheet, confirmDialog, toast, mount, emptyState, skeletonRows, debounce, input, localInputValue, isoFromLocal,
  fmtDateTime, fmtDateTimeY, fmtPhone, fmtMoney, friendlyError } from '../core/ui.js';
import { sb, rpc } from '../core/supa.js';
import { dataTable } from '../core/table.js';
import { state, can, whoName, loc, model } from '../core/store.js';
import { signedUrls, lightbox } from '../core/images.js';
import { summaryTable, deliverySummary } from '../core/payments.js';
import { deliveryChip, DELIVERY_LABEL, moneyChip, signed, acknowledgeMoney, disputeMoney, voidMoney, approveMoney } from '../core/ops.js';
import { openDeliveryForm, openBookingForm, openReplaceBooking, conflictText, openExtendForm, openAssignSwap, openChangeSwapVehicle, openDoSwap, openPickupForm, openMoneyForm } from './delivery_forms.js';
import { photoSlider, compareSlider } from '../core/slider.js';
import { openCustomerView } from '../core/customer_view.js';
import { mapsUrl } from '../core/geo.js';

const PAGE = 40;
const COLS = 'id,code,status,customer_id,vehicle_id,model_id,booking_for,booking_text,booking_name,booking_phone,booking_vehicle_id,booking_place,booking_days,delivered_at,return_due,days,created_by,created_at,approved_at,reviewed_at';
const FILTERS = [['all', 'All'], ['booking_pending', 'Bookings to approve'], ['booked', 'Booked'], ['pending', 'Waiting for approval'], ['active', 'Out now'], ['pickup_pending', 'Pickup waiting'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];
const inIds = (ids) => [...new Set(ids.filter(Boolean))];

export async function loadMaps(rows) {
  const [cs, vs] = await Promise.all([
    inIds(rows.map(r => r.customer_id)).length ? sb.from('customers').select('id,name,mobile,customer_type,nationality,status').in('id', inIds(rows.map(r => r.customer_id))) : { data: [] },
    inIds(rows.flatMap(r => [r.vehicle_id, r.booking_vehicle_id])).length ? sb.from('vehicles').select('id,number,model_id').in('id', inIds(rows.flatMap(r => [r.vehicle_id, r.booking_vehicle_id]))) : { data: [] },
  ]);
  return { customers: new Map((cs.data || []).map(c => [c.id, c])), vehicles: new Map((vs.data || []).map(v => [v.id, v])) };
}
const overdue = (d) => d.status === 'active' && d.return_due && new Date(d.return_due) < new Date();

// ---- photo sets: labelled thumbnails (also reads older records that have fewer photos) ----------
const SET_LABEL = { odometer: 'Odometer', front: 'Front', back: 'Rear', left: 'Left side', right: 'Right side' };
export function photoSetView(set, title) { return photoSlider(set, title); }
export const geoLine = (o) => (o && o.geo_lat != null ? h('span', null, o.geo_address ? `${o.geo_address} ` : 'Location recorded ', h('a', { href: mapsUrl(o.geo_lat, o.geo_lng), target: '_blank', rel: 'noopener' }, '(open map)')) : null);
export function hydrateTiles(root, code) {
  const tiles = [...root.querySelectorAll('.tile[data-path]')]; const paths = tiles.map(t => t.dataset.path).filter(Boolean);
  if (!paths.length) return;
  signedUrls(paths).then(map => tiles.forEach(t => { const u = map[t.dataset.path]; if (u && !t.querySelector('img')) { t.prepend(h('img', { src: u, alt: t.dataset.cap })); t.style.cursor = 'zoom-in'; t.addEventListener('click', () => lightbox(u, `${code} ${t.dataset.cap}`)); } })).catch(() => {});
}
const legacySet = (arr) => (arr?.length ? { extra: arr } : null);

export async function render(root, params) {
  const st = { status: FILTERS.some(f => f[0] === params.status) ? params.status : 'all', q: '', items: [], maps: { customers: new Map(), vehicles: new Map() }, total: 0, loading: false, order: { col: 'created_at', asc: false } };
  const list = h('div', { class: 'dl-list' }); const moreWrap = h('div', { class: 'more-wrap' }); const countEl = h('p', { class: 'result-count', 'aria-live': 'polite' });
  const search = input({ type: 'search', placeholder: 'Search by delivery number, customer, mobile or vehicle', 'aria-label': 'Search deliveries', enterkeyhint: 'search' });
  const chips = h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Filter by status' }, FILTERS.map(([v, l]) =>
    h('button', { type: 'button', class: 'fchip', dataset: { v }, 'aria-pressed': String(st.status === v), on: { click: () => { st.status = v; chips.querySelectorAll('.fchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.status))); load(true); } } }, l)));

  async function fetchRows(reset) {
    const term = st.q.replace(/[,()%*\\]/g, ' ').trim();
    const base = () => { let q = sb.from('deliveries').select(COLS, { count: 'exact' }).order(st.order.col, { ascending: st.order.asc, nullsFirst: false }).order('id', { ascending: st.order.asc }); if (st.status !== 'all') q = q.eq('status', st.status); return q; };
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
  const cust = (d) => st.maps.customers.get(d.customer_id), veh = (d) => st.maps.vehicles.get(d.vehicle_id || d.booking_vehicle_id);
  let viewMode = 'cards'; try { viewMode = localStorage.getItem('sfa-dl-view') || 'cards'; } catch {}
  const viewBtns = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show as' }, [['cards', 'Cards'], ['table', 'Table']].map(([v, l]) =>
    h('button', { type: 'button', class: 'fchip', dataset: { v }, 'aria-pressed': String(viewMode === v), on: { click: () => { viewMode = v; try { localStorage.setItem('sfa-dl-view', v); } catch {} viewBtns.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === viewMode))); paint(); } } }, l)));
  const cardOf = (d) => { const c = cust(d), v = veh(d);
    return h('article', { class: 'card-item clickable', tabindex: '0', on: { click: () => openDetail(d.id), keydown: (e) => { if (e.key === 'Enter') openDetail(d.id); } } },
      h('div', { class: 'card-top' }, h('strong', { class: 'code' }, d.code), h('span', null, deliveryChip(d.status), overdue(d) ? chip('Overdue', 'pink', 'clock') : null)),
      h('div', null, h('strong', c ? c.name : (d.booking_name || (d.booking_text || '').split('\n')[0] || 'No customer yet')), c ? h('small', { class: 'cell-note' }, fmtPhone(c.mobile)) : null),
      h('div', { class: 'card-meta' }, v ? h('span', null, icon('bike', 14), ` ${v.number}`) : null,
        h('span', null, ['booked', 'booking_pending'].includes(d.status) ? `Planned ${fmtDateTime(d.booking_for)}` : d.return_due ? `Return ${fmtDateTime(d.return_due)}` : fmtDateTime(d.delivered_at || d.created_at))));
  };
  const table = dataTable({
    storageKey: 'deliveries', defaultSort: { key: 'date', dir: 'desc' }, empty: 'Nothing to show.',
    serverKeys: { date: 'created_at', status: 'status', due: 'return_due' },
    onServerSort: (col, dir) => { st.order = { col, asc: dir === 'asc' }; load(true); },
    rowClick: (d) => openDetail(d.id),
    columns: [
      { key: 'date', label: 'Delivery', nowrap: true, sort: (d) => d.created_at, render: (d) => h('span', null, h('strong', { class: 'code' }, d.code), h('small', fmtDateTime(d.delivered_at || d.booking_for || d.created_at))), csv: (d) => d.code },
      { key: 'cust', label: 'Customer', sort: (d) => (cust(d)?.name || d.booking_name || d.booking_text || '').toLowerCase(), render: (d) => { const c = cust(d); return c ? h('span', null, h('strong', c.name), h('small', fmtPhone(c.mobile))) : d.booking_name ? h('span', null, h('strong', d.booking_name), h('small', fmtPhone(d.booking_phone))) : d.booking_text ? h('span', { class: 'prewrap clamp' }, d.booking_text) : '…'; } },
      { key: 'veh', label: 'Vehicle', nowrap: true, sort: (d) => veh(d)?.number || '', render: (d) => veh(d)?.number || '' },
      { key: 'status', label: 'Status', sort: (d) => d.status, render: (d) => h('span', null, deliveryChip(d.status), overdue(d) ? chip('Overdue', 'pink', 'clock') : null) },
      { key: 'due', label: 'Return due', nowrap: true, sort: (d) => d.return_due || '', render: (d) => ['booked', 'booking_pending'].includes(d.status) ? `Planned ${fmtDateTime(d.booking_for)}` : d.return_due ? fmtDateTime(d.return_due) : '' },
    ] });
  function paint() {
    countEl.textContent = st.total ? `${st.total} deliver${st.total === 1 ? 'y' : 'ies'}` : '';
    table.setServerMode(!st.q);
    if (!st.items.length) { mount(list, st.q || st.status !== 'all' ? emptyState('No deliveries match', 'Try a different search or filter.') : emptyState('No deliveries yet', 'Start with a new delivery, or save a booking to hand over later.', btn('New delivery', { kind: 'primary', ic: 'plus', onClick: () => openNew('deliver') }))); moreWrap.replaceChildren(); return; }
    if (viewMode === 'cards') mount(list, h('div', { class: 'deck' }, st.items.map(cardOf)));
    else { table.setRows(st.items); mount(list, table.el); }
    moreWrap.replaceChildren(!st.q && st.items.length < st.total ? btn(`Show more (${st.total - st.items.length} left)`, { onClick: (e) => busy(e.currentTarget, () => load(false)) }) : '');
  }
  const openNew = (mode) => mode === 'booking' && !can.createBooking() ? toast('An Executive cannot create a booking.', 'error') : openDeliveryForm({ mode, onDone: (id) => { load(true); openDetail(id); } });
  search.addEventListener('input', debounce(() => { st.q = search.value; load(true); }, 300));
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Deliveries'), h('p', { class: 'muted' }, 'Hand over vehicles, extend, swap and pick up.')),
    h('div', { class: 'page-actions' }, can.createBooking() ? btn('New booking', { ic: 'clock', onClick: () => openNew('booking') }) : null, btn('New delivery', { kind: 'primary', ic: 'plus', onClick: () => openNew('deliver') }))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), chips, viewBtns), countEl, list, moreWrap);
  await load(true);
  if (params.open) openDetail(Number(params.open));
  if (params.new) openNew(params.new === 'booking' ? 'booking' : 'deliver');

  // ---------------------------------------------------------------- detail
  function openDetail(id) { return openDeliveryDetail(id, { onChange: () => load(true) }); }
}

// Opened from the list, the To do page, and the dashboard.
export async function openDeliveryDetail(id, { onChange } = {}) {
  // An approver who opens a delivery that waits for approval holds a lock on it, so nobody changes it while it is being reviewed.
  let held = false, beat = null; const LOCK_MIN = 10;
  const releaseLock = () => { clearInterval(beat); beat = null; if (held) { held = false; rpc('release_delivery_lock', { p_id: id }).catch(() => {}); } };
  const s = openSheet({ title: 'Delivery', body: skeletonRows(5), footer: [], wide: 'xl', onClose: releaseLock });
  const reload = async () => { await paint(); onChange?.(); };
  async function paint() {
    try {
      const { data: d, error } = await sb.from('deliveries').select('*').eq('id', id).maybeSingle(); if (error) throw error; if (!d) throw new Error('This delivery was not found.');
      let lock = { ok: true };
      if (d.status === 'pending' && can.approve()) {
        try { lock = await rpc('acquire_delivery_lock', { p_id: id }) || { ok: true }; } catch { lock = { ok: true, skipped: true }; }   // (older database without the Stage 10b script)
        if (lock.ok && !lock.skipped && !held) { held = true; beat = setInterval(() => rpc('acquire_delivery_lock', { p_id: id }).catch(() => {}), 120000); }
      } else if (held) releaseLock();
      d._lockedBy = lock.ok === false ? (lock.name || 'Another approver')
        : (d.status === 'pending' && d.edit_lock_by && d.edit_lock_by !== state.me.id && d.edit_lock_at && Date.now() - new Date(d.edit_lock_at).getTime() < LOCK_MIN * 60000 ? (state.profileMap.get(d.edit_lock_by)?.user_name || 'An approver') : null);
      const [cRes, vRes, hRes, mRes, eRes, wRes, kRes, bill, bvRes, rpRes] = await Promise.all([
        d.customer_id ? sb.from('customers').select('id,name,mobile,customer_type,nationality,status,customer_image').eq('id', d.customer_id).maybeSingle() : { data: null },
        d.vehicle_id ? sb.from('vehicles').select('id,number,model_id').eq('id', d.vehicle_id).maybeSingle() : { data: null },
        sb.from('delivery_helmets').select('helmet_id,returned_at').eq('delivery_id', id),
        sb.from('money_entries').select('*').eq('delivery_id', id).order('created_at', { ascending: true }).order('id', { ascending: true }),
        sb.from('extensions').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        sb.from('swaps').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        sb.from('pickups').select('*').eq('delivery_id', id).order('created_at', { ascending: true }),
        ['booked', 'booking_pending'].includes(d.status) || (d.status === 'cancelled' && !d.vehicle_id) ? Promise.resolve(null) : rpc('delivery_bill', { p_id: id }),
        d.booking_vehicle_id ? sb.from('vehicles').select('id,number,model_id,current_state,current_location_id').eq('id', d.booking_vehicle_id).maybeSingle() : { data: null },
        // replacement requests (an empty list if the Stage 2 script has not been run)
        sb.from('booking_replacements').select('*').eq('booking_id', id).order('created_at', { ascending: true }).then(r => (r.error ? { data: [] } : r), () => ({ data: [] }))]);
      for (const r of [cRes, hRes, mRes, eRes, wRes, kRes]) if (r.error) throw r.error;
      let helmets = []; if (hRes.data.length) { const { data } = await sb.from('helmets').select('id,code').in('id', hRes.data.map(x => x.helmet_id)); helmets = hRes.data.map(x => ({ ...x, code: data?.find(y => y.id === x.helmet_id)?.code || `#${x.helmet_id}` })); }
      const vehicleIds = [...new Set([...wRes.data.flatMap(w => [w.old_vehicle_id, w.new_vehicle_id, w.planned_vehicle_id]), ...rpRes.data.flatMap(r => [r.old_vehicle_id, r.new_vehicle_id])].filter(Boolean))]; const vmap = new Map();
      if (vehicleIds.length) (await sb.from('vehicles').select('id,number').in('id', vehicleIds)).data?.forEach(v => vmap.set(v.id, v.number));
      draw(d, { customer: cRes.data, vehicle: vRes.data, helmets, money: mRes.data, extensions: eRes.data, swaps: wRes.data, pickups: kRes.data, bill, vmap, bookVeh: bvRes.data, repl: rpRes.data });
    } catch (e) { mount(s.body, h('div', { class: 'empty' }, icon('alert', 28), h('h3', 'Could not load this delivery'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: paint }))); }
  }

  function draw(d, x) {
    const me = state.me.id; const live = x.pickups.find(p => p.status !== 'cancelled'); const openSwap = x.swaps.find(w => ['assigned', 'done'].includes(w.status));
    payRows = x.money;
    const entries = x.money.filter(m => m.status !== 'void');
    const waiting = entries.filter(m => m.status === 'pending_ack'), disputed = entries.filter(m => m.status === 'disputed');
    const canApproveFor = () => can.approve();
    s.el.querySelector('.sheet-head h2').textContent = d.code; s.el.querySelector('.sheet-head p')?.remove();
    const sub = h('p', `${x.customer?.name || d.booking_name || (d.booking_text || '').split('\n')[0]}${(x.vehicle || x.bookVeh) ? `, ${(x.vehicle || x.bookVeh).number}` : ''}`); s.el.querySelector('.sheet-titles').append(sub);

    const blockers = [];
    if (waiting.length) blockers.push(`Waiting for ${[...new Set(waiting.map(m => who_(m.cash_user)))].join(' and ')} to acknowledge ${fmtMoney(waiting.reduce((a, m) => a + Number(m.amount), 0))} cash.`);
    if (disputed.length) blockers.push('A payment was disputed. A Manager must void it before this can be approved.');
    if (d.status === 'pending' && x.customer && x.customer.status !== 'active') blockers.push('The customer is still waiting for approval in the Customer Master. Approve them first.');
    if (d.status === 'pending') { const got = entries.filter(m => m.ref_kind === 'delivery' && m.entry_type === 'Income').reduce((a2, m) => a2 + Number(m.amount), 0); const need = Number(d.total_amount) + Number(d.other_charges_amount);
      if (Math.abs(got - need) > 0.001) blockers.push(`Received ${fmtMoney(got)} but the amount charged is ${fmtMoney(need)}. They must be equal.`); }

    if (d.status === 'active' && openSwap) blockers.push('A swap is in progress. Finish it (do, review and confirm) or cancel it before the vehicle can be picked up.');

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
    const pendingRepl = x.repl.find(r => r.status === 'pending');
    if (['booking_pending', 'booked'].includes(d.status) && !pendingRepl) A('Replace vehicle', { ic: 'move', onClick: () => openReplaceBooking({ booking: { ...d, vehicle_number: x.bookVeh?.number, advance_received: advLeft }, onDone: reload }) });
    if (d.status === 'booked') {
      P('Hand over', { ic: 'bike', onClick: () => openDeliveryForm({ mode: 'deliver', booking: { ...d, vehicle_number: x.bookVeh?.number, advance_received: advLeft }, onDone: reload }) });
      A('Cancel booking', { ic: 'ban', onClick: () => cancel(d) });
    }
    if (d.status === 'pending') {
      const locked = !!d._lockedBy, custWaiting = !!(x.customer && x.customer.status === 'pending');
      if (ap) {
        if (custWaiting) P('Step 1: Approve the customer', { ic: 'check', disabled: locked, onClick: () => approveCustomer(x.customer) });
        else if (!d.reviewed_at) P('Step 2: I have reviewed the details', { ic: 'check', disabled: locked, onClick: () => review('review_delivery', d.id, 'delivery', 'I have checked the booking details, customer, vehicle, helmets, address, charges and payments.') });
        else P('Step 3: Confirm vehicle delivered', { ic: 'check', disabled: blockers.length > 0 || locked, onClick: () => approve('approve_delivery', d.id, 'delivery', 'Confirm the vehicle and helmets were physically handed over to the customer.') });
      }
      if (d.created_by === me || ap) A('Edit delivery', { ic: 'edit', disabled: locked, onClick: () => openDeliveryForm({ edit: { delivery: d, customer: x.customer, helmets: x.helmets.filter(hh => !hh.returned_at),
        received: entries.filter(m => m.ref_kind === 'delivery' && m.entry_type === 'Income' && m.status !== 'disputed').reduce((a2, m) => a2 + Number(m.amount), 0) }, onDone: reload }) });
      if (can.manager()) A('Reverse delivery', { ic: 'undo', disabled: locked, onClick: () => cancel(d) });
    }
    if (d.status === 'active') {
      if (!openSwap) P('Pick up', { ic: 'bike', onClick: () => openPickupForm({ delivery: d, due: Math.max(0, Number(x.bill?.balance_due) || 0), rentalDays: d.days + activeExt.reduce((a2, e) => a2 + e.extra_days, 0), helmetsOut: x.helmets.filter(hh => !hh.returned_at), onDone: reload }) });
      A('Extend', { ic: 'clock', onClick: () => openExtendForm({ delivery: d, onDone: reload }) });
      if (can.assignSwap() && !openSwap) A('Assign a swap', { ic: 'move', onClick: () => openAssignSwap({ delivery: d, onDone: reload }) });
    }
    if (d.status === 'pickup_pending' && live) {
      if (ap) P('Approve pickup', { ic: 'check', disabled: blockers.length > 0 || x.extensions.some(e => e.status === 'pending'), onClick: () => approve('approve_pickup', live.id, 'pickup', 'The vehicle goes back to Ready and the delivery is closed.') });
      if (can.manager()) A('Cancel pickup', { ic: 'undo', onClick: () => cancelPickup(live) });
    }
    if (['pickup_pending', 'closed'].includes(d.status) && x.bill && Number(d.deposit) - Number(x.bill.deposit_refunded) > 0)
      A('Refund deposit', { ic: 'wallet', onClick: () => openMoneyForm({ delivery: d, preset: { type: 'Expense', purpose: 'Refundable Deposit', amount: String(Math.max(0, Number(d.deposit) - Number(x.bill.deposit_refunded) - Number(x.bill.extra_km_charge) - Number(x.bill.pickup_other_charges))) }, onDone: reload }) });
    A('Copy number', { ic: 'copy', onClick: () => navigator.clipboard?.writeText(d.code).then(() => toast('Copied')) });

    const billBox = x.bill ? h('div', { class: 'bill' },
      row('Total amount', x.bill.total_amount), x.bill.other_charges > 0 ? row(d.other_charges_text || 'Other charges', x.bill.other_charges) : null,
      x.bill.extensions > 0 ? row('Extensions', x.bill.extensions) : null, x.bill.extension_pending > 0 ? row('Extension waiting for approval (not counted yet)', x.bill.extension_pending, 'muted') : null, x.bill.extra_km_charge > 0 ? row('Extra km', x.bill.extra_km_charge) : null,
      x.bill.pickup_other_charges > 0 ? row('Other charges at return', x.bill.pickup_other_charges) : null,
      row('Total bill', x.bill.charges, 'strong'), row('Received', x.bill.paid), x.bill.awaiting_ack > 0 ? row('Cash waiting for acknowledgement', x.bill.awaiting_ack, 'muted') : null,
      x.bill.deposit_refunded > 0 ? row('Deposit given back', x.bill.deposit_refunded, 'muted') : null,
      row(x.bill.balance_due < 0 ? (live ? 'To give back to the customer' : 'Overpaid') : 'Balance to collect', Math.abs(x.bill.balance_due), x.bill.balance_due > 0 ? 'due' : 'ok')) : null;

    const dPhotoSet = photoSlider(d.photo_set || legacySet(d.photos), 'Vehicle at handover');
    mount(s.body, top,
      blockers.length && !['closed', 'cancelled', 'booked', 'booking_pending'].includes(d.status) ? h('div', { class: 'callout' }, icon('info', 18), h('span', blockers.join(' '))) : null,
      d.status === 'cancelled' && advLeft > 0 ? h('div', { class: 'callout' }, icon('alert', 18), h('span', `The customer paid ${fmtMoney(advIn)} as a booking advance. ${fmtMoney(advLeft)} still has to be refunded.`)) : null,
      d.status === 'pending' && d._lockedBy ? h('div', { class: 'callout' }, icon('lock', 18), h('span', null, h('strong', `${d._lockedBy} has this delivery open for review. `), 'You can look at it, but it cannot be changed or approved until they close it.')) : null,
      d.status === 'pending' && ap && !d._lockedBy && held ? h('div', { class: 'callout' }, icon('lock', 18), h('span', 'You have this delivery open, so nobody else can change it until you close this screen.')) : null,
      d.status === 'pending' ? h('div', { class: 'steps' }, h('span', { class: `step ${x.customer && x.customer.status !== 'pending' ? 'done' : 'now'}` }, '1  Approve customer'), h('span', { class: `step ${d.reviewed_at ? 'done' : x.customer && x.customer.status !== 'pending' ? 'now' : ''}` }, '2  Review all details'), h('span', { class: `step ${d.reviewed_at ? 'now' : ''}` }, '3  Confirm physical delivery')) : null,
      pendingRepl ? h('div', { class: 'callout' }, icon('info', 18), h('span', null, `Vehicle replacement requested by ${whoName(pendingRepl.created_by)}: ${x.vmap.get(pendingRepl.old_vehicle_id) || 'current vehicle'} to ${x.vmap.get(pendingRepl.new_vehicle_id) || 'another vehicle'}${pendingRepl.reason ? `. Reason: ${pendingRepl.reason}` : ''}. `),
        ap ? btn('Approve', { small: true, kind: 'primary', onClick: () => approve('approve_booking_replacement', pendingRepl.id, 'vehicle replacement', 'The booking moves to the new vehicle.') }) : null,
        ap ? btn('Reject', { small: true, onClick: () => closeRepl(pendingRepl, 'reject') }) : null,
        pendingRepl.created_by === me && !ap ? btn('Withdraw', { small: true, onClick: () => closeRepl(pendingRepl, 'cancel') }) : null) : null,
      rentCmp(d, x),
      h('div', { class: 'action-bar' }, actions),
      h('div', { class: 'bento detail-bento' }, sectionBlock('Details', h('dl', { class: 'kvs' },
        d.booking_name ? kv('Booking name', d.booking_name) : null, d.booking_phone ? kv('Booking phone', fmtPhone(d.booking_phone)) : null, d.booking_place ? kv('Delivery location (booking)', d.booking_place) : null,
        !d.booking_name ? kv('Booking details (typed at booking)', d.booking_text ? h('span', { class: 'prewrap' }, d.booking_text) : null) : null,
        x.bookVeh && ['booked', 'booking_pending'].includes(d.status) ? kv('Vehicle locked for this booking', h('span', null, `${x.bookVeh.number}, ${model(x.bookVeh.model_id)?.name || ''}`, d.booking_for && d.booking_days ? h('small', { class: 'cell-note' }, `Locked ${fmtDateTimeY(d.booking_for)} to ${fmtDateTimeY(new Date(new Date(d.booking_for).getTime() + d.booking_days * 86400000))} (${d.booking_days} day${d.booking_days === 1 ? '' : 's'})`) : null)) : null,
        ['booked', 'booking_pending'].includes(d.status) && d.booking_days && !x.bookVeh ? kv('Days booked', String(d.booking_days)) : null,
        ['booked', 'booking_pending'].includes(d.status) && !d.booking_vehicle_id ? kv('Vehicle', 'Not chosen at booking, so no vehicle is locked') : null,
        d.booking_note ? kv('Remarks', d.booking_note) : null,
        kv('Customer', x.customer ? h('span', null, x.customer.name, h('small', { class: 'cell-note' }, fmtPhone(x.customer.mobile)), x.customer.status === 'pending' ? chip('Waiting for approval', 'pink') : null, btn('View customer', { small: true, ic: 'eye', onClick: () => openCustomerView(x.customer.id, { onChange: reload }) })) : null),
        ['booked', 'booking_pending'].includes(d.status) ? kv('Planned delivery', fmtDateTimeY(d.booking_for)) : null, d.booking_approved_at ? kv('Booking approved by', `${whoName(d.booking_approved_by)}, ${fmtDateTimeY(d.booking_approved_at)}`) : null,
        kv('Vehicle', x.vehicle ? `${x.vehicle.number}, ${model(x.vehicle.model_id)?.name || ''}` : null), kv('Helmets', x.helmets.length ? h('span', null, x.helmets.map(hh => chip(hh.code + (hh.returned_at ? ', returned' : ''), hh.returned_at ? 'neutral' : 'blue'))) : (['booked', 'booking_pending'].includes(d.status) ? null : 'None')),
        kv('Handed over', d.handover_mode === 'office' ? 'The customer collected it at the Office' : d.handover_mode === 'delivery' ? 'We delivered it to the customer' : null), kv('Delivered', d.delivered_at ? fmtDateTimeY(d.delivered_at) : null), kv('Handover location (GPS)', geoLine(d)), kv(d.handover_mode === 'office' ? 'Collected at' : 'Delivery location', d.delivery_place), kv('Current address', d.current_address), kv('Taken from', loc(d.from_location_id)?.name),
        d.reviewed_at ? kv('Details reviewed by', `${whoName(d.reviewed_by)}, ${fmtDateTimeY(d.reviewed_at)}`) : null,
        kv('Return due', d.return_due ? fmtDateTimeY(d.return_due) : null), kv('Days', d.days ? `${d.days}${activeExt.length ? ` + ${activeExt.reduce((a, e) => a + e.extra_days, 0)} extended` : ''}` : null),
        kv('Trip', d.trip_type === 'road' ? 'Road trip' : d.trip_type === 'local' ? 'Local trip' : null), kv('Customer preferred return', d.preferred_return_at ? fmtDateTimeY(d.preferred_return_at) : null),
        kv('Km limit', d.km_limit_per_day ? `${d.km_limit_per_day} km per day, ${fmtMoney(d.extra_km_rate)} per extra km` : null), kv('Odometer out', d.odometer_out !== null ? `${d.odometer_out} km${d.km_before_current ? ` (after swap; ${d.km_before_current} km used before)` : ''}` : null),
        kv('Added by', `${whoName(d.created_by)}, ${fmtDateTimeY(d.created_at)}`), d.approved_at ? kv('Approved by', `${whoName(d.approved_by)}, ${fmtDateTimeY(d.approved_at)}`) : null,
        d.status === 'cancelled' ? kv('Cancelled', `${d.cancel_reason} (${whoName(d.cancelled_by)})`) : null, kv('Note', d.note))),
      !['booked', 'booking_pending'].includes(d.status) ? sectionBlock('Charges', h('dl', { class: 'kvs' }, kv('Rent', d.rent_per_day != null ? `${fmtMoney(d.rent)} (${fmtMoney(d.rent_per_day)} per day x ${d.days})` : fmtMoney(d.rent)), kv('Deposit', fmtMoney(d.deposit)), kv('Delivery charges', fmtMoney(d.delivery_charges)), kv('Advance pickup charges', fmtMoney(d.advance_pickup_charges))), billBox) : null,
      !['booking_pending', 'booked', 'cancelled'].includes(d.status) && x.money.length ? sectionBlock('Payment summary (as per record, against received)', summaryTable({ ...deliverySummary(d, { money: x.money, extensions: x.extensions, pickup: live || null }) })) : null,
      sectionBlock(`Payments (${x.money.length})`, x.money.length ? h('ul', { class: 'pay-list' }, x.money.map(m => payRow(m, d))) : h('p', { class: 'muted' }, 'No payments yet.')),
      x.extensions.length ? sectionBlock('Extensions', h('ul', { class: 'pay-list' }, x.extensions.map(e => h('li', { class: 'pay-row' }, h('div', null, h('strong', `Until ${fmtDateTime(e.new_return_due)}: ${fmtMoney(e.amount)} flat`),
        h('small', `Was due ${fmtDateTime(e.old_return_due)}, +${e.extra_days} day${e.extra_days === 1 ? '' : 's'}. Added by ${whoName(e.created_by)}.${e.status === 'pending' ? ' Takes effect when approved.' : ''}${e.note ? ' ' + e.note : ''}`)),
        h('div', { class: 'pay-act' }, e.status === 'approved' ? statusBadge('active', 'Approved') : e.status === 'cancelled' ? chip('Cancelled', 'neutral') : chip('Waiting for approval', 'blue'),
          e.status === 'pending' && ap ? btn('Approve', { small: true, kind: 'primary', onClick: () => approve('approve_extension', e.id, 'extension', 'The new return date takes effect.') }) : null,
          e.status === 'pending' && (e.created_by === me || ap) || (e.status === 'approved' && can.manager() && d.status === 'active') ? btn('Cancel', { small: true, onClick: () => cancelExt(e) }) : null))))) : null,
      x.swaps.length ? sectionBlock('Swaps', h('ul', { class: 'pay-list' }, x.swaps.map(w => swapRow(w, d, x)))) : null,
      x.pickups.length ? sectionBlock('Pickup', h('ul', { class: 'pay-list' }, x.pickups.map(k => h('li', { class: 'pay-row stacked' }, h('div', { class: 'pay-row-top' }, h('div', null, h('strong', `Picked up at ${k.return_place || loc(k.return_location_id)?.name || ''}, ${fmtDateTime(k.returned_at)}`),
        h('small', `${k.km_used} km used, ${k.allowed_km} km allowed over ${k.rental_days} days. ${k.extra_km} km extra = ${fmtMoney(k.extra_km_charge)}${k.other_charges_amount > 0 ? `. ${k.other_charges_text || 'Other'}: ${fmtMoney(k.other_charges_amount)}` : ''}.${k.condition_note ? ' ' + k.condition_note : ''}`), h('small', `By ${whoName(k.created_by)}${k.handover_mode ? (k.handover_mode === 'office' ? '. The customer brought it to the Office' : '. We picked it up from the customer') : ''}`), k.geo_lat != null ? h('small', null, 'Location (GPS): ', geoLine(k)) : null),
        h('div', { class: 'pay-act' }, k.status === 'approved' ? statusBadge('active', 'Approved') : k.status === 'cancelled' ? chip('Cancelled', 'neutral') : chip('Waiting for approval', 'blue'))),
        compareSlider(d.photo_set, k.photo_set || legacySet(k.photos), { title: 'Photos: handover and return', oldTitle: 'At handover', newTitle: 'At return' }))))) : null,
      dPhotoSet ? sectionBlock('Photos at handover', dPhotoSet) : null));
    s.body.querySelectorAll('.detail-bento > .form-section').forEach(sec => { if (/^(Payment summary|Payments|Extensions|Swaps|Pickup|Photos)/.test(sec.querySelector('h3')?.textContent || '')) sec.classList.add('span2'); });
    hydrateTiles(s.body, d.code);
    mount(s.foot, ...(primary.length ? primary : [btn('Close', { onClick: () => s.close() })]));
  }
  const who_ = (id) => state.profileMap.get(id)?.user_name || 'the cash holder';
  const row = (k, v, cls = '') => h('div', { class: `bill-row ${cls}` }, h('span', k), h('strong', fmtMoney(v)));

  // Find every proof / receipt photo stored on a money record, whatever the column is called.
  const PROOF_KEY = /receipt|proof|photo|image|attach/i, PATHLIKE = /\/|\.(jpe?g|png|webp|heic|gif|pdf)$/i;
  function proofPaths(m) {
    const out = [];
    const add = (p) => { if (typeof p === 'string' && PATHLIKE.test(p.trim())) out.push(p.trim()); };
    const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); else add(v); };
    for (const [k, v] of Object.entries(m)) if (PROOF_KEY.test(k) && v) walk(v);
    return [...new Set(out)];
  }
  let payRows = [];
  function groupTotal(m) {
    if (!m.pay_group) return null; const g = payRows.filter(r => r.pay_group === m.pay_group && r.status !== 'void'); if (g.length < 2) return null;
    return { total: g.reduce((a, r) => a + Number(r.amount), 0), n: g.length, heads: g.map(r => `${r.purpose} ${fmtMoney(r.amount)}`).join(', ') };
  }
  function payRow(m, cur) {
    const me = state.me.id; const proofs = proofPaths(m);
    const kvp = (k, v) => (v ? h('div', { class: 'kv' }, h('dt', k), h('dd', v)) : null);
    const stamp = (by, at) => (by || at ? `${by ? whoName(by) : ''}${at ? `${by ? ', ' : ''}${fmtDateTimeY(at)}` : ''}` : null);
    const details = h('div', { class: 'swap-details' },
      h('dl', { class: 'kvs' },
        kvp('Purpose', m.purpose), kvp('Type', m.entry_type), kvp('Paid by / mode', m.via), kvp('Amount', fmtMoney(m.amount)),
        kvp('Cash held by', m.cash_user ? who_(m.cash_user) : null), kvp('Transaction ID / UTR', m.txn_ref), kvp('Paid into / note', m.via_note || m.reference || m.ref_no || m.note),
        groupTotal(m) ? kvp('Part of one payment', `${fmtMoney(groupTotal(m).total)} paid once, split over ${groupTotal(m).n} charges (${groupTotal(m).heads})`) : null,
        kvp('Payment date', m.paid_on ? fmtDateTimeY(m.paid_on) : null), kvp('Entered in the system', fmtDateTimeY(m.created_at)),
        kvp('Added by', stamp(m.created_by, m.created_at)),
        kvp('Acknowledged by', stamp(m.acknowledged_by, m.acknowledged_at)),
        kvp('Approved by', stamp(m.approved_by, m.approved_at)),
        kvp('Disputed', m.dispute_reason), kvp('Voided', m.void_reason ? `${m.void_reason}${m.voided_by ? ` (${whoName(m.voided_by)})` : ''}` : null)),
      proofs.length
        ? h('div', { class: 'swap-photos' }, h('strong', 'Proof attached'), h('div', { class: 'photo-multi viewer' }, proofs.map((path, i) =>
            h('div', { class: 'tile filled', dataset: { path, cap: `Payment proof ${i + 1}` } }, icon('image', 22), h('span', { class: 'thumb-label' }, `Proof ${i + 1}`)))))
        : (m.via && m.via !== 'Cash' ? h('p', { class: 'muted small' }, 'No proof photo is attached to this payment.') : null));
    queueMicrotask(() => hydrateTiles(details, `${cur.code} payment`));
    return h('li', { class: `pay-row stacked ${m.status === 'void' ? 'is-void' : ''}` }, h('div', { class: 'pay-row-top' },
      h('div', null, h('strong', `${m.purpose}`), h('small', `${m.entry_type}, ${m.via}${m.cash_user ? `, cash held by ${who_(m.cash_user)}` : ''}. Added by ${whoName(m.created_by)} on ${fmtDateTime(m.created_at)}.${m.dispute_reason ? ' Dispute: ' + m.dispute_reason : ''}${m.void_reason ? ' Void: ' + m.void_reason : ''}`)),
      h('div', { class: 'pay-act' }, h('span', { class: `amt ${m.entry_type === 'Expense' ? 'neg' : ''}` }, signed(m)), moneyChip(m),
        m.status === 'pending_ack' && m.cash_user === me ? [btn('Acknowledge', { small: true, kind: 'primary', onClick: () => acknowledgeMoney(m, reload) }), btn('Dispute', { small: true, onClick: () => disputeMoney(m, reload) })] : null,
        m.status === 'pending' && m.ref_kind === 'delivery' && can.approve() && cur.status !== 'pending' ? btn('Approve', { small: true, kind: 'primary', onClick: () => approveMoney(m, reload) }) : null,
        m.status !== 'void' && can.manager() ? btn('Void', { small: true, onClick: () => voidMoney(m, reload) }) : null)),
      details);
  }
  function swapRow(w, d, x) {
    const me = state.me.id; const label = { assigned: 'Assigned', done: w.reviewed_at ? 'Reviewed, waiting for your confirmation' : 'Done, waiting for review', approved: 'Approved', cancelled: 'Cancelled' }[w.status];
    const hasData = !!w.new_vehicle_id;
    const details = (w.status === 'assigned' || !hasData) ? null : h('div', { class: 'swap-details' },
      h('dl', { class: 'kvs' },
        h('div', { class: 'kv' }, h('dt', 'Swap location'), h('dd', `${w.swap_place || ''}${w.handover_mode ? (w.handover_mode === 'office' ? ' (customer came to the Office)' : ' (we went to the customer)') : ''}`)), w.geo_lat != null ? h('div', { class: 'kv' }, h('dt', 'Location (GPS)'), h('dd', geoLine(w))) : null, h('div', { class: 'kv' }, h('dt', 'Current address'), h('dd', { class: 'prewrap' }, w.current_address || '')),
        h('div', { class: 'kv' }, h('dt', 'Old vehicle'), h('dd', `${x.vmap.get(w.old_vehicle_id) || ''}, reading ${w.odometer_in_old} km`)), h('div', { class: 'kv' }, h('dt', 'New vehicle'), h('dd', `${x.vmap.get(w.new_vehicle_id) || ''}, reading ${w.odometer_out_new} km`)),
        w.note ? h('div', { class: 'kv' }, h('dt', 'Note'), h('dd', w.note)) : null,
        w.reviewed_at ? h('div', { class: 'kv' }, h('dt', 'Reviewed by'), h('dd', `${whoName(w.reviewed_by)}, ${fmtDateTimeY(w.reviewed_at)}`)) : null),
      compareSlider(d.photo_set, w.photos_old, { title: 'Old bike: handover and received back', oldTitle: 'At handover', newTitle: 'Received back' }), photoSlider(w.photos_new, 'New bike given'));
    if (details) queueMicrotask(() => hydrateTiles(details, d.code));
    return h('li', { class: 'pay-row stacked' }, h('div', { class: 'pay-row-top' }, h('div', null, h('strong', w.status === 'assigned' ? `To be done by ${who_(w.assigned_to)}` : !hasData ? `Swap cancelled (was to be done by ${who_(w.assigned_to)})` : `${x.vmap.get(w.old_vehicle_id) || ''} replaced by ${x.vmap.get(w.new_vehicle_id) || ''}`),
      h('small', `Assigned by ${whoName(w.assigned_by)}${w.reason ? `. ${w.reason}` : ''}${w.done_by ? `. Done by ${whoName(w.done_by)}` : ''}`), w.planned_vehicle_id && w.status === 'assigned' ? h('small', null, `Vehicle to give: ${x.vmap.get(w.planned_vehicle_id) || ''}`) : null),
      h('div', { class: 'pay-act' }, chip(label, w.status === 'approved' || w.status === 'cancelled' ? 'neutral' : 'blue'),
        w.status === 'assigned' && can.assignSwap() ? btn('Change vehicle', { small: true, onClick: () => openChangeSwapVehicle({ swap: w, delivery: d, onDone: reload }) }) : null,
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
  // The rent charged against the rate in the master, per day and in total.
  function rentCmp(d, x) {
    if (d.rent_per_day == null || d.master_rent_per_day == null || ['booked', 'booking_pending', 'cancelled'].includes(d.status)) return null;
    const diff = Number(d.rent_per_day) - Number(d.master_rent_per_day); if (Math.abs(diff) < 0.005) return null;
    const total = diff * Number(d.days || 0);
    return h('div', { class: 'callout' }, icon('alert', 18), h('span', null,
      h('strong', 'Rent was changed for this delivery. '), `Master rate ${fmtMoney(d.master_rent_per_day)} per day, charged ${fmtMoney(d.rent_per_day)} per day (${diff > 0 ? '+' : '-'}${fmtMoney(Math.abs(diff))} per day). `,
      `Over ${d.days} day${d.days === 1 ? '' : 's'}: master ${fmtMoney(Number(d.master_rent_per_day) * Number(d.days))}, charged ${fmtMoney(d.rent)}, ${total > 0 ? 'more' : 'less'} by ${fmtMoney(Math.abs(total))}.`));
  }
  const closeRepl = (r, action) => confirmDialog({ title: action === 'reject' ? 'Reject this request?' : 'Withdraw this request?', message: 'The booking keeps its current vehicle.', confirmLabel: action === 'reject' ? 'Reject' : 'Withdraw' }).then(async (ok) => { if (!ok) return;
    try { await rpc('close_booking_replacement', { p_id: r.id, p_action: action, p_note: null }); toast('Done'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } });
  function editBooking(d) { openBookingForm({ booking: d, onDone: reload }); }
  const cancelExt = (e) => confirmDialog({ title: 'Cancel this extension?', message: 'The return date goes back and its payments are voided.', confirmLabel: 'Cancel extension', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_extension', { p_id: e.id, p_reason: r.text }); toast('Extension cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  const cancelSwap = (w) => confirmDialog({ title: 'Cancel this swap?', confirmLabel: 'Cancel swap', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_swap', { p_id: w.id, p_reason: r.text }); toast('Swap cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  const cancelPickup = (k) => confirmDialog({ title: 'Cancel this pickup?', message: 'The vehicle and helmets go back to the customer on record and the pickup payments are voided.', confirmLabel: 'Cancel pickup', danger: true, reason: { label: 'Reason', required: true } })
    .then(async (r) => { if (!r) return; try { await rpc('cancel_pickup', { p_id: k.id, p_reason: r.text }); toast('Pickup cancelled'); await reload(); } catch (er) { toast(friendlyError(er), 'error'); } });
  const approveCustomer = (c) => confirmDialog({ title: `Approve ${c.name}?`, message: 'Check the customer\'s photos and details first (open the Customers page to see them). Once approved, this customer can rent vehicles and the delivery can be reviewed.', confirmLabel: 'Approve customer' }).then(async (r) => { if (!r) return;
    try { const { error } = await sb.from('customers').update({ status: 'active' }).eq('id', c.id); if (error) throw error; toast('Customer approved. Now review the delivery.'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } });
  await paint();
  return s;
}
