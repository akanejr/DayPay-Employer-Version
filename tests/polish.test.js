/* DayPay — the polish invariants must be able to fail.
 *
 * An assertion that has never failed is not evidence. This file checks the
 * checker: every rule is given something it MUST catch, and something it must
 * leave alone. The second half matters as much as the first — the first draft
 * of the money rule flagged "…totals ₦42,000." because the sentence's full stop
 * looked like kobo, and two healthy panes were reported as broken. A rule that
 * cries wolf gets switched off, and then it protects nothing.
 *
 * The last block guards the money formatting itself. There are two formatters
 * in the product for a reason worth stating: src/lib/payslip.js holds the
 * canonical one, and src/lib/employerLogic.js is deliberately import-free so
 * the employer logic can be tested with nothing loaded, so it keeps its own
 * copy. Copies drift. This proves these two cannot.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { polishProblems } from '../scripts/ui-check/polish.js'
import { formatNaira } from '../src/lib/employerLogic.js'
import { fmtMoney } from '../src/lib/payslip.js'

describe('the polish invariants catch what they are for', () => {
  const caught = (html) => polishProblems(html).length > 0

  test('a leaked JavaScript value', () => {
    assert.ok(caught('<div>Total: undefined</div>'))
    assert.ok(caught('<div>₦NaN</div>'))
    assert.ok(caught('<div>[object Object]</div>'))
  })

  test('money that is not written the way money is written here', () => {
    assert.ok(caught('<div>₦90000</div>'), 'ungrouped')
    assert.ok(caught('<div>₦8,000.5</div>'), 'this product has no kobo')
    assert.ok(caught('<div>₦16.000</div>'), 'a locale that groups with a full stop')
  })

  test('a raw database error', () => {
    assert.ok(caught('<div>PGRST116: no rows returned</div>'))
    assert.ok(caught('<div>syntax error at or near "select"</div>'))
  })
})

describe('the polish invariants leave healthy screens alone', () => {
  const clean = (html) => assert.deepEqual(polishProblems(html), [])

  test('a sentence that ends in an amount', () => {
    clean('<p>Everything recorded for this period has been billed. ₦42,000</p>')
    clean('<p>The period totals ₦42,000.</p>')
    clean('<p>That is ₦1,234,567 in total, and ₦0 outstanding.</p>')
  })

  test('the ₦ sign used as a label rather than an amount', () => {
    clean('<label class="ew-label">Daily rate (₦)</label>')
  })

  test('a class name or attribute, which no one reads', () => {
    clean('<div data-note="undefined" class="ew-undefined-state">Ok</div>')
  })

  test('a negative amount, which payslips and corrections genuinely show', () => {
    clean('<div>-₦5,000</div>')
  })
})

describe('the two money formatters cannot drift apart', () => {
  const values = [0, 1, 7, 999, 1000, 16000, 42000, 304000, 1234567,
    8000.5, 999.4, -5000, -16000, 0.4, '16000', null, undefined, NaN, Infinity]

  test('they agree on every value', () => {
    for (const v of values) {
      assert.equal(formatNaira(v), fmtMoney(v), `disagreed on ${String(v)}`)
    }
  })

  test('and the agreed answer is the documented one', () => {
    assert.equal(fmtMoney(16000), '₦16,000')
    assert.equal(fmtMoney(0), '₦0')
    assert.equal(fmtMoney(1234567), '₦1,234,567')
    assert.equal(fmtMoney(-5000), '-₦5,000')
    assert.equal(fmtMoney(8000.5), '₦8,001', 'whole naira, rounded')
    assert.equal(fmtMoney(NaN), '₦0', 'never the string NaN')
  })
})
