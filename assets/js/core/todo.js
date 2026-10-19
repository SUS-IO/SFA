// Everything waiting for someone: shared by the To do page, the dashboard and the menu badge.
import { sb } from './supa.js';
import { state, can } from './store.js';

export async function loadTodo() {
  const me = state.me.id; const approver = can.approve();
  const q = (t, cols = '*') => sb.from(t).select(cols);
  const [ackMoney, ackTransfers, mySwaps, dels, exts, swaps, pickups, money, banks, out, repl] = await Promise.all([
    q('money_entries').eq('status', 'pending_ack').eq('cash_user', me).order('created_at'),
    q('cash_transfers').eq('status', 'pending_ack').eq('to_user', me).order('created_at'),
    q('swaps').eq('status', 'assigned').eq('assigned_to', me).order('created_at'),
    approver ? q('deliveries').in('status', ['booking_pending', 'pending']).order('created_at') : { data: [] },
    approver ? q('extensions').eq('status', 'pending').order('created_at') : { data: [] },
    approver ? q('swaps').eq('status', 'done').order('created_at') : { data: [] },
    approver ? q('pickups').eq('status', 'pending').order('created_at') : { data: [] },
    approver ? q('money_entries').eq('status', 'pending').or('ref_kind.is.null,ref_kind.eq.delivery').order('created_at') : { data: [] },
    approver ? q('cash_transfers').eq('status', 'pending').eq('kind', 'bank').order('created_at') : { data: [] },
    q('deliveries', 'id,code,status,customer_id,vehicle_id,return_due,approved_at').in('status', ['pending', 'active', 'pickup_pending']).order('return_due'),
    // vehicle replacement requests for booked vehicles (an empty list if the Stage 2 script has not been run yet)
    approver ? q('booking_replacements').eq('status', 'pending').order('created_at').then(r => (r.error ? { data: [] } : r), () => ({ data: [] })) : { data: [] },
  ]);
  for (const r of [ackMoney, ackTransfers, mySwaps, dels, exts, swaps, pickups, money, banks, out]) if (r.error) throw r.error;
  // money tied to a delivery is approved with that delivery while it waits for approval; otherwise on its own
  const mIds = [...new Set(money.data.map(m => m.delivery_id).filter(Boolean))];
  if (mIds.length) {
    const { data: ds } = await sb.from('deliveries').select('id,status').in('id', mIds);
    const st = new Map((ds || []).map(d => [d.id, d.status]));
    money.data = money.data.filter(m => !m.delivery_id || st.get(m.delivery_id) !== 'pending');
  }
  const mineOrBlocked = () => true;
  const approvals = {
    bookings: dels.data.filter(d => d.status === 'booking_pending'), deliveries: dels.data.filter(d => d.status === 'pending'), extensions: exts.data, swaps: swaps.data, pickups: pickups.data, replacements: repl.data, money: money.data, banks: banks.data,
  };
  const approvalCount = Object.values(approvals).reduce((a, l) => a + l.length, 0);
  const now = Date.now(); const overdue = out.data.filter(d => d.return_due && new Date(d.return_due).getTime() < now);
  return { ackMoney: ackMoney.data, ackTransfers: ackTransfers.data, mySwaps: mySwaps.data, approvals, approvalCount, out: out.data, overdue,
    count: ackMoney.data.length + ackTransfers.data.length + mySwaps.data.length + approvalCount, mineOrBlocked };
}
