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

// Standardized 7-photo inspection checklist (Odometer, Front, Rear, Left, Right, Helmet + 6 extra additional pics)
function inspectionPhotos(title) {
  const odo = photoField({ label: 'Odometer Pic', required: true });
  const front = photoField({ label: 'Bike Front Pic', required: true });
  const rear = photoField({ label: 'Bike Rear Pic', required: true });
  const left = photoField({ label: 'Bike Left Pic', required: true });
  const right = photoField({ label: 'Bike Right Pic', required: true });
  const helmet = photoField({ label: 'Helmet Pics', required: true });
  const additional = multiPhotoField({ label: 'Additional Pics (+06 pics extra)', max: 6 });

  const el = h('section', { class: 'form-section' },
    h('h3', title),
    h('p', { class: 'muted small' }, 'Required photos: Odometer, 4 side views, and Helmet.'),
    h('div', { class: 'photo-grid two' }, odo.el, helmet.el),
    h('div', { class: 'photo-grid two' }, front.el, rear.el),
    h('div', { class: 'photo-grid two' }, left.el, right.el),
    additional.el
  );

  return {
    el,
    validate() {
      let ok = true;
      [odo, front, rear, left, right, helmet].forEach(p => {
        if (!p.picked()) { p.setError('Add this photo.'); ok = false; } else p.setError('');
      });
      return ok;
    },
    async collect(folder, tag) {
      const o = {};
      o.odometer = await uploadPhoto(photoPath(folder, `${tag}-odometer`, odo.picked().type), odo.picked().blob);
      o.front = await uploadPhoto(photoPath(folder, `${tag}-front`, front.picked().type), front.picked().blob);
      o.rear = await uploadPhoto(photoPath(folder, `${tag}-rear`, rear.picked().type), rear.picked().blob);
      o.left = await uploadPhoto(photoPath(folder, `${tag}-left`, left.picked().type), left.picked().blob);
      o.right = await uploadPhoto(photoPath(folder, `${tag}-right`, right.picked().type), right.picked().blob);
      o.helmet = await uploadPhoto(photoPath(folder, `${tag}-helmet`, helmet.picked().type), helmet.picked().blob);
      
      const extraPaths = [];
      for (const it of additional.newItems()) {
        extraPaths.push(await uploadPhoto(photoPath(folder, `${tag}-additional`, it.type), it.blob));
      }
      o.additional = extraPaths;
      return o;
    }
  };
}

// ---------------------------------------------------------------------------------------------
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

  // Delivery Handover Location Logic
  const handoverType = select([
    { value: '', label: 'Choose handover method' },
    { value: 'customer_pickup', label: 'Customer came to pick up the bike' },
    { value: 'we_deliver', label: 'We are delivering to the customer' }
  ], { 'aria-label': 'Handover method' });
  const fHandoverType = field('Handover Method', handoverType, { required: true });
  const locationContainer = h('div', { class: 'stack-sm' });
  const fLocationBlock = field('Delivery location / area', locationContainer, { required: true, hint: 'Customer pickup auto-populates last office location from log. Doorstep delivery requires typing address.' });

  handoverType.addEventListener('change', () => {
    const type = handoverType.value;
    locationContainer.replaceChildren();
    const v = vehicle.value();
    if (!v && type) {
      alert('Please select a vehicle first.');
      handoverType.value = '';
      return;
    }
    if (type === 'customer_pickup') {
      const locObj = state.locations.find(l => l.id === v.current_location_id);
      if (!locObj || locObj.type !== 'Office') {
        alert('Error: Vehicle must be at an Office location for customer pickup.');
        handoverType.value = '';
        return;
      }
      locationContainer.append(
        h('div', { class: 'p-3 bg-green-50 border rounded-lg text-sm' },
          h('strong', 'Auto-populated from Log (Office):'),
          h('p', { class: 'text-base font-bold text-green-900 mt-1', id: 'delivery-location-text' }, locObj.name)
        )
      );
    } else if (type === 'we_deliver') {
      const placeInput = input({ placeholder: 'Type delivery address or area, e.g., Anna Nagar', id: 'delivery-location-text' });
      locationContainer.append(placeInput);
    }
  });

  const addr = textarea({ rows: '2', placeholder: 'Where the customer is staying now' }); const fAddr = field('Customer\'s current address', addr, { required: true });
  const at = input({ type: 'datetime-local', value: localInputValue() });
  const days = wholeInput('1'); const fDays = field('Number of days', days, { required: true });
  const rent = moneyInput(); const fRent = field('Rent (total)', rent, { required: true, hint: 'Type the rent for the whole period.' });
  const dep = moneyInput(); const fDep = field('Deposit', dep);
  const dch = moneyInput(); const fDch = field('Delivery charges', dch);
  const apc = moneyInput(); const fApc = field('Advance pickup charges', apc);
  const km = kmLimitField(); const xrate = moneyInput(); const fX = field('Extra km rate (per km)', xrate, { required: true });
  const odo = wholeInput(); const fOdo = field('Odometer reading', odo, { required: true });
  const ot = input({ placeholder: 'For example Helmet damage cover' }); const oa = moneyInput(); const fOa = field('Other charge amount', oa);
  
  const photos = inspectionPhotos('Vehicle inspection photos at delivery');
  const note = textarea({ rows: '2', placeholder: 'Anything to remember' });
  const total = h('div', { class: 'total-box' }); const billEl = h('p', { class: 'bill-line' });
  
  const charged = () => num(rent.value) + num(dep.value) + num(dch.value) + num(apc.value) + num(oa.value);
  const recalc = () => {
    const t = num(rent.value) + num(dep.value) + num(dch.value) + num(apc.value);
    mount(total, h('span', 'Total amount'), h('strong', fmtMoney(t)), h('small', 'Rent + deposit + delivery charges + advance pickup charges'));
    const diff = charged() - paySum;
    billEl.className = 'bill-line' + (diff === 0 && charged() > 0 ? ' ok' : ' due');
    billEl.textContent = charged() === 0 ? '' : diff === 0 ? `Amount received equals the amount charged (${fmtMoney(charged())}).` : diff > 0 ? `Still to receive: ${fmtMoney(diff)}.` : `Received ${fmtMoney(-diff)} too much.`;
  };
  [rent, dep, dch, apc, oa].forEach(i => i.addEventListener('input', recalc));
  
  // Payment editor restricted to Income only during Delivery
  const pay = paymentsEditor({ title: 'Payments received', purposes: ['Rent', 'Deposit', 'Delivery charges', 'Booking Amount'], first: 'Rent', hint: 'All delivery payments are Income received.', onTotal: (t) => { paySum = t; recalc(); } });
  recalc();

  const secs = [];
  if (booking) secs.push(h('div', { class: 'callout' }, icon('info', 18), h('span', null, h('strong', `Booking ${booking.code}: `), h('span', { class: 'prewrap' }, booking.booking_text || ''))));
  secs.push(cust.el, vehicle.el, sectionBlock('Helmets', h('div', { id: 'helmet-slot' }, h('p', { class: 'muted small' }, 'Loading helmets…'))),
    sectionBlock('Delivery', fHandoverType, fLocationBlock, fAddr, h('div', { class: 'grid-2' }, field('Delivery time', at), fDays)),
    sectionBlock('Charges', h('div', { class: 'grid-2' }, fRent, fDep), h('div', { class: 'grid-2' }, fDch, fApc), total,
      h('div', { class: 'grid-2' }, field('Other charge for', ot), fOa)),
    sectionBlock('Kilometres', km.el, h('div', { class: 'grid-2' }, fX, fOdo)), photos.el, field('Note', note), pay.el, billEl);

  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true;
    if (!cust.value()) { cust.setError('Choose the customer, or create them now.'); ok = false; }
    if (!vehicle.value()) { vehicle.setError('Choose a vehicle.'); ok = false; }
    if (!handoverType.value) { fHandoverType.setError('Choose handover method.'); ok = false; }
    
    const locVal = handoverType.value === 'customer_pickup' ? document.getElementById('delivery-location-text')?.textContent?.trim() : document.getElementById('delivery-location-text')?.value?.trim();
    if (!locVal) { fLocationBlock.setError('Specify delivery location.'); ok = false; } else fLocationBlock.setError('');

    if (!addr.value.trim()) { fAddr.setError('Enter customer current address.'); ok = false; } else fAddr.setError('');
    ok = checkWhole(fDays, days, { min: 1, label: 'the days' }) && ok;
    ok = checkMoney(fRent, rent, { required: true }) && ok;
    [[fDep, dep], [fDch, dch], [fApc, apc], [fOa, oa]].forEach(([f, i]) => { ok = checkMoney(f, i) && ok; });
    ok = km.validate() && ok;
    ok = checkMoney(fX, xrate, { required: true }) && ok;
    ok = checkWhole(fOdo, odo, { label: 'the reading' }) && ok;
    if (!photos.validate()) ok = false;
    if (!pay.validate()) ok = false;
    if (!ok) { form.querySelector('.has-error, .field-error:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    
    busy(submit, async () => {
      try {
        const folder = `deliveries/${folderId()}`;
        const payments = await pay.collect(`${folder}/receipts`);
        const ph = await photos.collect(folder, 'vehicle');
        const body = { customer_id: cust.value().id, vehicle_id: vehicle.value().id, helmet_ids: helmets ? helmets.values() : [], delivery_place: locVal, current_address: addr.value.trim(), delivered_at: isoFromLocal(at.value),
          days: days.value.trim(), rent: rent.value.trim(), deposit: dep.value.trim(), delivery_charges: dch.value.trim(), advance_pickup_charges: apc.value.trim(),
          km_limit_per_day: km.value(), extra_km_rate: xrate.value.trim(), odometer_out: odo.value.trim(), other_charges_text: ot.value, other_charges_amount: oa.value.trim(), note: note.value, photos: ph, payments };
        let id;
        if (booking) { await rpc('deliver_booking', { p_id: booking.id, p: body }); id = booking.id; }
        else id = await rpc('create_delivery', { p: { mode: 'deliver', ...body } });
        toast('Delivery saved. An approver will review it.'); s.close(); onDone?.(id);
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
  const amount = moneyInput(); const fAmt = field('Total amount to charge for the extension', amount, { required: true, hint: 'Type final amount.' });
  const note = textarea({ rows: '2' });
  const pay = paymentsEditor({ title: 'Payment received now (optional)', purposes: ['Extension'], first: 'Extension' });
  const formId = 'ext-form'; const submit = submitBtn('Send for approval', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; fEnd.setError('');
    if (!end.value || new Date(isoFromLocal(end.value)) <= due) { fEnd.setError('Choose a date after current return date.'); ok = false; }
    ok = checkMoney(fAmt, amount, { required: true }) && ok; if (!pay.validate()) ok = false;
    if (!ok) return;
    busy(submit, async () => { try {
      const payments = await pay.collect(`deliveries/${folderId()}/receipts`);
      await rpc('extend_delivery', { p_delivery: delivery.id, p_new_end: isoFromLocal(end.value), p_amount: num(amount.value), p_payments: payments, p_note: note.value });
      toast('Extension sent for approval.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, fEnd, fAmt, field('Note', note), pay.el);
  openSheet({ title: 'Extend delivery', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}

// ---------------------------------------------------------------------------------------------
export function openAssignSwap({ delivery, onDone }) {
  const who = select(userOptions({ blank: true })); const fWho = field('Who will do the swap', who, { required: true });
  const why = textarea({ rows: '3', placeholder: 'Why vehicle is being swapped' });
  const formId = 'asg-form'; const submit = submitBtn('Assign swap', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    if (!who.value) return fWho.setError('Choose a person.');
    busy(submit, async () => { try { await rpc('assign_swap', { p_delivery: delivery.id, p_assigned_to: who.value, p_reason: why.value }); toast('Swap assigned'); s.close(); onDone?.(); }
      catch (e) { fWho.setError(friendlyError(e)); } });
  } } }, fWho, field('Reason', why));
  openSheet({ title: 'Assign a swap', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}

export function openDoSwap({ swap, delivery, onDone }) {
  const nv = vehiclePicker({ label: 'New vehicle', excludeId: delivery.vehicle_id });
  const place = input({ placeholder: 'Swap location / area' }); const fPlace = field('Swap location / area', place, { required: true });
  const addr = textarea({ rows: '2', placeholder: 'Customer current address' }); const fAddr = field('Customer current address', addr, { required: true });
  const same = btn('Same as at delivery', { ic: 'copy', small: true, onClick: () => { addr.value = delivery.current_address || ''; fAddr.setError(''); } });
  const oin = wholeInput(); const fIn = field('Old vehicle reading now', oin, { required: true });
  const onew = wholeInput(); const fNew = field('New vehicle reading', onew, { required: true });
  const outP = inspectionPhotos('Outgoing vehicle inspection (old bike)'); 
  const inP = inspectionPhotos('Incoming vehicle inspection (new bike)');
  const note = textarea({ rows: '2' });
  const pay = paymentsEditor({ title: 'Payment received for swap (optional)', purposes: ['Swap charge'], first: 'Swap charge' });
  const formId = 'swp-form'; const submit = submitBtn('Send for approval', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; if (!nv.value()) { nv.setError('Choose new vehicle.'); ok = false; }
    if (!place.value.trim()) { fPlace.setError('Type swap location.'); ok = false; } else fPlace.setError('');
    if (!addr.value.trim()) { fAddr.setError('Enter current address.'); ok = false; } else fAddr.setError('');
    ok = checkWhole(fIn, oin, { label: 'the reading' }) && ok; ok = checkWhole(fNew, onew, { label: 'the reading' }) && ok;
    if (!outP.validate()) ok = false; if (!inP.validate()) ok = false; if (!pay.validate()) ok = false;
    if (!ok) return;
    busy(submit, async () => { try {
      const folder = `swaps/${folderId()}`; const payments = await pay.collect(`${folder}/receipts`);
      const photos_old = await outP.collect(folder, 'old'); const photos_new = await inP.collect(folder, 'new');
      await rpc('do_swap', { p_id: swap.id, p: { new_vehicle_id: nv.value().id, swap_place: place.value.trim(), current_address: addr.value.trim(), odometer_in_old: oin.value.trim(), odometer_out_new: onew.value.trim(), photos_old, photos_new, note: note.value, payments } });
      toast('Swap saved.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, nv.el, fPlace, h('div', { class: 'stack-sm' }, fAddr, same), h('div', { class: 'grid-2' }, fIn, fNew), outP.el, inP.el, field('Note', note), pay.el);
  openSheet({ title: 'Do the swap', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
}

// ---------------------------------------------------------------------------------------------
export function openPickupForm({ delivery, rentalDays, helmetsOut, onDone }) {
  const place = input({ placeholder: 'Pickup location / area' }); const fPlace = field('Pickup location / area', place, { required: true });
  const at = input({ type: 'datetime-local', value: localInputValue() });
  const odo = wholeInput(); const fOdo = field('Odometer reading now', odo, { required: true });
  const hel = helmetChips({ label: 'Helmets returned', items: helmetsOut.map(x => ({ id: x.helmet_id, code: x.code })), checked: helmetsOut.map(x => x.helmet_id) });
  const calc = h('div', { class: 'total-box' });
  const ot = input({ placeholder: 'For example Scratch on tank' }); const oa = moneyInput(); const fOa = field('Other charge amount', oa);
  const cond = textarea({ rows: '2', placeholder: 'Condition of vehicle' }); 
  
  // Pickup stage includes standard 7-photo inspection checklist
  const photos = inspectionPhotos('Vehicle inspection photos at return (pickup)');
  
  const refund = moneyInput(); const fRef = field('Deposit refund now (optional)', refund, { hint: `Deposit taken: ${fmtMoney(delivery.deposit)}.` });
  const refVia = select(VIAS.map(v => ({ value: v, label: v }))); const refHolder = select(userOptions({ blank: true }), { value: state.me.id }); const fRefHolder = field('Cash paid out by', refHolder);
  const refPhoto = photoField({ label: 'Refund receipt photo' }); const fRefPhoto = h('div', { class: 'stack-sm' }, refPhoto.el);
  refVia.addEventListener('change', () => { fRefHolder.hidden = refVia.value !== 'Cash'; fRefPhoto.hidden = refVia.value === 'Cash'; });
  
  // Pickup stage allows both Income and Expense tabs (for refunds / extra charges)
  const pay = paymentsEditor({ title: 'Payments received now (optional)', purposes: ['Extra km', 'Balance'], first: 'Balance' });
  
  const upd = () => {
    const oin = Number(odo.value); const used = Number.isFinite(oin) && odo.value.trim() ? delivery.km_before_current + (oin - delivery.odometer_out) : 0;
    const allowed = delivery.km_limit_per_day * rentalDays; const xkm = Math.max(0, used - allowed); const xchg = Math.round(xkm * num(delivery.extra_km_rate) * 100) / 100;
    mount(calc, h('span', 'Extra km charge'), h('strong', fmtMoney(xchg)), h('small', `${used} km used, ${allowed} allowed.`));
    refund.placeholder = String(Math.max(0, num(delivery.deposit) - xchg - num(oa.value)));
  };
  odo.addEventListener('input', upd); oa.addEventListener('input', upd); upd();
  const formId = 'pk-form'; const submit = submitBtn('Send for approval', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; if (!place.value.trim()) { fPlace.setError('Type pickup location.'); ok = false; } else fPlace.setError('');
    ok = checkWhole(fOdo, odo, { label: 'the reading' }) && ok; ok = checkMoney(fOa, oa) && ok; ok = checkMoney(fRef, refund) && ok;
    if (!photos.validate()) ok = false;
    if (num(refund.value) > num(delivery.deposit)) { fRef.setError(`Refund cannot exceed deposit.`); ok = false; }
    if (!pay.validate()) ok = false; if (!ok) return;
    busy(submit, async () => { try {
      const folder = `pickups/${folderId()}`; const payments = await pay.collect(`${folder}/receipts`); const photoPaths = await photos.collect(folder, 'return');
      let refundReceipt = null; const rp = refPhoto.picked(); if (num(refund.value) > 0 && rp) refundReceipt = await uploadPhoto(photoPath(folder, 'refund', rp.type), rp.blob);
      await rpc('create_pickup', { p_delivery: delivery.id, p: { return_place: place.value.trim(), returned_at: isoFromLocal(at.value), odometer_in: odo.value.trim(), helmet_ids: hel.values(),
        other_charges_text: ot.value, other_charges_amount: oa.value.trim(), condition_note: cond.value, photos: photoPaths, payments,
        refund_amount: num(refund.value) > 0 ? String(num(refund.value)) : '', refund_via: refVia.value, refund_receipt: refundReceipt, refund_cash_user: refVia.value === 'Cash' ? refHolder.value : null } });
      toast('Pickup saved.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, h('div', { class: 'grid-2' }, fPlace, field('Return time', at)), fOdo, calc, hel.el,
    sectionBlock('Other charges', h('div', { class: 'grid-2' }, field('Other charge for', ot), fOa)), field('Condition', cond), photos.el, pay.el,
    sectionBlock('Deposit refund', h('div', { class: 'grid-2' }, fRef, field('Paid by', refVia)), fRefHolder, fRefPhoto));
  
  openSheet({ title: 'Pick up the vehicle', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
}