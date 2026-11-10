/**
 * Respaldo lógico vía Supabase CLI (sin Docker ni pg_dump).
 *
 * Uso: node scripts/backup-remote.mjs <carpeta-destino>
 *
 * Requiere el proyecto enlazado (`supabase link`) y sesión de CLI válida.
 * Solo ejecuta consultas de lectura (`--read-only`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const destino = process.argv[2]
if (!destino) {
  console.error('Falta la carpeta destino')
  process.exit(1)
}
const dirData = path.join(destino, 'data')
fs.mkdirSync(dirData, { recursive: true })

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const tmpDir = path.join(destino, '.tmp-sql')
fs.mkdirSync(tmpDir, { recursive: true })
let nFile = 0

function sql(query) {
  const file = path.join(tmpDir, `q${nFile++}.sql`)
  fs.writeFileSync(file, query, 'utf8')
  const out = execFileSync(npx, ['supabase', 'db', 'query', '--remote', '--read-only', '--yes', '--output-format', 'json', '--file', file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const start = out.indexOf('{')
  if (start < 0) throw new Error('Respuesta inesperada de la CLI: ' + out.slice(0, 200))
  const json = JSON.parse(out.slice(start))
  const row = json.rows?.[0]
  if (!row) return null
  return row[Object.keys(row)[0]]
}

function agregado(expr) {
  return sql(`select coalesce(jsonb_agg(t), '[]'::jsonb)::text as data from (${expr}) t;`)
}

console.log('Leyendo tablas…')
const tablas = JSON.parse(sql(`select coalesce(jsonb_agg(tablename order by tablename), '[]'::jsonb)::text as data from pg_tables where schemaname = 'public';`))

const manifest = { generado: new Date().toISOString(), proyecto: 'mgqrnhidrqznxiojmjlt', tablas: {} }
for (const t of tablas) {
  const raw = sql(`select coalesce(jsonb_agg(x), '[]'::jsonb)::text as data from public."${t}" x;`)
  const datos = raw ? JSON.parse(raw) : []
  fs.writeFileSync(path.join(dirData, `${t}.json`), JSON.stringify(datos, null, 1), 'utf8')
  manifest.tablas[t] = datos.length
  console.log(`  ${t}: ${datos.length}`)
}

const partes = []
const add = (titulo, consulta) => {
  const raw = agregado(consulta)
  if (!raw) return
  const lineas = JSON.parse(raw).map(x => (typeof x === 'string' ? x : x?.s)).filter(Boolean)
  if (!lineas.length) return
  partes.push(`-- ═══ ${titulo} ═══`)
  partes.push(...lineas)
  partes.push('')
}

console.log('Leyendo esquema…')
add('EXTENSIONES', `select 'create extension if not exists ' || extname || ';' as s from pg_extension where extname <> 'plpgsql'`)
add('COLUMNAS', `select format('alter table %I.%I add column if not exists %I %s%s;', table_schema, table_name, column_name, case when data_type = 'USER-DEFINED' then udt_name else data_type end, case when character_maximum_length is not null then '(' || character_maximum_length || ')' else '' end) as s from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`)
add('DEFAULTS', `select format('alter table %I.%I alter column %I set default %s;', table_schema, table_name, column_name, column_default) as s from information_schema.columns where table_schema = 'public' and column_default is not null order by table_name, ordinal_position`)
add('CONSTRAINTS', `select format('alter table %I.%I add constraint %I %s;', n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid)) as s from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' order by c.relname, con.conname`)
add('ÍNDICES', `select indexdef || ';' as s from pg_indexes where schemaname = 'public' and indexname not in (select conname from pg_constraint where contype in ('p','u')) order by tablename, indexname`)
add('FUNCIONES', `select pg_get_functiondef(p.oid) as s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname, p.oid`)
add('TRIGGERS', `select pg_get_triggerdef(t.oid) || ';' as s from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal order by c.relname, t.tgname`)
add('POLÍTICAS RLS', `select format('create policy %I on %I.%I as %s for %s to %s%s%s;', policyname, schemaname, tablename, permissive, cmd, array_to_string(roles, ', '), case when qual is not null then ' using (' || qual || ')' else '' end, case when with_check is not null then ' with check (' || with_check || ')' else '' end) as s from pg_policies where schemaname = 'public' order by tablename, policyname`)
add('RLS HABILITADO', `select format('alter table %I.%I enable row level security;', schemaname, tablename) as s from pg_tables where schemaname = 'public' and rowsecurity order by tablename`)
add('SECUENCIAS', `select format('select setval(%L, %s, %s);', schemaname || '.' || sequencename, coalesce(last_value, 1), last_value is not null) as s from pg_sequences where schemaname = 'public'`)

fs.writeFileSync(path.join(destino, 'schema.sql'), partes.join('\n'), 'utf8')
fs.writeFileSync(path.join(destino, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

const total = Object.values(manifest.tablas).reduce((a, b) => a + b, 0)
console.log(`\nRespaldo listo: ${tablas.length} tablas, ${total} filas → ${destino}`)
