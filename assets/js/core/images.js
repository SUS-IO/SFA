// Photos: shrink in the browser to a few KB, upload to the private "photos" bucket,
// and show them again through short-lived signed links.
import { sb } from './supa.js';
import { h, icon, fmtBytes, toast } from './ui.js';

const TARGET = 90 * 1024;            // aim for about 90 KB per photo
const HARD_LIMIT = 280 * 1024;       // the bucket refuses anything above 300 KB

let preferred;                        // 'image/webp' where the browser can encode it, else JPEG
function outType() {
  if (preferred) return preferred;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    preferred = c.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  } catch { preferred = 'image/jpeg'; }
  return preferred;
}
const toBlob = (canvas, type, q) => new Promise(res => canvas.toBlob(res, type, q));

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('This file is not a readable image.')); i.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export async function compressImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Please choose a photo.');
  const src = await decode(file);
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const type = outType();
  let best = null, from = src, fw = w0, fh = h0;
  // Few passes on purpose (phones are slow): each smaller size is drawn from the previous canvas.
  for (const side of [1280, 1024, 800, 640]) {
    const scale = Math.min(1, side / Math.max(fw, fh));
    if (scale === 1 && from !== src && side < 1280) continue;
    const w = Math.max(1, Math.round(fw * scale)), hh = Math.max(1, Math.round(fh * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); ctx.drawImage(from, 0, 0, w, hh);
    from = canvas; fw = w; fh = hh;
    for (const q of [0.62, 0.46, 0.34]) {
      const blob = await toBlob(canvas, type, q);
      if (!blob) continue;
      if (!best || blob.size < best.blob.size) best = { blob, width: w, height: hh };
      if (blob.size <= TARGET) { src.close?.(); return finish(best); }
    }
  }
  src.close?.();
  if (!best || best.blob.size > HARD_LIMIT) throw new Error('This photo is too detailed to shrink enough. Try taking it again.');
  return finish(best);
}
const finish = (b) => ({ blob: b.blob, width: b.width, height: b.height, type: b.blob.type, size: b.blob.size });

const rand = () => Math.random().toString(36).slice(2, 8);
export const extOf = (type) => (type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg');
export function photoPath(folder, label, type) {
  return `${folder}/${label}-${Date.now().toString(36)}${rand()}.${extOf(type)}`;
}
export async function uploadPhoto(path, blob) {
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
  if (error) throw error;
  return path;
}

// ---- signed links (cached for ~50 minutes) ---------------------------------
const cache = new Map();
export async function signedUrls(paths) {
  const need = [...new Set(paths.filter(Boolean))].filter(p => !(cache.get(p)?.exp > Date.now() + 300000));
  if (need.length) {
    const { data, error } = await sb.storage.from('photos').createSignedUrls(need, 3600);
    if (error) throw error;
    for (const r of data) if (r.signedUrl) cache.set(r.path, { url: r.signedUrl, exp: Date.now() + 3600000 });
  }
  return Object.fromEntries(paths.filter(Boolean).map(p => [p, cache.get(p)?.url]));
}

export function lightbox(url, caption) {
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const el = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': caption || 'Photo', on: { click: close } },
    h('button', { class: 'icon-btn lightbox-x', type: 'button', 'aria-label': 'Close photo', on: { click: close } }, icon('x', 22)),
    h('img', { src: url, alt: caption || 'Photo' }), caption ? h('p', caption) : null);
  document.body.append(el); document.addEventListener('keydown', onKey, true);
}

// ---- photo picker field -----------------------------------------------------
// opts: { label, required, existing (path) }
export function photoField({ label, required = false, existing = null } = {}) {
  let picked = null;                       // { blob, size, type, previewUrl }
  let removedExisting = false;
  const frame = h('div', { class: 'photo-frame' });
  const meta = h('span', { class: 'photo-size' });
  const err = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, tabindex: '-1' });
  const gal = h('input', { type: 'file', accept: 'image/*', hidden: true, tabindex: '-1' });
  const actions = h('div', { class: 'photo-actions' });
  const root = h('div', { class: 'photo' },
    h('div', { class: 'photo-head' }, h('span', { class: 'field-label' }, label, required ? h('b', { class: 'req' }, ' *') : null), meta),
    frame, actions, err, cam, gal);

  const paint = async () => {
    frame.replaceChildren(); actions.replaceChildren();
    const hasExisting = existing && !removedExisting;
    if (picked) {
      frame.append(h('img', { src: picked.previewUrl, alt: label })); meta.textContent = fmtBytes(picked.size);
    } else if (hasExisting) {
      meta.textContent = 'Saved';
      frame.append(icon('image', 28));
      signedUrls([existing]).then(m => { if (m[existing]) { frame.replaceChildren(h('img', { src: m[existing], alt: label })); } }).catch(() => {});
    } else { meta.textContent = ''; frame.append(icon('camera', 28), h('span', 'No photo yet')); }
    frame.classList.toggle('filled', !!(picked || hasExisting));
    if (picked || hasExisting) {
      actions.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', on: { click: () => cam.click() } }, icon('camera', 16), h('span', 'Retake')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { clearPicked(); removedExisting = !!existing; paint(); } } }, icon('x', 16), h('span', 'Remove')));
    } else {
      actions.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', on: { click: () => cam.click() } }, icon('camera', 16), h('span', 'Take photo')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => gal.click() } }, icon('image', 16), h('span', 'Choose file')));
    }
  };
  const clearPicked = () => { if (picked) URL.revokeObjectURL(picked.previewUrl); picked = null; };
  const onFile = async (input) => {
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    meta.textContent = 'Shrinking…';
    try {
      const r = await compressImage(file);
      clearPicked(); picked = { ...r, previewUrl: URL.createObjectURL(r.blob) }; removedExisting = false;
      api.setError('');
    } catch (e) { toast(e.message, 'error'); }
    paint();
  };
  cam.addEventListener('change', () => onFile(cam)); gal.addEventListener('change', () => onFile(gal));

  const api = {
    el: root,
    isFilled: () => !!(picked || (existing && !removedExisting)),
    picked: () => picked,                                  // new photo to upload, if any
    keptPath: () => (existing && !removedExisting && !picked ? existing : null),
    removed: () => !!(existing && removedExisting && !picked),
    setError(msg) { err.textContent = msg || ''; err.hidden = !msg; root.classList.toggle('has-error', !!msg); },
  };
  paint();
  return api;
}

// Up to `max` extra photos.
export function multiPhotoField({ label, max = 5, existing = [] } = {}) {
  const kept = [...existing];
  const items = [];                         // { blob, size, type, previewUrl }
  const grid = h('div', { class: 'photo-multi' });
  const gal = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, tabindex: '-1' });
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, tabindex: '-1' });
  const root = h('div', { class: 'photo' }, h('div', { class: 'photo-head' }, h('span', { class: 'field-label' }, label), h('span', { class: 'photo-size' }, `Up to ${max}`)), grid, gal, cam);
  const total = () => kept.length + items.length;
  const paint = () => {
    grid.replaceChildren();
    kept.forEach((p, i) => {
      const tile = h('div', { class: 'tile filled' }, icon('image', 22));
      signedUrls([p]).then(m => m[p] && tile.prepend(h('img', { src: m[p], alt: `${label} ${i + 1}` }))).catch(() => {});
      tile.append(h('button', { type: 'button', class: 'tile-x', 'aria-label': 'Remove photo', on: { click: () => { kept.splice(i, 1); paint(); } } }, icon('x', 14)));
      grid.append(tile);
    });
    items.forEach((it, i) => grid.append(h('div', { class: 'tile filled' }, h('img', { src: it.previewUrl, alt: `${label} new ${i + 1}` }),
      h('span', { class: 'tile-size' }, fmtBytes(it.size)),
      h('button', { type: 'button', class: 'tile-x', 'aria-label': 'Remove photo', on: { click: () => { URL.revokeObjectURL(it.previewUrl); items.splice(i, 1); paint(); } } }, icon('x', 14)))));
    if (total() < max) {
      grid.append(h('button', { type: 'button', class: 'tile add', on: { click: () => cam.click() } }, icon('camera', 22), h('span', 'Take photo')),
        h('button', { type: 'button', class: 'tile add', on: { click: () => gal.click() } }, icon('image', 22), h('span', 'Choose files')));
    }
  };
  const onFiles = async (input) => {
    const files = [...(input.files || [])]; input.value = '';
    for (const f of files) {
      if (total() >= max) { toast(`Only ${max} photos allowed here.`, 'error'); break; }
      try { const r = await compressImage(f); items.push({ ...r, previewUrl: URL.createObjectURL(r.blob) }); paint(); }
      catch (e) { toast(e.message, 'error'); }
    }
  };
  gal.addEventListener('change', () => onFiles(gal)); cam.addEventListener('change', () => onFiles(cam));
  paint();
  return { el: root, kept: () => [...kept], newItems: () => [...items] };
}
