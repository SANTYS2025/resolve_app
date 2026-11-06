-- ═══════════════════════════════════════════════════════════════════════════
-- GPS del técnico · ETA · Pérdida de señal
--
-- Ejecutar en Supabase → SQL Editor, todo el bloque de una vez. Es idempotente.
--
-- Decisiones (ver src/lib/geo.ts):
--  · Solo se guarda la ÚLTIMA posición de cada técnico (tabla pequeña, canal
--    Realtime eficiente). No se almacena un historial de recorrido.
--  · El cliente solo puede leer la posición mientras la solicitud está activa
--    (confirmada, en_camino o llego) y el técnico sigue compartiendo.
--  · Si la posición tiene más de 5 minutos, la app oculta la ETA numérica y
--    muestra la última ubicación conocida con “Sin señal”. El servidor no
--    inventa una ETA: ese cálculo es de presentación.
--  · Al terminar o cancelar el servicio, el disparador deja de compartir.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ubicaciones_tecnicos (
  tecnico_id     bigint primary key references public.tecnicos(id) on delete cascade,
  solicitud_id   bigint references public.solicitudes(id) on delete set null,
  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  precision_m    double precision check (precision_m is null or precision_m >= 0),
  compartiendo   boolean not null default true,
  actualizado_en timestamptz not null default now()
);

create index if not exists ubicaciones_tecnicos_solicitud_idx
  on public.ubicaciones_tecnicos (solicitud_id) where compartiendo;

alter table public.ubicaciones_tecnicos enable row level security;

-- El técnico ve su propia posición.
drop policy if exists ubicaciones_tecnico_select on public.ubicaciones_tecnicos;
create policy ubicaciones_tecnico_select on public.ubicaciones_tecnicos
  for select to authenticated
  using (tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = auth.uid()));

-- El cliente ve la posición SOLO de una solicitud suya y mientras esté activa.
drop policy if exists ubicaciones_cliente_select on public.ubicaciones_tecnicos;
create policy ubicaciones_cliente_select on public.ubicaciones_tecnicos
  for select to authenticated
  using (
    compartiendo
    and exists (
      select 1 from public.solicitudes s
      where s.id = ubicaciones_tecnicos.solicitud_id
        and s.cliente_id = auth.uid()
        and s.estado in ('confirmada', 'en_camino', 'llego')
    )
  );

revoke all on public.ubicaciones_tecnicos from anon, authenticated;
grant select on public.ubicaciones_tecnicos to authenticated;

alter table public.ubicaciones_tecnicos replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ubicaciones_tecnicos') then
    alter publication supabase_realtime add table public.ubicaciones_tecnicos;
  end if;
end $$;

/**
 * Publica la posición del técnico para una solicitud.
 * Valida en el servidor: el técnico debe ser el asignado y el servicio debe
 * estar en un estado donde compartir ubicación tenga sentido.
 */
create or replace function public.publicar_ubicacion(
  p_solicitud_id bigint,
  p_lat double precision,
  p_lng double precision,
  p_precision_m double precision default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tecnico bigint;
  v_estado text;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'La ubicación no es válida.';
  end if;

  select t.id into v_tecnico from public.tecnicos t where t.usuario_id = v_uid order by t.id limit 1;
  if not found then raise exception 'Solo un técnico puede compartir su ubicación.'; end if;

  select s.estado into v_estado
    from public.solicitudes s
   where s.id = p_solicitud_id and s.tecnico_id = v_tecnico;
  if not found then raise exception 'No tienes asignada esa solicitud.'; end if;
  if v_estado not in ('confirmada', 'en_camino', 'llego') then
    raise exception 'Solo se comparte ubicación mientras el servicio está en curso.';
  end if;

  insert into public.ubicaciones_tecnicos
    (tecnico_id, solicitud_id, lat, lng, precision_m, compartiendo, actualizado_en)
  values
    (v_tecnico, p_solicitud_id, p_lat, p_lng, greatest(0, coalesce(p_precision_m, 0)), true, now())
  on conflict (tecnico_id) do update
    set solicitud_id = excluded.solicitud_id,
        lat = excluded.lat,
        lng = excluded.lng,
        precision_m = excluded.precision_m,
        compartiendo = true,
        actualizado_en = now();
end;
$$;

grant execute on function public.publicar_ubicacion(bigint, double precision, double precision, double precision) to authenticated;

/** El técnico deja de compartir (p. ej. al llegar o por privacidad). */
create or replace function public.detener_ubicacion(p_solicitud_id bigint default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  update public.ubicaciones_tecnicos u
     set compartiendo = false, actualizado_en = now()
   where u.tecnico_id in (select t.id from public.tecnicos t where t.usuario_id = v_uid)
     and (p_solicitud_id is null or u.solicitud_id = p_solicitud_id);
end;
$$;

grant execute on function public.detener_ubicacion(bigint) to authenticated;

/** Al cerrar el servicio, se deja de compartir automáticamente. */
create or replace function public.trg_ubicacion_cerrar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado in ('completada', 'cancelada', 'rechazada', 'expirada') then
    update public.ubicaciones_tecnicos
       set compartiendo = false, actualizado_en = now()
     where solicitud_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_solicitudes_cerrar_ubicacion on public.solicitudes;
create trigger trg_solicitudes_cerrar_ubicacion
  after update of estado on public.solicitudes
  for each row execute function public.trg_ubicacion_cerrar();

-- ── Verificación rápida (opcional) ─────────────────────────────────────────
-- select tecnico_id, solicitud_id, lat, lng, compartiendo,
--        extract(epoch from (now() - actualizado_en)) as segundos
--   from public.ubicaciones_tecnicos;
