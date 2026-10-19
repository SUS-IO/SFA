// Shared bits for deliveries and money: status labels and the small actions.
import { h, chip, statusBadge, confirmDialog, toast, friendlyError, fmtMoney } from './ui.js';
import { rpc } from './supa.js';
import { whoName, who } from './store.js';

export const DELIVERY_LABEL = { booking_pending: 'Booking waiting for approval', booked: 'Booked', pending: 'Waiting for approval', active: 'Out with customer', pickup_pending: 'Pickup waiting for approval', closed: 'Closed', cancelled: 'Cancelled' };
const DELIVERY_KIND = { booking_pending: 'pink', booked: 'aqua', pending: 'pink', active: 'blue', pickup_pending: 'pink', closed: 'neutral', cancelled: 'navy' };
export const deliveryChip = (status) => chip(DELIVERY_LABEL[status] || status, DELIVERY_KIND[status] || 'neutral');

export function moneyChip(m) {
  switch (m.status) {
    case 'pending_ack': return chip(`Waiting for ${who(m.cash_user)?.user_name || 'cash holder'} to acknowledge`, 'pink');
    case 'pending': return chip('Waiting for approval', 'blue');
    case 'approved': return statusBadge('active', 'Approved');
    case 'disputed': return statusBadge('blocked', 'Disputed');
    default: return chip('Void', 'neutral');
  }
}
export const signed = (m) => (m.entry_type === 'Expense' ? '-' : '+') + fmtMoney(m.amount);
export const TRANSFER_LABEL = { pending_ack: 'Waiting for acknowledgement', pending: 'Waiting for approval', done: 'Done', disputed: 'Disputed', void: 'Void' };
export function transferChip(t) {
  return t.status === 'done' ? statusBadge('active', 'Done') : t.status === 'disputed' ? statusBadge('blocked', 'Disputed') : chip(TRANSFER_LABEL[t.status], t.status === 'void' ? 'neutral' : t.status === 'pending_ack' ? 'pink' : 'blue');
}

async function run(fn, okMsg, after) {
  try { await fn(); toast(okMsg); await after?.(); } catch (e) { toast(friendlyError(e), 'error'); }
}
export const acknowledgeMoney = (m, after) => confirmDialog({ title: 'Acknowledge this cash?', message: `Confirm you hold ${fmtMoney(m.amount)} ${m.entry_type === 'Income' ? 'received' : 'paid out'} for "${m.purpose}", entered by ${whoName(m.created_by)}.`, confirmLabel: 'Yes, I have it' })
  .then(r => r && run(() => rpc('acknowledge_money', { p_id: m.id, p_accept: true }), 'Acknowledged', after));
export const disputeMoney = (m, after) => confirmDialog({ title: 'Dispute this entry?', message: 'Use this if the amount or the cash is not right. A Manager will look at it.', confirmLabel: 'Dispute', danger: true, reason: { label: 'What is wrong?', required: true, placeholder: 'For example, I only received 400' } })
  .then(r => r && run(() => rpc('acknowledge_money', { p_id: m.id, p_accept: false, p_reason: r.text }), 'Disputed', after));
export const voidMoney = (m, after) => confirmDialog({ title: 'Void this entry?', message: 'A voided entry stays on record but no longer counts.', confirmLabel: 'Void it', danger: true, reason: { label: 'Reason', required: true } })
  .then(r => r && run(() => rpc('void_money', { p_id: m.id, p_reason: r.text }), 'Entry voided', after));
export const approveMoney = (m, after) => confirmDialog({ title: 'Approve this entry?', message: `${m.entry_type} of ${fmtMoney(m.amount)} for "${m.purpose}".`, confirmLabel: 'Approve' })
  .then(r => r && run(() => rpc('approve_money', { p_id: m.id }), 'Approved', after));
export const acknowledgeTransfer = (t, after) => confirmDialog({ title: 'Acknowledge this cash?', message: `Confirm you received ${fmtMoney(t.amount)} from ${whoName(t.created_by)}.`, confirmLabel: 'Yes, I received it' })
  .then(r => r && run(() => rpc('acknowledge_transfer', { p_id: t.id, p_accept: true }), 'Acknowledged', after));
export const disputeTransfer = (t, after) => confirmDialog({ title: 'Dispute this transfer?', message: 'Use this if you did not receive this amount.', confirmLabel: 'Dispute', danger: true, reason: { label: 'What is wrong?', required: true } })
  .then(r => r && run(() => rpc('acknowledge_transfer', { p_id: t.id, p_accept: false, p_reason: r.text }), 'Disputed', after));
export const approveTransfer = (t, after) => confirmDialog({ title: 'Approve this bank deposit?', message: `${fmtMoney(t.amount)} deposited by ${whoName(t.created_by)}.`, confirmLabel: 'Approve' })
  .then(r => r && run(() => rpc('approve_transfer', { p_id: t.id }), 'Approved', after));
export const voidTransfer = (t, after) => confirmDialog({ title: 'Void this transfer?', message: 'It stays on record but no longer counts.', confirmLabel: 'Void it', danger: true, reason: { label: 'Reason', required: true } })
  .then(r => r && run(() => rpc('void_transfer', { p_id: t.id, p_reason: r.text }), 'Transfer voided', after));

// approve a delivery / extension / swap / pickup
export const approveRecord = (fn, what, after) => confirmDialog({ title: `Approve this ${what}?`, message: 'Its payments are approved with it.', confirmLabel: 'Approve' })
  .then(r => r && run(() => rpc(fn.name, { [fn.arg]: fn.id }), 'Approved', after));
