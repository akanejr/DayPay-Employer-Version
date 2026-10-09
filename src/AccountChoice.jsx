/* DayPay — choose Employer or Employee.
 *
 * The first screen a new account sees, and the only screen in the product
 * whose entire job is to decide which screen comes next. Extracted from
 * App.jsx for the same reason every other pane was: a screen that cannot be
 * mounted cannot be checked, and a blank sign-up screen is the worst bug a
 * product can ship — nobody can get in to report it.
 *
 * It holds no state and touches no network. Two cards, and a callback.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { ACCOUNT_TYPES } from './lib/employer'

export default function AccountChoice({ onChoose }) {
  return (
    <div className="acct-choice" data-testid="account-type">
      <p className="field-hint dp-mb-12">
        What will you use DayPay for?
      </p>

      {ACCOUNT_TYPES.map(t => (
        <button
          key={t.id}
          type="button"
          className="acct-card"
          onClick={() => onChoose?.(t.id)}
        >
          <span className="acct-card-title">{t.label}</span>
          <span className="acct-card-sub">{t.blurb}</span>
          {/* What comes next, on the card rather than after the click. A worker
              whose invite code is with their supervisor finds that out here —
              not two screens later, with a form already half filled in. */}
          <span className="acct-card-next">Next: {t.next}</span>
        </button>
      ))}
    </div>
  )
}
