// Payments: how it was paid, the transaction id (UTR), the screenshot, and the breakup of one payment over the charges.
// Example: one UPI payment of 5000 = Rent 3000 + Deposit 1500 + Delivery charges 500, one screenshot, one UTR.
// Put this file in: assets/js/core/payments.js
import { h, icon, btn, field, input, select, fmtMoney, num, toast } from './ui.js';
import { state, whoName } from './store.js';
import { photoField, photoPath, uploadPhoto } from './images.js';

import { accountsFor } from './settings.js';
export const VIAS = ['Cash', 'UPI', 'Online', 'Card', 'Bank Transfer', 'Cheque'];
const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const TXN_LABEL = { UPI: 'UPI transaction ID / UTR', Online: 'Transaction ID / gateway reference', Card: 'Card approval or reference number', 'Bank Transfer': 'UTR / bank reference number', Cheque: 'Cheque number' };
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
// "Other charges (Helmet damage)" belongs to the head "Other charges"
export const headOf = (purpose) => String(purpose || '').replace(/\s*\(.*\)\s*$/, '').trim();

export function userOptions({ blank = false } = {}) {
  return [...(blank ? [{ value: '', label: 'Choose a person' }] : []),
    ...state.profiles.filter(p => p.active).map(p => ({ value: p.id, label: `${p.user_name} (${p.user_id})${p.id === state.me.id ? ', you' : ''}` }))];
}

// ---------------------------------------------------------------------------------------------
// The "as per record" against "received" table. Used while entering payments and on the delivery page.
// rows: [{ head, expected, received }]   credit: { label, amount }  (money already held that counts towards the total)
let styled = false;
function ensureStyles() {
  if (styled || typeof document === 'undefined') return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .sum-wrap{overflow-x:auto;border:1px solid var(--line,#d9dee7);border-radius:10px}
  .sum-table{width:100%;border-collapse:collapse;font-size:.92rem;min-width:420px}
  .sum-table th,.sum-table td{padding:.5rem .7rem;text-align:right;border-bottom:1px solid var(--line,#e5e9f0);white-space:nowrap}
  .sum-table th:first-child,.sum-table td:first-child{text-align:left;white-space:normal}
  .sum-table thead th{font-weight:600;background:var(--surface-2,rgba(120,130,150,.08))}
  .sum-table tfoot td{font-weight:700;border-bottom:0}
  .sum-table .short{color:var(--danger,#c0392b)} .sum-table .extra{color:var(--warn,#b9770e)} .sum-table .okc{color:var(--ok,#1e8e4e)}
  .sum-table .cred td{font-style:italic}
  .pay-card{border:1px solid var(--line,#d9dee7);border-radius:12px;padding:.8rem;display:grid;gap:.7rem;background:var(--surface,transparent)}
  .pay-card-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
  .breakup{display:grid;gap:.5rem;padding:.6rem;border-radius:10px;background:var(--surface-2,rgba(120,130,150,.07))}
  .bk-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;gap:.5rem;align-items:end}
  .bk-row .field{margin:0}
  .bk-detail{grid-column:1 / -1}
  .bk-status{font-size:.88rem}
  .bk-status.bad{color:var(--danger,#c0392b)} .bk-status.good{color:var(--ok,#1e8e4e)}
  `;
  document.head.append(s);
}

export function summaryTable({ rows, credit = null, creditNote = '', receivedLabel = 'Received', expectedLabel = 'As per record' }) {
  ensureStyles();
  const list = rows.filter(r => r.expected || r.received);
  const exp = list.reduce((a, r) => a + r2(r.expected), 0), got = list.reduce((a, r) => a + r2(r.received), 0), cr = credit ? r2(credit.amount) : 0;
  const diffCell = (e, g) => { const d = r2(e - g); if (Math.abs(d) < 0.005) return h('td', { class: 'okc' }, e || g ? 'Tallied' : '');
    return h('td', { class: d > 0 ? 'short' : 'extra' }, d > 0 ? `Short ${fmtMoney(d)}` : `Extra ${fmtMoney(-d)}`); };
  const bal = r2(exp - got - cr);
  return h('div', { class: 'sum-wrap' }, h('table', { class: 'sum-table' },
    h('thead', h('tr', h('th', 'For'), h('th', expectedLabel), h('th', receivedLabel), h('th', 'Difference'))),
    h('tbody', list.map(r => h('tr', h('td', r.head), h('td', fmtMoney(r.expected || 0)), h('td', fmtMoney(r.received || 0)), diffCell(r.expected || 0, r.received || 0))),
      credit && cr ? h('tr', { class: 'cred' }, h('td', credit.label), h('td', ''), h('td', fmtMoney(cr)), h('td', creditNote || 'Adjusted')) : null),
    h('tfoot', h('tr', h('td', 'Total'), h('td', fmtMoney(exp)), h('td', fmtMoney(got + cr)),
      h('td', { class: Math.abs(bal) < 0.005 ? 'okc' : bal > 0 ? 'short' : 'extra' }, Math.abs(bal) < 0.005 ? 'Tallied' : bal > 0 ? `Still to receive ${fmtMoney(bal)}` : `Extra ${fmtMoney(-bal)}`)))));
}

// The summary of a saved delivery, from its records. money: money_entries of the delivery, extensions, pickup (live one or null)
export function deliverySummary(d, { money = [], extensions = [], pickup = null }) {
  const live = money.filter(m => m.entry_type === 'Income' && !['void', 'disputed'].includes(m.status));
  const got = {}; let advance = 0;
  for (const m of live) { const k = headOf(m.purpose); if (k === 'Booking advance') advance += Number(m.amount); else got[k] = (got[k] || 0) + Number(m.amount); }
  const ext = extensions.filter(e => e.status === 'approved').reduce((a, e) => a + Number(e.amount || 0), 0);
  const exp = [['Rent', d.rent], ['Deposit', d.deposit], ['Delivery charges', d.delivery_charges], ['Advance pickup charges', d.advance_pickup_charges],
    ['Other charges', d.other_charges_amount], ['Extension', ext], ['Extra km', pickup?.extra_km_charge], ['Return charges', pickup?.other_charges_amount]];
  const rows = exp.map(([head, expected]) => ({ head, expected: r2(expected), received: r2(got[head] || 0) }));
  const known = new Set(exp.map(e => e[0]));
  for (const [head, v] of Object.entries(got)) if (!known.has(head)) rows.push({ head, expected: 0, received: r2(v) });
  return { rows, credit: { label: 'Booking advance received earlier (adjusted)', amount: r2(advance) } };
}

// ---------------------------------------------------------------------------------------------
function breakupRow({ purposes, purpose, amount = '', onChange, onRemove }) {
  const head = select(purposes.map(s => ({ value: s, label: s })), { value: purpose || purposes[0], 'aria-label': 'Charge' });
  const fHead = field('For', head, { required: true });
  const amt = input({ inputmode: 'decimal', placeholder: '0', value: amount === '' ? '' : String(amount), 'aria-label': 'Amount for this charge' });
  const fAmt = field('Amount', amt, { required: true });
  const detail = input({ placeholder: 'Specify details (for example Helmet damage cover)' });
  const fDetail = field('Other charges detail', detail, { required: true }); fDetail.classList.add('bk-detail');
  const sync = () => { fDetail.hidden = head.value !== 'Other charges'; if (fDetail.hidden) { detail.value = ''; fDetail.setError(''); } };
  const rm = onRemove ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Remove this charge', on: { click: onRemove } }, icon('x', 16)) : h('span');
  const el = h('div', { class: 'bk-row' }, fHead, fAmt, rm, fDetail);
  let touched = false;
  head.addEventListener('change', () => { sync(); onChange?.(); });
  amt.addEventListener('input', () => { touched = true; fAmt.setError(''); onChange?.(); });
  sync();
  return {
    el, head: () => head.value, amount: () => num(amt.value), blank: () => amt.value.trim() === '', touched: () => touched,
    set(p, a) { head.value = p; amt.value = a === '' ? '' : String(a); touched = true; sync(); },
    mirror(v) { if (!touched) amt.value = v; },
    purpose: () => (head.value === 'Other charges' && detail.value.trim() ? `Other charges (${detail.value.trim()})` : head.value),
    validate() {
      let ok = true; fHead.setError(''); fAmt.setError(''); fDetail.setError('');
      if (!MONEY_RE.test(amt.value.trim().replace(/,/g, '')) || num(amt.value) <= 0) { fAmt.setError('Enter an amount above zero.'); ok = false; }
      if (head.value === 'Other charges' && !detail.value.trim()) { fDetail.setError('Specify details for other charges.'); ok = false; }
      return ok;
    },
  };
}

function card({ purposes, first, firstAmount, lockPurpose, breakup, type, simple = false, onChange, onRemove, onFill }) {
  const income = type === 'Income';
  const via = select(VIAS.map(v => ({ value: v, label: v })), { 'aria-label': 'Paid by' });
  const fVia = field('Paid by', via, { required: true });
  const total = input({ inputmode: 'decimal', placeholder: '0', value: firstAmount === '' ? '' : String(firstAmount) });
  const fTotal = field(breakup ? 'Total amount received' : simple ? 'Amount received' : 'Amount', total, { required: true });
  const holder = select(userOptions({ blank: true }), { value: state.me.id, 'aria-label': 'Cash held by' });
  const fHolder = field('Cash held by', holder, { required: true, hint: 'The person who has this cash. If it is not you, they must acknowledge it.' });
  const txn = input({ placeholder: 'For example the UTR printed on the screenshot', autocomplete: 'off' });
  const fTxn = field(TXN_LABEL.UPI, txn, { required: income, hint: income ? 'Copy it from the payment screenshot. It is checked so the same payment is not entered twice.' : 'Optional.' });
  const acctSel = select([], { 'aria-label': 'Company account' }); const fAcct = field('Company account', acctSel, { required: true, hint: 'Which company account the money went to.' }); fAcct.hidden = true;
  const viaNote = input({ placeholder: 'For example Company UPI QR, or Company payment gateway' });
  const fNote = field('Paid into', viaNote, { hint: 'Optional. Which company account or QR it went to.' });
  const photo = photoField({ label: 'Payment screenshot' });
  const rcptErr = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const shot = h('div', { class: 'stack-sm' }, photo.el, rcptErr);

  // breakup
  const rows = []; const rowsHost = h('div', { class: 'stack-sm' }); const status = h('p', { class: 'bk-status' });
  const addRowBtn = btn('Add another charge', { ic: 'plus', small: true, onClick: () => addRow() });
  const fillBtn = onFill ? btn('Fill from the charges', { ic: 'check', small: true, onClick: () => { const s = onFill(api); if (s) setRows(s); else toast('Nothing more is due as per the charges.'); } }) : null;
  const rowsTotal = () => rows.reduce((a, r) => a + (r.blank() ? 0 : r.amount()), 0);
  const paint = () => {
    if (!breakup) return;
    if (rows.length === 1 && !rows[0].touched()) rows[0].mirror(total.value);
    const t = num(total.value), b = rowsTotal(), diff = r2(t - b);
    status.className = 'bk-status ' + (t && Math.abs(diff) < 0.005 ? 'good' : t ? 'bad' : '');
    status.textContent = !t ? '' : Math.abs(diff) < 0.005 ? `Breakup adds up to ${fmtMoney(t)}.` : diff > 0 ? `${fmtMoney(diff)} of the payment is not yet given to a charge.` : `The charges are ${fmtMoney(-diff)} more than the payment.`;
  };
  const changed = () => { paint(); onChange?.(); };
  function addRow(purpose, amount = '') {
    const used = new Set(rows.map(r => r.head()));
    const next = purpose || purposes.find(p => !used.has(p)) || purposes[purposes.length - 1];
    const r = breakupRow({ purposes, purpose: next, amount, onChange: changed, onRemove: rows.length ? () => { rows.splice(rows.indexOf(r), 1); r.el.remove(); changed(); } : null });
    rows.push(r); rowsHost.append(r.el); changed(); return r;
  }
  function setRows(list) {
    rows.splice(0).forEach(r => r.el.remove()); let sum = 0;
    list.forEach(([p, a], i) => { const r = addRow(p, a); r.set(p, a); sum += a; if (i === 0) { /* first row cannot be removed */ } });
    total.value = String(r2(sum)); changed();
  }
  if (breakup) { addRow(first, firstAmount); }
  const breakBox = breakup ? h('div', { class: 'breakup' }, h('strong', 'Breakup of this payment'), h('p', { class: 'muted small' }, 'Say what this payment pays for. The charges must add up to the total received.'), rowsHost, status, h('div', { class: 'photo-actions' }, addRowBtn, fillBtn)) : null;

  const el = h('div', { class: 'pay-card' },
    onRemove ? h('div', { class: 'pay-card-head' }, h('strong', 'Another payment'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: onRemove } }, icon('x', 16), h('span', 'Remove this payment'))) : null,
    h('div', { class: 'grid-2' }, fVia, fTotal),
    fHolder, fAcct, fTxn, fNote, shot, breakBox);

  // single-purpose cards (no breakup) still choose what they are for when several purposes are offered
  let single = null;
  if (!breakup) {
    single = select(purposes.map(s => ({ value: s, label: s })), { value: first || purposes[0], 'aria-label': 'For' });
    if (lockPurpose || purposes.length === 1) single.disabled = true;
    const fSingle = field('For', single, { required: true }); fSingle.hidden = simple || (purposes.length === 1 && !lockPurpose) || (purposes.length === 1 && purposes[0] === 'Other');
    el.insertBefore(fSingle, el.children[onRemove ? 2 : 1] || null);
    const od = input({ placeholder: 'Specify details (for example Helmet damage cover)' }); const fOd = field('Other charges detail', od, { required: true });
    const so = () => { fOd.hidden = single.value !== 'Other charges'; if (fOd.hidden) od.value = ''; }; so();
    single.addEventListener('change', () => { so(); onChange?.(); }); el.insertBefore(fOd, fHolder);
    single._detail = od; single._fDetail = fOd;
  }

  const sync = () => {
    const cash = via.value === 'Cash';
    const accts = cash ? [] : accountsFor(via.value);
    if (accts.length) { acctSel.replaceChildren(h('option', { value: '' }, 'Choose an account'), ...accts.map(a => h('option', { value: a.label }, a.label))); }
    fAcct.hidden = !accts.length;
    fHolder.hidden = !cash; fTxn.hidden = cash; fNote.hidden = cash || accts.length > 0; shot.hidden = cash;
    const lab = fTxn.querySelector('.field-label'); if (lab && TXN_LABEL[via.value]) lab.firstChild.textContent = TXN_LABEL[via.value];
    onChange?.();
  };
  via.addEventListener('change', sync);
  total.addEventListener('input', () => { fTotal.setError(''); changed(); });
  holder.addEventListener('change', () => { fHolder.setError(''); onChange?.(); });
  sync(); paint();

  const api = {
    el, via: () => via.value, holder: () => holder.value, isBlank: () => total.value.trim() === '', amount: () => num(total.value),
    // what this payment pays for, by charge
    byHead() { if (breakup) { const o = {}; rows.forEach(r => { if (!r.blank()) o[r.head()] = (o[r.head()] || 0) + r.amount(); }); return o; } return { [headOf(single.value)]: num(total.value) }; },
    validate() {
      let ok = true; [fTotal, fHolder, fTxn, fAcct].forEach(f => f.setError('')); rcptErr.hidden = true;
      if (!MONEY_RE.test(total.value.trim().replace(/,/g, '')) || num(total.value) <= 0) { fTotal.setError('Enter an amount above zero.'); ok = false; }
      if (via.value === 'Cash' && !holder.value) { fHolder.setError('Choose who holds the cash.'); ok = false; }
      if (via.value !== 'Cash') {
        if (!fAcct.hidden && !acctSel.value) { fAcct.setError('Choose the company account.'); ok = false; }
        if (income && !txn.value.trim()) { fTxn.setError('Enter the transaction id (UTR or reference number).'); ok = false; }
        if (!photo.picked()) { rcptErr.textContent = `A payment screenshot or receipt photo is required for ${via.value} payments.`; rcptErr.hidden = false; ok = false; }
      }
      if (breakup) {
        for (const r of rows) if (!r.validate()) ok = false;
        const diff = r2(num(total.value) - rowsTotal());
        if (ok && Math.abs(diff) >= 0.005) { fTotal.setError(`The charges add up to ${fmtMoney(rowsTotal())} but the payment is ${fmtMoney(num(total.value))}. Fix the breakup.`); ok = false; }
      } else if (single.value === 'Other charges' && !single._detail.value.trim()) { single._fDetail.setError('Specify details for other charges.'); ok = false; }
      return ok;
    },
    // one entry per charge, all sharing the same payment mode, UTR and screenshot
    async collect(folder) {
      let receipt = null; const p = photo.picked();
      if (p) receipt = await uploadPhoto(photoPath(folder, 'receipt', p.type), p.blob);
      const cash = via.value === 'Cash', group = uuid();
      const base = { via: via.value, cash_user: cash ? holder.value : null, receipt, via_note: cash || !fAcct.hidden ? null : (viaNote.value.trim() || null), account: !cash && !fAcct.hidden ? acctSel.value : null, txn_ref: cash ? null : (txn.value.trim() || null), pay_group: group };
      if (breakup) return rows.filter(r => !r.blank()).map(r => ({ purpose: r.purpose(), amount: String(r.amount()), ...base }));
      const purpose = single.value === 'Other charges' && single._detail.value.trim() ? `Other charges (${single._detail.value.trim()})` : single.value;
      return [{ purpose, amount: String(num(total.value)), ...base }];
    },
  };
  return api;
}

// opts: { title, purposes, first, firstAmount, max (payments), type ('Income'|'Expense'), breakup (default: when several purposes are offered),
//         expected: () => [{ head, amount }]  as per record,  credit: () => ({ label, amount })  held money that counts,
//         onTotal(sum), optional, hint, lockPurpose }
export function paymentsEditor({ title = 'Payments received', purposes = ['Rent', 'Deposit'], first = purposes[0], firstAmount = '', max = 100, onTotal, optional = true, hint = null,
  lockPurpose = false, type = 'Income', breakup = null, expected = null, credit = null, summaryLabel = 'Payment summary', simple = false } = {}) {
  ensureStyles();
  const useBreakup = simple ? false : breakup === null ? (purposes.length > 1 && !lockPurpose) : breakup;
  const errEl = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const cards = []; const host = h('div', { class: 'stack' }); const sumEl = h('p', { class: 'pay-sum' }); const tableHost = h('div', { class: 'stack-sm' });
  const note = h('p', { class: 'pay-note', hidden: true }, icon('info', 16), h('span'));
  const addBtn = btn('Add another payment', { ic: 'plus', small: true, onClick: () => add('') });
  const live = () => cards.filter(c => !c.isBlank());
  const total = () => live().reduce((s, c) => s + c.amount(), 0);
  const received = () => { const o = {}; live().forEach(c => { for (const [k, v] of Object.entries(c.byHead())) o[k] = (o[k] || 0) + v; }); return o; };
  const fillFrom = (me) => {
    if (!expected) return null;
    const used = {}; cards.filter(c => c !== me).forEach(c => { if (!c.isBlank()) for (const [k, v] of Object.entries(c.byHead())) used[k] = (used[k] || 0) + v; });
    const cc = credit?.(); const cr = cc ? Number(cc.amount) || 0 : 0; let left = cr; const out = [];
    for (const e of expected()) { let rem = Math.max(0, r2(e.amount - (used[e.head] || 0))); const take = Math.min(left, rem); rem = r2(rem - take); left = r2(left - take); if (rem > 0 && purposes.includes(e.head)) out.push([e.head, rem]); }
    return out.length ? out : null;
  };
  const paintTable = () => {
    if (!expected || simple) return;
    const ex = expected(); const got = received(); const heads = ex.map(e => e.head);
    const rows = ex.map(e => ({ head: e.head, expected: r2(e.amount), received: r2(got[e.head] || 0) }));
    Object.keys(got).forEach(k => { if (!heads.includes(k)) rows.push({ head: k, expected: 0, received: r2(got[k]) }); });
    const cr = credit?.() || null;
    tableHost.replaceChildren(h('strong', summaryLabel), summaryTable({ rows, credit: cr, receivedLabel: 'Received now' }));
  };
  const changed = () => {
    const t = total(); sumEl.textContent = t ? `Received so far: ${fmtMoney(t)}` : '';
    const others = live().filter(c => c.via() === 'Cash' && c.holder() && c.holder() !== state.me.id);
    note.hidden = !others.length;
    if (others.length) note.lastChild.textContent = ` ${[...new Set(others.map(c => whoName(c.holder())))].join(' and ')} must acknowledge the cash before this can be approved.`;
    paintTable(); onTotal?.(t);
  };
  function add(purpose) {
    if (cards.length >= max) return toast(`At most ${max} payment${max === 1 ? '' : 's'}.`, 'error');
    const c = card({ purposes, first: cards.length ? (purpose || purposes[0]) : first, firstAmount: cards.length ? '' : firstAmount, lockPurpose, breakup: useBreakup, type, simple,
      onChange: changed, onFill: expected && !simple ? fillFrom : null, onRemove: cards.length ? () => { cards.splice(cards.indexOf(c), 1); c.el.remove(); changed(); addBtn.hidden = false; } : null });
    cards.push(c); host.append(c.el); changed(); addBtn.hidden = cards.length >= max;
  }
  add('');
  const el = h('section', { class: 'form-section' }, h('h3', title),
    (hint || optional) ? h('p', { class: 'muted small' }, hint || 'Leave the amount empty if nothing was received. Each payment has its own mode, transaction id and screenshot.') : null,
    errEl, host, note, sumEl, max > 1 ? addBtn : null, tableHost);
  return {
    el, total, received, refresh: changed, repaint: paintTable,
    validate() { let ok = true; for (const c of cards) { if (c.isBlank()) continue; if (!c.validate()) ok = false; } return ok; },
    setError(msg) { errEl.textContent = msg || ''; errEl.hidden = !msg; },
    // Simple mode: the person only enters payments. They are given to the charges in order (the booking advance first),
    // so the records still hold one row per payment and charge.
    async collect(folder) {
      const out = []; for (const c of cards) { if (!c.isBlank()) out.push(...await c.collect(folder)); }
      if (!simple || !expected) return out;
      const ex = expected(); const dues = ex.map(e => ({ purpose: e.purpose || e.head, left: r2(e.amount) })).filter(e => e.left > 0);
      const cc = credit?.(); let cr = cc ? Number(cc.amount) || 0 : 0;
      for (const d of dues) { const t = Math.min(cr, d.left); d.left = r2(d.left - t); cr = r2(cr - t); }
      const lastP = (() => { const l = ex.filter(e => e.amount > 0).pop(); return l ? (l.purpose || l.head) : (purposes[0] || 'Rent'); })();
      const res = [];
      for (const line of out) {
        let amt = r2(Number(line.amount));
        for (const d of dues) { if (amt <= 0) break; if (d.left <= 0) continue; const t = Math.min(amt, d.left); res.push({ ...line, purpose: d.purpose, amount: String(t) }); d.left = r2(d.left - t); amt = r2(amt - t); }
        if (amt > 0) res.push({ ...line, purpose: lastP, amount: String(amt) });   // more than charged: kept on the last charge so nothing is lost
      }
      return res;
    },
  };
}
