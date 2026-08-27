# Timings IAO

Tablero compartido de respawns de bosses para ImperiumAO. Todos ven la misma
pantalla: si uno carga un horario, al resto se le actualiza sola.

Frontend estático en GitHub Pages, datos y login en Supabase. Sin build, sin
dependencias que instalar, sin servidor propio.

---

## Setup

### 1. Crear el proyecto en Supabase

Entrá a [supabase.com](https://supabase.com), creá una cuenta y un proyecto
nuevo. El plan gratuito alcanza de sobra.

### 2. Crear la tabla

En el panel: **SQL Editor → New query**. Pegá todo el contenido de `schema.sql`
y dale **Run**. Eso crea la tabla `kills`, activa las políticas de seguridad y
habilita realtime.

### 3. Crear la cuenta del clan

**Authentication → Users → Add user → Create new user**.

- Email: `clan@timings.local` (o el que quieras, pero anotalo)
- Password: la contraseña que va a usar todo el clan
- Marcá **Auto Confirm User**

Esa es la única cuenta. Todos entran con esa contraseña.

### 4. Completar `config.js`

En **Project Settings → Data API** copiá:

- **Project URL** → `SUPABASE_URL`
- La clave **anon public** → `SUPABASE_ANON_KEY`

Y poné en `CLAN_EMAIL` el mismo email del paso 3.

> La anon key va commiteada al repo público sin drama: es pública por diseño y
> no sirve para nada sin sesión iniciada, porque las políticas RLS solo
> habilitan al rol `authenticated`. La que **nunca** va acá es la `service_role`.

### 5. Cargar los bosses

Editá `bosses.js`. Ya vienen seis de ejemplo. El formato:

```js
{ id: 'gorgona', name: 'Gorgona', min: 45, max: 100 }
```

`min` y `max` son minutos desde la muerte hasta el inicio y el fin de la
ventana de respawn. Si el respawn es exacto, poné el mismo valor en los dos.

No cambies un `id` después de que el boss tenga registros: se pierde el
historial.

### 6. Publicar en GitHub Pages

```bash
git init
git add .
git commit -m "Timings IAO"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/timings-iao.git
git push -u origin main
```

En el repo: **Settings → Pages → Source: Deploy from a branch → main / (root)**.

En un minuto queda en `https://TU-USUARIO.github.io/timings-iao/`.

---

## Cómo funciona

**Registrar / Ahora.** "Ahora" carga la hora actual de un toque. "Registrar" usa
los campos de hora y fecha, para cuando lo cargás más tarde o alguien te pasa el
dato por Discord.

**Aparece.** La ventana estimada, calculada sobre el último registro.

**Spawn perdido.** Cuando la ventana pasó y nadie lo vio. Toma el cierre de esa
ventana como nueva referencia y recalcula desde ahí. Es una estimación, no un
dato: sirve para que la tarjeta no quede clavada en "vencida hace 6 horas". Si
en el clan lo usan con otra lógica, se cambia en `app.js`.

**Deshacer último cambio.** Borra el registro más reciente de ese boss y vuelve
al anterior. Sirve para cuando alguien carga mal.

**Orden.** Por defecto aparecen primero los que tienen ventana abierta, después
los vencidos, después por cercanía. "Solo activos" esconde los que faltan más de
media hora.

**El nick** es autodeclarado y se guarda en el navegador de cada uno. Sirve para
saber quién cargó qué, no para autenticar a nadie.

---

## Límites que conviene saber

- **Una sola contraseña para todos.** Si se filtra, la rotás en
  *Authentication → Users → editar → cambiar password* y todos tienen que
  volver a entrar. No podés revocar a una persona sola.
- **El nick no está verificado.** Cualquiera puede escribir el de otro.
- **Cualquiera con sesión puede borrar registros.** Es lo que pediste — todos
  cargan, todos corrigen. Si algún día molesta, se restringe el `delete` en las
  políticas RLS.
- **Las horas se calculan con el reloj de cada máquina.** Si alguien lo tiene
  corrido, sus registros salen corridos. Se puede mover a hora de servidor con
  un default `now()` en la tabla si llega a pasar.
- **Free tier de Supabase.** El proyecto se pausa tras una semana sin ninguna
  actividad. Con uso diario del clan no debería llegar a pasar nunca.

---

## Archivos

```
index.html     Estructura: login + tablero
styles.css     Estilos
app.js         Auth, datos, realtime y render
bosses.js      La lista de bosses  ← lo que vas a editar seguido
config.js      Credenciales de Supabase
schema.sql     Para pegar una vez en el SQL Editor
```
