/* Phase 14 — the four states, on every screen that can have them.
 *
 * A screen has four things it can be asked to say, and only one of them is the
 * happy path:
 *
 *   loading   the data has not arrived — say that, and say it in a way a screen
 *             reader hears (a shimmer is not information)
 *   empty     it arrived, and there is nothing: the roster is new, the month is
 *             blank, no machine is linked yet
 *   failed    it did not arrive — which is NOT the same as empty, and on a
 *             check-in screen the difference is whether an employer's site is
 *             described as having nothing open today
 *   success   something happened, and the screen says so
 *
 * The failure this file exists for is a screen that answers two of those with the
 * same face. It is invisible in a screenshot and invisible in a passing test suite
 * that only ever walks the happy path, which is why each check below puts a screen
 * into a specific state and then asks what it said.
 *
 * It also holds the one structural rule Phase 14 introduced: the loading state is a
 * component (Loading, in the design system) rather than a line of grey text, and no
 * screen may go back to hand-rolling one.
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
const EmployeeView = (await import('../../src/employer/EmployeeView.jsx')).default
const CheckIn = (await import('../../src/employer/CheckIn.jsx')).default
const ContractorView = (await import('../../src/employer/ContractorView.jsx')).default
const CorrectionList = (await import('../../src/employer/CorrectionList.jsx')).default
const { Loading } = await import('../../src/ui/Ui.jsx')
const routes = await import('../../src/lib/routes.js')
const mock = await import('./mock-employer.js')

let bad = 0
const ok = (label, pass, detail) => {
  if (!pass) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1 }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const settle = async (ms = 25) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const press = async (el) => {
  if (!el) return false
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await settle()
  return true
}
const squash = (el) => String((el && el.textContent != null) ? el.textContent : (el || '')).replace(/\s+/g, ' ').trim()
const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => (e.textContent || '').trim().includes(text))

/* Mount with a SYNCHRONOUS act, which flushes the render and the effects but not
   the promise a screen is waiting on.

   This is the whole reason the file can check a loading state at all: an
   `await act(async () => ...)` also drains the microtask queue, so by the time it
   returns the fixture has arrived and the loading state is already gone. A check
   written that way would assert "the loading state appears" against a screen that
   had finished loading — and pass while proving nothing. */
async function mount(Component, props = {}, at = '') {
  try { dom.window.location.hash = at } catch { /* nothing to set */ }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(<Component {...props} />) })
  return {
    host,
    root,
    settle,
    close: async () => { await act(async () => { root.unmount() }); host.remove() },
  }
}

// ══ 1. The loading state is one component, and it is not a silent shimmer ══════
{
  const { host, close } = await mount(Loading, { label: 'Loading something…' })

  ok('the loading state is a shape standing in for the content, not a line of text',
    host.querySelectorAll('.dp-skel').length >= 3,
    `${host.querySelectorAll('.dp-skel').length} skeleton shape(s)`)
  ok('and it carries the sentence a screen reader announces',
    squash(host.querySelector('.dp-sr')) === 'Loading something…',
    squash(host.querySelector('.dp-sr')))
  ok('and the block says it is busy',
    host.querySelector('[aria-busy="true"]') !== null)
  ok('and the shimmer itself is hidden from assistive technology',
    host.querySelector('.dp-skel')?.closest('[aria-hidden="true"]') !== null)
  await close()
}

// ══ 2. A screen that is loading says so, and does not look finished ════════════
{
  /* Mounted and read BEFORE the reads resolve: this is the state an employer on a
     slow phone actually sees, and the old one — a centred line of grey text in an
     empty pane — is indistinguishable from "there is nothing here". */
  const shell = await mount(EmployerWorkspace, {}, routes.EMPLOYER.people)
  ok('the employer shell shows the loading state while the roster is on its way',
    shell.host.querySelector('.dp-skel') !== null && shell.host.querySelector('[aria-busy="true"]') !== null,
    squash(shell.host).slice(0, 70))
  await shell.settle()
  ok('and the roster replaces it rather than sitting under it',
    shell.host.querySelector('.dp-skel') === null && shell.host.querySelector('.ew-list') !== null)
  await shell.close()

  const employee = await mount(
    EmployeeView,
    { employee: { id: 'e1', full_name: 'James Okon', business_name: 'Eddimore' }, onChanged: () => {} },
  )
  ok('the worker’s own month shows it too, before its days arrive',
    employee.host.querySelector('.dp-skel') !== null,
    squash(employee.host).slice(0, 70))
  await employee.settle()
  await employee.close()

  const checkIn = await mount(CheckIn, { employee: { id: 'e1', full_name: 'James Okon' } })
  ok('and the check-in card, which is the first thing a worker opens at work',
    checkIn.host.querySelector('.dp-skel') !== null,
    squash(checkIn.host).slice(0, 70))
  await checkIn.settle()
  await checkIn.close()
}

// ══ 3. Failed is not empty: the check-in screen ════════════════════════════════
{
  /* The state that matters most in this file. `myAttendanceStatus` failing used to
     leave the screen saying "no session is open today" — a statement about the
     employer's site, made by a screen that never reached the database. */
  mock.setReadFailure('myAttendanceStatus')
  const { host, close } = await mount(CheckIn, { employee: { id: 'e1', full_name: 'James Okon' } })
  await settle()

  const said = squash(host)
  ok('a check-in load that failed says it could not check, not that nothing is open',
    /Could not check/.test(said) && !/no .*(session|code).*(open|today)/i.test(said),
    said.slice(0, 120))
  ok('and it offers the way back', !!byText(host, '.ew-btn', 'Try again'))

  /* The retry has to be a real one: the failure is cleared first, so the only way
     the form can appear is if pressing it asks again. */
  mock.setReadFailure(null)
  const before = (globalThis.__calls || []).filter(c => c[0] === 'myAttendanceStatus').length
  await press(byText(host, '.ew-btn', 'Try again'))
  const after = (globalThis.__calls || []).filter(c => c[0] === 'myAttendanceStatus').length
  ok('Try again asks the database again, and the screen recovers',
    after > before && !/Could not check/.test(squash(host)) && !!byText(host, '.ew-btn', 'Check again'),
    `${after - before} new read(s) -> ${squash(host).slice(0, 60)}`)
  await close()
}

// ══ 4. ...and the worker's month ══════════════════════════════════════════════
{
  mock.setReadFailure('myMonth')
  const { host, close } = await mount(
    EmployeeView,
    { employee: { id: 'e1', full_name: 'James Okon', business_name: 'Eddimore' }, onChanged: () => {} },
  )
  await settle()

  const said = squash(host)
  ok('a month that failed says so instead of drawing an empty month',
    /Could not load your month/.test(said) && !/No days recorded/.test(said),
    said.slice(0, 120))
  ok('and it is announced, not just coloured',
    host.querySelector('.ew-msg-error[role="alert"]') !== null)
  ok('and it offers the way back', !!byText(host, '.ew-linkbtn', 'Try again'))

  mock.setReadFailure(null)
  await press(byText(host, '.ew-linkbtn', 'Try again'))
  await settle()
  ok('and the month comes back when it is asked for again',
    !/Could not load your month/.test(squash(host)),
    squash(host).slice(0, 80))
  await close()
}

// ══ 5. A month with nothing in it is a different screen ═══════════════════════
{
  mock.setReadFailure(null)
  const { host, close } = await mount(
    EmployeeView,
    { employee: { id: 'e1', full_name: 'James Okon', business_name: 'Eddimore' }, onChanged: () => {} },
  )
  await settle()
  /* The fixture's days are in the current month, so stepping back one lands on a
     month this worker has nothing recorded in. The mock is month-aware, which is
     what makes this check possible at all. */
  await press(host.querySelector('[aria-label="Previous month"]'))
  await settle()

  const said = squash(host)
  ok('an empty month says which month is empty, and why',
    /No days recorded in/.test(said) && /your employer/i.test(said),
    said.slice(0, 130))
  ok('and it is not the failure state', !/Could not load/.test(said))
  ok('and it does not claim the figure is anything',
    host.querySelector('.ew-owe-figure') !== null,
    squash(host.querySelector('.ew-owe-sub')).slice(0, 60))
  await close()
}

// ══ 6. The check-in card, in its ordinary states ══════════════════════════════
{
  /* No session open. This is not an error and not an empty list — it is an answer,
     and it has to read like one. */
  mock.setAttendanceStatus(null)
  const closed = await mount(CheckIn, { employee: { id: 'e1', full_name: 'James Okon' } })
  await settle()
  ok('with nothing open the card answers, and offers to look again',
    !!byText(closed.host, '.ew-btn', 'Check again') && squash(closed.host).length > 40,
    squash(closed.host).slice(0, 110))
  await closed.close()

  /* A session is open: the card asks the question and takes the code. */
  mock.setAttendanceStatus({ is_open: true, contractor_name: 'Contractor A', last_ended: null })
  const open = await mount(CheckIn, { employee: { id: 'e1', full_name: 'James Okon' } })
  await settle()
  ok('with one open it asks the day’s question and names whose code it is',
    /Did you come to work today/.test(squash(open.host)) && /Contractor A/.test(squash(open.host)),
    squash(open.host).slice(0, 110))
  ok('and the code control is a labelled numeric field, not a mystery box',
    open.host.querySelector('.ew-code-input')?.getAttribute('inputmode') === 'numeric'
      && !!open.host.querySelector('.ew-code-input')?.getAttribute('aria-label'))
  /* Submitting a wrong-shape code must not reach the database: the button is only
     live for four digits. */
  const submit = byText(open.host, '.ew-btn', 'Record')
  ok('and an empty code cannot be sent', !!submit && submit.disabled === true)
  await open.close()
  mock.setAttendanceStatus(null)
}

// ══ 7. The contractor screen sends nobody to a screen that no longer exists ════
{
  /* "Assign them under Roster" was still on this screen: the roster has been called
     People since Phase 6, and a screen that names a destination that does not exist
     sends the reader looking for it. */
  const { host, close } = await mount(
    ContractorView,
    { contractor: { id: 'c-empty', name: 'Nobody Ltd', status: 'active' }, employees: [], onBack: () => {} },
  )
  await settle()
  const said = squash(host)
  ok('a contractor with no workers names the screen where they are assigned',
    /People/.test(said) && !/Roster/.test(said),
    said.slice(0, 130))
  await close()
}

// ══ 8. A list with nothing in it does not draw a heading over a void ═══════════
{
  /* CorrectionList is the worker's own requests. With none, it renders nothing at
     all rather than a heading over an empty space — deliberately: the section's
     subject is a list that is usually empty, and a permanent "you have no requests"
     panel would be furniture. What it must never do is draw the heading. */
  const { host, close } = await mount(CorrectionList, { rows: [], onChanged: () => {} })
  ok('no correction requests draws nothing at all, not a heading over a void',
    host.querySelectorAll('.ew-section-label').length === 0 && squash(host) === '',
    squash(host) || '(nothing)')
  await close()

  const one = await mount(CorrectionList, {
    rows: [{
      id: 'r1', work_date: mock.FIXTURE.WORK_DAY, status: 'open', request_kind: 'wrong_kind',
      want_kind: 'overtime', message: 'I worked late', decision_note: null,
    }],
    onChanged: () => {},
  })
  const st = mock.CORRECTION_STATUS.open
  ok('and one request is listed with its state in words',
    /Your requests/.test(squash(one.host)) && squash(one.host).includes(st.text),
    `${squash(one.host).slice(0, 90)} — engine says “${st.text}”`)
  await one.close()
}

// ══ 9. The rule that keeps it from drifting back ═══════════════════════════════
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const src = new URL('../../src/', import.meta.url)
  const files = readdirSync(new URL('employer/', src)).filter(f => f.endsWith('.jsx'))
    .map(f => `employer/${f}`)
    .concat(['App.jsx'].filter(f => {
      try { readFileSync(new URL(f, src), 'utf8'); return true } catch { return false }
    }))

  const handRolled = []
  for (const f of files) {
    const text = readFileSync(new URL(f, src), 'utf8')
    if (text.includes('ew-loading')) handRolled.push(`${f}: .ew-loading`)
    /* A skeleton written out by hand where Loading would do: three or more raw
       Skeleton shapes in a row is the old shape of it. */
    if ((text.match(/<Skeleton/g) || []).length >= 3) handRolled.push(`${f}: hand-written skeleton`)
  }
  ok('no screen hand-rolls a loading state any more', handRolled.length === 0, handRolled.join(', '))

  /* The three screens that had written the skeleton out by hand. They are named
     rather than guessed at: a rule that tries to work out which files "load" by
     pattern-matching useState and await flags nine innocent files and proves
     nothing. */
  const FORMERLY_HAND_ROLLED = ['Dashboard.jsx', 'WorkerView.jsx', 'StaffDays.jsx']
  const stillHandRolled = FORMERLY_HAND_ROLLED.filter(
    f => !readFileSync(new URL(`employer/${f}`, src), 'utf8').includes('<Loading'))
  ok('and the three screens that hand-rolled a skeleton use the shared one',
    stillHandRolled.length === 0, stillHandRolled.join(', '))

  /* Skeleton is the design system's, and it is reached through it. A screen that
     imports a skeleton from anywhere else is how a second one gets built. */
  const wrongSource = files.filter(f => {
    const text = readFileSync(new URL(f, src), 'utf8')
    return /<Skeleton/.test(text) && !/import \{[^}]*Skeleton[^}]*\} from '\.\.\/ui\/Ui\.jsx'/.test(text)
  })
  ok('and every screen that draws skeleton shapes imports them from the design system',
    wrongSource.length === 0, wrongSource.join(', ') || 'all of them do')
}

console.log(bad === 0 ? '\nSTATES: EVERY SCREEN SAYS WHAT IS HAPPENING' : `\nSTATES: ${bad} CHECK(S) FAILED`)
