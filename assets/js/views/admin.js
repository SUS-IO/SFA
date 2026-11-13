import { h, icon, btn, busy, chip, statusBadge, field, input, textarea, select, segmented, openSheet, confirmDialog, toast, mount, emptyState, skeletonRows,
  copyText, downloadText, fmtBytes, fmtDate, friendlyError, ROLE_LABEL, initials, debounce } from '../core/ui.js';
import { sb, rpc } from '../core/supa.js';
import { state, can, loadRefs } from '../core/store.js';

const ROLES = Object.keys(ROLE_LABEL);
const roleFrom = (txt) => { const k = String(txt).trim().toLowerCase().replace(/[\s-]+/g, '_'); return ROLES.includes(k) ? k : null; };

async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    const status = error.context?.status;
    if (status === 404) throw new Error('The admin function is not set up yet. Open the setup guide, step "Deploy the admin function".');
    throw new Error(friendlyError(error));
  }
  if (!data?.ok) throw new Error(data?.error || 'That did not work. Try again.');
  return data;
}

export async function render(root, params) {
  const TABS = [{ value: 'users', label: 'Users' }, { value: 'locations', label: 'Locations' }, { value: 'usage', label: 'Storage' }];
  const panel = h('div', { class: 'admin-panel' });
  const tabs = segmented(TABS, TABS.some(t => t.value === params.sub) ? params.sub : 'users', (v) => show(v));
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Admin'), h('p', { class: 'muted' }, 'Manage users and places here. You do not need the Supabase dashboard.'))),
    h('div', { class: 'toolbar' }, tabs), panel);
  async function show(tab) { history.replaceState(null, '', `#/admin/${tab}`); mount(panel, skeletonRows(4)); try { await ({ users: usersTab, locations: locationsTab, usage: usageTab })[tab](panel); } catch (e) { mount(panel, emptyState('Could not load this tab', friendlyError(e), btn('Try again', { kind: 'primary', onClick: () => show(tab) }))); } }
  await show(tabs.get());
}

// ================================================================ users
async function usersTab(panel) {
  await loadRefs();
  let q = '';
  const list = h('div', { class: 'rows rows-users', role: 'list' });
  const search = input({ type: 'search', placeholder: 'Search users', 'aria-label': 'Search users' });
  const roleOptions = (current) => ROLES.filter(r => r !== 'superadmin' || can.superadmin() || current === 'superadmin').map(r => ({ value: r, label: ROLE_LABEL[r] }));

  function paint() {
    const rows = state.profiles.filter(p => !q || `${p.user_id} ${p.user_name}`.toLowerCase().includes(q.toLowerCase()));
    mount(list, h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', 'User'), h('span', 'Role'), h('span', 'Status'), h('span', 'Actions')),
      rows.map(p => {
        const locked = p.role === 'superadmin' && !can.superadmin();
        const roleSel = select(roleOptions(p.role), { 'aria-label': `Role for ${p.user_name}`, value: p.role, disabled: locked || p.id === state.me.id });
        roleSel.addEventListener('change', async () => { try { const { error } = await sb.from('profiles').update({ role: roleSel.value }).eq('id', p.id); if (error) throw error; p.role = roleSel.value; toast(`${p.user_name} is now ${ROLE_LABEL[p.role]}`); } catch (e) { roleSel.value = p.role; toast(friendlyError(e), 'error'); } });
        return h('div', { class: 'row', role: 'listitem' },
          h('span', { class: 'cell cell-main' }, h('span', { class: 'avatar sm' }, initials(p.user_name)), h('span', { class: 'who' }, h('strong', p.user_name), h('small', p.user_id))),
          h('span', { class: 'cell' }, roleSel),
          h('span', { class: 'cell' }, p.active ? statusBadge('active', 'Active') : statusBadge('blocked', 'Switched off'), p.must_change_password ? chip('Temp password', 'pink') : null),
          h('span', { class: 'cell actions' },
            btn('Reset password', { small: true, ic: 'key', disabled: locked, onClick: () => resetPw(p) }),
            btn(p.active ? 'Switch off' : 'Switch on', { small: true, ic: p.active ? 'ban' : 'undo', cls: p.active ? 'btn-outline-danger' : '', disabled: locked || p.id === state.me.id, onClick: () => toggle(p) })));
      }));
    if (!rows.length) mount(list, emptyState('No users match', 'Try another name or User ID.'));
  }
  async function refresh() { await loadRefs(); paint(); }

  function showCredentials(title, rows) {
    const text = rows.map(r => `User ID: ${r.user_id}   Password: ${r.password}`).join('\n');
    const s = openSheet({ title, body: h('div', { class: 'stack' },
      h('div', { class: 'callout' }, icon('info', 18), h('span', 'Share these privately. Each person is asked to choose their own password at first sign-in. You will not see these passwords again.')),
      h('div', { class: 'cred-list' }, rows.map(r => h('div', { class: 'cred' }, h('span', r.user_id), h('code', r.password), btn('', { small: true, ic: 'copy', title: 'Copy password', onClick: () => copyText(r.password) })))) ),
      footer: [btn('Copy all', { ic: 'copy', onClick: () => copyText(text) }), rows.length > 1 ? btn('Download CSV', { ic: 'download', onClick: () => downloadText('new-users.csv', 'user_id,password\n' + rows.map(r => `${r.user_id},${r.password}`).join('\n') + '\n') }) : null, btn('Done', { kind: 'primary', onClick: () => s.close() })] });
  }

  async function resetPw(p) {
    const r = await confirmDialog({ title: `Reset password for ${p.user_name}?`, message: 'A new temporary password is created. They must choose their own at next sign-in.', confirmLabel: 'Reset password' });
    if (!r) return;
    try { const d = await adminCall({ action: 'reset_password', profile_id: p.id }); showCredentials('New temporary password', [{ user_id: d.user_id, password: d.password }]); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function toggle(p) {
    const off = p.active;
    const r = await confirmDialog({ title: off ? `Switch off ${p.user_name}?` : `Switch on ${p.user_name}?`, message: off ? 'They are signed out and cannot sign in until you switch them on again. Their records stay.' : 'They can sign in again.', confirmLabel: off ? 'Switch off' : 'Switch on', danger: off });
    if (!r) return;
    try { await adminCall({ action: 'set_active', profile_id: p.id, active: !off }); toast(off ? 'User switched off' : 'User switched on'); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  }

  function addOne() {
    const id = input({ placeholder: 'For example TC3', autofocus: true, autocapitalize: 'characters' }), name = input({ placeholder: 'Full name' });
    const role = select([{ value: '', label: 'Choose a role' }, ...roleOptions('').map(o => o)]);
    const pw = input({ placeholder: 'Leave empty to create one', autocomplete: 'off' });
    const fId = field('User ID', id, { required: true, hint: '2 to 20 letters or digits. This is what the person types to sign in.' }), fName = field('Name', name, { required: true }), fRole = field('Role', role, { required: true }), fPw = field('Temporary password', pw, { hint: 'Optional. At least 8 characters.' });
    const submit = btn('Create user', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'user-form');
    const form = h('form', { id: 'user-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); [fId, fName, fRole, fPw].forEach(f => f.setError(''));
      let bad = false; if (!/^[A-Za-z0-9_]{2,20}$/.test(id.value.trim())) { fId.setError('Use 2 to 20 letters, digits or underscore.'); bad = true; } if (!name.value.trim()) { fName.setError('Enter a name.'); bad = true; } if (!role.value) { fRole.setError('Choose a role.'); bad = true; } if (pw.value && pw.value.length < 8) { fPw.setError('At least 8 characters.'); bad = true; }
      if (bad) return;
      busy(submit, async () => { try { const d = await adminCall({ action: 'create', user_id: id.value.trim(), user_name: name.value.trim(), role: role.value, password: pw.value || undefined }); s.close(); showCredentials('User created', [{ user_id: d.user_id, password: d.password }]); refresh(); } catch (e) { fId.setError(e.message); } }); } } },
      h('div', { class: 'grid-2' }, fId, fName), fRole, fPw);
    const s = openSheet({ title: 'Add user', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  }

  function addMany() {
    const ta = textarea({ rows: '9', autofocus: true, placeholder: 'Tele Caller, TC3, Rao\nExecutive, EX2, Suresh\nManager, M2, Anita' });
    const out = h('div', { class: 'results' });
    const fTa = field('One person per line: role, User ID, name', ta, { required: true, hint: 'Roles: Executive, Tele Caller, Approver, Manager, Admin. A temporary password is created for each person.' });
    const submit = btn('Create users', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'many-form');
    const form = h('form', { id: 'many-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fTa.setError('');
      const lines = ta.value.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[,\t;]/).map(x => x.trim()));
      const bad = lines.find(p => p.length < 3 || !roleFrom(p[0]));
      if (!lines.length) return fTa.setError('Enter at least one line.');
      if (bad) return fTa.setError(`Check this line: "${bad.join(', ')}". It needs a role, a User ID and a name.`);
      busy(submit, async () => { mount(out); const done = [];
        for (const [r, uid, ...nm] of lines) {
          try { const d = await adminCall({ action: 'create', user_id: uid, user_name: nm.join(' '), role: roleFrom(r) }); done.push({ user_id: d.user_id, password: d.password }); out.append(h('p', { class: 'res ok' }, icon('check', 16), `${uid} created`)); }
          catch (e) { out.append(h('p', { class: 'res bad' }, icon('alert', 16), `${uid}: ${e.message}`)); }
        }
        await refresh(); if (done.length) { s.close(); showCredentials(`${done.length} user${done.length === 1 ? '' : 's'} created`, done); }
      }); } } }, fTa, out);
    const s = openSheet({ title: 'Add several users', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });
  }

  search.addEventListener('input', debounce(() => { q = search.value.trim(); paint(); }, 150));
  mount(panel, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), h('div', { class: 'page-actions' }, btn('Add several', { ic: 'list', onClick: addMany }), btn('Add user', { kind: 'primary', ic: 'plus', onClick: addOne }))), list);
  paint();
}

// ================================================================ locations & models (simple lists)
function listEditor({ panel, title, blurb, items, nameKey = 'name', extraCell, addForm, onRename, onToggle, noun }) {
  mount(panel, h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', null, h('h2', title), h('p', { class: 'muted small' }, blurb)), addForm.button),
    h('ul', { class: 'simple-list' }, items.length ? items.map(it => h('li', { class: it.active ? '' : 'off' },
      h('span', { class: 'sl-name' }, h('strong', it[nameKey]), extraCell?.(it)), it.active ? null : chip('Switched off', 'neutral'),
      h('span', { class: 'sl-actions' }, btn('Rename', { small: true, ic: 'edit', onClick: () => onRename(it) }), btn(it.active ? 'Switch off' : 'Switch on', { small: true, ic: it.active ? 'ban' : 'undo', onClick: () => onToggle(it) })))) : h('li', { class: 'muted' }, `No ${noun} yet.`))));
}
async function locationsTab(panel) {
  await loadRefs();
  const redraw = async () => { await loadRefs(); locationsTab(panel); };
  const add = () => {
    const type = select([{ value: 'Office', label: 'Office' }, { value: 'Service Centre', label: 'Service Centre' }, { value: 'Other', label: 'Other place' }]); const name = input({ autofocus: true, placeholder: 'For example Office-3' });
    const fName = field('Name', name, { required: true }); const submit = btn('Add location', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'loc-form');
    const form = h('form', { id: 'loc-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); fName.setError(''); if (!name.value.trim()) return fName.setError('Enter a name.');
      busy(submit, async () => { try { const { error } = await sb.from('locations').insert({ type: type.value, name: name.value.trim() }); if (error) throw error; toast('Location added'); s.close(); redraw(); } catch (e) { fName.setError(friendlyError(e)); } }); } } }, field('Type', type), fName);
    const s = openSheet({ title: 'Add location', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  };
  const rename = (it) => {
    const name = input({ value: it.name, autofocus: true }); const fName = field('Name', name, { required: true }); const submit = btn('Save', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'ren-form');
    const form = h('form', { id: 'ren-form', class: 'stack', novalidate: true, on: { submit: (ev) => { ev.preventDefault(); if (!name.value.trim()) return fName.setError('Enter a name.');
      busy(submit, async () => { try { const { error } = await sb.from('locations').update({ name: name.value.trim() }).eq('id', it.id); if (error) throw error; toast('Renamed'); s.close(); redraw(); } catch (e) { fName.setError(friendlyError(e)); } }); } } }, fName);
    const s = openSheet({ title: `Rename ${it.name}`, body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  };
  const toggle = async (it) => {
    const r = await confirmDialog({ title: it.active ? `Switch off ${it.name}?` : `Switch on ${it.name}?`, message: it.active ? 'It can no longer be chosen for new moves. History is kept.' : 'It can be chosen again.', confirmLabel: it.active ? 'Switch off' : 'Switch on', danger: it.active }); if (!r) return;
    try { const { error } = await sb.from('locations').update({ active: !it.active }).eq('id', it.id); if (error) throw error; redraw(); } catch (e) { toast(friendlyError(e), 'error'); }
  };
  listEditor({ panel, title: 'Locations', blurb: 'Offices, service centres and other places. Only a vehicle or helmet at an Office can be used for a delivery.', items: state.locations, noun: 'locations',
    extraCell: (l) => chip(l.type, l.type === 'Office' ? 'blue' : l.type === 'Service Centre' ? 'pink' : 'aqua', 'pin'), addForm: { button: btn('Add location', { kind: 'primary', ic: 'plus', onClick: add }) }, onRename: rename, onToggle: toggle });
}
// ================================================================ usage
async function usageTab(panel) {
  const PHOTO_CAP = 1073741824, DB_CAP = 524288000;
  const count = async (t) => { const r = await sb.from(t).select('id', { count: 'exact', head: true }); if (r.error) throw r.error; return r.count || 0; };
  const [u, customers, vehicles, helmets, users] = await Promise.all([rpc('storage_usage'), count('customers'), count('vehicles'), count('helmets'), count('profiles')]);
  const avg = u.photo_count ? u.photo_bytes / u.photo_count : 90 * 1024;
  const room = Math.max(0, Math.floor((PHOTO_CAP - u.photo_bytes) / avg));
  const meter = (label, used, cap, note) => { const pct = Math.min(100, (used / cap) * 100);
    return h('div', { class: 'meter-block' }, h('div', { class: 'meter-top' }, h('strong', label), h('span', `${fmtBytes(used)} of ${fmtBytes(cap)}`)),
      h('div', { class: `meter ${pct > 80 ? 'hot' : ''}`, role: 'progressbar', 'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': label }, h('i', { style: { width: `${Math.max(pct, 0.5)}%` } })), h('p', { class: 'muted small' }, note)); };
  mount(panel, h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', null, h('h2', 'Storage on the free plan'), h('p', { class: 'muted small' }, 'Check this now and then. When photos get close to the limit, upgrade or clear old photos.'))),
    meter('Photos', u.photo_bytes, PHOTO_CAP, `${u.photo_count} photos, about ${fmtBytes(avg)} each. Room for roughly ${room.toLocaleString('en-IN')} more.`),
    meter('Database', u.db_bytes, DB_CAP, 'Customers, vehicles, logs and users.'),
    h('dl', { class: 'kvs counts' }, [['Customers', customers], ['Vehicles', vehicles], ['Helmets', helmets], ['Users', users]].map(([k, v]) => h('div', { class: 'kv' }, h('dt', k), h('dd', v.toLocaleString('en-IN')))))));
}
