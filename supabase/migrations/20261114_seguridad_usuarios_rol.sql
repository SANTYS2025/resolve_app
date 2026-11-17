-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUEANTE 1 · Escalada de rol en `public.usuarios`
--
-- Problema: la policy `usr_update` solo comprobaba `id = auth.uid()`. Eso
-- permite que un usuario autenticado haga:
--
--   update usuarios set rol = 'admin' where id = auth.uid();
--
-- y se auto-promueva (o cambie `activo`, el correo vinculado a la cuenta, etc.).
--
-- Solución en dos capas, para que no dependa de una sola política:
--   1) Se reemplaza la policy de UPDATE por una explícita (mismo dueño).
--   2) Se agrega un trigger BEFORE UPDATE que rechaza cualquier cambio de
--      columnas sensibles hecho por alguien que no sea administrador o
--      `service_role`. La lista de columnas protegidas se detecta contra el
--      catálogo real, así que la migración funciona aunque el esquema tenga
--      columnas de aprobación agregadas por otro repositorio/panel.
--   3) Se revoca el UPDATE de tabla y se concede solo en las columnas que el
--      perfil realmente edita (`nombre`, `telefono`). Esto es defensa en
--      profundidad: aunque alguien reemplace la policy en el futuro, la base
--      seguirá negando escribir `rol`.
--
-- Requiere: `public.es_admin()` (20261105_pagos_wompi.sql).
-- Es idempotente: se puede ejecutar varias veces.
-- Ejecutar en Supabase → SQL Editor (o `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) POLICY DE UPDATE: solo la propia fila ────────────────────────────────
-- Se conserva la regla de "solo mi fila" (la app la necesita para el perfil),
-- pero la protección de columnas ya no queda a cargo de la policy.
drop policy if exists usr_update on public.usuarios;
create policy usr_update on public.usuarios
  as permissive
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── 2) TRIGGER: bloquea cambios de columnas sensibles ──────────────────────
-- ¿Por qué un trigger y no solo RLS? Porque RLS decide QUÉ FILAS se tocan,
-- no QUÉ COLUMNAS. Un trigger BEFORE UPDATE sí puede comparar OLD vs NEW y
-- abortar el cambio antes de que se escriba.
create or replace function public.trg_usuarios_proteger_columnas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol_jwt text := coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role';
  v_es_admin boolean;
  v_col text;
  -- Columnas que un usuario NUNCA debe poder cambiar por sí mismo.
  -- Si alguna no existe en esta instalación, se ignora sin fallar.
  v_protegidas text[] := array[
    'id', 'email', 'rol', 'activo',
    'aprobado', 'aprobada', 'aprobacion', 'estado_aprobacion',
    'verificado', 'es_admin', 'admin', 'superadmin',
    'creado_en'
  ];
begin
  -- `service_role` (Edge Functions con llave de servicio) y los administradores
  -- sí pueden tocar estas columnas: son quienes gestionan la plataforma.
  if v_rol_jwt = 'service_role' then
    return new;
  end if;
  begin
    v_es_admin := public.es_admin();
  exception when others then
    -- Si `es_admin()` no existe o falla, se asume que NO es admin (falla segura).
    v_es_admin := false;
  end;
  if coalesce(v_es_admin, false) then
    return new;
  end if;

  -- Compara solo las columnas protegidas que existan en la tabla.
  foreach v_col in array v_protegidas loop
    if (to_jsonb(old) ? v_col) and (to_jsonb(old) -> v_col) is distinct from (to_jsonb(new) -> v_col) then
      raise exception 'No puedes modificar el campo protegido "%" de tu usuario.', v_col
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_usuarios_proteger_columnas on public.usuarios;
create trigger trg_usuarios_proteger_columnas
  before update on public.usuarios
  for each row
  execute function public.trg_usuarios_proteger_columnas();

-- ── 3) PRIVILEGIOS POR COLUMNA (defensa en profundidad) ─────────────────────
-- El perfil solo edita nombre y teléfono. Se quita el UPDATE amplio y se
-- concede únicamente lo necesario. `email` lo cambia Supabase Auth, no la app.
revoke update on public.usuarios from authenticated;
grant update (nombre, telefono) on public.usuarios to authenticated;

commit;

-- ── Verificación rápida (opcional) ──────────────────────────────────────────
-- Como usuario autenticado normal, esto debe fallar con error 42501:
--   update public.usuarios set rol = 'admin' where id = auth.uid();
-- Y esto debe funcionar:
--   update public.usuarios set nombre = 'Nuevo nombre' where id = auth.uid();
