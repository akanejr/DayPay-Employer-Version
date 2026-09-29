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
   sends the day and kind the worker chose and no invented fields.
3. **The pre-existing screens still render** — the workspace's four sub-tabs,
   the day-marking grid, the summary, the roster, the attendance panel and the
   worker's check-in. This is the "do not break what works" rule, executed.

## Running it

```bash
npm install --no-save jsdom     # not in package.json: this is a dev-only tool
npx vite build --config scripts/ui-check/vite.ssr.config.mjs
node node_modules/.daypay-ui-check/entry.js
```

Exit code 0 means every check passed; the output names each screen it mounted.

`mock-employer.js` re-exports the real pure helpers rather than restating
them, so the screens are checked against shipping logic. An earlier version
hand-wrote `monthGrid` and `contractorRollup`, and both lied — the rollup
returned no rows for a worker with no days recorded, so a screen that was
working looked broken. Keep the mock to the network half only.
