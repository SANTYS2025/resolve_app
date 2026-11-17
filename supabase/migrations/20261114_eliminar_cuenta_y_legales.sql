-- Bloque 4: consentimiento legal y eliminación de cuenta.
--
-- · `consentimientos` deja constancia de la aceptación (versión y fecha).
-- · `registrar_consentimiento` permite registrar aceptaciones posteriores.
-- · `eliminar_mi_cuenta` anonimiza el perfil, borra datos personales y elimina
--   el usuario de Auth. Conserva `public.usuarios` y las filas financieras
--   (`solicitudes`, `transacciones`) porque sus FKs son ON DELETE RESTRICT.
--
-- Aplicar con `supabase db push` o desde el SQL Editor. Es idempotente.

/* ═════════ 1. Tabla de consentimientos ═════════ */

create table if not exists public.consentimientos (
  -- Se referencia `auth.users` (no `public.usuarios`) porque el trigger de alta
  -- corre en el INSERT de Auth, antes de que exista la fila de perfil.
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('terminos', 'privacidad', 'datos')),
  version text not null check (char_length(btrim(version)) between 1 and 40),
  aceptado_en timestamptz not null default now(),
  primary key (usuario_id, tipo, version)
);

-- Si una ejecución anterior creó la FK hacia `public.usuarios`, se corrige.
alter table public.consentimientos drop constraint if exists consentimientos_usuario_id_fkey;
alter table public.consentimientos add constraint consentimientos_usuario_id_fkey
  foreign key (usuario_id) references auth.users(id) on delete cascade;

alter table public.consentimientos enable row level security;

drop policy if exists con_select on public.consentimientos;
create policy con_select on public.consentimientos
  as permissive for select to authenticated
  using (usuario_id = auth.uid());

drop policy if exists con_insert on public.consentimientos;
create policy con_insert on public.consentimientos
  as permissive for insert to authenticated
  with check (usuario_id = auth.uid());

revoke all on public.consentimientos from public, anon;
grant select, insert on public.consentimientos to authenticated;

/* ═════════ 2. Registro explícito del consentimiento ═════════ */

create or replace function public.registrar_consentimiento(
  p_tipo text default 'terminos',
  p_version text default '2026-11-14'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tipo text := lower(btrim(coalesce(p_tipo, 'terminos')));
  v_version text := btrim(coalesce(p_version, '2026-11-14'));
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para registrar el consentimiento.' using errcode = 'P0001';
  end if;
  if v_tipo not in ('terminos', 'privacidad', 'datos') then
    raise exception 'Tipo de consentimiento inválido.' using errcode = '22023';
  end if;
  if char_length(v_version) < 1 or char_length(v_version) > 40 then
    raise exception 'Versión de consentimiento inválida.' using errcode = '22023';
  end if;

  insert into public.consentimientos (usuario_id, tipo, version)
  values (v_uid, v_tipo, v_version)
  on conflict (usuario_id, tipo, version) do nothing;
end;
$$;

revoke all on function public.registrar_consentimiento(text, text) from public, anon;
grant execute on function public.registrar_consentimiento(text, text) to authenticated;

/* ═════════ 3. Alta de usuario: consentimiento desde el registro ═════════
 * El registro envía `acepto_terminos`, `acepto_terminos_en` y `version_legal`
 * en el user_metadata. Así el consentimiento queda registrado incluso si la
 * cuenta requiere confirmación por correo y todavía no hay sesión.
 */

create or replace function public.registrar_consentimiento_alta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'version_legal'), ''), '2026-11-14');
begin
  if coalesce((new.raw_user_meta_data ->> 'acepto_terminos')::boolean, false) then
    insert into public.consentimientos (usuario_id, tipo, version, aceptado_en)
    values (new.id, 'terminos', v_version, now())
    on conflict (usuario_id, tipo, version) do nothing;
  end if;
  return new;
exception
  when others then
    -- Nunca bloquear el alta de Auth por un fallo al guardar el consentimiento.
    raise warning 'No se pudo registrar el consentimiento del usuario %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_consentimiento_alta on auth.users;
create trigger trg_consentimiento_alta
  after insert on auth.users
  for each row execute function public.registrar_consentimiento_alta();

/* ═════════ 4. Eliminación de la propia cuenta ═════════ */

create or replace function public.eliminar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tecnico_id bigint;
  v_estados_activos text[] := array[
    'pendiente', 'aceptada', 'confirmada', 'en_camino', 'llego',
    'en_proceso', 'en_curso', 'en_espera', 'confirmada_en_espera'
  ];
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para eliminar tu cuenta.' using errcode = 'P0001';
  end if;

  -- Un servicio en curso impide eliminar la cuenta: primero se cierra.
  if exists (
    select 1 from public.solicitudes s
    where s.cliente_id = v_uid
      and s.estado::text = any (v_estados_activos)
  ) then
    raise exception 'No puedes eliminar tu cuenta mientras tengas un servicio activo. Termínalo o cancélalo primero.'
      using errcode = 'P0001';
  end if;

  select t.id into v_tecnico_id
  from public.tecnicos t
  where t.usuario_id = v_uid
  limit 1;

  if v_tecnico_id is not null and exists (
    select 1 from public.solicitudes s
    where s.tecnico_id = v_tecnico_id
      and s.estado::text = any (v_estados_activos)
  ) then
    raise exception 'No puedes eliminar tu cuenta mientras tengas un servicio activo. Termínalo o cancélalo primero.'
      using errcode = 'P0001';
  end if;

  -- Datos personales y de contacto.
  delete from public.notificaciones where usuario_id = v_uid;
  delete from public.dispositivos_push where usuario_id = v_uid;
  delete from public.notificaciones_preferencias where usuario_id = v_uid;
  delete from public.consentimientos where usuario_id = v_uid;
  delete from public.favoritos where cliente_id = v_uid;
  delete from public.codigos_referido where usuario_id = v_uid;
  delete from public.tickets_soporte where usuario_id = v_uid;
  delete from public.reportes_problemas where usuario_id = v_uid;
  delete from public.solicitud_mensajes where autor_id = v_uid;
  update public.calificaciones set comentario = null where cliente_id = v_uid;
  update public.solicitud_calificaciones set comentario = null where autor_id = v_uid;

  -- Datos del técnico: documentos, portafolio, cuentas y agenda.
  if v_tecnico_id is not null then
    delete from public.documentos_tecnicos where tecnico_id = v_tecnico_id;
    delete from public.portafolio_tecnicos where tecnico_id = v_tecnico_id;
    delete from public.cuentas_bancarias_tecnicos where tecnico_id = v_tecnico_id;
    delete from public.disponibilidades where tecnico_id = v_tecnico_id;
    delete from public.bloqueos_agenda where tecnico_id = v_tecnico_id;
    delete from public.ubicaciones_tecnicos where tecnico_id = v_tecnico_id;
    delete from public.verificaciones where tecnico_id = v_tecnico_id;

    update public.tecnicos
    set nombre_publico = 'Técnico eliminado',
        descripcion = null,
        foto_url = null,
        genero = null,
        barrio_id = null,
        activo = false,
        disponible = false,
        verificado = false,
        actualizado_en = now()
    where id = v_tecnico_id;
  end if;

  -- Se conserva la fila de `usuarios` para no romper las FKs RESTRICT de
  -- solicitudes/transacciones, pero queda sin datos personales.
  update public.usuarios
  set nombre = 'Cuenta eliminada',
      email = 'eliminado+' || v_uid::text || '@resolve.invalid',
      telefono = null,
      activo = false,
      actualizado_en = now()
  where id = v_uid;

  -- Finalmente se revoca el acceso eliminando el usuario de Auth.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.eliminar_mi_cuenta() from public, anon;
grant execute on function public.eliminar_mi_cuenta() to authenticated;
