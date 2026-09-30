/* The Site Attendance machine, driven the way a worker drives it.
 *
 * A real Kiosk component, in a real DOM, pressing real buttons in the order a
 * person at a gate would: sign in once, link once, then contractor → name →
 * PIN → site code → answer. The network is the only fake, so everything that
 * decides what appears on the screen — the step machine, the masking, the
 * auto-advance, the wording of three different outcomes — is the shipping code.
 *
 * Two things are checked here that cannot be checked anywhere else:
 *   · that the machine never renders a blank or misleading pane, at any step,
 *     including when the server refuses;
 *   · that the kiosk calls exactly three functions and no employer table, which
 *     is §20 measured rather than promised.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

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
const Kiosk = (await import('../../src/kiosk/Kiosk.jsx')).default
const DevicePanel = (await import('../../src/employer/DevicePanel.jsx')).default
const kioskLib = await import('../../src/lib/kiosk.js')
const client = await import('./mock-supabase.js')

const ok = (label, pass, detail) => {
  if (!pass) globalThis.__bad = (globalThis.__bad || 0) + 1
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`)
}

const flush = async (ms = 25) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)) })
}

const click = async (el, settle = 30) => {
  if (!el) throw new Error('tried to click something that is not there')
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await flush(settle)
}

const byText = (host, sel, text) =>
  [...host.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text))

/* React listens for the input event and ignores a bare assignment to .value, so
   the native setter has to be reached through the prototype. */
const type = async (el, value) => {
  if (!el) throw new Error('tried to type into something that is not there')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await flush(10)
}

const submit = async (form) => {
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush(50)
}

/* The keypad is re-rendered between steps, so a reference captured on the PIN
   screen is detached by the time the code screen exists. Always look it up
   again — a click on a detached node silently does nothing, which is exactly
   the kind of failure that wastes an afternoon. */
const press = async (host, key) => {
  const el = [...host.querySelectorAll('.ks-key')].find(k => k.textContent.trim() === key)
  await click(el)
}
const pressAll = async (host, digits) => { for (const d of digits) await press(host, d) }

async function mountEl(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await flush(30)
  return { host, root }
}

const mount = () => mountEl(<Kiosk />)

const text = (host) => host.textContent.trim()

/* ── the crew at this gate ───────────────────────────────────────────────── */

const CREW = [
  { id: 'e1', name: 'James Okon', job_title: 'Rigger', contractor_id: 'c1', has_pin: true },
  { id: 'e2', name: 'Peter Smith', job_title: 'Welder', contractor_id: 'c1', has_pin: true },
  { id: 'e3', name: 'Grace Adeyemi', job_title: 'Electrician', contractor_id: 'c1', has_pin: false },
  { id: 'e4', name: 'Monday Udo', job_title: 'Mason', contractor_id: 'c2', has_pin: true },
  { id: 'e5', name: 'Blessing Eze', job_title: 'Painter', contractor_id: 'c2', has_pin: true },
  { id: 'e6', name: 'Friday Bassey', job_title: 'Rigger', contractor_id: 'c2', has_pin: true },
  { id: 'e7', name: 'Samuel Etim', job_title: 'Welder', contractor_id: 'c2', has_pin: true },
  { id: 'e8', name: 'Comfort Nwosu', job_title: null, contractor_id: 'c2', has_pin: true },
  { id: 'e9', name: 'Isaac Dan', job_title: 'Mason', contractor_id: 'c1', has_pin: true },
  { id: 'e10', name: 'Ruth Edet', job_title: 'Painter', contractor_id: 'c1', has_pin: true },
  { id: 'e11', name: 'Emeka Obi', job_title: 'Welder', contractor_id: null, has_pin: true },
  { id: 'e12', name: 'Ngozi Umeh', job_title: 'Steel fixer', contractor_id: 'c1', has_pin: true },
  { id: 'e13', name: 'Tunde Alao', job_title: 'Steel fixer', contractor_id: 'c1', has_pin: true },
  { id: 'e14', name: 'Wale Ojo', job_title: 'Carpenter', contractor_id: 'c1', has_pin: true },
  { id: 'e15', name: 'Ifeoma Nnaji', job_title: 'Carpenter', contractor_id: 'c1', has_pin: true },
  { id: 'e16', name: 'Joseph Ekong', job_title: 'Labourer', contractor_id: 'c1', has_pin: true },
]

const CONTRACTORS = [
  { id: 'c1', name: 'Contractor A' },
  { id: 'c2', name: 'Contractor B' },
]

const roster = () => [{
  business_name: 'Uche Construction Ltd',
  device_label: 'Gate kiosk',
  people: CREW,
  contractors: CONTRACTORS,
}]

/* ── 1. signing in, once ─────────────────────────────────────────────────── */

{
  client.signedOutFixture()
  client.resetCalls()
  client.clearFault()
  const { host } = await mount()

  ok('the machine identifies itself before anything else',
    text(host).includes('DayPay') && text(host).includes('Site Attendance'), text(host).slice(0, 40))
  ok('a signed-out machine asks for a sign-in, not a worker PIN',
    text(host).includes('Sign in on this device') && !!host.querySelector('input[type="email"]'))
  ok('it says this happens once, so nobody thinks they sign in every morning',
    /Once,/i.test(text(host)) && /without signing in/i.test(text(host)))

  await type(host.querySelector('input[type="email"]'), 'gate@site.example')
  await type(host.querySelector('input[type="password"]'), 'not-a-real-password')

  /* An unlinked machine: the roster call refuses with the "not linked"
     sentence, which is the normal state of a fresh kiosk — not an error. */
  client.setFault('P0001', 'This device is not linked to DayPay, or has been signed out. Ask your employer for a new code.')
  await submit(host.querySelector('form'))

  ok('after signing in it asks to be linked, not for a worker',
    text(host).includes('Link this device'), text(host).slice(0, 60))
  ok('signing in really signed in',
    globalThis.__kiosk.user?.email === 'gate@site.example')
  ok('an unlinked machine is not dressed up as a failure',
    !text(host).includes('Something went wrong') && !host.querySelector('.ks-result'))

  /* ── 2. linking, once ──────────────────────────────────────────────────── */

  const input = host.querySelector('.ks-input-code')
  ok('the link box says where the code comes from',
    !!input && /read out a code from their DayPay staff screen/i.test(text(host)))
  ok('the worker is told the machine is signed in as somebody (§4: the employer sees status)',
    text(host).includes('gate@site.example'))

  await type(input, 'abcd2345')
  ok('the code is uppercased as it is typed, because the printed code is',
    input.value === 'ABCD2345', input.value)

  client.clearFault()
  globalThis.__kiosk.reply.claim_attendance_device =
    [{ device_id: 'd1', label: 'Gate kiosk', business_name: 'Uche Construction Ltd' }]
  globalThis.__kiosk.reply.kiosk_roster = roster()

  await submit(host.querySelector('form'))

  const claim = client.calls().find(c => c[0] === 'claim_attendance_device')
  ok('linking calls claim_attendance_device, passing the code under the server’s argument name',
    !!claim && claim[1]?.p_code === 'ABCD2345', JSON.stringify(claim?.[1]))
  ok('and sends nothing else — no employer id, no site, no device id',
    !!claim && Object.keys(claim[1]).length === 1, JSON.stringify(claim?.[1] && Object.keys(claim[1])))

  /* ── 3. the worker's four steps ────────────────────────────────────────── */

  ok('linking leads straight into the first question, with no menu to get lost in',
    text(host).includes('Who are you working for today?'), text(host).slice(0, 70))
  ok('the site names itself, so a worker knows they are at the right machine',
    text(host).includes('Uche Construction Ltd') && text(host).includes('Gate kiosk'))

  /* §20: the kiosk returns no money. Checked on the rendered pixels rather than
     on the function signature — a rates field that is fetched and never drawn
     is still a rates field on a machine standing in a yard. */
  ok('nothing about pay is ever drawn on this screen',
    !/₦|rate|amount|naira|salary|payslip/i.test(text(host)), text(host).slice(0, 80))

  const choices = [...host.querySelectorAll('.ks-btn-choice')]
  ok('every contractor on the site is offered, plus the unassigned bucket',
    choices.length === 3, choices.map(b => b.textContent.trim()).join(' | '))
  ok('the unassigned bucket exists because somebody really is unassigned',
    choices.some(b => b.textContent.includes('No contractor')))

  await click(byText(host, '.ks-btn-choice', 'Contractor A'))
  ok('choosing a contractor shows only that contractor’s crew',
    !!byText(host, '.ks-question', 'Select your name') &&
    text(host).includes('James Okon') && !text(host).includes('Monday Udo'))

  const search = host.querySelector('.ks-search')
  ok('a big crew gets a search box, because queueing to scroll for your name is silly',
    !!search && host.querySelectorAll('.ks-btn-choice').length === 10,
    `${host.querySelectorAll('.ks-btn-choice').length} names`)

  await type(search, 'isaac')
  ok('typing narrows the list to the one name',
    host.querySelectorAll('.ks-btn-choice').length === 1 && text(host).includes('Isaac Dan'))
  await type(search, 'zzzz')
  ok('a search that matches nobody says so instead of quietly showing everybody',
    text(host).includes('No names here') && host.querySelectorAll('.ks-btn-choice').length === 0)
  await type(search, '')

  /* A worker the employer has not issued a PIN to must be told, in words, at
     the first tap — not after typing four digits of nothing. */
  client.resetCalls()
  await click(byText(host, '.ks-btn-choice', 'Grace Adeyemi'))
  ok('a worker with no PIN is told at the tap, not at the keypad',
    text(host).includes('No PIN has been set for you yet'))
  ok('and no check-in is attempted for them at all',
    !client.calls().some(c => c[0] === 'kiosk_check_in'), JSON.stringify(client.calls().map(c => c[0])))
  ok('the answer is drawn as a refusal, which is what it is',
    !!host.querySelector('.ks-result.ks-refused'))

  await click(byText(host, '.ks-btn', 'Done'))
  ok('after an answer the machine returns to the first question by itself',
    text(host).includes('Who are you working for today?'))

  /* ── 4. the PIN, private ───────────────────────────────────────────────── */

  await click(byText(host, '.ks-btn-choice', 'Contractor A'))
  await click(byText(host, '.ks-btn-choice', 'James Okon'))

  ok('the PIN screen names the worker, so a wrong name is visible immediately',
    text(host).includes('Enter your PIN') && text(host).includes('James Okon'))
  ok('the keypad offers all twelve keys',
    host.querySelectorAll('.ks-key').length === 12, `${host.querySelectorAll('.ks-key').length} keys`)

  await press(host, '4')
  await press(host, '8')
  const dots = [...host.querySelectorAll('.ks-dot')].map(e => e.textContent).join('')
  ok('the digits are never drawn — two pressed reads as two masked dots',
    dots === '••··', dots)
  ok('the characters of the PIN appear nowhere on the page',
    !text(host).includes('48'), text(host).slice(0, 70))

  await press(host, '2')
  await press(host, '1')
  await flush(400)                 // the machine advances itself on the fourth digit

  ok('the fourth digit advances without anyone reaching for a Next button',
    /Enter today\S?s site code/.test(text(host)), text(host).slice(0, 80))
  ok('the site code panel starts empty, so a mistyped digit is obvious',
    [...host.querySelectorAll('.ks-slot')].map(e => e.textContent).join('') === '····')
  ok('the site code is shown as it is typed, unlike the PIN',
    /four digits on display at the gate/i.test(text(host)))

  /* ── 5. the site code, and the answer ──────────────────────────────────── */

  client.resetCalls()
  globalThis.__kiosk.reply.kiosk_check_in = [{
    ok: true, message: 'Recorded.', full_name: 'James Okon', work_date: '2026-09-30',
    kind: 'work', contractor_name: 'Contractor A', method: 'kiosk', already: false,
  }]

  await pressAll(host, ['7', '4', '2', '9'])
  await flush(450)

  const call = client.calls().find(c => c[0] === 'kiosk_check_in')
  ok('checking in calls kiosk_check_in with the four arguments the server declares',
    !!call && Object.keys(call[1]).sort().join(',') === 'p_code,p_contractor_id,p_employee_id,p_pin',
    JSON.stringify(call?.[1]))
  ok('it sends the worker actually selected, the contractor actually chosen, and the two secrets',
    !!call && call[1].p_employee_id === 'e1' && call[1].p_contractor_id === 'c1' &&
      call[1].p_pin === '4821' && call[1].p_code === '7429', JSON.stringify(call?.[1]))

  ok('the answer thanks the worker by name',
    text(host).includes('Thank you, James'), text(host).slice(0, 90))
  ok('it says what was recorded, in words rather than a status code',
    text(host).includes('Working today'))
  ok('it states the method for audit, and still no money anywhere',
    text(host).includes('Kiosk') && !/₦|rate|amount/i.test(text(host)))
  ok('a recorded day is drawn green', !!host.querySelector('.ks-result.ks-ok'))
  ok('the machine re-reads the roster once after the answer, so the next worker sees today’s truth',
    client.calls().filter(c => c[0] === 'kiosk_roster').length === 1,
    `${client.calls().filter(c => c[0] === 'kiosk_roster').length} roster call(s) since the answer`)

  await click(byText(host, '.ks-btn', 'Done'))
  ok('Done clears the previous worker’s name and answer completely',
    !text(host).includes('James Okon') && !text(host).includes('Thank you'))

  /* ── 6. already checked in (§15) ───────────────────────────────────────── */

  await click(byText(host, '.ks-btn-choice', 'Contractor B'))
  await click(byText(host, '.ks-btn-choice', 'Monday Udo'))
  globalThis.__kiosk.reply.kiosk_check_in = [{
    ok: true, already: true, full_name: 'Monday Udo', work_date: '2026-09-30',
    kind: 'work', method: 'kiosk', message: '',
  }]
  await pressAll(host, ['1', '1', '1', '1'])
  await flush(400)
  await pressAll(host, ['7', '4', '2', '9'])
  await flush(450)

  const again = client.calls().filter(c => c[0] === 'kiosk_check_in').pop()
  ok('a second attempt is still SENT — the server decides, the machine does not guess',
    !!again && again[1].p_employee_id === 'e4', JSON.stringify(again?.[1]))
  ok('the brief’s exact words are used for a duplicate (§15)',
    text(host).includes('Already Checked In') &&
    text(host).includes('You are already recorded as working today.'), text(host).slice(0, 100))
  ok('a duplicate is amber, not red — the person did come to work',
    !!host.querySelector('.ks-result.ks-already') && !host.querySelector('.ks-result.ks-refused'))

  /* ── 7. refusals, and never a blank pane ───────────────────────────────── */

  const REFUSALS = [
    'That PIN is not correct.',
    'That site code is not valid now. Ask for today’s code.',
    'Too many wrong PINs. Try again in a few minutes.',
    'You are not listed under that contractor. Check with your supervisor.',
  ]

  for (const sentence of REFUSALS) {
    await click(byText(host, '.ks-btn', 'Done'))
    await click(byText(host, '.ks-btn-choice', 'Contractor A'))
    await click(byText(host, '.ks-btn-choice', 'Peter Smith'))
    globalThis.__kiosk.reply.kiosk_check_in = [{ ok: false, message: sentence }]
    await pressAll(host, ['9', '9', '9', '9'])
    await flush(400)
    await pressAll(host, ['7', '4', '2', '9'])
    await flush(450)

    ok(`a refusal repeats the server’s sentence: “${sentence}”`,
      text(host).includes(sentence) && !!host.querySelector('.ks-result.ks-refused'),
      text(host).slice(0, 110))
    ok('a refusal never leaves an empty pane',
      text(host).includes('Not recorded') && text(host).length > 40, `${text(host).length} chars`)
  }

  /* §10: none of those sentences may identify whose code, PIN or contractor was
     involved. The one that could — "not listed under that contractor" — names
     nobody either. */
  ok('no refusal sentence names a person, a rate, or another worker’s contractor',
    !REFUSALS.some(s => /James|Peter|Uche|rate|₦/i.test(s)))

  /* ── 8. a project that has not run migration 019 ────────────────────────── */

  client.setFault('42883', 'function public.kiosk_roster() does not exist')
  let message = ''
  try { await kioskLib.kioskRoster() } catch (e) { message = e.message }
  ok('an un-updated project is told in words, not in Postgres',
    /does not have the site kiosk installed yet/i.test(message) && !/does not exist/i.test(message),
    message)

  client.setFault('PGRST202', "Could not find the function public.kiosk_roster in the schema cache")
  try { await kioskLib.kioskRoster() } catch (e) { message = e.message }
  ok('so is the schema-cache wording of the same problem',
    /does not have the site kiosk installed yet/i.test(message), message)

  client.clearFault()
  globalThis.__kiosk.reply.kiosk_roster = roster()
  const back = await kioskLib.kioskRoster()
  ok('and a working project gets a roster with no money in it',
    back.people.length === CREW.length && back.contractors.length === 2 &&
    !JSON.stringify(back).includes('rate'), Object.keys(back).join(', '))
}

/* ── 9. what the machine is, structurally ────────────────────────────────── */

{
  const fs = require_('node:fs')
  const css = fs.readFileSync(new URL('../../src/kiosk/kiosk.css', import.meta.url), 'utf8')
  const px = (sel, prop) => {
    const m = css.match(new RegExp(`\\.${sel}\\s*\\{[^}]*${prop}:\\s*(\\d+)px`, 's'))
    return m ? Number(m[1]) : 0
  }

  ok('the keypad keys are big enough to hit with a thumb, at speed (§21)',
    px('ks-key', 'min-height') >= 64, `${px('ks-key', 'min-height')}px`)
  ok('the buttons a worker presses are big too (§21)',
    px('ks-btn', 'min-height') >= 52, `${px('ks-btn', 'min-height')}px`)
  const sizes = (sel) => {
    const m = css.match(new RegExp(`\\.${sel}\\s*\\{([^}]*)\\}`, 's'))
    return m ? [...m[1].matchAll(/(\d+)px/g)].map(x => Number(x[1])) : []
  }
  const title = sizes('ks-result-title')
  ok('the answer is set in type readable from a metre away (§21)',
    Math.max(...title) >= 40 && Math.min(...title) >= 28,
    `${Math.min(...title)}–${Math.max(...title)}px`)
  ok('and the sentence underneath it is set large as well',
    Math.min(...sizes('ks-result-body')) >= 20, `${sizes('ks-result-body')}px`)
  ok('and it adapts to a tablet rather than pretending every screen is a desktop',
    /max-width:\s*620px/.test(css))

  ok('every call the whole walk made was one of the kiosk’s three functions (§20)',
    client.calls().every(c => ['claim_attendance_device', 'kiosk_roster', 'kiosk_check_in'].includes(c[0])),
    [...new Set(client.calls().map(c => c[0]))].join(', '))
  ok('and the machine never read an employer table for itself',
    client.calls().length > 10, `${client.calls().length} calls, all rpc`)
}

/* ── 10. the employer's half of the same feature ──────────────────────────── */

{
  const employer = await import('./mock-employer.js')

  // A clipboard, so the Copy button can be pressed rather than merely found.
  let copied = null
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    value: { writeText: async (v) => { copied = v } }, configurable: true,
  })

  employer.setDevicesMissing(false)
  employer.setDeviceFixtures(null)
  globalThis.__calls.length = 0
  const { host } = await mountEl(<DevicePanel />)

  ok('the employer has a card for the machine, in the roster where they organise the site',
    text(host).includes('Site attendance kiosk'), text(host).slice(0, 60))
  ok('it says what a kiosk is FOR, because this is where an employer learns it exists',
    /no smartphone/i.test(text(host)) && /no network today/i.test(text(host)))
  ok('an employer who has never linked one is told exactly what to do',
    text(host).includes('No kiosk is linked') && text(host).includes('works once'))
  ok('the card offers a code to create, not a settings screen to configure',
    !!byText(host, '.ew-btn', 'Link a site kiosk'))

  /* ── the machine has been used and is reporting in ─────────────────────── */
  employer.setDeviceFixtures([
    { id: 'dv1', label: 'Gate kiosk', status: 'active', link_code: null,
      device_user_id: 'kiosk-account', created_at: '2026-09-28T07:00:00Z',
      linked_at: '2026-09-28T07:04:00Z', revoked_at: null,
      last_seen_at: new Date(Date.now() - 5000).toISOString() },
  ])
  const linked = await mountEl(<DevicePanel />)
  ok('a linked machine reads as linked, in words rather than a status column',
    text(linked.host).includes('Gate kiosk') && text(linked.host).includes('Linked'))
  ok('and it says when it last recorded somebody, so a dead machine is visible',
    /Last used (just now|\d+ minutes? ago)/.test(text(linked.host)), text(linked.host).slice(0, 80))
  ok('a linked machine has no code to show, because the code was used up',
    !linked.host.querySelector('.ew-invite-code'))
  ok('it can be signed out, which is the only control a kiosk needs',
    !!byText(linked.host, '.ew-btn', 'Sign out'))

  /* ── the code is created, read out, and used once ──────────────────────── */
  employer.setDeviceFixtures(null)
  const created = await mountEl(<DevicePanel />)
  await click(byText(created.host, '.ew-btn', 'Link a site kiosk'))

  const createCall = globalThis.__calls.find(c => c[0] === 'createDevice')
  ok('creating a kiosk records it against the business, with a label',
    !!createCall && createCall[1] === 'Site kiosk', JSON.stringify(createCall))
  ok('the new row is in the waiting-to-be-linked state',
    text(created.host).includes('Waiting to be linked'))

  const codeEl = created.host.querySelector('.ew-invite-code')
  ok('a one-time link code is shown for this machine',
    !!codeEl && codeEl.textContent.trim().length === 8, codeEl?.textContent)
  ok('the employer is told it works once, so nobody pins it to a wall',
    /stops working the moment it is used/i.test(text(created.host)))
  ok('and where to type it, in words, because the kiosk is a different address',
    text(created.host).includes('/kiosk.html'))

  await click(byText(created.host, '.ew-btn', 'Copy'))
  ok('Copy puts the code on the clipboard',
    copied === codeEl.textContent.trim(), String(copied))
  ok('and the button says so, so the employer is not left wondering',
    !!byText(created.host, '.ew-btn', 'Copied'))

  const codeText = codeEl.textContent.trim()
  await click(byText(created.host, '.ew-btn', 'Sign out'))
  const revokeCall = globalThis.__calls.find(c => c[0] === 'revokeDevice')
  ok('signing a machine out is recorded against that machine',
    !!revokeCall && revokeCall[1] === 'dv1', JSON.stringify(revokeCall))
  ok('the code disappears the moment the machine is signed out',
    !text(created.host).includes(codeText), text(created.host).slice(0, 90))
  ok('and the employer is told the signed-out machine kept nothing',
    /Nothing they recorded was removed/i.test(text(created.host)))

  /* ── a project that has not run migration 019 ──────────────────────────── */
  employer.setDevicesMissing(true)
  const old = await mountEl(<DevicePanel />)
  ok('an un-updated project says so instead of showing an empty list',
    /has not run the site kiosk migration yet/i.test(text(old.host)))
  ok('and it says the rest of the roster still works, which is true',
    /rest of the roster works normally/i.test(text(old.host)))
  ok('no crash, no blank card', text(old.host).length > 60, `${text(old.host).length} chars`)

  employer.setDevicesMissing(false)
  employer.setDeviceFixtures(null)
}
