/* A real mount, in a DOM, with the effects running. SSR only shows a
   component's loading state — which for WorkerView is one line of text — so
   the calendar, the corrections queue and the audit trail were never
   exercised. This is the check that catches a blank pane. */
import { createRequire } from 'node:module'
const require_ = createRequire(new URL('../../node_modules/', import.meta.url))
const { JSDOM } = require_('jsdom')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
// node 22's global.navigator is getter-only, so it has to be defined
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')

const WorkerView = (await import('../../src/employer/WorkerView.jsx')).default
const EmployeeView = (await import('../../src/employer/EmployeeView.jsx')).default
const ContractorView = (await import('../../src/employer/ContractorView.jsx')).default

const employee = { id: 'e1', full_name: 'James Okon', job_title: 'Rigger', status: 'active' }
let bad = 0

const must = (label, html, needles) => {
  const missing = needles.filter(n => !html.includes(n))
  if (missing.length) { bad++; console.log(`  FAIL  ${label} — missing: ${missing.join(' | ')}`) }
  else console.log(`  PASS  ${label} (${html.length} chars)`)
}

async function mount(label, el, needles, tabIndex = null) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  // let the data promises settle, then let React commit the result
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })

  if (tabIndex !== null) {
    const tabs = host.querySelectorAll('.ew-subtab')
    if (!tabs[tabIndex]) { bad++; console.log(`  FAIL  ${label} — no tab at index ${tabIndex} (has ${tabs.length})`) }
    else {
      await act(async () => {
        tabs[tabIndex].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    }
  }

  must(label, host.innerHTML, needles)
  await act(async () => { root.unmount() })
  host.remove()
}

// the worker's own screen, loaded
await mount('My work, loaded month',
  <EmployeeView employee={{ id: 'e1', full_name: 'James Okon', business_name: 'Eddimore' }} onChanged={() => {}} />,
  ['ew-mgrid', 'I worked a day that is not here'])

// the employer's worker detail, calendar tab
await mount('Worker detail, calendar',
  <WorkerView employee={employee} onBack={() => {}} onChanged={() => {}} />,
  ['ew-mgrid', 'ew-summary', 'Corrections'])

// the employer's worker detail, corrections tab, then history tab
await mount('Worker detail, corrections queue',
  <WorkerView employee={employee} onBack={() => {}} onChanged={() => {}} />,
  ['Says this was overtime', 'Agree', 'Do not agree'], 1)

await mount('Worker detail, history (audit trail)',
  <WorkerView employee={employee} onBack={() => {}} onChanged={() => {}} />,
  ['Day recorded', 'Day changed', 'Confirmed'], 2)

// the contractor's worker list, whose cards now open the detail
await mount('Contractor worker list',
  <ContractorView contractor={{ id: 'c1', name: 'Contractor A' }}
    employees={[{ ...employee, contractor_id: 'c1' }]} days={[]} onBack={() => {}} />,
  ['James Okon', 'Day by day'])

// the billing pane, loaded: one contractor already billed, one still to bill
const Billing = (await import('../../src/employer/Billing.jsx')).default
const { billingFixtures } = await import('./mock-employer.js')

await mount('Billing, loaded period',
  <Billing employees={billingFixtures.employees} contractors={billingFixtures.contractors} />,
  ['Not yet billed', 'Ready to bill', 'Contractor B', 'Bill this period',
    'Already billed for this period', 'INV-0001', '₦42,000'])

/* No process.exit here: the interaction pass runs after this file in the same
   bundle, so failures are accumulated and reported once, at the end. */
globalThis.__bad = (globalThis.__bad || 0) + bad
console.log(bad === 0 ? '\nCLIENT RENDER: EVERY SCREEN MOUNTED AND FILLED' : `\nCLIENT RENDER: ${bad} CHECK(S) FAILED`)
