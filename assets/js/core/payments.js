// Payment lines: purpose, amount, how it was paid, who holds the cash, optional receipt photo.
import { h, icon, btn, field, input, select, fmtMoney, num, toast } from './ui.js';
import { state, whoName } from './store.js';
import { photoField, photoPath, uploadPhoto } from './images.js';

export const VIAS = ['Cash', 'UPI', 'Online', 'Card', 'Bank Transfer', 'Cheque'];
const MONEY_RE = /^\d+(\.\d{1,2})?$/;

export function userOptions({ blank = false } = {}) {
  return [...(blank ? [{ value: '', label: 'Choose a person' }] : []),
    ...state.profiles.filter(p => p.active).map(p => ({ value: p.id, label: `${p.user_name} (${p.user_id})${p.id === state.me.id ? ', you' : ''}` }))];
}

function line({ purpose, suggestions, onChange, onRemove, amount: startAmount = '' }) {
  const dl = h('datalist', { id: 'pl-' + Math.random().toString(36).slice(2, 7) }, suggestions.map(s => h('option', { value: s })));
  const fPurpose = field('For', input({ value: purpose, list: dl.id, placeholder: 'For example Booking Amount or Rent' }), { required: true });
  const amount = input({ inputmode: 'decimal', placeholder: '0', value: startAmount === '' ? '' : String(startAmount) });
  const fAmount = field('Amount', amount, { required: true });
  const via = select(VIAS.map(v => ({ value: v, label: v })), { 'aria-label': 'Paid by' });
  const fVia = field('Paid by', via);
  const holder = select(userOptions({ blank: true }), { value: state.me.id, 'aria-label': 'Cash held by' });
  const fHolder = field('Cash held by', holder, { required: true, hint: 'The person who has this cash.' });
  const photo = photoField({ label: 'Receipt photo' });
  const viaNote = input({ placeholder: 'For example Company UPI QR' });
  const fNote = field('Paid into / reference', viaNote);
  const sum = h('summary', 'Add a receipt photo (optional)');
  const rcptErr = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const det = h('details', { class: 'receipt-det' }, sum, photo.el, rcptErr);
  const el = h('div', { class: 'pay-line' }, dl,
    h('div', { class: 'grid-2' }, fPurpose, fAmount), h('div', { class: 'grid-2' }, fVia, fHolder), fNote, det,
    onRemove ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm pay-x', on: { click: onRemove } }, icon('x', 16), h('span', 'Remove this line')) : null);
  const sync = () => {
    const cash = via.value === 'Cash'; fHolder.hidden = !cash; fNote.hidden = cash;
    sum.textContent = cash ? 'Add a receipt photo (optional)' : 'Receipt photo (required for this payment)';
    if (!cash) det.open = true;
    onChange?.();
  };
  via.addEventListener('change', sync); amount.addEventListener('input', () => { if (fAmount.classList.contains('has-error')) fAmount.setError(''); onChange?.(); });
  holder.addEventListener('change', () => { fHolder.setError(''); });
  sync();
  return {
    el, amount: () => num(amount.value), isBlank: () => amount.value.trim() === '',
    validate() {
      let ok = true; [fPurpose, fAmount, fHolder].forEach(f => f.setError(''));
      if (!purposeVal().trim()) { fPurpose.setError('Say what this is for.'); ok = false; }
      if (!MONEY_RE.test(amount.value.trim().replace(/,/g, '')) || num(amount.value) <= 0) { fAmount.setError('Enter an amount above zero.'); ok = false; }
      if (via.value === 'Cash' && !holder.value) { fHolder.setError('Choose who holds the cash.'); ok = false; }
      rcptErr.hidden = true;
      if (via.value !== 'Cash' && !photo.picked()) { rcptErr.textContent = `A receipt photo is required for ${via.value} payments.`; rcptErr.hidden = false; det.open = true; ok = false; }
      return ok;
    },
    async collect(folder) {
      let receipt = null; const p = photo.picked();
      if (p) receipt = await uploadPhoto(photoPath(folder, 'receipt', p.type), p.blob);
      return { purpose: purposeVal().trim(), amount: String(num(amount.value)), via: via.value, cash_user: via.value === 'Cash' ? holder.value : null, receipt, via_note: via.value === 'Cash' ? null : (viaNote.value.trim() || null) };
    },
    via: () => via.value, holder: () => holder.value,
  };
  function purposeVal() { return fPurpose.querySelector('input').value; }
}

export function paymentsEditor({ title = 'Payments received', purposes = ['Rent', 'Deposit', 'Booking Amount', 'Delivery charges'], first = purposes[0], firstAmount = '', max = 100, onTotal, optional = true, hint = null } = {}) {
  const lines = []; const host = h('div', { class: 'pay-lines' });
  const sumEl = h('p', { class: 'pay-sum' });
  const addBtn = btn('Add another payment', { ic: 'plus', small: true, onClick: () => add(purposes[Math.min(lines.length, purposes.length - 1)] || '') });
  const total = () => lines.reduce((s, l) => s + (l.isBlank() ? 0 : l.amount()), 0);
  const changed = () => {
    const t = total(); sumEl.textContent = t ? `Received so far: ${fmtMoney(t)}` : '';
    const others = lines.filter(l => !l.isBlank() && l.via() === 'Cash' && l.holder() && l.holder() !== state.me.id);
    note.hidden = !others.length;
    if (others.length) note.lastChild.textContent = ` ${[...new Set(others.map(l => whoName(l.holder())))].join(' and ')} must acknowledge the cash.`;
    onTotal?.(t);
  };
  const note = h('p', { class: 'pay-note', hidden: true }, icon('info', 16), h('span'));
  function add(purpose, amount = '') {
    if (lines.length >= max) return toast(`At most ${max} payment lines.`, 'error');
    const l = line({ purpose, amount, suggestions: purposes, onChange: changed, onRemove: lines.length ? () => { lines.splice(lines.indexOf(l), 1); l.el.remove(); changed(); addBtn.hidden = false; } : null });
    lines.push(l); host.append(l.el); changed(); addBtn.hidden = lines.length >= max;
  }
  add(first, firstAmount);
  const el = h('section', { class: 'form-section' }, h('h3', title), (hint || optional) ? h('p', { class: 'muted small' }, hint || 'Leave empty if nothing was received.') : null, host, note, sumEl, addBtn);
  return {
    el, total,
    validate() { let ok = true; for (const l of lines) { if (l.isBlank()) continue; if (!l.validate()) ok = false; } return ok; },
    async collect(folder) { const out = []; for (const l of lines) { if (!l.isBlank()) out.push(await l.collect(folder)); } return out; },
  };
}