// Reports (Manager, Admin, Superadmin): download detailed data as one Excel file, with a date filter.
// Put this file in: assets/js/views/reports.js
import { h, btn, busy, field, input, select, toast, mount, emptyState, friendlyError } from '../core/ui.js';
import { sb, rpc, fetchAll } from '../core/supa.js';
import { can, whoName, loc, model } from '../core/store.js';
import { saveXlsx } from '../core/xlsx.js';
import { slabsOf, extraKmKey, TRIPS } from '../core/masters.js';

const IST = 5.5 * 3600e3;
const istDay = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
const startOf = (d) => `${d}T00:00:00+05:30`;
const endOf = (d) => new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86400e3).toISOString();   // exclusive end
const N = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const who = (id) => (id ? whoName(id) : '');
const place = (id) => (id ? loc(id)?.name || '' : '');
const TRIPNAME = { local: 'Local trip', road: 'Road trip' };

// Each report: the date fields it can be filtered by (first is the default), or none for a "right now" list.
const REPORTS = [
  { id: 'deliveries', label: 'Deliveries and bookings', note: 'Every delivery with customer, vehicle, rent, charges, extensions and what was received.', dates: [['created_at', 'Created on'], ['delivered_at', 'Delivered on'], ['return_due', 'Return due on'], ['booking_for', 'Booking date']] },
  { id: 'payments', label: 'Payments (money in and out)', note: 'Every money entry with mode, UTR, who holds the cash and its status.', dates: [['paid_on', 'Payment date'], ['created_at', 'Entered on']] },
  { id: 'pickups', label: 'Pickups', note: 'Returns with km used, extra km and other charges.', dates: [['returned_at', 'Returned on'], ['created_at', 'Entered on']] },
  { id: 'swaps', label: 'Vehicle swaps', note: 'Old and new vehicle, odometer and reason.', dates: [['done_at', 'Swapped on'], ['created_at', 'Requested on']] },
  { id: 'extensions', label: 'Extensions', note: 'Extra days, rent and new return time.', dates: [['created_at', 'Entered on']] },
  { id: 'customers', label: 'Customers', note: 'Customer list with contacts and status.', dates: [['created_at', 'Added on']] },
  { id: 'vehicles', label: 'Vehicles (as of now)', note: 'All vehicles with details, rates, insurance and where they are now.', dates: null },
  { id: 'helmets', label: 'Helmets (as of now)', note: 'All helmets with where they are now.', dates: null },
  { id: 'vlogs', label: 'Vehicle movement history', note: 'Every vehicle status change.', dates: [['created_at', 'Date']] },
  { id: 'hlogs', label: 'Helmet movement history', note: 'Every helmet status change.', dates: [['created_at', 'Date']] },
  { id: 'cash', label: 'Cash day table (Admin only)', note: 'Each person\'s opening, in, out, handed over and closing cash per day (up to 400 days).', dates: [['day', 'Day']], admin: true, forceDate: true },
];

export async function render(root) {
  if (!can.manager()) return mount(root, emptyState('Reports are for Managers and above', 'Only a Manager, Admin or Superadmin can open this page.'));
  const today = istDay();
  const from = input({ type: 'date', value: today.slice(0, 8) + '01', 'aria-label': 'From day' }), to = input({ type: 'date', value: today, 'aria-label': 'To day' });
  const avail = REPORTS.filter(r => !r.admin || can.admin());
  const on = new Map(avail.map(r => [r.id, r.id === 'deliveries' || r.id === 'payments']));
  const dateBy = new Map(avail.map(r => [r.id, r.dates?.[0]?.[0] || null]));
  const status = h('p', { class: 'muted', 'aria-live': 'polite' });
  const quick = (label, fn) => btn(label, { size: 'sm', onClick: () => { const [a, b] = fn(); from.value = a; to.value = b; } });
  const ym = (d) => d.slice(0, 7);
  const list = h('div', { class: 'report-list' }, avail.map(r => {
    const box = h('input', { type: 'checkbox', id: `rp-${r.id}`, on: { change: () => on.set(r.id, box.checked) } }); box.checked = on.get(r.id);
    const by = r.dates && r.dates.length > 1 ? select(r.dates.map(([v, l]) => ({ value: v, label: `by ${l}` })), { 'aria-label': `Filter ${r.label} by`, on: { change: (e) => dateBy.set(r.id, e.target.value) } }) : null;
    return h('div', { class: 'card', style: 'display:flex;gap:.75rem;align-items:flex-start;padding:.8rem;margin:.5rem 0' }, box,
      h('label', { for: `rp-${r.id}`, style: 'flex:1' }, h('strong', r.label), h('small', { style: 'display:block;opacity:.75' }, r.note + (r.dates ? '' : ' Not filtered by date.'))), by);
  }));

  async function build() {
    const a = from.value, b = to.value; if (!a || !b) return toast('Choose both days.', 'error'); if (b < a) return toast('The last day must not be before the first day.', 'error');
    const picked = avail.filter(r => on.get(r.id)); if (!picked.length) return toast('Tick at least one report.', 'error');
    const lo = startOf(a), hi = endOf(b);
    const rng = (q, col) => (col === 'paid_on' || col === 'created_at' || col === 'delivered_at' || col === 'return_due' || col === 'booking_for' || col === 'returned_at' || col === 'done_at') ? q.gte(col, lo).lt(col, hi) : q;
    const get = (table, col, order = 'id') => fetchAll(() => { let q = sb.from(table).select('*').order(order, { ascending: true }); if (col) q = rng(q, col); return q; });
    const need = (id) => picked.some(r => r.id === id);
    status.textContent = 'Collecting the data…';
    // lookups used by several sheets
    const [custs, vehs, dels] = await Promise.all([get('customers'), get('vehicles'), get('deliveries')]);
    const C = new Map(custs.map(c => [c.id, c])), V = new Map(vehs.map(v => [v.id, v])), D = new Map(dels.map(d => [d.id, d]));
    const vnum = (id) => V.get(id)?.number || '', mname = (id) => model(id)?.name || '';
    const state_ = (o) => [o.current_state, o.current_location_id ? place(o.current_location_id) : o.current_location_text].filter(Boolean).join(' – ');
    const sheets = []; const counts = [];
    const money = (rows) => rows.filter(m => m.status !== 'void');
    let allMoney = null; const moneyAll = async () => (allMoney ||= await get('money_entries'));
    const T = { text: 'text', int: 'int', money: 'money', dt: 'dt', date: 'date' };
    const col = (h_, t, get_, w) => ({ h: h_, t, get: get_, w });

    for (const r of picked) {
      const before = sheets.length;
      status.textContent = `Preparing “${r.label}”…`;
      const by = dateBy.get(r.id);
      if (r.id === 'deliveries') {
        const rows = (await get('deliveries', by)); const mm = await moneyAll(); const ext = await get('extensions');
        const recv = new Map(), refund = new Map(), extAmt = new Map();
        for (const m of money(mm)) if (m.delivery_id) { const t = m.entry_type === 'Income' ? recv : refund; t.set(m.delivery_id, (t.get(m.delivery_id) || 0) + Number(m.amount || 0)); }
        for (const e of ext) if (!['cancelled', 'rejected'].includes(e.status)) extAmt.set(e.delivery_id, (extAmt.get(e.delivery_id) || 0) + Number(e.amount || 0));
        sheets.push({ name: 'Deliveries', rows, cols: [
          col('Delivery no.', T.text, d => d.code, 12), col('Status', T.text, d => d.status), col('Created on', T.dt, d => d.created_at), col('Created by', T.text, d => who(d.created_by), 24),
          col('Customer', T.text, d => C.get(d.customer_id)?.name || d.booking_name || d.booking_text, 24), col('Mobile', T.text, d => C.get(d.customer_id)?.mobile || d.booking_phone),
          col('Vehicle', T.text, d => vnum(d.vehicle_id || d.booking_vehicle_id)), col('Model', T.text, d => mname(d.model_id || V.get(d.vehicle_id || d.booking_vehicle_id)?.model_id)),
          col('Trip', T.text, d => TRIPNAME[d.trip_type] || ''), col('Booking date', T.dt, d => d.booking_for), col('Booked days', T.int, d => d.booking_days),
          col('Delivered on', T.dt, d => d.delivered_at), col('Delivery place', T.text, d => d.delivery_place, 22), col('From location', T.text, d => place(d.from_location_id)),
          col('Days', T.int, d => d.days), col('Return due', T.dt, d => d.return_due), col('Closed on', T.dt, d => d.closed_at),
          col('Rent per day charged', T.money, d => N(d.rent_per_day)), col('Rent per day (vehicle master)', T.money, d => N(d.master_rent_per_day)), col('Rent', T.money, d => N(d.rent)), col('Deposit', T.money, d => N(d.deposit)), col('Delivery charges', T.money, d => N(d.delivery_charges)),
          col('Advance pickup charges', T.money, d => N(d.advance_pickup_charges)), col('Other charges', T.money, d => N(d.other_charges_amount)), col('Other charges note', T.text, d => d.other_charges_text),
          col('Total amount', T.money, d => N(d.total_amount)), col('Extension amount', T.money, d => extAmt.get(d.id)),
          col('Received (all payments)', T.money, d => recv.get(d.id) || 0), col('Refunded', T.money, d => refund.get(d.id) || 0),
          col('KM limit per day', T.int, d => N(d.km_limit_per_day)), col('Extra KM rate', T.money, d => N(d.extra_km_rate)), col('Odometer out', T.int, d => N(d.odometer_out)),
          col('Approved by', T.text, d => who(d.approved_by), 24), col('Approved on', T.dt, d => d.approved_at), col('Note', T.text, d => d.note, 30)] });
      } else if (r.id === 'payments') {
        const rows = await get('money_entries', by); const delC = (m) => D.get(m.delivery_id)?.code || '';
        sheets.push({ name: 'Payments', rows, cols: [
          col('Entry no.', T.text, m => m.code, 12), col('Entered on', T.dt, m => m.created_at), col('Payment date', T.dt, m => m.paid_on || m.created_at), col('Entered by', T.text, m => who(m.created_by), 24),
          col('Type', T.text, m => m.entry_type), col('Purpose', T.text, m => m.purpose, 22), col('Amount', T.money, m => N(m.amount)), col('Mode', T.text, m => m.via), col('UTR / transaction id', T.text, m => m.txn_ref, 22), col('Mode note', T.text, m => m.via_note),
          col('Delivery', T.text, delC), col('Customer', T.text, m => C.get(D.get(m.delivery_id)?.customer_id)?.name || D.get(m.delivery_id)?.booking_name || '', 24),
          col('Cash held by', T.text, m => who(m.cash_user), 24), col('Status', T.text, m => m.status), col('Acknowledged by', T.text, m => who(m.ack_by), 24), col('Acknowledged on', T.dt, m => m.ack_at),
          col('Approved by', T.text, m => who(m.approved_by), 24), col('Voided', T.text, m => (m.void_at ? `Yes – ${m.void_reason || ''}` : '')), col('Dispute reason', T.text, m => m.dispute_reason),
          col('Finance status', T.text, m => m.fin_status), col('Finance reviewed by', T.text, m => who(m.fin_by), 24), col('Finance note', T.text, m => m.fin_note), col('Payment group', T.text, m => m.pay_group, 14)] });
      } else if (r.id === 'pickups') {
        const rows = await get('pickups', by);
        sheets.push({ name: 'Pickups', rows, cols: [
          col('Delivery', T.text, p => D.get(p.delivery_id)?.code || ''), col('Customer', T.text, p => C.get(D.get(p.delivery_id)?.customer_id)?.name, 24), col('Vehicle', T.text, p => vnum(D.get(p.delivery_id)?.vehicle_id)),
          col('Returned on', T.dt, p => p.returned_at), col('Return location', T.text, p => place(p.return_location_id)), col('Return place', T.text, p => p.return_place),
          col('Odometer in', T.int, p => N(p.odometer_in)), col('KM used', T.int, p => N(p.km_used)), col('Rental days', T.int, p => N(p.rental_days)), col('Allowed KM', T.int, p => N(p.allowed_km)),
          col('Extra KM', T.int, p => N(p.extra_km)), col('Extra KM charge', T.money, p => N(p.extra_km_charge)), col('Other charges', T.money, p => N(p.other_charges_amount)), col('Other charges note', T.text, p => p.other_charges_text),
          col('Condition note', T.text, p => p.condition_note, 30), col('Status', T.text, p => p.status), col('Entered by', T.text, p => who(p.created_by), 24), col('Approved by', T.text, p => who(p.approved_by), 24), col('Approved on', T.dt, p => p.approved_at)] });
      } else if (r.id === 'swaps') {
        const rows = await get('swaps', by);
        sheets.push({ name: 'Swaps', rows, cols: [
          col('Delivery', T.text, s => D.get(s.delivery_id)?.code || ''), col('Customer', T.text, s => C.get(D.get(s.delivery_id)?.customer_id)?.name, 24), col('Requested on', T.dt, s => s.created_at), col('Swapped on', T.dt, s => s.done_at),
          col('Old vehicle', T.text, s => vnum(s.old_vehicle_id)), col('New vehicle', T.text, s => vnum(s.new_vehicle_id)), col('Odometer (old)', T.int, s => N(s.odometer_in_old)), col('Odometer (new)', T.int, s => N(s.odometer_out_new)),
          col('Swap place', T.text, s => s.swap_place), col('Old vehicle went to', T.text, s => place(s.old_return_location)), col('Reason', T.text, s => s.reason, 30), col('Status', T.text, s => s.status),
          col('Assigned to', T.text, s => who(s.assigned_to), 24), col('Done by', T.text, s => who(s.done_by), 24), col('Approved by', T.text, s => who(s.approved_by), 24)] });
      } else if (r.id === 'extensions') {
        const rows = await get('extensions', by);
        sheets.push({ name: 'Extensions', rows, cols: [
          col('Delivery', T.text, e => D.get(e.delivery_id)?.code || ''), col('Customer', T.text, e => C.get(D.get(e.delivery_id)?.customer_id)?.name, 24), col('Entered on', T.dt, e => e.created_at),
          col('Extra days', T.int, e => N(e.extra_days)), col('Rent per day', T.money, e => N(e.rent_per_day)), col('Amount', T.money, e => N(e.amount)), col('Old return due', T.dt, e => e.old_return_due), col('New return due', T.dt, e => e.new_return_due),
          col('Status', T.text, e => e.status), col('Entered by', T.text, e => who(e.created_by), 24), col('Approved by', T.text, e => who(e.approved_by), 24), col('Note', T.text, e => e.note, 30)] });
      } else if (r.id === 'customers') {
        const rows = custs.filter(c => c.created_at >= lo && c.created_at < hi);
        sheets.push({ name: 'Customers', rows, cols: [
          col('Name', T.text, c => c.name, 26), col('Mobile', T.text, c => c.mobile), col('Second mobile', T.text, c => c.mobile2), col('Type', T.text, c => c.customer_type), col('Nationality', T.text, c => c.nationality),
          col('Address', T.text, c => c.permanent_address, 36), col('Emergency contact', T.text, c => c.emergency_name, 22), col('Emergency number', T.text, c => c.emergency_number1), col('Status', T.text, c => c.status),
          col('Added on', T.dt, c => c.created_at), col('Added by', T.text, c => who(c.created_by), 24), col('Approved by', T.text, c => who(c.approved_by), 24), col('Remarks', T.text, c => c.remarks, 30)] });
      } else if (r.id === 'vehicles') {
        const rates = TRIPS.flatMap(t => [[`${t.label} — Extra KM`, extraKmKey(t.value)], ...slabsOf(t.value).map(s => [`${t.label} — ${s.label}`, s.key])]);
        sheets.push({ name: 'Vehicles', rows: vehs, cols: [
          col('Vehicle number', T.text, v => v.number, 16), col('Model', T.text, v => mname(v.model_id)), col('Brand', T.text, v => v.brand), col('Type', T.text, v => v.vehicle_type), col('CC', T.int, v => N(v.cc)), col('Year', T.int, v => N(v.year)), col('Colour', T.text, v => v.color),
          col('Status', T.text, v => v.status), col('Now', T.text, state_, 30), col('Insurance ends', T.date, v => v.insurance_end), col('Vehicle owner', T.text, v => v.owner_name), col('Insurance owner', T.text, v => v.insurance_owner),
          ...rates.map(([hd, k]) => col(hd, T.money, v => N(v[k]))), col('Added on', T.dt, v => v.created_at), col('Remarks', T.text, v => v.remarks, 30)] });
      } else if (r.id === 'helmets') {
        const rows = await get('helmets');
        sheets.push({ name: 'Helmets', rows, cols: [col('Helmet', T.text, x => x.code), col('Type', T.text, x => x.helmet_type), col('Status', T.text, x => x.status), col('Now', T.text, state_, 30), col('Added on', T.dt, x => x.created_at), col('Remarks', T.text, x => x.remarks, 30)] });
      } else if (r.id === 'vlogs' || r.id === 'hlogs') {
        const v = r.id === 'vlogs'; const rows = await get(v ? 'vehicle_logs' : 'helmet_logs', by); const H = v ? null : new Map((await get('helmets')).map(x => [x.id, x]));
        sheets.push({ name: v ? 'Vehicle history' : 'Helmet history', rows, cols: [
          col('When', T.dt, l => l.created_at), col(v ? 'Vehicle' : 'Helmet', T.text, l => (v ? vnum(l.vehicle_id) : H.get(l.helmet_id)?.code || '')), col('Event', T.text, l => l.event, 22),
          col('From', T.text, l => [l.from_state, l.from_location_id ? place(l.from_location_id) : l.from_location_text].filter(Boolean).join(' – '), 28), col('To', T.text, l => [l.state, l.location_id ? place(l.location_id) : l.location_text].filter(Boolean).join(' – '), 28),
          col('By', T.text, l => who(l.by_user), 24), col('Linked to', T.text, l => (l.ref_type === 'delivery' ? D.get(l.ref_id)?.code || '' : l.ref_type || '')), col('Note', T.text, l => l.note, 30)] });
      } else if (r.id === 'cash') {
        const days = (await rpc('finance_day_table', { p_from: a, p_to: b })) || [];
        sheets.push({ name: 'Cash day table', rows: days, cols: [
          col('Day', T.date, x => x.day), col('Person', T.text, x => who(x.uid), 26), col('Opening cash', T.money, x => N(x.opening)), col('Cash in', T.money, x => N(x.cash_income)), col('Cash out', T.money, x => N(x.cash_expense)),
          col('Handed over', T.money, x => N(x.handed_over)), col('Received', T.money, x => N(x.received)), col('Closing cash', T.money, x => N(x.closing)), col('Non-cash in', T.money, x => N(x.noncash_income)), col('Non-cash out', T.money, x => N(x.noncash_expense)), col('Entries', T.int, x => N(x.entries))] });
      }
      const sh = sheets[before]; if (sh) counts.push([r.label, `${r.dates ? 'filtered by ' + (r.dates.find(d => d[0] === dateBy.get(r.id))?.[1] || '') : 'all records, as of now'} — ${sh.rows.length} rows`]);
    }
    const info = { name: 'About this file', rows: [['Period', `${a} to ${b} (India dates)`], ['Downloaded on', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })], ...counts], cols: [col('Item', T.text, x => x[0], 26), col('Detail', T.text, x => x[1], 60)] };
    return { sheets: [info, ...sheets], a, b };
  }

  const go = btn('Download Excel file', { kind: 'primary', ic: 'download', onClick: (e) => busy(e.currentTarget, async () => {
    try { const { sheets, a, b } = await build(); status.textContent = 'Creating the file…'; await saveXlsx(sheets, `sfa-report-${a}-to-${b}.xlsx`); status.textContent = `Done. ${sheets.length - 1} sheet(s) downloaded.`; toast('Report downloaded', 'success'); }
    catch (err) { status.textContent = ''; toast(friendlyError(err), 'error'); }
  }) });
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Reports'), h('p', { class: 'muted' }, 'Download detailed data as an Excel file. Each ticked report becomes one sheet, ready to filter and sort in Excel.'))),
    h('div', { class: 'card', style: 'padding:1rem' },
      h('div', { style: 'display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end' }, field('From day', from), field('To day', to),
        quick('This month', () => [today.slice(0, 8) + '01', today]), quick('Last 7 days', () => [istDay(Date.now() - 6 * 86400e3), today]),
        quick('Last month', () => { const d = new Date(`${today.slice(0, 8)}01T12:00:00Z`); d.setUTCDate(0); const e = d.toISOString().slice(0, 10); return [e.slice(0, 8) + '01', e]; }),
        quick('This year', () => [`${today.slice(0, 4)}-01-01`, today])),
      h('p', { class: 'muted' }, 'The days are India days. Reports marked “as of now” list everything and ignore the days.')),
    list, h('div', { style: 'margin:1rem 0' }, go), status);
}
