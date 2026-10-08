# DayPay 2.0 — Phase 1: Audit of the existing application

**Date:** 1 October 2026 · **Brief:** DayPay 2.0 complete UX + UI redesign
**Head:** working tree, uncommitted (the sandbox reverted `HEAD` to `c5fd6f9`; the
files are correct — see `HANDOVER-TO-NEW-SESSION.md`)

**Phase 1 asks for the audit only. No code was changed.** Everything below is read
from the files, with line references, so any claim can be re-checked.

---

## 0. Verified baseline — the thing the redesign must not break

```
npm test        383 tests, 0 failures
npm run lint    0 errors, 13 pre-existing warnings
npm run build   ✓ 747 ms
npm run prove   MIGRATION CHAIN 36/36 · END-TO-END 115/115 · RLS 78/78
                lockout ✓ · EVERY SCREEN MOUNTED AND FILLED · UI CHECK 185 checks
```

That is a green, fully instrumented starting point. `npm run prove` runs the
schema, the money, the permissions *and* the screens. Any phase that turns this
red has broken something, and the harness will say which check.

---

## 1. What DayPay actually is today

Not one product with a dense screen. **Three products sharing a shell**, plus a
fourth on its own page:

| # | Surface | Account needed | Data lives in | Reached by |
|---|---|---|---|---|
| 1 | **Personal tracker** — Month, Year, Settings, reminders, backup, CSV, payslip | no | `localStorage` (`user_data`, migration 003) | default view `month` |
| 2 | **Employer workspace** — 5 panes | yes | Supabase | `view === 'staff'`, business accounts only |
| 3 | **Worker's own view** — "My work" / "Join a team" | yes | Supabase | `view === 'me'` |
| 4 | **Site kiosk** | no — not even for the worker | Supabase | separate page `/kiosk.html` |

This is the most important finding in the audit. The brief's §3 proposes
`TODAY · ATTENDANCE · PEOPLE · MORE` as day-one destinations — but the segmented
control that would be replaced by that navigation is the only door to the
**personal tracker**, which is a complete, working, account-less product with its
own pay model, its own settings, and its own reason to exist. A redesign that
replaces the switcher wholesale deletes a product from the UI.

**Resolution proposed** (for approval in Phase 3): the four destinations are the
*employer's* navigation; the personal tracker keeps its place under `MORE`, and a
worker who is also an employer keeps "My work". The alternative — removing the
tracker from the employer's navigation — is a product decision, not a design one,
and is not one the interface should make silently.

---

## 2. Screens, and what each is for

### The shell — `src/App.jsx`, 3,516 lines, one component (`App()`, lines 300–3516)

Everything for surfaces 1 and 3 lives in a single component: state, data loading,
calculations, and JSX for the month calendar, the year view, settings, modals and
toasts. **~3,200 lines in one function.** This is the largest structural obstacle
to the redesign: there are no seams to re-lay-out. Phases 4–13 will need it
split — not rewritten, *split*, with the existing logic moved intact.

### Employer workspace — `src/employer/EmployerWorkspace.jsx`, 901 lines

Five panes on `pane` state (`EmployerWorkspace.jsx:824–894`):

| Pane | Tab label | Component | Answers |
|---|---|---|---|
| `today` | Today | `Dashboard.jsx` (378) | what is happening today |
| `days` | **Mark days** | `StaffDays.jsx` (367) | who worked |
| `roster` | Roster | inline in the workspace + `DevicePanel` + `ContractorEditor` | who my workers are |
| `summary` | Summary | `Summary.jsx` (353) | what happened this period |
| `billing` | Billing | `Billing.jsx` (480) | what to reconcile |

Supporting components: `WorkerView` (475) — the per-worker detail with calendar /
history / corrections tabs; `AttendancePanel` (205); `CorrectionForm` (164) and
`CorrectionList` (92); `PinPanel` (166); `ContractorView` (179);
`PaneErrorBoundary` (87); `CheckIn` (171).

### Kiosk — `src/kiosk/Kiosk.jsx`, 462 lines, `kiosk.css`

---

## 3. Routing: **there is none**

```
grep -rn "react-router|history.pushState|useLocation|HashRouter" src/ → 0 results
```

Dependencies are `react`, `react-dom`, `@supabase/supabase-js`, `jspdf` — **no
router**. Navigation is `useState` in three places (`view`, `pane`, and each
component's internal tab). Consequences that the brief's phases depend on:

- §11 **Worker profile as "the central place"** — there is no address for a
  worker. No link, no share, no refresh-survives.
- §28 **"Return them to the same position in People"** — browser Back today
  exits the app. There is no history, so there is nothing to restore.
- §37 Phase 3 **"Do not break routing"** — nothing to break; Phase 3 *creates*
  the first navigation. That is added value, not a regression risk, but it is
  new surface area and needs its own tests.

**This is the single highest-leverage change in the whole brief.** Every other
phase gets easier with addresses: profile screens, deep links, back behaviour,
and the ability to test a screen by name.

---

## 4. The business logic — the part that is the source of truth

### 4.1 Money is computed in the database and then **frozen**

`supabase/migrations/001_employer_schema.sql`:

- `day_records_compute_money` (line ~222) resolves the rate period in force and
  sets `new.rate`, `new.multiplier`, `new.amount := round(rate * mult, 2)`.
- The rate period in force is the latest `employee_rate_periods.effective_from
  <= work_date` (line 222–223) — the same rule the client mirrors in `rateOn()`.
- Once a day is `confirmed`, a trigger **refuses any change to amount, rate,
  multiplier, work_date or employee_id** (lines 271–281):
  `'This day is confirmed and its amount is final. Reopen it before changing the money.'`

**Consequence for §12 (pay transparency):** the UI may *explain* a figure but
must never *derive* one for display. Every amount shown must be the stored
`amount`. The brief's example — "19 regular × ₦16,000 / 2 weekend × ₦32,000 /
1 overtime × ₦32,000" — must be rendered from the stored rows, grouped, not
recomputed. `rateOn()` and `multiplierFor()` in `src/lib/employerLogic.js:110,124`
exist so the UI can *preview* a day before it is saved; they mirror the server
CASE expression deliberately and are pinned by tests.

### 4.2 The pay model, exactly

`KIND_LABELS` (`employerLogic.js:96`) and `multiplierFor()` (`:124`):

| Kind | Label | Multiplier |
|---|---|---|
| `work` | Worked | ×1 |
| `weekend` | Weekend | `weekend_multiplier` (default **2**) |
| `overtime` | Overtime | `weekend_multiplier` — **deliberately the same as weekend** |
| `holiday` | Holiday | `holiday_multiplier` (default 2) |
| `leave` | Leave | `leave_percent / 100` |

The overtime = weekend rule is not a bug: the client and the server's CASE agree
(`001:238` carries the comment *"matches the client engine"*). §12's "Extra days"
wording must map onto **these five kinds**, not onto a new concept.

### 4.3 The calculation engine — `src/lib/employerLogic.js`, 1,198 lines, 60 exports

Pure functions, no I/O, all unit-tested. The ones a redesign touches:

`dayBoard` (:425) today's present/absent/unrecorded · `monthFigures` (:488) ·
`summarise` (:171) · `workerMonthTotals` (:1064) · `billingRows` (:1110) ·
`contractorRollup` (:559) · `groupByContractor` (:526) · `unmetRates` (:479) ·
`accountStatus` (:387) the Registered / Not-registered chip ·
`attendancePrompt` (:742) · `checkInError` (:887) · `correctionSentence` (:956) ·
`monthGrid` (:1003) · `buildMonthCsv` (:252).

### 4.4 Data layer — `src/lib/employer.js`, 1,251 lines

**Tables:** `employers`, `employees`, `employee_rate_periods`, `day_records`,
`day_record_events`, `correction_requests`, `contractors`, `invoices`,
`invoice_lines`, `attendance_sessions`, `attendance_devices`, `user_data`.

**RPCs:** `claim_attendance_device`, `kiosk_roster`, `kiosk_check_in`,
`open_attendance`, `close_attendance`, `my_attendance_status`,
`check_in_with_code`, `redeem_invite`, `leave_roster`, `set_attendance_pin`,
`employee_pin_status`, `resolve_correction`, `issue_invoice`, `void_invoice`.

**19 migrations**, `001`–`019`. Every failure path is written into the database
and re-quoted verbatim by the tests (`019_site_kiosk.sql`). The wording is
product copy that happens to live in SQL — the redesign will be tempted to
"improve" it and must not, because §30 forbids changing behaviour and these
strings are asserted.

### 4.5 Permissions are enforced in the database, not the UI

`is_employer_of()`, `is_employer_of_employee()`; RLS across every table; 78
permission proofs in the harness. **The UI may hide an action, but hiding is
cosmetic** — the database refuses regardless. Any redesign that moves a control
must keep it behind the same gate, not merely off-screen.

---

## 5. Navigation as it stands

```
segmented control (App.jsx:2393, hidden while view === 'staff')
  Month · Year · [My work | Join] · [Staff]
```

- Visible only when `user` exists; `Staff` only when `roles.isBusiness`.
- `homeViewFor(roles)` (`employerLogic.js:369`) chooses the landing view.
- Inside Staff: a five-tab `.ew-subtabs` bar (`overflow-x: auto`, added in the
  previous pass).
- Inside a worker: `WorkerView`'s own three tabs (calendar / history /
  corrections).
- Inside Roster: panels that open **in place** — rate editor, add form, invite,
  PIN, plus the kiosk row and the contractor row. Nine controls at one level.
- Inside Settings: six categories, reachable only from the personal tracker.

**Depth from launch to a worker's rate history today:** app → Staff → Roster →
Rates → the rate panel. Four levels, and two of them are tabs.

---

## 6. Responsive behaviour — the finding that matters most for §27

```css
/* src/index.css:179 */
.phone-frame { width: 100%; max-width: 480px; min-height: 100dvh; }

/* src/index.css:1180 — Settings is its own full-screen page, also phone-width */
.sp-page { position: fixed; top: 0; left: 0; right: 0; bottom: 0;
           width: 100%; max-width: 480px; margin: 0 auto; }

/* src/index.css:185 — the ONLY wide-screen rule in the shell */
@media (min-width: 768px) {
  .app-root { padding: 28px var(--sp-4) 40px; align-items: flex-start; }
  .phone-frame { min-height: auto; border: 1px solid var(--border);
                 border-radius: var(--radius-xl); overflow: hidden; }
}
```

All three `max-width: 480px` rules in `src/index.css` are phone widths — the
frame, the Settings page, and the crash card. **DayPay is a 480px phone frame
centred on a desktop monitor, with a decorative border.** The one wide-screen
rule in the shell resizes the border around it. In `employer.css` the largest
breakpoint anywhere is `max-width: 600px` — eight of them, all mobile-side, none
of them a desktop layout.

§27 asks for side navigation, multi-column layouts and larger tables on desktop.
None of that exists. This is Phase 15, it is real work, and it is *additive* —
the phone layout is what the 185 screen checks were built on and must keep
passing.

---

## 7. Design system — what exists, what is missing

**Exists and is good.** 79 tokens in `src/index.css`: a type ramp
(`--fs-2xs` 11 → `--fs-2xl` 26, plus `--fs-hero`/`--fs-display`), spacing
`--sp-1…`, radii, three shadows, semantic colour with light **and** dark
definitions of every ink (`--text`…`--text-4`, `--green-ink`, `--green-wash`,
`--amber`, `--danger`), `--tap: 44px`. Ten self-hosted woff2 (Manrope + Geist
Mono), ₦ as a real glyph, no CDN at runtime, sha256-pinned.

**Exists in part.** Toasts (one at a time, `dpShowToast`, employee-side only),
modals, empty states (7 components), tabs, error boundaries per pane.

**Missing, and asked for by the brief:**

| §  | Missing | Notes |
|---|---|---|
| 22 | **Skeletons** | zero in the codebase; screens show "Loading…" text or nothing |
| 34 | **Bottom sheets** | the modal is a centred card; no mobile sheet pattern |
| 29 | **Search** | none anywhere in the employer app (the kiosk has one) |
| 10 | **Filter chips** All / Active / Pending | the roster filters by `status` internally, with no control |
| 11 | **Worker profile screen** | `WorkerView` exists but has no cost, rate, or month summary header |
| 20 | **Workplace settings** | `updateEmployer()` exists in the data layer and **is called from nowhere** — an employer cannot rename their workplace |
| 24 | **Success feedback in the employer app** | toasts are employee-side; the workspace uses inline messages |
| 26 | **Focus states / a11y audit** | reduced-motion is handled; focus-visible is not systematic |

---

## 8. Conflicts between the brief's examples and the existing logic

The brief's final instruction resolves these: *preserve the business logic and
redesign the interface around it.* Recording each so the decision is visible:

| # | Brief shows | Reality | Resolution |
|---|---|---|---|
| 1 | §14 kiosk: name → site code → done | Real flow is **four** steps: contractor → name → **PIN** → site code (`Kiosk.jsx:110`) | **Keep all four.** The PIN is §8/§10 of the original brief and the ordered validations are in SQL. The UI makes them feel fast; it does not delete one. |
| 2 | §14 "Good morning 👋" on the kiosk | the kiosk is a shared site device, often used by the first worker at 6am | Keep the tone, drop the personal greeting — the device does not know who is holding it |
| 3 | §9 "Present / Absent / Not recorded" | the model has **five** kinds (`work`, `weekend`, `overtime`, `holiday`, `leave`) plus a separate record *status* | Status words stay Present/Absent/Not recorded; **kind** stays visible as the second line, because that is what the money depends on |
| 4 | §10 rename Roster → **People** | "Roster" is used in copy, tests and the kiosk's own wording | Rename the tab and heading to **People**; the word "roster" stays where it means *the list the kiosk reads* |
| 5 | §12 "19 regular × ₦16,000" style breakdown | amounts are frozen per row; multipliers are stored | Build the explanation **from the stored rows** — group by kind, sum the stored amounts. Never re-multiply. |
| 6 | §17 Add worker with Contractor + Daily rate fields | `createEmployee` + `addRatePeriod` are two writes; contractor is a third | One form, **one save**, sequential writes — but the worker record must survive if a later write fails, because §15 forbids losing a worker record |
| 7 | §3 "Do not break routing" | no router exists | Phase 3 adds one, additively, with the existing `view`/`pane` state as the source of truth behind it |

---

## 9. What must not change — the guard rails for every phase

1. **Amounts are frozen and server-computed.** No UI-side money arithmetic for display.
2. **The five kinds and their multipliers**, including overtime = weekend. Pinned by tests on both sides.
3. **RLS and `is_employer_of()`.** Hiding a control is cosmetic; the gate is the database.
4. **The verbatim refusal strings**, all in `supabase/migrations/019_site_kiosk.sql`, asserted by tests — re-grepped, not quoted from memory:

   | String | Line |
   |---|---|
   | `Code not correct, visit the site.` | 325 |
   | `That PIN is not correct.` | 629 |
   | `Too many wrong PINs. Try again in a few minutes.` | 617 |
   | `Too many wrong codes. Try again in a few minutes.` | 305 |
   | `Too many wrong codes. Check the code with your contractor, then try again in a few minutes.` | — |
   | `That site code is not valid now. Ask for today's code.` | 685 |
   | `You are not listed under that contractor. Check with your supervisor.` | 605 |

   Note the two variants of the too-many-codes refusal. **The settled product
   wording is the short one**; a redesign must not "tidy" the longer one into it
   or out of it without a decision, because both are live paths.
5. **The invite code is an onboarding credential only**; a worker record exists without an account (§15).
6. **`attendance_method` is audit-only** and never changes pay.
7. **Cross-route duplicate protection** — kiosk and phone write the same `day_records`.
8. **Employer-only contractor assignment.**
9. **No GPS, geolocation, geofencing, maps or background tracking. Ever.**
10. **Existing data.** No invented workers, attendance or earnings in the production path.
11. **The personal tracker keeps working** — account-less, local, with its own settings.
12. **Preserve the visual identity** — Manrope + Geist Mono, the ₦ glyph, the hard-offset brand shadow, the 9–14px radii. The previous pass measured and *declined* a re-skin: this brief is an architecture and layout change, not a new face.

---

## 10. Proposed information architecture (for approval in Phase 3)

Mapping the brief's four destinations onto what exists, with nothing deleted:

```
TODAY      ← Dashboard.jsx, rebuilt as the command centre (§8)
             the only screen that answers "what needs me right now"

ATTENDANCE ← StaffDays.jsx, renamed from "Mark days" (§9)
             Today · Week · Month; fast marking, status obvious

PEOPLE     ← Roster pane + ViewerView, renamed (§10, §11)
             search, filter, clean rows, profile as a real screen

MORE       ← everything secondary, grouped
             WORKFORCE   Contractors (ContractorEditor) · Site kiosk (DevicePanel)
             PAY         Billing (Billing.jsx) · Reports (Summary.jsx)
             TRACKER     Month · Year  ← the personal tracker, kept alive
             ACCOUNT     Settings · Notifications (reminders)
```

Three things this mapping deliberately does **not** do: it does not delete the
personal tracker, it does not merge Attendance and Summary (the brief separates
work records from money in §18, and `billingRows` already does), and it does not
put Contractors or the Kiosk in the primary bar — both become rows under MORE,
which is where the previous pass had already moved them.

---

## 11. Risks, ranked

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| 1 | **`App.jsx` — 3,200 lines in one function** | cannot be re-laid-out safely by editing in place | split first, move code intact, keep 383 tests green |
| 2 | **No router** | profile screens and §28 back-behaviour need addresses | add one in Phase 3 as the only new dependency-sized change |
| 3 | **185 screen checks describe today's DOM** | a redesign breaks them by definition | they are the *spec*, not the obstacle: re-point them per phase, never delete a guarantee |
| 4 | **The brief's mockups imply logic that does not exist** (kiosk 2-step, one-write Add worker) | implementing them literally would change behaviour | §8 above; interface adapts, engine does not |
| 5 | **Personal tracker in the same shell** | deleting it from the nav is a product loss | keep it under MORE; flag if the user wants it gone |
| 6 | **Desktop has no layout at all** | §27 is a build, not a tweak | Phase 15, additive, phone layout stays the tested baseline |
| 7 | **Money on screen** | a wrong figure destroys trust faster than a wrong colour | every displayed amount comes from a stored row; tests assert it |

---

## 12. Phase 1 verdict

The engine is sound, tested and complete: **the redesign has a solid floor.** The
interface problems the brief describes are real and measurable — a 480px frame on
desktop, no search, no addresses, no desktop layout, cards where rows belong,
nine controls on the People pane, and three products sharing one switcher.

The work is therefore **architectural**, exactly as the brief says. The plan
below keeps every guarantee the current harness enforces and changes the shape
around it.

**Proposed order** (the brief's, with two insertions):

| Phase | Content | Insertion |
|---|---|---|
| 1 | ✅ this audit | — |
| 2 | Design system: tokens exist; add sheets, skeletons, toasts, focus states | — |
| **2b** | **Split `App.jsx` into screens** — no visual change, tests stay green | **new** |
| 3 | Navigation: four destinations + MORE, and **the first router** | router added |
| 4–13 | Today · Attendance · People · Profile · Add worker · Contractors · Kiosk · Summary · Billing/Reports · Settings | — |
| 14–17 | States · desktop · consistency · polish | — |

Phase 2b is the one addition. Without it every later phase edits a 3,200-line
function, which is how regressions in a working app actually happen.

**Delivered so far, against this table** (the plan above is kept as the plan; the
living status is `docs/PROGRESS.md`): 1 · 2 · 2b · 3 · 4–13 · **14 states** (2
October 2026) · **15 desktop** (2 October 2026) · **16 consistency** (2 October
2026) · **17 polish** (2 October 2026) · **§39 the final UX audit** (3 October 2026,
`docs/UX-AUDIT-FINAL.md` — six ranked findings; no code changed to write it) · **the
six findings closed** and **§40 "feels obvious"** (3 October 2026,
`docs/UX-REVIEW-OBVIOUS.md`). Every slot in the brief is now delivered or answered; what
remains is not design work — the browser run on a real phone, the deploy, and the
personal-tracker question for the owner.

**And the "Missing, asked for by the brief" table in §7, row by row, as of
Phase 17** — four of the eight were built in the phases named, and the other four
were delivered in earlier phases without a row of their own; all eight are now
named in a check, so this is a status backed by evidence rather than memory:

| § | Missing then | Now |
|---|---|---|
| 22 | Skeletons | **Delivered** (Phase 14) — `Skeleton` in `src/ui/Ui.jsx`; the three screens that hand-rolled one use it |
| 34 | Bottom sheets | **Delivered** — the modal is a sheet from the bottom of a phone and a centred dialog from 600px |
| 29 | Search | **Delivered** (Phase 6) — People searches name, trade and contractor, forgiving of case and spacing |
| 10 | Filter chips All / Active / Pending | **Delivered** (Phase 6) — All / Registered / Not registered, named after the fact that varies |
| 11 | Worker profile screen | **Delivered** (Phase 7) — with the month's total, the days and the paid-day equivalents |
| 20 | Workplace settings | **Delivered** (Phase 17) — `updateBusinessName` is called by a real screen; the name reaches the worker's header, the leave prompt and the kiosk |
| 24 | Success feedback in the employer app | **Delivered by a different pattern** (Phase 9/14) — inline messages and `role="status"` live regions rather than toasts, which is deliberate: the workspace's confirmations stay on screen instead of leaving after four seconds |
| 26 | Focus states / a11y audit | **Delivered** (Phase 9) — `:focus-visible` across the sheets, reduced-motion honoured; Phase 17 added the tap-target scan (every control 44px, or a documented reason) |
