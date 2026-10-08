/* DayPay — the machines allowed to record attendance at your sites.
 *
 * The employer's whole interface to the kiosk: create a code, read it out, and
 * sign out a machine that should stop. There is no third thing, because the
 * device has no settings worth having.
 *
 * THE ONE THING THIS SCREEN HAS TO GET RIGHT
 *
 * Saying what the code is FOR. An employer who reads this as "another invite
 * code" will send it to a worker, who will try to sign up with it and fail — the
 * two codes look alike and do completely different things. So the screen names
 * the MACHINE, not the person, and says where the code is typed.
 *
 * Phase 8 made it a destination rather than a row at the foot of the roster: it
 * opens with its own name and one sentence saying what it is for, its one action
 * is in that header, and the paragraph explaining what a kiosk even is stays
 * behind the info button. While the machines are still loading it says so — the
 * old row claimed "not linked yet" during a load, which is a different thing and
 * sometimes an untrue one.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useState } from 'react'
import { EmployerError, listDevices, createDevice, revokeDevice } from '../lib/employer'
import { deviceStatusWord, deviceStatusHint } from '../lib/kioskLogic'
import { Skeleton, TechDetail } from '../ui/Ui.jsx'

export default function DevicePanel() {
  const [devices, setDevices] = useState(undefined)   // undefined = loading, null = not installed
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)
  const [info, setInfo] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setDevices(await listDevices())
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
      setDevices(null)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function add() {
    setBusy(true); setError(null)
    try {
      await createDevice('Site kiosk')
      await load()
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally { setBusy(false) }
  }

  async function revoke(id) {
    setBusy(true); setError(null)
    try {
      await revokeDevice(id)
      await load()
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally { setBusy(false) }
  }

  const live = (devices || []).filter(d => d.status !== 'revoked')
  const past = (devices || []).filter(d => d.status === 'revoked')
  const waiting = live.find(d => d.link_code)

  return (
    <div className="ew-screen" data-testid="device-panel">
      <header className="ew-head">
        <div className="ew-head-text">
          <h2 className="ew-title">Site kiosk</h2>
          <p className="ew-sub">
            {/* Three different situations, three different sentences. "Not switched
                on yet" is a fact about the account; saying it after a network failure
                would send the employer to run a migration they already ran. (§39
                replaced "on this database yet" — that was the schema talking to a
                business owner.) */}
            {devices === undefined
              ? 'Loading your machines…'
              : devices === null && error
                ? 'Could not load your machines'
                : devices === null
                  ? 'Not switched on for this account yet'
                  : live.length === 0
                    ? 'For workers without a phone. No machine is linked yet.'
                    : `${live.length} machine${live.length === 1 ? '' : 's'} linked`}
          </p>
        </div>

        <button
          type="button" className="ew-icon-btn"
          aria-expanded={info} aria-label="What a site kiosk is"
          onClick={() => setInfo(v => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9.2" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
          </svg>
        </button>

        {devices !== null && devices !== undefined && (
          <button
            type="button" className="ew-btn ew-btn-primary"
            disabled={busy}
            onClick={add}
          >
            {busy ? 'Creating…' : waiting ? 'New code' : '+ Link a machine'}
          </button>
        )}
      </header>

      {/* While the machines are on their way. A screen that says nothing here has
          not decided whether the employer has any. */}
      {devices === undefined && <Skeleton variant="block" />}

      {/* The explanation, on demand. The row above stays one line; this is where
          an employer who has never seen a kiosk finds out what it is. */}
      {info && (
        <div className="ew-screen-info">
          <p>
            A kiosk is a computer at the worksite. Workers who have no smartphone
            — or no network today — pick their name there, enter their PIN and
            today&apos;s site code, and are recorded exactly like anybody who
            checked in on a phone.
          </p>
          <p>
            Create a code here and enter it on the machine. It works once, then it
            is used up — so there is nothing to pin to a wall.
          </p>
        </div>
      )}

      {/* Not switched on yet. The answer has to be actionable rather than
          "something is missing" — and §39 moved the file name out of the sentence
          and behind the detail, where the person who runs the database will look. */}
      {devices === null && !error && (
        <>
          <p className="ew-screen-note">
            Site machines aren’t switched on for this account yet, so none can be
            linked. The rest of the roster works normally.
          </p>
          <TechDetail>
            <code>supabase/migrations/019_site_kiosk.sql</code> — the database update
            the site kiosk needs has not been run.
          </TechDetail>
        </>
      )}

      {live.map(d => (
        <div className="ew-device" key={d.id}>
          <div className="ew-device-body">
            <div className="ew-device-name">
              {d.label}
              <span className={d.status === 'active' ? 'ew-chip ew-chip-live' : 'ew-chip'}>
                {deviceStatusWord(d)}
              </span>
            </div>
            <div className="ew-device-hint">{deviceStatusHint(d)}</div>

            {d.link_code && (
              <div className="ew-invite-row dp-mt-8">
                <span className="ew-invite-code">{d.link_code}</span>
                <button
                  type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard?.writeText(d.link_code)
                      setCopied(d.id)
                    } catch { /* no clipboard — the code is on screen */ }
                  }}
                >
                  {copied === d.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}

            {d.link_code && (
              <>
                <p className="ew-hint dp-mt-8">
                  Enter this on the site machine when it asks, after signing in there
                  once. It stops working the moment it is used.
                </p>
                {/* §39: "the kiosk at /kiosk.html" was the only file path inside a
                    sentence in the product. The words stay; the address is one tap
                    away for whoever is standing at the machine. */}
                <TechDetail label="Where to open the site machine">
                  {typeof window !== 'undefined' && window.location
                    ? `${window.location.origin}/kiosk.html`
                    : '/kiosk.html'}
                </TechDetail>
              </>
            )}
          </div>
          <button
            type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
            disabled={busy}
            onClick={() => revoke(d.id)}
            title="Stop this machine recording attendance. Records it already made are kept."
          >
            Sign out
          </button>
        </div>
      ))}

      {past.length > 0 && (
        <p className="ew-screen-note">
          {past.length} machine{past.length === 1 ? '' : 's'} signed out.
          Nothing they recorded was removed.
        </p>
      )}

      {error && (
        <div className="ew-msg ew-msg-error dp-mt-8">
          {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
          {/* A screen that failed offers the way out, like every other screen here. */}
          <button
            type="button" className="ew-btn ew-btn-ghost ew-btn-sm dp-mt-8" disabled={busy}
            onClick={load}
          >
            {busy ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}
    </div>
  )
}
