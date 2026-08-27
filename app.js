import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BOSSES } from './bosses.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, CLAN_EMAIL, APP_TITLE, IMG_DIR, IMG_EXT } from './config.js';

// El cliente arma las rutas (/auth/v1, /rest/v1, /realtime/v1) sobre la URL
// base, asi que si le pasan una URL con ruta incluida se duplica y devuelve
// 404. Nos quedamos siempre con el origen.
const BASE_URL = (() => {
  try {
    const u = new URL(SUPABASE_URL);
    if (u.pathname !== '/' && u.pathname !== '') {
      console.warn(
        `[config] SUPABASE_URL tenia la ruta "${u.pathname}" y se ignoro. ` +
        `Usá solo ${u.origin}`
      );
    }
    return u.origin;
  } catch {
    console.error('[config] SUPABASE_URL no es una URL valida:', SUPABASE_URL);
    return SUPABASE_URL;
  }
})();

const sb = createClient(BASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

const HISTORY_SHOWN = 5;
const TODOS = '__todos__';

let history = {};                 // bossId -> filas de mas nueva a mas vieja
let nick = localStorage.getItem('iao_nick') || '';
let sortMode = 'next';
let onlySoon = false;
let dungeon = localStorage.getItem('iao_dungeon') || TODOS;
const cards = new Map();

/* =========================== duraciones =========================== */

/** Acepta '33m 20s', '6h 30m', '2h', 45 (minutos). Devuelve segundos. */
function toSeconds(v) {
  if (typeof v === 'number') return Math.round(v * 60);

  const txt = String(v).trim().toLowerCase();
  const re = /(\d+(?:[.,]\d+)?)\s*([hms])/g;
  const mult = { h: 3600, m: 60, s: 1 };
  let m, total = 0, found = false;

  while ((m = re.exec(txt))) {
    found = true;
    total += parseFloat(m[1].replace(',', '.')) * mult[m[2]];
  }
  if (found) return Math.round(total);

  const plain = parseFloat(txt.replace(',', '.'));
  if (!isNaN(plain)) return Math.round(plain * 60);

  console.error(`[bosses] Duracion invalida: "${v}"`);
  return 0;
}

function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = [];
  if (h) p.push(h + 'h');
  if (m) p.push(m + 'm');
  if (s) p.push(s + 's');
  return p.join(' ') || '0s';
}

/** "Gran Dragón Verde" -> "gran-dragon-verde" */
function slug(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Normaliza la lista una sola vez y avisa de ids repetidos. */
const LIST = (() => {
  const seen = new Set();
  return BOSSES.map(b => {
    if (seen.has(b.id)) console.error(`[bosses] id repetido: "${b.id}"`);
    seen.add(b.id);
    const min = toSeconds(b.min), max = toSeconds(b.max);
    if (max < min) console.warn(`[bosses] "${b.name}": max menor que min`);
    return {
      ...b,
      dungeon: b.dungeon || 'Sin asignar',
      minSec: min,
      maxSec: max,
      // Misma imagen para el mismo bicho aunque aparezca en varios dungeons.
      imgSrc: b.img || `${IMG_DIR}/${slug(b.name)}.${IMG_EXT}`
    };
  });
})();

const DUNGEONS = [...new Set(LIST.map(b => b.dungeon))];

/* =========================== utilidades =========================== */

const pad = n => String(n).padStart(2, '0');

function countdown(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ddmm = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

const rangeText = b =>
  b.minSec === b.maxSec ? fmtDur(b.minSec) : `${fmtDur(b.minSec)} – ${fmtDur(b.maxSec)}`;

function calc(boss) {
  const last = (history[boss.id] || [])[0];
  if (!last) return { status: 'unknown' };

  const base = new Date(last.killed_at).getTime();
  const from = base + boss.minSec * 1000;
  const to   = base + boss.maxSec * 1000;
  const now  = Date.now();

  if (now < from) return { status: 'pending', last, base, from, to, ms: from - now };
  if (now <= to)  return { status: 'window',  last, base, from, to, ms: to - now };
  return { status: 'over', last, base, from, to, ms: now - to };
}

const RANK = { window: 0, over: 1, pending: 2, unknown: 3 };

function ordered() {
  const rows = LIST.map(b => ({ b, c: calc(b) }));
  const byName = (x, y) =>
    x.b.name.localeCompare(y.b.name, 'es') || x.b.dungeon.localeCompare(y.b.dungeon, 'es');

  if (sortMode === 'name') rows.sort(byName);
  else rows.sort((x, y) => {
    const d = RANK[x.c.status] - RANK[y.c.status];
    if (d) return d;
    if (x.c.status === 'unknown') return byName(x, y);
    return x.c.ms - y.c.ms;
  });
  return rows;
}

/** Un boss se muestra si pasa el filtro de dungeon y el de "solo activos". */
function visible(b, c) {
  if (dungeon !== TODOS && b.dungeon !== dungeon) return false;
  if (!onlySoon) return true;
  if (c.status === 'unknown') return false;
  return !(c.status === 'pending' && c.ms > 30 * 60000);
}

/* =========================== datos =========================== */

async function loadAll() {
  const { data, error } = await sb
    .from('kills').select('*')
    .order('killed_at', { ascending: false })
    .limit(900);

  if (error) { setStatus('Error al leer', false); console.error(error); return; }

  history = {};
  for (const row of data) (history[row.boss_id] ||= []).push(row);
  refresh();
}

async function register(bossId, when, kind = 'kill') {
  const { error } = await sb.from('kills').insert({
    boss_id: bossId,
    killed_at: new Date(when).toISOString(),
    by_nick: nick || 'anonimo',
    kind
  });
  if (error) { console.error(error); setStatus('No se pudo guardar', false); return; }
  await loadAll();
}

async function undoLast(bossId) {
  const last = (history[bossId] || [])[0];
  if (!last) return;
  const { error } = await sb.from('kills').delete().eq('id', last.id);
  if (error) { console.error(error); setStatus('No se pudo deshacer', false); return; }
  await loadAll();
}

function setStatus(text, live) {
  const el = $('status');
  el.textContent = text;
  el.dataset.state = live ? 'live' : 'off';
}

/* =========================== filtros =========================== */

function buildDungeonBar() {
  const bar = $('dungeonBar');
  bar.innerHTML = '';

  const mk = (value, label) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(dungeon === value));
    b.onclick = () => {
      dungeon = value;
      localStorage.setItem('iao_dungeon', value);
      for (const c of bar.children) c.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      refresh();
    };
    bar.appendChild(b);
  };

  mk(TODOS, 'Todos');
  for (const d of DUNGEONS) mk(d, d.replace(/^Dungeon /, ''));
}

/* =========================== tarjetas =========================== */

function buildCards() {
  const grid = $('grid');
  grid.innerHTML = '';
  cards.clear();

  if (!LIST.length) { $('empty').hidden = false; return; }
  $('empty').hidden = true;

  for (const boss of LIST) {
    const el = document.createElement('article');
    el.className = 'card';

    el.innerHTML = `
      <div class="card-top">
        <img class="sprite" alt="" loading="lazy" decoding="async">
        <div>
          <div class="card-name"></div>
          <div class="card-dungeon"></div>
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

    const r = {
      el,
      label:  el.querySelector('.count-label'),
      count:  el.querySelector('.count'),
      window: el.querySelector('.window-val'),
      time:   el.querySelector('input[type=time]'),
      date:   el.querySelector('input[type=date]'),
      undo:   el.querySelector('[data-act=undo]'),
      missed: el.querySelector('[data-act=missed]'),
      by:     el.querySelector('.by'),
      hist:   el.querySelector('.hist')
    };

    el.querySelector('.card-name').textContent = boss.name;
    el.querySelector('.card-dungeon').textContent = boss.dungeon;
    el.querySelector('.card-resp').textContent = rangeText(boss);

    // Si el archivo no existe, la tarjeta cae a la inicial del nombre en vez
    // de mostrar un icono roto.
    const img = el.querySelector('.sprite');
    img.onerror = () => {
      const ph = document.createElement('div');
      ph.className = 'sprite sprite-ph';
      ph.setAttribute('aria-hidden', 'true');
      ph.textContent = boss.name.charAt(0);
      img.replaceWith(ph);
    };
    img.src = boss.imgSrc;

    const now = new Date();
    r.time.value = hhmm(now);
    r.date.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    el.querySelector('[data-act=reg]').onclick = () => {
      if (!r.time.value || !r.date.value) return;
      const when = new Date(`${r.date.value}T${r.time.value}:00`);
      if (isNaN(when)) return;
      register(boss.id, when.getTime());
    };
    el.querySelector('[data-act=now]').onclick = () => register(boss.id, Date.now());
    r.undo.onclick = () => {
      const last = (history[boss.id] || [])[0];
      if (!last) return;
      const d = new Date(last.killed_at);
      if (confirm(`Borrar el registro de ${boss.name} (${boss.dungeon}) de las ${hhmm(d)} del ${ddmm(d)}?`)) {
        undoLast(boss.id);
      }
    };
    r.missed.onclick = () => {
      const c = calc(boss);
      if (c.status === 'unknown') return;
      register(boss.id, c.to, 'missed');
    };

    grid.appendChild(el);
    cards.set(boss.id, r);
  }
}

/* =========================== refresco =========================== */

function refresh() {
  const rows = ordered();
  let shown = 0;

  rows.forEach(({ b, c }, i) => {
    const r = cards.get(b.id);
    if (!r) return;

    const show = visible(b, c);
    r.el.hidden = !show;
    if (show) shown++;
    r.el.style.order = i;

    if (!show) return;

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
      return;
    }

    r.undo.disabled = false;
    r.missed.disabled = false;

    if (c.status === 'pending')      r.label.textContent = 'Falta';
    else if (c.status === 'window')  r.label.textContent = 'Ventana abierta · cierra en';
    else                             r.label.textContent = 'Ventana vencida hace';
    r.count.textContent = countdown(c.ms);

    const f = new Date(c.from), t = new Date(c.to);
    r.window.textContent = b.minSec === b.maxSec ? hhmm(f) : `${hhmm(f)} a ${hhmm(t)}`;

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

    if (document.activeElement !== r.time) r.time.value = hhmm(d);
    if (document.activeElement !== r.date) {
      r.date.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
  });

  $('empty').hidden = shown > 0;
  if (!shown) {
    $('empty').textContent = onlySoon
      ? 'Ningún boss activo con este filtro.'
      : 'No hay bosses en este dungeon.';
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
      text = `Contraseña incorrecta, o no existe la cuenta ${CLAN_EMAIL}. ` +
             'Verificá que ese email sea exactamente el de Authentication → Users.';
    } else if (m.includes('email not confirmed')) {
      text = 'La cuenta existe pero está sin confirmar. En Supabase: ' +
             'Authentication → Users → tu usuario → Confirm email.';
    } else if (m.includes('email logins are disabled') || m.includes('provider is not enabled')) {
      text = 'El login por email está desactivado. Activalo en ' +
             'Authentication → Sign In / Providers → Email.';
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

  buildDungeonBar();
  buildCards();
  await loadAll();

  sb.channel('kills-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kills' }, loadAll)
    .subscribe(s => setStatus(s === 'SUBSCRIBED' ? 'En vivo' : 'Reconectando', s === 'SUBSCRIBED'));

  setInterval(refresh, 1000);
  setInterval(loadAll, 60000);   // red de seguridad si se cae el websocket
}

/* =========================== arranque =========================== */

$('enter').onclick = doLogin;
$('pass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };

$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

$('nick').onchange = e => {
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
