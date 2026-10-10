import { cfg, configured } from './core/supa.js';
import { state, loadRefs, can } from './core/store.js';
import * as session from './core/session.js';
import { h, mount, icon, btn, toast, initials, friendlyError, ROLE_LABEL } from './core/ui.js';
import { loginView, setupNeeded, brandMark } from './views/login.js';
import { forcedPasswordView, openAccount } from './views/account.js';

const app = document.getElementById('app');
document.title = cfg.APP_NAME;

// Each screen is loaded only when first opened.
const ROUTES = {
  dashboard: { title: 'Home', icon: 'home', load: () => import('./views/dashboard.js') },
  customers: { title: 'Customers', icon: 'users', load: () => import('./views/customers.js') },
  vehicles:  { title: 'Vehicles', icon: 'bike', load: () => import('./views/assets.js').then(m => ({ render: (el, p, c) => m.render('vehicles', el, p, c) })) },
  helmets:   { title: 'Helmets', icon: 'helmet', load: () => import('./views/assets.js').then(m => ({ render: (el, p, c) => m.render('helmets', el, p, c) })) },
  logs:      { title: 'Logs', icon: 'list', load: () => import('./views/logs.js') },
  admin:     { title: 'Admin', icon: 'shield', load: () => import('./views/admin.js'), guard: () => can.admin() },
};
const SIDE = ['dashboard', 'customers', 'vehicles', 'helmets', 'logs', 'admin'];
const TABS = ['dashboard', 'customers', 'vehicles', 'helmets'];

let cleanup = null, watching = false, shell = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [name, ...rest] = path.split('/');
  return { name: name || 'dashboard', rest, params: Object.fromEntries(new URLSearchParams(qs)) };
}
export const go = (path) => { location.hash = '#/' + path; };

async function route() {
  if (!state.me || !shell) return;
  let { name, rest, params } = parseHash();
  let r = ROUTES[name];
  if (!r || (r.guard && !r.guard())) { name = 'dashboard'; r = ROUTES.dashboard; if (location.hash !== '#/dashboard') history.replaceState(null, '', '#/dashboard'); }
  shell.setActive(name, r.title);
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const view = shell.view; mount(view, h('div', { class: 'view-loading', 'aria-busy': 'true' }, h('span', { class: 'spinner' })));
  window.scrollTo(0, 0);
  try {
    const mod = await r.load();
    const holder = h('div', { class: 'view-inner' });
    mount(view, holder);
    cleanup = (await mod.render(holder, { ...params, sub: rest[0] }, { go })) || null;
  } catch (e) {
    console.error(e);
    mount(view, h('div', { class: 'empty' }, icon('alert', 32), h('h3', 'This screen could not load'), h('p', friendlyError(e)),
      btn('Try again', { kind: 'primary', onClick: route })));
  }
}

function buildShell() {
  const nav = (name, cls) => {
    const r = ROUTES[name];
    return h('a', { class: cls, href: '#/' + name, dataset: { route: name } }, icon(r.icon, 22), h('span', r.title));
  };
  const sideItems = SIDE.filter(n => !ROUTES[n].guard || ROUTES[n].guard());
  const moreLinks = ['logs', ...(can.admin() ? ['admin'] : [])].map(n => ({ href: '#/' + n, label: ROUTES[n].title, icon: ROUTES[n].icon }));
  const openMenu = (links) => openAccount({ links, onSignOut: doSignOut });
  const titleEl = h('h1', { class: 'topbar-title' }, '');

  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, brandMark(34), h('span', { class: 'brand-name' }, cfg.APP_NAME)),
    h('nav', { class: 'side-nav', 'aria-label': 'Main' }, sideItems.map(n => nav(n, 'side-link'))),
    h('button', { type: 'button', class: 'side-user', on: { click: () => openMenu([]) } },
      h('span', { class: 'avatar' }, initials(state.me.user_name)),
      h('span', { class: 'side-user-text' }, h('strong', state.me.user_name), h('small', ROLE_LABEL[state.me.role])), icon('right', 18)));

  const top = h('header', { class: 'topbar' }, brandMark(30), titleEl,
    h('button', { type: 'button', class: 'avatar-btn', 'aria-label': 'Account', on: { click: () => openMenu([]) } }, h('span', { class: 'avatar' }, initials(state.me.user_name))));

  const view = h('main', { class: 'view', id: 'view', tabindex: '-1' });
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    TABS.map(n => nav(n, 'tab')),
    h('button', { type: 'button', class: 'tab', dataset: { route: 'more' }, on: { click: () => openMenu(moreLinks) } }, icon('menu', 22), h('span', 'More')));

  const el = h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, view), tabbar);
  return {
    el, view,
    setActive(name, title) {
      el.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === name || (a.dataset.route === 'more' && !TABS.includes(name))));
      el.querySelectorAll('[data-route]').forEach(a => a.dataset.route === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
      titleEl.textContent = title; document.title = `${title} | ${cfg.APP_NAME}`;
    },
  };
}

async function doSignOut() {
  await session.signOut(); shell = null; location.hash = '';
  showLogin();
}
function showLogin(notice = '') { mount(app, loginView({ onSuccess: enterApp, notice })); }

async function enterApp() {
  mount(app, h('div', { class: 'center-screen' }, h('span', { class: 'spinner lg' })));
  try { await loadRefs(); }
  catch (e) {
    return mount(app, h('div', { class: 'center-screen' }, h('div', { class: 'login-card' }, icon('alert', 32), h('h2', 'Could not load your data'),
      h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: enterApp }),
      h('button', { type: 'button', class: 'link-btn', on: { click: doSignOut } }, 'Sign out'))));
  }
  if (state.me.must_change_password) return mount(app, forcedPasswordView({ onDone: enterApp }));
  shell = buildShell(); mount(app, shell.el);
  if (!watching) { watching = true; session.watchExpiry(() => { shell = null; showLogin(`Your ${cfg.SESSION_HOURS}-hour session ended. Please sign in again.`); }); }
  if (!location.hash) history.replaceState(null, '', '#/dashboard');
  route();
}
window.addEventListener('hashchange', route);

(async function boot() {
  if (!configured) return mount(app, setupNeeded());
  try {
    const r = await session.restore();
    if (r && !r.expired) return enterApp();
    showLogin(r?.expired ? `Your ${cfg.SESSION_HOURS}-hour session ended. Please sign in again.` : '');
  } catch (e) { console.error(e); showLogin(friendlyError(e)); }
})();
