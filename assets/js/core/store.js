// Shared in-memory state: who is signed in, and the small lists every screen needs.
import { sb, fetchAll } from './supa.js';

export const state = {
  me: null,                 // signed-in user's profile
  profiles: [], profileMap: new Map(),
  locations: [], models: [],
};

export async function loadRefs() {
  const [profiles, locations, models] = await Promise.all([
    fetchAll(() => sb.from('profiles').select('id,user_id,user_name,role,active,must_change_password,created_at').order('user_id')),
    fetchAll(() => sb.from('locations').select('*').order('type').order('name')),
    fetchAll(() => sb.from('vehicle_models').select('*').order('name')),
  ]);
  state.profiles = profiles; state.profileMap = new Map(profiles.map(p => [p.id, p]));
  state.locations = locations; state.models = models;
}
export async function reloadProfiles() { await loadRefs(); }

export const who = (id) => state.profileMap.get(id);
export const whoName = (id) => { const p = who(id); return p ? `${p.user_name} (${p.user_id})` : 'Unknown user'; };
export const loc = (id) => state.locations.find(l => l.id === id);
export const model = (id) => state.models.find(m => m.id === id);
export const activeLocations = () => state.locations.filter(l => l.active);

export const role = () => state.me?.role;
export const can = {
  approve: () => ['approver', 'manager', 'admin', 'superadmin'].includes(role()),
  assignSwap: () => ['tele_caller', 'approver', 'manager', 'admin', 'superadmin'].includes(role()),
  manager: () => ['manager', 'admin', 'superadmin'].includes(role()),
  admin: () => ['admin', 'superadmin'].includes(role()),
  superadmin: () => role() === 'superadmin',
};

// Where is a vehicle / helmet right now?
// kind: office | service | customer | transit | unknown
export function placeOf(it) {
  if (it.current_state === 'with_customer') {
    return { kind: 'customer', label: 'With customer' + (it.current_location_text ? ` (${it.current_location_text})` : '') };
  }
  if (it.current_state === 'waiting_approval') {
    const l = loc(it.current_location_id);
    return { kind: 'waiting', label: 'Waiting for approval' + (l ? ` (${l.name})` : '') };
  }
  if (it.current_state === 'in_transit') {
    return { kind: 'transit', label: 'In transit' + (it.current_location_text ? ` (${it.current_location_text})` : '') };
  }
  const l = loc(it.current_location_id);
  if (!l) return { kind: 'unknown', label: 'Unknown place' };
  return { kind: l.type === 'Office' ? 'office' : 'service', label: l.name };
}
// The reuse rule: active, and sitting at an Office.
export function availability(it) {
  if (it.status === 'blocked') return { ok: false, why: 'It is blocked.' };
  const p = placeOf(it);
  if (p.kind === 'office') return { ok: true, why: `At ${p.label}.` };
  if (p.kind === 'service') return { ok: false, why: `At ${p.label}. Only items at an office can be used.` };
  if (p.kind === 'customer') return { ok: false, why: 'It is with a customer.' };
  if (p.kind === 'waiting') return { ok: false, why: 'It is waiting for approval.' };
  return { ok: false, why: `At ${p.label}.` };
}
