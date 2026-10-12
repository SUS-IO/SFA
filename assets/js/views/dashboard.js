import { h, icon, btn, statusBadge, chip, emptyState, greeting, fmtDate, fmtDateTime, mount } from '../core/ui.js';
import { sb, fetchAll } from '../core/supa.js';
import { state, can, placeOf, availability, whoName, activeLocations } from '../core/store.js';
import { loadTodo } from '../core/todo.js';

const SEG = ['#1565C0', '#4A8FD9', '#0E3F7A', '#7DB0E8'];       // office shades
function colorFor(kind, i) {
  return kind === 'office' ? SEG[i % SEG.length] : kind === 'service' ? '#F26A8D' : kind === 'customer' ? '#102A43' : kind === 'waiting' ? '#F2A65A' : '#7FD3DF';
}

// Group items by place, in a stable order: offices, service centres, with customers, in transit.
function groupByPlace(items) {
  const map = new Map();
  for (const l of activeLocations()) map.set('loc:' + l.id, { key: 'loc:' + l.id, label: l.name, kind: l.type === 'Office' ? 'office' : 'service', n: 0 });
  map.set('customer', { key: 'customer', label: 'With customers', kind: 'customer', n: 0 });
  map.set('waiting', { key: 'waiting', label: 'Waiting for approval', kind: 'waiting', n: 0 });
  map.set('transit', { key: 'transit', label: 'In transit', kind: 'transit', n: 0 });
  for (const it of items) {
    const p = placeOf(it);
    const key = p.kind === 'customer' ? 'customer' : p.kind === 'waiting' ? 'waiting' : p.kind === 'transit' ? 'transit' : 'loc:' + it.current_location_id;
    if (!map.has(key)) map.set(key, { key, label: p.label, kind: p.kind === 'unknown' ? 'service' : p.kind, n: 0 });
    map.get(key).n++;
  }
  let oi = 0;
  const rows = [...map.values()].filter(r => r.n > 0 || r.kind === 'office' || r.kind === 'service');
  rows.forEach(r => { r.color = colorFor(r.kind, r.kind === 'office' ? oi++ : 0); });
  return rows;
}

function fleetPanel({ title, noun, route, items }) {
  const total = items.length, ready = items.filter(i => availability(i).ok).length, blocked = items.filter(i => i.status === 'blocked').length;
  const rows = groupByPlace(items);
  const body = total === 0
    ? emptyState(`No ${noun}s yet`, `Add your first ${noun} and it will show up here.`, btn(`Add ${noun}`, { kind: 'primary', ic: 'plus', onClick: () => { location.hash = `#/${route}?add=1`; } }))
    : h('div', null,
        h('p', { class: 'fleet-sentence' }, h('strong', String(ready)), ` of ${total} ${noun}s are ready to use`, blocked ? `, ${blocked} blocked` : '', '.'),
        h('div', { class: 'stackbar', role: 'img', 'aria-label': rows.map(r => `${r.label}: ${r.n}`).join(', ') },
          rows.filter(r => r.n).map(r => h('span', { style: { flexGrow: String(r.n), background: r.color }, title: `${r.label}: ${r.n}` }))),
        h('ul', { class: 'place-rows' }, rows.map(r => h('li', null,
          h('a', { href: `#/${route}?place=${encodeURIComponent(r.key)}`, class: 'place-row' },
            h('i', { class: 'swatch', style: { background: r.color } }), h('span', { class: 'place-name' }, r.label),
            h('span', { class: 'place-n' }, String(r.n)), icon('right', 16))))));
  return h('section', { class: 'panel fleet' }, h('div', { class: 'panel-head' }, h('h2', title)), body);
}

export async function render(root) {
  const first = state.me.user_name.split(/\s+/)[0];
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', `${greeting()}, ${first}`), h('p', { class: 'muted' }, fmtDate(new Date()))),
    h('div', { class: 'page-actions' },
      btn('New delivery', { kind: 'primary', ic: 'plus', onClick: () => { location.hash = '#/deliveries?new=1'; } }),
      btn('New customer', { ic: 'users', onClick: () => { location.hash = '#/customers?new=1'; } }))),
    h('div', { class: 'dash-grid' }, h('div', { class: 'skeleton-row tall' }), h('div', { class: 'skeleton-row tall' })));

  const todo = await loadTodo().catch(() => null);
  const [vehicles, helmets, pendingRes, pendingList] = await Promise.all([
    fetchAll(() => sb.from('vehicles').select('*').order('number')),
    fetchAll(() => sb.from('helmets').select('*').order('code')),
    sb.from('customers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('customers').select('id,name,mobile,created_by,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(6),
  ]);
  if (pendingRes.error) throw pendingRes.error;
  if (pendingList.error) throw pendingList.error;
  const pending = pendingRes.count || 0;

  const tile = (n, label, href, hot) => h('a', { class: `stat ${hot && n ? 'hot' : ''}`, href }, h('strong', String(n)), h('span', label));
  const stats = todo ? h('div', { class: 'stat-row' },
    tile(todo.count, 'on your to do list', '#/inbox', true), tile(todo.out.length, 'vehicles out with customers', '#/deliveries?status=active', false),
    tile(todo.overdue.length, 'overdue returns', '#/deliveries?status=active', true), tile(pending, 'customers waiting for approval', '#/customers?status=pending', false)) : null;
  const actionPanel = h('section', { class: 'panel action' },
    h('div', { class: 'panel-head' }, h('h2', can.approve() ? 'Waiting for your approval' : 'Customers waiting for approval'), pending ? h('span', { class: 'count-pill' }, String(pending)) : null),
    pending === 0
      ? h('div', { class: 'allclear' }, icon('check', 20), h('span', 'Nothing is waiting. You are all caught up.'))
      : h('ul', { class: 'work-list' }, pendingList.data.map(c => h('li', null, h('a', { class: 'work-row', href: `#/customers?open=${c.id}` },
          h('span', { class: 'work-main' }, h('strong', c.name), h('small', `Added by ${whoName(c.created_by)} on ${fmtDateTime(c.created_at)}`)),
          can.approve() ? (c.created_by === state.me.id && !can.superadmin() ? chip('Added by you', 'neutral') : statusBadge('pending', 'Review')) : statusBadge('pending', 'Pending'), icon('right', 16)))),
        pending > pendingList.data.length ? h('li', null, h('a', { class: 'work-more', href: '#/customers?status=pending' }, `See all ${pending}`)) : null));

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', `${greeting()}, ${first}`), h('p', { class: 'muted' }, fmtDate(new Date()))),
      h('div', { class: 'page-actions' },
        btn('New booking', { ic: 'clock', onClick: () => { location.hash = '#/deliveries?new=booking'; } }),
        btn('New delivery', { kind: 'primary', ic: 'plus', onClick: () => { location.hash = '#/deliveries?new=1'; } }),
        btn('New customer', { ic: 'users', onClick: () => { location.hash = '#/customers?new=1'; } }))),
    stats,
    h('div', { class: 'dash-grid' },
      h('div', { class: 'dash-col' }, actionPanel),
      h('div', { class: 'dash-col' },
        fleetPanel({ title: 'Where the vehicles are', noun: 'vehicle', route: 'vehicles', items: vehicles }),
        fleetPanel({ title: 'Where the helmets are', noun: 'helmet', route: 'helmets', items: helmets }))));
}
