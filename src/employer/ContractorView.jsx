/* DayPay Employer Version — one contractor's day and month.
 *
 * The brief's contractor view: how many workers, how many are in today, who is
 * not, and how much overtime. Then the worker list, one card each.
 *
 * Design decisions worth stating:
 *
 *   - A worker card carries three facts — present or not, actual days,
 *     paid-day equivalents — and nothing else. The brief asks for clean cards
 *     and warns against overload; the deeper detail lives one tap away in
 *     WorkerView, which is where Phase 6 put the calendar, overtime assignment,
 *     corrections and the audit trail.
 *
 *   - All figures come from `contractorRollup`, which reads the same stored
 *     rows everything else reads. The header is derived from the cards
 *     underneath it, so it cannot disagree with them.
 *
 *   - Nothing here writes. Recording a day and assigning overtime both live
 *     elsewhere, on purpose: a mis-tap on a summary screen is how wrong pay
 *     happens.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useState } from 'react'
import {
  contractorRollup, formatNaira, initials, todayKey,
  monthLabelFor, prettyDateKey, KIND_LABELS,
} from '../lib/employer'
import WorkerView from './WorkerView'

function Stat({ label, value, tone }) {
  return (
    <div className={`ew-stat${tone ? ` ew-stat-${tone}` : ''}`}>
      <div className="ew-stat-label">{label}</div>
      <div className="ew-stat-value">{value}</div>
    </div>
  )
}

// ── One worker's card ───────────────────────────────────────────────────────

function WorkerCard({ row, onOpen }) {
  const { employee, today, present } = row

  return (
    <button
      type="button"
      className={`ew-worker ew-worker-btn${present ? ' is-present' : ''}`}
      onClick={() => onOpen(employee.id)}
    >
      <div className="ew-worker-head">
        <div className="ew-avatar">{initials(employee.full_name)}</div>
        <div className="ew-worker-body">
          <div className="ew-name">{employee.full_name}</div>
          {employee.job_title && <div className="ew-mini-sub">{employee.job_title}</div>}
        </div>
        <span className={`ew-chip${present ? ' ew-chip-live' : ''}`}>
          {present ? 'Present' : 'Not in'}
        </span>
      </div>

      {present && today && (
        <div className="ew-worker-today">
          <span>{KIND_LABELS[today.kind] || today.kind}</span>
          <span className="ew-rate">{formatNaira(today.amount)}</span>
          {today.status === 'confirmed' && <span className="ew-chip">confirmed</span>}
          {today.status === 'disputed' && <span className="ew-chip ew-chip-warn">disputed</span>}
        </div>
      )}

      {/* The brief's own two figures. Shown even at 0, because a blank card
          reads as missing data rather than as no days yet. */}
      <div className="ew-worker-figures">
        <div className="ew-worker-figure">
          <span className="ew-worker-num">{row.actualDays}</span>
          <span className="ew-worker-cap">actual day{row.actualDays === 1 ? '' : 's'}</span>
        </div>
        <div className="ew-worker-figure">
          <span className="ew-worker-num">{row.equivalents}</span>
          <span className="ew-worker-cap">paid-day equiv</span>
        </div>
        {row.leave > 0 && (
          <div className="ew-worker-figure">
            <span className="ew-worker-num ew-worker-num-quiet">{row.leave}</span>
            <span className="ew-worker-cap">leave</span>
          </div>
        )}
      </div>

      <span className="ew-worker-open">Day by day ›</span>
    </button>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function ContractorView({ contractor, employees, days, onBack, onChanged }) {
  const today = todayKey()
  const roll = contractorRollup(employees, days, today)
  const [year, monthIndex] = today.split('-').map((v, i) => (i === 0 ? Number(v) : Number(v) - 1))
  const [openWorkerId, setOpenWorkerId] = useState(null)

  const title = contractor?.name || 'Unassigned workers'

  /* Derived, not stored: a worker who is archived or reassigned elsewhere
     while this screen is open falls back to the list on its own. */
  const openWorker = openWorkerId
    ? employees.find(e => e.id === openWorkerId) || null
    : null

  if (openWorker) {
    return (
      <WorkerView
        employee={openWorker}
        onBack={() => setOpenWorkerId(null)}
        onChanged={onChanged}
      />
    )
  }

  return (
    <div className="ew-contractor">
      <button type="button" className="ew-back" onClick={onBack}>
        ‹ All contractors
      </button>

      <div className="ew-card">
        <div className="ew-board-head">
          <div>
            <div className="ew-board-label">Contractor</div>
            <div className="ew-board-date">{title}</div>
          </div>
          {!roll.rows.length && <span className="ew-chip">no workers yet</span>}
        </div>

        {contractor?.note && <p className="ew-dash-note" style={{ marginTop: 7 }}>{contractor.note}</p>}

        {roll.rows.length > 0 && (
          <>
            <div className="ew-summary" style={{ marginTop: 11 }}>
              <Stat label="Workers" value={roll.expected} />
              <Stat label="Present" value={roll.present} tone={roll.present > 0 ? 'good' : undefined} />
              <Stat label="Not in" value={roll.missing} tone={roll.missing > 0 ? 'warn' : undefined} />
              <Stat label="OT" value={roll.overtime} />
            </div>

            <div className="ew-dash-money">
              <span className="ew-dash-money-label">
                {monthLabelFor(year, monthIndex)} to date
              </span>
              <span className="ew-dash-money-value">{formatNaira(roll.periodTotal)}</span>
            </div>
          </>
        )}
      </div>

      {/* ── The worker list ─────────────────────────────────────────────── */}
      {roll.rows.length === 0 ? (
        <div className="ew-card">
          <p className="ew-dash-note">
            {contractor
              ? <>No workers are assigned to {title} yet. Assign them under <strong>Roster</strong>.</>
              : 'Everyone on the roster has a contractor.'}
          </p>
        </div>
      ) : (
        <>
          <div className="ew-section-label">
            Workers · {prettyDateKey(today)}
          </div>
          {roll.rows.map(row => (
            <WorkerCard key={row.employee.id} row={row} onOpen={setOpenWorkerId} />
          ))}
        </>
      )}
    </div>
  )
}
