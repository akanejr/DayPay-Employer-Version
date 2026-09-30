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
| Unit tests | **321** (`npm test`) |
| Cross-layer proofs | **migration chain 36/36 · e2e 115/115 · RLS harness 78/78 · lockout PASS** (`npm run prove`) |
| UI check | **141 checks, all green** — every screen rendered in a real DOM, including the kiosk |
| Lint | 0 errors, 13 warnings (all pre-existing) |
| Build | `dist/` with two entry points: `index.html` and `kiosk.html` |

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

## What is verified, and how

| Question | Answered by | Result |
|---|---|---|
| Does the schema come out right from empty? | `migrations.mjs` | 001→019 applies clean; the batch applies on top of an older project and lands in the same place |
| Does one day of work become the same money everywhere? | `e2e.mjs` | 115/115, every layer reconciles |
| Can a worker see another worker's wages or guess a PIN? | `harness.mjs` | 78/78 — including the eleven kiosk checks |
| Can someone brute-force a site code? | `lockout-probe.mjs` | five wrong codes recorded, the sixth refused, all refusals word-identical |
| Does every screen render, and do the buttons work? | ui-check | 141 checks — including the kiosk walked button by button |
| Is a given project actually installed? | `verify_installed.sql` | 17 rows, PASS/FAIL, safe on a half-installed project |
| Does the kiosk bundle contain employer code? | `tests/kiosk.test.js` | no — the import graph is asserted, and the built chunk is greppable |

---

## What is outstanding

1. **The browser run of the eight scenarios** (`SITE-ATTENDANCE.md` §4). They
   are proven against a real database and in a real DOM; what only your browser
   can show is Supabase Auth never asking for an invite code again after
   sign-out, and how it all looks on a phone.
2. **The deploy itself** — the repository is ready; the steps are in
   `docs/DEPLOY-VERCEL.md`. The two things to get right are the **Production
   Branch** (this one, not `main`) and Supabase's **Auth URL configuration**.
3. **Scenario H, flagged not fixed:** a recorded day is attributed to the
   contractor a worker is on *now*. The day rows are never rewritten and an
   issued invoice does not move, but the per-contractor rollup follows a
   reassignment. That is existing reporting behaviour; changing it is a
   reporting change, which the brief forbids without instruction. Say the word
   and it becomes a decision.
4. **Two keys look alike.** The publishable key is public and committed; the
   `service_role` key must never be shared, pasted into a host, or added to this
   repository. The build refuses to ship one if it appears in the environment.

---

## Phase history, briefly

Phases 0–9 built the employer version from the v24.3 baseline: schema, roles,
invite and join, contractors, attendance sessions and codes, corrections,
invoices and other retention, locked months, reminders, themes and polish.

Phases 10–13 are the current brief: **10** roles, account access and
account-less workers · **11** the attendance PIN · **12** the site kiosk ·
**13** the audit view and the scenario record.
