/* Phase 17 — the workplace name, the last row of the audit's "missing" table.
 *
 * `employers.business_name` had a column, a writer in the data layer
 * (`updateBusinessName`) and three readers — the worker's own header, the leave
 * prompt and the site kiosk's door screen — and nothing that ever called the
 * writer. Every reader fell back: "My team", "this team", "Your site".
 *
 * This file drives the component that calls it, in a real DOM, against the same
 * mock data layer the rest of the suite uses (`src/employer/Workplace.jsx` imports
 * `../lib/employer`, which the harness replaces — so a save here is a claim about
 * what reaches the database, not about a button existing). The questions are the
 * ones a person would ask: does the row say what the name is, does the field hold
 * the name that is stored, is an empty name sendable, does a save reach the data
 * layer with exactly what was typed, does the screen then say so — and does a save
 * that FAILS say that rather than claiming success.
 *
 * The failure matters most: a name that silently did not save is the kind of thing
 * an employer discovers when a worker says they never heard of the place.
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
const Workplace = (await import('../../src/employer/Workplace.jsx')).default
const { WorkplaceRow } = await import('../../src/employer/Workplace.jsx')
const { workplaceVisible } = await import('../../src/lib/employerLogic.js')
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
/* `since` is a RAW index into the shared call log — the harness runs every driver
   in one process, so filtering first and slicing by that count would slide into
   another file's calls. `LOG_START` is taken when this driver loads, not at 0. */
const writes = (since) => calls().slice(since).filter(c => !/^list|^my|^invoicesAvailable/.test(c[0]))
const LOG_START = calls().length

const field = (host) => host.querySelector('.sp-name-input')
const saveBtn = (host) => byText(host, '.sp-save-name', 'Save')

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await settle()
  return { host, close: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

console.log('')
console.log('WORKPLACE: THE NAME AN EMPLOYER GIVES THE PLACE')
console.log('')

mock.resetBusinessName('Eddimore')

// ══ 1. The row: what it says, and who it is drawn for ════════════════════════
{
  const { host, close } = await mount(<WorkplaceRow name="Eddimore" onOpen={() => {}} />)
  ok('the settings row names the category and shows the name it holds',
    /Workplace/.test(textOf(host.querySelector('.sp-cat-name')))
      && /Eddimore/.test(textOf(host.querySelector('.sp-cat-sum'))),
    textOf(host).replace(/\s+/g, ' ').trim().slice(0, 70))
  ok('and it says what the name is for, in one line',
    /The name your workers see/.test(textOf(host.querySelector('.sp-cat-desc'))),
    textOf(host.querySelector('.sp-cat-desc')).trim())
  await close()

  const { host: unnamed, close: closeUnnamed } = await mount(<WorkplaceRow name={null} onOpen={() => {}} />)
  ok('a workplace with no name yet says so rather than showing an empty row',
    /Not named yet/.test(textOf(unnamed)), textOf(unnamed.querySelector('.sp-cat-sum')).trim())
  await closeUnnamed()

  ok('and only a business account is offered it at all',
    workplaceVisible({ isBusiness: true }) === true
      && workplaceVisible({ isBusiness: false }) === false
      && workplaceVisible(null) === false,
    'a worker and a personal workspace are both refused')
}

// ══ 2. The page: the field, the offer, and what is not sendable ══════════════
{
  const { host, close } = await mount(<Workplace name="Eddimore" onSaved={() => {}} />)
  const input = field(host)
  ok('the field holds the name that is stored, not an empty box beside it',
    !!input && input.value === 'Eddimore', input ? `"${input.value}"` : 'no field')
  ok('and it is labelled for a screen reader, not only by its placeholder',
    !!host.querySelector('label[for]') && host.querySelector('label[for]').textContent.trim() === 'Workplace name')
  ok('and the save is offered while there is something to save',
    !!saveBtn(host) && saveBtn(host).disabled === false)

  await type(input, '   ')
  ok('and a blank name cannot be sent — the offer is withdrawn, not failed later',
    saveBtn(host).disabled === true, 'Save is disabled on an empty name')

  /* And the control is not the only thing standing between a blank name and the
     database. The `disabled` attribute is a rendered fact; the function's own
     refusal is the one that holds if the attribute ever goes missing (a re-render
     mid-flight, a keyboard submit, someone calling it another way), so the check
     takes the attribute off and presses the button. */
  const before = calls().length
  const btn = saveBtn(host)
  btn.disabled = false
  await press(btn)
  ok('and a blank name still reaches nothing if the button is pressed anyway',
    writes(before).length === 0 && !host.querySelector('.sp-wp-note.is-ok'),
    'nothing was sent, nothing claimed to be saved')
  await close()
}

// ══ 3. Saving: exactly what was typed reaches the data layer ═════════════════
{
  const before = calls().length
  let told = null
  const { host, close } = await mount(<Workplace name="Eddimore" onSaved={(n) => { told = n }} />)

  await type(field(host), 'Riverside Farms')
  await press(saveBtn(host))

  const sent = writes(before)
  ok('saving reaches the data layer with exactly what was typed',
    sent.length === 1 && sent[0][0] === 'updateBusinessName' && sent[0][1] === 'Riverside Farms',
    JSON.stringify(sent))
  ok('and the caller is told the name that was saved, so it can re-read the roles',
    told === 'Riverside Farms', JSON.stringify(told))

  const note = host.querySelector('.sp-wp-note')
  ok('and the screen says so, in words, beside the field',
    !!note && note.classList.contains('is-ok') && /Saved/.test(textOf(note))
      && note.getAttribute('role') === 'status',
    note ? `${note.getAttribute('role')}: ${textOf(note).trim()}` : 'no note')
  ok('and what the database now holds is that name',
    mock.workplaceName() === 'Riverside Farms', mock.workplaceName())

  await type(field(host), 'Eddimore')
  ok('and typing a fresh name takes the old confirmation away, so it cannot be read as new',
    !host.querySelector('.sp-wp-note.is-ok'), 'no stale success note')
  await close()
}

// ══ 4. A save that fails says so ═════════════════════════════════════════════
{
  const before = calls().length
  let told = null
  const { host, close } = await mount(<Workplace name={mock.workplaceName()} onSaved={(n) => { told = n }} />)

  mock.setBusinessNameFailure('Could not reach DayPay. Check your connection.')
  await type(field(host), 'Bassey Yard')
  await press(saveBtn(host))

  const err = host.querySelector('.sp-wp-note.is-err')
  ok('a save that fails says what happened, in the app’s own words',
    !!err && /Could not reach DayPay/.test(textOf(err)) && err.getAttribute('role') === 'alert',
    err ? textOf(err).trim() : 'no message')
  ok('and it says what to do about it', /Check your connection/.test(textOf(err)),
    textOf(err).trim())
  ok('and it does not claim to have saved',
    !host.querySelector('.sp-wp-note.is-ok') && told === null, 'no success note, no callback')
  ok('and the attempt did reach the data layer — the failure was the write, not the button',
    writes(before).length === 1 && writes(before)[0][0] === 'updateBusinessName',
    JSON.stringify(writes(before)))
  ok('and the name the database holds is untouched',
    mock.workplaceName() === 'Riverside Farms', mock.workplaceName())

  mock.setBusinessNameFailure(null)
  await close()
  mock.resetBusinessName('Eddimore')
}

// ══ 5. Nothing was saved that nobody asked for ═══════════════════════════════
{
  const across = writes(LOG_START).filter(c => c[0] === 'updateBusinessName')
  ok('across the whole walk, the only saves are the two this file typed',
    across.length === 2,
    `${across.length} save(s): ${JSON.stringify(across)}`)
  const stray = writes(LOG_START).filter(c => c[0] !== 'updateBusinessName')
  ok('and nothing else was written by any of it', stray.length === 0, JSON.stringify(stray))
}

console.log('')
console.log(bad === 0
  ? 'WORKPLACE: THE NAME REACHES EVERY SCREEN THAT SHOWS IT'
  : `WORKPLACE: ${bad} CHECK(S) FAILED`)
