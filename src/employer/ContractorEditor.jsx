/* DayPay Employer Version — contractors: who supplies whom.
 *
 * A destination of its own under More (Phase 3 gave it the address, Phase 8 made
 * it a screen). It used to be a row at the foot of the roster, and then a row with
 * a heading on top of it — furniture from a place this is no longer in. It opens
 * with its own name now, like every other screen, and it answers the question the
 * name asks: WHO is under each contractor. A bare count made an employer open
 * People to find out.
 *
 * Assignment is not editable here, deliberately: who supplies a worker is set on
 * the worker's own row in People, where the worker is, and only the employer can
 * set it. This screen says so rather than offering a second place to do it.
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
import { Notice, TechDetail } from '../ui/Ui.jsx'

export default function ContractorEditor({ contractors, employees = [], available = true, onChanged }) {
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
  const activeWorkers = employees.filter(e => e.status === 'active').length
  const assigned = activeWorkers - unassigned
  const workerNames = (id) => employees
    .filter(e => e.contractor_id === id && e.status === 'active')
    .map(e => e.full_name)

  async function run(fn, id) {
    setBusyId(id ?? 'new')
    setError(null)
    try { await fn(); await onChanged() }
    catch (e) { setError(e instanceof EmployerError ? e : new EmployerError(String(e))) }
    finally { setBusyId(null) }
  }

  /* The database has not had migration 007 run against it. Saying so is much
     better than rendering a working-looking form whose every button fails: the
     employer has no way to tell a missing table from a bad name, and would
     reasonably conclude the app is broken. */
  if (!available) {
    return (
      <div className="ew-screen">
        <header className="ew-head">
          <div className="ew-head-text">
            <h2 className="ew-title">Contractors</h2>
            <p className="ew-sub">Who each worker answers to</p>
          </div>
        </header>

        <p className="ew-dash-note">
          Contractors aren’t switched on for this account yet, so this section is
          empty on purpose. Your roster works exactly as before — workers just
          aren’t grouped. Whoever set DayPay up can switch them on.
        </p>
        {/* §39: the sentence an employer reads is theirs; the file they cannot act
            on sits one tap away, for whoever can. */}
        <TechDetail>
          <code>supabase/migrations/007_contractors.sql</code> — run it in the
          Supabase SQL editor, then press Check again.
        </TechDetail>
        <button
          type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
          disabled={busyId === 'recheck'}
          onClick={() => run(async () => {}, 'recheck')}
        >
          {busyId === 'recheck' ? 'Checking…' : 'Check again'}
        </button>
        {error && (
          <div className="ew-msg ew-msg-error dp-mt-12">
            {error.message}
          </div>
        )}
      </div>
    )
  }

    return (
      <div className="ew-screen">
        {/* The screen's own name, and its one filled action. The words are the
            words the More row uses — a row that says one thing and a screen that
            says another is how two screens appear where there is one. */}
        <header className="ew-head">
          <div className="ew-head-text">
            <h2 className="ew-title">Contractors</h2>
            <p className="ew-sub">
              {active.length === 0
                ? 'Who each worker answers to'
                : `${active.length} contractor${active.length === 1 ? '' : 's'} · ${assigned} of ${activeWorkers} workers assigned`}
            </p>
          </div>
          {/* One filled action at a time, the People screen's rule: while a row
              is being renamed its Save is the screen's action and this stands
              down. Two solid buttons in one view is what the roster was reported
              for, and a header is not exempt from it. */}
          {!adding && editingId === null && (
            <button
              type="button" className="ew-btn ew-btn-primary"
              onClick={() => { setAdding(true); setDraft('') }}
            >
              + Add
            </button>
          )}
        </header>

      {error && (
        <div className="ew-msg ew-msg-error dp-mt-12">
          {error.message}
          {error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      {adding && (
        <div className="ew-form dp-mt-12">
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
              type="button" className="ew-btn ew-btn-accent ew-btn-sm"
              disabled={!draft.trim() || busyId === 'new'}
              onClick={() => run(() => createContractor(draft), 'new').then(() => { setAdding(false); setDraft('') })}
            >
              {busyId === 'new' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* An empty state is the house Notice, the same as on every other screen:
          one shape for "there is nothing here", so that a screen cannot quietly
          grow a second, quieter one. The archived case is a line, not an empty
          state — the screen is not empty, the filter is. */}
      {/* Which list is empty decides what may be said. This used to fall through to
          "No archived contractors." whenever the archive was not the empty one — so
          an employer who archived their only contractor, whose archived list held
          that contractor, was told there were none. (Phase 9.) */}
      {listed.length === 0 && !adding && (
        !showArchived
          ? (
            active.length === 0 && archived.length === 0
              ? (
                <Notice
                  tone="empty"
                  title="No contractors yet"
                  body="Your roster works without them. Add one when workers start arriving through a supplier — who supplies whom is then set on the worker's own row in People."
                />
              )
              : (
                <p className="ew-dash-note">
                  No active contractors — the archived ones are listed below.
                </p>
              )
          )
          : <p className="ew-dash-note">No archived contractors.</p>
      )}

        {/* One list with dividers, the same container the roster uses (Phase 16).
            A card per contractor read as a pile rather than a list, next to a roster
            that had already been consolidated. `.ew-person` on its own — the rate
            panel's header in People — keeps the card it needs. */}
        <div className="ew-list">
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
                  {/* WHO, not how many. An employer who has to open People to find
                      out which of their workers a contractor supplies has been sent
                      somewhere else to read this screen's own answer. Names only —
                      a name is not a control here. */}
                  {workerNames(c.id).length > 0 && (
                    <p className="ew-contractor-who">{workerNames(c.id).join(' · ')}</p>
                  )}
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
                    type="button" className="ew-btn ew-btn-accent ew-btn-sm"
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
        </div>

      {archived.length > 0 && (
        <button
          type="button" className="ew-btn ew-btn-ghost ew-btn-sm dp-mt-8"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setShowArchived(v => !v)}
        >
          {showArchived ? 'Hide archived' : `Show ${archived.length} archived`}
        </button>
      )}

      {unassigned > 0 && active.length > 0 && (
        <p className="ew-dash-foot">
          {unassigned} worker{unassigned === 1 ? '' : 's'} not assigned to a contractor yet.
          Who supplies whom is set on the worker&apos;s own row in People.
        </p>
      )}
    </div>
  )
}
