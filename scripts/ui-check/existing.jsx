/* The screens that existed BEFORE Phase 6, rendered with the same real pure
   logic. Phase 6 touched EmployeeView, ContractorView and Dashboard, and the
   standing rule is that nothing that already worked may stop working — so the
   whole workspace is mounted here, not just the new parts. */
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
const EmployerWorkspace = (await import('../../src/employer/EmployerWorkspace.jsx')).default
const StaffDays = (await import('../../src/employer/StaffDays.jsx')).default
const Summary = (await import('../../src/employer/Summary.jsx')).default
const AttendancePanel = (await import('../../src/employer/AttendancePanel.jsx')).default
const CheckIn = (await import('../../src/employer/CheckIn.jsx')).default

let bad = 0
const must = (label, html, needles) => {
  const missing = needles.filter(n => !html.includes(n))
  const faults = polishProblems(html)
  if (missing.length) { bad++; console.log(`  FAIL  ${label} — missing: ${missing.join(' | ')}`) }
  else if (faults.length) { bad++; console.log(`  FAIL  ${label} — polish: ${faults.join(' | ')}`) }
  else console.log(`  PASS  ${label} (${html.length} chars)`)
}

async function mount(label, el, needles, tabIndex = null) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await act(async () => { await new Promise(r => setTimeout(r, 25)) })
  if (tabIndex !== null) {
    const tabs = host.querySelectorAll('.ew-subtab')
    if (!tabs[tabIndex]) { bad++; console.log(`  FAIL  ${label} — no tab ${tabIndex} of ${tabs.length}`) }
    else {
      await act(async () => { tabs[tabIndex].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
      await act(async () => { await new Promise(r => setTimeout(r, 25)) })
    }
  }
  must(label, host.innerHTML, needles)
  await act(async () => { root.unmount() })
  host.remove()
}

const employee = {
  id: 'e1', full_name: 'James Okon', job_title: 'Rigger', status: 'active',
  contractor_id: 'c1', employer_id: 'o1', employee_user_id: null, email: null,
}

// the whole staff workspace, every sub-tab
await mount('Workspace · Today', <EmployerWorkspace />, ['On roster', 'Today', 'Mark days', 'Summary', 'Roster'])
await mount('Workspace · Mark days', <EmployerWorkspace />, ['ew-dayrow'], 1)
await mount('Workspace · Summary', <EmployerWorkspace />, ['James Okon'], 3)
await mount('Workspace · Roster', <EmployerWorkspace />, ['James Okon', 'Contractor A'], 2)

// the panes on their own
await mount('StaffDays', <StaffDays employees={[employee]} contractors={[]} />, ['James Okon'])

/* ── Two workers with the same name must be tellable apart ─────────────────
   This screen writes attendance into the ledger and used to list people by
   name alone. The owner's roster genuinely contains a James the Welder under
   Topher and a James the Electric under Eddimore, both active, both with days
   that month — which rendered as two identical rows. initials('James') is 'JA'
   for both, so even the avatar matched. Marking the wrong one pays the wrong
   person and lands in the wrong contractor's invoice a month later. */
await mount('Mark days, two workers called James',
  <StaffDays
    employees={[
      { ...employee, id: 'e1', full_name: 'James', job_title: 'Welder', contractor_id: 'c1' },
      { ...employee, id: 'e2', full_name: 'James', job_title: 'Electric', contractor_id: 'c2' },
    ]}
    contractors={[{ id: 'c1', name: 'Topher' }, { id: 'c2', name: 'Eddimore' }]}
  />,
  ['Welder · Topher', 'Electric · Eddimore', 'James'])
await mount('Summary pane', <Summary employees={[employee]} />, ['James Okon'])
await mount('Attendance panel', <AttendancePanel contractors={[{ id: 'c1', name: 'Contractor A', status: 'active' }]} onChanged={() => {}} />, ['Attendance'])
// attendance is not open in these fixtures, so the pane shows its "checking"
// state — the point is that it renders and says something, not what it says
await mount('Check-in (worker)', <CheckIn employee={employee} onRecorded={() => {}} />, ['Attendance'])

/* ── The employee app itself ───────────────────────────────────────────────
   Every other check in this suite covers the employer workspace. The product
   that already existed — the month grid, the payslip, the year view — was
   never mounted anywhere, so a broken import or a crash on the very first
   screen would have passed everything here. It stops at the splash because
   there is no signed-in session in jsdom, which is fine: the point is that the
   root component loads and draws instead of throwing. */
{
  const App = (await import('../../src/App.jsx')).default
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let html = '', failure = null
  try {
    await act(async () => { root.render(<App />) })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    html = host.innerHTML
  } catch (e) { failure = e }
  const problems = failure ? [`threw: ${failure.message}`] : polishProblems(html)
  if (!html.includes('app-root')) problems.push('rendered nothing into the root')
  if (problems.length) { bad++; console.log(`  FAIL  The employee app — ${problems.join(' | ')}`) }
  else console.log(`  PASS  The employee app (${html.length} chars)`)
  await act(async () => { root.unmount() })
  host.remove()
}

console.log(bad === 0 ? '\nEXISTING SCREENS: ALL STILL RENDER' : `\nEXISTING SCREENS: ${bad} CHECK(S) FAILED`)
globalThis.__bad = (globalThis.__bad || 0) + bad
