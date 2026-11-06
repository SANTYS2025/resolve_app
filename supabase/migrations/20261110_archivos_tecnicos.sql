-- ═══════════════════════════════════════════════════════════════════════════
-- Archivos del técnico: fotos de portafolio y documentos
--
-- Antes solo se guardaban enlaces externos. Ahora la app puede subir archivos a
-- Supabase Storage, manteniendo el enlace manual como alternativa compatible.
--
-- Decisiones:
--  · Bucket `portafolio-tecnicos`: público de lectura (son fotos de trabajo).
--  · Bucket `documentos-tecnicos`: privado; solo el técnico dueño y un admin.
--  · Cada archivo vive en `<tecnico_id>/<uuid>.<ext>`; las políticas comparan
--    esa primera carpeta con el técnico autenticado.
--  · Los documentos privados se visualizan con URL firmada temporal.
--
-- Requiere: 20261107_clientes_tecnicos.sql.
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) COLUMNAS DE ARCHIVO ──────────────────────────────────────────────────
alter table public.portafolio_tecnicos
  add column if not exists archivo_path text;

alter table public.documentos_tecnicos
  add column if not exists archivo_path text;

-- Los documentos pueden venir de Storage (sin URL pública) o de un enlace.
alter table public.documentos_tecnicos alter column url drop not null;

alter table public.portafolio_tecnicos drop constraint if exists portafolio_archivo_path_check;
alter table public.portafolio_tecnicos
  add constraint portafolio_archivo_path_check
  check (archivo_path is null or char_length(archivo_path) between 1 and 300);

alter table public.documentos_tecnicos drop constraint if exists documentos_archivo_path_check;
alter table public.documentos_tecnicos
  add constraint documentos_archivo_path_check
  check (archivo_path is null or char_length(archivo_path) between 1 and 300);

alter table public.documentos_tecnicos drop constraint if exists documentos_archivo_o_url_check;
alter table public.documentos_tecnicos
  add constraint documentos_archivo_o_url_check
  check (url is not null or archivo_path is not null);

-- ── 2) BUCKETS ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portafolio-tecnicos', 'portafolio-tecnicos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos-tecnicos', 'documentos-tecnicos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 3) POLÍTICAS DE PORTAFOLIO (público de lectura) ─────────────────────────
drop policy if exists "portafolio_lectura" on storage.objects;
create policy "portafolio_lectura" on storage.objects
  for select using (bucket_id = 'portafolio-tecnicos');

drop policy if exists "portafolio_escritura" on storage.objects;
create policy "portafolio_escritura" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portafolio-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

drop policy if exists "portafolio_actualizacion" on storage.objects;
create policy "portafolio_actualizacion" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'portafolio-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  )
  with check (
    bucket_id = 'portafolio-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

drop policy if exists "portafolio_borrado" on storage.objects;
create policy "portafolio_borrado" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'portafolio-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

-- ── 4) POLÍTICAS DE DOCUMENTOS (privado) ────────────────────────────────────
drop policy if exists "documentos_lectura" on storage.objects;
create policy "documentos_lectura" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentos-tecnicos'
    and (
      (storage.foldername(name))[1] = (
        select t.id::text from public.tecnicos t
        where t.usuario_id = auth.uid()
        order by t.id limit 1
      )
      or public.es_admin()
    )
  );

drop policy if exists "documentos_escritura" on storage.objects;
create policy "documentos_escritura" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documentos-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

drop policy if exists "documentos_actualizacion" on storage.objects;
create policy "documentos_actualizacion" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documentos-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  )
  with check (
    bucket_id = 'documentos-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

drop policy if exists "documentos_borrado" on storage.objects;
create policy "documentos_borrado" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documentos-tecnicos'
    and (storage.foldername(name))[1] = (
      select t.id::text from public.tecnicos t
      where t.usuario_id = auth.uid()
      order by t.id limit 1
    )
  );

-- ── 5) VERIFICACIÓN RÁPIDA (opcional) ───────────────────────────────────────
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets
--  where id in ('portafolio-tecnicos', 'documentos-tecnicos');
