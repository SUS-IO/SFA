// Look at a customer (details and documents) from any screen, without leaving it.
import { h, btn, chip, statusBadge, sectionBlock, openSheet, confirmDialog, toast, mount, emptyState, skeletonRows, fmtPhone, fmtDateTimeY, friendlyError } from './ui.js';
import { sb } from './supa.js';
import { state, can, whoName } from './store.js';
import { signedUrls, lightbox } from './images.js';

export async function openCustomerView(id, { onChange } = {}) {
  const s = openSheet({ title: 'Customer', body: skeletonRows(4), wide: true });
  async function load() {
    let c;
    try {
      const { data, error } = await sb.from('customers').select('*').eq('id', id).maybeSingle();
      if (error) throw error; if (!data) throw new Error('This customer no longer exists.'); c = data;
    } catch (e) { mount(s.body, emptyState('Could not open this customer', friendlyError(e))); return; }
    paint(c);
  }
  function paint(c) {
    s.panel.querySelector('.sheet-titles h2').textContent = c.name;
    const kv = (k, v) => (v ? h('div', { class: 'kv' }, h('dt', k), h('dd', v)) : null);
    const photos = [
      ['customer_image', 'Customer photo'], ['dl_image1', 'Driving licence, front'], ['dl_image2', 'Driving licence, back'],
      ...(c.customer_type === 'foreign' ? [['passport_image', 'Passport'], ['visa_image', 'Visa']] : [['aadhar_photo1', 'Aadhaar, front'], ['aadhar_photo2', 'Aadhaar, back'], ['aadhar_otp_proof', 'Aadhaar OTP proof']]),
      ['mobile_verification', 'Mobile verification'], ['emergency_verification1', 'Emergency contact 1 proof'], ['emergency_verification2', 'Emergency contact 2 proof'],
      ...(c.additional_proofs || []).map((p, i) => ['__extra' + i, `Additional proof ${i + 1}`, p]),
    ].map(([k, label, path]) => ({ label, path: path || c[k] })).filter(p => p.path);
    const grid = h('div', { class: 'photo-grid-view' }, photos.map(p => h('div', { class: 'thumb loading' }, h('span', { class: 'thumb-label' }, p.label))));
    signedUrls(photos.map(p => p.path)).then(map => grid.querySelectorAll('.thumb').forEach((el, i) => { const url = map[photos[i].path]; el.classList.remove('loading');
      if (url) { el.prepend(h('img', { src: url, alt: photos[i].label, loading: 'lazy' })); el.addEventListener('click', () => lightbox(url, photos[i].label)); } else el.classList.add('failed'); }))
      .catch(() => grid.querySelectorAll('.thumb').forEach(el => { el.classList.remove('loading'); el.classList.add('failed'); }));
    const history = [`Added by ${whoName(c.created_by)} on ${fmtDateTimeY(c.created_at)}`, c.approved_by ? `Approved by ${whoName(c.approved_by)} on ${fmtDateTimeY(c.approved_at)}` : null].filter(Boolean);
    mount(s.body,
      h('div', { class: 'detail-top' }, statusBadge(c.status), chip(c.customer_type === 'foreign' ? 'Foreign customer' : 'Indian customer', 'aqua'), h('a', { class: 'tel', href: `tel:${c.mobile}` }, fmtPhone(c.mobile))),
      h('div', { class: 'bento' },
        sectionBlock('Details', h('dl', { class: 'kvs' }, kv('Mobile', fmtPhone(c.mobile)), kv('Second mobile', fmtPhone(c.mobile2)), kv('Nationality', c.nationality), kv('Permanent address', c.permanent_address),
          kv('Emergency contact 1', [c.emergency_name, c.emergency_relation1 && `(${c.emergency_relation1})`, fmtPhone(c.emergency_number1)].filter(Boolean).join(' ')),
          kv('Emergency contact 2', [c.emergency_name2, c.emergency_relation2 && `(${c.emergency_relation2})`, fmtPhone(c.emergency_number2)].filter(Boolean).join(' ')),
          c.remarks ? h('div', { class: 'kv' }, h('dt', 'Remarks'), h('dd', { class: 'prewrap' }, c.remarks)) : null)),
        (() => { const e = sectionBlock('Photos and documents', photos.length ? grid : h('p', { class: 'muted' }, 'No photos saved.')); e.classList.add('span2'); return e; })(),
        sectionBlock('History', h('ul', { class: 'history' }, history.map(t => h('li', t))))));
    const foot = [btn('Close', { onClick: () => s.close() })];
    if (c.status === 'pending' && can.approve()) foot.push(btn('Approve customer', { kind: 'primary', ic: 'check', onClick: async () => {
      const ok = await confirmDialog({ title: `Approve ${c.name}?`, message: 'Once approved, this customer can rent vehicles.', confirmLabel: 'Approve' }); if (!ok) return;
      try { const { error } = await sb.from('customers').update({ status: 'active' }).eq('id', c.id); if (error) throw error; toast('Customer approved'); onChange?.(); await load(); } catch (e) { toast(friendlyError(e), 'error'); } } }));
    if (!s.foot) { const f = h('div', { class: 'sheet-foot' }, foot); s.panel.append(f); s.foot = f; } else mount(s.foot, foot);
  }
  await load();
  return s;
}
