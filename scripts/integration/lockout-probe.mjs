/* Does the five-attempt lockout actually lock anybody out?
 *
 * This exists because a test asserted the lockout message and got the ordinary
 * wrong-code message instead. Either the test was wrong or the lockout is. The
 * suspicion is transactional, and it is worth stating plainly:
 *
 *   check_in_with_code() inserts a row into check_in_attempts and THEN raises
 *   the refusal. In PostgreSQL an exception aborts the transaction it is raised
 *   in, and everything that transaction wrote is undone — including the row
 *   that was just inserted. So every wrong code erases its own evidence, the
 *   count never reaches five, and the cap never fires.
 *
 * That would make the endpoint brute-forceable: 10,000 codes, no limit, no
 * record. This script measures it instead of arguing about it, because the
 * difference between "the cap works" and "the cap is dead code" is the
 * difference between a guard and a comforting comment.
 *
 * Read-only in intent: it seeds its own fixtures and prints what it finds. It
 * changes nothing in the product.
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

/* The committed path. This is the important part: a wrapped-in-rollback probe
   could not answer this question at all, because it would undo the attempt row
   itself and manufacture the very result under investigation. */
async function wrongCode(code) {
  await db.exec('begin')
  await db.exec(`set local role authenticated; ${claims}`)
  try {
    await db.query(`select * from public.check_in_with_code('${code}')`)
    await db.exec('commit')
    return null
  } catch (e) {
    /* The transaction is aborted, so this is a rollback whatever it is called.
       Committing here would be a no-op; being explicit keeps it obvious. */
    try { await db.exec('rollback') } catch { /* already closed */ }
    return e.message.split('\n')[0]
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
console.log(`\n  rows left in check_in_attempts after six wrong codes: ${recorded}`)
console.log(`  every refusal identical:                              ${new Set(said).size === 1}`)
console.log(`  the lockout was ever reached:                          ${said.some(m => /Too many wrong codes/.test(m))}`)

/* And the other half of the question: can the cap fire at all, if the rows are
   put there by something that commits? This separates "the counter is broken"
   from "the transaction is broken" — they need different fixes. */
await db.exec(`insert into public.check_in_attempts (session_id, user_id)
  select s.id, '${UID}' from public.attendance_sessions s, generate_series(1,5) g`)
const forced = await wrongCode('7000')
console.log(`\n  with five attempts committed by hand, the next call says:`)
console.log(`    "${forced}"`)
console.log(`  so the counter itself works:                           ${/Too many wrong codes/.test(forced || '')}`)
console.log(`  what fails is that a refusal erases its own record.\n`)

process.exit(0)
