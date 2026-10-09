/* DayPay Employer Version — the employer workspace, and its four destinations.
 *
 * This is the container: it loads what every screen needs (the roster, the rate
 * periods, the contractors) and hands it to whichever destination the address
 * names. Since Phase 3 the destination is not state of its own — it is the URL
 * (src/lib/routes.js), which is what gives every screen an address, a Back
 * button and a reload that lands where you were.
 *
 *   Today       the command centre: who is working, who is not recorded, what
 *               needs an answer (§8)
 *   Attendance  marking days, fast (§9)                    — StaffDays
 *   People      the roster, rates, invitations (§10, §11)  — PeoplePane
 *   More        everything secondary, grouped (§32)        — MorePane
 *                 Workforce  Contractors · Site kiosk
 *                 Pay        Billing · Reports
 *                 Tracker    Month · Year   (the personal tracker, kept)
 *                 Account    Settings · Notifications
 *
 * The five equal tabs that used to be here — Today, Mark days, Roster, Summary,
 * Billing — answered no particular question: invoicing sat beside who is
 * working today and competed with it for the same glance.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  EmployerError, ensureEmployer, listEmployees, listAllRatePeriods,
  listContractors, resetSchemaProbes, contractorsAvailable,
} from '../lib/employer'
import Dashboard from './Dashboard'
import PaneErrorBoundary from './PaneErrorBoundary'
import Staff, { currentRateFor } from './PeoplePane'
import StaffDays from './StaffDays'
import Summary from './Summary'
import Billing from './Billing'
import DevicePanel from './DevicePanel'
import ContractorEditor from './ContractorEditor'
import MorePane from './MorePane'
import TabBar from '../ui/TabBar.jsx'
import { BackLink, Loading } from '../ui/Ui.jsx'
import {
  EMPLOYER, MORE, PEOPLE_ADD, employerPaneFor, moreScreenFor, peopleScreenFor,
  settingsCategoryFor,
} from '../lib/routes.js'
import { navigate, useRoute } from '../lib/router.js'
import './employer.css'


// ── Container ───────────────────────────────────────────────────────────────

export default function EmployerWorkspace() {
  /* The destination is the address, not a piece of state only this component
     can see. Everything below still reads `pane`; nothing sets it directly any
     more — a tap calls navigate(), which is what makes the back button, a
     reload and a pasted link all land in the same place. 'today' is the
     default, so `/` — "wherever this account belongs" — still opens on the
     command centre. */
  const { path } = useRoute()
  const pane = employerPaneFor(path) || 'today'
  const screen = moreScreenFor(path)
  const peopleScreen = peopleScreenFor(path)
  const navigateDestination = (to) => navigate(to)
  const [employees, setEmployees] = useState([])
  const [periods, setPeriods] = useState([])
  const [contractors, setContractors] = useState([])
  const [contractorsOk, setContractorsOk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setError(null)
    /* Re-probe rather than trusting the last answer. Running a migration while
       the app is open is a normal thing to do, and the app must notice on the
       next refresh instead of needing a full page reload. */
    resetSchemaProbes()
    try {
      await ensureEmployer()
      const [emps, rates, cons] = await Promise.all([
        listEmployees({ includeArchived: true }),
        listAllRatePeriods(),
        listContractors({ includeArchived: true }),
      ])
      setEmployees(emps || [])
      setPeriods(rates || [])
      setContractors(cons || [])
      setContractorsOk(contractorsAvailable())
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const activeCount = employees.filter(e => e.status === 'active').length

  const ratesSet = employees.filter(
    e => e.status === 'active' && currentRateFor(periods, e.id),
  ).length

  /* The loading state lives inside the workspace's own container, so on a wide
     screen the skeleton is measured like every other pane instead of running the
     full width of the window (Phase 15). The rail is not drawn yet: the pane it
     belongs to has not arrived. */
  if (loading) {
    return (
      <div className="ew ew-is-waiting">
        <Loading label="Loading your staff…" />
      </div>
    )
  }

  return (
    <div className="ew">
        {/* Phase 6. These two numbers were two stat cards on every pane except
            People and Today. They are one line of context now, and it is on
            Attendance only — the one screen left with nowhere else to say them.

            The reason is the brief's: a card is a thing to read before the thing
            you came for. Attendance works the active roster, so the size of the
            roster is part of the job; Settings and Billing have their own answers
            and the roster's size is noise on them.

            And the line states the fact an employer acts on — not two numbers and
            a subtraction, but either everybody is priced, or somebody is not, in
            which case their day cannot be saved at all. The words carry it; the
            colour only agrees with them. */}
        {pane === 'attendance' && (
          activeCount === 0 ? (
            <p className="ew-glance">No one is on the roster yet.</p>
          ) : (
            <p className="ew-glance">
              <span><strong>{activeCount}</strong> {activeCount === 1 ? 'worker' : 'workers'} on the roster</span>
              <span className="ew-glance-sep" aria-hidden="true">·</span>
              {ratesSet === activeCount
                ? <span>every one of them has a rate</span>
                : <span className="ew-glance-warn"><strong>{activeCount - ratesSet}</strong> with no rate yet</span>}
            </p>
          )
        )}

      {/* The four destinations (§3). They used to be five equal tabs — Mark
          days sitting beside Billing — so the bar answered no particular
          question. Summary and Billing are under More now, which is where the
          brief puts the things nobody needs every day (§32). */}
      <TabBar pane={pane} />

      {/* One crash must not take the whole screen with it. `key={pane}` also
          clears a caught error when the employer switches panes, so a broken
          pane does not poison the rest of the workspace. */}
      {/* `key` follows the whole path, not just the destination: ContractorEditor
          and Billing are both inside More, and moving between them must give each
          a fresh boundary instead of reusing the other one's caught error. */}
      <PaneErrorBoundary key={path} onReset={reload}>
        {pane === 'today' && (
          <Dashboard
            employees={employees}
            contractors={contractors}
            periods={periods}
            onOpenDays={() => navigateDestination(EMPLOYER.attendance)}
            onOpenPeople={() => navigateDestination(EMPLOYER.people)}
            onAddWorker={() => navigateDestination(PEOPLE_ADD)}
            />
        )}

        {pane === 'attendance' && (
          <StaffDays
            employees={employees}
            contractors={contractors}
            onOpenPeople={() => navigateDestination(EMPLOYER.people)}
          />
        )}

        {pane === 'people' && (
          <Staff
            employees={employees}
            contractors={contractors}
            periods={periods}
            loading={false}
            error={error}
            reload={reload}
            /* The address decides whether the add form is open, exactly as it
               decides everything else here. Closing the form puts the address
               back to the roster, so the back button and a reload agree with
               the screen. */
            startAdding={peopleScreen === 'new'}
            onOpenAdd={() => navigateDestination(PEOPLE_ADD)}
            onCloseAdd={() => navigateDestination(EMPLOYER.people)}
          />
        )}

        {pane === 'more' && !screen && (
          <MorePane
            employees={employees}
            contractors={contractors}
            contractorsOk={contractorsOk}
          />
        )}

        {/* ── the two screens that used to be tabs ──────────────────────────
            Each is reached from More and each carries the way back: a screen you
            arrived at by going deeper needs a way up, or the back button becomes
            the only way out of it. */}
        {pane === 'more' && screen && (
          <>
              {/* One control, one meaning, everywhere: `back()` returns to the screen
                  the reader came from when there is one, and to this screen's parent
                  when it was opened by a link (§41). A Settings category's parent is
                  Settings; everything else under More belongs to More. */}
              <BackLink to={settingsCategoryFor(path) ? MORE.settings : EMPLOYER.more} />

            {screen === 'contractors' && (
              <ContractorEditor
                contractors={contractors}
                employees={employees}
                available={contractorsOk}
                onChanged={reload}
              />
            )}

            {screen === 'kiosk' && <DevicePanel />}

            {/* Billing stays its own screen rather than a corner of Reports:
                "what do I owe" and "what have I billed" are different jobs, and
                a document that has been sent must not be editable from the
                screen that calculates next month's figure. */}
            {screen === 'billing' && <Billing employees={employees} contractors={contractors} />}

            {screen === 'reports' && <Summary employees={employees} />}
          </>
        )}
      </PaneErrorBoundary>
    </div>
  )
}
