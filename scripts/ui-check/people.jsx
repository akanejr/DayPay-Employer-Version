/* Phase 6 — People, driven in a real DOM.
 *
 * Phase 6 made the roster findable and made every row a door: search, a filter
 * for the two account states, and a tap on a person that opens their own screen.
 * Each of those is easy to claim and easy to get subtly wrong, and every one of
 * the ways it goes wrong is invisible in a screenshot:
 *
 *   · a search that matches something other than what the engine matches — the
 *     engine's rule is `filterPeople` (src/lib/employerLogic.js), and this file
 *     computes the expected list WITH it and insists the DOM agrees;
 *   · a filter whose words and whose chip describe different people — so the
 *     check reads the chip on every visible row and compares it with the tab;
 *   · a row that looks pressable and is not, or a three-dot menu that opens the
 *     person because the door was wrapped around it;
 *   · a search that is silently lost by opening somebody and coming back;
 *   · a "layout" change that turns out to write to the database.
 *
 * The last line of this file is the one that matters most: after every press
 * above, the write log is still where it was. A roster is a list; nothing on it
 * saves anything.
 *
 * THE CLOCK IS FROZEN ON THE 20th, before anything is imported — the same frozen
 * clock today.jsx uses, and for the same reason: a screen that answers "what is
 * happening today" must not be measured against whichever day the suite happens
 * to run on. (mock-employer.js derives every fixture from the real calendar, so
 * nothing here is pinned to a date that will pass.)
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

const press = async (el) => {
  if (!el) return false
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await settle()
  return true
}

/* React listens for the input event and ignores a bare assignment to .value, so
   the native setter has to be reached through the prototype. */
const type = async (el, value) => {
  if (!el) throw new Error('tried to type into something that is not there')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await settle()
}

const address = () => routes.normalisePath(dom.window.location.hash)
const textOf = (el) => (el ? el.textContent || '' : '')
const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => (e.textContent || '').trim().includes(text))

/* The roster's own rows, in the order they are drawn. The archived list is a
   different list with its own rules, so it is excluded by name. */
const rows = (host) => [...host.querySelectorAll('.ew-list:not(.is-archived) .ew-row')]
const names = (host) => rows(host).map(r => textOf(r.querySelector('.ew-row-name')).trim())
const chips = (host) => rows(host).map(r => textOf(r.querySelector('.ew-chip')).trim())
/* The whole filter row, as controls. */
const tabs = (host) => [...host.querySelectorAll('.ew-find-filter button')]
const tab = (host, label) => byText(host, '.ew-find-filter button', label)
const searchBox = (host) => host.querySelector('.ew-find input[type="search"]')

/* The search is asked the same question the screen asks it: the name, the trade,
   and the contractor's NAME — the field the row prints, not the id it stores —
   resolved the way PeoplePane resolves it. */
const CONTRACTORS = await mock.listContractors()
const contractorName = (id) => (CONTRACTORS.find(c => c.id === id) || {}).name || null
const find = (q) => mock
  .filterPeople(active, q, e => [contractorName(e.contractor_id)])
  .map(e => e.full_name)

/* Whichever way the screen is currently offering to undo a search. */
const clearSearch = async (host) => press(
  host.querySelector('.ew-find-count button') || byText(host, '.dp-notice .ew-btn', 'Clear'),
)

async function openPeople() {
  try { dom.window.location.hash = '/people' } catch { /* nothing to set */ }
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

/* ── the roster this file will look at ──────────────────────────────────────
   One worker was on the mock's roster already (unregistered). Two more are
   staged: a registered one with a rate, and a second unregistered one with no
   contractor — the two facts a filter and a search have to tell apart. The mock
   hands them back through its own fixture door and they are taken away at the
   end of this file. */
const STAMPED = mock.FIXTURE.STAMP(mock.FIXTURE.WORK_DAY, '07:30:00Z')
const STAGED = [
  {
    id: 'e9', employer_id: 'o1', full_name: 'Amina Yusuf', job_title: 'Welder',
    email: null, employee_user_id: 'u9', invite_code: null, status: 'active',
    contractor_id: 'c1', created_at: STAMPED,
  },
  {
    id: 'e8', employer_id: 'o1', full_name: 'Bassey Etim', job_title: 'Electric',
    email: null, employee_user_id: null, invite_code: null, status: 'active',
    contractor_id: null, created_at: STAMPED,
  },
]
mock.setExtraEmployees(STAGED)
mock.addRateFixture({
  id: 'p9', employee_id: 'e9', effective_from: mock.FIXTURE.DATE(1),
  daily_rate: 20000, weekend_multiplier: 2, holiday_multiplier: 2,
})

/* What the roster should contain, from the same engine the screen asks. */
const all = await mock.listEmployees()
const active = all.filter(e => e.status === 'active')
const registered = active.filter(e => e.employee_user_id)
const unregistered = active.filter(e => !e.employee_user_id)
const expectedNames = (list) => list.map(e => e.full_name)

/* Where the write log stood before this file pressed anything. A roster is a
   list of people; reading it, searching it and opening somebody must not write a
   row anywhere. */
const LOG_START = (globalThis.__calls || []).length

// ══ 1. The screen, and the fact that it is a roster of three ════════════════
{
  const { host, close } = await openPeople()
  ok('People renders as the roster', !!host.querySelector('.ew-list'))
  ok('with everybody active on it', rows(host).length === active.length,
    `${rows(host).length} row(s) for ${active.length} active worker(s)`)

  const one = host.querySelectorAll('.ew-dash, .ew-att')
  ok('and it is the People pane, not another screen', one.length === 0)

  const problems = polishProblems(host.innerHTML)
  ok('People passes the polish invariants', problems.length === 0, problems.join(' | '))
  await close()
}

// ══ 2. The search finds people the way the engine finds them ════════════════
{
  const { host, close } = await openPeople()
  const box = searchBox(host)
  ok('there is a search box, and it is labelled', !!box,
    box ? box.getAttribute('aria-label') : 'no input[type=search]')

  /* The queries are the ways an employer actually types, and the expectation is
     the ENGINE's answer — not a hand-written list that would silently disagree
     with the screen the day the matching rule changes. */
  const queries = [
    ['ami', 'part of a first name'],
    ['AMINA', 'capitals, because a phone keyboard does that'],
    ['yusuf amina', 'both names, in the wrong order'],
    ['weld', 'the trade, which is on the row but not in the name'],
    ['contractor a', 'the contractor, which is also on the row'],
  ]
  for (const [q, why] of queries) {
    await type(searchBox(host), q)
    const want = find(q)
    ok(`"${q}" finds the right people (${why})`,
      names(host).join('|') === want.join('|'),
      `${names(host).join(', ')} vs engine ${want.join(', ')}`)
  }

  await type(searchBox(host), 'ami')
  ok('and the count says how much of the roster is showing',
    textOf(host.querySelector('.ew-find-count')).includes(`1 of ${active.length} shown`),
    textOf(host.querySelector('.ew-find-count')))

  await type(searchBox(host), 'nobody by that name')
  ok('a search that finds nobody says so, in words', !!byText(host, '.dp-notice', 'Nobody matches'),
    textOf(host.querySelector('.dp-notice')))
  ok('and it draws no rows at all', rows(host).length === 0)
  /* §30: an empty screen must never be the answer — and the notice must offer the
     way back rather than leaving the employer to work out that they should clear
     the box. */
  ok('with a way back out of it', !!byText(host, '.dp-notice .ew-btn', 'Clear'))

  await clearSearch(host)
  ok('clearing restores the whole roster', rows(host).length === active.length)
  ok('and the box is empty again', searchBox(host).value === '')
  await close()
}

// ══ 3. The filter and the chip cannot describe different people ═════════════
{
  const { host, close } = await openPeople()
  const labels = tabs(host).map(b => textOf(b).trim())
  ok('the filter offers all three states', labels.length === 3, labels.join(' | '))
  ok('and it is the app’s one segmented control, not a new kind of toggle',
    !!host.querySelector('.ew-find-filter.segmented'))

  await press(tab(host, 'Registered'))
  ok('Registered shows the people who can sign in',
    names(host).join('|') === expectedNames(registered).join('|'),
    `${names(host).join(', ')} vs ${expectedNames(registered).join(', ')}`)
  /* The point of naming the tabs after the chip's own words: whatever the filter
     shows, every row on it says the same thing the filter said. */
  ok('and every row on it says "Registered"',
    chips(host).every(c => c === 'Registered'), chips(host).join(' | '))

  await press(tab(host, 'Not registered'))
  ok('Not registered shows the people who cannot sign in yet',
    names(host).join('|') === expectedNames(unregistered).join('|'),
    `${names(host).join(', ')} vs ${expectedNames(unregistered).join(', ')}`)
  ok('and every row on it says "Not registered"',
    chips(host).every(c => c === 'Not registered'), chips(host).join(' | '))

  await press(tab(host, 'All'))
  ok('All shows everybody again', rows(host).length === active.length)

  /* The two controls together, which is how an employer uses them: find the
     person, among the people of one kind. */
  await press(tab(host, 'Registered'))
  await type(searchBox(host), 'bassey')
  ok('a search inside a filter narrows to nothing, and says so',
    rows(host).length === 0 && !!byText(host, '.dp-notice', 'Nobody matches'))
  await close()
}

// ══ 4. Every row is a door ═════════════════════════════════════════════════
{
  const { host, close } = await openPeople()
  const james = rows(host).find(r => textOf(r).includes('James Okon'))
  ok('the worker’s name is inside the thing you press',
    !!james && !!james.querySelector('.ew-row-open .ew-row-name'))

  /* The search has to survive the round trip: an employer who searched, opened
     somebody and came back to an empty box has lost their place. */
  await type(searchBox(host), 'ami')
  await press(rows(host)[0].querySelector('.ew-row-open'))
  ok('pressing a row opens that worker',
    !!host.querySelector('.ew-subtabs'), `${host.querySelectorAll('.ew-subtab').length} tab(s)`)
  ok('headed by their own name', textOf(host.querySelector('.ew-name')).includes('Amina Yusuf'),
    textOf(host.querySelector('.ew-name')))
  /* Opening a worker is not a destination: it happens inside People, so the tab
     bar stays put, the address stays the roster's, and the way back is the screen's
     own. A separate address would make the roster a thing you navigate away from —
     and the employer would have to find their place again. */
  ok('and it opens inside People, without leaving the roster’s address',
    address() === '/people', address())

  await press(host.querySelector('.dp-back, .sp-back'))
  ok('and the way back returns to the roster', !!host.querySelector('.ew-list'))
  ok('with the search still in the box', searchBox(host) && searchBox(host).value === 'ami',
    searchBox(host) ? `"${searchBox(host).value}"` : 'no search box')
  ok('and the list still narrowed to what was found', rows(host).length === 1,
    `${rows(host).length} row(s)`)

  /* The overflow belongs to the row, not to the door: pressing it must open the
     menu, not the person. */
  /* Back to the whole roster, because the row whose menu is about to be pressed
     should not be the only row on the screen. */
  await clearSearch(host)
  const more = rows(host)[0].querySelector('.ew-more')
  await press(more)
  ok('the three-dot control opens the menu, not the person',
    !!host.querySelector('.ew-menu') && !host.querySelector('.ew-subtabs'))
  ok('and it says whether it is open', more.getAttribute('aria-expanded') === 'true',
    more.getAttribute('aria-expanded'))
  await close()
}

// ══ 5. The archived list is kept, and is reachable ═════════════════════════
{
  mock.setArchivedEmployee(true)
  const { host, close } = await openPeople()
  /* Quiet text, not a button: the control is `.ew-text-btn` and it says
     "Show 1 archived" — and it is the ONLY way to reach somebody who has been
     moved off the roster, which is why it is checked here. */
  const toggle = byText(host, '.ew-text-btn', 'archived')
  ok('a roster with archived workers still offers them', !!toggle,
    toggle ? `"${textOf(toggle).trim()}"` : 'no archived control')
  await press(toggle)
  ok('and opening it says so, so it can be closed again',
    !!byText(host, '.ew-text-btn', 'Hide archived'))
  ok('and they are listed, with their days and pay kept',
    textOf(host.querySelector('.ew-list.is-archived')).includes('Peter Bassey'),
    textOf(host.querySelector('.ew-list.is-archived')).slice(0, 60))

  const archivedRow = host.querySelector('.ew-list.is-archived .ew-row')
  await press(archivedRow.querySelector('.ew-row-open'))
  ok('an archived worker can still be opened', !!host.querySelector('.ew-subtabs'))
  await press(host.querySelector('.dp-back, .sp-back'))
  await close()
  mock.setArchivedEmployee(false)
}

// ══ 6. A brand-new employer: the roster nobody is on ═══════════════════════
/* The first screen a new employer sees. It has to say what to do, it must not
   offer a search over nothing, and it must not grow a second filled button — the
   screen's one action is Add, and it is already there. */
{
  mock.setRosterEmpty(true)
  const { host, close } = await openPeople()
  const notice = host.querySelector('.dp-notice')
  const shown = host.textContent.replace(/\s+/g, ' ').trim()
  ok('an empty roster says so, in the house pattern', !!notice, shown.slice(0, 110))
  ok('and it says what to do about it',
    textOf(notice).includes('Add the people you pay by the day'),
    textOf(notice))
  ok('with no search over nothing', !searchBox(host), shown.slice(0, 110))
  ok('and no second filled button — Add is still the only one',
    host.querySelectorAll('.ew-dash .ew-btn-primary, .dp-notice .ew-btn-primary').length === 0)
  await close()
  mock.setRosterEmpty(false)
}

// ══ 7. None of it wrote anything ═══════════════════════════════════════════
{
  const wrote = (globalThis.__calls || []).slice(LOG_START)
    .filter(c => ['setDay', 'clearDay', 'confirmDay', 'disputeDay', 'reopenDay',
      'archiveEmployee', 'restoreEmployee', 'setEmployeeContractor', 'resolveCorrection',
      'withdrawCorrection', 'setAttendancePin'].includes(c[0]))
  ok('searching, filtering and opening people wrote nothing', wrote.length === 0,
    JSON.stringify(wrote))

  mock.setExtraEmployees(null)
  mock.removeRateFixture('p9')
}

console.log(bad === 0 ? '\nPEOPLE: THE ROSTER IS FINDABLE, AND A ROW IS A DOOR' : `\nPEOPLE: ${bad} CHECK(S) FAILED`)
