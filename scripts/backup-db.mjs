/**
 * Respaldo lógico de Supabase (esquema + datos) sin Docker/pg_dump.
 *
 * Uso (PowerShell):
 *   $env:SUPABASE_DB_URL = "postgresql://postgres.<ref>:<password>@...:5432/postgres"
 *   node scripts/backup-db.mjs <carpeta-destino>
 *
 * Genera:
 *   schema.sql   → columnas, constraints, índices, funciones, triggers, políticas, secuencias
 *   data/<tabla>.json → todas las filas de cada tabla pública
 *   manifest.json → conteos y fecha
 *
 * No modifica nada en la base (solo lecturas).
 */
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Falta SUPABASE_DB_URL')
  process.exit(1)
}
const destino = process.argv[2]
if (!destino) {
  console.error('Falta la carpeta destino')
  process.exit(1)
}

const dirData = path.join(destino, 'data')
fs.mkdirSync(dirData, { recursive: true })

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

const q = async (sql, params = []) => (await client.query(sql, params)).rows

async function main() {
  await client.connect()

  const tablas = (await q(`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `)).map(r => r.tablename)

  const manifest = { generado: new Date().toISOString(), proyecto: 'mgqrnhidrqznxiojmjlt', tablas: {} }

  for (const t of tablas) {
    const rows = await q(`select row_to_json(x) as r from public."${t}" x`)
    const datos = rows.map(r => r.r)
    fs.writeFileSync(path.join(dirData, `${t}.json`), JSON.stringify(datos, null, 1), 'utf8')
    manifest.tablas[t] = datos.length
  }

  const partes = []
  const add = (titulo, sql) => {
    partes.push(`-- ═══ ${titulo} ═══`)
    partes.push(sql.trim().replace(/;?\s*$/, ';'))
    partes.push('')
  }

  add('EXTENSIONES', (await q(`select 'create extension if not exists ' || extname || ';' as s from pg_extension where extname <> 'plpgsql'`)).map(r => r.s).join('\n'))

  add('COLUMNAS', (await q(`
    select format(
      'alter table %I.%I add column if not exists %I %s%s%s;',
      table_schema, table_name, column_name,
      case when data_type = 'USER-DEFINED' then udt_name else data_type end,
      case when character_maximum_length is not null then '(' || character_maximum_length || ')' else '' end,
      case when is_nullable = 'NO' then ' not null' else '' end
    ) as s
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `)).map(r => r.s).join('\n'))

  add('DEFAULTS', (await q(`
    select format('alter table %I.%I alter column %I set default %s;', table_schema, table_name, column_name, column_default) as s
    from information_schema.columns
    where table_schema = 'public' and column_default is not null
    order by table_name, ordinal_position
  `)).map(r => r.s).join('\n'))

  add('CONSTRAINTS', (await q(`
    select format('alter table %I.%I add constraint %I %s;', n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid)) as s
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by c.relname, con.conname
  `)).map(r => r.s).join('\n'))

  add('ÍNDICES', (await q(`
    select indexdef || ';' as s
    from pg_indexes where schemaname = 'public'
    and indexname not in (select conname from pg_constraint where contype in ('p','u'))
    order by tablename, indexname
  `)).map(r => r.s).join('\n'))

  add('FUNCIONES', (await q(`
    select pg_get_functiondef(p.oid) as s
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname, p.oid
  `)).map(r => r.s).join('\n\n'))

  add('TRIGGERS', (await q(`
    select pg_get_triggerdef(t.oid) || ';' as s
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
    order by c.relname, t.tgname
  `)).map(r => r.s).join('\n'))

  add('POLÍTICAS RLS', (await q(`
    select format('create policy %I on %I.%I as %s for %s to %s%s%s;',
      policyname, schemaname, tablename, permissive, cmd,
      array_to_string(roles, ', '),
      case when qual is not null then ' using (' || qual || ')' else '' end,
      case when with_check is not null then ' with check (' || with_check || ')' else '' end
    ) as s
    from pg_policies where schemaname = 'public'
    order by tablename, policyname
  `)).map(r => r.s).join('\n'))

  add('RLS HABILITADO', (await q(`
    select format('alter table %I.%I enable row level security;', schemaname, tablename) as s
    from pg_tables where schemaname = 'public' and rowsecurity
    order by tablename
  `)).map(r => r.s).join('\n'))

  add('SECUENCIAS', (await q(`
    select format('select setval(%L, %s, %s);', schemaname || '.' || sequencename,
      coalesce(last_value, 1), last_value is not null) as s
    from pg_sequences where schemaname = 'public'
  `)).map(r => r.s).join('\n'))

  fs.writeFileSync(path.join(destino, 'schema.sql'), partes.join('\n'), 'utf8')
  fs.writeFileSync(path.join(destino, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  const total = Object.values(manifest.tablas).reduce((a, b) => a + b, 0)
  console.log(`Respaldo listo: ${tablas.length} tablas, ${total} filas → ${destino}`)
  await client.end()
}

main().catch(async e => {
  console.error(e)
  try { await client.end() } catch {}
  process.exit(1)
})
