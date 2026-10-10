// One screen for both Vehicles and Helmets: same rules, same logs.
import { h, icon, btn, busy, chip, statusBadge, field, input, textarea, select, segmented, openSheet, confirmDialog, toast, mount,
  emptyState, skeletonRows, debounce, fmtDateTime, fmtDateTimeY, friendlyError } from '../core/ui.js';
import { sb, fetchAll, rpc } from '../core/supa.js';
import { state, can, loc, model, placeOf, availability, whoName, activeLocations } from '../core/store.js';
import { parseCodes, parseVehicleLines } from '../core/codes.js';

const KINDS = {
  vehicles: { table: 'vehicles', logs: 'vehicle_logs', fk: 'vehicle_id', noun: 'vehicle', codeKey: 'number', codeLabel: 'Vehicle number', hasModel: true, ic: 'bike' },
  helmets:  { table: 'helmets',  logs: 'helmet_logs',  fk: 'helmet_id',  noun: 'helmet',  codeKey: 'code',   codeLabel: 'Helmet code',    hasModel: false, ic: 'helmet' },
};
const PLACE_CHIP = { office: ['blue', 'pin'], service: ['pink', 'pin'], customer: ['navy', 'users'], transit: ['aqua', 'move'], unknown: ['neutral', 'pin'] };
export const placeChip = (it) => { const p = placeOf(it); const [k, ic] = PLACE_CHIP[p.kind]; return chip(p.label, k, ic); };

export async function render(kind, root, params) {
  const K = KINDS[kind]; const Noun = K.noun[0].toUpperCase() + K.noun.slice(1);
  const st = { items: [], place: params.place || 'all', model: 'all', q: '' };
  const list = h('div', { class: `rows rows-${kind}`, role: 'list' });
  const countEl = h('p', { class: 'result-count', 'aria-live': 'polite' });

  const placeOpts = () => [{ value: 'all', label: 'All places' }, { value: 'ready', label: `Ready to use (at an office)` },
    ...activeLocations().map(l => ({ value: 'loc:' + l.id, label: l.name })),
    { value: 'customer', label: 'With customers' }, { value: 'transit', label: 'In transit' }, { value: 'blocked', label: 'Blocked' }];
  const placeSel = select(placeOpts(), { 'aria-label': 'Filter by place', value: st.place });
  if (![...placeSel.options].some(o => o.value === st.place)) { st.place = 'all'; placeSel.value = 'all'; }
  const modelSel = K.hasModel ? select([{ value: 'all', label: 'All models' }, ...state.models.filter(m => m.active).map(m => ({ value: String(m.id), label: m.name }))], { 'aria-label': 'Filter by model' }) : null;
  const search = input({ type: 'search', placeholder: `Search ${K.codeLabel.toLowerCase()}`, 'aria-label': `Search ${K.noun}s` });

  const matches = (it) => {
    if (st.q && !String(it[K.codeKey]).toUpperCase().includes(st.q.toUpperCase())) return false;
    if (K.hasModel && st.model !== 'all' && String(it.model_id) !== st.model) return false;
    const p = placeOf(it);
    switch (st.place) {
      case 'all': return true;
      case 'ready': return availability(it).ok;
      case 'blocked': return it.status === 'blocked';
      case 'customer': return p.kind === 'customer';
      case 'transit': return p.kind === 'transit';
      default: return st.place.startsWith('loc:') && p.kind !== 'customer' && p.kind !== 'transit' && `loc:${it.current_location_id}` === st.place;
    }
  };
  function paint() {
    const shown = st.items.filter(matches);
    countEl.textContent = st.items.length ? `${shown.length} of ${st.items.length} ${K.noun}s` : '';
    if (!st.items.length) return mount(list, emptyState(`No ${K.noun}s yet`, `Add your first ${K.noun}. Its place is recorded in the log from day one.`, btn(`Add ${K.noun}${kind === 'helmets' ? 's' : ''}`, { kind: 'primary', ic: 'plus', onClick: openAdd })));
    if (!shown.length) return mount(list, emptyState('Nothing matches', 'Change the place, model or search.'));
    mount(list, h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', K.codeLabel), K.hasModel ? h('span', 'Model') : null, h('span', 'Where now'), h('span', 'Status'), h('span', 'Last update')),
      shown.map(it => h('a', { class: 'row', role: 'listitem', href: `#/${kind}?open=${it.id}`, on: { click: (e) => { e.preventDefault(); openItem(it.id); } } },
        h('span', { class: 'cell cell-main' }, h('strong', { class: 'code' }, it[K.codeKey])),
        K.hasModel ? h('span', { class: 'cell' }, model(it.model_id)?.name || '') : null,
        h('span', { class: 'cell' }, placeChip(it)),
        h('span', { class: 'cell' }, it.status === 'blocked' ? statusBadge('blocked') : availability(it).ok ? statusBadge('active', 'Ready') : h('span', { class: 'muted small' }, 'In use or away')),
        h('span', { class: 'cell cell-sub' }, it.last_log_at ? fmtDateTime(it.last_log_at) : ''),
        icon('right', 16, 'row-go'))));
  }
  async function load() {
    mount(list, skeletonRows(6));
    try { st.items = await fetchAll(() => sb.from(K.table).select('*').order(K.codeKey)); } catch (e) { return mount(list, h('div', { class: 'empty' }, h('h3', `Could not load ${K.noun}s`), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: load }))); }
    paint();
  }

  placeSel.addEventListener('change', () => { st.place = placeSel.value; paint(); });
  modelSel?.addEventListener('change', () => { st.model = modelSel.value; paint(); });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); paint(); }, 150));
  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', `${Noun}s`), h('p', { class: 'muted' }, kind === 'vehicles' ? 'Where every vehicle is, and who moved it last.' : 'Only helmets at an office can go out with a delivery.')),
      h('div', { class: 'page-actions' }, kind === 'vehicles' ? btn('Add several', { ic: 'list', onClick: openAddSeveral }) : null, btn(kind === 'vehicles' ? 'Add vehicle' : 'Add helmets', { kind: 'primary', ic: 'plus', onClick: openAdd }))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), h('div', { class: 'filters' }, placeSel, modelSel)), countEl, list);
  await load();
  if (params.add) openAdd();
  if (params.open) openItem(Number(params.open));

  const reload = async () => { await load(); };
  const locOptions = (selected) => activeLocations().map(l => ({ value: String(l.id), label: `${l.name} (${l.type})`, selected: l.id === selected }));

  // ---------------------------------------------------------------- add
  function openAdd() {
    if (!activeLocations().length) return toast('Add a location in the Admin panel first.', 'error');
    if (kind === 'vehicles') {
      const num = input({ placeholder: 'For example V1001', autofocus: true });
      const mod = select(state.models.filter(m => m.active).map(m => ({ value: String(m.id), label: m.name })));
      const where = select(locOptions());
      const rem = textarea({ rows: '2' });
      const fNum = field('Vehicle number', num, { required: true }), fMod = field('Model', mod, { required: true }), fWhere = field('Where is it now?', where, { required: true }), fRem = field('Remarks', rem);
      const submit = btn('Add vehicle', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'add-form');
      const form = h('form', { id: 'add-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fNum.setError('');
        if (!num.value.trim()) return fNum.setError('Enter the vehicle number.');
        busy(submit, async () => { try { await rpc('add_vehicle', { p_number: num.value, p_model_id: Number(mod.value), p_location_id: Number(where.value), p_remarks: rem.value || null });
          toast('Vehicle added'); s.close(); reload(); } catch (e) { fNum.setError(friendlyError(e)); } }); } } }, fNum, h('div', { class: 'grid-2' }, fMod, fWhere), fRem);
      const s = openSheet({ title: 'Add vehicle', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
    } else {
      const codes = textarea({ rows: '5', placeholder: 'A1-A10\nF65, F66', autofocus: true });
      const where = select(locOptions());
      const fCodes = field('Helmet codes', codes, { required: true, hint: 'One per line or separated by commas. Use A1-A10 for a range.' });
      const preview = h('p', { class: 'muted small' });
      codes.addEventListener('input', () => { const r = parseCodes(codes.value); preview.textContent = r.error || (r.codes.length ? `${r.codes.length} helmet${r.codes.length === 1 ? '' : 's'}: ${r.codes.slice(0, 6).join(', ')}${r.codes.length > 6 ? '…' : ''}` : ''); });
      const submit = btn('Add helmets', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'add-form');
      const form = h('form', { id: 'add-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fCodes.setError('');
        const r = parseCodes(codes.value); if (r.error) return fCodes.setError(r.error); if (!r.codes.length) return fCodes.setError('Enter at least one helmet code.');
        busy(submit, async () => { try { const res = await rpc('add_helmets', { p_codes: r.codes, p_location_id: Number(where.value) });
          toast(`${res.added} helmet${res.added === 1 ? '' : 's'} added${res.skipped?.length ? `, ${res.skipped.length} already existed` : ''}`);
          if (res.skipped?.length) toast(`Already existed: ${res.skipped.slice(0, 8).join(', ')}${res.skipped.length > 8 ? '…' : ''}`, 'error');
          s.close(); reload(); } catch (e) { fCodes.setError(friendlyError(e)); } }); } } }, fCodes, preview, field('Where are they now?', where, { required: true }));
      const s = openSheet({ title: 'Add helmets', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
    }
  }

  function openAddSeveral() {
    if (!activeLocations().length) return toast('Add a location in the Admin panel first.', 'error');
    const lines = textarea({ rows: '8', placeholder: 'V1001\nV1002, Scooter\nV1003, Sports Bike', autofocus: true });
    const defModel = select(state.models.filter(m => m.active).map(m => ({ value: String(m.id), label: m.name })));
    const where = select(locOptions());
    const out = h('div', { class: 'results' });
    const fLines = field('Vehicles, one per line', lines, { required: true, hint: 'Write the number, then a comma and the model. Lines without a model use the model chosen below.' });
    const submit = btn('Add vehicles', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'several-form');
    const form = h('form', { id: 'several-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fLines.setError('');
      const rows = parseVehicleLines(lines.value); if (!rows.length) return fLines.setError('Enter at least one vehicle number.');
      busy(submit, async () => {
        mount(out); let ok = 0;
        for (const r of rows) {
          const m = r.model ? state.models.find(x => x.active && x.name.toLowerCase() === r.model.toLowerCase()) : model(Number(defModel.value));
          try { if (!m) throw new Error(`Unknown model "${r.model}"`); await rpc('add_vehicle', { p_number: r.number, p_model_id: m.id, p_location_id: Number(where.value), p_remarks: null }); ok++;
            out.append(h('p', { class: 'res ok' }, icon('check', 16), `${r.number.toUpperCase()} added`)); }
          catch (e) { out.append(h('p', { class: 'res bad' }, icon('alert', 16), `${r.number}: ${friendlyError(e)}`)); }
        }
        toast(`${ok} of ${rows.length} added`, ok === rows.length ? 'ok' : 'error'); reload();
      }); } } }, fLines, h('div', { class: 'grid-2' }, field('Default model', defModel), field('Where are they now?', where)), out);
    const s = openSheet({ title: 'Add several vehicles', body: form, footer: [btn('Close', { onClick: () => s.close() }), submit] });
  }

  // --------------------------------------------------------------- detail
  async function openItem(id) {
    const it = st.items.find(x => x.id === id);
    if (!it) return toast(`That ${K.noun} was not found.`, 'error');
    const s = openSheet({ title: it[K.codeKey], subtitle: K.hasModel ? model(it.model_id)?.name : 'Helmet', body: skeletonRows(4), wide: true });
    paintItem(s, it);
    try {
      const { data, error } = await sb.from(K.logs).select('*').eq(K.fk, id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30);
      if (error) throw error; s.setLogs?.(data);
    } catch (e) { s.setLogs?.(null, friendlyError(e)); }
  }
  function paintItem(s, it) {
    const av = availability(it);
    const tl = h('ol', { class: 'timeline' }, h('li', { class: 'muted' }, 'Loading history…'));
    s.setLogs = (logs, err) => mount(tl, err ? h('li', { class: 'muted' }, err) : !logs.length ? h('li', { class: 'muted' }, 'No history yet.') : logs.map(l => h('li', null,
      h('span', { class: 'tl-dot' }), h('div', { class: 'tl-main' }, h('strong', logLine(l)), h('small', `${whoName(l.by_user)} on ${fmtDateTimeY(l.created_at)}`), l.note ? h('p', { class: 'tl-note' }, l.note) : null))));
    mount(s.body,
      h('div', { class: 'detail-top' }, it.status === 'blocked' ? statusBadge('blocked') : statusBadge('active', 'Active'), placeChip(it)),
      h('div', { class: `callout ${av.ok ? 'ok' : ''}` }, icon(av.ok ? 'check' : 'info', 18), h('span', av.ok ? `Ready to use. It is at ${placeOf(it).label}.` : `Not available for a delivery. ${av.why}`)),
      it.remarks ? h('div', { class: 'section-lite' }, h('h3', 'Remarks'), h('p', { class: 'prewrap' }, it.remarks)) : null,
      h('div', { class: 'section-lite' }, h('h3', 'History'), tl));
    const foot = [];
    if (can.manager()) foot.push(btn('Edit', { ic: 'edit', onClick: () => { s.close(); openEdit(it); } }));
    if (can.manager()) foot.push(it.status === 'blocked' ? btn('Unblock', { ic: 'undo', onClick: () => setStatus(s, it, 'active') }) : btn('Block', { ic: 'ban', cls: 'btn-outline-danger', onClick: () => setStatus(s, it, 'blocked') }));
    foot.push(btn('Move or check', { kind: 'primary', ic: 'move', onClick: () => openMove(s, it) }));
    if (s.foot) mount(s.foot, foot); else { const f = h('div', { class: 'sheet-foot' }, foot); s.panel.append(f); s.foot = f; }
  }
  function logLine(l) {
    const to = describe(l.state, l.location_id, l.location_text), from = l.from_state ? describe(l.from_state, l.from_location_id, l.from_location_text) : null;
    switch (l.event) {
      case 'Added': return `Added at ${to}`;
      case 'Movement': return `Moved ${from} to ${to}`;
      case 'Manual Check': return `Checked at ${to}`;
      case 'Correction': return `Record corrected to ${to}`;
      case 'Blocked': case 'Unblocked': return `${l.event}, at ${to}`;
      case 'Delivery': return `Delivered, ${to}`;
      case 'Pickup': return `Picked up, ${to}`;
      default: return `${l.event}: ${to}`;
    }
  }
  const describe = (s, id, text) => s === 'at_location' ? (loc(id)?.name || 'unknown place') : s === 'with_customer' ? `with customer${text ? ` (${text})` : ''}` : `in transit${text ? ` (${text})` : ''}`;

  function openMove(parent, it) {
    const withCust = it.current_state === 'with_customer';
    if (withCust && !can.admin()) {
      return openSheet({ title: 'Cannot move yet', body: h('div', { class: 'callout' }, icon('info', 18), h('span', `This ${K.noun} is with a customer. It comes back into the system through a pickup, not a manual entry.`)) });
    }
    const kinds = withCust ? [{ value: 'Correction', label: 'Correct record' }]
      : [{ value: 'Movement', label: 'Moved' }, { value: 'Manual Check', label: 'Checked in person' }, ...(can.admin() ? [{ value: 'Correction', label: 'Correct record' }] : [])];
    const seg = segmented(kinds, kinds[0].value, () => paintHelp());
    const where = select(locOptions(it.current_location_id));
    const note = textarea({ rows: '2', placeholder: 'Optional' });
    const help = h('p', { class: 'muted small' });
    const paintHelp = () => { help.textContent = { Movement: `Use this when the ${K.noun} was physically taken to another place.`, 'Manual Check': `Use this when you looked and it is at the place below. If the system disagrees, the log shows a mismatch.`, Correction: `Admin only. Use this to fix a wrong record, for example a ${K.noun} marked with a customer that is actually back.` }[seg.get()]; };
    paintHelp();
    const fWhere = field(seg.get() === 'Manual Check' ? 'Where is it?' : 'Where is it now?', where, { required: true });
    const submit = btn('Save to log', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'move-form');
    const form = h('form', { id: 'move-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
      busy(submit, async () => { try {
        await rpc(`record_${K.noun}_location`, { [`p_${K.noun}_id`]: it.id, p_location_id: Number(where.value), p_kind: seg.get(), p_note: note.value || null });
        toast('Saved to the log'); s.close(); parent.close(); await reload(); openItem(it.id);
      } catch (e) { fWhere.setError(friendlyError(e)); } }); } } },
      withCust ? h('div', { class: 'callout' }, icon('alert', 18), h('span', `Marked as with a customer (${placeOf(it).label}).`)) : null,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'What happened?'), seg), help, fWhere, field('Note', note));
    const s = openSheet({ title: `Move or check ${it[K.codeKey]}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  function openEdit(it) {
    const num = input({ value: it[K.codeKey], autofocus: true });
    const mod = K.hasModel ? select(state.models.filter(m => m.active || m.id === it.model_id).map(m => ({ value: String(m.id), label: m.name })), { value: String(it.model_id) }) : null;
    const rem = textarea({ rows: '3', value: it.remarks || '' });
    const fNum = field(K.codeLabel, num, { required: true });
    const submit = btn('Save changes', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'edit-form');
    const form = h('form', { id: 'edit-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fNum.setError('');
      if (!num.value.trim()) return fNum.setError('This is required.');
      busy(submit, async () => { try {
        await rpc(`update_${K.noun}`, K.hasModel ? { p_id: it.id, p_number: num.value, p_model_id: Number(mod.value), p_remarks: rem.value || null } : { p_id: it.id, p_code: num.value, p_remarks: rem.value || null });
        toast('Changes saved'); s.close(); await reload(); openItem(it.id);
      } catch (e) { fNum.setError(friendlyError(e)); } }); } } }, fNum, K.hasModel ? field('Model', mod) : null, field('Remarks', rem));
    const s = openSheet({ title: `Edit ${it[K.codeKey]}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  async function setStatus(s, it, to) {
    const r = await confirmDialog({ title: to === 'blocked' ? `Block ${it[K.codeKey]}?` : `Unblock ${it[K.codeKey]}?`,
      message: to === 'blocked' ? `A blocked ${K.noun} cannot be used for deliveries${K.noun === 'vehicle' ? ' or swaps' : ''}.` : `This ${K.noun} can be used again when it is at an office.`,
      confirmLabel: to === 'blocked' ? `Block ${K.noun}` : 'Unblock', danger: to === 'blocked',
      reason: { label: to === 'blocked' ? 'Reason' : 'Note (optional)', required: to === 'blocked', placeholder: to === 'blocked' ? 'For example: accident damage' : '' } });
    if (!r) return;
    try { await rpc(`set_${K.noun}_status`, { p_id: it.id, p_status: to, p_remarks: r.text || null }); toast(to === 'blocked' ? 'Blocked' : 'Unblocked'); s.close(); await reload(); openItem(it.id); }
    catch (e) { toast(friendlyError(e), 'error'); }
  }
}
