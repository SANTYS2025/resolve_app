-- ═══════════════════════════════════════════════════════════════════════════
-- Herramientas de clientes y técnicos
--   · Favoritos
--   · Bloqueos de agenda por fecha (además del horario semanal existente)
--   · Portafolio y documentos del técnico
--   · Reportes de problemas de un servicio
--
-- Ejecutar en Supabase → SQL Editor, todo el bloque de una vez. Es idempotente.
-- Requiere: 20261101_chat_pagos_cuenta_bancaria.sql y 20261103_confirmacion_tecnico_estados.sql.
--
-- Decisiones:
--  · Los favoritos son privados de cada cliente.
--  · Los bloqueos de agenda son fechas completas (lo más simple compatible con
--    `disponibilidades`, que ya guarda el horario semanal).
--  · El portafolio es público para técnicos verificados; los documentos de
--    verificación son privados del técnico y del equipo de Resolve.
--  · Un reporte nunca modifica el estado del servicio por sí solo: queda para
--    revisión y conserva la trazabilidad.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) FAVORITOS ────────────────────────────────────────────────────────────
create table if not exists public.favoritos (
  cliente_id  uuid not null references public.usuarios(id) on delete cascade,
  tecnico_id  bigint not null references public.tecnicos(id) on delete cascade,
  creado_en   timestamptz not null default now(),
  primary key (cliente_id, tecnico_id)
);

create index if not exists favoritos_cliente_idx on public.favoritos (cliente_id, creado_en desc);

alter table public.favoritos enable row level security;

drop policy if exists favoritos_select on public.favoritos;
create policy favoritos_select on public.favoritos
  for select to authenticated using (cliente_id = auth.uid());

drop policy if exists favoritos_insert on public.favoritos;
create policy favoritos_insert on public.favoritos
  for insert to authenticated with check (cliente_id = auth.uid());

drop policy if exists favoritos_delete on public.favoritos;
create policy favoritos_delete on public.favoritos
  for delete to authenticated using (cliente_id = auth.uid());

revoke all on public.favoritos from anon, authenticated;
grant select, insert, delete on public.favoritos to authenticated;

/** Agrega o quita un favorito. Devuelve true si quedó guardado. */
create or replace function public.alternar_favorito(p_tecnico_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existe boolean;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  if not exists (select 1 from public.tecnicos where id = p_tecnico_id and verificado) then
    raise exception 'El técnico no está disponible.';
  end if;
  select exists (select 1 from public.favoritos where cliente_id = v_uid and tecnico_id = p_tecnico_id) into v_existe;
  if v_existe then
    delete from public.favoritos where cliente_id = v_uid and tecnico_id = p_tecnico_id;
    return false;
  end if;
  insert into public.favoritos (cliente_id, tecnico_id) values (v_uid, p_tecnico_id);
  return true;
end;
$$;

grant execute on function public.alternar_favorito(bigint) to authenticated;

-- ── 2) BLOQUEOS DE AGENDA ───────────────────────────────────────────────────
create table if not exists public.bloqueos_agenda (
  id          bigint generated always as identity primary key,
  tecnico_id  bigint not null references public.tecnicos(id) on delete cascade,
  fecha       date not null,
  todo_el_dia boolean not null default true,
  hora_inicio time,
  hora_fin    time,
  motivo      text check (motivo is null or char_length(motivo) <= 120),
  creado_en   timestamptz not null default now(),
  unique (tecnico_id, fecha)
);

create index if not exists bloqueos_agenda_tecnico_idx
  on public.bloqueos_agenda (tecnico_id, fecha);

alter table public.bloqueos_agenda enable row level security;

drop policy if exists bloqueos_agenda_select on public.bloqueos_agenda;
create policy bloqueos_agenda_select on public.bloqueos_agenda
  for select to authenticated using (true);

drop policy if exists bloqueos_agenda_write on public.bloqueos_agenda;
create policy bloqueos_agenda_write on public.bloqueos_agenda
  for all to authenticated
  using (tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid()))
  with check (tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid()));

revoke all on public.bloqueos_agenda from anon, authenticated;
grant select, insert, update, delete on public.bloqueos_agenda to authenticated;

create or replace function public.crear_bloqueo_agenda(
  p_fecha date,
  p_motivo text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tecnico bigint;
  v_id bigint;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  select t.id into v_tecnico from public.tecnicos t where t.usuario_id = v_uid order by t.id limit 1;
  if not found then raise exception 'Solo un técnico puede bloquear su agenda.'; end if;
  if p_fecha is null then raise exception 'Selecciona una fecha.'; end if;

  insert into public.bloqueos_agenda (tecnico_id, fecha, motivo)
  values (v_tecnico, p_fecha, nullif(btrim(coalesce(p_motivo, '')), ''))
  on conflict (tecnico_id, fecha) do update
    set motivo = excluded.motivo
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.crear_bloqueo_agenda(date, text) to authenticated;

create or replace function public.eliminar_bloqueo_agenda(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  delete from public.bloqueos_agenda b
   where b.id = p_id
     and b.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = v_uid);
end;
$$;

grant execute on function public.eliminar_bloqueo_agenda(bigint) to authenticated;

-- ── 3) PORTAFOLIO DEL TÉCNICO ───────────────────────────────────────────────
create table if not exists public.portafolio_tecnicos (
  id          bigint generated always as identity primary key,
  tecnico_id  bigint not null references public.tecnicos(id) on delete cascade,
  titulo      text not null check (char_length(btrim(titulo)) between 3 and 100),
  descripcion text check (descripcion is null or char_length(descripcion) <= 500),
  url         text check (url is null or url ~ '^https?://'),
  creado_en   timestamptz not null default now()
);

create index if not exists portafolio_tecnico_idx on public.portafolio_tecnicos (tecnico_id, creado_en desc);

alter table public.portafolio_tecnicos enable row level security;

-- Público: solo portafolio de técnicos verificados.
drop policy if exists portafolio_select on public.portafolio_tecnicos;
create policy portafolio_select on public.portafolio_tecnicos
  for select to authenticated
  using (tecnico_id in (select t.id from public.tecnicos t where t.verificado));

-- El técnico administra el suyo.
drop policy if exists portafolio_write on public.portafolio_tecnicos;
create policy portafolio_write on public.portafolio_tecnicos
  for all to authenticated
  using (tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid()))
  with check (tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid()));

revoke all on public.portafolio_tecnicos from anon, authenticated;
grant select, insert, update, delete on public.portafolio_tecnicos to authenticated;

-- ── 4) DOCUMENTOS DEL TÉCNICO (privados) ────────────────────────────────────
create table if not exists public.documentos_tecnicos (
  id          bigint generated always as identity primary key,
  tecnico_id  bigint not null references public.tecnicos(id) on delete cascade,
  tipo        text not null check (tipo in ('cedula_frente', 'cedula_reverso', 'selfie', 'certificado', 'otro')),
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 120),
  url         text not null check (url ~ '^https?://'),
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  creado_en   timestamptz not null default now()
);

create index if not exists documentos_tecnico_idx on public.documentos_tecnicos (tecnico_id, creado_en desc);

alter table public.documentos_tecnicos enable row level security;

drop policy if exists documentos_tecnico_select on public.documentos_tecnicos;
create policy documentos_tecnico_select on public.documentos_tecnicos
  for select to authenticated
  using (tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid()));

drop policy if exists documentos_tecnico_write on public.documentos_tecnicos;
create policy documentos_tecnico_write on public.documentos_tecnicos
  for all to authenticated
  using (tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid()))
  with check (tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid()));

revoke all on public.documentos_tecnicos from anon, authenticated;
grant select, insert, update, delete on public.documentos_tecnicos to authenticated;

-- ── 5) REPORTES DE PROBLEMAS ────────────────────────────────────────────────
create table if not exists public.reportes_problemas (
  id           bigint generated always as identity primary key,
  solicitud_id bigint not null references public.solicitudes(id) on delete cascade,
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  categoria    text not null check (categoria in ('no_llego', 'trabajo_incompleto', 'cobro_indebido', 'trato', 'otro')),
  descripcion  text not null check (char_length(btrim(descripcion)) between 20 and 2000),
  estado       text not null default 'abierto' check (estado in ('abierto', 'en_revision', 'resuelto', 'cerrado')),
  creado_en    timestamptz not null default now()
);

create index if not exists reportes_solicitud_idx on public.reportes_problemas (solicitud_id, creado_en desc);

alter table public.reportes_problemas enable row level security;

-- El autor ve sus reportes; el técnico de la solicitud también (para poder responder).
drop policy if exists reportes_select on public.reportes_problemas;
create policy reportes_select on public.reportes_problemas
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or exists (
      select 1 from public.solicitudes s
      where s.id = reportes_problemas.solicitud_id
        and s.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid())
    )
  );

revoke all on public.reportes_problemas from anon, authenticated;
grant select on public.reportes_problemas to authenticated;

create or replace function public.reportar_problema(
  p_solicitud_id bigint,
  p_categoria text,
  p_descripcion text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cat text := lower(btrim(coalesce(p_categoria, '')));
  v_desc text := btrim(coalesce(p_descripcion, ''));
  v_id bigint;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  if v_cat not in ('no_llego', 'trabajo_incompleto', 'cobro_indebido', 'trato', 'otro') then
    raise exception 'Selecciona un tipo de problema.';
  end if;
  if char_length(v_desc) < 20 or char_length(v_desc) > 2000 then
    raise exception 'Cuéntanos qué pasó con al menos 20 caracteres.';
  end if;
  if not exists (
    select 1 from public.solicitudes s
    where s.id = p_solicitud_id
      and (s.cliente_id = v_uid
           or s.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = v_uid))
  ) then
    raise exception 'No participas en esa solicitud.';
  end if;

  insert into public.reportes_problemas (solicitud_id, usuario_id, categoria, descripcion)
  values (p_solicitud_id, v_uid, v_cat, v_desc)
  returning id into v_id;

  perform public.encolar_notificacion(
    v_uid, 'sistema', 'Recibimos tu reporte',
    'Reporte #' || v_id || ' de la solicitud #' || p_solicitud_id || '. Lo revisaremos.', p_solicitud_id
  );
  return v_id;
end;
$$;

grant execute on function public.reportar_problema(bigint, text, text) to authenticated;

-- ── Verificación rápida (opcional) ─────────────────────────────────────────
-- select * from public.favoritos;
-- select * from public.bloqueos_agenda order by fecha;
-- select * from public.reportes_problemas order by creado_en desc;
