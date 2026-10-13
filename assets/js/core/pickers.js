// Pickers for Customer, Vehicle, and Helmets
import { h, icon, btn, field, input, openSheet, toast, mount, emptyState, skeletonRows, debounce, fmtPhone } from './ui.js';
import { sb } from './supa.js';
import { signedUrls } from './images.js';

export function customerPicker({ value = null, onChange, hint = 'Search by name or mobile. If the customer is not there yet, create them now.' } = {}) {
  let selected = value;
  const host = h('div', { class: 'cust-picker' });

  function render() {
    if (!selected) {
      const chooseBtn = btn('Choose customer from Customer Master', {
        ic: 'search',
        onClick: openSearch
      });
      mount(host, field('Customer from the Customer Master', chooseBtn, { required: true, hint }));
      return;
    }

    // Customer Card with Photo Preview
    const imgEl = h('img', {
      style: 'width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: #e2e8f0; flex-shrink: 0;',
      alt: selected.name
    });

    const info = h('div', { style: 'flex: 1; min-width: 0;' },
      h('strong', { style: 'display: block;' }, selected.name),
      h('small', { class: 'muted' }, fmtPhone(selected.mobile))
    );

    const changeBtn = btn('Change', {
      kind: 'ghost',
      small: true,
      onClick: openSearch
    });

    const card = h('div', { 
      style: 'display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; background: var(--bg-subtle, #f1f5f9); border: 1px solid var(--border-color, #cbd5e1);' 
    }, imgEl, info, changeBtn);

    // Load customer photo if available
    if (selected.customer_image) {
      signedUrls([selected.customer_image]).then(map => {
        if (map[selected.customer_image]) imgEl.src = map[selected.customer_image];
      }).catch(() => {});
    } else {
      // Fallback placeholder icon standard element
      imgEl.style.display = 'none';
      const iconAvatar = h('div', { style: 'width: 48px; height: 48px; border-radius: 50%; background: #cbd5e1; display: flex; align-items: center; justify-content: center; flex-shrink: 0;' }, icon('user', 24));
      card.prepend(iconAvatar);
    }

    mount(host, field('Customer from the Customer Master', card, { required: true, hint }));
  }

  function openSearch() {
    let listWrap = h('div', { class: 'rows' });
    const qInput = input({ placeholder: 'Search by name or mobile', type: 'search' });

    const sheet = openSheet({
      title: 'Choose customer',
      body: h('div', { class: 'stack' },
        h('div', { class: 'search' }, icon('search', 18), qInput),
        listWrap
      )
    });

    async function search() {
      const q = qInput.value.trim();
      mount(listWrap, skeletonRows(4));
      try {
        let query = sb.from('customers').select('id,name,mobile,customer_type,nationality,status,customer_image').order('name');
        if (q) {
          const digits = q.replace(/[\s()-]/g, '');
          if (/^\+?\d+$/.test(digits)) query = query.ilike('mobile', `%${digits}%`);
          else query = query.ilike('name', `%${q}%`);
        }
        const { data, error } = await query.limit(30);
        if (error) throw error;

        if (!data.length) {
          mount(listWrap, emptyState('No customers found', 'Try another search term.'));
          return;
        }

        // Fetch thumbnail signed URLs for search result list
        const paths = data.map(c => c.customer_image).filter(Boolean);
        const urlMap = paths.length ? await signedUrls(paths).catch(() => ({})) : {};

        mount(listWrap, data.map(c => {
          const avatar = h('div', { style: 'width: 40px; height: 40px; border-radius: 50%; background: #e2e8f0; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center;' });
          if (c.customer_image && urlMap[c.customer_image]) {
            avatar.append(h('img', { src: urlMap[c.customer_image], style: 'width:100%; height:100%; object-fit:cover;' }));
          } else {
            avatar.append(icon('user', 20));
          }

          return h('div', {
            class: 'row clickable',
            style: 'display: flex; align-items: center; gap: 12px; padding: 10px; cursor: pointer;',
            on: {
              click: () => {
                selected = c;
                render();
                onChange?.(selected);
                sheet.close();
              }
            }
          },
          avatar,
          h('div', { style: 'flex: 1;' }, h('strong', c.name), h('br'), h('small', { class: 'muted' }, fmtPhone(c.mobile)))
          );
        }));
      } catch (e) {
        mount(listWrap, h('p', { class: 'field-error' }, 'Could not load customers.'));
      }
    }

    qInput.addEventListener('input', debounce(search, 300));
    search();
  }

  render();

  return {
    el: host,
    value: () => selected,
    setError(msg) {
      const f = host.querySelector('.field');
      if (f && f.setError) f.setError(msg);
    }
  };
}

export function vehiclePicker({ label = 'Vehicle', value = null, excludeId = null, onChange } = {}) {
  let selected = value;
  const sel = select([]);
  const f = field(label, sel, { required: true, hint: 'Only active vehicles at an Office are listed.' });

  let vehicles = [];
  async function load() {
    try {
      const { data, error } = await sb.from('vehicles').select('id,number,model_id,current_location_id,status').eq('status', 'active');
      if (error) throw error;
      vehicles = (data || []).filter(v => v.id !== excludeId);
      sel.replaceChildren(
        h('option', { value: '' }, 'Choose a vehicle'),
        ...vehicles.map(v => h('option', { value: String(v.id) }, `${v.number}`))
      );
      if (selected) sel.value = String(selected.id || selected);
    } catch {
      f.setError('Could not load vehicles.');
    }
  }

  sel.addEventListener('change', () => {
    f.setError('');
    const id = Number(sel.value);
    selected = vehicles.find(v => v.id === id) || null;
    onChange?.(selected);
  });

  load();

  return {
    el: f,
    value: () => selected,
    setError(msg) { f.setError(msg); }
  };
}

export async function readyHelmets() {
  const { data } = await sb.from('helmets').select('id,code,status').eq('status', 'ready');
  return data || [];
}

export function helmetChips({ label = 'Helmets', items = [], checked = [], hint = '' } = {}) {
  const set = new Set(checked);
  const count = h('span', { class: 'muted small' }, `${set.size} chosen`);
  const list = h('div', { class: 'chips-grid' });

  items.forEach(item => {
    const active = set.has(item.id);
    const btnEl = btn(item.code, {
      kind: active ? 'primary' : 'outline',
      small: true,
      onClick: () => {
        if (set.has(item.id)) set.delete(item.id);
        else set.add(item.id);
        btnEl.className = set.has(item.id) ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
        count.textContent = `${set.size} chosen`;
      }
    });
    list.append(btnEl);
  });

  const el = field(label, h('div', { class: 'stack-sm' }, list), { hint, rightLabel: count });

  return {
    el,
    values: () => [...set]
  };
}
