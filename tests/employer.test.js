/* DayPay Employer Version — employer logic tests.
 *
 * Pure functions only: no network, no Supabase, no dependencies. Run with
 * `npm test`. These exist because the employer workspace cannot be executed
 * against a live database from here, so the parts that CAN be verified
 * mechanically are verified.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  formatNaira, initials, monthBounds, todayKey,
  rateOn, multiplierFor, makeInviteCode, CODE_ALPHABET, summarise,
} from '../src/lib/employerLogic.js'

const emp = (id, name) => ({ id, full_name: name, status: 'active' })

const day = (employee_id, { amount = 16000, kind = 'work', status = 'claimed', mult = 1, date = '2026-05-01' } = {}) => ({
  employee_id, work_date: date, amount, kind, status, multiplier: mult,
})

// ── Formatting ──────────────────────────────────────────────────────────────

describe('formatNaira', () => {
  test('groups thousands deterministically', () => {
    assert.equal(formatNaira(0), '₦0')
    assert.equal(formatNaira(16000), '₦16,000')
    assert.equal(formatNaira(304000), '₦304,000')
    assert.equal(formatNaira(1234567), '₦1,234,567')
  })

  test('never prints NaN on a payroll figure', () => {
    assert.equal(formatNaira(NaN), '₦0')
    assert.equal(formatNaira(undefined), '₦0')
    assert.equal(formatNaira(null), '₦0')
    assert.equal(formatNaira(Infinity), '₦0')
  })

  test('numeric strings from Postgres numeric columns work', () => {
    // PostgREST returns numeric as a string; forgetting this silently prints ₦0.
    assert.equal(formatNaira('16000.00'), '₦16,000')
    assert.equal(formatNaira('32000'), '₦32,000')
  })

  test('negatives are signed, not destroyed', () => {
    assert.equal(formatNaira(-5000), '-₦5,000')
  })
})

describe('initials', () => {
  test('uses first and last name', () => {
    assert.equal(initials('Amina Yusuf'), 'AY')
    assert.equal(initials('Chidi Okonkwo Nwosu'), 'CN')
  })
  test('single names and empty names do not break', () => {
    assert.equal(initials('Amina'), 'AM')
    assert.equal(initials(''), '?')
    assert.equal(initials(null), '?')
    assert.equal(initials('   '), '?')
  })
})

// ── Dates ───────────────────────────────────────────────────────────────────

describe('monthBounds', () => {
  test('31-day months end on the 31st', () => {
    assert.deepEqual(monthBounds(2026, 0), { from: '2026-01-01', to: '2026-01-31' })
    assert.deepEqual(monthBounds(2026, 11), { from: '2026-12-01', to: '2026-12-31' })
  })

  test('30-day months end on the 30th', () => {
    assert.deepEqual(monthBounds(2026, 3), { from: '2026-04-01', to: '2026-04-30' })
  })

  test('February is 28 days in a common year, 29 in a leap year', () => {
    assert.equal(monthBounds(2026, 1).to, '2026-02-28')
    assert.equal(monthBounds(2028, 1).to, '2028-02-29')
    assert.equal(monthBounds(2000, 1).to, '2000-02-29', 'century leap year')
    assert.equal(monthBounds(1900, 1).to, '1900-02-28', 'century non-leap year')
  })

  test('months are zero-indexed and zero-padded', () => {
    assert.equal(monthBounds(2026, 8).from, '2026-09-01')
    assert.equal(monthBounds(2026, 0).from, '2026-01-01')
  })
})

describe('todayKey', () => {
  test('formats as YYYY-MM-DD from local parts', () => {
    assert.equal(todayKey(new Date(2026, 0, 5)), '2026-01-05')
    assert.equal(todayKey(new Date(2026, 11, 31)), '2026-12-31')
  })
})

// ── Rates: mirrors the server's own lookup ──────────────────────────────────

const P = [
  { effective_from: '2026-01-01', daily_rate: 16000, weekend_multiplier: 2, holiday_multiplier: 2 },
  { effective_from: '2026-06-01', daily_rate: 20000, weekend_multiplier: 2, holiday_multiplier: 2 },
]

describe('rateOn', () => {
  test('returns the period in force, inclusive of its start date', () => {
    assert.equal(rateOn(P, '2026-05-31').daily_rate, 16000)
    assert.equal(rateOn(P, '2026-06-01').daily_rate, 20000, 'inclusive on the effective date')
    assert.equal(rateOn(P, '2026-12-31').daily_rate, 20000)
  })

  test('a date before every period returns null, not the earliest rate', () => {
    // Returning the earliest rate here would value a day at a rate that did
    // not exist yet. The server raises instead; the UI must show the gap.
    assert.equal(rateOn(P, '2025-12-31'), null)
  })

  test('is order-independent', () => {
    assert.equal(rateOn([P[1], P[0]], '2026-07-01').daily_rate, 20000)
  })

  test('empty, null and missing dates are inert', () => {
    assert.equal(rateOn([], '2026-01-01'), null)
    assert.equal(rateOn(null, '2026-01-01'), null)
    assert.equal(rateOn(P, null), null)
    assert.equal(rateOn(P, ''), null)
  })

  test('a raise never reprices a day before it', () => {
    const before = rateOn(P, '2026-04-15')
    assert.equal(before.daily_rate, 16000)
    assert.notEqual(before.daily_rate, rateOn(P, '2026-07-15').daily_rate)
  })
})

describe('multiplierFor', () => {
  const period = { daily_rate: 16000, weekend_multiplier: 2, holiday_multiplier: 3 }

  test('weekend and weekday overtime both use the weekend multiplier', () => {
    assert.equal(multiplierFor('weekend', period), 2)
    assert.equal(multiplierFor('overtime', period), 2)
  })

  test('holiday uses the holiday multiplier', () => {
    assert.equal(multiplierFor('holiday', period), 3)
  })

  test('a plain day is 1', () => {
    assert.equal(multiplierFor('work', period), 1)
    assert.equal(multiplierFor(undefined, period), 1)
  })

  test('leave is a fraction of the daily rate', () => {
    assert.equal(multiplierFor('leave', period, 100), 1)
    assert.equal(multiplierFor('leave', period, 50), 0.5)
    assert.equal(multiplierFor('leave', period, 0), 0)
  })

  test('no period means no multiplier rather than a silent default', () => {
    assert.equal(multiplierFor('weekend', null), null)
  })
})

// ── Invite codes ────────────────────────────────────────────────────────────

describe('makeInviteCode', () => {
  test('has the requested length and draws only from the alphabet', () => {
    const code = makeInviteCode(8, () => 0.5)
    assert.equal(code.length, 8)
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `${ch} not in alphabet`)
  })

  test('avoids characters that are misread aloud', () => {
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      assert.ok(!CODE_ALPHABET.includes(bad), `${bad} should be excluded`)
    }
  })

  test('is deterministic for a given source', () => {
    assert.equal(makeInviteCode(6, () => 0), '222222')
  })
})

// ── Payroll summary ─────────────────────────────────────────────────────────

describe('summarise', () => {
  const staff = [emp('a', 'Amina'), emp('b', 'Chidi')]

  test('totals stored amounts, per employee and overall', () => {
    const days = [
      day('a', { amount: 16000 }), day('a', { amount: 16000 }), day('a', { amount: 16000 }),
      day('b', { amount: 32000, mult: 2 }),
    ]
    const s = summarise(days, staff)
    assert.equal(s.total, 80000)
    assert.equal(s.staffCount, 2)
    assert.equal(s.rows.find(r => r.employee.id === 'a').total, 48000)
    assert.equal(s.rows.find(r => r.employee.id === 'b').total, 32000)
  })

  test('THE CORE RULE: a raise never reprices days already worked', () => {
    // 10 days at ₦16,000, raise, 10 days at ₦20,000.
    const days = [
      ...Array.from({ length: 10 }, () => day('a', { amount: 16000 })),
      ...Array.from({ length: 10 }, () => day('a', { amount: 20000 })),
    ]
    const s = summarise(days, staff)
    assert.equal(s.total, 360000, 'sum of frozen amounts')
    assert.notEqual(s.total, 20 * 20000, 'must not multiply all days by the newest rate')
  })

  test('weekend work is counted once, not double-counted', () => {
    const s = summarise([day('a', { amount: 32000, kind: 'weekend', mult: 2 })], staff)
    const row = s.rows[0]
    assert.equal(row.days, 1)
    assert.equal(row.worked, 1)
    assert.equal(row.total, 32000)
    assert.equal(row.equivalents, 2, 'equivalents reflect the multiplier, not a second day')
  })

  test('leave is separate from worked days', () => {
    const s = summarise([
      day('a', { amount: 16000 }),
      day('a', { amount: 16000, kind: 'leave' }),
      day('a', { amount: 0, kind: 'leave' }),
    ], staff)
    const row = s.rows[0]
    assert.equal(row.days, 3, 'all three are recorded days')
    assert.equal(row.worked, 1, 'only one was worked')
    assert.equal(row.leave, 2)
    assert.equal(row.total, 32000)
    assert.equal(row.equivalents, 1, 'leave earns no equivalents')
  })

  test('counts what is unconfirmed and disputed', () => {
    const s = summarise([
      day('a', { status: 'confirmed' }),
      day('a', { status: 'claimed' }),
      day('b', { status: 'claimed' }),
      day('b', { status: 'disputed' }),
    ], staff)
    assert.equal(s.unconfirmed, 2)
    assert.equal(s.disputed, 1)
    assert.equal(s.rows.find(r => r.employee.id === 'a').confirmed, 1)
    assert.equal(s.rows.find(r => r.employee.id === 'b').disputed, 1)
  })

  test('REGRESSION: days for an unknown employee are still counted in the total', () => {
    // If the roster passed in is filtered to active staff but the days include
    // an archived person, dropping those days would UNDERSTATE what is owed —
    // the worst direction for this number to be wrong in.
    const s = summarise([
      day('a', { amount: 16000 }),
      day('archived-or-unloaded', { amount: 50000 }),
    ], staff)
    assert.equal(s.total, 66000, 'the unmatched day is still owed')
    assert.equal(s.unmatchedDays, 1)
    assert.equal(s.unmatchedTotal, 50000)
    assert.equal(s.staffCount, 1, 'only known employees get a row')
  })

  test('archived employees passed in explicitly still get a row', () => {
    const withArchived = [...staff, { id: 'c', full_name: 'Old Staff', status: 'archived' }]
    const s = summarise([day('c', { amount: 9000 })], withArchived)
    assert.equal(s.staffCount, 1)
    assert.equal(s.unmatchedDays, 0)
    assert.equal(s.rows[0].employee.status, 'archived')
  })

  test('empty inputs are inert', () => {
    const s = summarise([], staff)
    assert.equal(s.total, 0)
    assert.equal(s.staffCount, 0)
    assert.equal(s.unconfirmed, 0)
  })

  test('null and malformed inputs do not throw', () => {
    assert.doesNotThrow(() => summarise(null, null))
    assert.doesNotThrow(() => summarise([undefined, null], staff))
    assert.equal(summarise(null, staff).total, 0)
  })

  test('rows are ranked by amount, largest first', () => {
    const s = summarise([
      day('a', { amount: 1000 }),
      day('b', { amount: 9000 }),
    ], staff)
    assert.equal(s.rows[0].employee.id, 'b')
  })

  test('amounts arriving as strings are summed as numbers', () => {
    // PostgREST returns numeric columns as strings.
    const s = summarise([day('a', { amount: '16000.00' }), day('a', { amount: '5000.50' })], staff)
    assert.equal(s.total, 21000.5)
  })
})
