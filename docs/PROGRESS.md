# Where DayPay stands

*Current as of the last commit on this branch. This file is a status report, not
a history lesson — for what each feature does, read `APP-SUMMARY.md`; for the
kiosk specifically, read `SITE-ATTENDANCE.md`.*

---

## The numbers

| | |
|---|---|
| Branch | `arena/01a0cffa-daypay-employer-version` |
| Migrations | **19**, all applied to project `crirzuoehbkzpnwokyxl` |
| Unit tests | **532** (`npm test`) |
| Cross-layer proofs | **859 checks, 0 failures** — migration chain 36/36 · e2e 115/115 · RLS harness 78/78 · lockout PASS · screens 626/626 (`npm run prove`) |
| UI check | **626 checks, all green** — every screen rendered in a real DOM: the navigation, the command centre, the screen that writes days, the roster, the worker profile checked against the engine’s own figures, the six destinations under More, the add-a-worker step end to end, every screen’s waiting, empty and failed state, the structure the wide-screen layout stands on, that the whole product speaks with one voice, and that every control answers to a thumb |
| Typefaces | **self-hosted** — 10 woff2 (Manrope + Geist Mono, 400–800) in `public/fonts/`, ₦ built into every file |
| Lint | 0 errors, 8 warnings (all pre-existing) |
| Build | `dist/` with two entry points: `index.html` and `kiosk.html` |

The UI check is now the **last step of `npm run prove`**. It used to be run by
hand, and on 1 October 2026 it turned out to have been quietly testing nothing
for a day — its fixtures were pinned to September, the employer screen opens on
the current month, so the days it looked for were not on screen. A proof that is
not run is not a proof, so the runner runs it. `tests/harness.test.js` holds the
fixtures to the calendar, and fails if a date is ever pinned there again.

Two real defects were found and fixed the same day, both by measuring the **built
output** rather than the sources:

- `src/App.jsx` was still injecting
  `<style>@import url('https://fonts.googleapis.com/…')</style>` into the app root
  at runtime. The pages and the stylesheets had been cleaned, so the design suite
  was green while every screen still fetched Manrope and Geist Mono from a CDN
  the service worker skips by design — the exact fault the self-hosted fonts
  exist to end. The suite now scans every file that ships.
- the UI check's own fixtures, described above.

A third review of the Staff pane the same day produced three changes, all of them
things that were on screen rather than opinions:

- **the rate had no rank.** It sat at the same 13px as the job title and the
  status chips beside it, so the number an employer scans a row for looked like
  everything else. It now stands one ramp step above its meta, and "No rate set"
  moved with it so a row does not jump as rates are entered.
- **"Not registered" was a badge.** Same pill, same 12px/600 as the green
  "Registered" chip next to it, told apart by colour alone — the first distinction
  to go in sunlight or for a colour-blind reader. By §4 it is a fact about a
  login, not a fault, so it now reads as quiet information and the green chip
  keeps the badge role. ("No rate set" stays amber: a missing rate *is* something
  to act on.)
- **five controls shared one row on the Staff pane** — a contractor select and
  four buttons, `flex: 0 0 auto`, beside a name that was `flex: 1 1 auto;
  min-width: 0`. On a phone the name collapsed and the controls ran off the card.
  Below 600px the row now takes its own line and can wrap among itself. Nothing
  is hidden: all five stay visible. `Archive` also moved to the app's existing
  destructive style, since it was the same rank as `Rates` and `Invite`.

### DayPay 2.0 — Phase 17: polish — a name for the workplace, and taps a thumb can hit (2 October 2026)

**The last row of the audit's "missing" table was a writer nobody called.**
`employers.business_name` had a column, a writer in the data layer
(`updateBusinessName`) and three readers — the worker's own header, the leave
prompt and the site kiosk's door screen — and no screen that ever called the
writer. So every reader fell back, and the product called an employer's business
**"My team"**, **"this team"** and **"Your site"** to the people who work there.

- **Settings → Workplace** now exists, for an employer account only, and it is
  the screen that calls the writer (`src/employer/Workplace.jsx`: a row in the
  list, a page with the field). The field is seeded from the name that is
  *stored*, not from an empty box; a blank name is refused twice — the Save button
  is disabled, and the save function returns on an empty draft before it reaches
  the network — and a save that works re-reads the roles so every surface picks
  the new name up at once. A save that fails says so in words (`role="alert"`),
  and never claims to have saved.
- **Who is offered it is a named rule, tested without a database**:
  `workplaceVisible(roles)` in `src/lib/employerLogic.js` — a business account is,
  a worker and a personal workspace are not, and an account whose roles have not
  loaded yet is not. The settings list draws the row behind that rule (checked),
  and the worker's own settings never shows a door that refuses (also checked, in
  a real DOM).
- **Every control is now the size of a thumb, or says why not.** The scan that
  found them is a new check rather than a list of classes: it reads the three
  stylesheets and reports any control below 44px in either direction. What it
  found and this phase fixed: the Attendance **date stepper** (42px), the Settings
  **back button** (38px), the header's **theme toggle** and **menu button** (38px
  wide — they keep their drawn size and gain a 44px hit area, the same trick
  `.icon-btn.small` already used), the **future-day chips** (42px wide), the
  leave-type **₦/% toggle and delete** (32px), the reminder popup's **close**
  (30px, with a hit area now), a section header's **action** (40px), and the
  reminder **day-of-week chips** — 36px wide and about 30px tall, seven of them in
  one row, which is exactly the shape a thumb misses. They are the token in both
  directions now, and the row wraps on a phone too narrow for seven.
- **The audit's other "missing" rows were delivered earlier; this phase holds
  them to being there** instead of rebuilding them. Search (§29) and the filter
  chips (§10) are on People — `type="search"` over the name, the trade and the
  contractor, and All / Registered / Not registered named after the fact that
  varies (§4: a roster record is not an account). The modal was already a bottom
  sheet on a phone (§34: anchored to the bottom, top-rounded, centred from 600px).
  Skeletons (§22), inline success and failure messages (§24) and `:focus-visible`
  across the sheets (§26) were all in place. Each is now named in a check, so the
  §39 audit can cite evidence rather than memory.

**Numbers.** Unit tests **493** (was 477; 489 at delivery, and four more with the
calendar guards below) · UI check **576** (was 555 — 21 in
`scripts/ui-check/workplace.jsx`) · lint 0 errors, 8 warnings (all pre-existing) ·
`npm run prove` green: migration 36/36, e2e 115/115, RLS 78/78, lockout PASS,
screens 576/576.

**What the checks can and cannot see.** The workplace screen is verified in a real
DOM against the same mock data layer the rest of the suite uses: the row's words,
the field's contents, the disabled Save, the exact string sent to
`updateBusinessName`, the callback that re-reads the roles, the success note, and
the failure path. The roles *gate* is unit-tested as a pure rule and checked in the
source at the place the card is drawn — it cannot be driven end-to-end here
because the harness has no signed-in employer account, and that limit is written
down rather than glossed over. Twelve deliberate regressions were run against the
new guards — the gate removed, the writer uncalled, the roles refresh skipped, the
failure note unannounced, a filter choice reworded, the sheet recentred, the back
button shrunk, a hit area deleted, a brand-new 30px control added, an empty name
made sendable, the alert role removed — and each was caught. Three gaps in the
checks themselves were found the same way and fixed: a size scan that a rule's own
comment hid from (`/* … */` before the first declaration), a check that watched the
button rather than the function's guard, and a roles-refresh assertion that passed
while the handler could still return early.

**Preserved:** every screen, every figure, every write, every address. No engine
change, no new data, nothing removed — the 555 checks that were green before this
phase are green inside the 576. The kiosk loads none of the stylesheets this phase
touched.

**Two calendar defects in the proofs themselves, found the next morning and fixed
(3 October 2026).** `npm run prove` had been green on the 2nd and failed five checks
on the 3rd with no line of the product changed — the chain had been written for
Monday to Friday:

- **The day it runs on.** A check-in's kind follows the DATE, in the database
  (`case when extract(isodow from work_date) >= 6 then 'weekend' else 'work'`) and in
  the engine (`suggestedKind`). The chain asserted `kind === 'work'` and
  `multiplier === 1`, which is true five days a week; the RLS harness's check 26
  asserted the same, so the *shipped* file also reported a database broken for
  behaving exactly as its own migrations say. Both now ask the date, through
  `checkInKind` / `checkInMultiplier` and the same `isodow` expression the trigger
  uses — so each check still fails if the ledger records the wrong kind for the day,
  which is the thing worth asserting.
- **Day 6.** The employer's extra days were picked from `[3, 4, 6, 20]` minus today,
  and day 6 is exactly where the correction scenario asks about a missing day — so on
  the 3rd and 4th of the month the employer had already written it, the approved
  correction correctly did nothing, and the chain failed asserting a change that
  should not have happened. The choices now live in
  `scripts/integration/fixture-days.mjs`, which returns exactly three days that
  cannot collide with the check-in day, the correction day or a rate-history day.

Both are the same class of defect as the pinned-September fixtures above, and both
are now guarded where that one is guarded: `tests/harness.test.js` walks **every day
of the month** and fails if any scenario's days collide, asserts the kind and
multiplier for a known Saturday, Sunday and Monday, and checks that both the chain
and the shipped SQL harness still derive their expectations from the date. The five
regressions were put back one at a time, and all five were caught.

### DayPay 2.0 — Phase 16: consistency — one voice, one status, one week (2 October 2026)

**The product had two voices, one tap apart.** Phase 9 brought the employer's
screens to sentence case; the personal tracker, the worker's own month and the
status badges had been left in a different one. The tracker's instruction line
shouted `LOG OK FOR EACH DAY` at a person who had just opened the app to do
exactly that, and its day states were stamped `FINAL` and `IN PROGRESS` while the
worker's own screen said "Confirmed" and "Awaiting confirmation" about the same
day. This phase deletes the second voice rather than restyling it.

- **Twenty-five rules that forced capitals are gone from `index.css`** — the
  property, not the text. Whatever a screen writes is what a person reads; nothing
  can be shouted at from the stylesheet. Letter-spacing normalised to `0.01em`
  with it. `.ew-code` (the site kiosk code, read aloud and written down) keeps its
  capitals in `employer.css`, as the two verification strings in `kiosk.css` keep
  theirs: the kiosk is the standard, and a code is a code, not a sentence.
  The tracker's day-code stamps (`OK`, `OT`, `HOL`, `LV`) are deliberately exempt —
  they are a legend already explained on the same screen, in fixed-width cells.
- **The four status pills are one pill, and it is the employer chip's own
  measurements** (`--fs-label`, weight 600, radius 999px, `2.5px var(--sp-2)`
  padding, a `--bg-sunken` wash). `Final`, `Active` and the rate-history pills are
  compared *against* `.ew-chip` by the checks, so they cannot drift apart again.
  A settled day is quiet; a live one carries the green wash — green means working
  (§4). Every pill keeps a dot that inherits its state's ink (`currentColor`), so
  no state is told apart by colour alone: the word is always there.
- **The employer's two month calendars stopped using initials.** They printed
  `M T W T F S S` — two pairs of duplicate letters a person has to resolve by
  position, at the same phone width where the tracker had always spelled the week
  out. Both now print `Mon Tue Wed Thu Fri Sat Sun`, and all three calendars read
  the **one shared list** (`WEEKDAYS` in `src/lib/format.js`) rather than three
  copies of the same seven words. A check holds the seven columns equal, because
  three letters only fit if they are.
- **Contractor rows sit in the roster's list container** (`.ew-list`), not in
  cards of their own design beside it: one product, one row. The roster keeps a
  standalone card for its rate panel, which is a panel, not a row.

**Numbers.** Unit tests **477** (was 472) · UI check **555** (was 541 — 14 in
`scripts/ui-check/consistency.jsx`) · lint 0 errors, 8 warnings (all pre-existing;
the ninth was an import this phase removed) · `npm run prove` green: migration
36/36, e2e 115/115, RLS 78/78, lockout PASS, screens 555/555.

**What the checks can and cannot see.** `tests/design.test.js` reads the
stylesheets (the rule text, sliced to a marker rather than to a character count —
a fixed window is how a check passes while the thing it looks for sits four lines
outside it) and holds the pill to the chip's measurements. `consistency.jsx`
mounts the tracker, the contractors screen, the roster and the attendance month
and asks the DOM questions a person would: is any text shouting, is a contractor
row inside the shared list, do the calendars print the same words. Both suites
were **mutation-tested**: eight deliberate regressions — capitals returned to a
rule, the tracker shouting `ACTIVE` again, the pill's radius changed, the live
wash removed, the list rule deleted, the contractor rows moved out of the
container, the employer's initials restored, the week columns made fixed-width —
were each caught, and each file restored byte-for-byte. Two of the checks' own
mistakes were found and fixed the same way: a slice that stopped short of the wash
it was looking for, and an assertion that asked about source order a question
that is really about the DOM (`closest('.ew-list')`).

**Preserved:** every screen, every figure, every write, every address. No engine
change, no new data, no removed functionality — the 541 checks that were green
before this phase are green inside the 555. The kiosk loads none of the
stylesheets this phase touched.

### DayPay 2.0 — Phase 15: desktop — the same app, laid out for a wide screen (2 October 2026)

**The audit's finding was blunt: on a 27-inch monitor DayPay was a 480px phone
column inside a decorative border, and the only wide-screen rule in the whole shell
resized that border. `--fs-2xs` aside, the largest breakpoint in `employer.css` was
600px, and every one of them was mobile-side. §27 of the brief asks for side
navigation, multi-column layouts and larger tables. This phase is *additive*: the
phone layout is the media query's `else`, and all 516 checks that were green before
it are green inside the 541 that are green now.**

- **From 1024px the shell stops being a phone.** The frame goes full width with no
  border, radius or shadow, and — one line with a reason behind it — `overflow:
  visible`. The rail is `position: fixed` inside the frame, and a clipping ancestor
  is exactly how a fixed child gets cut off at the bottom of a short screen. With no
  rounded corners left there is nothing for the clip to protect.
- **The navigation leaves the bottom of the phone and becomes a rail.** Same
  element, same four destinations read from `EMPLOYER_NAV`, same address behind each
  one, same `aria-current`, same 44px targets. The marker turns ninety degrees — a
  3px rule beside the label — so the active destination is still carried by position
  and weight and never by colour alone. No new markup was written for it: the rail
  *is* the tab bar, told to stand up.
- **One column with a measure.** Content is capped at `--content-max` (1080px) and
  centred in the room the rail leaves; sentences stop at 78ch. A line of text 1600px
  wide is unreadable, and a figure at the far end of one is worse — the cap is what
  makes the width usable rather than merely large.
- **Rows become the table they were always shaped like.** A row is `[icon] text …
  trail`, and on a phone the trail sits wherever the text happens to end. From
  1024px it sits in a reserved right-hand column, so figures line up down a list —
  the only reason to want the width in the first place. Descriptions are capped at
  68ch so they do not run the monitor.
- **Two columns where a screen has two jobs, from 1280px.** *Today*: the day and
  what needs an answer on the left, what the month adds up to and the setup behind
  it on the right. *Attendance*: the calendar on the left — sticky, because it is the
  control for the list beside it — and the people to record on the right, with the
  title, the lede and the day's closing line spanning both. *More*: the four groups
  two by two. *Settings*: the overlay widens to 820px and the six categories sit two
  to a row, with the account card above them both.
- **The phone did not move, and that is proved rather than claimed.** The three
  wrappers the wide layout needs are `display: contents` in the base stylesheet: no
  box, no margin, no gap of their own, so below 1280px the phone layout is byte-for
  -byte the one the screen checks were written against. A guard fails if that ever
  stops being true — and the desktop grid is on `.ew-att-split`, a class only the
  branch with two jobs carries, so the empty-roster screen cannot be scattered
  across two columns.
- **The wide shell belongs to the workspace and to nothing else.** The personal
  tracker and the worker's own screens are one-handed, personal screens: stretching
  them across a desk is a regression dressed as a desktop layout. The frame that does
  not contain the workspace keeps its 480px column, Settings keeps its own panel, and
  a reading column (720px) is the fail-safe for a browser without `:has()`.
- **Two real defects fixed on the way past.** `ew-more` was both the More pane's root
  *and* the roster row's overflow button — one class, two things — so the wide layout
  could have turned a 44px button into a grid; the pane carries `ew-more-pane` as well
  now, and the button is untouched. And the workspace's loading state ran the full
  width of the window, because it was rendered outside the pane container; it is
  inside it now (`ew-is-waiting` also drops the 40px the absent bottom bar needed).

**Numbers.** Unit tests **472** (was 466) · UI check **541** (was 516 — 25 in
`scripts/ui-check/desktop.jsx`) · lint 0 errors, 8 warnings (all pre-existing) ·
`npm run prove` green: migration 36/36, e2e 115/115, RLS 78/78, lockout PASS, screens
541/541. Six new design rules hold the CSS contract.

**What could be verified, and what could not — plainly.** There is no browser in this
environment: jsdom has no layout engine and does not evaluate media queries, so no
check in this repository can *see* the rail. What is verified mechanically is the
contract: `tests/design.test.js` reads the media blocks and holds the wide rules to
their promises (the frame stops being capped; the rail is fixed, 200px wide and runs
the window's height; the pane makes room for it; the content column has a measure;
the wrapper that makes it all harmless on a phone is still `display: contents`), and
`scripts/ui-check/desktop.jsx` mounts the screens and holds the *structure* those
rules hang off. Both suites were then **mutation-tested**: nine deliberate
regressions — the frame back to 480px, the clip restored, the rail made sticky, the
wrapper turned into a box, the split class removed, a column wrapper deleted, the
pane's padding removed, `ew-more-pane` removed, the trail column zeroed — were each
caught and the file restored. The first version of the frame assertion passed while
the frame was still 480px wide, because it had found `max-width: none` on the rail's
active marker; assertions about a rule now read that rule and nothing else. **The
pixels themselves are confirmed by the live preview at your own window width**, which
is why every phase ends with the preview running.

**Two more of the check's own mistakes, recorded because they are the same lesson as
Phase 14's.** The first run of `desktop.jsx` failed twice, and neither failure was the
app: one mount used `await act(async …)`, which drains the microtask queue and so had
already hidden the loading state it was looking for — the fix is a synchronous `act`,
and the helper now says so; and one check assumed a day picker is on screen in the
*day* range, where the screen quite correctly draws none. The check now chooses the
Week range first and then looks.

**Preserved:** every screen, every figure, every write. No engine change, no new
address, no new data. The 516 checks that were green before this phase are green
inside the 541; the kiosk does not load the stylesheets this phase touched.

### DayPay 2.0 — Phase 14: states — a screen that waits, and a screen that fails (2 October 2026)

**Every screen can be in one of four states: it has the answer, it is still
waiting for it, it has nothing to show, or it could not find out. The first and
the third were designed. The second and the fourth were whatever was left over —
and the leftover was dangerous in one specific way: a screen that had not managed
to read the database drew the same picture as a screen that had read it and found
nothing.**

- **Loading is one component, and it is three things at once.** `Loading` in
  `src/ui/Ui.jsx` draws skeleton shapes where the content will be, a sentence for
  assistive technology (`dp-sr`, clipped rather than visible), and `aria-busy` on
  the block. Separately each is a way to get it partly right — a shape with no
  words is silence to a screen reader, words with no shape make the page jump when
  the data lands — so it is deliberately one thing a screen cannot half-do.
- **Ten screens now use it, and their own versions are deleted.** The workspace
  shell, the staff pane, the command centre's today list (the skeleton still sits
  inside its `.ew-dash` wrapper, so the frame does not disappear while the records
  are on their way), the attendance panel, the check-in card, the worker's own
  month, the employer's per-worker pane, billing's invoice lines (shape `rows`,
  two of them — three would over-promise), Reports, and the days sheet.
  `.ew-loading` and `.ew-att-skeleton` are gone from `employer.css`: there is one
  way to say *on its way*, and it lives in the design system.
- **The check-in card no longer answers for the database.** `CheckIn.jsx` read the
  attendance status into a `catch { setStatus(null) }`, and `attendancePrompt(null)`
  is the *"Attendance is not open"* card — *"Your employer has not opened
  attendance yet."* A worker whose phone could not reach Supabase was told a fact
  about their employer's site. It has a `loadError` state of its own now:
  **"Could not check today's attendance"**, what to do about it, and a **Try
  again** that asks again — proved by counting reads (`myAttendanceStatus` 1 → 2)
  and watching the ordinary card come back. This is the fault the phase exists to
  remove, and it was found by asking what each screen does when its read fails.
- **The worker's month stopped drawing an empty month under an error.**
  `EmployeeView.jsx` put its error line above the ordinary empty state, so a failed
  read also said *"No days recorded in October"* — a claim about a worker's pay,
  made by a screen that did not know. The empty state is suppressed while loading
  or failed, the error carries `role="alert"` with a Try again, and the figure
  above no longer repeats *"Nothing recorded yet this month"* when the empty state
  below already says it.
- **"Could not reach DayPay" is now something the app can say.** A phone at a
  site, outdoors, on one bar of signal is the connection this app is built for, so
  the commonest way a read fails is the one that never reaches the server — and that
  is not a Postgres error. It has no SQLSTATE, so every case in `employer.js`'s
  error mapper missed it and the screen showed the browser's own sentence:
  *"TypeError: Failed to fetch"*. `isOfflineError()` in `employerLogic.js` (no
  imports, so it is unit-tested directly) recognises the seven ways Chrome, Safari,
  Firefox, React Native, undici and an iOS WebView word the same failure, and
  `describe()` maps it to *"Could not reach DayPay. Check your connection."* with
  *"Try again when you have a signal."* **It deliberately does not say the change
  failed** — a request that never got an answer is not the same as a request that
  was refused, and telling an employer their day was not recorded when it may have
  landed is worse than saying we do not know. Errors that carry a SQLSTATE are never
  caught by it: "check your connection" would send somebody to wave a phone in the
  air when the real answer is a migration that has not been run.
- **A destination that exists.** The contractor screen with no workers said
  *"Assign them under **Roster**."* The roster has been called **People** since
  Phase 6. A guard now fails if any employer screen names Roster as a place.

**Numbers.** Unit tests **466** (was 459) · UI check **516 checks, all green**
(29 more than before this phase) · lint 0 errors, 8 warnings (all pre-existing) ·
`npm run prove` green: migration 36/36, e2e 115/115, RLS 78/78, lockout PASS,
screens 516/516. The new checks are 28 in `scripts/ui-check/states.jsx`, 4 in
`tests/design.test.js`, 3 in `tests/employer.test.js` (the connection classifier,
which is pure) and 1 in the specimen suite, which now holds `.dp-loading` to the
same rule as every other primitive: a design system with an invisible member has
already begun to drift.

**A word about the count, because the previous figure was one too high.** The
number quoted in earlier phases was taken with `grep -c PASS`, which also matches
the suite's own `INTERACTION: ALL CHECKS PASSED` heading — so "488" was 487 real
checks plus a heading. Every figure from here on is counted as lines the harness
itself prints (`^  PASS` / `^  FAIL`), which is the only count that can be
reproduced. Before this phase that method gives 487; the phase adds 29; it gives
**516** now. The earlier sections of this file keep the numbers that were reported
at the time.
Two things are worth recording about writing a state check:

- **The loading state must be read mid-load.** The harness's `mount` is a
  *synchronous* `act`, because `await act(async () => …)` also drains the
  microtask queue — by the time it returns, the fixture has arrived and the
  loading state is gone. A check written that way passes while proving nothing,
  which is worse than no check.
- **A check that cannot fail is not a check.** The first run of the suite failed
  eleven times, and every failure but one was the check's own fault: a helper that
  stringified an empty element as *"[object HTMLDivElement]"*, a heuristic
  "which files wait for a read" rule that flagged nine innocent files, a
  correction-state sentence guessed at instead of read from the engine's own
  `CORRECTION_STATUS` table, and a retry check that looked for the code field when
  the session was closed. One was real: the duplicate empty sentence above.

**Preserved:** every screen, every figure and every write. The engine, the rate
history, weekend and overtime treatment, the PIN flow, the kiosk, the addresses
and the one attendance database are untouched — Phase 14 changed when a screen
says something, never what it says about pay. The checks that were green before
this phase are green inside the 516.

### DayPay 2.0 — Phase 9: polish — the edges of the screens that already exist (1 October 2026)

**Polish is the phase where nothing new is built and everything that was left is
finished. It was scoped by walking the shipped screens and asking one question of
each: what does this do when it has no data, no name, or nothing to say? Three
answers were wrong, and one of them was a button that could not be pressed.**

- **Adding a worker is a step with an address.** It was a `useState` flag only the
  roster could see, which made three promises false: the command centre's *one
  thing to do* on an empty roster ("Add a worker") landed on People with the form
  still one tap away, a reload closed the form, and the back button did nothing.
  `#/people/new` is the step now — it still belongs to People, so the tab bar keeps
  saying where the employer is, and closing or finishing the step puts the address
  back on the roster. `/people/whoever` still falls through to home, because the
  step is named exactly and not by prefix (`tests/routes.test.js`).
- **The empty form answers instead of being disabled into silence.** The submit sat
  at `disabled={busy || !name.trim()}`: a dead button with no reason given, on the
  screen a brand-new employer meets first. Pressing it now says *"A worker needs a
  name"* on the field, puts the cursor there, announces it (`role="alert"`) — and
  **sends nothing**. The check that proves it is the write log: an empty press adds
  no `createEmployee` call at all.
- **The form says what it is.** One sentence above the fields: this puts them on
  your roster, it does not create a DayPay account for them, they can be invited
  whenever they are ready, and their days are recorded the same either way. It is
  the standing rule about a worker record not being a registered user, said where
  the record is made.
- **The confirmation is announced, and the PIN leaves with it.** *"✓ Grace Adeyemi
  is on the roster"* is a heading with a tick AND the words, on a card that carries
  `role="status"`; Copy says *"✓ Copied"*. One real bug came out of the walk: both
  Done buttons passed their **click event** to `onCreated`, so the id of the worker
  who had just been added arrived as a MouseEvent.
- **Nothing on an employer screen is below the design system's floor.** Eighteen
  micro-labels were still set at the 11px step the new `src/ui` layer never used;
  they are at 12px now (`--fs-label`), and the guard fails if `--fs-2xs` comes back
  or if any inline `fontSize` under 12 appears in `src/employer/`.
- **Sentence case, in one place instead of eleven.** Phase 6 turned the caps off for
  the roster's panels with a scoped override. The brief asks for no excessive
  uppercase, so the shared `.ew-label` style moved and the override is gone — and
  the guard now asserts that **the only rule in `employer.css` that uppercases
  anything is `.ew-code`**, because a site code is read out loud at a kiosk and two
  characters must not be able to be confused.
- **One empty state said something untrue.** Contractors answered *"No archived
  contractors."* in a state where the archive held the only contractor there was — an
  employer who archived their only supplier was told there were none. It now says
  which list is empty and where the other one is. `tests/design.test.js` holds every
  employer screen that shows a list to "the state is said", naming where each one
  says it — the kiosk says it in the line above the list, beside the action that
  fills it, and the guard records that rather than forcing a second sentence.
- **A focus ring for the control nobody could see.** `index.css` rings `button`, `a`
  and `input`; the `<select>` — the contractor control on a roster row, and the
  appearance pickers in Settings — had none. It does now.

**Numbers.** Unit tests 459 (was 450) · UI check 488 real checks, all green (was
464) · lint 0 errors, 8 warnings (all pre-existing) · `npm run prove` green:
migration 36/36, e2e 115/115, RLS 78/78. The new checks are 21 in
`scripts/ui-check/polish.jsx` and 3 in `more.jsx`, with 9 new unit tests (8 design
rules for this phase's surfaces and the add step's address, 1 in `routes.test.js`).
Three existing guards were
rewritten rather than deleted, each because the thing it pinned had legitimately
moved: the roster's sentence-case override (the shared style moved instead), the
routes table's unknown-address guarantee (the new step is named exactly, so
`/people/whoever` still falls through), and `design.test.js`'s roster-label test.

**Preserved:** every screen, every figure and every write. The payroll engine, rate
history, weekend/overtime treatment, the PIN flow (still shown exactly once, still
hashed), the kiosk, the worker's own views, the addresses, and the one attendance
database are untouched. The add-a-worker form still writes one employee row and a
PIN and nothing else; the check walks the whole flow and insists the write log
contains exactly `[["createEmployee", "Grace Adeyemi"]]`.

**New proof.** `scripts/ui-check/polish.jsx` (21 checks) drives the flow in a real
DOM: the address opens the form, an empty press is answered and sends nothing, the
confirmation is announced, Copy reports itself, Done returns to the roster and the
one-time PIN does not follow it there, and a new employer's single action lands on
the form. `more.jsx` gained the archived-only-contractor check (three) and the mock
gained `setContractorFixtures` so it can be staged and removed the same way the
invoice and device fixtures are.

### DayPay 2.0 — Phase 8: More, and the six destinations under it (1 October 2026)

**More is the one place in this app where a screen can be added without anybody
noticing: it is a list of rows, and a row is cheap. Three of the four employer
screens under it opened as a compact card at the foot of the roster — an icon, a
title and a button, with no name of their own and nowhere to say what they were
for. Each is a destination now, and each answers the question its own name asks.**

- **Contractors.** It printed a COUNT — "3 workers" — so an employer who wanted to
  know *which* three had to open People and find out. Every contractor's row now
  names the workers under it, and the header counts what the engine counts:
  `assigned of active` workers. Assignment is deliberately not editable here: who
  supplies a worker is set on the worker's own row in People, and only the employer
  can set it — the screen says so instead of offering a second place to do it.
- **Site kiosk.** It said "Not linked yet" in three different situations: still
  loading, not installed on this database, and **the load failed**. Those are not
  the same thing, and after a network failure the sentence sends an employer to run
  a migration they have already run. The screen now tells them apart, says
  *"Could not load your machines"* when that is what happened, and offers **Try
  again**, which asks the database again and recovers. A `Skeleton` covers the
  loading state, and the machine list, the one-time code and the explanation behind
  the info button are unchanged.
- **Billing.** It is a screen now: its own name, one sentence saying that an
  invoice is a *document* — once issued it is not edited, void it to bill the
  period again — and its empty state on the house `Notice`, which also promises
  what is true of a voided invoice (it stays on file). Nothing about issuing,
  voiding or the PDF path changed.
- **Reports.** Its own name, and a sentence that states its order of business: the
  month's cost person by person first, the raw days as a CSV when you ask. The
  empty month is a `Notice` again.
- **Settings — and two bugs in it.** Every sub-page used to show the same word,
  "Settings", so the only way to tell Profile from Appearance was to read the
  content; the crumb now names the page (`Settings · Appearance`), and the six
  names live in one place so a page cannot exist without one. And the page had two
  doors into Profile — the profile card at the top *and* a "Profile" row beside it —
  which is one row asking the reader to work out which door is which. The row is
  gone; the card was already the door.
- **Notifications** is the same page opened on Reminders — as it always was, since
  that is the only thing "notifications" means here. What is new is that the header
  now reconciles the two words (`Settings · Reminders`) instead of leaving the row
  and the page disagreeing.

**Stale copy, fixed.** Two lines survived the renames of Phases 5 and 6 and were
still sending readers to screens that no longer exist: *"Restore the person on the
Roster tab"* and *"Head to Mark days and tap who worked"*. The first now names
People; the second is part of the empty state, which names Attendance and says what
the screen will and will not do. A reader who goes looking for a screen that is not
there has been told something untrue by the app.

**The old row styling went with the rows.** `.ew-tool*` — the compact card that held
kiosk and contractors at the foot of the roster — is deleted, not deprecated: a
usage scan found no renderer left. What replaced it is the header every other screen
uses (`.ew-head` + `.ew-title` + `.ew-sub`), plus `.ew-screen-info` and
`.ew-screen-note` for what hangs below it on the kiosk screen.

**Numbers.** Unit tests 450 (was 437) · UI check 464 real checks, all green (was
411) · lint 0 errors, 8 warnings (all pre-existing) · `npm run prove` green:
migration 36/36, e2e 115/115, RLS 78/78. The new 53 checks are 51 in
`scripts/ui-check/more.jsx` and 8 design rules replacing 3 structural guards that
pinned the old roster-row shape. Two mock defects were fixed while writing them,
both of the same kind: the mock's `listAllMonth` ignored the month it was asked for
(so a month with nothing in it showed data), and `listDevices` had no way to fail —
which is exactly the state this phase exists to tell apart. A third defect was found
by the first one: `profile.jsx`, written in Phase 7, staged a month of days and never
took them away, so the leak landed in whichever suite ran next.

**One thing deliberately not done here.** A contractor's row is still its own card
(`.ew-person`), not a row in a divided list like the roster's. Restyling it means
rewriting a list that carries inline rename and archive controls, and that is a
change to the roster's row language rather than to a destination's job — reported,
not smuggled in.

---

### DayPay 2.0 — Phase 7: the worker profile, one person in one place (1 October 2026)

**The screen an employer opens about one person now answers, in this order, the
questions they arrive with: who is this, what do they earn, what is this month
worth, and what is waiting on me.**

- **Who.** The name is the heading, the trade and the contractor are one line (the
  profile is *told* the contractor name — `employee.contractor_name` is a column on
  an invoice, never on a worker, which is why the old screen printed "Rigger" and
  stopped), and the account state is a chip **plus a sentence**. "Not registered"
  is a fact about a login; an employer who reads it as "not employed" stops paying
  somebody who is still owed. The sentence comes from `accountStatus()`, the same
  function the roster's chip uses.
- **What they earn.** The daily rate in force today, the weekend and holiday
  multipliers that would value a Saturday, and the date the rate started — read off
  the rate period the database itself would use. When no rate covers today the
  screen says so plainly and says what it stops: the day cannot be saved or paid,
  and Rates lives on their row in People. When the screen was *never told* about
  rates (the contractor's list opens a worker without them) it says nothing at all
  rather than claiming there is none.
- **What the month is worth.** One figure, labelled with the month, with three
  facts underneath it: days recorded (with overtime and leave named beneath when
  there are any), paid-day equivalents, and days waiting for confirmation — marked
  *"not counted as settled yet"* in words, so unconfirmed money is never presented
  as settled. Every number is `workerMonthTotals()`'s.
- **The month steps.** It was pinned to the current month, so "was he in last
  month?" had no answer on the screen about him, even though `listEmployeeMonth`
  always took a year and a month. The stepper is the one Attendance and Reports
  already use.
- **States.** A skeleton while the month loads; a `Notice` when a month has no days
  (the grid stays — the dates are how an employer checks they are looking at the
  month they meant) with the way back to this month; and a `Notice tone="error"`
  with **Try again** when the load fails, because a pane that failed and a pane
  that is slow look identical from the outside.

**The day sheet moved under the calendar.** It used to render above the tabs, so a
tap near the bottom of a phone opened a sheet off-screen. It is inside the days tab
now, and switching tabs closes it.

**Nothing was removed, and nothing new is recorded here.** Reclassifying a day
(`setDay` with `confirm: true`), confirming, disputing, reopening, removing, and
answering corrections are all exactly as they were — one row changes, no row is
added. The screen deliberately has **no marking control**: days are recorded one at
a time in Attendance, and a second place to record one is how a day gets recorded
twice. The empty-day text says so instead of offering a form.

**A stale field, fixed.** The old header read `employee.contractor_name`, which no
worker record has — so the contractor was never shown on the profile. All three
call sites (People, the command centre, the contractor's list) now pass the name
they already resolved.

**Numbers.** Unit tests 437 at the time (429 before it) · UI check 411 real checks,
all green (359 before it) · lint 0 errors, 8 warnings (all pre-existing) · `npm run
prove` green: migration 36/36, e2e 115/115, RLS 78/78. The new 52 checks are 44 in
`scripts/ui-check/profile.jsx` plus 8 design rules here, and the file grew to 52 by
Phase 8. One dead CSS block went with it:
`.ew-attention*` / `.ew-card-attention`, whose last user was the old profile.

---

### DayPay 2.0 — Phase 6: People, a roster you can search (1 October 2026)

**The roster was a list you could read. It is a list you can find somebody in, and
every row is a door.**

- **Finding somebody** is one box above the list, and the matching rule lives in
  the engine — `filterPeople()` in `employerLogic.js`, unit-tested in
  `employer.test.js`. It is forgiving in the ways an employer actually is: case
  does not matter, accents do not have to be typed, part of a word is enough, the
  words may come in any order, and the trade and the contractor on the row are
  searched too, because with two workers called James that is how they are told
  apart. The screen asks the engine; it does not grow a second matcher.
- **The two account states** are a filter — **All · Registered · Not registered** —
  and the labels are the row chip's own words, straight out of `accountStatus()`.
  That is deliberate: "Not registered" is a fact about a *login*, it never means
  "not employed", and a tab and a chip that described different people would make
  that sentence untrue. There is no "Pending" state in this product and the filter
  does not invent one.
- **A row opens the person.** The name, the trade, the rate and the avatar are one
  button that opens that worker's own screen *inside People* — the address stays
  the roster's, the tab bar does not move, the search is still in the box when you
  come back, and the screen carries its own way back. The three-dot menu stays a
  **sibling** of that button rather than inside it; a button within a button is
  lost to whichever handler the browser chooses.
- **Nothing matched is a result.** It is a `Notice`, it says so in words, it offers
  the way back — and when the person being searched for is *archived* it says that
  too, because that is the one case the roster cannot show and the one an employer
  is most likely to hit.
- **The roster's own empty state** became the same `Notice tone="empty"` as
  everywhere else. It was the last screen-local `.ew-empty` block on a redesigned
  screen (App, Billing, Summary and EmployeeView still carry theirs, untouched).

**Two numbers came off two cards.** "On roster / Rates set" were stat cards on every
pane except People and Today. They are one line of context now, and it is on
Attendance — the last screen with nowhere else to say them — and it states the fact
an employer acts on rather than a subtraction: *"5 workers on the roster · 2 with no
rate yet"*, or *"every one of them has a rate"*. The words carry the meaning; the
colour only agrees with them. Nobody without a rate can have a day saved at all, so
this is a task, not a statistic.

**A money bug found on the way — introduced in Phase 4, not by this phase.** The
command centre's correction rows opened `WorkerView` with the *one* rate period it
had picked, and the day sheet valued every day in the month against it. On a worker
who had had a raise, every day before that raise showed "no rate". The screen now
takes the worker's whole rate history and asks which period covered *that day*.
Both call sites were wrong and both are fixed.

**What this phase did not do.** The worker's own screen (`WorkerView`) was left to
Phase 7 — Phase 6 only wired the roster's rows to it and fixed the money above (it
was rebuilt into the profile in the next phase). Nothing was removed: rates, the
PIN panel, invites, contractor assignment, archiving and restore are all where they
were, inside the row's overflow.

**Numbers.** Unit tests 429 (was 415) · UI check 359 real checks, all green (was
309) · lint 0 errors, 8 warnings (all pre-existing) · `npm run prove` green:
migration 36/36, e2e 115/115, RLS 78/78. The new 50 checks are 42 on the People
screen (`scripts/ui-check/people.jsx`) and 8 on Attendance's line of context.

---

### DayPay 2.0 — Phase 5: Attendance, and the only screen that writes (1 October 2026)

**One day, chosen three ways.** The screen was a single date with a ‹ › stepper.
It is now the same single day, with a **Today · Week · Month** range control, and
the range changes *the picker* — never the write. A day is still recorded one
person at a time, for one date, through the same `setDay` call:

- **Today** is the daily job: who is recorded, who is not, one tap each.
- **Week** shows seven days with the number recorded on each, so a gap in the
  middle of the week is visible without stepping through it.
- **Month** shows the calendar — the same `monthGrid()` the worker's own screen
  draws, so the product has one calendar and not two — with the month's own
  figures underneath: days recorded, awaiting confirmation, and what it adds up to.

There is deliberately **no "mark the whole week" button**. A week of days is
money; the brief asks for Today/Week/Month *views*, and the write stays one
person, one date. Nothing about the pay model moved.

**Who is missing comes first.** The people not recorded for the selected day are
the top section — name, trade, contractor, and the one control that fixes it.
The recorded follow, each with the kind in a word, the amount the server stored,
and an Undo. The two James problem stays solved: `Rigger · Contractor A` under
the name is what tells two workers with the same first name apart, and it is
pinned by a check that names both.

**Every action is confirmed in words.** Mark, undo, change the kind, record all:
each says what happened — *"Recorded James Okon for Tue 20 Oct 2026."* — in a
live region, because the row that changed is often below the fold on a phone.

**Rows, not cards.** Twenty workers were twenty bordered cards; they are one list
with hairline dividers now, and the four dead rule groups the old layout owned
(`.ew-strip`, `.ew-toggle`, `.ew-monthfoot`, and the note strip) are gone from the
stylesheet rather than left behind.

**What did not change.** The kind follows the DATE, not the tap — a Saturday is
still saved as weekend work, because that is where the multiplier is. Days are
still saved as `claimed`; confirmation is still a deliberate month-end act. No
rate and no amount is ever sent, and the new checks assert that the arguments of
`setDay` are exactly `(employee, date, kind)`. Marking all present is still
sequential and per-person, so a partial failure leaves the successes saved.

**The mock now behaves like the schema.** `setDay`/`clearDay` in the UI harness
compute a day the way the database trigger does — rate from the period in force,
multiplier from the kind, amount from the two — and splice the row into the
fixtures, so a check that marks a day and re-reads the screen is reading what an
employer sees, not a local guess. A mock that accepted an amount would have hidden
the one defect this screen must never have.

**New checks: 52, in `scripts/ui-check/attendance.jsx`** — one write per tap and
the right arguments; the row body writes nothing; the second press is an undo, not
a duplicate; a Saturday is recorded as weekend work at the multiplier the rate
period carries; the range control, the week strip and the month grid write
nothing; the month's three figures are compared *for equality* against
`monthFigures()`; the command centre states the same month total; a confirmed day
cannot be changed from here; the empty roster points at People.

### DayPay 2.0 — Phase 4: Today, the command centre (1 October 2026)

**One question, answered before the fold.** Today used to open with four stat
cards — Expected · Recorded · Not yet · Overtime — above a money figure and a list
of names. It made the employer do the subtraction: "4 expected, 1 recorded, 3 not
yet" is one fact written three ways. The screen now leads with that fact in the
shape of the answer:

```
Thursday 1 October 2026
1  of 1 recorded   [▬▬▬▬▬▬▬▬]
Recorded today  ₦32,000
[ Record today's work ]
```

The bar exists because a screen for somebody standing outdoors in sunlight should
not need to be read twice; its figures are repeated in words beside it, so the
bar is decorative and the sentence is what a screen reader hears. The four cards
are gone from this pane and stay on the panes that have nowhere else to say it.

**Order is the argument.** The screen now reads: what is *waiting on you*, then
the day's figure, then who is not recorded, then who is, then the month, then the
contractor rollup, then the site's attendance code. Two things moved to the top
because they are the only things on the screen that get worse with age:

- **a worker's correction request** — somebody is waiting at the end of it, and it
  now says what is being asked in a sentence ("Says this was overtime, not
  overtime.") rather than reporting a count, with the worker's own words quoted;
- **a missing rate** — a day cannot be saved without one, so this is not a
  warning, it is a blocked task, and it names the people it blocks.

**Names come before totals.** "Not yet recorded · 3" is not actionable; a row with
James Okon on it and *Record* at the end is, and it goes to the screen where a day
is actually marked. Contractors, the month's figures and the site attendance code
keep their places — the panel is not in the four destinations, so Today is the
only door to it.

**Decisions taken rather than asked about again.** Two questions from the Phase 3
report were left unanswered when the user said "Continue to phase 4":

1. *May Today collapse the two shell stat cards into the day's own figure?* — **yes**,
   and they are suppressed on this pane only. "18 of 21 recorded today" already
   states the roster size, and a missing rate is a named row rather than a count.
2. *May Today act on an unrecorded worker, or only navigate?* — **it navigates.**
   A row press opens Attendance; nothing on this screen writes a record, because
   the amount is frozen on confirm and a mis-tap on an overview is how somebody is
   paid for a day they did not work. The rule is now a test ("Today imports no way
   to write a day") rather than a habit.

**What did not change.** The money is still `monthFigures()`/`dayBoard()` — the
same `summarise()` the Summary pane and the payslip use, and Today is forbidden
from totalling the month itself. Nothing is invented: every row is a stored record
or the absence of one. The engine, the schema, the auth, the kiosk and the
calculations are untouched.

**New checks: 30, in `scripts/ui-check/today.jsx`** — and they compare the screen
to the engine rather than to a fixture, so the numbers, names and sentences are
computed with the same pure functions the screen calls and the DOM has to agree.
They cover: one figure and it is the engine's, the four cards are gone, the empty
state offers no button at all, the missing are named and their row goes to
Attendance, an open request reads as a sentence and opens that worker (and the way
back works), and the site attendance code kept its door. The clock is frozen on
the 20th for these checks — the mock's fixtures all land in the first eight days of
the month, and without it "somebody is missing" would be untestable on the days it
happened to be false.

### DayPay 2.0 — Phase 3: four destinations, and an address for each (1 October 2026)

**Navigation.** The employer workspace had five equal tabs — Today, Mark days,
Roster, Summary, Billing — so "what have I invoiced" sat beside "who is working
today" and competed with it for the same glance. §32's test is whether the reader
needs a thing *right now*: Today, Attendance and People pass it. Invoicing,
contractors, the kiosk and settings do not, so they moved under **More**, grouped
by what they are for:

```
TODAY · ATTENDANCE · PEOPLE · MORE
                            Workforce  Contractors · Site kiosk
                            Pay        Billing · Reports
                            Tracker    Month · Year      ← the personal tracker
                            Account    Settings · Notifications
```

**Nothing was deleted to make the room.** Contractors and the site kiosk had been
two rows at the foot of the roster; they are rows under More now, and the roster
went back to being about people. The personal tracker — account-less, local, its
own pay model — keeps a door: the four destinations are the *employer's*
navigation, and the audit's first finding was that DayPay is three products in
one shell. Deleting it by tidying up the navigation would have been a product
decision, not a design one.

**Every screen has an address.** `src/lib/routes.js` is the whole of the
information architecture in one pure module, and `src/lib/router.js` is the forty
lines that read it: the hash, a subscription, and a memory of where you were on
each screen so Back returns you there. A hash rather than the History API because
the app is served as static files — a rewrite rule that has to be right on every
host forever, or a deep link that 404s, is a worse trade than a `#` in the address
bar.

The existing `view`/`pane` state is still what describes what is on screen; the
address is now its *name*, which is what made the change additive. Three things
fell out of it for free:

- **A business account no longer lands on the personal tracker.** `homeViewFor()`
  has always said an employer belongs in the workspace, but it only applied at
  sign-in — a reload dropped them on the calendar. The address applies it on load.
- **The tracker has a way back.** An employer who opens Month or Year from More
  gets the same one-word link the More sub-screens use.
- **Settings is an address.** More → Settings opens the overlay, and closing it
  returns to More rather than leaving an address pointing at a screen that is no
  longer on top.

Re-pointed rather than dropped: the roster screen is called **People** now (the
tab, the heading and the address all agree), and the checks that pinned the old
five-tab bar to `EmployerWorkspace.jsx` now assert the new guarantees — including
that Month, Year and Staff stay in the codebase, as asked, even where they are no
longer laid out.

### DayPay 2.0 — Phase 2b: the file the redesign has to happen in (1 October 2026)

`src/App.jsx` was **3,516 lines inside a single component**. Not one screen — the
whole shell, every view, the settings page (409 lines of it) and the tracker, with
no seams between them. Phase 3 decides the information architecture and phases 4–13
rebuild the screens; neither is possible inside a file where nothing can be found,
so this phase was the split, and it changed no behaviour at all.

Everything moved by **slicing the original lines**, never by retyping them —
`src/lib/format.js` (the formatters and the export helpers), `src/lib/constants.js`
(the theme and leave-type lists), `src/lib/holidays.js` (the offline holiday
fallback), `src/ui/Display.jsx` (`AnimatedAmount`, `NeutralAvatar`),
`src/ui/useExit.js`, and the roster pane — `Staff`, `RateEditor` and `AddEmployee` —
to **`src/employer/PeoplePane.jsx`**. `App.jsx` is 3,256 lines and
`EmployerWorkspace.jsx` 901 → **171**; both are now shells that compose screens
instead of containing them.

Three things were found by doing it:

- **`src/lib/employerLogic.js` carried a character-for-character copy of
  `fmtMoney`** from `src/lib/payslip.js` — two implementations of "how DayPay writes
  an amount", which is one more than a currency can have. It now delegates, so the
  format can only be changed in one place.
- **`rateOn` was used by the roster's `currentRateFor` and not imported after the
  move.** Lint caught it; the roster would have crashed on first render.
- **A failed build empties `dist/`**, so the next build reports "the Supabase config
  did not ship" instead of whatever actually failed. The config assert is still
  sound — it reads real files and cannot pass on a stale bundle — but the message
  can point at the wrong problem. If you see it twice, clear `dist/` and read the
  build again.

The two tests that pinned the roster's markup to `EmployerWorkspace.jsx` now read
both files, because as of this phase that screen genuinely is two: the tab shell and
the pane.

### DayPay 2.0 — Phase 2: the design system (1 October 2026)

DayPay already had a token layer. What it did not have was a small, named set of
things to build WITH, so every screen had assembled its own rows, its own empty
states and its own status pills out of raw tokens — the same idea spelled three
ways, which is how a product starts to look like several products.

`src/ui/` is now that set, and it is held to rules rather than taste: every value
is a token (a hard-coded hex fails the suite), every size comes from the ramp and
nothing is below 12px, every row clears the 44px tap floor, nothing communicates
by colour alone, motion stops under `prefers-reduced-motion`, and a keyboard can
see where it is (`:focus-visible` — there were no focus states at all before).

**`/specimen.html` renders all of it**, in both themes, on one page. It is built
for the preview only and is never part of `npm run build`, which still produces
exactly two entries.

Found while building it: **`.ew-row` meant two different things** — a horizontal
pair of form fields, and the roster's list row. The form rows had been silently
inheriting the list row's padding, and the list rows had been inheriting
`display: flex`, since the previous pass. One name, one meaning: the form row is
now `.ew-formrow`, and a guard test keeps the two apart.

### The Roster screen was relaid out (1 October 2026)

Seven faults were reported on it, and every one was real. What changed:

- **One tab bar, not two.** The Month / Year / Join / Staff switcher is the app
  shell's (it lives in `src/App.jsx`), and it made a second bar stacked on top of
  the roster's own — two different selected styles, one saying Staff while the tab
  said Roster. It is no longer rendered while the Staff view is open. **The
  controls themselves are untouched**; only the wrapper is conditional. The
  consequence is that the shell's switcher is no longer reachable from inside the
  Roster screen, so leaving it takes a reload — flagged, not hidden.
- **The heading is "Roster"**, matching the tab, and the two stat cards became one
  line of text ("3 on roster, 3 with rates set"). On the roster pane only — the
  other four panes still show the cards.
- **The row is a list row.** One bordered container with hairline dividers, not a
  card per person. The worker's own name is on it (it was not rendered at all),
  with "Trade, Contractor" under it, the status chip on the right, the rate on
  the second line, and one contextual action — Rates for a registered worker,
  **Send invite** in an accent outline for one with no login yet.
- **The contractor select left the row.** It sat there at `max-width: 116px`,
  clipping the rate and the status text beside it, and duplicating the contractor
  chip. It now lives in the row's overflow, with room to show a name, and the
  duplicate chip is gone.
- **Four same-weight buttons became one action and an overflow.** Reset PIN,
  Edit rates (unregistered only) and Archive; Archive last, in the danger colour,
  behind a confirmation step that names the worker. The menu opens **inline under
  its own row** — a floating menu on a phone covers the row that explains it.
- **The two footer cards are compact rows.** "Site kiosk" with its explanation
  behind an info button, and "Contractors" — one line each, instead of two more
  headings and paragraphs pushing the worker list down the screen.
- **The tab bar scrolls** rather than crushing five labels into 380px, and every
  control on the screen now clears the brief's 40px tap floor. Three of them did
  not: the overflow trigger was 44px wide but 35px tall, and the tab and the
  contractor select had no floor at all. The house token `--tap` (44px) is used
  rather than a bare number.

In the shell, two smaller fixes: the start month prints as "Sep 2026" instead of
the raw key "2026-09", and the greeting uses a real display name or none at all —
it used to fall back to the email's local part, which is how it said
"Hi, infopromptpilot" with the same email address printed underneath.

Two of the brief's rules were true by accident rather than by construction, and
both are now asserted: the screen offers **exactly one filled button** in every
state (at rest, with the add form open, with the overflow open, after cancelling)
and every control on it clears the **40px** tap floor — three did not. The
sentence-case rule is enforced against the stylesheet: `.ew-label` is the house
ALL-CAPS style that every employer screen shares, so the roster's four panels
carry a marker class and one scoped rule turns the caps off. Nothing else moves.

Every handler was re-driven in the DOM harness, and the two at the foot of the
screen had no coverage at all before this: **Add contractor** (open, type, submit
— the name reaches the data layer) and **Show 1 archived** → **Restore**. The
one-filled-button rule is now counted in **seven** states, which is how the PIN
panel turned out to leave the screen with no filled button at all when a PIN
already existed and two when it did not.

Every handler was re-driven in the DOM harness: Rates, Send invite, Reset PIN,
Edit rates, Archive (including Cancel), the contractor change, Add, Link kiosk
and Show archived.

Corner radii and drop shadows were reviewed and **deliberately left alone**: the
corners are already 9–14px on a twelve/16/20px token set, and the app already has
a shadow language (including a deliberate hard offset shadow in the brand green).
Restyling those would be a redesign, which the brief rules out.

---

## What exists

**The app** (`/`) — the original DayPay single-user tracker, unchanged in its
money behaviour: month and year calendars, effective-dated rates, weekend and
holiday at 2×, leave percentages, locked months, payslip and Yearly Share
exports, reminders, four themes, installable PWA.

**The workforce layer** — employers, contractors and employees as real tables;
a roster with invite codes; a day ledger with an audit trail; claimed →
confirmed → disputed; corrections with reasons; invoices that freeze at issue;
RLS policies for every table.

**Roles (Phase 10)** — Employer or Employee chosen at sign-up, enforced in the
database. Employees reach their own information and attendance only. The invite
code is onboarding-only.

**Attendance PIN (Phase 11)** — a per-worker 4-digit PIN, salted and hashed,
issued once and shown once, five wrong guesses lock it for five minutes.

**Site kiosk (Phase 12)** — `/kiosk.html`: a separate page with its own bundle
that records attendance for workers with no phone or no network, using eight
validations in order. The machine is a revocable device account; its roster
carries no money at all.

**One attendance database** — phone and kiosk write the same `day_records` row.
`attendance_method` records which route, **for audit only**; no calculation
reads it.

**Audit view (Phase 13)** — the employer's existing day sheet says *"At the site
kiosk"* or *"Checked in on their phone"*. No new report, no redesign.

**Deployment** — `vercel.json`, headers, and a build that needs no environment
variables because the public config is committed. `docs/DEPLOY-VERCEL.md`.

---

## The final QA pass (6 October 2026)

Not a redesign: preserve, verify, fix what is genuinely broken, prove it, report. Two
things came out of it.

**The way back (§41).** The report was right on both counts: the in-app control was a
12px line of grey text that only worked if you already knew what the previous screen
was called, and Android's system Back closed the app several levels deep. One cause,
seen from two sides — the levels a screen keeps in `useState` (a contractor opened
from the list, a worker opened from the roster, **a Settings category**) were
invisible to the browser's history, so the phone's Back had nothing to walk. The fix
is a depth stamped on every history entry so "is there anywhere behind the reader?"
is a question the app can answer, an address for the one buried level that mattered
(`/more/settings/<category>`), and one shared control — a chevron, the word **Back**,
a bordered box at the tap-target floor, `aria-label="Back to <screen>"`, an `<a href>`
where a real address exists. Whole file: `docs/NAVIGATION-BACK.md`.

**A proof that only ran on five days out of six.** `npm run prove` went red on the
correction scenario, and the ledger was right: the fixture asked about a day "missing
from their month" that was **today** on the 6th, which the check-in scenario had
already written — and the database deliberately does nothing with an approval for a
day that already exists. The chain had an opinion about the date it ran on, which is
the same class of fault `scripts/integration/fixture-days.mjs` was written to end.
The day is now chosen by `correctionDayFor(dom)`, and `tests/harness.test.js` walks
every day of the month proving it never lands on the check-in day, a rate-history day,
a day the employer writes, or the day after the rate change.

Two test files were also updated for the new control — the profile and the tracker now
render the shared `BackLink` rather than a bare `className="dp-back"` — and the
retired `.ew-back` rule was removed with its last user. No assertion was weakened.

## What is verified, and how

| Question | Answered by | Result |
|---|---|---|
| Does the schema come out right from empty? | `migrations.mjs` | 001→019 applies clean; the batch applies on top of an older project and lands in the same place |
| Does one day of work become the same money everywhere? | `e2e.mjs` | 115/115, every layer reconciles |
| Can a worker see another worker's wages or guess a PIN? | `harness.mjs` | 78/78 — including the eleven kiosk checks |
| Can someone brute-force a site code? | `lockout-probe.mjs` | five wrong codes recorded, the sixth refused, all refusals word-identical |
| Does every screen render, and do the buttons work? | ui-check | 626 checks — every screen in a real DOM, the kiosk walked button by button, the one screen that writes checked against the engine, and the profile’s money checked against it too |
| Is a given project actually installed? | `verify_installed.sql` | 17 rows, PASS/FAIL, safe on a half-installed project |
| Does the kiosk bundle contain employer code? | `tests/kiosk.test.js` | no — the import graph is asserted, and the built chunk is greppable |

---

## The final UX audit (§39)

`docs/UX-AUDIT-FINAL.md` — written 3 October 2026, at the end of the redesign. It
reads every surface as a whole and reports **six findings, ranked**: a correction
sentence that can read as nonsense and is reachable today (`medium`), two filled
green buttons on Today where the product's own rule is one (`medium`),
technical language shown to a business owner in four places (`medium`), a file
path inside a sentence (`low`), no search on Attendance (`low`), and the personal
tracker's categories sitting unlabelled inside an employer's Settings (`low`).
**No code was changed to write it** — the findings are proposals until they are
approved, and each names the smallest fix. §40, the "feels obvious" review, should
be judged on those six being closed.

---

## Typography, spacing and alignment (3 October 2026)

`docs/TYPOGRAPHY-SPACING.md` — the pass that followed §40. The brief named the
symptom: a list row that read `ContractorsWho each worker answers to`. The cause
was not a margin set too small but a pair of **inline** `<span>`s sharing one line
box, held apart by a `margin-top: 1px` that does nothing on an inline element — so
the separation had never existed and only appeared when a font's metrics happened
to leave a sliver. The same shape was in nine more containers across three files.

The pass added a type-role layer (aliases of the existing ramp: page 22px, section
13, row 15, body 13, nav 12, meta 11) and a rhythm named for what it separates
(stack 4, header 20, section 24, page 16, row 16), made every title-over-description
container a column flex on `--gap-stack`, replaced **~80 inline margins** across 16
JSX files with connector classes on the scale, and gave the workspace the page
gutter it never had — one left edge for the logo, page titles, section headings,
cards and rows. 17 new tests in `tests/design.test.js` guard the structure; six
deliberate mutations were all caught. The guards then found two real defects that
reading had missed: a class used but never defined, and one more title/description
pair still held apart by a 2px margin.

---

## What is outstanding

1. **The browser run of the eight scenarios** (`SITE-ATTENDANCE.md` §4). They
   are proven against a real database and in a real DOM; what only your browser
   can show is Supabase Auth never asking for an invite code again after
   sign-out, and how it all looks on a phone.
2. **Android's real Back gesture** (`NAVIGATION-BACK.md`). The fix is proven in a
   real DOM through the DOM's own history, and the six navigation scenarios pass —
   but it has not been pressed on a physical device. **NOT PHYSICALLY VERIFIED.**
   Three minutes, four steps, at the end of `NAVIGATION-BACK.md`.
3. **The deploy itself** — the repository is ready; the steps are in
   `docs/DEPLOY-VERCEL.md`. The two things to get right are the **Production
   Branch** (this one, not `main`) and Supabase's **Auth URL configuration**.
4. **Scenario H, flagged not fixed:** a recorded day is attributed to the
   contractor a worker is on *now*. The day rows are never rewritten and an
   issued invoice does not move, but the per-contractor rollup follows a
   reassignment. That is existing reporting behaviour; changing it is a
   reporting change, which the brief forbids without instruction. Say the word
   and it becomes a decision.
5. **Two keys look alike.** The publishable key is public and committed; the
   `service_role` key must never be shared, pasted into a host, or added to this
   repository. The build refuses to ship one if it appears in the environment.

---

## Phase history, briefly

Phases 0–9 built the employer version from the v24.3 baseline: schema, roles,
invite and join, contractors, attendance sessions and codes, corrections,
invoices and other retention, locked months, reminders, themes and polish.

The DayPay 2.0 redesign is a second programme on top of those: **1** the audit ·
**2** the design system · **2b** the split · **3** the navigation and the first
router · **4–13** one screen at a time · **14–17** states, desktop, consistency,
polish.

Phases 10–13 are the current brief: **10** roles, account access and
account-less workers · **11** the attendance PIN · **12** the site kiosk ·
**13** the audit view and the scenario record.
