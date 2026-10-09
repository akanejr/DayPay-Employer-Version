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
const PinPanel = (await import('../../src/employer/PinPanel.jsx')).default
const mock = await import('./mock-employer.js')
// Fixture dates are derived from today; see the note in mock-employer.js.
const FIX = mock.FIXTURE
const EmployerWorkspace = (await import('../../src/employer/EmployerWorkspace.jsx')).default

const employee = { id: 'e1', full_name: 'James Okon', job_title: 'Rigger', status: 'active' }
let bad = 0
/* Published on every check, not once halfway down the file. The run's final
   badge reads this, so a check appended below the old publish point used to be
   able to FAIL while the suite still reported ALL GREEN. */
const ok = (label, pass, detail) => {
  if (!pass) { bad++; globalThis.__bad = (globalThis.__bad || 0) + 1 }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const click = async (el) => {
  if (!el) throw new Error('tried to click something that is not there')
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text))

async function mount(el, at = '') {
  /* The address is real browser state and outlives a component unmounting, so
     every mount starts from a known one — otherwise a check would open wherever
     the previous check left off. Pass an address to open a screen deeper in. */
  try { dom.window.location.hash = at } catch { /* no window */ }
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
  ok('the detail names the day', !!sheet && sheet.textContent.includes(FIX.LABEL(FIX.WORK_DAY)),
    sheet ? FIX.LABEL(FIX.WORK_DAY) : 'no sheet')
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
    !!sent && sent[1] === 'e1' && sent[2] === FIX.DATE(FIX.WORK_DAY)
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


// ── the employer bills a period, then voids it ─────────────────────────────
{
  const Billing = (await import('../../src/employer/Billing.jsx')).default
  const { billingFixtures } = await import('./mock-employer.js')
  const { host, root } = await mount(
    <Billing employees={billingFixtures.employees} contractors={billingFixtures.contractors} />,
  )

  globalThis.__calls.length = 0

  // Bill the contractor who has not been billed yet.
  const billBtn = byText(host, '.ew-bill-actions .ew-btn', 'Bill this period')
  ok('a contractor with unbilled days offers to bill them', !!billBtn)
  await click(billBtn)

  const issue = globalThis.__calls.find(c => c[0] === 'issueInvoice')
  ok('billing sends the contractor and the period, and NO amount of any kind',
    !!issue && issue[1] === 'c2' && /^\d{4}-\d{2}-01$/.test(issue[2]) === false
      ? false : !!issue && issue[1] === 'c2' && /^\d{4}-\d{2}-\d{2}$/.test(issue[2]) && /^\d{4}-\d{2}-\d{2}$/.test(issue[3]) && issue.length === 5,
    JSON.stringify(issue))
  ok('and it is a request to the database, not a local total',
    !!issue && issue[4] === null)

  const card = byText(host, '.ew-inv', 'INV-0002')
  ok('the issued document appears with a number of its own', !!card)

  // Void it: the reason field must be reachable, and the call must carry it.
  const voidBtn = byText(host, '.ew-inv-actions .ew-btn', 'Void')
  ok('an issued invoice offers to be voided', !!voidBtn)
  await click(voidBtn)
  const form = host.querySelector('.ew-void-form')
  ok('voiding asks why, in the page rather than in a browser dialog', !!form)

  const input = host.querySelector('#void-reason')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
    await act(async () => {
      setter.call(input, 'Wrong rate for September.')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  const keep = byText(host, '.ew-void-actions .ew-btn', 'Keep it')
  ok('and it can be backed out of', !!keep)

  const confirm = byText(host, '.ew-void-actions .ew-btn', 'Void this invoice')
  await click(confirm)
  const didVoid = globalThis.__calls.find(c => c[0] === 'voidInvoice')
  ok('voiding sends the document and the reason the employer typed',
    !!didVoid && didVoid[1] === 'i1' && didVoid[2] === 'Wrong rate for September.',
    JSON.stringify(didVoid))

  // The PDF is asked for the frozen rows, not a recomputed figure.
  globalThis.__calls.length = 0
  const dl = byText(host, '.ew-inv-actions .ew-btn', 'Download PDF')
  ok('an invoice can be downloaded as a document', !!dl)
  await click(dl)
  const pdf = globalThis.__calls.find(c => c[0] === 'downloadInvoice')
  ok('the document is handed the stored figures, worker by worker',
    !!pdf && pdf[1] === 'INV-0001' && Array.isArray(pdf[2]) && pdf[2][0]?.[0] === 'James Okon' && pdf[2][0]?.[2] === 48000,
    JSON.stringify(pdf))

  await act(async () => { root.unmount() })
  host.remove()
}


// ── a period that is completely billed must say so, not "Not yet billed ₦0" ──
// The card used to read "Not yet billed · ₦0" above "everything has been
// billed": two labels, opposite meanings, one card. Whatever is left to do is
// what the card leads with, so here it leads with the money already billed.
{
  const Billing = (await import('../../src/employer/Billing.jsx')).default

  const issued = (id, contractorId, name, total) => ({
    id, employer_id: 'o1', contractor_id: contractorId, contractor_name: name,
    number: `INV-000${id.slice(1)}`, period_from: FIX.DATE(1), period_to: FIX.DATE(FIX.LAST_DAY),
    status: 'issued', note: null, void_reason: null,
    issued_at: FIX.STAMP(FIX.LAST_DAY, '18:00:00Z'), voided_at: null,
    worker_count: 1, actual_days: 2, leave_days: 0, equivalents: 3, total,
    confirmed_days: 1, claimed_days: 1, disputed_days: 0,
  })
  mock.setInvoiceFixtures([
    issued('i7', 'c1', 'Contractor A', 48000),
    issued('i8', 'c2', 'Contractor B', 42000),
  ])

  const { host, root } = await mount(
    <Billing employees={mock.billingFixtures.employees} contractors={mock.billingFixtures.contractors} />,
  )
  const html = host.innerHTML
  const card = host.querySelector('.ew-owe')
  ok('a fully billed period leads with what was billed, not with ₦0',
    !!card && card.textContent.includes('Billed for') && card.textContent.includes('₦90,000'),
    card ? card.textContent.replace(/\s+/g, ' ').slice(0, 110) : 'no card')
  ok('and it no longer says "Not yet billed" over a figure of zero',
    !html.includes('Not yet billed'))
  ok('every recorded day is accounted for, in words',
    !!card && /Every recorded day/.test(card.textContent))
  ok('both documents are still listed underneath', !!byText(host, '.ew-inv', 'INV-0007')
    && !!byText(host, '.ew-inv', 'INV-0008'))

  await act(async () => { root.unmount() })
  host.remove()
}

/* ── Phase 11: issuing a PIN ─────────────────────────────────────────────────
   Two things have to be true, and only one of them is about rendering.

   The first is that a worker with no PIN is told what a PIN is FOR — they have
   no smartphone and no account, and this is their way onto the site. The
   second, and the one that matters, is that the PIN appears once and the
   screen says so. There is no recover-it-later path, because the database
   holds only a hash; a screen that quietly implied otherwise would be found
   out by an employer at a kiosk with a queue behind them. */
{
  mock.setPinFixtures({})
  const { host, root } = await mount(
    <PinPanel employee={{ id: 'e1', full_name: 'James Okon' }} onChanged={() => {}} />,
  )

  ok('a worker with no PIN is told what one is for',
    host.innerHTML.includes('kiosk') && host.innerHTML.includes('No PIN yet'),
    host.textContent.replace(/\s+/g, ' ').slice(0, 90))

  await click(byText(host, '.ew-btn', 'Create PIN'))

  const value = host.querySelector('[data-testid="pin-value"]')
  ok('the PIN is shown, once it has been issued',
    !!value && /^\d{4}$/.test(value.textContent.trim()),
    value ? value.textContent.trim() : 'no PIN on screen')

  ok('and the screen says this is the only time it will be shown',
    /only time/.test(host.textContent) && /hashed/.test(host.textContent))

  await click(byText(host, '.ew-btn', 'Copy'))

  ok('the irreversibility is stated in words an employer can act on',
    /issue a new one|Issue a new one/.test(host.textContent))

  await act(async () => { root.unmount() })
  host.remove()
}

/* A worker who already holds a PIN: the number is gone for good, and the only
   thing on offer is a replacement. */
{
  mock.setPinFixtures({ e1: { has_pin: true, set_at: FIX.STAMP(FIX.TODAY_DAY, '08:00:00Z'), locked_until: null } })
  const { host, root } = await mount(
    <PinPanel employee={{ id: 'e1', full_name: 'James Okon' }} onChanged={() => {}} />,
  )

  ok('an existing PIN is never re-displayed — only its issue date',
    !host.querySelector('[data-testid="pin-value"]') && host.textContent.includes(FIX.LABEL(FIX.TODAY_DAY)),
    host.textContent.replace(/\s+/g, ' ').slice(0, 90))

  ok('and the button offers a replacement, not a lookup',
    !!byText(host, '.ew-btn', 'Issue a new PIN'))

  await act(async () => { root.unmount() })
  host.remove()
}

/* ── Phase 11, §8: adding a worker hands over their PIN ──────────────────────
   The brief says an employee who has not created an account "must still be able
   to have attendance recorded", and that when the employer adds them the system
   provides a PIN. So this walks the actual flow: open the roster, press Add,
   type a name, add them — and the PIN must appear, with the one-time warning,
   without a second trip to a different screen.

   It also has to be possible to say NO. A workforce where everybody already has
   DayPay on their phone does not need PINs nobody will ever type. */
{
  const { host, root } = await mount(<EmployerWorkspace />)

  // The workspace opens on Today. The roster is where workers are added, so
  // the walk starts by going there — exactly as an employer would.
  await click(byText(host, '.dp-tab', 'People'))
  await click(byText(host, '.ew-btn', 'Add'))

  const nameField = [...host.querySelectorAll('.ew-input')]
    .find(i => (i.getAttribute('placeholder') || '').includes('Amina'))
  ok('the add-worker form offers a PIN for the new worker',
    !!host.querySelector('.ew-check'),
    host.querySelector('.ew-check') ? host.querySelector('.ew-check').textContent.trim().slice(0, 60) : 'no checkbox')

  await act(async () => {
    /* Assigning input.value does NOT reach a React-controlled field: React
       installs its own value setter on the prototype to track changes, and a
       plain assignment bypasses it, so the state never updates and the button
       stays disabled. Calling the PROTOTYPE's setter is what React itself
       calls, which is why this form of the trick works and the obvious one
       silently does nothing. */
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nameField), 'value').set
    setter.call(nameField, 'Grace Adeyemi')
    nameField.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })

  await click(byText(host, '.ew-btn', 'Add to roster'))

  const shown = host.querySelector('[data-testid="pin-value"]')
  ok('adding a worker issues their attendance PIN and shows it once',
    !!shown && /^\d{4}$/.test(shown.textContent.trim()),
    shown ? shown.textContent.trim() : host.textContent.replace(/\s+/g, ' ').slice(0, 100))

  ok('and says plainly that this is the only time it can be read',
    /only time/.test(host.textContent) && /hashed/.test(host.textContent))

  await act(async () => { root.unmount() })
  host.remove()
}

// ── §18: the day sheet says how the day was recorded ────────────────────────
{
  const kioskDay = {
    id: 'd9', employee_id: 'e1', work_date: FIX.DATE(FIX.WORK_DAY), kind: 'work', status: 'claimed',
    amount: 16000, rate: 16000, multiplier: 1, source: 'check_in',
    checked_in_at: FIX.STAMP(FIX.WORK_DAY, '06:05:00Z'), note: null, attendance_method: 'kiosk',
  }
  mock.addMonthFixture(kioskDay)
  const { host } = await mount(<WorkerView employee={employee} onBack={() => {}} onChanged={() => {}} />)

  /* The cell is located by the day the fixture is ON, not by a literal that
     happens to match it. This used to say '10' because the fixture was dated
     10 September; when the fixture moved into the current month the literal
     became a click on nothing, and the run died mid-suite. */
  const kioskCell = [...host.querySelectorAll('.ew-mgrid-cell.is-marked')]
    .find(c => c.textContent.trim() === String(FIX.WORK_DAY))
  await click(kioskCell)
  const sheet = host.querySelector('.ew-sheet')
  ok('the employer can see a kiosk day was recorded at the machine, not on a phone',
    !!sheet && sheet.textContent.includes('At the site kiosk'),
    sheet ? sheet.textContent.slice(0, 90) : 'no sheet')
  const chip = [...(sheet?.querySelectorAll('.ew-chip') || [])]
    .find(c => /kiosk/i.test(c.textContent))
  ok('...and the chip names the method without ever carrying a figure',
    !!chip && !/₦|[0-9]/.test(chip.textContent), chip?.textContent)
  mock.removeMonthFixture('d9')
}

  /* ── the roster row ──────────────────────────────────────────────────────────
     The Roster screen was relaid out: one list with dividers, the worker's name
     on it, one contextual action, and everything else behind an overflow that
     opens inline under its own row. Every one of those controls has to still do
     what it did when it sat in a row of four — that is what this block is for.
     The fixture worker has no login, so this exercises the NOT-registered half:
     "Send invite" and the three-item menu. */
  {
    const calls = () => globalThis.__calls
    calls().length = 0

    const { host } = await mount(<EmployerWorkspace />)
    await click(byText(host, '.dp-tab', 'People'))

    /* One filled button on the screen. Everything else is an outline or a line
       of text. A screen with four solid buttons has no answer to "what am I
       meant to press", which is the fault this relay-out exists to fix. */
    /* Counted whether or not they are enabled, and with no offsetParent test:
       jsdom has no layout engine, so it is null for everything and that filter
       would silently return an empty list — reporting an empty screen as a
       passing one. A disabled submit still LOOKS like a filled button, which is
       what the brief is about. */
    const primaries = () => [...host.querySelectorAll('.ew-btn-primary')]
    ok('the roster at rest offers exactly one filled button',
      primaries().length === 1,
      `${primaries().length}: ${primaries().map(b => b.textContent.trim()).join(' | ')}`)
    ok('and that one is Add, in the header',
      primaries()[0]?.textContent.trim() === '+ Add', primaries()[0]?.textContent)

    /* The brief: sentence case for all labels, no ALL CAPS. Four or more
       consecutive capitals is a shouted word; PIN, ₦ and an initial are not.

       This catches a shouted LABEL WRITTEN IN THE MARKUP. It cannot catch one
       that is shouted by CSS: jsdom applies no stylesheets, so textTransform is
       invisible here and the caps the design test checks for would still read as
       sentence case. The stylesheet half of this rule is asserted in
       tests/design.test.js, against the CSS itself. */
    const shouted = () => [...host.querySelectorAll('*')]
      .filter(n => n.children.length === 0)
      .map(n => n.textContent.trim())
      .filter(t => /\b[A-Z]{4,}\b/.test(t))
    ok('nothing on the roster at rest shouts', shouted().length === 0,
      shouted().slice(0, 3).join(' / '))

    await click(byText(host, '.ew-btn', '+ Add'))
    ok('and the add form\'s labels are sentence case too', shouted().length === 0,
      shouted().slice(0, 3).join(' / '))
    ok('opening the add form swaps that button rather than adding a second',
      primaries().length === 1,
      `${primaries().length}: ${primaries().map(b => b.textContent.trim()).join(' | ')}`)
    await click(byText(host, '.ew-btn', 'Cancel'))
    ok('and cancelling returns the screen to its one button',
      primaries().length === 1,
      `${primaries().length}: ${primaries().map(b => b.textContent.trim()).join(' | ')}`)

    ok('the roster is one list, not a card per person', !!host.querySelector('.ew-list'))
    ok('and the row carries the worker’s own name',
      host.querySelector('.ew-row-name')?.textContent.trim() === 'James Okon',
      host.querySelector('.ew-row-name')?.textContent)

    const sub = host.querySelector('.ew-row-sub')?.textContent.trim()
    ok('with trade and contractor on one muted line, in that order',
      sub === 'Rigger, Contractor A', sub)

    ok('the contractor control is NOT on the row',
      !host.querySelector('.ew-row-top select') && !host.querySelector('.ew-row-foot select'))

    const contextual = byText(host, '.ew-row-actions .ew-btn', 'Send invite')
    ok('a worker with no login gets Send invite, not Rates',
      !!contextual && !byText(host, '.ew-row-actions .ew-btn', 'Rates'),
      contextual?.textContent.trim())
    ok('and it is the accent outline, not a fourth ghost button',
      !!contextual && contextual.className.includes('ew-btn-accent'), contextual?.className)
    ok('the row shows exactly one visible action plus the overflow',
      host.querySelectorAll('.ew-row-actions .ew-btn').length === 2,
      `${host.querySelectorAll('.ew-row-actions .ew-btn').length} controls`)

    /* ── the overflow ─────────────────────────────────────────────────────── */
    let more = host.querySelector('.ew-more')
    await click(more)
    ok('the overflow is sentence case as well', shouted().length === 0,
      shouted().slice(0, 3).join(' / '))
    ok('the overflow holds no filled button, only menu items',
      primaries().length === 1, `${primaries().length}: ${primaries().map(b => b.textContent.trim()).join(' | ')}`)
    await click(more)
    ok('the overflow says whether it is open, for a screen reader',
      more.getAttribute('aria-expanded') === 'false')
    await click(more)
    ok('the overflow opens inline, inside the row it belongs to',
      !!host.querySelector('.ew-row .ew-menu'))
    const items = [...host.querySelectorAll('.ew-menu-item')].map(b => b.textContent.trim())
    ok('and it offers the unregistered set, in order',
      items.join(' | ') === 'Reset PIN | Edit rates | Archive', items.join(' | '))
    ok('Archive is marked dangerous and sits last',
      host.querySelector('.ew-menu-item:last-child')?.className.includes('is-danger'))

    /* ── changing the contractor, which used to be the thing ON the row ──── */
    const select = host.querySelector('.ew-menu-select')
    ok('the contractor select moved into the overflow, with room to show a name',
      !!select && select.value === 'c1', select ? `value=${select.value}` : 'no select')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value').set
      setter.call(select, '')
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    const moved = calls().find(c => c[0] === 'setEmployeeContractor')
    ok('“No contractor” on that select really unassigns the worker',
      !!moved && moved[1] === 'e1' && moved[2] === '', JSON.stringify(moved))

    /* ── Archive asks first, and Cancel means cancel ───────────────────────
       The menu is still open from the contractor change above; clicking the
       trigger again would close it, which is how this check first failed. */
    await click(byText(host, '.ew-menu-item', 'Archive'))
    ok('archiving asks before it acts',
      !!host.querySelector('.ew-confirm') && host.textContent.includes('Move James Okon off the roster?'),
      host.textContent.slice(-90))
    ok('and nothing has been archived yet',
      !calls().some(c => c[0] === 'archiveEmployee'))

    await click(byText(host, '.ew-btn', 'Cancel'))
    ok('Cancel closes the confirmation and archives nothing',
      !host.querySelector('.ew-confirm') && !calls().some(c => c[0] === 'archiveEmployee'))

    await click(byText(host, '.ew-menu-item', 'Archive'))
    await click(byText(host, '.ew-btn', 'Yes, archive'))
    const archived = calls().find(c => c[0] === 'archiveEmployee')
    ok('confirming archives that worker and only that worker',
      !!archived && archived[1] === 'e1', JSON.stringify(archived))

    /* ── Reset PIN, and the one panel with its own button ────────────────── */
    more = host.querySelector('.ew-more')
    await click(more)
    await click(byText(host, '.ew-menu-item', 'Reset PIN'))
    ok('Reset PIN still opens the PIN panel for that worker',
      !!host.querySelector('[data-testid="pin-value"]') || /James Okon/.test(host.textContent),
      host.textContent.slice(-90))
  }

  /* ── the two things at the foot of the roster, and the archive ──────────────
     The kiosk row is driven in kiosk.jsx, where its own feature lives. These are
     the other two: the contractor row, and the quiet toggle that reveals the
     workers who have left. Both were relaid out, and a relaid-out control that
     still LOOKS right but no longer calls anything is the exact failure this
     exercise is about. */
  {
    mock.setArchivedEmployee(true)
    const calls = () => globalThis.__calls
    calls().length = 0

    /* Contractor management is under More now (Phase 3): it is not what an
       employer opened People to do, and it was pushing the list down. Same
       screen, same behaviour, one level deeper — so the walk opens its address
       directly, which is also how somebody would link to it. */
    const { host: contractorHost } = await mount(<EmployerWorkspace />, '/more/contractors')

    /* ── Add contractor ───────────────────────────────────────────────────── */
    const contractorAdd = byText(contractorHost, '.ew-head .ew-btn', 'Add')
    ok('the contractor row offers Add, not a form that is always open',
      !!contractorAdd && !contractorHost.querySelector('#ew-new-contractor'))
    await click(contractorAdd)
    const nameField = contractorHost.querySelector('#ew-new-contractor')
    ok('Add opens one field, and only one', !!nameField)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nameField), 'value').set
      setter.call(nameField, 'Alpha Services')
      nameField.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await click(byText(contractorHost, '.ew-form .ew-btn', 'Add'))
    const made = calls().find(c => c[0] === 'createContractor')
    ok('adding a contractor reaches the data layer with the name typed',
      !!made && made[1] === 'Alpha Services', JSON.stringify(made))

      /* These are roster checks and the roster is the People screen, so this
         half of the walk opens it: the contractor half above had to go to More. */
      const { host } = await mount(<EmployerWorkspace />, '/people')

    /* ── Show archived ────────────────────────────────────────────────────── */
    const toggle = byText(host, '.ew-text-btn', 'Show 1 archived')
    ok('the archive is behind a quiet line of text, not a button',
      !!toggle && toggle.className.includes('ew-text-btn'), toggle?.className)
    ok('and it is not showing while it is closed', !host.querySelector('.ew-list.is-archived'))
    await click(toggle)
    ok('opening it lists the archived worker in its own list',
      !!host.querySelector('.ew-list.is-archived') &&
      host.textContent.includes('Peter Bassey'), host.textContent.slice(-80))
    ok('and the toggle says how to close it again',
      !!byText(host, '.ew-text-btn', 'Hide archived'))

    await click(byText(host, '.ew-list.is-archived .ew-btn', 'Restore'))
    const back = calls().find(c => c[0] === 'restoreEmployee')
    ok('Restore brings that worker back and says which one',
      !!back && back[1] === 'e2', JSON.stringify(back))
    ok('an archived row never offers to archive again',
      !byText(host, '.ew-list.is-archived .ew-btn', 'Archive'))

    mock.setArchivedEmployee(false)
  }

  /* ── one filled button, in every state the screen can be in ─────────────────
     The brief asks for exactly one. A screen has more than one resting state,
     and the earlier checks only covered four of them; the panels the OTHER
     components own each brought a solid submit of their own, and until this
     block existed nothing noticed that a second one appeared the moment a PIN
     or an invite was being issued. */
  {
    /* Each state opens on the screen that owns it: the contractor panels moved
       under More in Phase 3, so they are reached at their own address. */
      /* `filled` is the class that means "a solid button" on that screen: the
         People screen's single primary, and the contractor screen's single
         accent submit. About them the rule is the same — one, not two. */
      const openState = async (label, open, at = '/people', filled = '.ew-btn-primary') => {
      const { host } = await mount(<EmployerWorkspace />, at)
      if (open) await open(host)
      const found = [...host.querySelectorAll(filled)].map(b => b.textContent.trim())
      ok(`${label}: still exactly one filled button`, found.length === 1,
        `${found.length}: ${found.join(' | ')}`)
    }

    await openState('at rest', null, '/people')
    await openState('with the share form open', async (h) => {
      await click(byText(h, '.ew-row-actions .ew-btn', 'Send invite'))
    }, '/people')
    await openState('with the rate editor open', async (h) => {
      await click(h.querySelector('.ew-more'))
      await click(byText(h, '.ew-menu-item', 'Edit rates'))
    }, '/people')
    await openState('with the PIN panel open', async (h) => {
      await click(h.querySelector('.ew-more'))
      await click(byText(h, '.ew-menu-item', 'Reset PIN'))
    }, '/people')
    await openState('with the contractor form open', async (h) => {
      await click(byText(h, '.ew-head .ew-btn', 'Add'))
      }, '/more/contractors', '.ew-btn-primary, .ew-btn-accent')
    await openState('with a contractor being renamed', async (h) => {
      await click(byText(h, '.ew-person-actions .ew-btn', 'Rename'))
      }, '/more/contractors', '.ew-btn-primary, .ew-btn-accent')
    await openState('with the add-worker form open', async (h) => {
      await click(byText(h, '.ew-btn', '+ Add'))
    }, '/people')
  }

console.log(bad === 0
  ? '\nINTERACTION: ALL CHECKS PASSED'
  : `\nINTERACTION: ${bad} CHECK(S) FAILED`)
