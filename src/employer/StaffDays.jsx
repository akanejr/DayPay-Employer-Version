/* DayPay Employer Version — mark staff days.
 *
 * The daily job. An employer picks a date and marks who worked; each tap is
 * saved immediately, so nothing is lost if the phone locks or the browser
 * closes.
 *
 * Design decisions worth stating:
 *
 *   - The kind follows the DATE, not the tap. Marking someone present on a
 *     Saturday records weekend work, because that earns the multiplier.
 *     Recording a plain workday there would underpay them.
 *
 *   - Days are saved as 'claimed', not 'confirmed'. An employer mis-tapping
 *     during the month can simply fix it; confirmation is a deliberate
 *     month-end act, and a confirmed day's amount is frozen by the database.
 *
 *   - No rate or amount is ever sent. The server values each day from the rate
 *     period in force on that date. The figure shown here is read back from
 *     the saved row, not calculated locally.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, listAllMonth, setDay, clearDay,
  formatNaira, initials, todayKey, shiftDateKey, suggestedKind,
  prettyDateKey, monthBounds, KIND_LABELS,
} from '../lib/employer'
import { monthLabelFor } from '../lib/employerLogic'

const KINDS = ['work', 'overtime', 'holiday', 'leave']

// ── Date stepper ────────────────────────────────────────────────────────────

function DateBar({ value, onChange, busy }) {
  const isToday = value === todayKey()
  return (
    <div className="ew-datebar">
      <button
        type="button" className="ew-datebar-step" aria-label="Previous day"
        onClick={() => onChange(shiftDateKey(value, -1))} disabled={busy}
      >‹</button>

      <div className="ew-datebar-mid">
        <div className="ew-datebar-day">{prettyDateKey(value)}</div>
        {!isToday && (
          <button type="button" className="ew-datebar-today" onClick={() => onChange(todayKey())} disabled={busy}>
            Jump to today
          </button>
        )}
      </div>

      <button
        type="button" className="ew-datebar-step" aria-label="Next day"
        onClick={() => onChange(shiftDateKey(value, 1))} disabled={busy}
      >›</button>
    </div>
  )
}

// ── One employee, one day ───────────────────────────────────────────────────

/* The trade and the contractor, under the name.
 *
 * WHY THIS EXISTS. This is the only screen that writes attendance into the
 * ledger, and it listed people by name alone. Two workers called James — one a
 * Welder under Topher, one an Electric under Eddimore, both active, both with
 * days recorded that month — rendered as:
 *
 *     [JA] James        [JA] James
 *          not marked        not marked
 *
 * Identical. initials('James') is 'JA' for both, because a one-word name gives
 * its first two letters. Marking the wrong row is not a cosmetic slip: it puts
 * a paid day against the wrong person, under the wrong contractor, and it
 * surfaces a month later in that contractor's invoice. The employer cannot tell
 * from this screen which James is standing in front of them.
 *
 * Every other screen already shows the job title — Today, Roster, the
 * contractor list, the worker detail, even invoice lines. This one did not,
 * which is why the gap survived: it looked handled everywhere else.
 *
 * The contractor name is what settles it, since two workers can share a trade
 * but the money belongs to a contractor. 'Unassigned' is spelled out rather
 * than left blank, because an empty line reads as missing data. */
function whoLabel(employee, contractorName) {
  const parts = []
  if (employee.job_title) parts.push(employee.job_title)
  parts.push(contractorName || 'Unassigned')
  return parts.join(' · ')
}

function DayRow({ employee, contractorName, record, kind, busy, onToggle, onKind }) {
  const marked = !!record
  const shownKind = record?.kind || kind

  return (
    <div className={`ew-dayrow${marked ? ' is-marked' : ''}`}>
      <div className="ew-avatar">{initials(employee.full_name)}</div>

      <div className="ew-dayrow-body">
        <div className="ew-name">{employee.full_name}</div>
        <div className="ew-mini-sub">{whoLabel(employee, contractorName)}</div>
        <div className="ew-meta">
          {marked ? (
            <>
              <span className="ew-chip ew-chip-live">{KIND_LABELS[record.kind] || record.kind}</span>
              <span className="ew-rate">{formatNaira(record.amount)}</span>
              {record.status === 'confirmed' && <span className="ew-chip">confirmed</span>}
              {record.status === 'disputed' && <span className="ew-chip ew-chip-warn">disputed</span>}
            </>
          ) : (
            <span className="ew-muted">not marked</span>
          )}
        </div>

        {/* Only shown once marked — changing the kind is the less common act. */}
        {marked && record.status !== 'confirmed' && (
          <div className="ew-kinds">
            {KINDS.map(k => (
              <button
                key={k}
                type="button"
                className={`ew-kindchip${record.kind === k ? ' active' : ''}`}
                disabled={busy}
                onClick={() => onKind(k)}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className={`ew-toggle${marked ? ' is-on' : ''}`}
        disabled={busy || (marked && record.status === 'confirmed')}
        onClick={onToggle}
        title={marked && record.status === 'confirmed' ? 'Confirmed — reopen it first' : undefined}
      >
        {busy ? '…' : marked ? 'Undo' : 'Mark'}
      </button>
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function StaffDays({ employees, contractors }) {
  const [date, setDate] = useState(todayKey())
  const [monthDays, setMonthDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const active = useMemo(
    () => (employees || []).filter(e => e.status === 'active'),
    [employees],
  )

  /* id -> name, so a row can say who the money belongs to. Built from the
     contractor list the workspace already loaded; no new query. */
  const contractorNames = useMemo(() => {
    const map = new Map()
    for (const c of contractors || []) map.set(c.id, c.name)
    return map
  }, [contractors])

  const [viewYear, viewMonth] = useMemo(() => {
    const [y, m] = date.split('-').map(Number)
    return [y, m - 1]
  }, [date])

  const load = useCallback(async () => {
    setError(null)
    try {
      const days = await listAllMonth(viewYear, viewMonth)
      setMonthDays(days || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [viewYear, viewMonth])

  useEffect(() => { load() }, [load])

  // What is already saved for the selected date, keyed by employee.
  const byEmployee = useMemo(() => {
    const m = new Map()
    for (const d of monthDays) if (d.work_date === date) m.set(d.employee_id, d)
    return m
  }, [monthDays, date])

  const kindForDate = suggestedKind(date)

  /* Optimistically update, then reconcile with the row the server returns.
     The server is the authority on the amount, so whatever comes back wins. */
  function applyLocal(employeeId, saved) {
    setMonthDays(prev => {
      const without = prev.filter(
        d => !(d.employee_id === employeeId && d.work_date === date),
      )
      return saved ? [...without, saved] : without
    })
  }

  async function toggle(employee) {
    setBusyId(employee.id)
    setError(null)
    setNotice(null)
    const existing = byEmployee.get(employee.id)
    try {
      if (existing) {
        await clearDay(employee.id, date)
        applyLocal(employee.id, null)
      } else {
        const saved = await setDay(employee.id, date, kindForDate)
        applyLocal(employee.id, saved)
      }
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusyId(null)
    }
  }

  async function setKind(employee, kind) {
    setBusyId(employee.id)
    setError(null)
    try {
      const saved = await setDay(employee.id, date, kind, {
        leaveType: kind === 'leave' ? 'annual' : null,
        leavePercent: kind === 'leave' ? 100 : 0,
      })
      applyLocal(employee.id, saved)
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusyId(null)
    }
  }

  /* Marks everyone not already marked. Sequential and per-person on purpose:
     each day is separately audited, and a partial failure should leave the
     successful ones saved rather than rolling the batch back. */
  async function markAllPresent() {
    const pending = active.filter(e => !byEmployee.get(e.id))
    if (!pending.length) { setNotice('Everyone is already marked for this day.'); return }
    setBulkBusy(true)
    setError(null)
    setNotice(null)
    let done = 0
    const failures = []
    for (const emp of pending) {
      try {
        const saved = await setDay(emp.id, date, kindForDate)
        applyLocal(emp.id, saved)
        done += 1
      } catch (e) {
        failures.push(`${emp.full_name}: ${e.message}`)
      }
    }
    setBulkBusy(false)
    if (failures.length) setError(new EmployerError(`${done} marked, ${failures.length} failed.`, { hint: failures.join(' · ') }))
    else setNotice(`${done} ${done === 1 ? 'person' : 'people'} marked for ${prettyDateKey(date)}.`)
  }

  // ── Month running total, from saved rows only ──
  const monthTotal = useMemo(
    () => monthDays.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    [monthDays],
  )
  const monthUnconfirmed = useMemo(
    () => monthDays.filter(d => d.status === 'claimed').length,
    [monthDays],
  )
  const { from, to } = monthBounds(viewYear, viewMonth)
  /* monthLabelFor, not toLocaleString: the same "September 2026" on every
     device, from the same table the Billing period uses. toLocaleString
     depends on the runtime's locale data, which is not something this app can
     promise is present. */
  const monthName = monthLabelFor(viewYear, viewMonth)

  if (!active.length) {
    return (
      <div className="ew-empty">
        <div className="ew-empty-title">No one to mark yet</div>
        <p className="ew-empty-body">
          Add people to your roster first, then come back here to mark their days.
        </p>
      </div>
    )
  }

  return (
    <>
      <p className="ew-pane-note">
        Use this to record a day on someone’s behalf — a correction, a backdated
        day, or a worker whose phone isn’t to hand. Everyone’s own days are the
        normal path; treating this page as the daily routine is how a roster gets
        marked present without anyone checking.
      </p>

      <DateBar value={date} onChange={setDate} busy={bulkBusy} />

      <div className="ew-strip">
        <span className="ew-strip-day">
          {kindForDate === 'weekend' ? 'Weekend rate applies' : 'Weekday'}
        </span>
        <button
          type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
          onClick={markAllPresent} disabled={bulkBusy || loading}
        >
          {bulkBusy ? 'Marking…' : 'Mark all present'}
        </button>
      </div>

      {notice && <div className="ew-msg ew-msg-ok">{notice}</div>}

      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}
          {error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      {loading ? (
        <div className="ew-loading">Loading {monthName}…</div>
      ) : (
        active.map(e => (
          <DayRow
            key={e.id}
            employee={e}
            contractorName={contractorNames.get(e.contractor_id)}
            record={byEmployee.get(e.id)}
            kind={kindForDate}
            busy={busyId === e.id}
            onToggle={() => toggle(e)}
            onKind={k => setKind(e, k)}
          />
        ))
      )}

      {!loading && monthDays.length > 0 && (
        <div className="ew-card ew-monthfoot">
          <div className="ew-monthfoot-row">
            <span>{monthName}</span>
            <strong>{formatNaira(monthTotal)}</strong>
          </div>
          <div className="ew-sub">
            {monthDays.length} {monthDays.length === 1 ? 'record' : 'records'}
            {monthUnconfirmed > 0 && ` · ${monthUnconfirmed} awaiting confirmation`}
          </div>
          <div className="ew-hint" style={{ marginTop: 6 }}>
            {from} to {to}. Amounts are what the server stored on each day, not
            recalculated from today's rate.
          </div>
        </div>
      )}
    </>
  )
}
