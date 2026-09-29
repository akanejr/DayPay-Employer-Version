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
  ledgerToRecord, recordsByDate, ledgerTotals, ledgerSourceLabel, notebookMonthNote,
  CORRECTION_CHOICES, CORRECTION_LABELS, CORRECTION_STATUS,
  correctionSentence, correctionEffect, openRequestsByDate, monthGrid,
  auditLabel, auditTone, workerMonthTotals,
} from '../src/lib/employerLogic.js'
import { payslipModel } from '../src/lib/payslip.js'

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

// ── Dashboard ───────────────────────────────────────────────────────────────

import { dayBoard, unmetRates, monthFigures } from '../src/lib/employerLogic.js'

const staff = [
  { id: 'a', full_name: 'James', job_title: 'Welder', status: 'active' },
  { id: 'b', full_name: 'Peter', job_title: 'Fitter', status: 'active' },
  { id: 'c', full_name: 'Grace', job_title: 'Helper', status: 'active' },
  { id: 'd', full_name: 'Old Timer', status: 'archived' },
]

describe('dayBoard', () => {
  test('names the missing, not just the count', () => {
    const days = [{ employee_id: 'a', work_date: '2026-09-25', kind: 'work', amount: 16000, status: 'claimed' }]
    const b = dayBoard(days, staff, '2026-09-25')
    assert.equal(b.expected, 3)          // archived excluded
    assert.equal(b.recorded, 1)
    assert.equal(b.missing.length, 2)
    assert.deepEqual(b.missing.map(e => e.full_name).sort(), ['Grace', 'Peter'])
    assert.equal(b.amount, 16000)
  })

  // A dashboard that contradicts itself is worse than no dashboard.
  test('recorded + missing always equals expected', () => {
    const days = [
      { employee_id: 'a', work_date: '2026-09-25', kind: 'work', amount: 100, status: 'claimed' },
      { employee_id: 'b', work_date: '2026-09-25', kind: 'overtime', amount: 200, status: 'claimed' },
    ]
    const b = dayBoard(days, staff, '2026-09-25')
    assert.equal(b.recorded + b.missing.length, b.expected)
    assert.equal(b.present.length, b.recorded)
  })

  test('a day for an archived person is kept, not dropped', () => {
    const days = [{ employee_id: 'd', work_date: '2026-09-25', kind: 'work', amount: 16000, status: 'claimed' }]
    const b = dayBoard(days, staff, '2026-09-25')
    assert.equal(b.offRoster.length, 1)
    assert.equal(b.recorded, 0)          // they are not on the active roster
    assert.equal(b.missing.length, 3)
  })

  test('counts kinds and workflow states separately', () => {
    const days = [
      { employee_id: 'a', work_date: '2026-09-25', kind: 'overtime', amount: 32000, status: 'claimed' },
      { employee_id: 'b', work_date: '2026-09-25', kind: 'holiday', amount: 32000, status: 'disputed' },
      { employee_id: 'c', work_date: '2026-09-25', kind: 'leave', amount: 0, status: 'confirmed' },
    ]
    const b = dayBoard(days, staff, '2026-09-25')
    assert.equal(b.counts.overtime, 1)
    assert.equal(b.counts.holiday, 1)
    assert.equal(b.counts.leave, 1)
    assert.equal(b.counts.unconfirmed, 1)   // the overtime day
    assert.equal(b.counts.disputed, 1)
    assert.equal(b.amount, 64000)           // leave contributes 0
  })

  test('only the requested date is counted', () => {
    const days = [
      { employee_id: 'a', work_date: '2026-09-25', kind: 'work', amount: 16000, status: 'claimed' },
      { employee_id: 'b', work_date: '2026-09-24', kind: 'work', amount: 16000, status: 'claimed' },
    ]
    const b = dayBoard(days, staff, '2026-09-25')
    assert.equal(b.recorded, 1)
  })

  test('flags a weekend date, because the multiplier follows the date', () => {
    assert.equal(dayBoard([], staff, '2026-09-26').isWeekend, true)   // Saturday
    assert.equal(dayBoard([], staff, '2026-09-25').isWeekend, false)  // Friday
  })

  test('amounts arriving as strings still sum as numbers', () => {
    const days = [
      { employee_id: 'a', work_date: '2026-09-25', kind: 'work', amount: '16000.00', status: 'claimed' },
      { employee_id: 'b', work_date: '2026-09-25', kind: 'work', amount: '5000.50', status: 'claimed' },
    ]
    assert.equal(dayBoard(days, staff, '2026-09-25').amount, 21000.5)
  })

  test('null and malformed input does not throw', () => {
    assert.doesNotThrow(() => dayBoard(null, null, '2026-09-25'))
    assert.doesNotThrow(() => dayBoard([null, undefined], [null], '2026-09-25'))
    assert.doesNotThrow(() => dayBoard([{}], staff, '2026-09-25'))
    const b = dayBoard(null, null, '2026-09-25')
    assert.equal(b.expected, 0)
    assert.equal(b.recorded, 0)
    assert.equal(b.amount, 0)
  })

  test('an empty roster reports a zero day rather than breaking', () => {
    const b = dayBoard([], [], '2026-09-25')
    assert.equal(b.expected, 0)
    assert.equal(b.missing.length, 0)
  })
})

describe('unmetRates', () => {
  const periodsFor = (id, from) => ({
    id: `${id}-${from}`, employee_id: id, effective_from: from,
    daily_rate: 16000, weekend_multiplier: 2, holiday_multiplier: 2,
  })

  test('a rate covering the date satisfies it', () => {
    const periods = [periodsFor('a', '2026-01-01')]
    assert.deepEqual(unmetRates(staff, periods, '2026-09-25').map(e => e.id), ['b', 'c'])
  })

  // The boundary that decides whether a day can be saved at all.
  test('a rate starting exactly on the date counts as covering it', () => {
    const periods = [periodsFor('a', '2026-09-25')]
    assert.equal(unmetRates(staff, periods, '2026-09-25').some(e => e.id === 'a'), false)
  })

  test('a rate starting after the date does not cover it', () => {
    const periods = [periodsFor('a', '2026-09-26')]
    assert.equal(unmetRates(staff, periods, '2026-09-25').some(e => e.id === 'a'), true)
  })

  /* An earlier period still covers a later date until a new one starts. This
     is the case that a naive "is there a rate for this date" check gets wrong:
     a raise dated tomorrow must not make today uncovered. */
  test('an earlier period keeps covering until a later one begins', () => {
    const periods = [periodsFor('a', '2026-01-01'), periodsFor('a', '2026-09-26')]
    assert.equal(unmetRates(staff, periods, '2026-09-25').some(e => e.id === 'a'), false)
    assert.equal(unmetRates(staff, periods, '2026-09-26').some(e => e.id === 'a'), false)
    // ...and still before the first one.
    assert.equal(unmetRates(staff, periods, '2025-12-31').some(e => e.id === 'a'), true)
  })

  test('another person\'s rate does not satisfy this person', () => {
    const periods = [periodsFor('b', '2026-01-01')]
    assert.equal(unmetRates(staff, periods, '2026-09-25').some(e => e.id === 'a'), true)
  })

  test('archived staff are not reported as gaps', () => {
    assert.equal(unmetRates(staff, [], '2026-09-25').some(e => e.id === 'd'), false)
  })

  test('null and malformed input does not throw', () => {
    assert.doesNotThrow(() => unmetRates(null, null, '2026-09-25'))
    assert.doesNotThrow(() => unmetRates(staff, [null], '2026-09-25'))
    assert.equal(unmetRates(staff, [], '2026-09-25').length, 3)
  })
})

describe('monthFigures', () => {
  // The brief's own worked example, end to end through the dashboard path.
  test('actual days and paid-day equivalents are reported separately', () => {
    const days = [
      ...Array.from({ length: 19 }, (_, i) => ({
        employee_id: 'a', work_date: `2026-09-${String(i + 1).padStart(2, '0')}`,
        kind: 'work', amount: 16000, multiplier: 1, status: 'claimed',
      })),
      { employee_id: 'a', work_date: '2026-09-20', kind: 'weekend', amount: 32000, multiplier: 2, status: 'claimed' },
      { employee_id: 'a', work_date: '2026-09-21', kind: 'weekend', amount: 32000, multiplier: 2, status: 'claimed' },
      { employee_id: 'a', work_date: '2026-09-22', kind: 'overtime', amount: 32000, multiplier: 2, status: 'claimed' },
    ]
    const f = monthFigures(days, staff)
    assert.equal(f.actualDays, 22)      // 19 + 2 + 1
    assert.equal(f.equivalents, 25)     // 19 + 2x2 + 1x2
    assert.equal(f.total, 400000)       // 25 x 16,000
  })

  test('leave is excluded from both actual days and equivalents', () => {
    const days = [
      { employee_id: 'a', work_date: '2026-09-01', kind: 'work', amount: 16000, multiplier: 1, status: 'claimed' },
      { employee_id: 'a', work_date: '2026-09-02', kind: 'leave', amount: 16000, multiplier: 1, status: 'claimed' },
    ]
    const f = monthFigures(days, staff)
    assert.equal(f.actualDays, 1)
    assert.equal(f.equivalents, 1)
    assert.equal(f.total, 32000)
  })

  test('surfaces unconfirmed and disputed alongside the money', () => {
    const days = [
      { employee_id: 'a', work_date: '2026-09-01', kind: 'work', amount: 16000, multiplier: 1, status: 'claimed' },
      { employee_id: 'b', work_date: '2026-09-01', kind: 'work', amount: 16000, multiplier: 1, status: 'confirmed' },
      { employee_id: 'c', work_date: '2026-09-01', kind: 'work', amount: 16000, multiplier: 1, status: 'disputed' },
    ]
    const f = monthFigures(days, staff)
    assert.equal(f.unconfirmed, 1)
    assert.equal(f.disputed, 1)
  })

  test('a day for someone off the roster is still counted in the total', () => {
    const days = [{ employee_id: 'gone', work_date: '2026-09-01', kind: 'work', amount: 16000, multiplier: 1, status: 'claimed' }]
    const f = monthFigures(days, staff)
    assert.equal(f.total, 16000)
    assert.equal(f.unmatchedDays, 1)
  })

  test('null and malformed input does not throw', () => {
    assert.doesNotThrow(() => monthFigures(null, null))
    assert.doesNotThrow(() => monthFigures([null], [null]))
    const f = monthFigures(null, null)
    assert.equal(f.total, 0)
    assert.equal(f.actualDays, 0)
    assert.equal(f.equivalents, 0)
  })
})

// ── Contractors ─────────────────────────────────────────────────────────────

import { groupByContractor, contractorRollup, isMissingTable } from '../src/lib/employerLogic.js'

const contractor = (id, name) => ({ id, name, status: 'active' })

const workforce = [
  { id: 'w1', full_name: 'Worker A', job_title: 'Fitter', status: 'active', contractor_id: 'c1' },
  { id: 'w2', full_name: 'Worker B', job_title: 'Rigger', status: 'active', contractor_id: 'c1' },
  { id: 'w3', full_name: 'Worker C', job_title: 'Welder', status: 'active', contractor_id: 'c2' },
  { id: 'w4', full_name: 'Worker D', status: 'active', contractor_id: null },
  { id: 'w5', full_name: 'Archived One', status: 'archived', contractor_id: 'c1' },
]

describe('groupByContractor', () => {
  test('groups workers under their contractor', () => {
    const g = groupByContractor([contractor('c1', 'Alpha'), contractor('c2', 'Beta')], workforce)
    assert.equal(g.length, 3)                       // c1, c2, unassigned
    assert.deepEqual(g[0].workers.map(w => w.id), ['w1', 'w2'])
    assert.deepEqual(g[1].workers.map(w => w.id), ['w3'])
    assert.equal(g[2].contractor, null)
    assert.deepEqual(g[2].workers.map(w => w.id), ['w4'])
  })

  // Otherwise creating one looks like it silently failed.
  test('a contractor with no workers still appears', () => {
    const g = groupByContractor([contractor('c9', 'Gamma')], workforce)
    const gamma = g.find(x => x.contractor?.id === 'c9')
    assert.ok(gamma, 'Gamma must be on screen')
    assert.equal(gamma.workers.length, 0)
  })

  // The dangerous one. A worker under an archived contractor is still owed
  // money, so they must never vanish from the screen.
  test('a worker whose contractor is not listed falls into Unassigned', () => {
    const g = groupByContractor([contractor('c2', 'Beta')], workforce)
    const unassigned = g.find(x => x.contractor === null)
    assert.ok(unassigned)
    assert.deepEqual(unassigned.workers.map(w => w.id).sort(), ['w1', 'w2', 'w4'])
  })

  test('archived workers are not grouped at all', () => {
    const g = groupByContractor([contractor('c1', 'Alpha')], workforce)
    const all = g.flatMap(x => x.workers.map(w => w.id))
    assert.equal(all.includes('w5'), false)
  })

  test('an entirely unassigned roster produces one group, not none', () => {
    const flat = workforce.filter(w => !w.contractor_id)
    const g = groupByContractor([], flat)
    assert.equal(g.length, 1)
    assert.equal(g[0].contractor, null)
    assert.equal(g[0].workers.length, 1)
  })

  test('no unassigned group is shown when everyone is assigned', () => {
    const all = workforce.filter(w => w.contractor_id).map(w => ({ ...w, contractor_id: 'c1' }))
    const g = groupByContractor([contractor('c1', 'Alpha')], all)
    assert.equal(g.length, 1)
    assert.equal(g.some(x => x.contractor === null), false)
  })

  test('no worker is ever lost across the groups', () => {
    const before = workforce.filter(w => w.status === 'active').map(w => w.id).sort()
    const g = groupByContractor([contractor('c1', 'Alpha')], workforce)
    const after = g.flatMap(x => x.workers.map(w => w.id)).sort()
    assert.deepEqual(after, before)
  })

  test('null and malformed input does not throw', () => {
    assert.doesNotThrow(() => groupByContractor(null, null))
    assert.doesNotThrow(() => groupByContractor([null, {}], [null, {}]))
    assert.deepEqual(groupByContractor(null, null), [])
  })
})

describe('contractorRollup', () => {
  const days = [
    // Today
    { employee_id: 'w1', work_date: '2026-09-25', kind: 'work', amount: 16000, multiplier: 1, status: 'claimed' },
    { employee_id: 'w2', work_date: '2026-09-25', kind: 'overtime', amount: 32000, multiplier: 2, status: 'claimed' },
    // Earlier in the month
    { employee_id: 'w1', work_date: '2026-09-01', kind: 'weekend', amount: 32000, multiplier: 2, status: 'claimed' },
    { employee_id: 'w2', work_date: '2026-09-02', kind: 'work', amount: 16000, multiplier: 1, status: 'claimed' },
    // Another contractor's day must not leak in
    { employee_id: 'w3', work_date: '2026-09-25', kind: 'work', amount: 99999, multiplier: 1, status: 'claimed' },
  ]
  const alpha = workforce.filter(w => w.contractor_id === 'c1' && w.status === 'active')

  test('counts today\'s attendance for this contractor only', () => {
    const r = contractorRollup(alpha, days, '2026-09-25')
    assert.equal(r.expected, 2)
    assert.equal(r.present, 2)
    assert.equal(r.missing, 0)
    assert.equal(r.overtime, 1)
    assert.equal(r.todayAmount, 48000)      // 16,000 + 32,000, not 147,999
  })

  // The brief's own worker-card example.
  test('a worker card carries actual days and paid-day equivalents', () => {
    const r = contractorRollup(alpha, days, '2026-09-25')
    const a = r.rows.find(x => x.employee.id === 'w1')
    assert.equal(a.present, true)
    assert.equal(a.actualDays, 2)
    assert.equal(a.equivalents, 3)          // 1 regular + 1 weekend at 2x
    assert.equal(a.total, 48000)
  })

  test('a worker with no day today is counted as missing, and still has month figures', () => {
    const r = contractorRollup(alpha, days, '2026-09-26')
    assert.equal(r.present, 0)
    assert.equal(r.missing, 2)
    const a = r.rows.find(x => x.employee.id === 'w1')
    assert.equal(a.present, false)
    assert.equal(a.today, null)
    assert.equal(a.actualDays, 2)           // the month still shows
  })

  test('the header cannot disagree with the rows underneath it', () => {
    const r = contractorRollup(alpha, days, '2026-09-25')
    assert.equal(r.present + r.missing, r.expected)
    assert.equal(r.rows.length, r.expected)
    assert.equal(r.rows.filter(x => x.present).length, r.present)
  })

  test('leave is excluded from actual days but still counted in the money', () => {
    const withLeave = [
      ...days,
      { employee_id: 'w1', work_date: '2026-09-08', kind: 'leave', amount: 16000, multiplier: 1, status: 'claimed' },
    ]
    const r = contractorRollup(alpha, withLeave, '2026-09-25')
    const a = r.rows.find(x => x.employee.id === 'w1')
    assert.equal(a.actualDays, 2)           // the leave day is not "worked"
    assert.equal(a.leave, 1)
    assert.equal(a.equivalents, 3)
    assert.equal(a.total, 64000)
  })

  test('the period total matches the sum of the worker cards', () => {
    const r = contractorRollup(alpha, days, '2026-09-25')
    const summed = r.rows.reduce((s, x) => s + x.total, 0)
    assert.equal(r.periodTotal, summed)
  })

  test('an empty contractor reports zero rather than breaking', () => {
    const r = contractorRollup([], days, '2026-09-25')
    assert.equal(r.expected, 0)
    assert.equal(r.present, 0)
    assert.equal(r.periodTotal, 0)
    assert.deepEqual(r.rows, [])
  })

  test('archived workers are excluded from the contractor', () => {
    const r = contractorRollup(workforce.filter(w => w.contractor_id === 'c1'), days, '2026-09-25')
    assert.equal(r.expected, 2)
  })

  test('null and malformed input does not throw', () => {
    assert.doesNotThrow(() => contractorRollup(null, null, '2026-09-25'))
    assert.doesNotThrow(() => contractorRollup([null], [null], '2026-09-25'))
    const r = contractorRollup(null, null, '2026-09-25')
    assert.equal(r.expected, 0)
    assert.equal(r.periodTotal, 0)
  })
})

describe('isMissingTable', () => {
  test('recognises the PostgREST undefined_table code', () => {
    assert.equal(isMissingTable({ code: '42P01', message: 'x' }, 'contractors'), true)
  })
  test('recognises the human-readable message', () => {
    assert.equal(isMissingTable({ message: 'relation "public.contractors" does not exist' }, 'contractors'), true)
  })
  test('does not fire for an unrelated error', () => {
    assert.equal(isMissingTable({ code: '42501', message: 'permission denied' }, 'contractors'), false)
    assert.equal(isMissingTable(null, 'contractors'), false)
    assert.equal(isMissingTable({}, 'contractors'), false)
    assert.equal(isMissingTable({ message: 'relation "public.employees" does not exist' }, 'contractors'), false)
  })
  test('an error with no message does not throw', () => {
    assert.doesNotThrow(() => isMissingTable({}, 'contractors'))
    assert.doesNotThrow(() => isMissingTable({ message: null }, 'contractors'))
  })
})

// ── Attendance sessions ─────────────────────────────────────────────────────

import {
  endOfLocalDay, sessionState, sessionIsLive, isValidCodeShape,
  timeLeftLabel, attendancePrompt, checkInError,
} from '../src/lib/employerLogic.js'

describe('endOfLocalDay', () => {
  /* The reason session validity is a timestamp at all. The database runs in
     UTC; a session opened just after midnight in Lagos is still the previous
     UTC day, so any rule phrased as "work_date = current_date" would be wrong
     for exactly the workers who arrive first. */
  test('ends on the same local calendar day it was given', () => {
    const d = endOfLocalDay(new Date(2026, 8, 25, 0, 30))   // 00:30 on the 25th
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 8)
    assert.equal(d.getDate(), 25)
    assert.equal(d.getHours(), 23)
    assert.equal(d.getMinutes(), 59)
  })

  test('is strictly after the moment it was computed from', () => {
    const morning = new Date(2026, 8, 25, 6, 0)
    assert.ok(endOfLocalDay(morning).getTime() > morning.getTime())
  })

  test('a moment just before midnight still expires that same day', () => {
    const late = new Date(2026, 8, 25, 23, 58, 30)
    const end = endOfLocalDay(late)
    assert.equal(end.getDate(), 25)
    assert.ok(end.getTime() > late.getTime())
  })
})

describe('sessionState', () => {
  const now = new Date(2026, 8, 25, 12, 0)

  test('open while the window is running', () => {
    const s = { status: 'open', expires_at: new Date(2026, 8, 25, 18, 0).toISOString() }
    assert.equal(sessionState(s, now), 'open')
    assert.equal(sessionIsLive(s, now), true)
  })

  test('expired once the moment passes — even if nobody closed it', () => {
    const s = { status: 'open', expires_at: new Date(2026, 8, 25, 11, 59).toISOString() }
    assert.equal(sessionState(s, now), 'expired')
    assert.equal(sessionIsLive(s, now), false)
  })

  test('closed beats a window that has not run out yet', () => {
    const s = { status: 'closed', expires_at: new Date(2026, 8, 25, 23, 59).toISOString() }
    assert.equal(sessionState(s, now), 'closed')
  })

  // Yesterday's code must not work today. This is the client's mirror of the
  // server rule, and the comparison is on the instant, not the date string.
  test('a session expiring at midnight is dead one second later', () => {
    const s = { status: 'open', expires_at: new Date(2026, 8, 25, 23, 59, 59).toISOString() }
    assert.equal(sessionState(s, new Date(2026, 8, 25, 23, 59, 58)), 'open')
    assert.equal(sessionState(s, new Date(2026, 8, 26, 0, 0, 0)), 'expired')
  })

  test('no session, and malformed input, do not throw', () => {
    assert.equal(sessionState(null, now), 'none')
    assert.equal(sessionState(undefined, now), 'none')
    assert.equal(sessionState({}, now), 'unknown')
    assert.equal(sessionState({ status: 'open', expires_at: 'not a date' }, now), 'unknown')
    assert.equal(sessionState({ status: 'open' }, now), 'unknown')
  })
})

describe('isValidCodeShape', () => {
  test('accepts exactly four digits', () => {
    assert.equal(isValidCodeShape('7429'), true)
    assert.equal(isValidCodeShape('0000'), true)
    assert.equal(isValidCodeShape(' 7429 '), true)
    assert.equal(isValidCodeShape(7429), true)
  })

  test('rejects anything else', () => {
    for (const bad of ['742', '74299', 'abcd', '74a9', '', null, undefined, '7 429', '-7429', '74.9']) {
      assert.equal(isValidCodeShape(bad), false, `${JSON.stringify(bad)} must be rejected`)
    }
  })
})

describe('timeLeftLabel', () => {
  const now = new Date(2026, 8, 25, 12, 0, 0)

  test('counts down in the coarsest useful unit', () => {
    assert.equal(timeLeftLabel(new Date(2026, 8, 25, 15, 20).toISOString(), now), 'ends in 3h 20m')
    assert.equal(timeLeftLabel(new Date(2026, 8, 25, 15, 0).toISOString(), now), 'ends in 3h')
    assert.equal(timeLeftLabel(new Date(2026, 8, 25, 12, 45).toISOString(), now), 'ends in 45m')
    assert.equal(timeLeftLabel(new Date(2026, 8, 25, 12, 0, 30).toISOString(), now), 'ends in under a minute')
  })

  test('says expired rather than counting backwards', () => {
    assert.equal(timeLeftLabel(new Date(2026, 8, 25, 11, 0).toISOString(), now), 'expired')
  })

  test('malformed input returns empty rather than throwing', () => {
    assert.equal(timeLeftLabel(null, now), '')
    assert.equal(timeLeftLabel('nonsense', now), '')
  })
})

describe('attendancePrompt', () => {
  test('open, with a contractor named', () => {
    const p = attendancePrompt({ is_open: true, contractor_name: 'Alpha Services' })
    assert.equal(p.tone, 'open')
    assert.match(p.body, /Alpha Services/)
  })

  test('open, site-wide, still phrased as a question', () => {
    const p = attendancePrompt({ is_open: true, contractor_name: null })
    assert.equal(p.tone, 'open')
    assert.match(p.body, /Did you come to work today/)
  })

  /* One means wait, the other means ask somebody — so they must not read the
     same. */
  test('never open yet and already closed are different messages', () => {
    const notYet = attendancePrompt({ is_open: false, last_ended: false })
    const closed = attendancePrompt({ is_open: false, last_ended: true })
    assert.equal(notYet.tone, 'idle')
    assert.equal(closed.tone, 'closed')
    assert.notEqual(notYet.body, closed.body)
    assert.match(closed.body, /ask your employer/i)
  })

  test('null input does not throw', () => {
    assert.doesNotThrow(() => attendancePrompt(null))
    assert.equal(attendancePrompt(null).tone, 'idle')
  })
})

describe('checkInError', () => {
  test('passes the database message through — it is written for the worker', () => {
    assert.equal(
      checkInError({ message: 'That code is not the one for today. Check it and try again.' }),
      'That code is not the one for today. Check it and try again.',
    )
  })

  // A policy refusal would otherwise surface as "new row violates row-level
  // security policy", which tells a worker nothing and blames them for it.
  test('replaces a raw policy refusal with something actionable', () => {
    const msg = checkInError({ message: 'new row violates row-level security policy for table "day_records"' })
    assert.match(msg, /ask your employer/i)
    assert.doesNotMatch(msg, /row-level security/)
  })

  test('says something useful when there is no message at all', () => {
    assert.ok(checkInError({}).length > 10)
    assert.ok(checkInError(null).length > 10)
    assert.ok(checkInError(undefined).length > 10)
  })
})

// ── Phase 5: the workplace record as the employee's own view ────────────────
// The point of these is not the mapping itself but its CONSEQUENCE: a worker's
// payslip, built from the employer's ledger rows, must land on exactly the
// figures the employer's side shows. One record, two views, same money.

describe('ledgerToRecord', () => {
  const row = (over = {}) => ({
    work_date: '2026-09-29', kind: 'work', amount: '16000', rate: '16000',
    multiplier: '1', status: 'confirmed', source: 'check_in', leave_type: null, ...over,
  })

  test('carries the date, amount, rate and multiplier across unchanged', () => {
    const r = ledgerToRecord(row())
    assert.equal(r.date, '2026-09-29')
    assert.equal(r.amount, 16000)
    assert.equal(r.rate, 16000)
    assert.equal(r.multiplier, 1)
  })

  test('reads the stored money, never today\'s rate — history stays history', () => {
    // A day paid at an old rate keeps that rate even though the settings have
    // moved on since. Recomputing here would silently restate a paid day.
    const r = ledgerToRecord(row({ rate: '12000', amount: '24000', multiplier: '2', kind: 'weekend' }))
    assert.equal(r.rate, 12000)
    assert.equal(r.amount, 24000)
    assert.equal(r.isWeekend, true)
  })

  test('maps every kind the database can store', () => {
    const flags = (k, over = {}) => {
      const r = ledgerToRecord(row({ kind: k, ...over }))
      return [r.isWeekend, r.isOvertime, r.isHoliday, r.isLeave]
    }
    // A plain workday is deliberately none of the four: it is the base case,
    // paid at 1×, and flagging it as anything else would double it.
    assert.deepEqual(flags('work'), [false, false, false, false])
    assert.deepEqual(flags('weekend'), [true, false, false, false])
    assert.deepEqual(flags('overtime'), [false, true, false, false])
    assert.deepEqual(flags('holiday'), [false, false, true, false])

    const leave = ledgerToRecord(row({ kind: 'leave', leave_type: 'sick', amount: '0' }))
    assert.deepEqual([leave.isWeekend, leave.isOvertime, leave.isHoliday, leave.isLeave], [false, false, false, true])
    assert.equal(leave.leaveType, 'sick')
  })

  test('refuses a row with no date instead of inventing one', () => {
    assert.equal(ledgerToRecord(null), null)
    assert.equal(ledgerToRecord({}), null)
    assert.equal(ledgerToRecord({ work_date: '' }), null)
  })

  test('keeps provenance for the screen, and no status is read as money', () => {
    const r = ledgerToRecord(row({ source: 'employer', status: 'claimed' }))
    assert.equal(r.source, 'employer')
    assert.equal(r.status, 'claimed')
  })
})

describe('recordsByDate', () => {
  test('keys by date and skips rows it cannot use', () => {
    const map = recordsByDate([
      { work_date: '2026-09-01', amount: 16000 },
      { work_date: '2026-09-02', amount: 32000, kind: 'overtime' },
      null,
      { amount: 999 },
    ])
    assert.deepEqual(Object.keys(map).sort(), ['2026-09-01', '2026-09-02'])
    assert.equal(map['2026-09-02'].isOvertime, true)
  })

  test('tolerates not being given an array at all', () => {
    assert.deepEqual(recordsByDate(null), {})
    assert.deepEqual(recordsByDate(undefined), {})
    assert.deepEqual(recordsByDate('nonsense'), {})
  })
})

describe('ledgerTotals', () => {
  test('separates written down from agreed', () => {
    const t = ledgerTotals([
      { work_date: '2026-09-01', amount: 16000, status: 'confirmed' },
      { work_date: '2026-09-02', amount: 16000, status: 'claimed' },
      { work_date: '2026-09-03', amount: 32000, status: 'claimed' },
      { work_date: '2026-09-04', amount: 16000, status: 'disputed' },
    ])
    assert.equal(t.days, 4)
    assert.equal(t.confirmed, 1)
    assert.equal(t.claimed, 2)
    assert.equal(t.disputed, 1)
    assert.equal(t.amount, 80000)
  })

  test('an empty record is all zeroes, not NaN', () => {
    assert.deepEqual(ledgerTotals([]), { days: 0, claimed: 0, confirmed: 0, disputed: 0, amount: 0 })
    assert.deepEqual(ledgerTotals(null), { days: 0, claimed: 0, confirmed: 0, disputed: 0, amount: 0 })
  })
})

describe('ledgerSourceLabel', () => {
  test('says who put the day there', () => {
    assert.match(ledgerSourceLabel('check_in'), /work code/i)
    assert.match(ledgerSourceLabel('correction'), /corrected/i)
    assert.match(ledgerSourceLabel('employer'), /employer/i)
    assert.match(ledgerSourceLabel(undefined), /employer/i)
  })
})

describe('notebookMonthNote', () => {
  const book = {
    '2026-09-02': { amount: 16000 },
    '2026-09-03': { amount: 32000 },
    '2026-08-31': { amount: 16000 },
  }

  test('counts only the month asked for', () => {
    assert.deepEqual(notebookMonthNote(book, 2026, 8), { days: 2, total: 48000 })
    assert.deepEqual(notebookMonthNote(book, 2026, 7), { days: 1, total: 16000 })
  })

  test('a quiet month says nothing at all, so it cannot nag', () => {
    assert.equal(notebookMonthNote(book, 2026, 0), null)
    assert.equal(notebookMonthNote({}, 2026, 8), null)
    assert.equal(notebookMonthNote(null, 2026, 8), null)
  })

  test('December and January do not bleed into each other', () => {
    const b = { '2026-12-31': { amount: 1000 }, '2027-01-01': { amount: 2000 } }
    assert.deepEqual(notebookMonthNote(b, 2026, 11), { days: 1, total: 1000 })
    assert.deepEqual(notebookMonthNote(b, 2027, 0), { days: 1, total: 2000 })
  })
})

describe('the worker\'s payslip from the employer\'s ledger', () => {
  /* The brief's own worked example: 19 regular + 2 weekend + 1 overtime at
     ₦16,000 → 22 actual days, 25 paid-day equivalents, ₦400,000. Here the
     six days are LEDGER ROWS (what the employer's side stores) and the
     assertion is made on the payslip model the worker's screen renders. If
     the two sides ever drift, this is where it shows. */
  const rows = [
    ...Array.from({ length: 19 }, (_, i) => ({
      work_date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      kind: 'work', amount: '16000', rate: '16000', multiplier: '1',
      status: 'confirmed', source: 'employer',
    })),
    ...['2026-09-20', '2026-09-21'].map(d => ({
      work_date: d, kind: 'weekend', amount: '32000', rate: '16000', multiplier: '2',
      status: 'confirmed', source: 'check_in',
    })),
    {
      work_date: '2026-09-22', kind: 'overtime', amount: '32000', rate: '16000', multiplier: '2',
      status: 'claimed', source: 'check_in',
    },
  ]

  const model = payslipModel(Object.values(recordsByDate(rows)).sort((a, b) => (a.date < b.date ? -1 : 1)))

  test('22 actual days', () => assert.equal(model.actualDays, 22))
  test('25 paid-day equivalents', () => assert.equal(model.totalEquiv, 25))
  test('₦400,000 total', () => assert.equal(model.total, 400000))
  test('one rate, so the simple equation reconciles', () => {
    assert.equal(model.singleRate, 16000)
    assert.equal(model.reconciles, true)
  })
  test('the groups are the ones the employer sees', () => {
    const g = Object.fromEntries(model.groups.map(x => [x.key, x.actual]))
    assert.deepEqual(g, { regular: 19, weekend: 2, overtime: 1, holiday: 0 })
  })
  test('an unconfirmed day still counts — the employer simply has not agreed it yet', () => {
    // Day 22 is `claimed`. It is money owed the moment it is recorded, which is
    // why the screen also shows how many days are still awaiting confirmation
    // rather than hiding them.
    assert.equal(model.actualDays, 22)
    assert.equal(ledgerTotals(rows).claimed, 1)
    assert.equal(ledgerTotals(rows).confirmed, 21)
  })
})

// ── Phase 6: corrections ────────────────────────────────────────────────────

describe('corrections — the sentences a person reads', () => {
  test('every sentence reads as English, not as a database value', () => {
    // These strings are shown to a worker and to their employer about money.
    // "Says this was Overtime, not Worked" is what a naive join of the chip
    // labels produces, and it was the first thing this function did.
    assert.equal(
      correctionSentence({ request_kind: 'reclassify', want_kind: 'overtime' }, 'work'),
      'Says this was overtime, not a normal working day.',
    )
    assert.equal(
      correctionSentence({ request_kind: 'reclassify', want_kind: 'holiday' }, 'work'),
      'Says this was a holiday, not a normal working day.',
    )
    assert.equal(
      correctionSentence({ request_kind: 'remove' }, 'work'),
      'Says they did not work this day.',
    )
    assert.equal(
      correctionSentence({ request_kind: 'missing' }, null),
      'Says they worked this day and it is not recorded.',
    )
  })

  test('a reclassification with nothing recorded does not invent a comparison', () => {
    assert.equal(
      correctionSentence({ request_kind: 'reclassify', want_kind: 'weekend' }, null),
      'Says this was weekend work.',
    )
  })

  test('an unknown request kind degrades to a sentence, not to a blank', () => {
    assert.equal(correctionSentence({ request_kind: 'nonsense' }, 'work'), 'Asked for a correction.')
    assert.equal(correctionSentence(null), '')
  })

  test('the effect says what agreeing would actually do', () => {
    // An employer is about to change someone's pay by tapping Agree. The
    // consequence is spelled out before the tap, not after it.
    assert.equal(
      correctionEffect({ request_kind: 'reclassify', want_kind: 'overtime' }, 'work'),
      'Agreeing changes it to overtime.',
    )
    assert.equal(
      correctionEffect({ request_kind: 'remove' }, 'work'),
      'Agreeing removes the day.',
    )
    assert.equal(
      correctionEffect({ request_kind: 'remove' }, null),
      'There is nothing recorded to remove.',
    )
    assert.equal(
      correctionEffect({ request_kind: 'missing' }, 'work'),
      'The day is already recorded.',
    )
    assert.equal(
      correctionEffect({ request_kind: 'missing' }, null),
      'Agreeing records a normal working day.',
    )
  })

  test('the three choices, the three labels and the four states are complete', () => {
    assert.deepEqual(CORRECTION_CHOICES.map(c => c.value), ['remove', 'reclassify', 'missing'])
    assert.deepEqual(Object.keys(CORRECTION_LABELS).sort(), ['missing', 'reclassify', 'remove'])
    assert.deepEqual(Object.keys(CORRECTION_STATUS).sort(), ['approved', 'open', 'rejected', 'withdrawn'])
    for (const s of Object.values(CORRECTION_STATUS)) {
      assert.ok(s.text && s.short && s.cls, 'every state needs words and a chip class')
    }
  })
})

describe('openRequestsByDate', () => {
  test('keeps only open requests, keyed by the day they are about', () => {
    const rows = [
      { work_date: '2026-05-02', status: 'open', created_at: '2026-05-03T10:00:00Z' },
      { work_date: '2026-05-04', status: 'approved', created_at: '2026-05-05T10:00:00Z' },
      { work_date: '2026-05-06', status: 'open', created_at: '2026-05-07T10:00:00Z' },
    ]
    const map = openRequestsByDate(rows)
    assert.deepEqual(Object.keys(map).sort(), ['2026-05-02', '2026-05-06'])
  })

  test('the oldest wins if two are somehow open for one day', () => {
    const map = openRequestsByDate([
      { work_date: '2026-05-02', status: 'open', created_at: '2026-05-09T10:00:00Z', message: 'later' },
      { work_date: '2026-05-02', status: 'open', created_at: '2026-05-01T10:00:00Z', message: 'earlier' },
    ])
    assert.equal(map['2026-05-02'].message, 'earlier')
  })

  test('junk does not throw', () => {
    assert.deepEqual(openRequestsByDate(null), {})
    assert.deepEqual(openRequestsByDate([null, { status: 'open' }, {}]), {})
  })
})

describe('monthGrid', () => {
  test('lays a month out Monday first, padded with nulls', () => {
    // September 2026 starts on a Tuesday, so exactly one leading blank.
    const weeks = monthGrid(2026, 8, [])
    assert.equal(weeks.length, 5)
    assert.equal(weeks[0][0], null)
    assert.equal(weeks[0][1].key, '2026-09-01')
    assert.equal(weeks[0][1].day, 1)
    for (const w of weeks) assert.equal(w.length, 7)
  })

  test('every day of the month appears exactly once', () => {
    const weeks = monthGrid(2026, 8, [])
    const days = weeks.flat().filter(Boolean).map(c => c.day)
    assert.equal(days.length, 30)
    assert.deepEqual(days, Array.from({ length: 30 }, (_, i) => i + 1))
  })

  test('a month starting on a Monday has no leading blank', () => {
    // June 2026 starts on a Monday. Getting this wrong shifts every day.
    const weeks = monthGrid(2026, 5, [])
    assert.equal(weeks[0][0].key, '2026-06-01')
  })

  test('a 31-day month starting on a Sunday needs six weeks', () => {
    // May 2026 starts on a Friday, has 31 days: 5 weeks would drop the last day.
    const weeks = monthGrid(2026, 4, [])
    const days = weeks.flat().filter(Boolean).map(c => c.day)
    assert.ok(days.includes(31), 'the 31st must be on the grid')
    assert.ok(weeks.length >= 5)
  })

  test('a leap February is 29 days, and 2026 is not a leap year', () => {
    assert.equal(monthGrid(2028, 1, []).flat().filter(Boolean).length, 29)
    assert.equal(monthGrid(2026, 1, []).flat().filter(Boolean).length, 28)
  })

  test('records land on their own day and nowhere else', () => {
    const mine = [{ work_date: '2026-09-15', kind: 'overtime', amount: 32000 }]
    const weeks = monthGrid(2026, 8, mine)
    const found = weeks.flat().filter(c => c && c.record)
    assert.equal(found.length, 1)
    assert.equal(found[0].day, 15)
    assert.equal(found[0].record.kind, 'overtime')
  })

  test('empty and junk input still produce a full grid', () => {
    assert.equal(monthGrid(2026, 8).flat().filter(Boolean).length, 30)
    assert.equal(monthGrid(2026, 8, [null, {}]).flat().filter(c => c && c.record).length, 0)
  })
})

describe('audit trail labels', () => {
  test('the stored actions become something readable', () => {
    assert.equal(auditLabel('created'), 'Day recorded')
    assert.equal(auditLabel('amended'), 'Day changed')
    assert.equal(auditLabel('status:claimed->confirmed'), 'Confirmed')
    assert.equal(auditLabel('status:confirmed->claimed'), 'Reopened')
    assert.equal(auditLabel('status:claimed->disputed'), 'Disputed')
  })

  test('an action nobody has named yet still reads as a sentence', () => {
    assert.equal(auditLabel('status:claimed->quibbled'), 'claimed → quibbled')
    assert.equal(auditLabel('something-new'), 'something-new')
    assert.equal(auditLabel(null), 'Changed')
  })

  test('tone is coarse on purpose — an audit list with nine colours is unreadable', () => {
    assert.equal(auditTone('created'), 'create')
    assert.equal(auditTone('amended'), 'amend')
    assert.equal(auditTone('status:claimed->confirmed'), 'good')
    assert.equal(auditTone('status:confirmed->claimed'), 'warn')
    assert.equal(auditTone('status:claimed->disputed'), 'warn')
    assert.equal(auditTone('something-new'), 'plain')
  })
})

describe('workerMonthTotals', () => {
  test('counts actual days, overtime and the equivalents the worker is paid for', () => {
    const rows = [
      { kind: 'work', amount: 16000, multiplier: 1, status: 'confirmed' },
      { kind: 'work', amount: 16000, multiplier: 1, status: 'confirmed' },
      { kind: 'weekend', amount: 32000, multiplier: 2, status: 'confirmed' },
      { kind: 'overtime', amount: 32000, multiplier: 2, status: 'claimed' },
      { kind: 'leave', amount: 8000, multiplier: 0.5, status: 'confirmed' },
    ]
    const t = workerMonthTotals(rows)
    assert.equal(t.days, 5)
    assert.equal(t.worked, 4)      // leave is not a worked day
    assert.equal(t.overtime, 1)
    assert.equal(t.leave, 1)
    assert.equal(t.total, 104000)
    assert.equal(t.equivalents, 6.5)
    assert.equal(t.awaiting, 1)    // the worker can see what is not settled yet
  })

  test('an empty month is zeroes, not NaN', () => {
    assert.deepEqual(workerMonthTotals([]),
      { worked: 0, overtime: 0, leave: 0, total: 0, equivalents: 0, awaiting: 0, days: 0 })
    assert.equal(workerMonthTotals([null, {}]).days, 2)
  })
})
