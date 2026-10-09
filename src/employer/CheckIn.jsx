/* DayPay Employer Version — the worker's check-in.
 *
 * The brief's flow, in order:
 *
 *   Did you come to work today?
 *     -> Enter today's workplace code
 *     -> the day is recorded, or one of three specific refusals
 *
 * Design decisions worth stating:
 *
 *   - The code is never shown here. The worker has to get it from the
 *     workplace, which is the entire verification mechanism. If the app could
 *     display it, the app would be the loophole.
 *
 *   - A wrong code is an ordinary event, not an error state. It happens every
 *     day on a real site, so it reads as a sentence and the box stays filled in
 *     for a retry. Nothing is destroyed, nothing is logged as a crash.
 *
 *   - "Not open yet" and "already closed" are different messages on purpose:
 *     one means wait, the other means go and find somebody.
 *
 *   - The success state is deliberately calm — a check and the day's figure.
 *     A worker checks in on a phone, outdoors, in a hurry.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EmployerError, myAttendanceStatus, checkIn, formatNaira,
  attendancePrompt, isValidCodeShape, prettyDateKey, KIND_LABELS,
} from '../lib/employer'
import { Loading } from '../ui/Ui.jsx'

export default function CheckIn({ employee, onRecorded }) {
    const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  /* A load that failed used to be swallowed: `catch { setStatus(null) }` left the
     screen saying "no session is open today", which is a statement about the
     employer's site made by a screen that never reached the database. (Phase 14.) */
  const [loadError, setLoadError] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)     // { ok, message, day, already }
  const inputRef = useRef(null)

    const load = useCallback(async () => {
    setLoadError(null)
    try { setStatus(await myAttendanceStatus()) }
    catch (e) {
      setStatus(null)
      setLoadError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const prompt = attendancePrompt(status)
  const canSubmit = isValidCodeShape(code) && !busy

  async function submit(e) {
    e?.preventDefault?.()
    if (!canSubmit) return

    setBusy(true)
    setResult(null)
    try {
      const out = await checkIn(code)
      setResult(out)
      if (out.ok) {
        setCode('')
        // The day has changed, so what the parent shows is now out of date.
        onRecorded?.()
      } else {
        // Keep the digits so a single wrong digit can be fixed rather than
        // retyped — within the five attempts the server allows.
        inputRef.current?.focus()
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof EmployerError ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

        if (loading) return <Loading label="Checking today’s attendance…" shape="panel" />

      /* The one state that must never be dressed up as an answer. "We could not tell
         you" is not "there is nothing today". */
      if (loadError) {
        return (
          <div className="ew-card">
            <div className="ew-checkin-q">Could not check today’s attendance</div>
            <p className="ew-checkin-sub dp-mt-8">
              {loadError.message}
              {loadError.hint ? ` ${loadError.hint}` : ''}
            </p>
            <button
              type="button" className="ew-btn ew-btn-ghost ew-btn-sm dp-mt-12"
              onClick={() => { setLoading(true); load() }}
            >
              Try again
            </button>
          </div>
        )
      }

  // ── Already recorded today ────────────────────────────────────────────────
  if (result?.ok) {
    const day = result.day
    return (
      <div className="ew-card ew-checkin-done">
        <div className="ew-checkin-tick" aria-hidden="true">✓</div>
        <div className="ew-checkin-title">
          {result.already ? 'Already recorded' : 'Attendance recorded'}
        </div>
        <p className="ew-checkin-sub">
          {prettyDateKey(day.work_date)} · {KIND_LABELS[day.kind] || day.kind}
          {day.amount ? ` · ${formatNaira(day.amount)}` : ''}
        </p>
        {result.already && (
          <p className="ew-checkin-note">
            Someone had already recorded this day — nothing was changed.
          </p>
        )}
        <button
          type="button" className="ew-btn ew-btn-ghost ew-btn-sm dp-mt-12"
          onClick={() => { setResult(null); load() }}
        >
          Done
        </button>
      </div>
    )
  }

  // ── Attendance not open, or finished ─────────────────────────────────────
  if (prompt.tone !== 'open') {
    return (
      <div className="ew-card">
        <div className="ew-checkin-q">{prompt.title}</div>
        <p className="ew-checkin-sub dp-mt-8">{prompt.body}</p>
        <button
          type="button" className="ew-btn ew-btn-ghost ew-btn-sm dp-mt-12"
          onClick={load}
        >
          Check again
        </button>
      </div>
    )
  }

  // ── The question ──────────────────────────────────────────────────────────
  return (
    <form className="ew-card" onSubmit={submit}>
      <div className="ew-checkin-q">
        {employee?.full_name ? `Did you come to work today, ${employee.full_name.split(' ')[0]}?` : 'Did you come to work today?'}
      </div>
      <p className="ew-checkin-sub dp-mt-4">
        {status?.contractor_name
          ? `Enter today’s workplace code for ${status.contractor_name}.`
          : 'Enter today’s workplace code. Your employer has it.'}
      </p>

      <div className="ew-code-entry">
        <input
          ref={inputRef}
          className="ew-code-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={4}
          placeholder="0000"
          aria-label="Today's workplace code"
          value={code}
          disabled={busy}
          onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        />
        <button type="submit" className="ew-btn ew-btn-primary" disabled={!canSubmit}>
          {busy ? 'Checking…' : 'Record'}
        </button>
      </div>

      {result && !result.ok && (
        <div className="ew-checkin-refusal" role="alert">
          <span className="ew-checkin-x" aria-hidden="true">✕</span>
          <span>{result.message}</span>
        </div>
      )}

      <p className="ew-dash-foot">
        The code changes every day and only works today. Ask your employer or
        whoever opened the site.
      </p>
    </form>
  )
}
