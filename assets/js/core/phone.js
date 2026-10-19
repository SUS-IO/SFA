// Phone input with a country-code picker. Values are stored as +<code><number>, e.g. +919876543210.
import { h, field, input, select } from './ui.js';

import { COUNTRIES, splitPhone, joinPhone } from './countries.js';
export { COUNTRIES, splitPhone, joinPhone };

export function phoneField(label, { required = false, value = '', hint = '' } = {}) {
  const init = splitPhone(value);
  const known = COUNTRIES.some(c => c[1] === init.cc);
  const byCode = new Map();
  for (const [n, c] of COUNTRIES) byCode.set(c, [...(byCode.get(c) || []), n]);
  const sel = select([...[...byCode].map(([c, names]) => ({ value: c, label: `${names.join(' / ')} (+${c})` })),
    { value: 'other', label: 'Other country code' }], { class: 'input select cc', 'aria-label': `${label} country code` });
  sel.value = known ? init.cc : 'other';
  const other = input({ class: 'input cc-other', inputmode: 'numeric', placeholder: 'Code', 'aria-label': 'Country code digits', value: known ? '' : init.cc, hidden: known });
  const num = input({ type: 'tel', inputmode: 'tel', placeholder: 'Mobile number', autocomplete: 'off', value: init.number });
  const wrap = field(label, h('div', { class: 'phone' }, sel, other, num), { required, hint });
  const cc = () => (sel.value === 'other' ? other.value : sel.value);
  sel.addEventListener('change', () => { other.hidden = sel.value !== 'other'; if (!other.hidden) other.focus(); });
  const api = {
    el: wrap,
    get: () => joinPhone(cc(), num.value),
    raw: () => num.value.trim(),
    setError: wrap.setError,
    validate() {
      const raw = num.value.trim();
      if (!raw) { if (required) { wrap.setError('Enter a mobile number.'); return false; } wrap.setError(''); return true; }
      if (!joinPhone(cc(), raw)) { wrap.setError('Check the country code and number.'); return false; }
      wrap.setError(''); return true;
    },
    focus: () => num.focus(),
  };
  for (const el of [num, other, sel]) el.addEventListener('input', () => { if (wrap.classList.contains('has-error')) api.validate(); });
  return api;
}
