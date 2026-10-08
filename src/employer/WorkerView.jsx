/* DayPay Employer Version — one worker, in one place.
 *
 * Phase 7. This is the profile: the screen an employer opens when the question
 * is about ONE person, and the last employer screen still laid out the way the
 * product looked before the redesign.
 *
 * It answers, in this order, the questions an employer actually arrives with:
 *
 *   1. WHO — the name, the trade, the contractor, and whether this person can
 *      sign in. A worker record is not a user account: "Not registered" means
 *      "no DayPay sign-in yet", never "not employed" (§15), and this screen says
 *      it in words rather than in colour.
 *   2. WHAT THEY EARN — the daily rate in force today and the weekend and holiday
 *      multipliers that go with it, read from the rate periods the server keeps.
 *      Nothing here is arithmetic the UI invented. If no rate covers today the
 *      screen says so, because that is the reason a day cannot be saved at all.
 *   3. WHAT THIS MONTH IS WORTH — one figure, summed from the stored rows, with
 *      the days and the paid-day equivalents that produced it underneath. Days
 *      that are still waiting for confirmation are counted and named: money that
 *      is not confirmed yet is never presented as settled.
 *   4. WHAT NEEDS ANSWERING — the corrections queue, one tap from the day it is
 *      about.
 *
 * Then the month itself: a calendar of days, each opening its own detail sheet
 * (change the kind, confirm, dispute, reopen, remove — the write path Phase 7
 * did not touch), the full corrections list, and the audit trail.
 *
 * THE MONTH STEPS. It used to be pinned to the current month, so "was he in last
 * month?" had no answer on the screen that is about him — while
 * `listEmployeeMonth` already took a year and a month. The stepper is the whole
 * change, and it is the same one Reports and Attendance use.
 *
 * NOTHING HERE RECORDS A NEW DAY. Days are recorded one at a time from
 * Attendance (§17/§18); this screen keeps pointing there rather than growing a
 * second marking screen. That is the rule Phase 4 set for the command centre's
 * rows — a row navigates, it does not write — and it is why the empty day below
 * says where a day comes from instead of offering a button that writes one.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, accountStatus, listEmployeeMonth, listEmployeeCorrections,
  listEmployeeEvents, resolveCorrection, confirmDay, disputeDay, reopenDay,
  clearDay, setDay, formatNaira, initials, todayKey, prettyDateKey, monthLabelFor,
  KIND_LABELS, monthGrid, openRequestsByDate, workerMonthTotals,
  correctionSentence, correctionEffect, auditLabel, auditTone,
  CORRECTION_STATUS, CORRECTION_LABELS, rateOn, multiplierFor, dayOriginChip,
} from '../lib/employer'
import { BackLink, Chip, Notice, Loading } from '../ui/Ui.jsx'

const KINDS = ['work', 'weekend', 'overtime', 'holiday']

/* What the screen looks like while the month is on its way. A pane that is blank
   and a pane that is slow look identical to the person holding the phone; this is
   the difference. */
function WorkerSkeleton() {
  return (
    <div className="ew-worker-view">
      <Loading label="Loading this worker’s days…" />
    </div>
  )
}

/* The rate, said the way an employer would say it out loud: a day rate, and what
   a weekend or a holiday is worth on top. Both multipliers are read off the rate
   period in force — the same period the database uses when it values a day — and
   a multiplier of 1 is left out rather than printed as a promise. */
function rateSentence(rate) {
  if (!rate) return null
  const parts = [`${formatNaira(rate.daily_rate)} per day`]
  const weekend = Number(rate.weekend_multiplier)
  const holiday = Number(rate.holiday_multiplier)
  if (weekend && weekend !== 1) parts.push(`weekends ${weekend}×`)
  if (holiday && holiday !== 1) parts.push(`holidays ${holiday}×`)
  if (rate.effective_from) parts.push(`since ${prettyDateKey(rate.effective_from)}`)
  return parts.join(' · ')
}

// ── One day's detail ────────────────────────────────────────────────────────

function DaySheet({ dateKey, record, request, periods, busy, onKind, onConfirm,
                   onDispute, onReopen, onClear, onResolve, onClose }) {
  /* ALL of this worker's rate periods, not the one in force today: a day from
     before a raise is valued at the rate that covered it, and one period would
     have shown "no rate" against every earlier day in the month. */
  const rate = rateOn(periods || [], dateKey)
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
          Nothing is recorded for {prettyDateKey(dateKey)}. Days are recorded one at a
          time from <strong>Attendance</strong>, and the amount comes from the rate in
          force on the day — not from anything typed here.
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

export default function WorkerView({ employee, periods = null, contractorName = null,
                                    onBack, onChanged }) {
  /* The month on screen. It starts on the month the app opens on and can be
     stepped, so "was he in last month?" is answered here rather than by going to
     Reports and finding him in a list. */
  const [ym, setYm] = useState(() => {
    const [y, m] = todayKey().split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const { year, month } = ym

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

  const today = todayKey()
  const [thisYear, thisMonth] = today.split('-').map(Number)
  const isThisMonth = year === thisYear && month === thisMonth - 1

  const account = accountStatus(employee)
  /* `periods` left as null means "this screen was not told" — the contractor's
     list opens a worker without them — and the honest thing to do then is say
     nothing about money rather than claim there is no rate. An empty array is a
     real answer: this worker has no rate period at all. */
  const rateKnown = Array.isArray(periods)
  const rate = rateKnown ? rateOn(periods, today) : null

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

  function stepMonth(delta) {
    setYm(cur => {
      const d = new Date(cur.year, cur.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
    setOpenDate(null)
  }

  function goThisMonth() {
    setYm({ year: thisYear, month: thisMonth - 1 })
    setOpenDate(null)
  }

  /* Opening a day always lands on the tab that shows days: the sheet belongs
     under the day it is about, so a queue row can never open something the
     employer cannot see. */
  function seeDay(key) {
    setOpenDate(key)
    setTab('calendar')
  }

  function goTab(next) {
    setTab(next)
    setOpenDate(null)
  }

  const record = openDate ? byDate[openDate] || null : null
  const openRequest = openDate ? (allByDate[openDate] || []).find(r => r.status === 'open') || null : null

  if (loading) return <WorkerSkeleton />

  return (
    <div className="ew-worker-view">
      <BackLink onBack={onBack} label="All workers" />

      {/* ── Who this is ─────────────────────────────────────────────────────────
          The roster already says "Rigger · Contractor A"; this screen used to say
          "Rigger" and stop, because `employee.contractor_name` is a column on an
          invoice and never on a worker. The name comes in as a prop now, from the
          screen that already resolved it. */}
      <header className="ew-prof">
        <div className="ew-prof-who">
          <div className="ew-avatar" aria-hidden="true">{initials(employee.full_name)}</div>
          <div className="ew-prof-body">
            <h2 className="ew-name">{employee.full_name}</h2>
            <p className="ew-prof-sub">
              {[employee.job_title, contractorName].filter(Boolean).join(' · ') || 'No trade or contractor set'}
            </p>
          </div>
        </div>

        <div className="ew-prof-chips">
          <Chip tone={account.registered ? 'ok' : 'warn'}>{account.text}</Chip>
          {employee.status === 'archived' && <Chip tone="quiet">Archived</Chip>}
        </div>

        {/* The sentence the chip cannot hold. "Not registered" is a fact about a
            login, and an employer who reads it as "not employed" stops paying
            somebody who is still owed — so it is spelled out, once, in the place
            where they look. */}
        <p className="ew-prof-hint">
          {employee.status === 'archived'
            ? 'This worker is off the roster. Their days, their rate history and their pay are all kept.'
            : account.hint}
        </p>
      </header>

      {/* ── What this month is worth ────────────────────────────────────────── */}
      <section className="ew-prof-pay" aria-label={`${monthLabel} for ${employee.full_name}`}>
        <div className="ew-monthbar">
          <button type="button" className="ew-datebar-step" aria-label="Previous month"
            onClick={() => stepMonth(-1)} disabled={busy}>‹</button>
          <div className="ew-datebar-mid">
            <div className="ew-datebar-day">{monthLabel}</div>
            {!isThisMonth && (
              <button type="button" className="ew-datebar-today" onClick={goThisMonth} disabled={busy}>
                Back to this month
              </button>
            )}
          </div>
          <button type="button" className="ew-datebar-step" aria-label="Next month"
            onClick={() => stepMonth(1)} disabled={busy}>›</button>
        </div>

        <div className="ew-prof-hero">
          <span className="ew-prof-hero-label">{isThisMonth ? 'Earned this month' : `Earned in ${monthLabel}`}</span>
          <span className="ew-prof-hero-sum">{formatNaira(totals.total)}</span>
        </div>

        <dl className="ew-prof-facts">
          <div className="ew-prof-fact">
            <dt>
              Days recorded
              {factNote(totals) && <span className="ew-prof-fact-note">{factNote(totals)}</span>}
            </dt>
            <dd>{totals.days}</dd>
          </div>
          <div className="ew-prof-fact">
            <dt>
              Paid-day equivalents
              <span className="ew-prof-fact-note">what the days are worth at this rate</span>
            </dt>
            <dd>{totals.equivalents}</dd>
          </div>
          <div className="ew-prof-fact">
            <dt>
              Waiting for confirmation
              <span className="ew-prof-fact-note">
                {totals.awaiting > 0 ? 'not counted as settled yet' : 'everything here is confirmed'}
              </span>
            </dt>
            <dd className={totals.awaiting > 0 ? 'is-warn' : ''}>{totals.awaiting}</dd>
          </div>
        </dl>

        {rateKnown && (
          rate ? (
            <p className="ew-prof-rate">
              <span className="ew-prof-rate-label">Rate</span>
              {rateSentence(rate)}
            </p>
          ) : (
            <p className="ew-prof-rate is-missing">
              No rate covers today, so a day cannot be saved or paid. Set it from
              <strong> Rates</strong> on their row in People.
            </p>
          )
        )}
      </section>

      {openQueue.length > 0 && (
        <div className="ew-prof-corr">
          <Notice
            tone="attention"
            title={`${openQueue.length} correction ${openQueue.length === 1 ? 'request' : 'requests'} waiting`}
            body={openQueue.slice(0, 3).map(r => prettyDateKey(r.work_date)).join(' · ')
              + (openQueue.length > 3 ? ` · +${openQueue.length - 3} more` : '')}
            action={(
              <button type="button" className="ew-btn ew-btn-sm" onClick={() => goTab('corrections')}>
                Answer {openQueue.length === 1 ? 'it' : 'them'}
              </button>
            )}
          />
        </div>
      )}

      {error && (
        <div className="ew-prof-error">
          <Notice
            tone="error"
            title="That did not go through"
            body={error.message + (error.hint ? ` ${error.hint}` : '')}
            action={<button type="button" className="ew-btn ew-btn-sm" onClick={load}>Try again</button>}
          />
        </div>
      )}

      <div className="ew-subtabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'calendar'}
          className={`ew-subtab${tab === 'calendar' ? ' active' : ''}`}
          onClick={() => goTab('calendar')}>Days</button>
        <button type="button" role="tab" aria-selected={tab === 'corrections'}
          className={`ew-subtab${tab === 'corrections' ? ' active' : ''}`}
          onClick={() => goTab('corrections')}>
          Corrections{openQueue.length ? ` · ${openQueue.length}` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'audit'}
          className={`ew-subtab${tab === 'audit' ? ' active' : ''}`}
          onClick={() => goTab('audit')}>History</button>
      </div>

      {tab === 'calendar' && (
        <div className="ew-card">
          <div className="ew-board-head">
            <div>
              <div className="ew-board-label">Days</div>
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
                      aria-expanded={openDate === cell.key}
                      onClick={() => seeDay(cell.key)}
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

          {/* A month with nothing in it is a result, and a result has to be stated
              — an empty grid on its own reads as a screen that failed to load. The
              grid stays: the dates are how an employer checks that they are looking
              at the month they meant. */}
          {days.length === 0 ? (
            <Notice
              tone="empty"
              title={`Nothing recorded in ${monthLabel}`}
              body="Days are recorded one at a time from Attendance, and the amount comes from the rate in force on the day. They appear here as soon as they are saved."
              action={!isThisMonth
                ? <button type="button" className="ew-btn ew-btn-sm" onClick={goThisMonth}>Back to this month</button>
                : null}
            />
          ) : (
            <p className="ew-hint">
              Tap any day to see it, change its type, confirm or dispute it, or answer a
              correction about it.
            </p>
          )}

          {/* The day's own detail, directly under the calendar it came from — not
              above the tabs, where a tap near the bottom of a phone opened
              something off-screen. */}
          {openDate && (
            <DaySheet
              dateKey={openDate}
              record={record}
              request={openRequest}
              periods={periods}
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
        </div>
      )}

      {tab === 'corrections' && (
        <div className="ew-card">
          <div className="ew-board-label dp-mb-12">
            Correction requests {openQueue.length > 0 ? `· ${openQueue.length} waiting` : '· all answered'}
          </div>

          {requests.length === 0 && (
            <Notice
              tone="empty"
              title={`${employee.full_name} has not queried a day`}
              body="They can ask from their own screen when a day looks wrong to them. Requests appear here, with the day they are about."
            />
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
                    <button type="button" className="ew-linkbtn" onClick={() => seeDay(r.work_date)}>
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
          <div className="ew-board-label dp-mb-12">History</div>
          <p className="ew-hint dp-mb-12" style={{ marginTop: 0 }}>
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

/* The one-line note under "Days recorded": what the days were, when they were not
   all plain working days. Nothing is said when they were. */
function factNote(totals) {
  const parts = []
  if (totals.overtime > 0) parts.push(`${totals.overtime} overtime`)
  if (totals.leave > 0) parts.push(`${totals.leave} leave`)
  return parts.join(' · ')
}
