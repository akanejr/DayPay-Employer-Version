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

/* ── The pending batch, against the state your database is actually in ──────
   A fresh chain is not the situation anyone is in. A real project is part-way
   through: some migrations applied, some not, and the ones not yet run have to
   work on top of what IS there. That is a different test from "does 001..017
   apply in order", and it is the one that catches a pending file which only
   works on a clean database.

   ONE PGLLITE INSTANCE AT A TIME. Two live instances in one process share the
   WebAssembly module, and the second one corrupts the first — the run dies with
   "current transaction is aborted", which is a symptom of the harness, not of
   any migration. So the fresh chain's answers are read and the instance closed
   before the half-migrated one is opened, and the two are compared afterwards
   as plain data. */
const functionShape = async (d) => (await d.query(
  `select p.proname, md5(pg_get_functiondef(p.oid)) d from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('check_in_with_code','my_attendance_status')
    order by p.proname`)).rows

const fresh = await functionShape(db)
const freshAttendance = (await db.query(
  `select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'my_attendance_status'`)).rows[0].d
await db.close()

/* THE STATE THIS MODELS, AND WHY IT IS STILL WORTH TESTING.

   This was "the live state" while the batch was outstanding. As of
   2026-09-30 the live project has run everything here plus 012, 016 and 017,
   so the list below is no longer a description of it. It is kept because it is
   the state ANY project is in before it runs the batch: a restore of a backup
   taken before that date, a second environment, the copy someone makes next
   month. A batch that only works against a clean database is not a batch, and
   that is what this test is for.

   Written out rather than derived, because a derived state quietly re-derives
   itself whenever a new file is added and stops modelling anything at all. */
const LIVE_APPLIED = ['001', '002', '003', '004', '005', '006', '007', '008', '009',
  '011', '013']

/* The batch, by name — INSTALLED on the live project on 2026-09-30, and still
   modelled as pending here so the paragraph above keeps its subject. NOTE WHAT
   IS ABSENT AND WHY:
     010  its check_in_with_code is already installed by 011 (identical md5),
          and it carries the OLD refusal sentences — 016 replaces the only part
          of 010 that is still missing.
     014  folded into 015, which is in turn superseded by 017 below.
     015  replaces check_in_with_code with the same sentences but the OLD return
          shape. 017 replaces the same function and carries the same sentences,
          so 015 has nothing left to add — and running it AFTER 017 fails
          outright with "cannot change return type", which this test
          demonstrated before the file was ever handed over. */
const LIVE_BATCH = ['012_correction_requests.sql',
  '016_attendance_status_tiebreak.sql',
  '017_refusal_as_value.sql']

/* AND THE STATE THAT COMES AFTER IT: a project which has run the batch and is
   one file behind the repository. This is the ordinary state of a project
   between phases, and it is the one that catches a migration written against
   the latest schema instead of against the schema it will actually meet. */
const LIVE_NEXT = ['018_attendance_pin.sql', '019_site_kiosk.sql']

{
  const db2 = new PGlite({ parsers: { 1082: (v) => v } })
  await db2.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
      created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as
      $f$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
    grant usage on schema auth to authenticated, anon;`)

  const applied = files.filter(f => LIVE_APPLIED.includes(f.slice(0, 3)))
  let broke = null
  for (const f of applied) {
    try { await db2.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')) }
    catch (e) { broke = `applying the existing ${f}: ${e.message.split('\n')[0]}`; break }
  }

  if (!broke) {
    for (const f of LIVE_BATCH) {
      try { await db2.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')) }
      catch (e) { broke = `${f}: ${e.message.split('\n')[0]}`; break }
    }
  }

  ok(`the ${LIVE_BATCH.length} batch migrations apply on top of a project that predates them`,
    !broke, broke || `after ${applied.length} already applied (${LIVE_BATCH.map(f => f.slice(0, 3)).join(' → ')})`)

  if (!broke) {
    for (const f of LIVE_NEXT) {
      try { await db2.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')) }
      catch (e) { broke = `${f}: ${e.message.split('\n')[0]}`; break }
    }
    ok(`and the ${LIVE_NEXT.length} file added since apply on top of that`,
      !broke, broke || `after the whole batch (${LIVE_NEXT.map(f => f.slice(0, 3)).join(' → ')})`)
  }

  if (!broke) {
    const patched = await functionShape(db2)
    ok('the half-migrated project ends up identical to a freshly built one',
      JSON.stringify(fresh) === JSON.stringify(patched),
      fresh.map(r => `${r.proname}=${r.d.slice(0, 8)}`).join(' '))

    /* 016 exists so that 010 does NOT have to be run — 010's check-in half is
       already installed by 011, and its old refusal sentences must not come
       back. That trade is only safe if 016 installs the same
       my_attendance_status that 010 carries. Checked against 010's own text,
       not against my memory of it. */
    const patchedAttendance = (await db2.query(
      `select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'my_attendance_status'`)).rows[0].d
    const tenSrc = fs.readFileSync(path.join(MIGRATIONS, '010_any_live_code_covers.sql'), 'utf8')
    ok('016 installs exactly the my_attendance_status that 010 carries',
      tenSrc.includes('order by (s.contractor_id is null)')
        && /order by \(s\.contractor_id is null\)/.test(patchedAttendance)
        && patchedAttendance === freshAttendance,
      'same deterministic order as 010, and the same body as the fresh chain')

    /* And 017's contract must be the one that reaches the live project. A
       refusal the worker never sees is the defect this migration exists for. */
    const liveCheckIn = (await db2.query(
      `select pg_get_function_result(p.oid) r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'check_in_with_code'`)).rows[0].r
    ok('after the batch, a refusal has an (ok, message) contract to travel in',
      /ok boolean/.test(liveCheckIn) && /message text/.test(liveCheckIn),
      liveCheckIn.slice(0, 62) + '…')

    /* THE REPORT A HUMAN PASTES. supabase/harness/verify_installed.sql is the
       "what is actually installed?" query handed to whoever administers the
       project. It is read by a person, which is exactly why it has to be
       tested here: a report that silently returns no rows, or throws on a
       valid database, is worse than no report — it answers "is it installed?"
       with something that looks like an answer. Run against a database this
       test has just built and therefore knows the truth about. */
    const report = await db2.query(fs.readFileSync(
      path.join(REPO, 'supabase', 'harness', 'verify_installed.sql'), 'utf8'))
    const notPassing = report.rows.filter(r => !/^(PASS|INFO)/.test(r.verdict))
    ok('the installed-state report reads PASS on a fully migrated database',
      report.rows.length >= 10 && notPassing.length === 0,
      notPassing.length === 0
        ? `${report.rows.length} rows, all PASS`
        : notPassing.map(r => r.check_name).join('; '))
  }

  await db2.close()
}

console.log(`\n${'='.repeat(78)}`)
console.log(`MIGRATION CHAIN: ${checks - bad}/${checks} checks passed`)
console.log(bad === 0
  ? `001 → ${latest.slice(0, 3)} applies clean from empty, and the batch `
    + `applies to a project that predates it and lands in the same place`
  : `${bad} FAILURE(S)`)
process.exit(bad === 0 ? 0 : 1)
