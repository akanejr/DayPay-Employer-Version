/* Phase 5 — Attendance, driven in a real DOM.
 *
 * This is the only screen in the product that writes a day into the ledger, so
 * "it looks right" is worth nothing here. What has to hold is:
 *
 *   · a tap records ONE person, on ONE date, with the kind the DATE implies —
 *     and never sends a rate or an amount, because the server values the day;
 *   · nothing else on the screen writes anything: not the range control, not the
 *     week strip, not the month grid, not the row body;
 *   · a recorded person cannot be recorded twice — the second press is an undo;
 *   · every action says what happened, in a live region, because on a phone the
 *     row that changed is often below the fold;
 *   · and the figures shown are the figures stored, with the month total equal to
 *     the same monthFigures() the command centre and the payslip use.
 *
 * The clock is frozen on the 20th, past every fixture the mock defines (they all
 * land in the first eight days), so "nobody is recorded yet" is a real state on
 * every run rather than a state that happens to be true on some dates.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { createRequire } from 'node:module'
const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
const { JSDOM } = require_('jsdom')

const REAL_NOW = new Date()
const FROZEN = new Date(REAL_NOW.getFullYear(), REAL_NOW.getMonth(), 20, 10, 0, 0)
const FROZEN_KEY = `${FROZEN.getFullYear()}-${String(FROZEN.getMonth() + 1).padStart(2, '0')}-20`
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
const StaffDays = (await import('../../src/employer/StaffDays.jsx')).default
const Dashboard = (await import('../../src/employer/Dashboard.jsx')).default
const EmployerWorkspace = (await import('../../src/employer/EmployerWorkspace.jsx')).default
const mock = await import('./mock-employer.js')

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
  /* React listens for the input event and ignores a bare assignment to .value. */
  const type = async (el, value) => {
    if (!el) throw new Error('tried to type into something that is not there')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await settle()
  }
const calls = () => globalThis.__calls || []
/* Every call that is not a read. A search that wrote something would be a bug worth
   failing the suite for. */
const writes = (since) => calls().slice(since).filter(c => !/^list|^my|^invoicesAvailable/.test(c[0]))
const byText = (host, sel, text) => [...host.querySelectorAll(sel)].find(e => textOf(e).trim() === text)
const byLabel = (host, sel, frag) => [...host.querySelectorAll(sel)].find(e => (e.getAttribute('aria-label') || '').includes(frag))
/* The one control that writes: 'Mark' while a day is not recorded, 'Undo' once
   it is. Addressed by what it says rather than by position, because the two
   lists reorder around it. */
const buttonSaying = (host, word) => [...host.querySelectorAll('.ew-att-mark')].find(b => textOf(b).trim() === word)

function section(host, startsWith) {
  const label = [...host.querySelectorAll('.dp-sec')]
    .find(s => textOf(s).trim().startsWith(startsWith))
  return label ? { label, rows: label.nextElementSibling } : null
}

function itemIn(container, title) {
  return [...(container || document).querySelectorAll('.dp-item')].find(r => textOf(r).includes(title))
}

async function mount(host, el) {
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await settle()
  await settle()
  return { root, done: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

async function open(props = {}) {
  const host = document.createElement('div')
  const employees = await mock.listEmployees()
  const contractors = await mock.listContractors()
  const { done } = await mount(host, <StaffDays employees={employees} contractors={contractors} {...props} />)
  return { host, close: done }
}

/* ── the engine's own answers, so these checks cannot drift from it ────────── */
const employees = await mock.listEmployees()
const periods = await mock.listAllRatePeriods()
const rateFor = (date) => mock.rateOn(periods.filter(p => p.employee_id === 'e1'), date)
const worthOf = (kind, date) => {
  const period = rateFor(date)
  return { multiplier: mock.multiplierFor(kind, period, kind === 'leave' ? 100 : 0), rate: period.daily_rate }
}
const monthFiguresNow = async () => mock.monthFigures(await mock.listAllMonth(), employees)

/* The Monday of the frozen week, and the Saturday in it — computed, never
   hardcoded, so the weekend check is a weekend check in every month. */
const mondayOfFrozenWeek = (() => {
  const d = new Date(FROZEN.getFullYear(), FROZEN.getMonth(), 20)
  return mock.shiftDateKey(FROZEN_KEY, -((d.getDay() + 6) % 7))
})()
const SATURDAY = mock.shiftDateKey(mondayOfFrozenWeek, 5)
const WEEKEND_KIND = mock.suggestedKind(SATURDAY)   // 'weekend', whatever day the 20th is

// ══ 1. The day, and the only control that writes it ═════════════════════════
{
  const { host, close } = await open()
  ok('Attendance opens on its own screen', !!host.querySelector('.ew-att'))
  ok('and says what it is', textOf(host.querySelector('.ew-title')).trim() === 'Attendance')

  const ranges = [...host.querySelectorAll('.segmented button')].map(b => textOf(b).trim())
  ok('the range control offers Today, Week and Month', ranges.join(' · ') === 'Today · Week · Month', ranges.join(' · '))
  ok('Today is the range it opens on',
    byText(host, '.segmented button', 'Today')?.getAttribute('aria-pressed') === 'true')
  ok('the day shown is today', textOf(host.querySelector('.ew-datebar-day')).includes(mock.prettyDateKey(FROZEN_KEY)),
    textOf(host.querySelector('.ew-datebar-day')))

  // The fact that decides the money is stated in words, not carried by colour.
  ok('the day says what its kind will be',
    textOf(host.querySelector('.ew-att-day-note')).startsWith(
      mock.suggestedKind(FROZEN_KEY) === 'weekend' ? 'Weekend' : 'Weekday'),
    textOf(host.querySelector('.ew-att-day-note')))

  const un = section(host, 'Not yet recorded')
  ok('the people still to record are the first section', !!un)
  ok('and it counts them', textOf(un && un.label).includes('1'), textOf(un && un.label))
  ok('and names them', textOf(un && un.rows).includes('James Okon'))
  ok('with the trade and the contractor, so two of the same name differ',
    textOf(un && un.rows).includes('Rigger · Contractor A'), textOf(un && un.rows).trim().slice(0, 80))

  ok('nothing is claimed as recorded yet', !section(host, 'Recorded'))
  ok('and the screen says so in words',
    textOf(host.querySelector('.ew-att-foot')).includes(`still to record for ${mock.prettyDateKey(FROZEN_KEY)}`),
    textOf(host.querySelector('.ew-att-foot')))

  const said = host.querySelector('.ew-att-said')
  ok('there is a live region for confirmations',
    said?.getAttribute('role') === 'status' && said?.getAttribute('aria-live') === 'polite')
  ok('and it is empty until something happens', textOf(said).trim() === '')
  await close()
}

// ══ 2. Marking writes one day, and only when the button is pressed ══════════
{
  const { host, close } = await open()
  const row = host.querySelector('.ew-att-row')
  const before = calls().length

  // The row is not the target: a stray tap on a name must not record a day.
  ok('the row itself is not a button', row.tagName === 'DIV')
  await press(host.querySelector('.ew-att-name'))
  ok('and pressing the name records nothing', calls().length === before)

  await press(buttonSaying(host, 'Mark'))
  const wrote = calls().slice(before).filter(c => c[0] === 'setDay' || c[0] === 'clearDay')
  ok('pressing Mark writes exactly one day', wrote.length === 1 && wrote[0][0] === 'setDay', JSON.stringify(wrote))
  ok('for that person, on the selected date',
    wrote[0]?.[1] === 'e1' && wrote[0]?.[2] === FROZEN_KEY, JSON.stringify(wrote[0]))
  ok('with the kind the date implies, not the tap',
    wrote[0]?.[3] === mock.suggestedKind(FROZEN_KEY), `${wrote[0]?.[3]} vs ${mock.suggestedKind(FROZEN_KEY)}`)
  ok('and no rate or amount is ever sent', wrote[0]?.length === 4, JSON.stringify(wrote[0]))

  ok('the person moves to the recorded list', !!section(host, 'Recorded'))
  ok('and leaves the list of people still to record', !section(host, 'Not yet recorded'))
  const worth = worthOf(mock.suggestedKind(FROZEN_KEY), FROZEN_KEY)
  ok('the amount on the row is the amount the server stored',
    textOf(host.querySelector('.ew-att-row')).includes(mock.formatNaira(worth.rate * worth.multiplier)),
    textOf(host.querySelector('.ew-att-row')).trim().slice(0, 80))
  ok('the kind is a word on the row',
    textOf(host.querySelector('.ew-att-row')).includes(mock.KIND_LABELS[mock.suggestedKind(FROZEN_KEY)]))
  ok('the confirmation names the person and the date',
    textOf(host.querySelector('.ew-att-said')).includes('James Okon')
    && textOf(host.querySelector('.ew-att-said')).includes(mock.prettyDateKey(FROZEN_KEY)),
    textOf(host.querySelector('.ew-att-said')))

  // No duplicate marking: one person cannot hold two days for one date.
  const afterMark = calls().length
  await press(buttonSaying(host, 'Undo'))
  const wrote2 = calls().slice(afterMark).filter(c => c[0] === 'setDay' || c[0] === 'clearDay')
  ok('the second press is an undo, not a second day',
    wrote2.length === 1 && wrote2[0][0] === 'clearDay' && wrote2[0][2] === FROZEN_KEY, JSON.stringify(wrote2))
  ok('the person goes back to the list of people to record', !!section(host, 'Not yet recorded'))
  ok('and the undo is confirmed too',
    textOf(host.querySelector('.ew-att-said')).includes('Removed'), textOf(host.querySelector('.ew-att-said')))
  await close()
}

// ══ 3. The range changes the picker, never the write ═══════════════════════
{
  const { host, close } = await open()
  const before = calls().length

  await press(byText(host, '.segmented button', 'Week'))
  const cells = host.querySelectorAll('.ew-att-wd')
  ok('the week shows seven days', cells.length === 7, `${cells.length}`)
  ok('and the day being recorded stays selected',
    host.querySelector('.ew-att-wd.is-sel')?.getAttribute('aria-pressed') === 'true')
  ok('switching range writes nothing', calls().length === before)

  await press(byText(host, '.segmented button', 'Month'))
  const monthCells = host.querySelectorAll('.ew-att-cell:not(.is-gap)')
  const daysInMonth = new Date(FROZEN.getFullYear(), FROZEN.getMonth() + 1, 0).getDate()
  ok('the month shows every day of the month', monthCells.length === daysInMonth, `${monthCells.length} vs ${daysInMonth}`)
  ok('and choosing a day in it writes nothing', calls().length === before)

  /* A day that is not today, chosen by its own label: the weekend, which is the
     one date where the kind recorded is not the kind anybody tapped. */
  await press(byText(host, '.segmented button', 'Week'))
  const sat = byLabel(host, '.ew-att-wd', mock.prettyDateKey(SATURDAY))
  ok('a day in the week strip can be chosen by its date', !!sat, mock.prettyDateKey(SATURDAY))
  await press(sat)
  ok('and the day being recorded moves to it',
    textOf(host.querySelector('.ew-datebar-day')).includes(mock.prettyDateKey(SATURDAY)))
  ok('the screen says that day earns 2×',
    textOf(host.querySelector('.ew-att-day-note')).startsWith('Weekend'),
    textOf(host.querySelector('.ew-att-day-note')))

  const markBefore = calls().length
  await press(buttonSaying(host, 'Mark'))
  const wrote = calls().slice(markBefore).filter(c => c[0] === 'setDay')
  ok('a Saturday is recorded as weekend work, not as an ordinary day',
    wrote[0]?.[3] === WEEKEND_KIND && wrote[0]?.[2] === SATURDAY, JSON.stringify(wrote[0]))
  const wk = worthOf(WEEKEND_KIND, SATURDAY)
  ok('valued at the multiplier the rate period carries',
    wk.multiplier === 2 && textOf(host.querySelector('.ew-att-row')).includes(mock.formatNaira(wk.rate * 2)),
    `${wk.multiplier}× ${wk.rate}`)

  await press(buttonSaying(host, 'Undo'))
  await press(byText(host, '.segmented button', 'Today'))
  ok('choosing Today brings the day back to today',
    textOf(host.querySelector('.ew-datebar-day')).includes(mock.prettyDateKey(FROZEN_KEY)),
    textOf(host.querySelector('.ew-datebar-day')))
  await close()
}

// ══ 4. The figures are the stored figures, on both screens that state them ══
{
  const { host, close } = await open()
  const before = calls().length
  await press(byText(host, '.segmented button', 'Month'))
  await press(buttonSaying(host, 'Mark'))       // record today, so the month has a figure
  ok('recording a day is one write', calls().slice(before).filter(c => c[0] === 'setDay').length === 1)

  const figures = await monthFiguresNow()
  const monthSection = section(host, mock.monthLabelFor(FROZEN.getFullYear(), FROZEN.getMonth()))
  ok('the month range states the month', !!monthSection)
  /* Each figure is read off the row's own trail and compared for EQUALITY with
     the engine's number. An `includes` would pass on a digit borrowed from
     another figure — "3" inside "13" — which is the kind of check that is green
     for the wrong reason. */
  const trailOf = (title) => textOf(itemIn(monthSection && monthSection.rows, title)?.querySelector('.ew-att-amount'))
  ok('the days recorded is what was recorded',
    trailOf('Days recorded') === String((await mock.listAllMonth()).length),
    `${trailOf('Days recorded')} vs ${(await mock.listAllMonth()).length}`)
  ok('the waiting count is the engine’s count, not a guess',
    figures.unconfirmed > 0 && trailOf('Awaiting confirmation') === String(figures.unconfirmed),
    `${trailOf('Awaiting confirmation')} vs ${figures.unconfirmed}`)
  ok('the month total is the engine’s total',
    trailOf('What the month adds up to') === mock.formatNaira(figures.total),
    `${trailOf('What the month adds up to')} vs ${mock.formatNaira(figures.total)}`)

  /* The same month, on the screen the employer checks first. Both read
     monthFigures() — the one the payslip uses — so this is a check that the
     product has one answer to "what has this month cost", not two. */
  const todayHost = document.createElement('div')
  const { done } = await mount(todayHost, (
    <Dashboard
      employees={employees}
      contractors={await mock.listContractors()}
      periods={periods}
      onOpenDays={() => {}}
      onOpenPeople={() => {}}
    />
  ))
  const attendanceTotal = monthSection && itemIn(monthSection.rows, 'What the month adds up to')
  ok('the command centre states the same month total',
    !!todayHost.querySelector('.ew-today-amount.is-money')
    && textOf(todayHost.querySelector('.ew-today-amount.is-money')) === textOf(attendanceTotal && attendanceTotal.querySelector('.ew-att-amount')),
    `${textOf(todayHost.querySelector('.ew-today-amount.is-money'))} vs ${textOf(attendanceTotal && attendanceTotal.querySelector('.ew-att-amount'))}`)
  await done()

  await press(buttonSaying(host, 'Undo'))
  await close()
}

// ══ 5. Empty, and the way out of it ════════════════════════════════════════
{
  let went = false
  const { host, close } = await open({ employees: [], onOpenPeople: () => { went = true } })
  ok('an empty roster says so', textOf(host).includes('No one to record yet'), textOf(host).trim().slice(0, 70))
  ok('and there are no rows to press', host.querySelectorAll('.ew-att-row').length === 0)
  await press(host.querySelector('.ew-btn-primary'))
  ok('and the one action goes to People', went)
  await close()
}

// ══ 6. A confirmed day is closed to changes from this screen ═══════════════
{
  const CONFIRMED = 'phase5-confirmed'
  mock.addMonthFixture({
    id: CONFIRMED, employee_id: 'e1', work_date: FROZEN_KEY, kind: 'work', status: 'confirmed',
    amount: 16000, rate: 16000, multiplier: 1, source: 'employer', note: null,
  })
  const { host, close } = await open()
  const before = calls().length
  ok('a confirmed day says so in words', textOf(host.querySelector('.ew-att-row')).includes('Confirmed'))
  const undo = buttonSaying(host, 'Undo')
  ok('and cannot be taken back from here', !!undo && undo.disabled === true, `disabled=${undo?.disabled}`)
  ok('and its kind cannot be changed, because the amount is frozen',
    host.querySelectorAll('.ew-att-row .ew-kindchip').length === 0)
  await press(undo)
  ok('pressing it anyway writes nothing',
    calls().slice(before).filter(c => c[0] === 'setDay' || c[0] === 'clearDay').length === 0)
  await close()
  mock.removeMonthFixture(CONFIRMED)
}

// ══ 7. The roster's size, as one line of context rather than two cards ══════
/* Phase 6 replaced the shell's two stat cards with a sentence on this screen —
   the last one that has nowhere else to state these numbers. A sentence can be
   wrong in ways a card cannot (it can be about the wrong roster, or say "all
   priced" when somebody is not), so it is checked against the engine, and the
   missing-rate branch is produced rather than hoped for. */
{
  const staff = await mock.listEmployees()
  const periods = await mock.listAllRatePeriods()
  const active = staff.filter(e => e.status === 'active')
  const gap = mock.unmetRates(staff, periods, mock.todayKey())

  const host = document.createElement('div')
  dom.window.location.hash = '/attendance'
  const { done } = await mount(host, <EmployerWorkspace />)
  ok('the Attendance pane still draws its rows', !!host.querySelector('.ew-att'))

  const glance = host.querySelector('.ew-glance')
  ok('the size of the roster is on the screen, as one line', !!glance, textOf(glance))
  ok('and nothing on it is a stat card any more',
    host.querySelectorAll('.ew-stat, .ew-stat-label').length === 0)
  ok('the line counts the roster the engine counts',
    textOf(glance).includes(`${active.length} worker${active.length === 1 ? '' : 's'} on the roster`),
    textOf(glance))
  ok('and, when everybody is priced, says so',
    gap.length === 0
      ? textOf(glance).includes('every one of them has a rate')
      : textOf(glance).includes(`${gap.length} with no rate yet`),
    `engine gaps: ${gap.length}`)

  /* Now the branch that matters: somebody who cannot be recorded at all, because
     no rate period covers the day. Staged for one mount, then taken away. */
  const STAGED = [{
    id: 'e7', employer_id: 'o1', full_name: 'Ngozi Eze', job_title: null,
    email: null, employee_user_id: null, invite_code: null, status: 'active',
    contractor_id: null, created_at: mock.FIXTURE.STAMP(mock.FIXTURE.WORK_DAY, '08:00:00Z'),
  }]
  mock.setExtraEmployees(STAGED)
  const withGap = mock.unmetRates(await mock.listEmployees(), periods, mock.todayKey())
  const host2 = document.createElement('div')
  const second = await mount(host2, <EmployerWorkspace />)
  const line2 = textOf(host2.querySelector('.ew-glance'))
  ok('a worker with no rate is counted against the roster', withGap.length === 1, `${withGap.length} gap(s)`)
  ok('and the line says it, in the engine’s number and in words',
    line2.includes(`${withGap.length} with no rate yet`), line2)
  ok('and it is not left to the colour to say', /no rate yet/.test(line2), line2)
  await second.done()
  await done()
  mock.setExtraEmployees(null)
}

/* ── §39: finding one name in a long roster ──────────────────────────────────
   The finding was that the screen an employer opens every morning had no search,
   while the roster screen did. Two things have to hold: the field appears when
   there is a reason for it and NOT when there is not (a search box over three
   names is furniture, §32), and typing in it narrows what is DRAWN without
   touching a figure the engine produced. */
{
  const small = await open()
  ok('a roster of three has no search field — nothing to search through yet',
    !small.host.querySelector('.ew-find-input'),
    `${small.host.querySelectorAll('.dp-item').length} row(s) drawn`)
  await small.close()

  const MANY = Array.from({ length: 7 }, (_, i) => ({
    id: `x${i}`, employer_id: 'o1', full_name: `Worker ${'ABCDEFG'[i]}`,
    job_title: 'Mason', email: null, employee_user_id: null, invite_code: null,
    status: 'active', contractor_id: null,
    created_at: mock.FIXTURE.STAMP(mock.FIXTURE.WORK_DAY, '08:00:00Z'),
  }))
  mock.setExtraEmployees(MANY)

  const { host, close } = await open()
  const field = host.querySelector('.ew-find-input')
  const roster = (await mock.listEmployees()).filter(e => e.status === 'active').length
  ok('a long roster gets the search the roster screen has', !!field, `${roster} active worker(s)`)
  ok('and it is labelled, not only placeheld',
    (field?.getAttribute('aria-label') || '').length > 0, field?.getAttribute('aria-label'))
  ok('and nothing is narrowed until something is typed', !host.querySelector('.ew-find-count'))

  const before = calls().length
  await type(field, 'Worker C')
  const rows = () => [...host.querySelectorAll('.ew-att-row')].map(r => textOf(r))
  const drawn = rows().filter(t => /Worker /.test(t))
  ok('typing a name narrows the day to that person, and to nobody else',
    drawn.length === 1 && /Worker C/.test(drawn[0]), `${drawn.length} row(s): ${drawn.join(' | ')}`)
  ok('and the count says what is hidden, rather than pretending the roster shrank',
    textOf(host.querySelector('.ew-find-count')).includes(`1 of ${roster} shown`),
    textOf(host.querySelector('.ew-find-count')).trim())

  await press(byText(host, '.dp-sec-action', 'Clear'))
  const back = rows().filter(t => /Worker /.test(t)).length
  ok('clearing brings the day back, whole', back === 7, `${back} row(s)`)
  ok('and searching wrote nothing', writes(before).length === 0, JSON.stringify(writes(before)))
  await close()
  mock.setExtraEmployees(null)
}

console.log(bad === 0 ? '\nATTENDANCE: THE DAY IS THE ONLY THING WRITTEN' : `\nATTENDANCE: ${bad} CHECK(S) FAILED`)
console.log(bad === 0 ? '\nATTENDANCE: THE DAY IS THE ONLY THING WRITTEN' : `\nATTENDANCE: ${bad} CHECK(S) FAILED`)
