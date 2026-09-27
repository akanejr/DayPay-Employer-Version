/* DayPay Employer Version — contractors: add, rename, archive.
 *
 * Lives inside the Roster pane rather than as a fifth sub-tab. The brief warns
 * against too many navigation items, and organising workers is a roster act —
 * this is where an employer already is when they think about who works for
 * whom.
 *
 * Deliberately absent: delete. A contractor is a label on real historical days
 * and on money that has already been earned; removing the row would leave those
 * days with nothing to explain them. Archive takes it off the lists and keeps
 * the history intact.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useState } from 'react'
import {
  EmployerError, createContractor, updateContractor,
  archiveContractor, restoreContractor,
} from '../lib/employer'

export default function ContractorEditor({ contractors, employees = [], onChanged }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  const active = contractors.filter(c => c.status === 'active')
  const archived = contractors.filter(c => c.status !== 'active')
  const listed = showArchived ? archived : active

  const workerCount = (id) => employees.filter(e => e.contractor_id === id && e.status === 'active').length
  const unassigned = employees.filter(e => !e.contractor_id && e.status === 'active').length

  async function run(fn, id) {
    setBusyId(id ?? 'new')
    setError(null)
    try { await fn(); await onChanged() }
    catch (e) { setError(e instanceof EmployerError ? e : new EmployerError(String(e))) }
    finally { setBusyId(null) }
  }

  return (
    <div className="ew-card">
      <div className="ew-board-head">
        <div>
          <div className="ew-board-label">Contractors</div>
          <div className="ew-board-date" style={{ fontSize: 14.5 }}>
            Who supplies your workers
          </div>
        </div>
        {!adding && (
          <button
            type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
            onClick={() => { setAdding(true); setDraft('') }}
          >
            Add contractor
          </button>
        )}
      </div>

      {error && (
        <div className="ew-msg ew-msg-error" style={{ marginTop: 10 }}>
          {error.message}
          {error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      {adding && (
        <div className="ew-form" style={{ marginTop: 11 }}>
          <div className="ew-field">
            <label className="ew-label" htmlFor="ew-new-contractor">Contractor name</label>
            <input
              id="ew-new-contractor" className="ew-input" autoFocus
              placeholder="e.g. Alpha Services"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && draft.trim()) {
                  run(() => createContractor(draft), 'new').then(() => { setAdding(false); setDraft('') })
                }
                if (e.key === 'Escape') { setAdding(false); setDraft('') }
              }}
            />
            <span className="ew-hint">
              Workers are assigned to contractors on their own rows below.
            </span>
          </div>
          <div className="ew-actions">
            <button
              type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
              onClick={() => { setAdding(false); setDraft('') }}
            >
              Cancel
            </button>
            <button
              type="button" className="ew-btn ew-btn-primary ew-btn-sm"
              disabled={!draft.trim() || busyId === 'new'}
              onClick={() => run(() => createContractor(draft), 'new').then(() => { setAdding(false); setDraft('') })}
            >
              {busyId === 'new' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {listed.length === 0 && !adding && (
        <p className="ew-dash-note" style={{ marginTop: 10 }}>
          {active.length === 0 && archived.length === 0
            ? <>No contractors yet. Your roster works perfectly without them — add one when workers start arriving through a supplier.</>
            : 'No archived contractors.'}
        </p>
      )}

      {listed.map(c => (
        <div className="ew-person" key={c.id} style={c.status !== 'active' ? { opacity: .72 } : undefined}>
          <div className="ew-person-body">
            {editingId === c.id ? (
              <input
                className="ew-input"
                autoFocus
                value={editDraft}
                onChange={e => setEditDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && editDraft.trim()) {
                    run(() => updateContractor(c.id, { name: editDraft }), c.id).then(() => setEditingId(null))
                  }
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <>
                <div className="ew-name">{c.name}</div>
                <div className="ew-meta">
                  {c.status !== 'active'
                    ? <span className="ew-chip">archived</span>
                    : <span>{workerCount(c.id)} worker{workerCount(c.id) === 1 ? '' : 's'}</span>}
                </div>
              </>
            )}
          </div>

          <div className="ew-person-actions">
            {editingId === c.id ? (
              <>
                <button
                  type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </button>
                <button
                  type="button" className="ew-btn ew-btn-primary ew-btn-sm"
                  disabled={!editDraft.trim() || busyId === c.id}
                  onClick={() => run(() => updateContractor(c.id, { name: editDraft }), c.id).then(() => setEditingId(null))}
                >
                  {busyId === c.id ? '…' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                  onClick={() => { setEditingId(c.id); setEditDraft(c.name) }}
                >
                  Rename
                </button>
                <button
                  type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                  disabled={busyId === c.id}
                  onClick={() => run(
                    () => (c.status === 'active' ? archiveContractor(c.id) : restoreContractor(c.id)),
                    c.id,
                  )}
                >
                  {c.status === 'active' ? 'Archive' : 'Restore'}
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {archived.length > 0 && (
        <button
          type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
          style={{ alignSelf: 'flex-start', marginTop: 6 }}
          onClick={() => setShowArchived(v => !v)}
        >
          {showArchived ? 'Hide archived' : `Show ${archived.length} archived`}
        </button>
      )}

      {unassigned > 0 && active.length > 0 && (
        <p className="ew-dash-foot">
          {unassigned} worker{unassigned === 1 ? '' : 's'} not assigned to a contractor yet.
        </p>
      )}
    </div>
  )
}
