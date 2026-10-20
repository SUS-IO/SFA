// Forms for everything that happens to a delivery.
import { h, icon, btn, busy, field, input, textarea, select, segmented, sectionBlock, openSheet, toast, mount, friendlyError, fmtMoney, num, localInputValue, isoFromLocal, fmtDateTimeY, debounce } from '../core/ui.js';
import { rpc, sb, fetchAll } from '../core/supa.js';
import { state, activeLocations, whoName, loc, can, model, placeOf } from '../core/store.js';
import { phoneField } from '../core/phone.js';
import { TRIPS, rateFor, extraKmFor } from '../core/masters.js';
import { paymentsEditor, userOptions, VIAS } from '../core/payments.js';
import { categoriesFor, subCategoriesOf } from '../core/settings.js';
import { customerPicker, vehiclePicker, helmetChips, readyHelmets, conflictText } from '../core/pickers.js';
export { conflictText };
import { multiPhotoField, photoField, photoPath, uploadPhoto } from '../core/images.js';

const MONEY = /^\d+(\.\d{1,2})?$/;
const KM_LIMITS = [100, 150, 200, 250, 300, 400, 500];
const folderId = () => Math.random().toString(36).slice(2, 10);
const moneyInput = (ph = '0') => input({ inputmode: 'decimal', placeholder: ph });
const wholeInput = (ph = '') => input({ inputmode: 'numeric', placeholder: ph });
const submitBtn = (label, formId) => { const b = btn(label, { kind: 'primary', type: 'submit' }); b.setAttribute('form', formId); return b; };
async function uploadAll(photoFld, folder, tag) {
  const out = [];
  for (const it of photoFld.newItems()) out.push(await uploadPhoto(photoPath(folder, tag, it.type), it.blob));
  return out;
}
const checkMoney = (f, inp, { required = false } = {}) => {
  const v = inp.value.trim().replace(/,/g, '');
  if (!v) { if (required) { f.setError('Enter an amount.'); return false; } return true; }
  if (!MONEY.test(v)) { f.setError('Use numbers only, for example 1500 or 1500.50.'); return false; }
  return true;
};
const checkWhole = (f, inp, { min = 0, label = 'a whole number' } = {}) => {
  const v = inp.value.trim();
  if (!/^\d{1,9}$/.test(v) || Number(v) < min) { f.setError(min ? `Enter ${label} of ${min} or more.` : `Enter ${label}.`); return false; }
  return true;
};
function kmLimitField() {
  const sel = select([{ value: '', label: 'Choose' }, ...KM_LIMITS.map(k => ({ value: String(k), label: `${k} km per day` })), { value: 'more', label: 'More than 500' }]);
  const other = wholeInput('Km per day'); other.hidden = true;
  const f = field('Km limit per day', h('div', { class: 'stack-sm' }, sel, other), { required: true, hint: 'The most the customer may ride each day. 100 or more.' });
  sel.addEventListener('change', () => { other.hidden = sel.value !== 'more'; f.setError(''); });
  return { el: f, value: () => (sel.value === 'more' ? other.value.trim() : sel.value),
    validate() { const v = this.value(); if (!/^\d+$/.test(v) || Number(v) < 100) { f.setError('Choose the km limit, 100 or more.'); return false; } return true; } };
}

const SET_SIDES = [['odometer', 'Odometer reading'], ['front', 'Front'], ['back', 'Rear'], ['left', 'Left side'], ['right', 'Right side']];
function photoSet(title, { helmets = false, hint = 'The odometer photo and all four sides are required.' } = {}) {
  const pf = Object.fromEntries(SET_SIDES.map(([k, l]) => [k, photoField({ label: l, required: true })]));
  const extra = multiPhotoField({ label: 'Additional photos (optional)', max: 6 });
  const hel = helmets ? multiPhotoField({ label: 'Helmet photos', max: 6 }) : null;
  const helNote = h('p', { class: 'field-hint' }, 'Required when helmets are handed over or taken back. Up to 6.');
  const helErr = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  let helNeeded = false;
  const el = h('section', { class: 'form-section' }, h('h3', title), h('p', { class: 'muted small' }, hint),
    h('div', { class: 'photo-grid two' }, SET_SIDES.map(([k]) => pf[k].el)), extra.el,
    hel ? h('div', { class: 'stack-sm' }, hel.el, helNote, helErr) : null);
  const picked = (m) => m.kept().length + m.newItems().length;
  return {
    el,
    setHelmetsNeeded(v) { helNeeded = !!v; if (hel) { helNote.textContent = v ? 'Helmets are involved: at least one helmet photo is required. Up to 6.' : 'Required when helmets are handed over or taken back. Up to 6.'; if (!v) { helErr.hidden = true; } } },
    validate() {
      let ok = true;
      for (const [k] of SET_SIDES) { if (!pf[k].picked()) { pf[k].setError('Add this photo.'); ok = false; } else pf[k].setError(''); }
      helErr.hidden = true;
      if (hel && helNeeded && picked(hel) === 0) { helErr.textContent = 'Add at least one photo of the helmets.'; helErr.hidden = false; ok = false; }
      return ok;
    },
    async collect(folder, tag) {
      const o = {};
      for (const [k] of SET_SIDES) { const it = pf[k].picked(); o[k] = await uploadPhoto(photoPath(folder, `${tag}-${k}`, it.type), it.blob); }
      o.extra = await uploadAll(extra, folder, `${tag}-extra`);
      o.helmets = hel ? await uploadAll(hel, folder, `${tag}-helmet`) : [];
      return o;
    },
  };
}
const sidePhotos = (title) => photoSet(title, { helmets: false });

// ---------------------------------------------------------------------------------------------
// What is in the way of a vehicle (answer of the vehicle_conflict function), in plain words.
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const WITH_CUSTOMER = ['with_customer', 'waiting_approval'];
// New booking, or (when `booking` is given) edit a booking that is waiting for approval.
export function openBookingForm({ booking = null, onDone }) {
  if (!booking && !can.createBooking()) { toast('An Executive cannot create a booking.', 'error'); return null; }
  const edit = !!booking; const formId = 'bk-form'; const submit = submitBtn(edit ? 'Save changes' : 'Save booking', formId);
  const nameIn = input({ value: booking?.booking_name || '', placeholder: 'Customer name', autofocus: true }); const fName = field('Customer name', nameIn, { required: true });
  const phone = phoneField('Phone number', { required: true, value: booking?.booking_phone || '' });
  const when = input({ type: 'datetime-local', value: localInputValue(booking?.booking_for ? new Date(booking.booking_for) : new Date(Date.now() + 86400000)) });
  const fWhen = field('Planned delivery date and time', when, { required: true });
  const days = wholeInput('1'); if (booking?.booking_days) days.value = String(booking.booking_days);
  const fDays = field('Number of days', days, { required: true, hint: 'The vehicle is locked for this many days from the planned delivery time. Nobody else can deliver, swap or book it in that time.' });
  const vSel = select([{ value: '', label: 'Choose a vehicle' }]); const fVeh = field('Vehicle number', vSel, { required: true });
  const rem = textarea({ rows: '2', placeholder: 'Anything to remember', value: booking?.booking_note || '' });
  const adv = edit ? null : paymentsEditor({ title: 'Booking advance received now (optional)', purposes: ['Booking advance'], first: 'Booking advance', lockPurpose: true,
    hint: 'If the customer pays something now to hold the booking, add it here. Leave the amount empty if nothing was received. It counts towards the delivery total later; if the booking is cancelled it must be refunded.' });
  let seq = 0, wanted = booking?.booking_vehicle_id ? String(booking.booking_vehicle_id) : '';
  async function loadVehicles() {
    const my = ++seq; const n = Number(days.value);
    try {
      const rows = await rpc('bookable_vehicles', { p_from: when.value ? isoFromLocal(when.value) : null, p_days: n >= 1 ? n : null, p_exclude: booking?.id ?? null });
      if (my !== seq) return;
      const keep = vSel.value || wanted;
      mount(vSel, h('option', { value: '' }, 'Choose a vehicle'), rows.map(v => {
        const label = `${v.number}, ${model(v.model_id)?.name || ''}, ${placeOf({ current_state: v.current_state, current_location_id: v.current_location_id }).label}`;
        const out = WITH_CUSTOMER.includes(String(v.current_state));   // a vehicle with a customer can never be booked
        return h('option', { value: String(v.id), disabled: !!v.conflict || out }, out ? `${label} (with a customer now, cannot be booked)` : v.conflict ? `${label} (not free: ${conflictText(v.conflict)})` : label);
      }));
      const ok = [...vSel.options].some(o => o.value === keep && !o.disabled); vSel.value = ok ? keep : '';
      if (!ok && keep) fVeh.setError('The vehicle you chose is not free for these dates. Choose another.'); else if (ok) fVeh.setError('');
    } catch (e) { mount(vSel, h('option', { value: '' }, 'Could not load vehicles. Has the Stage 2 database script been run?')); }
  }
  const vehNote = h('p', { class: 'field-hint' }); fVeh.append(vehNote);
  const reload = debounce(() => loadVehicles(), 250);
  // The date or the days changed: the vehicle that was chosen may be locked for the new time, so it is cleared at once.
  const timeChanged = () => { seq++; if (vSel.value) vehNote.textContent = 'The date or days changed, so the vehicle was cleared. Choose the vehicle again.'; vSel.value = ''; wanted = ''; fVeh.setError(''); reload(); };
  when.addEventListener('change', timeChanged); when.addEventListener('input', timeChanged); days.addEventListener('input', timeChanged);
  vSel.addEventListener('change', () => { wanted = vSel.value; fVeh.setError(''); vehNote.textContent = ''; });
  loadVehicles();
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true;
    if (nameIn.value.trim().length < 2) { fName.setError('Enter the customer\'s name.'); ok = false; } else fName.setError('');
    if (!phone.validate()) ok = false;
    if (!vSel.value) { fVeh.setError('Choose the vehicle to book.'); ok = false; }
    if (vSel.selectedOptions[0]?.disabled) { fVeh.setError('That vehicle is locked for these dates. Choose another.'); ok = false; }
    if (!when.value) { fWhen.setError('Enter the planned date and time.'); ok = false; } else fWhen.setError('');
    ok = checkWhole(fDays, days, { min: 1, label: 'the days' }) && ok;
    if (adv && !adv.validate()) ok = false;
    if (!ok) { form.querySelector('.has-error, .field-error:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    busy(submit, async () => { try {
      const body = { booking_name: nameIn.value.trim(), booking_phone: phone.get(), booking_vehicle_id: vSel.value, booking_for: isoFromLocal(when.value), booking_days: days.value.trim(), booking_note: rem.value.trim() };
      let id;
      if (edit) { await rpc('update_booking', { p_id: booking.id, p: body }); id = booking.id; toast('Booking saved'); }
      else { body.payments = await adv.collect(`deliveries/${folderId()}/receipts`); id = await rpc('create_booking', { p: body });
        toast(body.payments.length ? 'Booking saved with the advance. The vehicle is locked. An approver must approve it.' : 'Booking saved. The vehicle is locked. An approver must approve it.'); }
      s.close(); onDone?.(id);
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, fName, phone.el, h('div', { class: 'grid-2' }, fWhen, fDays), fVeh, field('Remarks', rem), adv ? adv.el : null,
    h('p', { class: 'muted small' }, 'A new booking waits for an Approver (or above) before it can be handed over. The vehicle can still be moved between places while it is booked.'));
  const s = openSheet({ title: edit ? 'Edit booking' : 'New booking', subtitle: booking?.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  return s;
}

// Ask for the vehicle on a booking to be replaced (so the booked vehicle can be given to someone else).
// Everyone can ask. An Approver (or above) can also replace it straight away.
export function openReplaceBooking({ booking, onDone }) {
  const sel = select([{ value: '', label: 'Loading vehicles…' }]); const fSel = field('Replace with', sel, { required: true, hint: 'Only vehicles that are free for the whole booking are listed.' });
  const why = textarea({ rows: '3', placeholder: 'Why the booked vehicle is needed for someone else' }); const fWhy = field('Reason', why, { required: true });
  const send = submitBtn('Send request', 'rp-form'); const now = can.approve() ? submitBtn('Replace now', 'rp-form') : null;
  let mode = 'request';
  send.addEventListener('click', () => { mode = 'request'; }); now?.addEventListener('click', () => { mode = 'now'; });
  rpc('bookable_vehicles', { p_from: booking.booking_for, p_days: booking.booking_days, p_exclude: booking.id }).then(rows => {
    const free = rows.filter(v => !v.conflict && v.id !== booking.booking_vehicle_id && !WITH_CUSTOMER.includes(String(v.current_state)));
    mount(sel, h('option', { value: '' }, free.length ? 'Choose a vehicle' : 'No vehicle is free for these dates'),
      free.map(v => h('option', { value: String(v.id) }, `${v.number}, ${model(v.model_id)?.name || ''}, ${placeOf({ current_state: v.current_state, current_location_id: v.current_location_id }).label}`)));
  }).catch(() => mount(sel, h('option', { value: '' }, 'Could not load vehicles')));
  const form = h('form', { id: 'rp-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; if (!sel.value) { fSel.setError('Choose the replacement vehicle.'); ok = false; } else fSel.setError('');
    if (!why.value.trim()) { fWhy.setError('Write a reason.'); ok = false; } else fWhy.setError(''); if (!ok) return;
    const btnEl = mode === 'now' && now ? now : send;
    busy(btnEl, async () => { try {
      const id = await rpc('request_booking_replacement', { p_booking: booking.id, p_new_vehicle: Number(sel.value), p_reason: why.value.trim() });
      if (mode === 'now' && can.approve()) { await rpc('approve_booking_replacement', { p_id: id }); toast('The booking now has the new vehicle.'); }
      else toast('Request sent. An approver must approve it.');
      s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, h('div', { class: 'callout' }, icon('info', 18), h('span', null, h('strong', `${booking.code}: `), `${booking.booking_name || 'Booking'}, ${booking.vehicle_number || 'vehicle'} from ${fmtDateTimeY(booking.booking_for)} for ${booking.booking_days} day${booking.booking_days === 1 ? '' : 's'}.`)),
    fSel, fWhy, h('p', { class: 'muted small' }, 'The booking keeps its dates. Only its vehicle changes, once approved.'));
  const s = openSheet({ title: 'Replace the booked vehicle', subtitle: booking.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), send, now] });
  return s;
}

// ---------------------------------------------------------------------------------------------
export function openDeliveryForm({ mode = 'deliver', booking = null, onDone }) {
  const isBooking = mode === 'booking';
  const formId = 'dl-form';
  const submit = submitBtn(isBooking ? 'Save booking' : 'Hand over', formId);
  let s;

  if (isBooking) return openBookingForm({ onDone });

  const cust = customerPicker({});
  let helmets = null, paySum = 0, pay = null;
  const advance = num(booking?.advance_received || 0);   // booking advance already received: it counts towards the total
  const vehicle = vehiclePicker({ label: 'Vehicle', selectId: booking?.booking_vehicle_id || null, onChange: () => { paintLast(); refreshRates(); checkConflict(); },
    window: () => { const st = startAt(), n = Number(days.value); return st ? { from: st, to: new Date(st.getTime() + (n >= 1 ? n : 1) * 86400000), exclude: booking?.id ?? null } : null; } });
  const handover = segmented([{ value: 'delivery', label: 'We are delivering' }, { value: 'office', label: 'Customer is coming to collect' }], 'delivery', () => paintMode());
  const place = input({ placeholder: 'Area or place, for example Anna Nagar' }); const fPlace = field('Delivery location / area', place, { required: true, hint: 'Type it. Nothing is filled in for you.' });
  const lastLoc = h('div', { class: 'callout' });
  let lastSeq = 0;
  async function paintLast() {
    const v = vehicle.value(); const seq = ++lastSeq;
    if (!v) { mount(lastLoc, icon('info', 18), h('span', 'Choose a vehicle to see where it is now.')); return; }
    const where = loc(v.current_location_id)?.name || 'an Office';
    mount(lastLoc, icon('info', 18), h('span', `${v.number} is at ${where}. Collecting from here.`));
    try {
      const { data } = await sb.from('vehicle_logs').select('event,created_at,by_user').eq('vehicle_id', v.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1);
      if (seq !== lastSeq || !data?.length) return;
      mount(lastLoc, icon('info', 18), h('span', null, h('strong', `${v.number} is at ${where}`), ` (last log: ${data[0].event}, ${fmtDateTimeY(data[0].created_at)}, ${whoName(data[0].by_user)}). The customer collects it from here.`));
    } catch { /* the simple line above stays */ }
  }
  function paintMode() { const coll = handover.get() === 'office'; fPlace.hidden = coll; lastLoc.hidden = !coll; fPlace.setError(''); if (coll) paintLast(); }
  const addr = textarea({ rows: '2', placeholder: 'Where the customer is staying now' }); const fAddr = field('Customer\'s current address', addr, { required: true, hint: 'Customers move often. This is recorded for this delivery.' });
  const at = input({ type: 'datetime-local', value: localInputValue() });
  const days = wholeInput('1'); if (booking?.booking_days) days.value = String(booking.booking_days); const fDays = field('Number of days', days, { required: true });
  
  const trip = select([{ value: '', label: 'Choose trip kind' }, ...TRIPS.map(t => ({ value: t.value, label: t.label }))]); const fTrip = field('Trip kind', trip, { required: true, hint: 'The rent and extra km rate come from the vehicle master for this kind of trip.' });
  const rent = moneyInput(); const fRent = field('Rent per day', rent, { required: true, hint: 'Filled in from the vehicle master. You can change it for this delivery only; the master stays the same.' });
  const rentNote = h('p', { class: 'muted small' });
  let rentTouched = false, xTouched = false;
  const pref = input({ type: 'datetime-local' }); const fPref = field('Customer preferred return time (optional)', pref, { hint: 'For the back office to follow up. It must be after the handover time and not later than the end of the rental.' });
  const dep = moneyInput(); const fDep = field('Deposit', dep);
  const dch = moneyInput(); const fDch = field('Delivery charges', dch);
  const apc = moneyInput(); const fApc = field('Advance pickup charges', apc);
  const km = kmLimitField(); const xrate = moneyInput(); const fX = field('Extra km rate (per km)', xrate, { required: true, hint: 'Filled in from the vehicle master for the trip kind. You can change it.' });
  const odo = wholeInput(); const fOdo = field('Odometer reading', odo, { required: true });
  const ot = input({ placeholder: 'For example Helmet damage cover' }); const oa = moneyInput(); const fOa = field('Other charge amount', oa);
  const photos = photoSet('Vehicle photos at handover', { helmets: true });
  const note = textarea({ rows: '2', placeholder: 'Anything to remember' });
  const total = h('div', { class: 'total-box' }); const billEl = h('p', { class: 'bill-line' });
  
  const totalRent = () => num(rent.value) * (num(days.value) || 1);
  const charged = () => totalRent() + num(dep.value) + num(dch.value) + num(apc.value) + num(oa.value);
  
  const recalc = () => {
    const t = totalRent() + num(dep.value) + num(dch.value) + num(apc.value) + num(oa.value);
    mount(total, h('span', 'Total amount'), h('strong', fmtMoney(t)), h('small', `Rent (${fmtMoney(num(rent.value))} x ${num(days.value) || 1} days) + deposit + delivery charges + advance pickup charges + other charges`));
    const diff = r2(charged() - paySum - advance);
    pay?.repaint?.();
    billEl.className = 'bill-line' + (diff === 0 && charged() > 0 ? ' ok' : ' due');
    const advTxt = advance ? ` (including the booking advance of ${fmtMoney(advance)} received earlier)` : '';
    billEl.textContent = charged() === 0 ? '' : diff === 0 ? `Amount received equals the amount charged (${fmtMoney(charged())})${advTxt}.` : diff > 0 ? `Still to receive: ${fmtMoney(diff)}. The amount received${advTxt} must equal the amount charged (${fmtMoney(charged())}).` : `Received ${fmtMoney(-diff)} too much. The amount received${advTxt} must equal the amount charged (${fmtMoney(charged())}).`;
  };
  [rent, dep, dch, apc, oa, days].forEach(i => i.addEventListener('input', recalc));
  // ---- rent from the vehicle master, end of rental, preferred return, and bookings that lock the vehicle
  const startAt = () => (at.value ? new Date(isoFromLocal(at.value)) : null);
  const endAt = () => { const st = startAt(), n = Number(days.value); return st && n >= 1 ? new Date(st.getTime() + n * 86400000) : null; };
  function refreshRates() {
    const v = vehicle.value(), n = Number(days.value), t = trip.value;
    const mv = v && n >= 1 && t ? rateFor(v, n, t) : null, mx = v && t ? extraKmFor(v, t) : null;
    if (!rentTouched && mv !== null) rent.value = String(mv);
    if (!xTouched && mx !== null) xrate.value = String(mx);
    if (!v || !t || !(n >= 1)) rentNote.textContent = 'Choose the vehicle, trip kind and number of days to see the master rate.';
    else if (mv === null) rentNote.textContent = 'No rate is set in the vehicle master for this trip kind and number of days. Type the rent per day.';
    else {
      const cur = num(rent.value), d = Math.round((cur - mv) * 100) / 100;
      rentNote.textContent = `Master rate: ${fmtMoney(mv)} per day (${TRIPS.find(x => x.value === t).label}, ${n} day${n === 1 ? '' : 's'}).` + (rent.value.trim() && d !== 0 ? ` You are charging ${fmtMoney(Math.abs(d))} per day ${d < 0 ? 'less' : 'more'} (${fmtMoney(Math.abs(d) * n)} ${d < 0 ? 'less' : 'more'} in total). The approver will see this.` : '');
    }
    recalc();
  }
  function paintPref() { const st = startAt(), en = endAt(); if (st && en) { pref.min = localInputValue(new Date(st.getTime() + 60000)); pref.max = localInputValue(en); } }
  rent.addEventListener('input', () => { rentTouched = true; refreshRates(); }); xrate.addEventListener('input', () => { xTouched = true; });
  trip.addEventListener('change', () => { fTrip.setError(''); refreshRates(); });
  const conflictBox = h('div', { class: 'callout', hidden: true }); let lastConflict = null, cSeq = 0, checkFailed = false;
  async function checkConflict() {
    const v = vehicle.value(), st = startAt(), en = endAt(); const my = ++cSeq;
    if (!v || !st || !en) { lastConflict = null; conflictBox.hidden = true; return null; }
    try {
      const c = await rpc('vehicle_conflict', { p_vehicle: v.id, p_from: st.toISOString(), p_to: en.toISOString(), p_exclude: booking?.id ?? null, p_include_out: false });
      if (my !== cSeq) return lastConflict; lastConflict = c;
      if (!c) { conflictBox.hidden = true; return null; }
      mount(conflictBox, icon('lock', 18), h('span', null, h('strong', `${v.number} is locked: `), `it is ${conflictText(c)}. Choose another vehicle`,
        c.kind === 'booking' ? [', or ask for that booking to be moved to a different vehicle. ', btn('Ask to move that booking', { small: true, onClick: () => openReplaceBooking({ booking: { id: c.id, code: c.code, booking_name: c.name, booking_for: c.from, booking_days: Math.max(1, Math.round((new Date(c.to) - new Date(c.from)) / 86400000)), booking_vehicle_id: v.id, vehicle_number: v.number }, onDone: checkConflict }) })] : '.'));
      conflictBox.hidden = false; return c;
    } catch (e) { checkFailed = true; return lastConflict; }
  }
  // the vehicle stays only if it is still free for the new time; a locked one is cleared and the list shows what is locked
  const onTimeChange = () => { refreshRates(); paintPref(); vehicle.refresh(); };
  days.addEventListener('input', onTimeChange); at.addEventListener('change', onTimeChange);
  
  // Restricted purpose list matching exact delivery categories: Rent, Deposit, Delivery charges, Advance pickup charges, Other charges
  pay = paymentsEditor({ title: 'Payments received', purposes: ['Rent', 'Deposit', 'Delivery charges', 'Advance pickup charges', 'Other charges'], first: 'Rent',
    hint: 'Enter each payment once: how it was paid, the transaction id and screenshot (if not cash), then split it over the charges. Use "Fill from the charges" to split it as per this delivery.',
    expected: () => [{ head: 'Rent', amount: totalRent() }, { head: 'Deposit', amount: num(dep.value) }, { head: 'Delivery charges', amount: num(dch.value) }, { head: 'Advance pickup charges', amount: num(apc.value) }, { head: 'Other charges', amount: num(oa.value) }],
    credit: () => (advance ? { label: 'Booking advance received earlier (adjusted)', amount: advance } : null),
    onTotal: (t) => { paySum = t; recalc(); } });
  recalc();

  const secs = [];
  if (booking) secs.push(h('div', { class: 'callout' }, icon('info', 18), h('span', null, h('strong', `Booking ${booking.code}: `), h('span', { class: 'prewrap' }, [booking.booking_name || booking.booking_text || '', booking.booking_phone ? `, ${booking.booking_phone}` : '',
    booking.vehicle_number ? `. Booked vehicle ${booking.vehicle_number}` : '', booking.booking_days ? ` for ${booking.booking_days} day${booking.booking_days === 1 ? '' : 's'}` : '', booking.booking_note ? `. ${booking.booking_note}` : ''].join('')))));
  secs.push(cust.el, vehicle.el, conflictBox, sectionBlock('Helmets', h('div', { id: 'helmet-slot' }, h('p', { class: 'muted small' }, 'Loading helmets…'))),
    sectionBlock('Handover', h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How is the vehicle handed over?'), handover), fPlace, lastLoc, fAddr, h('div', { class: 'grid-2' }, field('Handover time', at), fDays)),
    sectionBlock('Charges', fTrip, h('div', { class: 'stack-sm' }, fRent, rentNote), fPref, h('div', { class: 'grid-2' }, fDep, fDch), h('div', { class: 'grid-2' }, fApc), total,
      h('div', { class: 'grid-2' }, field('Other charge for', ot), fOa)),
    sectionBlock('Kilometres', km.el, h('div', { class: 'grid-2' }, fX, fOdo)), photos.el, field('Note', note), pay.el, billEl);
  paintMode();

  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true;
    if (!cust.value()) { cust.setError('Choose the customer, or create them now.'); ok = false; }
    if (!vehicle.value()) { vehicle.setError('Choose a vehicle.'); ok = false; }
    if (handover.get() === 'delivery' && !place.value.trim()) { fPlace.setError('Type the delivery location or area.'); ok = false; } else fPlace.setError('');
    if (!addr.value.trim()) { fAddr.setError('Enter the customer\'s current address.'); ok = false; } else fAddr.setError('');
    ok = checkWhole(fDays, days, { min: 1, label: 'the days' }) && ok;
    ok = checkMoney(fRent, rent, { required: true }) && ok;
    [[fDep, dep], [fDch, dch], [fApc, apc], [fOa, oa]].forEach(([f, i]) => { ok = checkMoney(f, i) && ok; });
    ok = km.validate() && ok;
    if (!trip.value) { fTrip.setError('Choose Local trip or Road trip.'); ok = false; } else fTrip.setError('');
    { const st = startAt(), en = endAt(), pv = pref.value ? new Date(isoFromLocal(pref.value)) : null;
      if (pv && st && en && (pv <= st || pv > en)) { fPref.setError(`Choose a time after the handover and not later than ${fmtDateTimeY(en)}.`); ok = false; } else fPref.setError(''); }
    ok = checkMoney(fX, xrate, { required: true }) && ok;
    ok = checkWhole(fOdo, odo, { label: 'the reading' }) && ok;
    if (num(oa.value) > 0 && !ot.value.trim()) { fOa.setError('Say what the other charge is for.'); ok = false; }
    photos.setHelmetsNeeded((helmets ? helmets.values() : []).length > 0);
    if (!photos.validate()) ok = false;
    if (!pay.validate()) ok = false;
    if (Math.abs(charged() - paySum - advance) > 0.001) { toast('The amount received must equal the amount charged.', 'error'); ok = false; }
    if (!ok) { form.querySelector('.has-error, .field-error:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    busy(submit, async () => {
      try {
        checkFailed = false; const c = await checkConflict();
        if (checkFailed) { toast('Could not check whether the vehicle is locked. Check your connection and try again.', 'error'); return; }
        if (c) { toast('This vehicle is locked for those dates. Choose another vehicle.', 'error'); return; }
        const folder = `deliveries/${folderId()}`;
        const payments = await pay.collect(`${folder}/receipts`);
        const photo_set = await photos.collect(folder, 'vehicle');
        const body = { customer_id: cust.value().id, vehicle_id: vehicle.value().id, helmet_ids: helmets ? helmets.values() : [], handover_mode: handover.get(), delivery_place: handover.get() === 'delivery' ? place.value.trim() : '', current_address: addr.value.trim(), delivered_at: isoFromLocal(at.value),
          days: days.value.trim(), trip_type: trip.value, rent_per_day: rent.value.trim(), preferred_return_at: pref.value ? isoFromLocal(pref.value) : '', deposit: dep.value.trim(), delivery_charges: dch.value.trim(), advance_pickup_charges: apc.value.trim(),
          km_limit_per_day: km.value(), extra_km_rate: xrate.value.trim(), odometer_out: odo.value.trim(), other_charges_text: ot.value, other_charges_amount: oa.value.trim(), note: note.value, photo_set, payments };
        let id;
        if (booking) { await rpc('deliver_booking', { p_id: booking.id, p: body }); id = booking.id; }
        else id = await rpc('create_delivery', { p: { mode: 'deliver', ...body } });
        toast('Saved. An approver will review it, then confirm the handover.'); s.close(); onDone?.(id);
      } catch (e) { toast(friendlyError(e), 'error'); }
    });
  } } }, secs);
  s = openSheet({ title: booking ? 'Hand over booking' : 'New delivery', subtitle: booking?.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
  readyHelmets().then(items => { helmets = helmetChips({ label: 'Helmets given', items, hint: 'Only helmets at an Office are listed.' }); mount(form.querySelector('#helmet-slot'), helmets.el); })
    .catch(() => { helmets = { values: () => [] }; mount(form.querySelector('#helmet-slot'), h('p', { class: 'muted small' }, 'Could not load helmets.')); });
  return s;
}

// ---------------------------------------------------------------------------------------------
export function openExtendForm({ delivery, onDone }) {
  const due = new Date(delivery.return_due);
  const end = input({ type: 'datetime-local', value: localInputValue(new Date(due.getTime() + 86400000)) });
  const fEnd = field('New end date and time', end, { required: true, hint: `Currently due ${fmtDateTimeY(delivery.return_due)}.` });
  const amount = moneyInput(); const fAmt = field('Total amount to charge for the extension', amount, { required: true, hint: 'Type the final amount, including any discount. Nothing is calculated for you.' });
  const note = textarea({ rows: '2' });
  const pay = paymentsEditor({ title: 'Payment received now (optional)', purposes: ['Extension'], first: 'Extension', hint: 'If the customer pays later, leave this empty and add the payment afterwards.' });
  const formId = 'ext-form'; const submit = submitBtn('Send for approval', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; fEnd.setError('');
    if (!end.value || new Date(isoFromLocal(end.value)) <= due) { fEnd.setError('Choose a date after the current return date.'); ok = false; }
    ok = checkMoney(fAmt, amount, { required: true }) && ok; if (!pay.validate()) ok = false;
    if (ok && pay.total() > num(amount.value)) { toast('The payment cannot be more than the extension amount.', 'error'); ok = false; }
    if (!ok) return;
    busy(submit, async () => { try {
      const payments = await pay.collect(`deliveries/${folderId()}/receipts`);
      await rpc('extend_delivery', { p_delivery: delivery.id, p_new_end: isoFromLocal(end.value), p_amount: num(amount.value), p_payments: payments, p_note: note.value });
      toast('Extension sent for approval. It takes effect once approved.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, fEnd, fAmt, field('Note', note), pay.el, h('p', { class: 'muted small' }, 'An Approver (or above) must approve the extension before the return date changes.'));
  const s = openSheet({ title: 'Extend delivery', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}

// ---------------------------------------------------------------------------------------------
export function openAssignSwap({ delivery, onDone }) {
  const who = select(userOptions({ blank: true })); const fWho = field('Who will do the swap', who, { required: true });
  const why = textarea({ rows: '3', placeholder: 'Why the vehicle is being swapped, for example puncture or breakdown' });
  const formId = 'asg-form'; const submit = submitBtn('Assign swap', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    if (!who.value) return fWho.setError('Choose a person.');
    busy(submit, async () => { try { await rpc('assign_swap', { p_delivery: delivery.id, p_assigned_to: who.value, p_reason: why.value }); toast('Swap assigned'); s.close(); onDone?.(); }
      catch (e) { fWho.setError(friendlyError(e)); } });
  } } }, h('p', { class: 'muted' }, 'The person you choose will do the swap and add the details. An approver then reviews and confirms it.'), fWho, field('Reason', why));
  const s = openSheet({ title: 'Assign a swap', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}

export function openDoSwap({ swap, delivery, onDone }) {
  const nv = vehiclePicker({ label: 'New vehicle', excludeId: delivery.vehicle_id });
  const place = input({ placeholder: 'Area or place where the swap happens' }); const fPlace = field('Swap location / area', place, { required: true, hint: 'Type it. Nothing is filled in for you.' });
  const addr = textarea({ rows: '2', placeholder: 'Where the customer is staying now' }); const fAddr = field('Customer\'s current address', addr, { required: true });
  const same = btn('Same as at delivery', { ic: 'copy', small: true, onClick: () => { addr.value = delivery.current_address || ''; if (!delivery.current_address) toast('No address was recorded at delivery.', 'error'); fAddr.setError(''); } });
  const oin = wholeInput(); const fIn = field('Old vehicle reading now', oin, { required: true, hint: `It left at ${delivery.odometer_out} km.` });
  const onew = wholeInput(); const fNew = field('New vehicle reading', onew, { required: true });
  const outP = sidePhotos('Old bike received back from the customer'); const inP = sidePhotos('New bike given to the customer');
  const note = textarea({ rows: '2' });
  const pay = paymentsEditor({ title: 'Payment received for the swap (optional)', purposes: ['Swap charge'], first: 'Swap charge' });
  const formId = 'swp-form'; const submit = submitBtn('Send for approval', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; if (!nv.value()) { nv.setError('Choose the new vehicle.'); ok = false; }
    if (!place.value.trim()) { fPlace.setError('Type the swap location or area.'); ok = false; } else fPlace.setError('');
    if (!addr.value.trim()) { fAddr.setError('Enter the current address.'); ok = false; } else fAddr.setError('');
    ok = checkWhole(fIn, oin, { label: 'the reading' }) && ok; ok = checkWhole(fNew, onew, { label: 'the reading' }) && ok;
    if (!outP.validate()) ok = false; if (!inP.validate()) ok = false; if (!pay.validate()) ok = false;
    if (!ok) { form.querySelector('.has-error, .field-error:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    busy(submit, async () => { try {
      const folder = `swaps/${folderId()}`; const payments = await pay.collect(`${folder}/receipts`);
      const photos_old = await outP.collect(folder, 'old'); const photos_new = await inP.collect(folder, 'new');
      await rpc('do_swap', { p_id: swap.id, p: { new_vehicle_id: nv.value().id, swap_place: place.value.trim(), current_address: addr.value.trim(), odometer_in_old: oin.value.trim(), odometer_out_new: onew.value.trim(), photos_old, photos_new, note: note.value, payments } });
      toast('Swap saved. Both vehicles now wait for approval.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, nv.el, fPlace, h('div', { class: 'stack-sm' }, fAddr, same), h('div', { class: 'grid-2' }, fIn, fNew), outP.el, inP.el, field('Note', note), pay.el);
  const s = openSheet({ title: 'Do the swap', subtitle: `${delivery.code}${swap.reason ? `, ${swap.reason}` : ''}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
}

// ---------------------------------------------------------------------------------------------
export function openPickupForm({ delivery, rentalDays, helmetsOut, due = 0, onDone }) {
  const place = input({ placeholder: 'Area or place where the vehicle was picked up' }); const fPlace = field('Pickup location / area', place, { required: true, hint: 'Type it. Nothing is filled in for you.' });
  const at = input({ type: 'datetime-local', value: localInputValue() });
  const odo = wholeInput(); const fOdo = field('Odometer reading now', odo, { required: true, hint: `It was ${delivery.odometer_out} km when it went out.` });
  const hel = helmetChips({ label: 'Helmets returned', items: helmetsOut.map(x => ({ id: x.helmet_id, code: x.code })), checked: helmetsOut.map(x => x.helmet_id), hint: 'Untick any helmet that was not returned.' });
  const calc = h('div', { class: 'total-box' });
  const ot = input({ placeholder: 'For example Scratch on tank' }); const oa = moneyInput(); const fOa = field('Other charge amount', oa);
  const cond = textarea({ rows: '2', placeholder: 'Condition of the vehicle' }); const photos = photoSet('Vehicle photos at return', { helmets: true });
  const refund = moneyInput(); const fRef = field('Deposit refund now (optional)', refund, { hint: `Deposit taken: ${fmtMoney(delivery.deposit)}. No cash right now? Leave it empty and refund later from the delivery.` });
  const refVia = select(VIAS.map(v => ({ value: v, label: v }))); const refHolder = select(userOptions({ blank: true }), { value: state.me.id }); const fRefHolder = field('Cash paid out by', refHolder, { hint: 'The person who hands over the cash.' });
  const refPhoto = photoField({ label: 'Refund receipt photo' }); const fRefPhoto = h('div', { class: 'stack-sm' }, refPhoto.el);
  refVia.addEventListener('change', () => { fRefHolder.hidden = refVia.value !== 'Cash'; fRefPhoto.hidden = refVia.value === 'Cash'; });
  const state_ = { xkm: 0, xchg: 0, kmUsed: 0 };
  const owed = () => ({ km: state_.xchg, ret: num(oa.value), bal: Math.max(0, num(due)) });
  const depositSetOff = () => { const o = owed(); return Math.max(0, Math.min(num(delivery.deposit) - num(refund.value), o.km + o.ret + o.bal)); };
  const pay = paymentsEditor({ title: 'Payments received now (optional)', purposes: ['Extra km', 'Return charges', 'Balance'], first: 'Balance',
    hint: 'Enter each payment once: how it was paid, the transaction id and screenshot (if not cash), then split it over the charges. The deposit held is set off against what is owed.',
    expected: () => { const o = owed(); return [{ head: 'Extra km', amount: o.km }, { head: 'Return charges', amount: o.ret }, { head: 'Balance', amount: o.bal }]; },
    credit: () => ({ label: 'Deposit held, set off against these charges', amount: depositSetOff() }), summaryLabel: 'Payment summary at pickup' });
  const upd = () => {
    const oin = Number(odo.value); const used = Number.isFinite(oin) && odo.value.trim() ? delivery.km_before_current + (oin - delivery.odometer_out) : 0;
    const allowed = delivery.km_limit_per_day * rentalDays; const xkm = Math.max(0, used - allowed); const xchg = Math.round(xkm * num(delivery.extra_km_rate) * 100) / 100;
    Object.assign(state_, { xkm, xchg, kmUsed: used });
    mount(calc, h('span', 'Extra km charge'), h('strong', fmtMoney(xchg)),
      h('small', odo.value.trim() ? `${used} km used, ${allowed} km allowed (${rentalDays} day${rentalDays === 1 ? '' : 's'} x ${delivery.km_limit_per_day}). ${xkm} km extra at ${fmtMoney(delivery.extra_km_rate)} per km.` : `Allowed: ${allowed} km (${rentalDays} day${rentalDays === 1 ? '' : 's'} x ${delivery.km_limit_per_day}).`));
    refund.placeholder = String(Math.max(0, num(delivery.deposit) - xchg - num(oa.value) - Math.max(0, num(due))));
    pay?.repaint?.();
  };
  odo.addEventListener('input', upd); oa.addEventListener('input', upd); refund.addEventListener('input', () => pay.repaint()); upd();
  const formId = 'pk-form'; const submit = submitBtn('Send for approval', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; if (!place.value.trim()) { fPlace.setError('Type the pickup location or area.'); ok = false; } else fPlace.setError('');
    ok = checkWhole(fOdo, odo, { label: 'the reading' }) && ok; ok = checkMoney(fOa, oa) && ok; ok = checkMoney(fRef, refund) && ok;
    if (num(oa.value) > 0 && !ot.value.trim()) { fOa.setError('Say what the other charge is for.'); ok = false; }
    if (num(refund.value) > num(delivery.deposit)) { fRef.setError(`The refund cannot be more than the deposit (${fmtMoney(delivery.deposit)}).`); ok = false; }
    if (num(refund.value) > 0 && refVia.value === 'Cash' && !refHolder.value) { fRefHolder.setError('Choose who pays out the cash.'); ok = false; }
    if (num(refund.value) > 0 && refVia.value !== 'Cash' && !refPhoto.picked()) { refPhoto.setError('A receipt photo is required for a non-cash refund.'); ok = false; }
    photos.setHelmetsNeeded(hel.values().length > 0); if (!photos.validate()) ok = false;
    if (!pay.validate()) ok = false; if (!ok) { form.querySelector('.has-error, .field-error:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    busy(submit, async () => { try {
      const folder = `pickups/${folderId()}`; const payments = await pay.collect(`${folder}/receipts`); const photoPaths = await photos.collect(folder, 'return');
      let refundReceipt = null; const rp = refPhoto.picked(); if (num(refund.value) > 0 && rp) refundReceipt = await uploadPhoto(photoPath(folder, 'refund', rp.type), rp.blob);
      await rpc('create_pickup', { p_delivery: delivery.id, p: { return_place: place.value.trim(), returned_at: isoFromLocal(at.value), odometer_in: odo.value.trim(), helmet_ids: hel.values(),
        other_charges_text: ot.value, other_charges_amount: oa.value.trim(), condition_note: cond.value, photos: photoPaths, payments,
        refund_amount: num(refund.value) > 0 ? String(num(refund.value)) : '', refund_via: refVia.value, refund_receipt: refundReceipt, refund_cash_user: refVia.value === 'Cash' ? refHolder.value : null } });
      toast('Pickup saved. It waits for approval.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, h('div', { class: 'grid-2' }, fPlace, field('Return time', at)), fOdo, calc, hel.el,
    sectionBlock('Other charges', h('div', { class: 'grid-2' }, field('Other charge for', ot), fOa)), field('Condition', cond), photos.el, pay.el,
    sectionBlock('Deposit refund', h('div', { class: 'grid-2' }, fRef, field('Paid by', refVia)), fRefHolder, fRefPhoto, h('p', { class: 'muted small' }, 'Saved as an expense for this delivery. You can also refund later from the delivery.')));
  refVia.dispatchEvent(new Event('change'));
  const s = openSheet({ title: 'Pick up the vehicle', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
}

// ---------------------------------------------------------------------------------------------
const TYPES_BY_STATUS = { booking_pending: ['Income'], booked: ['Income'], pending: ['Income'], active: ['Income'], pickup_pending: ['Income', 'Expense'], closed: ['Income', 'Expense'], cancelled: ['Expense'] };
export const moneyTypesFor = (status) => TYPES_BY_STATUS[status] || ['Income', 'Expense'];
const TYPE_NOTE = {
  booking_pending: 'A booking can only receive money (income).', booked: 'A booking can only receive money (income).',
  pending: 'While the delivery waits for approval only money received can be added.', active: 'While the vehicle is out with the customer only money received can be added. Refunds can be added from the pickup onwards.',
  cancelled: 'This record is cancelled, so money can only be paid back (an expense).',
};
const INCOME_FOR = ['Rent', 'Extension', 'Balance', 'Deposit', 'Other charges'];
const EXPENSE_FOR = ['Refundable Deposit', 'Fuel', 'Repair', 'Other charges'];
export function openMoneyForm({ delivery = null, preset = null, onDone }) {
  const ctx = { status: delivery?.status || null };
  const type = select([{ value: 'Income', label: 'Income (money received)' }, { value: 'Expense', label: 'Expense (money paid out)' }]);
  const fType = field('Type', type);
  const typeNote = h('p', { class: 'muted small' });
  const other = !delivery;          // money that does not belong to a delivery: a category and sub category from the Admin's list
  const catSel = select([]); const fCat = field('Category', catSel, { required: true }); const subSel = select([]); const fSub = field('Sub category', subSel, { required: true });
  const payHost = h('div'); let pay = null, builtKey = null, usedPreset = false;
  const formId = 'mn-form'; const submit = submitBtn('Save', formId);
  const fillCats = () => { const cats = categoriesFor(type.value); catSel.replaceChildren(h('option', { value: '' }, cats.length ? 'Choose a category' : 'No categories yet'), ...cats.map(c => h('option', { value: c.label, dataset: { id: String(c.id) } }, c.label))); fillSubs(); };
  const fillSubs = () => { const id = Number(catSel.selectedOptions[0]?.dataset?.id); const subs = id ? subCategoriesOf(id) : []; subSel.replaceChildren(h('option', { value: '' }, 'Choose a sub category'), ...subs.map(c => h('option', { value: c.label }, c.label))); fSub.hidden = !subs.length; };
  catSel.addEventListener('change', () => { fCat.setError(''); fillSubs(); });
  function apply() {
    const types = moneyTypesFor(ctx.status);
    if (!types.includes(type.value)) type.value = types[0];
    if (!usedPreset && preset?.type && types.includes(preset.type)) type.value = preset.type;
    fType.hidden = types.length === 1; typeNote.textContent = TYPE_NOTE[ctx.status] || ''; typeNote.hidden = !TYPE_NOTE[ctx.status];
    const bookingIn = ['booking_pending', 'booked'].includes(ctx.status), refund = ctx.status === 'cancelled';
    const key = `${type.value}|${ctx.status}`; if (key === builtKey) return; builtKey = key;
    if (other) fillCats();
    const purposes = other ? ['Other'] : bookingIn ? ['Booking advance'] : refund ? ['Booking refund'] : type.value === 'Income' ? INCOME_FOR : EXPENSE_FOR;
    const first = (!usedPreset && preset?.purpose) || (bookingIn || refund ? purposes[0] : '');
    pay = paymentsEditor({ title: type.value === 'Income' ? 'Payment received' : 'Amount', purposes, first, firstAmount: (!usedPreset && preset?.amount) || '', max: 1, optional: false, lockPurpose: other || bookingIn || refund, type: type.value, breakup: !other && type.value === 'Income' && !bookingIn,
      hint: other ? 'Money that is not part of a delivery. Delivery payments are added from the delivery, pickup, extension or swap itself.' : bookingIn ? 'Money received to hold the booking. It counts towards the delivery total.' : refund ? 'Money paid back to the customer. It cannot be more than the booking advance received.' : 'Non-cash payments need the transaction id and a screenshot or receipt photo.' });
    usedPreset = true; mount(payHost, pay.el);
  }
  type.addEventListener('change', apply);
  apply();
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: async (ev) => { ev.preventDefault();
    fCat.setError(''); fSub.setError(''); let okc = true;
    if (other) { if (!catSel.value) { fCat.setError('Choose a category.'); okc = false; } if (!fSub.hidden && !subSel.value) { fSub.setError('Choose a sub category.'); okc = false; } }
    if (!pay.validate() || !okc) return;
    busy(submit, async () => { try {
      const did = delivery?.id || null;
      let lines = await pay.collect(`money/${folderId()}`);
      if (other) lines = lines.map(l => ({ ...l, purpose: catSel.value, category: catSel.value, sub_category: fSub.hidden ? null : subSel.value }));
      await rpc('add_money_many', { p: { entry_type: type.value, delivery_id: did, lines } });
      toast('Saved'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, fType, typeNote, other ? fCat : null, other ? fSub : null, payHost);
  const title = !delivery ? 'Add other income or expense' : preset?.purpose === 'Refundable Deposit' ? 'Refund the deposit' : ctx.status === 'cancelled' ? 'Refund the booking amount' : ['booking_pending', 'booked'].includes(ctx.status) ? 'Receive booking amount' : 'Add a payment';
  const s = openSheet({ title, subtitle: delivery?.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}

export function openTransferForm({ onDone }) {
  const to = select(userOptions({ blank: true }).filter(o => o.value !== state.me.id)); const fTo = field('Hand to', to, { required: true, hint: 'They must acknowledge that they received it.' });
  const amt = moneyInput(); const fAmt = field('Amount', amt, { required: true }); const note = input({ placeholder: 'Optional note' });
  const formId = 'tr-form'; const submit = submitBtn('Save', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = checkMoney(fAmt, amt, { required: true }); if (!to.value) { fTo.setError('Choose a person.'); ok = false; } if (!ok) return;
    busy(submit, async () => { try { await rpc('create_transfer', { p_kind: 'user', p_to_user: to.value, p_amount: num(amt.value), p_note: note.value });
      toast('Saved. They need to acknowledge it.'); s.close(); onDone?.(); } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, fTo, fAmt, field('Note', note));
  const s = openSheet({ title: 'Hand over cash', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}
