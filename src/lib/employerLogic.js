/* DayPay Employer Version — pure employer logic.
 *
 * No imports, no network, no Supabase. Everything here is a pure function so
 * it can be tested with `node --test` and zero dependencies — which matters,
 * because node_modules is stripped from the sandbox between turns and a test
 * suite that dies with it protects nothing.
 *
 * employer.js imports and re-exports these, so the UI has one entry point.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatNaira(n) {
  const v = Number(n)
  if (!isFinite(v)) return '₦0'
  const neg = v < 0
  return `${neg ? '-' : ''}₦${Math.abs(Math.round(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Dates ───────────────────────────────────────────────────────────────────

const pad2 = n => String(n).padStart(2, '0')

/* Inclusive first/last day of a month. Built with plain arithmetic rather than
   Date(timezone) so it cannot shift a day near midnight in some zone. */
export function monthBounds(year, monthIndex) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return {
    from: `${year}-${pad2(monthIndex + 1)}-01`,
    to: `${year}-${pad2(monthIndex + 1)}-${pad2(last)}`,
  }
}

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/* Parses 'YYYY-MM-DD' as a LOCAL date. Never `new Date(key)`, which is parsed
   as UTC midnight and shifts the weekday backwards in any zone behind UTC —
   which would silently mark the wrong kind on the wrong day. */
export function parseDateKey(key) {
  if (typeof key !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const [, y, mo, d] = m.map(Number)
  const dt = new Date(y, mo - 1, d)
  // Reject impossible dates (2026-02-31) rather than silently rolling over.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt
}

export function isWeekendKey(key) {
  const d = parseDateKey(key)
  if (!d) return false
  const dow = d.getDay()
  return dow === 0 || dow === 6
}

export function shiftDateKey(key, days) {
  const d = parseDateKey(key)
  if (!d) return null
  d.setDate(d.getDate() + days)
  return todayKey(d)
}

/* Weekend work earns the multiplier, so the kind must follow the DATE, not the
   tap. Marking "present" on a Saturday must not record a plain workday. */
export function suggestedKind(key) {
  return isWeekendKey(key) ? 'weekend' : 'work'
}

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function prettyDateKey(key) {
  const d = parseDateKey(key)
  if (!d) return key || ''
  return `${DOW3[d.getDay()]} ${d.getDate()} ${MON3[d.getMonth()]} ${d.getFullYear()}`
}

export function shortDateKey(key) {
  const d = parseDateKey(key)
  if (!d) return key || ''
  return `${d.getDate()} ${MON3[d.getMonth()]}`
}

export const KIND_LABELS = {
  work: 'Worked',
  weekend: 'Weekend',
  overtime: 'Overtime',
  holiday: 'Holiday',
  leave: 'Leave',
}

// ── Rates ───────────────────────────────────────────────────────────────────

/* The rate period in force on a given date, or null if none covers it.
   Mirrors the server's own lookup in day_records_compute_money, so the UI can
   show what a day WILL be worth before it is saved. If these two ever disagree
   the UI is lying about money, so the behaviour is pinned by tests. */
export function rateOn(periods, workDate) {
  if (!periods?.length || !workDate) return null
  const sorted = [...periods].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))
  let found = null
  for (const p of sorted) {
    if (p.effective_from <= workDate) found = p
    else break
  }
  return found
}

/* The multiplier a kind earns, mirroring the server CASE expression.
   Weekend and weekday overtime both use weekend_multiplier — that is the
   existing client behaviour and the server matches it deliberately. */
export function multiplierFor(kind, period, leavePercent = 0) {
  if (!period) return null
  switch (kind) {
    case 'weekend': return Number(period.weekend_multiplier)
    case 'overtime': return Number(period.weekend_multiplier)
    case 'holiday': return Number(period.holiday_multiplier)
    case 'leave': return Number(leavePercent) / 100
    default: return 1
  }
}

// ── Invite codes ────────────────────────────────────────────────────────────

/* Excludes characters that are easy to confuse when read aloud or copied by
   hand: 0/O, 1/I/L. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function makeInviteCode(length = 8, random = defaultRandom) {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  }
  return out
}

function defaultRandom() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = new Uint8Array(1)
    crypto.getRandomValues(b)
    return b[0] / 256
  }
  return Math.random()
}

// ── Payroll summary ─────────────────────────────────────────────────────────

/* Totals for a month, per employee and overall.
 *
 * CRITICAL: `total` sums the STORED amounts, never days × today's rate. A
 * raise must not reprice days already worked — that is the rule the whole
 * product rests on, and the same rule the payslip tests pin down.
 *
 * Days belonging to an employee who is not in `employees` are counted into
 * `total` and reported as `unmatched`, rather than silently dropped. Dropping
 * them would understate what is owed, which is the worst possible direction
 * for this number to be wrong in.
 */
export function summarise(days, employees) {
  const byEmployee = new Map()
  for (const e of employees || []) {
    if (!e || !e.id) continue // defensive: a null element must not blank the whole summary
    byEmployee.set(e.id, {
      employee: e, days: 0, worked: 0, leave: 0, equivalents: 0,
      total: 0, claimed: 0, confirmed: 0, disputed: 0,
    })
  }

  let total = 0
  let unconfirmed = 0
  let disputed = 0
  let unmatchedDays = 0
  let unmatchedTotal = 0

  for (const d of days || []) {
    if (!d) continue // defensive: a null element must not blank the whole summary
    const amount = Number(d.amount) || 0
    total += amount
    if (d.status === 'claimed') unconfirmed += 1
    if (d.status === 'disputed') disputed += 1

    const row = byEmployee.get(d.employee_id)
    if (!row) {
      // Archived or otherwise unknown: still owed, still counted.
      unmatchedDays += 1
      unmatchedTotal += amount
      continue
    }

    row.days += 1
    if (d.kind === 'leave') {
      row.leave += 1
    } else {
      row.worked += 1
      row.equivalents += Number(d.multiplier) || 0
    }
    row.total += amount
    if (d.status === 'confirmed') row.confirmed += 1
    else if (d.status === 'disputed') row.disputed += 1
    else row.claimed += 1
  }

  const rows = [...byEmployee.values()]
    .filter(r => r.days > 0)
    .sort((a, b) => b.total - a.total)

  return {
    rows,
    total: Math.round(total * 100) / 100,
    unconfirmed,
    disputed,
    staffCount: rows.length,
    unmatchedDays,
    unmatchedTotal: Math.round(unmatchedTotal * 100) / 100,
  }
}

// ── Month-end export ────────────────────────────────────────────────────────

/* CSVs are dangerous in a spreadsheet: a cell beginning =, +, - or @ is
   interpreted as a formula, and a leading - is a legitimate negative number
   here. Only the formula triggers are neutralised, by prefixing a tab, which
   spreadsheets ignore. */
function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (/^[=+@]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

const CSV_HEADERS = [
  'Date', 'Employee', 'Job title', 'Kind', 'Rate', 'Multiplier',
  'Amount', 'Status', 'Note',
]

/* One row per recorded day, plus a control total. The total line is included
   because a CSV that disagrees with the screen is worse than no CSV — having
   the figure in the file makes any discrepancy immediately visible. */
export function buildMonthCsv(days, employees, { monthLabel = '' } = {}) {
  const byId = new Map((employees || []).map(e => [e.id, e]))
  const sorted = [...(days || [])]
    .filter(Boolean)
    .sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0))

  const lines = [CSV_HEADERS.join(',')]
  let total = 0

  for (const d of sorted) {
    const emp = byId.get(d.employee_id)
    total += Number(d.amount) || 0
    lines.push([
      d.work_date,
      emp ? emp.full_name : '(not on roster)',
      emp?.job_title || '',
      KIND_LABELS[d.kind] || d.kind || '',
      d.rate ?? '',
      d.multiplier ?? '',
      Number(d.amount) || 0,
      d.status || '',
      d.note || '',
    ].map(csvCell).join(','))
  }

  lines.push('')
  lines.push([monthLabel ? `Total — ${monthLabel}` : 'Total', '', '', '', '', '',
    Math.round(total * 100) / 100, '', ''].map(csvCell).join(','))

  return lines.join('\r\n')
}

export function monthLabelFor(year, monthIndex) {
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December']
  return `${MON[monthIndex]} ${year}`
}

// ── Roles ───────────────────────────────────────────────────────────────────

/* An `employers` row now carries a `kind`:
     'business' — a real workforce account: roster, attendance, invoices.
     'personal' — someone tracking their own days. Under the one-ledger plan
                  every account gets one of these, and it must NOT unlock the
                  workforce dashboard.
   The default below is the whole point of this function: anything missing,
   unrecognised, or malformed resolves to 'personal'. A null column must never
   be the reason a personal account sees a staff roster. */

export const PERSONAL = 'personal'
export const BUSINESS = 'business'

/* Combines the two database rows into the flags the UI branches on. Pure, so
   the rule above is testable with no database and no network. */
export function resolveRoles(input = {}) {
  // `input || {}` rather than a default parameter: a default only applies to
  // `undefined`, so resolveRoles(null) would destroy itself on destructuring.
  // Callers pass the result of a fetch that can legitimately be null.
  const { uid = null, employer = null, employee = null } = input || {}

  const asObject = (v) => (v && typeof v === 'object' ? v : null)
  const emp = asObject(employer)
  const isEmployer = !!emp
  const kind = emp && emp.kind === BUSINESS ? BUSINESS : PERSONAL

  return {
    uid,
    isEmployer,
    kind: isEmployer ? kind : null,
    // The gate for every workforce surface: Staff tab, roster, dashboard.
    isBusiness: isEmployer && kind === BUSINESS,
    businessName: emp?.business_name || null,
    employee: asObject(employee),
  }
}

// ── Phase 10: accounts, onboarding, and what the employer is told ───────────

/* THE SIGN-UP CHOICE, AND HOW MUCH IT IS ALLOWED TO DECIDE.

   The brief asks a new user to choose Employer or Employee. That choice routes
   the first screen and nothing else. It is deliberately NOT written to the
   database, because a stored choice would be a second source of truth about
   who somebody is — and there is already one, the one the database itself
   enforces: an `employers` row makes you an employer, `employees.employee_user_id`
   makes you a worker. Two sources of truth about identity is exactly the
   disagreement this project has avoided everywhere else. If the choice and the
   rows ever disagree, the rows win, and the person is still in the right place.

   The copy lives here rather than in the JSX so it is unit-tested: a sign-up
   screen is the one screen every single user reads, and it is the easiest place
   in the product to make a promise the code does not keep. */
export const ACCOUNT_TYPES = [
  {
    id: 'employer',
    label: 'Employer',
    blurb: 'I run the business. I add workers, set rates, and confirm the days that were worked.',
    next: 'Set up your business',
  },
  {
    id: 'employee',
    label: 'Employee',
    blurb: 'I work on site. I want to record my attendance and see my own days and pay.',
    next: 'Enter your invite code',
  },
]

export function accountTypeById(id) {
  return ACCOUNT_TYPES.find(t => t.id === id) || null
}

/* Which pane a signed-in account belongs on.

   Straight from resolveRoles() above, so there is one rule and not two. An
   employer's own business outranks their own work record: the owner of a
   company who is also on the roster is an employer first, because that is the
   pane with the work in it that nobody else can do. */
export function homeViewFor(roles) {
  if (!roles) return 'month'
  if (roles.isBusiness) return 'staff'
  if (roles.employee) return 'me'
  return 'month'
}

/* §4 — the account status an employer sees against a worker's name.

   "Not registered" means ONE thing: this person has not created their own
   DayPay login. It does not mean they are not employed, not on site, or not
   being paid. The hint says so out loud, because an employer who reads it the
   other way will chase a worker to sign up who has no smartphone — and the
   whole point of the kiosk is that they never have to.

   The `hint` is written to be true both before and after the kiosk exists: the
   record is kept either way, and only the sentence gains "at the site kiosk"
   when there is a kiosk to name. */
export function accountStatus(employee) {
  const registered = !!employee?.employee_user_id
  return {
    registered,
    text: registered ? 'Registered' : 'Not registered',
    hint: registered
      ? 'They have their own DayPay sign-in and can see their own days and pay.'
      : 'No DayPay sign-in yet. They are still on your workforce and attendance is still recorded for them.',
  }
}

/* Did this query fail because a column does not exist yet?

   PostgREST reports a missing column as 42703 ("undefined_column"). It matters
   here because the app is deployed by one person and migrated by hand at a
   different moment, so there is always a window where the code is newer than
   the schema. A lookup that hard-requires a new column would take the whole
   feature down during that window — which is strictly worse than degrading. */
export function isMissingColumn(error, column) {
  if (!error) return false
  if (error.code === '42703') return true
  const msg = String(error.message || error.details || '')
  if (!column) return false
  return new RegExp(`column\\b.*\\b${column}\\b.*does not exist`, 'i').test(msg)
}

// ── Dashboard ───────────────────────────────────────────────────────────────

/* The employer's morning question, answered from data already loaded:
   who did I expect, who came, who is missing, and what does today cost.

   Returns the two lists as objects, not counts, because the names are the
   actionable part — an employer does not chase "3", they chase James.

   Days belonging to someone off the active roster are collected separately as
   `offRoster` rather than dropped. Dropping them would make the recorded count
   disagree with the amount, and a dashboard that contradicts itself is worse
   than no dashboard. */
export function dayBoard(days, employees, dateKey) {
  const active = (employees || []).filter(e => e && e.id && e.status === 'active')

  const onDate = new Map()
  for (const d of days || []) {
    if (d && d.work_date === dateKey) onDate.set(d.employee_id, d)
  }

  const present = []
  const missing = []
  const counts = { overtime: 0, holiday: 0, weekend: 0, leave: 0, disputed: 0, unconfirmed: 0 }
  let recorded = 0
  let amount = 0

  for (const employee of active) {
    const day = onDate.get(employee.id)
    if (!day) { missing.push(employee); continue }

    present.push({ employee, day })
    recorded += 1
    amount += Number(day.amount) || 0

    if (day.status === 'disputed') counts.disputed += 1
    else if (day.status === 'claimed') counts.unconfirmed += 1

    if (day.kind === 'overtime') counts.overtime += 1
    else if (day.kind === 'holiday') counts.holiday += 1
    else if (day.kind === 'weekend') counts.weekend += 1
    else if (day.kind === 'leave') counts.leave += 1
  }

  const activeIds = new Set(active.map(e => e.id))
  const offRoster = (days || []).filter(d => d && d.work_date === dateKey && !activeIds.has(d.employee_id))

  return {
    dateKey,
    isWeekend: isWeekendKey(dateKey),
    expected: active.length,
    recorded,
    present,
    missing,
    offRoster,
    counts,
    amount: Math.round(amount * 100) / 100,
  }
}

/* Active staff with no rate period covering the date.

   This is not cosmetic. The money trigger raises "No rate period covers
   <date>" and the day cannot be saved at all — so an employer who discovers
   this at marking time has a person standing in front of them and no way to
   record the day. Surfacing it on the dashboard turns a failure into a task:
   set this person's rate. */
export function unmetRates(employees, periods, dateKey) {
  return (employees || [])
    .filter(e => e && e.id && e.status === 'active')
    .filter(e => !rateOn((periods || []).filter(p => p && p.employee_id === e.id), dateKey))
}

/* The month figures the dashboard shows, flattened out of summarise().
   Deliberately the same source as the Summary pane and the payslip — the
   dashboard must never compute money a second way. */
export function monthFigures(days, employees) {
  const s = summarise(days, employees)
  let actualDays = 0
  let equivalents = 0
  for (const row of s.rows) {
    actualDays += row.worked
    equivalents += row.equivalents
  }
  return {
    actualDays,
    equivalents: Math.round(equivalents * 100) / 100,
    total: s.total,
    staffCount: s.staffCount,
    unconfirmed: s.unconfirmed,
    disputed: s.disputed,
    unmatchedDays: s.unmatchedDays,
    unmatchedTotal: s.unmatchedTotal,
  }
}

// ── Contractors ─────────────────────────────────────────────────────────────

/* Groups the active roster by contractor.

   Three rules, each of which is a decision rather than an implementation
   detail:

     1. A contractor with no workers still appears. Otherwise creating one
        looks like it silently failed.

     2. A worker with no contractor lands in an 'Unassigned' group. That is the
        correct state for every worker created before contractors existed, so
        it must be a first-class place to be, not an error.

     3. A worker pointing at a contractor that is not in the list — an archived
        one, say — ALSO lands in Unassigned. Showing them under a group that is
        not on screen would hide them entirely, and a worker who cannot be seen
        is a worker who does not get paid. */
export function groupByContractor(contractors, employees) {
  const groups = []
  const byId = new Map()

  for (const c of contractors || []) {
    if (!c || !c.id) continue
    const group = { contractor: c, workers: [] }
    byId.set(c.id, group)
    groups.push(group)
  }

  const unassigned = { contractor: null, workers: [] }

  for (const e of employees || []) {
    if (!e || !e.id || e.status !== 'active') continue
    const group = e.contractor_id ? byId.get(e.contractor_id) : null
    if (group) group.workers.push(e)
    else unassigned.workers.push(e)
  }

  // Only shown when it has someone in it — an empty 'Unassigned' on a fully
  // organised roster is noise.
  if (unassigned.workers.length) groups.push(unassigned)

  return groups
}

/* One contractor's day and month, from data already loaded.

   Worker cards carry exactly the brief's three facts — today's status, actual
   days, paid-day equivalents — and nothing more. The aggregate is computed
   from the same rows the cards show, so the header can never disagree with the
   list underneath it. */
export function contractorRollup(workers, days, dateKey) {
  const list = (workers || []).filter(w => w && w.id && w.status === 'active')
  const memberIds = new Set(list.map(w => w.id))

  const todayByWorker = new Map()
  const monthByWorker = new Map()

  for (const d of days || []) {
    if (!d || !memberIds.has(d.employee_id)) continue
    if (d.work_date === dateKey) todayByWorker.set(d.employee_id, d)

    const acc = monthByWorker.get(d.employee_id) || { actualDays: 0, equivalents: 0, total: 0, leave: 0 }
    if (d.kind === 'leave') acc.leave += 1
    else {
      acc.actualDays += 1
      acc.equivalents += Number(d.multiplier) || 0
    }
    acc.total += Number(d.amount) || 0
    monthByWorker.set(d.employee_id, acc)
  }

  const rows = list.map(employee => {
    const today = todayByWorker.get(employee.id) || null
    const month = monthByWorker.get(employee.id) || { actualDays: 0, equivalents: 0, total: 0, leave: 0 }
    return {
      employee,
      today,
      present: !!today,
      actualDays: month.actualDays,
      equivalents: Math.round(month.equivalents * 100) / 100,
      leave: month.leave,
      total: Math.round(month.total * 100) / 100,
    }
  })

  let present = 0
  let overtime = 0
  let amount = 0
  let total = 0
  let equivalents = 0

  for (const r of rows) {
    if (r.present) {
      present += 1
      amount += Number(r.today.amount) || 0
      if (r.today.kind === 'overtime') overtime += 1
    }
    total += r.total
    equivalents += r.equivalents
  }

  return {
    expected: rows.length,
    present,
    missing: rows.length - present,
    overtime,
    todayAmount: Math.round(amount * 100) / 100,
    periodTotal: Math.round(total * 100) / 100,
    equivalents: Math.round(equivalents * 100) / 100,
    rows,
  }
}

/* Did this query fail because the table does not exist yet? PostgREST reports
   an unknown relation as 42P01. Same reasoning as isMissingColumn: the app and
   the schema are updated at different moments, so a Phase 3 screen must not be
   able to break the Phase 2 screens around it. */
export function isMissingTable(error, table) {
  if (!error) return false
  if (error.code === '42P01') return true
  if (!table) return false
  const msg = String(error.message || error.details || '')
  return new RegExp(`relation\\b.*\\b${table}\\b.*does not exist`, 'i').test(msg)
}

/* Did this call fail because the FUNCTION does not exist yet?

   Same reasoning as isMissingColumn above: the app is deployed by hand at a
   different moment from the migration, so there is always a window where the
   code is newer than the schema, and a lookup that hard-requires the new
   function would take the whole pane down during it. Migration 018 is the case
   this exists for.

   Two different systems can answer this call, and they word it differently:

     PostgreSQL   42883  "function public.foo(uuid) does not exist"
     PostgREST    PGRST202
                  "Could not find the function public.foo(p_x) in the schema cache"

   The first attempt at this only knew the first wording and the second one,
   written as "does not exist|not found" AFTER the name, matched neither — the
   PostgREST sentence puts "Could not find" BEFORE the name. That is exactly the
   case a user hits, because the app talks to PostgREST and never to PostgreSQL.
   So the phrases are checked anywhere in the message, and the function name has
   to be in there too.

   What must NOT match, and is tested: "permission denied for function foo" —
   same words, entirely different problem. Told to run a migration when the
   real answer is "that worker is not yours" sends somebody to fix the wrong
   thing. */
export function isMissingFunction(error, fn) {
  if (!error) return false

  const msg = String(error.message || error.details || '')

  /* 42883 IS "undefined_function" — the SQLSTATE means exactly one thing, so
     the code alone is enough and there is nothing to disambiguate. */
  if (error.code === '42883') return true

  /* PGRST202 is PostgREST's general "could not find it in the schema cache",
     which is NOT specific to functions, so the name has to appear. Without
     this, a missing table or view would be read as "run migration 018". */
  const named = !fn || new RegExp(`\\b${fn}\\b`, 'i').test(msg)
  if (error.code === 'PGRST202') return named

  if (!msg || !named) return false
  return /does not exist|not found|could not find|schema cache/i.test(msg)
}

// ── Attendance sessions ─────────────────────────────────────────────────────

/* The end of the employer's own local day, as an instant.

   This is the whole reason session validity is a timestamp and not a date. The
   database runs in UTC; an employer in Lagos opening attendance at 00:30 is
   still on the previous UTC day, so a rule like "valid while work_date =
   current_date" would hand out the wrong session to everyone who arrives
   early. An absolute instant needs no timezone guess: the code stops working
   when the employer's day ends, wherever they are. */
export function endOfLocalDay(date = new Date(), hour = 23, minute = 59) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 59, 999)
  return d
}

/* What state a session is in right now. The database re-checks all of this on
   every check-in; this is only so the screen can be honest before anyone taps. */
export function sessionState(session, now = new Date()) {
  if (!session) return 'none'
  if (session.status === 'closed') return 'closed'
  const expiry = session.expires_at ? new Date(session.expires_at) : null
  if (!expiry || Number.isNaN(expiry.getTime())) return 'unknown'
  return now.getTime() >= expiry.getTime() ? 'expired' : 'open'
}

export function sessionIsLive(session, now = new Date()) {
  return sessionState(session, now) === 'open'
}

/* A four-digit code. Checked in the browser so a typo does not cost one of the
   five attempts the server allows. */
export function isValidCodeShape(code) {
  return /^[0-9]{4}$/.test(String(code ?? '').trim())
}

/* The personal attendance PIN, at the kiosk. Same shape rule as the site code
   above, and deliberately its own function rather than a shared one: they are
   different secrets with different owners, and a change to one must not move
   the other. Checked here so a mistyped PIN does not spend one of the five
   attempts the server allows — the cap is a security control, and a typo
   should not eat it. */
export function isValidPinShape(pin) {
  return /^[0-9]{4}$/.test(String(pin ?? '').trim())
}

/* How long is left, in words an employer can act on. Deliberately coarse: the
   difference between 3h 12m and 3h 14m changes nothing. */
export function timeLeftLabel(expiresAt, now = new Date()) {
  const end = expiresAt ? new Date(expiresAt) : null
  if (!end || Number.isNaN(end.getTime())) return ''
  const ms = end.getTime() - now.getTime()
  if (ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'ends in under a minute'
  if (mins < 60) return `ends in ${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? `ends in ${hours}h` : `ends in ${hours}h ${rem}m`
}

/* What the worker's screen should say, from my_attendance_status().
   Kept as a function so the wording is in one place and can be tested — the
   difference between "not open yet" and "already closed" is the difference
   between waiting and asking somebody. */
export function attendancePrompt(status) {
  if (!status) {
    return { tone: 'idle', title: 'Attendance', body: 'Checking whether attendance is open…' }
  }
  if (status.is_open) {
    return {
      tone: 'open',
      title: 'Attendance is open',
      body: status.contractor_name
        ? `Did you come to work today? Enter today's code for ${status.contractor_name}.`
        : 'Did you come to work today? Enter today’s workplace code.',
    }
  }
  if (status.last_ended) {
    return {
      tone: 'closed',
      title: 'Attendance has closed',
      body: 'Today’s session has ended. If you worked and missed it, ask your employer to record the day for you.',
    }
  }
  return {
    tone: 'idle',
    title: 'Attendance is not open',
    body: 'Your employer has not opened attendance yet. Try again once they have.',
  }
}

// ── Phase 5: the workplace record as the employee's own view ────────────────

/* One ledger row (public.day_records) → the record shape the calendar and the
   payslip have always used.

   This is the whole of the "view mode" trick: the employee's Month, Year,
   payslip and Yearly Share read the employer's verified rows through the same
   shapes they already understood, so no screen needs a second calculation and
   the two sides cannot drift apart.

   `amount`, `rate` and `multiplier` are taken AS STORED. They are frozen at the
   moment the day was recorded (the DB computes and then refuses to change
   them), so re-deriving them from today's settings would quietly restate
   history — the one thing a pay record must never do. */
export function ledgerToRecord(d) {
  if (!d || !d.work_date) return null
  const kind = String(d.kind || 'work')
  const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v))
  return {
    date: d.work_date,
    amount: Number(d.amount) || 0,
    rate: num(d.rate),
    multiplier: num(d.multiplier),
    isWeekend: kind === 'weekend',
    isOvertime: kind === 'overtime',
    isHoliday: kind === 'holiday',
    isLeave: kind === 'leave',
    leaveType: d.leave_type || undefined,
    // Provenance, kept so a day can say where it came from and whether the
    // employer has confirmed it yet. The calendar shows this; the maths
    // ignores it.
    status: d.status || undefined,
    source: d.source || undefined,
  }
}

/* A list of ledger rows → the date-keyed map the calendar indexes by. */
export function recordsByDate(rows) {
  const out = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const rec = ledgerToRecord(row)
    if (rec) out[rec.date] = rec
  }
  return out
}

/* How many days are still waiting on the employer, and how many are settled.
   The employee's screen says this out loud: "awaiting confirmation" is the
   difference between a day being written down and a day being agreed, and
   someone who has just checked in deserves to know which one they have. */
export function ledgerTotals(rows) {
  const out = { days: 0, claimed: 0, confirmed: 0, disputed: 0, amount: 0 }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.work_date) continue
    out.days += 1
    out.amount += Number(row.amount) || 0
    if (row.status === 'confirmed') out.confirmed += 1
    else if (row.status === 'disputed') out.disputed += 1
    else out.claimed += 1
  }
  return out
}

/* Where a day came from, in words, for the cell's tooltip. The point is that a
   worker can always answer "who put this here?" — the code they typed, their
   employer, or a correction. */
export function ledgerSourceLabel(source) {
  if (source === 'check_in') return 'Recorded with the work code'
  if (source === 'correction') return 'Corrected by your employer'
  return 'Recorded by your employer'
}

/* The personal notebook, summarised for one month — or null when it holds
   nothing for that month.

   Only used to tell a linked employee that their old personal days still
   exist. When someone joins a workplace their calendar switches to the
   workplace record, and a screen that silently hides weeks of their own
   entries would look exactly like data loss. */
export function notebookMonthNote(notebook, year, monthIndex) {
  const prefix = `${year}-${String((Number(monthIndex) || 0) + 1).padStart(2, '0')}-`
  let days = 0
  let total = 0
  for (const key in notebook || {}) {
    if (!key.startsWith(prefix)) continue
    const rec = notebook[key]
    if (!rec) continue
    days += 1
    total += Number(rec.amount) || 0
  }
  return days > 0 ? { days, total } : null
}

/* Turn a raw failure from check_in_with_code into something worth showing.
   The database already sends human-readable messages — this only catches the
   cases where nothing useful arrives at all. */
export function checkInError(error) {
  const raw = String(error?.message || '').trim()
  if (!raw) return 'Could not record your attendance. Try again.'
  // Both spellings: PostgreSQL writes "row-level security", other layers write
  // "row level security". Matching only one let the raw policy text through.
  if (/row[- ]level security|permission denied/i.test(raw)) {
    return 'Attendance could not be recorded. Ask your employer to open attendance.'
  }
  return raw
}

// ── Phase 6: corrections, worker detail and the audit trail ────────────────
//
// Everything below is pure: rows in, strings and arrays out. The screens that
// show corrections and history are then only about layout, and every sentence
// a worker or an employer reads about a request is decided in one place and
// tested without a database.

/* The three things a worker may ask for, in the words they see when choosing.
   The database enforces the same three values; this is the label table for
   `request_kind`, not a second definition of what is allowed. */
export const CORRECTION_CHOICES = [
  {
    value: 'remove',
    label: 'I did not work this day',
    hint: 'The day will be removed from your record.',
  },
  {
    value: 'reclassify',
    label: 'The type of day is wrong',
    hint: 'Say what it should be — overtime, weekend or holiday.',
  },
  {
    value: 'missing',
    label: 'I worked this day and it is not recorded',
    hint: 'Your employer will add the day if they agree.',
  },
]

export const CORRECTION_LABELS = {
  remove: 'Not there that day',
  reclassify: 'Wrong type of day',
  missing: 'Day not recorded',
}

/* Status of a request, as the worker and the employer both see it. `open` is
   deliberately not called "pending" anywhere: pending sounds like the system
   is still working, and this is a person who has not answered yet. */
export const CORRECTION_STATUS = {
  open: { text: 'Waiting for your employer', short: 'Waiting', cls: 'ew-chip ew-chip-warn' },
  approved: { text: 'Agreed', short: 'Agreed', cls: 'ew-chip ew-chip-live' },
  rejected: { text: 'Not agreed', short: 'Not agreed', cls: 'ew-chip' },
  withdrawn: { text: 'Withdrawn', short: 'Withdrawn', cls: 'ew-chip' },
}

/* A chip and a sentence want different words. KIND_LABELS gives "Overtime"
   for a chip; a sentence needs "overtime" and "a normal working day" — "Says
   this was Overtime, not Worked" is not something a person would say out
   loud, and these sentences are read by two people about somebody's pay. */
const CORRECTION_KIND_PHRASE = {
  work: 'a normal working day',
  weekend: 'weekend work',
  overtime: 'overtime',
  holiday: 'a holiday',
  leave: 'leave',
}

/* One sentence for the employer's queue. `dayKind` is what the day says now,
   so a reclassification can read as the change it is. */
export function correctionSentence(row, dayKind = null) {
  if (!row) return ''
  const wants = CORRECTION_KIND_PHRASE[row.want_kind] || KIND_LABELS[row.want_kind] || row.want_kind
  const had = CORRECTION_KIND_PHRASE[dayKind] || KIND_LABELS[dayKind] || dayKind
  if (row.request_kind === 'remove') return 'Says they did not work this day.'
  if (row.request_kind === 'missing') return 'Says they worked this day and it is not recorded.'
  if (row.request_kind === 'reclassify') {
    return had
      ? `Says this was ${wants}, not ${had}.`
      : `Says this was ${wants}.`
  }
  return 'Asked for a correction.'
}

/* What approving would actually do, kept separate from the asking so the
   employer can see the consequence before they tap Agree. */
export function correctionEffect(row, dayKind = null) {
  if (!row) return ''
  if (row.request_kind === 'remove') {
    return dayKind ? 'Agreeing removes the day.' : 'There is nothing recorded to remove.'
  }
  if (row.request_kind === 'missing') {
    return dayKind ? 'The day is already recorded.' : 'Agreeing records a normal working day.'
  }
  const wants = CORRECTION_KIND_PHRASE[row.want_kind] || KIND_LABELS[row.want_kind] || row.want_kind
  return dayKind ? `Agreeing changes it to ${wants}.` : `Agreeing records it as ${wants}.`
}

/* The open request for each date, for painting a chip on a day row. Resolved
   requests are ignored: the day row is about today's argument, not history. */
export function openRequestsByDate(rows = []) {
  const out = {}
  for (const r of rows || []) {
    if (!r || r.status !== 'open') continue
    const key = r.work_date
    if (!key) continue
    // Oldest wins if two somehow exist — the one the employer saw first.
    if (!out[key] || String(r.created_at) < String(out[key].created_at)) out[key] = r
  }
  return out
}

/* A month laid out as weeks of seven, Monday first — the same convention as
   the main calendar, so a worker's workplace calendar and their personal one
   read identically. Days outside the month are null rather than borrowed from
   the neighbouring month, because this grid is for looking at, and a leading
   "31" from the last month invites a mis-tap. */
export function monthGrid(year, monthIndex, rows = []) {
  const byDate = {}
  for (const r of rows || []) {
    if (r && r.work_date) byDate[r.work_date] = r
  }

  const first = new Date(year, monthIndex, 1)
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const mondayOffset = (first.getDay() + 6) % 7

  const cells = []
  for (let i = 0; i < mondayOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ key, day: d, record: byDate[key] || null })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/* The audit trail is stored as actions, because that is the right thing to
   store. Nobody should have to read `status:claimed->confirmed`. */
const AUDIT_LABELS = {
  created: 'Day recorded',
  amended: 'Day changed',
  'status:claimed->confirmed': 'Confirmed',
  'status:confirmed->claimed': 'Reopened',
  'status:claimed->disputed': 'Disputed',
  'status:disputed->claimed': 'Dispute withdrawn',
  'status:disputed->confirmed': 'Confirmed after a dispute',
  'status:confirmed->disputed': 'Disputed after confirming',
}

export function auditLabel(action) {
  if (!action) return 'Changed'
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action]
  // A status pair nobody has named yet still reads as a sentence rather than
  // as a database value.
  const m = /^status:(\w+)->(\w+)$/.exec(action)
  if (m) return `${m[1]} → ${m[2]}`
  return action
}

/* Which of the few colours this entry gets. Deliberately coarse: an audit list
   with nine colours is a list nobody reads. */
export function auditTone(action) {
  if (!action) return 'plain'
  if (action === 'created') return 'create'
  if (action === 'amended') return 'amend'
  if (action.includes('disputed')) return 'warn'
  if (action.endsWith('->confirmed')) return 'good'
  if (action.startsWith('status:confirmed->')) return 'warn'
  return 'plain'
}

/* What a worker's month adds up to, from the ledger rows they can see. Mirrors
   ledgerTotals but keyed to a person's own screen, and counts overtime, so the
   worker can see the same 2× the employer sees. */
export function workerMonthTotals(rows = []) {
  let worked = 0, overtime = 0, leave = 0, total = 0, equivalents = 0, awaiting = 0
  for (const r of rows || []) {
    if (!r) continue
    total += Number(r.amount) || 0
    equivalents += Number(r.multiplier) || 0
    if (r.kind === 'leave') leave += 1
    else {
      worked += 1
      if (r.kind === 'overtime') overtime += 1
    }
    if (r.status === 'claimed') awaiting += 1
  }
  return { worked, overtime, leave, total, equivalents, awaiting, days: (rows || []).length }
}

// ── Billing: the period, and what the bill will say ─────────────────────────

/* A period written the way a person would say it: "1–30 Sep 2026" inside one
   month, "28 Aug – 27 Sep 2026" across two. Built from the parsed keys rather
   than Date(locale), so the label cannot change with the device's language. */
export function periodLabel(from, to) {
  const a = parseDateKey(from)
  const b = parseDateKey(to)
  if (!a || !b) return ''
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${MON3[b.getMonth()]} ${b.getFullYear()}`
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} ${MON3[a.getMonth()]} – ${b.getDate()} ${MON3[b.getMonth()]} ${b.getFullYear()}`
  }
  return `${a.getDate()} ${MON3[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MON3[b.getMonth()]} ${b.getFullYear()}`
}

/* What could be billed for a period, one row per contractor (plus the
   unassigned), before anything is issued.

   The figures come from `summarise` — the same function the Summary pane and
   the payslip bridge already use — so the preview cannot invent a total. The
   issued document is a second aggregation of the same stored days in SQL, and
   the two are meant to agree exactly.

   One deliberate difference from `groupByContractor`: this groups EVERY worker,
   archived ones included. Somebody who left last week is still owed for the
   days they worked, so dropping them would quietly understate the bill. The SQL
   does not filter on status either. */
export function billingRows(contractors, employees, days, from, to) {
  const inPeriod = (days || []).filter(d => d && d.work_date >= from && d.work_date <= to)

  const groups = new Map()
  for (const c of contractors || []) {
    if (!c || !c.id) continue
    groups.set(c.id, { contractorId: c.id, name: c.name, workers: [] })
  }

  const unassigned = { contractorId: null, name: 'Unassigned workers', workers: [] }
  for (const e of employees || []) {
    if (!e || !e.id) continue
    const g = e.contractor_id ? groups.get(e.contractor_id) : null
    if (g) g.workers.push(e)
    else if (e.contractor_id) {
      // Days exist against a contractor no longer on the roster: still theirs
      // to pay, so the row is kept rather than silently merged into anything.
      let orphan = groups.get('unknown:' + e.contractor_id)
      if (!orphan) {
        orphan = { contractorId: e.contractor_id, name: 'Former contractor', workers: [] }
        groups.set('unknown:' + e.contractor_id, orphan)
      }
      orphan.workers.push(e)
    } else {
      unassigned.workers.push(e)
    }
  }

  const rows = []
  const build = (g, isUnassigned) => {
    const ids = new Set(g.workers.map(w => w.id))
    const groupDays = inPeriod.filter(d => ids.has(d.employee_id))
    const s = summarise(groupDays, g.workers)
    let worked = 0, leave = 0, equivalents = 0
    for (const r of s.rows) {
      worked += r.worked
      leave += r.leave
      equivalents += r.equivalents
    }
    rows.push({
      key: isUnassigned ? 'unassigned' : String(g.contractorId),
      contractorId: g.contractorId,
      name: g.name || 'Unnamed contractor',
      isUnassigned,
      hasRecords: s.rows.length > 0,
      workers: s.rows,               // only those with days in the period
      workerCount: s.rows.length,
      days: groupDays.length,
      worked,
      leave,
      equivalents: Math.round(equivalents * 100) / 100,
      total: s.total,
      claimed: s.unconfirmed,
      disputed: s.disputed,
    })
  }

  for (const g of groups.values()) build(g, false)
  build(unassigned, true)

  // Billable rows first, biggest first; then the rest by name. Unassigned sits
  // last on purpose — it is the leftovers, not a contractor.
  return rows.sort((a, b) => {
    if (a.hasRecords !== b.hasRecords) return a.hasRecords ? -1 : 1
    if (a.hasRecords && b.hasRecords && b.total !== a.total) return b.total - a.total
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1
    return String(a.name).localeCompare(String(b.name))
  })
}

/* Nothing recorded means nothing to bill. The database refuses an empty invoice
   too, so the button and the rule agree. */
export function isBillable(row) {
  return !!(row && row.hasRecords && row.days > 0)
}

/* A live (issued) invoice for exactly this contractor and period, if there is
   one. Voided documents are history: they no longer block the period. */
export function liveInvoiceFor(invoices, contractorId, from, to) {
  const same = (a, b) => (a || null) === (b || null)
  return (invoices || []).find(inv => inv && inv.status === 'issued'
    && inv.period_from === from && inv.period_to === to
    && same(inv.contractor_id, contractorId)) || null
}

export function invoiceStatusLabel(status) {
  if (status === 'void') return 'Voided'
  return 'Issued'
}
