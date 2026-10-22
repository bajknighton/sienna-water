import {
  store, getMeta, getSettings, listSubs, pushAll, codeHash, subId, DEFAULT_SETTINGS, SCHEDULES,
  allergenWeek,
} from '../lib/core.mjs';
import { localNow, shiftDate, slotKey, isTime, prettyTime, weekStart, slug } from '../lib/schedule.mjs';

const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '');
  const s = store();
  const meta = await getMeta(s);
  const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));

  // --- open routes -------------------------------------------------------
  if (route === 'status') return json({ hasCode: !!meta.codeHash });

  if (route === 'setup' && req.method === 'POST') {
    const code = String(body.code || '').trim();
    if (code.length < 4) return json({ error: 'Family code must be at least 4 characters' }, 400);
    if (!meta.codeHash) {
      await s.setJSON('meta', { ...meta, codeHash: codeHash(code) });
      return json({ ok: true, created: true });
    }
    if (meta.codeHash !== codeHash(code)) return json({ error: "That code doesn't match" }, 401);
    return json({ ok: true });
  }

  // --- everything else needs the family code -----------------------------
  if (!meta.codeHash || req.headers.get('x-family-code') == null ||
      codeHash(req.headers.get('x-family-code')) !== meta.codeHash) {
    return json({ error: 'unauthorised' }, 401);
  }

  const settings = await getSettings(s);
  const { date, minutes } = localNow(settings.tz);

  if (route === 'state') {
    const slots = await Promise.all(
      settings.times.map(async (time) => {
        const k = slotKey(time);
        const [sent, done] = await Promise.all([
          s.get(`sent/${date}/${k}`, { type: 'json' }),
          s.get(`done/${date}/${k}`, { type: 'json' }),
        ]);
        return { time, key: k, sent, done };
      })
    );
    const week = await Promise.all(
      [6, 5, 4, 3, 2, 1, 0].map(async (back) => {
        const d = shiftDate(date, -back);
        const { blobs } = await s.list({ prefix: `done/${d}/` });
        return { date: d, done: blobs.filter((b) => /\/\d{4}$/.test(b.key)).length }; // water only
      })
    );
    const extra = async (key) => {
      const [sent, done] = await Promise.all([
        s.get(`sent/${date}/${key}`, { type: 'json' }),
        s.get(`done/${date}/${key}`, { type: 'json' }),
      ]);
      return { sent, done };
    };
    const [vit, allg] = await Promise.all([extra('vit'), extra('allg')]);
    const thisWeek = weekStart(date);
    const allergens = { week: thisWeek, entries: await allergenWeek(settings, thisWeek, s) };
    const devices = (await listSubs(s)).map((x) => ({ id: x.key.slice(4), name: x.name }));
    return json({ settings, publicKey: meta.vapidPublic, date, nowMin: minutes, slots, vit, allg, allergens, week, devices });
  }

  if (route === 'allergens' && req.method === 'GET') {
    const week = weekStart(isDate(url.searchParams.get('week')) ? url.searchParams.get('week') : date);
    return json({ week, entries: await allergenWeek(settings, week, s) });
  }

  if (route === 'allergen' && req.method === 'POST') {
    // { name, week, action: 'add' | 'remove', index }
    if (!settings.allergens.includes(body.name)) return json({ error: 'unknown allergen' }, 400);
    const week = weekStart(isDate(body.week) ? body.week : date);
    if (week > weekStart(date)) return json({ error: "can't log future weeks" }, 400);
    const key = `allergen/${week}/${slug(body.name)}`;
    const list = (await s.get(key, { type: 'json' })) || [];
    if (body.action === 'add') {
      // Ticks in the current week are dated today; older weeks just count.
      list.push({ date: week === weekStart(date) ? date : null, by: String(body.by || '').slice(0, 30), at: Date.now() });
    } else if (body.action === 'remove') {
      const i = Number.isInteger(body.index) ? body.index : list.length - 1;
      if (i >= 0 && i < list.length) list.splice(i, 1);
    }
    if (list.length) await s.setJSON(key, list.slice(0, 21)); else await s.delete(key);
    return json({ ok: true, week, entries: await allergenWeek(settings, week, s) });
  }

  if (route === 'subscribe' && req.method === 'POST') {
    const sub = body.subscription;
    if (!sub?.endpoint) return json({ error: 'missing subscription' }, 400);
    const id = subId(sub.endpoint);
    await s.setJSON(`sub/${id}`, {
      subscription: sub, name: String(body.name || 'Phone').slice(0, 30), created: Date.now(),
    });
    return json({ ok: true, id });
  }

  if (route === 'unsubscribe' && req.method === 'POST') {
    if (body.id) await s.delete(`sub/${body.id}`);
    return json({ ok: true });
  }

  if (route === 'settings' && req.method === 'PUT') {
    const next = { ...settings };
    if (typeof body.babyName === 'string' && body.babyName.trim())
      next.babyName = body.babyName.trim().slice(0, 30);
    const clean = (arr) => [...new Set(arr.filter(isTime))].sort().slice(0, 24);
    next.schedules = { ...settings.schedules };
    if (body.schedules && typeof body.schedules === 'object') {
      for (const k of SCHEDULES) if (Array.isArray(body.schedules[k])) next.schedules[k] = clean(body.schedules[k]);
    }
    if (Array.isArray(body.times)) next.schedules[settings.active] = clean(body.times);
    if (SCHEDULES.includes(String(body.active))) next.active = String(body.active);
    next.times = next.schedules[next.active];
    if ([0, 5, 10, 15, 20, 30].includes(Number(body.nagMinutes))) next.nagMinutes = Number(body.nagMinutes);
    if (Number.isInteger(body.maxNags) && body.maxNags >= 0 && body.maxNags <= 8) next.maxNags = body.maxNags;
    if (typeof body.notifyOnDone === 'boolean') next.notifyOnDone = body.notifyOnDone;
    if (typeof body.paused === 'boolean') next.paused = body.paused;
    const clockSetting = (cur, v) => (v && typeof v === 'object')
      ? { on: typeof v.on === 'boolean' ? v.on : cur.on, time: isTime(v.time) ? v.time : cur.time }
      : cur;
    next.vitamins = clockSetting(settings.vitamins, body.vitamins);
    next.allergenCheck = clockSetting(settings.allergenCheck, body.allergenCheck);
    if (Array.isArray(body.allergens)) {
      const seen = new Set();
      next.allergens = body.allergens
        .map((a) => String(a).trim().slice(0, 30)).filter(Boolean)
        .filter((a) => !seen.has(slug(a)) && seen.add(slug(a))).slice(0, 20);
    }
    if (Number.isInteger(body.allergenTarget) && body.allergenTarget >= 1 && body.allergenTarget <= 7)
      next.allergenTarget = body.allergenTarget;
    if (typeof body.tz === 'string') {
      try { localNow(body.tz); next.tz = body.tz; } catch {}
    }
    await s.setJSON('settings', next);
    if (next.active !== settings.active) {
      // Let the other phone know the plan for today has changed.
      await pushAll({
        title: `📅 ${next.babyName} is on Schedule ${next.active} now`,
        body: next.times.length
          ? `${String(body.by || 'Someone').slice(0, 30)} switched it. Water reminders: ${next.times.map(prettyTime).join(', ')}`
          : 'No reminder times set for this schedule yet.',
        tag: 'schedule', url: '/',
      }, { except: body.deviceId }, s);
    }
    return json({ ok: true, settings: next });
  }

  // kind: 'water' (needs time) | 'vit' | 'allg'
  const doneKey = () => {
    const kind = body.kind || 'water';
    if (kind === 'vit' || kind === 'allg') return { kind, k: kind };
    return isTime(body.time) ? { kind: 'water', k: slotKey(body.time) } : null;
  };

  if (route === 'done' && req.method === 'POST') {
    const d = doneKey();
    if (!d) return json({ error: 'bad time' }, 400);
    const by = String(body.by || 'Someone').slice(0, 30);
    await s.setJSON(`done/${date}/${d.k}`, { by, at: Date.now() });
    if (settings.notifyOnDone) {
      const n = settings.babyName;
      const msg = d.kind === 'water'
        ? { title: `✅ ${n}'s water is sorted`, body: `${by} ticked off the ${prettyTime(body.time)} water. No need to do anything!` }
        : d.kind === 'vit'
          ? { title: `✅ ${n}'s vitamins are done`, body: `${by} gave today's vitamins. No need to do anything!` }
          : { title: `✅ Allergens logged for today`, body: `${by} has ticked off ${n}'s allergens for today.` };
      await pushAll({ ...msg, tag: `${d.kind}-${date}-${d.k}`, url: d.kind === 'allg' ? '/?tab=allergens' : '/' },
        { except: body.deviceId }, s);
    }
    return json({ ok: true });
  }

  if (route === 'undo' && req.method === 'POST') {
    const d = doneKey();
    if (!d) return json({ error: 'bad time' }, 400);
    await s.delete(`done/${date}/${d.k}`);
    return json({ ok: true });
  }

  if (route === 'test' && req.method === 'POST') {
    const r = await pushAll({
      title: `🦁 Hello from ${settings.babyName}!`,
      body: 'Test reminder – if you can see this, notifications are working 💧',
      tag: 'test', url: '/',
    }, body.deviceId ? { only: body.deviceId } : {}, s);
    return json({ ok: true, ...r });
  }

  if (route === 'reset-defaults' && req.method === 'POST') {
    await s.setJSON('settings', DEFAULT_SETTINGS);
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
};

export const config = { path: '/api/*' };
