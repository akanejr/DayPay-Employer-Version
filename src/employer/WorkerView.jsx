/* DayPay Employer Version — one worker, day by day.
 *
 * The employer's side of Phase 6. Four jobs, and one screen:
 *
 *   1. The worker's month as a calendar, colour-coded, with each amount and
 *      where it came from. "He says he was in on Tuesday" is answered here.
 *   2. Overtime, assigned deliberately. Reclassification is ONE row changed by
 *      the employer — never a second row, because two rows for one day would
 *      pay the day twice.
 *   3. Corrections. What the worker asked, what agreeing would do, and the
 *      answer. The queue and the answer live together because splitting them
 *      across two screens is how a request gets forgotten.
 *   4. The audit trail. Read-only, written by the database, and shown in
 *      plain words rather than as `status:claimed->confirmed`.
 *
 * Nothing here re-implements money. Every figure is read from the stored row.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, listEmployeeMonth, listEmployeeCorrections, listEmployeeEvents,
  resolveCorrection, confirmDay, disputeDay, reopenDay, clearDay, setDay,
  formatNaira, initials, todayKey, prettyDateKey, monthLabelFor,
  KIND_LABELS, monthGrid, openRequestsByDate, workerMonthTotals,
  correctionSentence, correctionEffect, auditLabel, auditTone,
  CORRECTION_STATUS, CORRECTION_LABELS, rateOn, multiplierFor, dayOriginChip,
} from '../lib/employer'

const KINDS = ['work', 'weekend', 'overtime', 'holiday']

function Stat({ label, value, tone }) {
  return (
    <div className={`ew-stat${tone ? ` ew-stat-${tone}` : ''}`}>
      <div className="ew-stat-label">{label}</div>
      <div className="ew-stat-value">{value}</div>
    </div>
  )
}

// ── One day's detail ────────────────────────────────────────────────────────

function DaySheet({ dateKey, record, request, period, busy, onKind, onConfirm,
                   onDispute, onReopen, onClear, onResolve, onClose }) {
  const rate = period ? rateOn([period], dateKey) : null
  const preview = rate && record
    ? { rate: rate.daily_rate, amount: Number(rate.daily_rate) * multiplierFor(record.kind, rate, record.leave_percent) }
    : null

  return (
    <div className="ew-sheet">
      <div className="ew-sheet-head">
        <div>
          <div className="ew-board-label">{record ? 'Recorded day' : 'No record'}</div>
          <div className="ew-board-date">{prettyDateKey(dateKey)}</div>
        </div>
        <button type="button" className="ew-linkbtn" onClick={onClose}>Close</button>
      </div>

      {record ? (
        <>
          <div className="ew-sheet-figures">
            <div className="ew-worker-figure">
              <span className="ew-worker-num">{formatNaira(record.amount)}</span>
              <span className="ew-worker-cap">{KIND_LABELS[record.kind] || record.kind}</span>
            </div>
            <div className="ew-worker-figure">
              <span className="ew-worker-num">{record.multiplier}×</span>
              <span className="ew-worker-cap">multiplier</span>
            </div>
            <div className="ew-worker-figure">
              <span className="ew-worker-num">{formatNaira(record.rate)}</span>
              <span className="ew-worker-cap">daily rate</span>
            </div>
          </div>

          <div className="ew-sheet-meta">
            <span className={`ew-chip${record.status === 'confirmed' ? ' ew-chip-live' : record.status === 'disputed' ? ' ew-chip-warn' : ''}`}>
              {CORRECTION_STATUS[record.status]?.short || record.status}
            </span>
            {record.source && <span className="ew-chip">{dayOriginChip(record)}</span>}
            {record.checked_in_at && <span className="ew-mini-sub">at {String(record.checked_in_at).slice(11, 16)}</span>}
            {record.note && <span className="ew-mini-sub">{record.note}</span>}
          </div>

          {/* Overtime, assigned. One row changes; nothing is added. */}
          <div className="ew-field">
            <div className="ew-label">What this day was</div>
            <div className="ew-kind-row">
              {KINDS.map(k => (
                <button
                  key={k}
                  type="button"
                  className={`ew-kind-btn${record.kind === k ? ' is-on' : ''}`}
                  onClick={() => onKind(k)}
                  disabled={busy || record.kind === k}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
            {preview && record.kind !== 'work' && (
              <p className="ew-hint">
                At the rate in force that day this becomes {formatNaira(preview.amount)}.
              </p>
            )}
          </div>

          <div className="ew-sheet-actions">
            {record.status === 'claimed' && (
              <>
                <button type="button" className="ew-btn ew-btn-primary ew-btn-sm" onClick={onConfirm} disabled={busy}>
                  Confirm this day
                </button>
                <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm" onClick={onDispute} disabled={busy}>
                  Dispute it
                </button>
              </>
            )}
            {record.status === 'confirmed' && (
              <>
                <span className="ew-msg-hint">Confirmed days keep their amount. Reopen to change the type or the money.</span>
                <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm" onClick={onReopen} disabled={busy}>
                  Reopen
                </button>
              </>
            )}
            {record.status === 'disputed' && (
              <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm" onClick={onReopen} disabled={busy}>
                Withdraw the dispute
              </button>
            )}
            <button type="button" className="ew-btn ew-btn-danger ew-btn-sm" onClick={onClear} disabled={busy}>
              Remove this day
            </button>
          </div>
        </>
      ) : (
        <p className="ew-dash-note">
          Nothing is recorded for {prettyDateKey(dateKey)}. Use <strong>Mark days</strong> to
          add it, or wait for the worker to check in on the day.
        </p>
      )}

      {request && (
        <div className={`ew-corr-card status-${request.status}`}>
          <div className="ew-corr-row-head">
            <span className="ew-name">{CORRECTION_LABELS[request.request_kind] || request.request_kind}</span>
            <span className={(CORRECTION_STATUS[request.status] || CORRECTION_STATUS.open).cls}>
              {(CORRECTION_STATUS[request.status] || CORRECTION_STATUS.open).text}
            </span>
          </div>
          <p className="ew-corr-msg">
            {correctionSentence(request, record ? record.kind : null)}
          </p>
          {request.message && <p className="ew-corr-msg">“{request.message}”</p>}
          <p className="ew-corr-effect">
            {request.status === 'open'
              ? correctionEffect(request, record ? record.kind : null)
              : `Answered ${String(request.resolved_at || '').slice(0, 10)}.`}
          </p>

          {/* The answer belongs here as well as in the queue. Telling the
              employer what agreeing would do and then sending them to another
              tab to do it is how a request gets looked at and not answered. */}
          {request.status === 'open' && (
            <div className="ew-corr-actions">
              <button type="button" className="ew-btn ew-btn-primary ew-btn-sm"
                onClick={() => onResolve(request.id, true)} disabled={busy}>
                Agree
              </button>
              <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                onClick={() => onResolve(request.id, false, 'Not agreed.')} disabled={busy}>
                Do not agree
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function WorkerView({ employee, period = null, onBack, onChanged }) {
  const today = todayKey()
  const [year, month] = useMemo(() => {
    const [y, m] = today.split('-').map(Number)
    return [y, m - 1]
  }, [today])

  const [days, setDays] = useState([])
  const [requests, setRequests] = useState([])
  const [events, setEvents] = useState([])
  const [openDate, setOpenDate] = useState(null)
  const [tab, setTab] = useState('calendar')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [d, r, e] = await Promise.all([
        listEmployeeMonth(employee.id, year, month),
        listEmployeeCorrections(employee.id),
        listEmployeeEvents(employee.id),
      ])
      setDays(d || [])
      setRequests(r || [])
      setEvents(e || [])
    } catch (err) {
      setError(err instanceof EmployerError ? err : new EmployerError(String(err)))
    } finally {
      setLoading(false)
    }
  }, [employee.id, year, month])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => workerMonthTotals(days), [days])
  const grid = useMemo(() => monthGrid(year, month, days), [year, month, days])
  const openByDate = useMemo(() => openRequestsByDate(requests), [requests])
  const byDate = useMemo(() => {
    const m = {}
    for (const d of days) m[d.work_date] = d
    return m
  }, [days])
  const allByDate = useMemo(() => {
    const m = {}
    for (const r of requests) (m[r.work_date] ||= []).push(r)
    return m
  }, [requests])

  const openQueue = useMemo(() => requests.filter(r => r.status === 'open'), [requests])
  const monthLabel = monthLabelFor(year, month)

  /* A single mutator for every change, so nothing on this screen writes
     without reloading what it wrote and telling the container above. */
  async function act(fn) {
    setBusy(true); setError(null)
    try {
      await fn()
      await load()
      onChanged?.()
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusy(false)
    }
  }

  const record = openDate ? byDate[openDate] || null : null
  const openRequest = openDate ? (allByDate[openDate] || []).find(r => r.status === 'open') || null : null

  if (loading) return <div className="ew-loading">Loading {employee.full_name}…</div>

  return (
    <div className="ew-worker-view">
      <button type="button" className="ew-back" onClick={onBack}>‹ All workers</button>

      <div className="ew-card">
        <div className="ew-worker-head">
          <div className="ew-avatar">{initials(employee.full_name)}</div>
          <div className="ew-worker-body">
            <div className="ew-name">{employee.full_name}</div>
            <div className="ew-mini-sub">
              {employee.job_title || 'Worker'}{employee.contractor_name ? ` · ${employee.contractor_name}` : ''}
            </div>
          </div>
          {employee.status === 'archived' && <span className="ew-chip">archived</span>}
        </div>

        <div className="ew-summary" style={{ marginTop: 11 }}>
          <Stat label="Days" value={totals.worked} />
          <Stat label="Overtime" value={totals.overtime} />
          <Stat label="Equivalents" value={totals.equivalents} />
          <Stat label="Awaiting" value={totals.awaiting} tone={totals.awaiting > 0 ? 'warn' : undefined} />
        </div>

        <div className="ew-dash-money">
          <span className="ew-dash-money-label">{monthLabel} to date</span>
          <span className="ew-dash-money-value">{formatNaira(totals.total)}</span>
        </div>

        {openQueue.length > 0 && (
          <div className="ew-attention" style={{ marginTop: 11 }}>
            <div className="ew-attention-title">
              {openQueue.length} correction request{openQueue.length === 1 ? '' : 's'} waiting
            </div>
            <p className="ew-attention-body">
              {openQueue.slice(0, 3).map(r => prettyDateKey(r.work_date)).join(' · ')}
            </p>
            <button type="button" className="ew-btn ew-btn-sm" onClick={() => setTab('corrections')}>
              Open the queue
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
          <button type="button" onClick={load}>Retry</button>
        </div>
      )}

      {openDate && (
        <DaySheet
          dateKey={openDate}
          record={record}
          request={openRequest}
          period={period}
          busy={busy}
          onClose={() => setOpenDate(null)}
          onKind={k => act(() => setDay(employee.id, openDate, k, { confirm: true }))}
          onConfirm={() => act(() => confirmDay(record.id))}
          onDispute={() => act(() => disputeDay(record.id, 'Disputed by the employer.'))}
          onReopen={() => act(() => reopenDay(record.id))}
          onClear={() => act(() => clearDay(employee.id, openDate))}
          onResolve={(id, approve, note) => act(() => resolveCorrection(id, approve, note))}
        />
      )}

      <div className="ew-subtabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'calendar'}
          className={`ew-subtab${tab === 'calendar' ? ' active' : ''}`}
          onClick={() => setTab('calendar')}>Calendar</button>
        <button type="button" role="tab" aria-selected={tab === 'corrections'}
          className={`ew-subtab${tab === 'corrections' ? ' active' : ''}`}
          onClick={() => setTab('corrections')}>
          Corrections{openQueue.length ? ` · ${openQueue.length}` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'audit'}
          className={`ew-subtab${tab === 'audit' ? ' active' : ''}`}
          onClick={() => setTab('audit')}>History</button>
      </div>

      {tab === 'calendar' && (
        <div className="ew-card">
          <div className="ew-board-head">
            <div>
              <div className="ew-board-label">Calendar</div>
              <div className="ew-board-date">{monthLabel}</div>
            </div>
            <span className="ew-chip">{days.length} day{days.length === 1 ? '' : 's'}</span>
          </div>

          <div className="ew-mgrid" role="grid" aria-label={`${employee.full_name} ${monthLabel}`}>
            <div className="ew-mgrid-head" role="row">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <span key={i} className="ew-mgrid-dow" role="columnheader">{d}</span>
              ))}
            </div>
            {grid.map((week, wi) => (
              <div className="ew-mgrid-week" role="row" key={wi}>
                {week.map((cell, ci) => {
                  if (!cell) return <span key={ci} className="ew-mgrid-cell is-blank" />
                  const rec = cell.record
                  const asked = openByDate[cell.key]
                  const cls = [
                    'ew-mgrid-cell',
                    rec ? 'is-marked' : 'is-empty',
                    rec && rec.status === 'confirmed' ? 'is-confirmed' : '',
                    rec && rec.status === 'claimed' ? 'is-unconfirmed' : '',
                    rec && rec.status === 'disputed' ? 'is-disputed' : '',
                    rec && rec.kind !== 'work' ? `is-${rec.kind}` : '',
                    asked ? 'is-asked' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <button
                      key={ci} type="button" role="gridcell" className={cls}
                      onClick={() => setOpenDate(cell.key)}
                      title={rec
                        ? `${prettyDateKey(cell.key)} · ${KIND_LABELS[rec.kind] || rec.kind} · ${formatNaira(rec.amount)}${asked ? ' · a correction is waiting' : ''}`
                        : `${prettyDateKey(cell.key)} · nothing recorded`}
                    >
                      <span className="ew-mgrid-day">{cell.day}</span>
                      {asked && <span className="ew-mgrid-dot" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <p className="ew-hint">
            Tap any day to see it, change its type, confirm or dispute it, or
            answer a correction about it.
          </p>
        </div>
      )}

      {tab === 'corrections' && (
        <div className="ew-card">
          <div className="ew-board-label" style={{ marginBottom: 10 }}>
            Correction requests {openQueue.length > 0 ? `· ${openQueue.length} waiting` : '· all answered'}
          </div>

          {requests.length === 0 && (
            <p className="ew-dash-note">
              {employee.full_name} has not asked for any corrections. They can ask
              from their own screen when a day looks wrong to them.
            </p>
          )}

          {requests.map(r => {
            const st = CORRECTION_STATUS[r.status] || CORRECTION_STATUS.open
            const day = byDate[r.work_date] || null
            return (
              <div className={`ew-corr-card status-${r.status}`} key={r.id}>
                <div className="ew-corr-row-head">
                  <span className="ew-name">{prettyDateKey(r.work_date)}</span>
                  <span className={st.cls}>{st.text}</span>
                </div>

                <p className="ew-corr-msg">{correctionSentence(r, day ? day.kind : null)}</p>
                {r.message && <p className="ew-corr-msg">“{r.message}”</p>}
                <p className="ew-corr-effect">{correctionEffect(r, day ? day.kind : null)}</p>

                {r.status === 'open' ? (
                  <div className="ew-corr-actions">
                    <button type="button" className="ew-btn ew-btn-primary ew-btn-sm"
                      onClick={() => act(() => resolveCorrection(r.id, true))} disabled={busy}>
                      Agree
                    </button>
                    <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                      onClick={() => act(() => resolveCorrection(r.id, false, 'Not agreed.'))} disabled={busy}>
                      Do not agree
                    </button>
                    <button type="button" className="ew-linkbtn" onClick={() => setOpenDate(r.work_date)}>
                      See the day
                    </button>
                  </div>
                ) : (
                  <p className="ew-mini-sub">
                    {r.status === 'withdrawn'
                      ? 'The worker withdrew this.'
                      : `Answered ${String(r.resolved_at || '').slice(0, 10)}.`}
                    {r.decision_note ? ` “${r.decision_note}”` : ''}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'audit' && (
        <div className="ew-card">
          <div className="ew-board-label" style={{ marginBottom: 10 }}>History</div>
          <p className="ew-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Written by the database on every change. Nobody can edit it, including you.
          </p>

          {events.length === 0 && (
            <p className="ew-dash-note">Nothing has changed yet.</p>
          )}

          <div className="ew-audit">
            {events.map(ev => (
              <div className={`ew-audit-row tone-${auditTone(ev.action)}`} key={ev.id}>
                <span className="ew-audit-when">{String(ev.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                <span className="ew-audit-what">{auditLabel(ev.action)}</span>
                {ev.reason && <span className="ew-audit-why">{ev.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
