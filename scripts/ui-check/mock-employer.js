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

const DAYS = [
  { id: 'd1', employee_id: 'e1', work_date: '2026-09-08', kind: 'work', status: 'confirmed',
    amount: 16000, rate: 16000, multiplier: 1, source: 'check_in',
    checked_in_at: '2026-09-08T06:12:00Z', note: null },
  { id: 'd2', employee_id: 'e1', work_date: '2026-09-12', kind: 'overtime', status: 'claimed',
    amount: 32000, rate: 16000, multiplier: 2, source: 'employer', note: 'Night shift' },
]

const REQUESTS = [
  { id: 'r1', employee_id: 'e1', work_date: '2026-09-12', request_kind: 'reclassify',
    want_kind: 'overtime', status: 'open', message: 'I stayed late.',
    created_at: '2026-09-13T07:00:00Z' },
  { id: 'r2', employee_id: 'e1', work_date: '2026-09-02', request_kind: 'missing',
    status: 'approved', resolved_at: '2026-09-03T09:00:00Z', decision_note: 'Agreed.' },
]

const EVENTS = [
  { id: 1, employee_id: 'e1', actor: 'x', action: 'created', reason: null, created_at: '2026-09-08T06:12:00Z' },
  { id: 2, employee_id: 'e1', actor: 'x', action: 'amended', reason: 'Night shift', created_at: '2026-09-12T18:00:00Z' },
  { id: 3, employee_id: 'e1', actor: 'x', action: 'status:claimed->confirmed', reason: null, created_at: '2026-09-13T09:00:00Z' },
]

export const listEmployeeMonth = async () => DAYS
export const listEmployeeCorrections = async () => REQUESTS
export const listEmployeeEvents = async () => EVENTS
export const listAllMonth = async () => DAYS.concat(BILLING_DAYS)
export const listOpenCorrections = async () => REQUESTS.filter(r => r.status === 'open')
export const myMonth = async () => DAYS
export const myCorrections = async () => REQUESTS
export const myRatePeriods = async () => [
  { id: 'p1', employee_id: 'e1', effective_from: '2026-01-01', daily_rate: 16000, weekend_multiplier: 2, holiday_multiplier: 2 },
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
export const clearDay = async () => ({})
export const setDay = async () => ({})
export const withdrawCorrection = async (id) => { globalThis.__calls.push(['withdrawCorrection', id]); return {} }

export const redeemInvite = async () => ({})
export const leaveRoster = async () => ({})
export const myAttendanceStatus = async () => null
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
  contractor_id: 'c1', created_at: '2026-01-01T00:00:00Z',
}]
const PERIODS = [{
  id: 'p1', employee_id: 'e1', effective_from: '2026-01-01',
  daily_rate: 16000, weekend_multiplier: 2, holiday_multiplier: 2,
}]

export const ensureEmployer = async () => ({ user_id: 'o1', business_name: 'Eddimore', kind: 'business' })
export const updateBusinessName = async () => ({})
export const listEmployees = async () => EMPLOYEES
export const createEmployee = async () => EMPLOYEES[0]
export const updateEmployee = async () => EMPLOYEES[0]
export const archiveEmployee = async () => ({})
export const restoreEmployee = async () => ({})
export const unlinkEmployeeAccount = async () => ({})
export const setEmployeeContractor = async () => ({})
export const listRatePeriods = async () => PERIODS
export const listAllRatePeriods = async () => PERIODS
export const addRatePeriod = async () => PERIODS[0]
export const updateRatePeriod = async () => PERIODS[0]
export const deleteRatePeriod = async () => ({})
export const listContractors = async () => CONTRACTORS
export const createContractor = async () => CONTRACTORS[0]
export const updateContractor = async () => CONTRACTORS[0]
export const archiveContractor = async () => ({})
export const restoreContractor = async () => ({})
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
  PIN_STATE[id] = { has_pin: true, set_at: '2026-09-30T08:00:00Z', locked_until: null }
  return '4821'
}
export function setPinFixtures(next) { PIN_STATE = next || {} }
export const myRoles = async () => ({
  uid: 'o1', isEmployer: true, kind: 'business', isBusiness: true,
  businessName: 'Eddimore', employee: null,
})

// ── billing (Phase 7) ──────────────────────────────────────────────────────
// Two contractors: one already billed for the period, one still to bill. Both
// states matter — the row that offers a button and the row that explains why it
// does not.

const BILLING_EMPLOYEES = [
  { id: 'e2', employer_id: 'o1', full_name: 'Timothy Bassey', job_title: 'Welder',
    email: null, employee_user_id: null, invite_code: null, status: 'active',
    contractor_id: 'c2', created_at: '2026-02-01T00:00:00Z' },
]

const BILLING_DAYS = [
  { id: 'd9', employee_id: 'e2', work_date: '2026-09-09', kind: 'work', status: 'confirmed',
    amount: 14000, rate: 14000, multiplier: 1, source: 'employer', note: null },
  { id: 'd10', employee_id: 'e2', work_date: '2026-09-13', kind: 'weekend', status: 'claimed',
    amount: 28000, rate: 14000, multiplier: 2, source: 'employer', note: null },
]

const INVOICES = [
  { id: 'i1', employer_id: 'o1', contractor_id: 'c1', contractor_name: 'Contractor A',
    number: 'INV-0001', period_from: '2026-09-01', period_to: '2026-09-30', status: 'issued',
    note: null, void_reason: null, issued_at: '2026-09-30T18:00:00Z', voided_at: null,
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
      contractor_id: 'c1', created_at: '2026-01-01T00:00:00Z' },
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
    status: 'issued', note, void_reason: null, issued_at: '2026-09-30T19:00:00Z',
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
  if (row) { row.status = 'void'; row.void_reason = reason; row.voided_at = '2026-09-30T20:00:00Z' }
  return row || {}
}

/* The check swaps the fixtures to reproduce one particular state — a period
   where everything recorded has already been billed. Without this there is no
   way to exercise the all-billed card, which is the state that used to print a
   self-contradicting headline. */
export function setInvoiceFixtures(next) {
  INVOICES.length = 0
  for (const row of next || []) INVOICES.push(row)
}
