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
} from '../lib/employer'

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
        Your employer will have given you a short code. Enter it to see your own
        days and pay.
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

function MyMonth({ employee }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [days, setDays] = useState([])
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [d, p] = await Promise.all([
        myMonth(employee.id, year, month),
        myRatePeriods(employee.id),
      ])
      setDays(d || [])
      setPeriods(p || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [employee.id, year, month])

  useEffect(() => { load() }, [load])

  const label = monthLabelFor(year, month)

  const stats = useMemo(() => {
    let total = 0, worked = 0, leave = 0, confirmed = 0, pending = 0
    for (const d of days) {
      total += Number(d.amount) || 0
      if (d.kind === 'leave') leave += 1
      else worked += 1
      if (d.status === 'confirmed') confirmed += 1
      else if (d.status === 'claimed') pending += 1
    }
    return { total, worked, leave, confirmed, pending }
  }, [days])

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
              return (
                <div className="ew-dayrow is-marked" key={d.id}>
                  <div className="ew-dayrow-body">
                    <div className="ew-name">{prettyDateKey(d.work_date)}</div>
                    <div className="ew-meta">
                      <span className="ew-chip">{KIND_LABELS[d.kind] || d.kind}</span>
                      <span className={st.cls}>{st.text}</span>
                    </div>
                  </div>
                  <div className="ew-pay-amount">
                    <span className="ew-pay-figure">{formatNaira(d.amount)}</span>
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

      <MyMonth employee={linked} />

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
