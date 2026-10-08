/* DayPay — the personal attendance PIN.
 *
 * The employer's whole interface to it: give somebody a PIN, or give them a
 * new one. There is no third thing, because there is nothing else that can be
 * done with a value that only exists as a hash.
 *
 * WHY THIS SAYS "IT WILL NOT BE SHOWN AGAIN" IN THREE PLACES
 *
 * Because it is true, and because the alternative is an employer who assumes
 * there is a "show PIN" button somewhere and only finds out there is not when
 * a worker is standing at the kiosk. The PIN is generated on the server, handed
 * back once, and then only a salted hash remains. That is a property of the
 * storage — not a setting — so the screen has to be honest about it rather than
 * quietly implying a recovery path that does not exist.
 *
 * WHAT A PIN IS FOR, SAID PLAINLY
 *
 * A worker without a smartphone still has to be able to prove they were on
 * site. They cannot sign in — they may have no account at all — so they pick
 * their name at the kiosk and type four digits. The PIN is not a password and
 * the panel does not pretend it is: it is one half of a check whose other half
 * is the site code that changes every session.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  EmployerError, setAttendancePin, employeePinStatus, prettyDateKey,
} from '../lib/employer'

function issuedText(iso) {
  if (!iso) return ''
  const day = String(iso).slice(0, 10)
  const pretty = prettyDateKey(day)
  // prettyDateKey returns its input unchanged when it cannot parse it, so a
  // shape we do not recognise is passed through rather than shown as "Invalid".
  return pretty === day ? `Set ${day}` : `Set ${pretty}`
}

export default function PinPanel({ employee, onChanged }) {
  const [status, setStatus] = useState(undefined)  // undefined = still asking, null = not installed
  const [pin, setPin] = useState(null)             // the one-time value
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setStatus(undefined)
    setError(null)
    try {
      const s = await employeePinStatus(employee.id)
      setStatus(s)
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
      setStatus(null)
    }
  }, [employee.id])

  useEffect(() => { load() }, [load])

  async function issue() {
    setBusy(true); setError(null); setCopied(false)
    try {
      const value = await setAttendancePin(employee.id)
      setPin(value)
      // Re-read rather than assume: the issued date comes from the database,
      // so a clock that disagrees with the server cannot produce a lie here.
      const s = await employeePinStatus(employee.id)
      setStatus(s)
      onChanged?.()
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusy(false)
    }
  }

  const who = employee.full_name || 'this worker'
  const hasPin = !!(status && status.has_pin)
  const locked = !!(status && status.locked_until)

  return (
    <div className="ew-card ew-roster-panel" data-testid="pin-panel">
      <div className="ew-label">Attendance PIN · {who}</div>

      {status === undefined && (
        <p className="ew-hint dp-mt-8">Checking…</p>
      )}

      {/* The feature is not installed on this project. Say that, rather than
          showing "No PIN" — those are different facts, and the second one would
          send the employer looking for a problem with the worker. */}
      {status === null && !error && (
        <p className="ew-hint dp-mt-8">
          This project has not run the attendance PIN migration yet, so PINs
          cannot be issued. Everything else on this screen works normally.
        </p>
      )}

      {/* ── The one moment the PIN is visible ─────────────────────────────── */}
      {pin && (
        <div className="ew-pin-fresh">
          <p className="ew-pin-caption">Give this to {who} now</p>
          <div className="ew-pin-value" data-testid="pin-value">{pin}</div>
          <p className="ew-pin-warn">
            This is the only time it will ever be shown. It is stored hashed, so
            nobody — including you — can read it back. If it is lost, issue a
            new one; the old number stops working immediately.
          </p>
          <button
            type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
            onClick={async () => {
              try { await navigator.clipboard?.writeText(pin); setCopied(true) } catch { /* no clipboard */ }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {status && !pin && (
        <>
          {hasPin ? (
            <p className="ew-hint dp-mt-8">
              {issuedText(status.set_at)}
              {locked && ' · locked for a few minutes after repeated wrong PINs'}
            </p>
          ) : (
            <p className="ew-hint dp-mt-8">
              No PIN yet. Issue one so {who} can record attendance at the site
              kiosk — with no smartphone and no DayPay account.
            </p>
          )}
          <div className="ew-actions dp-mt-8">
            <button
              type="button"
              /* The accent outline, not a filled button: the screen's one filled button is
       the roster's Add, and this panel is opened from a row. When it came in
       filled, opening it produced either two solid buttons or — with a PIN
       already set, where this was already a ghost — none at all. */
                className="ew-btn ew-btn-accent ew-btn-sm"
              disabled={busy}
              onClick={issue}
            >
              {busy ? 'Issuing…' : hasPin ? 'Issue a new PIN' : 'Create PIN'}
            </button>
          </div>
        </>
      )}

      {hasPin && !pin && (
        <p className="ew-hint dp-mt-8">
          The PIN itself cannot be shown — only replaced. Issue a new one if it
          has been forgotten.
        </p>
      )}

      {error && (
        <div className="ew-msg ew-msg-error dp-mt-8">
          {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}
    </div>
  )
}
