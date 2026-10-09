/* DayPay — the More screen: everything secondary, grouped (§32).
 *
 * Before this, the employer's workspace was five equal tabs — Today, Mark days,
 * Roster, Summary, Billing — so "what have I invoiced" sat beside "who is
 * working today" and competed with it for the same glance. §32's test is
 * whether the reader needs a thing right now: Today, Attendance and People pass
 * it; invoicing, contractors, the kiosk and settings do not. Those move here,
 * grouped by what they are for, and the bar above keeps four destinations that
 * all answer a question somebody has every day.
 *
 * Nothing was removed to make room. Contractors and the site kiosk used to be
 * two rows at the foot of the roster — they are rows here now, and the roster
 * keeps its job: the people. The personal tracker is here too, under "Your own
 * tracker": it is a complete product that needs no account, and the four
 * destinations are the EMPLOYER's navigation, so the tracker keeps a door
 * rather than losing one.
 *
 * Rows are links. A real href means the address bar, the back button,
 * long-press-to-copy and "open in new tab" all work without a line of code.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { MORE_GROUPS } from '../lib/routes.js'
import { href, navigate } from '../lib/router.js'
import { Item, List, Section, TechDetail } from './../ui/Ui.jsx'

export default function MorePane({ employees = [], contractors = [], contractorsOk = true }) {
  /* `ew-more-pane` is the pane; plain `ew-more` is the roster row's overflow
     button, and the two have been sharing one class. Additive: the pane keeps the
     class it has always had, and gains one the wide layout can address on its own
     (Phase 15). */
  return (
    <div className="ew-more ew-more-pane">
      {MORE_GROUPS.map(group => (
        <Section key={group.label} label={group.label}>
          <List>
            {group.items.map(item => (
              <Item
                key={item.path}
                href={href(item.path)}
                title={item.label}
                sub={item.sub}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                  e.preventDefault()
                  navigate(item.path)
                }}
              />
            ))}
          </List>
        </Section>
      ))}

      {/* One honest line about the two screens that only work once the database has
          been updated. Before this the roster carried a card each, which is a lot
          of furniture for a state most employers never see.

          §39: this line ended "Ask for migration 016" — to a business owner. It says
          what is true in their words now, and the number lives behind the technical
          detail, where the person who runs the database will look for it. */}
      {contractorsOk === false && (
        <Section label="Workforce">
          <List>
            <Item
              title="Contractors aren’t switched on yet"
              sub="Everything else on the roster still works. Whoever set up DayPay can switch them on."
            />
          </List>
          <TechDetail>
            <code>016</code> — the database update for contractor grouping has not
            been run. Ask whoever set DayPay up to run it, then refresh this page.
          </TechDetail>
        </Section>
      )}

      <p className="ew-more-foot">
        {employees.length === 0
          ? 'No workers yet — add one from People.'
          : `${employees.length} worker${employees.length === 1 ? '' : 's'} on the roster · ${contractors.length} contractor${contractors.length === 1 ? '' : 's'}`}
      </p>
    </div>
  )
}
