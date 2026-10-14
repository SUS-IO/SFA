import { h, icon, field, input, btn, busy, openSheet, toast, mount, friendlyError, ROLE_LABEL, initials, fmtTime } from '../core/ui.js';
import { cfg } from '../core/supa.js';
import { state } from '../core/store.js';
import * as session from '../core/session.js';
import { brandMark } from './login.js';

function passwordForm({ onDone, forced }) {
  const a = input({ type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters', autofocus: true });
  const b = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Type it again' });
  const fa = field('New password', a, { hint: 'Use 8 or more characters with a letter and a number.' });
  const fb = field('Confirm new password', b);
  const fid = 'pw-' + Math.random().toString(36).slice(2, 7);
  const submit = btn(forced ? 'Save and continue' : 'Change password', { kind: 'primary', type: 'submit', cls: forced ? 'btn-block' : '' });
  submit.setAttribute('form', fid);       // lets the button sit in the sheet footer, outside the form
  const form = h('form', { id: fid, novalidate: true, class: 'stack', on: { submit: (e) => {
    e.preventDefault(); fa.setError(''); fb.setError('');
    const p = a.value;
    if (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) return fa.setError('Use 8 or more characters with at least one letter and one number.');
    if (p !== b.value) return fb.setError('The two passwords do not match.');
    busy(submit, async () => {
      try { await session.changePassword(p); toast('Password changed'); onDone(); }
      catch (ex) { fa.setError(friendlyError(ex)); }
    });
  } } }, fa, fb, forced ? submit : null);
  return { form, submit };
}

// Shown on first sign-in, or after an Admin resets a password.
export function forcedPasswordView({ onDone }) {
  const { form } = passwordForm({ onDone, forced: true });
  return h('div', { class: 'center-screen' }, h('div', { class: 'login-card' },
    brandMark(40), h('h2', 'Choose your own password'),
    h('p', 'Your Admin gave you a temporary password. Set a new one that only you know.'), form,
    h('button', { type: 'button', class: 'link-btn', on: { click: async () => { await session.signOut(); location.reload(); } } }, 'Sign out')));
}

export function openChangePassword() {
  const { form, submit } = passwordForm({ onDone: () => s.close(), forced: false });
  const s = openSheet({ title: 'Change password', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit] });
  return s;
}

export function openAccount({ links = [], onSignOut }) {
  const me = state.me;
  const endsAt = Date.now() + session.msLeft();
  const s = openSheet({
    title: 'Account',
    body: h('div', { class: 'stack' },
      h('div', { class: 'account-card' }, h('div', { class: 'avatar lg' }, initials(me.user_name)),
        h('div', h('strong', me.user_name), h('div', { class: 'muted' }, `${ROLE_LABEL[me.role]}, ID ${me.user_id}`))),
      links.length ? h('div', { class: 'menu-list' }, links.map(l => h('a', { class: 'menu-item', href: l.href, on: { click: () => s.close() } }, icon(l.icon, 20), h('span', l.label), icon('right', 18)))) : null,
      h('div', { class: 'menu-list' },
        h('button', { type: 'button', class: 'menu-item', on: { click: () => { s.close(); openChangePassword(); } } }, icon('key', 20), h('span', 'Change password'), icon('right', 18)),
        h('button', { type: 'button', class: 'menu-item', on: { click: () => { s.close(); onSignOut(); } } }, icon('logout', 20), h('span', 'Sign out'), icon('right', 18))),
      h('p', { class: 'muted small' }, `You will be signed out automatically at ${fmtTime(endsAt)} (${cfg.SESSION_HOURS} hours after you signed in), or when you close the browser.`)),
  });
  return s;
}
