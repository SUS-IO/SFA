// Forms for everything that happens to a delivery.
import { h, icon, btn, busy, field, input, textarea, select, sectionBlock, openSheet, toast, mount, friendlyError, fmtMoney, num, localInputValue, isoFromLocal, fmtDateTimeY } from '../core/ui.js';
import { rpc, sb, fetchAll } from '../core/supa.js';
import { state, activeLocations, whoName } from '../core/store.js';
import { paymentsEditor, userOptions, VIAS } from '../core/payments.js';
import { customerPicker, vehiclePicker, helmetChips, readyHelmets } from '../core/pickers.js';
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


// Four mandatory side photos (front, back, left, right) for one vehicle.
function sidePhotos(title) {
  const sides = [['front', 'Front'], ['back', 'Back'], ['left', 'Left side'], ['right', 'Right side']];
  const pf = Object.fromEntries(sides.map(([k, l]) => [k, photoField({ label: l, required: true })]));
  const el = h('section', { class: 'form-section' }, h('h3', title), h('p', { class: 'muted small' }, 'Photos of all four sides are required.'),
    h('div', { class: 'photo-grid two' }, sides.map(([k]) => pf[k].el)));
  return {
    el,
    validate() { let ok = true; for (const [k] of sides) { if (!pf[k].picked()) { pf[k].setError('Add this photo.'); ok = false; } else pf[k].setError(''); } return ok; },
    async collect(folder, tag) { const o = {}; for (const [k] of sides) { const it = pf[k].picked(); o[k] = await uploadPhoto(photoPath(folder, `${tag}-${k}`, it.type), it.blob); } return o; },
  };
}

// ---------------------------------------------------------------------------------------------
// New booking (text only), or a delivery: a walk-in, or the hand-over of an approved booking.
//   mode: 'deliver' | 'booking';  booking: an approved booking row
export function openDeliveryForm({ mode = 'deliver', booking = null, onDone }) {
  const isBooking = mode === 'booking';
  const formId = 'dl-form';
  const submit = submitBtn(isBooking ? 'Save booking' : 'Hand over', formId);
  let s;

  if (isBooking) {
    const text = textarea({ rows: '4', placeholder: 'Customer name and basic contact details, for example:\nRavi Kumar, 98765 43210' });
    const fText = field('Customer name and contact details', text, { required: true, hint: 'Just type it. The customer record is created later, when the vehicle is handed over.' });
    const when = input({ type: 'datetime-local', value: localInputValue(new Date(Date.now() + 86400000)) });
    const fWhen = field('Planned delivery', when, { required: true });
    const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
      let ok = true; if (text.value.trim().length < 3) { fText.setError('Write the name and contact details.'); ok = false; } else fText.setError('');
      if (!when.value) { fWhen.setError('Enter the planned date and time.'); ok = false; } else fWhen.setError('');
      if (!ok) return;
      busy(submit, async () => { try {
        const id = await rpc('create_booking', { p: { booking_text: text.value.trim(), booking_for: isoFromLocal(when.value) } });
        toast('Booking saved. An approver must approve it.'); s.close(); onDone?.(id);
      } catch (e) { toast(friendlyError(e), 'error'); } });
    } } }, fText, fWhen, h('p', { class: 'muted small' }, 'A new booking waits for an Approver (or above) before anything else can be done with it.'));
    s = openSheet({ title: 'New booking', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
    return s;
  }

  const cust = customerPicker({});
  let helmets = null, paySum = 0;
  const vehicle = vehiclePicker({ label: 'Vehicle' });
  const place = input({ placeholder: 'Area or place, for example Anna Nagar' }); const fPlace = field('Delivery location / area', place, { required: true, hint: 'Type it. Nothing is filled in for you.' });
  const addr = textarea({ rows: '2', placeholder: 'Where the customer is staying now' }); const fAddr = field('Customer\'s current address', addr, { required: true, hint: 'Customers move often. This is recorded for this delivery.' });
  const at = input({ type: 'datetime-local', value: localInputValue() });
  const days = wholeInput('1'); const fDays = field('Number of days', days, { required: true });
  const rent = moneyInput(); const fRent = field('Rent (total)', rent, { required: true, hint: 'Type the rent for the whole period.' });
  const dep = moneyInput(); const fDep = field('Deposit', dep);
  const dch = moneyInput(); const fDch = field('Delivery charges', dch);
  const apc = moneyInput(); const fApc = field('Advance pickup charges', apc);
  const km = kmLimitField(); const xrate = moneyInput(); const fX = field('Extra km rate (per km)', xrate, { required: true });
  const odo = wholeInput(); const fOdo = field('Odometer reading', odo, { required: true });
  const ot = input({ placeholder: 'For example Helmet damage cover' }); const oa = moneyInput(); const fOa = field('Other charge amount', oa);
  const photos = multiPhotoField({ label: 'Vehicle photos at delivery', max: 6 });
  const note = textarea({ rows: '2', placeholder: 'Anything to remember' });
  const total = h('div', { class: 'total-box' }); const billEl = h('p', { class: 'bill-line' });
  const charged = () => num(rent.value) + num(dep.value) + num(dch.value) + num(apc.value) + num(oa.value);
  const recalc = () => {
    const t = num(rent.value) + num(dep.value) + num(dch.value) + num(apc.value);
    mount(total, h('span', 'Total amount'), h('strong', fmtMoney(t)), h('small', 'Rent + deposit + delivery charges + advance pickup charges'));
    const diff = charged() - paySum;
    billEl.className = 'bill-line' + (diff === 0 && charged() > 0 ? ' ok' : ' due');
    billEl.textContent = charged() === 0 ? '' : diff === 0 ? `Amount received equals the amount charged (${fmtMoney(charged())}).` : diff > 0 ? `Still to receive: ${fmtMoney(diff)}. The amount received must equal the amount charged (${fmtMoney(charged())}).` : `Received ${fmtMoney(-diff)} too much. The amount received must equal the amount charged (${fmtMoney(charged())}).`;
  };
  [rent, dep, dch, apc, oa].forEach(i => i.addEventListener('input', recalc));
  const pay = paymentsEditor({ title: 'Payments received', purposes: ['Rent', 'Deposit', 'Delivery charges'], first: 'Rent', hint: 'The total received must equal the total amount charged. Split it over as many lines as you need. UPI, online, card and bank payments need a receipt photo.',
    onTotal: (t) => { paySum = t; recalc(); } });
  recalc();

  const secs = [];
  if (booking) secs.push(h('div', { class: 'callout' }, icon('info', 18), h('span', null, h('strong', `Booking ${booking.code}: `), h('span', { class: 'prewrap' }, booking.booking_text || ''))));
  secs.push(cust.el, vehicle.el, sectionBlock('Helmets', h('div', { id: 'helmet-slot' }, h('p', { class: 'muted small' }, 'Loading helmets…'))),
    sectionBlock('Delivery', fPlace, fAddr, h('div', { class: 'grid-2' }, field('Delivery time', at), fDays)),
    sectionBlock('Charges', h('div', { class: 'grid-2' }, fRent, fDep), h('div', { class: 'grid-2' }, fDch, fApc), total,
      h('div', { class: 'grid-2' }, field('Other charge for', ot), fOa)),
    sectionBlock('Kilometres', km.el, h('div', { class: 'grid-2' }, fX, fOdo)), photos.el, field('Note', note), pay.el, billEl);

  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true;
    if (!cust.value()) { cust.setError('Choose the customer, or create them now.'); ok = false; }
    if (!vehicle.value()) { vehicle.setError('Choose a vehicle.'); ok = false; }
    if (!place.value.trim()) { fPlace.setError('Type the delivery location or area.'); ok = false; } else fPlace.setError('');
    if (!addr.value.trim()) { fAddr.setError('Enter the customer\'s current address.'); ok = false; } else fAddr.setError('');
    ok = checkWhole(fDays, days, { min: 1, label: 'the days' }) && ok;
    ok = checkMoney(fRent, rent, { required: true }) && ok;
    [[fDep, dep], [fDch, dch], [fApc, apc], [fOa, oa]].forEach(([f, i]) => { ok = checkMoney(f, i) && ok; });
    ok = km.validate() && ok;
    ok = checkMoney(fX, xrate, { required: true }) && ok;
    ok = checkWhole(fOdo, odo, { label: 'the reading' }) && ok;
    if (num(oa.value) > 0 && !ot.value.trim()) { fOa.setError('Say what the other charge is for.'); ok = false; }
    if (!pay.validate()) ok = false;
    if (Math.abs(charged() - paySum) > 0.001) { toast('The amount received must equal the amount charged.', 'error'); ok = false; }
    if (!ok) { form.querySelector('.has-error, .field-error:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    busy(submit, async () => {
      try {
        const folder = `deliveries/${folderId()}`;
        const payments = await pay.collect(`${folder}/receipts`);
        const ph = await uploadAll(photos, folder, 'vehicle');
        const body = { customer_id: cust.value().id, vehicle_id: vehicle.value().id, helmet_ids: helmets ? helmets.values() : [], delivery_place: place.value.trim(), current_address: addr.value.trim(), delivered_at: isoFromLocal(at.value),
          days: days.value.trim(), rent: rent.value.trim(), deposit: dep.value.trim(), delivery_charges: dch.value.trim(), advance_pickup_charges: apc.value.trim(),
          km_limit_per_day: km.value(), extra_km_rate: xrate.value.trim(), odometer_out: odo.value.trim(), other_charges_text: ot.value, other_charges_amount: oa.value.trim(), note: note.value, photos: ph, payments };
        let id;
        if (booking) { await rpc('deliver_booking', { p_id: booking.id, p: body }); id = booking.id; }
        else id = await rpc('create_delivery', { p: { mode: 'deliver', ...body } });
        toast('Delivery saved. An approver will review it, then confirm the handover.'); s.close(); onDone?.(id);
      } catch (e) { toast(friendlyError(e), 'error'); }
    });
  } } }, secs);
  s = openSheet({ title: booking ? 'Hand over booking' : 'New delivery', subtitle: booking?.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
  readyHelmets().then(items => { helmets = helmetChips({ label: 'Helmets given', items, hint: 'Only helmets at an Office are listed.' }); mount(form.querySelector('#helmet-slot'), helmets.el); })
    .catch(() => { helmets = { values: () => [] }; mount(form.querySelector('#helmet-slot'), h('p', { class: 'muted small' }, 'Could not load helmets.')); });
  return s;
}

// ---------------------------------------------------------------------------------------------
// Extension: pick the new end date, type the flat amount. Payment may come later.
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
  const outP = sidePhotos('Outgoing vehicle: the old bike being returned'); const inP = sidePhotos('Incoming vehicle: the new bike being assigned');
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
export function openPickupForm({ delivery, rentalDays, helmetsOut, onDone }) {
  const place = input({ placeholder: 'Area or place where the vehicle was picked up' }); const fPlace = field('Pickup location / area', place, { required: true, hint: 'Type it. Nothing is filled in for you.' });
  const at = input({ type: 'datetime-local', value: localInputValue() });
  const odo = wholeInput(); const fOdo = field('Odometer reading now', odo, { required: true, hint: `It was ${delivery.odometer_out} km when it went out.` });
  const hel = helmetChips({ label: 'Helmets returned', items: helmetsOut.map(x => ({ id: x.helmet_id, code: x.code })), checked: helmetsOut.map(x => x.helmet_id), hint: 'Untick any helmet that was not returned.' });
  const calc = h('div', { class: 'total-box' });
  const ot = input({ placeholder: 'For example Scratch on tank' }); const oa = moneyInput(); const fOa = field('Other charge amount', oa);
  const cond = textarea({ rows: '2', placeholder: 'Condition of the vehicle' }); const photos = multiPhotoField({ label: 'Photos at return', max: 6 });
  const refund = moneyInput(); const fRef = field('Deposit refund now (optional)', refund, { hint: `Deposit taken: ${fmtMoney(delivery.deposit)}. No cash right now? Leave it empty and refund later from the delivery.` });
  const refVia = select(VIAS.map(v => ({ value: v, label: v }))); const refHolder = select(userOptions({ blank: true }), { value: state.me.id }); const fRefHolder = field('Cash paid out by', refHolder, { hint: 'The person who hands over the cash.' });
  const refPhoto = photoField({ label: 'Refund receipt photo' }); const fRefPhoto = h('div', { class: 'stack-sm' }, refPhoto.el);
  refVia.addEventListener('change', () => { fRefHolder.hidden = refVia.value !== 'Cash'; fRefPhoto.hidden = refVia.value === 'Cash'; });
  const pay = paymentsEditor({ title: 'Payments received now (optional)', purposes: ['Extra km', 'Balance'], first: 'Balance' });
  const state_ = { xkm: 0, xchg: 0, kmUsed: 0 };
  const upd = () => {
    const oin = Number(odo.value); const used = Number.isFinite(oin) && odo.value.trim() ? delivery.km_before_current + (oin - delivery.odometer_out) : 0;
    const allowed = delivery.km_limit_per_day * rentalDays; const xkm = Math.max(0, used - allowed); const xchg = Math.round(xkm * num(delivery.extra_km_rate) * 100) / 100;
    Object.assign(state_, { xkm, xchg, kmUsed: used });
    mount(calc, h('span', 'Extra km charge'), h('strong', fmtMoney(xchg)),
      h('small', odo.value.trim() ? `${used} km used, ${allowed} km allowed (${rentalDays} day${rentalDays === 1 ? '' : 's'} x ${delivery.km_limit_per_day}). ${xkm} km extra at ${fmtMoney(delivery.extra_km_rate)} per km.` : `Allowed: ${allowed} km (${rentalDays} day${rentalDays === 1 ? '' : 's'} x ${delivery.km_limit_per_day}).`));
    refund.placeholder = String(Math.max(0, num(delivery.deposit) - xchg - num(oa.value)));
  };
  odo.addEventListener('input', upd); oa.addEventListener('input', upd); upd();
  const formId = 'pk-form'; const submit = submitBtn('Send for approval', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; if (!place.value.trim()) { fPlace.setError('Type the pickup location or area.'); ok = false; } else fPlace.setError('');
    ok = checkWhole(fOdo, odo, { label: 'the reading' }) && ok; ok = checkMoney(fOa, oa) && ok; ok = checkMoney(fRef, refund) && ok;
    if (num(oa.value) > 0 && !ot.value.trim()) { fOa.setError('Say what the other charge is for.'); ok = false; }
    if (num(refund.value) > num(delivery.deposit)) { fRef.setError(`The refund cannot be more than the deposit (${fmtMoney(delivery.deposit)}).`); ok = false; }
    if (num(refund.value) > 0 && refVia.value === 'Cash' && !refHolder.value) { fRefHolder.setError('Choose who pays out the cash.'); ok = false; }
    if (num(refund.value) > 0 && refVia.value !== 'Cash' && !refPhoto.picked()) { refPhoto.setError('A receipt photo is required for a non-cash refund.'); ok = false; }
    if (!pay.validate()) ok = false; if (!ok) return;
    busy(submit, async () => { try {
      const folder = `pickups/${folderId()}`; const payments = await pay.collect(`${folder}/receipts`); const photoPaths = await uploadAll(photos, folder, 'return');
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
// A single payment: on a delivery, or on its own.   opts: { delivery?: row, preset?: { type, purpose, amount }, onDone }
export function openMoneyForm({ delivery = null, preset = null, onDone }) {
  const type = select([{ value: 'Income', label: 'Income (money received)' }, { value: 'Expense', label: 'Expense (money paid out)' }]);
  if (preset?.type) type.value = preset.type;
  const dlSel = delivery ? null : input({ placeholder: 'Delivery number, for example DL0000012 (optional)' });
  const pay = paymentsEditor({ title: 'Amount', purposes: ['Rent', 'Extension', 'Balance', 'Refundable Deposit', 'Fuel', 'Repair', 'Cancellation refund', 'Other'], first: preset?.purpose || '', firstAmount: preset?.amount || '', max: 1, optional: false, hint: 'Non-cash payments need a receipt photo.' });
  const formId = 'mn-form'; const submit = submitBtn('Save', formId); const fDl = dlSel ? field('Delivery', dlSel, { hint: 'Fill this if the money belongs to a delivery.' }) : null;
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: async (ev) => { ev.preventDefault();
    if (!pay.validate()) return;
    busy(submit, async () => { try {
      let did = delivery?.id || null;
      if (dlSel && dlSel.value.trim()) { const { data } = await sb.from('deliveries').select('id').ilike('code', dlSel.value.trim()).maybeSingle(); if (!data) return fDl.setError('No delivery with that number.'); did = data.id; }
      const [line] = await pay.collect(`money/${folderId()}`);
      await rpc('add_money', { p: { entry_type: type.value, delivery_id: did, ...line } });
      toast('Saved'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, field('Type', type), fDl, pay.el);
  const s = openSheet({ title: delivery ? (preset?.purpose === 'Refundable Deposit' ? 'Refund the deposit' : 'Add a payment') : 'Add income or expense', subtitle: delivery?.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}

export function openTransferForm({ onDone }) {
  const kind = select([{ value: 'user', label: 'Hand cash to a person' }, { value: 'bank', label: 'Deposit cash in the bank' }]);
  const to = select(userOptions({ blank: true }).filter(o => o.value !== state.me.id)); const fTo = field('Hand to', to, { required: true, hint: 'They must acknowledge that they received it.' });
  const amt = moneyInput(); const fAmt = field('Amount', amt, { required: true }); const note = input({ placeholder: 'Optional note, for example bank branch' });
  kind.addEventListener('change', () => { fTo.hidden = kind.value !== 'user'; });
  const formId = 'tr-form'; const submit = submitBtn('Save', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = checkMoney(fAmt, amt, { required: true }); if (kind.value === 'user' && !to.value) { fTo.setError('Choose a person.'); ok = false; } if (!ok) return;
    busy(submit, async () => { try { await rpc('create_transfer', { p_kind: kind.value, p_to_user: kind.value === 'user' ? to.value : null, p_amount: num(amt.value), p_note: note.value });
      toast(kind.value === 'user' ? 'Saved. They need to acknowledge it.' : 'Saved. A bank deposit needs approval.'); s.close(); onDone?.(); } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, field('What are you doing', kind), fTo, fAmt, field('Note', note));
  const s = openSheet({ title: 'Hand over cash', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}
