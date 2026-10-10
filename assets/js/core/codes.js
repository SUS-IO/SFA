// "A1-A10, F65, B3-5" -> ['A1',...,'A10','F65','B3','B4','B5']
export function parseCodes(text, limit = 500) {
  const out = []; const seen = new Set();
  const tokens = String(text || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  for (const t of tokens) {
    const m = /^([A-Za-z]*)(\d+)\s*(?:-|–|—|\bto\b)\s*([A-Za-z]*)(\d+)$/i.exec(t);
    let list;
    if (m && (!m[3] || m[3].toLowerCase() === m[1].toLowerCase())) {
      const [, prefix, a, , b] = m; const lo = parseInt(a, 10), hi = parseInt(b, 10);
      if (hi < lo) return { codes: [], error: `"${t}" counts backwards. Write the smaller number first.` };
      if (hi - lo + 1 > limit) return { codes: [], error: `"${t}" is more than ${limit} items.` };
      const width = a.length > 1 && a.startsWith('0') ? a.length : 0;
      list = []; for (let n = lo; n <= hi; n++) list.push(prefix + (width ? String(n).padStart(width, '0') : String(n)));
    } else list = [t];
    for (const c of list) { const k = c.toUpperCase(); if (!seen.has(k)) { seen.add(k); out.push(k); } }
    if (out.length > limit) return { codes: [], error: `Add at most ${limit} at a time.` };
  }
  return { codes: out, error: '' };
}
// One vehicle per line: "V1001" or "V1001, Scooter"
export function parseVehicleLines(text) {
  return String(text || '').split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
    const [number, ...rest] = l.split(/[,\t;]/); return { number: number.trim(), model: rest.join(' ').trim() };
  });
}
