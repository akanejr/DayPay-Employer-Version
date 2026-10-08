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
const AccountChoice = (await import('../../src/AccountChoice.jsx')).default

let bad = 0
const must = (label, html, needles) => {
  const missing = needles.filter(n => !html.includes(n))
  const faults = polishProblems(html)
  if (missing.length) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1; console.log(`  FAIL  ${label} — missing: ${missing.join(' | ')}`) }
  else if (faults.length) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1; console.log(`  FAIL  ${label} — polish: ${faults.join(' | ')}`) }
  else console.log(`  PASS  ${label} (${html.length} chars)`)
}

/* `at` is either an address to open the screen at — '/people', '/more/billing' —
   or a number, meaning "tap the nth tab once it has rendered". Addresses are
   what Phase 3 added, so the checks use them: a screen that cannot be reached by
   its own address is a screen you cannot link to, and this is where that shows. */
async function mount(label, el, needles, at = null) {
  /* Every mount starts from home. The address is real browser state and it
     survives a component unmounting, so without this a later check would
     silently open wherever the previous one left off. */
  try { dom.window.location.hash = '' } catch { /* no window — nothing to reset */ }
  if (typeof at === 'string' && at) dom.window.location.hash = at
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await act(async () => { await new Promise(r => setTimeout(r, 25)) })
  if (typeof at === 'number') {
    const tabs = host.querySelectorAll('.dp-tab')
    if (!tabs[at]) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1; console.log(`  FAIL  ${label} — no tab ${at} of ${tabs.length}`) }
    else {
      await act(async () => { tabs[at].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
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
/* Phase 4 moved Today's numbers into the screen itself — one progress figure
   instead of four cards — so 'On roster' is no longer on this pane, deliberately.
   What must still be here is the place itself: its title and its four doors. */
await mount('Workspace · Today', <EmployerWorkspace />, ['Today', 'Attendance', 'People', 'More'])
/* Phase 5 rebuilt this screen; its rows are `.ew-att-row` now. The guarantee is
   unchanged — the Attendance pane draws the people a day can be recorded for. */
await mount('Workspace · Attendance', <EmployerWorkspace />, ['Attendance', 'ew-att-row'], '/attendance')
await mount('Workspace · Reports', <EmployerWorkspace />, ['James Okon'], '/more/reports')
/* Phase 10 — §4. The roster must name the account status, and it must name it
   with the words the brief uses. "Not registered" is a fact about a LOGIN:
   the worker still has a job, still has days, and is still paid for them. The
   mock roster entry has employee_user_id = null, so this is the not-registered
   case — the one that used to be silent. */
await mount('Workspace · People', <EmployerWorkspace />, ['James Okon', 'Contractor A', 'Not registered'], '/people')

// the panes on their own
await mount('StaffDays', <StaffDays employees={[employee]} contractors={[]} />, ['James Okon'])

/* Phase 10 — the sign-up choice. Both roles must be offered, and each must say
   what it is for: this is the only screen a new account is guaranteed to read,
   and the place where an employer must NOT be shown an invite-code box and a
   worker must not be asked for a business name. */
await mount('Choose account type', <AccountChoice onChoose={() => {}} />,
  ['Employer', 'Employee', 'invite code'])

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
    /* The splash is an OVERLAY, not a replacement — the tracker is drawn
       underneath it, which is why this can assert the real month view without
       waiting five seconds for the splash to lift. Until now only 'app-root'
       was checked, so the month grid, the segmented control and the settings
       page could all have been blank. */
    const landmarks = ['.month-title', '.month-name', '.segmented', '.nav-btn', '.cell']
    const missing = landmarks.filter(sel => !host.querySelector(sel))
    problems.push(...missing.map(sel => `the month view has no ${sel}`))
  if (problems.length) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1; console.log(`  FAIL  The employee app — ${problems.join(' | ')}`) }
  else console.log(`  PASS  The employee app (${html.length} chars)`)
  await act(async () => { root.unmount() })
  host.remove()
}

console.log(bad === 0 ? '\nEXISTING SCREENS: ALL STILL RENDER' : `\nEXISTING SCREENS: ${bad} CHECK(S) FAILED`)
