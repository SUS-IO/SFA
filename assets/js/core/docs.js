// RC and insurance files. A PDF is shrunk in the browser before it is saved (each page is redrawn as a small
// picture and rebuilt into a light PDF), so these files use very little storage. Photos are shrunk too.
// Put this file in: assets/js/core/docs.js
import { sb } from './supa.js';
import { h, icon, fmtBytes, toast } from './ui.js';
import { compressImage } from './images.js';

const BUCKET = 'documents';
const MAX_INPUT = 15 * 1024 * 1024;       // biggest PDF we will read
const MAX_PAGES = 6;                      // pages kept from a PDF
const PER_PAGE = 90 * 1024;               // aim for about 90 KB per page
const HARD_LIMIT = 900 * 1024;            // the bucket refuses anything above 1 MB
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const rand = () => Math.random().toString(36).slice(2, 8);

// ---- reading a PDF (the reader is loaded only the first time a PDF is chosen) ----
let readerP;
function loadReader() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return (readerP ||= new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = `${PDFJS}pdf.min.js`;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`; ok(window.pdfjsLib); };
    s.onerror = () => { readerP = null; no(new Error('Could not load the PDF reader. Check the internet connection and try again.')); };
    document.head.append(s);
  }));
}
const toBlob = (canvas, type, q) => new Promise(res => canvas.toBlob(res, type, q));

// A small PDF made only of JPEG pictures, one per page.
function pdfFromJpegs(pages) {
  const enc = new TextEncoder(), chunks = [], offs = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (id, fn) => { offs[id] = len; push(`${id} 0 obj\n`); fn(); push('\nendobj\n'); };
  const N = pages.length;
  push('%PDF-1.4\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${N} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`));
  pages.forEach((p, i) => {
    const W = (p.w * 0.6).toFixed(2), H = (p.h * 0.6).toFixed(2), cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(3 + 3 * i, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`));
    obj(4 + 3 * i, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(5 + 3 * i, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`); push(p.bytes); push('\nendstream'); });
  });
  const total = 3 * N + 3, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id++) push(`${String(offs[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export async function shrinkPdf(file) {
  if (file.size > MAX_INPUT) throw new Error('This PDF is over 15 MB. Please choose a smaller file.');
  const lib = await loadReader();
  let doc;
  try { doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise; }
  catch { throw new Error('This PDF could not be read. It may be damaged or password protected.'); }
  const n = Math.min(doc.numPages, MAX_PAGES), pages = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i), base = page.getViewport({ scale: 1 });
    let best = null;
    for (const side of [1400, 1150, 950]) {
      const scale = side / Math.max(base.width, base.height), vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      for (const q of [0.55, 0.42, 0.32]) {
        const blob = await toBlob(canvas, 'image/jpeg', q); if (!blob) continue;
        if (!best || blob.size < best.blob.size) best = { blob, w: canvas.width, h: canvas.height };
        if (blob.size <= PER_PAGE) break;
      }
      if (best && best.blob.size <= PER_PAGE) break;
    }
    if (!best) throw new Error('This PDF could not be shrunk.');
    pages.push({ bytes: new Uint8Array(await best.blob.arrayBuffer()), w: best.w, h: best.h });
  }
  const out = pdfFromJpegs(pages);
  if (out.size > HARD_LIMIT) throw new Error('This PDF is still too large after shrinking. Please choose one with fewer pages.');
  return { blob: out, pages: n, total: doc.numPages };
}

export async function uploadDoc(folder, label, file) {
  const type = file.type;
  const ext = type === 'application/pdf' ? 'pdf' : type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
  const path = `${folder}/${label}-${Date.now().toString(36)}${rand()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false, cacheControl: '31536000' });
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
  let picked = null, removed = false, note = '';      // picked: File, already shrunk
  const status = h('span', { class: 'muted small' });
  const err = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const actions = h('div', { class: 'photo-actions' });
  const pick = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, tabindex: '-1' });
  const root = h('div', { class: 'photo' }, h('div', { class: 'photo-head' }, h('span', { class: 'field-label' }, label), status), actions, err, pick);
  const hasExisting = () => !!(existing && !removed && !picked);
  const paint = () => {
    actions.replaceChildren();
    status.textContent = picked ? `${picked.name} (${fmtBytes(picked.size)}${note ? `, ${note}` : ''})` : hasExisting() ? 'File saved' : 'No file yet';
    const has = picked || hasExisting();
    actions.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', on: { click: () => pick.click() } }, icon('image', 16), h('span', has ? 'Replace file' : 'Choose file')));
    if (hasExisting()) actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => openDoc(existing) } }, icon('eye', 16), h('span', 'View')));
    if (has) actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { picked = null; note = ''; removed = !!existing; paint(); } } }, icon('x', 16), h('span', 'Remove')));
  };
  pick.addEventListener('change', async () => {
    const f = pick.files?.[0]; pick.value = ''; if (!f) return;
    err.hidden = true; status.textContent = 'Shrinking…';
    try {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        const r = await shrinkPdf(f);
        picked = new File([r.blob], f.name.replace(/\.pdf$/i, '') + '.pdf', { type: 'application/pdf' });
        note = `was ${fmtBytes(f.size)}${r.total > r.pages ? `, first ${r.pages} of ${r.total} pages kept` : ''}`;
      } else if (/^image\//.test(f.type)) {
        const r = await compressImage(f);
        picked = new File([r.blob], f.name.replace(/\.\w+$/, '') + (r.type === 'image/webp' ? '.webp' : '.jpg'), { type: r.type });
        note = `was ${fmtBytes(f.size)}`;
      } else throw new Error('Choose a PDF or a photo.');
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
