// Searchable drop-downs. Every <select> in the app is upgraded automatically:
// a button shows the choice, and a pop-up with a search box lists the options.
// The real <select> stays in the page (hidden), so every screen keeps using .value and "change".
const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
let current = null;

const text = (o) => (o ? o.textContent.trim() : '');

function closePop() { if (current) { current.close(); current = null; } }

function openPop(sel, btn, paint) {
  closePop();
  const opts = [...sel.options].map((o, i) => ({ i, value: o.value, label: text(o), disabled: o.disabled || o.hidden }));
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const scrim = document.createElement('div'); scrim.className = 'ss-scrim' + (mobile ? ' mobile' : '');
  const pop = document.createElement('div'); pop.className = 'ss-pop' + (mobile ? ' mobile' : '');
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', btn.getAttribute('aria-label') || 'Choose');
  const search = document.createElement('input'); search.type = 'search'; search.className = 'input ss-search';
  search.placeholder = 'Type to search'; search.autocomplete = 'off'; search.setAttribute('aria-label', 'Search the list');
  const list = document.createElement('ul'); list.className = 'ss-list'; list.setAttribute('role', 'listbox');
  pop.append(search, list); document.body.append(scrim, pop);
  btn.setAttribute('aria-expanded', 'true');

  let shown = []; let active = 0;
  const match = (o, words) => { const l = o.label.toLowerCase(); return words.every(w => l.includes(w)); };
  const render = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = opts.filter(o => match(o, words));
    list.replaceChildren();
    if (!shown.length) { const li = document.createElement('li'); li.className = 'ss-empty'; li.textContent = 'Nothing matches'; list.append(li); return; }
    shown.forEach((o, idx) => {
      const li = document.createElement('li'); li.className = 'ss-opt'; li.setAttribute('role', 'option');
      li.textContent = o.label || '(blank)';
      if (String(o.value) === String(sel.value)) li.classList.add('is-chosen');
      if (o.disabled) li.classList.add('is-disabled');
      if (idx === active) li.classList.add('is-active');
      li.addEventListener('mousemove', () => { if (active !== idx) { active = idx; mark(); } });
      li.addEventListener('click', () => choose(o));
      list.append(li);
    });
  };
  const mark = (scroll) => {
    [...list.children].forEach((li, idx) => li.classList.toggle('is-active', idx === active));
    if (scroll) list.children[active]?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (o) => {
    if (!o || o.disabled) return;
    closePop();
    if (sel.value !== o.value) { valueDesc.set.call(sel, o.value); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    paint(); btn.focus();
  };
  const place = () => {
    if (mobile) return;
    const r = btn.getBoundingClientRect(); const vh = window.innerHeight;
    const below = vh - r.bottom, above = r.top; const h = Math.min(340, pop.scrollHeight || 340);
    const up = below < Math.min(h, 260) && above > below;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 240) - 8)) + 'px';
    pop.style.width = Math.max(r.width, 240) + 'px';
    pop.style.maxHeight = Math.max(160, (up ? above : below) - 16) + 'px';
    if (up) { pop.style.bottom = (vh - r.top + 6) + 'px'; pop.style.top = 'auto'; } else { pop.style.top = (r.bottom + 6) + 'px'; pop.style.bottom = 'auto'; }
  };
  const onKey = (e) => {
    if (!pop.isConnected) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); btn.focus(); }
    else if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); active = Math.min(shown.length - 1, active + 1); mark(true); }
    else if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); active = Math.max(0, active - 1); mark(true); }
    else if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(shown[active]); }
    else if (k === 'Tab') { e.preventDefault(); e.stopPropagation(); closePop(); btn.focus(); }
  };
  window.addEventListener('keydown', onKey, true);
  const onResize = () => place();
  window.addEventListener('resize', onResize);
  scrim.addEventListener('click', () => { closePop(); });
  search.addEventListener('input', () => { active = 0; render(); });
  current = { close() { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); scrim.remove(); pop.remove(); btn.setAttribute('aria-expanded', 'false'); } };

  const ci = shown.findIndex(o => String(o.value) === String(sel.value));
  render(); active = Math.max(0, shown.findIndex(o => String(o.value) === String(sel.value))); mark(); place();
  requestAnimationFrame(() => { place(); search.focus({ preventScroll: true }); list.children[active]?.scrollIntoView({ block: 'nearest' }); });
  void ci;
}

function enhance(sel) {
  if (sel.dataset.ss || sel.multiple || sel.size > 1) return;
  sel.dataset.ss = '1';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'input select ss-btn';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  const label = sel.getAttribute('aria-label'); if (label) btn.setAttribute('aria-label', label);
  const span = document.createElement('span'); span.className = 'ss-text'; btn.append(span);
  sel.classList.add('ss-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  sel.before(btn);
  const paint = () => {
    const o = sel.options[sel.selectedIndex];
    span.textContent = text(o) || 'Choose';
    btn.classList.toggle('is-blank', !sel.value);
    btn.disabled = sel.disabled;
  };
  // programmatic "sel.value = x" repaints too
  Object.defineProperty(sel, 'value', { get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); paint(); }, configurable: true });
  sel.addEventListener('change', paint);
  new MutationObserver(paint).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  btn.addEventListener('click', () => { paint(); openPop(sel, btn, paint); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); btn.click(); } });
  paint();
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.tagName === 'SELECT') enhance(root);
  root.querySelectorAll?.('select').forEach(enhance);
}

export function startSearchableSelects() {
  scan(document.body);
  new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(scan); }).observe(document.body, { childList: true, subtree: true });
}
