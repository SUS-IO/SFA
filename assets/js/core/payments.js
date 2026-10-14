// Payment lines: purpose, amount, how it was paid, who holds the cash, optional receipt photo.
import { h, icon, btn, field, input, select, fmtMoney, num, toast, fmtDateTime, moneyChip, signed, acknowledgeMoney, disputeMoney, voidMoney, approveMoney } from './ui.js';
import { state, whoName, can } from './store.js';
import { photoField, photoPath, uploadPhoto, signedUrls, lightbox } from './images.js';

export const VIAS = ['Cash', 'UPI', 'Online', 'Card', 'Bank Transfer', 'Cheque'];
const MONEY_RE = /^\d+(\.\d{1,2})?$/;

export function userOptions({ blank = false } = {}) {
  return [...(blank ? [{ value: '', label: 'Choose a person' }] : []),
    ...state.profiles.filter(p => p.active).map(p => ({ value: p.id, label: `${p.user_name} (${p.user_id})${p.id === state.me.id ? ', you' : ''}` }))];
}

function line({ purpose, suggestions, onChange, onRemove, amount: startAmount = '', lockPurpose = false }) {
  const purposeSelect = select(suggestions.map(s => ({ value: s, label: s })), { value: purpose || suggestions[0] });
  if (lockPurpose) purposeSelect.disabled = true;
  const fPurpose = field('For', purposeSelect, { required: true });

  const otherDetailInput = input({ placeholder: 'Specify details (e.g. Helmet damage cover)' });
  const fOtherDetail = field('Other charges detail', otherDetailInput, { required: true });
  fOtherDetail.hidden = purposeSelect.value !== 'Other charges';

  purposeSelect.addEventListener('change', () => {
    fOtherDetail.hidden = purposeSelect.value !== 'Other charges';
    if (purposeSelect.value !== 'Other charges') {
      otherDetailInput.value = '';
      fOtherDetail.setError('');
    }
    onChange?.();
  });

  const amount = input({ inputmode: 'decimal', placeholder: '0', value: startAmount === '' ? '' : String(startAmount) });
  const fAmount = field('Amount', amount, { required: true });
  const via = select(VIAS.map(v => ({ value: v, label: v })), { 'aria-label': 'Paid by' });
  const fVia = field('Paid by', via);
  const holder = select(userOptions({ blank: true }), { value: state.me.id, 'aria-label': 'Cash held by' });
  const fHolder = field('Cash held by', holder, { required: true, hint: 'The person who has this cash. If it is not you, they must acknowledge it.' });
  const photo = photoField({ label: 'Receipt photo' });
  const viaNote = input({ placeholder: 'For example Company UPI QR, or Company payment gateway' });
  const fNote = field('Paid into / reference', viaNote, { hint: 'Optional. Which company account or QR it went to.' });
  const sum = h('summary', 'Add a receipt photo (optional)');
  const rcptErr = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const det = h('details', { class: 'receipt-det' }, sum, photo.el, rcptErr);
  
  const el = h('div', { class: 'pay-line' },
    h('div', { class: 'grid-2' }, fPurpose, fAmount),
    fOtherDetail,
    h('div', { class: 'grid-2' }, fVia, fHolder), fNote, det,
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
      let ok = true; [fPurpose, fAmount, fHolder, fOtherDetail].forEach(f => f.setError(''));
      if (!purposeSelect.value) { fPurpose.setError('Choose what this is for.'); ok = false; }
      if (purposeSelect.value === 'Other charges' && !otherDetailInput.value.trim()) { fOtherDetail.setError('Specify details for other charges.'); ok = false; }
      if (!MONEY_RE.test(amount.value.trim().replace(/,/g, '')) || num(amount.value) <= 0) { fAmount.setError('Enter an amount above zero.'); ok = false; }
      if (via.value === 'Cash' && !holder.value) { fHolder.setError('Choose who holds the cash.'); ok = false; }
      rcptErr.hidden = true;
      if (via.value !== 'Cash' && !photo.picked()) { rcptErr.textContent = `A receipt photo is required for ${via.value} payments.`; rcptErr.hidden = false; det.open = true; ok = false; }
      return ok;
    },
    async collect(folder) {
      let receipt = null; const p = photo.picked();
      if (p) receipt = await uploadPhoto(photoPath(folder, 'receipt', p.type), p.blob);
      
      const finalPurpose = purposeSelect.value === 'Other charges' && otherDetailInput.value.trim()
        ? `Other charges (${otherDetailInput.value.trim()})`
        : purposeSelect.value;

      return { purpose: finalPurpose, amount: String(num(amount.value)), via: via.value, cash_user: via.value === 'Cash' ? holder.value : null, receipt, via_note: via.value === 'Cash' ? null : (viaNote.value.trim() || null) };
    },
    via: () => via.value, holder: () => holder.value,
  };
}

export function paymentsEditor({ title = 'Payments received', purposes = ['Rent', 'Deposit'], first = purposes[0], firstAmount = '', max = 100, onTotal, optional = true, hint = null, lockPurpose = false } = {}) {
  const lines = []; const host = h('div', { class: 'pay-lines' });
  const sumEl = h('p', { class: 'pay-sum' });
  const addBtn = btn('Add another payment', { ic: 'plus', small: true, onClick: () => add(purposes[Math.min(lines.length, purposes.length - 1)] || '') });
  const total = () => lines.reduce((s, l) => s + (l.isBlank() ? 0 : l.amount()), 0);
  const changed = () => {
    const t = total(); sumEl.textContent = t ? `Received so far: ${fmtMoney(t)}` : '';
    const others = lines.filter(l => !l.isBlank() && l.via() === 'Cash' && l.holder() && l.holder() !== state.me.id);
    note.hidden = !others.length;
    if (others.length) note.lastChild.textContent = ` ${[...new Set(others.map(l => whoName(l.holder())))].join(' and ')} must acknowledge the cash before this can be approved.`;
    onTotal?.(t);
  };
  const note = h('p', { class: 'pay-note', hidden: true }, icon('info', 16), h('span'));
  function add(purpose, amount = '') {
    if (lines.length >= max) return toast(`At most ${max} payment lines.`, 'error');
    const l = line({ purpose: lockPurpose ? first : purpose, amount, suggestions: purposes, lockPurpose, onChange: changed, onRemove: lines.length ? () => { lines.splice(lines.indexOf(l), 1); l.el.remove(); changed(); addBtn.hidden = false; } : null });
    lines.push(l); host.append(l.el); changed(); addBtn.hidden = lines.length >= max;
  }
  add(first, firstAmount);
  const el = h('section', { class: 'form-section' }, h('h3', title), (hint || optional) ? h('p', { class: 'muted small' }, hint || 'Leave the amount empty if nothing was received. Split the amount over as many lines as you need: each line has its own amount, mode and collector.') : null, host, note, sumEl, addBtn);
  return {
    el, total,
    validate() { let ok = true; for (const l of lines) { if (l.isBlank()) continue; if (!l.validate()) ok = false; } return ok; },
    async collect(folder) { const out = []; for (const l of lines) { if (!l.isBlank()) out.push(await l.collect(folder)); } return out; },
  };
}

// Helper to hydrate receipt tiles in payment rows
function hydrateTiles(root, code) {
  const tiles = [...root.querySelectorAll('.tile[data-path]')]; 
  const paths = tiles.map(t => t.dataset.path).filter(Boolean);
  if (!paths.length) return;
  signedUrls(paths).then(map => tiles.forEach(t => { 
    const u = map[t.dataset.path]; 
    if (u && !t.querySelector('img')) { 
      t.prepend(h('img', { src: u, alt: t.dataset.cap })); 
      t.style.cursor = 'zoom-in'; 
      t.addEventListener('click', () => lightbox(u, `${code} ${t.dataset.cap}`)); 
    } 
  })).catch(() => {});
}

const who_ = (id) => state.profileMap.get(id)?.user_name || 'the cash holder';

export function payRow(m, cur, reload) {
  const me = state.me.id;
  
  // Build receipt preview section if a receipt photo exists
  const receiptView = m.receipt ? h('div', { class: 'swap-photos', style: 'margin-top: 8px;' },
    h('div', { class: 'photo-multi viewer' }, [
      h('div', { class: 'tile filled', dataset: { path: m.receipt, cap: `${m.purpose} Receipt` } }, icon('image', 22), h('span', { class: 'thumb-label' }, 'Receipt'))
    ])
  ) : null;

  if (receiptView) {
    queueMicrotask(() => hydrateTiles(receiptView, cur.code));
  }

  return h('li', { class: `pay-row stacked ${m.status === 'void' ? 'is-void' : ''}` },
    h('div', { class: 'pay-row-top' },
      h('div', null, 
        h('strong', `${m.purpose}`), 
        h('small', `${m.entry_type}, ${m.via}${m.cash_user ? `, cash held by ${who_(m.cash_user)}` : ''}. Added by ${whoName(m.created_by)} on ${fmtDateTime(m.created_at)}.${m.dispute_reason ? ' Dispute: ' + m.dispute_reason : ''}${m.void_reason ? ' Void: ' + m.void_reason : ''}`)
      ),
      h('div', { class: 'pay-act' }, 
        h('span', { class: `amt ${m.entry_type === 'Expense' ? 'neg' : ''}` }, signed(m)), 
        moneyChip(m),
        m.status === 'pending_ack' && m.cash_user === me ? [btn('Acknowledgment', { small: true, kind: 'primary', onClick: () => acknowledgeMoney(m, reload) }), btn('Dispute', { small: true, onClick: () => disputeMoney(m, reload) })] : null,
        m.status === 'pending' && m.ref_kind === 'delivery' && can.approve() && cur.status !== 'pending' ? btn('Approve', { small: true, kind: 'primary', onClick: () => approveMoney(m, reload) }) : null,
        m.status !== 'void' && can.manager() ? btn('Void', { small: true, onClick: () => voidMoney(m, reload) }) : null
      )
    ),
    receiptView
  );
}
