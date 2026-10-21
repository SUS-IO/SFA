// Photos for approvers: one big photo with Previous / Next, or old and new side by side.
import { h, icon, btn } from './ui.js';
import { signedUrls, lightbox } from './images.js';

const SIDE_LABEL = { odometer: 'Odometer', front: 'Front', back: 'Rear', left: 'Left side', right: 'Right side' };
// a saved photo set -> [{ key, label, path }]
export function setItems(set) {
  if (!set || typeof set !== 'object') return [];
  const out = [];
  for (const k of ['odometer', 'front', 'back', 'left', 'right']) if (set[k]) out.push({ key: k, label: SIDE_LABEL[k], path: set[k] });
  (set.extra || []).forEach((p, i) => out.push({ key: `extra${i}`, label: `Additional ${i + 1}`, path: p }));
  (set.helmets || []).forEach((p, i) => out.push({ key: `helmet${i}`, label: `Helmet ${i + 1}`, path: p }));
  return out;
}
// old set + new set -> pairs, matched by side (odometer, front, ...); extras follow
export function pairItems(oldSet, newSet) {
  const o = setItems(oldSet), n = setItems(newSet); const keys = [...new Set([...n.map(x => x.key), ...o.map(x => x.key)])];
  const order = ['odometer', 'front', 'back', 'left', 'right']; keys.sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1); });
  return keys.map(k => { const a = o.find(x => x.key === k), b = n.find(x => x.key === k); return { label: (b || a).label, oldPath: a?.path || null, newPath: b?.path || null }; });
}

// slides: [{ label, panes: [{ title, path }] }]   (one pane = a normal slider, two panes = side by side)
export function slider({ title = '', slides = [] } = {}) {
  const root = h('div', { class: 'slider', tabindex: '0', role: 'group', 'aria-label': title || 'Photos' });
  if (!slides.length) { root.append(h('p', { class: 'muted small' }, 'No photos.')); return root; }
  let i = 0; let urls = {};
  const stage = h('div', { class: 'slider-stage' }); const cap = h('p', { class: 'slider-cap' }); const thumbs = h('div', { class: 'slider-thumbs' });
  const prev = h('button', { type: 'button', class: 'slider-nav', 'aria-label': 'Previous photo', on: { click: () => go(i - 1) } }, icon('right', 22)); prev.firstChild.style.transform = 'scaleX(-1)';
  const next = h('button', { type: 'button', class: 'slider-nav', 'aria-label': 'Next photo', on: { click: () => go(i + 1) } }, icon('right', 22));
  function go(n) { i = (n + slides.length) % slides.length; draw(); }
  function draw() {
    const sl = slides[i];
    stage.className = `slider-stage panes-${sl.panes.length}`;
    stage.replaceChildren(...sl.panes.map(p => {
      const u = p.path ? urls[p.path] : null;
      const pane = h('figure', { class: 'slider-pane' }, p.title ? h('figcaption', p.title) : null,
        p.path ? (u ? h('img', { src: u, alt: `${sl.label}${p.title ? ', ' + p.title : ''}` }) : h('div', { class: 'slider-wait' }, 'Loading…')) : h('div', { class: 'slider-none' }, 'No photo'));
      if (u) { pane.style.cursor = 'zoom-in'; pane.addEventListener('click', () => lightbox(u, `${title ? title + ': ' : ''}${sl.label}${p.title ? ', ' + p.title : ''}`)); }
      return pane;
    }));
    cap.textContent = `${i + 1} of ${slides.length}: ${sl.label}`;
    [...thumbs.children].forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
  }
  slides.forEach((sl, k) => thumbs.append(h('button', { type: 'button', class: 'slider-thumb', 'aria-label': sl.label, title: sl.label, on: { click: () => go(k) } }, sl.label)));
  root.append(title ? h('strong', { class: 'slider-title' }, title) : null, h('div', { class: 'slider-row' }, prev, stage, next), cap, thumbs);
  root.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); } });
  draw();
  const paths = slides.flatMap(sl => sl.panes.map(p => p.path)).filter(Boolean);
  signedUrls(paths).then(m => { urls = m; draw(); }).catch(() => {});
  return root;
}
export const photoSlider = (set, title) => { const it = setItems(set); return it.length ? slider({ title, slides: it.map(x => ({ label: x.label, panes: [{ path: x.path }] })) }) : null; };
export const compareSlider = (oldSet, newSet, { title = '', oldTitle = 'At handover', newTitle = 'Now' } = {}) => {
  const pr = pairItems(oldSet, newSet); if (!pr.length) return null;
  return slider({ title, slides: pr.map(p => ({ label: p.label, panes: [{ title: oldTitle, path: p.oldPath }, { title: newTitle, path: p.newPath }] })) });
};

// A small read-only tile for the "old photo" column of a form (old on the left, new capture on the right).
export function oldPhotoCell(path, label) {
  const tile = h('div', { class: `tile filled cmp-tile${path ? '' : ' none'}` }, path ? icon('image', 22) : h('span', 'No old photo'), h('span', { class: 'thumb-label' }, label));
  if (path) signedUrls([path]).then(m => { const u = m[path]; if (u) { tile.prepend(h('img', { src: u, alt: label })); tile.style.cursor = 'zoom-in'; tile.addEventListener('click', () => lightbox(u, label)); } }).catch(() => {});
  return tile;
}
