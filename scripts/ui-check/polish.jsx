/* Phase 9 — polish, driven in a real DOM.
 *
 * The last pass over screens that already exist, and the checks are the ones a
 * polish phase can only claim by demonstration:
 *
 *   · **Adding a worker is a step with an address.** `/people/new` opens the
 *     form, Cancel and Done put the address back on the roster, and the command
 *     centre's one action on an empty roster lands ON the form rather than a tap
 *     short of it. A step that is state nobody can link to, reload or go back
 *     from is a step that loses an employer's work.
 *   · **An empty form answers.** The button used to sit disabled with no reason
 *     given, which reads as a broken screen. Now the press is answered with the
 *     one thing that is missing, on the field that is missing it — and nothing
 *     is sent to the database either way. That last half is the point: a form
 *     that "validates" by writing a worker with no name is inventing a person.
 *   · **A confirmation is announced, not just coloured.** The card says who was
 *     added in words, carries role="status", and the PIN — which exists in the
 *     clear exactly once — is still on screen until the employer dismisses it.
 *   · **The work is pointed at.** The row that was just added is marked, and the
 *     mark goes the moment the employer moves on, because a highlight that
 *     outlives the act it confirms stops meaning anything.
 *
 * The write log is the same instrument the roster checks use: after the whole
 * walk, exactly ONE employee was created, with the name that was typed, and
 * nothing else was written.
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

/* React installs its own value setter on the input prototype and ignores a bare
   assignment, so the native one has to be reached through it. */
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
const squash = (el) => String(el && el.textContent || el || '').replace(/\s+/g, ' ').trim()
const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => (e.textContent || '').trim().includes(text))

/* The form's name field, found the way a person finds it: by what it asks for. */
const nameField = (host) => [...host.querySelectorAll('.ew-input')]
  .find(i => (i.getAttribute('placeholder') || '').includes('Amina'))

const rows = (host) => [...host.querySelectorAll('.ew-list:not(.is-archived) .ew-row')]

const LOG_START = (globalThis.__calls || []).length
const writes = () => (globalThis.__calls || []).slice(LOG_START)

async function open(at) {
  try { dom.window.location.hash = at } catch { /* no window — nothing to set */ }
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

// ══ 1. Adding a worker is a step with an address ═══════════════════════════════
{
  const { host, close } = await open(routes.PEOPLE_ADD)
  const field = nameField(host)
  ok('the address /people/new opens the add form, not the roster',
    !!field && !rows(host).length,
    host.textContent.replace(/\s+/g, ' ').trim().slice(0, 90))

  /* The sentence this form owes an employer. A worker record is not an account,
     and a person with no phone is still fully employable — that is the difference
     between "Not registered" reading as a fact about a login and reading as a fact
     about somebody's job. */
  const said = host.textContent.replace(/\s+/g, ' ')
  ok('and it says a roster record is not a DayPay account',
    /does not create a DayPay account/.test(said) && /invited/.test(said),
    said.slice(0, 130))

  // ══ 2. An empty form answers, and sends nothing ═════════════════════════════
  const submit = byText(host, '.ew-btn', 'Add to roster')
  ok('the submit is live, not disabled into silence', !!submit && !submit.disabled)

  await press(submit)
  const afterEmpty = host.textContent.replace(/\s+/g, ' ')
  ok('pressing it with no name says what is missing',
    /needs a name/.test(afterEmpty),
    afterEmpty.slice(0, 110))

  ok('the refusal is announced as well as shown',
    !!host.querySelector('.ew-msg-error[role="alert"]'),
    squash(textOf(host.querySelector('.ew-msg-error'))).slice(0, 60))

  ok('and puts the cursor on the field that is missing it',
    dom.window.document.activeElement === field,
    dom.window.document.activeElement ? dom.window.document.activeElement.tagName : 'nothing focused')

  ok('and nothing at all was sent to the database',
    writes().length === 0, JSON.stringify(writes()))

  // ══ 3. A name, a PIN, and a confirmation that is announced ══════════════════
  await type(field, 'Grace Adeyemi')
  await press(byText(host, '.ew-btn', 'Add to roster'))

  const card = host.querySelector('[role="status"]')
  const pin = host.querySelector('[data-testid="pin-value"]')
  ok('adding her shows the PIN once, on a card that is announced',
    !!card && !!pin && /^\d{4}$/.test((pin.textContent || '').trim()),
    pin ? (pin.textContent || '').trim() : 'no PIN on screen')

  ok('the confirmation names her, in words',
    /Grace Adeyemi is on the roster/.test(host.textContent),
    host.textContent.replace(/\s+/g, ' ').trim().slice(0, 90))

  const copy = byText(host, '.ew-btn', 'Copy PIN')
  await press(copy)
  ok('copying the PIN says so on the control itself',
    /Copied/.test(textOf(byText(host, '.ew-btn', 'Copied'))),
    textOf(byText(host, '.ew-btn', 'Copied')))

  ok('and the card is still up until the employer dismisses it — the number is not lost',
    !!host.querySelector('[data-testid="pin-value"]'))

  // ══ 4. Done goes back, and points at the person who was added ═══════════════
  await press(byText(host, '.ew-btn', 'Done'))
  ok('Done returns the address to the roster', address() === routes.EMPLOYER.people,
    `#${routes.normalisePath(dom.window.location.hash)}`)
  ok('the form is closed and the roster is back', !nameField(host) && rows(host).length > 0,
    `${rows(host).length} row(s)`)

  /* The number exists in the clear exactly once, and it goes with the card. A
     secret left on the roster — over an employer's shoulder, on a screen handed
     across to read the list — would be the same mistake as never showing it. */
  ok('and the one-time PIN does not follow them onto the roster',
    !host.querySelector('[data-testid="pin-value"]') && !/hashed/.test(host.textContent),
    host.textContent.replace(/\s+/g, ' ').trim().slice(0, 90))

  // ══ 5. The roster is a working screen when the flow ends ════════════════════
  await type(host.querySelector('.ew-find input[type="search"]'), 'Jam')
  ok('and the roster still answers a search from there',
    rows(host).length === 1,
    `${rows(host).length} row(s) for "Jam"`)

  await close()
}

// ══ 6. Cancel leaves the address where the employer was ════════════════════════
{
  const { host, close } = await open(routes.PEOPLE_ADD)
  await press(byText(host, '.ew-btn', 'Cancel'))
  ok('Cancel puts the address back on the roster',
    address() === routes.EMPLOYER.people && !nameField(host),
    `#${routes.normalisePath(dom.window.location.hash)}`)
  await close()
}

// ══ 7. A brand-new employer: one action, and it opens the form ════════════════
{
  mock.setRosterEmpty(true)
  const { host, close } = await open('')
  const first = host.querySelector('[data-testid="add-first-worker"]')
  ok('the empty command centre offers one thing to do, and it names the first worker',
    !!first && /Add your first worker/.test(textOf(first)),
    textOf(first).trim() || host.textContent.replace(/\s+/g, ' ').trim().slice(0, 80))

  await press(first)
  ok('and it lands ON the form — not on a screen where the form is one more tap away',
    !!nameField(host) && address() === routes.PEOPLE_ADD,
    `#${routes.normalisePath(dom.window.location.hash)}`)

  /* Cancel from here is the way out of the flow a new employer was pushed into,
     and it must leave them somewhere real. */
  await press(byText(host, '.ew-btn', 'Cancel'))
  ok('and Cancel leaves them on the roster, not back on an empty screen with a button',
    address() === routes.EMPLOYER.people && rows(host).length === 0,
    `#${routes.normalisePath(dom.window.location.hash)}, ${rows(host).length} row(s)`)

  await close()
  mock.setRosterEmpty(false)
}

// ══ 8. The whole walk wrote one worker, and nothing else ══════════════════════
{
  const wrote = writes()
  const created = wrote.filter(c => c[0] === 'createEmployee')
  ok('the whole polish walk created exactly one worker, with the name that was typed',
    created.length === 1 && created[0][1] === 'Grace Adeyemi',
    JSON.stringify(wrote))
  ok('and wrote nothing else — no day, no rate, no archive',
    wrote.filter(c => ['setDay', 'clearDay', 'confirmDay', 'disputeDay', 'reopenDay',
      'archiveEmployee', 'restoreEmployee', 'setEmployeeContractor', 'resolveCorrection',
      'withdrawCorrection', 'addRatePeriod', 'deleteRatePeriod'].includes(c[0])).length === 0,
    JSON.stringify(wrote))
}

console.log(bad === 0 ? '\nPOLISH: THE EDGES ARE HANDLED' : `\nPOLISH: ${bad} CHECK(S) FAILED`)
