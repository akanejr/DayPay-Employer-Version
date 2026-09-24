# DayPay — Phase 0: Architecture Inspection & Implementation Plan

**Status:** inspection only. No application code was modified in Phase 0.
**Date:** 2026-09-25
**Repo:** `akanejr/DayPay-Employer-Version`, branch `arena/01a0cffa-daypay-employer-version`

---

## 1. What DayPay is today — stated plainly

DayPay is currently **two applications sharing one shell, one sign-in, and one visual identity.** They do not share data.

| | **A. Personal tracker** (the original DayPay) | **B. Workforce ledger** (added this cycle) |
|---|---|---|
| Tabs | Month · Year | Join / My work · Staff |
| Store | `user_data` — one JSON row per user | `day_records` + `employees` + `employee_rate_periods` |
| Scope | single-tenant: you and your own days | employer-scoped: a roster of people |
| Who writes | the user, by tapping a calendar cell | the employer, or the linked employee |
| Money | computed **in the browser** on tap | computed **in the database** by trigger, frozen at confirmation |
| Audit | none | `day_record_events`, append-only |
| Gate on writing | month must not be locked | RLS policies + trigger guard |
| Rate history | `settings.ratePeriods` in JSON | `employee_rate_periods` table |

**This is the single most important finding of Phase 0.** The master plan says:

> Attendance records should remain the authoritative source. Employer dashboards, Monthly Payslip, Yearly Share and invoices should derive their information from the same underlying records.

Today they derive from **different** records. The Monthly Payslip and Yearly Share read store A. The employer dashboard, Summary pane and CSV read store B. A worker marked present by their employer does not appear in their own Month tab, and a day tapped at home does not appear on the employer's roster.

Everything in Phases 5–8 depends on resolving this, which is why it is raised now rather than at Phase 5.

---

## 2. Architecture map

### 2.1 Authentication
- Supabase Auth, email + password only. No OAuth, no magic links, no phone.
- `src/App.jsx` line ~571: session is read once on boot, then `onAuthStateChange`-driven.
- `authLoading` gates the splash. If Supabase is unconfigured the app boots into local-only mode with no error.
- `displayName` falls back to the email local-part.
- **No role concept in auth itself.** Roles are derived, not stored — see 2.4.

### 2.2 Account structure
- `employers` — PK `user_id` → `auth.users(id)`. Holds `business_name`. A row is created lazily by `ensureEmployer()` on first employer action.
- `employees` — `employer_id` → `auth.users(id)` (**directly, not to `employers.user_id`**), `full_name`, `job_title`, `email`, `employee_user_id` (null until linked), `invite_code` (unique, nulled on redemption), `status` active/archived.
- `employee_rate_periods` — `employee_id`, `effective_from`, `daily_rate`, `weekend_multiplier` (default 2), `holiday_multiplier` (default 2), `unique(employee_id, effective_from)`. Append-only in practice; a raise never rewrites past days.
- `user_data` — legacy, one row per user, holds the entire personal tracker as JSON.

### 2.3 Database schema — all six tables

| Table | Key constraint | Notes |
|---|---|---|
| `employers` | PK `user_id` | |
| `employees` | `invite_code` unique; FK to `auth.users` | **no contractor column** |
| `employee_rate_periods` | `unique(employee_id, effective_from)` | historical rates |
| `day_records` | `unique(employee_id, work_date)` | the ledger |
| `day_record_events` | append-only, **no INSERT policy at all** | written by SECURITY DEFINER trigger only |
| `user_data` | one row per user | legacy, untouched |

`day_records` columns worth knowing:
```
employee_id · work_date · kind · leave_type · leave_percent
rate · multiplier · amount          ← all three written by trigger, never by a client
status (claimed | confirmed | disputed)
note · claimed_by · confirmed_by · confirmed_at · disputed_by · disputed_at
```

`kind` ∈ `work | weekend | overtime | holiday | leave`.

### 2.4 Permissions — how roles actually work

There is no roles table. `myRoles()` (in `src/lib/employer.js`) computes three things on sign-in:

```
isEmployer   = does an `employers` row exist for me?
businessName = from that row
employee     = do I have a linked `employees` row? (i.e. have I been invited and joined?)
```

RLS is the real enforcement, via three SECURITY DEFINER helpers: `is_employer_of(emp)`, `is_self(emp)`, `can_see_employee(emp)`.

Policies on `day_records`:
- `day_records_employer_all` — the employer has full control over their roster's days.
- `day_records_self_select` — an employee reads their own days only.
- `day_records_self_insert` — **`with check (is_self and status = 'claimed')`**. The `status = 'claimed'` clause is load-bearing: without it an employee could insert an already-`confirmed` row and bypass the employer.
- `day_records_self_update` — own days, only while `claimed`.
- `day_records_self_delete` — own days, only while `claimed`.

Trigger chain, order matters:
```
BEFORE  day_records_compute_money   → derives rate/multiplier/amount from rate periods
BEFORE  day_records_guard           → freezes confirmed money; only the employer may confirm
AFTER   day_records_audit           → writes day_record_events
```

### 2.5 Attendance flow — employee (personal tracker)
- Calendar grid in App.jsx (~line 2194). `isEditable = monthStatus === 'active'`, where month status is `locked | active | future`.
- `handleCellClick(dateObj)` → `setAttendance(...)` → debounced 800 ms → **whole-dataset rewrite** of the `user_data` JSON row.
- Kinds come from taps: a plain tap = `work`; weekend days auto-apply the multiplier by date; an edit corner converts a worked day to `overtime`; a "log a future day" chip block logs days ahead.
- **Nothing verifies where the tap happened.** A day can be tapped from anywhere, for any date in the month, including the future.
- Known sync weakness: two devices writing the same JSON row = last-write-wins.

### 2.6 Attendance flow — employer (workforce ledger)
- `StaffDays` pane: pick a date, mark people present/kind. `setDay()` writes a `day_records` row. Bulk "Mark all present" runs **sequentially per person** so a partial failure keeps the successes.
- `Summary` pane: month totals from `summarise()`, CSV export.
- `Roster`: add person, set rates, invite, archive.
- Employer may set any `kind`, confirm days, confirm a whole month.

### 2.7 Salary calculation — **already matches the master plan exactly**

`employerLogic.multiplierFor(kind, period, leavePercent)`:
```
work      → 1
weekend   → period.weekend_multiplier   (default 2)
overtime  → period.weekend_multiplier   (default 2)   ← same 2× rule
holiday   → period.holiday_multiplier   (default 2)
leave     → leavePercent / 100
```
The DB trigger applies the identical rule in `day_records_compute_money()`, so client display and stored money cannot drift.

Worked check against the plan's own example — 19 regular, 2 weekend, 1 OT at ₦16,000:
```
actual days        19 + 2 + 1        = 22
paid-day equivalents 19 + 2×2 + 1×2  = 25
                       25 × ₦16,000   = ₦400,000
```
`summarise()` reports `worked` (actual, excluding leave) and `equivalents` separately — so the plan's distinction between **Actual Days Worked** and **Paid-Day Equivalents** is already carried end to end. **No change required here.**

### 2.8 Monthly Payslip & Yearly Share
- Both generated client-side with jsPDF (`src/lib/payslip.js`).
- v24.2/v24.3: the payslip was restructured around actual-days vs paid-day-equivalents, and the yearly figure is the settled monthly model aggregated — not `monthly × 12`.
- Respects rate history via `rateFor(periods, dateKey)`: the period in force on each day governs that day.
- **Both read store A (`user_data`).**
- Month locking freezes a month against further edits.

### 2.9 Navigation
```
segmented control:  [ Month ][ Year ][ Join / My work ][ Staff ]
```
- Month, Year — always visible (personal tracker).
- Join / My work — only when signed in. Label is "Join" when not yet linked, "My work" once linked.
- Staff — only when signed in. Renders `EmployerWorkspace` with three sub-tabs: **Days · Rates(roster) · Summary**.

### 2.10 Other subsystems (inspected, to be left alone)
- **Reminders** — `src/lib/reminders.js`, notification permission, `.ics` calendar-alarm download, per-day/time settings. Self-contained.
- **Settings** — profile, rate periods, salary goal, payday, leave types, reminder config, cloud status.
- **PWA** — `public/sw.js` (`daypay-v24`), cache-first for assets, network-first for navigation, explicitly skips `supabase.co`. Registered only in PROD.
- **Contractor structures** — **none exist in any form.**

### 2.11 Build & test tooling
- Vite 8 + React 19. `npm run build:site` → `site/`, served by `serve.py` on 0.0.0.0:5173.
- `scripts/prepare-env.mjs` fills `.env` from the committed `config/supabase-public.env`; `vite.config.js` fails the build if the Supabase project ref is not found in the output bundle.
- **85 tests pass** (`tests/engine.test.js` 26 + `tests/employer.test.js` 59), `node --test`. Pure logic lives in `employerLogic.js` (zero imports) precisely so money rules are testable without a database.
- `supabase/harness/rls_test.sql` — a 14-check, account-agnostic RLS harness the user runs in the SQL editor. All 14 pass.

---

## 3. Reuse / extend / avoid

### Reuse unchanged
`day_records` and its full trigger chain · `day_record_events` · `employee_rate_periods` · `employerLogic.multiplierFor` / `rateOn` / `summarise` / `parseDateKey` · `payslip.js` · `reminders.js` · the segmented nav shell · the entire CSS design language · `prepare-env.mjs` build guard · the 85-test suite.

### Extend, do not replace
- `employees` — add a nullable `contractor_id`. Purely additive; existing rows keep working with a null contractor.
- `day_records` — add provenance columns for check-in (`session_id`, `source`) so the audit trail can say *how* a day was created, not just that it was.
- `myRoles()` — return the contractor membership and a `canCheckIn` flag. Same shape, more fields.
- Employer workspace — add Contractor and Invoice panes to the existing sub-tab strip; do not add top-level tabs.
- Employee experience — add gate logic to the existing calendar; do not redesign it.

### New
`contractors` table · `attendance_sessions` table · `check_in_with_code()` SECURITY DEFINER function · `correction_requests` table + review actions · invoice generation (client-side PDF, reusing `summarise()`).

### Avoid
- A second calculation engine for invoices.
- Duplicate attendance writes (do **not** bridge store A → store B by writing on tap; that creates two writers for one fact, which the plan explicitly forbids).
- Any new top-level nav item beyond what exists.
- Touching the legacy `user_data` table's contents or dropping anything.

---

## 4. Gap analysis against the nine phases

| Phase | Plan asks for | Reality | Work remaining |
|---|---|---|---|
| **1** Roles | distinguish Employee from Employer | **substantially built** — `employers`/`employees`, `myRoles()`, RLS helpers | add contractor membership + `canCheckIn`; split "personal" from "business" employer |
| **2** Dashboard | management overview | **substantially built** — Staff tab, Days + Summary panes | restructure around Today / Contractors; demote manual marking |
| **3** Contractor → Worker | group workers under contractors | **not built** — roster is flat | new `contractors` table + `contractors.js` data layer + contractor panes |
| **4** Sessions + daily codes | open/close session, daily code, employee check-in | **not built** | new `attendance_sessions` + `check_in_with_code()` + employer control + employee flow |
| **5** Read-only employee | cannot create attendance from home | **not built, and currently violated** — the Month tab still lets a user tap any day of the month from anywhere | **blocked on Decision 1** |
| **6** Worker detail, OT, corrections, audit | inspect a worker day by day; assign OT; approve/reject corrections | **partly built** — audit trail exists; employer can set kind/confirm; `disputed` status exists | correction requests as first-class rows; worker detail view with calendar; OT assignment UI |
| **7** Invoice | contractor invoice from verified attendance | **not built** — CSV export only | invoice builder reusing `summarise()`; PDF layout in the existing visual language |
| **8** Integration test | everything reconciles | 85 unit tests, RLS harness; **nothing exercises the two-sided flow against a live DB** | end-to-end script + reconciliation checks |
| **9** Polish | final UI pass | — | after structure is correct |

**Net:** Phases 1–2 are largely done, Phase 6 is partly done, and Phases 3, 4, 5, 7 are genuinely new. The plan is not starting from zero — but the two-ledger problem gates Phases 5, 7 and 8.

---

## 5. Decisions required before Phase 1

### Decision 1 — the two ledgers *(blocking)*

**The problem.** The plan requires one authoritative attendance source. DayPay has two. Phase 5 ("employees cannot create attendance outside an attendance session") cannot be honestly satisfied while the Month tab writes days to `user_data` from anywhere.

**Option A — one ledger. `day_records` becomes the only attendance store.**
On first sign-in a user gets a *personal workspace*: an `employers` row marked `kind = 'personal'` and a self `employees` row. The Month tab reads and writes `day_records` like everyone else. Existing `user_data` attendance is migrated in once, non-destructively, and `user_data` is left in place as a fallback.
- *For:* one source of truth by construction. Payslip, Yearly Share, employer dashboard and invoice reconcile by definition. The audit trail and rate-period model extend to personal users. The last-write-wins sync bug disappears.
- *Against:* the largest single change in the restructure. Needs a migration and a careful cutover.

**Option B — two stores, switch per user.**
Personal-only users keep the old tracker untouched. Users linked to an employer get the ledger in their Month tab.
- *For:* the smallest disturbance to the existing personal experience, which the brief repeatedly asks to preserve.
- *Against:* two rendering paths for the month view; a user who tracked personally and later joins a contractor has a split history; "one source of truth" holds per-user but not globally.

**Option C — bridge on write.** Rejected: two writers for one fact is precisely the duplicate-source-of-truth the brief forbids.

**Recommendation: Option A**, because Phase 5 and Phase 7 are both unbuildable without it, and because it is the only option under which the monthly, yearly and invoice figures *cannot* disagree. Option B is defensible if preserving the personal tracker bit-for-bit matters more than reconciliation — but it defers the problem rather than solving it.

### Decision 2 — who gets the Staff tab
Under Option A every user has an `employers` row, so `isEmployer` would become true for everyone and the workforce dashboard would appear for someone tracking only their own days. Recommend an explicit `employers.kind` of `'personal' | 'business'`; the Staff tab and all workforce panes show only for `business`. **This is required under Option A and harmless under Option B.**

### Decision 3 — daily code shape
The plan's example is a 4-digit code (`7429`). Four digits is 10,000 combinations — fine for typing, thin against guessing. Recommend: **4 digits for readability, with a per-session attempt limit and a code that dies with the session.** Alternative: 6 characters from the existing unambiguous CSPRNG alphabet (`readable` but slower to shout across a site). Needs a ruling; it is a security/UX trade, not a technical one.

### Decision 4 — the employer's manual marking
The plan says *"Do not make the employer manually mark every employee present."* Today the Staff tab's primary action **is** marking people present, including a bulk button. Recommend: keep the capability but **demote it to an exception/override tool** (its own clearly-labelled action, always audited), with check-in becoming the normal path. Deleting it would remove the employer's only recourse when someone's phone dies. Needs confirmation.

### Decision 5 — invite code vs. daily code
Two codes will now exist with different lifetimes and purposes. Recommend fixed naming in the UI and the code: **"invite code"** = one-time onboarding (exists today); **"today's code"** = daily attendance. Both already exist conceptually and must never be visually confused.

---

## 6. Proposed phase plan

Each phase ends with a report in the required format and a stop for approval.

- **Phase 1 — Roles & identity.** Apply Decision 2. Add `employers.kind`, `myRoles()` → `{ isEmployer, isBusiness, employee, contractor, canCheckIn }`. Gate the Staff tab on `business`. Add a `contractors` table (nullable FK, additive). **No UI change beyond gating.**
- **Phase 2 — Employer dashboard.** Restructure the Staff tab into the management overview: Today (expected / checked in / not checked in / OT) then Contractors with rollups. Sub-tabs, not new top-level nav. Demote manual marking per Decision 4.
- **Phase 3 — Contractor → Worker.** Contractor CRUD, assign workers, contractor detail view, worker cards showing actual days and paid-day equivalents.
- **Phase 4 — Sessions & daily codes.** `attendance_sessions` (employer, contractor, date, code, status, validity). Employer: open / view code / close / see checked-in vs not. Employee: enter code → validated → one `day_records` row. New `check_in_with_code()` SECURITY DEFINER following the same pattern as `redeem_invite()`, which is already proven.
- **Phase 5 — Read-only employee mode.** Execute Decision 1. Enforce at the database, not the UI: an employee insert requires an open session for that date and contractor.
- **Phase 6 — Worker detail, OT, corrections, audit.** Worker detail with calendar; employer OT assignment (reclassification, one row — never two); `correction_requests` review/approve/reject; surface the existing `day_record_events` trail in the UI.
- **Phase 7 — Contractor summary & invoice.** Period summary per contractor, invoice PDF reusing `summarise()`.
- **Phase 8 — Integration test.** End-to-end: session → check-in → dashboard → worker → month → year → contractor total → invoice, asserting every figure reconciles.
- **Phase 9 — Polish.** Typography, spacing, mobile, empty/loading/error/success states, accessibility.

---

## 7. Risks

1. **Two-ledger divergence** — the central risk; Decision 1 resolves it.
2. **Live database, no local Postgres.** The sandbox cannot reach `*.supabase.co` and has no Docker, so RLS cannot be tested locally. Every security claim ships as a SQL harness the user runs. This is the existing, working arrangement and must continue.
3. **Destructive migrations** — the plan forbids them and none are proposed. Every schema change here is `add column` / `create table` / `create or replace function`. New `NOT NULL` columns are always given defaults or left nullable.
4. **Phase ordering vs. contractor dependency** — Phase 4's sessions are per-contractor, so Phase 3 must genuinely land first.
5. **The Excel/WhatsApp reality.** A plant office is likely to want the invoice as a file to forward, not a web page. The PDF/CSV path already exists and should be the invoice's output.

## 8. Non-negotiables carried into every phase

- No GPS, geolocation, geofencing, maps or location APIs. Verification is session + code + account + date + contractor.
- No destructive migrations; no deletion of existing data.
- No new top-level navigation items.
- The existing visual identity, dark-mode aesthetic, and 8pt rhythm are preserved.
- Existing features — login, calendar, payslip, Yearly Share, reminders, settings, rate history, locked months — are re-verified at the end of every phase and fixed before proceeding.
- Money logic is never duplicated: one engine, tested without a database.
