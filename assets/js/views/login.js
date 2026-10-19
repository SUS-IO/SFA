import { h, icon, field, input, btn, busy, mount } from '../core/ui.js';
import { cfg } from '../core/supa.js';
import * as session from '../core/session.js';

export const wheelArt = () => h('div', { class: 'wheel-art', 'aria-hidden': 'true', html:
  `<svg viewBox="0 0 400 400" fill="none"><g stroke="#CBEEF3" stroke-opacity=".28">
    <circle cx="200" cy="200" r="190" stroke-width="2"/><circle cx="200" cy="200" r="150" stroke-width="14" stroke-opacity=".16"/>
    <circle cx="200" cy="200" r="118" stroke-width="2"/><circle cx="200" cy="200" r="30" stroke-width="10" stroke-opacity=".3"/>
    ${Array.from({ length: 24 }, (_, i) => { const a = i * Math.PI / 12, x1 = 200 + 34 * Math.cos(a), y1 = 200 + 34 * Math.sin(a), x2 = 200 + 116 * Math.cos(a), y2 = 200 + 116 * Math.sin(a); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="1.5"/>`; }).join('')}
  </g><circle cx="200" cy="200" r="9" fill="#F26A8D"/><circle cx="200" cy="10" r="7" fill="#F26A8D"/></svg>` });

export function brandMark(size = 36) {
  return h('img', { class: 'brand-mark', src: 'assets/img/logo-mark.svg', width: size, height: size, alt: '' });
}

export function loginView({ onSuccess, notice = '' }) {
  const idIn = input({ id: 'uid', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'For example EX1', autofocus: true });
  const pwIn = input({ id: 'pw', name: 'password', type: 'password', autocomplete: 'current-password', placeholder: 'Your password' });
  const eye = h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show password', on: { click: () => {
    const show = pwIn.type === 'password'; pwIn.type = show ? 'text' : 'password';
    eye.replaceChildren(icon(show ? 'eyeoff' : 'eye', 20)); eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  } } }, icon('eye', 20));
  const err = h('p', { class: 'form-error', role: 'alert', hidden: !notice }, notice);
  const submit = btn('Sign in', { kind: 'primary', type: 'submit', cls: 'btn-block' });
  const form = h('form', { class: 'login-form', novalidate: true, on: { submit: (e) => {
    e.preventDefault(); err.hidden = true;
    busy(submit, async () => {
      try { await session.signIn(idIn.value, pwIn.value); onSuccess(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; pwIn.value = ''; (idIn.value ? pwIn : idIn).focus(); }
    });
  } } },
    field('User ID', idIn), field('Password', h('div', { class: 'pw-wrap' }, pwIn, eye)), err, submit);

  return h('div', { class: 'login' },
    h('div', { class: 'login-brand' }, wheelArt(),
      h('div', { class: 'login-brand-top' }, brandMark(40), h('span', { class: 'brand-name' }, cfg.APP_NAME)),
      h('div', { class: 'login-brand-copy' }, h('h1', 'Every bike, helmet and customer, in one place.'),
        h('p', 'Sign in with the User ID your Admin gave you.'))),
    h('main', { class: 'login-panel' },
      h('div', { class: 'login-card' },
        h('div', { class: 'login-card-brand' }, brandMark(32), h('span', { class: 'brand-name' }, cfg.APP_NAME)),
        h('h2', 'Sign in'), form,
        h('p', { class: 'login-foot' }, 'You are signed out automatically after ', String(cfg.SESSION_HOURS), ' hours, or when you close the browser.'))));
}

export function setupNeeded() {
  return h('div', { class: 'center-screen' }, h('div', { class: 'login-card' },
    brandMark(40), h('h2', 'One setup step left'),
    h('p', 'Open ', h('code', 'assets/js/config.js'), ' in your GitHub repository and paste your Supabase Project URL and anon key into it.'),
    h('p', { class: 'muted' }, 'The guide that came with this app shows exactly where to find them.')));
}
