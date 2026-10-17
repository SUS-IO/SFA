// One screen for both Vehicles and Helmets: same rules, same logs.
import { h, icon, btn, busy, chip, statusBadge, field, input, textarea, select, segmented, openSheet, confirmDialog, toast, mount,
  emptyState, skeletonRows, debounce, fmtDateTime, fmtDateTimeY, fmtMoney, friendlyError } from '../core/ui.js';
import { sb, fetchAll, rpc } from '../core/supa.js';
import { state, can, loc, model, placeOf, availability, whoName, activeLocations, loadRefs } from '../core/store.js';
import { parseCodes } from '../core/codes.js';
import { DEFAULT_TYPES, TRIPS, slabsOf, extraKmKey, fmtDay, insuranceState, parseVehicleSheet, parseHelmetSheet } from '../core/masters.js';
import { docField, openDoc } from '../core/docs.js';

const KINDS = {
  vehicles: { table: 'vehicles', logs: 'vehicle_logs', fk: 'vehicle_id', noun: 'vehicle', codeKey: 'number', codeLabel: 'Vehicle number', hasModel: true, ic: 'bike' },
  helmets:  { table: 'helmets',  logs: 'helmet_logs',  fk: 'helmet_id',  noun: 'helmet',  codeKey: 'code',   codeLabel: 'Helmet code',    hasModel: false, ic: 'helmet' },
};
const PLACE_CHIP = { office: ['blue', 'pin'], service: ['pink', 'pin'], customer: ['navy', 'users'], transit: ['aqua', 'move'], waiting: ['pink', 'clock'], unknown: ['neutral', 'pin'] };
export const placeChip = (it) => { const p = placeOf(it); const [k, ic] = PLACE_CHIP[p.kind]; return chip(p.label, k, ic); };

const insChip = (it) => { if (it.insurance_end === undefined) return null; const s = insuranceState(it.insurance_end);
  return s.kind === 'expired' ? chip('Insurance expired', 'pink', 'alert') : s.kind === 'soon' ? chip(`Insurance in ${s.days}d`, 'aqua', 'clock') : null; };

export async function render(kind, root, params) {
  const K = KINDS[kind]; const Noun = K.noun[0].toUpperCase() + K.noun.slice(1);
  const st = { items: [], place: params.place || 'all', model: 'all', q: '' };
  const list = h('div', { class: `rows rows-${kind}`, role: 'list' });
  const countEl = h('p', { class: 'result-count', 'aria-live': 'polite' });

  const placeOpts = () => [{ value: 'all', label: 'All places' }, { value: 'ready', label: `Ready to use (at an office)` },
    ...activeLocations().map(l => ({ value: 'loc:' + l.id, label: l.name })),
    { value: 'customer', label: 'With customers' }, { value: 'waiting', label: 'Waiting for approval' }, { value: 'transit', label: 'In transit' }, { value: 'blocked', label: 'Blocked' }];
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
      case 'waiting': return p.kind === 'waiting';
      default: return st.place.startsWith('loc:') && p.kind !== 'customer' && p.kind !== 'transit' && p.kind !== 'waiting' && `loc:${it.current_location_id}` === st.place;
    }
  };
  function paint() {
    const shown = st.items.filter(matches);
    countEl.textContent = st.items.length ? `${shown.length} of ${st.items.length} ${K.noun}s` : '';
    if (!st.items.length) return mount(list, emptyState(`No ${K.noun}s yet`, `Add your first ${K.noun}. Its place is recorded in the log from day one.`, (kind === 'vehicles' && !can.manager() ? null : btn(`Add ${K.noun}${kind === 'helmets' ? 's' : ''}`, { kind: 'primary', ic: 'plus', onClick: openAdd }))));
    if (!shown.length) return mount(list, emptyState('Nothing matches', 'Change the place, model or search.'));
    mount(list, h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', K.codeLabel), K.hasModel ? h('span', 'Model') : null, h('span', 'Where now'), h('span', 'Status'), h('span', 'Last update')),
      shown.map(it => h('a', { class: 'row', role: 'listitem', href: `#/${kind}?open=${it.id}`, on: { click: (e) => { e.preventDefault(); openItem(it.id); } } },
        h('span', { class: 'cell cell-main' }, h('strong', { class: 'code' }, it[K.codeKey])),
        K.hasModel ? h('span', { class: 'cell' }, model(it.model_id)?.name || '') : null,
        h('span', { class: 'cell' }, placeChip(it)),
        h('span', { class: 'cell' }, it.status === 'blocked' ? statusBadge('blocked') : availability(it).ok ? statusBadge('active', 'Ready') : h('span', { class: 'muted small' }, 'In use or away'), insChip(it)),
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
      h('div', { class: 'page-actions' },
        kind === 'vehicles' && can.manager() ? btn('Import from Excel', { ic: 'list', onClick: openImportVehicles }) : null,
        kind === 'helmets' ? btn('Import from Excel', { ic: 'list', onClick: openImportHelmets }) : null,
        kind === 'vehicles' && !can.manager() ? null : btn(kind === 'vehicles' ? 'Add vehicle' : 'Add helmets', { kind: 'primary', ic: 'plus', onClick: openAdd }))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), h('div', { class: 'filters' }, placeSel, modelSel)), countEl, list);
  await load();
  if (params.add) openAdd();
  if (params.open) openItem(Number(params.open));

  const reload = async () => { await load(); };
  const locOptions = (selected) => activeLocations().map(l => ({ value: String(l.id), label: `${l.name} (${l.type})`, selected: l.id === selected }));

  // ---------------------------------------------------------------- add
  function openAdd() {
    if (!activeLocations().length) return toast('Add a location in the Admin panel first.', 'error');
    if (kind === 'vehicles') return can.manager() ? openVehicleForm(null) : toast('Only a Manager, Admin or Superadmin can add vehicles.', 'error');
    {
      const codes = textarea({ rows: '5', placeholder: 'A1-A10\nF65, F66', autofocus: true });
      const where = select(locOptions());
      const hName = input({ placeholder: 'For example Atom' }), hType = input({ placeholder: 'For example Full Face', list: 'dl-htype' });
      const dlH = h('datalist', { id: 'dl-htype' }, [...new Set(['Full Face', 'Half Face', 'Flip Up', ...st.items.map(x => x.helmet_type).filter(Boolean)])].map(t => h('option', { value: t })));
      const fCodes = field('Helmet IDs', codes, { required: true, hint: 'One per line or separated by commas. Use A1-A10 for a range.' });
      const preview = h('p', { class: 'muted small' });
      codes.addEventListener('input', () => { const r = parseCodes(codes.value); preview.textContent = r.error || (r.codes.length ? `${r.codes.length} helmet${r.codes.length === 1 ? '' : 's'}: ${r.codes.slice(0, 6).join(', ')}${r.codes.length > 6 ? '…' : ''}` : ''); });
      const submit = btn('Add helmets', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'add-form');
      const form = h('form', { id: 'add-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fCodes.setError('');
        const r = parseCodes(codes.value); if (r.error) return fCodes.setError(r.error); if (!r.codes.length) return fCodes.setError('Enter at least one helmet ID.');
        const extra = {}; if (hName.value.trim()) extra.name = hName.value.trim(); if (hType.value.trim()) extra.helmet_type = hType.value.trim();
        busy(submit, async () => { try { const res = await rpc('save_helmets', { p_rows: r.codes.map(code => ({ code, ...extra })), p_location_id: Number(where.value) });
          const skipped = res.skipped + res.updated;
          toast(`${res.added} helmet${res.added === 1 ? '' : 's'} added${skipped ? `, ${skipped} already existed` : ''}`);
          if (res.errors?.length) toast(`${res.errors[0].key}: ${res.errors[0].message}`, 'error');
          s.close(); reload(); } catch (e) { fCodes.setError(friendlyError(e)); } }); } } }, fCodes, preview,
        h('div', { class: 'grid-2' }, field('Name (same for all)', hName), field('Type (same for all)', hType)), dlH, field('Where are they now?', where, { required: true }));
      const s = openSheet({ title: 'Add helmets', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
    }
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
      K.noun === 'vehicle' && it.current_state === 'with_customer' ? h('div', { class: 'callout' }, icon('lock', 18), h('span', 'This vehicle is with a customer. Nobody can move it, check it in, correct it or block it. It comes back only through a Pickup.')) : null,
      K.noun === 'vehicle' && it.current_state === 'waiting_approval' ? h('div', { class: 'callout' }, icon('lock', 18), h('span', 'This vehicle is waiting for approval. It cannot be moved or checked in until its delivery, swap or pickup is approved or cancelled.')) : null,
      masterBlock(it),
      it.remarks ? h('div', { class: 'section-lite' }, h('h3', 'Remarks'), h('p', { class: 'prewrap' }, it.remarks)) : null,
      h('div', { class: 'section-lite' }, h('h3', 'History'), tl));
    const foot = [];
    const lockedCust = K.noun === 'vehicle' && it.current_state === 'with_customer';
    const lockedWait = K.noun === 'vehicle' && it.current_state === 'waiting_approval';
    if (can.manager()) foot.push(btn('Edit', { ic: 'edit', onClick: () => { s.close(); openEdit(it); } }));
    if (can.manager() && !lockedCust) foot.push(it.status === 'blocked' ? btn('Unblock', { ic: 'undo', onClick: () => setStatus(s, it, 'active') }) : btn('Block', { ic: 'ban', cls: 'btn-outline-danger', onClick: () => setStatus(s, it, 'blocked') }));
    if (!lockedCust && !lockedWait) foot.push(btn('Move or check', { kind: 'primary', ic: 'move', onClick: () => openMove(s, it) }));
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
  const describe = (s, id, text) => s === 'at_location' ? (loc(id)?.name || 'unknown place') : s === 'with_customer' ? `with customer${text ? ` (${text})` : ''}` : s === 'waiting_approval' ? 'waiting for approval' : `in transit${text ? ` (${text})` : ''}`;

  function openMove(parent, it) {
    if (it.current_state === 'waiting_approval' || it.current_state === 'with_customer') {
      const why = it.current_state === 'with_customer'
        ? `This ${K.noun} is with a customer. It comes back only through a Pickup (or a Swap for a vehicle), never by a manual entry.`
        : `This ${K.noun} is waiting for approval. Its delivery, swap or pickup must be approved (or cancelled) first.`;
      return openSheet({ title: 'Cannot move', body: h('div', { class: 'callout' }, icon('lock', 18), h('span', why)) });
    }
    const kinds = [{ value: 'Movement', label: 'Moved' }, { value: 'Manual Check', label: 'Checked in person' }];
    const seg = segmented(kinds, kinds[0].value, () => paintHelp());
    const where = select(locOptions(it.current_location_id));
    const note = textarea({ rows: '2', placeholder: 'Optional' });
    const help = h('p', { class: 'muted small' });
    const paintHelp = () => { help.textContent = { Movement: `Use this when the ${K.noun} was physically taken to another place.`, 'Manual Check': `Use this when you looked and it is at the place below. If the system disagrees, the log shows a mismatch.` }[seg.get()]; };
    paintHelp();
    const fWhere = field(seg.get() === 'Manual Check' ? 'Where is it?' : 'Where is it now?', where, { required: true });
    const submit = btn('Save to log', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'move-form');
    const form = h('form', { id: 'move-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault();
      busy(submit, async () => { try {
        await rpc(`record_${K.noun}_location`, { [`p_${K.noun}_id`]: it.id, p_location_id: Number(where.value), p_kind: seg.get(), p_note: note.value || null });
        toast('Saved to the log'); s.close(); parent.close(); await reload(); openItem(it.id);
      } catch (e) { fWhere.setError(friendlyError(e)); } }); } } },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'What happened?'), seg), help, fWhere, field('Note', note));
    const s = openSheet({ title: `Move or check ${it[K.codeKey]}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  function masterBlock(it) {
    const kv = (k, v) => (v === null || v === undefined || v === '' ? null : h('div', { class: 'kv' }, h('dt', k), h('dd', v)));
    if (K.noun === 'helmet') {
      const rows = [kv('Name', it.name), kv('Type', it.helmet_type)].filter(Boolean);
      return rows.length ? h('div', { class: 'section-lite' }, h('h3', 'Helmet details'), h('dl', { class: 'kvs' }, rows)) : null;
    }
    const ins = insuranceState(it.insurance_end);
    const docs = [it.rc_file ? btn('View RC', { ic: 'eye', small: true, onClick: () => openDoc(it.rc_file) }) : null,
      it.insurance_file ? btn('View insurance', { ic: 'eye', small: true, onClick: () => openDoc(it.insurance_file) }) : null].filter(Boolean);
    const rateBlock = (t) => { const rows = [...slabsOf(t.value).map(sl => kv(sl.label, it[sl.key] == null ? null : `${fmtMoney(it[sl.key])} per day`)),
        kv('Extra km', it[extraKmKey(t.value)] == null ? null : `${fmtMoney(it[extraKmKey(t.value)])} per km`)].filter(Boolean);
      return rows.length ? h('div', { class: 'section-lite' }, h('h3', `${t.label} rent`), h('dl', { class: 'kvs' }, rows)) : null; };
    return h('div', { class: 'stack' },
      h('div', { class: 'section-lite' }, h('h3', 'Vehicle details'), h('dl', { class: 'kvs' }, [
        kv('Brand', it.brand), kv('Type', it.vehicle_type), kv('CC', it.cc), kv('Year', it.year), kv('Colour', it.color),
        kv('Vehicle owner', it.owner_name), kv('Insurance owner', it.insurance_owner),
        it.insurance_end ? kv('Insurance ends', h('span', null, fmtDay(it.insurance_end), ' ', ins.kind === 'expired' ? chip('Expired', 'pink', 'alert') : ins.kind === 'soon' ? chip(`In ${ins.days} days`, 'aqua', 'clock') : null)) : null,
      ].filter(Boolean))),
      ...TRIPS.map(rateBlock),
      docs.length ? h('div', { class: 'section-lite' }, h('h3', 'Documents'), h('div', { class: 'page-actions' }, docs)) : null);
  }

  // ---------------------------------------------------------------- full vehicle master form (add and edit)
  function openVehicleForm(it) {
    const v = it || {};
    if (!it && !activeLocations().length) return toast('Add a location in the Admin panel first.', 'error');
    const F = {};
    const mk = (key, label, ctrl, opts) => (F[key] = field(label, ctrl, opts));
    const val = (x) => (x === null || x === undefined ? '' : String(x));
    const num = input({ value: val(v.number), autofocus: true, placeholder: 'For example TN56K59857' });
    const modelIn = input({ value: val(model(v.model_id)?.name), list: 'dl-model', placeholder: 'Choose or type a new model' });
    const dlModel = h('datalist', { id: 'dl-model' }, state.models.filter(m => m.active).map(m => h('option', { value: m.name })));
    const brand = input({ value: val(v.brand), placeholder: 'For example Bajaj' });
    const dlType = h('datalist', { id: 'dl-type' }, [...new Set([...DEFAULT_TYPES, ...st.items.map(x => x.vehicle_type).filter(Boolean)])].map(t => h('option', { value: t })));
    const typeIn = input({ value: val(v.vehicle_type), list: 'dl-type', placeholder: 'For example Cruiser' });
    const cc = input({ value: val(v.cc), type: 'number', min: '1', inputmode: 'numeric', placeholder: 'For example 220' });
    const year = input({ value: val(v.year), type: 'number', min: '1980', max: '2100', inputmode: 'numeric', placeholder: 'For example 2024' });
    const color = input({ value: val(v.color) });
    const insEnd = input({ value: val(v.insurance_end), type: 'date' });
    const owner = input({ value: val(v.owner_name) }), insOwner = input({ value: val(v.insurance_owner) });
    const rateKeys = TRIPS.flatMap(t => [extraKmKey(t.value), ...slabsOf(t.value).map(sl => sl.key)]);
    const rate = Object.fromEntries(rateKeys.map(k => [k, input({ value: val(v[k]), type: 'number', min: '0', step: '0.01', inputmode: 'decimal' })]));
    const rcF = docField({ label: 'RC (PDF or photo)', existing: v.rc_file }), insF = docField({ label: 'Insurance (PDF or photo)', existing: v.insurance_file });
    const where = it ? null : select(locOptions());
    const rem = textarea({ rows: '2', value: val(v.remarks) });
    const err = h('p', { class: 'field-error', hidden: true, role: 'alert' });
    const submit = btn(it ? 'Save changes' : 'Add vehicle', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'vm-form');
    const bad = (x) => x === '' || !Number.isFinite(Number(x)) || Number(x) < 0;
    const form = h('form', { id: 'vm-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); err.hidden = true;
      Object.values(F).forEach(f => f.setError(''));
      let ok = true; const no = (k, m) => { F[k].setError(m); ok = false; };
      if (!num.value.trim()) no('number', 'Enter the vehicle number.');
      if (!modelIn.value.trim()) no('model', 'Choose or type the model.');
      if (cc.value.trim() && !(Number(cc.value) > 0)) no('cc', 'Enter the engine size as a number.');
      if (year.value.trim() && !(Number(year.value) >= 1980 && Number(year.value) <= 2100)) no('year', 'Enter a year like 2024.');
      for (const k of rateKeys) if (bad(rate[k].value.trim())) no(k, k.endsWith('extra_km') ? 'Enter the extra km rate.' : 'Enter the rent per day.');
      if (!ok) return;
      busy(submit, async () => { try {
        const label = num.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const rcPath = await rcF.commit('vehicles', `${label}-rc`), insPath = await insF.commit('vehicles', `${label}-insurance`);
        const row = { id: it?.id, number: num.value, model: modelIn.value, brand: brand.value, vehicle_type: typeIn.value, cc: cc.value, year: year.value, color: color.value,
          insurance_end: insEnd.value, owner_name: owner.value, insurance_owner: insOwner.value, rc_file: rcPath, insurance_file: insPath,
          remarks: rem.value };
        for (const k of rateKeys) row[k] = rate[k].value;
        const res = await rpc('save_vehicles', { p_rows: [row], p_location_id: where ? Number(where.value) : null });
        if (res.errors?.length) throw new Error(res.errors[0].message);
        rcF.cleanup(); insF.cleanup(); await loadRefs();
        toast(it ? 'Changes saved' : 'Vehicle added'); s.close(); await reload(); if (it) openItem(it.id);
      } catch (e) { err.textContent = friendlyError(e); err.hidden = false; } }); } } },
      mk('number', 'Vehicle number', num, { required: true, hint: it ? '' : 'This is the key. Every vehicle number is unique.' }),
      h('div', { class: 'grid-2' }, mk('model', 'Model', modelIn, { required: true }), mk('brand', 'Brand', brand)), dlModel, dlType,
      h('div', { class: 'grid-2' }, mk('type', 'Type', typeIn), mk('cc', 'CC', cc)),
      h('div', { class: 'grid-2' }, mk('year', 'Year', year), mk('color', 'Colour', color)),
      h('div', { class: 'grid-2' }, mk('owner', 'Vehicle owner name', owner), mk('insOwner', 'Insurance owner name', insOwner)),
      mk('insEnd', 'Insurance end date', insEnd),
      h('p', { class: 'muted small' }, 'The rent in a delivery is filled in from these rates, by trip kind and number of days. It can be changed for one delivery without changing this master.'),
      ...TRIPS.map(t => h('div', { class: 'section-lite' }, h('h3', `${t.label}`),
        h('div', { class: 'grid-2' }, slabsOf(t.value).map(sl => mk(sl.key, `${sl.label} (₹ per day)`, rate[sl.key], { required: true })), mk(extraKmKey(t.value), 'Extra km (₹ per km)', rate[extraKmKey(t.value)], { required: true })))),
      h('div', { class: 'section-lite' }, h('h3', 'Documents'), h('p', { class: 'muted small' }, 'PDF or photo. It is shrunk automatically before saving, so it uses very little storage.'), rcF.el, insF.el),
      where ? mk('where', 'Where is it now?', where, { required: true }) : null,
      mk('rem', 'Remarks', rem), err);
    const s = openSheet({ title: it ? `Edit ${it.number}` : 'Add vehicle', body: form, wide: true, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  // ---------------------------------------------------------------- import a table copied from Excel
  const showImport = ({ title, intro, example, parse, save, extraField, noun }) => {
    const ta = textarea({ rows: '8', placeholder: example, autofocus: true });
    const prev = h('div', { class: 'results' }), out = h('div', { class: 'results' });
    let parsed = { rows: [], problems: [] };
    const paintPrev = () => mount(prev, !ta.value.trim() ? null : [
      h('p', { class: 'res ok' }, icon('check', 16), `${parsed.rows.length} ${noun}${parsed.rows.length === 1 ? '' : 's'} ready`),
      ...parsed.problems.slice(0, 8).map(p => h('p', { class: 'res bad' }, icon('alert', 16), `Line ${p.line}${p.key ? ` (${p.key})` : ''}: ${p.message}`)),
      parsed.problems.length > 8 ? h('p', { class: 'muted small' }, `…and ${parsed.problems.length - 8} more lines with problems`) : null]);
    ta.addEventListener('input', () => { parsed = parse(ta.value); paintPrev(); });
    const fTa = field('Paste the table here', ta, { required: true, hint: intro });
    const submit = btn('Import', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'imp-form');
    const form = h('form', { id: 'imp-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fTa.setError('');
      if (!parsed.rows.length) return fTa.setError(`Paste at least one ${noun} first.`);
      busy(submit, async () => { try {
        mount(out); let added = 0, updated = 0, skipped = 0; const errors = [];
        const rows = parsed.rows.map(({ _line, ...r }) => { Object.keys(r).forEach(k => { if (r[k] === '') delete r[k]; }); return r; });   // blank cells never erase saved data
        for (let i = 0; i < rows.length; i += 100) {
          const res = await save(rows.slice(i, i + 100)); added += res.added; updated += res.updated; skipped += res.skipped || 0; errors.push(...res.errors);
        }
        await loadRefs();
        mount(out, h('p', { class: 'res ok' }, icon('check', 16), `${added} added, ${updated} updated${skipped ? `, ${skipped} skipped (already there)` : ''}`),
          ...errors.slice(0, 10).map(x => h('p', { class: 'res bad' }, icon('alert', 16), `${x.key || 'Row ' + x.row}: ${x.message}`)));
        toast(`${added} added, ${updated} updated`, errors.length ? 'error' : 'ok'); reload();
      } catch (e) { fTa.setError(friendlyError(e)); } }); } } }, fTa, prev, extraField, out);
    const s = openSheet({ title, body: form, wide: true, footer: [btn('Close', { onClick: () => s.close() }), submit] });
  };
  function openImportVehicles() {
    const where = select(locOptions());
    showImport({ title: 'Import vehicles from Excel', noun: 'vehicle', parse: parseVehicleSheet, extraField: field('New vehicles are now at', where, { required: true }),
      intro: 'In Excel, select the table with its heading row, copy it, and paste here. A vehicle number that already exists is updated; a new one is added. Blank cells never erase saved data. Add the RC and insurance files on each vehicle afterwards.',
      example: 'Vehicle Number\tModel\tBrand\tType\tCCC\tYear\tColor\tInsurance End Date\t…', save: (rows) => rpc('save_vehicles', { p_rows: rows, p_location_id: Number(where.value) }) });
  }
  function openImportHelmets() {
    const where = select(locOptions());
    showImport({ title: 'Import helmets from Excel', noun: 'helmet', parse: parseHelmetSheet, extraField: field('New helmets are now at', where, { required: true }),
      intro: 'Three columns: Helmet ID, Name, Type. Copy from Excel and paste here. A new ID is added.' + (can.manager() ? ' An ID that already exists is updated.' : ' IDs that already exist are skipped.'),
      example: 'Helmet ID\tName\tType\nA1\tAtom\tFull Face', save: (rows) => rpc('save_helmets', { p_rows: rows, p_location_id: Number(where.value) }) });
  }

  function openEdit(it) {
    if (K.noun === 'vehicle') return openVehicleForm(it);
    const num = input({ value: it[K.codeKey], autofocus: true });
    const mod = K.hasModel ? select(state.models.filter(m => m.active || m.id === it.model_id).map(m => ({ value: String(m.id), label: m.name })), { value: String(it.model_id) }) : null;
    const rem = textarea({ rows: '3', value: it.remarks || '' });
    const hName = input({ value: it.name || '' }), hType = input({ value: it.helmet_type || '', list: 'dl-htype2' });
    const dlH = h('datalist', { id: 'dl-htype2' }, [...new Set(['Full Face', 'Half Face', 'Flip Up', ...st.items.map(x => x.helmet_type).filter(Boolean)])].map(t => h('option', { value: t })));
    const fNum = field(K.codeLabel, num, { required: true });
    const submit = btn('Save changes', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'edit-form');
    const form = h('form', { id: 'edit-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fNum.setError('');
      if (!num.value.trim()) return fNum.setError('This is required.');
      busy(submit, async () => { try {
        await rpc('update_helmet', { p_id: it.id, p_code: num.value, p_remarks: rem.value || null });
        const res = await rpc('save_helmets', { p_rows: [{ id: it.id, code: num.value, name: hName.value, helmet_type: hType.value }], p_location_id: null });
        if (res.errors?.length) throw new Error(res.errors[0].message);
        toast('Changes saved'); s.close(); await reload(); openItem(it.id);
      } catch (e) { fNum.setError(friendlyError(e)); } }); } } }, fNum, h('div', { class: 'grid-2' }, field('Name', hName), field('Type', hType)), dlH, field('Remarks', rem));
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
