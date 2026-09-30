/* DayPay — the machines allowed to record attendance at your sites.
 *
 * The employer's whole interface to the kiosk: create a code, read it out, and
 * revoke a machine that should stop. There is no third thing, because the
 * device has no settings worth having.
 *
 * THE ONE THING THIS SCREEN HAS TO GET RIGHT
 *
 * Saying what the code is FOR. An employer who reads this as "another invite
 * code" will send it to a worker, who will try to sign up with it and fail —
 * the two codes look alike and do completely different things. So the card
 * names the machine, not the person, and says where it is typed.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useState } from 'react'
import { EmployerError, listDevices, createDevice, revokeDevice } from '../lib/employer'
import { deviceStatusWord, deviceStatusHint } from '../lib/kioskLogic'

export default function DevicePanel() {
  const [devices, setDevices] = useState(undefined)   // undefined = loading, null = not installed
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)

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

  return (
    <div className="ew-card" data-testid="device-panel">
      <div className="ew-label">Site attendance kiosk</div>

      {/* Not installed yet. Say which migration, so the answer is actionable
          rather than "something is missing". */}
      {devices === null && !error && (
        <p className="ew-hint" style={{ marginTop: 6 }}>
          This project has not run the site kiosk migration yet, so devices
          cannot be linked. The rest of the roster works normally.
        </p>
      )}

      {devices !== undefined && devices !== null && (
        <>
          <p className="ew-hint" style={{ marginTop: 6 }}>
            A kiosk is a computer at the worksite. Workers who have no
            smartphone — or no network today — pick their name there, enter
            their PIN and today&apos;s site code, and are recorded exactly like
            anybody who checked in on a phone.
          </p>

          {live.length === 0 && (
            <p className="ew-hint" style={{ marginTop: 8 }}>
              No kiosk is linked. Create a code and enter it on the machine — it
              works once.
            </p>
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
                  <div className="ew-invite-row" style={{ marginTop: 8 }}>
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
                  <p className="ew-hint" style={{ marginTop: 6 }}>
                    Enter this on the kiosk at <strong>/kiosk.html</strong>, after
                    signing in there once. It stops working the moment it is used.
                  </p>
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
            <p className="ew-hint" style={{ marginTop: 10 }}>
              {past.length} machine{past.length === 1 ? '' : 's'} signed out.
              Nothing they recorded was removed.
            </p>
          )}

          <div className="ew-actions" style={{ marginTop: 10 }}>
            <button type="button" className="ew-btn ew-btn-primary ew-btn-sm" disabled={busy} onClick={add}>
              {busy ? 'Creating…' : live.some(d => d.link_code) ? 'Create another code' : 'Link a site kiosk'}
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="ew-msg ew-msg-error" style={{ marginTop: 9 }}>
          {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}
    </div>
  )
}
