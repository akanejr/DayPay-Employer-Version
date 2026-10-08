/* The days the integration chain chooses, and what the ledger must say about the
 * day it actually runs on.
 *
 * WHY THIS FILE EXISTS. The chain ran green on Friday 2 October and failed the
 * next morning, on five checks, without a line of the product changing. Nothing
 * was broken: the chain had assumed two things about the calendar.
 *
 *   · **That the day it runs on is a weekday.** The database's own rule — in every
 *     migration that writes a check-in — is
 *         case when extract(isodow from work_date) >= 6 then 'weekend' else 'work'
 *     so a Saturday check-in is a weekend day at the weekend multiplier. The chain
 *     asserted `kind === 'work'` and `multiplier === 1`, which is true five days a
 *     week and false two of them. (The engine has the same rule in
 *     `suggestedKind()`, which is what is used below — one rule, both sides.)
 *   · **That day 6 was free.** The employer's extra days were picked from
 *     `[3, 4, 6, 20]` minus today, and day 6 is exactly where the correction
 *     scenario asks about a missing day. On the 3rd and 4th of the month the
 *     employer had already written that day, so the approved correction correctly
 *     did nothing — and the chain failed asserting a change that should not have
 *     happened.
 *
 * Both are defects in the PROOF, not in the ledger, and both are worse than an
 * ordinary flake: a suite that only passes Monday to Friday teaches you to
 * distrust it, and the temptation is to re-run it rather than read it.
 *
 * The choices live here, pure and importable, so `tests/harness.test.js` can walk
 * every day of the month and prove they never collide — rather than the chain
 * asserting it in a comment.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { suggestedKind } from '../../src/lib/employerLogic.js'

/* The day the correction scenario is about ("a day that is missing from their
   month"). Reserved: no other scenario may write it, or the correction proves
   nothing. */
export const CORRECTION_DAY = 6

/* The rate history starts on the 2nd, so days 1 and 2 belong to the rate-change
   scenario and are never handed to another one. */
export const RATE_CHANGE_DAY = 2
export const OLD_RATE_DAY = 1

/* Where the employer's "extra" days may come from. 20 is the day after the rate
   change (always priced at the new rate); the small numbers are ordinary days. */
export const EXTRA_DAY_POOL = [3, 4, 5, 20]

/* The day after the rate change, and the day the employer records as overtime in
   the chain — the second is chosen from the pool above, and both are named here so
   a scenario can be shown not to collide with them. */
const NEW_RATE_DAY = 20

/* WHICH DAY THE CORRECTION IS ABOUT, GIVEN THE DAY THE CHAIN RUNS ON.
 *
 * `CORRECTION_DAY` alone was not enough, and the chain proved it the hard way: on
 * the 6th of a month the correction scenario asks about a day that is *missing
 * from the month* — and on the 6th that day is today, which the check-in scenario
 * has already written. The approved correction then does exactly what the database
 * documentation says it does with a day that already exists (nothing, deliberately:
 * "silently rewriting an existing day because somebody said it was absent would
 * lose information"), and the chain reported a failure where the ledger was right.
 *
 * So the day is chosen here, and it is the documented day unless the chain happens
 * to be running on it — in which case it moves to the next day. It can never land
 * on the check-in day, a rate-history day, or any day the employer writes. */
export function correctionDayFor(dom) {
  const taken = new Set([dom, RATE_CHANGE_DAY, OLD_RATE_DAY, NEW_RATE_DAY,
    ...extraDaysFor(dom)])
  return [CORRECTION_DAY, CORRECTION_DAY + 1].find((d) => !taken.has(d))
}

/* The three days the employer records, in a fixed order (overtime, ordinary work,
   and the second worker's day), none of which may be the day the worker checks in
   on, the correction day, or a rate-history day. Exactly three, whatever the date:
   the chain indexes [0], [1] and [2], so a short list would silently become
   `undefined` and a long one would make the choice depend on where it was sliced. */
export function extraDaysFor(dom) {
  const taken = new Set([dom, CORRECTION_DAY, RATE_CHANGE_DAY, OLD_RATE_DAY])
  return EXTRA_DAY_POOL.filter((d) => !taken.has(d)).slice(0, 3)
}

/* What the ledger must record for a day, given the date — asked of the engine, so
   the chain's expectation and the product's rule cannot drift apart. */
export function checkInKind(dateKey) {
  return suggestedKind(dateKey)
}

export function checkInMultiplier(dateKey, weekendMultiplier = 2) {
  return checkInKind(dateKey) === 'weekend' ? Number(weekendMultiplier) : 1
}
