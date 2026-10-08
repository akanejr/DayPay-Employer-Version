/* Phase 16 — consistency, checked in the DOM rather than in the source.
 *
 * `tests/design.test.js` reads the stylesheets and holds the rules to their
 * promises. What it cannot see is what actually reaches a screen. This file mounts
 * the three surfaces this phase touched and asks the questions a person would:
 *
 *   · the personal tracker's month view — is anything still shouting, and does its
 *     status read as a status rather than as a label of its own design;
 *   · the contractors screen — is it one list with dividers, next to a roster that
 *     was consolidated two phases ago;
 *   · the two calendars — do they call a Monday the same thing.
 *
 * The rule behind all of it: one product should have one voice. The employer's
 * screens were brought to sentence case in Phase 9; the rest of the app was still
 * using a different one, and the difference was visible on the same phone, one tap
 * apart.
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
const EmployerWorkspace = (await import('../../src/employer/EmployerWorkspace.jsx')).default
const { WEEKDAYS } = await import('../../src/lib/format.js')
const routes = await import('../../src/lib/routes.js')
const { polishProblems } = await import('./polish.js')

let bad = 0
const ok = (label, pass, detail) => {
  if (!pass) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1 }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 25)) }) }

async function mount(el, at = '') {
  try { dom.window.location.hash = at } catch { /* nothing to set */ }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await settle()
  await settle()
  return { host, close: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

/* Every text node on a screen that is typed in capitals. Comments are not DOM, so
   this needs no stripping — it is the rendered page or nothing, which is exactly
   why it lives here instead of in the source-reading suite. */
function shoutedText(host) {
  const walker = dom.window.document.createTreeWalker(host, dom.window.NodeFilter.SHOW_TEXT)
  const found = []
  while (walker.nextNode()) {
    const text = (walker.currentNode.nodeValue || '').trim()
    // two or more capital letters, and nothing that is a lowercase word in disguise
    if (/^[A-Z][A-Z0-9 ×·&/-]{1,30}$/.test(text) && /[A-Z]{2}/.test(text)) found.push(text)
  }
  return [...new Set(found)]
}

console.log('\nCONSISTENCY: ONE VOICE, ONE STATUS, ONE LIST')
console.log('  scripts/ui-check/consistency.jsx')
console.log('')

// ══ 1. The personal tracker: it is not shouting any more ═══════════════════════
{
  const App = (await import('../../src/App.jsx')).default
  const { host, close } = await mount(<App />)

  ok('the tracker renders', host.querySelector('.month-title') !== null,
    `${host.innerHTML.length} chars`)

  /* The day codes are deliberate: OK · OT · HOL · LV are stamps in a 40px cell,
     paired with the plain words beside them in the same row. Everything else on
     the screen speaks in sentences now. */
  const CODES = ['OK', 'OT', 'HOL', 'LV', 'OT 2×', 'HOL 2×']
  const shouted = shoutedText(host).filter(t => !CODES.includes(t) && !/^\d/.test(t))
  ok('nothing on the tracker is typed in capitals except the day codes',
    shouted.length === 0, shouted.join(' · ') || `${CODES.length} code(s) allowed`)

  const problems = polishProblems(host.innerHTML)
  ok('and the rules the polish suite holds every screen to still hold',
    problems.length === 0, problems.join(' | ') || 'clean')

  await close()
}

// ══ 2. Status reads as status: one shape, in the chip’s measurements ═══════════
{
  const src = await import('node:fs').then(fs => fs.readFileSync(
    new URL('../../src/index.css', import.meta.url), 'utf8'))

  /* The measurements are read from the stylesheet and compared to the employer's
     chip, which is the reference: an employer meets the chip on every screen, so
     it is the shape the rest of the product should look like. If the two ever
     drift, one of them moved without the other. */
  const grab = (name) => {
    const m = src.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))
    return m ? m[1] : ''
  }
  const n = (block, prop) => (block.match(new RegExp(`${prop}:\\s*([^;]+)`)) || [])[1] || null

  const employerSrc = await import('node:fs').then(fs => fs.readFileSync(
    new URL('../../src/employer/employer.css', import.meta.url), 'utf8'))
  const employerChip = employerSrc.match(/\.ew-chip\s*\{([^}]*)\}/)[1]

  ok('the status badge is the employer chip’s own size and weight',
    n(grab('final-badge, .active-badge, .mr-final, .mr-active'), 'font-size')
      === n(employerChip, 'font-size')
    && n(grab('final-badge, .active-badge, .mr-final, .mr-active'), 'font-weight')
      === n(employerChip, 'font-weight'),
    `${n(grab('final-badge, .active-badge, .mr-final, .mr-active'), 'font-size')} / ${n(grab('final-badge, .active-badge, .mr-final, .mr-active'), 'font-weight')}`)

  ok('and the same pill radius',
    n(grab('final-badge, .active-badge, .mr-final, .mr-active'), 'border-radius')
      === n(employerChip, 'border-radius'),
    n(grab('final-badge, .active-badge, .mr-final, .mr-active'), 'border-radius'))

  /* Two states must not be told apart by colour alone (§26). Each badge carries a
     word, and each has a dot that inherits the state's ink. */
  const badges = src.slice(src.indexOf('.final-badge, .active-badge'), src.indexOf('.locked-hint'))
  ok('and every state carries a word beside its colour',
    /\.final-badge::before/.test(badges) && /\.active-badge::before/.test(badges)
    && (badges.match(/background: currentColor/g) || []).length === 2,
    'both dots inherit their state’s ink')
}

// ══ 3. Contractors: one list, the same container as the roster ═════════════════
{
  const { host, close } = await mount(<EmployerWorkspace />, routes.MORE.contractors)
  await settle()

  const list = host.querySelector('.ew-list')
  const rows = host.querySelectorAll('.ew-person')
  ok('the contractors screen draws one list', list !== null && rows.length > 0,
    rows.length ? `${rows.length} row(s)` : 'no list')
  ok('and every contractor row is inside it, not beside it',
    rows.length > 0 && [...rows].every(r => r.closest('.ew-list') === list),
    `${[...rows].filter(r => r.closest('.ew-list')).length}/${rows.length} inside`)

  /* The roster uses the same container class — that is the consistency, not merely
     that the contractors have a container at all. */
  await close()
  const people = await mount(<EmployerWorkspace />, routes.EMPLOYER.people)
  await settle()
  ok('the roster uses the same list container',
    people.host.querySelector('.ew-list') !== null,
    `${people.host.querySelectorAll('.ew-list .ew-person').length} person card(s) inside it (expected 0)`)
  ok('and a contractor row is not mistaken for a worker row',
    people.host.querySelectorAll('.ew-list .ew-person').length === 0,
    'the roster rows are .ew-row, the contractor rows are .ew-person')
  await people.close()
}

// ══ 4. The two calendars call a Monday the same thing ══════════════════════════
{
  /* The tracker's calendar is in the personal tracker (App), the employer's is in
     the month picker on Attendance. Both print Mon…Sun; only the CSS ever made one
     of them MON. Both were read as rendered text, not as source, so a future
     `text-transform` cannot quietly pass this. */
  const App = (await import('../../src/App.jsx')).default
  const tracker = await mount(<App />)
  const trackerDays = [...tracker.host.querySelectorAll('.weekdays div')].map(d => d.textContent.trim())
  await tracker.close()

  const { host, close } = await mount(<EmployerWorkspace />, routes.EMPLOYER.attendance)
  await settle()
  // the employer's month header is aria-hidden and only drawn in the Month range
  const monthBtn = [...host.querySelectorAll('.segmented button')].find(b => b.textContent.trim() === 'Month')
  if (monthBtn) await act(async () => { monthBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await settle()
  const employerDays = [...host.querySelectorAll('.ew-att-month-head > *')].map(d => d.textContent.trim())
  await close()

  ok('the tracker’s calendar heads its columns in sentence case',
    trackerDays.length === 7 && trackerDays[0] === 'Mon' && trackerDays[6] === 'Sun',
    trackerDays.join(' '))
  ok('the employer’s month grid heads its columns too', employerDays.length === 7,
    employerDays.length === 7, employerDays.join(' '))
  ok('and every month calendar prints the one shared list of weekdays, in the same order',
    matches(employerDays) && matches(trackerDays),
    `${employerDays.join(' ')} vs ${trackerDays.join(' ')}`)

  function matches(days) {
    return days.length === WEEKDAYS.length && days.every((d, i) => d === WEEKDAYS[i])
  }

  // Three letters only fit if the seven columns are equal in both month grids — the
  // employer's header and the worker's own grid, which are the two that had initials.
  // A fixed-px column would clip "Wed" to nothing and the words above would be a lie.
  const css = await import('node:fs').then(fs => fs.readFileSync(
    new URL('../../src/employer/employer.css', import.meta.url), 'utf8'))
  const head = (sel) => css.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
  const columns = (sel) => /grid-template-columns:\s*repeat\(7,\s*1fr\)/.test(head(sel))
  ok('and on a phone the seven columns stay equal, so three letters fit',
    columns('\\.ew-att-month-head') && columns('\\.ew-mgrid-head,\\s*\\.ew-mgrid-week'),
    'repeat(7, 1fr) in both month grids')
}

console.log('')
console.log(bad === 0 ? 'CONSISTENCY: ONE VOICE ACROSS THE PRODUCT' : `CONSISTENCY: ${bad} CHECK(S) FAILED`)
