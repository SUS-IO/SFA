// Rent "as per the slab": what the vehicle master says the rent should be for the TOTAL number of days,
// compared with what was charged and what was received. Used on Extend, Pickup, Accounts and the Rent grid.
// Put this file in: assets/js/core/slab.js
import { h, fmtMoney } from './ui.js';
import { sb } from './supa.js';
import { slabFor, rateFor, TRIPS } from './masters.js';
import { headOf } from './payments.js';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const N = (v) => Number(v) || 0;

export async function loadVehicleRates(vehicleId) {
  if (!vehicleId) return null;
  const { data, error } = await sb.from('vehicles').select('*').eq('id', vehicleId).maybeSingle();
  if (error) throw error; return data;
}

// Which heads count as "rent" money. The booking advance is counted towards rent first.
export const RENT_HEADS = ['Rent', 'Extension'];
export const headGroup = (purpose) => { const k = headOf(purpose); if (RENT_HEADS.includes(k) || k === 'Booking advance') return 'Rent'; if (k === 'Deposit') return 'Deposit'; return 'Other charges'; };

// Rent received so far from the money rows of one delivery (void and disputed rows are not counted).
export function rentReceived(entries, rentCharged = null) {
  const live = (entries || []).filter(m => m.status !== 'void' && m.status !== 'disputed');
  let rent = 0, advance = 0, back = 0;
  for (const m of live) {
    const k = headOf(m.purpose);
    if (m.entry_type === 'Income' && RENT_HEADS.includes(k)) rent += N(m.amount);
    else if (m.entry_type === 'Income' && k === 'Booking advance') advance += N(m.amount);
    else if (m.entry_type === 'Expense' && k === 'Booking refund') back += N(m.amount);
  }
  const adv = Math.max(0, advance - back);
  const room = rentCharged == null ? adv : Math.max(0, N(rentCharged) - rent);
  return r2(rent + Math.min(adv, room));
}

// delivery: { days, rent, trip_type }   extensions: approved extensions   vehicle: row with the rate columns
// extraDays: days being added now (for the Extend form)   addCharge: amount being added now
export function slabPlan({ vehicle, delivery, extensions = [], extraDays = 0, addCharge = 0, received = 0 }) {
  const trip = delivery?.trip_type || 'local';
  const baseDays = N(delivery?.days) + extensions.filter(e => e.status === 'approved').reduce((a, e) => a + N(e.extra_days), 0);
  const days = baseDays + N(extraDays);
  const charged = r2(N(delivery?.rent) + extensions.filter(e => e.status === 'approved').reduce((a, e) => a + N(e.amount), 0) + N(addCharge));
  const slab = slabFor(days), rate = days >= 1 ? rateFor(vehicle, days, trip) : null;
  const expected = rate == null ? null : r2(rate * days);
  return { trip, tripLabel: TRIPS.find(t => t.value === trip)?.label || trip, days, baseDays, slab, rate, expected, charged, received: r2(received),
    chargedDiff: expected == null ? null : r2(charged - expected), receivedDiff: expected == null ? null : r2(received - expected), toReceive: expected == null ? null : r2(Math.max(0, expected - received)) };
}

export const diffText = (d) => (d == null ? '-' : d === 0 ? 'Matches' : d > 0 ? `${fmtMoney(d)} more` : `${fmtMoney(-d)} less`);
const tone = (d) => (d == null ? '' : d === 0 ? 'ok' : d > 0 ? 'more' : 'less');

// A small box that can be shown in any form or screen.
export function slabBox(p, { title = 'Rent as per the vehicle master slab', note = '' } = {}) {
  if (p.rate == null) return h('div', { class: 'slab-box' }, h('strong', title), h('p', { class: 'muted small' }, p.days >= 1 ? `No rate is set in the vehicle master for ${p.tripLabel} and ${p.days} day${p.days === 1 ? '' : 's'}.` : 'Choose the dates to see the slab rent.'));
  const row = (a, b, cls = '') => h('div', { class: `slab-row ${cls}` }, h('span', a), h('strong', b));
  return h('div', { class: 'slab-box' },
    h('strong', title),
    h('p', { class: 'muted small' }, `${p.tripLabel}: ${p.days} day${p.days === 1 ? '' : 's'} in total falls in the "${p.slab.label}" slab, so the rent is ${fmtMoney(p.rate)} per day.`),
    row(`Rent as per slab (${p.days} x ${fmtMoney(p.rate)})`, fmtMoney(p.expected), 'big'),
    row('Rent charged so far', fmtMoney(p.charged)), row('Difference (charged minus slab)', diffText(p.chargedDiff), tone(p.chargedDiff)),
    p.received != null ? row('Rent received so far', fmtMoney(p.received)) : null,
    p.received != null ? row('Still to receive as per slab', fmtMoney(p.toReceive), p.toReceive > 0 ? 'less' : 'ok') : null,
    note ? h('p', { class: 'muted small' }, note) : null);
}

let styled = false;
export function ensureSlabStyles() {
  if (styled) return; styled = true;
  const el = document.createElement('style');
  el.textContent = `
.slab-box{border:1px solid var(--line-2,#cdd2d9);border-left:4px solid var(--crimson,#8e1a2d);border-radius:12px;padding:12px 16px;background:var(--surface,#fff);display:grid;gap:6px}
.slab-box p{margin:0}
.slab-row{display:flex;justify-content:space-between;gap:12px;font-size:14px}
.slab-row.big{font-size:15.5px;padding:6px 0;border-bottom:1px dashed var(--line-2,#cdd2d9)}
.slab-row.less strong{color:var(--danger,#b42318)}.slab-row.more strong{color:var(--info,#2563a8)}.slab-row.ok strong{color:#0c7a4c}
.slab-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:4px}
`;
  document.head.append(el);
}
