
 // Pick a customer, a ready vehicle, ready helmets.
import { h, icon, btn, field, input, select, mount, debounce, fmtPhone, chip, statusBadge, fmtDateTimeY } from './ui.js';
import { sb, fetchAll, rpc } from './supa.js';
import { state, availability, placeOf, model, loc } from './store.js';
import { signedUrls } from '../core/images.js';

// Search customers by name or mobile. Show customer photos using signed URLs
// from the existing private "photos" Storage bucket.
export function customerPicker({ fixed = null, allowNew = true } = {}) {
  let picked = fixed;
  const shown = h('div', { class: 'picked' });
  const results = h('div', { class: 'pick-results', role: 'listbox' });
  const q = input({
    type: 'search',
    placeholder: 'Type a name or mobile number',
    'aria-label': 'Search customers'
  });

  // Render a photo or a placeholder icon.
  function photoElement(size = 52) {
    const box = h('div', {
      class: 'customer-photo',
      style: `width:${size}px;height:${size}px;`
    });
    mount(box, h('div', { class: 'customer-photo-placeholder' }, icon('user-round', 25)));
    return box;
  }

  async function loadCustomer(id) {
    const { data, error } = await sb
      .from('customers')
      .select('id,name,mobile,status,customer_type,customer_image')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Could not load customer photo details:', error);
      return;
    }

    if (data) {
      picked = data;
      f.setError('');
      paint();
    }
  }

  const newBtn = allowNew && !fixed
    ? btn('Create new customer', {
        ic: 'plus',
        small: true,
        onClick: async () => {
          const { openNewCustomer } = await import('../views/customers.js');
          openNewCustomer(loadCustomer);
        }
      })
    : null;

  const f = field(
    'Customer from the Customer Master',
    h('div', { class: 'pick' }, q, results, shown, newBtn),
    {
      required: true,
      hint: 'Search by name or mobile. If the customer is not there yet, create them now.'
    }
  );

  async function paintPickedPhoto(card, customer) {
    const box = photoElement(58);
    card.prepend(box);

    if (!customer?.customer_image) return;

    try {
      const urls = await signedUrls([customer.customer_image]);
      const url = urls[customer.customer_image];
      if (!url || !box.isConnected) return;

      const img = h('img', {
        src: url,
        alt: `Photo of ${customer.name}`,
        loading: 'lazy'
      });
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '50%';
      img.onerror = () => {
        mount(box, h('div', { class: 'customer-photo-placeholder' }, icon('user-round', 25)));
      };
      mount(box, img);
    } catch (error) {
      console.error('Could not load customer photo:', error);
    }
  }

  function paint() {
    if (picked) {
      const card = h(
        'div',
        { class: 'picked-card customer-picked-card' },
        h('div',
          h('strong', picked.name),
          h('small', fmtPhone(picked.mobile))
        ),
        picked.status === 'pending'
          ? chip('Waiting for approval', 'pink')
          : null,
        fixed
          ? null
          : h('button', {
              type: 'button',
              class: 'btn btn-ghost btn-sm',
              on: {
                click: () => {
                  picked = null;
                  q.hidden = false;
                  q.value = '';
                  paint();
                  q.focus();
                }
              }
            }, 'Change')
      );

      mount(shown, card);
      paintPickedPhoto(card, picked);
      q.hidden = true;
      mount(results);
      if (newBtn) newBtn.hidden = true;
    } else {
      mount(shown);
      q.hidden = false;
      if (newBtn) newBtn.hidden = false;
    }
  }

  const search = debounce(async () => {
    const term = q.value.replace(/[,()%*\\]/g, ' ').trim();
    if (term.length < 2) {
      mount(results);
      return;
    }

    const digits = term.replace(/[\s()-]/g, '');
    let query = sb
      .from('customers')
      .select('id,name,mobile,status,customer_type,customer_image')
      .in('status', ['active', 'pending'])
      .order('name')
      .limit(8);

    query = /^\+?\d{3,}$/.test(digits)
      ? query.ilike('mobile', `%${digits}%`)
      : query.ilike('name', `%${term}%`);

    const { data, error } = await query;

    if (error) {
      console.error('Customer search failed:', error);
      mount(results, h('p', { class: 'muted small' }, 'Could not search. Try again.'));
      return;
    }

    if (!data?.length) {
      mount(results, h('p', { class: 'muted small' },
        'No customer found. Use "Create new customer" below to add them to the Customer Master.'));
      return;
    }

    // Show results immediately; load each private photo asynchronously.
    const rows = data.map(customer => {
      const row = h('button', {
        type: 'button',
        class: 'pick-row customer-pick-row',
        role: 'option',
        on: {
          click: () => {
            picked = customer;
            f.setError('');
            paint();
          }
        }
      });

      const box = photoElement(46);
      const details = h('span', { class: 'customer-photo-details' },
        h('strong', customer.name),
        h('small', fmtPhone(customer.mobile)),
        customer.customer_type === 'foreign' ? chip('Foreign', 'aqua') : null,
        customer.status === 'pending' ? chip('Waiting for approval', 'pink') : null
      );

      row.append(box, details);

      if (customer.customer_image) {
        signedUrls([customer.customer_image])
          .then(urls => {
            const url = urls[customer.customer_image];
            if (!url || !box.isConnected) return;

            const img = h('img', {
              src: url,
              alt: `Photo of ${customer.name}`,
              loading: 'lazy'
            });
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            img.onerror = () => {
              mount(box, h('div', { class: 'customer-photo-placeholder' }, icon('user-round', 25)));
            };
            mount(box, img);
          })
          .catch(error => console.error('Could not load customer photo:', error));
      }

      return row;
    });

    mount(results, rows);
  }, 250);

  q.addEventListener('input', search);
  paint();

  return {
    el: f,
    value: () => picked,
    setError: m => f.setError(m)
  };
}

// What is in the way of a vehicle (the answer of the vehicle_conflict function), in plain words.
export const conflictText = (c) => (c?.kind === 'booking'
  ? `booked for ${c.name || 'another customer'} (${c.code}) from ${fmtDateTimeY(c.from)} to ${fmtDateTimeY(c.to)}`
  : `with a customer (${c?.code})${c?.to ? `, due back ${fmtDateTimeY(c.to)}` : ''}. A vehicle with a customer cannot be booked`);

// A drop-down of vehicles that can be used right now (active and at an Office).
// With `window` (a function that returns { from: Date, to: Date, exclude: bookingId|null }) every vehicle that is locked
// by a booking in that time is shown as locked and cannot be chosen. Call refresh() when the time changes.
export function vehiclePicker({ label = 'Vehicle', excludeId = null, onChange = null, selectId = null, window: getWin = null } = {}) {
  const sel = select([{ value: '', label: 'Loading vehicles…' }]);
  const f = field(label, sel, { required: true, hint: 'Only active vehicles at an Office are listed.' });
  const hintEl = f.querySelector('.field-hint'); const baseHint = hintEl?.textContent || '';
  let all = [], seq = 0, wanted = selectId ? String(selectId) : '', first = true, loadedOnce = false;
  const rowOf = (id) => all.find(v => String(v.id) === String(id));
  async function load() {
    const my = ++seq;
    try {
      const w = getWin ? getWin() : null;
      const [vs, conf] = await Promise.all([
        loadedOnce ? Promise.resolve(all) : fetchAll(() => sb.from('vehicles').select('*').order('number')),
        w?.from && w?.to ? rpc('free_vehicles', { p_from: w.from.toISOString(), p_to: w.to.toISOString(), p_exclude: w.exclude ?? null, p_include_out: false }).catch(() => null) : Promise.resolve(null),
      ]);
      if (my !== seq) return;
      all = vs; loadedOnce = true;
      const cmap = new Map((conf || []).map(r => [r.id, r.conflict]));
      const usable = all.filter(v => v.id !== excludeId && availability(v).ok);
      all = all.map(v => ({ ...v, conflict: cmap.get(v.id) || null }));
      const list = all.filter(v => v.id !== excludeId && availability(v).ok);
      const keep = sel.value || wanted;
      sel.replaceChildren(...[{ value: '', label: usable.length ? 'Choose a vehicle' : 'No vehicle is ready at an Office' },
        ...list.map(v => ({ value: String(v.id), disabled: !!v.conflict,
          label: `${v.number}, ${model(v.model_id)?.name || ''}, ${loc(v.current_location_id)?.name || ''}${v.conflict ? ` (locked: ${conflictText(v.conflict)})` : ''}` }))]
        .map(o => h('option', { value: o.value, disabled: o.disabled }, o.label)));
      const okOpt = keep && [...sel.options].some(o => o.value === keep && !o.disabled);
      const before = sel.value;
      sel.value = okOpt ? keep : '';
      if (keep && !okOpt) {
        const r = rowOf(keep);
        f.setError(r?.conflict ? `${r.number} is locked for that time: it is ${conflictText(r.conflict)}. Choose another vehicle.`
          : (first && selectId && String(selectId) === keep ? '' : 'The vehicle you chose is not available. Choose another.'));
        if (first && selectId && String(selectId) === keep && !r?.conflict && hintEl) hintEl.textContent = 'The booked vehicle is not ready at an Office yet. Move it to an Office first, or choose another ready vehicle.';
      } else if (okOpt) { f.setError(''); if (hintEl) hintEl.textContent = baseHint; }
      wanted = sel.value; first = false;
      if (sel.value !== before || okOpt) onChange?.(value());
    } catch {
      sel.replaceChildren(h('option', { value: '' }, 'Could not load vehicles'));
    }
  }
  Promise.resolve().then(load);   // after the form that owns this picker has finished building
  const value = () => (sel.value ? rowOf(sel.value) || null : null);
  sel.addEventListener('change', () => { wanted = sel.value; f.setError(''); onChange?.(value()); });
  return {
    el: f, value, setError: m => f.setError(m),
    // reload the list for the current time. clear: also forget the chosen vehicle.
    refresh({ clear = false } = {}) { if (clear) { sel.value = ''; wanted = ''; } return load(); },
    clear() { sel.value = ''; wanted = ''; onChange?.(null); },
  };
}

// Tick-boxes for helmets. items: [{ id, code, where }]
export function helmetChips({ label = 'Helmets', items, checked = [], hint = '' }) {
  const ids = new Set(checked);
  const filter = input({ type: 'search', placeholder: 'Find a helmet', 'aria-label': 'Find a helmet' });
  const grid = h('div', { class: 'helmet-grid', role: 'group', 'aria-label': label });
  const count = h('span', { class: 'photo-size' });
  const paint = () => {
    const t = filter.value.trim().toLowerCase();
    mount(grid, items.filter(i => !t || i.code.toLowerCase().includes(t) || ids.has(i.id)).map(i =>
      h('button', { type: 'button', class: 'hchip', 'aria-pressed': String(ids.has(i.id)), title: i.where || '', on: { click: () => { ids.has(i.id) ? ids.delete(i.id) : ids.add(i.id); paint(); } } },
        icon(ids.has(i.id) ? 'check' : 'helmet', 14), i.code)));
    if (!items.length) mount(grid, h('p', { class: 'muted small' }, 'No helmet is ready at an Office.'));
    count.textContent = `${ids.size} chosen`;
  };
  filter.addEventListener('input', paint);
  paint();
  return { el: h('div', { class: 'stack-sm' }, h('div', { class: 'photo-head' }, h('span', { class: 'field-label' }, label), count), items.length > 12 ? filter : null, grid, hint ? h('span', { class: 'field-hint' }, hint) : null), values: () => [...ids] };
}

export async function readyHelmets() {
  const all = await fetchAll(() => sb.from('helmets').select('*').order('code'));
  return all.filter(x => availability(x).ok).map(x => ({ id: x.id, code: x.code, where: loc(x.current_location_id)?.name || '' }));
}
