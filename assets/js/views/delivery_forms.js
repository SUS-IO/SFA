// Forms for everything that happens to a delivery.
import { h, icon, btn, busy, field, input, textarea, select, sectionBlock, openSheet, toast, mount, friendlyError, fmtMoney, num, localInputValue, isoFromLocal, fmtDateTimeY } from '../core/ui.js';
import { rpc, sb, fetchAll } from '../core/supa.js';
import { state, activeLocations, whoName } from '../core/store.js';
import { paymentsEditor, userOptions, VIAS } from '../core/payments.js';
import { customerPicker, vehiclePicker, helmetChips, readyHelmets } from '../core/pickers.js';
import { multiPhotoField, photoPath, uploadPhoto } from '../core/images.js';

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

// ---------------------------------------------------------------------------------------------
// New delivery, new booking, or hand over a booking.
//   mode: 'deliver' | 'booking';  booking: an existing booked delivery row (with .customer)
export function openDeliveryForm({ mode = 'deliver', booking = null, onDone }) {
  const isBooking = mode === 'booking';
  const cust = customerPicker({ fixed: booking?.customer || null });
  const secs = [cust.el];
  let helmets = null, vehicle = null, total = null, paySum = 0, billEl = null;
  const get = {};

  if (isBooking) {
    const when = input({ type: 'datetime-local', value: localInputValue(new Date(Date.now() + 86400000)) });
    const fWhen = field('Planned delivery', when, { required: true });
    const modelSel = select([{ value: '', label: 'Not decided' }, ...state.models.filter(m => m.active).map(m => ({ value: String(m.id), label: m.name }))]);
    const note = textarea({ rows: '2', placeholder: 'Anything to remember, for example the address or the customer\'s request' });
    secs.push(h('div', { class: 'grid-2' }, fWhen, field('Model wanted', modelSel)), field('Booking note', note));
    Object.assign(get, { when, fWhen, modelSel, note });
  } else {
    vehicle = vehiclePicker({ label: 'Vehicle' });
    const place = input({ placeholder: 'Where it is being delivered, for example Anna Nagar' });
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
    total = h('div', { class: 'total-box' });
    const recalc = () => { const t = num(rent.value) + num(dep.value) + num(dch.value) + num(apc.value);
      mount(total, h('span', 'Total amount'), h('strong', fmtMoney(t)), h('small', 'Rent + deposit + delivery charges + advance pickup charges'));
      if (billEl) billEl.textContent = t ? `Balance to collect: ${fmtMoney(Math.max(0, t + num(oa.value) - paySum))}` : ''; };
    [rent, dep, dch, apc, oa].forEach(i => i.addEventListener('input', recalc)); recalc();
    secs.push(vehicle.el, sectionBlock('Helmets', h('div', { id: 'helmet-slot' }, h('p', { class: 'muted small' }, 'Loading helmets…'))),
      sectionBlock('Delivery', h('div', { class: 'grid-2' }, field('Delivered to', place), field('Delivery time', at)), fDays),
      sectionBlock('Charges', h('div', { class: 'grid-2' }, fRent, fDep), h('div', { class: 'grid-2' }, fDch, fApc), total,
        h('div', { class: 'grid-2' }, field('Other charge for', ot), fOa)),
      sectionBlock('Kilometres', km.el, h('div', { class: 'grid-2' }, fX, fOdo)), photos.el, field('Note', note));
    Object.assign(get, { place, at, days, fDays, rent, fRent, dep, fDep, dch, fDch, apc, fApc, km, xrate, fX, odo, fOdo, ot, oa, fOa, photos, note });
  }

  const pay = paymentsEditor({ title: isBooking ? 'Advance received' : 'Payments received', purposes: isBooking ? ['Booking Advance'] : ['Rent', 'Deposit', 'Delivery charges'], first: isBooking ? 'Booking Advance' : 'Rent',
    onTotal: (t) => { paySum = t; if (billEl) get.rent && get.rent.dispatchEvent(new Event('input')); } });
  billEl = h('p', { class: 'bill-line' });
  secs.push(pay.el, billEl);
  if (!isBooking) get.rent.dispatchEvent(new Event('input'));

  const formId = 'dl-form';
  const submit = submitBtn(isBooking ? 'Save booking' : 'Hand over', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true;
    if (!cust.value()) { cust.setError('Choose the customer.'); ok = false; }
    if (isBooking) {
      if (!get.when.value) { get.fWhen.setError('Enter the planned date and time.'); ok = false; }
    } else {
      if (!vehicle.value()) { vehicle.setError('Choose a vehicle.'); ok = false; }
      ok = checkWhole(get.fDays, get.days, { min: 1, label: 'the days' }) && ok;
      ok = checkMoney(get.fRent, get.rent, { required: true }) && ok;
      [[get.fDep, get.dep], [get.fDch, get.dch], [get.fApc, get.apc], [get.fOa, get.oa]].forEach(([f, i]) => { ok = checkMoney(f, i) && ok; });
      ok = get.km.validate() && ok;
      ok = checkMoney(get.fX, get.xrate, { required: true }) && ok;
      ok = checkWhole(get.fOdo, get.odo, { label: 'the reading' }) && ok;
      if (num(get.oa.value) > 0 && !get.ot.value.trim()) { get.fOa.setError('Say what the other charge is for.'); ok = false; }
    }
    if (!pay.validate()) ok = false;
    if (!ok) { form.querySelector('.has-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    busy(submit, async () => {
      try {
        const folder = `deliveries/${folderId()}`;
        const payments = await pay.collect(`${folder}/receipts`);
        let id;
        if (isBooking) {
          id = await rpc('create_delivery', { p: { mode: 'booking', customer_id: cust.value().id, booking_for: isoFromLocal(get.when.value), model_id: get.modelSel.value || null, booking_note: get.note.value, payments } });
        } else {
          const photos = await uploadAll(get.photos, folder, 'vehicle');
          const body = { customer_id: cust.value().id, vehicle_id: vehicle.value().id, helmet_ids: helmets ? helmets.values() : [], delivery_place: get.place.value, delivered_at: isoFromLocal(get.at.value),
            days: get.days.value.trim(), rent: get.rent.value.trim(), deposit: get.dep.value.trim(), delivery_charges: get.dch.value.trim(), advance_pickup_charges: get.apc.value.trim(),
            km_limit_per_day: get.km.value(), extra_km_rate: get.xrate.value.trim(), odometer_out: get.odo.value.trim(), other_charges_text: get.ot.value, other_charges_amount: get.oa.value.trim(), note: get.note.value, photos, payments };
          if (booking) { await rpc('deliver_booking', { p_id: booking.id, p: body }); id = booking.id; }
          else id = await rpc('create_delivery', { p: { mode: 'deliver', ...body } });
        }
        toast(isBooking ? 'Booking saved' : 'Delivery saved. It now waits for approval.'); s.close(); onDone?.(id);
      } catch (e) { toast(friendlyError(e), 'error'); }
    });
  } } }, secs);
  const s = openSheet({ title: isBooking ? 'New booking' : booking ? 'Hand over booking' : 'New delivery', subtitle: booking?.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
  if (!isBooking) readyHelmets().then(items => { helmets = helmetChips({ label: 'Helmets given', items, hint: 'Only helmets at an Office are listed.' }); mount(form.querySelector('#helmet-slot'), helmets.el); })
    .catch(() => { helmets = { values: () => [] }; mount(form.querySelector('#helmet-slot'), h('p', { class: 'muted small' }, 'Could not load helmets.')); });
  return s;
}

// ---------------------------------------------------------------------------------------------
export function openExtendForm({ delivery, onDone }) {
  const days = wholeInput('1'); const fDays = field('Extra days', days, { required: true });
  const rate = moneyInput(); const fRate = field('Rent per day', rate, { required: true, hint: 'Type the rent for one day.' });
  const note = textarea({ rows: '2' });
  const calc = h('div', { class: 'total-box' });
  const upd = () => { const d = Number(days.value) || 0; const r = num(rate.value);
    mount(calc, h('span', 'Extension rent'), h('strong', fmtMoney(d * r)), h('small', d ? `New return date: ${fmtDateTimeY(new Date(new Date(delivery.return_due).getTime() + d * 86400000))}` : `Current return date: ${fmtDateTimeY(delivery.return_due)}`)); };
  days.addEventListener('input', upd); rate.addEventListener('input', upd); upd();
  const pay = paymentsEditor({ title: 'Payment received for the extension', purposes: ['Extension'], first: 'Extension' });
  const formId = 'ext-form'; const submit = submitBtn('Save extension', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = checkWhole(fDays, days, { min: 1, label: 'the extra days' }); ok = checkMoney(fRate, rate, { required: true }) && ok; if (!pay.validate()) ok = false;
    if (!ok) return;
    busy(submit, async () => { try {
      const payments = await pay.collect(`deliveries/${folderId()}/receipts`);
      await rpc('extend_delivery', { p_delivery: delivery.id, p_extra_days: Number(days.value), p_rent_per_day: num(rate.value), p_payments: payments, p_note: note.value });
      toast('Extension saved. It waits for approval.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, h('div', { class: 'grid-2' }, fDays, fRate), calc, field('Note', note), pay.el);
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
  } } }, h('p', { class: 'muted' }, 'The person you choose will do the swap and add the details. It then needs approval.'), fWho, field('Reason', why));
  const s = openSheet({ title: 'Assign a swap', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
}

export function openDoSwap({ swap, delivery, onDone }) {
  const nv = vehiclePicker({ label: 'New vehicle', excludeId: delivery.vehicle_id });
  const where = select([{ value: '', label: 'Choose a place' }, ...activeLocations().map(l => ({ value: String(l.id), label: `${l.name} (${l.type})` }))]); const fWhere = field('Where was the old vehicle taken', where, { required: true });
  const oin = wholeInput(); const fIn = field('Old vehicle reading now', oin, { required: true, hint: `It left at ${delivery.odometer_out} km.` });
  const onew = wholeInput(); const fNew = field('New vehicle reading', onew, { required: true });
  const photos = multiPhotoField({ label: 'Photos', max: 6 }); const note = textarea({ rows: '2' });
  const pay = paymentsEditor({ title: 'Payment received for the swap', purposes: ['Swap charge'], first: 'Swap charge' });
  const formId = 'swp-form'; const submit = submitBtn('Save swap', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; if (!nv.value()) { nv.setError('Choose the new vehicle.'); ok = false; } if (!where.value) { fWhere.setError('Choose a place.'); ok = false; }
    ok = checkWhole(fIn, oin, { label: 'the reading' }) && ok; ok = checkWhole(fNew, onew, { label: 'the reading' }) && ok; if (!pay.validate()) ok = false; if (!ok) return;
    busy(submit, async () => { try {
      const folder = `swaps/${folderId()}`; const payments = await pay.collect(`${folder}/receipts`); const photoPaths = await uploadAll(photos, folder, 'swap');
      await rpc('do_swap', { p_id: swap.id, p: { new_vehicle_id: nv.value().id, old_return_location: where.value, odometer_in_old: oin.value.trim(), odometer_out_new: onew.value.trim(), photos: photoPaths, note: note.value, payments } });
      toast('Swap done. It waits for approval.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, nv.el, fWhere, h('div', { class: 'grid-2' }, fIn, fNew), photos.el, field('Note', note), pay.el);
  const s = openSheet({ title: 'Do the swap', subtitle: `${delivery.code}${swap.reason ? `, ${swap.reason}` : ''}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
}

// ---------------------------------------------------------------------------------------------
export function openPickupForm({ delivery, rentalDays, helmetsOut, onDone }) {
  const where = select([{ value: '', label: 'Choose a place' }, ...activeLocations().map(l => ({ value: String(l.id), label: `${l.name} (${l.type})` }))]); const fWhere = field('Vehicle is returned to', where, { required: true });
  const at = input({ type: 'datetime-local', value: localInputValue() });
  const odo = wholeInput(); const fOdo = field('Odometer reading now', odo, { required: true, hint: `It was ${delivery.odometer_out} km when it went out.` });
  const hel = helmetChips({ label: 'Helmets returned', items: helmetsOut.map(x => ({ id: x.helmet_id, code: x.code })), checked: helmetsOut.map(x => x.helmet_id), hint: 'Untick any helmet that was not returned.' });
  const calc = h('div', { class: 'total-box' });
  const ot = input({ placeholder: 'For example Scratch on tank' }); const oa = moneyInput(); const fOa = field('Other charge amount', oa);
  const cond = textarea({ rows: '2', placeholder: 'Condition of the vehicle' }); const photos = multiPhotoField({ label: 'Photos at return', max: 6 });
  const refund = moneyInput(); const fRef = field('Deposit refund', refund, { hint: `Deposit taken: ${fmtMoney(delivery.deposit)}` });
  const refVia = select(VIAS.map(v => ({ value: v, label: v }))); const refHolder = select(userOptions({ blank: true }), { value: state.me.id }); const fRefHolder = field('Cash paid out by', refHolder, { hint: 'The person who hands over the cash.' });
  refVia.addEventListener('change', () => { fRefHolder.hidden = refVia.value !== 'Cash'; });
  const pay = paymentsEditor({ title: 'Payments received now', purposes: ['Extra km', 'Balance'], first: 'Balance' });
  const state_ = { xkm: 0, xchg: 0, kmUsed: 0 };
  const upd = () => {
    const oin = Number(odo.value); const used = Number.isFinite(oin) && odo.value.trim() ? delivery.km_before_current + (oin - delivery.odometer_out) : 0;
    const allowed = delivery.km_limit_per_day * rentalDays; const xkm = Math.max(0, used - allowed); const xchg = Math.round(xkm * num(delivery.extra_km_rate) * 100) / 100;
    Object.assign(state_, { xkm, xchg, kmUsed: used });
    mount(calc, h('span', 'Extra km charge'), h('strong', fmtMoney(xchg)),
      h('small', odo.value.trim() ? `${used} km used, ${allowed} km allowed (${rentalDays} day${rentalDays === 1 ? '' : 's'} x ${delivery.km_limit_per_day}). ${xkm} km extra at ${fmtMoney(delivery.extra_km_rate)} per km.` : `Allowed: ${allowed} km (${rentalDays} day${rentalDays === 1 ? '' : 's'} x ${delivery.km_limit_per_day} km).`));
    const sugg = Math.max(0, num(delivery.deposit) - xchg - num(oa.value)); refund.placeholder = String(sugg);
  };
  odo.addEventListener('input', upd); oa.addEventListener('input', upd); upd();
  const formId = 'pk-form'; const submit = submitBtn('Save pickup', formId);
  const form = h('form', { id: formId, class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
    let ok = true; if (!where.value) { fWhere.setError('Choose a place.'); ok = false; }
    ok = checkWhole(fOdo, odo, { label: 'the reading' }) && ok; ok = checkMoney(fOa, oa) && ok; ok = checkMoney(fRef, refund) && ok;
    if (num(oa.value) > 0 && !ot.value.trim()) { fOa.setError('Say what the other charge is for.'); ok = false; }
    if (num(refund.value) > num(delivery.deposit)) { fRef.setError(`The refund cannot be more than the deposit (${fmtMoney(delivery.deposit)}).`); ok = false; }
    if (num(refund.value) > 0 && refVia.value === 'Cash' && !refHolder.value) { fRefHolder.setError('Choose who pays out the cash.'); ok = false; }
    if (!pay.validate()) ok = false; if (!ok) return;
    busy(submit, async () => { try {
      const folder = `pickups/${folderId()}`; const payments = await pay.collect(`${folder}/receipts`); const photoPaths = await uploadAll(photos, folder, 'return');
      await rpc('create_pickup', { p_delivery: delivery.id, p: { return_location_id: where.value, returned_at: isoFromLocal(at.value), odometer_in: odo.value.trim(), helmet_ids: hel.values(),
        other_charges_text: ot.value, other_charges_amount: oa.value.trim(), condition_note: cond.value, photos: photoPaths, payments,
        refund_amount: num(refund.value) > 0 ? String(num(refund.value)) : '', refund_via: refVia.value, refund_cash_user: refVia.value === 'Cash' ? refHolder.value : null } });
      toast('Pickup saved. It waits for approval.'); s.close(); onDone?.();
    } catch (e) { toast(friendlyError(e), 'error'); } });
  } } }, h('div', { class: 'grid-2' }, fWhere, field('Return time', at)), fOdo, calc, hel.el,
    sectionBlock('Other charges', h('div', { class: 'grid-2' }, field('Other charge for', ot), fOa)), field('Condition', cond), photos.el, pay.el,
    sectionBlock('Deposit refund', h('div', { class: 'grid-2' }, fRef, field('Paid by', refVia)), fRefHolder, h('p', { class: 'muted small' }, 'Type the amount you are giving back. It is saved as an expense for this delivery.')));
  refVia.dispatchEvent(new Event('change'));
  const s = openSheet({ title: 'Pick up the vehicle', subtitle: delivery.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
}

// ---------------------------------------------------------------------------------------------
// A single payment: on a delivery, or on its own.   opts: { delivery?: row, onDone }
export function openMoneyForm({ delivery = null, onDone }) {
  const type = select([{ value: 'Income', label: 'Income (money received)' }, { value: 'Expense', label: 'Expense (money paid out)' }]);
  const dlSel = delivery ? null : input({ placeholder: 'Delivery number, for example DL0000012 (optional)' });
  const pay = paymentsEditor({ title: 'Amount', purposes: ['Rent', 'Fuel', 'Repair', 'Cancellation refund', 'Other'], first: '', max: 1, optional: false });
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
  const s = openSheet({ title: delivery ? 'Add a payment' : 'Add income or expense', subtitle: delivery?.code, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
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
