/* DayPay — the People pane: the roster, the rate editor and the add-worker form.
 *
 * These three used to live inside EmployerWorkspace.jsx, which made one file
 * the home of both the tab shell and the whole of the screen the redesign
 * rebuilds first. Splitting them out is Phase 2b of DayPay 2.0: no behaviour,
 * no markup and no styles changed — the components already took explicit props,
 * so this is a cut, a paste and the imports they need.
 *
 * `Staff` is the pane; `RateEditor` and `AddEmployee` are the two panels it
 * opens in place. `currentRateFor` is exported because the shell asks the same
 * question ("what rate is in force for this person today?").
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EmployerError, accountStatus, addRatePeriod, archiveEmployee, createEmployee,
  deleteRatePeriod, filterPeople, formatNaira, initials, issueInviteCode, rateOn,
  restoreEmployee,
  setAttendancePin, setEmployeeContractor, todayKey,
} from '../lib/employer'
import PinPanel from './PinPanel'
import WorkerView from './WorkerView'
import { Loading, Notice, TechDetail } from '../ui/Ui.jsx'
import './employer.css'

// ── Small helpers ───────────────────────────────────────────────────────────

function prettyDate(key) {
  if (!key) return ''
  const [y, m, d] = key.split('-').map(Number)
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${MON[m - 1]} ${y}`
}

/* The most recent rate period tells us what this person earns today. */
export function currentRateFor(periods, employeeId) {
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
    <div className="ew-card ew-roster-panel">
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
                  {p.effective_from > todayKey() && <span className="ew-chip ew-chip-warn dp-ml-8">future</span>}
                </span>
                <span className="dp-gap-8" style={{ display: 'flex', alignItems: 'center' }}>
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

      <div className="ew-formrow dp-mt-12">
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

      <p className="ew-hint dp-mt-8">
        A raise applies only from its start date. Days already logged keep the
        rate they were worked at — the past is never recalculated.
      </p>

      {err && (
        <div className="ew-msg ew-msg-error dp-mt-12">
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
  /* Phase 9. The form itself is unchanged in what it WRITES — one employee row,
     then a PIN if the employer asked for one — and it still hands the PIN over
     exactly once. What changed is that it says what it does: that a worker record
     is not an account, what is required and what is not, and why the button will
     not go yet. */
  const [name, setName] = useState('')
  const [job, setJob] = useState('')
  const [email, setEmail] = useState('')
  /* §8: a worker who will never have a login still has to be able to record
     attendance, so adding somebody to the roster issues their kiosk PIN at the
     same time. Ticked by default, because the common case is a site full of
     people with no smartphones — but not forced, because a workforce where
     everybody already has DayPay on their phone does not need fifty PINs
     nobody will ever type. */
  const [withPin, setWithPin] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [created, setCreated] = useState(null)   // { name, pin, pinFailed }
  const [copied, setCopied] = useState(false)
  const nameRef = useRef(null)
  
  /* Forgiving, not disabled. The button used to sit disabled with no reason given,
     which reads as a broken form; now the press is answered with the one thing
     that is missing, on the field that is missing it, and the cursor is put
     there. Nothing is sent to the database either way. */
  async function save() {
    if (!name.trim()) {
      setErr(new EmployerError('A worker needs a name', {
        hint: 'Their name is the only thing this form requires.',
      }))
      nameRef.current?.focus()
      return
    }
    setBusy(true); setErr(null)
    try {
      const row = await createEmployee({ fullName: name, jobTitle: job, email })

      /* The worker exists at this point, and that must not be undone by a
         failure in the second call. If the PIN cannot be issued they are still
         on the roster with everything else intact, and the notice says so —
         there is a button on their row that will do it again. */
      let pin = null
      let pinFailed = false
      if (withPin) {
        try { pin = await setAttendancePin(row.id) } catch { pinFailed = true }
      }

      /* Deliberately NOT calling onCreated() here. The parent's handler is
         `setAdding(false)` followed by a reload — and setAdding(false) unmounts
         this component, taking `created` with it. The PIN would be issued,
         stored, and never once displayed: the employer would press "Add to
         roster" and see the roster, with a secret they never read.

         Caught by the ui-check walk in scripts/ui-check/interact.jsx, which
         presses the real button and then looks for the number. So the card
         stays up until the employer dismisses it, and THAT is when the form
         closes and the roster refreshes. */
      setCreated({ id: row.id, name: row.full_name || name, pin, pinFailed })
      setName(''); setJob(''); setEmail('')
    } catch (e) {
      setErr(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusy(false)
    }
  }

  /* ── What just happened, and the one number that will not come back ──────
     The PIN is shown here because this is the only moment it exists in the
     clear. The card stays until the employer dismisses it, and says plainly
     that it is the last chance to write it down — an employer who taps away
     without reading has not lost the worker, only the number. */
  if (created) {
    return (
      <div className="ew-card ew-roster-panel" role="status">
        <h3 className="ew-form-title">
          <span className="ew-tick" aria-hidden="true">✓</span>
          {created.name} is on the roster
        </h3>

        {created.pin && (
          <div className="ew-pin-fresh">
            <p className="ew-pin-caption">Their site attendance PIN</p>
            <div className="ew-pin-value" data-testid="pin-value">{created.pin}</div>
            <p className="ew-pin-warn">
              Write this down and give it to {created.name}. It is the only time
              it will be shown — it is stored hashed, so nobody can read it
              back. They will also need the site code on the day, which you
              issue from the Today screen.
            </p>
          </div>
        )}

        {created.pinFailed && (
          <div className="ew-msg ew-msg-warn">
            Added, but the attendance PIN could not be issued.
            <span className="ew-msg-hint">
              Nothing else was affected — press PIN on their row to try again.
            </span>
          </div>
        )}

        {!created.pin && !created.pinFailed && (
          <p className="ew-hint dp-mt-8">
            They have no PIN, so they record attendance by signing in. You can
            issue one from their row at any time.
          </p>
        )}

        {/* Done hands the parent the id of the worker that was just created. It
            used to hand over its click event, which arrived as a MouseEvent. */}
        {!created.pin && created.pinFailed ? (
          <div className="ew-actions">
            <button type="button" className="ew-btn ew-btn-primary ew-btn-sm" onClick={() => onCreated(created.id)}>
              Done
            </button>
          </div>
        ) : (
          <div className="ew-actions">
            <button
              type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
              onClick={async () => {
                setCopied(true)
                try { await navigator.clipboard?.writeText(created.pin || '') } catch { /* nothing to copy through */ }
              }}
              disabled={!created.pin || copied}
            >
              {copied ? '✓ Copied' : 'Copy PIN'}
            </button>
            <button type="button" className="ew-btn ew-btn-primary ew-btn-sm" onClick={() => onCreated(created.id)}>
              Done
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ew-card ew-roster-panel">
      <h3 className="ew-form-title">Add a worker</h3>
      {/* The single sentence this form owes an employer: a worker record is not an
          account, and somebody with no phone is still fully employable. It is the
          difference between "Not registered" reading as a fact about a login and
          reading as a fact about their job. */}
      <p className="ew-hint ew-form-lede">
        This puts them on your roster — it does not create a DayPay account for them.
        They can be invited whenever they are ready, and their days are recorded the
        same either way.
      </p>

      <div className="ew-form">
        <div className="ew-field">
          <label className="ew-label" htmlFor="ew-new-worker-name">
            Full name
          </label>
          <input
            id="ew-new-worker-name"
            ref={nameRef}
            className="ew-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Amina Yusuf"
            aria-invalid={!!err && !name.trim()}
            autoFocus
          />
        </div>
        <div className="ew-formrow">
          <div className="ew-field">
            <label className="ew-label">Job title <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label>
            <input className="ew-input" value={job} onChange={e => setJob(e.target.value)} placeholder="e.g. Welder" />
          </div>
          <div className="ew-field">
            <label className="ew-label">Email <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label>
            <input className="ew-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="for inviting them later" />
          </div>
        </div>
        <label className="ew-check">
          <input type="checkbox" checked={withPin} onChange={e => setWithPin(e.target.checked)} />
          <span>
            Give them a site attendance PIN
            <span className="ew-check-sub">
              For recording attendance at the worksite kiosk — no smartphone and
              no DayPay account needed. You will see the PIN once, to hand over.
            </span>
          </span>
        </label>
      </div>

      {/* Announced, not just coloured: the field is focused for a sighted keyboard
          user, and this is what a screen reader hears when the press is refused. */}
      {err && (
        <div className="ew-msg ew-msg-error dp-mt-12" role="alert">
          {err.message}{err.hint && <span className="ew-msg-hint">{err.hint}</span>}
        </div>
      )}

      <div className="ew-actions">
        <button type="button" className="ew-btn ew-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="ew-btn ew-btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Adding…' : 'Add to roster'}
        </button>
      </div>
    </div>
  )
}

// ── Staff screen ────────────────────────────────────────────────────────────

export default function Staff({
  employees, contractors = [], periods, loading, error, reload,
  /* Phase 9: the add form is a step inside this screen, and its address decides
     whether it is open. The props are optional so the screen works mounted on its
     own — which is how the harness mounts it — and the address half is what makes
     "Add your first worker" on the command centre land on the form itself. */
  startAdding = false, onOpenAdd = null, onCloseAdd = null,
}) {
  const onInviteChanged = reload
    const [adding, setAdding] = useState(startAdding)
  const [rateFor, setRateFor] = useState(null)
  const [inviteFor, setInviteFor] = useState(null)
  const [busyInvite, setBusyInvite] = useState(false)
  /* Which worker's PIN panel is open. Only one card is open at a time — the
     roster already opens Rate panels and the Add form the same way, and two
     open cards push the roster off the screen on a phone. */
    const [pinFor, setPinFor] = useState(null)
    const [showArchived, setShowArchived] = useState(false)
        const [busyId, setBusyId] = useState(null)
    /* Which row has its overflow open, and which row is asking "are you sure".
       Both are inline — under the row that owns them — because a floating menu
       on a phone covers the thing it is telling you about. */
    const [menuFor, setMenuFor] = useState(null)
    const [confirmArchive, setConfirmArchive] = useState(null)
    /* The search, the filter, and the worker whose own screen is open. All three
       are this screen's own business — the shell knows nothing about them — and
       the query survives opening a worker and coming back, because an employer
       who searched, opened somebody, and returned to an empty box has lost their
       place. */
        const [query, setQuery] = useState('')
      const [who, setWho] = useState('all')
      const [workerFor, setWorkerFor] = useState(null)

      /* Arriving at /people/new — by link, by reload, or from the command centre's
         one action — opens the form. The reverse is not true: opening the form by
         pressing Add navigates, which comes back through here and changes nothing. */
      useEffect(() => { if (startAdding) setAdding(true) }, [startAdding])

      const openAdd = () => { setRateFor(null); setInviteFor(null); setPinFor(null); setAdding(true); onOpenAdd?.() }
      /* Closing puts the address back to the roster, so the back button and a reload
         agree with what is on screen. */
      const closeAdd = () => { setAdding(false); onCloseAdd?.() }

      

  const contractorName = useCallback(
    (id) => contractors.find(c => c.id === id)?.name || null,
    [contractors],
  )

    const active = employees.filter(e => e.status === 'active')
    const archived = employees.filter(e => e.status !== 'active')
    /* The same number the "rates set" stat card showed. It is computed from the
       rate periods rather than stored, so it cannot drift from what the rows
       below actually display. */
    const ratesSet = active.filter(e => currentRateFor(periods, e.id)).length

    /* The three questions this list is asked, in the words the rows already use:
       everybody, the people who can sign in, and the people who cannot yet.
       'Pending' is not a state this product has — a worker is on the roster or
       they are archived — so the filter is named after the fact that actually
       varies, which is whether they have a DayPay sign-in. The row's chip says
       the same words, so the filter and the chip cannot disagree. */
    const searched = filterPeople(active, query, e => [contractorName(e.contractor_id)])
    const shown = who === 'registered' ? searched.filter(e => accountStatus(e).registered)
      : who === 'pending' ? searched.filter(e => !accountStatus(e).registered)
        : searched
    const filtering = query.trim() !== '' || who !== 'all'
    const archivedMatches = query.trim()
      ? filterPeople(archived, query, e => [contractorName(e.contractor_id)]).length
      : 0

    if (loading) return <Loading label="Loading your staff…" />

  /* A worker's own screen is a place, not a panel: it replaces the roster and
     carries its own way back. Opening it from the row is what makes the row
     worth pressing — the name, the trade, the rate, the days and the corrections
     all live there, and the roster is where an employer finds somebody. */
  const openWorker = workerFor ? employees.find(e => e.id === workerFor) || null : null
  if (openWorker) {
    return (
      <WorkerView
        employee={openWorker}
        periods={periods || []}
        contractorName={contractorName(openWorker.contractor_id)}
        onBack={() => setWorkerFor(null)}
        onChanged={reload}
      />
    )
  }

  return (
    <>
        <div className="ew-head">
          <div className="ew-head-text">
            {/* "People", not "Staff" — and not "Roster" either: the tab that
                opens this screen says People (§10), and a screen whose heading
                disagrees with its tab reads as two screens. The word "roster"
                stays where it is the right word (a worker is on the roster);
                it just stops being the name of the screen. */}
            <h2 className="ew-title">People</h2>
            <p className="ew-sub">
              {error
                ? 'Could not load your roster'
                : active.length === 0
                  ? 'No one on the roster yet'
                  : `${active.length} on roster, ${ratesSet} with ${ratesSet === 1 ? 'a rate' : 'rates'} set${archived.length && !showArchived ? ` · ${archived.length} archived` : ''}`}
            </p>
          </div>
          {/* Hidden while any panel is open, not just the two the roster owns:
              a panel brings its own single action, and two filled buttons in one
              view is the thing this screen was reported for. */}

                    {!adding && !rateFor && !inviteFor && (
            <button type="button" className="ew-btn ew-btn-primary" onClick={openAdd}>
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
            /* §39: one disclosure in the product, not two. This was the original,
               and TechDetail is that pattern lifted into the design system, so the
               screens that had to add one (Contractors, Billing, the kiosk) did not
               invent a fourth way to show a database error. */
            <TechDetail>
              <pre style={{
                margin: '7px 0 0', padding: '8px 10px', borderRadius: 8,
                background: 'rgba(0,0,0,.06)', fontSize: 12,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45,
              }}>
{error.code ? `code: ${error.code}\n` : ''}{error.cause?.message || ''}{error.cause?.details ? `\ndetails: ${error.cause.details}` : ''}{error.cause?.hint ? `\nhint: ${error.cause.hint}` : ''}
              </pre>
            </TechDetail>
          )}
        </div>
      )}

            {adding && (
                <AddEmployee
          /* Done gives back the id of the worker it created; the step it belongs to
             ends here. The confirmation already happened — on the card that named
             them and handed over the PIN — so nothing is repeated onto the roster. */
          onCreated={async (id) => {
            if (id) closeAdd()
            await reload()
          }}
          onCancel={closeAdd}
        />
      )}

      {/* The house pattern (src/ui/Ui.jsx): an empty state is a Notice, not a
          screen-local block. Phase 6 brought this screen onto it, so the roster
          that is empty and the search that matched nothing are said the same way —
          and neither can drift from the other's wording or spacing.
          No action on this one: the screen's one filled button, Add, is already
          above it, and a second one inviting the same tap is how a screen ends up
          with two primary buttons. */}
      {active.length === 0 && !adding && (
        <Notice
          tone="empty"
          title="Your roster is empty"
          body="Add the people you pay by the day. You can set each person's rate, log their days, and see what you owe at month end."
        />
      )}

      {/* ── the roster ────────────────────────────────────────────────────────
          One bordered container with hairline dividers, not a card per person: a
          roster of three should read as a list, and separate cards made every
          row look like its own screen.

          Two things moved off the row. The contractor select was on it, and at
          `max-width: 116px` it clipped the rate and the status text beside it —
          it now sits in the row's overflow, where changing who supplies a worker
          cannot be a mis-tap on the way to Rates. And the four actions were all
          the same weight and size, including Archive; now one contextual action
          is visible (Rates, or Send invite for a worker with no login yet) and
          everything else is behind the overflow, Archive last and in danger. */}
      {active.length > 0 && rateFor === null && !adding && (
        <div className="ew-find">
          <input
            type="search"
            className="ew-input ew-find-input"
            value={query}
                                                onChange={ev => setQuery(ev.target.value)}
            placeholder="Search name, trade or contractor"
            aria-label="Search your workers"
            autoComplete="off"
          />

          <div className="segmented ew-find-filter" role="group" aria-label="Which workers to show">
            {[['all', 'All'], ['registered', 'Registered'], ['pending', 'Not registered']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={who === id ? 'active' : ''}
                aria-pressed={who === id}
                                                                onClick={() => setWho(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {filtering && (
            <div className="ew-find-count">
              <span>{shown.length} of {active.length} shown</span>
              <button
                type="button" className="dp-sec-action"
                                                                onClick={() => { setQuery(''); setWho('all') }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* Nothing matched is a result, and a result has to be stated: a blank
          pane reads as a broken screen. It also says where the person went if
          they are archived, because that is the one case the roster search
          cannot show and one an employer is likely to hit. */}
      {active.length > 0 && rateFor === null && !adding && shown.length === 0 && (
        <Notice
          tone="empty"
          title="Nobody matches"
          body={archivedMatches > 0
            ? `${archivedMatches} archived ${archivedMatches === 1 ? 'worker matches' : 'workers match'} “${query.trim()}” — open the archived list below.`
            : `No one on your roster matches “${query.trim()}”. Try part of a name, a trade, or a contractor.`}
          action={(
            <button type="button" className="ew-btn" onClick={() => { setQuery(''); setWho('all') }}>
              Clear the search
            </button>
          )}
        />
      )}

      {active.length > 0 && rateFor === null && !adding && shown.length > 0 && (
        <div className="ew-list">
          {shown.map(e => {
            const rate = currentRateFor(periods, e.id)
            const hasRate = !!rate
            const st = accountStatus(e)
            const supplier = contractorName(e.contractor_id)
            const subline = [e.job_title, supplier].filter(Boolean).join(', ')
            const open = menuFor === e.id
            const confirming = confirmArchive === e.id
            const suppliers = contractors.filter(c => c.status === 'active')

            const closer = (fn) => () => { fn(); setMenuFor(null); setConfirmArchive(null) }

            return (
                                                        <div className="ew-row" key={e.id}>
                {/* The row opens the person. Spans, not divs, because this is a
                    button: a button may only hold phrasing content, and a nested
                    div is the kind of markup that works until it does not. */}
                <button
                  type="button"
                  className="ew-row-top ew-row-open"
                  aria-label={`Open ${e.full_name}`}
                                                                        onClick={() => { setWorkerFor(e.id); setMenuFor(null); setConfirmArchive(null) }}
                >
                  <span className="ew-avatar" aria-hidden="true">{initials(e.full_name)}</span>
                  <span className="ew-row-text">
                    <span className="ew-row-name">{e.full_name}</span>
                    {subline && <span className="ew-row-sub">{subline}</span>}
                  </span>
                  <span
                    className={`ew-chip ${st.registered ? 'ew-chip-live' : 'ew-chip-warn'}`}
                    title={st.hint}
                  >
                    {st.text}
                  </span>
                  <span className="ew-row-go" aria-hidden="true">›</span>
                </button>

                <div className="ew-row-foot">
                  <span className={hasRate ? 'ew-rate' : 'ew-rate-none'}>
                    {hasRate ? `${formatNaira(rate.daily_rate)} per day` : 'No rate set'}
                  </span>
                  <div className="ew-row-actions">
                    <button
                      type="button"
                      className={`ew-btn ew-btn-sm ${st.registered ? 'ew-btn-ghost' : 'ew-btn-accent'}`}
                      onClick={st.registered
                        ? closer(() => { setRateFor(e.id); setInviteFor(null); setAdding(false); setPinFor(null) })
                        : closer(() => { setInviteFor(e.id === inviteFor ? null : e.id); setRateFor(null); setAdding(false); setPinFor(null) })}
                    >
                      {st.registered ? 'Rates' : 'Send invite'}
                    </button>
                    <button
                      type="button"
                      className="ew-btn ew-btn-ghost ew-btn-sm ew-more"
                      aria-expanded={open}
                      aria-label={`More actions for ${e.full_name}`}
                      onClick={() => { setMenuFor(open ? null : e.id); setConfirmArchive(null) }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="ew-menu">
                    {suppliers.length > 0 && (
                      <label className="ew-menu-field">
                        <span className="ew-menu-label">Contractor</span>
                        <select
                          className="ew-select ew-select-sm ew-menu-select"
                          aria-label={`Contractor for ${e.full_name}`}
                          value={e.contractor_id || ''}
                          disabled={busyId === e.id}
                          onChange={async (ev) => {
                            setBusyId(e.id)
                            try { await setEmployeeContractor(e.id, ev.target.value); await reload() }
                            finally { setBusyId(null) }
                          }}
                        >
                          <option value="">No contractor</option>
                          {suppliers.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <button
                      type="button" className="ew-menu-item"
                      onClick={closer(() => { setPinFor(e.id === pinFor ? null : e.id); setRateFor(null); setAdding(false); setInviteFor(null) })}
                    >
                      Reset PIN
                    </button>

                    {!st.registered && (
                      <button
                        type="button" className="ew-menu-item"
                        onClick={closer(() => { setRateFor(e.id); setAdding(false) })}
                      >
                        Edit rates
                      </button>
                    )}

                    {confirming ? (
                      <div className="ew-confirm" role="group" aria-label={`Archive ${e.full_name}`}>
                        <p className="ew-confirm-text">
                          Move {e.full_name} off the roster? Their days and pay are kept.
                        </p>
                        <div className="ew-confirm-row">
                          <button
                            type="button" className="ew-btn ew-btn-danger ew-btn-sm"
                            disabled={busyId === e.id}
                            onClick={async () => {
                              setBusyId(e.id)
                              try { await archiveEmployee(e.id); await reload(); setMenuFor(null); setConfirmArchive(null) }
                              finally { setBusyId(null) }
                            }}
                          >
                            {busyId === e.id ? 'Archiving…' : 'Yes, archive'}
                          </button>
                          <button
                            type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                            onClick={() => setConfirmArchive(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button" className="ew-menu-item is-danger"
                        onClick={() => setConfirmArchive(e.id)}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {inviteFor && (() => {
        const emp = employees.find(x => x.id === inviteFor)
        if (!emp) return null
        const linked = !!emp.employee_user_id
        return (
          <div className="ew-card ew-roster-panel">
            <div className="ew-label">Invite {emp.full_name}</div>

            {linked ? (
              <>
                <p className="ew-invite-used dp-mt-8">
                  Registered. They have their own DayPay sign-in.
                </p>
                <p className="ew-hint dp-mt-8">
                  They can see their own days and pay, and nobody else's.
                </p>
              </>
            ) : emp.invite_code ? (
              <>
                <div className="ew-invite-row dp-mt-8">
                  <span className="ew-invite-code">{emp.invite_code}</span>
                  <button
                    type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                    disabled={busyInvite}
                    onClick={async () => {
                      /* The steps in this message have to match the sign-up
                         screen exactly. Since Phase 10 the code is entered
                         WHILE creating the account (choose Employee), not
                         after signing in — a message describing the old flow
                         sends the worker looking for a box that is not there. */
                      const where = (typeof window !== 'undefined' && window.location?.origin) || 'DayPay'
                      const text =
                        `DayPay: create your account at ${where} — choose Employee and enter this code: ${emp.invite_code}\n`
                        + `You only need the code once; after that you just sign in with your email.`
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
                <p className="ew-hint dp-mt-8">
                  Give them this code. They create their own account, choose
                  Employee, and enter it once — then they can see their own days
                  and pay, and nobody else's. The code stops working the moment
                  it is used, and they are never asked for it again.
                </p>
                <div className="ew-actions dp-mt-8">
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
                <p className="ew-hint dp-mt-8">
                  No invite code yet. Create one to let this person sign in and
                  see their own days.
                </p>
                <div className="ew-actions dp-mt-8">
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

      {pinFor && (() => {
        const emp = employees.find(x => x.id === pinFor)
        if (!emp) return null
        return <PinPanel employee={emp} onChanged={reload} />
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
            {/* Quiet text, not a button: showing the archive is housekeeping,
                and it should not compete with Add. */}
            <button
              type="button" className="ew-text-btn"
              onClick={() => setShowArchived(v => !v)}
            >
              {showArchived ? 'Hide archived' : `Show ${archived.length} archived`}
            </button>

            {showArchived && (
              <div className="ew-list is-archived">
                {archived.map(e => (
                  <div className="ew-row" key={e.id}>
                    <button
                      type="button"
                      className="ew-row-top ew-row-open"
                      aria-label={`Open ${e.full_name}`}
                      onClick={() => setWorkerFor(e.id)}
                    >
                      <span className="ew-avatar" aria-hidden="true">{initials(e.full_name)}</span>
                      <span className="ew-row-text">
                        <span className="ew-row-name">{e.full_name}</span>
                        {e.job_title && <span className="ew-row-sub">{e.job_title}</span>}
                      </span>
                      <span className="ew-chip">Archived</span>
                      <span className="ew-row-go" aria-hidden="true">›</span>
                    </button>
                    <div className="ew-row-foot">
                      <span className="ew-row-note">Their days and pay are kept</span>
                      <div className="ew-row-actions">
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
                  </div>
                ))}
              </div>
            )}
        </>
      )}

      {/* Contractor management and the site kiosk used to sit at the foot of
          this screen. They are rows under More now (Phase 3): organising the
          site is not what an employer opened People to do, and both had the
          same weight as the list they were pushing down. Nothing was removed —
          see MorePane.jsx. */}
    </>
  )
}
