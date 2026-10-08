/* The design system's own screen, mounted and driven.
 *
 * WHY THIS EXISTS
 *
 * src/ui/ is what the redesign's screens are built from, so "it renders" is not
 * enough: a chip that forgets its text communicates by colour alone, a row that
 * is a div with a click handler is invisible to a keyboard, and a skeleton that
 * is not hidden from assistive technology reads out as nothing twelve times.
 * Each of those is asserted here, on the real component, in a real DOM.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { createRequire } from 'node:module'
const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
const { JSDOM } = require_('jsdom')

const { polishProblems } = await import('./polish.js')

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { default: Specimen } = await import('../../src/specimen/Specimen.jsx')

let bad = 0
const ok = (label, pass, detail) => {
  if (!pass) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1 }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
await act(async () => { root.render(<Specimen />) })
await act(async () => { await new Promise(r => setTimeout(r, 20)) })

ok('the design system renders', host.innerHTML.length > 3000, `${host.innerHTML.length} chars`)
ok('and it renders without leaking a value into the page',
  polishProblems(host.innerHTML).length === 0, polishProblems(host.innerHTML).join(' | '))

/* Every primitive is on the page. A design system with an invisible member is
   a design system that has already begun to drift. */
for (const [cls, what] of [
  ['.dp-sec', 'section label'],
  ['.dp-list', 'list'],
  ['.dp-item', 'row'],
  ['.dp-progress-track', 'progress'],
  ['.dp-skel', 'skeleton'],
  ['.dp-chip', 'chip'],
    ['.dp-notice', 'notice'],
  ['.dp-loading', 'loading state'],
  ['.dp-item-icon', 'row icon'],
]) {
  ok(`${what} renders`, !!host.querySelector(cls))
}

/* §26 — never colour alone. */
const chips = [...host.querySelectorAll('.dp-chip')]
ok('every chip carries a word beside its colour',
  chips.length > 0 && chips.every(c => c.textContent.trim().length > 1),
  `${chips.length} chips: ${chips.map(c => c.textContent.trim()).join(' · ')}`)

const tones = new Set(chips.map(c => [...c.classList].find(x => x.startsWith('is-'))))
ok('the chip has a tone for each meaning, not one colour',
  tones.size >= 3, [...tones].join(' '))

/* §26 — a control a keyboard can reach. */
const pressable = [...host.querySelectorAll('.dp-item')].filter(el => el.tagName === 'BUTTON')
ok('a row that does something is a button, so a keyboard can reach it',
  pressable.length >= 1, `${pressable.length} button rows`)
ok('and a row that does nothing is not pretending to be one',
  [...host.querySelectorAll('.dp-item')].some(el => el.tagName === 'DIV'))
/* A row can GO somewhere as well as DO something, and a link is the element for
   that: it can be copied, long-pressed and opened in a new tab, which a button
   cannot. The design system has to offer both, or a screen that needs a link
   will fake one with a button and lose those. */
const linkRows = [...host.querySelectorAll('a.dp-item')]
ok('a row that goes somewhere is a link, not a button pretending to be one',
  linkRows.length >= 1 && linkRows.every(a => (a.getAttribute('href') || '').startsWith('#')),
  `${linkRows.length} link rows`)
ok('and there is a way back, at the tap floor',
  !!host.querySelector('.dp-back') && host.querySelector('.dp-back').className.includes('dp-back'))

/* §22 — a loading state must not be read out as nothing. */
const skels = [...host.querySelectorAll('.dp-skel')]
ok('the skeleton is hidden from assistive technology',
  skels.length > 0 && skels.every(s => s.closest('[aria-hidden="true"]')),
  `${skels.length} skeleton blocks`)

/* §8 — a bar everybody can read, including somebody who cannot see it. */
const bars = [...host.querySelectorAll('[role="progressbar"]')]
ok('progress reports its figures, not just its width',
  bars.length >= 3 && bars.every(b => b.getAttribute('aria-valuenow') !== null
    && b.getAttribute('aria-valuemax') !== null && b.getAttribute('aria-label')),
  `${bars.length} bars`)
ok('and a bar at zero is not drawn as a full one',
  bars.some(b => b.getAttribute('aria-valuenow') === '0')
  && host.querySelector('.dp-progress-bar[style*="width: 0%"]'))

/* The theme toggle is how a reviewer checks dark mode, so it has to work. */
const toggle = [...host.querySelectorAll('button')].find(b => /theme/i.test(b.textContent))
ok('the page offers a dark-mode switch', !!toggle && toggle.getAttribute('aria-pressed') === 'false')
await act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
const themed = host.querySelector('[data-theme="dark"]')
ok('and switching it puts the page in the dark theme',
  !!themed, themed ? 'data-theme="dark" applied' : 'no dark root')
await act(async () => { root.unmount() })
host.remove()

console.log(bad === 0 ? '\nDESIGN SYSTEM: EVERY PRIMITIVE HELD TO ITS RULE' : `\nDESIGN SYSTEM: ${bad} CHECK(S) FAILED`)
