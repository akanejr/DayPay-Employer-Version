/* DayPay Site Attendance — the rules the kiosk runs on.
 *
 * Pure, import-free, and therefore testable with `node --test` and no browser.
 * The kiosk itself is a large, deliberately simple screen; everything that
 * could be got wrong about it — which step comes next, what a refusal says,
 * which people belong under which contractor — lives here where it can be
 * argued with.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

/* ── The steps ───────────────────────────────────────────────────────────────
   Five, and no way to reach a sixth. A worker at the kiosk walks forward and
   can walk back at any point; they can never land on a screen that shows
   somebody else's information, because there is no such screen to land on. */
export const KIOSK_STEPS = ['contractor', 'person', 'pin', 'code', 'result']

export function nextStep(step) {
  const i = KIOSK_STEPS.indexOf(step)
  if (i === -1) return 'contractor'
  return KIOSK_STEPS[Math.min(i + 1, KIOSK_STEPS.length - 2)]  // result is only reachable with an answer
}

/* Going back is deliberately allowed from every step, because the most common
   thing that happens at a kiosk is a mis-tap on a name three rows down. */
export function backStep(step) {
  const i = KIOSK_STEPS.indexOf(step)
  if (i <= 0) return 'contractor'
  return KIOSK_STEPS[i - 1]
}

/* ── The keypad ──────────────────────────────────────────────────────────────
   Both secrets at the kiosk are four digits, so both use the same keypad. A
   physical keyboard is present on a desktop and absent on a tablet, so the
   keypad is the screen's own — with the hardware keyboard also accepted, since
   a kiosk machine often has one and refusing it would be petty.

   Never longer than four: there is nothing to trim, and a fifth digit cannot
   be mistyped into existence. */
export function keypadPress(current, key, length = 4) {
  const digits = String(current ?? '').replace(/[^0-9]/g, '')
  if (key === 'clear') return ''
  if (key === 'back') return digits.slice(0, -1)
  if (!/^[0-9]$/.test(String(key))) return digits
  if (digits.length >= length) return digits
  return digits + key
}

export function isComplete(value, length = 4) {
  return new RegExp(`^[0-9]{${length}}$`).test(String(value ?? ''))
}

/* What the worker sees while typing their PIN. Dots, always the same count, so
   nobody standing behind learns the length of anything but a four-digit PIN —
   and §8's "must never be displayed publicly" is honoured by never rendering
   the digits at all, not by trusting the screen. */
export function masked(value, length = 4) {
  const filled = String(value ?? '').replace(/[^0-9]/g, '').length
  return Array.from({ length }, (_, i) => (i < filled ? '•' : '·'))
}

/* The site code is NOT masked. It is written on a wall, the whole crew knows
   it, and hiding it makes a typo much harder to see and correct. Different
   secrets get different treatment, deliberately. */
export function codeSlots(value, length = 4) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '')
  return Array.from({ length }, (_, i) => digits[i] ?? '·')
}

// ── Who can be chosen ───────────────────────────────────────────────────────

/* The kiosk asks for a contractor first, because that is how a site is
   organised and because §16 requires the choice to agree with the worker's own
   assignment.

   `null` is a real bucket, and it earns its place rather than being a hole in
   the rule: an employer may genuinely not have assigned somebody yet, and the
   attendance_sessions table has always allowed a site-wide session
   (contractor_id is null) precisely for that worker. It appears ONLY when
   somebody actually needs it — the option is data-driven, so a site where
   every worker has a contractor never sees it, and nobody can use it to
   pretend: choosing it only ever matches workers whose assignment really is
   empty. */
export function contractorChoices(people, contractors) {
  const list = (contractors || []).map(c => ({ id: c.id, name: c.name }))
  const unassigned = (people || []).filter(p => !p.contractor_id).length
  if (unassigned > 0) list.push({ id: null, name: 'No contractor', sub: `${unassigned} worker${unassigned === 1 ? '' : 's'}` })
  return list
}

export function peopleForContractor(people, contractorId) {
  return (people || []).filter(p =>
    contractorId === null || contractorId === undefined
      ? !p.contractor_id
      : p.contractor_id === contractorId)
}

/* A site with fifty workers needs a way to find a name quickly; a site with
   eight does not need a search box cluttering the screen before anybody has
   said they want one. So the filter appears only when the list is long. */
export const KIOSK_FILTER_THRESHOLD = 9

export function filterPeople(people, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return people || []
  return (people || []).filter(p =>
    String(p.name || '').toLowerCase().includes(q) ||
    String(p.job_title || '').toLowerCase().includes(q))
}

// ── What the answer means ───────────────────────────────────────────────────

/* §15 in the brief's own words, used verbatim.

   "Already checked in" is NOT an error and is not drawn as one. The person in
   front of the screen did come to work; they are on the record for today; and
   a red screen at that moment sends them to the office for no reason. It is
   amber, it is calm, and it says exactly what happened. No second row is
   created either — the database's unique index guarantees that independently
   of what this function returns. */
export const ALREADY_TITLE = 'Already Checked In'
export const ALREADY_BODY = 'You are already recorded as working today.'

const KIND_WORDS = {
  work: 'Working today',
  weekend: 'Weekend working',
  overtime: 'Overtime',
  holiday: 'Holiday working',
  leave: 'Leave',
}

export function kioskOutcome(result) {
  if (!result) return { tone: 'error', title: 'Something went wrong', body: 'Try again, or ask your supervisor.' }

  if (result.ok && result.already) {
    return { tone: 'already', title: ALREADY_TITLE, body: ALREADY_BODY, detail: result }
  }

  if (result.ok) {
    return {
      tone: 'ok',
      title: result.full_name ? `Thank you, ${result.full_name.split(' ')[0]}` : 'Recorded',
      body: KIND_WORDS[result.kind] || 'Recorded',
      detail: result,
    }
  }

  /* A refusal. The message is the server's, and every one of them is written to
     be safe to show to whoever is standing there: none names a person, a rate,
     a contractor's code, or anything about anybody but the worker who pressed
     the button. The fallback exists so a missing message can never render as a
     blank screen — a refusal that says nothing is worse than one that says too
     little. */
  return {
    tone: 'refused',
    title: 'Not recorded',
    body: result.message || 'That did not work. Ask your supervisor.',
  }
}

/* ── How the screen resets ───────────────────────────────────────────────────
   Success gives the queue time to read the name; a refusal is shorter, because
   the person needs to act rather than admire it. Both are printable and both
   are interruptible — the Done button is always there, and a new touch always
   wins over the timer. */
export const RESULT_MS = { ok: 6000, already: 7000, refused: 5500, error: 5500 }

export function resultDuration(tone) {
  return RESULT_MS[tone] ?? 5500
}

/* The employer's device list, as words rather than a status column. */
export function deviceStatusWord(device) {
  if (!device) return ''
  if (device.status === 'revoked') return 'Signed out'
  if (device.device_user_id) return 'Linked'
  return 'Waiting to be linked'
}

export function deviceStatusHint(device, now = new Date()) {
  if (!device) return ''
  if (device.status === 'revoked') return 'This machine can no longer record attendance.'
  if (device.device_user_id) {
    return device.last_seen_at
      ? 'Last used ' + shortMoment(device.last_seen_at, now)
      : 'Linked, and not used yet.'
  }
  return 'Give this code to the site machine. It works once.'
}

/* A kiosk that says "3 minutes ago" is more useful than one that says
   2026-09-30T15:04:11Z, and a kiosk is a machine for glancing at. */
export function shortMoment(iso, now = new Date()) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const secs = Math.max(0, Math.round((now.getTime() - t.getTime()) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/* What a worker's name looks like on a button. Job title is shown because two
   people called James are a normal thing on a Nigerian site, and picking the
   wrong one records a day for the wrong person. */
export function personLabel(person) {
  const name = person?.name || ''
  const job = person?.job_title ? ` · ${person.job_title}` : ''
  return { name, job }
}
