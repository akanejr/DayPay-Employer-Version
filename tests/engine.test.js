/* DayPay Employer Version — pay engine tests.
 *
 * These pin the three rules that make DayPay trustworthy. They are pure
 * functions, so the suite needs no browser, no database and no dependencies:
 * node --test only. That matters here, because node_modules is stripped from
 * the sandbox between turns and a test suite that dies with it protects
 * nothing.
 *
 * Run:  npm test
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { sortPeriods, normalizePeriods, migratePeriods, rateFor } from '../src/lib/rates.js'
import {
  fmtMoney, fmtEquiv, equivOf, payslipModel, explainerKind, calcLines, breakdownRows,
} from '../src/lib/payslip.js'

// ── Builders ────────────────────────────────────────────────────────────────

/* Mirrors how App.jsx stamps a record: the multiplier follows the kind, using
   the same weekend multiplier for weekday overtime (see the app's
   reclassify path, which uses weekendMultiplier for 'overtime'). */
const MULT_BY_KIND = { regular: 1, weekend: 2, overtime: 2, holiday: 2 }

const day = (date, { rate = 16000, mult, kind = 'regular', leaveType, percent } = {}) => {
  const multiplier = kind === 'leave' ? percent / 100 : (mult ?? MULT_BY_KIND[kind])
  const rec = {
    date,
    rate,
    multiplier,
    amount: Math.round(rate * multiplier * 100) / 100,
    isWeekend: kind === 'weekend',
    isOvertime: kind === 'overtime',
    isHoliday: kind === 'holiday',
    isLeave: kind === 'leave',
  }
  if (kind === 'leave') rec.leaveType = leaveType ?? 'annual'
  return rec
}

const PERIODS = [
  { from: '2026-01-01', dailyRate: 16000, weekendMultiplier: 2, holidayMultiplier: 2 },
  { from: '2026-06-01', dailyRate: 20000, weekendMultiplier: 2, holidayMultiplier: 2 },
]

// ── Rule 1: rate periods are effective-dated, never retroactive ─────────────

describe('rate periods', () => {
  test('a raise applies from its start date forward', () => {
    assert.equal(rateFor(PERIODS, '2026-05-31', PERIODS[0]).dailyRate, 16000)
    assert.equal(rateFor(PERIODS, '2026-06-01', PERIODS[0]).dailyRate, 20000, 'inclusive on the effective date')
    assert.equal(rateFor(PERIODS, '2026-12-31', PERIODS[0]).dailyRate, 20000)
  })

  test('a gap after the last period keeps the last rate in force', () => {
    assert.equal(rateFor(PERIODS, '2030-01-01', PERIODS[0]).dailyRate, 20000)
  })

  test('a raise never reprices a day worked before it', () => {
    const before = rateFor(PERIODS, '2026-04-15', PERIODS[0])
    assert.equal(before.dailyRate, 16000)
    assert.notEqual(before.dailyRate, rateFor(PERIODS, '2026-07-15', PERIODS[0]).dailyRate)
  })

  test('periods are order-independent', () => {
    const shuffled = [PERIODS[1], PERIODS[0]]
    assert.equal(sortPeriods(shuffled)[0].from, '2026-01-01')
    assert.equal(rateFor(sortPeriods(shuffled), '2026-07-01', PERIODS[0]).dailyRate, 20000)
  })

  test('empty periods fall back to the supplied settings', () => {
    const fallback = { dailyRate: 12345 }
    assert.equal(rateFor([], '2026-01-01', fallback).dailyRate, 12345)
    assert.equal(rateFor(null, '2026-01-01', fallback).dailyRate, 12345)
  })

  test('legacy single-rate settings migrate into a first period', () => {
    const migrated = migratePeriods([], { dailyRate: 15000, weekendMultiplier: 2, holidayMultiplier: 2 }, '2026-03-04', '2026-09-01')
    assert.equal(migrated.length, 1)
    assert.equal(migrated[0].from, '2026-03-04', 'anchored on the earliest logged day')
    assert.equal(migrated[0].dailyRate, 15000)
  })

  test('migration with no history anchors on the month start', () => {
    const migrated = migratePeriods([], { dailyRate: 15000 }, null, '2026-09-01')
    assert.equal(migrated[0].from, '2026-09-01')
  })

  test('normalizePeriods drops malformed rows and sorts', () => {
    const out = normalizePeriods(
      [{ from: '2026-06-01', dailyRate: 20000 }, { from: null }, { dailyRate: 5 }, { from: '2026-01-01', dailyRate: 16000 }],
      { dailyRate: 1000, weekendMultiplier: 2, holidayMultiplier: 2 },
    )
    assert.equal(out.length, 2)
    assert.equal(out[0].from, '2026-01-01')
    assert.equal(out[1].from, '2026-06-01')
  })
})

// ── Rule 2: amounts are frozen on the day they were logged ──────────────────

describe('frozen amounts', () => {
  test('a month at one rate totals correctly', () => {
    const recs = 20
    const model = payslipModel(Array.from({ length: recs }, (_, i) => day(`2026-05-${String(i + 1).padStart(2, '0')}`)))
    assert.equal(model.actualDays, 20)
    assert.equal(model.totalEquiv, 20)
    assert.equal(model.total, 320000)
    assert.equal(model.singleRate, 16000)
    assert.equal(model.reconciles, true)
  })

  test('THE CORE RULE: total is the sum of stored amounts, not days × current rate', () => {
    // 10 days at ₦16,000, then a raise to ₦20,000, then 10 days at ₦20,000.
    const recs = [
      ...Array.from({ length: 10 }, (_, i) => day(`2026-05-${String(i + 1).padStart(2, '0')}`, { rate: 16000 })),
      ...Array.from({ length: 10 }, (_, i) => day(`2026-06-${String(i + 1).padStart(2, '0')}`, { rate: 20000 })),
    ]
    const model = payslipModel(recs)

    assert.equal(model.total, 160000 + 200000, 'sum of frozen amounts')

    // The naive — and wrong — calculation must not appear anywhere.
    const naive = model.actualDays * 20000
    assert.notEqual(model.total, naive, 'a raise must not reprice days already worked')
    assert.equal(naive, 400000)
  })

  test('a mixed-rate month does not claim a single rate', () => {
    const recs = [
      day('2026-05-01', { rate: 16000 }),
      day('2026-06-01', { rate: 20000 }),
    ]
    const model = payslipModel(recs)
    assert.equal(model.singleRate, null, 'no single rate can be reported')
    assert.equal(model.reconciles, false, 'the simple equation does not reconcile')
    assert.equal(explainerKind(model), 'mixed')
  })

  test('mixed rates never print a false uniform equation', () => {
    const recs = [
      ...Array.from({ length: 3 }, (_, i) => day(`2026-05-0${i + 1}`, { rate: 16000 })),
      ...Array.from({ length: 2 }, (_, i) => day(`2026-06-0${i + 1}`, { rate: 20000 })),
    ]
    const lines = calcLines(payslipModel(recs))

    // The true total must be present...
    const total = lines.find(l => l.kind === 'totalKV')
    assert.equal(total.right, fmtMoney(3 * 16000 + 2 * 20000))

    // ...and the honest explanation must be given.
    assert.ok(
      lines.some(l => l.kind === 'note' && /rate in force/i.test(l.text)),
      'must explain that rates changed during the period',
    )

    // A false "N × rate" line is the specific failure this guards against.
    const kvText = lines.filter(l => l.kind === 'kv').map(l => `${l.left} ${l.right}`).join(' | ')
    assert.ok(!/5 × ₦20,000/.test(kvText), 'must not multiply all days by the newest rate')
    assert.ok(!/5 × ₦16,000/.test(kvText), 'must not multiply all days by the oldest rate')
  })

  test('weekend, overtime and holiday earn their multiplier', () => {
    const recs = [
      day('2026-05-01', { kind: 'regular' }),
      day('2026-05-02', { kind: 'weekend' }),
      day('2026-05-04', { kind: 'overtime' }),
      day('2026-05-05', { kind: 'holiday' }),
    ]
    const model = payslipModel(recs)
    assert.equal(model.actualDays, 4, 'four actual days')
    assert.equal(model.totalEquiv, 7, '1 + 2 + 2 + 2 paid-day equivalents')
    assert.equal(model.total, 7 * 16000)
    assert.equal(model.standardTwoX, true)
    assert.equal(explainerKind(model), 'twoX')
  })

  test('leave is paid separately and never counted as worked', () => {
    const recs = [
      day('2026-05-01', { kind: 'regular' }),
      day('2026-05-02', { kind: 'leave', percent: 100 }),
    ]
    const model = payslipModel(recs)
    assert.equal(model.actualDays, 1, 'leave is not a worked day')
    assert.equal(model.leaveDays, 1)
    assert.equal(model.leavePay, 16000)
    assert.equal(model.totalEquiv, 1, 'leave earns no paid-day equivalents')
    assert.equal(model.total, 16000 + 16000)
  })

  test('unpaid leave costs nothing but is still recorded', () => {
    const recs = [
      day('2026-05-01', { kind: 'regular' }),
      day('2026-05-02', { kind: 'leave', percent: 0 }),
    ]
    const model = payslipModel(recs)
    assert.equal(model.leaveDays, 1)
    assert.equal(model.leavePay, 0)
    assert.equal(model.total, 16000)
  })
})

// ── Rule 3: legacy records stay interpretable ───────────────────────────────

describe('legacy records', () => {
  test('equivOf uses the stored multiplier when present', () => {
    assert.equal(equivOf({ multiplier: 2, amount: 32000, rate: 16000 }), 2)
    assert.equal(equivOf({ multiplier: 1, amount: 16000, rate: 16000 }), 1)
  })

  test('equivOf falls back to amount / rate for pre-multiplier records', () => {
    assert.equal(equivOf({ amount: 32000, rate: 16000 }), 2)
    assert.equal(equivOf({ amount: 16000, rate: 16000 }), 1)
  })

  test('leave contributes zero equivalents regardless of shape', () => {
    assert.equal(equivOf({ isLeave: true, multiplier: 3, amount: 999 }), 0)
  })

  test('an empty or malformed record is inert', () => {
    assert.equal(equivOf(null), 0)
    assert.equal(equivOf(undefined), 0)
    assert.equal(equivOf({}), 0)
  })
})

// ── Formatting: deterministic, never locale-dependent ───────────────────────

describe('formatting', () => {
  test('naira grouping is explicit', () => {
    assert.equal(fmtMoney(0), '₦0')
    assert.equal(fmtMoney(16000), '₦16,000')
    assert.equal(fmtMoney(304000), '₦304,000')
    assert.equal(fmtMoney(1234567), '₦1,234,567')
  })

  test('non-finite values degrade to ₦0 rather than NaN on a payslip', () => {
    assert.equal(fmtMoney(NaN), '₦0')
    assert.equal(fmtMoney(Infinity), '₦0')
    assert.equal(fmtMoney(undefined), '₦0')
  })

  test('equivalents drop trailing zeros', () => {
    assert.equal(fmtEquiv(25), '25')
    assert.equal(fmtEquiv(26.5), '26.5')
  })
})

// ── Edge cases that would otherwise reach a payslip ─────────────────────────

describe('edge cases', () => {
  test('an empty month reports no rate rather than a misleading one', () => {
    const model = payslipModel([])
    assert.equal(model.actualDays, 0)
    assert.equal(model.total, 0)
    assert.equal(explainerKind(model), 'none')
    assert.equal(calcLines(model)[0].text, '= ₦0')
  })

  test('a month of leave only still totals correctly', () => {
    const model = payslipModel([day('2026-05-01', { kind: 'leave', percent: 50 })])
    assert.equal(model.actualDays, 0)
    assert.equal(model.leaveDays, 1)
    assert.equal(model.total, 8000)
    assert.equal(model.singleRate, null, 'leave-only month has no worked rate')
  })

  test('breakdownRows always emits a leave row', () => {
    const rows = breakdownRows(payslipModel([day('2026-05-01')]))
    assert.ok(rows.some(r => r.label === 'Leave'), 'leave row is always present for a stable layout')
  })

  test('records with no date do not crash the model', () => {
    assert.doesNotThrow(() => payslipModel([null, undefined, {}, day('2026-05-01')]))
  })
})
