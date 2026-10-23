// Attendance: mark In / Out with a selfie and GPS, many times a day, review, schedules and a map.
// Put this file in: assets/js/views/attendance.js
import { h, icon, btn, busy, chip, field, input, select, textarea, openSheet, toast, mount, emptyState, skeletonRows, fmtTime, friendlyError, confirmDialog } from '../core/ui.js';
import { sb, rpc } from '../core/supa.js';
import { state, can } from '../core/store.js';
import { geoCapture, mapsUrl } from '../core/geo.js';
import { photoField, uploadPhoto, photoPath, signedUrls, lightbox } from '../core/images.js';
import { dataTable } from '../core/table.js';

// ---------------------------------------------------------------- helpers (all days are Indian time)
const TZ = 'Asia/Kolkata';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const labelFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
export const istDay = (t = new Date()) => dayFmt.format(new Date(t));
const dayStart = (day) => new Date(`${day}T00:00:00+05:30`);
export const addDays = (day, n) => istDay(new Date(dayStart(day).getTime() + n * 86400000 + 43200000));
const dayLabel = (day) => labelFmt.format(new Date(dayStart(day).getTime() + 43200000));
export const hm = (min) => { min = Math.max(0, Math.round(Number(min) || 0)); return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`; };
const effIn = (p) => p.adj_in_at || p.in_at;
const effOut = (p) => p.adj_out_at || p.out_at;
const minsOf = (p) => Math.max(0, Math.round(((effOut(p) ? new Date(effOut(p)) : new Date()) - new Date(effIn(p))) / 60000));
const punchDay = (p) => istDay(effIn(p));
const istInput = (ts) => { const o = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts)).map(x => [x.type, x.value])); return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`; };
const fromIstInput = (v) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
const nm = (id) => state.profileMap?.get(id)?.user_name || 'Unknown user';
const timeText = (t) => String(t || '').slice(0, 5);
const STATUS = { pending: ['Waiting for review', 'aqua'], present: ['Present', 'blue'], absent: ['Absent', 'pink'] };
const PALETTE = ['#1769e0', '#d6336c', '#2b8a3e', '#e8590c', '#7048e8', '#0c8599', '#a61e4d', '#5c940d', '#c92a2a', '#495057'];

// a small selfie button: opens the big photo
function selfie(path, label) {
  if (!path) return h('span', { class: 'selfie none', title: `${label}: no photo` }, '–');
  const b = h('button', { type: 'button', class: 'selfie', title: label, 'aria-label': `View ${label}` }, icon('camera', 18));
  signedUrls([path]).then(m => { const u = m[path]; if (!u) return; b.replaceChildren(h('img', { src: u, alt: label })); b.addEventListener('click', () => lightbox(u, label)); }).catch(() => {});
  return b;
}
const placeLine = (kind, addr, lat, lng) => (lat == null ? null : h('small', { class: 'att-place' }, `${kind}: `, addr ? `${addr} ` : 'location recorded ', h('a', { href: mapsUrl(lat, lng), target: '_blank', rel: 'noopener' }, '(map)')));

function punchRow(p, { onCorrect } = {}) {
  const who = nm(p.uid);
  return h('li', { class: 'att-row' },
    h('div', { class: 'att-times' },
      h('strong', `${fmtTime(effIn(p))} – ${effOut(p) ? fmtTime(effOut(p)) : 'still In'}`),
      h('small', effOut(p) ? hm(minsOf(p)) : `${hm(minsOf(p))} so far`),
      p.adj_at ? h('span', { class: 'att-corr', title: p.adj_note || '' }, chip('Corrected', 'neutral')) : null),
    h('div', { class: 'att-selfies' }, selfie(p.in_photo, `${who}, In selfie`), selfie(p.out_photo, `${who}, Out selfie`)),
    h('div', { class: 'att-places' }, placeLine('In', p.in_address, p.in_lat, p.in_lng), placeLine('Out', p.out_address, p.out_lat, p.out_lng),
      p.adj_at ? h('small', { class: 'att-place' }, `Original: ${fmtTime(p.in_at)} – ${p.out_at ? fmtTime(p.out_at) : 'no Out'}. ${p.adj_note || ''}`) : null),
    onCorrect ? btn('Correct timings', { small: true, ic: 'edit', onClick: () => onCorrect(p) }) : null);
}

function dayCard(t, punches, { actions, title } = {}) {
  const [stText, stColor] = STATUS[t.status] || STATUS.pending;
  const counted = t.status === 'absent' ? 0 : t.minutes;
  return h('article', { class: 'card-item att-day' },
    h('div', { class: 'card-top' }, h('strong', title || dayLabel(t.day)), chip(t.sessions || t.minutes ? stText : (t.status === 'pending' ? 'No attendance' : stText), t.sessions || t.minutes ? stColor : (t.status === 'pending' ? 'neutral' : stColor))),
    h('div', { class: 'att-hours' }, h('strong', hm(counted)), t.status === 'absent' && t.minutes ? h('small', `(worked ${hm(t.minutes)}, marked Absent)`) : h('small', `${t.sessions} time${t.sessions === 1 ? '' : 's'} In`),
      t.sched_minutes ? h('small', `Scheduled ${hm(t.sched_minutes)}`) : null, t.is_open ? chip('Still In', 'blue') : null),
    punches?.length ? h('ul', { class: 'att-list' }, punches.map(p => punchRow(p, { onCorrect: actions?.onCorrect }))) : null,
    t.note ? h('p', { class: 'muted small' }, `Review note: ${t.note}`) : null,
    actions?.buttons || null);
}

// ---------------------------------------------------------------- Tab 1: mark In / Out
async function markTab(box) {
  const me = state.me.id;
  const statusEl = h('div', { class: 'att-status' }); const listEl = h('div'); const schedEl = h('div');
  const geo = geoCapture({ label: 'Your location (found automatically)' });
  const photoHolder = h('div'); let photo = null;
  const newPhoto = () => { photo = photoField({ label: 'Your selfie', required: true, cameraOnly: true, facing: 'user' }); mount(photoHolder, photo.el); };
  newPhoto();
  let open = null, today = [];
  const actionBtn = btn('Mark In', { kind: 'primary', ic: 'check', onClick: (e) => submit(e.currentTarget) });
  const paintStatus = () => {
    const tot = today.filter(p => punchDay(p) === istDay()).reduce((a, p) => a + minsOf(p), 0);
    statusEl.replaceChildren(h('div', { class: `att-big ${open ? 'in' : 'out'}` }, h('strong', open ? 'You are In' : 'You are Out'), open ? h('small', `Since ${fmtTime(open.in_at)}, ${hm(minsOf(open))} so far`) : h('small', 'Mark In when you start work.')),
      h('div', { class: 'att-total' }, h('small', 'Worked today'), h('strong', hm(tot))));
    actionBtn.querySelector('span:last-child') ? (actionBtn.querySelector('span:last-child').textContent = open ? 'Mark Out' : 'Mark In') : (actionBtn.textContent = open ? 'Mark Out' : 'Mark In');
  };
  async function load() {
    const start = dayStart(istDay()).toISOString();
    const { data, error } = await sb.from('attendance_punches').select('*').eq('uid', me).or(`out_at.is.null,in_at.gte.${start}`).order('in_at');
    if (error) { mount(listEl, h('p', { class: 'muted' }, friendlyError(error))); return; }
    today = data || []; open = today.find(p => !p.out_at) || null; paintStatus();
    mount(listEl, h('h3', 'Today'), today.length ? h('ul', { class: 'att-list' }, today.map(p => punchRow(p))) : h('p', { class: 'muted small' }, 'No attendance marked today yet.'));
    const { data: sc } = await sb.from('attendance_schedules').select('*').eq('uid', me).gte('day', istDay()).order('day').order('start_time').limit(30);
    mount(schedEl, h('h3', 'My upcoming schedule'), (sc || []).length ? h('ul', { class: 'att-list' }, sc.map(s => h('li', { class: 'att-row' }, h('strong', dayLabel(s.day)), h('span', `${timeText(s.start_time)} – ${timeText(s.end_time)}`), s.note ? h('small', s.note) : null))) : h('p', { class: 'muted small' }, 'Nothing has been scheduled for you yet.'));
  }
  async function submit(el) {
    photo.setError('');
    if (!photo.isFilled()) return photo.setError('Take your selfie first.');
    await busy(el, async () => {
      const pos = await geo.ensure(); if (!pos) return;                 // no location, nothing is saved
      const wasOpen = !!open; const it = photo.picked();
      try {
        const path = await uploadPhoto(photoPath(`attendance/${me}`, wasOpen ? 'out' : 'in', it.type), it.blob);
        await rpc(wasOpen ? 'attendance_out' : 'attendance_in', { p_photo: path, p_lat: Number(pos.geo_lat), p_lng: Number(pos.geo_lng), p_acc: pos.geo_accuracy ? Number(pos.geo_accuracy) : null, p_address: pos.geo_address || null });
        toast(wasOpen ? 'Marked Out' : 'Marked In'); newPhoto(); geo.refresh(); await load();
      } catch (e) { toast(friendlyError(e), 'error'); await load(); }
    });
  }
  mount(box, h('div', { class: 'bento' },
    h('section', { class: 'bento-card span2' }, statusEl),
    h('section', { class: 'bento-card' }, h('h3', 'Mark attendance'), geo.el, photoHolder, h('p', { class: 'muted small' }, 'The time is taken from the server. Your location and selfie are saved with it.'), h('div', { class: 'action-bar' }, actionBtn)),
    h('section', { class: 'bento-card' }, listEl, schedEl)));
  await load();
  const tick = setInterval(() => { if (!statusEl.isConnected) return clearInterval(tick); paintStatus(); }, 30000);
}

// ---------------------------------------------------------------- Tab 2: my days
async function myDaysTab(box) {
  const me = state.me.id; const today = istDay();
  const range = select([{ value: '7', label: 'Last 7 days' }, { value: '14', label: 'Last 14 days' }, { value: '31', label: 'Last 31 days' }], { 'aria-label': 'Period' }); range.value = '14';
  const body = h('div');
  async function load() {
    mount(body, skeletonRows(4));
    try {
      const n = Number(range.value); const from = addDays(today, -(n - 1));
      const [tot, pr] = await Promise.all([rpc('attendance_day_totals', { p_from: from, p_to: today, p_uid: me }),
        sb.from('attendance_punches').select('*').eq('uid', me).gte('in_at', dayStart(addDays(from, -1)).toISOString()).order('in_at').limit(1000)]);
      const byDay = new Map(); for (const p of pr.data || []) { const d = punchDay(p); (byDay.get(d) || byDay.set(d, []).get(d)).push(p); }
      const rows = tot || [];
      const sum = rows.reduce((a, t) => a + (t.counted_minutes || 0), 0);
      mount(body, h('div', { class: 'att-summary' }, h('strong', hm(sum)), h('small', `counted in the last ${n} days (days marked Absent count 0)`)),
        rows.length ? h('div', { class: 'deck' }, rows.map(t => dayCard(t, byDay.get(String(t.day).slice(0, 10)) || []))) : emptyState('No attendance yet', 'Your attendance will show here.'));
    } catch (e) { mount(body, h('p', { class: 'muted' }, friendlyError(e))); }
  }
  range.addEventListener('change', load);
  mount(box, h('div', { class: 'toolbar' }, field('Show', range)), body); await load();
}

// ---------------------------------------------------------------- Tab 3: review (Manager, Admin, Superadmin)
async function reviewTab(box) {
  const st = { day: istDay(), f: 'review' };
  const dayIn = input({ type: 'date', value: st.day, max: istDay(), 'aria-label': 'Day' });
  const body = h('div');
  const FILTERS = [['review', 'Needs review'], ['all', 'Everyone'], ['present', 'Present'], ['absent', 'Absent']];
  const chips = h('div', { class: 'filter-chips', role: 'group' }, FILTERS.map(([v, l]) => h('button', { type: 'button', class: 'fchip', dataset: { v }, 'aria-pressed': String(v === st.f), on: { click: () => { st.f = v; chips.querySelectorAll('.fchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); load(); } } }, l)));
  const setDay = (d) => { st.day = d > istDay() ? istDay() : d; dayIn.value = st.day; load(); };
  dayIn.addEventListener('change', () => dayIn.value && setDay(dayIn.value));

  async function mark(uid, status, note) { await rpc('attendance_review_day', { p_uid: uid, p_day: st.day, p_status: status, p_note: note || null }); }
  function openAbsent(u) {
    const note = textarea({ rows: '3', placeholder: 'Why is this day marked Absent?' }); const f = field('Reason', note, { required: true, hint: 'The worked time stays on record. It is not counted.' });
    const save = btn('Mark Absent', { kind: 'danger', onClick: (e) => { f.setError(''); if (!note.value.trim()) return f.setError('Write a reason.'); busy(e.currentTarget, async () => { try { await mark(u.id, 'absent', note.value.trim()); toast('Marked Absent'); s.close(); load(); } catch (er) { toast(friendlyError(er), 'error'); } }); } });
    const s = openSheet({ title: `Mark ${u.user_name} Absent`, subtitle: dayLabel(st.day), body: h('form', { class: 'stack', novalidate: true, on: { submit: (e) => e.preventDefault() } }, f), footer: [btn('Cancel', { onClick: () => s.close() }), save] });
  }
  function openCorrect(p) {
    const inI = input({ type: 'datetime-local', value: istInput(effIn(p)), max: istInput(new Date()) }); const outI = input({ type: 'datetime-local', value: effOut(p) ? istInput(effOut(p)) : '', max: istInput(new Date()) });
    const note = textarea({ rows: '2', placeholder: 'Why is the timing corrected?' });
    const fIn = field('In time', inI, { required: true }); const fOut = field('Out time', outI, { hint: p.out_at || p.adj_out_at ? '' : 'Leave empty if the person is still working.' }); const fNote = field('Reason for the correction', note, { required: true, hint: 'The original times stay on record.' });
    const save = btn('Save correction', { kind: 'primary', ic: 'check', onClick: (e) => {
      [fIn, fOut, fNote].forEach(x => x.setError('')); if (!inI.value) return fIn.setError('Choose the In time.'); if (!note.value.trim()) return fNote.setError('Write the reason.');
      const ni = fromIstInput(inI.value), no = fromIstInput(outI.value);
      const changedIn = new Date(ni).getTime() !== new Date(effIn(p)).getTime(); const changedOut = no && (!effOut(p) || new Date(no).getTime() !== new Date(effOut(p)).getTime());
      if (!changedIn && !changedOut) return fNote.setError('Change at least one time.');
      if (no && new Date(no) < new Date(ni)) return fOut.setError('The Out time must be after the In time.');
      busy(e.currentTarget, async () => { try { await rpc('attendance_adjust', { p_punch: p.id, p_in: changedIn ? ni : null, p_out: changedOut ? no : null, p_note: note.value.trim() }); toast('Timing corrected'); s.close(); load(); } catch (er) { toast(friendlyError(er), 'error'); } }); } });
    const s = openSheet({ title: `Correct timings: ${nm(p.uid)}`, subtitle: `Original: ${fmtTime(p.in_at)} – ${p.out_at ? fmtTime(p.out_at) : 'no Out'}`, body: h('form', { class: 'stack', novalidate: true, on: { submit: (e) => e.preventDefault() } }, fIn, fOut, fNote), footer: [btn('Cancel', { onClick: () => s.close() }), save] });
  }

  async function load() {
    mount(body, skeletonRows(4));
    try {
      const [tot, pr, sc] = await Promise.all([rpc('attendance_day_totals', { p_from: st.day, p_to: st.day, p_uid: null }),
        sb.from('attendance_punches').select('*').gte('in_at', dayStart(addDays(st.day, -1)).toISOString()).lt('in_at', dayStart(addDays(st.day, 2)).toISOString()).order('in_at').limit(3000),
        sb.from('attendance_schedules').select('*').eq('day', st.day).order('start_time')]);
      const tm = new Map((tot || []).map(t => [t.uid, t])); const byU = new Map();
      for (const p of pr.data || []) if (punchDay(p) === st.day) (byU.get(p.uid) || byU.set(p.uid, []).get(p.uid)).push(p);
      const scU = new Map(); for (const s of sc.data || []) (scU.get(s.uid) || scU.set(s.uid, []).get(s.uid)).push(s);
      const people = (state.profiles || []).filter(u => u.active || tm.has(u.id));
      const cards = []; let pendingN = 0; const toAck = [];
      for (const u of people) {
        const t = tm.get(u.id) || { uid: u.id, day: st.day, sessions: 0, minutes: 0, counted_minutes: 0, status: 'pending', sched_minutes: 0 };
        const ps = byU.get(u.id) || []; const worked = ps.length > 0; const slots = scU.get(u.id) || [];
        if (!worked && !slots.length && t.status === 'pending') { if (st.f !== 'all') continue; }
        if (st.f === 'review' && !(worked && t.status === 'pending') && !(slots.length && !worked && t.status === 'pending')) continue;
        if (st.f === 'present' && t.status !== 'present') continue;
        if (st.f === 'absent' && t.status !== 'absent') continue;
        if (worked && t.status === 'pending') { pendingN++; toAck.push(u.id); }
        const buttons = h('div', { class: 'action-bar' }, btn('Present', { small: true, kind: t.status === 'present' ? undefined : 'primary', ic: 'check', onClick: (e) => busy(e.currentTarget, async () => { try { await mark(u.id, 'present'); toast('Marked Present'); load(); } catch (er) { toast(friendlyError(er), 'error'); } }) }), btn('Absent', { small: true, onClick: () => openAbsent(u) }));
        const card = dayCard(t, ps, { title: u.user_name, actions: { onCorrect: openCorrect, buttons } });
        card.querySelector('.card-top strong').after(h('small', { class: 'muted' }, ` ${u.user_id || ''}`));
        if (slots.length) card.querySelector('.att-hours').after(h('p', { class: 'muted small' }, `Scheduled: ${slots.map(s => `${timeText(s.start_time)}–${timeText(s.end_time)}`).join(', ')}${worked ? '' : '. Not marked In'}`));
        cards.push(card);
      }
      const ackAll = pendingN > 1 ? btn(`Mark all ${pendingN} Present`, { ic: 'check', onClick: () => confirmDialog({ title: `Mark ${pendingN} people Present?`, message: `Everyone waiting for review on ${dayLabel(st.day)} is marked Present with the times shown. You can still correct or mark Absent afterwards.`, confirmLabel: 'Mark Present' }).then(async (r) => { if (!r) return; try { for (const id of toAck) await mark(id, 'present'); toast('Done'); } catch (er) { toast(friendlyError(er), 'error'); } load(); }) }) : null;
      mount(body, ackAll ? h('div', { class: 'action-bar' }, ackAll) : null, cards.length ? h('div', { class: 'deck' }, cards) : emptyState('Nothing to show', st.f === 'review' ? 'No attendance is waiting for review on this day.' : 'No one matches this filter.'));
    } catch (e) { mount(body, h('p', { class: 'muted' }, friendlyError(e))); }
  }
  mount(box, h('div', { class: 'toolbar' }, btn('Previous day', { small: true, onClick: () => setDay(addDays(st.day, -1)) }), dayIn, btn('Next day', { small: true, onClick: () => setDay(addDays(st.day, 1)) }), chips), body);
  await load();
}

// ---------------------------------------------------------------- Tab 4: summary (Manager, Admin, Superadmin)
async function summaryTab(box) {
  const today = istDay(); const from = input({ type: 'date', value: `${today.slice(0, 8)}01`, 'aria-label': 'From' }); const to = input({ type: 'date', value: today, max: today, 'aria-label': 'To' }); const body = h('div');
  const table = dataTable({ rowKey: 'uid', storageKey: 'att-summary', defaultSort: { key: 'name', dir: 'asc' }, empty: 'No attendance in this period.', columns: [
    { key: 'name', label: 'Person', sort: (r) => r.name.toLowerCase(), render: (r) => h('strong', r.name), csv: (r) => r.name },
    { key: 'present', label: 'Days present', sort: (r) => r.present, render: (r) => String(r.present), csv: (r) => r.present },
    { key: 'absent', label: 'Days absent', sort: (r) => r.absent, render: (r) => String(r.absent), csv: (r) => r.absent },
    { key: 'pending', label: 'Waiting for review', sort: (r) => r.pending, render: (r) => String(r.pending), csv: (r) => r.pending },
    { key: 'counted', label: 'Hours counted', sort: (r) => r.counted, render: (r) => hm(r.counted), csv: (r) => (r.counted / 60).toFixed(2) },
    { key: 'worked', label: 'Hours worked (all)', sort: (r) => r.worked, render: (r) => hm(r.worked), csv: (r) => (r.worked / 60).toFixed(2) },
    { key: 'sched', label: 'Hours scheduled', sort: (r) => r.sched, render: (r) => hm(r.sched), csv: (r) => (r.sched / 60).toFixed(2) },
  ] });
  async function load() {
    if (!from.value || !to.value) return; mount(body, skeletonRows(4));
    try {
      const tot = await rpc('attendance_day_totals', { p_from: from.value, p_to: to.value, p_uid: null });
      const m = new Map();
      for (const t of tot || []) { const r = m.get(t.uid) || { uid: t.uid, name: t.user_name, present: 0, absent: 0, pending: 0, counted: 0, worked: 0, sched: 0 };
        if (t.status === 'present') r.present++; else if (t.status === 'absent') r.absent++; else if (t.minutes > 0) r.pending++;
        r.counted += t.counted_minutes || 0; r.worked += t.minutes || 0; r.sched += t.sched_minutes || 0; m.set(t.uid, r); }
      table.setRows([...m.values()]); mount(body, table.el);
    } catch (e) { mount(body, h('p', { class: 'muted' }, friendlyError(e))); }
  }
  from.addEventListener('change', load); to.addEventListener('change', load);
  mount(box, h('div', { class: 'toolbar' }, field('From', from), field('To', to), btn('Download as CSV', { ic: 'download', onClick: () => table.download('attendance-summary') })), body); await load();
}

// ---------------------------------------------------------------- Tab 5: schedules (Manager, Admin, Superadmin)
async function scheduleTab(box) {
  const today = istDay(); const people = (state.profiles || []).filter(u => u.active);
  const checks = people.map(u => ({ u, el: h('input', { type: 'checkbox', value: u.id, 'aria-label': u.user_name }) }));
  const peopleBox = h('div', { class: 'att-people' }, checks.map(c => h('label', { class: 'att-person' }, c.el, h('span', `${c.u.user_name} (${c.u.user_id || ''})`))));
  const all = h('input', { type: 'checkbox', 'aria-label': 'Select everyone' }); all.addEventListener('change', () => checks.forEach(c => { c.el.checked = all.checked; }));
  const from = input({ type: 'date', value: today, min: today }); const to = input({ type: 'date', value: today, min: today });
  const start = input({ type: 'time', value: '09:00' }); const end = input({ type: 'time', value: '17:00' }); const note = input({ placeholder: 'Optional note, e.g. Counter duty' });
  const fPeople = field('People', h('div', null, h('label', { class: 'att-person' }, all, h('span', 'Everyone')), peopleBox), { required: true });
  const fFrom = field('From date', from, { required: true }); const fTo = field('To date', to, { required: true }); const fStart = field('Start time', start, { required: true }); const fEnd = field('End time', end, { required: true });
  const list = h('div');
  const add = btn('Allot schedule', { kind: 'primary', ic: 'check', onClick: (e) => {
    [fPeople, fFrom, fTo, fStart, fEnd].forEach(x => x.setError(''));
    const uids = checks.filter(c => c.el.checked).map(c => c.u.id);
    if (!uids.length) return fPeople.setError('Choose at least one person.'); if (!from.value || !to.value || to.value < from.value) return fTo.setError('Choose a valid date range.');
    if (from.value < istDay()) return fFrom.setError('Today or a future day only.'); if (!start.value || !end.value || end.value <= start.value) return fEnd.setError('The end time must be after the start time.');
    busy(e.currentTarget, async () => { try { const n = await rpc('attendance_set_schedule', { p_uids: uids, p_from: from.value, p_to: to.value, p_start: `${start.value}:00`, p_end: `${end.value}:00`, p_note: note.value.trim() || null });
      toast(n ? `${n} schedule${n === 1 ? '' : 's'} added` : 'Nothing added: those times are already scheduled'); loadList(); } catch (er) { toast(friendlyError(er), 'error'); } }); } });
  async function loadList() {
    mount(list, skeletonRows(3));
    const { data, error } = await sb.from('attendance_schedules').select('*').gte('day', istDay()).lte('day', addDays(istDay(), 30)).order('day').order('start_time').limit(1500);
    if (error) return mount(list, h('p', { class: 'muted' }, friendlyError(error)));
    const byDay = new Map(); for (const s of data || []) (byDay.get(s.day) || byDay.set(s.day, []).get(s.day)).push(s);
    mount(list, h('h3', 'Allotted for the next 30 days'), byDay.size ? h('div', { class: 'deck' }, [...byDay].map(([d, ss]) => h('article', { class: 'card-item' }, h('strong', dayLabel(d)),
      h('ul', { class: 'att-list' }, ss.map(s => h('li', { class: 'att-row' }, h('strong', nm(s.uid)), h('span', `${timeText(s.start_time)} – ${timeText(s.end_time)}`), s.note ? h('small', s.note) : null,
        btn('Remove', { small: true, onClick: () => confirmDialog({ title: 'Remove this schedule?', message: `${nm(s.uid)}, ${dayLabel(d)}, ${timeText(s.start_time)} – ${timeText(s.end_time)}`, confirmLabel: 'Remove', danger: true }).then(async (r) => { if (!r) return; try { await rpc('attendance_remove_schedule', { p_id: s.id }); toast('Removed'); loadList(); } catch (er) { toast(friendlyError(er), 'error'); } }) }))))))) : h('p', { class: 'muted small' }, 'Nothing is allotted yet.'));
  }
  mount(box, h('div', { class: 'bento' }, h('section', { class: 'bento-card' }, h('h3', 'Allot a schedule'), h('p', { class: 'muted small' }, 'For today and future days. Add the same person again with other times for a split day, for example 6 to 8 and 10 to 5.'),
    h('form', { class: 'stack', novalidate: true, on: { submit: (e) => e.preventDefault() } }, fPeople, h('div', { class: 'grid2' }, fFrom, fTo), h('div', { class: 'grid2' }, fStart, fEnd), field('Note', note), h('div', { class: 'action-bar' }, add))),
    h('section', { class: 'bento-card' }, list)));
  await loadList();
}

// ---------------------------------------------------------------- Tab 6: map
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    document.head.append(h('link', { rel: 'stylesheet', href: 'assets/js/vendor/leaflet/leaflet.css' }));
    const sc = document.createElement('script'); sc.src = 'assets/js/vendor/leaflet/leaflet.js';
    sc.onload = () => res(window.L); sc.onerror = () => { leafletP = null; rej(new Error('The map could not load. Check your internet connection.')); };
    document.head.append(sc);
  });
  return leafletP;
}
async function mapTab(box) {
  const today = istDay(); const mgr = can.manager();
  const from = input({ type: 'date', value: today, max: today }); const to = input({ type: 'date', value: today, max: today });
  const who = mgr ? select([{ value: '', label: 'Everyone' }, ...(state.profiles || []).map(u => ({ value: u.id, label: `${u.user_name} (${u.user_id || ''})` }))], { 'aria-label': 'Person' }) : null;
  const mapEl = h('div', { class: 'att-map', role: 'application', 'aria-label': 'Map of attendance locations' }); const legend = h('div', { class: 'att-legend' }); const list = h('div');
  let map = null, layer = null;
  async function load() {
    if (!from.value || !to.value || to.value < from.value) return;
    mount(list, skeletonRows(3));
    let q = sb.from('attendance_punches').select('*').gte('in_at', dayStart(from.value).toISOString()).lt('in_at', dayStart(addDays(to.value, 1)).toISOString()).order('in_at').limit(1500);
    q = mgr ? (who.value ? q.eq('uid', who.value) : q) : q.eq('uid', state.me.id);
    const { data, error } = await q;
    if (error) return mount(list, h('p', { class: 'muted' }, friendlyError(error)));
    const rows = data || []; const uids = [...new Set(rows.map(p => p.uid))]; const color = (id) => PALETTE[uids.indexOf(id) % PALETTE.length];
    mount(legend, uids.map(id => h('span', { class: 'att-key' }, h('i', { style: `background:${color(id)}` }), nm(id))), h('span', { class: 'att-key' }, h('i', { class: 'ring' }), 'ring = Out'));
    mount(list, rows.length ? h('div', { class: 'deck' }, rows.slice().reverse().map(p => h('article', { class: 'card-item' }, h('div', { class: 'card-top' }, h('strong', nm(p.uid)), h('small', { class: 'muted' }, dayLabel(punchDay(p)))), punchRow(p)))) : emptyState('No attendance in this period', 'Nothing was marked on these days.'));
    try {
      const L = await loadLeaflet();
      if (map) map.remove(); mapEl.replaceChildren();
      map = L.map(mapEl, { zoomControl: true }).setView([20.59, 78.96], 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      layer = L.featureGroup().addTo(map);
      const pop = (p, kind, t, addr, path) => { const d = h('div', { class: 'att-pop' }, h('strong', nm(p.uid)), h('div', `${kind} ${fmtTime(t)}, ${dayLabel(istDay(t))}`), addr ? h('div', addr) : null, path ? btn('View selfie', { small: true, onClick: () => signedUrls([path]).then(m => m[path] && lightbox(m[path], `${nm(p.uid)}, ${kind} selfie`)) }) : null); return d; };
      for (const p of rows) {
        const c = color(p.uid);
        L.circleMarker([p.in_lat, p.in_lng], { radius: 9, color: c, weight: 2, fillColor: c, fillOpacity: 0.85 }).bindPopup(pop(p, 'In', effIn(p), p.in_address, p.in_photo)).addTo(layer);
        if (p.out_lat != null) {
          L.circleMarker([p.out_lat, p.out_lng], { radius: 9, color: c, weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindPopup(pop(p, 'Out', effOut(p), p.out_address, p.out_photo)).addTo(layer);
          L.polyline([[p.in_lat, p.in_lng], [p.out_lat, p.out_lng]], { color: c, weight: 2, dashArray: '4 6', opacity: 0.7 }).addTo(layer);
        }
      }
      map.invalidateSize(); if (rows.length) map.fitBounds(layer.getBounds().pad(0.2), { maxZoom: 17 });
    } catch (e) { mapEl.replaceChildren(h('p', { class: 'muted pad' }, friendlyError(e))); }
  }
  [from, to, who].filter(Boolean).forEach(x => x.addEventListener('change', load));
  mount(box, h('div', { class: 'toolbar' }, field('From', from), field('To', to), who ? field('Person', who) : null), legend, mapEl, list);
  await load();
}

// ---------------------------------------------------------------- page
export async function render(root, params = {}) {
  const mgr = can.manager();
  const TABS = [['mark', 'Mark In / Out', markTab], ['days', 'My days', myDaysTab], ...(mgr ? [['review', 'Review', reviewTab], ['summary', 'Summary', summaryTab], ['schedule', 'Schedules', scheduleTab]] : []), ['map', 'Map', mapTab]];
  let cur = TABS.some(t => t[0] === params.tab) ? params.tab : 'mark';
  const box = h('div', { class: 'att-body' });
  const chips = h('div', { class: 'filter-chips', role: 'tablist', 'aria-label': 'Attendance' }, TABS.map(([v, l]) => h('button', { type: 'button', role: 'tab', class: 'fchip', dataset: { v }, 'aria-pressed': String(v === cur), 'aria-selected': String(v === cur), on: { click: () => { cur = v; chips.querySelectorAll('.fchip').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.v === cur)); b.setAttribute('aria-selected', String(b.dataset.v === cur)); }); show(); } } }, l)));
  async function show() { mount(box, skeletonRows(3)); try { await TABS.find(t => t[0] === cur)[2](box); } catch (e) { mount(box, h('div', { class: 'empty' }, h('h3', 'This could not load'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: show }))); } }
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', 'Attendance'), h('p', { class: 'muted' }, 'Mark In and Out with your selfie and location. You can mark several times a day.'))), chips, box);
  await show();
}
