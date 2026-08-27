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
