/* Phase 8 — the six destinations under More, driven in a real DOM.
 *
 * More is the one place in this app where a screen can be added and nobody
 * notices: it is a list of rows, and a row is cheap to add. Three of these four
 * used to open as a compact card at the foot of the roster — an icon, a title and
 * an action, with no name of their own and nowhere to say what they were for.
 * Phase 8 made each of them a destination. What has to hold, and what a screenshot
 * cannot show:
 *
 *   · the name on the screen is the name on the row that opened it. A row that
 *     says one thing and a screen that says another is how one screen comes to look
 *     like two;
 *   · the contractor screen answers its own question. It printed a COUNT — "3
 *     workers" — and an employer who wants to know which three has been sent to
 *     People to find out. The names are asserted against the same list the screen
 *     is handed, and the names of people under somebody else are asserted absent;
 *   · the kiosk screen can tell three states apart: still loading, not installed on
 *     this database, and the load FAILED. The row it replaced said "not linked yet"
 *     in all three, and after a network failure that sentence sends an employer to
 *     run a migration they have already run. The failure path is driven here, and
 *     the way back is pressed;
 *   · every empty state on these screens is the house Notice — one empty state per
 *     app, so that "nothing here" always looks the same and a screen cannot quietly
 *     grow a second, quieter one;
 · a row is TWO lines. §41: the first row on this screen read "ContractorsWho
   each worker answers to", because the title and its description were spans in
   a span and the margin between them did nothing. The stylesheet is guarded in
   tests/design.test.js; here the DOM is asked whether the pair are separate
   elements inside the stack, and whether any destination is missing its line;
 *   · and no screen sends the reader to a place that does not exist. Two lines of
 *     copy survived the renames of Phases 5 and 6, still saying "Mark days" and the
 *     "Roster tab". A reader who goes looking and finds nothing has been told
 *     something untrue by the app.
 *
 * Nothing on these screens may write: opening Contractors, Kiosk, Billing or
 * Reports and stepping a month is reading. The write log is checked at the end.
 *
 * THE CLOCK IS FROZEN ON THE 20th, before anything is imported, for the same reason
 * today.jsx, attendance.jsx, people.jsx and profile.jsx freeze it: these screens
 * answer questions about a month, and the answer must not depend on the day the
 * suite runs.
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

const textOf = (el) => (el ? el.textContent || '' : '')
const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => textOf(e).trim().includes(text))
const calls = () => globalThis.__calls || []
const writes = (since) => calls().slice(since).filter(c => !/^list|^my|^invoicesAvailable/.test(c[0]))

async function open(address, el) {
  /* The address is real browser state and outlives a component unmounting, so
     every mount starts from a known one. */
  try { dom.window.location.hash = address } catch { /* no window */ }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await settle()
  await settle()
  return { host, close: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

/* ── the roster this file looks at ────────────────────────────────────────────
   One worker was on the mock's roster already. Two more are staged so the
   contractor screen has something to be right about: a second worker under
   Contractor A, and one under nobody — the two facts a count cannot tell apart. */
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

/* The engine's answer to "who is under each contractor", so the screen is not
   measured against a hand-written list that would quietly disagree with it. */
const ROSTER = (await mock.listEmployees()).filter(e => e.status === 'active')
const CONTRACTORS = await mock.listContractors()
const ACTIVE_CONTRACTORS = CONTRACTORS.filter(c => c.status === 'active')
const underOf = (id) => ROSTER.filter(e => e.contractor_id === id).map(e => e.full_name)
const assigned = ROSTER.filter(e => e.contractor_id).length

const LOG_START = calls().length

// ══ 0. The screen this brief was written about: a row is two lines ══════════
{
  /* §41. The More screen is where the defect was reported: its first row read
     "ContractorsWho each worker answers to" — a title and its description sharing
     one line box, so the two ran together. The stylesheet fix lives in
     `src/ui/ui.css` and is guarded in `tests/design.test.js`; what only a rendered
     DOM can show is that the two are separate elements, in that order, inside the
     container the stylesheet stacks, and that no destination on this screen is
     missing the line that explains it. */
  const { host, close } = await open(routes.EMPLOYER.more, <EmployerWorkspace />)

  const rows = [...host.querySelectorAll('.dp-item')]
  ok('More renders its destinations as list rows', rows.length >= 6, `${rows.length} row(s)`)

  const headed = rows.filter(r => r.querySelector('.dp-item-title'))
  ok('and every row with a title keeps it inside the text stack, not loose',
    headed.every(r => r.querySelector('.dp-item-text > .dp-item-title')))

  ok('and a row with a description keeps it a separate element under the title',
    headed.every(r => {
      const sub = r.querySelector('.dp-item-sub')
      return !sub || sub.parentElement.classList.contains('dp-item-text')
    }))

  /* The reported symptom, in the DOM: if the two shared one element, the title
     would CONTAIN the description and no gap could ever separate them. */
  ok('...so no title element swallows its own description',
    headed.every(r => !r.querySelector('.dp-item-title .dp-item-sub')))

  const nav = rows.filter(r => r.querySelector('.dp-item-title')
    && r.querySelector('a, [role="link"], button'))
  ok('and every destination carries the line that says what it is for',
    nav.every(r => r.querySelector('.dp-item-sub')),
    nav.filter(r => !r.querySelector('.dp-item-sub'))
      .map(r => textOf(r.querySelector('.dp-item-title'))).join(' | '))

  /* The bar is one system: equal cells, a label in each, and the active rule in
     the active cell rather than floated beside it. */
  const tabs = [...host.querySelectorAll('.dp-tab')]
  ok('the navigation bar divides into four equal cells', tabs.length === 4, `${tabs.length} cell(s)`)
  ok('and every cell carries its label', tabs.every(t => t.querySelector('.dp-tab-label')))
  const active = host.querySelector('.dp-tab.is-active')
  ok('and the active rule lives inside the active cell, not beside it',
    !active || !!active.querySelector('.dp-tab-rule'))

  await close()
}

// ══ 1. Contractors: who is under each one ═══════════════════════════════════
{
  const { host, close } = await open(routes.MORE.contractors, <EmployerWorkspace />)

  ok('Contractors opens as a screen with its own name, not a row at the foot of the roster',
    textOf(host.querySelector('.ew-title')).trim() === 'Contractors',
    textOf(host.querySelector('.ew-title')))
  ok('and it says what its job is in one line',
    /workers assigned/.test(textOf(host.querySelector('.ew-sub'))),
    textOf(host.querySelector('.ew-sub')))
  ok('and the line counts what the engine counts',
    textOf(host.querySelector('.ew-sub')).includes(`${assigned} of ${ROSTER.length} workers assigned`),
    `${textOf(host.querySelector('.ew-sub'))} — engine says ${assigned} of ${ROSTER.length}`)

  /* THE POINT OF THIS SCREEN. A count is not an answer to "who supplies whom". */
  const rowsByName = Object.fromEntries(
    ACTIVE_CONTRACTORS.map(c => [c.name, [...host.querySelectorAll('.ew-person')]
      .find(r => textOf(r.querySelector('.ew-name')).trim() === c.name)]),
  )
  for (const c of ACTIVE_CONTRACTORS) {
    const who = textOf(rowsByName[c.name]?.querySelector('.ew-contractor-who')).trim()
    const expected = underOf(c.id)
    ok(`${c.name} names the workers under it, not just how many`,
      expected.length === 0 ? who === '' : expected.every(n => who.includes(n)),
      who || '(nothing named)')
    const others = ROSTER.filter(e => e.contractor_id !== c.id).map(e => e.full_name)
    ok(`...and nobody else's name is printed under ${c.name}`,
      others.every(n => !who.includes(n)),
      who || '(nothing named)')
  }

  const filled = [...host.querySelectorAll('.ew-btn-primary, .ew-btn-accent')]
  ok('and it has exactly one filled action, which is Add',
    filled.length === 1 && /Add/.test(textOf(filled[0])),
    filled.map(b => textOf(b).trim()).join(' | '))

  /* While a row is being renamed its Save is the screen's action, and the header's
     Add stands down — two solid buttons in one view is what the roster was
     reported for, and a header is not exempt from it. */
  await press(byText(host, '.ew-person-actions .ew-btn', 'Rename'))
  ok('renaming a contractor leaves one filled button on the screen, not two',
    host.querySelectorAll('.ew-btn-primary').length === 0 &&
    host.querySelectorAll('.ew-btn-accent').length === 1,
    `${host.querySelectorAll('.ew-btn-primary').length} primary, ${host.querySelectorAll('.ew-btn-accent').length} accent`)
  await press(byText(host, '.ew-person-actions .ew-btn', 'Cancel'))

  /* The one thing this screen does not do, said out loud where it matters. */
  if (ROSTER.length > assigned) {
    const foot = textOf([...host.querySelectorAll('.ew-dash-foot')].pop())
    ok('an unassigned worker is reported, with where to assign them',
      /not assigned to a contractor yet/.test(foot) && /People/.test(foot), foot)
  }

  await press(byText(host, '.ew-head .ew-btn', 'Add'))
  ok('Add opens one field, and only one', !!host.querySelector('#ew-new-contractor'))
  await type(host.querySelector('#ew-new-contractor'), 'Alpha Services')
  await press(byText(host, '.ew-form .ew-btn', 'Add'))
  const made = calls().find(c => c[0] === 'createContractor')
  ok('and adding one reaches the data layer with the name typed',
    !!made && made[1] === 'Alpha Services', JSON.stringify(made))

  const problems = polishProblems(host.innerHTML)
  ok('Contractors passes the polish invariants', problems.length === 0, problems.join(' | '))
  await close()
}

// ══ 2. Site kiosk: three states, told apart ═════════════════════════════════
{
  mock.setDeviceFixtures(null)
  mock.setDevicesMissing(false)
  const { host, close } = await open(routes.MORE.kiosk, <EmployerWorkspace />)

  ok('Site kiosk opens as a screen with its own name',
    textOf(host.querySelector('.ew-title')).trim() === 'Site kiosk',
    textOf(host.querySelector('.ew-title')))
  ok('and says what it is for, in one sentence',
    /workers without a phone/i.test(textOf(host.querySelector('.ew-sub'))),
    textOf(host.querySelector('.ew-sub')))
  ok('and it says no machine is linked yet rather than saying nothing',
    /No machine is linked yet/i.test(textOf(host.querySelector('.ew-head .ew-sub'))),
    textOf(host.querySelector('.ew-head .ew-sub')))
  ok('its one action is in its header, where a screen keeps it',
    !!host.querySelector('.ew-head .ew-btn-primary'))
  await close()
}

{
  /* The failure path. It is the one the old row got wrong: a load that fails is
     not a database that has never had migration 019 run against it, and telling
     an employer the second when the first happened sends them to do work they
     have already done. */
  mock.setDeviceFixtures(null)
  mock.setReadFailure('listDevices')
  const { host, close } = await open(routes.MORE.kiosk, <EmployerWorkspace />)

  const head = textOf(host.querySelector('.ew-head .ew-sub'))
  ok('a load that failed is reported as a failure', /Could not load your machines/i.test(head), head)
  ok('...and not as an account that is missing its tables',
    !/not switched on for this account/i.test(head), head)
  ok('and the failure offers the way back', !!byText(host, '.ew-btn', 'Try again'))

  const before = calls().length
  mock.setReadFailure(null)
  await press(byText(host, '.ew-btn', 'Try again'))
  const asked = calls().slice(before).filter(c => c[0] === 'listDevices').length
  ok('and pressing it asks the database again', asked >= 1, `${asked} read(s)`)
  ok('and the screen recovers instead of staying broken',
    !!host.querySelector('.ew-head .ew-btn-primary') && !/Could not load/i.test(textOf(host)),
    textOf(host.querySelector('.ew-head .ew-sub')))
  await close()
}

{
  mock.setDevicesMissing(true)
  const { host, close } = await open(routes.MORE.kiosk, <EmployerWorkspace />)
  ok('an account without the kiosk says so, and says the rest still works',
    /not switched on for this account yet/i.test(textOf(host)) && /rest of the roster works/i.test(textOf(host)),
    textOf(host).slice(0, 120))
  /* §39: the sentence is the employer's; the schema's own words are one tap away,
     and shut until they are asked for. */
  ok('and the technical detail is shut until it is asked for',
    !!host.querySelector('details.dp-tech') && !host.querySelector('details.dp-tech[open]'))
  ok('and it never offers a code it cannot mint', !host.querySelector('.ew-head .ew-btn-primary'))
  mock.setDevicesMissing(false)
  await close()
}

{
  mock.setDeviceFixtures(null)
  const { host, close } = await open(routes.MORE.kiosk, <EmployerWorkspace />)
  await press(byText(host, '.ew-head .ew-btn', 'Link'))
  const made = calls().find(c => c[0] === 'createDevice')
  ok('linking a machine mints a code against the business, with a label',
    !!made && typeof made[1] === 'string' && made[1].length > 0, JSON.stringify(made))
  ok('and the code is on the screen to read out',
    !!host.querySelector('.ew-invite-code') || /works once/i.test(textOf(host)),
    textOf(host).slice(0, 120))
  await close()
}

// ══ 3. Billing: a document, not a form ══════════════════════════════════════
{
  mock.setInvoiceFixtures([])
  const { host, close } = await open(routes.MORE.billing, <EmployerWorkspace />)

  ok('Billing opens as a screen with its own name',
    textOf(host.querySelector('.ew-title')).trim() === 'Billing',
    textOf(host.querySelector('.ew-title')))
  ok('and says what it is for, including that an issued invoice is a document',
    /what each contractor owes/i.test(textOf(host.querySelector('.ew-sub'))) &&
    /not edited/i.test(textOf(host.querySelector('.ew-sub'))),
    textOf(host.querySelector('.ew-sub')))

  const empty = host.querySelector('.dp-notice.is-empty')
  ok('with nothing billed, the empty state is the house Notice', !!empty)
  ok('and it says what will appear here',
    /Nothing billed yet/i.test(textOf(empty)) && /PDF/.test(textOf(empty)),
    textOf(empty))
  ok('and it promises nothing that is not true of a voided invoice',
    /stay on file/i.test(textOf(empty)), textOf(empty))

  await close()
}

{
  const INVOICES = mock.billingFixtures ? null : null // eslint-disable-line no-unused-vars
  mock.setInvoiceFixtures([{
    id: 'i1', employer_id: 'o1', contractor_id: 'c1', contractor_name: 'Contractor A',
    number: 'INV-0001', period_from: mock.FIXTURE.DATE(1), period_to: mock.FIXTURE.DATE(mock.FIXTURE.LAST_DAY),
    status: 'issued', note: null, void_reason: null,
    issued_at: mock.FIXTURE.STAMP(mock.FIXTURE.LAST_DAY, '18:00:00Z'), voided_at: null,
    worker_count: 1, actual_days: 2, leave_days: 0, equivalents: 3, total: 48000,
    confirmed_days: 1, claimed_days: 1, disputed_days: 0,
  }])
  const { host, close } = await open(routes.MORE.billing, <EmployerWorkspace />)

  ok('an issued invoice is listed with its number, not hidden behind a summary',
    /INV-0001/.test(textOf(host)), textOf(host).slice(0, 140))
  ok('and it is not offered for editing — the only thing to do to a document is void it',
    !byText(host, '.ew-btn', 'Edit') && /Void/.test(textOf(host)),
    [...host.querySelectorAll('.ew-btn')].map(b => textOf(b).trim()).join(' | '))
  ok('and no empty state is drawn beside it',
    !host.querySelector('.dp-notice.is-empty'))
  mock.setInvoiceFixtures([])
  await close()
}

// ══ 4. Reports: the summary first, the raw days on request ══════════════════
{
  const { host, close } = await open(routes.MORE.reports, <EmployerWorkspace />)

  ok('Reports opens as a screen with its own name',
    textOf(host.querySelector('.ew-title')).trim() === 'Reports',
    textOf(host.querySelector('.ew-title')))
  ok('and says what a month costs before it offers the file',
    /what a month costs/i.test(textOf(host.querySelector('.ew-sub'))) &&
    /CSV/.test(textOf(host.querySelector('.ew-sub'))),
    textOf(host.querySelector('.ew-sub')))
  ok('the total for the month is the biggest thing on it, named as money owed',
    !!host.querySelector('.ew-owe-figure') && /You owe for/.test(textOf(host.querySelector('.ew-owe-label'))),
    textOf(host.querySelector('.ew-owe-label')))

  /* The raw days are offered as a file while there are raw days to offer. */
  const csv = byText(host, '.ew-btn', 'CSV')
  ok('the raw days are one press away, as a file', !!csv,
    csv ? textOf(csv).trim() : [...host.querySelectorAll('.ew-btn')].map(b => textOf(b).trim()).join(' | '))

  /* Step back to a month with nothing in it and read what the screen says. */
  const labelNow = textOf(host.querySelector('.ew-datebar-mid'))
  await press(host.querySelector('[aria-label="Previous month"]'))
  const labelBack = textOf(host.querySelector('.ew-datebar-mid'))
  ok('the month steps, and the screen says which month it is showing',
    labelBack !== labelNow && labelBack.length > 3, `${labelNow} → ${labelBack}`)

  const empty = host.querySelector('.dp-notice.is-empty')
  ok('a month with nothing recorded says so rather than showing a bare figure',
    !!empty, textOf(host.querySelector('.ew-owe-sub')))
  if (empty) {
    ok('and it says where a day comes from', /recorded one at a time from Attendance/i.test(textOf(empty)),
      textOf(empty))
    /* The renames of Phases 5 and 6 left two lines of copy pointing at screens
       that no longer exist. A reader who goes looking finds nothing. */
    ok('and it names no screen that has been renamed away',
      !/Mark days/.test(textOf(empty)) && !/Roster tab/.test(textOf(empty)), textOf(empty))
  }

  /* A file with nothing in it is not an offer, it is a trap: the control goes with
     the data. */
  ok('with no days in the month there is no file to download',
    !byText(host, '.ew-btn', 'CSV'),
    [...host.querySelectorAll('.ew-btn')].map(b => textOf(b).trim()).join(' | '))
  await close()
}

// ══ 5. Settings and Notifications: two doors, two pages, one shell ══════════
{
  /* Settings is an overlay owned by the app shell, so this half is mounted at the
     root. Its address is what opens it — which is exactly how an employer arrives
     from the More row. */
  const App = (await import('../../src/App.jsx')).default
  const { host, close } = await open(routes.MORE.settings, <App />)

  ok('More → Settings opens the settings page at its own address',
    !!host.querySelector('.sp-page'), textOf(host).slice(0, 60))
  ok('and it says where you are', /Settings/.test(textOf(host.querySelector('.sp-title-main'))),
    textOf(host.querySelector('.sp-title-main')))

  const cards = [...host.querySelectorAll('.sp-cat-card')]
  ok('the page lists the categories as rows, each with its own name',
    cards.length >= 5, cards.map(c => textOf(c.querySelector('.sp-cat-name')).trim()).join(' | '))
  ok('and there is one door to Profile, not two',
    host.querySelectorAll('.sp-prof-card').length === 1 &&
    cards.filter(c => textOf(c.querySelector('.sp-cat-name')).trim() === 'Profile').length === 0,
    `${host.querySelectorAll('.sp-prof-card').length} profile card(s), ` +
    `${cards.filter(c => textOf(c.querySelector('.sp-cat-name')).trim() === 'Profile').length} Profile row(s)`)

  /* §39: an employer opening Settings was shown "Earnings" (their own day rate and
     goal) and "Reminders" (remind me to record my own days) with nothing saying
     that half of the screen is the personal tracker that rides along. The More pane
     names it; this page did not. */
  const groups = [...host.querySelectorAll('.sp-cats .sp-section-label')].map(e => textOf(e).trim())
  ok('the personal half of Settings is named as the personal half',
    groups.includes('Your own tracker'), groups.join(' | ') || '(no group label)')
  /* It explains what is UNDER it: above Earnings and Reminders (and above Your
     data, which is the same tracker's records), below the employer's own things.
     The Workplace row is not required to be there — it only exists for a business
     account, and this mount is not signed in as one. */
  ok('and the label sits above the categories it explains, not under them', (() => {
    const kids = [...host.querySelector('.sp-cats').children]
    const at = kids.findIndex(k => textOf(k).includes('Your own tracker'))
    if (at < 0) return false
    const below = ['Earnings', 'Reminders', 'Your data']
      .map(name => kids.findIndex(k => textOf(k).includes(name)))
    return below.every(i => i > at) && at > 0
  })(), groups.join(' | '))

  await press(byText(host, '.sp-cat-card', 'Appearance'))
  ok('opening a category says which one you are in, instead of the same word on all six',
    /Settings · Appearance/.test(textOf(host.querySelector('.sp-crumb'))),
    textOf(host.querySelector('.sp-crumb')))

  /* ── §41: a category is a STEP, and both Backs walk up out of it ─────────────
     The report was a reader going several levels deep and watching the phone's
     Back close the app, because a category lived in `useState` and therefore in
     no history at all. It is an address now, so the phone's Back steps up — and
     the page's own control steps up with it, not out of Settings altogether. */
  const addr = () => routes.normalisePath(dom.window.location.hash)
  ok('...and the category is in the address, so Back has somewhere to step',
    addr() === '/more/settings/appearance', addr())

  await press(host.querySelector('.dp-back, .sp-back'))
  ok('the page’s own Back leaves the category and lands on Settings',
    addr() === '/more/settings' && !!host.querySelector('.sp-title-main'),
    addr())

  await press(byText(host, '.sp-cat-card', 'Earnings'))
  ok('...back into a category', addr() === '/more/settings/earnings', addr())
  await act(async () => { dom.window.history.back() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  ok('Android Back out of a category lands on Settings, with the page still open',
    addr() === '/more/settings' && !!host.querySelector('.sp-page'), addr())
  /* Closing Settings REPLACES its entry rather than stacking More on top of it.
     That is what stops the next Back from re-opening the page the reader just
     left — press back, watch the app walk forward into Settings again. */
  await press(host.querySelector('.dp-back, .sp-back'))
  /* The page animates out (useExit, 380ms), so "closed" is not true on the same
     tick as the press — the address is. */
  await act(async () => { await new Promise(r => setTimeout(r, 450)) })
  ok('closing Settings puts the address back to More and closes the page',
    addr() === '/more' && !host.querySelector('.sp-page'), addr())
  await act(async () => { dom.window.history.back() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  ok('...and Android Back from there does NOT re-open Settings',
    !host.querySelector('.sp-page') && addr() !== '/more/settings', addr())
  ok('...and it lands on a screen the app can draw, not on nothing',
    !!host.querySelector('.dp-tabbar') || textOf(host).trim().length > 40, addr())
  await close()
}

{
  const App = (await import('../../src/App.jsx')).default
  const { host, close } = await open(routes.MORE.notifications, <App />)

  const crumb = textOf(host.querySelector('.sp-crumb'))
  ok('More → Notifications opens the reminders page', /Reminders/.test(textOf(host)), textOf(host).slice(0, 80))
  ok('and the header reconciles the two words, so the row and the page agree',
    /Settings · Reminders/.test(crumb), crumb)

  const before = calls().length
  await press(byText(host, '.sp-cat-card', 'Earnings'))
  ok('reading settings writes nothing to the database', writes(before).length === 0,
    JSON.stringify(writes(before)))
  await close()
}

// ══ 5b. Connect: the walk the §41 report named by hand ══════════════════════
/* More → Settings → Connect was the exact path in the report, and Connect did not
   exist: cloud sync was a status ROW duplicated inside two other categories, with
   no address of its own and nothing to sign in from. It is a category now, so it
   owes the two promises the other seven already keep — the crumb names it, and the
   phone's own Back steps OUT of it rather than out of the app. nav.jsx §41 proves
   that mechanism on `earnings` and `data`; this proves it on the screen the reader
   actually reported, which is the one that was missing. */
{
  const App = (await import('../../src/App.jsx')).default
  const { host, close } = await open(routes.settingsPath('connect'), <App />)
  const addr = () => routes.normalisePath(dom.window.location.hash)

  ok('a deep link to Connect opens Settings already standing on Connect',
    /Settings · Connect/.test(textOf(host.querySelector('.sp-crumb'))),
    textOf(host.querySelector('.sp-crumb')))
  /* Scoped to `.sp-page`, not to `host`: Settings is an overlay drawn on top of
     the whole app, so an unscoped read could match a word from the tracker behind
     it and pass without Connect having drawn anything at all. */
  const page = () => textOf(host.querySelector('.sp-page'))
  ok('...and the page says what it is for',
    /Cloud sync/.test(page()), page().slice(0, 90))
  ok('Connect answers what a status row could not: is this device talking to the record',
    /Connected|Ready — sign in|Not configured/.test(page()), page().slice(0, 90))

  await press(host.querySelector('.dp-back, .sp-back'))
  ok('the page’s own Back leaves Connect and lands on the Settings list',
    addr() === '/more/settings' && !!host.querySelector('.sp-title-main'), addr())

  await press(byText(host, '.sp-cat-card', 'Connect'))
  ok('...and the card is a door back into it, at an address of its own',
    addr() === '/more/settings/connect', addr())

  await act(async () => { dom.window.history.back() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  ok('Android Back out of Connect lands on Settings, with the page still open',
    addr() === '/more/settings' && !!host.querySelector('.sp-page'), addr())

  await close()
}

// ══ 6. An empty list says WHICH list is empty (Phase 9) ═════════════════════
/* The screen used to answer "No archived contractors." whenever the empty list was
   not the archive — so an employer who archived their only contractor, whose archive
   held that contractor, was told there were none. An empty state that is untrue is
   worse than none: it says a real supplier is gone. */
{
  mock.setContractorFixtures([
    { id: 'c7', name: 'Retired Supplier', status: 'archived', note: null },
  ])
  const { host, close } = await open(routes.MORE.contractors, <EmployerWorkspace />)
  const said = textOf(host).replace(/\s+/g, ' ')

  ok('with every contractor archived, the screen says which list is empty',
    /No active contractors/.test(said) && !/No archived contractors/.test(said),
    said.slice(0, 130))
  ok('and points at where the archived one is listed',
    /archived ones are listed below/.test(said), said.slice(0, 130))
  ok('with the control that reaches it',
    !!byText(host, '.ew-btn', 'Show 1 archived'))

  await close()
  /* The fixture is put back to the one every other check in this directory expects:
     one active contractor, because the roster's own worker is assigned to it. */
  mock.setContractorFixtures([
    { id: 'c1', name: 'Contractor A', status: 'active', note: null },
  ])
}

// ══ 7. Nothing on any of these screens wrote anything ═══════════════════════
{
  /* Two writes above are deliberate — they are the buttons this file pressed. Any
     OTHER write in the whole walk is a screen saving something the reader did not
     ask it to save, which is the failure this last check exists for. */
  const DELIBERATE = new Set(['createContractor', 'createDevice'])
  const stray = writes(LOG_START).filter(c => !DELIBERATE.has(c[0]))
  ok('no screen under More wrote a row the reader did not ask for',
    stray.length === 0, JSON.stringify(stray))
  ok('and the only writes in the whole walk are the two buttons this file pressed',
    writes(LOG_START).length === 2, JSON.stringify(writes(LOG_START).map(c => c[0])))
}

mock.setReadFailure(null)
mock.setExtraEmployees([])

console.log(bad === 0
  ? '\nMORE: SIX DESTINATIONS, EACH WITH A JOB AND AN ANSWER'
  : `\nMORE: ${bad} CHECK(S) FAILED`)
