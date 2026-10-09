/* Stands in for src/lib/employer.js — the NETWORK half only.
 *
 * The pure half is re-exported from the real employerLogic.js. That file has
 * zero imports, so it runs here unchanged, and it means this check renders the
 * code that ships rather than a paraphrase of it. An earlier version of this
 * mock hand-wrote monthGrid and contractorRollup, and both lied: the rollup
 * returned no rows for a worker who had none recorded, so a screen that was
 * fine looked broken.
 */

export * from '../../src/lib/employerLogic.js'
/* Imported as well as re-exported: the day writes below have to value a day the
   way the server's trigger does, and that rule lives in this module. */
import { rateOn, multiplierFor, monthBounds } from '../../src/lib/employerLogic.js'

export class EmployerError extends Error {
  constructor(message, { hint, code, cause } = {}) {
    super(message)
    this.name = 'EmployerError'
    this.hint = hint
    this.code = code
    this.cause = cause
  }
}

// ── fixtures shaped like real rows ─────────────────────────────────────────

/* THE DATES ARE COMPUTED FROM TODAY, NOT HARDCODED.
 *
 * They used to be pinned to September 2026, and this suite therefore stopped
 * testing anything the moment the calendar moved to October: the app opens on
 * the CURRENT month, so September's days were not on screen at all. It failed
 * with "0 marked cell(s)" and an empty billing period — which reads exactly
 * like a broken app, and was in fact a broken test. Found on 1 October 2026.
 *
 * Days are now chosen inside the current month, and chosen for what they MEAN:
 * the plain working days are weekdays (the app marks weekends 2×, so a fixture
 * that landed on a Saturday would not mean what the check says it means), and
 * the one weekend row is a real weekend day. Day numbers stay inside the first
 * 28 so they exist in every month, including February.
 */
const NOW = new Date()
const YEAR = NOW.getFullYear()
const MONTH = NOW.getMonth()                              // 0-based
const MONTH_KEY = `${YEAR}-${String(MONTH + 1).padStart(2, '0')}`
const MONTH_NAME = NOW.toLocaleString('en-GB', { month: 'short' })
const LAST_DAY = new Date(YEAR, MONTH + 1, 0).getDate()
const TODAY_DAY = Math.min(NOW.getDate(), LAST_DAY)
/* Well before the fixture month, and derived rather than pinned: a rate period
   has to start on or before the days it prices, and employee created_at is
   carried as a display date. Pinning these to a literal is how the September
   fixtures rotted — see the note above. */
const EARLIER = new Date(YEAR, MONTH - 3, 1)
const EARLIER_KEY = `${EARLIER.getFullYear()}-${String(EARLIER.getMonth() + 1).padStart(2, '0')}-01`

function firstMatching(from, pred) {
  for (let d = from; d <= 28; d++) if (pred(new Date(YEAR, MONTH, d).getDay())) return d
  return from
}
const WEEKDAY = (wd) => wd !== 0 && wd !== 6
const WORK_DAY = firstMatching(1, WEEKDAY)
const OT_DAY = firstMatching(WORK_DAY + 1, WEEKDAY)
const MISSING_DAY = firstMatching(OT_DAY + 1, WEEKDAY)
const WEEKEND_DAY = firstMatching(1, (wd) => !WEEKDAY(wd))

const DATE = (d) => `${MONTH_KEY}-${String(d).padStart(2, '0')}`
const STAMP = (d, time) => `${DATE(d)}T${time}`
const LABEL = (d) => `${d} ${MONTH_NAME} ${YEAR}`          // e.g. "8 Oct 2026"

export const FIXTURE = {
  WORK_DAY, OT_DAY, MISSING_DAY, WEEKEND_DAY, TODAY_DAY, LAST_DAY,
  MONTH_KEY, MONTH_NAME, YEAR, DATE, LABEL, STAMP,
}


const DAYS = [
  { id: 'd1', employee_id: 'e1', work_date: DATE(WORK_DAY), kind: 'work', status: 'confirmed',
    amount: 16000, rate: 16000, multiplier: 1, source: 'check_in',
    checked_in_at: STAMP(WORK_DAY, '06:12:00Z'), note: null, attendance_method: 'mobile' },
  { id: 'd2', employee_id: 'e1', work_date: DATE(OT_DAY), kind: 'overtime', status: 'claimed',
    amount: 32000, rate: 16000, multiplier: 2, source: 'employer', note: 'Night shift' },
]

const REQUESTS = [
  { id: 'r1', employee_id: 'e1', work_date: DATE(OT_DAY), request_kind: 'reclassify',
    want_kind: 'overtime', status: 'open', message: 'I stayed late.',
    created_at: STAMP(OT_DAY, '20:00:00Z') },
  { id: 'r2', employee_id: 'e1', work_date: DATE(MISSING_DAY), request_kind: 'missing',
    status: 'approved', resolved_at: STAMP(MISSING_DAY, '09:00:00Z'), decision_note: 'Agreed.' },
]

const EVENTS = [
  { id: 1, employee_id: 'e1', actor: 'x', action: 'created', reason: null, created_at: STAMP(WORK_DAY, '06:12:00Z') },
  { id: 2, employee_id: 'e1', actor: 'x', action: 'amended', reason: 'Night shift', created_at: STAMP(OT_DAY, '18:00:00Z') },
  { id: 3, employee_id: 'e1', actor: 'x', action: 'status:claimed->confirmed', reason: null, created_at: STAMP(OT_DAY, '18:00:00Z') },
]

/* A way to add one day for the length of one check, then take it away again.
   The calendar check counts marked cells, so a fixture that stayed would make
   an unrelated assertion fail — and a suite whose fixtures leak into each other
   is a suite that fails for reasons nobody can see. */
export function addMonthFixture(row) { DAYS.push(row) }

/* A rate period for one check at a time, so a worker staged into the roster can
   have a price and their profile has money on it. Taken away again with
   removeRateFixture, for the same reason addMonthFixture is. */
export function addRateFixture(row) { PERIODS.push(row) }
export function removeRateFixture(id) {
  const i = PERIODS.findIndex((p) => p.id === id)
  if (i >= 0) PERIODS.splice(i, 1)
}
export function removeMonthFixture(id) {
  const i = DAYS.findIndex(d => d.id === id)
  if (i >= 0) DAYS.splice(i, 1)
}

/* Which month this screen asked for, and whether the read is allowed to fail.
   Both exist so a check can prove a thing the screen only claims: that stepping
   the month actually fetches that month, and that a failed load says so instead
   of drawing a blank pane. Reads are logged separately from writes — `__calls`
   already means "what the screen sent", and a read sent to the database is part
   of that story too. */
let failedRead = null
export function setReadFailure(name) { failedRead = name || null }
/* The message is the screen's words, not the database's, and each screen has its
   own: a kiosk that could not be reached is not a worker who could not be loaded,
   and a check that asks for the wrong one would pass on the wrong sentence. */
const guard = (name, message = 'Could not load this worker') => {
  if (failedRead === name) {
    throw new EmployerError(message, {
      hint: 'Check your connection, then try again.', code: 'NETWORK',
    })
  }
}

/* ONE worker's month, filtered the way the query filters it — by employee and by
   the month's bounds (see listEmployeeMonth in src/lib/employer.js). It used to
   return every row of every worker, which made this screen's figures larger than
   the same figures on any other screen and let a day from last month sit in this
   month's total. A mock that answers a different question from the real thing
   hides exactly the class of defect this suite exists to catch. */
export const listEmployeeMonth = async (employeeId, year, month) => {
  globalThis.__calls.push(['listEmployeeMonth', employeeId, year, month])
  guard('listEmployeeMonth')
  const { from, to } = monthBounds(year, month)
  return DAYS.filter(d => d.employee_id === employeeId && d.work_date >= from && d.work_date <= to)
}
export const listEmployeeCorrections = async () => { guard('listEmployeeCorrections'); return REQUESTS }
export const listEmployeeEvents = async () => { guard('listEmployeeEvents'); return EVENTS }
/* The real query filters server-side by the month's bounds. Called with no
   arguments — which is what today.jsx and attendance.jsx do, to read the whole
   fixture and compare it with the screen — it returns everything; the screens
   always pass a month, and this is where a wrong month stops being invisible. The
   shortcut belongs to the checks, not to the app. */
export const listAllMonth = async (year, month) => {
  const rows = DAYS.concat(BILLING_DAYS)
  if (year === undefined || month === undefined) return rows
  const { from, to } = monthBounds(year, month)
  return rows.filter(d => d.work_date >= from && d.work_date <= to)
}
export const listOpenCorrections = async () => REQUESTS.filter(r => r.status === 'open')
/* The worker's own month, filtered the way the real query filters it. It used to
   hand back every fixture day whatever month was asked for — the same defect
   `listAllMonth` had, found the same way: a check that wanted to prove "a month with
   nothing in it says so" could not, because the mock never had an empty month. */
export const myMonth = async (employeeId, year, month) => {
  globalThis.__calls.push(['myMonth', employeeId, year, month])
  guard('myMonth', 'Could not load your month')
  const rows = DAYS.filter(d => d.employee_id === employeeId)
  if (year === undefined || month === undefined) return rows
  const { from, to } = monthBounds(year, month)
  return rows.filter(d => d.work_date >= from && d.work_date <= to)
}
export const myCorrections = async () => {
  globalThis.__calls.push(['myCorrections'])
  guard('myCorrections', 'Could not load your requests')
  return REQUESTS
}
export const myRatePeriods = async () => [
  { id: 'p1', employee_id: 'e1', effective_from: EARLIER_KEY, daily_rate: 16000, weekend_multiplier: 2, holiday_multiplier: 2 },
]

/* Every write records what it was called with, so an interaction check can
   assert on the ARGUMENTS and not merely on a screen changing. */
globalThis.__calls = []
export const resolveCorrection = async (id, approve, note) => {
  globalThis.__calls.push(['resolveCorrection', id, approve, note])
  return {}
}
export const requestCorrection = async (employeeId, workDate, opts) => {
  globalThis.__calls.push(['requestCorrection', employeeId, workDate, opts])
  return {}
}
export const confirmDay = async () => ({})
export const disputeDay = async () => ({})
export const reopenDay = async () => ({})
/* A day written the way the DATABASE writes it: the rate comes from the period
   in force on the work date, the multiplier from the kind, and the amount from
   the two of them. The screen is never allowed to send or compute a figure, so
   this mock must not either — a mock that took an amount would hide the exact
   defect the real trigger exists to prevent.

   The row is spliced into the month's fixtures because the database row
   persists: a check that marks a day and then re-reads the screen is reading
   what an employer sees after a reload, not a local guess. */
let madeDays = 0
export const setDay = async (employeeId, workDate, kind, { leaveType = null, leavePercent = 0, note = null } = {}) => {
  const period = rateOn(PERIODS.filter(p => p.employee_id === employeeId), workDate)
  if (!period) throw new EmployerError(`No rate period covers ${workDate}`, { code: 'P0001' })
  const multiplier = multiplierFor(kind, period, kind === 'leave' ? leavePercent : 0)
  madeDays += 1
  const row = {
    id: `made-${madeDays}`, employee_id: employeeId, work_date: workDate, kind,
    status: 'claimed', rate: period.daily_rate, multiplier,
    amount: Math.round(period.daily_rate * multiplier * 100) / 100,
    source: 'employer', note, attendance_method: null,
    ...(kind === 'leave' ? { leave_type: leaveType || 'annual', leave_percent: leavePercent } : {}),
  }
  const at = DAYS.findIndex(d => d.employee_id === employeeId && d.work_date === workDate)
  if (at >= 0) DAYS.splice(at, 1, row)     // the upsert: one row per person per day
  else DAYS.push(row)
  globalThis.__calls.push(['setDay', employeeId, workDate, kind])
  return row
}

export const clearDay = async (employeeId, workDate) => {
  const at = DAYS.findIndex(d => d.employee_id === employeeId && d.work_date === workDate)
  if (at >= 0) DAYS.splice(at, 1)
  globalThis.__calls.push(['clearDay', employeeId, workDate])
  return {}
}
export const withdrawCorrection = async (id) => { globalThis.__calls.push(['withdrawCorrection', id]); return {} }

export const redeemInvite = async () => ({})
export const leaveRoster = async () => ({})
/* The status behind the check-in card: no session, an open one, or a load that
   failed. All three are screens, and the difference between the last two is the
   whole point of Phase 14 — a screen that never reached the database must not say
   "nothing is open today". */
let ATT_STATUS = null
export function setAttendanceStatus(next) { ATT_STATUS = next }
export const myAttendanceStatus = async () => {
  globalThis.__calls.push(['myAttendanceStatus'])
  guard('myAttendanceStatus', 'Could not check today’s attendance')
  return ATT_STATUS
}
export const checkIn = async () => ({ ok: false, message: 'no code' })
export const todaysSession = async () => null
export const listSessionsForDate = async () => []
export const openAttendance = async () => ({})
export const closeAttendance = async () => ({})

// ── the rest of the employer data layer, for the pre-existing panes ────────

const CONTRACTORS = [{ id: 'c1', name: 'Contractor A', status: 'active', note: null }]
const EMPLOYEES = [{
  id: 'e1', employer_id: 'o1', full_name: 'James Okon', job_title: 'Rigger',
  email: null, employee_user_id: null, invite_code: null, status: 'active',
  contractor_id: 'c1', created_at: EARLIER_KEY + 'T00:00:00Z',
}]
const PERIODS = [{
  id: 'p1', employee_id: 'e1', effective_from: EARLIER_KEY,
  daily_rate: 16000, weekend_multiplier: 2, holiday_multiplier: 2,
}]

export const ensureEmployer = async () => ({ user_id: 'o1', business_name: workplaceName(), kind: 'business' })

/* Phase 17 — the workplace name is state here, not a constant, because the point
   of the screen is that saving it changes what every other surface reads. A check
   that typed a name and watched a fixed 'Eddimore' come back would be watching
   nothing. The failure switch is the same shape as setReadFailure: a save that
   cannot complete must say so, and a check has to be able to make it fail. */
let businessNameValue = 'Eddimore'
let businessNameFailure = null
export const workplaceName = () => businessNameValue
export function setBusinessNameFailure(message) { businessNameFailure = message || null }
export function resetBusinessName(name = 'Eddimore') { businessNameValue = name; businessNameFailure = null }
export const updateBusinessName = async (name) => {
  globalThis.__calls.push(['updateBusinessName', name])
  if (businessNameFailure) {
    throw new EmployerError(businessNameFailure, {
      hint: 'Check your connection, then try again.', code: 'NETWORK',
    })
  }
  businessNameValue = name
  return { user_id: 'o1', business_name: name }
}
/* Off by default; a check that needs an archived worker turns it on and off
   again, so no other assertion sees a roster of two. */
let archivedFixture = null
export const setArchivedEmployee = (on) => {
  archivedFixture = on
    ? { ...EMPLOYEES[0], id: 'e2', full_name: 'Peter Bassey', status: 'archived',
        invite_code: null, employee_user_id: null }
    : null
}
/* Workers staged into the roster for the length of one check. The roster screens
   need more than one person to be worth checking at all — a search over a list of
   one finds everything — and they need the two account states side by side. Off by
   default and cleared by the check that turned it on, so no other file sees a
   roster of three. */
let extras = []
export function setExtraEmployees(next) { extras = next || [] }
/* The roster a new employer actually starts with. Staged for one check and taken
   away again, because an empty roster is a screen state worth checking and a
   terrible default for every other check in the suite. */
let emptyRoster = false
export function setRosterEmpty(on) { emptyRoster = !!on }
export const listEmployees = async () => {
  /* Empty means empty: no base roster, no staged workers, no archived fixture.
     This is the first run of a new employer, and it is checked as exactly that. */
  if (emptyRoster) return []
  const base = archivedFixture ? [...EMPLOYEES, archivedFixture] : EMPLOYEES
  return extras.length ? [...base, ...extras] : base
}
/* The one write the add-a-worker form makes. It is recorded so a check can insist
   that NOTHING was sent when the form had nothing to send, and the row it returns
   carries the name that was typed — a mock that always answered "James Okon" would
   let a confirmation card that ignores the form look correct. It does NOT join the
   roster: a fixture that grew every time somebody pressed a button would leak into
   every check that ran afterwards. */
export const createEmployee = async ({ fullName = null } = {}) => {
  globalThis.__calls.push(['createEmployee', fullName])
  return { ...EMPLOYEES[0], full_name: fullName || EMPLOYEES[0].full_name }
}
export const updateEmployee = async () => EMPLOYEES[0]
/* The roster's writes record what they were called with, for the same reason
   the correction and invoice writes do: "the button still works" is a claim
   about arguments reaching the data layer, not about a button existing. */
export const archiveEmployee = async (id) => { globalThis.__calls.push(['archiveEmployee', id]); return {} }
export const restoreEmployee = async (id) => { globalThis.__calls.push(['restoreEmployee', id]); return {} }
export const unlinkEmployeeAccount = async (id) => { globalThis.__calls.push(['unlinkEmployeeAccount', id]); return {} }
export const setEmployeeContractor = async (id, contractorId) => {
  globalThis.__calls.push(['setEmployeeContractor', id, contractorId]); return {}
}
export const listRatePeriods = async () => PERIODS
export const listAllRatePeriods = async () => PERIODS
export const addRatePeriod = async () => PERIODS[0]
export const updateRatePeriod = async () => PERIODS[0]
export const deleteRatePeriod = async () => ({})
export const listContractors = async () => CONTRACTORS
export const createContractor = async (name) => {
  globalThis.__calls.push(['createContractor', name]); return CONTRACTORS[0]
}
export const updateContractor = async (id, patch) => {
  globalThis.__calls.push(['updateContractor', id, patch?.name ?? patch]); return CONTRACTORS[0]
}
export const archiveContractor = async (id) => { globalThis.__calls.push(['archiveContractor', id]); return {} }
export const restoreContractor = async (id) => { globalThis.__calls.push(['restoreContractor', id]); return {} }
export const contractorsAvailable = () => true
export const resetSchemaProbes = () => {}
export const correctionsAvailable = () => true
export const markCorrectionsMissing = () => {}
export const issueInviteCode = async () => 'ABCD1234'

/* ── Phase 11: the attendance PIN ───────────────────────────────────────────
   The mock has to model the two facts the panel branches on, because they are
   what the screen is FOR: a worker who has never had a PIN, and one who has.
   `setAttendancePin` returns a value, like the real RPC, so the panel's
   "shown once" branch is exercised. */
let PIN_STATE = {}
export const employeePinStatus = async (id) => PIN_STATE[id] || { has_pin: false, set_at: null, locked_until: null }
export const setAttendancePin = async (id) => {
  PIN_STATE[id] = { has_pin: true, set_at: STAMP(TODAY_DAY, '08:00:00Z'), locked_until: null }
  return '4821'
}
export function setPinFixtures(next) { PIN_STATE = next || {} }
/* And the account itself can be either kind: a worker's settings must not offer a
   workplace to name, and "the door is not drawn for them" is only a claim until a
   check can be that account. On by default; the check that turns it off turns it
   back on. */
let employerAccount = true
export function setEmployerAccount(on) { employerAccount = on !== false }

export const myRoles = async () => (employerAccount
  ? {
      uid: 'o1', isEmployer: true, kind: 'business', isBusiness: true,
      businessName: workplaceName(), employee: null,
    }
  : {
      uid: 'o1', isEmployer: false, kind: null, isBusiness: false,
      businessName: null, employee: null,
    })

// ── billing (Phase 7) ──────────────────────────────────────────────────────
// Two contractors: one already billed for the period, one still to bill. Both
// states matter — the row that offers a button and the row that explains why it
// does not.

const BILLING_EMPLOYEES = [
  { id: 'e2', employer_id: 'o1', full_name: 'Timothy Bassey', job_title: 'Welder',
    email: null, employee_user_id: null, invite_code: null, status: 'active',
    contractor_id: 'c2', created_at: EARLIER_KEY + 'T00:00:00Z' },
]

const BILLING_DAYS = [
  { id: 'd9', employee_id: 'e2', work_date: DATE(WORK_DAY), kind: 'work', status: 'confirmed',
    amount: 14000, rate: 14000, multiplier: 1, source: 'employer', note: null },
  { id: 'd10', employee_id: 'e2', work_date: DATE(WEEKEND_DAY), kind: 'weekend', status: 'claimed',
    amount: 28000, rate: 14000, multiplier: 2, source: 'employer', note: null },
]

const INVOICES = [
  { id: 'i1', employer_id: 'o1', contractor_id: 'c1', contractor_name: 'Contractor A',
    number: 'INV-0001', period_from: DATE(1), period_to: DATE(LAST_DAY), status: 'issued',
    note: null, void_reason: null, issued_at: STAMP(LAST_DAY, '18:00:00Z'), voided_at: null,
    worker_count: 1, actual_days: 2, leave_days: 0, equivalents: 3, total: 48000,
    confirmed_days: 1, claimed_days: 1, disputed_days: 0 },
]

const INVOICE_LINES = [
  { id: 'il1', invoice_id: 'i1', employee_id: 'e1', employee_name: 'James Okon',
    job_title: 'Rigger', days: 2, worked: 2, leave_days: 0, equivalents: 3,
    amount: 48000, confirmed_days: 1, claimed_days: 1, disputed_days: 0 },
]

export const billingFixtures = {
  contractors: [
    { id: 'c1', name: 'Contractor A', status: 'active', note: null },
    { id: 'c2', name: 'Contractor B', status: 'active', note: null },
  ],
  employees: [
    { id: 'e1', employer_id: 'o1', full_name: 'James Okon', job_title: 'Rigger',
      email: null, employee_user_id: null, invite_code: null, status: 'active',
      contractor_id: 'c1', created_at: EARLIER_KEY + 'T00:00:00Z' },
    ...BILLING_EMPLOYEES,
  ],
  days: BILLING_DAYS,
}

export const invoicesAvailable = () => true
export const listInvoices = async () => INVOICES.slice()
export const listInvoiceLines = async (id) => INVOICE_LINES.filter(l => l.invoice_id === id)

/* The real one sends three identifiers and a note — never a figure. The check
   asserts exactly that. */
export const issueInvoice = async (contractorId, from, to, note) => {
  globalThis.__calls.push(['issueInvoice', contractorId, from, to, note])
  const row = {
    id: `i${INVOICES.length + 1}`, employer_id: 'o1', contractor_id: contractorId,
    contractor_name: contractorId === 'c2' ? 'Contractor B' : 'Unassigned workers',
    number: `INV-000${INVOICES.length + 1}`, period_from: from, period_to: to,
    status: 'issued', note, void_reason: null, issued_at: STAMP(LAST_DAY, '19:00:00Z'),
    voided_at: null, worker_count: 1, actual_days: 2, leave_days: 0, equivalents: 3,
    total: 42000, confirmed_days: 1, claimed_days: 1, disputed_days: 0,
  }
  INVOICES.push(row)
  INVOICE_LINES.push({
    id: `il${INVOICE_LINES.length + 1}`, invoice_id: row.id, employee_id: 'e2',
    employee_name: 'Timothy Bassey', job_title: 'Welder', days: 2, worked: 2,
    leave_days: 0, equivalents: 3, amount: 42000, confirmed_days: 1, claimed_days: 1,
    disputed_days: 0,
  })
  return row
}

export const voidInvoice = async (id, reason) => {
  globalThis.__calls.push(['voidInvoice', id, reason])
  const row = INVOICES.find(i => i.id === id)
  if (row) { row.status = 'void'; row.void_reason = reason; row.voided_at = STAMP(LAST_DAY, '20:00:00Z') }
  return row || {}
}

/* The check swaps the fixtures to reproduce one particular state — a period
   where everything recorded has already been billed. Without this there is no
   way to exercise the all-billed card, which is the state that used to print a
   self-contradicting headline. */
/* Contractors, staged the same way the invoices and the machines are: a check that
   needs a contractor who is NOT the one on the list (to prove what an empty list
   says) swaps the fixture, and puts it back at the foot of the file that swapped it. */
export function setContractorFixtures(next) {
  CONTRACTORS.length = 0
  for (const row of next || []) CONTRACTORS.push(row)
}

export function setInvoiceFixtures(next) {
  INVOICES.length = 0
  for (const row of next || []) INVOICES.push(row)
}

// ── the site kiosks (Phase 12) ──────────────────────────────────────────────

const DEVICES = [
  { id: 'dv1', label: 'Gate kiosk', status: 'active', link_code: null,
    device_user_id: 'kiosk-account', created_at: STAMP(TODAY_DAY, '07:00:00Z'),
    linked_at: STAMP(TODAY_DAY, '07:04:00Z'), revoked_at: null, last_seen_at: STAMP(TODAY_DAY, '06:31:00Z') },
  { id: 'dv2', label: 'Site kiosk', status: 'pending', link_code: 'K7QM24RD',
    device_user_id: null, created_at: STAMP(TODAY_DAY, '06:00:00Z'),
    linked_at: null, revoked_at: null, last_seen_at: null },
]

export function setDeviceFixtures(next) {
  DEVICES.length = 0
  for (const row of next || []) DEVICES.push(row)
}

// `null` is the honest answer for a project that has not run migration 019, and
// the panel has a screen for it — so the check has to be able to ask for it.
export function setDevicesMissing(yes) { DEVICES_MISSING = !!yes }
let DEVICES_MISSING = false

export const listDevices = async () => {
  globalThis.__calls.push(['listDevices'])
  guard('listDevices', 'Could not load your machines')
  if (DEVICES_MISSING) return null
  return DEVICES.map(d => ({ ...d }))
}

/* The code is a one-time credential, so it is minted once and then only ever
   read. A mock that re-randomised it on every render would hide a screen that
   flickers, which is one of the things this card must not do. */
export const createDevice = async (label = 'Site kiosk') => {
  globalThis.__calls.push(['createDevice', label])
  const row = {
    id: `dv${DEVICES.length + 1}`, label, status: 'pending', link_code: 'NEW24RD' + DEVICES.length,
    device_user_id: null, created_at: STAMP(TODAY_DAY, '07:00:00Z'),
    linked_at: null, revoked_at: null, last_seen_at: null,
  }
  DEVICES.unshift(row)
  return { ...row }
}

export const revokeDevice = async (id) => {
  globalThis.__calls.push(['revokeDevice', id])
  const row = DEVICES.find(d => d.id === id)
  if (row) {
    row.status = 'revoked'; row.link_code = null
    row.device_user_id = null; row.revoked_at = STAMP(TODAY_DAY, '07:30:00Z')
  }
  return row ? { ...row } : {}
}
