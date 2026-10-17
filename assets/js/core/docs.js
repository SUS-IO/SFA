// RC and insurance files (PDF or photo, up to 2 MB) kept in the private "documents" bucket.
// Put this file in: assets/js/core/docs.js
import { sb } from './supa.js';
import { h, icon, fmtBytes, toast } from './ui.js';
import { compressImage } from './images.js';

const BUCKET = 'documents', LIMIT = 2 * 1024 * 1024;
const rand = () => Math.random().toString(36).slice(2, 8);

export async function uploadDoc(folder, label, file) {
  const isPdf = file.type === 'application/pdf';
  const ext = isPdf ? 'pdf' : file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg';
  const path = `${folder}/${label}-${Date.now().toString(36)}${rand()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (error) throw error;
  return path;
}
export async function removeDoc(path) { try { await sb.storage.from(BUCKET).remove([path]); } catch { /* best effort */ } }

export async function docUrl(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error; return data.signedUrl;
}
// Opens the file in a new tab (the tab is opened first so phones do not block it).
export async function openDoc(path) {
  const w = window.open('', '_blank');
  try { const url = await docUrl(path); if (w) w.location.href = url; else window.location.href = url; }
  catch (e) { w?.close(); toast('Could not open the file. Try again.', 'error'); }
}

// A small file picker. opts: { label, existing (path) }
export function docField({ label, existing = null } = {}) {
  let picked = null, removed = false;                // picked: File (already within the size limit)
  const status = h('span', { class: 'muted small' });
  const err = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const actions = h('div', { class: 'photo-actions' });
  const pick = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, tabindex: '-1' });
  const root = h('div', { class: 'photo' }, h('div', { class: 'photo-head' }, h('span', { class: 'field-label' }, label), status), actions, err, pick);
  const hasExisting = () => !!(existing && !removed && !picked);
  const paint = () => {
    actions.replaceChildren();
    status.textContent = picked ? `${picked.name} (${fmtBytes(picked.size)})` : hasExisting() ? 'File saved' : 'No file yet';
    const has = picked || hasExisting();
    actions.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', on: { click: () => pick.click() } }, icon('image', 16), h('span', has ? 'Replace file' : 'Choose file')));
    if (hasExisting()) actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => openDoc(existing) } }, icon('eye', 16), h('span', 'View')));
    if (has) actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { picked = null; removed = !!existing; paint(); } } }, icon('x', 16), h('span', 'Remove')));
  };
  pick.addEventListener('change', async () => {
    const f = pick.files?.[0]; pick.value = ''; if (!f) return;
    err.hidden = true;
    try {
      if (f.type === 'application/pdf') { if (f.size > LIMIT) throw new Error('This PDF is over 2 MB. Please send a smaller or compressed PDF.'); picked = f; }
      else if (/^image\//.test(f.type)) { status.textContent = 'Shrinking…'; const r = await compressImage(f); picked = new File([r.blob], f.name.replace(/\.\w+$/, '') + (r.type === 'image/webp' ? '.webp' : '.jpg'), { type: r.type }); }
      else throw new Error('Choose a PDF or a photo.');
      removed = false;
    } catch (e) { err.textContent = e.message; err.hidden = false; }
    paint();
  });
  paint();
  let stale = null;
  return {
    el: root,
    // Upload a new file if one was chosen and return the path to store: new path, kept path, or null (removed / none).
    // The old file is only deleted by cleanup(), which the caller runs after the record has been saved.
    async commit(folder, key) {
      stale = null;
      if (picked) { const p = await uploadDoc(folder, key, picked); stale = existing || null; return p; }
      if (hasExisting()) return existing;
      if (existing && removed) stale = existing;
      return null;
    },
    cleanup() { if (stale) removeDoc(stale); stale = null; },
  };
}
