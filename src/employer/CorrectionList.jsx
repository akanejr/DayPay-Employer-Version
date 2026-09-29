/* DayPay Employer Version — the worker's own requests, and their answer.
 *
 * A request the worker cannot see the fate of is a complaint, not a
 * correction. This is the other half of the form: what was asked, what the
 * employer decided, and what they said about it.
 *
 * The chips come from CORRECTION_STATUS so the worker's screen and the
 * employer's queue cannot drift into saying different things about the same
 * row.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useState } from 'react'
import {
  EmployerError, withdrawCorrection,
  CORRECTION_LABELS, CORRECTION_STATUS, prettyDateKey, KIND_LABELS,
} from '../lib/employer'

export default function CorrectionList({ rows = [], onChanged, compact = false }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  if (!rows.length) return null

  async function withdraw(row) {
    setBusyId(row.id); setError(null)
    try {
      await withdrawCorrection(row.id)
      onChanged?.()
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusyId(null)
    }
  }

  const shown = compact ? rows.slice(0, 4) : rows

  return (
    <div className="ew-corrections">
      {!compact && <div className="ew-section-label">Your requests</div>}

      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}{error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      {shown.map(row => {
        const st = CORRECTION_STATUS[row.status] || CORRECTION_STATUS.open
        const wanted = row.want_kind ? (KIND_LABELS[row.want_kind] || row.want_kind) : null
        return (
          <div className="ew-corr-row" key={row.id}>
            <div className="ew-corr-row-head">
              <span className="ew-name">{prettyDateKey(row.work_date)}</span>
              <span className={st.cls}>{st.text}</span>
            </div>

            <div className="ew-corrections-meta">
              {CORRECTION_LABELS[row.request_kind] || row.request_kind}
              {wanted ? ` · should be ${wanted.toLowerCase()}` : ''}
            </div>

            {row.message && <p className="ew-corr-msg">“{row.message}”</p>}

            {row.decision_note && (
              <p className="ew-corr-decision">
                <span className="ew-corr-decision-label">Your employer said</span>
                {row.decision_note}
              </p>
            )}

            {row.status === 'open' && (
              <button
                type="button" className="ew-linkbtn"
                onClick={() => withdraw(row)}
                disabled={busyId === row.id}
              >
                {busyId === row.id ? 'Withdrawing…' : 'Withdraw this request'}
              </button>
            )}
          </div>
        )
      })}

      {compact && rows.length > shown.length && (
        <p className="ew-hint">{rows.length - shown.length} older request(s) in your history.</p>
      )}
    </div>
  )
}
