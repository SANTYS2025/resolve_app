-- ═══════════════════════════════════════════════════════════════════════════
-- Disponibilidad real del técnico · presencia · avatares
--
-- Problemas que corrige:
--  1. El catálogo calculaba la disponibilidad con el horario semanal y los
--     bloqueos. Un técnico fuera de su horario aparecía OCUPADO aunque no
--     tuviera ningún servicio, y uno con servicio activo podía aparecer
--     DISPONIBLE porque el cliente solo alcanza a ver sus propias solicitudes
--     por RLS.
--  2. No existía forma de saber si el técnico tenía la app abierta, ni un
--     interruptor para dejar de recibir solicitudes sin cerrar sesión.
--  3. Los avatares apuntaban a URLs de ejemplo (example.invalid) y no había
--     bucket para subir una foto propia.
--
-- Modelo (servidor como única autoridad):
--  · `tecnico_estado` guarda el interruptor manual y el último latido de la app.
--  · El servicio activo se deriva de `solicitudes` (aceptada…llego). El horario
--    semanal queda solo para la agenda: ya no oculta técnicos libres.
--  · `tecnicos_publicos` expone `estado_disponibilidad` y `disponible_ahora`
--    calculados en el servidor, así todos los clientes ven lo mismo.
--  · Realtime publica `tecnico_estado`; un trigger toca la fila cuando cambia
--    una solicitud, de modo que aceptar o terminar un servicio se refleja al
--    instante en los demás dispositivos.
--
-- Requiere: migraciones 20261107 y 20261111 aplicadas.
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) ESTADO DEL TÉCNICO ───────────────────────────────────────────────────
create table if not exists public.tecnico_estado (
  tecnico_id             bigint primary key references public.tecnicos(id) on delete cascade,
  -- Interruptor manual del perfil: ¿quiere recibir solicitudes en este momento?
  recibiendo_solicitudes boolean not null default true,
  -- Último latido de la app. Null = nunca se conectó o se desconectó a propósito.
  ultima_conexion        timestamptz,
  -- Cambia solo en transiciones reales (conexión, desconexión, interruptor).
  -- El latido normal NO lo modifica para no inundar Realtime.
  actualizado_en         timestamptz not null default now()
);

comment on table public.tecnico_estado is
  'Presencia e interruptor de solicitudes del técnico. La disponibilidad se deriva de aquí y de las solicitudes activas.';

alter table public.tecnico_estado enable row level security;

-- Lectura pública: solo son datos de disponibilidad, no información personal.
drop policy if exists "tecnico_estado_lectura" on public.tecnico_estado;
create policy "tecnico_estado_lectura" on public.tecnico_estado
  for select using (true);

grant select on public.tecnico_estado to anon, authenticated;

-- Nadie escribe directo: las RPC de abajo validan la sesión y el técnico.
revoke insert, update, delete on public.tecnico_estado from anon, authenticated;

-- ── 2) PRESENCIA: LATIDO Y DESCONEXIÓN ──────────────────────────────────────
-- Ventana de gracia: si la app se cierra de golpe (sin avisar), el técnico deja
-- de estar "presente" como máximo 4 minutos después de su último latido.
create or replace function public.tecnico_esta_presente(p_ultima timestamptz)
returns boolean
language sql
stable
as $function$
  select p_ultima is not null and p_ultima > now() - interval '4 minutes';
$function$;

/** Latido de la app abierta. Se llama al entrar y cada minuto mientras está visible. */
create or replace function public.marcar_presencia_tecnico()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tecnico bigint;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;

  select t.id into v_tecnico
    from public.tecnicos t
   where t.usuario_id = auth.uid()
   order by t.id
   limit 1;

  -- Un cliente o un usuario sin ficha de técnico no tiene presencia que marcar.
  if v_tecnico is null then return; end if;

  insert into public.tecnico_estado as e (tecnico_id, ultima_conexion, actualizado_en)
  values (v_tecnico, now(), now())
  on conflict (tecnico_id) do update
    set ultima_conexion = now(),
        -- Solo avisa a los demás cuando pasa de ausente a presente.
        actualizado_en = case
          when e.ultima_conexion is null
            or e.ultima_conexion <= now() - interval '4 minutes'
          then now()
          else e.actualizado_en
        end;
end $function$;

/** Cierre explícito (logout o salida de la app): el técnico deja de estar disponible al instante. */
create or replace function public.marcar_desconexion_tecnico()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then return; end if;

  update public.tecnico_estado e
     set ultima_conexion = null,
         actualizado_en = now()
   where e.tecnico_id in (
     select t.id from public.tecnicos t where t.usuario_id = auth.uid()
   );
end $function$;

/** Interruptor "Recibir solicitudes" del perfil. Devuelve el valor aplicado. */
create or replace function public.alternar_recibir_solicitudes(p_activo boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tecnico bigint;
  v_activo  boolean := coalesce(p_activo, true);
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;

  select t.id into v_tecnico
    from public.tecnicos t
   where t.usuario_id = auth.uid()
   order by t.id
   limit 1;

  if v_tecnico is null then raise exception 'Tu cuenta no tiene ficha de técnico.'; end if;

  insert into public.tecnico_estado as e (tecnico_id, recibiendo_solicitudes, ultima_conexion, actualizado_en)
  values (v_tecnico, v_activo, now(), now())
  on conflict (tecnico_id) do update
    set recibiendo_solicitudes = v_activo,
        -- Tocar el interruptor implica que la persona está en la app.
        ultima_conexion = now(),
        actualizado_en = now();

  return v_activo;
end $function$;

/** Estado propio del técnico autenticado (aunque todavía no esté verificado). */
create or replace function public.mi_estado_tecnico()
returns table(
  tecnico_id             bigint,
  recibiendo_solicitudes boolean,
  presente               boolean,
  estado_disponibilidad  text,
  solicitud_activa       bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    t.id,
    coalesce(e.recibiendo_solicitudes, true),
    public.tecnico_esta_presente(e.ultima_conexion),
    case
      when s.id is not null then 'ocupado'
      when not public.tecnico_esta_presente(e.ultima_conexion) then 'desconectado'
      when not coalesce(e.recibiendo_solicitudes, true) then 'pausado'
      else 'disponible'
    end,
    s.id
  from public.tecnicos t
  left join public.tecnico_estado e on e.tecnico_id = t.id
  left join lateral (
    select so.id
      from public.solicitudes so
     where so.tecnico_id = t.id
       and so.estado in ('aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso', 'en_curso')
     order by so.id
     limit 1
  ) s on true
  where t.usuario_id = auth.uid()
  order by t.id
  limit 1;
$function$;

grant execute on function public.marcar_presencia_tecnico() to authenticated;
grant execute on function public.marcar_desconexion_tecnico() to authenticated;
grant execute on function public.alternar_recibir_solicitudes(boolean) to authenticated;
grant execute on function public.mi_estado_tecnico() to authenticated;

-- ── 3) TRIGGER: UNA SOLICITUD CAMBIA LA DISPONIBILIDAD ──────────────────────
-- Toca `actualizado_en` del técnico afectado para que Realtime avise a todos.
-- Se ejecuta como owner para no depender de las políticas del cliente que actúa.
create or replace function public.solicitud_toca_estado_tecnico()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_activos constant text[] := array['aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso', 'en_curso'];
  v_antes   boolean := false;
  v_despues boolean := false;
  v_cambio_tecnico boolean := false;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_despues := new.tecnico_id is not null and new.estado = any(v_activos);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_antes := old.tecnico_id is not null and old.estado = any(v_activos);
  end if;
  if tg_op = 'UPDATE' then
    v_cambio_tecnico := old.tecnico_id is distinct from new.tecnico_id;
  end if;

  -- Se avisa solo cuando el servicio activo empieza o termina (o cambia de
  -- técnico). Los pasos intermedios (confirmada, en_camino, llego) y las
  -- solicitudes pendientes no alteran la disponibilidad de nadie.
  if v_antes <> v_despues or v_cambio_tecnico then
    if tg_op in ('INSERT', 'UPDATE') and new.tecnico_id is not null then
      insert into public.tecnico_estado (tecnico_id)
      values (new.tecnico_id)
      on conflict (tecnico_id) do nothing;
      update public.tecnico_estado
         set actualizado_en = now()
       where tecnico_id = new.tecnico_id;
    end if;

    if tg_op in ('UPDATE', 'DELETE') and old.tecnico_id is not null then
      update public.tecnico_estado
         set actualizado_en = now()
       where tecnico_id = old.tecnico_id;
    end if;
  end if;

  return null;
end $function$;

drop trigger if exists solicitudes_estado_tecnico on public.solicitudes;
create trigger solicitudes_estado_tecnico
  after insert or update or delete on public.solicitudes
  for each row execute function public.solicitud_toca_estado_tecnico();

-- ── 4) CATÁLOGO PÚBLICO CON DISPONIBILIDAD CALCULADA ───────────────────────
-- Se conservan las columnas existentes (la app vieja sigue funcionando) y se
-- agregan las nuevas al final. `create or replace view` mantiene los permisos.
create or replace view public.tecnicos_publicos as
select t.id,
       t.nombre_publico,
       t.especialidad,
       t.descripcion,
       t.precio_min,
       t.precio_max,
       t.anios_experiencia,
       t.foto_url,
       t.verificado,
       t.categoria_id,
       c.nombre as categoria,
       b.nombre as barrio,
       coalesce(r.rating, 0)::numeric(2,1) as rating,
       coalesce(r.resenas, 0) as resenas,
       coalesce(j.trabajos, 0) as trabajos,
       (sa.id is not null) as ocupado,
       coalesce(e.recibiendo_solicitudes, true) as recibiendo_solicitudes,
       public.tecnico_esta_presente(e.ultima_conexion) as presente,
       case
         when sa.id is not null then 'ocupado'
         when not public.tecnico_esta_presente(e.ultima_conexion) then 'desconectado'
         when not coalesce(e.recibiendo_solicitudes, true) then 'pausado'
         else 'disponible'
       end as estado_disponibilidad,
       (sa.id is null
        and public.tecnico_esta_presente(e.ultima_conexion)
        and coalesce(e.recibiendo_solicitudes, true)) as disponible_ahora
  from public.tecnicos t
  left join public.categorias c on c.id = t.categoria_id
  left join public.barrios b on b.id = t.barrio_id
  left join public.tecnico_estado e on e.tecnico_id = t.id
  left join lateral (
    select round(avg(calificaciones.puntuacion), 1) as rating,
           count(*)::integer as resenas
      from public.calificaciones
     where calificaciones.tecnico_id = t.id
  ) r on true
  left join lateral (
    select count(*)::integer as trabajos
      from public.solicitudes
     where solicitudes.tecnico_id = t.id
       and solicitudes.estado = 'completada'
  ) j on true
  left join lateral (
    select so.id
      from public.solicitudes so
     where so.tecnico_id = t.id
       and so.estado in ('aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso', 'en_curso')
     order by so.id
     limit 1
  ) sa on true
 where t.activo and t.verificado;

grant select on public.tecnicos_publicos to anon, authenticated;

-- ── 5) REALTIME ─────────────────────────────────────────────────────────────
do $block$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'tecnico_estado'
     ) then
    alter publication supabase_realtime add table public.tecnico_estado;
  end if;
end $block$;

-- ── 6) AVATARES DE TÉCNICOS ─────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatares-tecnicos', 'avatares-tecnicos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública: la foto se muestra en el catálogo a cualquier visitante.
drop policy if exists "avatares_lectura" on storage.objects;
create policy "avatares_lectura" on storage.objects
  for select using (bucket_id = 'avatares-tecnicos');

-- Cada técnico solo escribe dentro de su propia carpeta: <tecnico_id>/avatar.jpg
drop policy if exists "avatares_escritura" on storage.objects;
create policy "avatares_escritura" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatares-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

drop policy if exists "avatares_actualizacion" on storage.objects;
create policy "avatares_actualizacion" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatares-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  )
  with check (
    bucket_id = 'avatares-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

drop policy if exists "avatares_borrado" on storage.objects;
create policy "avatares_borrado" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatares-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

/** Guarda la URL pública de la foto en la ficha del técnico autenticado. */
create or replace function public.guardar_foto_tecnico(p_url text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url text := nullif(btrim(p_url), '');
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'La foto debe ser una URL válida.';
  end if;

  update public.tecnicos
     set foto_url = v_url
   where usuario_id = auth.uid();

  if not found then
    raise exception 'Tu cuenta no tiene ficha de técnico.';
  end if;
end $function$;

grant execute on function public.guardar_foto_tecnico(text) to authenticated;

-- Los datos de ejemplo apuntaban a un dominio inexistente: mejor null para que
-- la app use la foto por defecto del género en vez de una imagen rota.
update public.tecnicos
   set foto_url = null
 where foto_url is null
    or btrim(foto_url) = ''
    or foto_url ilike '%example.invalid%';

commit;

-- Verificación rápida después de aplicar:
--   select id, nombre_publico, estado_disponibilidad, disponible_ahora
--     from public.tecnicos_publicos order by id limit 20;
--   select * from public.tecnico_estado;
