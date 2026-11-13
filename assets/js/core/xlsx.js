// Excel files in the browser: build a workbook for download, and read an uploaded .xlsx.
// The Excel library (SheetJS) is loaded from the internet the first time it is needed.
// Put this file in: assets/js/core/xlsx.js
const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let loading = null;
export function loadXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return (loading ||= new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = SHEETJS;
    s.onload = () => ok(globalThis.XLSX);
    s.onerror = () => { loading = null; no(new Error('Could not load the Excel tools. Check the internet connection and try again.')); };
    document.head.append(s);
  }));
}

const IST = 5.5 * 3600e3;
// A moment as an Excel date-time, shown in India time whatever the viewer's time zone is.
export const excelSerial = (ts) => { const t = new Date(ts).getTime(); return Number.isFinite(t) ? (t + IST) / 86400000 + 25569 : null; };
// 'yyyy-mm-dd' as an Excel date
export const excelDay = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569 : null; };
const FMT = { dt: 'dd-mmm-yyyy hh:mm', date: 'dd-mmm-yyyy', money: '#,##0.00', int: '0' };
const safeName = (n, used) => { let s = String(n).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'; let k = 2, base = s; while (used.has(s.toLowerCase())) s = `${base.slice(0, 28)} ${k++}`; used.add(s.toLowerCase()); return s; };

// sheets: [{ name, cols: [{ h: 'Heading', t: 'text'|'int'|'money'|'dt'|'date', w: width, get: (row) => value }], rows: [..] }]
export async function makeWorkbook(sheets) {
  const X = await loadXlsx(); const wb = X.utils.book_new(); const used = new Set();
  for (const sh of sheets) {
    const ws = {}; const R = sh.rows.length;
    sh.cols.forEach((c, ci) => { ws[X.utils.encode_cell({ r: 0, c: ci })] = { t: 's', v: c.h }; });
    sh.rows.forEach((row, ri) => sh.cols.forEach((c, ci) => {
      let v = c.get ? c.get(row) : row[c.key]; if (v === null || v === undefined || v === '') return;
      const ref = X.utils.encode_cell({ r: ri + 1, c: ci }); const t = c.t || 'text';
      if (t === 'dt' || t === 'date') { const n = t === 'dt' ? excelSerial(v) : (typeof v === 'number' ? v : excelDay(v) ?? excelSerial(v)); if (n !== null) ws[ref] = { t: 'n', v: n, z: FMT[t] }; }
      else if (t === 'money' || t === 'int') { const n = Number(v); if (Number.isFinite(n)) ws[ref] = { t: 'n', v: n, z: FMT[t] }; }
      else ws[ref] = { t: 's', v: String(v) };
    }));
    ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(R, 0), c: Math.max(sh.cols.length - 1, 0) } });
    ws['!cols'] = sh.cols.map(c => ({ wch: c.w || Math.max(10, Math.min(36, String(c.h).length + 2)) }));
    if (R) ws['!autofilter'] = { ref: ws['!ref'] };
    X.utils.book_append_sheet(wb, ws, safeName(sh.name, used));
  }
  return { X, wb };
}
export async function saveXlsx(sheets, filename) {
  const { X, wb } = await makeWorkbook(sheets);
  X.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
// For tests and previews: the file as bytes
export async function xlsxBytes(sheets) { const { X, wb } = await makeWorkbook(sheets); return X.write(wb, { type: 'array', bookType: 'xlsx' }); }

// Read the first sheet of an uploaded .xlsx as tab separated text (dates become yyyy-mm-dd), so it can go through the same
// checks as a table pasted from Excel.
export async function readFirstSheetAsText(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('This file is over 8 MB. Please upload a smaller file.');
  const X = await loadXlsx(); let wb;
  try { wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: false, cellNF: true }); } catch { throw new Error('This file could not be read. Please use an Excel file (.xlsx).'); }
  const name = wb.SheetNames[0]; const ws = name && wb.Sheets[name]; if (!ws || !ws['!ref']) throw new Error('The first sheet of this file is empty.');
  const rg = X.utils.decode_range(ws['!ref']); if (rg.e.r > 5000) throw new Error('Too many rows. Upload at most 5000 rows at a time.');
  const lines = []; const dateCols = new Set();
  for (let c = rg.s.c; c <= rg.e.c; c++) { const hd = ws[X.utils.encode_cell({ r: rg.s.r, c })]; if (hd && /date|expiry|valid/i.test(String(hd.v))) dateCols.add(c); }   // a date column
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const cells = [];
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const cell = ws[X.utils.encode_cell({ r, c })]; let v = '';
      if (cell) {
        if (cell.t === 'n' && ((cell.z && X.SSF?.is_date?.(cell.z)) || (r > rg.s.r && dateCols.has(c) && cell.v > 20000 && cell.v < 80000))) v = new Date(Math.round((cell.v - 25569) * 86400000)).toISOString().slice(0, 10);
        else if (cell.t === 'd' && cell.v instanceof Date) v = cell.v.toISOString().slice(0, 10);
        else v = cell.v === undefined || cell.v === null ? '' : String(cell.v);
      }
      cells.push(v.replace(/[\t\r\n]+/g, ' ').trim());
    }
    if (cells.some(x => x)) lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}
