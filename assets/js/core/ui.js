// Small UI toolkit: DOM builder, icons, toasts, sheets, dialogs, formatters.
import { splitPhone } from './countries.js';

// ---------- DOM builder ----------------------------------------------------
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs); attrs = null;
  }
  let pendingValue;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'html') el.innerHTML = v;                 // trusted, developer-written strings only
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') pendingValue = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required') el[k] = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendKids(el, kids);
  if (pendingValue !== undefined) el.value = pendingValue;
  return el;
}
function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); appendKids(el, kids); return el; }

// ---------- Icons ---------------------------------------------------------
const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.5-3.2 3-5 6-5s5.5 1.8 6 5"/><circle cx="17.5" cy="9" r="2.4"/><path d="M17 14.2c2.3.2 3.8 1.7 4.2 4.3"/>',
  bike: '<circle cx="6" cy="16.5" r="3.3"/><circle cx="18" cy="16.5" r="3.3"/><path d="M6 16.5 9.5 9H14l3.5 7.5M14 9l-1.2-3.2H10.5M9.8 13h7.4"/>',
  helmet: '<path d="M4 15a8 8 0 0 1 16 0v2.5a.8.8 0 0 1-.8.8H9.5L7 15.5H4z"/><path d="M12 7v4h8"/>',
  list: '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  logout: '<path d="M10 5H5.5v14H10"/><path d="M14 8.5 18 12l-4 3.5M18 12H9"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M17 12v3M20 12v2"/>',
  alert: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  pin: '<path d="M12 21s6.5-5.7 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.3 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  move: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1s-1 1.8-2.8 3.4M6.5 7.6C4 9.2 2.5 12 2.5 12S6 18.1 12 18.1c1.4 0 2.7-.3 3.8-.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>',
  database: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  wallet: '<path d="M4 7.5h14.5A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 7.5 15 4.5v3M16 14h2.5"/>',
  inbox: '<path d="M4 13.5 6.5 5.5h11L20 13.5V19H4z"/><path d="M4 13.5h4.5a3.5 3.5 0 0 0 7 0H20"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
};
export function icon(name, size = 20, cls = '') {
  const s = document.createElement('span');
  s.className = ('ico ' + cls).trim();
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return s;
}

// ---------- Formatters ----------------------------------------------------
const TZ = 'Asia/Kolkata';
const fDT = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const fDTY = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const fD = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const fT = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
export const fmtDateTime = (ts) => ts ? fDT.format(new Date(ts)).replace(/\b(am|pm)\b/i, m => m.toUpperCase()) : '';
export const fmtDateTimeY = (ts) => ts ? fDTY.format(new Date(ts)).replace(/\b(am|pm)\b/i, m => m.toUpperCase()) : '';
export const fmtDate = (ts) => ts ? fD.format(new Date(ts)) : '';
export const fmtTime = (ts) => ts ? fT.format(new Date(ts)).replace(/\b(am|pm)\b/i, m => m.toUpperCase()) : '';
export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
export function fmtPhone(p) {
  if (!p) return '';
  const { cc, number } = splitPhone(p);
  if (cc === '91' && number.length === 10) return `+91 ${number.slice(0, 5)} ${number.slice(5)}`;
  return `+${cc} ${number}`;
}
export function greeting() {
  const hr = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()));
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}
export const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
export const ROLE_LABEL = { executive: 'Executive', tele_caller: 'Tele Caller', approver: 'Approver', manager: 'Manager', admin: 'Admin', superadmin: 'Superadmin' };

export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Turn raw database / network messages into plain language.
export function friendlyError(e) {
  const m = String(e?.message || e || 'Something went wrong');
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'No connection. Check your internet and try again.';
  if (/invalid login credentials/i.test(m)) return 'User ID or password is not right.';
  if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.';
  if (/customers_mobile_key/.test(m)) return 'A customer with this mobile number already exists.';
  if (/vehicles_number_key/.test(m)) return 'This vehicle number already exists.';
  if (/helmets_code_key/.test(m)) return 'This helmet code already exists.';
  if (/locations_name_key/.test(m)) return 'A location with this name already exists.';
  if (/vehicle_models_name_key/.test(m)) return 'This model already exists.';
  if (/customers_docs_check/.test(m)) return 'Some required ID documents are missing.';
  if (/_check"?$|violates check constraint/i.test(m)) return 'One of the values is not in the right format.';
  if (/jwt|session|not authenticated/i.test(m)) return 'Your session has ended. Please sign in again.';
  return m;
}

// ---------- Toasts --------------------------------------------------------
let toastHost;
export function toast(message, kind = 'ok') {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const el = h('div', { class: `toast toast-${kind}` }, icon(kind === 'error' ? 'alert' : 'check', 18), h('span', message));
  toastHost.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, kind === 'error' ? 6000 : 3200);
}

// ---------- Buttons / badges ------------------------------------------------
export function btn(label, { kind = 'secondary', ic, onClick, type = 'button', small = false, title, disabled = false, cls = '' } = {}) {
  const b = h('button', { type, class: `btn btn-${kind}${small ? ' btn-sm' : ''} ${cls}`.trim(), title, disabled, on: onClick ? { click: onClick } : {} },
    ic ? icon(ic, small ? 16 : 18) : null, label ? h('span', label) : null);
  return b;
}
export async function busy(button, fn) {
  if (button.dataset.busy) return;
  button.dataset.busy = '1'; button.disabled = true; button.classList.add('is-busy');
  try { return await fn(); }
  finally { delete button.dataset.busy; button.disabled = false; button.classList.remove('is-busy'); }
}
export const STATUS_LABEL = { pending: 'Pending approval', active: 'Active', blocked: 'Blocked' };
export function statusBadge(status, label) {
  return h('span', { class: `badge badge-${status}` }, h('i', { class: 'dot' }), label || STATUS_LABEL[status] || status);
}
export function chip(text, kind = 'neutral', ic) {
  return h('span', { class: `chip chip-${kind}` }, ic ? icon(ic, 14) : null, text);
}

// ---------- Sheets (side panel on desktop, full screen on phones) -----------------
const sheetStack = [];   // open sheets, topmost last
export function openSheet({ title, subtitle, body, footer, wide = false, onClose, guard = null } = {}) {
  const prevFocus = document.activeElement;
  const userClose = () => { if (guard?.()) return; close(); };     // the X, the dark area and Escape: not while a form is being saved
  const close = () => {
    if (!root.isConnected) return;
    root.classList.add('closing');
    const i = sheetStack.indexOf(root); if (i >= 0) sheetStack.splice(i, 1);
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => { root.remove(); if (!sheetStack.length) document.body.classList.remove('no-scroll'); prevFocus?.focus?.(); onClose?.(); }, 180);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === root) { e.stopPropagation(); userClose(); }
    if (e.key === 'Tab') trapFocus(e, panel);
  };
  const bodyEl = h('div', { class: 'sheet-body' }, body);
  const footEl = footer ? h('div', { class: 'sheet-foot' }, footer) : null;
  const panel = h('section', { class: `sheet-panel${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Panel', tabindex: '-1' },
    h('header', { class: 'sheet-head' },
      h('div', { class: 'sheet-titles' }, h('h2', title || ''), subtitle ? h('p', subtitle) : null),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', on: { click: userClose } }, icon('x', 20))),
    bodyEl, footEl);
  const root = h('div', { class: 'sheet' }, h('div', { class: 'sheet-scrim', on: { click: userClose } }), panel);
  sheetStack.push(root);
  document.body.append(root); document.body.classList.add('no-scroll');
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => { root.classList.add('open'); (panel.querySelector('[autofocus]') || panel).focus({ preventScroll: true }); });
  return { el: root, panel, body: bodyEl, foot: footEl, close };
}
function trapFocus(e, panel) {
  const f = [...panel.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---------- Confirm dialog (optional reason box) -------------------------------
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, reason = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const ta = reason ? h('textarea', { class: 'input', rows: '3', placeholder: reason.placeholder || '', 'aria-label': reason.label || 'Reason', autofocus: true }) : null;
    const err = h('p', { class: 'field-error', hidden: true });
    const ok = btn(confirmLabel, { kind: danger ? 'danger' : 'primary', onClick: () => {
      const text = ta ? ta.value.trim() : '';
      if (reason?.required && !text) { err.textContent = 'Please write a reason.'; err.hidden = false; ta.focus(); return; }
      finish({ ok: true, text }); s.close();
    } });
    const s = openSheet({
      title, onClose: () => finish(null),
      body: h('div', { class: 'confirm' }, message ? h('p', message) : null,
        ta ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, reason.label || 'Reason'), ta, err) : null),
      footer: [btn('Cancel', { onClick: () => s.close() }), ok],
    });
    s.el.classList.add('dialog');
  });
}

// ---------- Form helpers -------------------------------------------------------
export function field(label, control, { required = false, hint = '', id } = {}) {
  const err = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const wrap = h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label, required ? h('b', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    control, hint ? h('span', { class: 'field-hint' }, hint) : null, err);
  wrap.setError = (msg) => { err.textContent = msg || ''; err.hidden = !msg; wrap.classList.toggle('has-error', !!msg); };
  return wrap;
}
export const input = (attrs = {}) => h('input', { class: 'input', autocomplete: 'off', ...attrs });
export const textarea = (attrs = {}) => h('textarea', { class: 'input', rows: '3', ...attrs });
export function select(options, attrs = {}) {
  const s = h('select', { class: 'input select', ...attrs },
    options.map(o => h('option', { value: o.value, disabled: o.disabled, selected: o.selected }, o.label)));
  if (attrs.value !== undefined) s.value = attrs.value;
  return s;
}
export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
  const paint = () => [...wrap.children].forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === wrap.dataset.value)));
  wrap.dataset.value = value;
  for (const o of options) {
    wrap.append(h('button', { type: 'button', role: 'radio', class: 'seg', dataset: { v: o.value }, on: { click: () => { wrap.dataset.value = o.value; paint(); onChange?.(o.value); } } }, o.label));
  }
  paint();
  wrap.get = () => wrap.dataset.value;
  return wrap;
}
export function sectionBlock(title, ...kids) {
  return h('section', { class: 'form-section' }, h('h3', title), ...kids);
}

export function emptyState(titleText, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-art', html: '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="42" r="9"/><circle cx="46" cy="42" r="9"/><path d="M18 42l8-18h12l8 18M38 24l-3-8h-6"/></svg>' }),
    h('h3', titleText), text ? h('p', text) : null, action || null);
}
export function skeletonRows(n = 5) {
  return h('div', { class: 'skeleton-list', 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('div', { class: 'skeleton-row' })));
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { const t = h('textarea', { value: text, style: { position: 'fixed', opacity: 0 } }); document.body.append(t); t.select(); try { document.execCommand('copy'); toast('Copied'); } catch { toast('Could not copy', 'error'); } t.remove(); }
}
export function downloadText(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Money and date-box helpers -----------------------------------------------
const fMoney = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtMoney = (n) => `₹${fMoney.format(Number(n) || 0)}`;
export const num = (v) => { const x = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(x) ? x : 0; };
// <input type="datetime-local"> wants local time as YYYY-MM-DDTHH:mm
export function localInputValue(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const isoFromLocal = (v) => (v ? new Date(v).toISOString() : null);
export const money2 = (v) => (v === '' || v === null || v === undefined ? '' : String(Math.round(num(v) * 100) / 100));
