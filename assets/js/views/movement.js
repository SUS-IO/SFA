// Asset movement: every vehicle and helmet that is not with a customer. Move them, verify them, see how stale they are.
// Put this file in: assets/js/views/movement.js
import { h, icon, btn, busy, chip, field, input, select, textarea, segmented, openSheet, toast, mount, emptyState, skeletonRows, debounce,
  fmtDateTime, friendlyError } from '../core/ui.js';
import { rpc } from '../core/supa.js';
import { can, model, whoName, activeLocations } from '../core/store.js';
import { placeChip } from './assets.js';
import { STALE_HOURS, ageHours, fmtAge, fetchBoard, ensureAgeingStyles } from '../core/ageing.js';

const asItem = (r) => ({ current_state: r.current_state, current_location_id: r.location_id, current_location_text: r.location_text, status: r.status });

export async function render(root, params) {
  ensureAgeingStyles();
  const st = { kind: params.kind === 'helmets' ? 'helmets' : 'vehicles', place: 'all', age: params.stale === '1' ? 'stale' : 'all', q: '', rows: [], picked: new Set() };
  const one = () => (st.kind === 'vehicles' ? 'vehicle' : 'helmet');

  const list = h('div', { class: 'mv-table' });
  const bar = h('div', { class: 'mv-bar', hidden: true });
  const stats = h('div', { class: 'stat-row' });
  const countEl = h('p', { class: 'result-count', 'aria-live': 'polite' });
  const tabs = segmented([{ value: 'vehicles', label: 'Vehicles' }, { value: 'helmets', label: 'Helmets' }], st.kind, (v) => { st.kind = v; st.picked.clear(); paint(); });
  const placeSel = select([{ value: 'all', label: 'All places' }, ...activeLocations().map(l => ({ value: 'loc:' + l.id, label: l.name }))], { 'aria-label': 'Filter by place' });
  const ageSel = select([{ value: 'all', label: 'Any age' }, { value: 'stale', label: `Not updated for ${STALE_HOURS}+ hours` }], { 'aria-label': 'Filter by age', value: st.age });
  const search = input({ type: 'search', placeholder: 'Search by number or code', 'aria-label': 'Search' });
  let headBox = null;

  const visible = () => st.rows.filter(r => r.kind === one()).filter(r => {
    if (st.q && !String(r.code).toUpperCase().includes(st.q.toUpperCase())) return false;
    if (st.place !== 'all' && `loc:${r.location_id}` !== st.place) return false;
    if (st.age === 'stale' && ageHours(r.last_at) < STALE_HOURS) return false;
    return true;
  }).sort((a, b) => new Date(a.last_at) - new Date(b.last_at));      // oldest update first

  function paintBar() {
    const n = st.picked.size; bar.hidden = n === 0;
    if (headBox) { const shown = visible(); headBox.checked = shown.length > 0 && shown.every(r => st.picked.has(r.id)); }
    if (!n) return;
    mount(bar, h('strong', `${n} selected`),
      btn('Move', { kind: 'primary', ic: 'move', onClick: () => openMove([...st.picked]) }),
      can.approve() ? btn('Mark seen or communicated', { ic: 'eye', onClick: () => openCheck([...st.picked]) }) : null,
      btn('Clear', { onClick: () => { st.picked.clear(); paint(); } }));
  }

  function paint() {
    const shown = visible();
    for (const id of [...st.picked]) if (!shown.some(r => r.id === id)) st.picked.delete(id);   // hidden rows are not selected
    const staleN = (k) => st.rows.filter(r => r.kind === k && ageHours(r.last_at) >= STALE_HOURS).length;
    const tile = (n, label, hot) => h('div', { class: `stat ${hot && n ? 'hot' : ''}` }, h('strong', String(n)), h('span', label));
    mount(stats,
      tile(st.rows.filter(r => r.kind === 'vehicle').length, 'vehicles not with customers'), tile(st.rows.filter(r => r.kind === 'helmet').length, 'helmets not with customers'),
      tile(staleN('vehicle'), `vehicles not updated for ${STALE_HOURS}+ hours`, true), tile(staleN('helmet'), `helmets not updated for ${STALE_HOURS}+ hours`, true));
    const total = st.rows.filter(r => r.kind === one()).length;
    countEl.textContent = total ? `${shown.length} of ${total} ${one()}s` : '';
    headBox = null;
    if (!total) { mount(list, emptyState(`No ${one()}s here`, `Every ${one()} is with a customer, or none have been added yet.`)); paintBar(); return; }
    if (!shown.length) { mount(list, emptyState('Nothing matches', 'Change the place, age or search.')); paintBar(); return; }
    const hasModel = st.kind === 'vehicles'; const nm = hasModel ? '' : ' nm';
    headBox = h('input', { type: 'checkbox', 'aria-label': 'Select all', on: { change: (e) => { shown.forEach(r => (e.target.checked ? st.picked.add(r.id) : st.picked.delete(r.id))); paint(); } } });
    mount(list,
      h('div', { class: `mv-row mv-head${nm}`, 'aria-hidden': 'true' }, h('label', { class: 'mv-check' }, headBox),
        h('span', hasModel ? 'Vehicle' : 'Helmet'), hasModel ? h('span', 'Model') : null, h('span', 'Where now'), h('span', 'Last updated'), h('span', 'Updated by'), h('span', 'Ageing')),
      shown.map(r => {
        const hrs = ageHours(r.last_at), old = hrs >= STALE_HOURS;
        const box = h('input', { type: 'checkbox', 'aria-label': `Select ${r.code}`, on: { change: (e) => { e.target.checked ? st.picked.add(r.id) : st.picked.delete(r.id); paintBar(); } } });
        box.checked = st.picked.has(r.id);
        return h('div', { class: `mv-row${nm}${old ? ' stale' : ''}` }, h('label', { class: 'mv-check' }, box),
          h('span', { class: 'mv-c' }, h('strong', { class: 'code' }, r.code), r.status === 'blocked' ? h('small', 'Blocked') : null),
          hasModel ? h('span', { class: 'mv-c' }, model(r.model_id)?.name || '') : null,
          h('span', { class: 'mv-c' }, placeChip(asItem(r))),
          h('span', { class: 'mv-c' }, fmtDateTime(r.last_at), r.last_event ? h('small', `${r.last_event}${r.last_note ? `: ${r.last_note}` : ''}`) : null),
          h('span', { class: 'mv-c' }, r.last_by ? whoName(r.last_by) : 'System'),
          h('span', { class: 'mv-c' }, chip(fmtAge(hrs), old ? 'pink' : 'blue', 'clock'), h('a', { class: 'mv-hist', href: `#/${st.kind}?open=${r.id}` }, 'History')));
      }));
    paintBar();
  }

  async function reload() {
    try { st.rows = await fetchBoard(); }
    catch (e) { return mount(list, h('div', { class: 'empty' }, h('h3', 'Could not load the assets'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: () => { mount(list, skeletonRows(6)); reload(); } }))); }
    paint();
  }

  // ------------------------------------------------------------ move (any user)
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
        toast(n === 0 ? 'Nothing moved: already at that place.' : `${n} moved and saved to the log`); s.close(); st.picked.clear(); await reload();
      } catch (e) { fWhere.setError(friendlyError(e)); } }); } } },
      h('p', { class: 'muted' }, `${noun} will be moved. Anything with a customer is locked and cannot be moved.`), fWhere, field('Note', note));
    const s = openSheet({ title: `Move ${noun}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  // ------------------------------------------------------------ verify (Approver and above)
  function openCheck(ids) {
    const noun = `${ids.length} ${one()}${ids.length === 1 ? '' : 's'}`;
    const help = h('p', { class: 'muted small' });
    const seg = segmented([{ value: 'Seen', label: 'Seen in person' }, { value: 'Communicated', label: 'Communicated' }], 'Seen', () => paintHelp());
    const paintHelp = () => { help.textContent = seg.get() === 'Seen' ? 'You looked at it and it is where the system says.' : 'You confirmed by phone or message with the person who has it.'; };
    paintHelp();
    const note = textarea({ rows: '2', placeholder: 'Optional' });
    const err = h('p', { class: 'field-error', hidden: true });
    const submit = btn('Save to log', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'ck-form');
    const form = h('form', { id: 'ck-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); err.hidden = true;
      busy(submit, async () => { try {
        const n = Number(await rpc('record_asset_check', { p_kind: one(), p_ids: ids, p_event: seg.get(), p_note: note.value.trim() || null }));
        toast(`${n} marked as ${seg.get().toLowerCase()} and saved to the log`); s.close(); st.picked.clear(); await reload();
      } catch (e) { err.textContent = friendlyError(e); err.hidden = false; } }); } } },
      h('p', { class: 'muted' }, `${noun} will be marked and written to the log. You can do this as many times as you like.`),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How did you check?'), seg), help, field('Note', note), err);
    const s = openSheet({ title: `Mark ${noun}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  placeSel.addEventListener('change', () => { st.place = placeSel.value; paint(); });
  ageSel.addEventListener('change', () => { st.age = ageSel.value; paint(); });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); paint(); }, 150));
  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', 'Asset movement'),
      h('p', { class: 'muted' }, 'Vehicles and helmets that are not with a customer. Tick the ones you want, then move them or mark them as seen.'))),
    h('div', { class: 'toolbar' }, tabs), stats,
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), h('div', { class: 'filters' }, placeSel, ageSel)),
    countEl, bar, list);
  mount(list, skeletonRows(6));
  await reload();
  const tick = setInterval(() => { if (!document.hidden) paint(); }, 60000);      // keep the ageing times fresh
  return () => clearInterval(tick);
}
