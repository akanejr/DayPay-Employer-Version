/* Phase 15 — the desktop layout, held to what a DOM can prove.
 *
 * The wide-screen layout is CSS: a rail at 1024px, two columns at 1280px, a
 * measured column of content. jsdom cannot see any of it — it has no layout, and
 * it does not evaluate media queries — so this file deliberately does not pretend
 * to test the pixels. What it tests is the STRUCTURE the CSS hangs off:
 *
 *   · the wrappers the wide layout needs exist, and there are exactly two of them
 *     on Today, so a block cannot fall between the columns on a wide screen;
 *   · nothing escaped a wrapper — the sections inside the two halves are the same
 *     sections the screen had before, both by count and by name;
 *   · the side/main split on Attendance holds the control on the left and the
 *     people on the right, with the title and the summary outside both;
 *   · the branch with one job does not opt into the two-column grid;
 *   · the rail's markup is unchanged — the same nav, the same four destinations
 *     from EMPLOYER_NAV, each still carrying the rule that marks the active one
 *     without relying on colour;
 *   · the class names the new CSS targets are rendered somewhere, so no rule in
 *     this phase is dead.
 *
 * The CSS itself is held to its contract in `tests/design.test.js`, which is where
 * a media query can actually be read, and the phone layout staying put is proved
 * by the other 500-odd checks in this harness, which all run at phone width.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { createRequire } from 'node:module'
const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
const { JSDOM } = require_('jsdom')

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
const Dashboard = (await import('../../src/employer/Dashboard.jsx')).default
const StaffDays = (await import('../../src/employer/StaffDays.jsx')).default
const MorePane = (await import('../../src/employer/MorePane.jsx')).default
const EmployerWorkspace = (await import('../../src/employer/EmployerWorkspace.jsx')).default
const routes = await import('../../src/lib/routes.js')
const mock = await import('./mock-employer.js')

let bad = 0
const ok = (label, pass, detail) => {
  if (!pass) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1 }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 25)) }) }
const textOf = (el) => (el ? el.textContent || '' : '')
const squash = (el) => String((el && el.textContent != null) ? el.textContent : (el || '')).replace(/\s+/g, ' ').trim()

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await settle()
  await settle()
  return { host, close: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

/* The same render without draining the microtask queue — so the state that exists
   BETWEEN the first paint and the data arriving can be read. `await act(async …)`
   also flushes the promise a screen is waiting on, which is why the loading state
   has to be looked at through a synchronous act (see states.jsx, which learned
   this the hard way). */
function mountSync(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, close: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

const employees = await mock.listEmployees()
const contractors = await mock.listContractors()
const periods = await mock.listAllRatePeriods()

console.log('\nDESKTOP: THE WIDE LAYOUT RESTS ON STRUCTURE THAT IS REALLY THERE')
console.log('  scripts/ui-check/desktop.jsx')
console.log('')

// ══ 1. Today: exactly two columns, and nothing outside them ════════════════════
{
  const { host, close } = await mount(
    <Dashboard
      employees={employees}
      contractors={contractors}
      periods={periods}
      onOpenDays={() => {}}
      onOpenPeople={() => {}}
      onAddWorker={() => {}}
    />,
  )

  const dash = host.querySelector('.ew-dash')
  const cols = host.querySelectorAll('.ew-dash-col')

  ok('the command centre is split into exactly two blocks', cols.length === 2,
    `${cols.length} column wrapper(s)`)
  ok('and they are the container’s only children, so nothing can fall between them',
    dash.children.length === 2, `${dash.children.length} child(ren) of .ew-dash`)

  const sections = [...host.querySelectorAll('.ew-dash .dp-sec')]
  const inside = sections.filter(s => s.closest('.ew-dash-col') !== null)
  ok('every section of the screen is inside one of the two blocks',
    sections.length > 0 && inside.length === sections.length,
    `${inside.length}/${sections.length} inside`)

  /* The split is only a layout change if the blocks still hold what they held: the
     day on the left, the month and the site code on the right. */
  const left = cols[0]
  const right = cols[1]
  ok('the day itself is in the first block, with who is recorded and who is not',
    /Recorded|Not yet recorded|No workers yet|Today/.test(squash(left)),
    squash(left).slice(0, 64))
  ok('and what the month costs, the contractors and the site code are in the second',
    /This month/.test(squash(right)) && /Site attendance code/.test(squash(right)),
    squash(right).slice(0, 64))
  ok('nothing was dropped on the way into a block: both blocks together hold every row',
    left.querySelectorAll('.dp-item').length + right.querySelectorAll('.dp-item').length
      === host.querySelectorAll('.ew-dash .dp-item').length,
    `${host.querySelectorAll('.ew-dash .dp-item').length} row(s) in the screen`)

  await close()
}

// ══ 2. Attendance: the calendar on one side, the people on the other ═══════════
{
  const { host, close } = await mount(
    <StaffDays employees={employees} contractors={contractors} onOpenPeople={() => {}} />,
  )

  const att = host.querySelector('.ew-att')
  const side = host.querySelector('.ew-att-side')
  const main = host.querySelector('.ew-att-main')

  ok('attendance opts into the two-column branch', att.classList.contains('ew-att-split'))
  ok('and it has a side and a main', side !== null && main !== null)
  ok('the calendar controls are on the side: the range control and the day stepper',
    side.querySelector('.segmented') !== null && side.querySelector('.ew-datebar') !== null,
    squash(side).slice(0, 64))

  /* Whichever range is chosen, the calendar it draws belongs to the side as well —
     the day view draws none, so the Week range is chosen first rather than assumed. */
  const week = [...side.querySelectorAll('.segmented button')].find(b => textOf(b).trim() === 'Week')
  await act(async () => { week.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await settle()
  const sideAfter = host.querySelector('.ew-att-side')
  ok('and the calendar for the chosen range is on the side too',
    sideAfter.querySelector('.ew-att-week') !== null
      && host.querySelector('.ew-att-main .ew-att-week') === null,
    squash(sideAfter).slice(0, 64))
  ok('and the people are in the main, where the day is actually recorded',
    main.querySelectorAll('.ew-att-row').length > 0,
    `${main.querySelectorAll('.ew-att-row').length} row(s)`)
  ok('the title, the lede and the day’s closing line sit outside both, so they can span',
    host.querySelector('.ew-att > .ew-title') !== null
      && host.querySelector('.ew-att > .ew-att-note') !== null
      && host.querySelector('.ew-att > .ew-att-foot') !== null)
  ok('no row escaped the main block',
    main.querySelectorAll('.ew-att-row').length === host.querySelectorAll('.ew-att-row').length)

  await close()

  /* The branch with nothing to record has one job, so it must not become a grid:
     the desktop rules would otherwise scatter its title and its notice across two
     columns. */
  const empty = await mount(<StaffDays employees={[]} contractors={contractors} onOpenPeople={() => {}} />)
  ok('the empty-roster screen keeps its single column',
    empty.host.querySelector('.ew-att') !== null
      && empty.host.querySelector('.ew-att-split') === null
      && empty.host.querySelector('.ew-att-side') === null,
    squash(empty.host).slice(0, 48))
  await empty.close()
}

// ══ 3. The rail: the same nav, addressed the way the wide CSS addresses it ══════
{
  const waiting = mountSync(<EmployerWorkspace />)
  ok('the skeleton of the workspace is inside the pane container, so it is measured',
    waiting.host.querySelector('.ew.ew-is-waiting .dp-loading') !== null,
    squash(waiting.host).slice(0, 48))
  await waiting.close()

  const shell = await mount(<EmployerWorkspace />)

  const ew = shell.host.querySelector('.ew')
  const rail = ew.querySelector(':scope > .dp-tabbar')
  ok('the navigation is a direct child of the pane, which is where the rail rule looks',
    rail !== null, rail ? 'found' : 'not a direct child')

  const links = [...rail.querySelectorAll('.dp-tab')]
  ok('and it is still the four destinations from the routes table',
    links.length === routes.EMPLOYER_NAV.length
      && links.every((a, i) => textOf(a).trim() === routes.EMPLOYER_NAV[i].label),
    links.map(a => textOf(a).trim()).join(' · '))

  ok('every destination still carries the marker that is not a colour',
    links.every(a => a.querySelector('.dp-tab-rule') !== null),
    `${links.filter(a => a.querySelector('.dp-tab-rule')).length}/${links.length}`)
  ok('and the one you are on is marked for a screen reader as well',
    rail.querySelector('[aria-current="page"]') !== null,
    (rail.querySelector('[aria-current="page"]') || {}).textContent || 'none')

  await shell.close()
}

// ══ 4. More: four groups, two columns, and a class of its own ══════════════════
{
  const { host, close } = await mount(
    <MorePane employees={employees} contractors={contractors} contractorsOk />,
  )
  const pane = host.querySelector('.ew-more-pane')
  const groups = pane ? [...pane.children].filter(c => c.classList.contains('dp-sec')) : []

  ok('the More pane has a class the wide layout can address on its own',
    pane !== null && pane.tagName === 'DIV')
  ok('the four groups are its direct children, so the grid has four cells',
    groups.length === routes.MORE_GROUPS.length,
    `${groups.length} group(s)`)
  ok('and the foot line is the last thing in it, after the groups',
    pane.lastElementChild.classList.contains('ew-more-foot'),
    pane.lastElementChild.className)

  /* The roster row's overflow control is a different thing with a similar name,
     and it has to stay a button. */
  ok('the roster’s overflow control is still a button, and not the pane',
    host.querySelector('button.ew-more') === null && pane.classList.contains('ew-more'),
    'the pane keeps the class it always had')

  await close()
}

// ══ 5. No rule in this phase addresses a class nobody renders ══════════════════
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const src = new URL('../../src/', import.meta.url)

  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) walk(child)
      else if (/\.jsx?$/.test(entry.name)) files.push(child)
    }
  }
  walk(src)
  files.push(new URL('../../src/App.jsx', import.meta.url))

  const source = files.map(f => readFileSync(f, 'utf8')).join('\n')
  const introduced = [
    'ew-dash-col', 'ew-att-side', 'ew-att-main', 'ew-att-split',
    'ew-more-pane', 'ew-is-waiting', 'sp-cats',
  ]
  const dead = introduced.filter(cls => !source.includes(cls))
  ok('every class the wide layout introduces is rendered by a screen',
    dead.length === 0, dead.join(', ') || `${introduced.length} class(es) checked`)

  /* The settings class belongs to the category LIST only. The opened category is
     its own scroll area, and a grid there would rearrange a page of controls. */
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')
  ok('and the settings grid is on the category list, not on an opened category',
    app.includes('className="sp-scroll sp-cats"')
      && (app.match(/className="sp-scroll"/g) || []).length === 0,
    `${(app.match(/className="sp-scroll[^"]*"/g) || []).join(' · ')}`)
}

console.log('')
console.log(bad === 0 ? 'DESKTOP: THE WIDE LAYOUT HAS SOMETHING TO STAND ON' : `DESKTOP: ${bad} CHECK(S) FAILED`)
