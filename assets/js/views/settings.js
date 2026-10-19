// Settings (Admin and Superadmin): the lists in the dropdowns and the time limits, without changing any code.
// Put this file in: assets/js/views/settings.js
import { h, icon, btn, busy, chip, field, input, select, segmented, openSheet, toast, mount, emptyState, friendlyError } from '../core/ui.js';
import { rpc } from '../core/supa.js';
import { state, can } from '../core/store.js';
import { loadSettings, listItems, ACCOUNT_MODES } from '../core/settings.js';

export async function render(root, params) {
  if (!can.admin()) return mount(root, emptyState('Settings are for Admins', 'Only an Admin or Superadmin can open this page.'));
  const TABS = [{ value: 'lists', label: 'Dropdown lists' }, { value: 'time', label: 'Time limits' }];
  const panel = h('div');
  const tabs = segmented(TABS, params.sub === 'time' ? 'time' : 'lists', (v) => show(v));
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Settings'), h('p', { class: 'muted' }, 'Change the choices in the dropdowns and the time limits. Changes apply to everyone straight away.'))), h('div', { class: 'toolbar' }, tabs), panel);
  const show = (tab) => { history.replaceState(null, '', `#/settings/${tab}`); (tab === 'time' ? timeTab : listsTab)(panel); };
  show(tabs.get());
}

// ---- add or rename one choice
function itemSheet({ title, label = '', active = true, id = null, list, parent = null, mode = null, onDone }) {
  const name = input({ value: label, maxlength: '60', placeholder: 'Name' }); const f = field('Name', name, { required: true });
  const on = h('input', { type: 'checkbox' }); on.checked = active;
  const submit = btn('Save', { kind: 'primary', onClick: (e) => {
    f.setError(''); if (!name.value.trim()) return f.setError('Enter a name.');
    busy(e.currentTarget, async () => { try { await rpc('save_list_item', { p_id: id, p_list: list, p_parent: parent, p_mode: mode, p_label: name.value.trim(), p_active: on.checked, p_sort: 100 }); await loadSettings(); toast('Saved'); s.close(); onDone?.(); } catch (err) { f.setError(friendlyError(err)); } });
  } });
  const s = openSheet({ title, body: h('div', { class: 'stack' }, f, id ? h('label', { class: 'check' }, on, h('span', 'In use (switch off to hide it from the dropdown)')) : null), footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  setTimeout(() => name.focus(), 50);
}
async function setActive(it, on, onDone) {
  try { await rpc('save_list_item', { p_id: it.id, p_list: it.list, p_parent: it.parent_id, p_mode: it.mode, p_label: it.label, p_active: on, p_sort: it.sort }); await loadSettings(); onDone(); } catch (e) { toast(friendlyError(e), 'error'); }
}
const rowFor = (it, redo, { addSub = null, indent = false } = {}) => h('div', { class: 'set-row', style: `display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.45rem 0;border-top:1px solid rgba(128,128,128,.2);${indent ? 'margin-left:1.5rem' : ''}` },
  h('strong', { style: `flex:1;min-width:140px;${it.active ? '' : 'opacity:.55;text-decoration:line-through'}` }, it.label), it.active ? null : chip('Switched off', 'neutral'),
  addSub ? btn('Add sub category', { small: true, ic: 'plus', onClick: addSub }) : null,
  btn('Rename', { small: true, onClick: () => itemSheet({ title: 'Rename', label: it.label, active: it.active, id: it.id, list: it.list, parent: it.parent_id, mode: it.mode, onDone: redo }) }),
  btn(it.active ? 'Switch off' : 'Switch on', { small: true, onClick: () => setActive(it, !it.active, redo) }));

function listsTab(panel) {
  const draw = () => {
    const cats = (list, noun) => {
      const top = listItems(list, { all: true });
      return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', `${noun} categories`), btn(`Add ${noun.toLowerCase()} category`, { small: true, ic: 'plus', kind: 'primary', onClick: () => itemSheet({ title: `New ${noun.toLowerCase()} category`, list, onDone: draw }) })),
        top.length ? top.map(c => h('div', null, rowFor(c, draw, { addSub: () => itemSheet({ title: `New sub category in ${c.label}`, list, parent: c.id, onDone: draw }) }),
          listItems(list, { parent: c.id, all: true }).map(sc => rowFor(sc, draw, { indent: true })))) : h('p', { class: 'muted' }, 'Nothing here yet.'));
    };
    const accounts = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', 'Payment accounts')),
      h('p', { class: 'muted small' }, 'Company accounts people choose when money comes in by UPI, Online, Card, Bank Transfer or Cheque. If a mode has no account here, nothing is asked for that mode.'),
      ACCOUNT_MODES.map(m => h('div', { style: 'margin:.8rem 0' }, h('div', { style: 'display:flex;gap:.5rem;align-items:center' }, h('strong', { style: 'flex:1' }, m), btn(`Add ${m} account`, { small: true, ic: 'plus', onClick: () => itemSheet({ title: `New ${m} account`, list: 'account', mode: m, onDone: draw }) })),
        listItems('account', { mode: m, all: true }).map(a => rowFor(a, draw)))));
    mount(panel, h('div', { class: 'stack' }, cats('expense_category', 'Expense'), cats('income_category', 'Income'), accounts,
      h('p', { class: 'muted small' }, 'Names already used on past entries stay as they were. Switching a choice off only hides it from new entries.')));
  };
  draw();
}

function timeTab(panel) {
  const s = state.settings || {};
  const sess = input({ type: 'number', min: '1', max: '72', step: '0.5', value: String(s.session_hours ?? 6) }), stale = input({ type: 'number', min: '0.5', max: '168', step: '0.5', value: String(s.stale_hours ?? 4) });
  const fS = field('Session length (hours)', sess, { hint: 'People are signed out automatically this many hours after they sign in.' });
  const gapIn = input({ type: 'number', min: '0.5', max: '168', step: '0.5', value: String(s.call_gap_hours ?? 24) });
  const fG = field('Flag customers not called for (hours)', gapIn, { hint: 'On the Live customers page, a customer with no call in this many hours is marked in red.' });
  const fA = field('Alert after (hours without an update)', stale, { hint: 'A vehicle or helmet that is not with a customer and has no update for this long is flagged on the Vehicle status page and in the reminder popup.' });
  const save = btn('Save', { kind: 'primary', onClick: (e) => busy(e.currentTarget, async () => {
    fS.setError(''); fA.setError(''); fG.setError('');
    try { await rpc('set_setting', { p_key: 'session_hours', p_value: sess.value }); } catch (err) { return fS.setError(friendlyError(err)); }
    try { await rpc('set_setting', { p_key: 'stale_hours', p_value: stale.value }); } catch (err) { return fA.setError(friendlyError(err)); }
    try { await rpc('set_setting', { p_key: 'call_gap_hours', p_value: gapIn.value }); } catch (err) { return fG.setError(friendlyError(err)); }
    await loadSettings(); toast('Saved. It applies to everyone from now.');
  }) });
  mount(panel, h('section', { class: 'panel' }, h('div', { class: 'stack' }, fS, fA, fG, h('div', null, save))));
}
