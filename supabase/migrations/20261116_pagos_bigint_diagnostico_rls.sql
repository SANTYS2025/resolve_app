-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECCIÓN 1 · "integer out of range" al confirmar un pago
-- CORRECCIÓN 2 · El técnico asignado puede guardar el diagnóstico en estados activos
--
-- Cómo ejecutarla
--   1. Abre el SQL Editor del proyecto en Supabase (resolve_db).
--   2. Pega TODO este archivo y ejecútalo una sola vez.
--   3. Verifica al final con las consultas comentadas.
--
-- Por qué fallaba el pago
--   `registrar_pago_interno` calculaba la comisión así:
--       round(v_monto * v_pct / 10000.0)
--   `v_monto` y `v_pct` eran INTEGER, así que PostgreSQL multiplicaba primero
--   en INTEGER: 10.000.000 × 1000 = 10.000.000.000 (mayor que 2.147.483.647)
--   y lanzaba "integer out of range" ANTES de dividir. Con montos pequeños
--   ($5.000) no se notaba.
--
--   Cambiar solo la columna no basta: hay que cambiar también la aritmética de
--   la función. Aquí se migran las columnas de dinero a BIGINT y se recrean
--   todas las funciones que operan con ellas usando BIGINT/NUMERIC.
--
--   Las vistas actuales (`tecnicos_publicos`, `vista_catalogo_tecnicos`,
--   `tecnicos_genero`) NO usan columnas de centavos, así que no hay que
--   recrearlas.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) Columnas de dinero: INTEGER → BIGINT ────────────────────────────────
-- BIGINT llega a 9.22 × 10^18 centavos (≈ 92 billones de pesos), suficiente
-- para cualquier servicio y para multiplicar por 10.000 sin desbordar.
alter table public.transacciones
  alter column monto_centavos type bigint,
  alter column comision_centavos type bigint,
  alter column neto_centavos type bigint,
  alter column reembolsado_centavos type bigint,
  alter column comision_reversada_centavos type bigint;

alter table public.reembolsos
  alter column monto_centavos type bigint;

alter table public.solicitudes
  alter column descuento_centavos type bigint;

alter table public.cupones_usos
  alter column descuento_centavos type bigint;

alter table public.comisiones_config
  alter column minimo_centavos type bigint;

-- ── 2) Confirmar pago manual (interno) ─────────────────────────────────────
-- Misma lógica de negocio, pero con BIGINT en todos los cálculos.
create or replace function public.registrar_pago_interno(p_solicitud_id bigint, p_metodo text)
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
  v_bruto bigint;
  v_descuento bigint;
  v_monto bigint;
  v_pct bigint;
  v_minimo bigint;
  v_comision bigint;
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

  -- Precio base: el acordado si existe; si no, el tope máximo de la referencia.
  v_bruto := greatest(0, round(coalesce(
    v_sol.precio_final, v_sol.precio_estimado_max, v_sol.precio_estimado_min, 0
  ) * 100)::bigint);
  v_descuento := least(greatest(0, coalesce(v_sol.descuento_centavos, 0)), v_bruto);
  v_monto := greatest(0, v_bruto - v_descuento);
  if v_monto <= 0 then raise exception 'El servicio no tiene un monto válido.'; end if;

  select coalesce(pct_bps, 1000), coalesce(minimo_centavos, 0)
    into v_pct, v_minimo
    from public.comisiones_config where id = 1;

  -- Multiplicación en NUMERIC (no en BIGINT) para que nunca desborde aunque
  -- el monto sea enorme; luego se redondea a BIGINT.
  v_comision := least(
    v_monto,
    greatest(round(v_monto::numeric * v_pct::numeric / 10000.0)::bigint, v_minimo)
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
exception
  when numeric_value_out_of_range then
    raise exception 'El monto del pago es demasiado alto para procesarlo. Revisa el precio del servicio con el cliente e inténtalo de nuevo.';
end;
$$;

grant execute on function public.registrar_pago_interno(bigint, text) to authenticated;

-- ── 2b) Cierre atómico con pago interno (mismo cálculo seguro) ───────────────
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

  -- Si el pago aún no está confirmado, se registra con la función segura
  if v_pago is distinct from 'pagado' then
    perform public.registrar_pago_interno(p_id, p_metodo);
  end if;

  select s.pago_estado into v_pago from public.solicitudes s where s.id = p_id;
  if v_pago is distinct from 'pagado' then
    raise exception 'No se pudo confirmar el pago. El servicio no se cerró.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('resolve_tecnico:' || v_tecnico::text, 0));

  update public.solicitudes set estado = 'completada' where id = p_id;

  perform public.activar_siguiente_solicitud(v_tecnico);

  return 'completada';
exception
  when numeric_value_out_of_range then
    raise exception 'El monto del pago es demasiado alto para procesarlo. Revisa el precio del servicio con el cliente e inténtalo de nuevo.';
end;
$function$;

grant execute on function public.completar_solicitud_con_pago(bigint, text) to authenticated;

-- ── 3) Pago con pasarela: preparar transacción ─────────────────────────────
-- El parámetro cambia de INTEGER a BIGINT; hay que borrar la versión anterior
-- porque PostgreSQL no permite cambiar el tipo de un argumento con
-- CREATE OR REPLACE.
drop function if exists public.preparar_transaccion(bigint, text, integer, text);

create function public.preparar_transaccion(
  p_solicitud_id bigint,
  p_referencia text,
  p_monto_centavos bigint,
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
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  select * into v_sol from public.solicitudes where id = p_solicitud_id;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_sol.cliente_id <> v_uid then raise exception 'Solo el cliente puede pagar esta solicitud.'; end if;
  if v_sol.estado <> 'completada' then raise exception 'Solo se paga un servicio completado.'; end if;
  if p_monto_centavos is null or p_monto_centavos <= 0 then raise exception 'El monto no es válido.'; end if;

  select * into v_tx from public.transacciones where referencia = p_referencia;
  if found then
    if v_tx.estado = 'aprobada' then raise exception 'Esta solicitud ya está pagada.'; end if;
    return v_tx;
  end if;

  insert into public.transacciones
    (solicitud_id, cliente_id, tecnico_id, proveedor, referencia, estado, monto_centavos, metodo_pago)
  values
    (p_solicitud_id, v_uid, v_sol.tecnico_id, 'wompi', p_referencia, 'pendiente', p_monto_centavos, p_metodo)
  returning * into v_tx;

  insert into public.transacciones_eventos (transaccion_id, tipo, detalle)
  values (v_tx.id, 'checkout_iniciado', jsonb_build_object('referencia', p_referencia, 'monto_centavos', p_monto_centavos));

  return v_tx;
end;
$$;

grant execute on function public.preparar_transaccion(bigint, text, bigint, text) to authenticated, anon, service_role;

-- ── 4) Eventos de la pasarela (webhook) ────────────────────────────────────
drop function if exists public.registrar_evento_wompi(text, text, text, integer, jsonb);

create function public.registrar_evento_wompi(
  p_referencia text,
  p_proveedor_id text,
  p_estado text,
  p_monto_centavos bigint,
  p_payload jsonb default '{}'::jsonb
)
returns public.transacciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.transacciones;
  v_sol public.solicitudes;
  v_sol_id bigint;
  v_pct bigint;
  v_min bigint;
  v_comision bigint;
  v_estado text := lower(coalesce(p_estado, ''));
  v_cliente uuid;
  v_tec_usuario uuid;
begin
  -- Normaliza el vocabulario de Wompi.
  v_estado := case v_estado
    when 'approved' then 'aprobada'
    when 'declined' then 'declinada'
    when 'failed' then 'declinada'
    when 'voided' then 'anulada'
    when 'error' then 'error'
    when 'pending' then 'pendiente'
    when 'created' then 'pendiente'
    else 'error'
  end;

  select * into v_tx from public.transacciones where referencia = p_referencia;
  if not found then
    -- Respaldo: la referencia contiene el id de la solicitud.
    v_sol_id := nullif(substring(p_referencia from '^resolve-sol-([0-9]+)'), '')::bigint;
    if v_sol_id is null then raise exception 'Referencia de pago desconocida.'; end if;
    select * into v_sol from public.solicitudes where id = v_sol_id;
    if not found then raise exception 'La solicitud de la referencia no existe.'; end if;
    insert into public.transacciones
      (solicitud_id, cliente_id, tecnico_id, proveedor, referencia, estado, monto_centavos, metodo_pago)
    values
      (v_sol.id, v_sol.cliente_id, v_sol.tecnico_id, 'wompi', p_referencia,
       'pendiente', greatest(0, coalesce(p_monto_centavos, 0)), v_sol.metodo_pago)
    returning * into v_tx;
  end if;

  -- Idempotencia: si ya está en estado final, no se vuelve a aplicar.
  if v_tx.estado in ('aprobada','declinada','error','anulada','reembolsada','reembolso_parcial') then
    insert into public.transacciones_eventos (transaccion_id, tipo, detalle)
    values (v_tx.id, 'evento_duplicado', jsonb_build_object('estado', v_estado, 'proveedor_id', p_proveedor_id));
    return v_tx;
  end if;

  select coalesce(pct_bps, 1000), coalesce(minimo_centavos, 0)
    into v_pct, v_min
    from public.comisiones_config where id = 1;

  v_comision := least(
    greatest(0, coalesce(p_monto_centavos, v_tx.monto_centavos)),
    greatest(round(greatest(0, coalesce(p_monto_centavos, v_tx.monto_centavos))::numeric * v_pct::numeric / 10000.0)::bigint, v_min)
  );

  update public.transacciones
     set estado = v_estado,
         proveedor_transaccion_id = coalesce(nullif(p_proveedor_id, ''), proveedor_transaccion_id),
         monto_centavos = greatest(0, coalesce(p_monto_centavos, monto_centavos)),
         comision_centavos = case when v_estado = 'aprobada' then v_comision else comision_centavos end,
         neto_centavos = case when v_estado = 'aprobada'
                              then greatest(0, coalesce(p_monto_centavos, monto_centavos) - v_comision)
                              else neto_centavos end,
         payload = coalesce(p_payload, payload),
         actualizada_en = now()
   where id = v_tx.id
   returning * into v_tx;

  insert into public.transacciones_eventos (transaccion_id, tipo, detalle)
  values (v_tx.id, 'estado_' || v_estado,
          jsonb_build_object('proveedor_id', p_proveedor_id, 'monto_centavos', v_tx.monto_centavos,
                             'comision_centavos', v_tx.comision_centavos));

  select s.cliente_id, (select t.usuario_id from public.tecnicos t where t.id = s.tecnico_id)
    into v_cliente, v_tec_usuario
    from public.solicitudes s where s.id = v_tx.solicitud_id;

  if v_estado = 'aprobada' then
    update public.solicitudes
       set pago_estado = 'pagado',
           metodo_pago = coalesce(v_tx.metodo_pago, metodo_pago)
     where id = v_tx.solicitud_id;

    perform public.encolar_notificacion(v_cliente, 'pago', 'Pago aprobado',
      'Tu pago de $' || (v_tx.monto_centavos / 100)::text || ' fue aprobado. Solicitud #' || v_tx.solicitud_id, v_tx.solicitud_id);
    perform public.encolar_notificacion(v_tec_usuario, 'pago', 'Pago recibido',
      'El cliente pagó la solicitud #' || v_tx.solicitud_id || '. Tu neto: $' || (v_tx.neto_centavos / 100)::text || '.', v_tx.solicitud_id);
  elsif v_estado in ('declinada','error','anulada') then
    -- Si no estaba pagada, vuelve a quedar pendiente para reintentar.
    update public.solicitudes
       set pago_estado = case when pago_estado = 'pagado' then pago_estado else 'pendiente_pasarela' end
     where id = v_tx.solicitud_id;
    perform public.encolar_notificacion(v_cliente, 'pago', 'Pago no aprobado',
      'El pago de la solicitud #' || v_tx.solicitud_id || ' no se completó. Puedes reintentar.', v_tx.solicitud_id);
  end if;

  return v_tx;
end;
$$;

grant execute on function public.registrar_evento_wompi(text, text, text, bigint, jsonb) to service_role;

-- ── 5) Reembolsos ──────────────────────────────────────────────────────────
drop function if exists public.solicitar_reembolso(bigint, integer, text);

create function public.solicitar_reembolso(
  p_transaccion_id bigint,
  p_monto_centavos bigint,
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
  v_disp bigint;
  v_id bigint;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  select * into v_tx from public.transacciones where id = p_transaccion_id;
  if not found then raise exception 'La transacción no existe.'; end if;
  if v_tx.cliente_id <> v_uid then raise exception 'Solo el cliente puede pedir el reembolso.'; end if;
  if v_tx.estado not in ('aprobada','reembolso_parcial') then
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

  return v_id;
end;
$$;

grant execute on function public.solicitar_reembolso(bigint, bigint, text) to authenticated;

create or replace function public.aplicar_reembolso(
  p_reembolso_id bigint,
  p_proveedor_id text default null,
  p_estado text default 'aprobado'
)
returns public.transacciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_re public.reembolsos;
  v_tx public.transacciones;
  v_total bigint;
  v_com_acum bigint;
  v_com_ya bigint;
  v_estado text;
begin
  select * into v_re from public.reembolsos where id = p_reembolso_id for update;
  if not found then raise exception 'El reembolso no existe.'; end if;
  if v_re.estado in ('aprobado','rechazado') then
    select * into v_tx from public.transacciones where id = v_re.transaccion_id;
    return v_tx;
  end if;

  if coalesce(p_estado, 'aprobado') <> 'aprobado' then
    update public.reembolsos
       set estado = case when p_estado = 'fallido' then 'fallido' else 'rechazado' end,
           detalle = jsonb_build_object('proveedor_id', p_proveedor_id),
           actualizado_en = now()
     where id = p_reembolso_id;
    select * into v_tx from public.transacciones where id = v_re.transaccion_id;
    return v_tx;
  end if;

  select * into v_tx from public.transacciones where id = v_re.transaccion_id for update;

  v_total := v_tx.reembolsado_centavos + v_re.monto_centavos;
  if v_total > v_tx.monto_centavos then
    raise exception 'El reembolso supera el monto de la transacción.';
  end if;

  -- Comisión acumulada que corresponde al total reembolsado (redondeo una vez).
  v_com_acum := case when v_tx.monto_centavos = 0 then 0
                     else round(v_tx.comision_centavos::numeric * v_total::numeric / v_tx.monto_centavos::numeric)::bigint end;
  v_com_ya := case when v_tx.monto_centavos = 0 then 0
                   else round(v_tx.comision_centavos::numeric * v_tx.reembolsado_centavos::numeric / v_tx.monto_centavos::numeric)::bigint end;

  v_estado := case when v_total >= v_tx.monto_centavos then 'reembolsada' else 'reembolso_parcial' end;

  update public.transacciones
     set estado = v_estado,
         reembolsado_centavos = v_total,
         comision_reversada_centavos = greatest(0, v_com_acum),
         comision_centavos = greatest(0, v_tx.comision_centavos),
         neto_centavos = greatest(0, v_tx.monto_centavos - v_total - (v_tx.comision_centavos - v_com_acum)),
         actualizada_en = now()
   where id = v_tx.id
   returning * into v_tx;

  update public.reembolsos
     set estado = 'aprobado',
         proveedor_reembolso_id = coalesce(nullif(p_proveedor_id, ''), proveedor_reembolso_id),
         actualizado_en = now()
   where id = p_reembolso_id;

  insert into public.transacciones_eventos (transaccion_id, tipo, detalle)
  values (v_tx.id, 'reembolso_aplicado',
          jsonb_build_object('reembolso_id', p_reembolso_id, 'monto_centavos', v_re.monto_centavos,
                             'comision_reversada_centavos', greatest(0, v_com_acum - v_com_ya),
                             'total_reembolsado_centavos', v_total, 'estado', v_estado));

  perform public.encolar_notificacion(v_tx.cliente_id, 'pago', 'Reembolso aprobado',
    'Reembolsamos $' || (v_re.monto_centavos / 100)::text || ' de la solicitud #' || v_tx.solicitud_id || '.', v_tx.solicitud_id);

  return v_tx;
end;
$$;

-- ── 6) Comisión configurable ───────────────────────────────────────────────
drop function if exists public.actualizar_comision(integer, integer);

create function public.actualizar_comision(p_pct_bps integer, p_minimo_centavos bigint default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede cambiar la comisión.'; end if;
  if p_pct_bps is null or p_pct_bps < 0 or p_pct_bps > 10000 then
    raise exception 'El porcentaje debe estar entre 0 y 10000 puntos básicos.';
  end if;
  update public.comisiones_config
     set pct_bps = p_pct_bps,
         minimo_centavos = greatest(0, coalesce(p_minimo_centavos, 0)),
         actualizado_en = now()
   where id = 1;
end;
$$;

grant execute on function public.actualizar_comision(integer, bigint) to authenticated;

-- ── 7) Cupones ─────────────────────────────────────────────────────────────
drop function if exists public.validar_cupon(text, integer);

create function public.validar_cupon(p_codigo text, p_monto_centavos bigint)
returns table(valido boolean, motivo text, descuento_centavos bigint, total_centavos bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_c public.cupones;
  v_total bigint := greatest(0, coalesce(p_monto_centavos, 0));
  v_desc bigint;
begin
  select * into v_c from public.cupones where codigo = v_cod;
  if not found then return query select false, 'Ese cupón no existe.', 0::bigint, v_total; return; end if;
  if not v_c.activo then return query select false, 'Este cupón ya no está activo.', 0::bigint, v_total; return; end if;
  if v_c.valido_desde is not null and now() < v_c.valido_desde then
    return query select false, 'Este cupón todavía no está vigente.', 0::bigint, v_total; return;
  end if;
  if v_c.valido_hasta is not null and now() > v_c.valido_hasta then
    return query select false, 'Este cupón venció.', 0::bigint, v_total; return;
  end if;
  if v_c.usos_max is not null and v_c.usos >= v_c.usos_max then
    return query select false, 'Este cupón ya alcanzó su límite de usos.', 0::bigint, v_total; return;
  end if;
  if v_total <= 0 then
    return query select false, 'El servicio no tiene un monto para aplicar el cupón.', 0::bigint, v_total; return;
  end if;
  if v_total < v_c.monto_minimo_cop::bigint * 100 then
    return query select false, 'El cupón aplica desde $' || v_c.monto_minimo_cop::text || '.', 0::bigint, v_total; return;
  end if;

  v_desc := case when v_c.tipo = 'porcentaje'
                 then round(v_total::numeric * least(100, v_c.valor) / 100.0)::bigint
                 else v_c.valor::bigint * 100 end;
  v_desc := least(v_total, greatest(0::bigint, v_desc));
  if v_desc <= 0 then
    return query select false, 'El cupón no genera descuento para este monto.', 0::bigint, v_total; return;
  end if;
  return query select true, '', v_desc, v_total - v_desc;
end;
$$;

grant execute on function public.validar_cupon(text, bigint) to authenticated, anon, service_role;

drop function if exists public.aplicar_cupon_solicitud(bigint, text);

create function public.aplicar_cupon_solicitud(p_solicitud_id bigint, p_codigo text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sol public.solicitudes;
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_monto bigint;
  v_res record;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  -- Bloquea la fila para que dos toques simultáneos no apliquen dos cupones.
  select * into v_sol from public.solicitudes where id = p_solicitud_id for update;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if v_sol.cliente_id <> v_uid then raise exception 'Solo el cliente puede aplicar el cupón.'; end if;
  if v_sol.estado <> 'completada' then raise exception 'El cupón se aplica al terminar el servicio.'; end if;
  if v_sol.pago_estado = 'pagado' then raise exception 'La solicitud ya está pagada.'; end if;
  if v_sol.pago_estado not in ('pendiente', 'pendiente_pasarela') then
    raise exception 'No se puede aplicar un cupón con el pago en estado %.', v_sol.pago_estado;
  end if;
  if exists (select 1 from public.cupones_usos where solicitud_id = p_solicitud_id) then
    raise exception 'Esta solicitud ya tiene un cupón aplicado.';
  end if;

  -- Mismo precio base que usa `registrar_pago_interno`: final, o el tope máximo/mínimo.
  v_monto := greatest(0, round(coalesce(
    v_sol.precio_final, v_sol.precio_estimado_max, v_sol.precio_estimado_min, 0
  ) * 100)::bigint);
  if v_monto <= 0 then raise exception 'El servicio no tiene un precio para aplicar el cupón.'; end if;
  select * into v_res from public.validar_cupon(v_cod, v_monto);
  if not v_res.valido then raise exception '%', v_res.motivo; end if;

  update public.cupones set usos = usos + 1 where codigo = v_cod;
  insert into public.cupones_usos (codigo, usuario_id, solicitud_id, descuento_centavos)
  values (v_cod, v_uid, p_solicitud_id, v_res.descuento_centavos);
  update public.solicitudes
     set cupon_codigo = v_cod,
         descuento_centavos = v_res.descuento_centavos
   where id = p_solicitud_id;

  return v_res.descuento_centavos;
end;
$$;

grant execute on function public.aplicar_cupon_solicitud(bigint, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECCIÓN 2 · Diagnóstico del técnico asignado en estados activos
--
-- Antes: la RPC solo aceptaba ('aceptada','completada'), pero la app muestra el
-- formulario en ('aceptada','confirmada','en_camino','en_proceso','llego').
-- Por eso el técnico veía "No puedes registrar el diagnóstico de esta solicitud".
--
-- Ahora: solo el técnico ASIGNADO y solo mientras la solicitud está activa.
-- Una solicitud cerrada (completada/cancelada/etc.) ya no se puede editar.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.guardar_diagnostico(p_id bigint, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_txt text := btrim(coalesce(p_texto, ''));
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  if char_length(v_txt) < 10   then raise exception 'El diagnóstico debe tener al menos 10 caracteres.'; end if;
  if char_length(v_txt) > 1000 then raise exception 'El diagnóstico no puede superar 1000 caracteres.'; end if;

  update public.solicitudes s
     set diagnostico = v_txt, diagnostico_en = now()
   where s.id = p_id
     and s.estado in ('aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego')
     and s.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid());

  if not found then
    raise exception 'No puedes registrar el diagnóstico de esta solicitud.';
  end if;
end;
$$;

grant execute on function public.guardar_diagnostico(bigint, text) to authenticated;

-- RLS de respaldo: si en el futuro alguna pantalla escribe el diagnóstico
-- directamente con supabase-js (sin RPC), solo podrá tocar esas dos columnas y
-- solo en SUS solicitudes activas. El resto de columnas sigue cerrado.
-- Hoy la app escribe por la RPC `guardar_diagnostico` (SECURITY DEFINER).
revoke update on public.solicitudes from anon, authenticated;
grant update (diagnostico, diagnostico_en) on public.solicitudes to authenticated;

drop policy if exists solicitudes_update_diagnostico_tecnico on public.solicitudes;
create policy solicitudes_update_diagnostico_tecnico
  on public.solicitudes
  for update
  to authenticated
  using (
    estado in ('aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego')
    and tecnico_id in (
      select t.id from public.tecnicos t where t.usuario_id = (select auth.uid())
    )
  )
  with check (
    estado in ('aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego')
    and tecnico_id in (
      select t.id from public.tecnicos t where t.usuario_id = (select auth.uid())
    )
  );

commit;

-- ── Verificación (ejecuta después del commit) ─────────────────────────────
-- 1) Tipos de las columnas de dinero (deben ser bigint):
--    select table_name, column_name, data_type
--      from information_schema.columns
--     where table_schema = 'public'
--       and column_name like '%centavos%'
--     order by table_name, column_name;
--
-- 2) La función de pago ya no declara variables INTEGER:
--    select pg_get_functiondef(oid)
--      from pg_proc
--     where proname = 'registrar_pago_interno';
--
-- 3) El técnico asignado puede guardar el diagnóstico en `llego`:
--    (hazlo desde la app con una solicitud en estado `llego`).
