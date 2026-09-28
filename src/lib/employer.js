/* DayPay Employer Version — employer data layer.
 *
 * The single place the app talks to the multi-employee schema. UI components
 * import from here and never call Supabase directly, so the shape of the data
 * has exactly one definition.
 *
 * Two rules this layer must not break — the database enforces them, but
 * breaking them here just produces confusing errors instead of correct ones:
 *
 *   1. NEVER send `rate`, `multiplier` or `amount`. The server computes them
 *      from the rate period in force on the work date. Sending them is at best
 *      ignored and at worst misleading.
 *
 *   2. A rate period must exist covering any date before a day is logged. The
 *      money trigger raises "No rate period covers <date>" otherwise, which is
 *      why addRatePeriod exists separately and is called first.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { supabase } from './supabase'
import {
  formatNaira, initials, monthBounds, todayKey, rateOn, multiplierFor,
  makeInviteCode, summarise, parseDateKey, isWeekendKey, shiftDateKey,
  suggestedKind, prettyDateKey, shortDateKey, KIND_LABELS,
  buildMonthCsv, monthLabelFor, resolveRoles, PERSONAL, BUSINESS, isMissingColumn,
  dayBoard, unmetRates, monthFigures,
  groupByContractor, contractorRollup, isMissingTable,
  endOfLocalDay, sessionState, sessionIsLive, isValidCodeShape,
  timeLeftLabel, attendancePrompt, checkInError,
} from './employerLogic'

/* The pure helpers live in employerLogic.js — no imports there, so they can be
   tested with `node --test` and zero dependencies. Re-exported so callers have
   a single entry point and never need to know which file holds what. */
export {
  formatNaira, initials, monthBounds, todayKey, rateOn, multiplierFor,
  makeInviteCode, summarise, parseDateKey, isWeekendKey, shiftDateKey,
  suggestedKind, prettyDateKey, shortDateKey, KIND_LABELS,
  buildMonthCsv, monthLabelFor, resolveRoles, PERSONAL, BUSINESS, isMissingColumn,
  dayBoard, unmetRates, monthFigures,
  groupByContractor, contractorRollup, isMissingTable,
  endOfLocalDay, sessionState, sessionIsLive, isValidCodeShape,
  timeLeftLabel, attendancePrompt, checkInError,
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class EmployerError extends Error {
  constructor(message, { code, hint, cause } = {}) {
    super(message)
    this.name = 'EmployerError'
    this.code = code
    this.hint = hint
    this.cause = cause
  }
}

/* Turns a Postgres/PostgREST error into something a person can act on.
   The raw messages are accurate but assume you know the schema. */
function describe(error) {
  if (!error) return null
  const code = error.code
  const msg = error.message || String(error)

  if (code === '23503') return { message: 'That employee no longer exists.', hint: 'Refresh the roster.' }
  if (code === '23505') return { message: 'This employee already has a rate starting on that date.', hint: 'Edit the existing one instead.' }
  if (code === '23514') {
    if (/No rate period covers/.test(msg)) {
      return {
        message: msg,
        hint: 'Set a pay rate for this employee that starts on or before the day you are logging.',
      }
    }
    if (/amount is final/.test(msg)) {
      return { message: 'This day is already confirmed.', hint: 'Reopen it before changing the amount.' }
    }
    return { message: msg }
  }

  /* 42501 is insufficient_privilege. There are two very different causes and
     the raw message is the only way to tell them apart:

       "permission denied for table X"  -> the GRANT is missing. RLS and GRANTs
                                           are separate layers: a policy says
                                           which ROWS, a grant says whether the
                                           table may be touched at all. This is
                                           a setup problem, not a user problem,
                                           and telling someone to "sign in as
                                           the employer" would send them
                                           chasing the wrong thing.

       "new row violates row-level security policy" -> the policy doing its job.
                                           Genuinely a permission matter. */
  if (code === '42501') {
    if (/permission denied for table/i.test(msg)) {
      return {
        message: 'Setup problem: the database has not granted access to these tables.',
        hint: 'Run the pending migration (supabase/migrations, in order). This is not something you did wrong.',
      }
    }
    return { message: 'You do not have permission to do that.', hint: 'Check this record belongs to you.' }
  }

  /* 42P01 is undefined_table — usually a migration that has not been run. It
     was previously reported as a permissions problem, which sent people
     looking in the wrong place. */
  if (code === '42P01') {
    const table = /relation "([^"]+)"/.exec(msg)?.[1] || 'a table'
    return {
      message: `Setup problem: ${table} does not exist yet.`,
      hint: 'Run the migrations in supabase/migrations, in order, in the Supabase SQL Editor.',
    }
  }

  if (/insufficient_privilege|Only the employer/.test(msg)) {
    return { message: 'Only the employer can do that.' }
  }

  return { message: msg }
}

async function run(query, what) {
  const { data, error } = await query
  if (error) {
    const d = describe(error)
    throw new EmployerError(d.message || `Could not ${what}`, { code: error.code, hint: d.hint, cause: error })
  }
  return data
}

function client() {
  if (!supabase) {
    throw new EmployerError('Cloud is not configured on this device.', {
      hint: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.',
    })
  }
  return supabase
}

async function currentUserId() {
  const { data } = await client().auth.getUser()
  const id = data?.user?.id
  if (!id) throw new EmployerError('You need to be signed in.', { hint: 'Sign in, then try again.' })
  return id
}

// ── Employer record ─────────────────────────────────────────────────────────

/* Every employer needs one row in `employers`. Created on first use, so the
   UI never has to care whether this is a brand-new account.

   Created as kind 'business' — reaching this function means a workforce action
   was taken. A personal workspace is created by a different path and is
   deliberately never granted business powers. */
/* Reads the employer row, tolerating a database that has not had migration
   006 applied yet.

   The `kind` column arrives with 006. Between shipping this code and running
   that SQL there is a window where asking for `kind` by name fails the whole
   query — which would take out role detection AND roster creation, not just
   the new flag. So the lookup degrades to the pre-006 query instead.

   Treating a pre-006 row as 'business' is not a guess: before 006 the only way
   to hold an employers row was to open the Staff tab and act, which is exactly
   the rule migration 006's backfill applies. */
async function selectEmployer(uid) {
  const full = await run(
    client().from('employers').select('user_id, business_name, kind').eq('user_id', uid).maybeSingle(),
    'load your business details',
  )
  if (full || !kindMissing) return full
  const bare = await run(
    client().from('employers').select('user_id, business_name').eq('user_id', uid).maybeSingle(),
    'load your business details',
  )
  return bare ? { ...bare, kind: BUSINESS } : bare
}

/* Set when a lookup proves the column is absent, so the app stops asking for
   it for the rest of the session instead of paying a failed round trip every
   time. Cleared on the next successful role read. */
let kindMissing = false

export async function ensureEmployer(businessName = null) {
  const uid = await currentUserId()
  const existing = await selectEmployer(uid)
  if (existing) return existing

  const attempt = () => client().from('employers')
    .insert({ user_id: uid, business_name: businessName, kind: BUSINESS })
    .select('user_id, business_name, kind')
    .single()

  let res = await attempt()
  if (res.error && isMissingColumn(res.error, 'kind')) {
    kindMissing = true
    res = await client().from('employers')
      .insert({ user_id: uid, business_name: businessName })
      .select('user_id, business_name')
      .single()
    if (res.data) res = { ...res, data: { ...res.data, kind: BUSINESS } }
  }
  if (res.error) throw new EmployerError(describe(res.error).message, { code: res.error.code, cause: res.error })
  return res.data
}

export async function updateBusinessName(businessName) {
  const uid = await currentUserId()
  return run(
    client().from('employers').update({ business_name: businessName }).eq('user_id', uid)
      .select('user_id, business_name').single(),
    'update your business name',
  )
}

// ── Roster ──────────────────────────────────────────────────────────────────

const EMPLOYEE_COLS_BASE = 'id, full_name, job_title, email, employee_user_id, invite_code, status, created_at'

/* `contractor_id` arrives with migration 007, and the code that reads it can
   ship before the SQL is run. If asking for it by name failed the whole query,
   the roster would disappear — not just the new grouping. So the column list
   adapts, and the flag means we only pay one failed round trip per session. */
let contractorColumnMissing = false

function employeeCols() {
  return contractorColumnMissing ? EMPLOYEE_COLS_BASE : `${EMPLOYEE_COLS_BASE}, contractor_id`
}

/* Retries an employee query without `contractor_id` if the column is absent. */
async function withEmployeeCols(build) {
  let res = await build(employeeCols())
  if (isMissingColumn(res.error, 'contractor_id')) {
    contractorColumnMissing = true
    res = await build(EMPLOYEE_COLS_BASE)
  }
  return res
}

export async function listEmployees({ includeArchived = false } = {}) {
  const res = await withEmployeeCols(cols => {
    let q = client().from('employees').select(cols).order('full_name', { ascending: true })
    if (!includeArchived) q = q.eq('status', 'active')
    return q
  })
  if (res.error) throw new EmployerError(describe(res.error).message, { code: res.error.code, cause: res.error })
  return res.data
}

export async function createEmployee({ fullName, jobTitle = null, email = null, withInvite = true }) {
  const uid = await currentUserId()
  const name = (fullName || '').trim()
  if (!name) throw new EmployerError('Please enter a name.', { hint: 'A name is required for the roster.' })

  return run(
    client().from('employees').insert({
      employer_id: uid,
      full_name: name,
      job_title: jobTitle?.trim() || null,
      email: email?.trim() || null,
      invite_code: withInvite ? makeInviteCode() : null,
    }).select(employeeCols()).single(),
    'add this employee',
  )
}

export async function updateEmployee(id, patch) {
  const clean = {}
  if ('fullName' in patch) clean.full_name = patch.fullName?.trim()
  if ('jobTitle' in patch) clean.job_title = patch.jobTitle?.trim() || null
  if ('email' in patch) clean.email = patch.email?.trim() || null
  if ('status' in patch) clean.status = patch.status
  if ('contractorId' in patch) clean.contractor_id = patch.contractorId || null
  const res = await withEmployeeCols(cols =>
    client().from('employees').update(clean).eq('id', id).select(cols).single(),
  )
  if (res.error) throw new EmployerError(describe(res.error).message, { code: res.error.code, cause: res.error })
  return res.data
}

/* Moves a worker to a contractor, or to none at all (contractorId = null,
   which puts them back on 'Unassigned'). Passing an empty string is treated as
   'none' rather than as a contractor named '' — the UI sends '' for the
   unassigned option. */
export async function setEmployeeContractor(employeeId, contractorId) {
  return updateEmployee(employeeId, { contractorId: contractorId || null })
}

export async function archiveEmployee(id) {
  return updateEmployee(id, { status: 'archived' })
}

export async function restoreEmployee(id) {
  return updateEmployee(id, { status: 'active' })
}

/* Detaches the signed-in employee from a roster entry. Used if someone leaves
   and their account should stop seeing this business's records. */
export async function unlinkEmployeeAccount(id) {
  const res = await withEmployeeCols(cols =>
    client().from('employees').update({ employee_user_id: null }).eq('id', id).select(cols).single(),
  )
  if (res.error) throw new EmployerError(describe(res.error).message, { code: res.error.code, cause: res.error })
  return res.data
}

// ── Rates ───────────────────────────────────────────────────────────────────

/* Rate history, newest first. Every employee needs at least one period before
   any day can be logged for them. */
export async function listRatePeriods(employeeId) {
  return run(
    client().from('employee_rate_periods')
      .select('id, employee_id, effective_from, daily_rate, weekend_multiplier, holiday_multiplier')
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false }),
    'load pay rates',
  )
}

export async function listAllRatePeriods() {
  return run(
    client().from('employee_rate_periods')
      .select('id, employee_id, effective_from, daily_rate, weekend_multiplier, holiday_multiplier')
      .order('effective_from', { ascending: false }),
    'load pay rates',
  )
}

/* Adding a rate from date D does NOT change any day before D. That is enforced
   in the database, not here — see day_records_compute_money. */
export async function addRatePeriod(employeeId, {
  effectiveFrom, dailyRate, weekendMultiplier = 2, holidayMultiplier = 2,
}) {
  const rate = Number(dailyRate)
  if (!(rate >= 0)) throw new EmployerError('Enter a daily rate.', { hint: 'It must be zero or more.' })
  if (!effectiveFrom) throw new EmployerError('Choose the date this rate starts.', { hint: 'Days before it keep the old rate.' })

  return run(
    client().from('employee_rate_periods').insert({
      employee_id: employeeId,
      effective_from: effectiveFrom,
      daily_rate: rate,
      weekend_multiplier: Number(weekendMultiplier) || 2,
      holiday_multiplier: Number(holidayMultiplier) || 2,
    }).select().single(),
    'save this rate',
  )
}

export async function updateRatePeriod(id, patch) {
  const clean = {}
  if ('dailyRate' in patch) clean.daily_rate = Number(patch.dailyRate)
  if ('weekendMultiplier' in patch) clean.weekend_multiplier = Number(patch.weekendMultiplier)
  if ('holidayMultiplier' in patch) clean.holiday_multiplier = Number(patch.holidayMultiplier)
  if ('effectiveFrom' in patch) clean.effective_from = patch.effectiveFrom
  return run(
    client().from('employee_rate_periods').update(clean).eq('id', id).select().single(),
    'update this rate',
  )
}

export async function deleteRatePeriod(id) {
  return run(
    client().from('employee_rate_periods').delete().eq('id', id),
    'delete this rate',
  )
}

// ── Days ────────────────────────────────────────────────────────────────────

const DAY_COLS = 'id, employee_id, work_date, kind, leave_type, leave_percent, rate, multiplier, amount, status, note, confirmed_at, disputed_at'


export async function listEmployeeMonth(employeeId, year, monthIndex) {
  const { from, to } = monthBounds(year, monthIndex)
  return run(
    client().from('day_records').select(DAY_COLS)
      .eq('employee_id', employeeId)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: true }),
    'load this month',
  )
}

/* One query for the whole roster's month — cheaper than N round trips and the
   shape the payroll summary and the all-staff grid both want. */
export async function listAllMonth(year, monthIndex) {
  const { from, to } = monthBounds(year, monthIndex)
  return run(
    client().from('day_records').select(DAY_COLS)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: true }),
    'load this month',
  )
}

/* Records one day. Deliberately sends ONLY the claim — no rate, no amount.
   `status` defaults to 'claimed' in the schema, and an employer saving on an
   employee's behalf may confirm in the same step by passing confirm: true. */
export async function setDay(employeeId, workDate, kind, {
  leaveType = null, leavePercent = 0, note = null, confirm = false,
} = {}) {
  const payload = {
    employee_id: employeeId,
    work_date: workDate,
    kind,
    note,
  }

  if (kind === 'leave') {
    payload.leave_type = leaveType || 'annual'
    payload.leave_percent = Number(leavePercent) || 0
  }

  const uid = await currentUserId()
  payload.claimed_by = uid
  if (confirm) payload.status = 'confirmed'

  return run(
    client().from('day_records')
      .upsert(payload, { onConflict: 'employee_id,work_date' })
      .select(DAY_COLS).single(),
    'save this day',
  )
}

export async function clearDay(employeeId, workDate) {
  return run(
    client().from('day_records').delete()
      .eq('employee_id', employeeId).eq('work_date', workDate),
    'remove this day',
  )
}

export async function confirmDay(id) {
  return run(
    client().from('day_records').update({ status: 'confirmed' }).eq('id', id)
      .select(DAY_COLS).single(),
    'confirm this day',
  )
}

export async function disputeDay(id, reason = null) {
  return run(
    client().from('day_records').update({ status: 'disputed', note: reason }).eq('id', id)
      .select(DAY_COLS).single(),
    'dispute this day',
  )
}

export async function reopenDay(id) {
  return run(
    client().from('day_records').update({ status: 'claimed' }).eq('id', id)
      .select(DAY_COLS).single(),
    'reopen this day',
  )
}

/* Confirms every still-unconfirmed day in a month for one employee. One round
   trip per day because each is separately audited — deliberate, not an
   oversight. For a large month this is the slow path; a bulk RPC would be the
   optimisation, and it should write the same audit rows. */
export async function confirmMonth(employeeId, year, monthIndex) {
  const days = await listEmployeeMonth(employeeId, year, monthIndex)
  const pending = days.filter(d => d.status === 'claimed')
  const results = []
  for (const d of pending) {
    results.push(await confirmDay(d.id))
  }
  return { confirmed: results.length, skipped: days.length - pending.length }
}

// ── Summary ─────────────────────────────────────────────────────────────────


// ── Roles ───────────────────────────────────────────────────────────────────

/* Who is this account? Either or both can be true — an owner who also works
   days is both an employer and an employee of their own business.

   The `kind` distinction is what keeps the two halves apart. `isEmployer` is
   true for a personal account too (under the one-ledger plan everyone gets an
   employers row); `isBusiness` is the gate for every workforce surface. The
   decision itself lives in resolveRoles(), which is pure and unit-tested. */
export async function myRoles() {
  const uid = await currentUserId()
  const c = client()

  const [employerRes, asEmployee] = await Promise.all([
    kindMissing
      ? c.from('employers').select('user_id, business_name').eq('user_id', uid).maybeSingle()
      : c.from('employers').select('user_id, business_name, kind').eq('user_id', uid).maybeSingle(),
    c.from('employees')
      .select('id, full_name, job_title, employer_id, status')
      .eq('employee_user_id', uid)
      .maybeSingle(),
  ])

  // Degrade to the pre-006 shape rather than failing, and remember it.
  let asEmployer = employerRes
  if (isMissingColumn(asEmployer.error, 'kind')) {
    kindMissing = true
    const bare = await c.from('employers').select('user_id, business_name').eq('user_id', uid).maybeSingle()
    asEmployer = bare.data ? { ...bare, data: { ...bare.data, kind: BUSINESS } } : bare
  } else if (!asEmployer.error) {
    kindMissing = false
  }

  // A missing row is not an error here — it just means "no".
  if (asEmployer.error && asEmployer.error.code !== 'PGRST116') {
    throw new EmployerError(describe(asEmployer.error).message, { code: asEmployer.error.code, cause: asEmployer.error })
  }
  if (asEmployee.error && asEmployee.error.code !== 'PGRST116') {
    throw new EmployerError(describe(asEmployee.error).message, { code: asEmployee.error.code, cause: asEmployee.error })
  }

  return resolveRoles({ uid, employer: asEmployer.data || null, employee: asEmployee.data || null })
}

// ── Joining a team ──────────────────────────────────────────────────────────

/* Redeems an invite code. Runs server-side because an employee has no write
   policy on `employees` — see migration 005 for why that is deliberate.

   Returns the linked roster entry, or throws with a message safe to show. */
export async function redeemInvite(code) {
  const cleaned = String(code || '').trim()
  if (!cleaned) throw new EmployerError('Enter the code from your employer.')

  const { data, error } = await client().rpc('redeem_invite', { code: cleaned })
  if (error) {
    const msg = error.message || 'Could not join.'
    throw new EmployerError(
      /not recognised/i.test(msg) ? 'That code was not recognised.'
        : /already been used/i.test(msg) ? 'That code has already been used.'
          : /archived/i.test(msg) ? 'That roster entry is archived.'
            : msg,
      { code: error.code, hint: /not recognised/i.test(msg) ? 'Check it with your employer — codes are case-sensitive to look at but not to type.' : undefined, cause: error },
    )
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new EmployerError('Could not join.', { hint: 'The code was accepted but no roster entry came back.' })
  return row
}

/* Unlinks the signed-in account from whatever roster entry it holds. */
export async function leaveRoster() {
  const { error } = await client().rpc('leave_roster')
  if (error) throw new EmployerError(error.message || 'Could not leave.', { code: error.code, cause: error })
}

/* Issues a fresh invite code for a roster entry — used after someone leaves,
   or when the original was never shared. The employer writes to their own row
   through the existing policy, so this needs no server function. */
export async function issueInviteCode(employeeId) {
  const res = await withEmployeeCols(cols =>
    client().from('employees')
      .update({ invite_code: makeInviteCode() })
      .eq('id', employeeId)
      .select(cols).single(),
  )
  if (res.error) throw new EmployerError(describe(res.error).message, { code: res.error.code, cause: res.error })
  return res.data
}

// ── The employee's own view ─────────────────────────────────────────────────

/* Their rate history. RLS already scopes this to their own periods, so no
   employee id is needed — the policy does the filtering. */
export async function myRatePeriods(employeeId) {
  return listRatePeriods(employeeId)
}

/* Their own days for a month. Also RLS-scoped, but the employee_id filter is
   passed explicitly so the query is index-friendly rather than relying on the
   planner to combine a policy with a date range. */
export async function myMonth(employeeId, year, monthIndex) {
  return listEmployeeMonth(employeeId, year, monthIndex)
}

// ── Contractors ─────────────────────────────────────────────────────────────

/* The middle of EMPLOYER → CONTRACTOR → WORKER.

   Every function here tolerates the contractors table not existing yet, for
   the same reason the employee columns do: this code can be live before
   migration 007 is run, and a Phase 3 screen must never be able to break the
   Phase 2 screens around it. `listContractors` returning [] in that window
   means the roster simply stays flat, which is exactly how it behaved before. */

const CONTRACTOR_COLS = 'id, name, note, status, created_at'

/* Set once the database has told us the table is absent. */
let contractorsMissing = false

export function contractorsAvailable() {
  return !contractorsMissing
}

/* Clears both "this part of the schema is absent" flags so the next query
   probes again.

   Both are sticky on purpose — they stop the app paying a failed round trip on
   every render. But sticky with no way out is a trap: if migration 007 is run
   while the app is open, the app would go on believing the table is missing
   for the life of the page, and the only cure would be a full reload — not
   something a user can be expected to guess. Every user-initiated refresh calls
   this, so running the migration and hitting refresh is enough. */
export function resetSchemaProbes() {
  contractorColumnMissing = false
  contractorsMissing = false
}

export async function listContractors({ includeArchived = false } = {}) {
  if (contractorsMissing) return []
  let q = client().from('contractors').select(CONTRACTOR_COLS).order('name', { ascending: true })
  if (!includeArchived) q = q.eq('status', 'active')

  const res = await q
  if (isMissingTable(res.error, 'contractors')) {
    contractorsMissing = true
    return []
  }
  if (res.error) throw new EmployerError(describe(res.error).message, { code: res.error.code, cause: res.error })
  return res.data
}

export async function createContractor(name, { note = null } = {}) {
  const uid = await currentUserId()
  const clean = (name || '').trim()
  if (!clean) {
    throw new EmployerError('Give the contractor a name.', {
      hint: 'A name is required — it is what appears on the invoice.',
    })
  }
  return run(
    client().from('contractors')
      .insert({ employer_id: uid, name: clean, note: note?.trim() || null })
      .select(CONTRACTOR_COLS).single(),
    'add this contractor',
  )
}

export async function updateContractor(id, patch) {
  const clean = {}
  if ('name' in patch) clean.name = patch.name?.trim()
  if ('note' in patch) clean.note = patch.note?.trim() || null
  if ('status' in patch) clean.status = patch.status
  return run(
    client().from('contractors').update(clean).eq('id', id).select(CONTRACTOR_COLS).single(),
    'update this contractor',
  )
}

/* Archiving, never deleting. A contractor is a label on real historical days;
   removing it would leave the days with nothing to explain them. */
export async function archiveContractor(id) {
  return updateContractor(id, { status: 'archived' })
}

export async function restoreContractor(id) {
  return updateContractor(id, { status: 'active' })
}

// ── Attendance sessions ─────────────────────────────────────────────────────

/* The employer's side of the daily code.
 *
 * The worker's side is a single call — checkIn(code) — and the deliberate
 * asymmetry is the point: the employer can read a session, and a worker cannot
 * read one at all. `attendance_sessions` has no policy for them, so their own
 * query returns nothing. They learn that attendance is open through
 * myAttendanceStatus(), which returns a boolean and a contractor name and
 * never the code.
 */

const SESSION_COLS = 'id, contractor_id, work_date, code, status, opens_at, expires_at, closed_at'

/* Today's session for one contractor, or the site-wide one when contractorId is
   null. Returns null when nothing has been opened — not an error. */
export async function todaysSession(contractorId = null, workDate = todayKey()) {
  let q = client().from('attendance_sessions')
    .select(SESSION_COLS)
    .eq('work_date', workDate)

  q = contractorId
    ? q.eq('contractor_id', contractorId)
    : q.is('contractor_id', null)

  const res = await q.maybeSingle()
  if (res.error && res.error.code !== 'PGRST116') {
    if (isMissingTable(res.error, 'attendance_sessions')) return null
    throw new EmployerError(describe(res.error).message, { code: res.error.code, cause: res.error })
  }
  return res.data || null
}

export async function listSessionsForDate(workDate = todayKey()) {
  const res = await client().from('attendance_sessions')
    .select(SESSION_COLS)
    .eq('work_date', workDate)

  if (res.error) {
    if (isMissingTable(res.error, 'attendance_sessions')) return []
    throw new EmployerError(describe(res.error).message, { code: res.error.code, cause: res.error })
  }
  return res.data || []
}

/* Opens attendance, or reopens a closed one with a fresh code.
 *
 * `expiresAt` comes from the browser as the end of the employer's own local
 * day, because the database has no idea which timezone they are in. Reopening
 * rotates the code — the old one dies for good. */
export async function openAttendance(contractorId = null, workDate = todayKey(), expiresAt = null) {
  const expiry = expiresAt || endOfLocalDay(new Date()).toISOString()

  const { data, error } = await client().rpc('open_attendance', {
    p_contractor_id: contractorId,
    p_work_date: workDate,
    p_expires_at: expiry,
  })
  if (error) throw new EmployerError(describe(error).message, { code: error.code, cause: error })
  return Array.isArray(data) ? data[0] : data
}

export async function closeAttendance(sessionId) {
  const { data, error } = await client().rpc('close_attendance', { p_session_id: sessionId })
  if (error) throw new EmployerError(describe(error).message, { code: error.code, cause: error })
  return Array.isArray(data) ? data[0] : data
}

// ── The worker's side ───────────────────────────────────────────────────────

/* Whether attendance is open for the signed-in worker, and for which
   contractor. Never returns the code. */
export async function myAttendanceStatus() {
  const { data, error } = await client().rpc('my_attendance_status')
  if (error) {
    if (isMissingTable(error, 'attendance_sessions')) return null
    throw new EmployerError(describe(error).message, { code: error.code, cause: error })
  }
  const row = Array.isArray(data) ? data[0] : data
  return row || null
}

/* Records today's attendance from a workplace code.
 *
 * Returns { ok: true, day, already } or { ok: false, message } — a refusal is
 * an expected outcome here, not an exception, because "wrong code" is a thing
 * that happens every day on a real site and must not read as a crash. */
export async function checkIn(code) {
  const cleaned = String(code ?? '').trim()

  if (!isValidCodeShape(cleaned)) {
    return { ok: false, message: 'Enter the four-digit code from your workplace.' }
  }

  const { data, error } = await client().rpc('check_in_with_code', { p_code: cleaned })
  if (error) return { ok: false, message: checkInError(error) }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: false, message: 'Attendance was not recorded. Try again.' }

  return { ok: true, day: row, already: !!row.already }
}
