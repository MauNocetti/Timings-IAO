-- ---------------------------------------------------------------------------
-- Timings IAO — esquema de base de datos
-- Pegá todo esto en el SQL Editor de Supabase y ejecutalo una sola vez.
-- ---------------------------------------------------------------------------

-- Un registro por evento. El estado actual de cada boss es simplemente su
-- fila mas reciente, asi que el historial y el "deshacer" salen gratis.
create table if not exists public.kills (
  id          bigint generated always as identity primary key,
  boss_id     text        not null,
  killed_at   timestamptz not null,
  by_nick     text        not null default 'anonimo',
  kind        text        not null default 'kill'
                          check (kind in ('kill', 'missed')),
  created_at  timestamptz not null default now()
);

create index if not exists kills_boss_time_idx
  on public.kills (boss_id, killed_at desc);

-- ---------------------------------------------------------------------------
-- Sin muertes duplicadas
--
-- Si dos personas cargan la misma muerte, la segunda tiene que rebotar. Como
-- rara vez ponen el minuto exacto (uno carga 21:03 y el otro 21:05), no alcanza
-- con un unique sobre (boss_id, killed_at): hay que comparar con tolerancia.
--
-- Cada fila reserva un rango de +/- 5 minutos alrededor de su killed_at. Dos
-- rangos se pisan justo cuando la diferencia entre ambos horarios es menor a
-- 10 minutos, asi que el efecto es: "no se puede cargar el mismo boss dos veces
-- dentro de una ventana de 10 minutos".
--
-- Esto no limita nada real: el respawn mas corto de la lista es de 30 minutos,
-- o sea que dos muertes legitimas del mismo boss nunca caen tan cerca. Si
-- alguien se equivoco al cargar, primero usa "Deshacer ultimo cambio" y despues
-- carga el horario bueno.
--
-- La restriccion vale para 'kill' y para 'missed' por igual: lo que se reserva
-- es el momento, sin importar como se haya registrado.
--
-- NOTA si ya tenias la tabla con datos: el ALTER falla si en el historial hay
-- duplicados de antes. Corré primero la consulta del final de este archivo para
-- verlos y limpiarlos, y despues volvé a ejecutar esto.
-- ---------------------------------------------------------------------------

-- Necesaria para poder mezclar '=' sobre boss_id con '&&' sobre el rango.
create extension if not exists btree_gist;

-- El rango se arma sobre 'killed_at at time zone UTC', no sobre killed_at a
-- secas. Motivo: restar un interval a un timestamptz es STABLE y no IMMUTABLE
-- (un interval puede traer meses o dias, y cuanto dura eso depende del huso),
-- y un indice GiST exige IMMUTABLE. Pasandolo a timestamp sin huso, las tres
-- operaciones -- 'at time zone' con zona literal, la resta y tsrange -- si son
-- IMMUTABLE. Como todos los instantes se convierten con la misma zona, el
-- orden y las distancias no cambian: la comparacion sigue siendo la correcta.
do $$
begin
  if exists (select 1 from pg_constraint
             where conrelid = 'public.kills'::regclass
               and conname  = 'kills_sin_duplicados') then
    raise notice 'kills_sin_duplicados ya existia, no se toco nada.';
  else
    alter table public.kills
      add constraint kills_sin_duplicados
      exclude using gist (
        boss_id with =,
        tsrange((killed_at at time zone 'UTC') - interval '5 minutes',
                (killed_at at time zone 'UTC') + interval '5 minutes') with &&
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seguridad
--
-- RLS activo y sin ninguna politica para 'anon' significa que un visitante sin
-- sesion no puede leer ni escribir absolutamente nada, aunque tenga la anon key.
-- El acceso lo da unicamente el login con la cuenta del clan.
-- ---------------------------------------------------------------------------

alter table public.kills enable row level security;

drop policy if exists "clan lee"      on public.kills;
drop policy if exists "clan inserta"  on public.kills;
drop policy if exists "clan borra"    on public.kills;

create policy "clan lee"
  on public.kills for select
  to authenticated
  using (true);

create policy "clan inserta"
  on public.kills for insert
  to authenticated
  with check (true);

-- Necesario para "deshacer ultimo cambio".
create policy "clan borra"
  on public.kills for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Realtime: para que al cargar un horario se les actualice la pantalla a todos
-- sin refrescar.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public' and tablename = 'kills') then
    raise notice 'kills ya estaba en supabase_realtime.';
  else
    alter publication supabase_realtime add table public.kills;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Opcional: limpieza automatica del historial viejo.
-- Corré esto de vez en cuando, o programalo con pg_cron si lo habilitás.
-- Conserva los ultimos 20 registros de cada boss.
-- ---------------------------------------------------------------------------

-- delete from public.kills where id in (
--   select id from (
--     select id, row_number() over (partition by boss_id order by killed_at desc) as rn
--     from public.kills
--   ) t where rn > 20
-- );

-- ---------------------------------------------------------------------------
-- Ubicaciones de los bosses ocultos
--
-- Una fila por boss: cual es su captura del mapa, quien la subio y cuando.
-- El archivo en si vive en Storage; aca solo va la referencia. Tener la tabla
-- aparte del bucket sirve para dos cosas: saber si hay imagen sin salir a
-- pedirla, y que el cambio viaje por realtime como cualquier otro.
-- ---------------------------------------------------------------------------

create table if not exists public.spots (
  boss_id     text        primary key,
  path        text        not null,
  by_nick     text        not null default 'anonimo',
  updated_at  timestamptz not null default now()
);

alter table public.spots enable row level security;

drop policy if exists "clan ve spots"     on public.spots;
drop policy if exists "clan sube spots"   on public.spots;
drop policy if exists "clan cambia spots" on public.spots;
drop policy if exists "clan borra spots"  on public.spots;

create policy "clan ve spots"
  on public.spots for select to authenticated using (true);

create policy "clan sube spots"
  on public.spots for insert to authenticated with check (true);

-- Reemplazar una imagen es un update sobre la fila que ya existe.
create policy "clan cambia spots"
  on public.spots for update to authenticated using (true) with check (true);

create policy "clan borra spots"
  on public.spots for delete to authenticated using (true);

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public' and tablename = 'spots') then
    raise notice 'spots ya estaba en supabase_realtime.';
  else
    alter publication supabase_realtime add table public.spots;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Bucket de las capturas
--
-- Privado a proposito: 'public => false'. Si fuese publico, cualquiera con el
-- link veria la ubicacion de un boss oculto sin pasar por el login, que es
-- justo lo contrario de lo que se busca. La app pide una URL firmada que dura
-- una hora, y eso solo funciona con sesion iniciada.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('ubicaciones', 'ubicaciones', false)
on conflict (id) do nothing;

drop policy if exists "clan ve ubicaciones"     on storage.objects;
drop policy if exists "clan sube ubicaciones"   on storage.objects;
drop policy if exists "clan cambia ubicaciones" on storage.objects;
drop policy if exists "clan borra ubicaciones"  on storage.objects;

create policy "clan ve ubicaciones"
  on storage.objects for select to authenticated
  using (bucket_id = 'ubicaciones');

create policy "clan sube ubicaciones"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ubicaciones');

create policy "clan cambia ubicaciones"
  on storage.objects for update to authenticated
  using (bucket_id = 'ubicaciones') with check (bucket_id = 'ubicaciones');

create policy "clan borra ubicaciones"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ubicaciones');

-- ---------------------------------------------------------------------------
-- Limpieza de duplicados historicos
--
-- Solo hace falta si el bloque de kills_sin_duplicados de arriba tiro
-- "could not create exclusion constraint": eso pasa cuando en el historial ya
-- hay duplicados de antes de que existiera la restriccion. Ningun dato se toca
-- solo por correr este archivo; lo de aca abajo es lo unico que borra, y hay
-- que descomentarlo a mano.
--
-- 1) Mirar que se va a borrar. Esto es de solo lectura. De cada grupo de
--    registros pegados conserva el mas viejo y lista el resto.
--
-- select v.id, v.boss_id, v.killed_at, v.by_nick from public.kills v
-- where exists (
--   select 1 from public.kills w
--   where w.boss_id = v.boss_id
--     and w.killed_at < v.killed_at
--     and v.killed_at - w.killed_at < interval '10 minutes'
-- )
-- order by boss_id, killed_at;
--
-- 2) Si estas de acuerdo con esa lista, borrarlos:
--
-- delete from public.kills v
-- where exists (
--   select 1 from public.kills w
--   where w.boss_id = v.boss_id
--     and w.killed_at < v.killed_at
--     and v.killed_at - w.killed_at < interval '10 minutes'
-- );
--
-- 3) Volver a correr este archivo entero. Ahora si crea la restriccion.
--
-- Una sola pasada alcanza, incluso con cadenas de tres o mas registros
-- encadenados: la condicion mira si existe CUALQUIER registro anterior a menos
-- de 10 minutos, no solo el inmediato. De 21:00, 21:04, 21:08 y 21:12 sobrevive
-- 21:00 y nada mas. El ultimo queda a 12 minutos del sobreviviente, o sea que
-- se borra de mas, pero con respawns de 30 minutos para arriba una cadena asi
-- solo puede ser la misma muerte cargada cuatro veces.
-- ---------------------------------------------------------------------------
