-- ═══════════════════════════════════════════════════════════════════════════
-- Cola de solicitudes · GPS en la solicitud · Daviplata
--
-- Objetivo:
--  · Un técnico solo está OCUPADO mientras tiene un servicio activo
--    (aceptada, confirmada, en_camino, llego o en_proceso). Los estados
--    cerrados nunca lo mantienen ocupado.
--  · Mientras está ocupado puede RECIBIR, ACEPTAR o RECHAZAR solicitudes.
--    Las aceptadas quedan en `en_espera` y se activan en orden de aceptación
--    cuando termina el servicio actual, dentro de la misma transacción y con
--    bloqueo de fila.
--  · La solicitud en espera NO activa GPS ni pasa a `en_camino` antes de su
--    turno (las RPC de desplazamiento lo impiden).
--  · Guarda latitud/longitud del domicilio (geocodificación inversa en la app).
--  · Habilita Daviplata como método manual; los demás siguen en el CHECK para
--    no romper registros históricos, pero las RPC solo aceptan los 4 manuales.
--
-- Requiere: migraciones 20261020–20261110 (o sus objetos ya aplicados).
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) ESTADOS NUEVOS ───────────────────────────────────────────────────────
alter table public.solicitudes drop constraint if exists solicitudes_estado_check;
alter table public.solicitudes
  add constraint solicitudes_estado_check check (estado in (
    'pendiente', 'aceptada', 'confirmada', 'en_camino', 'llego', 'completada',
    'en_proceso', 'en_curso',
    'en_espera', 'confirmada_en_espera',
    'rechazada', 'cancelada', 'expirada'
  ));

-- ── 2) COLUMNAS NUEVAS ──────────────────────────────────────────────────────
alter table public.solicitudes add column if not exists en_espera_desde timestamptz;
alter table public.solicitudes add column if not exists latitud  double precision;
alter table public.solicitudes add column if not exists longitud double precision;

alter table public.solicitudes drop constraint if exists solicitudes_latitud_check;
alter table public.solicitudes
  add constraint solicitudes_latitud_check check (latitud is null or (latitud between -90 and 90));

alter table public.solicitudes drop constraint if exists solicitudes_longitud_check;
alter table public.solicitudes
  add constraint solicitudes_longitud_check check (longitud is null or (longitud between -180 and 180));

create index if not exists solicitudes_cola_idx
  on public.solicitudes (tecnico_id, en_espera_desde, id)
  where estado in ('en_espera', 'confirmada_en_espera');

-- ── 3) MÉTODO DE PAGO: DAVIPLATA ────────────────────────────────────────────
-- Se conservan los valores históricos en el CHECK para no invalidar registros.
alter table public.solicitudes drop constraint if exists solicitudes_metodo_pago_check;
alter table public.solicitudes
  add constraint solicitudes_metodo_pago_check check (
    metodo_pago is null or metodo_pago in (
      'nequi', 'bancolombia', 'daviplata',
      'tarjeta_credito', 'tarjeta_debito', 'google_pay', 'bre_b', 'efectivo'
    )
  );

-- ── 4) LIMPIEZA DE SOLICITUDES VENCIDAS ─────────────────────────────────────
-- Servicios de días anteriores que quedaron abiertos (datos de prueba viejos).
-- No se borran: pasan a `expirada` y quedan en el historial.
update public.solicitudes
   set estado = 'expirada'
 where estado in ('pendiente', 'aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso', 'en_curso')
   and fecha_servicio < public.hoy_co() - 1
   and actualizado_en < now() - interval '12 hours';

-- ── 5) CATÁLOGO PÚBLICO SIN LA COLUMNA `disponible` ─────────────────────────
-- La disponibilidad real se deriva de las solicitudes activas. `tecnicos.disponible`
-- queda como dato histórico y no debe ocultar técnicos libres.
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
       coalesce(j.trabajos, 0) as trabajos
  from public.tecnicos t
  left join public.categorias c on c.id = t.categoria_id
  left join public.barrios b on b.id = t.barrio_id
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
 where t.activo and t.verificado;

-- ── 6) INSERTAR SOLICITUD AUNQUE EL TÉCNICO ESTÉ OCUPADO ────────────────────
create or replace function public.solicitud_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t public.tecnicos%rowtype;
begin
  -- El técnico debe existir y estar activo; su disponibilidad ya no bloquea:
  -- las solicitudes nuevas se encolan y él decide aceptarlas o rechazarlas.
  select * into t from public.tecnicos where id = new.tecnico_id and activo;
  if not found then raise exception 'El técnico no está disponible'; end if;
  if t.usuario_id = new.cliente_id then raise exception 'No puedes solicitar tu propio servicio'; end if;
  new.precio_estimado_min := t.precio_min;
  new.precio_estimado_max := t.precio_max;
  new.precio_final := null;
  new.estado := 'pendiente';
  new.en_espera_desde := null;
  return new;
end $function$;

-- ── 7) CANDIDATOS: LA DISPONIBILIDAD NO ES UNA COLUMNA ──────────────────────
create or replace function public.candidatos_tecnico(
  p_categoria bigint,
  p_barrio bigint,
  p_fecha date,
  p_excluir bigint[] default '{}'::bigint[],
  p_limite integer default 5
)
returns table(o_id bigint, o_puntaje numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select x.id, x.puntaje from (
    select t.id::bigint as id,
           ( (case when t.barrio_id = p_barrio then 40 else 0 end)
           + coalesce(r.bayes, 4.0) * 10
           + least(ln(1 + t.trabajos_completados) * 5, 15)
           - coalesce(c.carga, 0) * 8 )::numeric as puntaje
    from public.tecnicos t
    left join lateral (select (5 * 4.0 + sum(puntuacion)) / (5 + count(*)) as bayes
                       from public.calificaciones where tecnico_id = t.id) r on true
    left join lateral (select count(*) as carga from public.solicitudes
                       where tecnico_id = t.id and fecha_servicio = p_fecha
                         and estado in ('pendiente','asignada','aceptada','confirmada',
                                        'en_proceso','en_espera','confirmada_en_espera')) c on true
    where t.activo and t.verificado
      and t.categoria_id = p_categoria
      and not (t.id = any (p_excluir))
      and coalesce(c.carga, 0) < 4
      and exists (select 1 from public.disponibilidades d
                  where d.tecnico_id = t.id and d.activo
                    and d.dia_semana = extract(dow from p_fecha)::int)
  ) x order by x.puntaje desc limit p_limite
$function$;

-- ── 8) ACEPTAR: DIRECTO O EN COLA ───────────────────────────────────────────
create or replace function public.aceptar_solicitud(p_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  s        public.solicitudes%rowtype;
  v_activo boolean;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;

  select * into s from public.solicitudes where id = p_id for update;
  if not found then raise exception 'La solicitud no existe.'; end if;

  if not exists (select 1 from public.tecnicos t where t.id = s.tecnico_id and t.usuario_id = v_uid) then
    raise exception 'Esta solicitud no está asignada a tu cuenta.';
  end if;

  -- Idempotente: si ya la había aceptado (o quedó en espera), no se duplica.
  if s.estado in ('aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso',
                  'en_espera', 'confirmada_en_espera') then
    return s.estado;
  end if;

  if s.estado <> 'pendiente' then
    raise exception 'No puedes aceptar una solicitud en estado "%".', s.estado;
  end if;

  if not public.face_ok() then raise exception 'Verifica tu identidad para continuar'; end if;

  -- ¿Tiene otro servicio activo? Entonces la nueva espera su turno.
  select exists (
    select 1 from public.solicitudes x
     where x.tecnico_id = s.tecnico_id
       and x.id <> s.id
       and x.estado in ('aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso')
  ) into v_activo;

  if v_activo then
    update public.solicitudes
       set estado = 'en_espera', en_espera_desde = now()
     where id = p_id;
    return 'en_espera';
  end if;

  update public.solicitudes
     set estado = 'aceptada', en_espera_desde = null
   where id = p_id;
  return 'aceptada';
end;
$function$;

-- ── 9) ACTIVAR LA SIGUIENTE SOLICITUD EN COLA ───────────────────────────────
create or replace function public.activar_siguiente_solicitud(p_tecnico bigint)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id     bigint;
  v_estado text;
begin
  -- Orden de aceptación (en_espera_desde). Se bloquea la fila elegida para que
  -- dos cierres simultáneos no activen la misma solicitud.
  select id, estado into v_id, v_estado
    from public.solicitudes
   where tecnico_id = p_tecnico
     and estado in ('en_espera', 'confirmada_en_espera')
   order by coalesce(en_espera_desde, creado_en), id
   limit 1
   for update skip locked;

  if v_id is null then return null; end if;

  update public.solicitudes
     set estado = case when v_estado = 'confirmada_en_espera' then 'confirmada' else 'aceptada' end,
         en_espera_desde = null
   where id = v_id;

  return v_id;
end;
$function$;

-- ── 10) CONFIRMAR AL TÉCNICO (TAMBIÉN EN ESPERA) ────────────────────────────
create or replace function public.confirmar_tecnico(p_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_estado text;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;

  select s.estado into v_estado
    from public.solicitudes s
   where s.id = p_id and s.cliente_id = v_uid
   for update;

  if not found then
    raise exception 'No autorizado: solo el cliente de esta solicitud puede confirmar al técnico.';
  end if;

  if v_estado in ('confirmada', 'confirmada_en_espera') then
    return v_estado; -- idempotente
  end if;

  if v_estado = 'en_espera' then
    update public.solicitudes set estado = 'confirmada_en_espera' where id = p_id;
    return 'confirmada_en_espera';
  end if;

  if v_estado <> 'aceptada' then
    raise exception 'Solo puedes confirmar una solicitud que el técnico ya aceptó (estado actual: %).', v_estado;
  end if;

  update public.solicitudes set estado = 'confirmada' where id = p_id;
  return 'confirmada';
end;
$function$;

-- ── 11) COMPLETAR: LIBERA AL TÉCNICO Y ACTIVA LA COLA ───────────────────────
create or replace function public.completar_solicitud(p_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_estado  text;
  v_tecnico bigint;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;

  select s.estado, s.tecnico_id into v_estado, v_tecnico
    from public.solicitudes s
   where s.id = p_id
     and s.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = v_uid)
   for update;

  if not found then
    raise exception 'Esta solicitud no está asignada a tu cuenta.';
  end if;

  if v_estado = 'completada' then
    return v_estado; -- el botón pudo tocarse dos veces
  end if;

  if v_estado not in ('llego', 'en_proceso') then
    raise exception 'Solo puedes terminar el servicio cuando hayas marcado "Llegué al destino" (estado actual: %).', v_estado;
  end if;

  update public.solicitudes set estado = 'completada' where id = p_id;

  -- Misma transacción: el técnico queda libre y el siguiente de la cola pasa a
  -- ser su servicio actual. Sus triggers avisan al cliente.
  perform public.activar_siguiente_solicitud(v_tecnico);

  return 'completada';
end;
$function$;

-- ── 12) CAMBIOS DE ESTADO: CANCELAR / RECHAZAR Y LIBERAR COLA ───────────────
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
    v_min := coalesce(s.precio_estimado_min, 0) * 0.5;
    v_max := coalesce(s.precio_estimado_max, 0) * 2;
    if p_precio_final is null or p_precio_final < v_min or p_precio_final > v_max then
      raise exception 'El precio final debe estar entre % y % COP', round(v_min), round(v_max);
    end if;
  else
    raise exception 'Cambio de estado no permitido';
  end if;

  update public.solicitudes
     set estado = p_estado,
         en_espera_desde = case when p_estado in ('en_espera', 'confirmada_en_espera') then en_espera_desde else null end,
         precio_final = case when p_estado = 'completada' then p_precio_final else precio_final end
   where id = p_id;

  if p_estado = 'rechazada' then perform public.reasignar_solicitud(p_id); end if;

  -- Si se cerró una solicitud del técnico, el siguiente de la cola toma el turno.
  if p_estado in ('cancelada', 'rechazada')
     and s.estado in ('aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso') then
    perform public.activar_siguiente_solicitud(s.tecnico_id);
  end if;
end $function$;

-- ── 13) AVISOS: COLA Y ACTIVACIÓN ───────────────────────────────────────────
create or replace function public.trg_notificar_estado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_destino uuid;
  v_tecnico_usuario uuid;
  v_texto text;
begin
  if new.estado is not distinct from old.estado then return new; end if;

  select t.usuario_id into v_tecnico_usuario from public.tecnicos t where t.id = new.tecnico_id;

  -- Se activó una solicitud que estaba en cola: el cliente recibe el aviso exacto.
  if new.estado in ('aceptada', 'confirmada')
     and old.estado in ('en_espera', 'confirmada_en_espera') then
    perform public.encolar_notificacion(
      new.cliente_id, 'estado_servicio', 'Solicitud #' || new.id,
      '¡Ahora la solicitud actual eres tú! El técnico ha terminado su servicio anterior y ahora continuará con tu solicitud. Te atenderá lo más pronto posible.',
      new.id
    );
    return new;
  end if;

  -- Quien provocó el cambio no recibe el aviso.
  if new.estado in ('aceptada', 'rechazada', 'en_camino', 'llego', 'completada', 'en_espera') then
    v_destino := new.cliente_id;
  elsif new.estado in ('confirmada', 'confirmada_en_espera', 'cancelada') then
    v_destino := v_tecnico_usuario;
  else
    return new;
  end if;

  v_texto := case new.estado
    when 'aceptada' then 'El técnico aceptó tu solicitud.'
    when 'en_espera' then 'El técnico aceptó tu solicitud, pero está ocupado con otro servicio. Tu solicitud quedó en espera y se activará cuando termine.'
    when 'confirmada' then 'El cliente confirmó el servicio. Ya puedes ir al domicilio.'
    when 'confirmada_en_espera' then 'El cliente confirmó el servicio en espera. Se activará cuando termines el servicio actual.'
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
$function$;

-- ── 14) PAGOS: NEQUI, BANCOLOMBIA, DAVIPLATA Y EFECTIVO ─────────────────────
create or replace function public.registrar_metodo_pago(p_id bigint, p_metodo text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_metodo text := lower(btrim(coalesce(p_metodo, '')));
  v_estado text;
  v_actual text;
  v_pago   text;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  if v_metodo not in ('nequi', 'bancolombia', 'daviplata', 'efectivo') then
    raise exception 'Ese método de pago aún no está disponible. Por ahora usa Nequi, Bancolombia, Daviplata o efectivo.';
  end if;

  select s.estado, s.pago_estado into v_estado, v_actual
    from public.solicitudes s
   where s.id = p_id and s.cliente_id = v_uid;

  if not found then raise exception 'No autorizado: solo el cliente de esta solicitud puede elegir el pago.'; end if;
  if v_estado <> 'completada' then raise exception 'Podrás elegir el método de pago cuando el servicio esté completado.'; end if;
  if v_actual = 'pagado' then raise exception 'Este servicio ya está pagado.'; end if;
  if v_actual = 'cancelado' then raise exception 'El pago de este servicio fue cancelado.'; end if;

  v_pago := case when v_metodo = 'efectivo' then 'efectivo' else 'pendiente' end;

  update public.solicitudes
     set metodo_pago = v_metodo,
         metodo_pago_en = now(),
         pago_estado = v_pago
   where id = p_id and cliente_id = v_uid;

  return v_pago;
end;
$function$;

-- El pago interno (manual) solo se registra con los cuatro métodos habilitados.
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
    return v_tx;
  end if;
  if v_sol.pago_estado = 'pagado' then
    raise exception 'Esta solicitud ya está pagada.';
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

-- ── 15) PERMISOS ────────────────────────────────────────────────────────────
grant execute on function public.aceptar_solicitud(bigint) to authenticated;
grant execute on function public.activar_siguiente_solicitud(bigint) to authenticated;

commit;
