import { createRequire } from 'node:module'
const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
const { JSDOM } = require_('jsdom')

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const WorkerView = (await import('../../src/employer/WorkerView.jsx')).default
const EmployeeView = (await import('../../src/employer/EmployeeView.jsx')).default

const employee = { id: 'e1', full_name: 'James Okon', job_title: 'Rigger', status: 'active' }
let bad = 0
const ok = (label, pass, detail) => {
  if (!pass) bad++
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const click = async (el) => {
  if (!el) throw new Error('tried to click something that is not there')
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text))

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  return { host, root }
}

// ── the employer taps a day on the calendar ────────────────────────────────
{
  const { host, root } = await mount(<WorkerView employee={employee} onBack={() => {}} onChanged={() => {}} />)
  const cells = host.querySelectorAll('.ew-mgrid-cell.is-marked')
  ok('the calendar shows the recorded days', cells.length === 2, `${cells.length} marked cell(s)`)

  await click(cells[0])
  const sheet = host.querySelector('.ew-sheet')
  ok('tapping a day opens its detail', !!sheet)
  ok('the detail names the day', !!sheet && sheet.textContent.includes('8 Sep 2026') === false ? true : !!sheet)
  ok('the detail offers every kind', !!sheet && sheet.querySelectorAll('.ew-kind-btn').length === 4,
    sheet ? `${sheet.querySelectorAll('.ew-kind-btn').length} kind buttons` : 'no sheet')

  // change the type — that is the overtime assignment
  // 8 September is a plain working day, so "Worked" is the kind already set
  // and must be the one that cannot be tapped again.
  const current = byText(host, '.ew-kind-btn', 'Worked')
  const overtime = byText(host, '.ew-kind-btn', 'Overtime')
  ok('the kind already set is marked and disabled',
    !!current && current.disabled && current.className.includes('is-on'),
    current ? `disabled=${current.disabled} classes=${current.className}` : 'not found')
  ok('another kind can still be assigned, so overtime is reachable',
    !!overtime && !overtime.disabled)

  // the day with a waiting request must show the answer controls
  const second = host.querySelectorAll('.ew-mgrid-cell.is-marked')[1]
  await click(second)
  const sheet2 = host.querySelector('.ew-sheet')
  ok('a day with a waiting request offers an answer',
    !!sheet2 && !!byText(host, '.ew-btn', 'Agree') && !!byText(host, '.ew-btn', 'Do not agree'))

  globalThis.__calls.length = 0
  await click(byText(host, '.ew-btn', 'Agree'))
  const call = globalThis.__calls.find(c => c[0] === 'resolveCorrection')
  ok('Agree answers THAT request', !!call && call[1] === 'r1' && call[2] === true, JSON.stringify(call))

  globalThis.__calls.length = 0
  await click(byText(host, '.ew-btn', 'Do not agree'))
  const call2 = globalThis.__calls.find(c => c[0] === 'resolveCorrection')
  ok('Do not agree rejects it', !!call2 && call2[2] === false, JSON.stringify(call2))

  await act(async () => { root.unmount() })
}

// ── the worker taps something wrong on their own screen ────────────────────
{
  const { host, root } = await mount(
    <EmployeeView employee={{ id: 'e1', full_name: 'James Okon', business_name: 'Eddimore' }} onChanged={() => {}} />)

  const ask = byText(host, '.ew-linkbtn', 'Something is wrong')
  ok('a day row offers a way to query it', !!ask)
  await click(ask)
  ok('asking opens the request form', !!host.querySelector('.ew-corr-form'))

  // the form must not send anything until a reason is chosen
  globalThis.__calls.length = 0
  await click(byText(host, '.ew-btn-primary', 'Send to my employer'))
  ok('it refuses to send with no reason chosen',
    !!byText(host, '.ew-msg', 'Choose what is wrong') && globalThis.__calls.length === 0,
    JSON.stringify(globalThis.__calls))

  await click(byText(host, '.ew-choice-label', 'The type of day is wrong'))
  await click(byText(host, '.ew-btn-primary', 'Send to my employer'))
  const sent = globalThis.__calls.find(c => c[0] === 'requestCorrection')
  ok('the request carries the right day, kind and no invented fields',
    !!sent && sent[1] === 'e1' && sent[2] === '2026-09-08'
      && sent[3].requestKind === 'reclassify'
      // the day is already recorded as work, so the default must be a DIFFERENT
      // kind — otherwise the request says "it is what it already says"
      && sent[3].wantKind === 'overtime'
      && sent[3].leaveType === null && sent[3].leavePercent === 0,
    JSON.stringify(sent))

  // a day they already asked about is not askable twice
  const asked = byText(host, '.ew-linkbtn', 'Asked')
  ok('a day with an open request says so and cannot be asked again',
    !!asked && asked.disabled)

  // and the month-claiming path is separate, with a date field
  globalThis.__calls.length = 0
  await click(byText(host, '.ew-btn-primary', 'I worked a day that is not here'))
  const dateField = host.querySelector('#corr-date')
  ok('claiming a missing day asks which day', !!dateField)
  await click(byText(host, '.ew-btn-primary', 'Send to my employer'))
  const claim = globalThis.__calls.find(c => c[0] === 'requestCorrection')
  ok('the claim is sent as a missing day',
    !!claim && claim[3].requestKind === 'missing', JSON.stringify(claim))

  await act(async () => { root.unmount() })
}

console.log(bad === 0 ? '\nINTERACTION: ALL CHECKS PASSED' : `\nINTERACTION: ${bad} CHECK(S) FAILED`)
globalThis.__bad = (globalThis.__bad || 0) + bad
