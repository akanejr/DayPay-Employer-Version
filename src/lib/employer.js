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
  if (code === '42501' || code === '42P01') {
    return { message: 'You do not have access to that.', hint: 'Are you signed in as the employer?' }
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
   UI never has to care whether this is a brand-new account. */
export async function ensureEmployer(businessName = null) {
  const uid = await currentUserId()
  const existing = await run(
    client().from('employers').select('user_id, business_name').eq('user_id', uid).maybeSingle(),
    'load your business details',
  )
  if (existing) return existing

  return run(
    client().from('employers')
      .insert({ user_id: uid, business_name: businessName })
      .select('user_id, business_name')
      .single(),
    'create your business record',
  )
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

const EMPLOYEE_COLS = 'id, full_name, job_title, email, employee_user_id, invite_code, status, created_at'

export async function listEmployees({ includeArchived = false } = {}) {
  let q = client().from('employees').select(EMPLOYEE_COLS).order('full_name', { ascending: true })
  if (!includeArchived) q = q.eq('status', 'active')
  return run(q, 'load your staff list')
}

/* A short, readable invite code. Avoids characters that are easy to misread
   when someone is copying it over the phone: 0/O, 1/I/L. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function makeInviteCode(length = 8) {
  const bytes = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
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
    }).select(EMPLOYEE_COLS).single(),
    'add this employee',
  )
}

export async function updateEmployee(id, patch) {
  const clean = {}
  if ('fullName' in patch) clean.full_name = patch.fullName?.trim()
  if ('jobTitle' in patch) clean.job_title = patch.jobTitle?.trim() || null
  if ('email' in patch) clean.email = patch.email?.trim() || null
  if ('status' in patch) clean.status = patch.status
  return run(
    client().from('employees').update(clean).eq('id', id).select(EMPLOYEE_COLS).single(),
    'update this employee',
  )
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
  return run(
    client().from('employees').update({ employee_user_id: null }).eq('id', id)
      .select(EMPLOYEE_COLS).single(),
    'unlink this account',
  )
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

/* The rate in force on a given date — mirrors the server's own lookup so the
   UI can show what a day WILL be worth before it is saved. */
export function rateOn(periods, workDate) {
  if (!periods?.length) return null
  const sorted = [...periods].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))
  let found = null
  for (const p of sorted) {
    if (p.effective_from <= workDate) found = p
    else break
  }
  return found
}

// ── Days ────────────────────────────────────────────────────────────────────

const DAY_COLS = 'id, employee_id, work_date, kind, leave_type, leave_percent, rate, multiplier, amount, status, note, confirmed_at, disputed_at'

export function monthBounds(year, monthIndex) {
  const pad = n => String(n).padStart(2, '0')
  const from = `${year}-${pad(monthIndex + 1)}-01`
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const to = `${year}-${pad(monthIndex + 1)}-${pad(last)}`
  return { from, to }
}

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

/* Payroll totals for a month, per employee and overall.
   `amount` is the stored, frozen figure — this deliberately does NOT recompute
   from today's rate, because that is exactly the error DayPay exists to avoid. */
export function summarise(days, employees) {
  const byEmployee = new Map()
  for (const e of employees) {
    byEmployee.set(e.id, {
      employee: e, days: 0, worked: 0, leave: 0, equivalents: 0,
      total: 0, claimed: 0, confirmed: 0, disputed: 0,
    })
  }

  let total = 0
  let unconfirmed = 0
  let disputed = 0

  for (const d of days) {
    const row = byEmployee.get(d.employee_id)
    if (!row) continue // day belongs to an archived or unknown employee
    row.days += 1
    if (d.kind === 'leave') row.leave += 1
    else { row.worked += 1; row.equivalents += Number(d.multiplier) || 0 }
    row.total += Number(d.amount) || 0
    if (d.status === 'confirmed') row.confirmed += 1
    else if (d.status === 'disputed') row.disputed += 1
    else row.claimed += 1

    total += Number(d.amount) || 0
    if (d.status === 'claimed') unconfirmed += 1
    if (d.status === 'disputed') disputed += 1
  }

  const rows = [...byEmployee.values()].filter(r => r.days > 0)

  return {
    rows,
    total: Math.round(total * 100) / 100,
    unconfirmed,
    disputed,
    staffCount: rows.length,
  }
}

export function formatNaira(n) {
  const v = Number(n)
  if (!isFinite(v)) return '₦0'
  const neg = v < 0
  return `${neg ? '-' : ''}₦${Math.abs(Math.round(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}
