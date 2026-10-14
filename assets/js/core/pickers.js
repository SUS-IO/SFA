
 // Pick a customer, a ready vehicle, ready helmets.
import { h, icon, btn, field, input, select, mount, debounce, fmtPhone, chip, statusBadge } from './ui.js';
import { sb, fetchAll } from './supa.js';
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

// A drop-down of vehicles that can be used right now (active and at an Office).
export function vehiclePicker({ label = 'Vehicle', excludeId = null, onChange = null } = {}) {
  const sel = select([{ value: '', label: 'Loading vehicles…' }]);
  const f = field(label, sel, { required: true, hint: 'Only active vehicles at an Office are listed.' });
  let list = [];
  (async () => {
    try {
      list = (await fetchAll(() => sb.from('vehicles').select('*').order('number'))).filter(v => v.id !== excludeId && availability(v).ok);
      sel.replaceChildren(...[{ value: '', label: list.length ? 'Choose a vehicle' : 'No vehicle is ready at an Office' },
        ...list.map(v => ({ value: String(v.id), label: `${v.number}, ${model(v.model_id)?.name || ''}, ${loc(v.current_location_id)?.name || ''}` }))]
        .map(o => h('option', { value: o.value }, o.label)));
    } catch {
      sel.replaceChildren(h('option', { value: '' }, 'Could not load vehicles'));
    }
  })();
  const value = () => (sel.value ? list.find(v => String(v.id) === sel.value) : null);
  sel.addEventListener('change', () => { f.setError(''); onChange?.(value()); });
  return { el: f, value, setError: m => f.setError(m) };
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
