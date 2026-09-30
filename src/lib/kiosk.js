/* DayPay Site Attendance — the network half of the kiosk.
 *
 * Deliberately thin, and deliberately its own module rather than a few more
 * functions in lib/employer.js. That file pulls in the roster, the dashboard,
 * the billing model and the payroll maths; a kiosk machine standing in a yard
 * has no business carrying any of it, and the surest way for it not to is for
 * the kiosk's own bundle never to import it.
 *
 * Three calls, one of them optional. A site with bad connectivity should not
 * need a round trip per step, so the roster arrives in ONE payload.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { supabase } from './supabase'

export class KioskError extends Error {
  constructor(message, { code, hint, cause } = {}) {
    super(message)
    this.name = 'KioskError'
    this.code = code
    this.hint = hint
    this.cause = cause
  }
}

/* PostgREST says "not linked" in one of three ways depending on whether the
   refusal came from an exception we raised, a missing row, or a schema that
   predates migration 019. All three mean the same thing to the person at the
   machine, so they are folded into one message here rather than three screens. */
function asKioskError(error, fallback) {
  if (!error) return new KioskError(fallback)
  const msg = String(error.message || error.details || fallback)
  const code = error.code

  // The migration has not been run on this project yet.
  if (code === '42883' || code === 'PGRST202' || /does not exist|Could not find the function/i.test(msg)) {
    return new KioskError('This project does not have the site kiosk installed yet. Ask your employer.', { code })
  }

  return new KioskError(msg, { code, cause: error })
}

export async function currentSessionUser() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.user || null
}

export function onSessionChange(fn) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => fn(session?.user || null))
  return () => data?.subscription?.unsubscribe?.()
}

export async function signInKiosk(email, password) {
  if (!supabase) throw new KioskError('Cloud sync is not configured on this build.')
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw asKioskError(error, 'Could not sign in.')
  return data?.user || null
}

export async function signOutKiosk() {
  if (!supabase) return
  await supabase.auth.signOut()
}

/* Links the machine to one employer. The code is read out by the employer from
   their Staff screen and works exactly once. */
export async function claimDevice(code) {
  const { data, error } = await supabase.rpc('claim_attendance_device', { p_code: String(code || '').trim() })
  if (error) throw asKioskError(error, 'Could not link this device.')
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new KioskError('The code was accepted but no device came back. Ask your employer.')
  return row
}

/* Everything the kiosk needs to draw its screens: who we are, and who works
   here. No money, no days, no pay — see migration 019 for why that is the
   shape rather than a promise. */
export async function kioskRoster() {
  const { data, error } = await supabase.rpc('kiosk_roster')
  if (error) throw asKioskError(error, 'Could not load the roster.')
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new KioskError('The roster came back empty.')
  return {
    businessName: row.business_name || null,
    deviceLabel: row.device_label || 'Site kiosk',
    people: Array.isArray(row.people) ? row.people : [],
    contractors: Array.isArray(row.contractors) ? row.contractors : [],
  }
}

/* Records one attendance. Returns the server's row — including its refusals,
   which are answers here, not exceptions. */
export async function kioskCheckIn(employeeId, contractorId, pin, code) {
  const { data, error } = await supabase.rpc('kiosk_check_in', {
    p_employee_id: employeeId,
    p_contractor_id: contractorId ?? null,
    p_pin: String(pin || '').trim(),
    p_code: String(code || '').trim(),
  })
  if (error) throw asKioskError(error, 'Could not record that.')
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: false, message: 'Nothing was recorded. Try again.' }
  return row
}
