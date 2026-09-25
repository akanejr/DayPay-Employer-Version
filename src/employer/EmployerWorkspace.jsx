/* DayPay Employer Version — employer workspace.
 *
 * Container for the employer-side screens. Kept separate from App.jsx on
 * purpose: that file is already 3,000+ lines of employee-side logic, and the
 * employer side has a different shape (many people, one viewer) so mixing them
 * would make both harder to reason about.
 *
 * Screens:
 *   Staff   — the roster, pay rates, archives           (built)
 *   Month   — mark days for staff                       (next)
 *   Summary — what you owe this month                   (next)
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, ensureEmployer, listEmployees, createEmployee, updateEmployee,
  archiveEmployee, restoreEmployee, listAllRatePeriods, addRatePeriod,
  deleteRatePeriod, rateOn, formatNaira, initials, todayKey,
  issueInviteCode, myRoles,
} from '../lib/employer'
import Dashboard from './Dashboard'
import StaffDays from './StaffDays'
import Summary from './Summary'
import EmployeeView from './EmployeeView'
import './employer.css'

// ── Small helpers ───────────────────────────────────────────────────────────

function prettyDate(key) {
  if (!key) return ''
  const [y, m, d] = key.split('-').map(Number)
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${MON[m - 1]} ${y}`
}

/* The most recent rate period tells us what this person earns today. */
function currentRateFor(periods, employeeId) {
  const mine = periods.filter(p => p.employee_id === employeeId)
  return rateOn(mine, todayKey())
}

// ── Rate history editor ─────────────────────────────────────────────────────

function RateEditor({ employee, periods, onChanged, onClose }) {
  const [from, setFrom] = useState(todayKey())
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const mine = useMemo(
    () => periods.filter(p => p.employee_id === employee.id)
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1)),
    [periods, employee.id],
  )

  async function save() {
    setBusy(true); setErr(null)
    try {
      await addRatePeriod(employee.id, {
        effectiveFrom: from,
        dailyRate: Number(rate),
        weekendMultiplier: 2,
        holidayMultiplier: 2,
      })
      setRate('')
      await onChanged()
    } catch (e) {
      setErr(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    setBusy(true); setErr(null)
    try {
      await deleteRatePeriod(id)
      await onChanged()
    } catch (e) {
      setErr(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ew-card">
      <div className="ew-field">
        <label className="ew-label">Pay rate for {employee.full_name}</label>
        {mine.length === 0 ? (
          <p className="ew-hint">
            No rate set yet. A rate is needed before any day can be logged —
            days are valued at the rate in force on the day itself.
          </p>
        ) : (
          <div className="ew-rates">
            {mine.map(p => (
              <div className="ew-rate-row" key={p.id}>
                <span className="ew-rate-when">
                  from {prettyDate(p.effective_from)}
                  {p.effective_from > todayKey() && <span className="ew-chip ew-chip-warn" style={{ marginLeft: 6 }}>future</span>}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span className="ew-rate-amt">{formatNaira(p.daily_rate)}/day</span>
                  <button
                    type="button"
                    className="ew-btn ew-btn-danger ew-btn-sm"
                    onClick={() => remove(p.id)}
                    disabled={busy || mine.length === 1}
                    title={mine.length === 1 ? 'An employee needs at least one rate' : 'Delete this rate'}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ew-row" style={{ marginTop: 12 }}>
        <div className="ew-field">
          <label className="ew-label">New rate starts</label>
          <input className="ew-input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="ew-field">
          <label className="ew-label">Daily rate (₦)</label>
          <input
            className="ew-input" type="number" inputMode="numeric" min="0" placeholder="16000"
            value={rate} onChange={e => setRate(e.target.value)}
          />
        </div>
      </div>

      <p className="ew-hint" style={{ marginTop: 7 }}>
        A raise applies only from its start date. Days already logged keep the
        rate they were worked at — the past is never recalculated.
      </p>

      {err && (
        <div className="ew-msg ew-msg-error" style={{ marginTop: 10 }}>
          {err.message}{err.hint && <span className="ew-msg-hint">{err.hint}</span>}
        </div>
      )}

      <div className="ew-actions">
        <button type="button" className="ew-btn ew-btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        <button
          type="button" className="ew-btn ew-btn-primary"
          onClick={save} disabled={busy || !rate || !from}
        >
          {busy ? 'Saving…' : 'Add rate'}
        </button>
      </div>
    </div>
  )
}

// ── Add-employee form ───────────────────────────────────────────────────────

function AddEmployee({ onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [job, setJob] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function save() {
    setBusy(true); setErr(null)
    try {
      await createEmployee({ fullName: name, jobTitle: job, email })
      setName(''); setJob(''); setEmail('')
      await onCreated()
    } catch (e) {
      setErr(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ew-card">
      <div className="ew-form">
        <div className="ew-field">
          <label className="ew-label">Full name</label>
          <input className="ew-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Amina Yusuf" autoFocus />
        </div>
        <div className="ew-row">
          <div className="ew-field">
            <label className="ew-label">Job title <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label>
            <input className="ew-input" value={job} onChange={e => setJob(e.target.value)} placeholder="e.g. Welder" />
          </div>
          <div className="ew-field">
            <label className="ew-label">Email <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label>
            <input className="ew-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="for inviting them later" />
          </div>
        </div>
      </div>

      {err && (
        <div className="ew-msg ew-msg-error" style={{ marginTop: 11 }}>
          {err.message}{err.hint && <span className="ew-msg-hint">{err.hint}</span>}
        </div>
      )}

      <div className="ew-actions">
        <button type="button" className="ew-btn ew-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="ew-btn ew-btn-primary" onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add to roster'}
        </button>
      </div>
    </div>
  )
}

// ── Staff screen ────────────────────────────────────────────────────────────

function Staff({ employees, periods, loading, error, reload }) {
  const onInviteChanged = reload
  const [adding, setAdding] = useState(false)
  const [rateFor, setRateFor] = useState(null)
  const [inviteFor, setInviteFor] = useState(null)
  const [busyInvite, setBusyInvite] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const active = employees.filter(e => e.status === 'active')
  const archived = employees.filter(e => e.status !== 'active')

  if (loading) return <div className="ew-loading">Loading your staff…</div>

  return (
    <>
      <div className="ew-head">
        <div className="ew-head-text">
          <h2 className="ew-title">Staff</h2>
          <p className="ew-sub">
            {error
              ? 'Could not load your roster'
              : active.length === 0
                ? 'No one on the roster yet'
                : `${active.length} ${active.length === 1 ? 'person' : 'people'}${archived.length && !showArchived ? ` · ${archived.length} archived` : ''}`}
          </p>
        </div>
        {!adding && !rateFor && (
          <button type="button" className="ew-btn ew-btn-primary" onClick={() => { setAdding(true); setRateFor(null) }}>
            + Add
          </button>
        )}
      </div>

      {/* The error is shown BELOW the header rather than replacing the whole
          screen. Previously a load failure hid the Add button too, which made
          a data problem look like a broken interface. */}
      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}
          {error.hint && <span className="ew-msg-hint">{error.hint}</span>}
          {(error.code || error.cause?.message) && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                Technical detail
              </summary>
              <pre style={{
                margin: '7px 0 0', padding: '8px 10px', borderRadius: 8,
                background: 'rgba(0,0,0,.06)', fontSize: 11.5,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45,
              }}>
{error.code ? `code: ${error.code}\n` : ''}{error.cause?.message || ''}{error.cause?.details ? `\ndetails: ${error.cause.details}` : ''}{error.cause?.hint ? `\nhint: ${error.cause.hint}` : ''}
              </pre>
            </details>
          )}
        </div>
      )}

      {adding && (
        <AddEmployee
          onCreated={async () => { setAdding(false); await reload() }}
          onCancel={() => setAdding(false)}
        />
      )}

      {active.length === 0 && !adding && (
        <div className="ew-empty">
          <div className="ew-empty-title">Your roster is empty</div>
          <p className="ew-empty-body">
            Add the people you pay by the day. You can set each person's rate,
            log their days, and see what you owe at month end.
          </p>
        </div>
      )}

      {active.length > 0 && rateFor === null && !adding && active.map(e => {
        const rate = currentRateFor(periods, e.id)
        const hasRate = !!rate
        return (
          <div className="ew-person" key={e.id}>
            <div className="ew-avatar">{initials(e.full_name)}</div>
            <div className="ew-person-body">
              <div className="ew-name">{e.full_name}</div>
              <div className="ew-meta">
                {e.job_title && <span>{e.job_title}</span>}
                {hasRate
                  ? <span className="ew-rate">{formatNaira(rate.daily_rate)}/day</span>
                  : <span className="ew-rate-none">No rate set</span>}
                {e.employee_user_id && <span className="ew-chip ew-chip-live">linked</span>}
              </div>
            </div>
            <div className="ew-person-actions">
              <button
                type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                onClick={() => { setRateFor(e.id); setAdding(false) }}
              >
                {hasRate ? 'Rates' : 'Set rate'}
              </button>
              <button
                type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                onClick={() => { setInviteFor(e.id === inviteFor ? null : e.id); setRateFor(null); setAdding(false) }}
              >
                Invite
              </button>
              <button
                type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                disabled={busyId === e.id}
                onClick={async () => {
                  setBusyId(e.id)
                  try { await archiveEmployee(e.id); await reload() } finally { setBusyId(null) }
                }}
                title="Move off the active roster. Records are kept."
              >
                Archive
              </button>
            </div>
          </div>
        )
      })}

      {inviteFor && (() => {
        const emp = employees.find(x => x.id === inviteFor)
        if (!emp) return null
        const linked = !!emp.employee_user_id
        return (
          <div className="ew-card">
            <div className="ew-label">Invite {emp.full_name}</div>

            {linked ? (
              <>
                <p className="ew-invite-used" style={{ marginTop: 6 }}>
                  This account is already linked — they signed in with a code.
                </p>
                <p className="ew-hint" style={{ marginTop: 6 }}>
                  They can see their own days and pay, and nobody else's.
                </p>
              </>
            ) : emp.invite_code ? (
              <>
                <div className="ew-invite-row" style={{ marginTop: 7 }}>
                  <span className="ew-invite-code">{emp.invite_code}</span>
                  <button
                    type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                    disabled={busyInvite}
                    onClick={async () => {
                      const text =
                        `DayPay: sign in with your own email, then enter this code to see your days and pay — ${emp.invite_code}`
                      try {
                        if (navigator.share) await navigator.share({ text })
                        else await navigator.clipboard?.writeText(emp.invite_code)
                      } catch {
                        // Sharing cancelled, or clipboard unavailable — the
                        // code is on screen and selectable either way.
                      }
                    }}
                  >
                    Share
                  </button>
                </div>
                <p className="ew-hint" style={{ marginTop: 8 }}>
                  Give them this code. They sign in with their own email, enter
                  it once, and can then see only their own days and pay. The
                  code stops working the moment it is used.
                </p>
                <div className="ew-actions" style={{ marginTop: 9 }}>
                  <button
                    type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                    disabled={busyInvite}
                    onClick={async () => {
                      setBusyInvite(true)
                      try { await issueInviteCode(emp.id); await onInviteChanged() }
                      finally { setBusyInvite(false) }
                    }}
                  >
                    Replace code
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="ew-hint" style={{ marginTop: 6 }}>
                  No invite code yet. Create one to let this person sign in and
                  see their own days.
                </p>
                <div className="ew-actions" style={{ marginTop: 9 }}>
                  <button
                    type="button" className="ew-btn ew-btn-primary ew-btn-sm"
                    disabled={busyInvite}
                    onClick={async () => {
                      setBusyInvite(true)
                      try { await issueInviteCode(emp.id); await onInviteChanged() }
                      finally { setBusyInvite(false) }
                    }}
                  >
                    {busyInvite ? 'Creating…' : 'Create invite code'}
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {rateFor && (() => {
        const emp = employees.find(x => x.id === rateFor)
        if (!emp) return null
        return (
          <>
            <div className="ew-person">
              <div className="ew-avatar">{initials(emp.full_name)}</div>
              <div className="ew-person-body">
                <div className="ew-name">{emp.full_name}</div>
                {emp.job_title && <div className="ew-meta">{emp.job_title}</div>}
              </div>
            </div>
            <RateEditor
              employee={emp}
              periods={periods}
              onChanged={reload}
              onClose={() => setRateFor(null)}
            />
          </>
        )
      })()}

      {archived.length > 0 && rateFor === null && !adding && (
        <>
          <button
            type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
            onClick={() => setShowArchived(v => !v)}
          >
            {showArchived ? 'Hide archived' : `Show ${archived.length} archived`}
          </button>

          {showArchived && archived.map(e => (
            <div className="ew-person" key={e.id} style={{ opacity: .72 }}>
              <div className="ew-avatar">{initials(e.full_name)}</div>
              <div className="ew-person-body">
                <div className="ew-name">{e.full_name}</div>
                <div className="ew-meta"><span className="ew-chip">archived</span></div>
              </div>
              <div className="ew-person-actions">
                <button
                  type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                  disabled={busyId === e.id}
                  onClick={async () => {
                    setBusyId(e.id)
                    try { await restoreEmployee(e.id); await reload() } finally { setBusyId(null) }
                  }}
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  )
}

// ── Container ───────────────────────────────────────────────────────────────

export default function EmployerWorkspace() {
  const [pane, setPane] = useState('today')
  const [employees, setEmployees] = useState([])
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      await ensureEmployer()
      const [emps, rates] = await Promise.all([
        listEmployees({ includeArchived: true }),
        listAllRatePeriods(),
      ])
      setEmployees(emps || [])
      setPeriods(rates || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const activeCount = employees.filter(e => e.status === 'active').length

  const ratesSet = employees.filter(
    e => e.status === 'active' && currentRateFor(periods, e.id),
  ).length

  if (loading) return <div className="ew-loading">Loading your staff…</div>

  return (
    <div className="ew">
      <div className="ew-summary">
        <div className="ew-stat">
          <div className="ew-stat-label">On roster</div>
          <div className="ew-stat-value">{activeCount}</div>
        </div>
        <div className="ew-stat">
          <div className="ew-stat-label">Rates set</div>
          <div className="ew-stat-value">{ratesSet}</div>
        </div>
      </div>

      <div className="ew-subtabs" role="tablist">
        <button
          type="button" role="tab" aria-selected={pane === 'today'}
          className={`ew-subtab${pane === 'today' ? ' active' : ''}`}
          onClick={() => setPane('today')}
        >
          Today
        </button>
        <button
          type="button" role="tab" aria-selected={pane === 'days'}
          className={`ew-subtab${pane === 'days' ? ' active' : ''}`}
          onClick={() => setPane('days')}
        >
          Mark days
        </button>
        <button
          type="button" role="tab" aria-selected={pane === 'roster'}
          className={`ew-subtab${pane === 'roster' ? ' active' : ''}`}
          onClick={() => setPane('roster')}
        >
          Roster
        </button>
        <button
          type="button" role="tab" aria-selected={pane === 'summary'}
          className={`ew-subtab${pane === 'summary' ? ' active' : ''}`}
          onClick={() => setPane('summary')}
        >
          Summary
        </button>
      </div>

      {pane === 'today' && (
        <Dashboard
          employees={employees}
          periods={periods}
          onOpenDays={() => setPane('days')}
        />
      )}

      {pane === 'days' && <StaffDays employees={employees} />}

      {pane === 'summary' && <Summary employees={employees} />}

      {pane === 'roster' && (
        <Staff
          employees={employees}
          periods={periods}
          loading={false}
          error={error}
          reload={reload}
        />
      )}
    </div>
  )
}
