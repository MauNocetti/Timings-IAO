import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BOSSES } from './bosses.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, CLAN_EMAIL, APP_TITLE, IMG_DIR, IMG_EXT, SPOT_BUCKET } from './config.js';

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

// Dos personas cargando la misma muerte rara vez ponen el mismo minuto: uno
// escribe 21:03 y el otro 21:05. Cualquier registro del mismo boss a menos de
// esto de distancia se considera la misma muerte y se rechaza. Va igual que la
// restriccion kills_sin_duplicados de schema.sql: si cambia una, cambia la otra.
const DUP_WINDOW_MS = 10 * 60 * 1000;

// Tope de la captura del mapa. Una foto de pantalla del juego pesa muy por
// debajo de esto; el limite esta para que nadie suba un video por error.
const SPOT_MAX_BYTES = 6 * 1024 * 1024;

let history = {};                 // bossId -> filas de mas nueva a mas vieja
let spots = {};                   // bossId -> fila de spots (la captura del mapa)
const spotUrls = new Map();       // bossId -> { url firmada, updated_at }
const spotBusy = new Set();       // bossIds con una subida en vuelo
const busy = new Set();           // bossIds con una escritura en vuelo
const msgTimers = new Map();      // bossId -> timeout del cartel de la tarjeta
let nick = localStorage.getItem('iao_nick') || '';
let sortMode = 'next';
let onlySoon = false;
let query = '';
let dungeon = localStorage.getItem('iao_dungeon') || TODOS;
const cards = new Map();

/** Minusculas y sin acentos, para que "dragon" encuentre "Gran Dragón". */
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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
      coords: b.coords || '',
      pista: b.pista || '',
      // Misma imagen para el mismo bicho aunque aparezca en varios dungeons.
      imgSrc: b.img || `${IMG_DIR}/${slug(b.name)}.${IMG_EXT}`,
      // Se busca por nombre y por dungeon.
      // Se busca por nombre, por dungeon y por coordenada.
      haystack: norm(`${b.name} ${b.dungeon || ''} ${b.coords || ''} ${b.pista || ''}`)
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

// Primero lo accionable: la ventana abierta, despues lo que esta por salir.
// El vencido ya no tiene nada que mirar, asi que cae despues de los pendientes
// y solo queda arriba de los que nunca se registraron.
const RANK = { window: 0, pending: 1, over: 2, unknown: 3 };

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

/** Un boss se muestra si pasa la busqueda, el filtro de dungeon y "solo activos". */
function visible(b, c) {
  if (query) {
    // Cada palabra tiene que aparecer: "golem zero" encuentra los de ese dungeon.
    for (const w of query.split(/\s+/)) if (!b.haystack.includes(w)) return false;
  }
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

/** Registro ya cargado que cae dentro de la ventana de tolerancia, o null. */
function findDuplicate(bossId, whenMs) {
  return (history[bossId] || []).find(
    row => Math.abs(new Date(row.killed_at).getTime() - whenMs) < DUP_WINDOW_MS
  ) || null;
}

function dupText(row) {
  const d = new Date(row.killed_at);
  return `Esta muerte ya fue cargada: ${hhmm(d)} del ${ddmm(d)} por ${row.by_nick}.`;
}

async function register(bossId, when, kind = 'kill') {
  // Doble click, doble tap, o Enter repetido mientras el insert anterior sigue
  // viajando: sin esto entran dos registros identicos.
  if (busy.has(bossId)) return;

  // Chequeo local primero: es instantaneo y evita el viaje a la base en el caso
  // comun, que es que el duplicado ya este en pantalla.
  const dup = findDuplicate(bossId, when);
  if (dup) { cardMsg(bossId, dupText(dup), 'warn'); return; }

  setBusy(bossId, true);
  const { error } = await sb.from('kills').insert({
    boss_id: bossId,
    killed_at: new Date(when).toISOString(),
    by_nick: nick || 'anonimo',
    kind
  });
  setBusy(bossId, false);

  if (error) {
    // 23P01 = exclusion_violation. Es la carrera real: alguien lo cargo entre
    // nuestro chequeo local y el insert. La base es la que decide.
    if (error.code === '23P01' || /kills_sin_duplicados/.test(error.message || '')) {
      await loadAll();
      const other = findDuplicate(bossId, when);
      cardMsg(bossId, other ? dupText(other) : 'Esta muerte ya fue cargada.', 'warn');
      return;
    }
    console.error(error);
    setStatus('No se pudo guardar', false);
    return;
  }

  cardMsg(bossId, kind === 'missed' ? 'Spawn perdido registrado.' : 'Registrado.', 'ok');
  await loadAll();
}

async function undoLast(bossId) {
  if (busy.has(bossId)) return;
  const last = (history[bossId] || [])[0];
  if (!last) return;

  setBusy(bossId, true);
  const { error } = await sb.from('kills').delete().eq('id', last.id);
  setBusy(bossId, false);

  if (error) { console.error(error); setStatus('No se pudo deshacer', false); return; }
  await loadAll();
}

/** Bloquea los botones de una tarjeta mientras hay una escritura en vuelo. */
function setBusy(bossId, on) {
  if (on) busy.add(bossId); else busy.delete(bossId);
  const r = cards.get(bossId);
  if (!r) return;
  // Directo ademas de por refresh(), porque refresh() saltea las tarjetas
  // escondidas por el filtro.
  for (const b of r.acts) b.disabled = on;
  refresh();
}

/** Cartel corto dentro de la tarjeta. Se borra solo. */
function cardMsg(bossId, text, tone) {
  const r = cards.get(bossId);
  if (!r) return;
  r.msg.textContent = text;
  r.msg.dataset.tone = tone;
  r.msg.hidden = false;

  clearTimeout(msgTimers.get(bossId));
  msgTimers.set(bossId, setTimeout(() => {
    r.msg.hidden = true;
    r.msg.textContent = '';
  }, tone === 'warn' ? 7000 : 2500));
}

/* =========================== ubicaciones =========================== */

async function loadSpots() {
  const { data, error } = await sb.from('spots').select('*');
  if (error) { console.error(error); return; }

  spots = {};
  for (const row of data) spots[row.boss_id] = row;
  refresh();
}

// La firma dura una hora; se renueva pasados 50 minutos para que a una pestaña
// abierta toda la tarde no se le rompan las miniaturas.
const SPOT_URL_TTL_MS = 3600 * 1000;
const SPOT_URL_RENEW_MS = 50 * 60 * 1000;

/**
 * URL para mostrar la captura. El bucket es privado, asi que hay que pedir una
 * firmada. Se cachea hasta que la imagen cambie o hasta que la firma envejezca.
 */
async function spotUrl(bossId) {
  const row = spots[bossId];
  if (!row) return null;

  const hit = spotUrls.get(bossId);
  if (hit && hit.updated_at === row.updated_at &&
      Date.now() - hit.at < SPOT_URL_RENEW_MS) {
    return hit.url;
  }

  const { data, error } = await sb.storage.from(SPOT_BUCKET)
    .createSignedUrl(row.path, SPOT_URL_TTL_MS / 1000);
  if (error) { console.error(error); return null; }

  spotUrls.set(bossId, { url: data.signedUrl, updated_at: row.updated_at, at: Date.now() });
  return data.signedUrl;
}

async function uploadSpot(bossId, file) {
  if (!file || spotBusy.has(bossId)) return;

  if (!file.type.startsWith('image/')) {
    cardMsg(bossId, 'Eso no es una imagen.', 'warn');
    return;
  }
  if (file.size > SPOT_MAX_BYTES) {
    const mb = (file.size / 1048576).toFixed(1);
    cardMsg(bossId, `La imagen pesa ${mb} MB y el maximo es 6 MB.`, 'warn');
    return;
  }

  setSpotBusy(bossId, true);

  // Una imagen por boss, siempre en la misma ruta: al reemplazarla se pisa y no
  // quedan archivos sueltos en el bucket. La extension no hace falta porque el
  // tipo viaja en el content-type.
  const path = bossId;
  const { error: upErr } = await sb.storage.from(SPOT_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (upErr) {
    setSpotBusy(bossId, false);
    console.error(upErr);
    cardMsg(bossId, 'No se pudo subir la imagen.', 'warn');
    return;
  }

  const { error: dbErr } = await sb.from('spots').upsert({
    boss_id: bossId,
    path,
    by_nick: nick || 'anonimo',
    updated_at: new Date().toISOString()
  });

  setSpotBusy(bossId, false);

  if (dbErr) {
    console.error(dbErr);
    cardMsg(bossId, 'La imagen subio pero no se pudo registrar.', 'warn');
    return;
  }

  spotUrls.delete(bossId);
  cardMsg(bossId, 'Ubicación actualizada.', 'ok');
  await loadSpots();
}

async function removeSpot(bossId) {
  const row = spots[bossId];
  if (!row || spotBusy.has(bossId)) return;

  setSpotBusy(bossId, true);
  const { error: stErr } = await sb.storage.from(SPOT_BUCKET).remove([row.path]);
  const { error: dbErr } = await sb.from('spots').delete().eq('boss_id', bossId);
  setSpotBusy(bossId, false);

  if (stErr || dbErr) {
    console.error(stErr || dbErr);
    cardMsg(bossId, 'No se pudo quitar la imagen.', 'warn');
    return;
  }

  spotUrls.delete(bossId);
  await loadSpots();
}

function setSpotBusy(bossId, on) {
  if (on) spotBusy.add(bossId); else spotBusy.delete(bossId);
  const r = cards.get(bossId);
  if (!r || !r.spot) return;
  r.spotUp.classList.toggle('is-busy', on);
  r.spotUpLabel.textContent = on ? 'Subiendo…' : (spots[bossId] ? 'Reemplazar' : 'Subir imagen');
  r.spotDel.disabled = on;
}

/**
 * Pinta el bloque de ubicacion. refresh() corre cada segundo, asi que solo se
 * rehace cuando la imagen cambio de verdad: si no, cada segundo se pediria una
 * URL firmada nueva.
 */
function renderSpot(b, r) {
  const row = spots[b.id] || null;
  const key = row ? row.updated_at : '';

  // Si la firma de la URL esta por vencer hay que volver a pintar aunque la
  // imagen sea la misma, para que spotUrl() pida una nueva.
  const hit = spotUrls.get(b.id);
  const firmaVieja = !!row && !!hit && Date.now() - hit.at >= SPOT_URL_RENEW_MS;

  if (r.spotKey === key && !firmaVieja) return;
  r.spotKey = key;

  r.spotEmpty.hidden = !!row;
  r.spotThumb.hidden = !row;
  r.spotDel.hidden = !row;
  r.spotBy.textContent = row ? `Subida por ${row.by_nick}` : '';
  if (!spotBusy.has(b.id)) {
    r.spotUpLabel.textContent = row ? 'Reemplazar' : 'Subir imagen';
  }

  if (!row) { r.spotThumb.removeAttribute('src'); return; }

  spotUrl(b.id).then(url => {
    // Si mientras tanto la imagen volvio a cambiar, esta URL ya no sirve.
    // Reasignar el mismo src dispara otra carga y hace parpadear la miniatura.
    if (url && r.spotKey === key && r.spotThumb.getAttribute('src') !== url) {
      r.spotThumb.src = url;
    }
  });
}

/* =========================== visor =========================== */

async function openLightbox(boss) {
  const url = await spotUrl(boss.id);
  if (!url) return;
  $('lightboxImg').src = url;
  $('lightboxImg').alt = `Ubicación de ${boss.name}`;
  $('lightboxCap').textContent = `${boss.name} · ${boss.coords}${boss.pista ? ' · ' + boss.pista : ''}`;
  $('lightbox').hidden = false;
}

function closeLightbox() {
  $('lightbox').hidden = true;
  $('lightboxImg').removeAttribute('src');
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

      <div class="spot" hidden>
        <div class="spot-head">
          <button type="button" class="spot-coord" title="Copiar coordenadas"></button>
          <span class="spot-pista"></span>
        </div>
        <img class="spot-thumb" alt="" loading="lazy" decoding="async" hidden>
        <p class="spot-empty">Sin captura de la ubicación todavía.</p>
        <div class="spot-acts">
          <label class="spot-up">
            <input type="file" accept="image/*" hidden>
            <span class="spot-up-label">Subir imagen</span>
          </label>
          <button type="button" class="spot-del" hidden>Quitar</button>
        </div>
        <p class="spot-by"></p>
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
        <p class="card-msg" role="status" aria-live="polite" hidden></p>
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
      reg:    el.querySelector('[data-act=reg]'),
      now:    el.querySelector('[data-act=now]'),
      undo:   el.querySelector('[data-act=undo]'),
      missed: el.querySelector('[data-act=missed]'),
      msg:    el.querySelector('.card-msg'),
      by:     el.querySelector('.by'),
      hist:   el.querySelector('.hist'),

      spot:        el.querySelector('.spot'),
      spotCoord:   el.querySelector('.spot-coord'),
      spotPista:   el.querySelector('.spot-pista'),
      spotThumb:   el.querySelector('.spot-thumb'),
      spotEmpty:   el.querySelector('.spot-empty'),
      spotUp:      el.querySelector('.spot-up'),
      spotUpLabel: el.querySelector('.spot-up-label'),
      spotFile:    el.querySelector('.spot-up input[type=file]'),
      spotDel:     el.querySelector('.spot-del'),
      spotBy:      el.querySelector('.spot-by'),
      spotKey:     undefined      // updated_at de lo que hay pintado ahora
    };
    r.acts = [r.reg, r.now, r.undo, r.missed];

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
      // "Boss Jardín Maldito" -> "J". Sin esto los ocultos mostrarian todos
      // la misma "B" y la inicial no distinguiria ninguno.
      ph.textContent = boss.name.replace(/^Boss\s+/i, '').charAt(0);
      img.replaceWith(ph);
    };
    img.src = boss.imgSrc;

    const now = new Date();
    r.time.value = hhmm(now);
    r.date.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    r.reg.onclick = () => {
      if (!r.time.value || !r.date.value) return;
      const when = new Date(`${r.date.value}T${r.time.value}:00`);
      if (isNaN(when)) return;
      register(boss.id, when.getTime());
    };
    r.now.onclick = () => register(boss.id, Date.now());
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

    // El bloque de ubicacion solo existe para los bosses que tienen coords.
    if (boss.coords) {
      r.spot.hidden = false;
      r.spotCoord.textContent = boss.coords;
      r.spotPista.textContent = boss.pista;

      // Las coordenadas se tipean adentro del juego, asi que copiarlas de un
      // click ahorra el ida y vuelta.
      r.spotCoord.onclick = async () => {
        try {
          await navigator.clipboard.writeText(boss.coords);
          cardMsg(boss.id, `Coordenadas copiadas: ${boss.coords}`, 'ok');
        } catch {
          cardMsg(boss.id, `Copiá a mano: ${boss.coords}`, 'warn');
        }
      };

      r.spotFile.onchange = e => {
        const file = e.target.files?.[0];
        e.target.value = '';       // permite volver a elegir el mismo archivo
        uploadSpot(boss.id, file);
      };

      r.spotThumb.onclick = () => openLightbox(boss);

      r.spotDel.onclick = () => {
        if (confirm(`Quitar la captura de ${boss.name}?`)) removeSpot(boss.id);
      };
    }

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

    if (b.coords) renderSpot(b, r);

    r.el.classList.toggle('is-window', c.status === 'window');
    r.el.classList.toggle('is-over', c.status === 'over');
    // 'over' y 'unknown' no muestran numero, asi que el cartel va en chico.
    r.count.classList.toggle('sm', c.status === 'unknown' || c.status === 'over');

    // Mientras hay una escritura en vuelo la tarjeta entera queda quieta.
    const locked = busy.has(b.id);
    r.reg.disabled = locked;
    r.now.disabled = locked;

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

    r.undo.disabled = locked;
    r.missed.disabled = locked;

    // Una ventana vencida no tiene cuenta regresiva que mostrar: contar hacia
    // arriba desde el vencimiento no dice nada util y hace ruido en la grilla.
    // El horario de la ventana que paso queda igual en "Aparece".
    if (c.status === 'over') {
      r.label.textContent = 'Ventana';
      r.count.textContent = 'Vencida';
      // La ventana que paso ya no sirve de nada: mostrarla invita a leerla como
      // si el boss fuese a salir a esa hora. La hora real queda en el ultimo
      // registro, abajo.
      r.window.textContent = '—';
    } else {
      r.label.textContent = c.status === 'pending'
        ? 'Falta'
        : 'Ventana abierta · cierra en';
      r.count.textContent = countdown(c.ms);

      const f = new Date(c.from), t = new Date(c.to);
      r.window.textContent = b.minSec === b.maxSec ? hhmm(f) : `${hhmm(f)} a ${hhmm(t)}`;
    }

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

  $('searchCount').textContent = query ? `${shown}/${LIST.length}` : '';

  $('empty').hidden = shown > 0;
  if (!shown) {
    $('empty').textContent = query
      ? `Ningún boss coincide con "${$('search').value.trim()}".`
      : onlySoon
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
  await Promise.all([loadAll(), loadSpots()]);

  sb.channel('kills-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kills' }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'spots' }, loadSpots)
    .subscribe(s => setStatus(s === 'SUBSCRIBED' ? 'En vivo' : 'Reconectando', s === 'SUBSCRIBED'));

  setInterval(refresh, 1000);
  setInterval(() => { loadAll(); loadSpots(); }, 60000);  // si se cae el websocket

  $('lightbox').onclick = e => { if (e.target.id !== 'lightboxImg') closeLightbox(); };
  $('lightboxClose').onclick = closeLightbox;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('lightbox').hidden) closeLightbox();
  });
}

/* =========================== arranque =========================== */

$('enter').onclick = doLogin;
$('pass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };

$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

$('nick').onchange = e => {
  nick = e.target.value.trim();
  localStorage.setItem('iao_nick', nick);
};

function setQuery(text) {
  query = norm(text.trim());
  $('searchClear').hidden = !query;

  // Buscar mirando un solo dungeon confunde: si hay texto, se busca en todos
  // y el chip se mueve solo para que se vea.
  if (query && dungeon !== TODOS) {
    dungeon = TODOS;
    localStorage.setItem('iao_dungeon', TODOS);
    const bar = $('dungeonBar');
    for (const c of bar.children) c.setAttribute('aria-pressed', 'false');
    bar.firstElementChild?.setAttribute('aria-pressed', 'true');
  }
  refresh();
}

$('search').oninput = e => setQuery(e.target.value);
$('search').onkeydown = e => {
  if (e.key === 'Escape') { e.target.value = ''; setQuery(''); }
};
$('searchClear').onclick = () => {
  $('search').value = '';
  setQuery('');
  $('search').focus();
};

// "/" enfoca el buscador, como en GitHub.
document.addEventListener('keydown', e => {
  if (e.key !== '/' || $('appView').hidden) return;
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA') return;
  e.preventDefault();
  $('search').focus();
});

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
