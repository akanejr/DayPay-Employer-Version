/* Phase 4 — Today, the command centre, driven in a real DOM.
 *
 * Phase 4 rebuilt the employer's first screen around one question: "is everybody
 * recorded today, and if not, who is missing?" That claim is easy to make and
 * easy to get subtly wrong — a figure that disagrees with the engine, a missing
 * list that names nobody, a row that looks like an action and does nothing, a
 * "one primary action" screen that offers four.
 *
 * So this file checks the screen AGAINST THE ENGINE, not against a screenshot:
 * the numbers, names and sentences are computed with the same pure functions the
 * screen uses, and the DOM has to agree with them. A screenshot cannot show that;
 * a fixture that drifts cannot break it.
 *
 * THE CLOCK IS FROZEN ON THE 20th — and that is not a detail.
 * The mock's fixture days are computed from the real calendar and all land in the
 * first eight days of the month (mock-employer.js). If "today" happened to BE one
 * of those days, somebody would already be recorded and the check for "someone is
 * missing" would find nothing to assert: green on the 3rd, meaningless on the
 * 20th. Freezing the clock past every fixture makes the missing state real on
 * every run, in the same month, and it is done before anything is imported.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { createRequire } from 'node:module'
const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
const { JSDOM } = require_('jsdom')

// ── the clock, frozen before the app is loaded ──────────────────────────────
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
const EmployerWorkspace = (await import('../../src/employer/EmployerWorkspace.jsx')).default
const routes = await import('../../src/lib/routes.js')
const mock = await import('./mock-employer.js')
const { polishProblems } = await import('./polish.js')

let bad = 0
const ok = (label, pass, detail) => {
  if (!pass) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1 }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 25)) }) }

/* React listens for the browser's own events, so a press has to BE one. */
const press = async (el) => {
  if (!el) return false
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await settle()
  return true
}

const address = () => routes.normalisePath(dom.window.location.hash)
const textOf = (el) => (el ? el.textContent || '' : '')

/* A section, found by its own heading. Section renders the label as a SIBLING of
   what it labels (src/ui/Ui.jsx), so the rows are the next element after it. */
function section(host, startsWith) {
  const label = [...host.querySelectorAll('.dp-sec')]
    .find(s => (s.textContent || '').trim().startsWith(startsWith))
  return label ? { label, rows: label.nextElementSibling } : null
}

/* The filled actions on Today, ALL of them.
 *
 * This used to subtract the site-attendance panel's own button, on the reasoning
 * that the panel is a separate screen that happens to live here. §39 found the
 * cost of that reasoning: on a morning when nobody is recorded and no code is
 * open, the employer saw TWO filled green buttons — "Record today's work" and
 * "Open attendance" — while this check reported exactly one, because it had been
 * written to look away from the second. The panel's button is the outlined green
 * now (ew-btn-accent), so the subtraction is gone and the screen is held to the
 * rule the product claims: one filled action, or none. */
function ownPrimaries(host) {
  return host.querySelectorAll('.ew-dash .ew-btn-primary').length
}

async function openToday() {
  try { dom.window.location.hash = '/today' } catch { /* nothing to set */ }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<EmployerWorkspace />) })
  await settle()
  await settle()
  return {
    host,
    close: async () => { await act(async () => { root.unmount() }); host.remove() },
  }
}

/* ── what the engine says, computed the way the screen computes it ─────────── */
const staff = await mock.listEmployees()
const engineBoard = mock.dayBoard(await mock.listAllMonth(), staff, FROZEN_KEY)

/* Where the write log stood before this file pressed anything. Readings are
   allowed to move it; the point of the last check is that Today is not. */
const LOG_START = (globalThis.__calls || []).length

// ══ 1. The answer is one figure, and it is the engine's ══════════════════════
{
  const { host, close } = await openToday()
  ok('Today renders as the command centre', !!host.querySelector('.ew-dash'))

  const bars = host.querySelectorAll('.ew-dash [role="progressbar"]')
  ok('exactly one figure carries the day', bars.length === 1, `${bars.length} progress bar(s)`)
  if (bars.length === 1) {
    ok('the bar counts the whole active roster',
      bars[0].getAttribute('aria-valuemax') === String(engineBoard.expected),
      `${bars[0].getAttribute('aria-valuemax')} vs engine ${engineBoard.expected}`)
    ok('the bar counts what is recorded',
      bars[0].getAttribute('aria-valuenow') === String(engineBoard.recorded),
      `${bars[0].getAttribute('aria-valuenow')} vs engine ${engineBoard.recorded}`)
  }
  ok('the figures are also words, not just a bar',
    textOf(host.querySelector('.ew-dash')).includes(`of ${engineBoard.expected} recorded`))

  /* The four stat cards are GONE, not restyled: "Expected 4 · Recorded 1 · Not
     yet 3" made the reader do the subtraction that the bar now does. */
  ok('the four stat cards are gone from Today',
    host.querySelectorAll('.ew-dash .ew-stat, .ew-dash .ew-stat-label').length === 0)

  const problems = polishProblems(host.innerHTML)
  ok('Today passes the polish invariants', problems.length === 0, problems.join(' | '))
  await close()
}

// ══ 2. Everybody recorded: the money, the kind, and nothing left to press ════
/* The day is written and taken away through the mock's own fixture door, so the
   two states are produced by this check rather than by the calendar. */
{
  const DAY_ID = 'phase4-today'
  mock.addMonthFixture({
    id: DAY_ID, employee_id: 'e1', work_date: FROZEN_KEY, kind: 'overtime',
    status: 'confirmed', amount: 32000, rate: 16000, multiplier: 2,
    source: 'employer', note: null,
  })

  const { host, close } = await openToday()
  const recorded = section(host, 'Recorded today')
  ok('a recorded worker is listed under their own heading', !!recorded)
  ok('with their name on the row', textOf(recorded && recorded.rows).includes('James Okon'))
  ok('the kind is a word, not only a colour',
    textOf(recorded && recorded.rows).includes(mock.KIND_LABELS.overtime),
    textOf(recorded && recorded.rows).trim().slice(0, 70))
  ok('and the amount is the stored amount',
    textOf(recorded && recorded.rows).includes(mock.formatNaira(32000)))

  ok('nobody is missing, so nothing claims they are', !section(host, 'Not yet recorded'))
  /* The brief's rule, made testable: ONE filled action on the screen — and when
     there is nothing to do, none at all. A primary button on a screen with no
     outstanding work is a button that exists to be pressed by mistake. */
  ok('and the screen offers no action of its own', ownPrimaries(host) === 0,
    `${ownPrimaries(host)} filled button(s)`)
  await close()

  mock.removeMonthFixture(DAY_ID)

  // ══ 3. Somebody missing: named, counted, and the row is the way to act ═════
  const { host: h2, close: close2 } = await openToday()
  const missing = section(h2, 'Not yet recorded')
  ok('somebody missing is a section, not a number', !!missing)
  ok('labelled with how many', textOf(missing && missing.label).includes(String(engineBoard.expected)),
    textOf(missing && missing.label))
  ok('and named', textOf(missing && missing.rows).includes('James Okon'))

  const row = missing && missing.rows && missing.rows.querySelector('.dp-item')
  ok('the row says what it does', textOf(row).includes('Record'), textOf(row).trim().slice(0, 48))
  ok('and there is exactly one way to fix it', ownPrimaries(h2) === 1, `${ownPrimaries(h2)} filled button(s)`)

  const before = (globalThis.__calls || []).length
  await press(row)
  ok('pressing the person opens where a day is recorded', address() === '/attendance', address())
  ok('and it really is the attendance screen', !!h2.querySelector('.ew-att'))
  ok('which is a move, not a mark', (globalThis.__calls || []).length === before)
  await close2()
}

// ══ 4. A request waiting on the employer, readable without opening it ════════
{
  const open = await mock.listOpenCorrections()
  const request = open[0]
  const day = (await mock.listAllMonth())
    .find(d => d.employee_id === request.employee_id && d.work_date === request.work_date)
  /* The expected sentence is asked of the same function the screen asks — so this
     check cannot drift from the wording, only from the wiring. */
  const sentence = mock.correctionSentence(request, day ? day.kind : null)

  const { host, close } = await openToday()
  const queue = section(host, 'Waiting on you')
  ok('an open request is on the first screen', !!queue)
  ok('it names the person and the date',
    textOf(queue && queue.rows).includes('James Okon')
    && textOf(queue && queue.rows).includes(mock.prettyDateKey(request.work_date)))
  ok('it says what is being asked, in a sentence',
    textOf(queue && queue.rows).includes(sentence), sentence)
  ok('and it quotes what they said', textOf(queue && queue.rows).includes(request.message))

  await press(queue && queue.rows && queue.rows.querySelector('.dp-item'))
  ok('pressing it opens that worker', !!host.querySelector('.ew-subtabs'),
    `${host.querySelectorAll('.ew-subtab').length} tab(s)`)
  ok('on their own screen, headed by their name',
    textOf(host.querySelector('.ew-name')).includes('James Okon'))

  /* The worker screen is Phase 6's to redesign and still carries its own way
     back; this only insists that the way back WORKS from here. */
  await press(host.querySelector('.dp-back, .sp-back'))
  ok('and the way back returns to Today', !!host.querySelector('.ew-dash'), address())
  await close()
}

// ══ 5. Nothing that worked stopped working ══════════════════════════════════
{
  const { host, close } = await openToday()
  /* The site's attendance code lived on this screen before Phase 4 and still
     does. A tidier screen that quietly dropped it would be a tidy regression. */
  ok('the site attendance code kept its door',
    !!host.querySelector('.ew-dash .ew-board-label'),
    textOf(host.querySelector('.ew-dash .ew-board-label')))

  /* Nothing on this screen writes a record. The source rule is asserted in
     tests/design.test.js; here it is a fact about this session — after every
     press above, no correction was answered and nobody was archived. */
  const wrote = (globalThis.__calls || []).slice(LOG_START)
    .filter(c => ['resolveCorrection', 'withdrawCorrection', 'archiveEmployee', 'archiveContractor'].includes(c[0]))
  ok('and reading Today wrote nothing', wrote.length === 0, JSON.stringify(wrote))
  await close()
}

console.log(bad === 0 ? '\nTODAY: THE COMMAND CENTRE HOLDS' : `\nTODAY: ${bad} CHECK(S) FAILED`)
