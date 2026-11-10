-- ═══════════════════════════════════════════════════════════════════════════
-- Cola de solicitudes: bloqueo por técnico.
--
-- La migración 20261111 ya usa `for update` sobre la solicitud y activa la
-- cola dentro de la misma transacción. Este refuerzo agrega un lock de
-- transacción por técnico para que dos aceptaciones simultáneas (o una
-- aceptación y un cierre al mismo tiempo) no puedan dejar dos servicios
-- activos ni saltarse el orden de la cola.
--
-- Es idempotente: solo reemplaza funciones.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1) ACEPTAR: serializa por técnico antes de mirar si está ocupado.
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

  if s.estado in ('aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso',
                  'en_espera', 'confirmada_en_espera') then
    return s.estado;
  end if;

  if s.estado <> 'pendiente' then
    raise exception 'No puedes aceptar una solicitud en estado "%".', s.estado;
  end if;

  if not public.face_ok() then raise exception 'Verifica tu identidad para continuar'; end if;

  -- Un solo aceptar/cerrar por técnico a la vez.
  perform pg_advisory_xact_lock(hashtextextended('resolve_tecnico:' || s.tecnico_id::text, 0));

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

-- 2) ACTIVAR: toma el mismo lock antes de elegir la siguiente de la cola.
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
  perform pg_advisory_xact_lock(hashtextextended('resolve_tecnico:' || p_tecnico::text, 0));

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

-- 3) COMPLETAR: cierra y activa la cola sin que otra aceptación se cuele.
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
    return v_estado;
  end if;

  if v_estado not in ('llego', 'en_proceso') then
    raise exception 'Solo puedes terminar el servicio cuando hayas marcado "Llegué al destino" (estado actual: %).', v_estado;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('resolve_tecnico:' || v_tecnico::text, 0));

  update public.solicitudes set estado = 'completada' where id = p_id;

  perform public.activar_siguiente_solicitud(v_tecnico);

  return 'completada';
end;
$function$;

-- 4) CANCELAR / RECHAZAR: el cierre de un servicio activo también se serializa.
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
