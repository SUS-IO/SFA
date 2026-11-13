import { h, icon, btn, busy, chip, field, input, select, segmented, mount, emptyState, skeletonRows, fmtDateTimeY, fmtDateTime, friendlyError } from '../core/ui.js';
import { sb, fetchAll } from '../core/supa.js';
import { state, loc, whoName } from '../core/store.js';

const PAGE = 50;
const EVENTS = ['Added', 'Movement', 'Manual Check', 'Seen', 'Communicated', 'Call remark', 'Correction', 'Blocked', 'Unblocked', 'Delivery Submitted', 'Delivery', 'Swap Submitted', 'Swap Out', 'Swap In', 'Pickup Submitted', 'Pickup'];
const EVENT_CHIP = { Added: 'neutral', Movement: 'blue', 'Manual Check': 'aqua', Seen: 'aqua', Communicated: 'blue', 'Call remark': 'aqua', Correction: 'pink', Blocked: 'navy', Unblocked: 'neutral', Delivery: 'blue', 'Delivery Submitted': 'aqua', 'Swap Submitted': 'aqua', 'Pickup Submitted': 'aqua', 'Swap Out': 'pink', 'Swap In': 'pink', Pickup: 'blue' };
const place = (s, id, text) => !s ? '' : s === 'at_location' ? (loc(id)?.name || 'Unknown place') : s === 'with_customer' ? `With customer${text ? ` (${text})` : ''}` : s === 'waiting_approval' ? `Waiting for approval${loc(id) ? ` (${loc(id).name})` : ''}` : `In transit${text ? ` (${text})` : ''}`;

export async function render(root, params) {
  const st = { kind: params.kind === 'helmets' ? 'helmets' : 'vehicles', event: 'all', item: '', from: '', to: '', rows: [], more: false, items: [] };
  const T = () => st.kind === 'vehicles' ? { table: 'vehicle_logs', fk: 'vehicle_id', codeKey: 'number', items: 'vehicles', label: 'Vehicle' } : { table: 'helmet_logs', fk: 'helmet_id', codeKey: 'code', items: 'helmets', label: 'Helmet' };
  const list = h('div', { class: 'rows rows-logs', role: 'list' });
  const moreWrap = h('div', { class: 'more-wrap' });
  const tabs = segmented([{ value: 'vehicles', label: 'Vehicle logs' }, { value: 'helmets', label: 'Helmet logs' }], st.kind, async (v) => { st.kind = v; st.item = ''; itemIn.value = ''; await loadItems(); load(true); });
  const eventSel = select([{ value: 'all', label: 'All events' }, ...EVENTS.map(e => ({ value: e, label: e }))], { 'aria-label': 'Filter by event' });
  const itemIn = input({ placeholder: 'Vehicle or helmet', 'aria-label': 'Filter by vehicle or helmet', list: 'log-items' });
  const dl = h('datalist', { id: 'log-items' });
  const fromIn = input({ type: 'date', 'aria-label': 'From date' }), toIn = input({ type: 'date', 'aria-label': 'To date' });

  async function loadItems() {
    const t = T();
    try { st.items = await fetchAll(() => sb.from(t.items).select(`id,${t.codeKey}`).order(t.codeKey)); } catch { st.items = []; }
    mount(dl, st.items.map(i => h('option', { value: i[t.codeKey] })));
    itemIn.placeholder = `${t.label} ${t.codeKey === 'number' ? 'number' : 'code'}`;
  }
  const codeOf = (id) => st.items.find(i => i.id === id)?.[T().codeKey] ?? `#${id}`;
  // The browser clock is IST for the people using this; treat the date boxes as IST days.
  const istStart = (d) => new Date(`${d}T00:00:00+05:30`).toISOString();
  const istEndExclusive = (d) => new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86400000).toISOString();

  async function load(reset) {
    const t = T();
    if (reset) { st.rows = []; mount(list, skeletonRows(6)); moreWrap.replaceChildren(); }
    try {
      let q = sb.from(t.table).select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).range(st.rows.length, st.rows.length + PAGE - 1);
      if (st.event !== 'all') q = q.eq('event', st.event);
      if (st.item) { const m = st.items.find(i => String(i[t.codeKey]).toUpperCase() === st.item.toUpperCase()); if (!m) { st.rows = []; return paint(`No ${t.items === 'vehicles' ? 'vehicle' : 'helmet'} called "${st.item}".`); } q = q.eq(t.fk, m.id); }
      if (st.from) q = q.gte('created_at', istStart(st.from));
      if (st.to) q = q.lt('created_at', istEndExclusive(st.to));
      const { data, error } = await q; if (error) throw error;
      st.rows.push(...data); st.more = data.length === PAGE;
    } catch (e) { return mount(list, h('div', { class: 'empty' }, h('h3', 'Could not load the logs'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: () => load(true) }))); }
    paint();
  }
  function paint(emptyMsg) {
    const t = T();
    if (!st.rows.length) { mount(list, emptyState('No log entries', emptyMsg || 'Nothing matches these filters.')); moreWrap.replaceChildren(); return; }
    mount(list, h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', 'When'), h('span', t.label), h('span', 'Event'), h('span', 'What happened'), h('span', 'By')),
      st.rows.map(l => {
        const from = place(l.from_state, l.from_location_id, l.from_location_text), to = place(l.state, l.location_id, l.location_text);
        return h('div', { class: 'row', role: 'listitem' },
          h('span', { class: 'cell cell-sub', title: fmtDateTimeY(l.created_at) }, fmtDateTime(l.created_at)),
          h('span', { class: 'cell cell-main' }, h('strong', { class: 'code' }, codeOf(l[t.fk]))),
          h('span', { class: 'cell' }, chip(l.event, EVENT_CHIP[l.event] || 'neutral')),
          h('span', { class: 'cell cell-wide' }, from && from !== to ? `${from} to ${to}` : to, l.note ? h('small', { class: 'cell-note' }, l.note) : null),
          h('span', { class: 'cell cell-sub' }, whoName(l.by_user)));
      }));
    moreWrap.replaceChildren(st.more ? btn('Show older entries', { onClick: (e) => busy(e.currentTarget, () => load(false)) }) : '');
  }

  const apply = () => { st.event = eventSel.value; st.item = itemIn.value.trim(); st.from = fromIn.value; st.to = toIn.value; load(true); };
  [eventSel, fromIn, toIn].forEach(el => el.addEventListener('change', apply));
  itemIn.addEventListener('change', apply); itemIn.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Logs'), h('p', { class: 'muted' }, 'Every move, check, delivery and pickup. Entries are written by the system and cannot be edited or deleted.'))),
    h('div', { class: 'toolbar' }, tabs), h('div', { class: 'toolbar filters-line' }, eventSel, itemIn, dl, h('label', { class: 'datebox' }, h('span', 'From'), fromIn), h('label', { class: 'datebox' }, h('span', 'To'), toIn)), list, moreWrap);
  await loadItems(); await load(true);
}
