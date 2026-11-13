// The place where a handover, swap or pickup happens: GPS position and the address found from it.
// Nothing is saved without a GPS position. If only the address lookup fails, the entry can still be saved (a button retries the address).
import { h, icon, btn, toast } from './ui.js';

const FRESH_MS = 3 * 60 * 1000;           // a position older than this is fetched again when saving

export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 'unsupported' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0), at: Date.now() }),
      (e) => reject({ code: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout, maximumAge: 20000 });
  });
}
export async function reverseGeocode(lat, lng, { timeout = 9000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json(); if (!j?.display_name) return null;
    const a = j.address || {}; const area = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city || '';
    return { address: j.display_name, area };
  } catch { return null; } finally { clearTimeout(t); }
}
export const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const WHY = {
  denied: 'Location is switched off for this site. Turn on location (GPS) in your phone or browser settings for this site, then press Try again.',
  unavailable: 'The phone could not find its position. Go to an open area, make sure GPS is on, then press Try again.',
  timeout: 'Finding the position took too long. Make sure GPS is on, then press Try again.',
  unsupported: 'This browser cannot give the location. Use Chrome or Safari on your phone.',
};

// A small card for a form: captures the position at once, and again when saving if it is old.
export function geoCapture({ label = 'Location', onAddress = null } = {}) {
  let pos = null, addr = null, area = '', state = 'busy', why = '', addrBusy = false;
  const body = h('div', { class: 'geo-body' });
  const root = h('div', { class: 'geo-card', role: 'group', 'aria-label': label }, h('strong', label), body);
  const retry = btn('Try again', { small: true, ic: 'pin', onClick: () => capture() });
  const retryAddr = btn('Retry address', { small: true, onClick: () => lookup() });
  function paint() {
    const line = (cls, text) => h('p', { class: `geo-line ${cls}` }, text);
    if (state === 'busy') body.replaceChildren(line('wait', 'Finding your location…'));
    else if (state === 'error') body.replaceChildren(line('bad', why), retry, h('p', { class: 'muted small' }, 'This cannot be saved without the location.'));
    else body.replaceChildren(
      line('good', `Location captured (about ${pos.acc || '?'} m).`),
      addrBusy ? line('wait', 'Finding the address…') : addr ? line('addr', addr) : line('warn', 'The address could not be found automatically. You can still save; the location is recorded.'),
      h('div', { class: 'geo-actions' }, h('a', { class: 'btn btn-secondary btn-sm', href: mapsUrl(pos.lat, pos.lng), target: '_blank', rel: 'noopener' }, 'Open map'),
        !addr && !addrBusy ? retryAddr : null, btn('Refresh location', { small: true, onClick: () => capture() })));
  }
  async function lookup() {
    if (!pos) return; addrBusy = true; paint();
    const r = await reverseGeocode(pos.lat, pos.lng); addrBusy = false;
    if (r) { addr = r.address; area = r.area; onAddress?.(addr, area); } else addr = null;
    paint();
  }
  let inflight = null;
  function capture() {
    if (inflight) return inflight;
    state = 'busy'; paint();
    inflight = getPosition().then(async (p) => { pos = p; addr = null; state = 'ok'; paint(); await lookup(); return true; })
      .catch((e) => { pos = null; state = 'error'; why = WHY[e?.code] || WHY.unavailable; paint(); return false; })
      .finally(() => { inflight = null; });
    return inflight;
  }
  capture();
  const value = () => (pos ? { geo_lat: String(pos.lat), geo_lng: String(pos.lng), geo_accuracy: String(pos.acc || ''), geo_address: addr || '' } : null);
  return {
    el: root, value,
    // call when saving: returns the position fields, or null (and shows why) when there is no position
    async ensure() {
      if (pos && Date.now() - pos.at < FRESH_MS) return value();
      const ok = await capture(); if (!ok) { toast('The location (GPS) is needed. Turn it on and press Try again.', 'error'); return null; }
      return value();
    },
    refresh: capture,
  };
}
