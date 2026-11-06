-- ═══════════════════════════════════════════════════════════════════════════
-- Notificaciones push · Bandeja · Preferencias · Soporte
--
-- Ejecutar en Supabase → SQL Editor, todo el bloque de una vez. Es idempotente.
-- Requiere: 20261020_solicitud_eventos.sql y 20261101_chat_pagos_cuenta_bancaria.sql.
--
-- Decisiones:
--  · Los tokens de dispositivo viven en `dispositivos_push`; nunca se exponen a
--    otros usuarios. El envío real lo hace la Edge Function `enviar-push` con
--    la llave de servicio (FCM HTTP v1).
--  · Cada aviso se guarda primero en `notificaciones` (bandeja + auditoría) y
--    queda `push_enviado = false` hasta que la función lo despacha. Así una
--    caída de FCM no pierde el aviso: se reintenta.
--  · Se respetan las preferencias EN EL SERVIDOR. `sistema` (seguridad/cuenta)
--    se envía siempre, salvo que el usuario apague TODO el push.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) PREFERENCIAS ─────────────────────────────────────────────────────────
create table if not exists public.notificaciones_preferencias (
  usuario_id       uuid primary key references public.usuarios(id) on delete cascade,
  push_activo      boolean not null default true,
  mensajes         boolean not null default true,
  estados_servicio boolean not null default true,
  pagos            boolean not null default true,
  promociones      boolean not null default false,
  actualizado_en   timestamptz not null default now()
);

alter table public.notificaciones_preferencias enable row level security;

drop policy if exists notif_prefs_select on public.notificaciones_preferencias;
create policy notif_prefs_select on public.notificaciones_preferencias
  for select to authenticated using (usuario_id = auth.uid());

drop policy if exists notif_prefs_insert on public.notificaciones_preferencias;
create policy notif_prefs_insert on public.notificaciones_preferencias
  for insert to authenticated with check (usuario_id = auth.uid());

drop policy if exists notif_prefs_update on public.notificaciones_preferencias;
create policy notif_prefs_update on public.notificaciones_preferencias
  for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

revoke all on public.notificaciones_preferencias from anon, authenticated;
grant select, insert, update on public.notificaciones_preferencias to authenticated;

/** Preferencias del usuario; si no existen, se crean con los valores por defecto. */
create or replace function public.mis_preferencias_notificacion()
returns public.notificaciones_preferencias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.notificaciones_preferencias;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  insert into public.notificaciones_preferencias (usuario_id)
  values (v_uid)
  on conflict (usuario_id) do nothing;
  select * into v_row from public.notificaciones_preferencias where usuario_id = v_uid;
  return v_row;
end;
$$;

grant execute on function public.mis_preferencias_notificacion() to authenticated;

create or replace function public.guardar_preferencias_notificacion(
  p_push_activo boolean,
  p_mensajes boolean,
  p_estados_servicio boolean,
  p_pagos boolean,
  p_promociones boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  insert into public.notificaciones_preferencias
    (usuario_id, push_activo, mensajes, estados_servicio, pagos, promociones, actualizado_en)
  values
    (v_uid, coalesce(p_push_activo, true), coalesce(p_mensajes, true),
     coalesce(p_estados_servicio, true), coalesce(p_pagos, true),
     coalesce(p_promociones, false), now())
  on conflict (usuario_id) do update
    set push_activo = excluded.push_activo,
        mensajes = excluded.mensajes,
        estados_servicio = excluded.estados_servicio,
        pagos = excluded.pagos,
        promociones = excluded.promociones,
        actualizado_en = now();
end;
$$;

grant execute on function public.guardar_preferencias_notificacion(boolean, boolean, boolean, boolean, boolean) to authenticated;

-- ── 2) DISPOSITIVOS PUSH ────────────────────────────────────────────────────
create table if not exists public.dispositivos_push (
  id             bigint generated always as identity primary key,
  usuario_id     uuid not null references public.usuarios(id) on delete cascade,
  token          text not null check (char_length(token) between 20 and 4096),
  plataforma     text not null default 'android' check (plataforma in ('android', 'ios', 'web')),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (token)
);

create index if not exists dispositivos_push_usuario_idx
  on public.dispositivos_push (usuario_id) where activo;

alter table public.dispositivos_push enable row level security;

drop policy if exists dispositivos_push_select on public.dispositivos_push;
create policy dispositivos_push_select on public.dispositivos_push
  for select to authenticated using (usuario_id = auth.uid());

revoke all on public.dispositivos_push from anon, authenticated;
grant select on public.dispositivos_push to authenticated;

/**
 * Registra el token del dispositivo para el usuario actual.
 * Si el token ya existía en otro usuario (p. ej. cambió de cuenta en el mismo
 * teléfono), se reasigna para no enviar avisos a la persona equivocada.
 */
create or replace function public.registrar_dispositivo_push(p_token text, p_plataforma text default 'android')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tok text := btrim(coalesce(p_token, ''));
  v_plat text := lower(btrim(coalesce(p_plataforma, 'android')));
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  if char_length(v_tok) < 20 or char_length(v_tok) > 4096 then
    raise exception 'Token de dispositivo no válido.';
  end if;
  if v_plat not in ('android', 'ios', 'web') then v_plat := 'android'; end if;

  insert into public.dispositivos_push (usuario_id, token, plataforma, activo, actualizado_en)
  values (v_uid, v_tok, v_plat, true, now())
  on conflict (token) do update
    set usuario_id = v_uid,
        plataforma = excluded.plataforma,
        activo = true,
        actualizado_en = now();
end;
$$;

grant execute on function public.registrar_dispositivo_push(text, text) to authenticated;

create or replace function public.desactivar_dispositivo_push(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  update public.dispositivos_push
     set activo = false, actualizado_en = now()
   where token = btrim(coalesce(p_token, '')) and usuario_id = v_uid;
end;
$$;

grant execute on function public.desactivar_dispositivo_push(text) to authenticated;

-- ── 3) BANDEJA DE NOTIFICACIONES ────────────────────────────────────────────
create table if not exists public.notificaciones (
  id            bigint generated always as identity primary key,
  usuario_id    uuid not null references public.usuarios(id) on delete cascade,
  tipo          text not null check (tipo in ('mensaje', 'estado_servicio', 'pago', 'promocion', 'sistema')),
  titulo        text not null check (char_length(titulo) between 1 and 160),
  cuerpo        text not null check (char_length(cuerpo) between 1 and 500),
  solicitud_id  bigint references public.solicitudes(id) on delete cascade,
  leida         boolean not null default false,
  push_enviado  boolean not null default false,
  push_intentos integer not null default 0,
  creada_en     timestamptz not null default now()
);

create index if not exists notificaciones_usuario_idx
  on public.notificaciones (usuario_id, creada_en desc);
create index if not exists notificaciones_pendientes_push_idx
  on public.notificaciones (creada_en) where push_enviado = false;

alter table public.notificaciones enable row level security;

drop policy if exists notificaciones_select on public.notificaciones;
create policy notificaciones_select on public.notificaciones
  for select to authenticated using (usuario_id = auth.uid());

drop policy if exists notificaciones_update on public.notificaciones;
create policy notificaciones_update on public.notificaciones
  for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

revoke all on public.notificaciones from anon, authenticated;
grant select, update on public.notificaciones to authenticated;

alter table public.notificaciones replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificaciones') then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;

/** ¿El usuario quiere recibir este tipo? Misma regla que `src/lib/notificaciones.ts`. */
create or replace function public.debe_notificar(p_usuario uuid, p_tipo text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare p public.notificaciones_preferencias;
begin
  select * into p from public.notificaciones_preferencias where usuario_id = p_usuario;
  if not found then
    -- Sin fila = valores por defecto.
    return p_tipo = 'sistema' or p_tipo in ('mensaje', 'estado_servicio', 'pago');
  end if;
  if not p.push_activo then return false; end if;
  case p_tipo
    when 'mensaje' then return p.mensajes;
    when 'estado_servicio' then return p.estados_servicio;
    when 'pago' then return p.pagos;
    when 'promocion' then return p.promociones;
    when 'sistema' then return true;
    else return false;
  end case;
end;
$$;

/** Encola un aviso si el usuario lo permite. Devuelve el id o null. */
create or replace function public.encolar_notificacion(
  p_usuario uuid,
  p_tipo text,
  p_titulo text,
  p_cuerpo text,
  p_solicitud_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  if p_usuario is null then return null; end if;
  if not public.debe_notificar(p_usuario, p_tipo) then return null; end if;
  insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, solicitud_id)
  values (p_usuario, p_tipo, left(p_titulo, 160), left(p_cuerpo, 500), p_solicitud_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.encolar_notificacion(uuid, text, text, text, bigint) from public, anon, authenticated;

create or replace function public.marcar_notificacion_leida(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notificaciones
     set leida = true
   where id = p_id and usuario_id = auth.uid();
end;
$$;

grant execute on function public.marcar_notificacion_leida(bigint) to authenticated;

create or replace function public.marcar_todas_leidas()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notificaciones set leida = true
   where usuario_id = auth.uid() and leida = false;
end;
$$;

grant execute on function public.marcar_todas_leidas() to authenticated;

-- ── 4) DISPARADORES: MENSAJES Y CAMBIOS DE ESTADO ───────────────────────────
/**
 * Al llegar un mensaje, avisa al OTRO participante. No se envía al autor.
 * El texto se recorta: la push nunca lleva el mensaje completo.
 */
create or replace function public.trg_notificar_mensaje()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_tecnico_usuario uuid;
  v_destino uuid;
  v_remitente text;
begin
  select s.cliente_id,
         (select t.usuario_id from public.tecnicos t where t.id = s.tecnico_id)
    into v_cliente, v_tecnico_usuario
    from public.solicitudes s where s.id = new.solicitud_id;

  if new.autor_rol = 'cliente' then
    v_destino := v_tecnico_usuario;
    v_remitente := 'el cliente';
  else
    v_destino := v_cliente;
    v_remitente := 'el técnico';
  end if;

  perform public.encolar_notificacion(
    v_destino,
    'mensaje',
    'Nuevo mensaje de ' || v_remitente,
    left(regexp_replace(new.contenido, '\s+', ' ', 'g'), 120) || ' · Solicitud #' || new.solicitud_id,
    new.solicitud_id
  );
  return new;
end;
$$;

drop trigger if exists trg_solicitud_mensajes_notificar on public.solicitud_mensajes;
create trigger trg_solicitud_mensajes_notificar
  after insert on public.solicitud_mensajes
  for each row execute function public.trg_notificar_mensaje();

/** Al cambiar el estado, avisa a la contraparte. */
create or replace function public.trg_notificar_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destino uuid;
  v_tecnico_usuario uuid;
  v_texto text;
begin
  if new.estado is not distinct from old.estado then return new; end if;

  select t.usuario_id into v_tecnico_usuario from public.tecnicos t where t.id = new.tecnico_id;

  -- Quien provocó el cambio no recibe el aviso.
  if new.estado in ('aceptada', 'rechazada', 'en_camino', 'llego', 'completada') then
    v_destino := new.cliente_id;
  elsif new.estado in ('confirmada', 'cancelada') then
    v_destino := v_tecnico_usuario;
  else
    return new;
  end if;

  v_texto := case new.estado
    when 'aceptada' then 'El técnico aceptó tu solicitud.'
    when 'confirmada' then 'El cliente confirmó el servicio. Ya puedes ir al domicilio.'
    when 'en_camino' then 'El técnico va en camino.'
    when 'llego' then 'El técnico llegó a tu domicilio.'
    when 'completada' then 'El servicio terminó. Ya puedes calificar y pagar.'
    when 'cancelada' then 'La solicitud fue cancelada.'
    when 'rechazada' then 'La solicitud fue rechazada.'
    else 'La solicitud cambió a ' || new.estado || '.'
  end;

  perform public.encolar_notificacion(
    v_destino, 'estado_servicio', 'Solicitud #' || new.id, v_texto, new.id
  );
  return new;
end;
$$;

drop trigger if exists trg_solicitudes_notificar_estado on public.solicitudes;
create trigger trg_solicitudes_notificar_estado
  after update of estado on public.solicitudes
  for each row execute function public.trg_notificar_estado();

-- ── 5) SOPORTE ──────────────────────────────────────────────────────────────
create table if not exists public.tickets_soporte (
  id            bigint generated always as identity primary key,
  usuario_id    uuid not null references public.usuarios(id) on delete cascade,
  solicitud_id  bigint references public.solicitudes(id) on delete set null,
  categoria     text not null check (categoria in ('pago', 'servicio', 'cuenta', 'tecnico', 'otro')),
  asunto        text not null check (char_length(btrim(asunto)) between 5 and 120),
  descripcion   text not null check (char_length(btrim(descripcion)) between 20 and 2000),
  estado        text not null default 'abierto' check (estado in ('abierto', 'en_revision', 'resuelto', 'cerrado')),
  respuesta     text,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists tickets_soporte_usuario_idx
  on public.tickets_soporte (usuario_id, creado_en desc);

alter table public.tickets_soporte enable row level security;

drop policy if exists tickets_soporte_select on public.tickets_soporte;
create policy tickets_soporte_select on public.tickets_soporte
  for select to authenticated using (usuario_id = auth.uid());

revoke all on public.tickets_soporte from anon, authenticated;
grant select on public.tickets_soporte to authenticated;

/**
 * Crea un ticket. Si viene `p_solicitud_id`, valida que el usuario participe
 * en esa solicitud (cliente o técnico) para no filtrar información.
 */
create or replace function public.crear_ticket_soporte(
  p_categoria text,
  p_asunto text,
  p_descripcion text,
  p_solicitud_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cat text := lower(btrim(coalesce(p_categoria, '')));
  v_asunto text := btrim(coalesce(p_asunto, ''));
  v_desc text := btrim(coalesce(p_descripcion, ''));
  v_id bigint;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  if v_cat not in ('pago', 'servicio', 'cuenta', 'tecnico', 'otro') then
    raise exception 'Selecciona una categoría válida.';
  end if;
  if char_length(v_asunto) < 5 or char_length(v_asunto) > 120 then
    raise exception 'El asunto debe tener entre 5 y 120 caracteres.';
  end if;
  if char_length(v_desc) < 20 or char_length(v_desc) > 2000 then
    raise exception 'La descripción debe tener entre 20 y 2000 caracteres.';
  end if;

  if p_solicitud_id is not null then
    if not exists (
      select 1 from public.solicitudes s
      where s.id = p_solicitud_id
        and (s.cliente_id = v_uid
             or s.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = v_uid))
    ) then
      raise exception 'No participas en esa solicitud.';
    end if;
  end if;

  insert into public.tickets_soporte (usuario_id, solicitud_id, categoria, asunto, descripcion)
  values (v_uid, p_solicitud_id, v_cat, v_asunto, v_desc)
  returning id into v_id;

  -- Confirmación en la bandeja (tipo sistema: siempre pasa).
  perform public.encolar_notificacion(
    v_uid, 'sistema', 'Recibimos tu solicitud de soporte',
    'Ticket #' || v_id || ': ' || left(v_asunto, 100), p_solicitud_id
  );
  return v_id;
end;
$$;

grant execute on function public.crear_ticket_soporte(text, text, text, bigint) to authenticated;

-- ── 6) Verificación rápida (opcional) ───────────────────────────────────────
-- select table_name from information_schema.tables
--  where table_schema = 'public'
--    and table_name in ('notificaciones_preferencias','dispositivos_push','notificaciones','tickets_soporte');
