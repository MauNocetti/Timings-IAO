import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BOSSES } from './bosses.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, CLAN_EMAIL, APP_TITLE } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const HISTORY_SHOWN = 5;
const MIN = 60000;

let history = {}; // bossId -> filas ordenadas de mas nueva a mas vieja
let nick = localStorage.getItem('iao_nick') || '';
let sortMode = 'next';
let onlySoon = false;
const cards = new Map();

/* =========================== utilidades =========================== */

const pad = (n) => String(n).padStart(2, '0');

function dur(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600),
    m = Math.floor((t % 3600) / 60),
    s = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ddmm = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

function humanRange(min, max) {
  const fmt = (v) => {
    const h = Math.floor(v / 60),
      m = v % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  };
  return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

/** Estado de un boss a partir de su ultimo registro. */
function calc(boss) {
  const last = (history[boss.id] || [])[0];
  if (!last) return { status: 'unknown' };

  const base = new Date(last.killed_at).getTime();
  const from = base + boss.min * MIN;
  const to = base + boss.max * MIN;
  const now = Date.now();

  if (now < from) return { status: 'pending', last, base, from, to, ms: from - now };
  if (now <= to) return { status: 'window', last, base, from, to, ms: to - now };
  return { status: 'over', last, base, from, to, ms: now - to };
}

const RANK = { window: 0, over: 1, pending: 2, unknown: 3 };

function ordered() {
  const rows = BOSSES.map((b) => ({ b, c: calc(b) }));
  if (sortMode === 'name') {
    rows.sort((x, y) => x.b.name.localeCompare(y.b.name, 'es'));
  } else {
    rows.sort((x, y) => {
      const d = RANK[x.c.status] - RANK[y.c.status];
      if (d) return d;
      if (x.c.status === 'unknown') return x.b.name.localeCompare(y.b.name, 'es');
      return x.c.ms - y.c.ms;
    });
  }
  return rows;
}

/* =========================== datos =========================== */

async function loadAll() {
  const { data, error } = await sb.from('kills').select('*').order('killed_at', { ascending: false }).limit(600);

  if (error) {
    setStatus('Error al leer', false);
    console.error(error);
    return;
  }

  history = {};
  for (const row of data) (history[row.boss_id] ||= []).push(row);
  refresh();
}

async function register(bossId, when, kind = 'kill') {
  const { error } = await sb.from('kills').insert({
    boss_id: bossId,
    killed_at: new Date(when).toISOString(),
    by_nick: nick || 'anonimo',
    kind,
  });
  if (error) {
    console.error(error);
    setStatus('No se pudo guardar', false);
    return;
  }
  await loadAll();
}

async function undoLast(bossId) {
  const last = (history[bossId] || [])[0];
  if (!last) return;
  const { error } = await sb.from('kills').delete().eq('id', last.id);
  if (error) {
    console.error(error);
    setStatus('No se pudo deshacer', false);
    return;
  }
  await loadAll();
}

function setStatus(text, live) {
  const el = $('status');
  el.textContent = text;
  el.dataset.state = live ? 'live' : 'off';
}

/* =========================== construccion de tarjetas =========================== */

function buildCards() {
  const grid = $('grid');
  grid.innerHTML = '';
  cards.clear();

  if (!BOSSES.length) {
    $('empty').hidden = false;
    return;
  }
  $('empty').hidden = true;

  for (const boss of BOSSES) {
    const el = document.createElement('article');
    el.className = 'card';

    const sprite = boss.img
      ? `<img class="sprite" src="${boss.img}" alt="" loading="lazy">`
      : `<div class="sprite" aria-hidden="true">${boss.name.charAt(0)}</div>`;

    el.innerHTML = `
      <div class="card-top">
        ${sprite}
        <div>
          <div class="card-name"></div>
          <div class="card-resp"></div>
        </div>
      </div>

      <div class="count-label"></div>
      <div class="count"></div>

      <div class="window-box">
        <small>Aparece</small>
        <span class="window-val"></span>
      </div>

      <div class="card-foot">
        <div class="inputs">
          <input type="time" step="60" aria-label="Hora de la muerte">
          <input type="date" aria-label="Fecha de la muerte">
        </div>
        <div class="acts">
          <button class="btn btn-fill" data-act="reg">Registrar</button>
          <button class="btn" data-act="now">Ahora</button>
          <button class="btn btn-ghost btn-wide" data-act="undo">Deshacer último cambio</button>
          <button class="btn btn-warn btn-wide" data-act="missed">Spawn perdido</button>
        </div>
        <p class="by"></p>
        <details>
          <summary>Últimos ${HISTORY_SHOWN} guardados</summary>
          <ul class="hist"></ul>
        </details>
      </div>`;

    const refs = {
      el,
      name: el.querySelector('.card-name'),
      resp: el.querySelector('.card-resp'),
      label: el.querySelector('.count-label'),
      count: el.querySelector('.count'),
      window: el.querySelector('.window-val'),
      time: el.querySelector('input[type=time]'),
      date: el.querySelector('input[type=date]'),
      undo: el.querySelector('[data-act=undo]'),
      missed: el.querySelector('[data-act=missed]'),
      by: el.querySelector('.by'),
      hist: el.querySelector('.hist'),
    };

    refs.name.textContent = boss.name;
    refs.resp.textContent = (boss.zone ? boss.zone + ' · ' : '') + humanRange(boss.min, boss.max);

    const now = new Date();
    refs.time.value = hhmm(now);
    refs.date.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    el.querySelector('[data-act=reg]').onclick = () => {
      if (!refs.time.value || !refs.date.value) return;
      const when = new Date(`${refs.date.value}T${refs.time.value}:00`);
      if (isNaN(when)) return;
      register(boss.id, when.getTime());
    };
    el.querySelector('[data-act=now]').onclick = () => register(boss.id, Date.now());
    refs.undo.onclick = () => {
      const last = (history[boss.id] || [])[0];
      if (!last) return;
      const d = new Date(last.killed_at);
      if (confirm(`Borrar el registro de ${boss.name} de las ${hhmm(d)} del ${ddmm(d)}?`)) {
        undoLast(boss.id);
      }
    };
    refs.missed.onclick = () => {
      const c = calc(boss);
      if (c.status === 'unknown') return;
      // No lo vimos aparecer: tomamos el cierre de la ventana perdida como
      // nueva referencia y recalculamos desde ahi.
      register(boss.id, c.to, 'missed');
    };

    grid.appendChild(el);
    cards.set(boss.id, refs);
  }
}

/* =========================== refresco =========================== */

function refresh() {
  const rows = ordered();

  rows.forEach(({ b, c }, i) => {
    const r = cards.get(b.id);
    if (!r) return;

    r.el.style.order = i;
    r.el.classList.toggle('is-window', c.status === 'window');
    r.el.classList.toggle('is-over', c.status === 'over');
    r.count.classList.toggle('sm', c.status === 'unknown');

    if (c.status === 'unknown') {
      r.label.textContent = 'Sin datos';
      r.count.textContent = 'Nunca registrado';
      r.window.textContent = '—';
      r.by.textContent = '';
      r.undo.disabled = true;
      r.missed.disabled = true;
      r.hist.innerHTML = '';
      r.el.hidden = onlySoon;
      return;
    }

    r.undo.disabled = false;
    r.missed.disabled = false;

    if (c.status === 'pending') {
      r.label.textContent = 'Falta';
      r.count.textContent = dur(c.ms);
    } else if (c.status === 'window') {
      r.label.textContent = 'Ventana abierta · cierra en';
      r.count.textContent = dur(c.ms);
    } else {
      r.label.textContent = 'Ventana vencida hace';
      r.count.textContent = dur(c.ms);
    }

    const f = new Date(c.from),
      t = new Date(c.to);
    r.window.textContent = b.min === b.max ? hhmm(f) : `${hhmm(f)} a ${hhmm(t)}`;

    const d = new Date(c.base);
    const tag = c.last.kind === 'missed' ? 'spawn perdido' : 'muerto';
    r.by.textContent = `Último registro: ${tag} ${hhmm(d)} del ${ddmm(d)} · ${c.last.by_nick}`;

    r.hist.innerHTML = '';
    for (const row of (history[b.id] || []).slice(0, HISTORY_SHOWN)) {
      const rd = new Date(row.killed_at);
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = `${hhmm(rd)} · ${ddmm(rd)}`;
      const right = document.createElement('span');
      right.textContent = row.by_nick;
      if (row.kind === 'missed') right.className = 'tag';
      li.append(left, right);
      r.hist.appendChild(li);
    }

    r.el.hidden = onlySoon && c.status === 'pending' && c.ms > 30 * MIN;
  });

  // Mantener los inputs en sincronia con el ultimo registro, sin pisar lo que
  // el usuario este tipeando en ese momento.
  for (const { b } of rows) {
    const r = cards.get(b.id);
    const last = (history[b.id] || [])[0];
    if (!r || !last) continue;
    const d = new Date(last.killed_at);
    if (document.activeElement !== r.time) r.time.value = hhmm(d);
    if (document.activeElement !== r.date) {
      r.date.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
  }
}

/* =========================== auth =========================== */

async function doLogin() {
  const pass = $('pass').value;
  if (!pass) return $('pass').focus();

  $('enter').disabled = true;
  $('loginMsg').textContent = '';

  const { error } = await sb.auth.signInWithPassword({ email: CLAN_EMAIL, password: pass });

  $('enter').disabled = false;
  if (error) {
    console.error('[login]', error);
    const m = (error.message || '').toLowerCase();
    let text;

    if (m.includes('invalid login credentials')) {
      text =
        `Contraseña incorrecta, o no existe la cuenta ${CLAN_EMAIL}. ` +
        'Verificá que ese email sea exactamente el de Authentication → Users.';
    } else if (m.includes('email not confirmed')) {
      text =
        'La cuenta existe pero está sin confirmar. En Supabase: ' +
        'Authentication → Users → tu usuario → Confirm email.';
    } else if (m.includes('email logins are disabled') || m.includes('provider is not enabled')) {
      text = 'El login por email está desactivado. Activalo en ' + 'Authentication → Sign In / Providers → Email.';
    } else if (m.includes('failed to fetch') || m.includes('networkerror')) {
      text = 'No hay conexión con Supabase. Revisá SUPABASE_URL y la clave en config.js.';
    } else if (m.includes('rate limit') || m.includes('too many')) {
      text = 'Demasiados intentos seguidos. Esperá un minuto y probá de nuevo.';
    } else {
      text = error.message;
    }

    $('loginMsg').textContent = text;
    $('pass').select();
    return;
  }
  $('pass').value = '';
  await startApp();
}

async function startApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('appTitle').textContent = APP_TITLE;
  $('nick').value = nick;

  buildCards();
  await loadAll();

  sb.channel('kills-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kills' }, loadAll)
    .subscribe((s) => setStatus(s === 'SUBSCRIBED' ? 'En vivo' : 'Reconectando', s === 'SUBSCRIBED'));

  setInterval(refresh, 1000);
  setInterval(loadAll, 60000); // red de seguridad si se cae el websocket
}

/* =========================== arranque =========================== */

$('enter').onclick = doLogin;
$('pass').onkeydown = (e) => {
  if (e.key === 'Enter') doLogin();
};

$('logout').onclick = async () => {
  await sb.auth.signOut();
  location.reload();
};

$('nick').onchange = (e) => {
  nick = e.target.value.trim();
  localStorage.setItem('iao_nick', nick);
};

$('sortNext').onclick = () => {
  sortMode = 'next';
  $('sortNext').setAttribute('aria-pressed', 'true');
  $('sortName').setAttribute('aria-pressed', 'false');
  refresh();
};
$('sortName').onclick = () => {
  sortMode = 'name';
  $('sortName').setAttribute('aria-pressed', 'true');
  $('sortNext').setAttribute('aria-pressed', 'false');
  refresh();
};
$('onlySoon').onclick = () => {
  onlySoon = !onlySoon;
  $('onlySoon').setAttribute('aria-pressed', String(onlySoon));
  refresh();
};

(async function boot() {
  const { data } = await sb.auth.getSession();
  if (data.session) await startApp();
  else $('loginView').hidden = false;
})();
