/* Phase 3 — the navigation, checked in a real DOM against a real address bar.
 *
 * Phase 3 gave every screen an address and reduced the employer's navigation to
 * the four destinations the brief names. Both are easy to claim and easy to get
 * subtly wrong: a tab that changes the screen but not the address, a back
 * button that goes nowhere because the address never moved, a More row that
 * looks like a link and is not one.
 *
 * So this file drives it the way a thumb does — presses the destinations, reads
 * the address bar after each press, presses the browser's own Back — and checks
 * the things a screenshot cannot show:
 *
 *   · the four destinations are the four the brief names, in order;
 *   · pressing one changes BOTH the screen and the address;
 *   · Back returns to the destination you came from, not to the top;
 *   · a screen inside More keeps More lit in the bar (otherwise you lose the
 *     one cue that says which of the four you are inside);
 *   · a More row is a real <a href>, so it can be copied, long-pressed, or
 *     opened in a new tab;
 *   · an address nobody wrote a screen for is not a blank pane;
 *   · the personal tracker still has a door, and an employer who walks through
 *     it can get back.
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
const routes = await import('../../src/lib/routes.js')
await import('./mock-employer.js')

let bad = 0
const ok = (label, pass, detail) => {
  if (!pass) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1 }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text))

const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 15)) }) }

/* React listens for the browser's own events, so a press has to BE one. */
const press = async (el) => {
  if (!el) throw new Error('tried to press something that is not there')
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await settle()
}

/* The browser's Back. jsdom implements history, but not the button; moving back
   through the session history and firing the event the browser would fire is
   the same thing as far as the app is concerned. */
const goBack = async () => {
  await act(async () => { dom.window.history.back() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
}

const address = () => routes.normalisePath(dom.window.location.hash)

async function mount(el, at = '/') {
  dom.window.location.hash = at === '/' ? '' : at
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await settle()
  return { host, root }
}

/* ── the four destinations ──────────────────────────────────────────────────── */
{
  const { host, root } = await mount(<EmployerWorkspace />)
  const tabs = [...host.querySelectorAll('.dp-tab')].map(t => t.textContent.trim())
  ok('the bar carries the four destinations the brief names',
    JSON.stringify(tabs) === JSON.stringify(['Today', 'Attendance', 'People', 'More']),
    tabs.join(' · '))

  ok('every destination is a real link, so it can be copied or opened in a new tab',
    [...host.querySelectorAll('.dp-tab')].every(t => t.tagName === 'A' && (t.getAttribute('href') || '').startsWith('#/')),
    [...host.querySelectorAll('.dp-tab')].map(t => t.getAttribute('href')).join(' '))

  ok('the destination you are on says so to a screen reader',
    host.querySelector('.dp-tab[aria-current="page"]')?.textContent.trim() === 'Today',
    host.querySelector('.dp-tab[aria-current="page"]')?.textContent.trim())

  /* ── pressing a destination moves the screen AND the address ───────────── */
  await press(byText(host, '.dp-tab', 'Attendance'))
  ok('pressing Attendance opens it', !!host.querySelector('.ew-dayrow') || host.textContent.includes('Attendance'),
    address())
  ok('...and the address says so, because the screen follows the address',
    address() === '/attendance', address())
  ok('...and the bar moves with it',
    host.querySelector('.dp-tab[aria-current="page"]')?.textContent.trim() === 'Attendance')

  await press(byText(host, '.dp-tab', 'People'))
  ok('pressing People opens the roster', host.textContent.includes('James Okon'), address())
  ok('...and the address says People', address() === '/people', address())

  /* ── the browser's back button ─────────────────────────────────────────── */
  await goBack()
  ok('Back returns to the destination you came from',
    address() === '/attendance' &&
    host.querySelector('.dp-tab[aria-current="page"]')?.textContent.trim() === 'Attendance',
    address())

  await act(async () => { root.unmount() })
  host.remove()
}

/* ── More, and the screens that live under it ───────────────────────────────── */
{
  const { host, root } = await mount(<EmployerWorkspace />)

  await press(byText(host, '.dp-tab', 'More'))
  ok('More is an address, not a menu that opens over the screen', address() === '/more', address())

  const groups = [...host.querySelectorAll('.dp-sec-label')].map(g => g.textContent.trim())
  ok('More is grouped, so a long list reads as sections',
    groups.length >= 3 && groups.includes('Workforce') && groups.includes('Account'),
    groups.join(' · '))

  const rows = [...host.querySelectorAll('.ew-more a.dp-item')]
  ok('every row under More goes somewhere', rows.length >= 6, `${rows.length} rows`)
  ok('every row is a real link with a real address',
    rows.every(r => (r.getAttribute('href') || '').startsWith('#/')),
    rows.map(r => r.getAttribute('href')).join(' '))

  /* The four destinations are the only navigation: a screen under More keeps
     More lit, or a reader loses the cue that says where they are. */
  const contractors = rows.find(r => r.textContent.includes('Contractors'))
  await press(contractors)
  ok('a row under More opens its screen', address() === '/more/contractors', address())
  ok('...and the bar still shows you as inside More',
    host.querySelector('.dp-tab[aria-current="page"]')?.textContent.trim() === 'More')
  /* §41: the way back is a control now, not the destination's name set in grey.
     What it has to be is pressable, labelled, and honest about where it goes —
     the visible word is "Back" and the accessible name names the screen. */
  const backCtl = host.querySelector('.dp-back')
  ok('...and that screen carries the way back',
    !!backCtl && !!(backCtl.getAttribute('aria-label') || '').includes('More'),
    backCtl ? backCtl.outerHTML.slice(0, 90) : 'no .dp-back')
  ok('...as a control you can see and press, not a line of grey text',
    !!backCtl && backCtl.tagName === 'A' && !!backCtl.querySelector('svg'),
    backCtl && backCtl.tagName)
  ok('...and it says the one word that cannot be misread',
    (backCtl.textContent || '').trim() === 'Back',
    backCtl && backCtl.textContent)

  /* ── the address is what decides, so a link opens the screen directly ──── */
  await act(async () => { root.unmount() })
  host.remove()
}

{
  const { host, root } = await mount(<EmployerWorkspace />, '/more/billing')
  ok('a pasted link opens the screen it names, not the index it belongs to',
    !!host.querySelector('.dp-back') && host.textContent.trim().length > 80,
    host.textContent.trim().slice(0, 60))
  ok('and it is still inside More', address() === '/more/billing')
  await act(async () => { root.unmount() })
  host.remove()
}

{
  /* An address nobody wrote a screen for. The brief's rule is that a screen
     that fails must say so — and an unknown address is the one case where
     saying nothing is right, because the reader asked for nothing. It falls
     back to the first destination rather than to a blank pane. */
  const { host, root } = await mount(<EmployerWorkspace />, '/not-a-screen')
  ok('an unknown address is not a blank pane',
    host.textContent.trim().length > 40 && !!host.querySelector('.dp-tabbar'),
    `${host.textContent.trim().slice(0, 40)}…`)
  await act(async () => { root.unmount() })
  host.remove()
}

/* ── the personal tracker keeps its door ────────────────────────────────────── */
{
  const paths = routes.MORE_GROUPS.flatMap(g => g.items.map(i => i.path))
  ok('the tracker is reachable from the employer navigation',
    paths.includes(routes.TRACKER.month) && paths.includes(routes.TRACKER.year),
    paths.join(' '))

  const { host, root } = await mount(<EmployerWorkspace />, '/more')
  const month = [...host.querySelectorAll('a.dp-item')].find(r => r.textContent.includes('Month'))
  ok('...and it is a row under More, on its own screen', !!month, month?.getAttribute('href'))
  await act(async () => { root.unmount() })
  host.remove()
}

/* ══ §41 — ONE STEP BACK, ALL THE WAY UP ═════════════════════════════════════
 *
 * The report: several levels deep, the phone's own Back button closed the app
 * instead of stepping up, and the in-app way back was not obvious.
 *
 * The cause was that a level a screen keeps in its own state is invisible to the
 * browser's history: Settings' categories lived in `useState`, so there was no
 * entry for them and the back gesture had nothing to walk. A category is an
 * address now, and every Back control — the one on the screen and the one on the
 * phone — walks the same history, one logical step at a time.
 *
 * These are the sequences from the report, driven in a real DOM. "Android Back"
 * is `history.back()` plus the popstate the browser fires for it, which is exactly
 * what the phone sends; jsdom has no system back button to press.
 */
{
  const { host, root } = await mount(<EmployerWorkspace />, '/today')
  const backCtl = () => host.querySelector('.dp-back') || host.querySelector('.sp-back')
  const pressBack = async () => { await press(backCtl()) }

  /* ── A. Dashboard → Contractor → More → Settings → a category → back up ──── */
  await press(byText(host, '.dp-tab', 'More'))
  await press(byText(host, '.dp-item', 'Contractors'))
  ok('A · Contractor, reached from the More list', address() === '/more/contractors', address())

  await pressBack()
  ok('A · its Back control returns to More, one step, not to the dashboard',
    address() === '/more', address())

  await press(byText(host, '.dp-item', 'Settings'))
  ok('A · More → Settings', address() === '/more/settings', address())

  /* The Settings PAGE is drawn by the app shell, not by the workspace, so the
     category cards and the crumb are driven in more.jsx §5. What belongs here is
     the address they move to, and the history it creates. */
  await pressBack()
  ok('A · Back out of Settings lands on More, one step, not out of the app',
    address() === '/more', address())

  /* ── B. the same chain on the phone's own Back button ─────────────────────── */
  for (const step of ['/more/settings', '/more/settings/earnings']) {
    await act(async () => { dom.window.location.hash = step })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  }
  ok('B · a category inside Settings is a step with an address of its own',
    address() === '/more/settings/earnings', address())
  await goBack()
  ok('B · Android Back: category → Settings', address() === '/more/settings', address())
  await goBack()
  ok('B · Android Back: Settings → More', address() === '/more', address())
  ok('...and the app is still inside the workspace, not closed',
    !!host.querySelector('.dp-tabbar'), address())

  /* ── C. deep, then Back repeatedly: one logical step each time ────────────── */
  const walk = []
  for (const step of ['/more/contractors', '/more/settings', '/more/settings/data']) {
    await act(async () => { dom.window.location.hash = step })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    walk.push(address())
  }
  ok('C · three levels deep on the address alone',
    JSON.stringify(walk) === JSON.stringify(['/more/contractors', '/more/settings', '/more/settings/data']),
    walk.join(' → '))

  await goBack(); const c1 = address()
  await goBack(); const c2 = address()
  await goBack(); const c3 = address()
  ok('C · each Android Back moves exactly one logical step',
    c1 === '/more/settings' && c2 === '/more/contractors' && c3 === '/more',
    [c1, c2, c3].join(' → '))
  ok('C · and it never lands anywhere the app cannot draw',
    [c1, c2, c3].every(p => routes.employerPaneFor(p) || routes.shellViewFor(p)),
    [c1, c2, c3].join(' '))

  /* ── D. forward, back, forward again: the history stays sane ─────────────── */
  await press(byText(host, '.dp-tab', 'Attendance'))
  const f1 = address()
  await goBack()
  const d1 = address()
  await press(byText(host, '.dp-tab', 'Attendance'))
  const f2 = address()
  ok('D · forward, back, forward again ends where it started',
    f1 === '/attendance' && d1 !== '/attendance' && f2 === '/attendance',
    `${f1} → ${d1} → ${f2}`)
  await goBack()
  ok('D · and Back still retraces from there', address() !== '/attendance', address())
  await act(async () => { root.unmount() })
  host.remove()
}

/* ── E. a deep link is not a trap ────────────────────────────────────────────
   A pasted link, a notification or a shortcut opens a screen with nothing of the
   app behind it. Back must not leave the app, and must not invent a destination:
   it goes to the screen this one belongs to. */
{
  const { host, root } = await mount(<EmployerWorkspace />, '/more/settings/earnings')
  ok('E · the deep link opens the address it names',
    address() === '/more/settings/earnings', address())
  const backCtl = host.querySelector('.dp-back')
  ok('E · and the screen it lands on carries a way back', !!backCtl, backCtl && backCtl.tagName)
  await press(backCtl)
  ok('E · Back out of a deep link goes to the screen it belongs to, not nowhere',
    address() === '/more/settings', address())
  ok('...and it is still a screen the app can draw',
    !!host.querySelector('.dp-tabbar'), address())
  await act(async () => { root.unmount() })
  host.remove()
}

/* ── F. the root is the one place the app may close ──────────────────────────
   Android closes a standalone app when its history runs out — that is correct,
   and it is only correct at the root. What this asserts is the precondition: at
   the first entry there is nothing of the app behind, so Back leaves rather than
   pretending to step up. */
{
  const { host, root } = await mount(<EmployerWorkspace />, '/')
  const first = dom.window.history.state
  ok('F · the root entry is the app’s own floor, with nothing before it',
    !first || !first.dpDepth, JSON.stringify(first))
  ok('F · the root screen does not offer a Back it cannot honour',
    !host.querySelector('.dp-back'))
  await press(byText(host, '.dp-tab', 'More'))
  ok('F · a step in has an entry behind it, so the phone’s Back walks rather than closes',
    dom.window.history.state && dom.window.history.state.dpDepth >= 1,
    JSON.stringify(dom.window.history.state))
  await act(async () => { root.unmount() })
  host.remove()
}

console.log(bad === 0
  ? '\nNAVIGATION: THE FOUR DESTINATIONS, AND AN ADDRESS FOR EACH'
  : `\nNAVIGATION: ${bad} CHECK(S) FAILED`)
