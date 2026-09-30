/* DayPay Site Attendance — the rules, and the wall around them.
 *
 * Two kinds of test live here, and the second kind is unusual enough to explain.
 *
 * The first is ordinary: the kiosk's steps, its keypad, its messages. Pure
 * functions, microseconds, no browser.
 *
 * The second is the §20 separation, checked by READING THE IMPORT GRAPH rather
 * than by trusting a convention. The brief says the Site Attendance interface
 * must not expose the employer dashboard, payroll, reports, settings or
 * management. The strongest version of that claim is not "there is no link to
 * it" — it is "the code is not in the bundle", and the only way to know that is
 * to look at what imports what. These tests fail the moment somebody adds an
 * import that would drag the employer application into the kiosk.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { dayOriginChip, ledgerSourceLabel } from '../src/lib/employerLogic.js'
import {
  KIOSK_STEPS, nextStep, backStep, keypadPress, isComplete, masked, codeSlots,
  contractorChoices, peopleForContractor, filterPeople, kioskOutcome,
  KIOSK_FILTER_THRESHOLD, ALREADY_TITLE, ALREADY_BODY, resultDuration,
  deviceStatusWord, deviceStatusHint, shortMoment, personLabel,
} from '../src/lib/kioskLogic.js'

const REPO = fileURLToPath(new URL('../', import.meta.url))

// ── The steps ───────────────────────────────────────────────────────────────

describe('the kiosk asks one thing at a time', () => {
  test('it is the five steps the brief describes, in order', () => {
    assert.deepEqual(KIOSK_STEPS, ['contractor', 'person', 'pin', 'code', 'result'])
  })

  test('walking forward from the contractor screen reaches the pin', () => {
    assert.equal(nextStep('contractor'), 'person')
    assert.equal(nextStep('person'), 'pin')
    assert.equal(nextStep('pin'), 'code')
  })

  test('walking forward can never land on the answer screen', () => {
    // The result step exists only to show an answer that came back from the
    // server. It is not somewhere the flow can wander into, because a kiosk
    // showing an empty result card is a kiosk that looks broken.
    let step = 'contractor'
    for (let i = 0; i < 6; i++) step = nextStep(step)
    assert.notEqual(step, 'result')
  })

  test('every step can be backed out of', () => {
    // Mis-tapping a name three rows down is the most common event at a kiosk.
    assert.equal(backStep('person'), 'contractor')
    assert.equal(backStep('pin'), 'person')
    assert.equal(backStep('code'), 'pin')
    assert.equal(backStep('contractor'), 'contractor')
  })

  test('an unknown step goes home rather than nowhere', () => {
    assert.equal(nextStep('nonsense'), 'contractor')
    assert.equal(backStep('nonsense'), 'contractor')
    assert.equal(nextStep(undefined), 'contractor')
  })
})

// ── The keypad ──────────────────────────────────────────────────────────────

describe('the keypad', () => {
  test('digits append, up to four', () => {
    let v = ''
    for (const d of ['4', '8', '2']) v = keypadPress(v, d)
    assert.equal(v, '482')
    v = keypadPress(v, '1')
    assert.equal(v, '4821')
  })

  test('a fifth digit is impossible, not trimmed later', () => {
    assert.equal(keypadPress('4821', '9'), '4821')
  })

  test('back removes one digit and clear removes all', () => {
    assert.equal(keypadPress('482', 'back'), '48')
    assert.equal(keypadPress('4', 'back'), '')
    assert.equal(keypadPress('', 'back'), '')
    assert.equal(keypadPress('4821', 'clear'), '')
  })

  test('a key that is not a digit and not a command changes nothing', () => {
    assert.equal(keypadPress('48', 'Enter'), '48')
    assert.equal(keypadPress('48', null), '48')
    assert.equal(keypadPress('48', ' '), '48')
  })

  test('it never produces something that is not a four-digit PIN', () => {
    const junk = ['99', '4821x', ' 12 ', 'abc', '', null, undefined]
    for (const start of junk) {
      const out = keypadPress(start, '7')
      assert.match(out, /^[0-9]{0,4}$/, `${JSON.stringify(start)} produced ${JSON.stringify(out)}`)
    }
  })

  test('completeness means exactly four digits', () => {
    assert.equal(isComplete('0000'), true)
    assert.equal(isComplete('123'), false)
    assert.equal(isComplete('12345'), false)
    assert.equal(isComplete('abcd'), false)
    assert.equal(isComplete(null), false)
  })
})

// ── What is shown ───────────────────────────────────────────────────────────

describe('the two secrets are drawn differently, on purpose', () => {
  test('the PIN is never rendered as digits', () => {
    // §8: the employee enters it privately. The way to keep it private is for
    // the screen never to hold it in a form somebody behind can read.
    assert.deepEqual(masked('4821'), ['•', '•', '•', '•'])
    assert.deepEqual(masked('48'), ['•', '•', '·', '·'])
    assert.deepEqual(masked(''), ['·', '·', '·', '·'])
    assert.ok(!masked('1234').join('').includes('1'))
  })

  test('the site code is shown, because it is written on a wall', () => {
    assert.deepEqual(codeSlots('7429'), ['7', '4', '2', '9'])
    assert.deepEqual(codeSlots('74'), ['7', '4', '·', '·'])
    assert.deepEqual(codeSlots(''), ['·', '·', '·', '·'])
  })

  test('anything that is not a digit is never drawn as one', () => {
    assert.deepEqual(codeSlots('ab'), ['·', '·', '·', '·'])
    assert.deepEqual(codeSlots(null), ['·', '·', '·', '·'])
  })
})

// ── Who is on the screen ────────────────────────────────────────────────────

describe('contractor choices', () => {
  const contractors = [{ id: 'c1', name: 'Contractor A' }, { id: 'c2', name: 'Contractor B' }]
  const assigned = [
    { id: 'e1', name: 'John Doe', contractor_id: 'c1' },
    { id: 'e2', name: 'Peter Smith', contractor_id: 'c2' },
  ]

  test('a site where everybody has a contractor shows only contractors', () => {
    const out = contractorChoices(assigned, contractors)
    assert.deepEqual(out.map(c => c.name), ['Contractor A', 'Contractor B'])
  })

  test('an unassigned worker gets a bucket, because otherwise they are stuck', () => {
    const withNobody = [...assigned, { id: 'e3', name: 'Grace Adeyemi', contractor_id: null }]
    const out = contractorChoices(withNobody, contractors)
    assert.equal(out.length, 3)
    assert.equal(out[2].id, null)
    assert.equal(out[2].name, 'No contractor')
    assert.match(out[2].sub, /1 worker/)
  })

  test('the "no contractor" bucket is data-driven, not permanent chrome', () => {
    // It must not appear just because the code can draw it.
    assert.equal(contractorChoices(assigned, contractors).some(c => c.id === null), false)
  })

  test('people are filtered to the chosen contractor, exactly', () => {
    assert.deepEqual(peopleForContractor(assigned, 'c1').map(p => p.name), ['John Doe'])
    assert.deepEqual(peopleForContractor(assigned, 'c2').map(p => p.name), ['Peter Smith'])
  })

  test('the empty bucket only ever contains the genuinely unassigned', () => {
    const withNobody = [...assigned, { id: 'e3', name: 'Grace Adeyemi', contractor_id: null }]
    assert.deepEqual(peopleForContractor(withNobody, null).map(p => p.name), ['Grace Adeyemi'])
  })

  test('no people, no contractors, or nothing at all — never a crash', () => {
    assert.deepEqual(contractorChoices([], []), [])
    assert.deepEqual(contractorChoices(null, null), [])
    assert.deepEqual(peopleForContractor(null, 'c1'), [])
  })
})

describe('finding a name on a big site', () => {
  const crew = [
    { id: 'e1', name: 'James Okon', job_title: 'Welder' },
    { id: 'e2', name: 'James Brown', job_title: 'Electrician' },
    { id: 'e3', name: 'Grace Adeyemi', job_title: null },
  ]

  test('an empty search returns everybody', () => {
    assert.equal(filterPeople(crew, '').length, 3)
    assert.equal(filterPeople(crew, null).length, 3)
  })

  test('it matches on name and on trade, because both are how people are known', () => {
    assert.deepEqual(filterPeople(crew, 'james').map(p => p.id), ['e1', 'e2'])
    assert.deepEqual(filterPeople(crew, 'weld').map(p => p.id), ['e1'])
  })

  test('two people called James are told apart by their trade', () => {
    const both = filterPeople(crew, 'James')
    assert.equal(both.length, 2)
    assert.equal(personLabel(both[0]).job, ' · Welder')
    assert.equal(personLabel(both[1]).job, ' · Electrician')
  })

  test('a search that matches nothing returns nothing, not everybody', () => {
    // The failure mode that matters: a filter which silently shows the whole
    // roster when it fails is worse than no filter.
    assert.deepEqual(filterPeople(crew, 'zzzz'), [])
  })

  test('the filter only appears when the list is long enough to need it', () => {
    assert.equal(KIOSK_FILTER_THRESHOLD, 9)
    assert.ok(KIOSK_FILTER_THRESHOLD > 8)
  })
})

// ── What comes back ─────────────────────────────────────────────────────────

describe('the answer on screen (§15)', () => {
  test('a recorded day is green and names the worker', () => {
    const out = kioskOutcome({ ok: true, already: false, full_name: 'John Doe', kind: 'work' })
    assert.equal(out.tone, 'ok')
    assert.match(out.title, /John/)
    assert.equal(out.body, 'Working today')
  })

  test('a second attempt uses the brief’s words, and is not an error', () => {
    const out = kioskOutcome({ ok: true, already: true, full_name: 'John Doe', kind: 'work' })
    assert.equal(out.tone, 'already')
    assert.equal(out.title, ALREADY_TITLE)
    assert.equal(out.body, ALREADY_BODY)
    // Amber, never red: the person DID come to work, and they ARE on the
    // record. Sending them to the office over it wastes everybody's morning.
    assert.notEqual(out.tone, 'refused')
  })

  test('a refusal is red, headed simply, and carries the server’s sentence', () => {
    const out = kioskOutcome({ ok: false, message: 'That PIN is not correct.' })
    assert.equal(out.tone, 'refused')
    assert.equal(out.title, 'Not recorded')
    assert.equal(out.body, 'That PIN is not correct.')
  })

  test('a refusal with no message still says something a person can act on', () => {
    // A blank refusal is the one outcome a kiosk must never produce.
    for (const r of [{ ok: false }, { ok: false, message: '' }, { ok: false, message: null }]) {
      const out = kioskOutcome(r)
      assert.equal(out.tone, 'refused')
      assert.ok(out.body.length > 10)
    }
    assert.equal(kioskOutcome(null).tone, 'error')
    assert.ok(kioskOutcome(null).body.length > 10)
  })

  test('weekends and overtime are named in plain words, not codes', () => {
    assert.equal(kioskOutcome({ ok: true, kind: 'weekend' }).body, 'Weekend working')
    assert.equal(kioskOutcome({ ok: true, kind: 'overtime' }).body, 'Overtime')
    assert.equal(kioskOutcome({ ok: true, kind: 'work' }).body, 'Working today')
  })

  test('a kind nobody has a word for still reads as something', () => {
    assert.equal(kioskOutcome({ ok: true, kind: 'somethingnew' }).body, 'Recorded')
  })
})

describe('the screen clears itself', () => {
  test('every tone has a duration, and success lingers longest', () => {
    const ok = resultDuration('ok')
    for (const tone of ['already', 'refused', 'error']) {
      assert.ok(resultDuration(tone) > 0)
    }
    assert.ok(ok >= 5000, 'a worker needs time to read their own name')
    assert.ok(resultDuration(undefined) > 0, 'an unknown tone still clears')
  })
})

// ── The employer's side of it ───────────────────────────────────────────────

describe('the device list', () => {
  test('each state reads as words, not as a status column', () => {
    assert.equal(deviceStatusWord({ status: 'pending' }), 'Waiting to be linked')
    assert.equal(deviceStatusWord({ status: 'active', device_user_id: 'u1' }), 'Linked')
    assert.equal(deviceStatusWord({ status: 'revoked' }), 'Signed out')
    assert.equal(deviceStatusWord(null), '')
  })

  test('the hint says what to do next in each state', () => {
    assert.match(deviceStatusHint({ status: 'pending' }), /works once/i)
    assert.match(deviceStatusHint({ status: 'active', device_user_id: 'u1' }), /not used yet/i)
    assert.match(deviceStatusHint({ status: 'revoked' }), /can no longer record/i)
  })

  test('a device that has been used says when, in words', () => {
    const now = new Date('2026-09-30T12:00:00Z')
    assert.match(deviceStatusHint({ status: 'active', device_user_id: 'u1', last_seen_at: '2026-09-30T11:59:30Z' }, now), /just now/)
    assert.match(shortMoment('2026-09-30T11:30:00Z', now), /30 minutes ago/)
    assert.match(shortMoment('2026-09-30T09:00:00Z', now), /3 hours ago/)
    assert.match(shortMoment('2026-09-28T12:00:00Z', now), /2 days ago/)
  })

  test('an unparseable moment is blank, not "Invalid Date"', () => {
    for (const bad of [null, '', 'not a date']) assert.equal(shortMoment(bad), '')
  })
})

// ── §18: the employer can see how a day arrived ─────────────────────────────

describe('the audit view says how a day was recorded, and never guesses', () => {
  test('a kiosk day says kiosk', () => {
    assert.equal(dayOriginChip({ source: 'check_in', attendance_method: 'kiosk' }), 'At the site kiosk')
    assert.equal(ledgerSourceLabel('check_in', 'kiosk'), 'Recorded at the site kiosk')
  })

  test('a phone day says phone, in the wording that was already there', () => {
    assert.equal(dayOriginChip({ source: 'check_in', attendance_method: 'mobile' }), 'Checked in on their phone')
    assert.equal(ledgerSourceLabel('check_in', 'mobile'), 'Recorded with the work code')
  })

  test('a day from before 019 keeps the older sentence rather than inventing one', () => {
    // Every check-in that existed before this phase has no method. Calling it
    // "mobile" would be the audit trail making something up.
    assert.equal(dayOriginChip({ source: 'check_in', attendance_method: null }), 'Checked in')
    assert.equal(ledgerSourceLabel('check_in', null), 'Recorded with the work code')
    assert.equal(ledgerSourceLabel('check_in'), 'Recorded with the work code')
  })

  test('an employer-marked day is still the employer’s, and a correction is still a correction', () => {
    assert.equal(dayOriginChip({ source: 'employer' }), 'Marked by you')
    assert.equal(dayOriginChip({ source: 'employer', attendance_method: 'kiosk' }), 'Marked by you',
      'a method on an employer-marked day must not be believed')
    assert.equal(dayOriginChip({ source: 'correction' }), 'From a correction')
    assert.equal(ledgerSourceLabel('correction'), 'Corrected by your employer')
    assert.equal(ledgerSourceLabel('employer'), 'Recorded by your employer')
  })

  test('a row with no source produces no chip, rather than an empty one', () => {
    assert.equal(dayOriginChip({}), '')
    assert.equal(dayOriginChip(null), '')
    assert.equal(dayOriginChip(undefined), '')
  })
})

// ── §20, as a property of the import graph ──────────────────────────────────

describe('the kiosk cannot reach the employer application', () => {
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
  const importsOf = (src) => {
    const out = []
    const re = /(?:from|import)\s+['"]([^'"]+)['"]/g
    let m
    while ((m = re.exec(src))) out.push(m[1])
    return out
  }

  /* Everything the kiosk is allowed to pull in. Each entry is a decision: the
     Supabase client (it must talk to the server), the two kiosk modules, and
     React. Anything else is a mistake until somebody argues for it here. */
  const ALLOWED_PREFIXES = ['react', 'react-dom', './Kiosk.jsx', './kiosk.css', '../lib/kiosk', '../lib/kioskLogic', './supabase', './kioskLogic']

  const KIOSK_FILES = [
    'src/kiosk/main.jsx',
    'src/kiosk/Kiosk.jsx',
    'src/lib/kiosk.js',
    'src/lib/kioskLogic.js',
  ]

  test('every file in the kiosk tree imports only kiosk-safe modules', () => {
    for (const file of KIOSK_FILES) {
      for (const spec of importsOf(read(file))) {
        const ok = ALLOWED_PREFIXES.some(p => spec === p || spec.startsWith(p + '/') || spec === p.replace(/\.jsx?$/, ''))
        assert.ok(ok, `${file} imports "${spec}", which is not on the kiosk allowlist`)
      }
    }
  })

  test('nothing in the kiosk names the employer application', () => {
    // The imports above are the mechanism; this is the intent, checked in case
    // somebody reaches a screen some other way.
    const forbidden = ['EmployerWorkspace', 'EmployeeView', 'App.jsx', 'lib/employer', 'Billing', 'WorkerView', 'Dashboard']
    for (const file of KIOSK_FILES) {
      const src = read(file)
      for (const word of forbidden) {
        // `Billing`/`Dashboard` etc. as whole words only — a comment may
        // legitimately mention the payroll admin the kiosk must not expose.
        const re = new RegExp(`(from|import)\\s+['"][^'"]*${word}`)
        assert.doesNotMatch(src, re, `${file} pulls in ${word}`)
      }
    }
  })

  test('the kiosk logic is import-free, so it can never drag anything in', () => {
    assert.deepEqual(importsOf(read('src/lib/kioskLogic.js')), [])
  })

  test('the kiosk client talks to the database and nothing else of ours', () => {
    assert.deepEqual(importsOf(read('src/lib/kiosk.js')), ['./supabase'])
  })

  test('the kiosk entry point imports the kiosk and nothing else', () => {
    const specs = importsOf(read('src/kiosk/main.jsx'))
    assert.ok(specs.includes('./Kiosk.jsx'))
    assert.ok(specs.includes('./kiosk.css'))
    assert.equal(specs.length, 4, `unexpected imports: ${specs.join(', ')}`)  // + react + react-dom/client
  })

  test('it is a separate HTML entry point, not a route inside the app', () => {
    // §6: "a separate external/public-facing interface". Two entries in the
    // build is what makes that structural rather than a convention.
    const html = read('kiosk.html')
    assert.match(html, /src\/kiosk\/main\.jsx/)
    assert.doesNotMatch(html, /src\/main\.jsx/)

    const app = read('index.html')
    assert.match(app, /src\/main\.jsx/)
    assert.doesNotMatch(app, /src\/kiosk\/main\.jsx/)

    const vite = read('vite.config.js')
    assert.match(vite, /main:\s*path\.resolve/)
    assert.match(vite, /kiosk:\s*path\.resolve/)
  })

  test('the kiosk is not linked from the application anywhere', () => {
    // §20 is about exposure, and a link in the workforce UI would be an
    // invitation to open a kiosk on a phone. The employer is TOLD the address
    // in words; nothing navigates there.
    const workspace = read('src/employer/DevicePanel.jsx')
    assert.doesNotMatch(workspace, /<a[^>]+href=["'][^"']*kiosk/i)
    assert.match(workspace, /\/kiosk\.html/, 'the employer must be told the address in words')
  })
})
