/* DayPay Employer Version — Today. The command centre.
 *
 * One question, answered before the employer has to scroll: **is everybody
 * recorded today, and if not, who is missing?** Everything else on this screen
 * is either the money that follows from that answer or a thing that is blocked
 * until somebody acts.
 *
 * What changed in Phase 4, and why (§8, §32, SEE → UNDERSTAND → ACT):
 *
 *   · **Four stat cards became one figure.** "Expected 21 · Recorded 18 · Not yet
 *     3 · Overtime 2" made the reader do the subtraction. The bar and "18 of 21
 *     recorded today" say it once, in the shape of the answer.
 *   · **The names come before the totals.** An employer does not chase "3", they
 *     chase James. The people who are missing are rows with an action on them.
 *   · **What is stuck is at the top.** A worker's correction request has another
 *     person waiting at the end of it; a missing rate means a day that cannot be
 *     recorded at all. Those are the only things on this screen that are worse
 *     the later they are dealt with, so they lead.
 *   · **One filled button.** "Record today's work" — and when nobody is missing,
 *     there is no filled button at all, because there is nothing to do.
 *
 * What did NOT change:
 *
 *   · This screen records nothing. Marking a day is a deliberate act on its own
 *     screen; a mis-tap on an overview is how wrong pay happens.
 *   · Every money figure still comes from `monthFigures`/`dayBoard`, which wrap
 *     the same `summarise()` the Summary pane and the payslip use. This screen
 *     must never compute money a second way — a second way is a second answer.
 *   · Nothing is invented. Every row is a stored record, or the absence of one.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, listAllMonth, listOpenCorrections,
  dayBoard, unmetRates, monthFigures,
  groupByContractor, contractorRollup,
  formatNaira, initials, todayKey, prettyDateKey, monthLabelFor,
  correctionSentence, KIND_LABELS,
} from '../lib/employer'
import ContractorView from './ContractorView'
import AttendancePanel from './AttendancePanel'
import WorkerView from './WorkerView'
import { Section, List, Item, Progress, Chip, Notice, Loading } from '../ui/Ui.jsx'

/* The screen while it is loading. A skeleton rather than "Loading today…": the
   shape of the answer is already known, and showing it means the screen does not
   jump when the data lands (§22). It is hidden from assistive technology, so the
   live region below carries the words. */
/* The skeleton is the design system's now (Phase 14). It was written out here and
   on two other screens, which is three chances for one of them to drift into being
   a line of grey text in an empty pane. */
function TodaySkeleton() {
  return (
    <div className="ew-dash">
      <Loading label="Loading today’s records…" />
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function Dashboard({ employees, contractors = [], periods, onOpenDays, onOpenPeople, onAddWorker }) {
  const today = todayKey()
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openContractorId, setOpenContractorId] = useState(null)

  const [year, monthIndex] = useMemo(() => {
    const [y, m] = today.split('-').map(Number)
    return [y, m - 1]
  }, [today])

  /* Correction requests are loaded with the month, not after it: a request the
     employer does not see on the screen where they look first is a request that
     gets answered a week late. */
  const [requests, setRequests] = useState([])
  const [openWorkerId, setOpenWorkerId] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [rows, reqs] = await Promise.all([
        listAllMonth(year, monthIndex),
        listOpenCorrections(),
      ])
      setDays(rows || [])
      setRequests(reqs || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [year, monthIndex])

  useEffect(() => { load() }, [load])

  const board = useMemo(() => dayBoard(days, employees, today), [days, employees, today])
  const figures = useMemo(() => monthFigures(days, employees), [days, employees])
  const groups = useMemo(() => groupByContractor(contractors, employees), [contractors, employees])

  /* Anything that is worse for being left: a rate gap stops the day being
     recorded at all, and a correction has somebody waiting. */
  const rateGaps = useMemo(() => unmetRates(employees, periods, today), [employees, periods, today])

  /* A contractor can disappear while its detail view is open — archived on
     another device, or reloaded away. Deriving the group rather than storing it
     means a stale id falls through to the list on its own, with no state written
     during render. */
  const openGroup = openContractorId
    ? groups.find(g => (g.contractor?.id || null) === openContractorId) || null
    : null

  /* The worker detail, opened from the corrections queue. Derived for the same
     reason as openGroup: a worker archived on another device must not leave this
     screen pinned to a stale record. */
  const openWorker = openWorkerId
    ? employees.find(e => e.id === openWorkerId) || null
    : null

  if (loading) return <TodaySkeleton />

  if (openWorker) {
    return (
      <WorkerView
        employee={openWorker}
        periods={(periods || []).filter(p => p.employee_id === openWorker.id)}
        contractorName={(contractors.find(c => c.id === openWorker.contractor_id) || {}).name || null}
        onBack={() => setOpenWorkerId(null)}
        onChanged={load}
      />
    )
  }

  if (openGroup) {
    return (
      <ContractorView
        contractor={openGroup.contractor}
        employees={openGroup.workers}
        days={days}
        onBack={() => setOpenContractorId(null)}
        onChanged={load}
      />
    )
  }

  const outstanding = board.expected - board.recorded
  const waiting = rateGaps.length + requests.length + board.counts.disputed

  return (
    <div className="ew-dash">
      {/* ── Column one: the day itself, and what needs an answer ─────────────
          Above 1280px these two wrappers are the left and right columns of the
          screen (Phase 15). Below it they are `display: contents` — no box at
          all — so the phone layout stays exactly the one the screen checks were
          written against. */}
      <div className="ew-dash-col">
        {error && (
          <Notice
            tone="error"
            title="Today could not be loaded"
            body={error.message}
            action={<button type="button" className="ew-btn" onClick={load}>Try again</button>}
          />
        )}

        {/* ── Waiting on you ───────────────────────────────────────────────────
            First, and only when there is something. These are the two things on
            this screen with a person or a blocked day at the end of them. */}
        {waiting > 0 && (
          <Section label={requests.length > 0 ? 'Waiting on you' : 'Before you record'}>
            <List>
              {rateGaps.length > 0 && (
                <Item
                  title={rateGaps.length === 1 ? 'No rate covers today' : `No rate covers today for ${rateGaps.length} people`}
                  sub={`${rateGaps.map(e => e.full_name).join(', ')} — a day cannot be recorded without a rate, because the amount is calculated from it`}
                  trail={<span className="dp-item-go">Set a rate</span>}
                  onClick={onOpenPeople}
                />
              )}

              {requests.map(r => {
                const who = employees.find(e => e.id === r.employee_id)
                return (
                  <Item
                    key={r.id}
                    title={`${who ? who.full_name : 'A worker'} · ${prettyDateKey(r.work_date)}`}
                    sub={correctionSentence(r, (days.find(d => d.employee_id === r.employee_id
                      && d.work_date === r.work_date) || {}).kind || null) + (r.message ? ` “${r.message}”` : '')}
                    trail={<span className="dp-item-go">Answer</span>}
                    onClick={() => setOpenWorkerId(r.employee_id)}
                  />
                )
              })}

              {board.counts.disputed > 0 && (
                <Item
                  title={`${board.counts.disputed} disputed today`}
                  sub="Someone has questioned these days. They stay in the month total until they are settled."
                  trail={<span className="dp-item-go">People</span>}
                  onClick={onOpenPeople}
                />
              )}
            </List>
          </Section>
        )}

        {/* ── The figure ───────────────────────────────────────────────────────
            One number, in the shape of the answer, with the money it represents
            underneath. The date is here rather than in a header of its own: it is
            the least important fact on the screen and the easiest to state once. */}
        {board.expected === 0 ? (
          <Section label="Today">
            <Notice
              tone="empty"
              title="No workers yet"
              body="Add the people you work with and today will start counting."
              /* The one thing to do on a roster of nobody, and it lands on the FORM —
                 not on People with the form still a tap away (Phase 9). It falls back
                 to opening People if the screen was mounted without the address half,
                 which is how the harness mounts it. */
              action={(onAddWorker || onOpenPeople)
                ? (
                  <button
                    type="button" className="ew-btn ew-btn-primary"
                    data-testid="add-first-worker"
                    onClick={onAddWorker || onOpenPeople}
                  >
                    Add your first worker
                  </button>
                )
                : null}
            />
          </Section>
        ) : (
          <section className="ew-today-head">
            <div className="ew-today-date">
              {prettyDateKey(today)}
              {board.isWeekend && <Chip tone="quiet">Weekend · 2×</Chip>}
            </div>

            <Progress
              value={board.recorded}
              max={board.expected}
              label="Workers recorded today"
              caption={`of ${board.expected} recorded`}
            >
              {board.recorded}
            </Progress>

            {board.amount > 0 && (
              <div className="ew-today-money">
                <span className="ew-today-money-label">Recorded today</span>
                <span className="ew-today-money-value">{formatNaira(board.amount)}</span>
              </div>
            )}

            {/* The one filled button on this screen, and only while it has a job.
                When nobody is outstanding there is nothing to press, which is the
                answer the employer came for. */}
            {outstanding > 0 && (
              <button type="button" className="ew-btn ew-btn-primary ew-today-cta" onClick={onOpenDays}>
                Record today’s work
              </button>
            )}
          </section>
        )}

        {/* ── Who is not recorded ──────────────────────────────────────────────
            By name, because that is the actionable part, and each row goes to the
            screen where the day is actually marked. */}
        {outstanding > 0 && (
          <Section label={`Not yet recorded · ${outstanding}`}>
            <List>
              {board.missing.map(e => (
                <Item
                  key={e.id}
                  icon={initials(e.full_name)}
                  title={e.full_name}
                  sub={e.job_title || undefined}
                  trail={<span className="dp-item-go">Record</span>}
                  onClick={onOpenDays}
                />
              ))}
            </List>
          </Section>
        )}

        {/* ── Who is recorded ─────────────────────────────────────────────────
            The other half of the question. The kind and the amount are the stored
            record's own values — nothing here is derived. */}
        {board.present.length > 0 && (
          <Section label={`Recorded today · ${board.present.length}`}>
            <List>
              {board.present.map(({ employee: e, day }) => (
                <Item
                  key={e.id}
                  icon={initials(e.full_name)}
                  title={e.full_name}
                  sub={e.job_title || undefined}
                  trail={
                    <>
                      {day.kind !== 'work' && <Chip tone={day.kind === 'leave' ? 'quiet' : 'ok'}>
                        {KIND_LABELS[day.kind] || day.kind}
                      </Chip>}
                      <span className="ew-today-amount">{formatNaira(day.amount)}</span>
                    </>
                  }
                />
              ))}
            </List>
          </Section>
        )}

        {/* Off-roster days are surfaced rather than hidden: they are real money and
            the month total includes them. */}
        {board.offRoster.length > 0 && (
          <Notice
            tone="attention"
            title={`${board.offRoster.length} day${board.offRoster.length === 1 ? '' : 's'} recorded today for someone no longer on the roster`}
            body="Their days are kept and still count towards the month."
          />
        )}
      </div>

      {/* ── Column two: what the month adds up to, and the setup it needs ─── */}
      <div className="ew-dash-col">
        {board.expected > 0 && (
          <Section label={`This month · ${monthLabelFor(year, monthIndex)}`}>
            <List>
              <Item title="Days worked" trail={<span className="ew-today-amount">{figures.actualDays}</span>} />
              <Item
                title="Paid-day equivalents"
                sub="A weekend or overtime day counts as two of these — days worked and what they cost are different numbers on purpose"
                trail={<span className="ew-today-amount">{figures.equivalents}</span>}
              />
              <Item
                title="What they have earned so far"
                trail={<span className="ew-today-amount is-money">{formatNaira(figures.total)}</span>}
              />
              {(figures.unconfirmed > 0 || figures.disputed > 0) && (
                <Item
                  title={`${figures.unconfirmed} awaiting confirmation${figures.disputed > 0 ? ` · ${figures.disputed} disputed` : ''}`}
                  sub="Included in the total until they are settled"
                  onClick={onOpenPeople}
                  trail={<span className="dp-item-go">People</span>}
                />
              )}
            </List>
          </Section>
        )}

        {/* ── Contractors ──────────────────────────────────────────────────────
            Only once there is something to group. With no contractors defined the
            roster is flat, and a section explaining a concept the employer has not
            adopted yet is noise. */}
        {contractors.length > 0 && (
          <Section label="Contractors">
            <List>
              {groups.map(group => {
                const roll = contractorRollup(group.workers, days, today)
                const id = group.contractor?.id || null
                return (
                  <Item
                    key={id || 'unassigned'}
                    title={group.contractor?.name || 'Unassigned'}
                    sub={`${roll.expected} worker${roll.expected === 1 ? '' : 's'}${roll.overtime > 0 ? ` · ${roll.overtime} on overtime` : ''}`}
                    trail={<span className="ew-today-amount">{roll.present} of {roll.expected}</span>}
                    onClick={() => setOpenContractorId(id)}
                  />
                )
              })}
            </List>
          </Section>
        )}

        {/* ── The site's own attendance ────────────────────────────────────────
            The employer's half of the daily code. It is last because it is the one
            thing on this screen that is not about a person's pay — an employer who
            runs a kiosk opens it deliberately, and one who does not should not have
            to scroll past it to find out who is missing. */}
        <Section label="Site attendance code">
          <AttendancePanel contractors={contractors} onChanged={load} />
        </Section>
      </div>
    </div>
  )
}
