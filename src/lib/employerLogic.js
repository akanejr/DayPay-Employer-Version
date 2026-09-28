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
