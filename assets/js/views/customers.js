import { h, icon, btn, busy, chip, statusBadge, field, input, textarea, segmented, sectionBlock, openSheet, confirmDialog,
  toast, mount, emptyState, skeletonRows, debounce, fmtDateTimeY, fmtDateTime, fmtPhone, friendlyError, STATUS_LABEL } from '../core/ui.js';
import { sb } from '../core/supa.js';
import { state, can, whoName } from '../core/store.js';
import { photoField, multiPhotoField, photoPath, uploadPhoto, signedUrls, lightbox } from '../core/images.js';
import { phoneField } from '../core/phone.js';

const PAGE = 40;
const LIST_COLS = 'id,created_at,created_by,name,mobile,customer_type,nationality,status';

export async function render(root, params) {
  const st = { status: ['pending', 'active', 'blocked'].includes(params.status) ? params.status : 'all', q: '', items: [], total: 0, loading: false, loaded: false };
  const list = h('div', { class: 'rows', role: 'list' });
  const moreWrap = h('div', { class: 'more-wrap' });
  const countEl = h('p', { class: 'result-count', 'aria-live': 'polite' });

  const search = input({ type: 'search', placeholder: 'Search by name or mobile number', 'aria-label': 'Search customers', enterkeyhint: 'search' });
  const chips = h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Filter by status' },
    [['all', 'All'], ['pending', 'Pending'], ['active', 'Active'], ['blocked', 'Blocked']].map(([v, l]) =>
      h('button', { type: 'button', class: 'fchip', dataset: { v }, 'aria-pressed': String(st.status === v), on: { click: () => { st.status = v; paintChips(); load(true); } } }, l)));
  const paintChips = () => chips.querySelectorAll('.fchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.status)));

  async function load(reset) {
    if (st.loading) return;
    st.loading = true;
    if (reset) { st.items = []; mount(list, skeletonRows(6)); moreWrap.replaceChildren(); }
    try {
      let q = sb.from('customers').select(LIST_COLS, { count: 'exact' })
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(st.items.length, st.items.length + PAGE - 1);
      if (st.status !== 'all') q = q.eq('status', st.status);
      const term = st.q.replace(/[,()%*\\]/g, ' ').trim();
      if (term) {
        const digits = term.replace(/[\s()-]/g, '');
        q = /^\+?\d{3,}$/.test(digits) ? q.ilike('mobile', `%${digits}%`) : q.ilike('name', `%${term}%`);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      st.items.push(...data); st.total = count ?? st.items.length; st.loaded = true;
    } catch (e) { mount(list, h('div', { class: 'empty' }, h('h3', 'Could not load customers'), h('p', friendlyError(e)), btn('Try again', { kind: 'primary', onClick: () => { st.loading = false; load(true); } }))); st.loading = false; return; }
    st.loading = false; paintList();
  }

  function paintList() {
    countEl.textContent = st.total ? `${st.total} customer${st.total === 1 ? '' : 's'}` : '';
    if (!st.items.length) {
      mount(list, st.q || st.status !== 'all'
        ? emptyState('No customers match', 'Try a different name, number or status.')
        : emptyState('No customers yet', 'Add the first customer. New customers wait for an approver before they can rent.', btn('New customer', { kind: 'primary', ic: 'plus', onClick: () => openForm() })));
      moreWrap.replaceChildren(); return;
    }
    mount(list, h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', 'Customer'), h('span', 'Mobile'), h('span', 'Status'), h('span', 'Added by'), h('span', 'Added on')),
      st.items.map(c => h('a', { class: 'row', role: 'listitem', href: `#/customers?open=${c.id}`, on: { click: (e) => { e.preventDefault(); openDetail(c.id); } } },
        h('span', { class: 'cell cell-main' }, h('strong', c.name), c.customer_type === 'foreign' ? chip(c.nationality ? `Foreign, ${c.nationality}` : 'Foreign', 'aqua') : null),
        h('span', { class: 'cell cell-mono' }, fmtPhone(c.mobile)),
        h('span', { class: 'cell' }, statusBadge(c.status)),
        h('span', { class: 'cell cell-sub' }, whoName(c.created_by)),
        h('span', { class: 'cell cell-sub' }, fmtDateTime(c.created_at)),
        icon('right', 16, 'row-go'))));
    moreWrap.replaceChildren(st.items.length < st.total ? btn(`Show more (${st.total - st.items.length} left)`, { onClick: (e) => busy(e.currentTarget, () => load(false)) }) : '');
  }

  search.addEventListener('input', debounce(() => { st.q = search.value; load(true); }, 300));
  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', 'Customers'), h('p', { class: 'muted' }, 'Add, approve and block customers.')),
      h('div', { class: 'page-actions' }, btn('New customer', { kind: 'primary', ic: 'plus', onClick: () => openForm() }))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), chips), countEl, list, moreWrap);

  const refresh = () => load(true);
  if (params.__headless) { openForm(); return; }
  await load(true);
  if (params.new) openForm();
  if (params.open) openDetail(Number(params.open));

  // ---------------------------------------------------------------- detail
  async function openDetail(id) {
    const s = openSheet({ title: 'Customer', body: skeletonRows(4), wide: true });
    let c;
    try {
      const { data, error } = await sb.from('customers').select('*').eq('id', id).maybeSingle();
      if (error) throw error; if (!data) throw new Error('This customer no longer exists.'); c = data;
    } catch (e) { mount(s.body, emptyState('Could not open this customer', friendlyError(e))); return; }
    paintDetail(s, c);
  }

  function paintDetail(s, c) {
    const isOwn = c.created_by === state.me.id;
    const canEdit = c.status === 'pending' ? (isOwn || can.approve()) : can.manager();
    const canApprove = c.status === 'pending' && can.approve() && (!isOwn || can.superadmin());
    s.panel.querySelector('.sheet-titles h2').textContent = c.name;
    const kv = (k, v) => v ? h('div', { class: 'kv' }, h('dt', k), h('dd', v)) : null;
    const photos = [
      ['customer_image', 'Customer photo'], ['dl_image1', 'Driving licence, front'], ['dl_image2', 'Driving licence, back'],
      ...(c.customer_type === 'foreign' ? [['passport_image', 'Passport'], ['visa_image', 'Visa']] : [['aadhar_photo1', 'Aadhaar, front'], ['aadhar_photo2', 'Aadhaar, back'], ['aadhar_otp_proof', 'Aadhaar OTP proof']]),
      ['mobile_verification', 'Mobile verification'], ['emergency_verification1', 'Emergency contact 1 proof'], ['emergency_verification2', 'Emergency contact 2 proof'],
      ...(c.additional_proofs || []).map((p, i) => ['__extra' + i, `Additional proof ${i + 1}`, p]),
    ].map(([k, label, path]) => ({ label, path: path || c[k] })).filter(p => p.path);
    const grid = h('div', { class: 'photo-grid-view' }, photos.map(p => h('div', { class: 'thumb loading', dataset: { path: p.path } }, h('span', { class: 'thumb-label' }, p.label))));
    signedUrls(photos.map(p => p.path)).then(map => {
      grid.querySelectorAll('.thumb').forEach((el, i) => { const url = map[photos[i].path]; el.classList.remove('loading');
        if (url) { el.prepend(h('img', { src: url, alt: photos[i].label, loading: 'lazy' })); el.addEventListener('click', () => lightbox(url, photos[i].label)); el.tabIndex = 0; el.addEventListener('keydown', e => { if (e.key === 'Enter') lightbox(url, photos[i].label); }); }
        else el.classList.add('failed'); });
    }).catch(() => grid.querySelectorAll('.thumb').forEach(el => { el.classList.remove('loading'); el.classList.add('failed'); }));

    const history = [`Added by ${whoName(c.created_by)} on ${fmtDateTimeY(c.created_at)}`,
      c.approved_by ? `Approved by ${whoName(c.approved_by)} on ${fmtDateTimeY(c.approved_at)}` : null,
      c.status_changed_by ? `${c.status === 'blocked' ? 'Blocked' : 'Last unblocked'} by ${whoName(c.status_changed_by)} on ${fmtDateTimeY(c.status_changed_at)}` : null].filter(Boolean);

    const note = c.status === 'pending' && can.approve() && isOwn && !can.superadmin()
      ? h('div', { class: 'callout' }, icon('info', 18), h('span', 'You added this customer, so another approver has to approve it.')) : null;

    mount(s.body,
      h('div', { class: 'detail-top' }, statusBadge(c.status), chip(c.customer_type === 'foreign' ? 'Foreign customer' : 'Indian customer', 'aqua'),
        h('a', { class: 'tel', href: `tel:${c.mobile}` }, fmtPhone(c.mobile))),
      note,
      sectionBlock('Details', h('dl', { class: 'kvs' },
        kv('Mobile', fmtPhone(c.mobile)), kv('Second mobile', fmtPhone(c.mobile2)), kv('Nationality', c.nationality),
        kv('Permanent address', c.permanent_address),
        kv('Emergency contact 1', [c.emergency_name, c.emergency_relation1 && `(${c.emergency_relation1})`, fmtPhone(c.emergency_number1)].filter(Boolean).join(' ')),
        kv('Emergency contact 2', [c.emergency_name2, c.emergency_relation2 && `(${c.emergency_relation2})`, fmtPhone(c.emergency_number2)].filter(Boolean).join(' ')),
        c.remarks ? h('div', { class: 'kv' }, h('dt', 'Remarks'), h('dd', { class: 'prewrap' }, c.remarks)) : null)),
      sectionBlock('Photos and documents', photos.length ? grid : h('p', { class: 'muted' }, 'No photos saved.')),
      sectionBlock('History', h('ul', { class: 'history' }, history.map(t => h('li', t)))));

    const foot = [];
    if (canEdit) foot.push(btn('Edit', { ic: 'edit', onClick: () => { s.close(); openForm(c); } }));
    if (can.manager() && c.status !== 'blocked') foot.push(btn('Block', { ic: 'ban', cls: 'btn-outline-danger', onClick: () => changeStatus(s, c, 'blocked') }));
    if (can.manager() && c.status === 'blocked') foot.push(btn('Unblock', { ic: 'undo', onClick: () => changeStatus(s, c, 'active') }));
    if (canApprove) foot.push(btn('Approve customer', { kind: 'primary', ic: 'check', onClick: () => changeStatus(s, c, 'active') }));
    if (!s.foot && foot.length) { const f = h('div', { class: 'sheet-foot' }, foot); s.panel.append(f); s.foot = f; }
    else if (s.foot) mount(s.foot, foot);
  }

  async function changeStatus(s, c, to) {
    const approving = c.status === 'pending' && to === 'active';
    const r = await confirmDialog({
      title: approving ? `Approve ${c.name}?` : to === 'blocked' ? `Block ${c.name}?` : `Unblock ${c.name}?`,
      message: approving ? 'Check the photos and details first. Once approved, this customer can rent vehicles.' : to === 'blocked' ? 'A blocked customer cannot rent until a Manager unblocks them.' : 'This customer will be able to rent again.',
      confirmLabel: approving ? 'Approve' : to === 'blocked' ? 'Block customer' : 'Unblock', danger: to === 'blocked',
      reason: approving ? null : { label: to === 'blocked' ? 'Reason for blocking' : 'Note (optional)', required: to === 'blocked', placeholder: to === 'blocked' ? 'For example: licence found to be fake' : '' },
    });
    if (!r) return;
    const patch = { status: to };
    if (r.text) { const line = `${fmtDateTimeY(new Date())}, ${state.me.user_name}: ${to === 'blocked' ? 'Blocked' : 'Unblocked'}. ${r.text}`; patch.remarks = c.remarks ? `${c.remarks}\n${line}` : line; }
    try {
      const { data, error } = await sb.from('customers').update(patch).eq('id', c.id).select('*').single();
      if (error) throw error;
      toast(approving ? 'Customer approved' : to === 'blocked' ? 'Customer blocked' : 'Customer unblocked');
      paintDetail(s, data); refresh();
    } catch (e) { toast(friendlyError(e), 'error'); }
  }

  // ------------------------------------------------------------------ form
  function openForm(existing = null) {
    const e = existing || {};
    const editing = !!existing;
    const F = {};                       // key -> { el, validate(), focus() }
    const reg = (key, comp) => { F[key] = comp; return comp.el; };
    const text = (key, label, o = {}) => {
      const i = input({ value: e[key] ?? '', ...(o.attrs || {}) });
      const f = field(label, i, { required: o.required, hint: o.hint });
      const comp = reg(key, { el: f, get: () => i.value.trim(), focus: () => i.focus(),
        validate: () => { const bad = o.required && !i.value.trim(); f.setError(bad ? (o.msg || 'This is required.') : ''); return !bad; } });
      i.addEventListener('input', () => { if (f.classList.contains('has-error')) F[key].validate(); });
      return f;
    };
    const area = (key, label, o = {}) => {
      const t = textarea({ value: e[key] ?? '', rows: o.rows || '3' });
      const f = field(label, t, { required: o.required, hint: o.hint });
      reg(key, { el: f, get: () => t.value.trim(), focus: () => t.focus(),
        validate: () => { const bad = o.required && !t.value.trim(); f.setError(bad ? 'This is required.' : ''); return !bad; } });
      t.addEventListener('input', () => { if (f.classList.contains('has-error')) F[key].validate(); });
      return f;
    };
    const phone = (key, label, o = {}) => { const p = phoneField(label, { required: o.required, value: e[key] || '', hint: o.hint }); reg(key, p); return p.el; };
    const photos = {};
    const photo = (key, label, required) => { const p = photoField({ label, required, existing: e[key] || null }); photos[key] = { p, required }; return p.el; };

    let type = e.customer_type || 'indian';
    const typeSeg = segmented([{ value: 'indian', label: 'Indian' }, { value: 'foreign', label: 'Foreign' }], type, v => { type = v; paintType(); });
    const indianDocs = sectionBlock('Aadhaar', h('div', { class: 'photo-grid' }, photo('aadhar_photo1', 'Aadhaar, front', true), photo('aadhar_photo2', 'Aadhaar, back', true), photo('aadhar_otp_proof', 'Aadhaar OTP proof', true)));
    const foreignDocs = sectionBlock('Passport and visa', h('div', { class: 'photo-grid' }, photo('passport_image', 'Passport', true), photo('visa_image', 'Visa', true)));
    const nationality = text('nationality', 'Nationality', { required: true, attrs: { placeholder: 'For example British' } });
    const paintType = () => { indianDocs.hidden = type !== 'indian'; foreignDocs.hidden = type !== 'foreign'; nationality.hidden = type !== 'foreign'; };

    const extra = multiPhotoField({ label: 'Additional proofs', max: 5, existing: e.additional_proofs || [] });
    const form = h('form', { class: 'form', novalidate: true, id: 'cust-form', on: { submit: (ev) => { ev.preventDefault(); save(); } } },
      sectionBlock('Customer', h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Customer type'), typeSeg),
        h('div', { class: 'grid-2' }, text('name', 'Full name', { required: true }), phone('mobile', 'Mobile number', { required: true, hint: 'This is the customer key. It cannot be used twice.' })),
        h('div', { class: 'grid-2' }, phone('mobile2', 'Second mobile number'), nationality),
        area('permanent_address', 'Permanent address', { required: true })),
      sectionBlock('Driving licence and mobile proof', h('div', { class: 'photo-grid' }, photo('dl_image1', 'Driving licence, front', true), photo('dl_image2', 'Driving licence, back', true), photo('mobile_verification', 'Mobile verification', true))),
      indianDocs, foreignDocs,
      sectionBlock('Emergency contact 1', h('div', { class: 'grid-2' }, text('emergency_name', 'Name', { required: true }), text('emergency_relation1', 'Relation', { required: true, attrs: { placeholder: 'For example Father' } })),
        phone('emergency_number1', 'Mobile number', { required: true }), h('div', { class: 'photo-grid one' }, photo('emergency_verification1', 'Verification photo', true))),
      sectionBlock('Emergency contact 2 (optional)', h('div', { class: 'grid-2' }, text('emergency_name2', 'Name'), text('emergency_relation2', 'Relation')),
        phone('emergency_number2', 'Mobile number'), h('div', { class: 'photo-grid one' }, photo('emergency_verification2', 'Verification photo', false))),
      sectionBlock('Photos', h('div', { class: 'photo-grid one' }, photo('customer_image', 'Customer photo', true)), extra.el),
      sectionBlock('Remarks', area('remarks', 'Anything the next person should know', { rows: '2' })));
    paintType();

    const submit = btn(editing ? 'Save changes' : 'Save customer', { kind: 'primary', type: 'submit' }); submit.setAttribute('form', 'cust-form');
    const s = openSheet({ title: editing ? 'Edit customer' : 'New customer', subtitle: editing ? e.name : 'New customers wait for an approver.', body: form, footer: [btn('Cancel', { onClick: () => s.close() }), submit], wide: true });

    function validate() {
      let first = null; const bad = (el) => { first = first || el; };
      const checkText = ['name', 'permanent_address', 'emergency_name', 'emergency_relation1'];
      for (const k of checkText) if (!F[k].validate()) bad(F[k].el);
      if (type === 'foreign' && !F.nationality.validate()) bad(F.nationality.el);
      for (const k of ['mobile', 'emergency_number1']) if (!F[k].validate()) bad(F[k].el);
      for (const k of ['mobile2', 'emergency_number2']) if (!F[k].validate()) bad(F[k].el);
      const any2 = ['emergency_name2', 'emergency_relation2'].some(k => F[k].get()) || F.emergency_number2.raw();
      if (any2) { if (!F.emergency_name2.get()) { F.emergency_name2.el.setError('Add the name for contact 2.'); bad(F.emergency_name2.el); } else F.emergency_name2.el.setError('');
        if (!F.emergency_relation2.get()) { F.emergency_relation2.el.setError('Add the relation for contact 2.'); bad(F.emergency_relation2.el); } else F.emergency_relation2.el.setError('');
        if (!F.emergency_number2.raw()) { F.emergency_number2.setError('Add the mobile number for contact 2.'); bad(F.emergency_number2.el); } }
      const needed = ['dl_image1', 'dl_image2', 'mobile_verification', 'customer_image', 'emergency_verification1', ...(type === 'indian' ? ['aadhar_photo1', 'aadhar_photo2', 'aadhar_otp_proof'] : ['passport_image', 'visa_image'])];
      for (const k of needed) { const p = photos[k].p; if (!p.isFilled()) { p.setError('Add this photo.'); bad(p.el); } else p.setError(''); }
      return first;
    }

    async function save() {
      const firstBad = validate();
      if (firstBad) { firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast('Please fix the highlighted fields.', 'error'); return; }
      await busy(submit, async () => {
        const label = submit.querySelector('span'); const idle = label.textContent;
        try {
          const mobile = F.mobile.get();
          const dup = await sb.from('customers').select('id,name,status').eq('mobile', mobile).maybeSingle();
          if (dup.error) throw dup.error;
          if (dup.data && dup.data.id !== e.id) { F.mobile.setError(`Already registered: ${dup.data.name} (${STATUS_LABEL[dup.data.status]}).`); F.mobile.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

          const folder = `customers/${mobile.replace(/\D/g, '')}`;
          const jobs = [];
          for (const [k, { p }] of Object.entries(photos)) { const pk = p.picked(); if (pk) jobs.push({ k, blob: pk.blob, type: pk.type }); }
          const extraNew = extra.newItems();
          extraNew.forEach((it, i) => jobs.push({ k: '__extra', i, blob: it.blob, type: it.type }));
          const paths = {}; const extraPaths = [];
          for (let n = 0; n < jobs.length; n++) {
            label.textContent = `Uploading photo ${n + 1} of ${jobs.length}`;
            const j = jobs[n]; const path = photoPath(folder, j.k === '__extra' ? 'extra' : j.k, j.type);
            await uploadPhoto(path, j.blob);
            if (j.k === '__extra') extraPaths.push(path); else paths[j.k] = path;
          }
          label.textContent = 'Saving';
          const photoVal = (k) => (paths[k] ?? photos[k].p.keptPath()) || null;
          const row = {
            name: F.name.get(), permanent_address: F.permanent_address.get(), mobile, mobile2: F.mobile2.get() || null,
            customer_type: type, nationality: type === 'foreign' ? F.nationality.get() : null,
            dl_image1: photoVal('dl_image1'), dl_image2: photoVal('dl_image2'), mobile_verification: photoVal('mobile_verification'),
            aadhar_photo1: type === 'indian' ? photoVal('aadhar_photo1') : null, aadhar_photo2: type === 'indian' ? photoVal('aadhar_photo2') : null,
            aadhar_otp_proof: type === 'indian' ? photoVal('aadhar_otp_proof') : null,
            passport_image: type === 'foreign' ? photoVal('passport_image') : null, visa_image: type === 'foreign' ? photoVal('visa_image') : null,
            emergency_name: F.emergency_name.get(), emergency_relation1: F.emergency_relation1.get(), emergency_number1: F.emergency_number1.get(), emergency_verification1: photoVal('emergency_verification1'),
            emergency_name2: F.emergency_name2.get() || null, emergency_relation2: F.emergency_relation2.get() || null, emergency_number2: F.emergency_number2.get() || null, emergency_verification2: photoVal('emergency_verification2'),
            additional_proofs: [...extra.kept(), ...extraPaths], customer_image: photoVal('customer_image'), remarks: F.remarks.get() || null,
          };
          const res = editing ? await sb.from('customers').update(row).eq('id', e.id).select('id').single() : await sb.from('customers').insert(row).select('id').single();
          if (res.error) throw res.error;
          toast(editing ? 'Changes saved' : 'Customer saved. An approver needs to approve it.');
          s.close(); refresh(); params.__onSaved?.(res.data.id);
        } catch (ex) { toast(friendlyError(ex), 'error'); }
        finally { label.textContent = idle; }
      });
    }
  }
}

// A "New customer" form that can be opened from anywhere (for example while handing over a vehicle).
export function openNewCustomer(onSaved) {
  return render(document.createElement('div'), { __headless: true, __onSaved: onSaved });
}
