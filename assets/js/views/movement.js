// Vehicle status: every vehicle (and helmet) in one place. Where it is, who has it, start and end dates, pending/overdue,
// booking lock, last update, last seen/communicated/reviewed. Move assets and mark them as reviewed from here.
// Put this file in: assets/js/views/movement.js
import { h, icon, btn, busy, chip, field, input, select, textarea, segmented, openSheet, toast, mount, emptyState, skeletonRows, debounce,
  fmtDateTime, fmtDateTimeY, fmtPhone, friendlyError } from '../core/ui.js';
import { rpc } from '../core/supa.js';
import { can, model, whoName, activeLocations, placeOf } from '../core/store.js';
import { placeChip } from './assets.js';
import { STALE_HOURS, ageHours, fmtAge, ensureAgeingStyles } from '../core/ageing.js';
import { dataTable } from '../core/table.js';

const DAY = 86400000;
const away = (r) => ['with_customer', 'waiting_approval'].includes(r.current_state);     // with a customer or waiting for approval
const movable = (r) => ['at_location', 'in_transit'].includes(r.current_state);
const asItem = (r) => ({ current_state: r.current_state, current_location_id: r.location_id, current_location_text: r.location_text, status: r.status });
const dueIn = (ts) => { const ms = new Date(ts).getTime() - Date.now(); const a = Math.abs(ms); const t = a < 3600000 ? `${Math.max(1, Math.round(a / 60000))} min` : a < DAY ? `${Math.round(a / 3600000)} h` : `${Math.round(a / DAY * 10) / 10} d`; return { late: ms < 0, text: t }; };

// What is this vehicle doing right now? rank puts the ones that need attention first.
export function vehicleStatus(r) {
  if (r.status === 'blocked') return { key: 'blocked', label: 'Blocked', kind: 'neutral', rank: 9 };
  if (r.current_state === 'with_customer') {
    if (r.delivery_status === 'pickup_pending') return { key: 'customer', label: 'Pickup waiting for approval', kind: 'aqua', rank: 2 };
    if (r.return_due && new Date(r.return_due) < new Date()) return { key: 'overdue', label: 'Pending, past end date', kind: 'pink', rank: 1 };
    return { key: 'customer', label: 'With customer', kind: 'navy', rank: 4 };
  }
  if (r.current_state === 'waiting_approval') return { key: 'customer', label: 'Delivery waiting for approval', kind: 'pink', rank: 3 };
  if (r.current_state === 'in_transit') return { key: 'service', label: 'In transit', kind: 'aqua', rank: 5 };
  const p = placeOf(asItem(r));
  if (p.kind !== 'office') return { key: 'service', label: `At ${p.label}`, kind: 'pink', rank: 5 };
  if (r.booking_id) return { key: 'booked', label: 'Ready, booked', kind: 'blue', rank: 6 };
  return { key: 'ready', label: 'Ready', kind: 'blue', rank: 7 };
}

export async function render(root, params) {
  ensureAgeingStyles();
  const st = { kind: params.kind === 'helmets' ? 'helmets' : 'vehicles', place: 'all', filter: params.stale === '1' ? 'stale' : 'all', q: '', rows: { vehicles: [], helmets: [] }, loaded: false };
  const one = () => (st.kind === 'vehicles' ? 'vehicle' : 'helmet');
  const selected = new Set();

  const host = h('div'); const bar = h('div', { class: 'mv-bar', hidden: true }); const stats = h('div', { class: 'stat-row' });
  const countEl = h('p', { class: 'result-count', 'aria-live': 'polite' });
  const tabs = segmented([{ value: 'vehicles', label: 'Vehicles' }, { value: 'helmets', label: 'Helmets' }], st.kind, (v) => { st.kind = v; st.filter = 'all'; selected.clear(); buildTable(); paint(); });
  const placeSel = select([{ value: 'all', label: 'All places' }, ...activeLocations().map(l => ({ value: 'loc:' + l.id, label: l.name }))], { 'aria-label': 'Filter by place' });
  const filterSel = select([], { 'aria-label': 'Filter by status' });
  const search = input({ type: 'search', placeholder: 'Search number, model, customer, booking', 'aria-label': 'Search' });
  let table = null;

  const FILTERS = {
    vehicles: [['all', 'All vehicles'], ['ready', 'Ready'], ['customer', 'With customers'], ['overdue', 'Pending, past end date'], ['booked', 'Booked (locked)'], ['service', 'Service or other places'], ['stale', `Not updated for ${STALE_HOURS}+ hours`], ['blocked', 'Blocked']],
    helmets: [['all', 'All helmets'], ['ready', 'At an Office'], ['customer', 'With customers'], ['service', 'Other places'], ['stale', `Not updated for ${STALE_HOURS}+ hours`], ['blocked', 'Blocked']],
  };
  const isStale = (r) => movable(r) && ageHours(r.last_at) >= STALE_HOURS;
  const helmetStatus = (r) => (r.status === 'blocked' ? { key: 'blocked', label: 'Blocked', kind: 'neutral', rank: 9 } : away(r) ? { key: 'customer', label: r.current_state === 'with_customer' ? 'With customer' : 'Waiting for approval', kind: 'navy', rank: 4 }
    : placeOf(asItem(r)).kind === 'office' ? { key: 'ready', label: 'At an Office', kind: 'blue', rank: 7 } : { key: 'service', label: `At ${placeOf(asItem(r)).label}`, kind: 'pink', rank: 5 });
  const statusOf = (r) => (st.kind === 'vehicles' ? vehicleStatus(r) : helmetStatus(r));
  const list = () => st.rows[st.kind];
  const matches = (r) => {
    const s = statusOf(r);
    if (st.filter === 'stale') { if (!isStale(r)) return false; } else if (st.filter !== 'all' && s.key !== st.filter && !(st.filter === 'customer' && s.key === 'overdue') && !(st.filter === 'ready' && s.key === 'booked')) return false;
    if (st.place !== 'all' && `loc:${r.location_id}` !== st.place) return false;
    if (st.q) { const t = [r.number, r.code, r.name, r.brand, model(r.model_id)?.name, r.customer_name, r.customer_mobile, r.delivery_code, r.booking_name, r.booking_code, r.booking_phone, r.location_text].join(' ').toUpperCase(); if (!t.includes(st.q.toUpperCase())) return false; }
    return true;
  };

  // ------------------------------------------------------------ the columns
  const code = (r) => r.number || r.code;
  const cols = () => {
    const v = st.kind === 'vehicles';
    return [
      { key: 'code', label: v ? 'Vehicle' : 'Helmet', sort: (r) => code(r), nowrap: true,
        render: (r) => h('span', null, h('strong', { class: 'code' }, code(r)), v ? h('small', [model(r.model_id)?.name, r.brand].filter(Boolean).join(', ')) : h('small', [r.name, r.helmet_type].filter(Boolean).join(', ')),
          h('a', { class: 'mv-hist', href: `#/${st.kind}?open=${r.id}` }, 'History')), csv: (r) => code(r) },
      ...(v ? [{ key: 'model', label: 'Model', sort: (r) => model(r.model_id)?.name || '', csv: (r) => model(r.model_id)?.name || '', render: (r) => model(r.model_id)?.name || '' }] : []),
      { key: 'status', label: 'Status', sort: (r) => statusOf(r).rank * 1e6 + (isStale(r) ? 0 : 1e5) + Math.min(9e4, 9e4 - ageHours(r.last_at)), csv: (r) => statusOf(r).label,
        render: (r) => { const s = statusOf(r); return h('span', null, chip(s.label, s.kind), isStale(r) ? h('small', { class: 'mv-age' }, `Not updated for ${fmtAge(ageHours(r.last_at))}`) : null, r.status === 'blocked' ? null : null); } },
      { key: 'where', label: 'Where now', sort: (r) => placeOf(asItem(r)).label, csv: (r) => placeOf(asItem(r)).label, render: (r) => placeChip(asItem(r)) },
      { key: 'with', label: 'With customer', sort: (r) => r.customer_name || '', csv: (r) => [r.customer_name, r.customer_mobile, r.delivery_code].filter(Boolean).join(' '),
        render: (r) => (r.customer_name ? h('span', null, h('strong', r.customer_name), h('small', fmtPhone(r.customer_mobile)), r.delivery_code ? h('a', { href: `#/deliveries?open=${r.delivery_id}` }, r.delivery_code) : null) : '') },
      { key: 'start', label: 'Start date', nowrap: true, sort: (r) => (r.delivered_at ? new Date(r.delivered_at).getTime() : null), csv: (r) => fmtDateTimeY(r.delivered_at), render: (r) => (r.delivered_at ? fmtDateTimeY(r.delivered_at) : '') },
      { key: 'end', label: 'End date', nowrap: true, sort: (r) => (r.return_due && away(r) ? new Date(r.return_due).getTime() : null), csv: (r) => (away(r) && r.return_due ? fmtDateTimeY(r.return_due) : ''),
        render: (r) => { if (!away(r) || !r.return_due) return ''; const d = dueIn(r.return_due);
          return h('span', null, fmtDateTimeY(r.return_due), r.delivery_status === 'pickup_pending' ? h('small', 'Pickup submitted') : d.late ? h('small', { class: 'mv-age' }, `Pending: ${d.text} past the end date`) : h('small', `Due in ${d.text}`),
            r.preferred_return_at ? h('small', `Customer prefers ${fmtDateTimeY(r.preferred_return_at)}`) : null); } },
      ...(v ? [{ key: 'booking', label: 'Booked and locked', nowrap: false, sort: (r) => (r.booking_from ? new Date(r.booking_from).getTime() : null), csv: (r) => (r.booking_id ? `${r.booking_code} ${r.booking_name} ${fmtDateTimeY(r.booking_from)} to ${fmtDateTimeY(r.booking_to)}` : ''),
        render: (r) => (r.booking_id ? h('span', null, chip('Locked', 'blue', 'lock'), h('strong', ` ${r.booking_name || 'Booking'}`), h('small', `${fmtDateTimeY(r.booking_from)} to ${fmtDateTimeY(r.booking_to)}`), h('a', { href: `#/deliveries?open=${r.booking_id}` }, r.booking_code)) : '') }] : []),
      { key: 'updated', label: 'Last updated', nowrap: true, sort: (r) => (r.last_at ? new Date(r.last_at).getTime() : null), csv: (r) => `${fmtDateTimeY(r.last_at)} ${r.last_event || ''} ${r.last_by ? whoName(r.last_by) : 'System'}`,
        render: (r) => h('span', null, fmtDateTime(r.last_at), h('small', `${r.last_event || ''}${r.last_by ? `, ${whoName(r.last_by)}` : ''}`)) },
      { key: 'checked', label: 'Last reviewed or seen', nowrap: true, sort: (r) => (r.check_at ? new Date(r.check_at).getTime() : null), csv: (r) => (r.check_at ? `${r.check_event} ${fmtDateTimeY(r.check_at)} ${whoName(r.check_by)}` : ''),
        render: (r) => (r.check_at ? h('span', null, chip(r.check_event, 'neutral', 'eye'), h('small', `${fmtDateTime(r.check_at)}, ${whoName(r.check_by)}`)) : h('small', 'Never')) },
    ];
  };

  function buildTable() {
    table = dataTable({ columns: cols(), rowKey: 'id', defaultSort: { key: 'status', dir: 'asc' }, selectable: true, selected, storageKey: `status-${st.kind}`, onSelect: paintBar,
      rowClass: (r) => (statusOf(r).key === 'overdue' || isStale(r) ? 'hot' : ''), empty: 'Nothing matches. Change the filter, place or search.' });
    mount(host, table.el);
  }

  function paintBar() {
    const n = selected.size; bar.hidden = n === 0; if (!n) return;
    const picked = list().filter(r => selected.has(r.id));
    mount(bar, h('strong', `${n} selected`),
      btn('Move', { kind: 'primary', ic: 'move', onClick: () => { const bad = picked.filter(r => !movable(r)); if (bad.length) return toast(`${bad.map(code).join(', ')} ${bad.length === 1 ? 'is' : 'are'} with a customer or waiting for approval and cannot be moved. Pickup (or swap) brings it back.`, 'error'); openMove(picked.map(r => r.id)); } }),
      can.approve() ? btn('Mark reviewed, seen or communicated', { ic: 'eye', onClick: () => openCheck(picked) }) : null,
      btn('Clear', { onClick: () => { selected.clear(); table.repaint(); paintBar(); } }));
  }

  function paint() {
    const all = list(); const shown = all.filter(matches);
    for (const id of [...selected]) if (!shown.some(r => r.id === id)) selected.delete(id);
    const tile = (n, label, key, hot) => h('button', { type: 'button', class: `stat ${hot && n ? 'hot' : ''}`, on: { click: () => { st.filter = key; filterSel.value = key; paint(); } }, style: 'cursor:pointer;text-align:left' }, h('strong', String(n)), h('span', label));
    const cnt = (key) => all.filter(r => statusOf(r).key === key).length;
    mount(stats, st.kind === 'vehicles'
      ? [tile(all.length, 'vehicles in all', 'all'), tile(all.filter(r => ['ready', 'booked'].includes(statusOf(r).key)).length, 'ready at an Office', 'ready'), tile(all.filter(r => ['customer', 'overdue'].includes(statusOf(r).key)).length, 'with customers', 'customer'),
        tile(cnt('overdue'), 'pending, past end date', 'overdue', true), tile(all.filter(r => r.booking_id).length, 'booked and locked', 'booked'), tile(all.filter(isStale).length, `not updated for ${STALE_HOURS}+ hours`, 'stale', true)]
      : [tile(all.length, 'helmets in all', 'all'), tile(cnt('ready'), 'at an Office', 'ready'), tile(cnt('customer'), 'with customers', 'customer'), tile(all.filter(isStale).length, `not updated for ${STALE_HOURS}+ hours`, 'stale', true)]);
    mount(filterSel, ...FILTERS[st.kind].map(([v, l]) => h('option', { value: v, selected: v === st.filter }, l))); filterSel.value = st.filter;
    countEl.textContent = all.length ? `${shown.length} of ${all.length} ${one()}${all.length === 1 ? '' : 's'}` : '';
    table.setRows(shown); paintBar();
  }

  async function reload() {
    try {
      const [v, hm] = await Promise.all([rpc('vehicle_status_board', {}), rpc('helmet_status_board', {})]);
      st.rows = { vehicles: v || [], helmets: hm || [] };
    } catch (e) { return mount(host, h('div', { class: 'empty' }, h('h3', 'Could not load the board'), h('p', friendlyError(e), h('br'), 'If this is the first time, run the Stage 4 database script.'), btn('Try again', { kind: 'primary', onClick: () => { mount(host, skeletonRows(6)); reload(); } }))); }
    if (!st.loaded) { st.loaded = true; buildTable(); }
    paint();
  }

  // ------------------------------------------------------------ move (any user, only assets that are not with a customer)
  function openMove(ids) {
    const noun = `${ids.length} ${one()}${ids.length === 1 ? '' : 's'}`;
    const where = select([{ value: '', label: 'Choose a place' }, ...activeLocations().map(l => ({ value: String(l.id), label: `${l.name} (${l.type})` }))]);
    const fWhere = field('Move to', where, { required: true });
    const note = textarea({ rows: '2', placeholder: 'Optional, for example Sent for service' });
    const submit = btn('Move', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'mv-form');
    const form = h('form', { id: 'mv-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fWhere.setError('');
      if (!where.value) return fWhere.setError('Choose where it is going.');
      busy(submit, async () => { try {
        const n = Number(await rpc('move_assets', { p_kind: one(), p_ids: ids, p_location_id: Number(where.value), p_note: note.value.trim() || null }));
        toast(n === 0 ? 'Nothing moved: already at that place.' : `${n} moved and saved to the log`); s.close(); selected.clear(); await reload();
      } catch (e) { fWhere.setError(friendlyError(e)); } }); } } },
      h('p', { class: 'muted' }, `${noun} will be moved. A booked vehicle can be moved too; the booking keeps it locked. Anything with a customer cannot be moved.`), fWhere, field('Note', note));
    const s = openSheet({ title: `Move ${noun}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  // ------------------------------------------------------------ reviewed / seen / communicated (Approver and above)
  function openCheck(picked) {
    const ids = picked.map(r => r.id); const noun = `${ids.length} ${one()}${ids.length === 1 ? '' : 's'}`;
    const anyAway = picked.some(away);
    const opts = [{ value: 'Reviewed', label: 'Reviewed' }, ...(anyAway ? [] : [{ value: 'Seen', label: 'Seen in person' }]), { value: 'Communicated', label: 'Communicated' }];
    const help = h('p', { class: 'muted small' });
    const seg = segmented(opts, 'Reviewed', () => paintHelp());
    const paintHelp = () => { help.textContent = { Reviewed: 'You checked its record and status on this board.', Seen: 'You looked at it and it is where the system says.', Communicated: 'You confirmed by phone or message with the person who has it.' }[seg.get()]; };
    paintHelp();
    const note = textarea({ rows: '2', placeholder: 'Optional' });
    const err = h('p', { class: 'field-error', hidden: true });
    const submit = btn('Save to log', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'ck-form');
    const form = h('form', { id: 'ck-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); err.hidden = true;
      busy(submit, async () => { try {
        const n = Number(await rpc('record_asset_check', { p_kind: one(), p_ids: ids, p_event: seg.get(), p_note: note.value.trim() || null }));
        toast(`${n} marked as ${seg.get().toLowerCase()} and saved to the log`); s.close(); selected.clear(); await reload();
      } catch (e) { err.textContent = friendlyError(e); err.hidden = false; } }); } } },
      h('p', { class: 'muted' }, `${noun} will be marked and written to the log. You can do this as many times as you like.${anyAway ? ' Something here is with a customer, so "Seen in person" is not offered.' : ''}`),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'What did you do?'), seg), help, field('Note', note), err);
    const s = openSheet({ title: `Mark ${noun}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  placeSel.addEventListener('change', () => { st.place = placeSel.value; paint(); });
  filterSel.addEventListener('change', () => { st.filter = filterSel.value; paint(); });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); paint(); }, 150));
  const csvBtn = btn('Download as CSV', { ic: 'download', onClick: () => table?.download(`${st.kind}-status-${new Date().toISOString().slice(0, 10)}`) });
  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', 'Vehicle status'),
      h('p', { class: 'muted' }, 'Every vehicle in one place: where it is, who has it, start and end dates, bookings that lock it, and when it was last reviewed. Click a heading to sort.'))),
    h('div', { class: 'toolbar' }, tabs), stats,
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), h('div', { class: 'filters' }, filterSel, placeSel, csvBtn)),
    countEl, bar, host);
  mount(host, skeletonRows(6));
  await reload();
  const tick = setInterval(() => { if (!document.hidden && table) table.repaint(); }, 60000);      // keep the ageing times fresh
  const poll = setInterval(() => { if (!document.hidden) reload(); }, 5 * 60000);
  return () => { clearInterval(tick); clearInterval(poll); };
}
