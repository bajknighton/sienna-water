// Sienna's Water – front end
const $ = (s) => document.querySelector(s);
const LS = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let state = null;
let sending = false;

// ---------- helpers ----------
function show(id) {
  for (const v of ['v-install', 'v-setup', 'v-main']) $('#' + v).classList.toggle('hidden', v !== id);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function pretty(t) {
  let [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
}
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api/' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-family-code': LS.get('code') || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'setup') { LS.del('code'); start(); throw new Error('unauthorised'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// ---------- start-up ----------
async function start() {
  if (isIOS && !standalone && !LS.get('skipInstall')) return show('v-install');
  if (!LS.get('code') || !LS.get('name')) return showSetup();
  show('v-main');
  await refresh();
}

$('#skipInstall').onclick = () => { LS.set('skipInstall', '1'); start(); };

async function showSetup() {
  show('v-setup');
  $('#nameIn').value = LS.get('name') || '';
  try {
    const { hasCode } = await api('status');
    if (hasCode) {
      $('#setupTitle').textContent = 'Join your family';
      $('#setupLead').textContent = 'Enter the family code you chose on the first phone.';
      $('#codeHint').textContent = '';
    } else {
      $('#setupTitle').textContent = 'Welcome!';
      $('#setupLead').textContent = "You're the first phone. Pick a family code to share with your partner.";
      $('#codeHint').textContent = 'Pick something memorable (at least 4 characters). Your partner types the same code on their phone.';
    }
  } catch {}
}

$('#setupForm').onsubmit = async (e) => {
  e.preventDefault();
  const code = $('#codeIn').value.trim();
  const name = $('#nameIn').value.trim();
  const err = $('#setupErr');
  err.classList.add('hidden');
  if (!name) { err.textContent = 'Please add your name'; return err.classList.remove('hidden'); }
  try {
    await api('setup', { method: 'POST', body: { code } });
    LS.set('code', code);
    LS.set('name', name);
    start();
  } catch (x) {
    err.textContent = x.message;
    err.classList.remove('hidden');
  }
};

// ---------- main view ----------
async function refresh() {
  try {
    state = await api('state');
  } catch (e) {
    if (e.message !== 'unauthorised') toast("Couldn't reach the server – check your connection");
    return;
  }
  render();
  syncPush();
}

function slotStatus(slot) {
  if (slot.done) return 'done';
  const diff = state.nowMin - toMin(slot.time);
  if (diff < 0) return 'upcoming';
  return diff <= 120 ? 'due' : 'missed';
}

function render() {
  const { settings } = state;
  document.querySelectorAll('.baby').forEach((el) => (el.textContent = settings.babyName));
  document.title = `${settings.babyName}'s Water`;
  $('#todayLabel').textContent = new Date(state.date + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  $('#pausedBanner').classList.toggle('hidden', !settings.paused);

  const slots = state.slots.map((s) => ({ ...s, status: slotStatus(s) }));
  const doneCount = slots.filter((s) => s.status === 'done').length;

  // big "due now" cards
  const due = slots.filter((s) => s.status === 'due');
  $('#dueArea').innerHTML = due.map((s) => `
    <div class="card due" id="due-${s.key}">
      <img src="/icons/icon-192.png" alt="">
      <div class="big" style="margin-top:12px">${pretty(s.time)}</div>
      <p class="who">Water time for ${esc(settings.babyName)}! 💧</p>
      <button class="water" data-done="${s.time}">✓ Water's ready – Done</button>
    </div>`).join('');

  // progress
  $('#progressText').textContent = `${doneCount} of ${slots.length} today`;
  $('#drops').innerHTML = slots.map((s) => `
    <svg class="drop ${s.status === 'done' ? 'full' : ''}" viewBox="0 0 26 32"><path d="M13 2C17 8 24 15 24 21a11 11 0 0 1-22 0C2 15 9 8 13 2Z"/></svg>`).join('');
  const next = slots.find((s) => s.status === 'upcoming');
  $('#nextText').textContent = settings.paused ? 'Reminders paused'
    : next ? `Next reminder at ${pretty(next.time)}`
    : due.length ? 'One to do now ↑' : 'All done for today 🎉';

  // slot list
  $('#slots').innerHTML = slots.length ? slots.map((s) => {
    let right = '', state_ = '';
    if (s.status === 'done') {
      state_ = `Done by ${esc(s.done.by)} at ${clock(s.done.at)}`;
      right = `<div class="tick">✓</div>`;
    } else if (s.status === 'upcoming') {
      state_ = 'Coming up';
      right = `<button class="soft mini" data-done="${s.time}">Done early</button>`;
    } else if (s.status === 'due') {
      state_ = s.sent ? `Reminded ${s.sent.count} time${s.sent.count > 1 ? 's' : ''}` : 'Due now';
      right = `<button class="water mini" data-done="${s.time}">Done</button>`;
    } else {
      state_ = 'Not ticked off';
      right = `<button class="soft mini" data-done="${s.time}">Mark done</button>`;
    }
    const undo = s.status === 'done' ? ` · <button class="ghost small" style="padding:0;font-size:14px" data-undo="${s.time}">undo</button>` : '';
    return `<div class="card slot is-${s.status}">
      <div class="time">${pretty(s.time)}</div>
      <div class="info"><div class="state">${state_}${undo}</div></div>
      ${right}
    </div>`;
  }).join('') : '<div class="card muted">No reminder times yet – add some in Settings below.</div>';

  // week
  const total = Math.max(slots.length, 1);
  $('#week').innerHTML = state.week.map((w) => {
    const pct = Math.min(100, Math.round((w.done / total) * 100));
    const d = new Date(w.date + 'T12:00:00').toLocaleDateString([], { weekday: 'narrow' });
    return `<div><div class="bar"><div class="fill" style="height:${pct}%"></div></div><div class="d">${d} · ${w.done}</div></div>`;
  }).join('');

  // schedule switch
  document.querySelectorAll('#schedSwitch button').forEach((b) => {
    const on = b.dataset.sched === settings.active;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  $('#schedTimes').textContent = settings.times.map(pretty).join(' · ');

  // settings (don't overwrite while the user is editing)
  if (!formDirty && !$('#settingsForm').contains(document.activeElement)) fillSettings();

  // devices
  const mine = LS.get('deviceId');
  $('#devices').innerHTML = state.devices.length ? state.devices.map((d) => `
    <div class="device"><span>📱 ${esc(d.name)}</span><span class="muted small">${d.id === mine ? 'This phone' : ''}</span></div>`).join('')
    : '<p class="muted">No phones yet – tap "Turn on reminders" above.</p>';

  // opened from a notification? scroll to that card
  const want = new URLSearchParams(location.search).get('due');
  if (want && $('#due-' + want)) { $('#due-' + want).scrollIntoView({ behavior: 'smooth', block: 'center' }); history.replaceState(null, '', '/'); }

  // clear the red badge on the icon if nothing is waiting
  if (!due.length && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
}

document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-done]');
  const u = e.target.closest('[data-undo]');
  if (d && !sending) {
    sending = true;
    d.disabled = true;
    try {
      await api('done', { method: 'POST', body: { time: d.dataset.done, by: LS.get('name'), deviceId: LS.get('deviceId') } });
      if (navigator.vibrate) navigator.vibrate(30);
      toast(`🦁 Thanks! ${state.settings.babyName}'s water is ticked off`);
      await refresh();
    } catch (x) { toast(x.message); d.disabled = false; }
    sending = false;
  }
  if (u) {
    await api('undo', { method: 'POST', body: { time: u.dataset.undo } }).catch((x) => toast(x.message));
    refresh();
  }
});

// ---------- settings ----------
function timeRow(value = '') {
  const row = document.createElement('div');
  row.className = 'timerow';
  row.innerHTML = `<input type="time" value="${value}" required><button type="button" class="x" aria-label="Remove">×</button>`;
  row.querySelector('.x').onclick = () => row.remove();
  return row;
}
// Times being edited for each schedule (kept until Save).
let draft = { 1: [], 2: [] };
let editing = '1';
let formDirty = false;

const rowTimes = () => [...$('#timeRows').querySelectorAll('input')].map((i) => i.value).filter(Boolean);
function showEditTab(k) {
  editing = k;
  document.querySelectorAll('#editSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.edit === k));
  $('#timeRows').replaceChildren(...draft[k].map((t) => timeRow(t)));
  $('#editNote').textContent = k === state.settings.active
    ? `Schedule ${k} is the one in use today.`
    : `Editing Schedule ${k} – switch to it at the top when you need it.`;
}
function fillSettings() {
  const s = state.settings;
  $('#babyIn').value = s.babyName;
  draft = { 1: [...s.schedules['1']], 2: [...s.schedules['2']] };
  showEditTab(formDirty ? editing : s.active);
  $('#nagIn').value = String(s.nagMinutes);
  $('#maxIn').value = String(s.maxNags);
  $('#notifyDoneIn').checked = s.notifyOnDone;
  $('#pausedIn').checked = s.paused;
  formDirty = false;
}
document.querySelectorAll('#editSwitch button').forEach((b) => (b.onclick = () => {
  draft[editing] = rowTimes();
  showEditTab(b.dataset.edit);
}));
$('#settingsForm').addEventListener('input', () => (formDirty = true));
$('#settingsForm').addEventListener('click', (e) => { if (e.target.closest('.x, #addTime, #editSwitch')) formDirty = true; });

// The big switch at the top
document.querySelectorAll('#schedSwitch button').forEach((b) => (b.onclick = async () => {
  const k = b.dataset.sched;
  if (!state || k === state.settings.active) return;
  document.querySelectorAll('#schedSwitch button').forEach((x) => x.classList.toggle('on', x === b));
  try {
    await api('settings', { method: 'PUT', body: { active: k, by: LS.get('name'), deviceId: LS.get('deviceId') } });
    toast(`📅 Switched to Schedule ${k} on both phones`);
    if (navigator.vibrate) navigator.vibrate(20);
  } catch (x) { toast(x.message); }
  await refresh();
}));

$('#addTime').onclick = () => {
  const r = timeRow('12:00');
  $('#timeRows').append(r);
  r.querySelector('input').focus();
};
$('#settingsForm').onsubmit = async (e) => {
  e.preventDefault();
  draft[editing] = rowTimes();
  $('#saveBtn').disabled = true;
  try {
    await api('settings', {
      method: 'PUT',
      body: {
        babyName: $('#babyIn').value,
        schedules: draft,
        nagMinutes: Number($('#nagIn').value),
        maxNags: Number($('#maxIn').value),
        notifyOnDone: $('#notifyDoneIn').checked,
        paused: $('#pausedIn').checked,
      },
    });
    document.activeElement?.blur();
    toast('Saved – both phones will use these times');
    formDirty = false;
    await refresh();
    fillSettings();
  } catch (x) { toast(x.message); }
  $('#saveBtn').disabled = false;
};
$('#nagIn').onchange = () => { $('#maxIn').disabled = $('#nagIn').value === '0'; };

// ---------- notifications ----------
async function getReg() {
  return navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
}

async function syncPush() {
  const card = $('#notifCard');
  if (!pushSupported) {
    card.classList.remove('hidden');
    $('#enableBtn').classList.add('hidden');
    $('#notifText').textContent = isIOS
      ? 'To get reminders, open this from your Home Screen (Share → Add to Home Screen). Needs iOS 16.4 or later.'
      : "This browser can't receive reminders.";
    return;
  }
  const reg = await getReg();
  const sub = await reg.pushManager.getSubscription();
  const known = state.devices.some((d) => d.id === LS.get('deviceId'));
  if (Notification.permission === 'granted' && sub && known) return card.classList.add('hidden');
  if (Notification.permission === 'granted') {
    // Permission already given – quietly (re)register this phone.
    try { await subscribe(reg); return card.classList.add('hidden'); } catch {}
  }
  card.classList.remove('hidden');
  if (Notification.permission === 'denied') {
    $('#enableBtn').classList.add('hidden');
    $('#notifText').textContent = 'Notifications are blocked. Go to iPhone Settings → Notifications → Sienna\'s Water and allow them, then reopen the app.';
  }
}

async function subscribe(reg) {
  let sub = await reg.pushManager.getSubscription();
  const key = b64ToBytes(state.publicKey);
  if (sub) {
    // If the server's key changed, start fresh.
    const cur = sub.options?.applicationServerKey;
    if (cur && new Uint8Array(cur).toString() !== key.toString()) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const { id } = await api('subscribe', { method: 'POST', body: { subscription: sub.toJSON(), name: LS.get('name') } });
  LS.set('deviceId', id);
}

$('#enableBtn').onclick = async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return syncPush();
    await subscribe(await getReg());
    toast('🔔 Reminders are on for this phone');
    await refresh();
  } catch (x) { toast('Could not turn on reminders: ' + x.message); }
};

$('#testBtn').onclick = async () => {
  if (!LS.get('deviceId')) return toast('Turn on reminders first');
  const r = await api('test', { method: 'POST', body: { deviceId: LS.get('deviceId') } }).catch((x) => toast(x.message));
  if (r) toast(r.sent ? 'Test sent – lock your phone to see it' : "Couldn't send – try turning reminders off and on");
};

$('#offBtn').onclick = async () => {
  const id = LS.get('deviceId');
  if (id) await api('unsubscribe', { method: 'POST', body: { id } }).catch(() => {});
  try { const reg = await getReg(); const s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch {}
  LS.del('deviceId');
  toast('Reminders turned off on this phone');
  refresh();
};

$('#signOut').onclick = () => { LS.del('code'); showSetup(); };

// keep it fresh
document.addEventListener('visibilitychange', () => { if (!document.hidden && state) refresh(); });
setInterval(() => { if (!document.hidden && state) refresh(); }, 60000);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'refresh' && state) refresh(); });
}

start();
