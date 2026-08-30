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
y dale **Run**. Eso crea las tablas `kills` y `spots`, el bucket privado
`ubicaciones` para las capturas de los bosses ocultos, activa las políticas de
seguridad, habilita realtime y bloquea las muertes duplicadas.

> Si ya lo habías corrido antes: volvé a pegarlo y ejecutarlo. Es idempotente
> — lo que ya existe lo saltea con un aviso y no toca ningún dato.
>
> Lo único que puede fallar es la restricción `kills_sin_duplicados`, si en el
> historial ya hay duplicados de antes de crearla. En ese caso el propio archivo
> termina con la consulta para verlos y limpiarlos. **Fijate que el Run no tire
> error rojo:** si falla ahí, las cargas duplicadas quedan sin bloquear del lado
> del servidor.

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

**Vencida.** Cuando la ventana pasó sin que nadie cargue nada, la tarjeta dice
"Vencida", deja de contar y "Aparece" se limpia. Ni el contador hacia arriba ni
una ventana que ya pasó dicen nada útil, y encima se leen como si el boss fuese
a salir a esa hora. El dato que queda es el último registro, abajo de todo.

Los vencidos tampoco encabezan más la lista: van después de los que están por
salir y antes de los que nunca se registraron.

**Spawn perdido.** Cuando la ventana pasó y nadie lo vio. Toma el cierre de esa
ventana como nueva referencia y recalcula desde ahí. Es una estimación, no un
dato: sirve para sacar la tarjeta de "Vencida" y volver a tener una ventana que
mirar. Si en el clan lo usan con otra lógica, se cambia en `app.js`.

**Deshacer último cambio.** Borra el registro más reciente de ese boss y vuelve
al anterior. Sirve para cuando alguien carga mal.

**Sin muertes duplicadas.** Si dos personas cargan la misma muerte, la segunda
rebota con *"Esta muerte ya fue cargada"*, diciendo el horario y el nick del que
llegó primero. Como rara vez ponen el mismo minuto, se comparan con tolerancia:
cuenta como la misma muerte cualquier registro del mismo boss a menos de **10
minutos**. No limita nada real — el respawn más corto de la lista es de media
hora, así que dos muertes legítimas nunca caen tan cerca.

El chequeo está en los dos lados. En la app es instantáneo, sin ir a la base. Y
la base tiene la restricción `kills_sin_duplicados`, que es la que decide cuando
dos cargan al mismo tiempo y el aviso de realtime todavía no llegó: ahí también
rebota y la tarjeta se actualiza sola con el registro del otro.

Los botones se bloquean mientras el registro viaja, así que apretar dos veces
"Registrar", "Ahora", "Spawn perdido" o "Deshacer" carga una sola vez.

Si cargaste un horario equivocado y querés corregirlo por pocos minutos, usá
primero **Deshacer último cambio** y después cargá el bueno.

**Orden.** Por defecto: primero los que tienen la ventana abierta (el que cierra
antes arriba), después los que faltan por cercanía, después los vencidos, y al
final los que nunca se registraron. La idea es que arriba quede lo accionable.
"Solo activos" esconde los que faltan más de media hora.

**El nick** es obligatorio: se pide en la pantalla de entrada, junto con la
contraseña, y sin él no se pasa. Todo lo que cargues —horarios y capturas— queda
firmado con ese nombre. Se guarda en el navegador de cada uno, así que se pide
una sola vez por dispositivo; después se puede cambiar desde el encabezado, pero
no dejar en blanco. Mínimo dos letras.

Sigue siendo autodeclarado: sirve para saber quién cargó qué, no para autenticar
a nadie.

---

## Bosses ocultos

Ocho bosses en mapas sin acceso directo. Van todos bajo el chip **Bosses
ocultos** y comparten respawn de 2h a 3h. Como no tienen nombre propio, llevan
el del lugar.

Sus tarjetas traen un bloque extra con la coordenada, la pista de por dónde se
entra, y la captura del mapa:

- **La coordenada** (`551 - 44 - 28`) se copia con un click, para pegarla en el
  juego sin tipearla.
- **Subir imagen** guarda una captura del mapa marcando dónde está. Cualquiera
  del clan la sube y al resto le aparece sola, sin refrescar.
- **Click en la miniatura** la abre a pantalla completa. Se cierra con Escape o
  clickeando afuera.
- **Reemplazar** pisa la que había.

Una imagen por boss, hasta 6 MB, cualquier formato de imagen. Desde la app solo
se reemplaza, no se borra: si alguna vez hay que sacar una del todo, se hace
desde el panel de Supabase (*Storage → ubicaciones* y la fila en *Table Editor →
spots*).

Las capturas van a un bucket de Supabase Storage llamado `ubicaciones`, que
`schema.sql` crea **privado**. Si fuera público, cualquiera con el link vería la
ubicación de un boss oculto sin pasar por el login — justo lo contrario de lo
que se busca. La app pide una URL firmada que dura una hora y se renueva sola,
así que las imágenes solo se ven con sesión iniciada.

Para agregar más bosses con ubicación, alcanza con ponerles `coords` en
`bosses.js`. El bloque aparece solo:

```js
{ id: 'oculto-lo-que-sea', name: 'Boss Lo Que Sea', dungeon: 'Bosses ocultos',
  min: '2h', max: '3h', coords: '551 - 44 - 28', pista: 'Cactus' }
```

---

## Límites que conviene saber

- **Una sola contraseña para todos.** Si se filtra, la rotás en
  *Authentication → Users → editar → cambiar password* y todos tienen que
  volver a entrar. No podés revocar a una persona sola.
- **El nick no está verificado.** Es obligatorio ponerlo, pero cualquiera puede
  escribir el de otro. Los registros viejos que dicen `anonimo` son de antes de
  que se pidiera; quedan como están.
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

La tabla `kills` guarda los horarios y `spots` dice qué captura tiene cada boss
oculto. Los archivos en sí viven en Storage, no en la base.
