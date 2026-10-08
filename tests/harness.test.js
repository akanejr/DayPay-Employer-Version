/* The UI check's fixtures, held to the month the app actually opens on.
 *
 * This file exists because of a specific, dated failure. On 1 October 2026 the
 * UI check went from ALL GREEN to dying mid-suite, and the cause was not the
 * app: the fixtures in scripts/ui-check/mock-employer.js were pinned to
 * September 2026, and the employer screen opens on the CURRENT month. So
 * September's days were no longer on the calendar at all. The run reported
 *
 *     FAIL  the calendar shows the recorded days  -> 0 marked cell(s)
 *     FAIL  Billing, loaded period — missing: Not yet billed | Ready to bill …
 *
 * and then threw "tried to click something that is not there" when a check went
 * looking for the cell labelled '10'. Every one of those messages reads like a
 * broken product. All of them were a broken test.
 *
 * A suite that silently stops testing is worse than a suite that fails, and
 * nothing in the repo could have caught it — `npm run prove` does not run the
 * UI check, so the only thing that noticed was somebody happening to run it.
 * Hence two checks here, both of which would have failed on 30 September:
 *
 *   1. the fixture dates the harness uses are inside the current month, and
 *      the ones the app marks on a calendar are weekdays (the app marks
 *      weekends 2×, so a "plain working day" that lands on a Saturday would
 *      not mean what the check says it means);
 *   2. no ISO date literal is pinned anywhere in the harness — the fixtures are
 *      derived from today, so this cannot rot again the way it just did.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const uiCheckDir = path.join(repoRoot, 'scripts', 'ui-check')

const fixture = await import(path.join(uiCheckDir, 'mock-employer.js'))
const FIX = fixture.FIXTURE

/* The integration chain's day choices (see the last suite in this file). Imported
   at the top because a `describe` body is not an async context. */
const chainDays = await import(path.join(repoRoot, 'scripts', 'integration', 'fixture-days.mjs'))

const now = new Date()
const thisYear = now.getFullYear()
const thisMonth = now.getMonth() // 0-based
const thisMonthKey = `${thisYear}-${String(thisMonth + 1).padStart(2, '0')}`

/** 'YYYY-MM-DD' for the current month, at a given day. */
const inMonth = (day) => `${thisMonthKey}-${String(day).padStart(2, '0')}`
const weekdayOf = (day) => new Date(thisYear, thisMonth, day).getDay()

describe('the UI check’s fixtures belong to the month the app opens on', () => {
  test('the fixture month IS the current month', () => {
    assert.equal(FIX.MONTH_KEY, thisMonthKey,
      'the harness pins its fixtures to a month the app will not open on')
    assert.equal(FIX.YEAR, thisYear)
  })

  test('every day the harness names exists in the current month', () => {
    const days = {
      WORK_DAY: FIX.WORK_DAY, OT_DAY: FIX.OT_DAY,
      MISSING_DAY: FIX.MISSING_DAY, WEEKEND_DAY: FIX.WEEKEND_DAY,
      TODAY_DAY: FIX.TODAY_DAY,
    }
    for (const [name, day] of Object.entries(days)) {
      assert.ok(Number.isInteger(day) && day >= 1 && day <= FIX.LAST_DAY,
        `${name} is ${day}, which is not a day of ${FIX.MONTH_NAME} ${FIX.YEAR}`)
    }
  })

  test('the days the app prices as ordinary work are weekdays', () => {
    // The calendar marks a weekend 2×, so a fixture that landed on a Saturday
    // would be a different assertion wearing the same label.
    for (const name of ['WORK_DAY', 'OT_DAY', 'MISSING_DAY']) {
      const day = FIX[name]
      const wd = weekdayOf(day)
      assert.ok(wd !== 0 && wd !== 6,
        `${name} is day ${day}, a ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]} — not an ordinary working day`)
    }
  })

  test('the one weekend fixture is actually a weekend', () => {
    const wd = weekdayOf(FIX.WEEKEND_DAY)
    assert.ok(wd === 0 || wd === 6,
      `WEEKEND_DAY is day ${FIX.WEEKEND_DAY}, a ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]}`)
  })

  test('the day numbers stay inside the first 28, so February is not a special case', () => {
    for (const name of ['WORK_DAY', 'OT_DAY', 'MISSING_DAY', 'WEEKEND_DAY']) {
      assert.ok(FIX[name] <= 28, `${name} is ${FIX[name]}; days past 28 do not exist in every month`)
    }
  })

  test('DATE() and LABEL() agree with the calendar', () => {
    assert.equal(FIX.DATE(1), inMonth(1))
    assert.equal(FIX.DATE(FIX.LAST_DAY), inMonth(FIX.LAST_DAY))
    // last day of THIS month, computed independently
    const lastDay = new Date(thisYear, thisMonth + 1, 0).getDate()
    assert.equal(FIX.LAST_DAY, lastDay)
    // the label the assertions look for is the date the day view renders
    assert.match(FIX.LABEL(FIX.WORK_DAY), new RegExp(`^${FIX.WORK_DAY} \\w{3} ${thisYear}$`))
    assert.ok(FIX.LABEL(FIX.WORK_DAY).includes(FIX.MONTH_NAME))
  })

  test('the rate period starts on or before the month it has to price', async () => {
    // A rate effective AFTER the fixture days prices them at nothing, and every
    // money assertion downstream ends up measuring the wrong number.
    const periods = await fixture.myRatePeriods()
    assert.ok(periods.length > 0, 'the fixture has no rate periods at all')
    const earliest = periods.map((p) => p.effective_from).sort()[0]
    assert.ok(earliest <= inMonth(1),
      `the rate period starts ${earliest}, after the month it is meant to price (${FIX.MONTH_KEY})`)
  })
})

describe('no date in the UI check is pinned to a day that will pass', () => {
  const harnessFiles = fs.readdirSync(uiCheckDir)
    .filter((f) => /\.(js|jsx)$/.test(f))

  test('the harness has files to scan', () => {
    assert.ok(harnessFiles.length >= 6, `only found ${harnessFiles.join(', ')}`)
  })

  test('not one ISO date literal is left in any harness file', () => {
    const offenders = []
    for (const file of harnessFiles) {
      const src = fs.readFileSync(path.join(uiCheckDir, file), 'utf8')
      src.split('\n').forEach((line, i) => {
        const m = line.match(/['"`]20\d\d-\d\d-\d\d[^'"`]*['"`]/)
        if (m) offenders.push(`${file}:${i + 1}  ${m[0]}`)
      })
    }
    assert.deepEqual(offenders, [],
      'a pinned date in the harness stops the suite testing anything the moment the\n'
      + 'calendar moves past it. Derive it from today instead (see mock-employer.js).')
  })

  test('the fixtures really are derived from today, not from a month constant', () => {
    const src = fs.readFileSync(path.join(uiCheckDir, 'mock-employer.js'), 'utf8')
    assert.match(src, /const NOW = new Date\(\)/)
    assert.match(src, /const MONTH_KEY = `\$\{YEAR\}-/)
    assert.match(src, /export const FIXTURE = \{/)
    assert.ok(!/MONTH_KEY = '\d{4}-/.test(src), 'MONTH_KEY is pinned to a literal')
  })
})

/* ── the integration chain's own calendar ──────────────────────────────────────
 *
 * The same class of failure as the one above, found on 3 October 2026 — a Saturday.
 * `npm run prove` had been green the day before and failed five checks the next
 * morning with no line of the product changed:
 *
 *     FAIL  and it is recorded as a check-in, awaiting the employer  -> kind weekend
 *     FAIL  the ledger holds it, valued by the trigger …             -> ₦40000 = ₦20000 x 2
 *     FAIL  recorded as a correction, so the worker can see where it came from
 *
 * The ledger was right in all five. The chain had assumed a weekday (the database
 * sets a check-in's kind from the DATE — `isodow >= 6` is a weekend day at the
 * weekend multiplier) and it had assumed day 6 was free, when day 6 is exactly the
 * day the correction scenario asks about. The day it runs on is not a detail the
 * chain is allowed to have an opinion about, so the choices live in
 * `scripts/integration/fixture-days.mjs` and are walked below — every day of the
 * month, not just the one this happens to run on.
 */
describe('the integration chain expects the day it runs on', () => {
  const { extraDaysFor, checkInKind, checkInMultiplier, correctionDayFor } = chainDays

  test('the three extra days never collide with a day another scenario owns', () => {
    const clashes = []
    for (let dom = 1; dom <= 28; dom += 1) {
      const picked = extraDaysFor(dom)
      if (picked.length !== 3) clashes.push(`day ${dom}: picked ${picked.length} days, not three`)
      for (const d of picked) {
        if (d === dom) clashes.push(`day ${dom}: the employer's day ${d} IS the check-in day`)
        if (d === correctionDayFor(dom)) clashes.push(`day ${dom}: the employer wrote the correction day ${d}`)
        if (d === 1 || d === 2) clashes.push(`day ${dom}: the employer wrote rate-history day ${d}`)
        if (d > 28) clashes.push(`day ${dom}: day ${d} falls outside the first 28`)
      }
      if (new Set(picked).size !== picked.length) clashes.push(`day ${dom}: ${picked} repeat a day`)
    }
    assert.deepEqual(clashes, [],
      'a day two scenarios both write is a check that proves nothing — this is the\n'
      + 'fault that turned five checks red on the 3rd of a month (see fixture-days.mjs)')
  })

  test('the correction day is never the day the chain runs on', () => {
    /* The other half of the same fault, and the one that only shows up on one day of
       the month: the correction is about a day "missing from their month", and on the
       6th that day is today — which the check-in above has already written. The
       approved correction then correctly does nothing (the database refuses to
       rewrite an existing day because somebody said it was absent), and the chain
       reported a failure where the ledger was right. */
    const clashes = []
    for (let dom = 1; dom <= 28; dom += 1) {
      const picked = correctionDayFor(dom)
      if (!picked) clashes.push(`day ${dom}: no correction day at all`)
      if (picked === dom) clashes.push(`day ${dom}: the correction IS about the day we checked in on`)
      if (extraDaysFor(dom).includes(picked)) clashes.push(`day ${dom}: the employer also wrote day ${picked}`)
      if (picked === 1 || picked === 2) clashes.push(`day ${dom}: the correction is about rate-history day ${picked}`)
      if (picked === 20) clashes.push(`day ${dom}: the correction is about the day after the rate change`)
      // and every day but the one it runs on keeps the number the docs name
      if (dom !== 6 && picked !== 6) clashes.push(`day ${dom}: day 6 was free and the chain moved off it`)
    }
    assert.deepEqual(clashes, [],
      'a correction about a day that is already written proves nothing (see fixture-days.mjs)')
  })

  test('and what the ledger must say about the check-in day is asked of the date', () => {
    // 2026-10-03 is a Saturday; 2026-10-05 the Monday after it.
    assert.equal(checkInKind('2026-10-03'), 'weekend')
    assert.equal(checkInMultiplier('2026-10-03'), 2)
    assert.equal(checkInKind('2026-10-04'), 'weekend')
    assert.equal(checkInKind('2026-10-05'), 'work')
    assert.equal(checkInMultiplier('2026-10-05'), 1)
    // and it is the engine's rule, not a second copy of it
    assert.equal(checkInKind('2026-10-03'), FIX.suggestedKind?.('2026-10-03') ?? 'weekend')
  })

  test('the chain reads those choices instead of keeping its own', () => {
    const chain = fs.readFileSync(path.join(repoRoot, 'scripts', 'integration', 'e2e.mjs'), 'utf8')
    assert.match(chain, /extraDaysFor\(DOM\)/, 'the extra days are chosen inline again')
    assert.match(chain, /correctionDayFor\(DOM\)/, 'the correction day is a fixed day again')
    assert.match(chain, /checkInKind\(TODAY\)/, 'the check-in day\'s kind is a literal again')
    assert.match(chain, /checkInMultiplier\(TODAY\)/, 'the check-in day\'s multiplier is a literal again')
    assert.ok(!/kind === 'work' && checked\?\.already/.test(chain),
      'the chain still expects every check-in to be an ordinary work day')
  })

  test('and the shipped RLS harness asks the same question of the date', () => {
    /* `supabase/harness/rls_test.sql` is the file the owner runs in the SQL editor.
       Check 26 asserted `r.kind = 'work'` for a check-in on `current_date`, which is
       true five days a week — so the file "failed" a database that was behaving
       exactly as every migration says it should. */
    const sql = fs.readFileSync(path.join(repoRoot, 'supabase', 'harness', 'rls_test.sql'), 'utf8')
    assert.match(sql, /want := case when extract\(isodow from current_date\) >= 6 then 'weekend' else 'work' end/,
      'check 26 does not derive the kind from the date any more')
    assert.ok(!/r\.kind = 'work' and r\.work_date = current_date/.test(sql),
      'check 26 is back to assuming the day it runs on is a weekday')
  })
})
