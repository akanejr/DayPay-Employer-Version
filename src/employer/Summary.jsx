/* DayPay Employer Version — month-end summary.
 *
 * Answers the employer's actual question: "what do I owe, and can I prove it?"
 *
 * Two things this screen deliberately does NOT do:
 *
 *   1. It never recalculates amounts from a rate. Every figure is the stored
 *      `amount` on the day. If a rate changed mid-month, the individual days
 *      keep what they were worked at and the total reflects that. Recomputing
 *      from today's rate is the exact error DayPay exists to prevent.
 *
 *   2. It never confirms silently. Confirming freezes a day's money in the
 *      database — the trigger refuses to change it afterwards. That is a
 *      deliberate act and the UI asks for it explicitly.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, listAllMonth, confirmDay, reopenDay, disputeDay,
  summarise, formatNaira, initials, monthBounds, monthLabelFor,
  buildMonthCsv, KIND_LABELS,
} from '../lib/employer'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── One employee's line in the payroll ──────────────────────────────────────

function PayRow({ row, onConfirm, onReopen, busy }) {
  const [open, setOpen] = useState(false)
  const { employee, total, days, worked, leave, claimed, confirmed, disputed } = row

  return (
    <div className="ew-pay">
      <button
        type="button" className="ew-pay-head"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <div className="ew-avatar">{initials(employee.full_name)}</div>

        <div className="ew-pay-body">
          <div className="ew-name">{employee.full_name}</div>
          <div className="ew-meta">
            <span>{days} {days === 1 ? 'day' : 'days'}</span>
            {leave > 0 && <span>· {leave} leave</span>}
            {claimed > 0 && <span className="ew-chip ew-chip-warn">{claimed} unconfirmed</span>}
            {disputed > 0 && <span className="ew-chip ew-chip-warn">{disputed} disputed</span>}
            {claimed === 0 && disputed === 0 && days > 0 && <span className="ew-chip ew-chip-live">all confirmed</span>}
          </div>
        </div>

        <div className="ew-pay-amount">
          <span className="ew-pay-figure">{formatNaira(total)}</span>
          <span className="ew-pay-chev">{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div className="ew-pay-detail">
          {worked > 0 && (
            <div className="ew-pay-line">
              <span>Worked days</span><span>{worked}</span>
            </div>
          )}
          {leave > 0 && (
            <div className="ew-pay-line">
              <span>Leave days</span><span>{leave}</span>
            </div>
          )}
          <div className="ew-pay-line">
            <span>Confirmed</span><span>{confirmed} of {days}</span>
          </div>

          <div className="ew-pay-actions">
            {claimed > 0 && (
              <button
                type="button" className="ew-btn ew-btn-primary ew-btn-sm"
                disabled={busy} onClick={() => onConfirm(row)}
              >
                Confirm {claimed} {claimed === 1 ? 'day' : 'days'}
              </button>
            )}
            {confirmed > 0 && (
              <button
                type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                disabled={busy} onClick={() => onReopen(row)}
                title="Unlock these days so they can be corrected"
              >
                Reopen {confirmed}
              </button>
            )}
          </div>

          <p className="ew-hint" style={{ marginTop: 8 }}>
            Confirming freezes these amounts. Reopening is recorded in the
            audit trail.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function Summary({ employees }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [showDisputed, setShowDisputed] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await listAllMonth(year, month)
      setDays(rows || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => summarise(days, employees), [days, employees])
  const label = monthLabelFor(year, month)
  const { from, to } = monthBounds(year, month)

  const disputedDays = useMemo(
    () => days.filter(d => d.status === 'disputed'),
    [days],
  )

  function stepMonth(delta) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
    setNotice(null)
  }

  async function runBulk(pending, action) {
    setBusy(true)
    setError(null)
    setNotice(null)
    let done = 0
    const failures = []
    for (const d of pending) {
      try {
        await action(d)
        done += 1
      } catch (e) {
        failures.push(e.message)
      }
    }
    await load()
    setBusy(false)
    if (failures.length) {
      setError(new EmployerError(
        `${done} of ${pending.length} saved.`,
        { hint: failures.slice(0, 3).join(' · ') },
      ))
    } else {
      setNotice(`${done} ${done === 1 ? 'day' : 'days'} saved.`)
    }
  }

  const confirmEmployee = row => {
    const pending = days.filter(d => d.employee_id === row.employee.id && d.status === 'claimed')
    runBulk(pending, d => confirmDay(d.id))
  }

  const reopenEmployee = row => {
    const done = days.filter(d => d.employee_id === row.employee.id && d.status === 'confirmed')
    runBulk(done, d => reopenDay(d.id))
  }

  const confirmEverything = async () => {
    setConfirmTarget(null)
    const pending = days.filter(d => d.status === 'claimed')
    await runBulk(pending, d => confirmDay(d.id))
  }

  const allPending = days.filter(d => d.status === 'claimed')
  const disputedOf = id => disputedDays.filter(d => d.employee_id === id)

  return (
    <>
      <div className="ew-monthbar">
        <button type="button" className="ew-datebar-step" aria-label="Previous month" onClick={() => stepMonth(-1)} disabled={busy}>‹</button>
        <div className="ew-datebar-mid">
          <div className="ew-datebar-day">{label}</div>
        </div>
        <button type="button" className="ew-datebar-step" aria-label="Next month" onClick={() => stepMonth(1)} disabled={busy}>›</button>
      </div>

      {notice && <div className="ew-msg ew-msg-ok">{notice}</div>}
      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}
          {error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      {loading ? (
        <div className="ew-loading">Loading {label}…</div>
      ) : (
        <>
          <div className="ew-owe">
            <div className="ew-owe-label">You owe for {label}</div>
            <div className="ew-owe-figure">{formatNaira(stats.total)}</div>
            <div className="ew-owe-sub">
              {stats.staffCount === 0
                ? 'No days recorded this month'
                : `${stats.staffCount} ${stats.staffCount === 1 ? 'person' : 'people'} · ${days.length} ${days.length === 1 ? 'day' : 'days'} recorded`}
            </div>
            {(stats.unconfirmed > 0 || stats.disputed > 0) && (
              <div className="ew-owe-flags">
                {stats.unconfirmed > 0 && <span className="ew-chip ew-chip-warn">{stats.unconfirmed} unconfirmed</span>}
                {stats.disputed > 0 && <span className="ew-chip ew-chip-warn">{stats.disputed} disputed</span>}
              </div>
            )}
          </div>

          {stats.unmatchedDays > 0 && (
            <div className="ew-msg ew-msg-warn">
              {stats.unmatchedDays} {stats.unmatchedDays === 1 ? 'day belongs' : 'days belong'} to someone no longer on your roster, worth {formatNaira(stats.unmatchedTotal)}.
              <span className="ew-msg-hint">
                Included in the total above — otherwise you would underpay.
                Restore the person on the Roster tab to see the detail.
              </span>
            </div>
          )}

          {stats.rows.length === 0 && (
            <div className="ew-empty">
              <div className="ew-empty-title">Nothing recorded in {label}</div>
              <p className="ew-empty-body">
                Head to Mark days and tap who worked. Amounts appear here as you go.
              </p>
            </div>
          )}

          {stats.rows.map(row => (
            <div key={row.employee.id}>
              <PayRow
                row={row}
                busy={busy}
                onConfirm={confirmEmployee}
                onReopen={reopenEmployee}
              />
              {disputedOf(row.employee.id).length > 0 && (
                <div className="ew-disputed">
                  {disputedOf(row.employee.id).map(d => (
                    <div className="ew-disputed-row" key={d.id}>
                      <span>{d.work_date} · {KIND_LABELS[d.kind] || d.kind} · {formatNaira(d.amount)}</span>
                      <button
                        type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                        disabled={busy}
                        onClick={() => runBulk([d], x => disputeDay(x.id, null).then(() => reopenDay(x.id)))}
                      >
                        Clear dispute
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {(allPending.length > 0 || days.length > 0) && (
            <div className="ew-monthend">
              {confirmTarget ? (
                <div className="ew-msg ew-msg-warn">
                  Confirm all {allPending.length} unconfirmed {allPending.length === 1 ? 'day' : 'days'} for {label}?
                  <span className="ew-msg-hint">
                    This freezes {formatNaira(stats.total)} in the database. Individual
                    amounts can afterwards only be changed by reopening that day.
                  </span>
                  <div className="ew-confirm-actions">
                    <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm" onClick={() => setConfirmTarget(null)}>Cancel</button>
                    <button type="button" className="ew-btn ew-btn-primary ew-btn-sm" onClick={confirmEverything}>Yes, confirm all</button>
                  </div>
                </div>
              ) : allPending.length > 0 ? (
                <button
                  type="button" className="ew-btn ew-btn-primary"
                  style={{ width: '100%' }}
                  disabled={busy} onClick={() => setConfirmTarget(true)}
                >
                  Confirm all {allPending.length} for {label}
                </button>
              ) : days.length > 0 ? (
                <div className="ew-msg ew-msg-ok">
                  All {days.length} days in {label} are confirmed and frozen.
                </div>
              ) : null}

              {days.length > 0 && (
                <button
                  type="button" className="ew-btn ew-btn-ghost"
                  style={{ width: '100%' }}
                  onClick={() => download(
                    `DayPay_${label.replace(' ', '-')}.csv`,
                    buildMonthCsv(days, employees, { monthLabel: label }),
                  )}
                >
                  Download CSV
                </button>
              )}
            </div>
          )}

          {disputedDays.length > 0 && (
            <button
              type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setShowDisputed(v => !v)}
            >
              {showDisputed ? 'Hide' : `Show ${disputedDays.length} disputed ${disputedDays.length === 1 ? 'day' : 'days'}`}
            </button>
          )}

          <p className="ew-hint" style={{ textAlign: 'center', marginTop: 4 }}>
            {from} to {to} · every figure is the amount stored on the day it was
            worked, never recalculated from a later rate.
          </p>
        </>
      )}
    </>
  )
}
