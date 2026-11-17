-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUEANTE 2 · Finalizar servicio solo con pago confirmado (validación en servidor)
--
-- Problema: `completar_solicitud` cerraba el servicio sin mirar `pago_estado`.
-- La interfaz preguntaba "¿Recibiste el pago?", pero esa validación era solo
-- visual: cualquiera podía llamar la RPC y cerrar sin pago.
--
-- Solución:
--   1) `completar_solicitud` exige `pago_estado = 'pagado'` y una transacción
--      aprobada de la solicitud. Si no, aborta con un mensaje claro.
--   2) `registrar_pago_interno` ahora acepta también los estados `llego` y
--      `en_proceso`. Así el pago puede registrarse ANTES de cerrar (rompe el
--      círculo "para pagar hay que completar / para completar hay que pagar").
--   3) Nueva RPC atómica `completar_solicitud_con_pago(p_id, p_metodo)`:
--      registra el pago y completa en la misma transacción. El frontend usa
--      esta función; si el pago falla, el servicio NO se cierra.
--   4) `cambiar_estado_solicitud` (vía histórica) también exige pago: aunque
--      la app no la use para cerrar, un cliente podría llamarla directamente.
--
-- Requiere: 20261109_pagos_internos.sql, 20261111_cola_solicitudes_gps_daviplata.sql,
--           20261112_cola_lock_tecnico.sql.
-- Es idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) PAGO INTERNO: permitir registrar antes de cerrar ─────────────────────
-- Se conserva toda la lógica de la versión 20261111 (montos en centavos,
-- comisión, idempotencia por referencia, notificaciones) y solo se amplía el
-- estado permitido. El pago sigue siendo manual (Nequi/Bancolombia/Daviplata/
-- efectivo); los pagos reales siguen diferidos.
create or replace function public.registrar_pago_interno(p_solicitud_id bigint, p_metodo text)
returns public.transacciones
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if v_metodo not in ('nequi', 'bancolombia', 'daviplata', 'efectivo') then
    raise exception 'Ese método de pago aún no está disponible. Por ahora usa Nequi, Bancolombia, Daviplata o efectivo.';
  end if;

  select * into v_sol from public.solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'La solicitud no existe.'; end if;
  -- Cambio clave: el técnico puede confirmar el pago al llegar o durante el
  -- servicio, no solo después de completarlo.
  if v_sol.estado not in ('llego', 'en_proceso', 'completada') then
    raise exception 'Solo se confirma el pago cuando el técnico está en el domicilio o el servicio terminó.';
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
    return v_tx;
  end if;
  if v_sol.pago_estado = 'pagado' then
    raise exception 'Esta solicitud ya está pagada.';
  end if;
  if v_sol.pago_estado = 'cancelado' then
    raise exception 'El pago de esta solicitud fue cancelado.';
  end if;

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
$function$;

-- ── 2) COMPLETAR: exige pago confirmado ─────────────────────────────────────
create or replace function public.completar_solicitud(p_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_estado  text;
  v_pago    text;
  v_tecnico bigint;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;

  select s.estado, s.pago_estado, s.tecnico_id into v_estado, v_pago, v_tecnico
    from public.solicitudes s
   where s.id = p_id
     and s.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = v_uid)
   for update;

  if not found then
    raise exception 'Esta solicitud no está asignada a tu cuenta.';
  end if;

  if v_estado = 'completada' then
    return v_estado;
  end if;

  if v_estado not in ('llego', 'en_proceso') then
    raise exception 'Solo puedes terminar el servicio cuando hayas marcado "Llegué al destino" (estado actual: %).', v_estado;
  end if;

  -- Regla autoritativa: no se cierra un servicio sin pago confirmado.
  if v_pago is distinct from 'pagado' then
    raise exception 'No puedes finalizar el servicio sin confirmar el pago. Registra el pago y vuelve a intentar.';
  end if;
  if not exists (
    select 1 from public.transacciones t
     where t.solicitud_id = p_id
       and t.estado = 'aprobada'
  ) then
    raise exception 'No hay una transacción aprobada para esta solicitud. Registra el pago antes de finalizar.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('resolve_tecnico:' || v_tecnico::text, 0));

  update public.solicitudes set estado = 'completada' where id = p_id;

  perform public.activar_siguiente_solicitud(v_tecnico);

  return 'completada';
end;
$function$;

-- ── 3) RPC ATÓMICA: registrar pago + completar ──────────────────────────────
-- El frontend llama esta función en el botón "Finalizar solicitud". Si el pago
-- no se puede registrar, la excepción revierte todo y el servicio sigue abierto.
create or replace function public.completar_solicitud_con_pago(p_id bigint, p_metodo text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_estado  text;
  v_pago    text;
  v_tecnico bigint;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;

  select s.estado, s.pago_estado, s.tecnico_id into v_estado, v_pago, v_tecnico
    from public.solicitudes s
   where s.id = p_id
     and s.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = v_uid)
   for update;

  if not found then
    raise exception 'Esta solicitud no está asignada a tu cuenta.';
  end if;

  if v_estado = 'completada' then
    return v_estado;
  end if;

  if v_estado not in ('llego', 'en_proceso') then
    raise exception 'Solo puedes terminar el servicio cuando hayas marcado "Llegué al destino" (estado actual: %).', v_estado;
  end if;

  if v_pago = 'cancelado' then
    raise exception 'El pago de esta solicitud fue cancelado. No se puede finalizar.';
  end if;

  -- Si el pago aún no está confirmado, se registra en esta misma transacción.
  if v_pago is distinct from 'pagado' then
    perform public.registrar_pago_interno(p_id, p_metodo);
  end if;

  -- Releer el estado del pago ya dentro de la transacción.
  select s.pago_estado into v_pago from public.solicitudes s where s.id = p_id;
  if v_pago is distinct from 'pagado' then
    raise exception 'No se pudo confirmar el pago. El servicio no se cerró.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('resolve_tecnico:' || v_tecnico::text, 0));

  update public.solicitudes set estado = 'completada' where id = p_id;

  perform public.activar_siguiente_solicitud(v_tecnico);

  return 'completada';
end;
$function$;

grant execute on function public.completar_solicitud_con_pago(bigint, text) to authenticated;

-- ── 4) VÍA HISTÓRICA: `cambiar_estado_solicitud` tampoco cierra sin pago ─────
-- La app usa `completar_solicitud`, pero esta RPC sigue expuesta y permite
-- pasar a `completada` desde `en_proceso`. Se conserva su lógica y se aplica
-- la misma regla autoritativa para que no quede un camino alterno sin pago.
create or replace function public.cambiar_estado_solicitud(
  p_id bigint,
  p_estado text,
  p_precio_final numeric default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.solicitudes%rowtype;
  es_cli boolean;
  es_tec boolean;
  v_min numeric;
  v_max numeric;
begin
  select * into s from public.solicitudes where id = p_id for update;
  if not found then raise exception 'La solicitud no existe'; end if;

  es_cli := s.cliente_id = auth.uid();
  es_tec := exists (select 1 from public.tecnicos t where t.id = s.tecnico_id and t.usuario_id = auth.uid());
  if not (es_cli or es_tec) then raise exception 'No autorizado'; end if;

  if p_estado = 'cancelada' and es_cli
     and s.estado in ('pendiente', 'aceptada', 'en_espera', 'confirmada_en_espera') then
    null;
  elsif p_estado = 'rechazada' and es_tec and s.estado in ('pendiente', 'en_espera', 'confirmada_en_espera') then
    if not public.face_ok() then raise exception 'Verifica tu identidad para continuar'; end if;
  elsif p_estado = 'completada' and es_tec and s.estado = 'en_proceso' then
    if not public.face_ok() then raise exception 'Verifica tu identidad para continuar'; end if;
    -- Misma regla que `completar_solicitud`: pago confirmado + transacción aprobada.
    if s.pago_estado is distinct from 'pagado' then
      raise exception 'No puedes finalizar el servicio sin confirmar el pago. Registra el pago y vuelve a intentar.';
    end if;
    if not exists (
      select 1 from public.transacciones t
       where t.solicitud_id = p_id and t.estado = 'aprobada'
    ) then
      raise exception 'No hay una transacción aprobada para esta solicitud. Registra el pago antes de finalizar.';
    end if;
    v_min := coalesce(s.precio_estimado_min, 0) * 0.5;
    v_max := coalesce(s.precio_estimado_max, 0) * 2;
    if p_precio_final is null or p_precio_final < v_min or p_precio_final > v_max then
      raise exception 'El precio final debe estar entre % y % COP', round(v_min), round(v_max);
    end if;
  else
    raise exception 'Cambio de estado no permitido';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('resolve_tecnico:' || s.tecnico_id::text, 0));

  update public.solicitudes
     set estado = p_estado,
         en_espera_desde = case when p_estado in ('en_espera', 'confirmada_en_espera') then en_espera_desde else null end,
         precio_final = case when p_estado = 'completada' then p_precio_final else precio_final end
   where id = p_id;

  if p_estado = 'rechazada' then perform public.reasignar_solicitud(p_id); end if;

  if p_estado in ('cancelada', 'rechazada')
     and s.estado in ('aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso') then
    perform public.activar_siguiente_solicitud(s.tecnico_id);
  end if;
end $function$;

commit;

-- ── Verificación rápida (opcional) ──────────────────────────────────────────
-- 1) Sin pago, esto debe fallar:
--    select public.completar_solicitud(<id_en_llego>);
-- 2) Con pago, esto debe cerrar y liberar la cola:
--    select public.completar_solicitud_con_pago(<id_en_llego>, 'efectivo');
-- 3) La vía histórica tampoco debe cerrar sin pago:
--    select public.cambiar_estado_solicitud(<id_en_proceso>, 'completada', 50000);
