/* DayPay — runs the shipped RLS harness, whole.
 *
 * `supabase/harness/rls_test.sql` is the file the user runs in the Supabase SQL
 * editor. It has been extended in every phase and never once run end to end:
 * Phase 6 proved sections 42-47 by slicing them out, Phase 7 proved 48-57 the
 * same way. Slicing is how a section gets checked; it is not how the FILE gets
 * checked, and a file that has drifted (a missing reset, a fixture that no
 * longer matches the schema, a check that depends on one two sections earlier)
 * would still look perfect in slices.
 *
 * So this executes the real file, unmodified except for its final ROLLBACK —
 * results live in a temporary table and are only readable inside the
 * transaction, so the rollback has to come after they are read. Everything
 * else, including the REPORT at the foot, runs exactly as written.
 *
 * Run it with:
 *     npm install --no-save @electric-sql/pglite
 *     node scripts/integration/harness.mjs
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
let PGlite
try {
  ({ PGlite } = require_('@electric-sql/pglite'))
} catch {
  console.error('\nThis needs PostgreSQL in a wasm module:\n' +
    '  npm install --no-save @electric-sql/pglite\n')
  process.exit(2)
}

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const HARNESS = path.join(REPO, 'supabase', 'harness', 'rls_test.sql')
const MIGRATIONS = path.join(REPO, 'supabase', 'migrations')

const raw = fs.readFileSync(HARNESS, 'utf8')
const rollbackAt = raw.lastIndexOf('\nrollback;')
if (rollbackAt < 0) {
  console.error('The harness no longer ends with a rollback — refusing to run it unrolled.')
  process.exit(2)
}
const sql = raw.slice(0, rollbackAt)

const db = new PGlite({ parsers: { 1082: (v) => v } })

// The two Supabase pieces the harness takes for granted.
await db.exec(`
create role anon; create role authenticated; create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
  created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as
  $f$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
grant usage on schema auth to authenticated, anon;
`)

for (const f of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')) }
  catch (e) { console.error(`\n  FAIL  ${f}: ${e.message.split('\n')[0]}`); process.exit(1) }
}
console.log(`\n  ${fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).length} migrations applied (001-013)`)

/* The harness picks its two accounts out of auth.users, by email if _cfg names
   them and otherwise the two most recent. These are its accounts. */
const EMPLOYER = '11111111-1111-4111-8111-111111111111'
const WORKER = '22222222-2222-4222-8222-222222222222'
await db.exec(`
insert into auth.users (id, email, created_at) values
  ('${EMPLOYER}','harness-employer@daypay.test', now() - interval '1 hour'),
  ('${WORKER}','harness-worker@daypay.test', now());
`)
/* Nothing else: the harness seeds its own employer, employees, rates,
   contractors, sessions and days. A runner that seeds them too collides with
   it — which is how this line was found. */

let rows = []
let report = ''
try {
  /* No wrapper transaction here: the harness opens its own with `begin;` on
     line 79 and closes it at the foot, which is exactly how it behaves in the
     Supabase SQL editor. Wrapping it again produced "relation _ids does not
     exist" — the outer block committed nothing and the temp tables, which are
     `on commit drop`, went with it. */
  const res = await db.exec(sql)
  rows = (await db.query(
    `select n, area, check_name, expected, actual, pass from _rls order by n`)).rows
  await db.exec('rollback')
  report = res.map(r => r.rows?.length ? `${r.rows.length} row(s)` : '').filter(Boolean).join(' ')
} catch (e) {
  console.error(`\n  FAIL  the harness did not survive the run: ${e.message.split('\n')[0]}`)
  try { await db.exec('rollback') } catch { /* already closed */ }
  process.exit(1)
}

const failed = rows.filter(r => !r.pass)
const areas = [...new Set(rows.map(r => r.area))]
let lastArea = null
for (const r of rows) {
  if (r.area !== lastArea) { console.log(`\n  ${r.area}`); lastArea = r.area }
  console.log(`    ${String(r.n).padStart(2)}  ${r.pass ? 'PASS' : 'FAIL'}  ${r.check_name}`)
  if (!r.pass) {
    console.log(`        expected: ${r.expected}`)
    console.log(`        actual:   ${r.actual}`)
  }
}

console.log(`\n  areas: ${areas.join(', ')}`)
console.log(`  checks: ${rows.length} — ${rows.length - failed.length} passed, ${failed.length} failed`)
console.log(`  the harness's own REPORT ran without error (${report})`)
console.log(failed.length === 0 && rows.length >= 58
  ? `\nTHE SHIPPED HARNESS PASSES END TO END — all ${rows.length} checks, in one run`
  : `\n*** ${failed.length} CHECK(S) FAILED — the shipped harness is not trustworthy as it stands ***`)
process.exit(failed.length === 0 && rows.length >= 58 ? 0 : 1)
