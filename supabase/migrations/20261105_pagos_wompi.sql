-- ═══════════════════════════════════════════════════════════════════════════
-- Pagos con Wompi · Comisiones · Reembolsos · Historial de transacciones
--
-- Ejecutar en Supabase → SQL Editor, todo el bloque de una vez. Es idempotente.
-- Requiere: 20261101_chat_pagos_cuenta_bancaria.sql.
--
-- Decisiones (ver docs/INTEGRACION_PAGOS.md):
--  · Todo el dinero se guarda en CENTAVOS (integer). Nunca se usan flotantes.
--  · Comisión de Resolve: 10 % por defecto (`comisiones_config.pct_bps = 1000`),
--    configurable, redondeada al centavo (mitad hacia arriba).
--  · La comisión se calcula sobre el monto bruto aprobado.
--  · Referencia determinista `resolve-sol-<id>` (reintentos `-rN`): el webhook
--    puede repetirse sin duplicar el cobro.
--  · Reembolso total → `reembolsada`; parcial → `reembolso_parcial`. La comisión
--    se reversa en la MISMA proporción y queda registrada en el historial.
--  · Las llaves de Wompi viven SOLO en los secrets de las Edge Functions.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) CONFIGURACIÓN DE COMISIÓN ────────────────────────────────────────────
create table if not exists public.comisiones_config (
  id               smallint primary key default 1 check (id = 1),
  pct_bps          integer not null default 1000 check (pct_bps between 0 and 10000),
  minimo_centavos  integer not null default 0 check (minimo_centavos >= 0),
  actualizado_en   timestamptz not null default now()
);

insert into public.comisiones_config (id) values (1) on conflict (id) do nothing;

alter table public.comisiones_config enable row level security;

drop policy if exists comisiones_config_select on public.comisiones_config;
create policy comisiones_config_select on public.comisiones_config
  for select to authenticated using (true);

revoke all on public.comisiones_config from anon, authenticated;
grant select on public.comisiones_config to authenticated;

/** Solo un admin puede cambiar la comisión. */
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin'
  );
$$;

grant execute on function public.es_admin() to authenticated;

create or replace function public.actualizar_comision(p_pct_bps integer, p_minimo_centavos integer default 0)
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

grant execute on function public.actualizar_comision(integer, integer) to authenticated;

-- ── 2) TRANSACCIONES ────────────────────────────────────────────────────────
create table if not exists public.transacciones (
  id                        bigint generated always as identity primary key,
  solicitud_id              bigint not null references public.solicitudes(id) on delete restrict,
  cliente_id                uuid not null references public.usuarios(id) on delete restrict,
  tecnico_id                bigint references public.tecnicos(id) on delete set null,
  proveedor                 text not null default 'wompi' check (proveedor in ('wompi', 'efectivo', 'transferencia')),
  referencia                text not null unique,
  proveedor_transaccion_id  text unique,
  estado                    text not null default 'pendiente'
                            check (estado in ('pendiente','aprobada','declinada','error','anulada','reembolsada','reembolso_parcial')),
  monto_centavos            integer not null check (monto_centavos >= 0),
  comision_centavos         integer not null default 0 check (comision_centavos >= 0),
  neto_centavos             integer not null default 0 check (neto_centavos >= 0),
  reembolsado_centavos      integer not null default 0 check (reembolsado_centavos >= 0),
  comision_reversada_centavos integer not null default 0 check (comision_reversada_centavos >= 0),
  moneda                    text not null default 'COP',
  metodo_pago               text,
  payload                   jsonb,
  creada_en                 timestamptz not null default now(),
  actualizada_en            timestamptz not null default now()
);

create index if not exists transacciones_cliente_idx on public.transacciones (cliente_id, creada_en desc);
create index if not exists transacciones_tecnico_idx on public.transacciones (tecnico_id, creada_en desc);
create index if not exists transacciones_solicitud_idx on public.transacciones (solicitud_id);

alter table public.transacciones enable row level security;

drop policy if exists transacciones_select on public.transacciones;
create policy transacciones_select on public.transacciones
  for select to authenticated
  using (
    cliente_id = auth.uid()
    or tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid())
  );

revoke all on public.transacciones from anon, authenticated;
grant select on public.transacciones to authenticated;

create table if not exists public.transacciones_eventos (
  id             bigint generated always as identity primary key,
  transaccion_id bigint not null references public.transacciones(id) on delete cascade,
  tipo           text not null,
  detalle        jsonb not null default '{}'::jsonb,
  creado_en      timestamptz not null default now()
);

create index if not exists transacciones_eventos_tx_idx
  on public.transacciones_eventos (transaccion_id, creado_en);

alter table public.transacciones_eventos enable row level security;

drop policy if exists transacciones_eventos_select on public.transacciones_eventos;
create policy transacciones_eventos_select on public.transacciones_eventos
  for select to authenticated
  using (exists (
    select 1 from public.transacciones t
    where t.id = transacciones_eventos.transaccion_id
      and (t.cliente_id = auth.uid()
           or t.tecnico_id in (select tt.id from public.tecnicos tt where tt.usuario_id = auth.uid()))
  ));

revoke all on public.transacciones_eventos from anon, authenticated;
grant select on public.transacciones_eventos to authenticated;

-- ── 3) REEMBOLSOS ───────────────────────────────────────────────────────────
create table if not exists public.reembolsos (
  id                    bigint generated always as identity primary key,
  transaccion_id        bigint not null references public.transacciones(id) on delete restrict,
  solicitado_por        uuid not null references public.usuarios(id) on delete restrict,
  monto_centavos        integer not null check (monto_centavos > 0),
  motivo                text not null check (char_length(btrim(motivo)) between 10 and 500),
  estado                text not null default 'solicitado'
                        check (estado in ('solicitado','procesando','aprobado','rechazado','fallido')),
  proveedor_reembolso_id text,
  detalle               jsonb,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now()
);

create index if not exists reembolsos_tx_idx on public.reembolsos (transaccion_id, creado_en desc);

alter table public.reembolsos enable row level security;

drop policy if exists reembolsos_select on public.reembolsos;
create policy reembolsos_select on public.reembolsos
  for select to authenticated
  using (exists (
    select 1 from public.transacciones t
    where t.id = reembolsos.transaccion_id
      and (t.cliente_id = auth.uid()
           or t.tecnico_id in (select tt.id from public.tecnicos tt where tt.usuario_id = auth.uid()))
  ));

revoke all on public.reembolsos from anon, authenticated;
grant select on public.reembolsos to authenticated;

-- ── 4) LÓGICA DE DINERO (espejo de src/lib/pagosCore.ts) ────────────────────
/**
 * Registra el intento de cobro ANTES de ir a Wompi. La referencia es única:
 * un doble toque o un reintento reutiliza la misma fila pendiente.
 */
create or replace function public.preparar_transaccion(
  p_solicitud_id bigint,
  p_referencia text,
  p_monto_centavos integer,
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

grant execute on function public.preparar_transaccion(bigint, text, integer, text) to authenticated;

/**
 * Procesa un evento de Wompi de forma IDEMPOTENTE.
 * Devuelve la transacción resultante. Puede repetirse sin duplicar cobros.
 * Se llama desde la Edge Function `wompi-webhook` con la llave de servicio.
 */
create or replace function public.registrar_evento_wompi(
  p_referencia text,
  p_proveedor_id text,
  p_estado text,
  p_monto_centavos integer,
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
  v_pct integer;
  v_min integer;
  v_comision integer;
  v_estado text := lower(coalesce(p_estado, ''));
  v_final boolean;
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
    greatest(round(greatest(0, coalesce(p_monto_centavos, v_tx.monto_centavos)) * v_pct / 10000.0)::integer, v_min)
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

-- Solo la Edge Function (service_role) debe registrar eventos.
revoke all on function public.registrar_evento_wompi(text, text, text, integer, jsonb) from public, anon, authenticated;

/**
 * El cliente pide un reembolso. Queda en estado `solicitado` y el equipo lo
 * procesa (o la Edge Function lo ejecuta contra Wompi). Nunca borra historial.
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

grant execute on function public.solicitar_reembolso(bigint, integer, text) to authenticated;

/**
 * Aplica un reembolso YA confirmado por la pasarela (o aprobado manualmente).
 * Reversa la comisión en la misma proporción y deja el rastro en eventos.
 */
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
  v_total integer;
  v_com_acum integer;
  v_com_ya integer;
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
                     else round(v_tx.comision_centavos * v_total::numeric / v_tx.monto_centavos)::integer end;
  v_com_ya := case when v_tx.monto_centavos = 0 then 0
                   else round(v_tx.comision_centavos * v_tx.reembolsado_centavos::numeric / v_tx.monto_centavos)::integer end;

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

revoke all on function public.aplicar_reembolso(bigint, text, text) from public, anon, authenticated;

-- ── 5) Verificación rápida (opcional) ───────────────────────────────────────
-- select * from public.comisiones_config;
-- select referencia, estado, monto_centavos, comision_centavos, neto_centavos
--   from public.transacciones order by creada_en desc limit 20;
