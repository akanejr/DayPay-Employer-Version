/* DayPay Employer Version — the management dashboard.
 *
 * The first thing an employer sees on opening Staff, and it answers the
 * question they actually have on arriving at a site: who am I expecting, who
 * has been recorded, who is missing, and what does the month look like so far.
 *
 * Design decisions worth stating:
 *
 *   - The missing are shown BY NAME, not as a count. An employer does not
 *     chase "3", they chase James. The names are the actionable part.
 *
 *   - Every money figure comes from `monthFigures`, which wraps the same
 *     `summarise()` the Summary pane and the payslip use. The dashboard must
 *     never compute money a second way — a second way is a second answer.
 *
 *   - This screen records nothing. Marking a day is a deliberate act on its
 *     own pane; a mis-tap on an overview screen is how wrong pay happens.
 *
 *   - "Recorded" rather than "checked in", for now. Today the employer records
 *     days; from Phase 4 workers check themselves in and the wording becomes
 *     true either way. The stored fact is the same one.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, listAllMonth,
  dayBoard, unmetRates, monthFigures,
  formatNaira, initials, todayKey, prettyDateKey, monthLabelFor, shiftDateKey,
  KIND_LABELS,
} from '../lib/employer'

function Stat({ label, value, tone }) {
  return (
    <div className={`ew-stat${tone ? ` ew-stat-${tone}` : ''}`}>
      <div className="ew-stat-label">{label}</div>
      <div className="ew-stat-value">{value}</div>
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function Dashboard({ employees, periods, onOpenDays }) {
  const today = todayKey()
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [year, monthIndex] = useMemo(() => {
    const [y, m] = today.split('-').map(Number)
    return [y, m - 1]
  }, [today])

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await listAllMonth(year, monthIndex)
      setDays(rows || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [year, monthIndex])

  useEffect(() => { load() }, [load])

  const board = useMemo(() => dayBoard(days, employees, today), [days, employees, today])
  const figures = useMemo(() => monthFigures(days, employees), [days, employees])

  /* Anything the employer should deal with before it becomes someone's
     missing pay. Rate gaps come first: those are the ones that make recording
     a day outright fail. */
  const rateGaps = useMemo(() => unmetRates(employees, periods, today), [employees, periods, today])

  const nothingYet = board.expected > 0 && board.recorded === 0 && board.missing.length === board.expected

  if (loading) return <div className="ew-loading">Loading today…</div>

  return (
    <div className="ew-dash">
      {error && (
        <div className="ew-msg ew-msg-error">
          <span>{error.message}</span>
          <button type="button" onClick={load}>Retry</button>
        </div>
      )}

      {/* ── Today ───────────────────────────────────────────────────────── */}
      <section className="ew-card">
        <div className="ew-board-head">
          <div>
            <div className="ew-board-label">Today</div>
            <div className="ew-board-date">{prettyDateKey(today)}</div>
          </div>
          {board.isWeekend && <span className="ew-chip ew-chip-live">Weekend 2×</span>}
        </div>

        {board.expected === 0 ? (
          <p className="ew-dash-note" style={{ marginTop: 10 }}>
            No one is on the roster yet. Add your workers under <strong>Roster</strong> and
            today will start counting.
          </p>
        ) : (
          <>
            <div className="ew-summary" style={{ marginTop: 11 }}>
              <Stat label="Expected" value={board.expected} />
              <Stat label="Recorded" value={board.recorded} tone={board.recorded > 0 ? 'good' : undefined} />
              <Stat label="Not yet" value={board.missing.length} tone={board.missing.length > 0 ? 'warn' : undefined} />
              <Stat label="Overtime" value={board.counts.overtime} />
            </div>

            {board.amount > 0 && (
              <div className="ew-dash-money">
                <span className="ew-dash-money-label">Recorded today</span>
                <span className="ew-dash-money-value">{formatNaira(board.amount)}</span>
              </div>
            )}

            {nothingYet ? (
              <div className="ew-dash-note" style={{ marginTop: 11 }}>
                Nothing recorded yet today.
                <button type="button" className="ew-linkbtn" onClick={onOpenDays}>
                  Record today’s days →
                </button>
              </div>
            ) : board.missing.length > 0 ? (
              <div className="ew-dash-block">
                <div className="ew-dash-block-title">
                  Not yet recorded
                  <span className="ew-dash-count">{board.missing.length}</span>
                </div>
                <div className="ew-mini-list">
                  {board.missing.map(e => (
                    <div className="ew-mini" key={e.id}>
                      <div className="ew-avatar ew-avatar-sm">{initials(e.full_name)}</div>
                      <div className="ew-mini-body">
                        <div className="ew-mini-name">{e.full_name}</div>
                        {e.job_title && <div className="ew-mini-sub">{e.job_title}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="ew-dash-note ew-dash-done" style={{ marginTop: 11 }}>
                Everyone on the roster is recorded for today.
              </div>
            )}

            {/* Off-roster days are surfaced rather than hidden: they are real
                money and the month total includes them. */}
            {board.offRoster.length > 0 && (
              <div className="ew-dash-note" style={{ marginTop: 9 }}>
                {board.offRoster.length} day{board.offRoster.length === 1 ? '' : 's'} recorded today
                for someone no longer on the roster.
              </div>
            )}
          </>
        )}
      </section>

      {/* ── This month ──────────────────────────────────────────────────── */}
      {board.expected > 0 && (
        <section className="ew-card">
          <div className="ew-board-head">
            <div>
              <div className="ew-board-label">This month</div>
              <div className="ew-board-date">{monthLabelFor(year, monthIndex)}</div>
            </div>
          </div>

          <div className="ew-summary" style={{ marginTop: 11 }}>
            <Stat label="Days worked" value={figures.actualDays} />
            <Stat label="Paid-day equiv" value={figures.equivalents} />
            <Stat label="Owed" value={formatNaira(figures.total)} tone="money" />
          </div>

          {(figures.unconfirmed > 0 || figures.disputed > 0) && (
            <div className="ew-dash-chips">
              {figures.unconfirmed > 0 && (
                <span className="ew-chip ew-chip-warn">{figures.unconfirmed} awaiting confirmation</span>
              )}
              {figures.disputed > 0 && (
                <span className="ew-chip ew-chip-warn">{figures.disputed} disputed</span>
              )}
            </div>
          )}

          <p className="ew-dash-foot">
            Days worked and paid-day equivalents are separate numbers on purpose —
            a weekend or overtime day counts as two of the second kind.
          </p>
        </section>
      )}

      {/* ── Needs attention ─────────────────────────────────────────────── */}
      {(rateGaps.length > 0 || board.counts.disputed > 0) && (
        <section className="ew-card ew-card-attention">
          <div className="ew-board-label">Needs attention</div>

          {rateGaps.length > 0 && (
            <div className="ew-attention">
              <div className="ew-attention-title">
                {rateGaps.length === 1 ? 'No rate covers today' : `No rate covers today for ${rateGaps.length} people`}
              </div>
              <p className="ew-attention-body">
                Their day cannot be recorded at all until a rate starts on or before today
                — the amount is calculated from it. Set it under <strong>Roster</strong>.
              </p>
              <div className="ew-dash-chips">
                {rateGaps.map(e => (
                  <span className="ew-chip" key={e.id}>{e.full_name}</span>
                ))}
              </div>
            </div>
          )}

          {board.counts.disputed > 0 && (
            <div className="ew-attention">
              <div className="ew-attention-title">
                {board.counts.disputed} disputed today
              </div>
              <p className="ew-attention-body">
                Someone has questioned these days. They are still included in the month
                total until they are settled.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
