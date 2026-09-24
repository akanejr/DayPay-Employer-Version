# DayPay Employer Version — progress to date

Branch: `arena/01a0cffa-daypay-employer-version`
Latest commit: `6af9a56`
Tests: **85 passing**, zero dependencies
Database: 4 migrations applied, isolation harness verified

---

## Starting point

The repository held only a one-line README. The employer-version code did not
exist anywhere in the workspace, so DayPay v24.3 (from `akanejr/DayPay-repo`,
commit `cceb44a`) was imported as the baseline and verified byte-identical.

That app is a **single-user** day-rate tracker: one person's calendar, rates
and payslips, backed by one `user_data` row per auth user.

---

## What was added

### The foundation

| File | Purpose |
|---|---|
| `supabase/migrations/001_employer_schema.sql` | 5 tables, 14 RLS policies |
| `supabase/migrations/002_fix_audit_trigger.sql` | Corrects the audit trigger |
| `supabase/migrations/003_legacy_user_data.sql` | Restores the employee-side table |
| `supabase/migrations/004_grants.sql` | Explicit privileges + future defaults |
| `supabase/harness/rls_test.sql` | 14 checks proving employee isolation |

Schema: `employers`, `employees`, `employee_rate_periods`, `day_records`,
`day_record_events`.

Three rules are enforced **in the database**, not in the client:

1. **Money is computed server-side.** A trigger reads the rate period in force
   on the *work date*. A client may claim a day was worked; it cannot claim
   what that day pays.
2. **Confirmed amounts are frozen.** The trigger refuses to change a confirmed
   day's money; the day must be reopened first, which is recorded.
3. **The audit trail is unwritable by the audited.** `day_record_events` has
   no INSERT policy at all; rows come only from `SECURITY DEFINER` triggers.

### The employer workspace

New third tab: **Month · Year · Staff**, with Staff split into three panes.

| Pane | What it does |
|---|---|
| **Mark days** | Date stepper, per-person marking, bulk "mark all present", inline kind picker, month running total |
| **Summary** | The "you owe" figure, per-employee rows, confirm/reopen, dispute list, CSV export |
| **Roster** | Add/archive/restore staff, effective-dated rate history, invite codes |

Supporting code:

| File | Lines | Purpose |
|---|---|---|
| `src/lib/employerLogic.js` | 287 | Pure functions, zero imports — testable |
| `src/lib/employer.js` | 395 | Supabase I/O; never sends `rate`/`amount` |
| `src/employer/EmployerWorkspace.jsx` | 475 | Container, roster, rate editor |
| `src/employer/StaffDays.jsx` | 316 | The daily marking job |
| `src/employer/Summary.jsx` | 353 | Month end |
| `src/employer/employer.css` | 539 | Uses existing theme tokens |

### Tooling

| File | Purpose |
|---|---|
| `serve.py` | Dependency-free static server (node_modules is wiped between sandbox turns) |
| `start-preview.sh` | One-command rebuild-and-serve |
| `scripts/make-connection-check.py` | Browser-side diagnostic, because the agent's sandbox cannot reach Supabase |
| `config/supabase-public.env` | Public config, committed so it survives wipes |
| `docs/*.md` | Setup guide, runbook, plain-language instructions |

---

## What is verified, and how

| Claim | How it was verified |
|---|---|
| DayPay source imported intact | 24 files, checksums compared to source |
| Employee isolation holds | 14-check harness run by the user on the live project — **all passed** |
| A raise never reprices the past | Test asserts total ≠ days × newest rate |
| A forged amount is overwritten | Harness: client sent ₦1, server stored ₦32,000 |
| An employee cannot self-confirm | Harness: 42501 on the attempt |
| Roster + rates work end to end | User created "James, Welder, ₦16,000/day" against the live database |
| Payroll maths, CSV, date logic | 85 automated tests |

**Not verified:** the Mark days and Summary screens have never been executed
against a live database. The agent has no network route to Supabase, so these
can only be confirmed by the user running them.

---

## Bugs found today

Every SQL bug below was found by the user running the code and reporting the
error precisely. None could have been caught by the agent alone.

| Bug | Severity |
|---|---|
| `SET LOCAL x = <expression>` is invalid PostgreSQL (42601) | Harness unusable |
| CTE referenced `p.employer_uid` with no `p` alias (42P01) | Harness unusable |
| **Audit trigger was BEFORE INSERT but wrote to a table with an FK to the row being inserted (23503)** | Every day save failed |
| `summarise` threw on a null element | Would blank the whole summary |
| **`summarise` dropped days belonging to an unlisted employee** | **Understated what is owed** |
| Staff returned early on error, hiding the Add button | A data error looked like a broken UI |
| 42501 and 42P01 reported as "are you signed in?", blaming the user for a setup fault | Sent the reader to the wrong place |
| Sandbox reset local git history twice | Recovered from the remote; no work lost |

### One wrong diagnosis, worth recording

After seeing a "signed in as the employer" message, the missing-grant theory
was pursued and migration 004 was written to fix it. **The theory was wrong.**
The user's own verification output showed privileges
(`REFERENCES, TRIGGER, TRUNCATE`) that only `GRANT ALL` produces, proving the
grants were already in place. Supabase's defaults covered it; the original
single-user app's `supabase-setup.sql` had no grants either and worked fine.

Migration 004 is retained as insurance — Supabase now requires explicit grants
for newly created public tables — but it was not the fix. The real cause was
that the user was not signed in, and a similar-sounding error message led the
diagnosis astray.

### Process changes made in response

- Whole-file rewrites instead of regex edits, after a regex cut `employer.js`
  from 370 lines to 93 and it had to be restored from git.
- Brace-counting, not regex, for removing code blocks.
- Pure logic moved into a zero-import module so it can be tested at all.

---

## Costs and caveats

- **No African Supabase region exists.** Port Harcourt runs against
  `eu-west-1` / `eu-central-1`, so every query carries an intercontinental
  round trip. Acceptable for day-rate logging; worth knowing before scaling.
- **Sync is still last-write-wins on a whole dataset** for the employee-side
  `user_data` blob. Fine for one person on two devices; a problem the moment
  two people edit. The new multi-employee tables do not have this issue.
- **Bulk operations are sequential**, one audited call per day. Correct, but
  slow for a large roster; an RPC would be the optimisation.
- **The employer workspace is unexercised.** Expect rough edges on first use.

---

## Next

1. **Invite flow** — `invite_code` and `employee_user_id` exist in the schema
   with no UI. This is what makes the system genuinely two-sided.
2. **Employee's own view** — see your days, your rates, your total.
3. **The handshake** — employee claims, employer confirms, both sides see the
   same agreed figure with an audit trail.
