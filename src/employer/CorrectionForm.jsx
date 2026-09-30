/* DayPay Employer Version — a worker asking for a day to be corrected.
 *
 * This is the whole of a worker's write access to their own record. They fill
 * in a form; the database stores a REQUEST. Nothing here can change a day, and
 * nothing here wants to — that is what makes Phase 5's rule ("the workplace
 * record is read-only for the worker") and the brief's rule ("an employee can
 * request a correction") true at the same time.
 *
 * Three answers, and only ever three, because they are exactly the three moves
 * the employer already has: remove a day, change its kind, add a day. A request
 * asking for something the employer could not do would just be a message in a
 * box.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useState } from 'react'
import {
  EmployerError, requestCorrection, CORRECTION_CHOICES, KIND_LABELS,
  prettyDateKey, shiftDateKey, todayKey,
} from '../lib/employer'

const KINDS = ['work', 'weekend', 'overtime', 'holiday', 'leave']

/* `mode` is 'day' when the request is about a day that already exists, and
   'missing' when the worker is claiming a day nobody recorded — the one case
   with no row to hang a button on, so it asks for a date instead. */
export default function CorrectionForm({
  employee, dateKey = null, currentKind = null, mode = 'day', onDone, onCancel,
}) {
  const [choice, setChoice] = useState(mode === 'missing' ? 'missing' : null)
  /* A different kind from the one already recorded, because "the type of day
     is wrong" cannot mean "it is what it already says". Overtime for a plain
     working day is the correction that actually gets raised on a site; every
     other starting point is one tap away. */
  const [wantKind, setWantKind] = useState(currentKind === 'work' ? 'overtime' : 'work')
  const [leaveType, setLeaveType] = useState('annual')
  const [leavePercent, setLeavePercent] = useState('50')
  const [message, setMessage] = useState('')
  const [when, setWhen] = useState(dateKey || todayKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const isMissing = mode === 'missing' || choice === 'missing'

  async function submit(e) {
    e.preventDefault()
    if (!choice) { setError(new EmployerError('Choose what is wrong with the day.')); return }
    setBusy(true); setError(null)
    try {
      await requestCorrection(employee.id, when, {
        requestKind: choice,
        wantKind: choice === 'reclassify' ? wantKind : null,
        leaveType: choice === 'reclassify' && wantKind === 'leave' ? leaveType : null,
        leavePercent: choice === 'reclassify' && wantKind === 'leave' ? Number(leavePercent) || 0 : 0,
        message,
      })
      onDone?.()
    } catch (err) {
      setError(err instanceof EmployerError ? err : new EmployerError(String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ew-card ew-corr-form" onSubmit={submit}>
      <h3 className="ew-title">
        {isMissing ? 'Ask for a missing day' : 'Ask for a correction'}
      </h3>

      {!isMissing && (
        <p className="ew-sub">
          {prettyDateKey(when)}
          {currentKind ? ` · recorded as ${(KIND_LABELS[currentKind] || currentKind).toLowerCase()}` : ''}
        </p>
      )}

      {isMissing && (
        <div className="ew-field">
          <label className="ew-label" htmlFor="corr-date">Which day did you work?</label>
          <div className="ew-datestep">
            <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
              onClick={() => setWhen(shiftDateKey(when, -1))} disabled={busy}>‹</button>
            <input id="corr-date" className="ew-input" type="date" value={when}
              max={todayKey()} onChange={e => setWhen(e.target.value)} disabled={busy} />
            <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
              onClick={() => setWhen(shiftDateKey(when, 1))}
              disabled={busy || when >= todayKey()}>›</button>
          </div>
        </div>
      )}

      <div className="ew-field">
        <span className="ew-label">What is wrong?</span>
        <div className="ew-choice-list">
          {CORRECTION_CHOICES.filter(c => mode !== 'day' || c.value !== 'missing').map(c => (
            <button
              key={c.value}
              type="button"
              className={`ew-choice${choice === c.value ? ' is-chosen' : ''}`}
              onClick={() => setChoice(c.value)}
              disabled={busy}
            >
              <span className="ew-choice-label">{c.label}</span>
              <span className="ew-choice-hint">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {choice === 'reclassify' && (
        <div className="ew-field">
          <label className="ew-label" htmlFor="corr-kind">It should be recorded as</label>
          <select id="corr-kind" className="ew-input" value={wantKind}
            onChange={e => setWantKind(e.target.value)} disabled={busy}>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k] || k}</option>)}
          </select>

          {wantKind === 'leave' && (
            <div className="ew-inline-fields">
              <label className="ew-label" htmlFor="corr-leave-type">Leave type</label>
              <input id="corr-leave-type" className="ew-input" value={leaveType}
                onChange={e => setLeaveType(e.target.value)} disabled={busy} />
              <label className="ew-label" htmlFor="corr-leave-pct">Paid percentage</label>
              <input id="corr-leave-pct" className="ew-input" type="number" min="0" max="100"
                value={leavePercent} onChange={e => setLeavePercent(e.target.value)} disabled={busy} />
            </div>
          )}
        </div>
      )}

      <div className="ew-field">
        <label className="ew-label" htmlFor="corr-msg">Anything to add? (optional)</label>
        <textarea id="corr-msg" className="ew-input" rows={2} value={message} maxLength={300}
          onChange={e => setMessage(e.target.value)} disabled={busy}
          placeholder="Your employer will read this." />
      </div>

      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      <div className="ew-corr-actions">
        <button type="button" className="ew-btn ew-btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {/* Deliberately NOT disabled when no reason is chosen. A disabled
            button with no explanation leaves a worker tapping a dead control;
            the guard in submit() answers them in words instead. */}
        <button type="submit" className="ew-btn ew-btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send to my employer'}
        </button>
      </div>

      <p className="ew-hint">
        This asks your employer to change the record. It does not change it
        itself — they will see your request and answer it.
      </p>
    </form>
  )
}
