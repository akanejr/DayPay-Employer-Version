/* DayPay Employer Version — Attendance.
 *
 * The daily job: an employer marks who worked, for a day they choose. Each tap
 * is saved immediately, so nothing is lost if the phone locks or the browser
 * closes. This screen was called "Mark days"; the destination is Attendance and
 * the screen now says what the destination says.
 *
 * What changed in Phase 5, and why (§9, §13, §32):
 *
 *   · **One day, chosen three ways.** Today · Week · Month is the range control,
 *     and it changes THE PICKER, never the write. A day is still recorded one
 *     person at a time, for one date, through the same `setDay` call. There is no
 *     "mark the whole week" button anywhere, because a week of days is money and
 *     nobody asked for it — but seeing the week, and seeing which days of the
 *     month are still empty, is how an employer notices a gap at all.
 *   · **Who is missing comes first.** The people who are not marked for the
 *     selected day are the top section, each with the one control that fixes it.
 *     The marked follow, with the amount the server stored.
 *   · **Every action is confirmed in words.** Mark, undo, change the kind, mark
 *     all — each says what happened, in a live region, because a silent toggle is
 *     how somebody marks a day twice or not at all.
 *   · **Rows, not cards.** Twenty workers on a phone were twenty bordered cards;
 *     they are one list with hairline dividers now.
 *
 * What did NOT change — and must not:
 *
 *   · The kind follows the DATE, not the tap. Marking someone present on a
 *     Saturday records weekend work, because that earns the multiplier.
 *     Recording a plain workday there would underpay them.
 *   · Days are saved as 'claimed', not 'confirmed'. A mis-tap during the month
 *     can simply be fixed; confirmation is a deliberate month-end act, and a
 *     confirmed day's amount is frozen by the database.
 *   · No rate or amount is ever sent. The server values each day from the rate
 *     period in force on that date. The figure shown here is read back from the
 *     saved row, not calculated on the device.
 *   · Marking all present stays sequential and per-person: each day is audited
 *     separately, and a partial failure leaves the successful ones saved.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, listAllMonth, setDay, clearDay,
  formatNaira, initials, todayKey, shiftDateKey, suggestedKind,
  prettyDateKey, monthBounds, monthGrid, monthLabelFor, monthFigures,
  KIND_LABELS,
} from '../lib/employer'
/* §39: the day's roster is searched with the SAME function the People screen uses,
   over the same fields, so one search behaves like the other. Two implementations
   would drift. */
import { filterPeople } from '../lib/employerLogic.js'
import { Section, List, Item, Chip, Notice, Loading } from '../ui/Ui.jsx'

/* The kinds a person may be moved between by hand. 'weekend' is not here: it is
   decided by the date, not by the employer, and it carries the multiplier. */
const KINDS = ['work', 'overtime', 'holiday', 'leave']

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

/* The shared list, not a second copy of it: the tracker's calendar prints these
   same seven words (Phase 16). */
import { WEEKDAYS as DOW } from '../lib/format.js'

const pad2 = (n) => String(n).padStart(2, '0')
const dateKeyOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`

/* The seven days of the week containing `key`, Monday first. */
function weekOf(key) {
  const mondayOffset = (new Date(`${key}T00:00:00`).getDay() + 6) % 7
  const monday = shiftDateKey(key, -mondayOffset)
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(monday, i))
}

/* Move a month at a time, clamping the day: 31 January + one month is 28
   February, not 3 March. Getting this wrong would silently move the employer to
   a day they never picked — and then mark it. */
function shiftMonthKey(key, months) {
  const [y, m, d] = key.split('-').map(Number)
  const target = new Date(y, m - 1 + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return dateKeyOf(target.getFullYear(), target.getMonth(), Math.min(d, lastDay))
}

/* The trade and the contractor, under the name.
 *
 * WHY THIS EXISTS. This is the only screen that writes attendance into the
 * ledger, and it listed people by name alone. Two workers called James — one a
 * Welder under Topher, one an Electric under Eddimore, both active, both with
 * days recorded that month — rendered as:
 *
 *     [JA] James        [JA] James
 *          not marked        not marked
 *
 * Identical. initials('James') is 'JA' for both, because a one-word name gives
 * its first two letters. Marking the wrong row is not a cosmetic slip: it puts
 * a paid day against the wrong person, under the wrong contractor, and it
 * surfaces a month later in that contractor's invoice. The employer cannot tell
 * from this screen which James is standing in front of them.
 *
 * Every other screen already shows the job title — Today, People, the
 * contractor list, the worker detail, even invoice lines. This one did not,
 * which is why the gap survived: it looked handled everywhere else.
 *
 * The contractor name is what settles it, since two workers can share a trade
 * but the money belongs to a contractor. 'Unassigned' is spelled out rather
 * than left blank, because an empty line reads as missing data. */
function whoLabel(employee, contractorName) {
  const parts = []
  if (employee.job_title) parts.push(employee.job_title)
  parts.push(contractorName || 'Unassigned')
  return parts.join(' · ')
}

// ── The range: which picker, never which write ──────────────────────────────

function RangeBar({ range, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="How much of the calendar to show">
      {RANGES.map(r => (
        <button
          key={r.id}
          type="button"
          className={range === r.id ? 'active' : ''}
          aria-pressed={range === r.id}
          onClick={() => onChange(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

/* ‹ Thursday 1 October 2026 › — and what that day is worth by its own date.
   The stepping moves by the RANGE's unit: a day, a week, a month. */
function PeriodNav({ range, date, isToday, onStep, onToday, busy }) {
  const unit = range === 'week' ? 'week' : range === 'month' ? 'month' : 'day'
  /* The same stepper Billing, Summary and the worker's own month already use —
     one control, one shape, four screens. */
  return (
    <div className="ew-datebar">
      <button
        type="button" className="ew-datebar-step" aria-label={`Previous ${unit}`}
        onClick={() => onStep(-1)} disabled={busy}
      >‹</button>

      <div className="ew-datebar-mid">
        <div className="ew-datebar-day">{prettyDateKey(date)}</div>
        <div className="ew-att-day-note">
          {suggestedKind(date) === 'weekend'
            ? 'Weekend — days recorded here earn 2×'
            : 'Weekday — days recorded here earn the daily rate'}
        </div>
        {!isToday && (
          <button type="button" className="ew-datebar-today" onClick={onToday} disabled={busy}>
            Jump to today
          </button>
        )}
      </div>

      <button
        type="button" className="ew-datebar-step" aria-label={`Next ${unit}`}
        onClick={() => onStep(1)} disabled={busy}
      >›</button>
    </div>
  )
}

/* A week at a glance, Monday to Sunday. The number under each day is how many
   people are recorded for it — the gap is what an employer is looking for. */
function WeekPicker({ date, today, counts, onPick, busy }) {
  return (
    <div className="ew-att-week">
      {weekOf(date).map((key, i) => {
        const n = counts.get(key) || 0
        const selected = key === date
        return (
          <button
            key={key}
            type="button"
            className={`ew-att-wd${selected ? ' is-sel' : ''}${key === today ? ' is-today' : ''}`}
            aria-pressed={selected}
            aria-label={`${prettyDateKey(key)} — ${n === 1 ? '1 day recorded' : `${n} days recorded`}`}
            disabled={busy}
            onClick={() => onPick(key)}
          >
            <span className="ew-att-wd-dow">{DOW[i]}</span>
            <span className="ew-att-wd-day">{Number(key.slice(8))}</span>
            <span className="ew-att-wd-n">{n > 0 ? n : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

/* The month, one cell per day. `monthGrid` draws the calendar — the same pure
   function the worker's own screen uses, so there is exactly one calendar in
   the product and no second definition of where a month starts. */
function MonthPicker({ year, monthIndex, date, today, counts, onPick, busy }) {
  const weeks = useMemo(() => monthGrid(year, monthIndex), [year, monthIndex])
  return (
    <div className="ew-att-month">
      <div className="ew-att-month-head" aria-hidden="true">
        {/* Three letters, not one. "M T W T F S S" is two ambiguous pairs, and this
            grid is the same seven columns at the same phone width as the tracker's,
            which has always spelled them out. (Phase 16.) */}
        {DOW.map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="ew-att-grid">
        {weeks.flat().map((cell, i) => {
          if (!cell) return <span key={`gap-${i}`} className="ew-att-cell is-gap" aria-hidden="true" />
          const n = counts.get(cell.key) || 0
          const selected = cell.key === date
          return (
            <button
              key={cell.key}
              type="button"
              className={`ew-att-cell${selected ? ' is-sel' : ''}${cell.key === today ? ' is-today' : ''}`}
              aria-pressed={selected}
              aria-label={`${prettyDateKey(cell.key)} — ${n === 1 ? '1 day recorded' : `${n} days recorded`}`}
              disabled={busy}
              onClick={() => onPick(cell.key)}
            >
              <span>{cell.day}</span>
              {n > 0 && <span className="ew-att-cell-n">{n}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── One person, one day ─────────────────────────────────────────────────────

function PersonRow({ employee, contractorName, record, busy, onToggle, onKind }) {
  const marked = !!record
  /* Only the button writes. A row that marks on a stray tap is how a day gets
     recorded for somebody who was not there. */
  return (
    <div className={`ew-att-row${marked ? ' is-marked' : ''}`}>
      <span className="dp-item-icon" aria-hidden="true">{initials(employee.full_name)}</span>

      <div className="ew-att-body">
        <div className="ew-att-name">{employee.full_name}</div>
        <div className="ew-att-sub">{whoLabel(employee, contractorName)}</div>

        {marked && (
          <>
            <div className="ew-att-meta">
              <Chip>{KIND_LABELS[record.kind] || record.kind}</Chip>
              <span className="ew-att-amount">{formatNaira(record.amount)}</span>
              {record.status === 'confirmed' && <Chip tone="ok">Confirmed</Chip>}
              {record.status === 'disputed' && <Chip tone="warn">Disputed</Chip>}
            </div>

            {/* Changing the kind is the less common act, and only possible while
                the day is still open — a confirmed day is frozen by the database. */}
            {record.status !== 'confirmed' && (
              <div className="ew-att-kinds">
                {KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    className={`ew-kindchip${record.kind === k ? ' active' : ''}`}
                    aria-pressed={record.kind === k}
                    disabled={busy}
                    onClick={() => onKind(k)}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className={`ew-att-mark${marked ? ' is-on' : ''}`}
        disabled={busy || (marked && record.status === 'confirmed')}
        onClick={onToggle}
        title={marked && record.status === 'confirmed' ? 'Confirmed — reopen it on the day before undoing' : undefined}
      >
        {busy ? '…' : marked ? 'Undo' : 'Mark'}
      </button>
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function StaffDays({ employees, contractors, onOpenPeople }) {
  const today = todayKey()
  const [range, setRange] = useState('today')
  const [date, setDate] = useState(today)
  const [monthDays, setMonthDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [error, setError] = useState(null)
  const [said, setSaid] = useState(null)
  /* §39: an employer with sixty workers was scrolling to find one name on the
     screen they open every morning. Same search as People, over the day's list. */
  const [query, setQuery] = useState('')

  const active = useMemo(
    () => (employees || []).filter(e => e.status === 'active'),
    [employees],
  )

  /* id -> name, so a row can say who the money belongs to. Built from the
     contractor list the workspace already loaded; no new query. */
  const contractorNames = useMemo(() => {
    const map = new Map()
    for (const c of contractors || []) map.set(c.id, c.name)
    return map
  }, [contractors])

  const [viewYear, viewMonth] = useMemo(() => {
    const [y, m] = date.split('-').map(Number)
    return [y, m - 1]
  }, [date])

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const days = await listAllMonth(viewYear, viewMonth)
      setMonthDays(days || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [viewYear, viewMonth])

  useEffect(() => { load() }, [load])

  // What is already saved for the selected date, keyed by employee.
  const byEmployee = useMemo(() => {
    const m = new Map()
    for (const d of monthDays) if (d.work_date === date) m.set(d.employee_id, d)
    return m
  }, [monthDays, date])

  /* How many people are recorded on each date of the month shown — the week
     strip and the month grid both read this, so the two can never disagree. */
  const countsByDate = useMemo(() => {
    const m = new Map()
    for (const d of monthDays) m.set(d.work_date, (m.get(d.work_date) || 0) + 1)
    return m
  }, [monthDays])

  const kindForDate = suggestedKind(date)

  /* Optimistically update, then reconcile with the row the server returns.
     The server is the authority on the amount, so whatever comes back wins. */
  function applyLocal(employeeId, saved) {
    setMonthDays(prev => {
      const without = prev.filter(
        d => !(d.employee_id === employeeId && d.work_date === date),
      )
      return saved ? [...without, saved] : without
    })
  }

  function step(direction) {
    setSaid(null)
    if (range === 'week') setDate(d => shiftDateKey(d, direction * 7))
    else if (range === 'month') setDate(d => shiftMonthKey(d, direction))
    else setDate(d => shiftDateKey(d, direction))
  }

  function pickRange(next) {
    setSaid(null)
    setRange(next)
    /* "Today" means today. The other two ranges keep the day you were looking
       at, because the picker shows the period around it. */
    if (next === 'today') setDate(today)
  }

  async function toggle(employee) {
    setBusyId(employee.id)
    setError(null)
    setSaid(null)
    const existing = byEmployee.get(employee.id)
    try {
      if (existing) {
        await clearDay(employee.id, date)
        applyLocal(employee.id, null)
        setSaid(`Removed ${employee.full_name}’s day for ${prettyDateKey(date)}.`)
      } else {
        const saved = await setDay(employee.id, date, kindForDate)
        applyLocal(employee.id, saved)
        setSaid(`Recorded ${employee.full_name} for ${prettyDateKey(date)}.`)
      }
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusyId(null)
    }
  }

  async function setKind(employee, kind) {
    setBusyId(employee.id)
    setError(null)
    setSaid(null)
    try {
      const saved = await setDay(employee.id, date, kind, {
        leaveType: kind === 'leave' ? 'annual' : null,
        leavePercent: kind === 'leave' ? 100 : 0,
      })
      applyLocal(employee.id, saved)
      setSaid(`${employee.full_name} is now recorded as ${(KIND_LABELS[kind] || kind).toLowerCase()} for ${prettyDateKey(date)}.`)
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusyId(null)
    }
  }

  /* Marks everyone not already marked. Sequential and per-person on purpose:
     each day is separately audited, and a partial failure should leave the
     successful ones saved rather than rolling the batch back. */
  async function markAllPresent() {
    const pending = active.filter(e => !byEmployee.get(e.id))
    if (!pending.length) { setSaid('Everyone is already marked for this day.'); return }
    setBulkBusy(true)
    setError(null)
    setSaid(null)
    let done = 0
    const failures = []
    for (const emp of pending) {
      try {
        const saved = await setDay(emp.id, date, kindForDate)
        applyLocal(emp.id, saved)
        done += 1
      } catch (e) {
        failures.push(`${emp.full_name}: ${e.message}`)
      }
    }
    setBulkBusy(false)
    if (failures.length) setError(new EmployerError(`${done} recorded, ${failures.length} failed.`, { hint: failures.join(' · ') }))
    else setSaid(`${done} ${done === 1 ? 'person' : 'people'} recorded for ${prettyDateKey(date)}.`)
  }

  // ── Month running total, from saved rows only ──
  const figures = useMemo(() => monthFigures(monthDays, employees), [monthDays, employees])
  const { from, to } = monthBounds(viewYear, viewMonth)
  /* monthLabelFor, not toLocaleString: the same "September 2026" on every
     device, from the same table the Billing period uses. toLocaleString
     depends on the runtime's locale data, which is not something this app can
     promise is present. */
  const monthName = monthLabelFor(viewYear, viewMonth)

  if (!active.length) {
    return (
      <div className="ew-att">
        <h2 className="ew-title">Attendance</h2>
        {/* §21: an empty screen says what is missing and what to do about it. */}
        <Notice
          tone="empty"
          title="No one to record yet"
          body="Add the people you work with and their days can be recorded here — or by them, from their own phone."
          action={onOpenPeople
            ? <button type="button" className="ew-btn ew-btn-primary" onClick={onOpenPeople}>Add a worker</button>
            : null}
        />
      </div>
    )
  }

  /* What the search does NOT do: change a figure. `missing` and `present` are the
     day's truth and stay whole; only what is DRAWN is filtered, and the counts in
     the section labels follow what is drawn so a filtered list never claims to be
     the whole roster. */
  const shown = filterPeople(active, query, e => [contractorNames.get(e.contractor_id)])
  const missing = shown.filter(e => !byEmployee.get(e.id))
  const present = shown.filter(e => byEmployee.get(e.id))

  return (
    /* `ew-att-split` marks the branch with two jobs in it — a day to choose and a
       roster to mark. The empty-roster branch above has one, so it keeps its single
       column at every width (Phase 15). */
    <div className="ew-att ew-att-split">
      <h2 className="ew-title">Attendance</h2>

      <p className="ew-att-note">
        Record a day on someone’s behalf — a correction, a backdated day, or a
        worker whose phone isn’t to hand. Their own days are the normal path.
      </p>

      {/* ── The calendar controls. From 1280px these sit in their own column,
          sticky, because they are the control for the list beside them — and
          `display: contents` below that, so a phone still sees one column
          exactly as it did before (Phase 15). */}
      <div className="ew-att-side">
        <RangeBar range={range} onChange={pickRange} />

        {range === 'week' && (
          <WeekPicker date={date} today={today} counts={countsByDate} onPick={setDate} busy={bulkBusy} />
        )}
        {range === 'month' && (
          <MonthPicker
            year={viewYear} monthIndex={viewMonth} date={date} today={today}
            counts={countsByDate} onPick={setDate} busy={bulkBusy}
          />
        )}

        <PeriodNav
          range={range} date={date} isToday={date === today} busy={bulkBusy}
          onStep={step}
          onToday={() => { setSaid(null); setDate(today) }}
        />
      </div>

      {/* ── What the day is made of: the rows, the confirmations, the error. */}
      <div className="ew-att-main">
        {/* A confirmation that stays put. It is a live region because the thing
            that changed on screen is a row somewhere below the fold on a phone —
            the message is the only evidence the employer gets that their tap
            landed, and four seconds later it would be gone. */}
        <p className="ew-att-said" role="status" aria-live="polite">
          {said || ''}
        </p>

        {error && (
          <Notice
            tone="error"
            title="That did not save"
            body={error.message + (error.hint ? ` — ${error.hint}` : '')}
            action={<button type="button" className="ew-btn" onClick={load}>Try again</button>}
          />
        )}

        {/* The same control the People screen has, over the same fields — a name, a
            trade, or the contractor who supplies them. Drawn only once there is more
            than a handful to look through: a search box over three names is furniture
            that asks the employer to read it every morning (§32). */}
        {!loading && active.length > 6 && (
          <div className="ew-find">
            <input
              type="search"
              className="ew-input ew-find-input"
              value={query}
              onChange={ev => setQuery(ev.target.value)}
              placeholder="Search this day’s roster"
              aria-label="Search the people recorded today"
              autoComplete="off"
            />
            {query && (
              <div className="ew-find-count">
                <span>{shown.length} of {active.length} shown</span>
                <button type="button" className="dp-sec-action" onClick={() => setQuery('')}>
                  Clear
                </button>
              </div>
            )}
          </div>
        )}


        {loading ? (
                  <Loading label={`Loading ${monthName}…`} lines={4} />
        ) : (
          <>
            {missing.length > 0 && (
              <Section
                label={`Not yet recorded · ${missing.length}`}
                action={(
                  <button
                    type="button" className="dp-sec-action"
                    onClick={markAllPresent} disabled={bulkBusy}
                  >
                    {bulkBusy ? 'Recording…' : 'Record all present'}
                  </button>
                )}
              >
                <List>
                  {missing.map(e => (
                    <PersonRow
                      key={e.id}
                      employee={e}
                      contractorName={contractorNames.get(e.contractor_id)}
                      record={null}
                      busy={busyId === e.id}
                      onToggle={() => toggle(e)}
                      onKind={k => setKind(e, k)}
                    />
                  ))}
                </List>
              </Section>
            )}

            {present.length > 0 && (
              <Section label={`Recorded · ${present.length}`}>
                <List>
                  {present.map(e => (
                    <PersonRow
                      key={e.id}
                      employee={e}
                      contractorName={contractorNames.get(e.contractor_id)}
                      record={byEmployee.get(e.id)}
                      busy={busyId === e.id}
                      onToggle={() => toggle(e)}
                      onKind={k => setKind(e, k)}
                    />
                  ))}
                </List>
              </Section>
            )}

            {/* The month's own figures belong to the month range: on Today and
                Week the employer is marking, and the month total is on the
                command centre where they look first. */}
            {range === 'month' && (
              <Section label={monthName}>
                <List>
                  <Item title="Days recorded" trail={<span className="ew-att-amount">{monthDays.length}</span>} />
                  <Item
                    title="Awaiting confirmation"
                    sub="Every recorded day counts until the month is confirmed"
                    trail={<span className="ew-att-amount">{figures.unconfirmed}</span>}
                  />
                  <Item
                    title="What the month adds up to"
                    trail={<span className="ew-att-amount is-money">{formatNaira(figures.total)}</span>}
                  />
                </List>
                <p className="ew-att-foot">
                  {from} to {to}. Amounts are what the server stored on each day, not
                  recalculated from today’s rate.
                </p>
              </Section>
            )}
          </>
        )}
      </div>

      {/* Kept in the screen's own words: it is the one fact an employer needs
          before tapping, and it is always about THE DAY being recorded — never
          about the month, which is a different question with its own figures. */}
      <p className="ew-att-foot">
        {missing.length === 0
          ? `Everyone is recorded for ${prettyDateKey(date)}.`
          : `${missing.length} of ${active.length} still to record for ${prettyDateKey(date)}.`}
      </p>
    </div>
  )
}
