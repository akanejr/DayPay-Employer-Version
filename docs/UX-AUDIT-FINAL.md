# DayPay 2.0 — the final UX audit (§39)

*Written 3 October 2026, at the end of the redesign. The brief's §39 asks for a
review rather than a build: read the product as a whole, as a designer would, and
say plainly what it now is, what it answers, and what is still wrong. Nothing in
the product was changed to write this. Every finding below is a proposal until it
is approved, and each one names the smallest fix I would make.*

**Living status of the programme is `docs/PROGRESS.md`; the searchable design
contract of every screen is in `scripts/ui-check/` (576 checks across 15 suites)
and `tests/design.test.js`.**

---

## 1. How this audit was made

| What was read | How |
|---|---|
| Every employer surface | `Dashboard`, `StaffDays`, `PeoplePane`, `WorkerView`, `MorePane`, the six destinations under More and the settings categories — **rendered in a real DOM** and read as text, so the words quoted here are the words on screen, not the words in the source |
| Every worker surface | the worker's own screen (`EmployeeView`), the personal tracker (month and year), the site kiosk |
| Every state | `scripts/ui-check/states.jsx` — waiting, empty, failed, and recovered, per screen |
| Every journey | the fifteen check suites, walked as paths rather than as components: 576 checks, all green |
| The engine | `npm run prove` on the day of writing: **migration 36/36 · e2e 115/115 · RLS 78/78 · lockout PASS · screens 576/576**, plus **493 unit tests** |
| The reference | `docs/AUDIT-DAYPAY-2.0.md` — the Phase 1 audit, read last, so the comparison is against what the product *was* rather than against the plan |

**A limit, stated plainly.** The brief's §33 enumerates ten journeys, and the
verbatim list is not available in this workspace. So §3 below walks the ten
end-to-end paths the delivered product actually supports, each named by the
question it answers and each with the suite that holds it. If the brief's list
differs, the difference is a thing to check, not a thing to assume away.

---

## 2. The verdict, in one paragraph

**The product answers its questions, in the order a person asks them, and it no
longer lies about what it is doing.** Phase 1 recorded a five-tab workspace where
"what have I invoiced" competed with "who is working today"; the commands are now
four destinations and twelve named screens, each with one question, one filled
action, and an address. The dangerous states are gone: a screen that could not read
the database no longer draws the same picture as a screen that read it and found
nothing, the worker's own screen no longer calls a recorded day "not registered",
and an employer can finally name their workplace instead of their workers being
told "My team". What remains is a short list of **copy and consistency defects**,
not structural ones — the largest is a nonsense sentence that is reachable in
production, and the most embarrassing is technical language shown to a business
owner. None of them needs a redesign, and none of them is a reason to doubt the
engine.

---

## 2b. Status of the findings — closed the same day

Nothing on the six findings needed an engine change, a migration, a new address or a
redesign, so all six were fixed rather than filed, each with a check that fails if it
comes back. The findings above are kept exactly as they were found; this table is what
happened to them.

| # | Finding | What changed | Held by |
|---|---|---|---|
| 1 | A correction sentence that can read as nonsense | `correctionSentence()` collapses when the day's kind and the asked-for kind are the same — the form keeps every option, because asking for the kind a day already has is how somebody says "yes, that is right, but it was never confirmed" | 5 unit tests (`tests/employer.test.js`, *the correction sentence never doubles back on itself*) |
| 2 | Two filled green buttons on Today | The attendance panel's button is the outlined green (`ew-btn-accent`); the "one filled action" helper in `today.jsx` lost the subtraction that had been excusing it | `today.jsx`, 2 checks — *"the screen offers no action of its own"*, *"exactly one way to fix it"* |
| 3 | Technical language on four screens | A shared `TechDetail` disclosure (`src/ui/Ui.jsx`, one pattern, shut by default, a full-size tap target) and plain sentences in the product's voice; `PeoplePane`'s hand-rolled disclosure was folded into the same component | 5 design tests — *a file path is only ever shown inside the technical detail* — plus 5 screen checks on the switched-off states |
| 4 | A file path inside a sentence | "Enter this on the site machine when it asks…", with the address behind the disclosure | `kiosk.jsx`, 2 checks (the second asserts the address is still reachable, one tap away) |
| 5 | No search on Attendance | The roster's own `filterPeople()` over the day's list, drawn only once the roster is longer than six — and it filters what is *drawn*, never a figure | `attendance.jsx`, 8 checks (including *"searching wrote nothing"* and the short-roster case where the field must NOT appear) |
| 6 | The tracker's categories unlabelled in Settings | One section label — **Your own tracker** — above Earnings, Reminders and Your data | `more.jsx`, 2 checks (including where it sits) |

Six deliberate regressions were run against those checks — the filled button restored,
the sentence doubled back, a path put back into a sentence, the search removed, the
search made to stop filtering, the label deleted — and **all six were caught**.

---

## 3. The ten journeys

Each journey below is a complete path with a beginning and an end. "Held by" is
the suite that fails if it breaks.

| # | The journey | Where it starts → ends | Held by |
|---|---|---|---|
| 1 | **"Who is working today?"** | Open the app → Today: who is in, who is not recorded, what is waiting on the employer | `today.jsx` (60) |
| 2 | **"I need to record a day for somebody."** | Today → Attendance → the day is written once, and only once | `attendance.jsx` (42) |
| 3 | **"My worker will record it themselves."** | Today → the day's code → the worker's phone records the day against the same ledger | `attendance.jsx`, `e2e.mjs` (115) |
| 4 | **"They have no smartphone."** | More → Site kiosk → a worker with no account records a full day at the gate | `kiosk.jsx` (79), `e2e.mjs` |
| 5 | **"Who are these people, and what do they earn?"** | People → a row → the worker's profile: rate, month, days, paid-day equivalents | `people.jsx` (52), `profile.jsx` (54) |
| 6 | **"Something about a day is wrong."** | The worker asks → the employer answers → the ledger changes, and the change is auditable | `e2e.mjs` step 4b, `states.jsx` |
| 7 | **"Add somebody new."** | People → Add → a roster record with a one-time PIN — with or without an account | `interact.jsx`, `polish.jsx` (21) |
| 8 | **"Group the workers under the contractor that supplies them."** | More → Contractors → assignment, rename, archive | `more.jsx` (54) |
| 9 | **"What do I owe, and what do I send?"** | More → Billing: the period, the figure, the invoice as a document | `more.jsx`, `e2e.mjs` (invoice = the ledger written down) |
| 10 | **"What happened this month?"** | More → Reports, and the worker's own month: the total first, the raw days as a file | `more.jsx`, `profile.jsx` |

**Every one of the ten ends on a screen that can say what it is doing** — waiting,
empty, failed or answered. That is the Phase 14 property and it is the one I would
defend hardest, because it is invisible when it works.

---

## 4. What holds — the part of the audit that matters most

- **The engine is untouched and still the source of truth.** Amounts are computed
  in the database and frozen; the screens read them. 36 migration checks, 115
  end-to-end checks and 78 permission checks agree with the screens on the same
  money, on the same day.
- **One voice.** No screen shouts; the app's own words are sentence case
  everywhere, the four status states are one shape, and the three calendars read
  one shared list of weekdays.
- **One question per screen, one filled action where it was asserted** — the
  roster, the contractor screen and the add-a-worker step each carry exactly one.
  (Today is the exception, and it is Finding 2.)
- **Every control answers to a thumb** — 44px, or a documented reason, checked by
  scanning the stylesheets rather than by listing classes.
- **Nothing is unreachable, and nothing is trapped.** Every screen has an address;
  the back button and a reload agree with what is on screen; a search survives
  opening a worker and coming back.
- **No dead ends.** Every failure offers the way back; every empty state says what
  will appear there and, where there is one action, offers it.

---

## 5. Findings, ranked

### Finding 1 — a sentence that can read as nonsense, and can happen today · **medium**

**What the product says.** On Today, a worker's request is summarised by
`correctionSentence()` (`src/lib/employerLogic.js:1041`): `Says this was ${wants},
not ${had}.`

**Why it is wrong.** The worker's own form offers all five kinds, including the one
the day already has (`src/employer/CorrectionForm.jsx:23,117`). If a worker asks
for the kind the day already is, the employer reads **"Says this was overtime, not
overtime."** I met this on screen during this audit, in the delivered build — it is
not hypothetical, it is what the fixture happens to produce and what a worker can
produce by choosing the currently-selected option.

**The smallest fix.** Two lines, both in the interface layer, no engine change:
either make the sentence collapse when the two are the same (`Says this was
overtime.`) or drop the current kind out of the worker's select. I would do the
first — it fixes the reading wherever it is rendered, including the correction
list, and it cannot hide a legitimate request.

### Finding 2 — Today can show two filled green buttons · **medium**

**What the product says.** "Record today's work" (`Dashboard.jsx:264`,
`.ew-btn-primary`) and, in the attendance panel beside it, "Open attendance" /
"Open again with a new code" (`AttendancePanel.jsx:200`, also `.ew-btn-primary`).

**Why it is wrong.** The product's own rule — asserted on People and on Contractors
— is one filled action per screen, and the brief's §32 asks which single thing the
reader should do next. On the morning of a day when nobody has recorded and no code
is open, both buttons are filled green and equal in weight, which is exactly the
"what am I supposed to press?" the redesign set out to remove.

**The smallest fix.** Render the panel's button as `ew-btn-accent` (outlined green,
already used elsewhere for a second-rank action) so Today keeps one filled button,
and extend the existing "exactly one filled action" check to Today so this cannot
come back. No logic changes: the same button, the same handler, one class.

### Finding 3 — technical language shown to a business owner · **medium**

**What the product says** — four places, all on screens an employer reaches:

| Where | The words |
|---|---|
| More → the contractors notice | "Ask for migration 016." |
| Contractors, when the tables are missing | "run `supabase/migrations/007_contractors.sql` in the Supabase SQL Editor, then refresh this page." |
| Billing, when invoices are missing | "Run supabase/migrations/013_invoices.sql in the SQL editor." |
| Site kiosk, when the tables are missing | "Not available on this database yet" |

**Why it is wrong.** These are the sentences an employer reads when something is
not switched on, and they name a file path and a vendor's console. DayPay's own
voice everywhere else is plain ("Could not load your machines", "Check your
connection, then try again."). The person reading this is a business owner in
Port Harcourt, not the person who runs the SQL.

**The smallest fix.** One sentence in the product's voice — *"Contractors are not
switched on for this account yet. Everything else on the roster still works. Ask
whoever set up DayPay to switch it on."* — with the exact migration kept behind the
"Technical detail" disclosure that `PeoplePane` already uses for database errors.
The information is not lost; it stops being the headline.

### Finding 4 — a file path in a sentence · **low**

**What the product says.** Site kiosk → "Enter this on the kiosk at `/kiosk.html`,
after signing in there once."

**Why it is wrong.** Everywhere else the kiosk is called *the site machine* or *the
site kiosk*. A path is a thing you type into a browser, and it is the only place in
the product where the reader is shown one.

**The smallest fix.** "Enter this on the site machine when it asks, after signing in
there once." (and the address stays available in the deploy documentation, where it
belongs).

### Finding 5 — Attendance cannot be searched · **low**

**What the product says.** Attendance lists the day's roster with no search and no
filter; People has both (`type="search"`, All / Registered / Not registered).

**Why it is wrong.** §29 asks for fast, forgiving search, and this is the screen an
employer opens every morning. With the three-worker fixture it is invisible; with
sixty rows it is the difference between two taps and a scroll.

**The smallest fix.** The roster already owns the answer — the same `filterPeople()`
the People screen uses, over the same fields, under the day's list. I would add it
as its own small step rather than as part of an audit, because it is the one finding
here that adds a control (§32), and the case for it should be made with the real
roster size in front of us.

### Finding 6 — Settings carries the personal tracker's categories without saying so · **low**

**What the product says.** Settings lists: Workplace · Appearance · Earnings ·
Reminders · Your data · About DayPay. More's own groups name the personal half
clearly — "Your own tracker", "Your own days, kept on this device" — but inside
Settings, "Earnings" means *the employer's own day rate and goal*
("Daily rate", "Monthly goal", "Leave types") and "Notifications" is
"Reminders to record your days".

**Why it is wrong.** An employer who wants to change something about their
*workforce* opens Settings and is shown their own pay. The distinction is real and
deliberate — the tracker is a second, account-less product that rides along — but
it is not stated on the screen where the confusion happens.

**The smallest fix.** A section label inside Settings, the one the More pane already
uses: the employer's own category first, then **"Your own tracker"** above
Earnings / Reminders. One string, no re-ordering, no new screen.

### Finding 7 — not defects: two things deliberately left alone

Recorded so that a later reader does not "tidy" them:

- **The payslip and yearly-share PDFs print in capitals** (`FINAL SALARY`,
  `WORKPLACE · FINAL`, `LOCKED · FINAL`). A printed document has a convention of
  its own, and the money band is a document's convention, not a screen's voice.
  Phase 16 removed the second voice from the screens and left these two files.
- **`Code not correct, visit the site.` and its longer variant for a named
  contractor** are both live, both asserted, and both were agreed with the owner.
  They are not a copy defect to be tidied into one sentence.

---

## 6. What I would do next, and in what order

1. **Finding 1** (the nonsense sentence) — because it is the only one that can
   embarrass the product in front of a worker today, and it is two lines.
2. **Finding 3** (technical language) — because it is the first thing an employer
   reads when something is not switched on, and it is the product's voice at its
   weakest.
3. **Finding 2** (two filled buttons) — one class and one check.
4. **Findings 4 and 6** — one string each.
5. **Finding 5** (Attendance search) — as its own small phase, with a real roster
   size to judge it against.

None of the six requires an engine change, a migration, a new address, or a
redesign, and every one is inside the redesign's own rules rather than beside them.

---

## 7. Still outstanding, unchanged by this audit

1. **The browser run of the eight scenarios** (`SITE-ATTENDANCE.md` §4) — proven
   against a real database and in a real DOM; what only a browser can show is
   Supabase Auth not asking for an invite code twice, and how it all looks on a
   phone.
2. **The deploy** — ready; the two decisions are the Production Branch and
   Supabase's Auth URL configuration (`docs/DEPLOY-VERCEL.md`).
3. **Scenario H** — a recorded day is attributed to the contractor a worker is on
   *now*. Existing reporting behaviour, flagged not fixed, awaiting a decision.
4. **The longer refusal variant** — see Finding 7.

---

## 8. Signed off against the brief

| The brief asked | Where it stands |
|---|---|
| Reconsider IA, navigation, journeys, hierarchy, screen composition | Four destinations, twelve named screens, every one with an address — §2, §3 |
| Not cosmetic | The engine, the ledger and the permissions are untouched; the change is what the employer sees and in what order |
| Preserve the database, auth, attendance, pay, rates, contractors, payroll, security, kiosk, check-in, reminders | `npm run prove`: 36/36 · 115/115 · 78/78 · lockout PASS |
| SEE → UNDERSTAND → ACT; one primary question per screen | §3's ten journeys, each ending on an answer |
| Mobile-first, one-handed, outdoor, unstable internet | 44px targets, 11px floor, offline wording, states that admit failure |
| Desktop and tablet (§27) | A rail, real columns and a measure from 1024px — verified as a CSS contract plus structure, and by the preview at your own window width |
| §30 data safety | Nothing invented; history changes only on an explicit action; mock data cannot reach the production path |
| §39 the final UX audit | this document |
| §40 "feels obvious" | next, and it should be judged on Findings 1–6 being closed |
