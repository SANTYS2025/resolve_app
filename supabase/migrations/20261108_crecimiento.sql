-- ═══════════════════════════════════════════════════════════════════════════
-- Crecimiento: cupones · referidos · cobertura por barrio
--
-- Ejecutar en Supabase → SQL Editor, todo el bloque de una vez. Es idempotente.
-- Requiere: 20261105_pagos_wompi.sql (para recompensar referidos al primer pago).
--
-- Decisiones:
--  · El cupón se valida SIEMPRE en el servidor (`validar_cupon`) antes de
--    descontar. El cliente solo ve el resultado.
--  · Los descuentos se guardan en centavos en la solicitud, para que el cobro
--    de Wompi use el monto exacto que se mostró.
--  · Un cupón se consume al APLICARLO (no al pagar), para que dos clientes no
--    puedan reservar el mismo último uso. Solo se permite uno por solicitud.
--  · La recompensa de referido se marca como `recompensado` cuando el invitado
--    tiene su primer pago aprobado. No se mueve dinero automáticamente: queda
--    registrado para que el equipo lo abone por su medio habitual. El código
--    solo se puede vincular antes del primer pago aprobado.
--  · La cobertura por barrio es informativa (activo/recargo/nota); no bloquea
--    la creación de solicitudes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) COLUMNAS EN LA SOLICITUD ─────────────────────────────────────────────
alter table public.solicitudes add column if not exists cupon_codigo text;
alter table public.solicitudes add column if not exists descuento_centavos integer not null default 0;
alter table public.solicitudes add column if not exists referido_codigo text;

-- ── 2) CUPONES ──────────────────────────────────────────────────────────────
create table if not exists public.cupones (
  codigo             text primary key check (codigo ~ '^[A-Z0-9]{3,24}$'),
  tipo               text not null check (tipo in ('porcentaje', 'monto')),
  valor              integer not null check (valor between 1 and 100000000),
  monto_minimo_cop   integer not null default 0 check (monto_minimo_cop between 0 and 100000000),
  usos_max           integer check (usos_max is null or usos_max > 0),
  usos               integer not null default 0 check (usos >= 0),
  valido_desde       timestamptz,
  valido_hasta       timestamptz,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  -- Un porcentaje nunca puede superar el 100 % del servicio.
  constraint cupones_porcentaje_check check (tipo <> 'porcentaje' or valor <= 100)
);

-- Refuerzo para bases donde la tabla ya existía sin la restricción.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cupones_porcentaje_check') then
    alter table public.cupones
      add constraint cupones_porcentaje_check check (tipo <> 'porcentaje' or valor <= 100);
  end if;
end $$;

alter table public.cupones enable row level security;

drop policy if exists cupones_select on public.cupones;
create policy cupones_select on public.cupones
  for select to authenticated using (activo);

revoke all on public.cupones from anon, authenticated;
grant select on public.cupones to authenticated;

create table if not exists public.cupones_usos (
  id                 bigint generated always as identity primary key,
  codigo             text not null references public.cupones(codigo) on delete restrict,
  usuario_id         uuid not null references public.usuarios(id) on delete cascade,
  solicitud_id       bigint not null references public.solicitudes(id) on delete cascade,
  descuento_centavos integer not null check (descuento_centavos >= 0),
  creado_en          timestamptz not null default now()
);

create index if not exists cupones_usos_usuario_idx on public.cupones_usos (usuario_id, creado_en desc);
-- Un solo cupón por solicitud (también corrige bases con la restricción vieja).
create unique index if not exists cupones_usos_solicitud_unica on public.cupones_usos (solicitud_id);

alter table public.cupones_usos enable row level security;

drop policy if exists cupones_usos_select on public.cupones_usos;
create policy cupones_usos_select on public.cupones_usos
  for select to authenticated using (usuario_id = auth.uid());

revoke all on public.cupones_usos from anon, authenticated;
grant select on public.cupones_usos to authenticated;

/**
 * Valida un cupón contra el monto (en centavos). Réplica exacta de la regla de
 * `src/lib/cupones.ts`. No consume el cupón: solo dice cuánto descontaría.
 */
create or replace function public.validar_cupon(p_codigo text, p_monto_centavos integer)
returns table (valido boolean, motivo text, descuento_centavos integer, total_centavos integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_c public.cupones;
  v_total integer := greatest(0, coalesce(p_monto_centavos, 0));
  v_desc integer;
  v_desc_big bigint;
begin
  select * into v_c from public.cupones where codigo = v_cod;
  if not found then return query select false, 'Ese cupón no existe.', 0, v_total; return; end if;
  if not v_c.activo then return query select false, 'Este cupón ya no está activo.', 0, v_total; return; end if;
  if v_c.valido_desde is not null and now() < v_c.valido_desde then
    return query select false, 'Este cupón todavía no está vigente.', 0, v_total; return;
  end if;
  if v_c.valido_hasta is not null and now() > v_c.valido_hasta then
    return query select false, 'Este cupón venció.', 0, v_total; return;
  end if;
  if v_c.usos_max is not null and v_c.usos >= v_c.usos_max then
    return query select false, 'Este cupón ya alcanzó su límite de usos.', 0, v_total; return;
  end if;
  if v_total <= 0 then
    return query select false, 'El servicio no tiene un monto para aplicar el cupón.', 0, v_total; return;
  end if;
  if v_total::bigint < v_c.monto_minimo_cop::bigint * 100 then
    return query select false, 'El cupón aplica desde $' || v_c.monto_minimo_cop::text || '.', 0, v_total; return;
  end if;

  -- Se calcula en bigint para que un cupón de monto grande no desborde integer.
  v_desc_big := case when v_c.tipo = 'porcentaje'
                     then round(v_total::numeric * least(100, v_c.valor) / 100.0)::bigint
                     else v_c.valor::bigint * 100 end;
  v_desc := least(v_total::bigint, greatest(0::bigint, v_desc_big))::integer;
  if v_desc <= 0 then
    return query select false, 'El cupón no genera descuento para este monto.', 0, v_total; return;
  end if;
  return query select true, '', v_desc, v_total - v_desc;
end;
$$;

grant execute on function public.validar_cupon(text, integer) to authenticated;

/**
 * Aplica un cupón a una solicitud propia que todavía no se ha pagado.
 * Valida, registra el uso, incrementa el contador y deja el descuento en la
 * solicitud. Devuelve el descuento en centavos.
 */
create or replace function public.aplicar_cupon_solicitud(p_solicitud_id bigint, p_codigo text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sol public.solicitudes;
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_monto integer;
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

  -- Mismo precio base que usa `wompi-checkout`: final, o la referencia máxima/mínima.
  v_monto := greatest(0, round(coalesce(
    v_sol.precio_final, v_sol.precio_estimado_max, v_sol.precio_estimado_min, 0
  ) * 100)::integer);
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

-- ── 3) REFERIDOS ────────────────────────────────────────────────────────────
create table if not exists public.codigos_referido (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  codigo     text not null unique check (codigo ~ '^[A-Z0-9]{5,16}$'),
  creado_en  timestamptz not null default now()
);

alter table public.codigos_referido enable row level security;

drop policy if exists codigos_referido_select on public.codigos_referido;
create policy codigos_referido_select on public.codigos_referido
  for select to authenticated using (usuario_id = auth.uid());

revoke all on public.codigos_referido from anon, authenticated;
grant select on public.codigos_referido to authenticated;

create table if not exists public.referidos (
  id             bigint generated always as identity primary key,
  codigo         text not null,
  referidor_id   uuid not null references public.usuarios(id) on delete cascade,
  referido_id    uuid not null unique references public.usuarios(id) on delete cascade,
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'recompensado', 'expirado')),
  recompensa_cop integer not null default 10000 check (recompensa_cop >= 0),
  creado_en      timestamptz not null default now(),
  completado_en  timestamptz,
  check (referidor_id <> referido_id)
);

create index if not exists referidos_referidor_idx on public.referidos (referidor_id, creado_en desc);

alter table public.referidos enable row level security;

drop policy if exists referidos_select on public.referidos;
create policy referidos_select on public.referidos
  for select to authenticated using (referidor_id = auth.uid() or referido_id = auth.uid());

revoke all on public.referidos from anon, authenticated;
grant select on public.referidos to authenticated;

/** Devuelve el código del usuario; lo crea la primera vez. */
create or replace function public.mi_codigo_referido()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cod text;
  v_base text;
  v_intento integer := 0;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  select codigo into v_cod from public.codigos_referido where usuario_id = v_uid;
  if found then return v_cod; end if;

  select upper(regexp_replace(coalesce(nombre, ''), '[^A-Za-z]', '', 'g')) into v_base
    from public.usuarios where id = v_uid;
  v_base := left(coalesce(nullif(v_base, ''), 'AMIGO'), 6);
  loop
    v_intento := v_intento + 1;
    v_cod := v_base || upper(substr(replace(v_uid::text, '-', ''), 1, 4));
    if v_intento > 1 then v_cod := v_base || upper(substr(replace(v_uid::text, '-', ''), 1, 4)) || v_intento::text; end if;
    begin
      insert into public.codigos_referido (usuario_id, codigo) values (v_uid, v_cod);
      return v_cod;
    exception when unique_violation then
      -- Pudo ganarle otra petición simultánea del mismo usuario: reutiliza su código.
      select codigo into v_cod from public.codigos_referido where usuario_id = v_uid;
      if found then return v_cod; end if;
      if v_intento > 20 then raise; end if;
    end;
  end loop;
end;
$$;

grant execute on function public.mi_codigo_referido() to authenticated;

/** Vincula la cuenta actual con un código de referido (una sola vez). */
create or replace function public.vincular_referido(p_codigo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_referidor uuid;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  select usuario_id into v_referidor from public.codigos_referido where codigo = v_cod;
  if not found then raise exception 'Ese código de referido no existe.'; end if;
  if v_referidor = v_uid then raise exception 'No puedes usar tu propio código.'; end if;
  if exists (select 1 from public.referidos where referido_id = v_uid) then
    raise exception 'Ya tienes un referido vinculado.';
  end if;
  -- La recompensa es por el PRIMER pago: no se puede vincular después de pagar.
  if exists (select 1 from public.transacciones where cliente_id = v_uid and estado = 'aprobada') then
    raise exception 'Solo puedes vincular un código antes de tu primer pago.';
  end if;
  insert into public.referidos (codigo, referidor_id, referido_id)
  values (v_cod, v_referidor, v_uid);
  update public.solicitudes set referido_codigo = v_cod where cliente_id = v_uid and referido_codigo is null;
end;
$$;

grant execute on function public.vincular_referido(text) to authenticated;

/**
 * Al aprobarse el primer pago del invitado, la recompensa queda registrada.
 * No mueve dinero: el equipo la abona y el referidor recibe el aviso.
 */
create or replace function public.trg_recompensar_referido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referidos;
begin
  if new.estado <> 'aprobada' or old.estado = 'aprobada' then return new; end if;
  if coalesce(new.monto_centavos, 0) <= 0 then return new; end if;
  select * into v_ref from public.referidos
   where referido_id = new.cliente_id and estado = 'pendiente'
   order by creado_en limit 1;
  if not found then return new; end if;

  update public.referidos
     set estado = 'recompensado', completado_en = now()
   where id = v_ref.id;

  -- Tipo 'pago' (no 'promocion'): es un crédito, no publicidad, y las
  -- promociones están desactivadas por defecto.
  perform public.encolar_notificacion(
    v_ref.referidor_id, 'pago', '¡Ganaste una recompensa!',
    'Tu invitado completó su primer pago. Tienes $' || v_ref.recompensa_cop::text || ' pendientes de abono.', null
  );
  return new;
end;
$$;

drop trigger if exists trg_transacciones_recompensar_referido on public.transacciones;
create trigger trg_transacciones_recompensar_referido
  after update of estado on public.transacciones
  for each row execute function public.trg_recompensar_referido();

-- ── 4) COBERTURA POR BARRIO ─────────────────────────────────────────────────
create table if not exists public.cobertura_barrios (
  barrio_id   bigint primary key references public.barrios(id) on delete cascade,
  activo      boolean not null default true,
  recargo_cop integer not null default 0 check (recargo_cop >= 0),
  nota        text check (nota is null or char_length(nota) <= 200),
  actualizado_en timestamptz not null default now()
);

alter table public.cobertura_barrios enable row level security;

drop policy if exists cobertura_select on public.cobertura_barrios;
create policy cobertura_select on public.cobertura_barrios
  for select to authenticated using (true);

revoke all on public.cobertura_barrios from anon, authenticated;
grant select on public.cobertura_barrios to authenticated;

create or replace function public.cobertura_visible()
returns table (barrio_id bigint, barrio text, activo boolean, recargo_cop integer, nota text)
language sql
stable
security definer
set search_path = public
as $$
  select c.barrio_id, b.nombre, c.activo, c.recargo_cop, c.nota
    from public.cobertura_barrios c
    join public.barrios b on b.id = c.barrio_id
   order by b.nombre;
$$;

grant execute on function public.cobertura_visible() to authenticated;

-- ── Verificación rápida (opcional) ─────────────────────────────────────────
-- select * from public.validar_cupon('PROMO10', 10000000);
-- select public.mi_codigo_referido();
-- select * from public.cobertura_visible();
