/* Phase 7 — the worker profile, driven in a real DOM.
 *
 * Phase 7 rebuilt the one screen that is about a single person. What has to hold,
 * and what a screenshot cannot show:
 *
 *   · the money on it is the engine's money. Every figure — the month total, the
 *     days, the paid-day equivalents, the count waiting for confirmation, the rate
 *     and the multipliers — is computed here with the same pure functions the
 *     screen uses (workerMonthTotals, rateOn, multiplierFor) and the DOM has to
 *     agree with it, exactly, not approximately;
 *   · the screen can tell "this worker has no rate" from "nobody told this screen
 *     about rates". The first is a day that cannot be saved and has to be said out
 *     loud; the second must be silent, because claiming a missing rate that the
 *     screen never looked for would send an employer to fix something that is not
 *     broken;
 *   · the month STEPS. It used to be pinned to the current month, so "was he in
 *     last month?" had no answer on the screen about him. The check stages a day in
 *     the previous month and insists it appears only after a step back — and that
 *     the step actually asked for that month;
 *   · opening the profile writes nothing, a month with no days says so, and a
 *     failed load says so instead of drawing a blank pane.
 *
 * THE CLOCK IS FROZEN ON THE 20th, before anything is imported, for the same
 * reason today.jsx and attendance.jsx freeze it: this screen answers "what is this
 * month worth", and the answer must not depend on which day the suite runs.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { createRequire } from 'node:module'
const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
const { JSDOM } = require_('jsdom')

// ── the clock, frozen before the app is loaded ──────────────────────────────
const REAL_NOW = new Date()
const FROZEN = new Date(REAL_NOW.getFullYear(), REAL_NOW.getMonth(), 20, 10, 0, 0)
const RealDate = Date
class FrozenDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(FROZEN.getTime()) }
  static now() { return FROZEN.getTime() }
}
global.Date = FrozenDate

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'https://daypay.test/',
})
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const WorkerView = (await import('../../src/employer/WorkerView.jsx')).default
const EmployerWorkspace = (await import('../../src/employer/EmployerWorkspace.jsx')).default
const mock = await import('./mock-employer.js')
const { polishProblems } = await import('./polish.js')

let bad = 0
const ok = (label, pass, detail) => {
  if (!pass) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1 }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 25)) }) }

const press = async (el) => {
  if (!el) return false
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await settle()
  return true
}

const textOf = (el) => (el ? el.textContent || '' : '')
const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => textOf(e).trim().includes(text))

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await settle()
  await settle()
  return { host, close: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

/* ── the worker, and the month around them ──────────────────────────────────
   Two people, because two of the screen's statements are about the difference
   between them: one has a DayPay sign-in, one does not. Both have a rate and a
   month of days, so the money on the screen is real money. */
const STAGED = [{
  id: 'e9', employer_id: 'o1', full_name: 'Amina Yusuf', job_title: 'Welder',
  email: null, employee_user_id: 'u9', invite_code: null, status: 'active',
  contractor_id: 'c1', created_at: mock.FIXTURE.STAMP(mock.FIXTURE.WORK_DAY, '07:00:00Z'),
}, {
  id: 'e8', employer_id: 'o1', full_name: 'Bassey Etim', job_title: null,
  email: null, employee_user_id: null, invite_code: null, status: 'active',
  contractor_id: null, created_at: mock.FIXTURE.STAMP(mock.FIXTURE.WORK_DAY, '07:00:00Z'),
}]
mock.setExtraEmployees(STAGED)
mock.addRateFixture({
  id: 'p9', employee_id: 'e9', effective_from: mock.FIXTURE.DATE(1),
  daily_rate: 20000, weekend_multiplier: 2, holiday_multiplier: 2,
})
/* A month of the registered worker's days, staged through the mock's own door so
   the figures come from stored rows rather than from the screen's optimism. */
const STAGED_DAYS = [
  { id: 'p7-a', employee_id: 'e9', work_date: mock.FIXTURE.DATE(mock.FIXTURE.WORK_DAY),
    kind: 'work', status: 'confirmed', amount: 20000, rate: 20000, multiplier: 1,
    source: 'employer', note: null },
  { id: 'p7-b', employee_id: 'e9', work_date: mock.FIXTURE.DATE(mock.FIXTURE.OT_DAY),
    kind: 'overtime', status: 'claimed', amount: 40000, rate: 20000, multiplier: 2,
    source: 'employer', note: 'Night shift' },
  { id: 'p7-c', employee_id: 'e9', work_date: mock.FIXTURE.DATE(mock.FIXTURE.MISSING_DAY),
    kind: 'leave', status: 'confirmed', amount: 20000, rate: 20000, multiplier: 1,
    source: 'employer', note: null },
]
/* Every fixture this file stages is taken away again at the foot of it. The suites
   share one mock, and a month of days left behind is not a leak that shows up here
   — it shows up in whichever suite runs next and reads a whole month. (It did: the
   Reports check found a previous-month day that belongs to this file.) */
for (const d of STAGED_DAYS) mock.addMonthFixture(d)

/* A day in the PREVIOUS month, derived from the calendar — never pinned — so the
   month stepper has something only it can show. */
const [CUR_Y, CUR_M] = mock.FIXTURE.MONTH_KEY.split('-').map(Number)
const LAST_MONTH_DATE = new Date(CUR_Y, CUR_M - 2, 8)
const LAST_MONTH_KEY = `${LAST_MONTH_DATE.getFullYear()}-${String(LAST_MONTH_DATE.getMonth() + 1).padStart(2, '0')}-08`
const LAST_MONTH_LABEL = mock.monthLabelFor(LAST_MONTH_DATE.getFullYear(), LAST_MONTH_DATE.getMonth())
mock.addMonthFixture({
  id: 'p7-last', employee_id: 'e9', work_date: LAST_MONTH_KEY, kind: 'work',
  status: 'confirmed', amount: 20000, rate: 20000, multiplier: 1,
  source: 'employer', note: null,
})
const STAGED_DAY_IDS = [...STAGED_DAYS.map(d => d.id), 'p7-last']

const registered = STAGED[0]
const unregistered = STAGED[1]
const PERIODS = await mock.listAllRatePeriods()
const TODAY = mock.todayKey()
const MY_DAYS = await mock.listEmployeeMonth('e9', CUR_Y, CUR_M - 1)
const ENGINE = mock.workerMonthTotals(MY_DAYS)
const RATE = mock.rateOn(PERIODS.filter(p => p.employee_id === 'e9'), TODAY)

// ══ 1. Who this is ═════════════════════════════════════════════════════════
{
  const { host, close } = await mount(
    <WorkerView employee={registered} periods={PERIODS} contractorName="Contractor A"
      onBack={() => {}} onChanged={() => {}} />)
  ok('the profile renders', !!host.querySelector('.ew-prof'))
  ok('the worker’s name is the heading', textOf(host.querySelector('h2')) === 'Amina Yusuf',
    textOf(host.querySelector('h2')))
  ok('trade and contractor are one line, in that order',
    textOf(host.querySelector('.ew-prof-sub')) === 'Welder · Contractor A',
    textOf(host.querySelector('.ew-prof-sub')))
  ok('the account state is a word, not only a colour',
    textOf(host.querySelector('.ew-prof-chips')).includes('Registered'),
    textOf(host.querySelector('.ew-prof-chips')))
  ok('and the profile passes the polish invariants',
    polishProblems(host.innerHTML).length === 0, polishProblems(host.innerHTML).join(' | '))
  await close()
}

// ══ 2. A worker record is not a user account ═══════════════════════════════
{
  const { host, close } = await mount(
    <WorkerView employee={unregistered} periods={PERIODS} contractorName={null}
      onBack={() => {}} onChanged={() => {}} />)
  ok('a worker with no sign-in says "Not registered"',
    textOf(host.querySelector('.ew-prof-chips')).includes('Not registered'),
    textOf(host.querySelector('.ew-prof-chips')))
  ok('and the screen explains what that means, so it cannot be read as "not employed"',
    /still on your workforce/i.test(textOf(host.querySelector('.ew-prof-hint'))),
    textOf(host.querySelector('.ew-prof-hint')))
  ok('with no trade and no contractor, the line says so rather than being blank',
    textOf(host.querySelector('.ew-prof-sub')).includes('No trade or contractor set'),
    textOf(host.querySelector('.ew-prof-sub')))
  await close()
}

// ══ 3. The money is the engine’s money ═════════════════════════════════════
{
  const { host, close } = await mount(
    <WorkerView employee={registered} periods={PERIODS} contractorName="Contractor A"
      onBack={() => {}} onChanged={() => {}} />)

  const sum = textOf(host.querySelector('.ew-prof-hero-sum'))
  ok('the month total is the stored rows added up', sum === mock.formatNaira(ENGINE.total),
    `${sum} vs engine ${mock.formatNaira(ENGINE.total)}`)
  /* The figure is labelled, and the label distinguishes "this month" from a month
     the employer stepped to — otherwise the amount with no month on it is a number
     that could belong to anything. */
  ok('the figure says which month it belongs to',
    textOf(host.querySelector('.ew-prof-hero-label')) === 'Earned this month',
    textOf(host.querySelector('.ew-prof-hero-label')))
  ok('and the month is named in full on the bar above it',
    textOf(host.querySelector('.ew-datebar-day')).includes(mock.FIXTURE.MONTH_NAME),
    textOf(host.querySelector('.ew-datebar-day')))

  /* The three facts, read by EQUALITY off their own row — the same way attendance
     reads its month figures, because `includes('1')` is satisfied by '13'. */
  const facts = [...host.querySelectorAll('.ew-prof-fact')].map(r => ({
    label: textOf(r.querySelector('dt')).trim(),
    value: textOf(r.querySelector('dd')).trim(),
  }))
  const fact = (starts) => facts.find(f => f.label.startsWith(starts))
  ok('the days recorded is the engine’s count',
    fact('Days recorded') && fact('Days recorded').value === String(ENGINE.days),
    `${fact('Days recorded') && fact('Days recorded').value} vs ${ENGINE.days}`)
  ok('the paid-day equivalents are the engine’s',
    fact('Paid-day equivalents') && fact('Paid-day equivalents').value === String(ENGINE.equivalents),
    `${fact('Paid-day equivalents') && fact('Paid-day equivalents').value} vs ${ENGINE.equivalents}`)
  ok('the days waiting for confirmation are counted',
    fact('Waiting for confirmation') && fact('Waiting for confirmation').value === String(ENGINE.awaiting),
    `${fact('Waiting for confirmation') && fact('Waiting for confirmation').value} vs ${ENGINE.awaiting}`)
  ok('and unconfirmed money is not presented as settled',
    /not counted as settled yet/.test(textOf(host.querySelector('.ew-prof-facts'))),
    textOf(host.querySelector('.ew-prof-facts')))

  /* The rate sentence: the day rate in force, the multipliers, and the date it
     started — every value read off the rate period the database would use. */
  const rateLine = textOf(host.querySelector('.ew-prof-rate'))
  ok('the rate is the one in force today, in naira',
    rateLine.includes(mock.formatNaira(RATE.daily_rate)), rateLine)
  ok('with the weekend multiplier that would value a Saturday',
    rateLine.includes(`${RATE.weekend_multiplier}×`), rateLine)
  ok('and the holiday multiplier', rateLine.includes(`${RATE.holiday_multiplier}×`), rateLine)

  const problems = polishProblems(host.innerHTML)
  ok('the profile’s money passes the polish invariants', problems.length === 0, problems.join(' | '))
  await close()
}

// ══ 4. "No rate" and "not told" are different answers ══════════════════════
{
  /* The roster and the command centre both hand this screen the rate history. The
     CONTRACTOR's list does not — it opens a worker of a contractor it was given a
     day's figures for. In that case the screen must say nothing about rates rather
     than claim there is none. */
  const silent = await mount(
    <WorkerView employee={registered} contractorName="Contractor A" onBack={() => {}} onChanged={() => {}} />)
  ok('a screen that was not told about rates says nothing about them',
    !silent.host.querySelector('.ew-prof-rate'), textOf(silent.host.querySelector('.ew-prof-rate')))
  ok('and it still shows the month’s figures, which it did load',
    textOf(silent.host.querySelector('.ew-prof-hero-sum')) === mock.formatNaira(ENGINE.total))
  await silent.close()

  const none = await mount(
    <WorkerView employee={registered} periods={[]} contractorName="Contractor A"
      onBack={() => {}} onChanged={() => {}} />)
  const missing = none.host.querySelector('.ew-prof-rate.is-missing')
  ok('a worker with no rate at all is told so plainly', !!missing, textOf(none.host.querySelector('.ew-prof-rate')))
  ok('and it says what that stops — a day that cannot be saved',
    /cannot be saved or paid/i.test(textOf(missing)), textOf(missing))
  ok('and where to fix it', /Rates/.test(textOf(missing)) && /People/.test(textOf(missing)), textOf(missing))
  await none.close()
}

// ══ 5. The month steps, and it asks for the month it shows ═════════════════
{
  const { host, close } = await mount(
    <WorkerView employee={registered} periods={PERIODS} contractorName="Contractor A"
      onBack={() => {}} onChanged={() => {}} />)

  ok('the current month is where it opens',
    textOf(host.querySelector('.ew-prof-hero-label')) === 'Earned this month',
    textOf(host.querySelector('.ew-prof-hero-label')))

  /* The grid holds this month's days and nothing else. The day staged in the
     previous month is a real day eight days into it: if it could leak into this
     month's grid or into this month's total, this is where it would show. */
  const expectedDays = MY_DAYS.map(d => Number(d.work_date.slice(-2))).sort((a, b) => a - b)
  const gridDay = (n) => [...host.querySelectorAll('.ew-mgrid-cell')]
    .find(c => textOf(c.querySelector('.ew-mgrid-day')) === String(n))
  ok('the grid holds exactly this month’s recorded days',
    JSON.stringify([...host.querySelectorAll('.ew-mgrid-cell.is-marked .ew-mgrid-day')]
      .map(e => Number(textOf(e))).sort((a, b) => a - b)) === JSON.stringify(expectedDays),
    `recorded: ${expectedDays.join(', ')}`)
  if (!expectedDays.includes(8)) {
    ok('and the day staged in the previous month is not among them',
      !((gridDay(8) || { className: '' }).className || '').includes('is-marked'),
      (gridDay(8) || {}).className)
  }

  const before = (globalThis.__calls || []).length
  await press(host.querySelector('[aria-label="Previous month"]'))
  const asked = (globalThis.__calls || []).slice(before).filter(c => c[0] === 'listEmployeeMonth')
  const step = asked[asked.length - 1]
  /* The month is 0-based, the way every call in the data layer takes it. */
  ok('stepping back asks the server for that month, not a filtered cache',
    !!step && `${step[2]}-${String(step[3] + 1).padStart(2, '0')}` === LAST_MONTH_KEY.slice(0, 7),
    step ? `${step[2]}-${String(step[3] + 1).padStart(2, '0')}` : 'no read')
  ok('and the screen says which month it is now',
    textOf(host.querySelector('.ew-board-date')).includes(LAST_MONTH_LABEL),
    textOf(host.querySelector('.ew-board-date')))
  ok('and offers the way back to this month', !!byText(host, '.ew-datebar-today', 'Back to this month'))

  /* The real proof that the step is a fetch and not a re-render: the previous
     month's day is now on the calendar, and it was not before. */
  const marked = [...host.querySelectorAll('.ew-mgrid-cell.is-marked .ew-mgrid-day')].map(e => Number(textOf(e)))
  ok('the previous month’s day is on the calendar now, and it was not before',
    marked.length === 1 && marked[0] === 8, `marked: ${marked.join(', ')}`)
  ok('with the month’s total for that month, not the old one',
    textOf(host.querySelector('.ew-prof-hero-sum')) === mock.formatNaira(20000),
    textOf(host.querySelector('.ew-prof-hero-sum')))

  await press(byText(host, '.ew-datebar-today', 'Back to this month'))
  ok('and back to this month restores it',
    textOf(host.querySelector('.ew-prof-hero-sum')) === mock.formatNaira(ENGINE.total))
  await close()
}

// ══ 6. A day, opened from the calendar ═════════════════════════════════════
{
  const { host, close } = await mount(
    <WorkerView employee={registered} periods={PERIODS} contractorName="Contractor A"
      onBack={() => {}} onChanged={() => {}} />)

  const cells = host.querySelectorAll('.ew-mgrid-cell.is-marked')
  ok('the recorded days are on the calendar', cells.length === MY_DAYS.length,
    `${cells.length} marked cell(s) for ${MY_DAYS.length} day(s)`)

  /* The day is addressed by its number, and the sheet must be about THAT day —
     the same date the stored row carries. */
  const overtime = MY_DAYS.find(d => d.kind === 'overtime')
  const cell = [...cells].find(c => textOf(c.querySelector('.ew-mgrid-day')) === String(Number(overtime.work_date.slice(-2))))
  await press(cell)
  const sheet = host.querySelector('.ew-sheet')
  ok('tapping a day opens its own detail', !!sheet)
  ok('the sheet names that day', textOf(sheet).includes(mock.prettyDateKey(overtime.work_date)),
    textOf(sheet).slice(0, 70))
  ok('and shows the amount the server stored, not a fresh calculation',
    textOf(sheet).includes(mock.formatNaira(overtime.amount)), textOf(sheet).slice(0, 90))
  ok('with the rate that was in force on the day',
    textOf(sheet).includes(mock.formatNaira(overtime.rate)))
  ok('and the multiplier it was valued at', textOf(sheet).includes(`${overtime.multiplier}×`))
  await close()
}

// ══ 7. A month with nothing in it says so ══════════════════════════════════
{
  const { host, close } = await mount(
    <WorkerView employee={registered} periods={PERIODS} contractorName="Contractor A"
      onBack={() => {}} onChanged={() => {}} />)
  await press(host.querySelector('[aria-label="Next month"]'))
  const notice = host.querySelector('.dp-notice.is-empty')
  ok('a month with no days is stated, not left blank', !!notice, textOf(notice).slice(0, 70))
  ok('and it says where days come from', /Attendance/.test(textOf(notice)), textOf(notice))
  ok('and it offers the way back to this month', !!byText(host, '.dp-notice .ew-btn', 'Back to this month'))
  await close()
}

// ══ 8. A failed load is said out loud ══════════════════════════════════════
{
  mock.setReadFailure('listEmployeeMonth')
  const { host, close } = await mount(
    <WorkerView employee={registered} periods={PERIODS} contractorName="Contractor A"
      onBack={() => {}} onChanged={() => {}} />)
  const notice = host.querySelector('.dp-notice.is-error')
  ok('a screen that could not load its days says so', !!notice, textOf(notice).slice(0, 80))
  ok('in the product’s own words, not the database’s',
    /Could not load this worker/.test(textOf(notice)) && !/PGRST|SQLSTATE/.test(textOf(notice)),
    textOf(notice))
  ok('and offers a way to try again', !!byText(host, '.dp-notice .ew-btn', 'Try again'))

  mock.setReadFailure(null)
  await press(byText(host, '.dp-notice .ew-btn', 'Try again'))
  ok('trying again loads the month', !!host.querySelector('.ew-prof-hero-sum'))
  await close()
}

// ══ 9. Opening a profile writes nothing, and recording stays on Attendance ══
{
  /* The roster's own path: open a worker from People and come back. */
  try { dom.window.location.hash = '/people' } catch { /* nothing to set */ }
  const { host, close } = await mount(<EmployerWorkspace />)
  const row = [...host.querySelectorAll('.ew-list:not(.is-archived) .ew-row-open')]
    .find(r => textOf(r).includes('Amina Yusuf'))
  const before = (globalThis.__calls || []).length
  await press(row)
  ok('the roster opens the profile', !!host.querySelector('.ew-prof'))
  ok('and opening a worker wrote nothing',
    (globalThis.__calls || []).slice(before).filter(c => c[0] !== 'listEmployeeMonth').length === 0,
    JSON.stringify((globalThis.__calls || []).slice(before)))

  /* This screen keeps its own write path — confirming, disputing, reopening and
     removing a day, and answering a correction — and it deliberately has NO way to
     record a new day: that is Attendance's job, and a second marking screen is how
     a day gets recorded twice. */
  ok('there is no mark control anywhere on the profile',
    host.querySelectorAll('.ew-att-mark').length === 0,
    `${host.querySelectorAll('.ew-att-mark').length} mark control(s)`)

  /* Open a day with nothing recorded on it and read what the screen says. */
  await press([...host.querySelectorAll('.ew-mgrid-cell.is-empty')][0])
  ok('an empty day opens its detail rather than doing nothing', !!host.querySelector('.ew-sheet'))
  ok('and it says where a day comes from, instead of offering a form',
    /Days are recorded one at a time from/.test(textOf(host.querySelector('.ew-sheet'))),
    textOf(host.querySelector('.ew-sheet')).slice(0, 110))
  ok('and looking at a day wrote nothing',
    (globalThis.__calls || []).slice(before)
      .filter(c => c[0] === 'setDay' || c[0] === 'clearDay').length === 0,
    JSON.stringify((globalThis.__calls || []).slice(before).filter(c => c[0] !== 'listEmployeeMonth')))
  await close()
}

/* ── put the fixtures back ────────────────────────────────────────────────────
   A suite whose fixtures leak into the next one fails for reasons nobody can see,
   and the mock's own note says so. Everything staged above leaves here. */
for (const id of STAGED_DAY_IDS) mock.removeMonthFixture(id)
mock.removeRateFixture('p9')
mock.setExtraEmployees([])

console.log(bad === 0 ? '\nPROFILE: ONE PERSON, AND THE NUMBERS ARE THE ENGINE’S' : `\nPROFILE: ${bad} CHECK(S) FAILED`)
