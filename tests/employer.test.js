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

// ── Date keys and day kinds ─────────────────────────────────────────────────
// These matter because a weekend day earns 2×, so if the weekday is computed
// wrongly the money is wrong. `new Date('2026-05-02')` is UTC midnight and
// shifts the weekday backwards in zones behind UTC, so parsing is explicit.

import {
  parseDateKey, isWeekendKey, shiftDateKey, suggestedKind,
  prettyDateKey, shortDateKey, KIND_LABELS,
} from '../src/lib/employerLogic.js'

describe('parseDateKey', () => {
  test('parses a valid key to local parts', () => {
    const d = parseDateKey('2026-05-02')
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 4, 'May is month index 4')
    assert.equal(d.getDate(), 2)
  })

  test('rejects impossible dates instead of rolling them over', () => {
    // new Date(2026, 1, 31) silently becomes 3 March. That would mark the
    // wrong day, so the parser must refuse it.
    assert.equal(parseDateKey('2026-02-31'), null)
    assert.equal(parseDateKey('2026-13-01'), null)
    assert.equal(parseDateKey('2026-00-10'), null)
  })

  test('rejects malformed and non-string input', () => {
    assert.equal(parseDateKey('2026-5-2'), null)
    assert.equal(parseDateKey(''), null)
    assert.equal(parseDateKey(null), null)
    assert.equal(parseDateKey(undefined), null)
    assert.equal(parseDateKey(20260502), null)
  })
})

describe('isWeekendKey', () => {
  test('identifies Saturday and Sunday', () => {
    assert.equal(isWeekendKey('2026-05-02'), true, 'Sat 2 May 2026')
    assert.equal(isWeekendKey('2026-05-03'), true, 'Sun 3 May 2026')
  })

  test('weekdays are not weekends', () => {
    assert.equal(isWeekendKey('2026-05-01'), false, 'Fri 1 May 2026')
    assert.equal(isWeekendKey('2026-05-04'), false, 'Mon 4 May 2026')
    assert.equal(isWeekendKey('2026-05-08'), false, 'Fri 8 May 2026')
  })

  test('an invalid key is not silently treated as a weekend', () => {
    assert.equal(isWeekendKey('nonsense'), false)
    assert.equal(isWeekendKey(null), false)
  })
})

describe('suggestedKind', () => {
  test('THE MONEY RULE: the kind follows the date, not the tap', () => {
    // Marking "present" on a Saturday must record weekend work, because that
    // earns the multiplier. Defaulting to plain 'work' would underpay.
    assert.equal(suggestedKind('2026-05-02'), 'weekend')
    assert.equal(suggestedKind('2026-05-03'), 'weekend')
    assert.equal(suggestedKind('2026-05-04'), 'work')
  })
})

describe('shiftDateKey', () => {
  test('moves a day at a time', () => {
    assert.equal(shiftDateKey('2026-05-02', 1), '2026-05-03')
    assert.equal(shiftDateKey('2026-05-02', -1), '2026-05-01')
  })

  test('crosses month and year boundaries', () => {
    assert.equal(shiftDateKey('2026-05-31', 1), '2026-06-01')
    assert.equal(shiftDateKey('2026-06-01', -1), '2026-05-31')
    assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01')
    assert.equal(shiftDateKey('2027-01-01', -1), '2026-12-31')
  })

  test('handles leap day', () => {
    assert.equal(shiftDateKey('2028-02-28', 1), '2028-02-29')
    assert.equal(shiftDateKey('2028-02-29', 1), '2028-03-01')
  })

  test('an invalid key stays invalid', () => {
    assert.equal(shiftDateKey('nonsense', 1), null)
    assert.equal(shiftDateKey(null, 1), null)
  })
})

describe('display helpers', () => {
  test('prettyDateKey names the weekday', () => {
    assert.match(prettyDateKey('2026-05-02'), /^Sat 2 May 2026$/)
  })
  test('shortDateKey is compact', () => {
    assert.equal(shortDateKey('2026-05-02'), '2 May')
  })
  test('labels exist for every kind the schema allows', () => {
    for (const k of ['work', 'weekend', 'overtime', 'holiday', 'leave']) {
      assert.ok(KIND_LABELS[k], `missing label for ${k}`)
    }
  })
})

// ── Month-end export ────────────────────────────────────────────────────────

import { buildMonthCsv, monthLabelFor } from '../src/lib/employerLogic.js'

describe('monthLabelFor', () => {
  test('names the month and year', () => {
    assert.equal(monthLabelFor(2026, 0), 'January 2026')
    assert.equal(monthLabelFor(2026, 8), 'September 2026')
    assert.equal(monthLabelFor(2026, 11), 'December 2026')
  })
})

describe('buildMonthCsv', () => {
  const staff = [
    { id: 'a', full_name: 'Amina Yusuf', job_title: 'Welder' },
    { id: 'b', full_name: 'Chidi, "Junior"', job_title: null },
  ]

  const rows = [
    { employee_id: 'a', work_date: '2026-05-02', kind: 'weekend', rate: 16000, multiplier: 2, amount: 32000, status: 'confirmed', note: null },
    { employee_id: 'a', work_date: '2026-05-01', kind: 'work', rate: 16000, multiplier: 1, amount: 16000, status: 'claimed', note: null },
  ]

  test('has a header and one line per day', () => {
    const out = buildMonthCsv(rows, staff).split('\r\n')
    assert.match(out[0], /^Date,Employee,Job title,Kind/)
    assert.equal(out.length, 5, 'header + 2 days + blank + total')
  })

  test('sorts by date, oldest first', () => {
    const out = buildMonthCsv(rows, staff).split('\r\n')
    assert.match(out[1], /^2026-05-01/)
    assert.match(out[2], /^2026-05-02/)
  })

  test('the control total matches the sum of the rows', () => {
    const out = buildMonthCsv(rows, staff)
    assert.match(out, /Total,.*48000/)
  })

  test('a name containing a comma or quote survives intact', () => {
    const out = buildMonthCsv(
      [{ employee_id: 'b', work_date: '2026-05-01', kind: 'work', amount: 1000, status: 'claimed' }],
      staff,
    )
    assert.match(out, /"Chidi, ""Junior"""/, 'quoted and doubled per RFC 4180')
  })

  test('a day whose employee is not on the roster is labelled, not dropped', () => {
    const out = buildMonthCsv(
      [{ employee_id: 'gone', work_date: '2026-05-01', kind: 'work', amount: 5000, status: 'claimed' }],
      staff,
    )
    assert.match(out, /\(not on roster\)/)
    assert.match(out, /Total,.*5000/, 'and still counted in the total')
  })

  test('spreadsheet formula injection is neutralised', () => {
    const out = buildMonthCsv(
      [{ employee_id: 'a', work_date: '2026-05-01', kind: 'work', amount: 1, status: 'claimed', note: '=SUM(A1:A9)' }],
      staff,
    )
    assert.ok(!/,=SUM/.test(out), 'a leading = must not reach the spreadsheet')
    assert.match(out, /'=SUM/)
  })

  test('empty input still yields a valid file with a zero total', () => {
    const out = buildMonthCsv([], staff, { monthLabel: 'May 2026' })
    assert.match(out, /^Date,Employee/)
    assert.match(out, /Total — May 2026,.*0/)
  })

  test('null and malformed rows do not throw', () => {
    assert.doesNotThrow(() => buildMonthCsv(null, null))
    assert.doesNotThrow(() => buildMonthCsv([null, undefined], staff))
  })

  test('amounts as strings sum as numbers', () => {
    const out = buildMonthCsv([
      { employee_id: 'a', work_date: '2026-05-01', kind: 'work', amount: '16000.00', status: 'claimed' },
      { employee_id: 'a', work_date: '2026-05-02', kind: 'work', amount: '5000.50', status: 'claimed' },
    ], staff)
    assert.match(out, /21000\.5/)
  })
})

// ── Roles ───────────────────────────────────────────────────────────────────

/* These are the rules that decide whether an account can see a staff roster.
   They are tested hard because the failure mode is silent over-permission:
   nothing crashes, a personal user is simply handed other people's records. */

import { resolveRoles, PERSONAL, BUSINESS } from '../src/lib/employerLogic.js'

describe('resolveRoles', () => {
  test('an account with neither row has no role at all', () => {
    const r = resolveRoles({ uid: 'u1' })
    assert.equal(r.isEmployer, false)
    assert.equal(r.isBusiness, false)
    assert.equal(r.kind, null)
    assert.equal(r.businessName, null)
    assert.equal(r.employee, null)
    assert.equal(r.uid, 'u1')
  })

  test('a business account gets the workforce surfaces', () => {
    const r = resolveRoles({ uid: 'u1', employer: { kind: 'business', business_name: 'Alpha Plant' } })
    assert.equal(r.isEmployer, true)
    assert.equal(r.isBusiness, true)
    assert.equal(r.kind, BUSINESS)
    assert.equal(r.businessName, 'Alpha Plant')
  })

  test('a personal account is an employer but NOT a business', () => {
    const r = resolveRoles({ uid: 'u1', employer: { kind: 'personal', business_name: null } })
    assert.equal(r.isEmployer, true)
    assert.equal(r.isBusiness, false)
    assert.equal(r.kind, PERSONAL)
  })

  // The one that matters most. A missing, null, misspelled or unexpected kind
  // must resolve to the answer that grants nothing.
  test('a missing or unrecognised kind fails safe to personal', () => {
    for (const kind of [undefined, null, '', 'Business', 'BUSINESS', 'admin', 'owner', 0, 1, {}, []]) {
      const r = resolveRoles({ uid: 'u1', employer: { kind, business_name: 'X' } })
      assert.equal(r.isBusiness, false, `kind=${JSON.stringify(kind)} must not grant business access`)
      assert.equal(r.kind, PERSONAL)
    }
  })

  test('an employee linked to someone else is not thereby an employer', () => {
    const r = resolveRoles({
      uid: 'u1',
      employee: { id: 'e1', full_name: 'James', employer_id: 'boss', status: 'active' },
    })
    assert.equal(r.isEmployer, false)
    assert.equal(r.isBusiness, false)
    assert.equal(r.employee.full_name, 'James')
  })

  test('an owner who also works their own days holds both', () => {
    const r = resolveRoles({
      uid: 'u1',
      employer: { kind: 'business', business_name: 'Alpha Plant' },
      employee: { id: 'e1', full_name: 'Owner', employer_id: 'u1', status: 'active' },
    })
    assert.equal(r.isBusiness, true)
    assert.equal(r.employee.id, 'e1')
  })

  test('null and malformed input does not throw', () => {
    assert.doesNotThrow(() => resolveRoles())
    assert.doesNotThrow(() => resolveRoles({}))
    assert.doesNotThrow(() => resolveRoles({ employer: null, employee: null }))
    assert.doesNotThrow(() => resolveRoles({ employer: 'business' }))
    assert.doesNotThrow(() => resolveRoles({ employer: { kind: 'business' }, employee: 'x' }))
    assert.equal(resolveRoles(null).isBusiness, false)
  })

  test('a truthy employee value is normalised to an object or null', () => {
    // Guards the UI, which does `roles.employee ? ... : ...` and then reads
    // fields off it. A string here would render blank rows instead of failing.
    assert.equal(resolveRoles({ employee: undefined }).employee, null)
    assert.equal(resolveRoles({ employee: null }).employee, null)
    assert.equal(resolveRoles({ employee: 'x' }).employee, null)
    assert.equal(resolveRoles({ employer: 'business' }).isBusiness, false)
  })
})

// ── Pre-migration tolerance ─────────────────────────────────────────────────

/* The app and the database are updated by different people at different
   moments, so the code must survive being newer than the schema. If asking for
   a column that does not exist yet took out the whole query, shipping Phase 1
   before the SQL was run would break roles AND roster creation. */

import { isMissingColumn } from '../src/lib/employerLogic.js'

describe('isMissingColumn', () => {
  test('recognises the PostgREST undefined_column code', () => {
    assert.equal(isMissingColumn({ code: '42703', message: 'whatever' }, 'kind'), true)
  })

  test('recognises the human-readable message', () => {
    assert.equal(
      isMissingColumn({ message: "column employers.kind does not exist" }, 'kind'),
      true,
    )
  })

  test('does not fire for an unrelated error', () => {
    assert.equal(isMissingColumn({ code: '42501', message: 'permission denied for table employers' }, 'kind'), false)
    assert.equal(isMissingColumn({ code: 'PGRST116', message: 'no rows returned' }, 'kind'), false)
    assert.equal(isMissingColumn(null, 'kind'), false)
    assert.equal(isMissingColumn(undefined, 'kind'), false)
    assert.equal(isMissingColumn({}, 'kind'), false)
  })

  test('does not fire for a different missing column', () => {
    assert.equal(
      isMissingColumn({ message: 'column employers.business_name does not exist' }, 'kind'),
      false,
    )
  })

  test('an error with no message does not throw', () => {
    assert.doesNotThrow(() => isMissingColumn({}, 'kind'))
    assert.doesNotThrow(() => isMissingColumn({ message: null }, 'kind'))
    assert.doesNotThrow(() => isMissingColumn({ message: 42 }, 'kind'))
  })
})
