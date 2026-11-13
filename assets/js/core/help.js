// Plain-language help for every screen, and a short "getting started" guide for new users.
// Put this file in: assets/js/core/help.js
import { h, icon, openSheet } from './ui.js';

export const SUBTITLES = {
  dashboard: 'Your day at a glance', deliveries: 'Bookings, deliveries, swaps and pickups', inbox: 'Things waiting for you', live: 'Customers who have a vehicle right now',
  movement: 'Where every vehicle and helmet is', attendance: 'Mark your attendance and see hours worked', customers: 'Customer records and approvals', vehicles: 'The vehicle master list',
  helmets: 'The helmet master list', money: 'Other income and expenses', accounts: 'Cash, payments and day books', rentgrid: 'Vehicles by day: money received against the slab', reports: 'Download Excel reports', logs: 'Who did what and when',
  settings: 'Lists, categories and session length', admin: 'Users and roles',
};

const TIPS = {
  dashboard: ['The four tiles at the top are clickable. Tap one to open that list.', 'Use "New booking", "New delivery" or "New customer" at the top right to start work.', '"Waiting for your approval" shows what needs a decision from you.'],
  deliveries: ['Tap a row (or card) to see the full delivery, its photos and money.', 'Use the search box and the status filter to find a customer or vehicle quickly.', 'Switch between Cards and Table with the buttons at the top right.', 'A booking becomes a delivery when you press "Hand over" on it.'],
  inbox: ['This is your to-do list. Each line says what to do and opens the right screen.', 'The red number next to the bell shows how many items are waiting.'],
  live: ['These are customers who currently have a vehicle. Use it to call them or check returns.', 'Red or orange rows are overdue and need attention first.'],
  movement: ['Shows every vehicle and helmet with its place and status.', 'Tap one to see its history and move it between places.', 'A vehicle that is with a customer comes back only through a Pickup (or a Swap).'],
  attendance: ['Press "Mark In" when you start and "Mark Out" when you finish. You can do this several times a day.', 'Your location is picked up automatically and a selfie is needed. Without both, attendance is not saved.', 'You cannot edit or delete an entry. Managers review the day and can correct the timings.'],
  customers: ['Add a customer with "New customer". Photos and ID are needed.', 'New customers wait for approval. Approvers, Managers and Admins can approve them.', 'Tap a customer to see their documents, history and deliveries.'],
  vehicles: ['Each vehicle has a number, model, place and status.', 'Tap a vehicle to see its documents and history.', 'A blocked vehicle cannot be booked or delivered.'],
  helmets: ['Helmets are listed with their place and status.', 'Only helmets at an Office can be given on a delivery.'],
  money: ['This page is only for other income and other expense (not rent, deposit or delivery money).', 'Always pick a Category and a Sub-category.', 'Online income needs a UTR number and a screenshot.'],
  accounts: ['See cash held by each person and what is waiting to be acknowledged.', 'Cash moves only from one person to another. There is no bank deposit entry.', 'Use the date range at the top to see another period.'],
  rentgrid: ['Each row is a vehicle and each column is a day.', 'Each cell shows the money received that day and the rent as per the slab in the vehicle master.', 'Orange means less than the slab, green means it matches, blue means more.', 'Use Money type to look at Rent, Deposit or Other charges, and the date boxes to change the period.'],
  reports: ['Pick a report and a date range, then download it. It opens in Excel.'],
  logs: ['A record of changes. Use it to see who did what and when.'],
  settings: ['Admins can edit drop-down lists, categories, alert hours and how long a login lasts.'],
  admin: ['Admins create users, set their role and reset passwords.', 'Roles: Executive, Tele caller, Approver, Manager, Admin, Superadmin.'],
};

const STEPS = [
  ['Find your way', 'The menu on the left lists every screen. On a phone, use the bar at the bottom and "More".'],
  ['Do your daily work', 'Start from Home. "New booking", "New delivery" and "New customer" are at the top right.'],
  ['Check your To do', 'The bell at the top shows what is waiting for you. Tap it to open your list.'],
  ['Get help any time', 'Press the ? button at the top. It explains the screen you are on, in simple words.'],
];

export function openHelp(route, title) {
  const tips = TIPS[route] || ['Use the menu on the left to move between screens.'];
  openSheet({
    title: `How to use: ${title || 'this screen'}`, subtitle: 'Simple tips for this screen',
    body: h('div', { class: 'stack' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', 'On this screen')), h('ul', { class: 'help-list' }, tips.map(t => h('li', null, icon('check', 18), h('span', t))))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', 'Getting started')), h('ol', { class: 'help-steps' }, STEPS.map(([a, b]) => h('li', null, h('strong', a), h('span', { class: 'muted' }, b))))),
      h('p', { class: 'muted small' }, 'Tip: tables can be sorted by clicking a column heading. The page size is at the bottom of each table.')),
  });
}

const KEY = 'sfa-quickstart-done';
export const quickStartSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
export function quickStartPanel() {
  if (quickStartSeen()) return null;
  const el = h('section', { class: 'panel quickstart' }, h('div', { class: 'panel-head' }, h('h2', 'Welcome. Here is how to start'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } el.remove(); } } }, 'Got it, hide this')),
    h('ol', { class: 'help-steps' }, STEPS.map(([a, b]) => h('li', null, h('strong', a), h('span', { class: 'muted' }, b)))));
  return el;
}
