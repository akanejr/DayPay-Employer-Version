/* DayPay Employer Version — open and close attendance.
 *
 * The employer's half of the daily code. They open attendance in the morning,
 * the workers are told the code at the workplace, and the code dies at the end
 * of the employer's own local day.
 *
 * Design decisions worth stating:
 *
 *   - The code is displayed LARGE and monospaced, because its entire job is to
 *     be read out loud across a noisy site or copied onto a board. Anything
 *     smaller or more decorative would be a worse product.
 *
 *   - Reopening rotates the code. Closing is therefore real: once closed, the
 *     old number is dead for good, so a code photographed on Monday cannot be
 *     replayed later in the week.
 *
 *   - The expiry shown is the employer's own end-of-day, not midnight UTC. The
 *     database runs in UTC and has no idea where the employer is; the browser
 *     does, so the browser decides and sends an absolute instant.
 *
 *   - The employer never marks anyone present here. They open the door; the
 *     workers walk through it. Marking on someone's behalf stays on Mark days.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  EmployerError, todaysSession, openAttendance, closeAttendance,
  sessionState, timeLeftLabel,
} from '../lib/employer'
import { Loading } from '../ui/Ui.jsx'

export default function AttendancePanel({ contractors, onChanged }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [pickFor, setPickFor] = useState(null)   // contractor id, or 'site'
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    setError(null)
    try { setSession(await todaysSession(pickFor === 'site' ? null : pickFor)) }
    catch (e) { setError(e instanceof EmployerError ? e : new EmployerError(String(e))) }
    finally { setLoading(false) }
  }, [pickFor])

  useEffect(() => { load() }, [load])

  /* A countdown is only useful if it moves. Ticking once a minute is enough —
     the label is coarse on purpose, so a second-by-second update would be
     motion without information. */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  const state = sessionState(session, now)
  const active = contractors.filter(c => c.status === 'active')

  async function open() {
    setBusy(true); setError(null)
    try {
      const s = await openAttendance(pickFor === 'site' ? null : pickFor, undefined, undefined)
      setSession(s)
      await onChanged?.()
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally { setBusy(false) }
  }

  async function close() {
    setBusy(true); setError(null)
    try {
      await closeAttendance(session.id)
      await load()
      await onChanged?.()
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally { setBusy(false) }
  }

  /* Don't copy a dead code. Once it has expired or been closed, the number on
     screen is history, and pasting it into a group chat would send people to a
     code that cannot work. */
  function share() {
    const who = pickFor === 'site'
      ? 'today’s attendance'
      : `${active.find(c => c.id === pickFor)?.name || 'your contractor'}`
    const text = `${who} is open today. Code: ${session.code}\nOpen DayPay, tap My work, and enter it.`
    if (navigator.share) {
      navigator.share({ text }).catch(() => {})
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(session.code).catch(() => {})
    }
  }

    if (loading) return <Loading label="Loading attendance…" shape="panel" />

  return (
    <section className="ew-card">
      <div className="ew-board-head">
        <div>
          <div className="ew-board-label">Attendance</div>
          <div className="ew-board-date" style={{ fontSize: 14.5 }}>
            {pickFor === 'site'
              ? 'Whole site'
              : active.find(c => c.id === pickFor)?.name || 'Whole site'}
          </div>
        </div>
        {state === 'open' && (
          <span className="ew-chip ew-chip-live">open · {timeLeftLabel(session.expires_at, now)}</span>
        )}
        {state === 'closed' && <span className="ew-chip">closed</span>}
        {state === 'expired' && <span className="ew-chip ew-chip-warn">expired</span>}
      </div>

      {error && (
        <div className="ew-msg ew-msg-error dp-mt-12">
          {error.message}
          <button type="button" className="ew-linkbtn dp-ml-8" onClick={load}>Retry</button>
        </div>
      )}

      {/* Which contractor's attendance is being opened. Only worth showing once
          a contractor exists — before that there is nothing to choose. */}
      {active.length > 0 && (
        <div className="ew-att-pick">
          <button
            type="button"
            className={`ew-kindchip${pickFor === 'site' ? ' active' : ''}`}
            onClick={() => setPickFor('site')}
          >
            Whole site
          </button>
          {active.map(c => (
            <button
              key={c.id}
              type="button"
              className={`ew-kindchip${pickFor === c.id ? ' active' : ''}`}
              onClick={() => setPickFor(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {state === 'open' ? (
        <>
          <div className="ew-codebox">
            <div className="ew-code-label">Today’s code</div>
            <div className="ew-code-big">{session.code}</div>
            <div className="ew-code-sub">
              Say this out loud, or write it where the crew can see it.
              It stops working at the end of the day.
            </div>
          </div>

          <div className="ew-att-actions">
            <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm" onClick={share}>
              Share code
            </button>
            <button
              type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
              disabled={busy} onClick={open}
            >
              {busy ? '…' : 'New code'}
            </button>
            <button
              type="button" className="ew-btn ew-btn-secondary ew-btn-sm"
              disabled={busy} onClick={close}
            >
              {busy ? '…' : 'Close attendance'}
            </button>
          </div>

          <p className="ew-dash-foot">
            Workers who are linked to your roster can enter this code to record
            today themselves. It proves nothing on its own — anyone standing on
            site can read it — but it is what keeps yesterday’s code from
            working tomorrow, and keeps one contractor’s code out of another’s.
          </p>
        </>
      ) : (
        <>
          <p className="ew-dash-note dp-mt-12">
            {state === 'closed'
              ? 'Attendance is closed. Opening it again issues a new code — the old one stops working.'
              : state === 'expired'
                ? 'Yesterday’s session has ended. Open attendance to issue today’s code.'
                : 'Not open yet. Open attendance so your workers can record today themselves.'}
          </p>

          {/* §39: this is the SECOND thing an employer might do on Today, and it
              sits beside "Record today's work". Two filled green buttons on one
              screen is the "what am I supposed to press?" the redesign set out to
              remove, and the product's own rule (asserted on People and on
              Contractors) is one filled action per screen. The outlined green is
              the same button at second rank — same handler, same words. */}
          <button
            type="button" className="ew-btn ew-btn-accent dp-mt-12" style={{ alignSelf: 'flex-start' }}
            disabled={busy} onClick={open}
          >
            {busy ? 'Opening…' : state === 'none' ? 'Open attendance' : 'Open again with a new code'}
          </button>
        </>
      )}
    </section>
  )
}
