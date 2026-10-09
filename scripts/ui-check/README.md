# UI check — does every screen actually render?

`vite build` proves a file compiles. It does not prove a screen renders: in
Phase 2 the roster pane was blank on real devices because a variable was never
passed into a component, and the build was perfectly happy about it. This
directory is the answer to that class of bug.

It mounts the employer and worker screens in a real DOM (jsdom), with the
**real** pure logic from `src/lib/employerLogic.js` and a fake network layer
(`mock-employer.js`). It then asserts three things:

1. **Every screen renders and fills** — including with data, not just in its
   loading state (server-side rendering only ever shows the loading state,
   which is why this uses a DOM).
2. **The controls do something** — tapping a day opens that day's detail;
   Agree answers *that* request with those arguments; the correction form
   sends the day and kind the worker chose and no invented fields; billing a
   period sends a contractor and two dates and **no amount of any kind**.
3. **The pre-existing screens still render** — the workspace's five panes,
   the day-marking grid, the summary, the roster, the attendance panel and the
   worker's check-in. This is the "do not break what works" rule, executed.

## Running it

```bash
npm install     # jsdom is a devDependency, so this is the whole setup
npx vite build --config scripts/ui-check/vite.ssr.config.mjs
node node_modules/.daypay-ui-check/entry.js
```

Exit code 0 means every check passed; the output names each screen it mounted.

**It also runs as the last step of `npm run prove`**, which compiles it and then
runs it. That was added on 1 October 2026, and the reason is the paragraph below.

## The fixtures are dated from today, and they have to be

They were pinned to September 2026. The employer screen opens on the **current**
month, so on 1 October every day this suite looked for was off the calendar:

```
FAIL  the calendar shows the recorded days  -> 0 marked cell(s)
FAIL  Billing, loaded period — missing: Not yet billed | Ready to bill | ₦42,000
Error: tried to click something that is not there
```

All three messages describe a broken product. All three were a broken test. The
suite had gone from ALL GREEN to dying part-way through, and `npm run prove` did
not run it, so nothing else in the repo could notice. Two things came out of it:

- `mock-employer.js` derives its days from `new Date()` — and picks **weekdays**
  for the days the app prices as ordinary work, because the calendar marks a
  weekend 2×. `tests/harness.test.js` holds both facts, and fails if any ISO date
  literal is ever pinned in this directory again.
- `npm run prove` now runs this directory, so a suite that has stopped testing
  can no longer pass unnoticed.

If a check fails here, read the dates in the message before the code: the
fixtures are supposed to follow the calendar.

## The polish invariants

Every mounted screen is passed through `polish.js` before it is called a pass,
so a defect has to survive all of it. The rules are objective on purpose —
"looks better" is taste and cannot fail a build, but these are facts:

- no `undefined`, `NaN` or `[object Object]` visible in the text. A pane showing
  `NaN` looks like an amount and is not one, which is the same family of failure
  as the blank screen `PaneErrorBoundary` exists to end.
- every `₦` amount grouped in threes, whole naira, no decimals and no device
  locale (`src/lib/payslip.js` documents why).
- no raw database error in user-facing text (`PGRST`, `SQLSTATE`, …).

Attributes are stripped first, so a class called `ew-undefined-state` is not a
failure. `tests/polish.test.js` checks the checker: every rule is given
something it must catch and something it must leave alone. That second half is
not decoration — the first draft of the money rule failed two healthy panes
because a sentence ending "…totals ₦42,000." looked like kobo.

The invoice PDF is stubbed (`mock-invoice-pdf.js`) because jsPDF has no business
running in node. The stub records what the document was asked to print, which is
the thing worth checking: that it is handed the **stored** figures, not a fresh
calculation.

`mock-employer.js` re-exports the real pure helpers rather than restating
them, so the screens are checked against shipping logic. An earlier version
hand-wrote `monthGrid` and `contractorRollup`, and both lied — the rollup
returned no rows for a worker with no days recorded, so a screen that was
working looked broken. Keep the mock to the network half only.
