// Runs every 5 minutes on Netlify and sends any reminders that are due.
import { store, getSettings, pushAll } from '../lib/core.mjs';
import { localNow, toMin, slotKey, decide, message } from '../lib/schedule.mjs';

export default async () => {
  const s = store();
  const settings = await getSettings(s);
  const nowMs = Date.now();
  const { date, minutes } = localNow(settings.tz);

  for (const time of settings.times) {
    const k = slotKey(time);
    const [sent, done] = await Promise.all([
      s.get(`sent/${date}/${k}`, { type: 'json' }),
      s.get(`done/${date}/${k}`, { type: 'json' }),
    ]);
    const action = decide({
      nowMin: minutes, nowMs, slotMin: toMin(time), sent, done,
      nagMinutes: settings.nagMinutes, maxNags: settings.maxNags, paused: settings.paused,
    });
    if (!action) continue;

    const count = sent ? sent.count : 0;
    const { title, body } = message(action, settings.babyName, time, count);
    // Record first so a slow push can't cause a double-send on the next run.
    await s.setJSON(`sent/${date}/${k}`, { count: count + 1, last: nowMs });
    const r = await pushAll({ title, body, tag: `water-${date}-${k}`, url: `/?due=${k}` }, {}, s);
    console.log(`${date} ${time} ${action} -> sent to ${r.sent}/${r.total}`);
  }
  return new Response('ok');
};

export const config = { schedule: '*/5 * * * *' };
