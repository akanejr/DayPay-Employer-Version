/* DayPay — the primary navigation: the employer's four destinations.
 *
 * TODAY · ATTENDANCE · PEOPLE · MORE, rendered from EMPLOYER_NAV in
 * src/lib/routes.js so the bar and the address table cannot disagree about what
 * exists. It sits at the bottom of the frame rather than the top because the
 * brief asks for one-handed use on a phone (§6) — the top of a 6-inch screen is
 * the one place a thumb cannot reach comfortably.
 *
 * Each destination is a real link with a real address. Tapping it also calls
 * navigate() directly, so the screen changes on the same tick instead of waiting
 * for the browser's hashchange event; the href stays for the things a link gives
 * you for free — middle-click, long-press to copy, "open in new tab", and a
 * keyboard that reaches it without any help from us.
 *
 * The active destination is marked three ways, not one: it carries `aria-current`,
 * its label gains weight, and a rule sits above it. §26 — never colour alone,
 * and never a state a screen reader cannot hear.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { EMPLOYER_NAV, employerPaneFor } from '../lib/routes.js'
import { href, navigate } from '../lib/router.js'

export default function TabBar({ pane }) {
  return (
    <nav className="dp-tabbar" aria-label="Main">
      {EMPLOYER_NAV.map(({ path, label }) => {
        const active = employerPaneFor(path) === pane
        return (
          <a
            key={path}
            className={`dp-tab${active ? ' is-active' : ''}`}
            href={href(path)}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              /* Let the browser handle a modified click: opening a destination in
                 a new tab is a legitimate thing to do with a link. */
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              e.preventDefault()
              navigate(path)
            }}
          >
            <span className="dp-tab-rule" aria-hidden="true" />
            <span className="dp-tab-label">{label}</span>
          </a>
        )
      })}
    </nav>
  )
}
