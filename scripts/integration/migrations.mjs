/* DayPay — the migration chain, from an empty database.
 *
 * Every other proof in this repository assumes the schema exists. This one is
 * the assumption: apply 001 through the latest file in order, to nothing, and
 * check that what comes out is what the app expects. It also re-runs the last
 * migration, because a project that is a version behind will run it twice and a
 * migration that is not idempotent turns that into a confusing failure.
 *
 * The invariant checks at the end exist because migration 010 taught the
 * lesson: it asserted a literal string that was legitimately different, so the
 * migration could never install and nobody knew. Assert the shape, not the
 * wording — and never assert something the file itself cannot guarantee.
 *
 * Run it with:
 *     npm install --no-save @electric-sql/pglite
 *     node scripts/integration/migrations.mjs
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
const MIGRATIONS = path.join(REPO, 'supabase', 'migrations')
const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
const latest = files[files.length - 1]

let bad = 0
let checks = 0
const ok = (label, pass, detail) => {
  checks++
  if (!pass) bad++
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  -> ' + detail : ''}`)
}

const db = new PGlite({ parsers: { 1082: (v) => v } })

// The two Supabase pieces every migration takes for granted.
await db.exec(`
create role anon; create role authenticated; create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
  created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as
  $f$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
grant usage on schema auth to authenticated, anon;
`)

console.log(`\n  applying ${files.length} files, in order, to an empty database\n`)
for (const f of files) {
  try {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    console.log(`    ok  ${f}`)
  } catch (e) {
    ok(`apply ${f}`, false, e.message.split('\n')[0])
    process.exit(1)
  }
}
ok(`the whole chain applies, 001 through ${latest.slice(0, 3)}`, true, `${files.length} files`)

try {
  await db.exec(fs.readFileSync(path.join(MIGRATIONS, latest), 'utf8'))
  ok(`${latest} re-runs safely (a project a version behind is not a broken project)`, true)
} catch (e) {
  ok(`${latest} re-runs safely`, false, e.message.split('\n')[0])
}

// ── The shape the app depends on ────────────────────────────────────────────
const tables = (await db.query(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)).rows.map(r => r.table_name)
for (const t of ['employers', 'employees', 'employee_rate_periods', 'day_records',
  'day_record_events', 'contractors', 'attendance_sessions', 'correction_requests',
  'invoices', 'invoice_lines']) {
  ok(`table public.${t} exists`, tables.includes(t))
}

const fns = (await db.query(
  `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' order by proname`)).rows.map(r => r.proname)
for (const f of ['is_employer_of', 'is_self', 'can_see_employee', 'check_in_with_code',
  'resolve_correction', 'issue_invoice', 'void_invoice', 'my_attendance_status', 'redeem_invite']) {
  ok(`function public.${f}() exists`, fns.includes(f))
}

/* RLS must be ON, not merely configured. A table with policies and RLS off is
   wide open, and that is exactly the kind of mistake a passing build hides. */
const unprotected = (await db.query(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by c.relname`)).rows.map(r => r.relname)
ok('row level security is enabled on every table in public',
  unprotected.length === 0, unprotected.length ? unprotected.join(', ') : `${tables.length} of ${tables.length}`)

const policies = (await db.query(
  `select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public'`)).rows
ok('there are policies on the tables that need them', policies.length >= 20, `${policies.length} policies`)

/* A worker may withdraw their OWN day, but only while it is still merely
   claimed. Once the employer has confirmed it, the money is settled and the
   delete has to go through the employer. This check reads the policy's own
   condition, so it fails if that clause is ever loosened — the harness proves
   the same thing behaviourally, by trying it. The first draft of this check
   simply asserted "no DELETE policy on day_records", which was wrong: the
   employer may delete, and a worker may withdraw a claim. */
const workerDelete = policies.find(p => p.tablename === 'day_records' && p.policyname === 'day_records_self_delete')
ok("a worker's own delete is limited to a day the employer has NOT confirmed",
  !!workerDelete && /claimed/.test(workerDelete.qual || '') && !/confirmed/.test(workerDelete.qual || ''),
  workerDelete ? workerDelete.qual : 'NO POLICY')

/* The audit trail is append-only for clients: every row is written by a
   SECURITY DEFINER trigger. Read-only policies, and nothing else. */
const eventWrites = policies.filter(p => p.tablename === 'day_record_events' && p.cmd !== 'SELECT')
ok('the audit trail is append-only to every client — history is never rewritten',
  eventWrites.length === 0, eventWrites.length ? JSON.stringify(eventWrites.map(p => p.cmd)) : 'SELECT only')

/* An invoice is created by issue_invoice(), never by a POST. Migration 013 has
   to REVOKE what 004's default privileges hand every new table, so this check
   guards that pairing — grants alone would let a hand-made POST through even
   with no write policy. */
const writes = (await db.query(
  `select table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('authenticated','anon')
      and privilege_type in ('INSERT','UPDATE','DELETE')
      and table_name in ('invoices','invoice_lines')`)).rows
ok('clients cannot write an invoice directly — the function is the only door',
  writes.length === 0, writes.length ? JSON.stringify(writes) : 'no write grants')


const guard = (await db.query(
  `select pg_get_indexdef(i.indexrelid) as def from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'invoices_one_live_period_idx'`)).rows[0]
ok('the double-billing guard is partial and covers the unassigned case',
  !!guard && /where/i.test(guard.def) && /coalesce/i.test(guard.def),
  guard ? guard.def.slice(-46) : 'INDEX MISSING')

/* The money trigger is the single source of every amount in the product. If it
   is missing, every figure is zero and every screen is confidently wrong. */
const triggers = (await db.query(
  `select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relname = 'day_records'`)).rows.map(r => r.tgname)
ok('day_records still computes its own money and guards its own changes',
  triggers.includes('day_records_compute_money') && triggers.includes('day_records_guard'),
  triggers.join(', '))

console.log(`\n${'='.repeat(78)}`)
console.log(`MIGRATION CHAIN: ${checks - bad}/${checks} checks passed`)
console.log(bad === 0
  ? `001 → ${latest.slice(0, 3)} applies clean from an empty database and installs what the app expects`
  : `${bad} FAILURE(S)`)
process.exit(bad === 0 ? 0 : 1)
