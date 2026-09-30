# DayPay — what the app is, and what each feature does

*Written for the employer who owns it, not for a developer. Everything below
describes the app as it stands on this branch.*

---

## 1. What DayPay is for

DayPay is a **day-rate work record**. Not a payroll system, not an HR system —
a system that answers one question precisely:

> *What is this day worth, and can we prove it?*

A day is worth `rate × multiplier`:

| Day | Multiplier |
|---|---|
| Work | 1× |
| Weekend | 2× |
| Overtime | 2× |
| Holiday | 2× |
| Leave | a percentage you set (100% = paid) |

Two rules govern every figure in the app, and both exist because the opposite
is what loses money:

1. **A rate change never rewrites history.** Rates are effective-dated, so a
   day keeps the rate it was worked at. Nothing recomputes an old day from
   today's rate.
2. **Confirming a day freezes its money.** After that the database itself
   refuses to change the amount. Changing a confirmed day is a deliberate act
   with a recorded reason, not an accident.

The **Employer Version** turns this from a personal tracker into three-sided
bookkeeping: **Employer → Contractor → Worker**, where everyone sees the same
numbers from their own side.

---

## 2. The three front doors

| Door | Who uses it | What it is for |
|---|---|---|
| **The app** (`/`) — *Month · Year · My work · Staff* | one person, whatever their role | everything, filtered by what you are allowed to see |
| **Staff** (inside the app) | the employer | running the workforce: sites, days, people, money out |
| **Site Attendance** (`/kiosk.html`) | a worker at the gate | verifying who they are and recording the day. Nothing else — no dashboard, no money, no settings |

The first two are one application with role-based access. The third is a
separate page with its own bundle, because a machine standing in a yard should
not be able to reach the employer's business at all — and structurally cannot.

---

## 3. Key concepts (the vocabulary)

| Term | Meaning |
|---|---|
| **Site code** | four digits the employer reads out each morning. Open on **Today**, dead at the end of the employer's local day. It is *temporary* — yesterday's is worthless. |
| **Attendance PIN** | four digits issued to a worker, used only at the kiosk. Separate from their login password, shown once when issued, resettable. Five wrong guesses lock it for five minutes. |
| **Invite code** | an onboarding credential. A worker gives it **once, at registration**, to attach their account to your workforce. It is never asked for again — not daily, not on a new device. |
| **Not Registered** | a worker on your roster who has no DayPay account. They are **fully employed** and can record attendance at the kiosk; they simply have no app of their own. |
| **Contractor** | the crew a worker belongs to. Only you assign, change or remove it. |
| **Claimed / Confirmed / Disputed** | the life of a day. A check-in arrives *claimed*; you confirm it (money freezes) or dispute it. |
| **Locked month** | a closed accounting period. Read-only, so a past month cannot drift after it has been paid. |

---

## 4. The employer's workspace, pane by pane

**Today** — the morning screen.
*Function:* opens and closes attendance; shows today's site code **large** so it
can be read out across a noisy site; live counts of who has been recorded, who
is claimed, who is missing. Closing the session kills the code for good
(reopening mints a new one).

**Mark days** — the all-staff grid.
*Function:* one month, one row per worker, every day clickable. Mark work /
weekend / overtime / holiday / leave, set a leave percentage, confirm, dispute
or remove a day. This is where the employer records days for workers who have
no phone, and where a disputed claim is answered.

**Roster** — the workforce.
*Function:* add a worker (name, trade, contractor, optionally a PIN in the same
step), change their contractor, archive or restore them, issue or reset an
**attendance PIN**, hand a new worker an **invite code**, see who is
**Registered** and who is **Not Registered**, and manage **site kiosks**
(create a machine, read out its one-time link code, sign it out).

**Summary** — what you owe.
*Function:* the month, per worker and per contractor: days, paid-day
equivalents, and money. Every figure is the *stored* amount on the day — it
never recalculates from a rate, which is the only way a mid-month rate change
can be trusted. Confirming days happens here too, explicitly, because it
freezes money.

**Billing** — what you can bill for, and what you have billed.
*Function:* one row per contractor for a period, then the invoices already
issued — each frozen at the moment of issue, voidable (which keeps the document
and its number rather than erasing it), reissuable, and downloadable as a PDF.
No amount is ever sent from the screen; the database does the arithmetic from
the stored days.

---

## 5. The worker's own side

**Join** — a worker registers, chooses Employee, and enters your invite code
once. That is the only time it is ever needed.

**My work** — their month calendar, their year, their rates, their ledger, and
their own check-in:
- **Check in** — enter today's site code. One check-in per day; a second is
  answered with *"Already Checked In — you are already recorded as working
  today"* rather than an error.
- **Corrections** — ask for a missing day, a reclassification, or a correction,
  with a note; see the answer and its reason. Every change is written to an
  audit trail with who, what, when and why.
- **My rates** — the rate history they are paid on, in force-dated order.
- **Personal notebook** — days recorded before they joined a workplace stay
  visible, so joining never looks like data loss.

---

## 6. What this update added, feature by feature

This is the work of Phases 10–13. Each line is a feature and what it does.

### Roles and account access (Phase 10)
- **Choose Employer or Employee at sign-up.** An employer gets administrative
  control of the organisation; an employee gets their own information and
  attendance.
- **Enforced at the database, not hidden in the interface.** An employee cannot
  read another worker's records, see the company books, or reach a management
  function even with the console open.
- **One app, filtered by role.** No second codebase to drift out of sync.
- **The invite code is onboarding only.** After it is used the worker signs in
  normally forever; the daily route does not even have a parameter it could be
  passed in.

### Employees without accounts (Phase 10)
- **Add a worker who has no DayPay account.** No smartphone, no email, no
  registration — they still exist on the roster, can be assigned a contractor,
  and can have attendance recorded for them.
- **Registered / Not Registered is visible to the employer** and never means
  "not employed".

### Attendance PIN (Phase 11)
- **A personal four-digit PIN per worker**, salted and hashed in the database —
  never stored in the clear, never shown again after issue, and resettable by
  the employer.
- **Five wrong guesses lock that PIN for five minutes**, counted per worker, so
  nobody can lock out the crew.
- **The PIN is a signature, not a password.** It proves the person at the
  machine is the person they picked from the list.

### Site kiosk (Phase 12)
- **`/kiosk.html` — DayPay Site Attendance**, a machine at the worksite needing
  no worker login: pick contractor → pick your name → PIN → today's site code →
  checked in.
- **A device account, not a shared secret.** The employer creates the machine
  and reads out a code that works **once**; the machine is linked to one
  employer and can be **signed out** in one tap, immediately.
- **Eight validations, in order:** the worker exists, is active, belongs to
  *this* employer, is assigned to the chosen contractor, the PIN is right, the
  code is live, attendance is open, and they are not already recorded. Only
  then is a day written.
- **Refusals are answers, not crashes** — one plain sentence each, naming
  nobody and no rate: *"That PIN is not correct."*, *"That site code is not
  valid now. Ask for today's code."*, *"Already Checked In."*
- **The machine cannot see money.** The roster it loads has no rate, no amount
  and no pay anywhere — by shape, not by promise. It also cannot open the
  employer's dashboard, because the employer screens are not in its bundle.
- **The employer's control panel** — in Roster: create a kiosk, read out its
  code, see when it last recorded somebody, sign it out. Signing a machine out
  never removes the days it recorded.

### One attendance database (Phase 12)
- **The phone and the kiosk write the same row.** A kiosk day is paid exactly
  like a phone day — same kind, same multiplier, same rate rule — and a worker
  who has no phone gets a full record, not a lesser one.
- **`attendance_method` is audit only.** It records *mobile*, *kiosk*, or
  nothing (an employer-marked day). No calculation reads it; the payroll
  trigger has never heard of it.
- **Cross-route duplicate protection.** One check-in per day across both
  routes, whichever comes second is told *"Already Checked In"*, and the row
  keeps whichever route wrote it first.

### The audit view (Phase 13)
- **The employer can see how a day arrived** — *"At the site kiosk"*,
  *"Checked in on their phone"*, *"Marked by you"* — where the day sheet
  already showed its origin. No new report, no redesign, no second query.
- **Days from before this update keep their old wording.** Nothing invents a
  method that was never recorded.

---

## 7. The rules that protect the money

These are worth knowing because they are what makes the numbers defensible:

- **A worker cannot write their own attendance.** They can check in; they
  cannot amend, reclassify or delete a day.
- **A wrong site code tells nobody anything.** It is refused with the same
  sentence whether it never existed or belonged to yesterday, so the code
  cannot be used to ask "was that number real?".
- **A wrong PIN is not a way to learn about other people.** The worker and
  contractor are checked *before* the PIN, so the kiosk cannot be used as a PIN
  oracle against somebody else's workforce.
- **The attempt counters are per person, per session.** One person guessing
  cannot lock out the queue.
- **Every change is traceable** — created, amended, confirmed, disputed,
  corrected, with who and why.

---

## 8. Everything else that ships with it

| Feature | What it does |
|---|---|
| **Rate history** | effective-dated rates, weekends/holidays multipliers, leave percentages |
| **Monthly payslip** | the month in full: days, equivalents (actual vs paid), money |
| **Yearly Share** | the year aggregated from the records and reconciled with the months — never a month × 12 |
| **Corrections workflow** | ask, answer, reason, audit — for both sides |
| **Locked months** | a closed month is read-only and cannot drift |
| **Reminders** | in-app and web notifications while open, plus an `.ics` alarm you can import so the phone itself rings |
| **CSV export** | the month's ledger out of the app |
| **PDF** | payslips and contractor invoices |
| **Themes** | light, dark and two glass variants; dark-mode identity preserved |
| **PWA** | installable, with an offline shell |
| **Responsive** | phone, tablet and desktop; the kiosk is aimed at a large screen with large targets |

---

## 9. How it is verified

Every phase is proven, not asserted:

| Check | What it proves |
|---|---|
| `npm test` — 301 tests | the maths, the wording, the access rules |
| `npm run prove` — chain 34/34, e2e 115/115, harness 78/78, lockout | real Postgres: schema, permissions, the eight kiosk validations, §23 scenarios A–H, and that every layer reports the same money |
| ui-check — 141 checks | the screens actually render, including the kiosk walked button by button |
| `build:site` | the kiosk builds to its own ~12 kB bundle with no employer code in it |
