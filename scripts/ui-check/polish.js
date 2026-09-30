/* DayPay — the polish invariants.
 *
 * Every screen the UI check mounts is handed to these rules, so a defect has to
 * survive all of them to reach the employer. They are deliberately OBJECTIVE:
 * "looks better" is a matter of taste and cannot be asserted, but "the word
 * undefined is visible on the Summary pane" and "this amount is not written
 * the way money is written everywhere else" are facts, and facts can fail a
 * build.
 *
 * WHY THESE THREE
 *
 *   undefined / NaN / [object Object]
 *     The three ways a JavaScript value leaks into text. A pane showing "NaN"
 *     is worse than a pane that admits it failed: it looks like an amount and
 *     it is not one. This is the same family of failure as the blank screen
 *     that PaneErrorBoundary exists to end — the user cannot tell whether the
 *     number is wrong or the app is.
 *
 *   money
 *     One format, everywhere: ₦ with comma grouping, whole naira, never a
 *     device locale (╎16,000 is ₦16,000 on every phone, in every region).
 *     src/lib/payslip.js documents the rule; src/App.jsx had grown a second
 *     formatter that used toLocaleString('en-NG'), which is subject to the
 *     runtime's ICU data and can quietly produce something else entirely.
 *
 * Text content only. Attributes are stripped first, because a class name or a
 * data attribute is not something a person reads, and `class="ew-undefined"`
 * should not fail a render.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

/* Crude on purpose: it runs on a test fixture, not on hostile input. Anything
   between < and > is markup and is not read by anybody. */
function textOf(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
}

/* ₦16,000 · ₦0 · ₦1,234,567 — whole naira, comma groups of three, nothing else.
   A match that does not fit is a real defect, not a formatting preference.

   The decimal part is written as an optional group rather than as "a dot is
   allowed", because a sentence ends "…totals ₦42,000." and the full stop is
   punctuation, not kobo. The first draft swallowed it and failed two healthy
   panes — an assertion has to be right before it is worth anything. A dot
   followed by digits is a genuine decimal, and that IS a defect: this product
   has no kobo. */
const MONEY = /₦\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g
const MONEY_OK = /^[0-9]{1,3}(,[0-9]{3})*$/

export function polishProblems(html) {
  const text = textOf(html)
  const problems = []

  // A bare "NaN" is only ever a bug; "undefined" only ever a bug.
  for (const word of ['undefined', 'NaN', '[object Object]']) {
    if (text.includes(word)) {
      const where = text.slice(Math.max(0, text.indexOf(word) - 40), text.indexOf(word) + 40)
      problems.push(`${word} is visible — …${where.trim()}…`)
    }
  }

  // Every amount on the screen, held to the one format.
  for (const m of text.matchAll(MONEY)) {
    if (!MONEY_OK.test(m[1].replace(/\s/g, ''))) problems.push(`malformed amount ${m[0]}`)
  }

  // A raw database error is not a user-facing sentence.
  for (const leak of ['syntax error at or near', 'PGRST', 'row-level security', 'SQLSTATE', 'null value in column']) {
    if (text.includes(leak)) problems.push(`raw database error leaked: ${leak}`)
  }

  return problems
}
