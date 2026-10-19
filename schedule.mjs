// Pure scheduling helpers (no I/O) so they are easy to test.

export function localNow(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    minutes: Number(g('hour')) * 60 + Number(g('minute')),
  };
}

export function shiftDate(isoDate, days) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const slotKey = (hhmm) => hhmm.replace(':', '');

export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// How long after a reminder time we will still send the *first* alert
// (covers a missed scheduler run, but avoids firing old times you just added).
export const FIRST_ALERT_WINDOW = 30;

/**
 * Decide whether a reminder slot needs a push right now.
 * sent = { count, last } | null ; done = truthy if marked done.
 * Returns 'first' | 'nag' | null
 */
export function decide({ nowMin, nowMs, slotMin, sent, done, nagMinutes, maxNags, paused }) {
  if (paused || done) return null;
  if (nowMin < slotMin) return null;
  if (!sent) return nowMin - slotMin <= FIRST_ALERT_WINDOW ? 'first' : null;
  if (!nagMinutes || sent.count > maxNags) return null;
  // The scheduler runs every 5 minutes, so allow 90s of slack.
  if (nowMs - sent.last >= nagMinutes * 60000 - 90000) return 'nag';
  return null;
}

const FIRST = [
  (n, t) => [`💧 Water time for ${n}!`, `It's ${t} – pop some water out for ${n} 🦁`],
];
const NAGS = [
  (n, t) => [`🦁 Roar! ${n} is still waiting`, `Her ${t} water isn't ticked off yet – tap when it's ready`],
  (n, t) => [`💧 Little lion needs a drink`, `${n}'s ${t} water is still to do`],
  (n, t) => [`🦁 Psst… ${n}'s water!`, `Still waiting on the ${t} cup – tap Done once it's out`],
];

export function message(kind, babyName, time, count = 0) {
  const n = babyName || 'Baby';
  const t = prettyTime(time);
  const f = kind === 'first' ? FIRST[0] : NAGS[(count - 1) % NAGS.length];
  const [title, body] = f(n, t);
  return { title, body };
}

export function prettyTime(hhmm) {
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
}
