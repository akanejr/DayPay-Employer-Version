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
