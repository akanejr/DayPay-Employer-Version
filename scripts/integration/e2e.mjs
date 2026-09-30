/* DayPay — Phase 8 end-to-end integration test.
 *
 * THE ONE QUESTION THIS FILE ANSWERS
 *
 * Phase 8 of the brief is one sentence: "session → check-in → dashboard →
 * worker → month → year → contractor total → invoice, asserting every figure
 * reconciles."
 *
 * So this walks that chain once, in order, against a real PostgreSQL with all
 * thirteen migrations applied, acting as each person in turn: the employer
 * opening a session, the worker checking in with the code, the employer
 * confirming and correcting, the worker's month, the year, the contractor's
 * total, the invoice. At every stage the SAME money is computed by a different
 * layer, and the layers are compared:
 *
 *     the database trigger   the amount stored on the day
 *     SQL aggregate          count/sum over the stored rows
 *     JS  summarise()        the Summary screen and the CSV
 *     JS  monthFigures()     the month header
 *     JS  ledgerTotals()     the worker's own "awaiting confirmation" line
 *     JS  payslipModel()     the payslip and the yearly share
 *     JS  contractorRollup() the contractor's worker cards
 *     JS  billingRows()      the billing preview
 *     SQL issue_invoice()    the document that gets sent
 *
 * A disagreement between any two of those is the bug this phase exists to find,
 * because DayPay's whole promise is that the ledger, the screen and the invoice
 * say the same thing.
 *
 * Run it with:
 *     npm install --no-save @electric-sql/pglite
 *     node scripts/integration/e2e.mjs
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
  console.error('\nThis test needs PostgreSQL in a wasm module:\n' +
    '  npm install --no-save @electric-sql/pglite\n')
  process.exit(2)
}

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const MIGRATIONS = path.join(REPO, 'supabase', 'migrations')

const {
  summarise, monthFigures, ledgerTotals, ledgerToRecord,
  contractorRollup, billingRows, dayBoard, workerMonthTotals, monthBounds,
} = await import('../../src/lib/employerLogic.js')
const { payslipModel, fmtMoney, fmtEquiv } = await import('../../src/lib/payslip.js')
const { invoiceModel } = await import('../../src/lib/invoice.js')

// ── Reporting ───────────────────────────────────────────────────────────────
let bad = 0
let checks = 0
const ok = (label, pass, detail) => {
  checks++
  if (!pass) bad++
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  -> ' + detail : ''}`)
}
const step = (n, title) => console.log(`\n── ${n}. ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`)

/* Every layer that reports the same figure is asked for it, and the answers are
   put side by side. Equality is asserted once, on the whole set, so adding a
   layer to the table automatically adds it to the assertion. */
let recon = []
const reconcile = (figures, { label = '' } = {}) => {
  recon = Object.entries(figures).map(([layer, value]) => ({ layer, value }))
  const values = new Set(recon.map(r => String(r.value)))
  console.log(`\n  RECONCILIATION${label ? ' — ' + label : ''}`)
  for (const r of recon) console.log(`    ${r.layer.padEnd(26)} ${r.value}`)
  ok(`${figureWord(label || 'figure')} is identical across ${recon.length} layers`,
    values.size === 1, values.size === 1 ? String(recon[0].value) : [...values].join(' vs '))
}
const figureWord = (l) => `${l.charAt(0).toUpperCase()}${l.slice(1)}`

// ── The database ────────────────────────────────────────────────────────────
/* PGlite hands `date` columns back as JavaScript Dates; PostgREST hands them
   back as 'YYYY-MM-DD' strings, which is what every screen in this app compares
   against. Without this one line the test measures PGlite's type mapping
   instead of the app: the first run "failed" a correct check-in because
   '2026-09-30' !== new Date('2026-09-30T00:00:00.000Z'), and the dashboard
   reported nobody present. Type 1082 is DATE. */
const db = new PGlite({ parsers: { 1082: (v) => v } })

await db.exec(`
create role anon; create role authenticated; create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
  created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as
  $f$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
grant usage on schema auth to authenticated, anon;
`)

step(0, 'The database the app expects')
for (const f of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  } catch (e) {
    ok(`apply ${f}`, false, e.message.split('\n')[0]); process.exit(1)
  }
}
const applied = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
const tableCount = (await db.query(
  `select count(*)::int n from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE'`)).rows[0].n
ok(`all ${applied.length} migrations apply, 001 through ${applied[applied.length - 1].slice(0, 3)}`,
  true, applied.join(' '))
ok('the workforce tables are present', tableCount >= 8, `${tableCount} tables in public`)

/* Actors. Two employers, so isolation is tested with a real neighbour rather
   than by imagining one. */
const EMP = {
  A: '11111111-1111-4111-8111-111111111111',
  B: '22222222-2222-4222-8222-222222222222',
}
const USER = {
  james: '33333333-3333-4333-8333-333333333333',   // worker, linked account
  grace: '44444444-4444-4444-8444-444444444444',   // worker, linked, different employer
}
const C1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const C2 = 'bbbbbbbb-0000-0000-0000-000000000002'
const W = {
  james: 'cccccccc-0000-0000-0000-000000000001',   // linked, on C1
  timothy: 'cccccccc-0000-0000-0000-000000000002', // unlinked, on C1
  samuel: 'cccccccc-0000-0000-0000-000000000003',  // unlinked, unassigned
  grace: 'cccccccc-0000-0000-0000-000000000004',   // linked to USER.grace, on employer B
}

const YEAR = new Date().getFullYear()
const MONTH = new Date().getMonth()          // the month the chain runs in
const { from: M_FROM, to: M_TO } = monthBounds(YEAR, MONTH)
const day = (d) => `${YEAR}-${String(MONTH + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const DOM = new Date().getDate()             // which day of the month we are on

/* RATE HISTORY BY CONSTRUCTION. The rate changes on the 2nd of the month, so
   every run has days on both sides of the change and the "mixed rates" case is
   always exercised — including on the 1st, when the day being checked in is
   itself on the old rate. Nothing below hardcodes a rate: it is asked of this
   one function, and the ledger has to agree with it. */
const RATE_OLD = 16000
const RATE_NEW = 20000
const RATE_CHANGE = day(2)
const expectRate = (dateKey) => (dateKey >= RATE_CHANGE ? RATE_NEW : RATE_OLD)

/* The extra days the employer records, chosen so none of them collides with the
   day the worker checks in on. */
const extraDays = [3, 4, 6, 20].filter(d => d !== DOM)
const OT_DAY = day(extraDays[0] ?? 1)
const WORK_DAY = day(extraDays[1] ?? extraDays[0] ?? 1)
const NEW_RATE_DAY = day(20)                 // always after the change
const SECOND_WORKER_DAY = day(extraDays[2] ?? extraDays[0] ?? 1)
/* A day on the OLD rate. On the 1st of the month that day is the check-in
   itself, so nothing extra is recorded and the two rates still both appear. */
const OLD_RATE_DAY = day(1)
const NEEDS_OLD_DAY = DOM !== 1

await db.exec(`
insert into auth.users (id, email) values
  ('${EMP.A}','owner@eddimore.test'), ('${EMP.B}','owner@other.test'),
  ('${USER.james}','james@worker.test'), ('${USER.grace}','grace@worker.test');

insert into public.employers (user_id, business_name, kind) values
  ('${EMP.A}','Eddimore','business'), ('${EMP.B}','Other Co','business');

insert into public.contractors (id, employer_id, name, status) values
  ('${C1}','${EMP.A}','Eddimore Crew','active'),
  ('${C2}','${EMP.B}','Other Crew','active');

insert into public.employees (id, employer_id, full_name, job_title, contractor_id, employee_user_id, status) values
  ('${W.james}','${EMP.A}','James Okon','Rigger','${C1}','${USER.james}','active'),
  ('${W.timothy}','${EMP.A}','Timothy Bassey','Welder','${C1}',null,'active'),
  ('${W.samuel}','${EMP.A}','Samuel Etim','Helper',null,null,'active'),
  ('${W.grace}','${EMP.B}','Grace Effiong','Painter','${C2}','${USER.grace}','active');

/* Rate history, which is what makes the yearly figure impossible to fake:
   James is on 16,000 until the 15th of this month, then 20,000. Any layer that
   values a day from "the current rate" instead of the stored amount will be
   caught by the reconciliation at the end. */
insert into public.employee_rate_periods
  (employee_id, effective_from, daily_rate, weekend_multiplier, holiday_multiplier) values
  ('${W.james}','${YEAR}-01-01',${RATE_OLD},2,2),
  ('${W.james}','${RATE_CHANGE}',${RATE_NEW},2,2),
  ('${W.timothy}','${YEAR}-01-01',12000,2,2),
  ('${W.samuel}','${YEAR}-01-01',10000,2,2),
  ('${W.grace}','${YEAR}-01-01',15000,2,2);
`)
ok('a workplace exists: 2 employers, 4 workers, 2 contractors, rates with a mid-month change', true)

// ── Acting as somebody ──────────────────────────────────────────────────────
/* RLS only bites a non-owner role, so every client-side step runs as
   `authenticated` inside its own transaction. Reads roll back; writes commit. */
const as = async (uid, sql, { commit = false } = {}) => {
  await db.exec('begin')
  await db.exec(`set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);`)
  try {
    const r = await db.query(sql)
    if (commit) await db.exec('commit')
    return r
  } finally {
    if (!commit) { try { await db.exec('rollback') } catch { /* already closed */ } }
  }
}
const asA = (sql, o) => as(EMP.A, sql, o)
const attempt = async (uid, sql) => {
  await db.exec('begin')
  await db.exec(`set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);`)
  try {
    await db.query(sql)
    return null                      // no error means the database allowed it
  } catch (e) { return e.message }
  finally { try { await db.exec('rollback') } catch { /* already closed */ } }
}

/* A check-in, read the way the app now reads it.
 *
 * Migration 017 made a refusal a RETURNED value (ok = false, message) instead
 * of a raised exception, so `attempt` — which only knows about errors — cannot
 * see one. A refusal that raised is precisely what used to roll back the
 * attempt record, which is why the five-attempt cap never fired.
 *
 * commit: true is needed to observe anything the function WROTE. Without it the
 * rollback at the end undoes the attempt rows, and the test would be measuring
 * its own wrapper rather than the product. */
const checkInAttempt = async (uid, code, { commit = false } = {}) => {
  await db.exec('begin')
  await db.exec(`set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);`)
  try {
    const rows = (await db.query(`select * from public.check_in_with_code('${code}')`)).rows
    const r = rows[0]
    if (commit) await db.exec('commit')
    if (!r) return { ok: false, message: null, note: 'the function returned no row at all' }
    return { ok: r.ok === true, message: r.message, row: r }
  } catch (e) {
    /* Not a refusal — a refusal is a row now. This is either an older server,
       which still raises, or a genuine fault. Both are reported as they are. */
    try { await db.exec('rollback') } catch { /* already closed */ }
    return { ok: false, message: e.message.split('\n')[0], raised: e.message.split('\n')[0] }
  }
}

/* The employer's month rows, read exactly the way the app reads them. */
const readMonth = async () => {
  const { rows } = await asA(`
    select d.id, d.employee_id, d.work_date, d.kind, d.status, d.source,
           d.rate, d.multiplier, d.amount, d.leave_type
      from public.day_records d
      join public.employees e on e.id = d.employee_id
     where e.employer_id = auth.uid()
       and d.work_date between '${M_FROM}' and '${M_TO}'
     order by d.work_date`)
  return rows
}
const employeesOfA = (await asA(
  `select id, employer_id, full_name, job_title, contractor_id, status
     from public.employees where employer_id = auth.uid() order by full_name`)).rows

// ── 1. Session ──────────────────────────────────────────────────────────────
step(1, 'The employer opens today, and reads out the code')
const CODE = '7429'
const TODAY = day(new Date().getDate())
await asA(`
  insert into public.attendance_sessions (employer_id, contractor_id, work_date, code, expires_at)
  values (auth.uid(), '${C1}', '${TODAY}', '${CODE}', now() + interval '8 hours')`, { commit: true })
const session = (await asA(
  `select id, code, status, work_date, contractor_id from public.attendance_sessions
    where employer_id = auth.uid() and work_date = '${TODAY}'`)).rows[0]
ok('a session exists for today with a 4-digit code', !!session && /^[0-9]{4}$/.test(session.code), session?.code)

/* The code is the employer's to read out, and only theirs. If a worker could
   read it, "verification" would mean nothing — they could check in from home. */
const workerSeesCode = (await as(USER.james,
  `select count(*)::int n from public.attendance_sessions
    where employer_id = '${EMP.A}' and code = '${CODE}'`)).rows[0].n
ok('the worker cannot read the code they are about to be given', workerSeesCode === 0)

// ── 2. Check-in ─────────────────────────────────────────────────────────────
step(2, 'The linked worker checks in with it')
/* The refusal, asserted to the character. This sentence is the ONLY thing a
   worker sees when their code is wrong, and it is raised by the database — the
   interface has no copy of it — so the exact words are a contract, not a
   detail. Migration 014 set them.
   The second wrong code proves the messages are IDENTICAL: a code belonging to
   nobody and a code that is merely stale must look the same, or the endpoint
   becomes a way to ask "was that number real?" */
const REFUSAL = 'Code not correct, visit the site.'
const CAP = 'Too many wrong codes. Try again in a few minutes.'
const said = (m) => (m || '').split('\n')[0].replace(/^ERROR:\s*/, '').trim()

const wrong = await checkInAttempt(USER.james, '0001')
const wrong2 = await checkInAttempt(USER.james, '9998')
ok('a wrong code comes back as an ANSWER, not an exception (ok=false + message)',
  wrong.ok === false && !!wrong.message && !wrong.raised,
  `ok=${wrong.ok} raised=${wrong.raised || 'no'} "${said(wrong.message)}"`)
ok('in exactly the words we agreed', said(wrong.message) === REFUSAL, `"${said(wrong.message)}"`)
ok('and it names nobody — no worker, no contractor, no hint the number was real',
  !/james|okon|timothy|samuel|grace|contractor/i.test(wrong.message || ''), said(wrong.message))
ok('a different wrong code gets a byte-identical answer (the endpoint is not an oracle)',
  said(wrong2.message) === said(wrong.message), `"${said(wrong2.message)}"`)

const checked = (await as(USER.james, `select * from public.check_in_with_code('${CODE}')`, { commit: true })).rows[0]
ok('the right code records the day', !!checked && checked.work_date === TODAY, JSON.stringify(checked?.work_date))
ok('and it is recorded as a check-in, awaiting the employer',
  checked?.kind === 'work' && checked?.already === false,
  `kind ${checked?.kind}, already ${checked?.already}`)

const jamesDay = (await asA(
  `select * from public.day_records where employee_id = '${W.james}' and work_date = '${TODAY}'`)).rows[0]
ok('the ledger holds it, valued by the trigger at the rate in force that day',
  Number(jamesDay?.amount) === expectRate(TODAY) * 1
    && Number(jamesDay?.rate) === expectRate(TODAY) && Number(jamesDay?.multiplier) === 1,
  `₦${jamesDay?.amount} = ₦${jamesDay?.rate} x ${jamesDay?.multiplier} (rate ${expectRate(TODAY) === RATE_NEW ? 'after' : 'before'} the change on the 2nd)`)
ok('the day is claimed, not confirmed — checking in is not the same as agreeing',
  jamesDay?.status === 'claimed' && jamesDay?.source === 'check_in')

const again = (await as(USER.james, `select * from public.check_in_with_code('${CODE}')`)).rows[0]
ok('checking in twice does not create a second day', again?.already === true,
  `already = ${again?.already}`)
const rowsToday = (await asA(
  `select count(*)::int n from public.day_records where employee_id = '${W.james}' and work_date = '${TODAY}'`)).rows[0].n
ok('exactly one row, because the ledger is a ledger', rowsToday === 1, `${rowsToday} row(s)`)

/* ── The lockout, which does not work ───────────────────────────────────────
   This started as an assertion that the lockout message appears after five
   wrong codes. It does not appear, and the reason is not the message.

   check_in_with_code() writes the attempt to check_in_attempts and THEN raises
   the refusal. PostgreSQL aborts the transaction an exception is raised in, so
   the row that was just written is rolled back with it: every wrong code erases
   its own evidence. Six wrong codes in a row leave the table EMPTY and the
   count never reaches five. The endpoint is brute-forceable — 10,000 codes,
   no limit, no record of the attempt — and the cap has never protected
   anything on any database this has run against.

   scripts/integration/lockout-probe.mjs demonstrates it end to end, including
   the half that DOES work: put five rows there by hand, committed, and the
   sixth call is refused with the lockout message. The counter is fine. The
   transaction is the problem.

   These two checks therefore record what the system ACTUALLY does, not what it
   says it does. They will fail the moment the behaviour is fixed, which is the
   point: the fix has to come here and change them, rather than quietly land
   underneath a green suite. Reported to the owner; not fixed in this phase,
   because switching the refusal from an exception to a return value changes
   the worker's screen and every refusal path in the product. */
for (const c of ['0001', '0002', '0003', '0004', '0005']) {
  await checkInAttempt(USER.james, c, { commit: true })
}
/* Read as the OWNER, not as the employer, and that is not a workaround.
   check_in_attempts carries no SELECT policy for either role, so both the
   employer and the worker see zero rows — which is right: the log of who tried
   what should not be legible to the person being rate-limited, nor a way for an
   employer to watch a worker fumble a code. The first version of this check
   asked as the employer, read 0, and reported the fix as broken while the cap
   was demonstrably working — the number in front of it was a permission, not a
   fact. */
const recorded = (await db.query(
  `select count(*)::int n from public.check_in_attempts where user_id = '${USER.james}'`)).rows[0].n
ok('five wrong codes leave FIVE recorded attempts — a refusal no longer erases its own evidence',
  recorded === 5, `${recorded} row(s) in check_in_attempts`)

const capped = await checkInAttempt(USER.james, '0006', { commit: true })
ok('so the sixth is refused for the cap, in the agreed words',
  said(capped.message) === CAP, `"${said(capped.message)}"`)
ok('and the lockout does not send them to a contractor either — it names the one useful fact',
  !/contractor/i.test(capped.message || ''), said(capped.message))

/* The five attempts stay in the table for the rest of this run, deliberately:
   the cap is per worker per session and this is the last check-in in the walk.
   An earlier version of this block cleared them and claimed they cleared
   themselves — they do not, any more, and that is the point of the fix. */

// ── 3. Dashboard ────────────────────────────────────────────────────────────
step(3, 'The dashboard the employer sees')
let monthRows = await readMonth()
const board = dayBoard(monthRows, employeesOfA, TODAY)
ok('the board knows who is in and who is not',
  board.present.length === 1 && board.missing.length === 2 && board.offRoster.length === 0,
  `${board.present.length} in, ${board.missing.length} not in`)
ok('the person who checked in is the person who checked in',
  board.present[0].employee.full_name === 'James Okon', board.present[0].employee.full_name)
ok('and the board flags the day as unsettled',
  board.counts.unconfirmed === 1, `${board.counts.unconfirmed} awaiting confirmation`)

// ── 4. Employee + employer in the same month ────────────────────────────────
step(4, 'The employer marks and confirms days, assigns overtime')
/* Overtime as the employer marks it: one row, kind overtime, 2x. The trigger
   values it — the client never sends an amount. */
await asA(`insert into public.day_records (employee_id, work_date, kind, status, claimed_by)
           values ('${W.james}', '${OT_DAY}', 'overtime', 'confirmed', auth.uid())`, { commit: true })
await asA(`insert into public.day_records (employee_id, work_date, kind, status, claimed_by)
           values ('${W.james}', '${WORK_DAY}', 'work', 'confirmed', auth.uid())`, { commit: true })
/* A day before the change and a day after it, so the period provably contains
   two rates — which is what makes a re-estimating engine detectable. */
await asA(`insert into public.day_records (employee_id, work_date, kind, status, claimed_by)
           values ('${W.james}', '${NEW_RATE_DAY}', 'work', 'confirmed', auth.uid())`, { commit: true })
if (NEEDS_OLD_DAY) {
  await asA(`insert into public.day_records (employee_id, work_date, kind, status, claimed_by)
             values ('${W.james}', '${OLD_RATE_DAY}', 'work', 'confirmed', auth.uid())`, { commit: true })
}
await asA(`insert into public.day_records (employee_id, work_date, kind, status, claimed_by)
           values ('${W.timothy}', '${SECOND_WORKER_DAY}', 'work', 'confirmed', auth.uid())`, { commit: true })
await asA(`insert into public.day_records (employee_id, work_date, kind, status, claimed_by)
           values ('${W.samuel}', '${SECOND_WORKER_DAY}', 'weekend', 'claimed', auth.uid())`, { commit: true })

await asA(`update public.day_records set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
            where employee_id = '${W.james}' and work_date = '${TODAY}' and status = 'claimed'`, { commit: true })
const ot = (await asA(`select kind, rate, multiplier, amount, status from public.day_records
                         where employee_id = '${W.james}' and work_date = '${OT_DAY}'`)).rows[0]
ok('overtime is one row at 2x, valued by the trigger',
  ot.kind === 'overtime' && Number(ot.multiplier) === 2
    && Number(ot.amount) === expectRate(OT_DAY) * 2,
  `${ot.kind} · ₦${ot.amount} = ₦${ot.rate} x ${ot.multiplier}`)
const late = (await asA(`select rate, amount from public.day_records
                          where employee_id = '${W.james}' and work_date = '${NEW_RATE_DAY}'`)).rows[0]
ok('a day after the rate change is valued at the NEW rate',
  Number(late.rate) === RATE_NEW && Number(late.amount) === RATE_NEW,
  `₦${late.amount} at ₦${late.rate}/day on the ${NEW_RATE_DAY.slice(-2)}th`)

// A correction: the worker asks, the employer answers, the ledger changes.
step('4b', 'A correction is asked for, and answered')
const req = (await as(USER.james, `
  insert into public.correction_requests (employee_id, work_date, request_kind, want_kind, message)
  values ('${W.james}', '${day(6)}', 'missing', null, 'I worked this day but it is not here.')
  returning id`, { commit: true })).rows[0]
const openRequests = (await asA(
  `select count(*)::int n from public.correction_requests
    where employee_id = '${W.james}' and status = 'open'`)).rows[0].n
ok('a worker can ask about a day that is missing from their month',
  !!req?.id && openRequests === 1, `${openRequests} open request(s)`)
const selfApprove = await attempt(USER.james,
  `select * from public.resolve_correction('${req.id}', true, 'sure')`)
ok('but cannot answer their own request — that would be a forged write path',
  !!selfApprove, selfApprove?.split('\n')[0])
const approved = (await asA(
  `select * from public.resolve_correction('${req.id}', true, 'Agreed, my mistake.')`, { commit: true })).rows[0]
const added = (await asA(
  `select kind, rate, amount, status, source from public.day_records
    where employee_id = '${W.james}' and work_date = '${day(6)}'`)).rows[0]
ok('the employer approving it writes the day into the ledger',
  !!approved && !!added && Number(added.amount) === expectRate(day(6)),
  added ? `${added.kind} · ₦${added.amount} · ${added.source}` : 'no day written')
ok('recorded as a correction, so the worker can see where it came from',
  added?.source === 'correction')

// ── 5. The month ────────────────────────────────────────────────────────────
step(5, 'The month, computed by every layer at once')
monthRows = await readMonth()
const jamesRows = monthRows.filter(r => r.employee_id === W.james)

const sqlMonth = (await asA(`
  select count(*)::int days,
         count(*) filter (where kind <> 'leave')::int worked,
         coalesce(sum(multiplier) filter (where kind <> 'leave'), 0)::numeric equiv,
         coalesce(sum(amount), 0)::numeric total
    from public.day_records
   where employee_id = '${W.james}'
     and work_date between '${M_FROM}' and '${M_TO}'`)).rows[0]

const S = summarise(jamesRows, employeesOfA.filter(e => e.id === W.james))
const MF = monthFigures(jamesRows, employeesOfA.filter(e => e.id === W.james))
const LT = ledgerTotals(jamesRows)
const wmt = workerMonthTotals(jamesRows)
const slip = payslipModel(jamesRows.map(ledgerToRecord))

ok('SQL, the Summary screen, the month header and the worker\'s own view agree on days',
  sqlMonth.worked === S.rows[0].worked && sqlMonth.worked === MF.actualDays
    && sqlMonth.worked === wmt.worked,
  `sql ${sqlMonth.worked} · summarise ${S.rows[0].worked} · monthFigures ${MF.actualDays} · worker ${wmt.worked}`)
ok('...and on equivalents, which is what the money is actually paid on',
  Number(sqlMonth.equiv) === Number(S.rows[0].equivalents)
    && Number(sqlMonth.equiv) === Number(MF.equivalents)
    && Number(sqlMonth.equiv) === Number(wmt.equivalents),
  `${sqlMonth.equiv} everywhere`)
/* Money is compared with money, and equivalents with equivalents. Putting a
   count in the same table would make the "all identical" assertion mean
   nothing — the first draft did exactly that and reported ₦120,000 vs 6. */
reconcile({
  'SQL sum(amount)': fmtMoney(sqlMonth.total),
  'summarise() total': fmtMoney(S.total),
  'monthFigures()': fmtMoney(MF.total),
  'ledgerTotals()': fmtMoney(LT.amount),
  'workerMonthTotals()': fmtMoney(wmt.total),
  'payslipModel()': fmtMoney(slip.total),
}, { label: "one worker's month, in money" })
reconcile({
  'SQL sum(multiplier)': fmtEquiv(sqlMonth.equiv),
  'summarise()': fmtEquiv(S.rows[0].equivalents),
  'monthFigures()': fmtEquiv(MF.equivalents),
  'workerMonthTotals()': fmtEquiv(wmt.equivalents),
  'payslipModel()': fmtEquiv(slip.totalEquiv),
}, { label: "one worker's month, in paid-day equivalents" })

const ratesInPeriod = new Set(jamesRows.filter(r => r.kind !== 'leave').map(r => Number(r.rate)))
ok('the period provably contains two rates, so nothing may quietly average them',
  ratesInPeriod.size === 2, [...ratesInPeriod].map(r => `₦${r}`).join(' and '))
ok('the payslip knows the rate changed mid-month and says so rather than averaging it',
  slip.singleRate === null && slip.reconciles === false,
  `singleRate ${slip.singleRate}, reconciles ${slip.reconciles}`)
ok('so its calculation lines print per group instead of one simple equation',
  slip.groups.filter(g => g.actual > 0).length >= 2,
  slip.groups.filter(g => g.actual > 0).map(g => `${g.label} ${g.actual}d`).join(', '))

// The whole roster, the way the Summary screen and the CSV read it.
const allMonth = (await asA(`
  select count(*)::int days, coalesce(sum(d.amount),0)::numeric total,
         count(*) filter (where d.status = 'claimed')::int claimed
    from public.day_records d join public.employees e on e.id = d.employee_id
   where e.employer_id = auth.uid() and d.work_date between '${M_FROM}' and '${M_TO}'`)).rows[0]
const sumAll = summarise(monthRows, employeesOfA)
ok('the whole roster reconciles too, including the unassigned worker',
  Number(allMonth.total) === sumAll.total && sumAll.staffCount === 3,
  `${fmtMoney(allMonth.total)} across ${sumAll.staffCount} people`)
ok('and the unassigned worker is counted, not dropped',
  sumAll.rows.some(r => r.employee.full_name === 'Samuel Etim'),
  `${allMonth.claimed} day(s) still awaiting confirmation`)

// ── 6. The year ─────────────────────────────────────────────────────────────
step(6, 'The year, which must reconcile with the months and never be x12')
/* A closed month earlier in the year, so the year has more than one month in it
   and the rate in force there is the OLD one. */
const EARLIER = MONTH === 0 ? 1 : 0
const earlierDay = `${YEAR}-${String(EARLIER + 1).padStart(2, '0')}-05`
await asA(`insert into public.day_records (employee_id, work_date, kind, status, claimed_by)
           values ('${W.james}', '${earlierDay}', 'weekend', 'confirmed', auth.uid())`, { commit: true })

const yearRows = (await asA(`
  select d.work_date, d.kind, d.status, d.source, d.rate, d.multiplier, d.amount, d.leave_type
    from public.day_records d
   where d.employee_id = '${W.james}' and d.work_date >= '${YEAR}-01-01'
   order by d.work_date`)).rows
const yearSlip = payslipModel(yearRows.map(ledgerToRecord))
const yearSql = (await asA(`
  select count(*) filter (where kind <> 'leave')::int worked,
         coalesce(sum(multiplier) filter (where kind <> 'leave'), 0)::numeric equiv,
         coalesce(sum(amount), 0)::numeric total
    from public.day_records
   where employee_id = '${W.james}' and work_date >= '${YEAR}-01-01'`)).rows[0]

const monthTotals = []
for (let m = 0; m < 12; m++) {
  const b = monthBounds(YEAR, m)
  const rows = yearRows.filter(r => r.work_date >= b.from && r.work_date <= b.to)
  monthTotals.push(payslipModel(rows.map(ledgerToRecord)))
}
const sumOfMonths = monthTotals.reduce((a, s) => a + s.total, 0)
const equivOfMonths = monthTotals.reduce((a, s) => a + s.totalEquiv, 0)

reconcile({
  'SQL sum over the year': fmtMoney(yearSql.total),
  'year payslipModel()': fmtMoney(yearSlip.total),
  'sum of 12 monthly slips': fmtMoney(sumOfMonths),
}, { label: 'one worker, year to date, in money' })
reconcile({
  'SQL sum(multiplier)': fmtEquiv(yearSql.equiv),
  'year payslipModel()': fmtEquiv(yearSlip.totalEquiv),
  'sum of 12 monthly slips': fmtEquiv(equivOfMonths),
}, { label: 'one worker, year to date, in equivalents' })

ok('the year is the sum of the months — structurally, not by arithmetic luck',
  yearSlip.total === sumOfMonths && yearSlip.totalEquiv === equivOfMonths)
const busiestMonth = Math.max(...monthTotals.map(m => m.total))
ok('and it is NOT any single month multiplied by twelve',
  yearSlip.total !== busiestMonth * 12,
  `${fmtMoney(yearSlip.total)} vs ${fmtMoney(busiestMonth)} x 12 = ${fmtMoney(busiestMonth * 12)}`)
const weekendRec = yearRows.find(r => r.work_date === earlierDay)
ok('the earlier month keeps the rate in force back then, not today\'s',
  Number(weekendRec.rate) === 16000 && Number(weekendRec.amount) === 32000,
  `₦${weekendRec.amount} = ₦${weekendRec.rate} x ${weekendRec.multiplier}`)
ok('so the year is a mix of rates, and the payslip says so',
  yearSlip.singleRate === null, `singleRate ${yearSlip.singleRate}`)

// ── 7. The contractor's total ───────────────────────────────────────────────
step(7, 'The contractor total, and the bill that will come from it')
const contractorsOfA = (await asA(
  `select id, name, status from public.contractors where employer_id = auth.uid() order by name`)).rows
const rollup = contractorRollup(employeesOfA, monthRows, TODAY)
ok('the contractor rollup covers every worker on the roster',
  rollup.rows.length === 3 && rollup.expected === 3,
  rollup.rows.map(r => r.employee.full_name).join(', '))
ok('and it counts who is in today, straight off the same rows',
  rollup.present === 1 && rollup.missing === 2,
  `${rollup.present} present, ${rollup.missing} missing, ₦${rollup.todayAmount} today`)
const jamesRoll = rollup.rows.find(r => r.employee.id === W.james)
ok('and its per-worker figures are the same ones the worker sees',
  jamesRoll.actualDays === S.rows[0].worked && jamesRoll.equivalents === S.rows[0].equivalents,
  `${jamesRoll.actualDays} days · ${jamesRoll.equivalents} equiv · ${fmtMoney(jamesRoll.total)}`)

const rows = billingRows(contractorsOfA, employeesOfA, monthRows, M_FROM, M_TO)
const crew = rows.find(r => r.name === 'Eddimore Crew')
const unassignedRow = rows.find(r => r.isUnassigned)
const sqlCrew = (await asA(`
  select count(*)::int days, coalesce(sum(d.amount),0)::numeric total
    from public.day_records d join public.employees e on e.id = d.employee_id
   where e.contractor_id = '${C1}' and d.work_date between '${M_FROM}' and '${M_TO}'`)).rows[0]
ok('the billing preview for a contractor equals the ledger for that contractor',
  crew.total === Number(sqlCrew.total) && crew.days === sqlCrew.days,
  `${fmtMoney(crew.total)} over ${crew.days} day(s), ${crew.workerCount} worker(s)`)
ok('and the unassigned worker is a bill of their own',
  unassignedRow.total > 0 && unassignedRow.workerCount === 1,
  `${unassignedRow.name}: ${fmtMoney(unassignedRow.total)}`)

// ── 8. The invoice ──────────────────────────────────────────────────────────
step(8, 'The invoice, which must be the ledger written down')
const inv = (await asA(
  `select * from public.issue_invoice('${C1}', '${M_FROM}', '${M_TO}', 'Phase 8')`, { commit: true })).rows[0]
const invLines = (await asA(
  `select * from public.invoice_lines where invoice_id = '${inv.id}' order by employee_name`)).rows

reconcile({
  'SQL sum(amount)': fmtMoney(sqlCrew.total),
  'billingRows() preview': fmtMoney(crew.total),
  'issue_invoice() total': fmtMoney(inv.total),
  'sum(invoice_lines)': fmtMoney(invLines.reduce((a, l) => a + Number(l.amount), 0)),
  'invoiceModel() total': fmtMoney(invoiceModel(inv, invLines).total),
}, { label: 'the contractor invoice' })

ok('the invoice covers every worker the ledger has days for',
  invLines.length === 2 && invLines.every(l => l.days > 0),
  invLines.map(l => `${l.employee_name} ${l.days}d`).join(', '))
ok('its actual days and equivalents are the ledger\'s own, not a re-count',
  inv.actual_days === sqlCrew.days && Number(inv.equivalents) === Number(crew.equivalents),
  `${inv.actual_days} days · ${inv.equivalents} equiv`)
ok('the frozen worker name is stored on the document',
  invLines.every(l => l.employee_name && l.job_title),
  invLines.map(l => l.employee_name).join(', '))

/* THE TEST THAT WOULD CATCH A SECOND CALCULATION ENGINE. The month has two
   rates in it. Anything that valued the invoice from the current rate would
   produce a different total from the stored ledger — so this comparison is the
   proof that the invoice really is the ledger written down. */
const atCurrentRate = jamesRows.filter(r => r.kind !== 'leave')
  .reduce((a, r) => a + 20000 * Number(r.multiplier), 0)
ok('a re-estimate at today\'s rate would give a different number — and the invoice does not',
  Number(inv.total) !== atCurrentRate && Number(inv.total) === Number(sqlCrew.total),
  `invoice ${fmtMoney(inv.total)} vs re-estimate ${fmtMoney(atCurrentRate)}`)

const pdf = invoiceModel(inv, invLines)
ok('the PDF is handed the stored figures, worker by worker',
  pdf.rows.every((r, i) => r.amountText === fmtMoney(invLines[i].amount)),
  pdf.rows.map(r => `${r.name} ${r.amountText}`).join(' · '))
ok('a day under dispute would be stated, not hidden',
  typeof pdf.statusNote === 'string' && pdf.statusNote.length > 0, pdf.statusNote)

// Void and reissue must not move a naira.
const voided = (await asA(`select * from public.void_invoice('${inv.id}', 'Phase 8 reissue')`, { commit: true })).rows[0]
const reissued = (await asA(
  `select * from public.issue_invoice('${C1}', '${M_FROM}', '${M_TO}')`, { commit: true })).rows[0]
ok('voiding keeps the document and reissuing gives a new number',
  voided.status === 'void' && reissued.number !== inv.number && reissued.total === inv.total,
  `${inv.number} void -> ${reissued.number} issued`)
const ledgerAfter = (await asA(`
  select coalesce(sum(d.amount),0)::numeric total
    from public.day_records d join public.employees e on e.id = d.employee_id
   where e.contractor_id = '${C1}' and d.work_date between '${M_FROM}' and '${M_TO}'`)).rows[0].total
ok('and the ledger is untouched by any of it', Number(ledgerAfter) === Number(sqlCrew.total),
  fmtMoney(ledgerAfter))

// ── 9. Who can see what ─────────────────────────────────────────────────────
step(9, 'The same chain seen by somebody who should not see it')
const otherEmployer = (await as(EMP.B, `select count(*)::int n from public.day_records`)).rows[0].n
ok('the other employer sees their own ledger and nothing else', otherEmployer === 0,
  `${otherEmployer} row(s) visible to the company next door`)
const graceOwn = (await as(USER.grace, `select count(*)::int n from public.day_records`)).rows[0].n
const graceInvoices = (await as(USER.grace, `select count(*)::int n from public.invoices`)).rows[0].n
ok('a worker sees no days but their own, and no invoices at all',
  graceOwn === 0 && graceInvoices === 0, `${graceOwn} day(s), ${graceInvoices} invoice(s)`)
const jamesOwnRows = (await as(USER.james, `select count(*)::int n from public.day_records`)).rows[0].n
ok('the linked worker sees every day of their own, and only their own',
  jamesOwnRows === yearRows.length, `${jamesOwnRows} row(s), matching the ${yearRows.length} in the ledger`)
ok('...and not a colleague\'s day either',
  (await as(USER.james,
    `select count(*)::int n from public.day_records where employee_id = '${W.timothy}'`)).rows[0].n === 0)
const jamesCannotWrite = await attempt(USER.james,
  `insert into public.day_records (employee_id, work_date, kind) values ('${W.james}', '${day(28)}', 'work')`)
ok('and cannot invent a day for themselves — the session gate is still there',
  !!jamesCannotWrite && /session|code|policy/i.test(jamesCannotWrite),
  jamesCannotWrite?.split('\n')[0])

/* THE ATTEMPT THAT MATTERS IS NOT WHETHER IT ERRORED. RLS makes an UPDATE
   against a row you cannot see affect zero rows WITHOUT raising anything, so
   "no error" would have looked like a hole. What matters is whether the money
   moved: the day is re-read as the employer, and it must be untouched. */
await attempt(USER.james,
  `update public.day_records set kind = 'overtime' where employee_id = '${W.james}' and work_date = '${WORK_DAY}'`)
const afterAttack = (await asA(`select kind, multiplier, amount, status from public.day_records
                                 where employee_id = '${W.james}' and work_date = '${WORK_DAY}'`)).rows[0]
ok('nor turn a plain day into double-pay overtime — the day is unchanged afterwards',
  afterAttack?.kind === 'work' && Number(afterAttack?.multiplier) === 1
    && Number(afterAttack?.amount) === expectRate(WORK_DAY) && afterAttack?.status === 'confirmed',
  `${afterAttack?.kind} · ${afterAttack?.multiplier}x · ${fmtMoney(afterAttack?.amount)} · ${afterAttack?.status}`)
await attempt(USER.james,
  `delete from public.day_records where employee_id = '${W.james}' and work_date = '${WORK_DAY}'`)
const afterDelete = (await asA(
  `select count(*)::int n from public.day_records
    where employee_id = '${W.james}' and work_date = '${WORK_DAY}'`)).rows[0].n
ok('nor delete a confirmed day that has been paid for', afterDelete === 1, `${afterDelete} row(s) left`)

// ── 10. The site kiosk, and the eight scenarios of §23 ──────────────────────
step(10, 'The site kiosk: the same day, recorded from a machine at the gate')

/* A kiosk is an ordinary account, and that is the entire security model: it can
   be revoked, it can be audited, and it holds no secret worth stealing. It is
   signed in once by whoever sets the machine up. After that the workers use it
   with no account of their own at all — which is the whole point, because the
   people who most need it are the ones who have no smartphone. */
const KIOSK = '55555555-5555-4555-8555-555555555555'
const NEWBIE = '66666666-6666-4666-8666-666666666666'
const W_NEW = 'cccccccc-0000-0000-0000-000000000005'
const C3 = 'dddddddd-0000-0000-0000-000000000003'
const LINK = 'KIOSK9QA'

/* The sentences, asserted to the character. Every one of them is what a worker
   reads at the gate, so they are a contract, not a detail — and each is written
   to name nobody: not the worker's own code, not the contractor's code, not the
   rate, not another crew. */
const KIOSK_BAD_CODE = "That site code is not valid now. Ask for today's code."
const KIOSK_BAD_CONTRACTOR = 'You are not listed under that contractor. Check with your supervisor.'
const KIOSK_BAD_PIN = 'That PIN is not correct.'
const KIOSK_NO_PIN = 'No PIN has been set for you yet. Ask your employer for one.'

/* One trip through the kiosk, in the kiosk's own transaction, as the machine's
   account — because the device is half of the security model and a check that
   ran as the employer would not be testing the thing that ships. */
const kioskTry = async (employeeId, contractorId, pin, code, { commit = false } = {}) => {
  await db.exec('begin')
  await db.exec(`set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${KIOSK}","role":"authenticated"}', true);`)
  try {
    const rows = (await db.query(
      `select * from public.kiosk_check_in('${employeeId}', ${contractorId ? `'${contractorId}'` : 'null'},
                                           '${pin}', '${code}')`)).rows
    if (commit) await db.exec('commit')
    return rows[0] || { ok: false, message: 'the function returned no row at all', note: true }
  } catch (e) {
    try { await db.exec('rollback') } catch { /* already closed */ }
    return { ok: false, message: e.message.split('\n')[0], raised: e.message.split('\n')[0] }
  }
}

const dayOf = async (employeeId, dateKey = TODAY) => (await asA(
  `select * from public.day_records where employee_id = '${employeeId}' and work_date = '${dateKey}'`)).rows[0]
const dayCount = async (employeeId, dateKey = TODAY) => (await asA(
  `select count(*)::int n from public.day_records where employee_id = '${employeeId}' and work_date = '${dateKey}'`)).rows[0].n
const pinFor = async (employeeId) => (await asA(
  `select public.set_attendance_pin('${employeeId}') p`, { commit: true })).rows[0].p

await db.exec(`insert into auth.users (id, email) values
  ('${KIOSK}','kiosk@site.test'), ('${NEWBIE}','blessing@worker.test');`)

/* 1. The employer creates the machine, and reads its code out once. */
const machine = (await asA(`insert into public.attendance_devices (employer_id, label, link_code)
  values (auth.uid(), 'Gate kiosk', '${LINK}') returning id, status`, { commit: true })).rows[0]
ok('the employer creates a machine, which starts waiting to be linked',
  machine?.status === 'pending', machine?.id)

const claimedDevice = (await as(KIOSK,
  `select * from public.claim_attendance_device('${LINK}')`, { commit: true })).rows[0]
ok('the machine links itself with that code, once, and is told which site it belongs to',
  claimedDevice?.business_name === 'Eddimore' && !!claimedDevice?.device_id,
  `${claimedDevice?.label} at ${claimedDevice?.business_name}`)

const reuseCode = await attempt(KIOSK, `select * from public.claim_attendance_device('${LINK}')`)
ok('the link code is spent the moment it is used, so a bystander who read it cannot join later',
  !!reuseCode && /not recognised/i.test(reuseCode), said(reuseCode))

await asA(`insert into public.attendance_devices (employer_id, label, link_code)
  values (auth.uid(), 'Second kiosk', 'OTHER24RD')`, { commit: true })
const secondClaim = await attempt(KIOSK, `select * from public.claim_attendance_device('OTHER24RD')`)
ok('and one account cannot be two machines, even with a code the employer really issued',
  !!secondClaim && /already linked/i.test(secondClaim), said(secondClaim))

/* 2. What the machine can read. This is §20 measured rather than promised: the
      roster is money-free by SHAPE, so there is nothing to leak even if the
      machine is stolen and its console opened. */
const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v)
const rosterRow = (await as(KIOSK, `select * from public.kiosk_roster()`)).rows[0]
const kioskPeople = parsed(rosterRow.people)
const kioskContractors = parsed(rosterRow.contractors)
ok('the machine can name the site and list the crew it may record for',
  rosterRow.business_name === 'Eddimore' && kioskPeople.map(p => p.name).sort().join(', ') ===
    'James Okon, Samuel Etim, Timothy Bassey',
  `${kioskPeople.map(p => p.name).join(', ')}`)
ok('...and not one name, contractor or rate from the company next door',
  !JSON.stringify(rosterRow).includes('Other Crew') &&
  !JSON.stringify(rosterRow).includes('Grace Effiong') &&
  kioskContractors.map(c => c.name).join(', ') === 'Eddimore Crew',
  kioskContractors.map(c => c.name).join(', '))
ok('the roster carries no rate, no amount and no money at all (§20)',
  !/rate|amount|amount|₦|salary|payslip/i.test(JSON.stringify(rosterRow)),
  Object.keys(kioskPeople[0] || {}).join(', '))
ok('it flags which workers can actually use the kiosk, so nobody is sent round in circles',
  kioskPeople.every(p => 'has_pin' in p) && kioskPeople.some(p => p.has_pin === false),
  `${kioskPeople.filter(p => !p.has_pin).length} of ${kioskPeople.length} have no PIN yet`)

/* ── A. The invite code, used once, at registration, and never again ───────── */
await asA(`
  insert into public.employees (id, employer_id, full_name, job_title, contractor_id, invite_code, status)
  values ('${W_NEW}', auth.uid(), 'Blessing Eze', 'Painter', '${C1}', 'JOIN1234', 'active')`, { commit: true })
await asA(`insert into public.employee_rate_periods
  (employee_id, effective_from, daily_rate, weekend_multiplier, holiday_multiplier)
  values ('${W_NEW}', '${YEAR}-01-01', 12000, 2, 2)`, { commit: true })

const joined = (await as(NEWBIE, `select * from public.redeem_invite(' join 1234 ')`, { commit: true })).rows[0]
ok('A — a new account joins the workforce with the employer’s invite code, typed with a stray space and still accepted',
  joined?.full_name === 'Blessing Eze' && joined?.business_name === 'Eddimore',
  `${joined?.full_name} at ${joined?.business_name}`)

const burned = (await asA(
  `select employee_user_id, invite_code from public.employees where id = '${W_NEW}'`)).rows[0]
ok('...and the code is burned in the same act, so it cannot be passed to anybody else',
  burned.employee_user_id === NEWBIE && burned.invite_code === null,
  `linked=${burned.employee_user_id === NEWBIE} code=${burned.invite_code}`)

const reusedInvite = await attempt(NEWBIE, `select * from public.redeem_invite('JOIN1234')`)
ok('...and redeeming it twice is impossible, because the roster no longer carries it',
  !!reusedInvite && /not recognised/i.test(reusedInvite), said(reusedInvite))

/* The structural half of §2: the daily route has ONE parameter. There is no
   argument an invite code could even be passed in, which is a stronger promise
   than a screen that does not ask for one. */
const codeArgs = (await asA(`select pg_get_function_arguments(p.oid) args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'check_in_with_code'`)).rows[0].args.trim()
ok('A — the daily route takes the site code and nothing else, so no invite can be asked for again',
  codeArgs === 'p_code text', codeArgs)

/* ── C. A registered worker, no network, at the kiosk ─────────────────────── */
const newPin = await pinFor(W_NEW)
ok('the employer issues a personal attendance PIN, four digits, shown once at issue',
  /^[0-9]{4}$/.test(newPin), newPin)
const storedPin = (await asA(
  `select pin_hash, pin_salt from public.employees where id = '${W_NEW}'`)).rows[0]
ok('...and it is stored salted and hashed, never in the clear — it is a signature, not a password',
  !!storedPin.pin_hash && storedPin.pin_hash !== newPin && Number(storedPin.pin_salt?.length ?? 0) > 0,
  `hash ${String(storedPin.pin_hash).slice(0, 12)}…`)

const viaKiosk = await kioskTry(W_NEW, C1, newPin, CODE, { commit: true })
ok('C — a REGISTERED worker with no network records from the kiosk',
  viaKiosk.ok === true && viaKiosk.method === 'kiosk' && viaKiosk.full_name === 'Blessing Eze',
  `${viaKiosk.full_name} · ${viaKiosk.method} · ${viaKiosk.kind} · ${viaKiosk.contractor_name}`)

const newDay = await dayOf(W_NEW)
ok('...and his day is an ordinary check-in: claimed, from a check-in, at the stored rate, at 1×',
  newDay.source === 'check_in' && newDay.status === 'claimed' && newDay.kind === 'work' &&
  Number(newDay.multiplier) === 1 && Number(newDay.amount) === 12000,
  `${newDay.source} · ${newDay.status} · ${newDay.kind} · ${fmtMoney(newDay.amount)}`)
ok('...carrying attendance_method = kiosk for the audit view, and that is the only difference',
  newDay.attendance_method === 'kiosk')

/* ── F. The duplicate rule, in both directions (§15) ──────────────────────── */
const phoneAfterKiosk = (await as(NEWBIE,
  `select * from public.check_in_with_code('${CODE}')`, { commit: true })).rows[0]
ok('F — the phone AFTER the kiosk: same person, same day, accepted as already recorded',
  phoneAfterKiosk.ok === true && phoneAfterKiosk.already === true,
  `ok=${phoneAfterKiosk.ok} already=${phoneAfterKiosk.already}`)
ok('...and no second row exists for that day, because both routes share one database (§14)',
  (await dayCount(W_NEW)) === 1, `${await dayCount(W_NEW)} row(s)`)
ok('...and the row still says kiosk, because the kiosk is what wrote it',
  (await dayOf(W_NEW)).attendance_method === 'kiosk')

const kioskAfterPhone = await kioskTry(W.james, C1, await pinFor(W.james), CODE, { commit: true })
ok('F — the kiosk AFTER the phone: the same day again, refused as already recorded, writing nothing',
  kioskAfterPhone.ok === true && kioskAfterPhone.already === true && (await dayCount(W.james)) === 1,
  `ok=${kioskAfterPhone.ok} already=${kioskAfterPhone.already} · ${await dayCount(W.james)} row(s)`)
ok('...and his row still says mobile, because his phone is what wrote it',
  (await dayOf(W.james)).attendance_method === 'mobile')

/* ── B. A worker with no account at all (§3, §4) ──────────────────────────── */
const timBefore = (await asA(
  `select employee_user_id, status from public.employees where id = '${W.timothy}'`)).rows[0]
ok('B — this worker has no DayPay account: no registration, no email, nothing',
  timBefore.employee_user_id === null && timBefore.status === 'active')

const timPin = await pinFor(W.timothy)
const timViaKiosk = await kioskTry(W.timothy, C1, timPin, CODE, { commit: true })
ok('B — and he still records a full day at the gate, on the employer’s machine',
  timViaKiosk.ok === true && timViaKiosk.method === 'kiosk' && timViaKiosk.full_name === 'Timothy Bassey',
  `${timViaKiosk.full_name} · ${timViaKiosk.method}`)
const timDay = await dayOf(W.timothy)
ok('...which is a real day for payroll, not a lesser kind of record',
  timDay.source === 'check_in' && timDay.status === 'claimed' &&
  Number(timDay.amount) === 12000 && Number(timDay.multiplier) === 1,
  `${fmtMoney(timDay.amount)} · ${timDay.attendance_method}`)

/* ── G. The wrong PIN ─────────────────────────────────────────────────────── */
const timFails0 = (await asA(`select pin_fails from public.employees where id = '${W.timothy}'`)).rows[0].pin_fails
const wrongPin = await kioskTry(W.timothy, C1, '0000', CODE, { commit: true })
ok('G — a wrong PIN is refused, and the sentence names nobody and nothing',
  wrongPin.ok === false && wrongPin.message === KIOSK_BAD_PIN, wrongPin.message)
ok('...nothing is written for the guess',
  (await dayCount(W.timothy)) === 1, `${await dayCount(W.timothy)} row(s) for today`)
const timFails1 = (await asA(`select pin_fails from public.employees where id = '${W.timothy}'`)).rows[0].pin_fails
ok('...and the attempt is counted against that worker’s PIN, so five in a row lock it',
  Number(timFails1) === Number(timFails0) + 1, `${timFails0} -> ${timFails1}`)
ok('...and the kiosk’s answer has no amount and no rate field at all, unlike the phone’s',
  !('amount' in wrongPin) && !('rate' in wrongPin), Object.keys(wrongPin).join(', '))

const noPinWorker = await kioskTry(W.samuel, null, '1234', CODE)
ok('a worker the employer has not issued a PIN to is told so plainly, and never “wrong PIN”',
  noPinWorker.ok === false && noPinWorker.message === KIOSK_NO_PIN, noPinWorker.message)

/* ── E. The chosen contractor must be the assigned one (§16) ──────────────── */
const wrongCrew = await kioskTry(W.timothy, C2, timPin, CODE)
ok('E — a different contractor cannot be chosen to get round the rule',
  wrongCrew.ok === false && wrongCrew.message === KIOSK_BAD_CONTRACTOR, wrongCrew.message)
ok('...and the refusal wrote nothing, so picking a name is not a way to check in',
  (await dayCount(W.timothy)) === 1, `${await dayCount(W.timothy)} row(s)`)

/* An unassigned worker is a legitimate case, not a loophole: NULL on both sides
   is a match. It needs a site-wide code, so one is opened — which is also the
   other direction of the same rule, tested next. */
await asA(`insert into public.attendance_sessions (employer_id, contractor_id, work_date, code, expires_at)
  values (auth.uid(), null, '${TODAY}', '8080', now() + interval '8 hours')`, { commit: true })
const samuelPin = await pinFor(W.samuel)
const unassigned = await kioskTry(W.samuel, null, samuelPin, '8080', { commit: true })
ok('E — a worker assigned to nobody checks in under “No contractor”, on a site-wide code',
  unassigned.ok === true && unassigned.method === 'kiosk' && unassigned.contractor_name === null,
  `${unassigned.full_name} · contractor=${unassigned.contractor_name}`)

const assignedAsNobody = await kioskTry(W.timothy, null, timPin, '8080')
ok('E — but a worker who IS assigned cannot choose “No contractor” to slip past it',
  assignedAsNobody.ok === false && assignedAsNobody.message === KIOSK_BAD_CONTRACTOR,
  assignedAsNobody.message)

/* ── D. Codes that are not today’s ────────────────────────────────────────── */
await asA(`insert into public.attendance_sessions (employer_id, contractor_id, work_date, code, expires_at, status)
  values (auth.uid(), '${C1}', current_date - 1, '1111', now() + interval '1 hour', 'closed')`, { commit: true })
const timFailsD = (await asA(`select pin_fails from public.employees where id = '${W.timothy}'`)).rows[0].pin_fails

const madeUpCode = await kioskTry(W.timothy, C1, timPin, '0001')
const yesterdayCode = await kioskTry(W.timothy, C1, timPin, '1111')
const blankCode = await kioskTry(W.timothy, C1, timPin, '')
ok('D — a code that is not today’s is refused',
  madeUpCode.ok === false && madeUpCode.message === KIOSK_BAD_CODE, madeUpCode.message)
ok('D — yesterday’s code, from a session that has been closed, is refused by the SAME sentence',
  yesterdayCode.ok === false && yesterdayCode.message === madeUpCode.message, yesterdayCode.message)
ok('...and so is an empty one, so a slipped keypad is not a way to learn anything',
  blankCode.ok === false && blankCode.message === madeUpCode.message)
ok('...and none of the three wrote a day or touched the worker’s PIN',
  (await dayCount(W.timothy)) === 1 &&
  Number((await asA(`select pin_fails from public.employees where id = '${W.timothy}'`)).rows[0].pin_fails) === Number(timFailsD),
  `still ${await dayCount(W.timothy)} row(s), pin_fails ${timFailsD}`)

/* The mobile route refuses a bad code with the older sentence, unchanged by any
   of this: one wording for the phone, one for the gate, and neither names a
   person. */
const phoneBadCode = (await as(NEWBIE, `select * from public.check_in_with_code('0001')`)).rows[0]
ok('the phone still says “Code not correct, visit the site.” — 017’s wording survives 019',
  phoneBadCode.ok === false && phoneBadCode.message === REFUSAL, phoneBadCode.message)

/* ── H. A contractor change applies from now on, and rewrites nothing ─────── */
await asA(`insert into public.contractors (id, employer_id, name, status)
  values ('${C3}', auth.uid(), 'Eddimore Crew II', 'active')`, { commit: true })
const beforeChange = await dayOf(W.timothy)

await asA(`update public.employees set contractor_id = '${C3}' where id = '${W.timothy}'`, { commit: true })
const movedAway = await kioskTry(W.timothy, C1, timPin, CODE)
ok('H — once the employer moves him, the OLD contractor no longer validates',
  movedAway.ok === false && movedAway.message === KIOSK_BAD_CONTRACTOR, movedAway.message)

await asA(`insert into public.attendance_sessions (employer_id, contractor_id, work_date, code, expires_at)
  values (auth.uid(), '${C3}', '${TODAY}', '5151', now() + interval '8 hours')`, { commit: true })
ok('H — and the old crew’s code no longer carries him either, because a code belongs to a crew',
  (await kioskTry(W.timothy, C3, timPin, CODE)).message === KIOSK_BAD_CODE)
const movedTo = await kioskTry(W.timothy, C3, timPin, '5151')
ok('H — and the NEW one does, from that moment on',
  movedTo.ok === true && movedTo.already === true && movedTo.contractor_name === 'Eddimore Crew II',
  `ok=${movedTo.ok} already=${movedTo.already} · ${movedTo.contractor_name}`)

const afterChange = await dayOf(W.timothy)
ok('H — the day already recorded is byte-identical after the move: nothing was rewritten',
  JSON.stringify(afterChange) === JSON.stringify(beforeChange),
  `${fmtMoney(afterChange.amount)} · ${afterChange.kind} · ${afterChange.attendance_method}`)
ok('H — and no second day appeared for him',
  (await dayCount(W.timothy)) === 1, `${await dayCount(W.timothy)} row(s)`)

/* A day is attributed to the contractor a worker is on NOW, which is the
   existing reporting behaviour this phase was told not to change. What is
   frozen is the invoice. */
const invAfterKiosk = (await asA(
  `select number, total from public.invoices where id = '${reissued.id}'`)).rows[0]
ok('the bill issued before all of this has not moved: an invoice is a document, not a view',
  Number(invAfterKiosk.total) === Number(reissued.total),
  `${invAfterKiosk.number} · ${fmtMoney(invAfterKiosk.total)}`)

/* ── The audit column, and what it must never do (§14, §18, §19) ──────────── */
const methods = (await asA(`
  select d.source, d.attendance_method m, count(*)::int n
    from public.day_records d join public.employees e on e.id = d.employee_id
   where e.employer_id = auth.uid()
   group by 1, 2 order by 1, 2`)).rows
const seen = Object.fromEntries(methods.map(r => [`${r.source}/${r.m ?? 'null'}`, r.n]))
ok('the audit column tells the two routes apart',
  seen['check_in/mobile'] >= 1 && seen['check_in/kiosk'] >= 3,
  Object.entries(seen).map(([k, v]) => `${k}:${v}`).join(' '))
ok('and a day the employer marked carries NULL — “no device recorded this”, which is the truth',
  seen['employer/null'] >= 1 &&
  methods.filter(r => r.source === 'employer').every(r => r.m === null) &&
  methods.filter(r => r.source === 'check_in').every(r => r.m !== null),
  methods.filter(r => r.source === 'employer').map(r => `${r.m}:${r.n}`).join(' '))

const byMethod = (await asA(`
  select d.attendance_method m, d.kind, d.multiplier, d.amount, d.rate
    from public.day_records d join public.employees e on e.id = d.employee_id
   where e.employer_id = auth.uid() and d.work_date = '${TODAY}' and d.source = 'check_in'
   order by d.attendance_method`)).rows
ok('kiosk and phone produce the same shape of record: same kind, same multiplier, same rate rule (§13, §19)',
  byMethod.length >= 3 &&
  byMethod.every(r => Number(r.amount) === Number(r.rate) * Number(r.multiplier)) &&
  new Set(byMethod.map(r => `${r.kind}:${r.multiplier}`)).size === 1,
  byMethod.map(r => `${r.m}:${r.kind} ${r.multiplier}x ${fmtMoney(r.amount)}`).join(' | '))

/* Revocation, the one control the employer has over a machine. Everything the
   machine recorded survives it; every door it had closes at once. */
await asA(`update public.attendance_devices set status = 'revoked'
            where id = '${claimedDevice.device_id}'`, { commit: true })
const afterRevoke = await kioskTry(W_NEW, C1, newPin, CODE)
ok('a revoked machine stops dead: the next attempt is refused with the not-linked sentence',
  afterRevoke.ok === false && afterRevoke.raised === undefined &&
  /not linked|signed out/i.test(afterRevoke.message), afterRevoke.message)
const revokedRows = await dayCount(W_NEW)
ok('...and every day it recorded is still there, because revoking a machine is not deleting work',
  revokedRows === 1, `${revokedRows} row(s)`)

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(78)}`)
console.log(`DAYPAY END-TO-END: ${checks - bad}/${checks} checks passed`)
console.log(bad === 0
  ? 'session → check-in → dashboard → worker → month → year → contractor → invoice → KIOSK (§23 A–H): EVERY FIGURE RECONCILES'
  : `${bad} FAILURE(S) — the chain does not reconcile`)
process.exit(bad === 0 ? 0 : 1)
