/* DayPay Employer Version — the employee's own view.
 *
 * What a member of staff sees: their rate, their days, their total, and
 * whether each day has been confirmed. Nothing more — RLS already prevents
 * them reading a colleague's record, and this screen never asks for one.
 *
 * Two states:
 *   not linked  -> enter an invite code to join a team
 *   linked      -> their work for the selected month
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, redeemInvite, leaveRoster, myMonth, myRatePeriods,
  formatNaira, monthLabelFor, monthBounds, rateOn, todayKey,
  prettyDateKey, KIND_LABELS,
  myCorrections, openRequestsByDate, monthGrid, workerMonthTotals,
  ledgerSourceLabel,
} from '../lib/employer'
import CheckIn from './CheckIn'
import CorrectionForm from './CorrectionForm'
import CorrectionList from './CorrectionList'

const STATUS_LABEL = {
  claimed: { text: 'Awaiting confirmation', cls: 'ew-chip ew-chip-warn' },
  confirmed: { text: 'Confirmed', cls: 'ew-chip ew-chip-live' },
  disputed: { text: 'Disputed', cls: 'ew-chip ew-chip-warn' },
}

// ── Joining ─────────────────────────────────────────────────────────────────

function JoinForm({ onJoined }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const row = await redeemInvite(code)
      onJoined(row)
    } catch (e2) {
      setErr(e2 instanceof EmployerError ? e2 : new EmployerError(String(e2)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ew-card">
      <h2 className="ew-title">Join a team</h2>
      <p className="ew-sub" style={{ marginBottom: 12 }}>
        Your employer will have given you a short code. Enter it once to link this
        account to their workforce and see your own days and pay. You will not be
        asked for it again — after this you just sign in.
      </p>

      <form className="ew-form" onSubmit={submit}>
        <div className="ew-field">
          <label className="ew-label" htmlFor="invite-code">Invite code</label>
          <input
            id="invite-code"
            className="ew-input ew-code"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD2345"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
            maxLength={16}
            autoFocus
          />
          <span className="ew-hint">
            Eight characters. Spaces and letter case do not matter.
          </span>
        </div>

        {err && (
          <div className="ew-msg ew-msg-error">
            {err.message}{err.hint && <span className="ew-msg-hint">{err.hint}</span>}
          </div>
        )}

        <div className="ew-actions">
          <button type="submit" className="ew-btn ew-btn-primary" disabled={busy || !code.trim()}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Rate history ────────────────────────────────────────────────────────────

function MyRates({ periods }) {
  const [open, setOpen] = useState(false)
  const today = todayKey()
  const current = rateOn([...periods].reverse(), today)

  if (!periods.length) return null

  return (
    <div className="ew-card">
      <button
        type="button" className="ew-foldhead"
        onClick={() => setOpen(o => !o)} aria-expanded={open}
      >
        <span>My rate</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {current
            ? <strong className="ew-rate">{formatNaira(current.daily_rate)}/day</strong>
            : <span className="ew-rate-none">none current</span>}
          <span className="ew-pay-chev">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className="ew-rates" style={{ borderTop: '1px solid var(--border-light)', marginTop: 9 }}>
          {periods.map(p => (
            <div className="ew-rate-row" key={p.id}>
              <span className="ew-rate-when">
                from {p.effective_from}
                {p.effective_from > today && <span className="ew-chip ew-chip-warn" style={{ marginLeft: 6 }}>starts soon</span>}
              </span>
              <span className="ew-rate-amt">{formatNaira(p.daily_rate)}/day</span>
            </div>
          ))}
          <p className="ew-hint" style={{ marginTop: 8 }}>
            Days you have already worked keep the rate that applied then. A raise
            never changes what you were paid before it.
          </p>
        </div>
      )}
    </div>
  )
}

// ── The employee's month ────────────────────────────────────────────────────

function MyMonth({ employee, onChanged }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [days, setDays] = useState([])
  const [periods, setPeriods] = useState([])
  const [requests, setRequests] = useState([])
  const [asking, setAsking] = useState(null)   // the dateKey being asked about
  const [claiming, setClaiming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [d, p, r] = await Promise.all([
        myMonth(employee.id, year, month),
        myRatePeriods(employee.id),
        myCorrections(),
      ])
      setDays(d || [])
      setPeriods(p || [])
      setRequests(r || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [employee.id, year, month])

  useEffect(() => { load() }, [load])

  const label = monthLabelFor(year, month)

  const stats = useMemo(() => {
    const t = workerMonthTotals(days)
    return {
      total: t.total, worked: t.worked, leave: t.leave,
      overtime: t.overtime, equivalents: t.equivalents,
      confirmed: days.filter(d => d.status === 'confirmed').length,
      pending: t.awaiting,
    }
  }, [days])

  /* The month grid shows the worker their own month the way their employer
     sees it: days marked, days missing, and a flag where they have asked for
     something. Read-only, always — tapping a day opens a request, never an
     editor. */
  const openByDate = useMemo(() => openRequestsByDate(requests), [requests])
  const weeks = useMemo(() => monthGrid(year, month, days), [year, month, days])
  const byDate = useMemo(() => {
    const m = {}
    for (const d of days) m[d.work_date] = d
    return m
  }, [days])

  const mine = useMemo(
    () => requests.filter(r => String(r.work_date).startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)),
    [requests, year, month],
  )

  const askAbout = asking ? byDate[asking] || null : null

  function stepMonth(delta) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const { from, to } = monthBounds(year, month)

  return (
    <>
      <div className="ew-monthbar">
        <button type="button" className="ew-datebar-step" aria-label="Previous month" onClick={() => stepMonth(-1)}>‹</button>
        <div className="ew-datebar-mid"><div className="ew-datebar-day">{label}</div></div>
        <button type="button" className="ew-datebar-step" aria-label="Next month" onClick={() => stepMonth(1)}>›</button>
      </div>

      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      {loading ? (
        <div className="ew-loading">Loading {label}…</div>
      ) : (
        <>
          <div className="ew-owe">
            <div className="ew-owe-label">{label}</div>
            <div className="ew-owe-figure">{formatNaira(stats.total)}</div>
            <div className="ew-owe-sub">
              {days.length === 0
                ? 'Nothing recorded yet this month'
                : `${stats.worked} worked${stats.leave ? ` · ${stats.leave} leave` : ''}`}
            </div>
            {days.length > 0 && (
              <div className="ew-owe-flags">
                {stats.confirmed > 0 && <span className="ew-chip">{stats.confirmed} confirmed</span>}
                {stats.pending > 0 && <span className="ew-chip ew-chip-warn">{stats.pending} awaiting</span>}
              </div>
            )}
          </div>

          {/* The month at a glance. Read-only by design: tapping a day opens a
              REQUEST, never an editor. A day with an unanswered request is
              flagged here so a worker can see they have already asked. */}
          <div className="ew-mgrid" role="grid" aria-label={`${label} at a glance`}>
            <div className="ew-mgrid-head" role="row">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <span key={i} className="ew-mgrid-dow" role="columnheader">{d}</span>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div className="ew-mgrid-week" role="row" key={wi}>
                {week.map((cell, ci) => {
                  if (!cell) return <span key={ci} className="ew-mgrid-cell is-blank" />
                  const rec = cell.record
                  const asking = openByDate[cell.key]
                  const cls = [
                    'ew-mgrid-cell',
                    rec ? 'is-marked' : 'is-empty',
                    rec && rec.status === 'confirmed' ? 'is-confirmed' : '',
                    rec && rec.status === 'claimed' ? 'is-unconfirmed' : '',
                    rec && rec.kind !== 'work' ? `is-${rec.kind}` : '',
                    asking ? 'is-asked' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <button
                      key={ci}
                      type="button"
                      role="gridcell"
                      className={cls}
                      title={rec
                        ? `${prettyDateKey(cell.key)} · ${KIND_LABELS[rec.kind] || rec.kind} · ${formatNaira(rec.amount)}${asking ? ' · you asked about this day' : ''}`
                        : `${prettyDateKey(cell.key)} · nothing recorded`}
                      onClick={() => setAsking(cell.key)}
                    >
                      <span className="ew-mgrid-day">{cell.day}</span>
                      {asking && <span className="ew-mgrid-dot" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="ew-corr-tools">
            <button type="button" className="ew-btn ew-btn-primary ew-btn-sm"
              onClick={() => { setClaiming(true); setAsking(null) }}>
              I worked a day that is not here
            </button>
          </div>

          {claiming && (
            <CorrectionForm
              employee={employee}
              mode="missing"
              onDone={() => { setClaiming(false); load(); onChanged?.() }}
              onCancel={() => setClaiming(false)}
            />
          )}

          {asking && (
            <CorrectionForm
              employee={employee}
              dateKey={asking}
              currentKind={askAbout ? askAbout.kind : null}
              onDone={() => { setAsking(null); load(); onChanged?.() }}
              onCancel={() => setAsking(null)}
            />
          )}

          <MyRates periods={periods} />

          {days.length === 0 ? (
            <div className="ew-empty">
              <div className="ew-empty-title">No days recorded in {label}</div>
              <p className="ew-empty-body">
                Your employer marks the days they pay you for. They will appear
                here as soon as they do.
              </p>
            </div>
          ) : (
            days.map(d => {
              const st = STATUS_LABEL[d.status] || STATUS_LABEL.claimed
              const asked = openByDate[d.work_date]
              return (
                <div className={`ew-dayrow is-marked${asked ? ' is-asked' : ''}`} key={d.id}>
                  <div className="ew-dayrow-body">
                    <div className="ew-name">{prettyDateKey(d.work_date)}</div>
                    <div className="ew-meta">
                      <span className="ew-chip">{KIND_LABELS[d.kind] || d.kind}</span>
                      <span className={st.cls}>{st.text}</span>
                      {asked && <span className="ew-chip ew-chip-warn">You asked</span>}
                    </div>
                    {/* Who put this day here. A worker looking at a figure they
                        do not recognise should be able to tell a check-in from
                        something their employer typed — without asking. */}
                    <div className="ew-dayrow-source">
                      {ledgerSourceLabel(d.source || 'employer', d.attendance_method)}
                    </div>
                  </div>
                  <div className="ew-dayrow-actions">
                    <div className="ew-pay-amount">
                      <span className="ew-pay-figure">{formatNaira(d.amount)}</span>
                    </div>
                    <button
                      type="button"
                      className="ew-linkbtn"
                      onClick={() => { setClaiming(false); setAsking(d.work_date) }}
                      disabled={!!asked}
                      title={asked ? 'You have already asked about this day.' : undefined}
                    >
                      {asked ? 'Asked' : 'Something is wrong'}
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {days.length > 0 && (
            <p className="ew-hint" style={{ textAlign: 'center', marginTop: 4 }}>
              {from} to {to} · each amount is what was stored on the day it was
              worked.
            </p>
          )}

          <CorrectionList rows={mine} onChanged={() => { load(); onChanged?.() }} />

          <p className="ew-hint" style={{ textAlign: 'center' }}>
            Your workplace record cannot be edited from here. Check in with
            today's code while you are at work, or ask your employer to change
            a day.
          </p>
        </>
      )}
    </>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function EmployeeView({ employee, onChanged }) {
  const [linked, setLinked] = useState(employee)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [monthBump, setMonthBump] = useState(0)

  useEffect(() => { setLinked(employee) }, [employee])

  async function doLeave() {
    setBusy(true); setError(null)
    try {
      await leaveRoster()
      setLinked(null)
      onChanged?.()
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusy(false)
      setConfirmLeave(false)
    }
  }

  if (!linked) {
    return (
      <>
        <JoinForm onJoined={row => { setLinked(row); onChanged?.() }} />
        {error && (
          <div className="ew-msg ew-msg-error">
            {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="ew-head">
        <div className="ew-head-text">
          <h2 className="ew-title">{linked.full_name || 'My work'}</h2>
          <p className="ew-sub">
            {linked.business_name || 'My team'}{linked.job_title ? ` · ${linked.job_title}` : ''}
          </p>
        </div>
      </div>

      {/* Check in first, then what the month looks like. Recording a day
          changes the month, so MyMonth is keyed off a counter that bumps when
          one lands — otherwise the figures underneath would be stale until
          the next reload. */}
      <CheckIn employee={linked} onRecorded={() => setMonthBump(n => n + 1)} />

      <MyMonth key={monthBump} employee={linked} onChanged={() => setMonthBump(n => n + 1)} />

      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      <div className="ew-leave">
        {confirmLeave ? (
          <div className="ew-msg ew-msg-warn">
            Leave {linked.business_name || 'this team'}?
            <span className="ew-msg-hint">
              You will stop seeing their records. Ask your employer for a new
              code if you want to rejoin.
            </span>
            <div className="ew-confirm-actions">
              <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm" onClick={() => setConfirmLeave(false)} disabled={busy}>Cancel</button>
              <button type="button" className="ew-btn ew-btn-danger ew-btn-sm" onClick={doLeave} disabled={busy}>
                {busy ? 'Leaving…' : 'Yes, leave'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
            onClick={() => setConfirmLeave(true)}
          >
            Leave this team
          </button>
        )}
      </div>
    </>
  )
}
