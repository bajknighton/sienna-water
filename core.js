import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import { createHash } from 'node:crypto';

export const DEFAULT_SETTINGS = {
  babyName: 'Sienna',
  times: ['08:00', '10:00', '15:00', '17:00'],
  tz: 'Europe/London',
  nagMinutes: 15, // repeat every N minutes until someone taps Done (0 = off)
  maxNags: 3, // how many repeats after the first alert
  notifyOnDone: true, // tell the other phone when it's been done
  paused: false,
  vitamins: { on: true, time: '09:00' },
  allergenCheck: { on: true, time: '19:00' }, // evening "have we ticked today's allergens?" reminder
  allergens: ['Egg', 'Peanut', 'Milk', 'Wheat', 'Soya', 'Sesame', 'Fish', 'Tree nuts', 'Shellfish'],
  allergenTarget: 3, // exposures per allergen per week
};

export const store = () => getStore({ name: 'sienna-water', consistency: 'strong' });

export const hash = (s) => createHash('sha256').update(s).digest('hex');
export const codeHash = (code) => hash('sienna-water:' + String(code).trim().toLowerCase());

export async function getMeta(s = store()) {
  let meta = await s.get('meta', { type: 'json' });
  if (!meta || !meta.vapidPublic) {
    // First run: create this site's own push keys and keep them in storage.
    const keys = webpush.generateVAPIDKeys();
    meta = { ...(meta || {}), vapidPublic: keys.publicKey, vapidPrivate: keys.privateKey };
    await s.setJSON('meta', meta);
  }
  return meta;
}

export const SCHEDULES = ['1', '2'];

// Two named schedules; `times` is always the active schedule's times.
export function normalise(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  if (!s.schedules) s.schedules = { 1: [...s.times], 2: [...s.times] };
  for (const k of SCHEDULES) if (!Array.isArray(s.schedules[k])) s.schedules[k] = [];
  s.active = SCHEDULES.includes(String(s.active)) ? String(s.active) : '1';
  s.times = s.schedules[s.active];
  s.vitamins = { ...DEFAULT_SETTINGS.vitamins, ...(saved?.vitamins || {}) };
  s.allergenCheck = { ...DEFAULT_SETTINGS.allergenCheck, ...(saved?.allergenCheck || {}) };
  if (!Array.isArray(s.allergens)) s.allergens = [...DEFAULT_SETTINGS.allergens];
  return s;
}

export async function getSettings(s = store()) {
  return normalise(await s.get('settings', { type: 'json' }));
}

export async function listSubs(s = store()) {
  const { blobs } = await s.list({ prefix: 'sub/' });
  const subs = await Promise.all(
    blobs.map(async (b) => ({ key: b.key, ...(await s.get(b.key, { type: 'json' })) }))
  );
  return subs.filter((x) => x.subscription);
}

/** Allergen ticks for one week: { name: [{ date, by, at }, ...] } */
export async function allergenWeek(settings, week, s = store()) {
  const { slug } = await import('./schedule.mjs');
  const rows = await Promise.all(
    settings.allergens.map(async (name) => [name, (await s.get(`allergen/${week}/${slug(name)}`, { type: 'json' })) || []])
  );
  return Object.fromEntries(rows);
}

export function allergenSummary(settings, entries) {
  const met = settings.allergens.filter((a) => (entries[a] || []).length >= settings.allergenTarget).length;
  return `${met} of ${settings.allergens.length} allergens at ${settings.allergenTarget}+ this week`;
}

export const subId =(endpoint) => hash(endpoint).slice(0, 16);

/** Send a payload to every subscribed phone (optionally skipping one). */
export async function pushAll(payload, { except, only } = {}, s = store()) {
  const meta = await getMeta(s);
  webpush.setVapidDetails('mailto:reminders@example.com', meta.vapidPublic, meta.vapidPrivate);
  let subs = await listSubs(s);
  if (except) subs = subs.filter((x) => x.key !== `sub/${except}`);
  if (only) subs = subs.filter((x) => x.key === `sub/${only}`);
  const results = await Promise.allSettled(
    subs.map((x) =>
      webpush.sendNotification(x.subscription, JSON.stringify(payload), { TTL: 1800, urgency: 'high' })
    )
  );
  let sent = 0;
  await Promise.all(
    results.map(async (r, i) => {
      if (r.status === 'fulfilled') return sent++;
      const code = r.reason?.statusCode;
      console.log('push failed', subs[i].name, code, r.reason?.body || r.reason?.message);
      if (code === 404 || code === 410) await s.delete(subs[i].key); // phone unsubscribed
    })
  );
  return { sent, total: subs.length };
}
