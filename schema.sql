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

do $$
begin
  alter table public.kills
    add constraint kills_sin_duplicados
    exclude using gist (
      boss_id with =,
      tstzrange(killed_at - interval '5 minutes',
                killed_at + interval '5 minutes') with &&
    );
exception
  when duplicate_object then
    raise notice 'kills_sin_duplicados ya existia, no se toco nada.';
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

alter publication supabase_realtime add table public.kills;

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
-- Solo si el ALTER de arriba fallo por duplicados historicos.
--
-- 1) Mirá que se va a borrar. Deja el registro mas viejo de cada grupo y lista
--    los que quedaron pegados a menos de 10 minutos de el.
--
-- select v.* from public.kills v
-- where exists (
--   select 1 from public.kills w
--   where w.boss_id = v.boss_id
--     and w.killed_at < v.killed_at
--     and v.killed_at - w.killed_at < interval '10 minutes'
-- )
-- order by boss_id, killed_at;
--
-- 2) Si estas de acuerdo, cambiá el 'select v.*' por 'delete' y corré de nuevo:
--
-- delete from public.kills v
-- where exists (
--   select 1 from public.kills w
--   where w.boss_id = v.boss_id
--     and w.killed_at < v.killed_at
--     and v.killed_at - w.killed_at < interval '10 minutes'
-- );
--
-- Ojo: puede necesitar mas de una pasada si habia cadenas de tres o mas
-- registros encadenados. Repetí hasta que el select no devuelva nada.
-- ---------------------------------------------------------------------------
