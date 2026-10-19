// Vehicle and helmet master: field lists, rent slabs, insurance dates, and reading a table pasted from Excel.
// Put this file in: assets/js/core/masters.js

// Rent per day depends on the kind of trip and on how many days the vehicle is taken for.
export const TRIPS = [{ value: 'local', label: 'Local trip' }, { value: 'road', label: 'Road trip' }];
export const SLAB_DEFS = [
  { k: 'd1_6',   label: '1 to 6 days',     from: 1,  to: 6 },
  { k: 'd7_13',  label: '7 to 13 days',    from: 7,  to: 13 },
  { k: 'd14_20', label: '14 to 20 days',   from: 14, to: 20 },
  { k: 'd21_27', label: '21 to 27 days',   from: 21, to: 27 },
  { k: 'd28',    label: '28 days or more', from: 28, to: Infinity },
];
// Column names look like local_d1_6 or road_d28; the extra km rate is local_extra_km / road_extra_km.
export const slabsOf = (trip) => SLAB_DEFS.map(s => ({ ...s, key: `${trip}_${s.k}` }));
export const extraKmKey = (trip) => `${trip}_extra_km`;
export const ALL_RATE_KEYS = TRIPS.flatMap(t => [extraKmKey(t.value), ...slabsOf(t.value).map(s => s.key)]);
export const slabFor = (days) => { const d = Number(days); return d >= 1 ? SLAB_DEFS.find(s => d >= s.from && d <= s.to) || null : null; };
// The master rent per day for this vehicle, trip kind and number of days (null when no rate is set yet).
export const rateFor = (vehicle, days, trip = 'local') => { const s = slabFor(days); const v = s ? vehicle?.[`${trip}_${s.k}`] : null; return v === null || v === undefined ? null : Number(v); };
export const extraKmFor = (vehicle, trip = 'local') => { const v = vehicle?.[extraKmKey(trip)]; return v === null || v === undefined ? null : Number(v); };

export const DEFAULT_TYPES = ['Cruiser', 'Scooter', 'Commuter', 'EV', 'Sports'];

// ---------------------------------------------------------------- dates
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 'yyyy-mm-dd' -> '17-Nov-2026'
export const fmtDay = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : ''; };
// '17-11-2026', '17/11/2026', '17.11.2026' or '2026-11-17' -> '2026-11-17'. '' when blank, null when it is not a real date.
export function parseDay(text) {
  const t = String(text ?? '').trim(); if (!t) return '';
  let y, m, d, k;
  if ((k = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) { d = +k[1]; m = +k[2]; y = +k[3]; }
  else if ((k = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) { y = +k[1]; m = +k[2]; d = +k[3]; }
  else if ((k = /^(\d{1,2})[-/. ]([A-Za-z]{3})[a-z]*[-/. ](\d{4})$/.exec(t))) { d = +k[1]; m = MONTHS.findIndex(x => x.toLowerCase() === k[2].toLowerCase()) + 1; y = +k[3]; if (!m) return null; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Insurance status for a 'yyyy-mm-dd' end date.
export function insuranceState(end) {
  if (!end) return { kind: 'none', label: 'No insurance date' };
  const t = new Date(); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const e = new Date(`${end}T00:00:00`); const days = Math.round((e - today) / 86400000);
  if (days < 0) return { kind: 'expired', days, label: `Insurance expired ${fmtDay(end)}` };
  if (days <= 30) return { kind: 'soon', days, label: `Insurance ends in ${days} day${days === 1 ? '' : 's'}` };
  return { kind: 'ok', days, label: `Insurance until ${fmtDay(end)}` };
}

// ---------------------------------------------------------------- reading a table copied from Excel
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const VEHICLE_HEAD = {
  vehiclenumber: 'number', number: 'number', regno: 'number', registrationnumber: 'number',
  model: 'model', brand: 'brand', type: 'vehicle_type', vehicletype: 'vehicle_type',
  ccc: 'cc', cc: 'cc', year: 'year', color: 'color', colour: 'color',
  insuranceenddate: 'insurance_end', insuranceend: 'insurance_end',
  vehicleownername: 'owner_name', vehicleowner: 'owner_name', insuranceownername: 'insurance_owner', insuranceowner: 'insurance_owner',
  // RC / Insurance columns hold attachments. They are added one by one on each vehicle, so they are skipped here.
  rc: null, insurance: null, insuarance: null,
};
const RATE_HEAD = { extrakm: 'extra_km', '01to06days': 'd1_6', '1to6days': 'd1_6', '07to13days': 'd7_13', '7to13days': 'd7_13',
  '14to20days': 'd14_20', '21to27days': 'd21_27', '28days': 'd28', '28daysormore': 'd28' };
// "Local Trip — 01 to 06 days" -> local_d1_6. Without Local or Road in the heading, the rate is read as a Local trip rate.
function headKey(c) {
  if (c in VEHICLE_HEAD) return VEHICLE_HEAD[c];
  const m = /^(localtrip|roadtrip|local|road)?(.*)$/.exec(c); const rest = m[2];
  if (rest in RATE_HEAD) return `${m[1] && m[1].startsWith('road') ? 'road' : 'local'}_${RATE_HEAD[rest]}`;
  return null;
}
// The columns of the vehicle Excel template: [heading, field]. The headings are read back by parseVehicleSheet.
export const VEHICLE_TEMPLATE = [['Vehicle Number', 'number'], ['Model', 'model'], ['Brand', 'brand'], ['Type', 'vehicle_type'], ['CC', 'cc'], ['Year', 'year'], ['Color', 'color'],
  ['Insurance End Date', 'insurance_end'], ['Vehicle Owner Name', 'owner_name'], ['Insurance Owner Name', 'insurance_owner'],
  ...TRIPS.flatMap(t => [[`${t.label} — Extra KM`, extraKmKey(t.value)], ...slabsOf(t.value).map(s => [`${t.label} — ${s.label}`, s.key])])];
// Used only when the first line is not a header. Same order as the master table.
const VEHICLE_ORDER = ['number', 'model', 'brand', 'vehicle_type', 'cc', 'year', 'color', 'insurance_end', 'owner_name', 'insurance_owner', null, null,
  ...TRIPS.flatMap(t => [extraKmKey(t.value), ...slabsOf(t.value).map(s => s.key)])];
const NUMERIC = ['cc', 'year', ...ALL_RATE_KEYS];
const NICE = { number: 'Vehicle number', model: 'Model', cc: 'CC', year: 'Year', insurance_end: 'Insurance end date' };
const niceKey = (k) => NICE[k] || `${k.startsWith('road') ? 'Road' : 'Local'} trip rate (${k.replace(/^(local|road)_/, '')})`;

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map(c => c.trim());
  const out = []; let cur = '', q = false;                    // comma separated, with optional "quotes"
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  out.push(cur.trim()); return out;
}
const lines = (text) => String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());

// -> { rows: [{ ...fields, _line }], problems: [{ line, key, message }] }
export function parseVehicleSheet(text) {
  const ls = lines(text); const rows = [], problems = [], seen = new Set();
  if (!ls.length) return { rows, problems };
  let order = VEHICLE_ORDER, start = 0;
  const first = splitLine(ls[0]).map(norm);
  if (first.some(c => c === 'vehiclenumber' || c === 'model' || c === 'number')) {
    order = first.map(headKey); start = 1;
  }
  if (!order.includes('number') || !order.includes('model')) return { rows, problems: [{ line: 1, key: '', message: 'The first line must have the headings "Vehicle Number" and "Model".' }] };
  ls.slice(start).forEach((ln, idx) => {
    const lineNo = idx + start + 1; const cells = splitLine(ln); const r = { _line: lineNo }; const bad = [];
    order.forEach((k, i) => { if (k) r[k] = String(cells[i] ?? '').trim(); });
    r.number = (r.number || '').toUpperCase();
    if (!r.number) return problems.push({ line: lineNo, key: '', message: 'The vehicle number is empty.' });
    if (!r.model) bad.push('The model is empty.');
    if (seen.has(r.number)) bad.push('This vehicle number is listed twice.'); seen.add(r.number);
    for (const k of NUMERIC) if (k in r && r[k] !== '') {
      const n = Number(String(r[k]).replace(/,/g, '')); if (!Number.isFinite(n) || n < 0) bad.push(`${niceKey(k)} must be a number.`); else r[k] = String(n);
    }
    if ('insurance_end' in r) { const d = parseDay(r.insurance_end); if (d === null) bad.push('Insurance end date must look like 17-Nov-2026 or 17-11-2026.'); else r.insurance_end = d; }
    if (bad.length) problems.push({ line: lineNo, key: r.number, message: bad.join(' ') }); else rows.push(r);
  });
  return { rows, problems };
}

// Helmet table: Helmet ID, Name, Type
export function parseHelmetSheet(text) {
  const ls = lines(text); const rows = [], problems = [], seen = new Set();
  let start = 0;
  if (ls.length && /^(helmet\s*id|id|code|helmet)\b/i.test(splitLine(ls[0])[0] || '')) start = 1;
  ls.slice(start).forEach((ln, idx) => {
    const lineNo = idx + start + 1; const [code, name = '', type = ''] = splitLine(ln); const c = String(code || '').trim().toUpperCase();
    if (!c) return problems.push({ line: lineNo, key: '', message: 'The helmet ID is empty.' });
    if (seen.has(c)) return problems.push({ line: lineNo, key: c, message: 'This helmet ID is listed twice.' });
    seen.add(c); rows.push({ _line: lineNo, code: c, name: name.trim(), helmet_type: type.trim() });
  });
  return { rows, problems };
}
