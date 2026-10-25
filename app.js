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
  showTab(tab);
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

// ---------- tabs ----------
let tab = LS.get('tab') || 'today';
function showTab(t) {
  tab = t;
  LS.set('tab', t);
  for (const p of ['today', 'allergens', 'settings']) $('#tab-' + p).classList.toggle('hidden', p !== t);
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabbar button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- main view ----------
async function refresh() {
  try {
    state = await api('state');
  } catch (e) {
    if (e.message !== 'unauthorised') toast("Couldn't reach the server – check your connection");
    return;
  }
  // keep viewing an older allergen week if that's where we are
  if (!allgView || allgView.week === state.allergens.week) allgView = state.allergens;
  render();
  syncPush();
}

function statusAt(time, done, windowMin = 120) {
  if (done) return 'done';
  const diff = state.nowMin - toMin(time);
  if (diff < 0) return 'upcoming';
  return diff <= windowMin ? 'due' : 'missed';
}

function render() {
  const { settings } = state;
  document.body.classList.add('has-tabs');
  document.querySelectorAll('.baby').forEach((el) => (el.textContent = settings.babyName));
  document.title = `${settings.babyName}'s Water`;
  $('#todayLabel').textContent = new Date(state.date + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  $('#pausedBanner').classList.toggle('hidden', !settings.paused);

  const slots = state.slots.map((s) => ({ ...s, status: statusAt(s.time, s.done) }));
  const doneCount = slots.filter((s) => s.status === 'done').length;
  const vit = settings.vitamins.on ? { ...state.vit, time: settings.vitamins.time, status: statusAt(settings.vitamins.time, state.vit.done, 180) } : null;
  // the evening check stays "due" until midnight
  const allg = settings.allergenCheck.on ? { ...state.allg, time: settings.allergenCheck.time, status: statusAt(settings.allergenCheck.time, state.allg.done, 24 * 60) } : null;

  // big "due now" cards
  const cards = slots.filter((s) => s.status === 'due').map((s) => `
    <div class="card due" id="due-${s.key}">
      <img src="/icons/icon-192.png" alt="">
      <div class="big" style="margin-top:12px">${pretty(s.time)}</div>
      <p class="who">Water time for ${esc(settings.babyName)}! 💧</p>
      <button class="water" data-kind="water" data-time="${s.time}">✓ Water's ready – Done</button>
    </div>`);
  if (vit?.status === 'due') cards.unshift(`
    <div class="card due" id="due-vit">
      <div class="big" style="font-size:54px">💊</div>
      <p class="who">Vitamin time for ${esc(settings.babyName)}!</p>
      <button class="water" data-kind="vit">✓ Vitamins given – Done</button>
    </div>`);
  if (allg?.status === 'due') cards.push(`
    <div class="card due-soft" style="text-align:center">
      <div style="font-size:44px">🥚🥜🥛</div>
      <p class="who" style="margin:6px 0 14px">Evening allergen check</p>
      <p class="muted" style="margin-bottom:6px">${todaySoFar()}</p>
      <p class="muted small" style="margin-bottom:14px">Tick off anything ${esc(settings.babyName)} had in the tracker, then mark today as done.</p>
      <div class="row2"><button class="soft" data-goto="allergens">Open tracker</button><button data-kind="allg">✓ Mark today done</button></div>
    </div>`);
  $('#dueArea').innerHTML = cards.join('');
  const anyDue = cards.length > 0;

  // water progress
  $('#progressText').textContent = `${doneCount} of ${slots.length} water today`;
  $('#drops').innerHTML = slots.map((s) => `
    <svg class="drop ${s.status === 'done' ? 'full' : ''}" viewBox="0 0 26 32"><path d="M13 2C17 8 24 15 24 21a11 11 0 0 1-22 0C2 15 9 8 13 2Z"/></svg>`).join('');
  const next = slots.find((s) => s.status === 'upcoming');
  $('#nextText').textContent = settings.paused ? 'Reminders paused'
    : next ? `Next water at ${pretty(next.time)}`
    : slots.some((s) => s.status === 'due') ? 'One to do now ↑'
    : doneCount === slots.length ? 'All water done for today 🎉'
    : `${slots.length - doneCount} not ticked off today`;

  // water list
  $('#slots').innerHTML = slots.length ? slots.map((s) => rowHtml({ ...s, kind: 'water', label: pretty(s.time) })).join('')
    : '<div class="card muted">No water times yet – add some in Settings.</div>';

  // extras
  const extras = [];
  if (vit) extras.push(rowHtml({ ...vit, kind: 'vit', label: '💊', sub: `Vitamins · ${pretty(vit.time)}` }));
  if (allg) extras.push(rowHtml({ ...allg, kind: 'allg', label: '🥚', sub: `Allergen check · ${pretty(allg.time)}` }));
  $('#extrasWrap').classList.toggle('hidden', !extras.length);
  $('#extras').innerHTML = extras.join('');

  // week bars (water)
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

  // allergens
  renderAllergens(allg);

  // settings (don't overwrite while the user is editing)
  if (!formDirty && !$('#settingsForm').contains(document.activeElement)) fillSettings();

  // devices
  const mine = LS.get('deviceId');
  $('#devices').innerHTML = state.devices.length ? state.devices.map((d) => `
    <div class="device"><span>📱 ${esc(d.name)}</span><span class="muted small">${d.id === mine ? 'This phone' : ''}</span></div>`).join('')
    : '<p class="muted">No phones yet – tap "Turn on reminders".</p>';

  // opened from a notification?
  const q = new URLSearchParams(location.search);
  if (q.get('tab')) showTab(q.get('tab'));
  if (q.get('due')) { showTab('today'); setTimeout(() => $('#due-' + q.get('due'))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }
  if (location.search) history.replaceState(null, '', '/');

  // clear the red badge on the icon if nothing is waiting
  if (!anyDue && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
}

// One row in the Today lists (water slot, vitamins or allergen check)
function rowHtml(r) {
  const attrs = `data-kind="${r.kind}"${r.time && r.kind === 'water' ? ` data-time="${r.time}"` : ''}`;
  let right = '', text = '';
  if (r.status === 'done') {
    text = `Done by ${esc(r.done.by)} at ${clock(r.done.at)}`;
    right = `<div class="tick">✓</div>`;
  } else if (r.status === 'upcoming') {
    text = 'Coming up';
    right = `<button class="soft mini" ${attrs}>Done early</button>`;
  } else if (r.status === 'due') {
    text = r.sent ? `Reminded ${r.sent.count} time${r.sent.count > 1 ? 's' : ''}` : 'Due now';
    right = `<button class="water mini" ${attrs}>Done</button>`;
  } else {
    text = 'Not ticked off';
    right = `<button class="soft mini" ${attrs}>Mark done</button>`;
  }
  const undo = r.status === 'done' ? ` · <button class="ghost small" style="padding:0;font-size:14px" data-undo ${attrs}>undo</button>` : '';
  return `<div class="card slot is-${r.status}">
    <div class="time">${r.label}</div>
    <div class="info">${r.sub ? `<div><b>${r.sub}</b></div>` : ''}<div class="state">${text}${undo}</div></div>
    ${right}
  </div>`;
}

const DONE_TOAST = {
  water: (n) => `🦁 Thanks! ${n}'s water is ticked off`,
  vit: (n) => `💊 ${n}'s vitamins are ticked off`,
  allg: () => `🥚 Today's allergen check is done`,
};

document.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) return showTab(go.dataset.goto);
  const el = e.target.closest('[data-kind]');
  if (!el || el.closest('#tabbar') || sending) return;
  const body = { kind: el.dataset.kind, time: el.dataset.time, by: LS.get('name'), deviceId: LS.get('deviceId') };
  sending = true;
  el.disabled = true;
  try {
    if (el.hasAttribute('data-undo')) {
      await api('undo', { method: 'POST', body });
    } else {
      await api('done', { method: 'POST', body });
      if (navigator.vibrate) navigator.vibrate(30);
      toast(DONE_TOAST[body.kind](state.settings.babyName));
    }
    await refresh();
  } catch (x) { toast(x.message); el.disabled = false; }
  sending = false;
});

// ---------- allergens ----------
let allgView = null;
let allgBusy = false;
const dayShort = (d) => new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short' }).slice(0, 3);
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// e.g. "Ticked today: Egg, Peanut" or "Nothing ticked off yet today"
function todaySoFar() {
  const entries = state.allergens.entries;
  const names = state.settings.allergens.filter((a) => (entries[a] || []).some((e) => e.date === state.date));
  return names.length ? `Ticked today: ${names.map(esc).join(', ')}` : 'Nothing ticked off yet today';
}

function renderAllergens(allg) {
  const { settings } = state;
  const target = settings.allergenTarget;
  const view = allgView;
  const isThisWeek = view.week === state.allergens.week;
  const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' });
  $('#weekLabel').textContent = isThisWeek ? 'This week' : view.week === addDays(state.allergens.week, -7) ? 'Last week' : `Week of ${fmt(view.week)}`;
  const met = settings.allergens.filter((a) => (view.entries[a] || []).length >= target).length;
  $('#weekSub').textContent = `${fmt(view.week)} – ${fmt(addDays(view.week, 6))} · ${met} of ${settings.allergens.length} at ${target}+`;
  $('#ameterFill').style.width = `${settings.allergens.length ? (met / settings.allergens.length) * 100 : 0}%`;
  $('#weekNext').disabled = isThisWeek;

  $('#allgTable').innerHTML = settings.allergens.length ? settings.allergens.map((name) => {
    const list = view.entries[name] || [];
    const n = Math.max(target, list.length);
    let boxes = '';
    for (let i = 0; i < n; i++) {
      const en = list[i];
      boxes += en
        ? `<button type="button" class="box on ${en.date === state.date ? 'today' : ''}" data-allg="${esc(name)}" data-rm="${i}" aria-label="Remove ${esc(name)} tick">${en.date ? dayShort(en.date) : '<span class="ck">✓</span>'}</button>`
        : `<button type="button" class="box" data-allg="${esc(name)}" aria-label="Tick ${esc(name)}"></button>`;
    }
    if (list.length >= target) boxes += `<button type="button" class="box more" data-allg="${esc(name)}" aria-label="Add another ${esc(name)}">+</button>`;
    const done = list.length >= target;
    return `<div class="arow ${done ? 'met' : ''}">
      <div class="aname">${esc(name)}<span class="cnt">${done ? `✓ ${list.length} this week` : `${list.length} of ${target}`}</span></div>
      <div class="boxes">${boxes}</div>
    </div>`;
  }).join('') : '<p class="muted">No allergens yet – add some in Settings.</p>';

  // evening check banner (only on this week)
  const showBanner = isThisWeek && !!allg;
  $('#allgBanner').classList.toggle('hidden', !showBanner);
  if (showBanner) {
    const lead = allg.status === 'upcoming'
      ? `Finished for today? Mark it done now and the ${pretty(allg.time)} reminder won't go off.`
      : `Tick anything ${esc(settings.babyName)} had today, then mark today as done so the other phone knows.`;
    $('#allgBanner').innerHTML = allg.done
      ? `<b>✓ Today marked as done</b><p class="muted small">By ${esc(allg.done.by)} at ${clock(allg.done.at)} · ${todaySoFar()}
         · <button class="ghost small" style="padding:0;font-size:14px" data-undo data-kind="allg">undo</button></p>`
      : `<b>Evening check · ${pretty(allg.time)}</b><p style="margin:4px 0 2px">${todaySoFar()}</p>
         <p class="muted small" style="margin-bottom:12px">${lead}</p>
         <button data-kind="allg">✓ Mark today done</button>`;
  }
  $('#allgDot').classList.toggle('hidden', !(allg && allg.status === 'due'));
}

$('#allgTable').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-allg]');
  if (!b || allgBusy) return;
  allgBusy = true;
  b.disabled = true;
  const remove = b.dataset.rm != null;
  try {
    const r = await api('allergen', {
      method: 'POST',
      body: { name: b.dataset.allg, week: allgView.week, action: remove ? 'remove' : 'add', index: remove ? Number(b.dataset.rm) : undefined, by: LS.get('name') },
    });
    allgView = { week: r.week, entries: r.entries };
    if (r.week === state.allergens.week) state.allergens = allgView;
    if (!remove && navigator.vibrate) navigator.vibrate(20);
    renderAllergens(state.settings.allergenCheck.on ? { ...state.allg, time: state.settings.allergenCheck.time, status: statusAt(state.settings.allergenCheck.time, state.allg.done, 24 * 60) } : null);
  } catch (x) { toast(x.message); }
  allgBusy = false;
});

async function loadWeek(week) {
  try {
    allgView = await api('allergens?week=' + week);
    render();
  } catch (x) { toast(x.message); }
}
$('#weekPrev').onclick = () => loadWeek(addDays(allgView.week, -7));
$('#weekNext').onclick = () => loadWeek(addDays(allgView.week, 7));

// ---------- settings ----------
function timeRow(value = '') {
  const row = document.createElement('div');
  row.className = 'timerow';
  row.innerHTML = `<input type="time" value="${value}" required><button type="button" class="x" aria-label="Remove">×</button>`;
  row.querySelector('.x').onclick = () => row.remove();
  return row;
}
function allgRow(value = '') {
  const row = document.createElement('div');
  row.className = 'timerow xrow';
  row.innerHTML = `<input type="text" maxlength="30" placeholder="e.g. Kiwi"><button type="button" class="x" aria-label="Remove">×</button>`;
  row.querySelector('input').value = value;
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
    : `Editing Schedule ${k} – switch to it on the Today tab when you need it.`;
}
function fillSettings() {
  const s = state.settings;
  $('#babyIn').value = s.babyName;
  draft = { 1: [...s.schedules['1']], 2: [...s.schedules['2']] };
  showEditTab(formDirty ? editing : s.active);
  $('#vitOn').checked = s.vitamins.on;
  $('#vitTime').value = s.vitamins.time;
  $('#allgOn').checked = s.allergenCheck.on;
  $('#allgTime').value = s.allergenCheck.time;
  $('#targetIn').value = String(s.allergenTarget);
  $('#allgRows').replaceChildren(...s.allergens.map((a) => allgRow(a)));
  $('#nagIn').value = String(s.nagMinutes);
  $('#maxIn').value = String(s.maxNags);
  $('#maxIn').disabled = s.nagMinutes === 0;
  $('#notifyDoneIn').checked = s.notifyOnDone;
  $('#pausedIn').checked = s.paused;
  formDirty = false;
}
document.querySelectorAll('#editSwitch button').forEach((b) => (b.onclick = () => {
  draft[editing] = rowTimes();
  showEditTab(b.dataset.edit);
}));
$('#settingsForm').addEventListener('input', () => (formDirty = true));
$('#settingsForm').addEventListener('click', (e) => { if (e.target.closest('.x, #addTime, #addAllg, #editSwitch')) formDirty = true; });

// The big switch on the Today tab
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
$('#addAllg').onclick = () => {
  const r = allgRow('');
  $('#allgRows').append(r);
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
        vitamins: { on: $('#vitOn').checked, time: $('#vitTime').value },
        allergenCheck: { on: $('#allgOn').checked, time: $('#allgTime').value },
        allergenTarget: Number($('#targetIn').value),
        allergens: [...$('#allgRows').querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean),
        nagMinutes: Number($('#nagIn').value),
        maxNags: Number($('#maxIn').value),
        notifyOnDone: $('#notifyDoneIn').checked,
        paused: $('#pausedIn').checked,
      },
    });
    document.activeElement?.blur();
    toast('Saved – both phones will use these settings');
    formDirty = false;
    allgView = null;
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
