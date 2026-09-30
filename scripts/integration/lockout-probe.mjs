/* Does the five-attempt lockout actually lock anybody out?
 *
 * THE BUG THIS WAS WRITTEN TO PROVE, AND STILL GUARDS AGAINST
 *
 * check_in_with_code() used to insert a row into check_in_attempts and THEN
 * raise the refusal. An exception aborts the transaction it is raised in, so
 * the row that had just been written was rolled back with it — every wrong code
 * erased its own evidence. The count never reached five, the cap never fired,
 * and the endpoint was brute-forceable: 10,000 codes, no limit, no record.
 *
 * Migration 017 returns the refusal as a value instead, so the write stands.
 * This script measures the whole path rather than trusting the migration's own
 * proof block, and it prints the numbers so the difference between "the cap
 * works" and "the cap is a comforting comment" is a measurement, not an
 * opinion.
 *
 * It also checks the property that made the bug possible to miss for three
 * phases: the refusals must still be INDISTINGUISHABLE from one another, and
 * the cap's sentence must still name nobody.
 *
 * It seeds its own fixtures and changes nothing else.
 *
 *     node scripts/integration/lockout-probe.mjs
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
const { PGlite } = require_('@electric-sql/pglite')

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const MIGRATIONS = path.join(REPO, 'supabase', 'migrations')

const db = new PGlite({ parsers: { 1082: (v) => v } })
await db.exec(`
create role anon; create role authenticated; create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
  created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as
  $f$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
grant usage on schema auth to authenticated, anon;`)
for (const f of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
}

const EMP = 'aaaaaaaa-0000-4000-8000-000000000001'
const UID = 'aaaaaaaa-1111-4111-8111-111111111111'
await db.exec(`insert into auth.users (id, email) values
  ('${EMP}', 'probe-employer@example.com'), ('${UID}', 'probe-worker@example.com')`)
await db.exec(`
insert into public.employers (user_id, business_name, kind) values ('${EMP}', 'Probe Ltd', 'business');
insert into public.employees (id, employer_id, employee_user_id, full_name, status)
  values ('${EMP.replace('0000', '2222')}', '${EMP}', '${UID}', 'Probe Worker', 'active');
insert into public.attendance_sessions (employer_id, work_date, code, expires_at)
  values ('${EMP}', current_date, '4321', now() + interval '8 hours');`)

const claims = `select set_config('request.jwt.claims', '{"sub":"${UID}","role":"authenticated"}', true)`

/* The committed path — the real one. A wrapper that rolled back could not
   answer this question at all, because it would undo the attempt row itself and
   manufacture the very result under investigation. */
async function wrongCode(code) {
  await db.exec('begin')
  await db.exec(`set local role authenticated; ${claims}`)
  try {
    const row = (await db.query(`select * from public.check_in_with_code('${code}')`)).rows[0]
    await db.exec('commit')
    /* A refusal is a returned row now. An older server raises instead, and a
       genuine fault does too, so both are still handled — the point is to see
       which one this database does. */
    if (!row) return 'NO ROW RETURNED'
    return row.ok === false ? row.message : `ACCEPTED — ${row.kind} recorded`
  } catch (e) {
    try { await db.exec('rollback') } catch { /* already closed */ }
    return 'RAISED: ' + e.message.split('\n')[0]
  }
}

console.log('\n  six wrong codes, each in its own transaction (the real path):\n')
const said = []
for (let i = 0; i < 6; i++) {
  const m = await wrongCode(String(1000 + i))
  said.push(m)
  const n = (await db.query('select count(*)::int n from public.check_in_attempts')).rows[0].n
  console.log(`    attempt ${i + 1}: attempts recorded = ${n}   "${m}"`)
}

const recorded = (await db.query('select count(*)::int n from public.check_in_attempts')).rows[0].n
const identical = new Set(said.slice(0, 5)).size === 1
const lockedOut = /Too many wrong codes/.test(said[5] || '')

console.log(`\n  rows left in check_in_attempts after six wrong codes: ${recorded}`)
console.log(`  every refusal identical until the cap:                ${identical}`)
console.log(`  the sixth is refused FOR THE CAP:                     ${lockedOut}`)
console.log(`  the cap names no contractor:                          ${!/contractor/i.test(said[5] || '')}`)

/* ── The verdict ─────────────────────────────────────────────────────────────
   Pass/fail on the four properties that matter, so this can be run as a check
   rather than read as prose. */
const verdict = [
  ['wrong codes are recorded', recorded === 5, `${recorded} of 5`],
  ['the refusals are indistinguishable', identical, 'one sentence for all five'],
  ['the cap fires on the sixth', lockedOut, lockedOut ? 'locked out' : 'NOT LOCKED OUT'],
  ['nothing names a contractor', !/contractor/i.test(said[5] || ''), 'no names'],
]
console.log('')
let failed = 0
for (const [what, pass, detail] of verdict) {
  if (!pass) failed++
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${what}  -> ${detail}`)
}
console.log(failed === 0
  ? '\nTHE LOCKOUT WORKS: five wrong codes are recorded, and the sixth is refused.\n'
  : `\n${failed} PROPERTY FAILED — the cap is not protecting anything.\n`)
process.exit(failed === 0 ? 0 : 1)
