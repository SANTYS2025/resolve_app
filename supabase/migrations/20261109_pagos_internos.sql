-- ═══════════════════════════════════════════════════════════════════════════
-- Pagos internos (sin proveedor real) · Comisiones · Reembolsos
--
-- Etapa actual: los pagos reales con Wompi/ePayco están DIFERIDOS hasta que la
-- empresa tenga RUT. Esta migración deja el registro interno trazable e
-- idempotente y una configuración para conectar el proveedor después.
--
-- Decisiones:
--  · El dinero sigue guardándose en CENTAVOS (integer).
--  · El monto SIEMPRE lo calcula el servidor:
--      (precio_final ?? precio_estimado_max ?? precio_estimado_min) - descuento
--  · La comisión se calcula sobre el monto bruto y se guarda en la transacción.
--  · Referencia interna determinista `resolve-sol-<id>-interno`: repetir la
--    confirmación no duplica el cobro ni la comisión.
--  · Solo se confirman pagos manuales (efectivo / Nequi / Bancolombia / Bre-B).
--    Tarjeta y Google Pay quedan bloqueados hasta habilitar el proveedor real.
--  · Los reembolsos internos se registran y aplican en el mismo acto; el dinero
--    físico se devuelve por fuera de la app y queda trazado en `reembolsos` y
--    `transacciones_eventos`.
--
-- Requiere: 20261104_notificaciones_soporte.sql, 20261105_pagos_wompi.sql,
--           20261108_crecimiento.sql.
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) PROVEEDOR Y CONFIGURACIÓN ────────────────────────────────────────────
-- Se conservan los valores futuros (`wompi`, `epayco`) para no romper el día
-- que se habilite el proveedor, pero el valor por defecto es interno.
alter table public.transacciones drop constraint if exists transacciones_proveedor_check;
alter table public.transacciones
  add constraint transacciones_proveedor_check
  check (proveedor in ('interno', 'wompi', 'epayco', 'efectivo', 'transferencia'));

alter table public.transacciones alter column proveedor set default 'interno';

create table if not exists public.pagos_config (
  id                     smallint primary key default 1 check (id = 1),
  proveedor_activo       text not null default 'interno'
                         check (proveedor_activo in ('interno', 'wompi', 'epayco')),
  pagos_reales_habilitados boolean not null default false,
  actualizado_en         timestamptz not null default now()
);

insert into public.pagos_config (id) values (1) on conflict (id) do nothing;

alter table public.pagos_config enable row level security;

drop policy if exists pagos_config_select on public.pagos_config;
create policy pagos_config_select on public.pagos_config
  for select to authenticated using (true);

revoke all on public.pagos_config from anon, authenticated;
grant select on public.pagos_config to authenticated;

/** Solo un admin cambia el proveedor. Debe existir `es_admin()` (20261105). */
create or replace function public.configurar_pagos(
  p_proveedor text,
  p_habilitado boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_prov text := lower(btrim(coalesce(p_proveedor, '')));
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede cambiar los pagos.'; end if;
  if v_prov not in ('interno', 'wompi', 'epayco') then
    raise exception 'Proveedor de pagos no válido.';
  end if;
  if v_prov = 'interno' and coalesce(p_habilitado, false) then
    raise exception 'El proveedor interno no puede marcarse como pago real.';
  end if;
  update public.pagos_config
     set proveedor_activo = v_prov,
         pagos_reales_habilitados = coalesce(p_habilitado, false),
         actualizado_en = now()
   where id = 1;
end;
$$;

grant execute on function public.configurar_pagos(text, boolean) to authenticated;

-- ── 2) CONFIRMAR UN PAGO MANUAL (INTERNO) ───────────────────────────────────
/**
 * Confirma un pago manual y deja la transacción aprobada, la comisión y el
 * neto. Es idempotente por la referencia única de la solicitud.
 *
 * Puede llamarlo el cliente o el técnico de la solicitud, pero la UI solo
 * muestra el botón al técnico (es quien recibe el efectivo/transferencia).
 */
create or replace function public.registrar_pago_interno(
  p_solicitud_id bigint,
  p_metodo text
)
returns public.transacciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sol public.solicitudes;
  v_tx public.transacciones;
  v_ref text;
  v_metodo text := lower(btrim(coalesce(p_metodo, '')));
  v_bruto integer;
  v_descuento integer;
  v_monto integer;
  v_pct integer;
  v_minimo integer;
  v_comision integer;
  v_tecnico_usuario uuid;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;

  if not exists (
    select 1 from public.pagos_config
    where id = 1 and proveedor_activo = 'interno' and not pagos_reales_habilitados
  ) then
    raise exception 'Los pagos internos están deshabilitados.';
  end if;

  if v_metodo not in ('efectivo', 'nequi', 'bancolombia', 'bre_b') then
    raise exception 'Los pagos con tarjeta se habilitarán cuando Resolve active pagos reales.';
  end if;

  select * into v_sol from public.solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_sol.estado <> 'completada' then
    raise exception 'Solo se confirma el pago de un servicio completado.';
  end if;
  if not (
    v_sol.cliente_id = v_uid
    or v_sol.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = v_uid)
  ) then
    raise exception 'No participas en esta solicitud.';
  end if;

  v_ref := 'resolve-sol-' || p_solicitud_id::text || '-interno';

  select * into v_tx from public.transacciones where referencia = v_ref for update;
  if found and v_tx.estado in ('aprobada', 'reembolsada', 'reembolso_parcial') then
    return v_tx; -- idempotente: ya estaba registrado
  end if;
  if v_sol.pago_estado = 'pagado' then
    raise exception 'Esta solicitud ya está pagada.';
  end if;

  -- Mismo precio base que la UI y el checkout futuro.
  v_bruto := greatest(0, round(coalesce(
    v_sol.precio_final, v_sol.precio_estimado_max, v_sol.precio_estimado_min, 0
  ) * 100)::integer);
  v_descuento := least(greatest(0, coalesce(v_sol.descuento_centavos, 0)), v_bruto);
  v_monto := greatest(0, v_bruto - v_descuento);
  if v_monto <= 0 then raise exception 'El servicio no tiene un monto válido.'; end if;

  select coalesce(pct_bps, 1000), coalesce(minimo_centavos, 0)
    into v_pct, v_minimo
    from public.comisiones_config where id = 1;

  v_comision := least(
    v_monto,
    greatest(round(v_monto * v_pct / 10000.0)::integer, v_minimo)
  );

  if v_tx.id is null then
    insert into public.transacciones
      (solicitud_id, cliente_id, tecnico_id, proveedor, referencia, estado,
       monto_centavos, comision_centavos, neto_centavos, metodo_pago, payload)
    values
      (v_sol.id, v_sol.cliente_id, v_sol.tecnico_id, 'interno', v_ref, 'aprobada',
       v_monto, v_comision, v_monto - v_comision, v_metodo,
       jsonb_build_object('origen', 'pago_interno', 'metodo', v_metodo))
    returning * into v_tx;

    insert into public.transacciones_eventos (transaccion_id, tipo, detalle)
    values (v_tx.id, 'pago_interno_confirmado',
            jsonb_build_object('referencia', v_ref, 'monto_centavos', v_monto,
                               'comision_centavos', v_comision, 'metodo', v_metodo));
  else
    update public.transacciones
       set estado = 'aprobada',
           monto_centavos = v_monto,
           comision_centavos = v_comision,
           neto_centavos = v_monto - v_comision,
           metodo_pago = v_metodo,
           payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('origen', 'pago_interno', 'metodo', v_metodo),
           actualizada_en = now()
     where id = v_tx.id
     returning * into v_tx;

    insert into public.transacciones_eventos (transaccion_id, tipo, detalle)
    values (v_tx.id, 'pago_interno_confirmado',
            jsonb_build_object('referencia', v_ref, 'monto_centavos', v_monto,
                               'comision_centavos', v_comision, 'metodo', v_metodo));
  end if;

  update public.solicitudes
     set pago_estado = 'pagado',
         metodo_pago = v_metodo
   where id = v_sol.id;

  select t.usuario_id into v_tecnico_usuario
    from public.tecnicos t where t.id = v_sol.tecnico_id;

  perform public.encolar_notificacion(
    v_sol.cliente_id, 'pago', 'Pago registrado',
    'Registramos el pago de $' || (v_monto / 100)::text ||
    ' de la solicitud #' || v_sol.id || '.',
    v_sol.id
  );
  perform public.encolar_notificacion(
    v_tecnico_usuario, 'pago', 'Pago recibido',
    'El pago de la solicitud #' || v_sol.id || ' quedó registrado. Tu neto: $' ||
    (v_tx.neto_centavos / 100)::text || '.',
    v_sol.id
  );

  return v_tx;
end;
$$;

grant execute on function public.registrar_pago_interno(bigint, text) to authenticated;

-- ── 3) REEMBOLSOS INTERNOS ──────────────────────────────────────────────────
/**
 * Se reemplaza la versión de 20261105 para que, en modo interno, el reembolso
 * se aplique inmediatamente después de registrarse. Así el historial queda
 * completo sin depender de un proveedor externo.
 *
 * En modo real (wompi/epayco) queda en `solicitado` para que el webhook o el
 * equipo lo procesen.
 */
create or replace function public.solicitar_reembolso(
  p_transaccion_id bigint,
  p_monto_centavos integer,
  p_motivo text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tx public.transacciones;
  v_disp integer;
  v_id bigint;
  v_interno boolean;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;

  select * into v_tx from public.transacciones where id = p_transaccion_id for update;
  if not found then raise exception 'La transacción no existe.'; end if;
  if v_tx.cliente_id <> v_uid then raise exception 'Solo el cliente puede pedir el reembolso.'; end if;
  if v_tx.estado not in ('aprobada', 'reembolso_parcial') then
    raise exception 'Solo se reembolsa una transacción aprobada.';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Cuéntanos el motivo (mínimo 10 caracteres).';
  end if;

  v_disp := v_tx.monto_centavos - v_tx.reembolsado_centavos;
  if p_monto_centavos is null or p_monto_centavos <= 0 or p_monto_centavos > v_disp then
    raise exception 'El monto supera el saldo disponible de la transacción.';
  end if;

  insert into public.reembolsos (transaccion_id, solicitado_por, monto_centavos, motivo)
  values (p_transaccion_id, v_uid, p_monto_centavos, btrim(p_motivo))
  returning id into v_id;

  insert into public.transacciones_eventos (transaccion_id, tipo, detalle)
  values (p_transaccion_id, 'reembolso_solicitado',
          jsonb_build_object('reembolso_id', v_id, 'monto_centavos', p_monto_centavos));

  select (proveedor_activo = 'interno' and not pagos_reales_habilitados)
    into v_interno
    from public.pagos_config where id = 1;

  if coalesce(v_interno, false) then
    perform public.aplicar_reembolso(v_id, null, 'aprobado');
  end if;

  return v_id;
end;
$$;

grant execute on function public.solicitar_reembolso(bigint, integer, text) to authenticated;

-- ── 4) VERIFICACIÓN RÁPIDA (opcional) ───────────────────────────────────────
-- select * from public.pagos_config;
-- select referencia, proveedor, estado, monto_centavos, comision_centavos, neto_centavos
--   from public.transacciones order by creada_en desc limit 20;
