/* DayPay — the workplace name (§20).
 *
 * What was wrong: `employers.business_name` had a column, a writer in the data
 * layer (`updateBusinessName`) and three readers — the worker's own header, the
 * leave prompt and the site kiosk's door screen — and nothing that ever called the
 * writer. So all three fell back, and an employer's own product called their
 * business "My team" and "Your site" to the people who work there. The audit's
 * table row 20 is the whole story: "exists in the data layer and is called from
 * nowhere".
 *
 * This is the screen that calls it. It is a component rather than a block inside
 * `src/App.jsx` for one reason that matters here: a save is a claim about what
 * reaches the database, and this way the claim can be driven in a real DOM with
 * the data layer the harness already stands in for — typing, pressing Save, and
 * reading what the mock was asked to write.
 *
 * The name reaches four surfaces, and this component is only the first:
 *   · the settings row and the field below it — here;
 *   · the worker's own screen, where `EmployeeView` prints it instead of "My team";
 *   · the site kiosk's header, where it replaces "Your site";
 *   · and the payslip's provenance line, which says WORKPLACE rather than a
 *     personal tally when the worker is on somebody's books.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useEffect, useId, useState } from 'react'
import { updateBusinessName } from '../lib/employer'

/* The briefcase, drawn once. A workplace is a place of work, not a briefcase —
   but every other mark on this settings page is a 19px line icon, and a map pin
   would read as a location, which is the one thing this app promises never to do
   with anybody's position. */
function BriefcaseMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="7" width="19" height="13" rx="2.5" />
      <path d="M8.5 7V5.4A1.9 1.9 0 0 1 10.4 3.5h3.2A1.9 1.9 0 0 1 15.5 5.4V7" />
      <path d="M2.5 12.5h19" />
    </svg>
  )
}

/* ── the row in the settings list ─────────────────────────────────────────────
   Drawn only for an employer — `workplaceVisible()` in employerLogic.js is the
   rule, and `src/App.jsx` holds it. The summary says what the name IS, so an
   employer who has never named the place can see that from the list. */
export function WorkplaceRow({ name, onOpen }) {
  const named = (name || '').trim()
  return (
    <button type="button" className="sp-cat-card" onClick={onOpen}>
      <span className="sp-cat-ico"><BriefcaseMark /></span>
      <span className="sp-cat-body">
        <span className="sp-cat-line">
          <span className="sp-cat-name">Workplace</span>
          <span className="sp-cat-sum">{named || 'Not named yet'}</span>
        </span>
        <span className="sp-cat-desc">The name your workers see.</span>
      </span>
    </button>
  )
}

/* ── the page ──────────────────────────────────────────────────────────────── */
export default function Workplace({ name, onSaved }) {
  const stored = (name || '').trim()
  const [draft, setDraft] = useState(stored)
  const [saving, setSaving] = useState(false)
  const [said, setSaid] = useState('')
  const [err, setErr] = useState('')
  const fieldId = useId()

  /* The field follows the stored name. It matters after a save on another device
     (the roles read comes back with a new name) and after a failed save, where the
     field must not keep a value the database never agreed to. */
  useEffect(() => { setDraft(stored) }, [stored])

  async function save() {
    const next = draft.trim()
    if (!next || saving) return
    setSaving(true); setErr(''); setSaid('')
    try {
      await updateBusinessName(next)
      setSaid('Saved. Your workers will see this name.')
      await onSaved?.(next)
    } catch (e) {
      setErr(e?.hint
        ? `${e?.message || 'Could not save that.'} — ${e.hint}`
        : (e?.message || 'Could not save your workplace name.'))
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="sp-card sp-profile">
        <span className="sp-avatar sp-avatar-ghost"><BriefcaseMark /></span>
        <div className="sp-profile-main">
          <label className="sr-only" htmlFor={fieldId}>Workplace name</label>
          <input
            id={fieldId}
            className="sp-name-input"
            value={draft}
            onChange={e => { setDraft(e.target.value); setSaid('') }}
            placeholder="e.g. Eddimore Farms"
            maxLength={60}
            autoComplete="organization"
          />
          <span className="sp-email">Shown to your workers and on the site kiosk</span>
        </div>
        <button className="sp-save-name" onClick={save} disabled={saving || !draft.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* The words carry the meaning; the colour only says which of the two it is.
          Both are announced: a save that worked and a save that did not are two
          different facts, and neither should be found by looking harder. */}
      {err && <p className="sp-wp-note is-err" role="alert">{err}</p>}
      {said && <p className="sp-wp-note is-ok" role="status">{said}</p>}

      <p className="sp-hint">
        Your workplace name is the name a worker reads on their own screen, and the name on
        the site kiosk at the door. Nothing about a day, a rate or a payslip changes with it.
      </p>
    </>
  )
}
