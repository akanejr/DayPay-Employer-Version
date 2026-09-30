# Site attendance — the kiosk, and how to prove the eight scenarios

This is the runbook for the feature added in migration 019: a machine at the
worksite that records attendance for workers who have no smartphone, or no
network today. Nothing here replaces the phone route — both write the same
`day_records` row, and `attendance_method` records which one it was **for
audit only**. No calculation reads it.

---

## 1. What has to be installed

| Migration | Why |
|---|---|
| `018_attendance_pin.sql` | the worker's personal 4-digit PIN |
| `019_site_kiosk.sql` | the device, and the three kiosk functions |

019 refuses to run without 018. Both are safe to re-run.

---

## 2. Setting the kiosk up (once per machine)

1. **Create a separate Supabase account for the machine.**
   Dashboard → Authentication → *Add user*, with **Auto Confirm** on.
   Do **not** use an employer login for a kiosk: a machine in a yard must never
   hold dashboard credentials. Any e-mail will do — it is never used again.

2. **In DayPay, open Roster → *Site attendance kiosk* → *Link a site kiosk*.**
   A code like `K7QM24RD` appears. It works **once**.

3. **On the machine, open `/kiosk.html`** (same site as the app, different
   page). Sign in with the account from step 1. Paste the code. The site name
   and the crew appear.

4. **Give each worker a PIN** from the roster (the **PIN** button on their
   row). It is shown exactly once. A worker with no PIN is told so the moment
   their name is tapped, rather than after typing four digits of nothing.

**To stop a machine:** Roster → the device → **Sign out**. It stops recording
immediately, on its next call. Everything it already recorded stays.

---

## 3. Daily use

| Where | What happens |
|---|---|
| **Kiosk** | contractor → name → PIN → today's site code → *"Thank you, …"* |
| **Phone** | the worker signs in and types today's site code, as before |

The employer reads today's 4-digit code from the **Today** pane, as before.
The kiosk needs no DayPay account and no smartphone; the phone route needs no
invite code. The invite code is used **once, at registration**, and never again
— the daily check-in function takes one argument and could not accept it.

---

## 4. The eight scenarios (§23), and what each one should do

Run these in the browser on a preview build with 018 and 019 installed. Each
row names what to do and what must happen. All eight are also asserted
automatically by `npm run prove` (`scripts/integration/e2e.mjs`, step 10) and,
for the on-screen half, by the UI check (`scripts/ui-check/kiosk.jsx`).

| # | Do this | Expect |
|---|---|---|
| **A** | Register a new account with a worker's invite code, sign out, sign back in, then check in with today's site code | Registration accepts the code once; signing back in **never** asks for it; the check-in is recorded |
| **B** | Create a worker who has no DayPay account. Give them a PIN. Record a day at the kiosk | The day is recorded exactly like a phone check-in, and appears on the employer's calendar as *claimed* |
| **C** | Use the kiosk for a worker who **is** registered (turn the phone's data off first) | Same result. The kiosk does not care whether they have an account |
| **D** | At the kiosk, enter yesterday's code, then a code belonging to nobody | *"That site code is not valid now. Ask for today's code."* — the **same sentence** for both, and nothing recorded |
| **E** | At the kiosk, pick the wrong contractor for a worker | *"You are not listed under that contractor. Check with your supervisor."* — nothing recorded |
| **F** | Check in on the phone, then try the same day at the kiosk (and the reverse) | *"Already Checked In / You are already recorded as working today."* — one row for the day, never two, and the row keeps whichever route wrote it |
| **G** | At the kiosk, enter the wrong PIN | *"That PIN is not correct."* — nothing recorded. Five in a row locks that PIN for five minutes: *"Too many wrong PINs. Try again in a few minutes."* |
| **H** | Change a worker's contractor, then try the kiosk with the old one, then the new one | The old contractor is refused; the new one works. **The day already recorded is not changed**, and an issued invoice does not move |

Two things worth knowing while testing:

- A wrong site code is refused **without touching the PIN counter**. The code is
  shared by the whole crew; a queue mistyping it must not lock anybody out.
- The employee/contractor checks happen **before** the PIN, so the machine can
  never be used to ask "does this worker exist?" or to guess PINs against
  somebody else's workforce.

---

## 5. What the kiosk cannot do

By construction, not by convention: `/kiosk.html` builds to its own bundle
(~12 kB) and imports none of the employer application. There is no dashboard,
no payroll, no reports, no settings, no roster management, and no rate or
amount anywhere in what it fetches — checked by reading the import graph in
`tests/kiosk.test.js` and by grepping the built chunk.
