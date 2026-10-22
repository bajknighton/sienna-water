// Runs every 5 minutes on Netlify and sends any reminders that are due.
import { store, getSettings, pushAll, allergenWeek, allergenSummary } from '../lib/core.mjs';
import { localNow, toMin, decide, message, extraMessage, reminders, weekStart } from '../lib/schedule.mjs';

export default async () => {
  const s = store();
  const settings = await getSettings(s);
  const nowMs = Date.now();
  const { date, minutes } = localNow(settings.tz);

  for (const r of reminders(settings)) {
    const [sent, done] = await Promise.all([
      s.get(`sent/${date}/${r.key}`, { type: 'json' }),
      s.get(`done/${date}/${r.key}`, { type: 'json' }),
    ]);
    const action = decide({
      nowMin: minutes, nowMs, slotMin: toMin(r.time), sent, done,
      nagMinutes: settings.nagMinutes, maxNags: settings.maxNags, paused: settings.paused,
    });
    if (!action) continue;

    const count = sent ? sent.count : 0;
    let msg, url;
    if (r.kind === 'water') {
      msg = message(action, settings.babyName, r.time, count);
      url = `/?due=${r.key}`;
    } else if (r.kind === 'vit') {
      msg = extraMessage('vit', action, settings.babyName);
      url = '/?due=vit';
    } else {
      const entries = await allergenWeek(settings, weekStart(date), s);
      msg = extraMessage('allg', action, settings.babyName, allergenSummary(settings, entries));
      url = '/?tab=allergens';
    }
    // Record first so a slow push can't cause a double-send on the next run.
    await s.setJSON(`sent/${date}/${r.key}`, { count: count + 1, last: nowMs });
    const res = await pushAll({ ...msg, tag: `${r.kind}-${date}-${r.key}`, url }, {}, s);
    console.log(`${date} ${r.kind} ${r.time} ${action} -> sent to ${res.sent}/${res.total}`);
  }
  return new Response('ok');
};

export const config = { schedule: '*/5 * * * *' };
