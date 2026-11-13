import { openSheet, h, icon, btn, chip, mount, emptyState, skeletonRows, fmtDateTime, fmtMoney, friendlyError, confirmDialog, toast, statusBadge } from '../core/ui.js';
import { sb, rpc } from '../core/supa.js';
import { state, can, whoName } from '../core/store.js';
import { loadTodo } from '../core/todo.js';
import { signed, acknowledgeMoney, disputeMoney, acknowledgeTransfer, disputeTransfer, approveMoney, approveTransfer, deliveryChip } from '../core/ops.js';
import { openDeliveryDetail } from './deliveries.js';
import { signedUrls, lightbox } from '../core/images.js';
import { fmtDateTimeY } from '../core/ui.js';
import { openCustomerView } from '../core/customer_view.js';


// Full details of a payment or a handover, so the person can check everything before acknowledging or approving.
function kvRow(k, v) { return v === null || v === undefined || v === '' ? null : h('div', { class: 'kv' }, h('dt', k), h('dd', v)); }
async function openMoneyDetail(m, codeOf) {
  const proof = h('div', { class: 'stack-sm' }, h('strong', 'Proof'));
  if (m.receipt) { proof.append(h('p', { class: 'muted small' }, 'Loading…')); signedUrls([m.receipt]).then(u => { proof.lastChild.remove(); const url = u[m.receipt]; if (!url) return proof.append(h('p', { class: 'muted small' }, 'The proof could not be loaded.')); const img = h('img', { src: url, alt: 'Payment proof', style: 'max-width:260px;max-height:260px;border-radius:10px;cursor:zoom-in' }); img.addEventListener('click', () => lightbox(url, `${m.code || 'Payment'} proof`)); proof.append(img); }).catch(() => {}); }
  else proof.append(h('p', { class: 'muted small' }, m.via === 'Cash' ? 'Cash payment, no proof photo.' : 'No proof photo is attached.'));
  openSheet({ title: m.code || 'Payment', subtitle: `${m.entry_type}: ${m.purpose}`, wide: true, footer: [],
    body: h('div', { class: 'stack' }, h('div', { class: 'detail-top' }, chip(m.entry_type, m.entry_type === 'Income' ? 'blue' : 'pink')),
      h('dl', { class: 'kvs' }, kvRow('Amount', signed(m)), kvRow('For', m.purpose), kvRow('Category', m.category ? `${m.category}${m.sub_category ? ` › ${m.sub_category}` : ''}` : null), kvRow('Paid by', m.via), kvRow('Company account', m.account), kvRow('Transaction ID / UTR', m.txn_ref), kvRow('Note', m.via_note),
        kvRow('Cash held by', m.cash_user ? whoName(m.cash_user) : m.via === 'Cash' ? '' : 'Company account'), kvRow('Payment date', fmtDateTimeY(m.paid_on || m.created_at)), kvRow('Entered', `${whoName(m.created_by)}, ${fmtDateTimeY(m.created_at)}`),
        kvRow('Delivery', m.delivery_id ? (codeOf(m.delivery_id) || 'delivery') : null), kvRow('Disputed', m.dispute_reason)),
      m.delivery_id ? h('div', { class: 'action-bar' }, btn('Open delivery', { ic: 'right', onClick: () => openDeliveryDetail(m.delivery_id) })) : null, proof) });
}
function openTransferDetail(x) {
  openSheet({ title: 'Cash handover', wide: true, footer: [], body: h('dl', { class: 'kvs' }, kvRow('Amount', fmtMoney(x.amount)), kvRow('Handed by', whoName(x.created_by)), kvRow('Handed to', x.to_user ? whoName(x.to_user) : 'Bank (old)'), kvRow('When', fmtDateTimeY(x.created_at)), kvRow('Note', x.note), kvRow('Disputed', x.dispute_reason)) });
}

export async function render(root) {
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'To do'), h('p', { class: 'muted' }, 'Everything waiting for you.'))), skeletonRows(5));
  async function draw() {
    let t; try { t = await loadTodo(); } catch (e) { return mount(root, h('div', { class: 'empty' }, h('h3', 'Could not load your list'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: draw }))); }
    const ids = [...new Set([...t.approvals.replacements.map(r => ({ delivery_id: r.booking_id })), ...t.approvals.extensions, ...t.approvals.swaps, ...t.approvals.pickups, ...t.approvals.money, ...t.mySwaps, ...t.ackMoney].map(r => r.delivery_id).filter(Boolean))];
    const codes = new Map(); if (ids.length) (await sb.from('deliveries').select('id,code').in('id', ids)).data?.forEach(d => codes.set(d.id, d.code));
    const open = (id) => openDeliveryDetail(id, { onChange: draw }); const me = state.me.id;
    const link = (id) => (id ? h('a', { href: `#/deliveries?open=${id}`, on: { click: (e) => { e.preventDefault(); open(id); } } }, codes.get(id) || 'delivery') : null);
    const li = (main, sub, acts) => h('article', { class: 'card-item' }, h('div', { class: 'todo-main' }, h('strong', main), h('small', sub)), h('div', { class: 'pay-act' }, acts));
    const approveFn = (fn, id, what) => confirmDialog({ title: `Approve this ${what}?`, message: 'Its payments are approved with it.', confirmLabel: 'Approve' }).then(async (r) => { if (!r) return; try { await rpc(fn, { p_id: id }); toast('Approved'); draw(); } catch (e) { toast(friendlyError(e), 'error'); } });
    const okToApprove = () => true;
    const sec = (title, n, body) => h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', title), n ? h('span', { class: 'count-pill' }, String(n)) : null), body);

    const ack = [...t.ackMoney.map(m => li(`${fmtMoney(m.amount)} ${m.entry_type === 'Income' ? 'received' : 'paid out'}: ${m.purpose}`, [`Entered by ${whoName(m.created_by)} on ${fmtDateTime(m.created_at)}`, m.delivery_id ? [' · ', link(m.delivery_id)] : ''],
        [btn('Details', { small: true, onClick: () => openMoneyDetail(m, (i) => codes.get(i)) }), btn('Acknowledge', { small: true, kind: 'primary', onClick: () => acknowledgeMoney(m, draw) }), btn('Dispute', { small: true, onClick: () => disputeMoney(m, draw) })])),
      ...t.ackTransfers.map(x => li(`${fmtMoney(x.amount)} handed to you by ${whoName(x.created_by)}`, fmtDateTime(x.created_at), [btn('Details', { small: true, onClick: () => openTransferDetail(x) }), btn('Acknowledge', { small: true, kind: 'primary', onClick: () => acknowledgeTransfer(x, draw) }), btn('Dispute', { small: true, onClick: () => disputeTransfer(x, draw) })]))];
    const swaps = t.mySwaps.map(w => li(`Swap for ${codes.get(w.delivery_id) || 'a delivery'}`, `Assigned by ${whoName(w.assigned_by)}${w.reason ? `. ${w.reason}` : ''}`, [btn('Open', { small: true, kind: 'primary', onClick: () => open(w.delivery_id) })]));
    const A = t.approvals;
    const appr = [
      ...A.bookings.map(d => li(`Booking ${d.code}`, `${d.booking_name || (d.booking_text || '').split('\n')[0]} · added by ${whoName(d.created_by)}`, [d.customer_id ? btn('Customer', { small: true, ic: 'eye', onClick: () => openCustomerView(d.customer_id, { onChange: draw }) }) : null, btn('Open', { small: true, onClick: () => open(d.id) }), btn('Approve', { small: true, kind: 'primary', onClick: () => approveFn('approve_booking', d.id, 'booking') })])),
      ...A.deliveries.map(d => li(`Delivery ${d.code}${d.reviewed_at ? ' (reviewed, confirm handover)' : ' (review details)'}`, `Added by ${whoName(d.created_by)} on ${fmtDateTime(d.created_at)}`, [d.customer_id ? btn('Customer', { small: true, ic: 'eye', onClick: () => openCustomerView(d.customer_id, { onChange: draw }) }) : null, btn(d.reviewed_at ? 'Open to confirm' : 'Open to review', { small: true, kind: 'primary', onClick: () => open(d.id) })])),
      ...A.replacements.map(r => li('Vehicle replacement for a booking', [link(r.booking_id), ` · requested by ${whoName(r.created_by)}${r.reason ? `. ${r.reason}` : ''}`],
        [btn('Open', { small: true, onClick: () => open(r.booking_id) }), btn('Approve', { small: true, kind: 'primary', onClick: () => approveFn('approve_booking_replacement', r.id, 'vehicle replacement') }),
          btn('Reject', { small: true, onClick: () => confirmDialog({ title: 'Reject this request?', message: 'The booking keeps its current vehicle.', confirmLabel: 'Reject' }).then(async (ok) => { if (!ok) return; try { await rpc('close_booking_replacement', { p_id: r.id, p_action: 'reject', p_note: null }); toast('Rejected'); draw(); } catch (e) { toast(friendlyError(e), 'error'); } }) })])),
      ...A.extensions.map(e => li(`Extension to ${fmtDateTime(e.new_return_due)} (${fmtMoney(e.amount)})`, [link(e.delivery_id), ` · added by ${whoName(e.created_by)}`], [btn('Open', { small: true, onClick: () => open(e.delivery_id) }), okToApprove(e) ? btn('Approve', { small: true, kind: 'primary', onClick: () => approveFn('approve_extension', e.id, 'extension') }) : chip('Your own entry', 'neutral')])),
      ...A.swaps.map(w => li(`Swap done${w.reviewed_at ? ' (reviewed, confirm)' : ' (review details)'}`, [link(w.delivery_id), ` · done by ${whoName(w.done_by)}`], [btn(w.reviewed_at ? 'Open to confirm' : 'Open to review', { small: true, kind: 'primary', onClick: () => open(w.delivery_id) })])),
      ...A.pickups.map(k => li('Pickup', [link(k.delivery_id), ` · by ${whoName(k.created_by)}`], [btn('Open', { small: true, onClick: () => open(k.delivery_id) }), okToApprove(k) ? btn('Approve', { small: true, kind: 'primary', onClick: () => approveFn('approve_pickup', k.id, 'pickup') }) : chip('Your own entry', 'neutral')])),
      ...A.money.map(m => li(`${m.entry_type}: ${m.purpose} ${fmtMoney(m.amount)}`, [`${m.via} · added by ${whoName(m.created_by)}`, m.delivery_id ? [' · ', link(m.delivery_id)] : ''], [btn('Details', { small: true, onClick: () => openMoneyDetail(m, (i) => codes.get(i)) }), okToApprove(m) ? btn('Approve', { small: true, kind: 'primary', onClick: () => approveMoney(m, draw) }) : chip('Your own entry', 'neutral')])),
      ...A.banks.map(x => li(`Bank deposit ${fmtMoney(x.amount)}`, `By ${whoName(x.created_by)}`, [btn('Details', { small: true, onClick: () => openTransferDetail(x) }), okToApprove(x) ? btn('Approve', { small: true, kind: 'primary', onClick: () => approveTransfer(x, draw) }) : chip('Your own entry', 'neutral')])),
    ];
    const none = (msg) => h('div', { class: 'allclear' }, icon('check', 20), h('span', msg));
    mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'To do'), h('p', { class: 'muted' }, 'Everything waiting for you.'))),
      h('div', { class: 'dash-grid' }, h('div', { class: 'dash-col' },
        sec('Cash to acknowledge', ack.length, ack.length ? h('div', { class: 'deck' }, ack) : none('No cash is waiting for you to confirm.')),
        sec('Swaps assigned to you', swaps.length, swaps.length ? h('div', { class: 'deck' }, swaps) : none('No swaps assigned to you.'))),
        h('div', { class: 'dash-col' },
          can.approve() ? sec('Waiting for your approval', appr.length, appr.length ? h('div', { class: 'deck' }, appr) : none('Nothing is waiting for approval.')) : null,
          t.overdue.length ? sec('Overdue returns', t.overdue.length, h('div', { class: 'deck' }, t.overdue.slice(0, 12).map(d => li(d.code, `Was due ${fmtDateTime(d.return_due)}`, btn('Open', { small: true, onClick: () => open(d.id) }))))) : null)));
  }
  await draw();
}
