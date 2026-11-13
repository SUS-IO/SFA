// Country calling codes and phone number helpers (no imports).
export const COUNTRIES = [
  ['India', '91'], ['United States', '1'], ['Canada', '1'], ['United Kingdom', '44'], ['Australia', '61'], ['New Zealand', '64'],
  ['Germany', '49'], ['France', '33'], ['Italy', '39'], ['Spain', '34'], ['Netherlands', '31'], ['Belgium', '32'], ['Switzerland', '41'],
  ['Austria', '43'], ['Sweden', '46'], ['Norway', '47'], ['Denmark', '45'], ['Finland', '358'], ['Ireland', '353'], ['Portugal', '351'],
  ['Poland', '48'], ['Czech Republic', '420'], ['Russia', '7'], ['Ukraine', '380'], ['Turkey', '90'], ['United Arab Emirates', '971'],
  ['Saudi Arabia', '966'], ['Qatar', '974'], ['Oman', '968'], ['Kuwait', '965'], ['Bahrain', '973'], ['Israel', '972'],
  ['Sri Lanka', '94'], ['Nepal', '977'], ['Bhutan', '975'], ['Bangladesh', '880'], ['Pakistan', '92'], ['Maldives', '960'],
  ['Singapore', '65'], ['Malaysia', '60'], ['Thailand', '66'], ['Indonesia', '62'], ['Philippines', '63'], ['Vietnam', '84'],
  ['Japan', '81'], ['South Korea', '82'], ['China', '86'], ['Hong Kong', '852'], ['Taiwan', '886'],
  ['Brazil', '55'], ['Argentina', '54'], ['Mexico', '52'], ['South Africa', '27'], ['Kenya', '254'], ['Nigeria', '234'], ['Egypt', '20'], ['Mauritius', '230'],
];
const CODES = [...new Set(COUNTRIES.map(c => c[1]))].sort((a, b) => b.length - a.length);

// "+919876543210" -> { cc: '91', number: '9876543210' }
export function splitPhone(e164) {
  const d = String(e164 || '').replace(/\D/g, '');
  if (!d) return { cc: '91', number: '' };
  const cc = CODES.find(c => d.startsWith(c)) || d.slice(0, 2);
  return { cc, number: d.slice(cc.length) };
}
// -> '+919876543210' or null when it cannot be valid
export function joinPhone(cc, number) {
  const c = String(cc || '').replace(/\D/g, '');
  const n = String(number || '').replace(/\D/g, '').replace(/^0+/, '');
  const total = c.length + n.length;
  if (!c || c.length > 4 || n.length < 5 || total < 8 || total > 15) return null;
  return '+' + c + n;
}

