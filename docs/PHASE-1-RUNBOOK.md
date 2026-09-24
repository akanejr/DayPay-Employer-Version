# Phase 1 runbook — what to run, in order

Everything here is done in **your browser**. The agent's sandbox has no network
route to Supabase, so it cannot run any of these steps for you.

Estimated time: about 10 minutes.

---

## Step 0 — Sanity check the connection

Open:

```
https://<preview-host>/connection-check.html
```

Expect: reachable, key accepted, migration not applied (a warning, which is
correct at this point), anonymous access denied.

**If the key is rejected here, stop.** Nothing downstream will work.

---

## Step 1 — Create the two test accounts

Supabase Dashboard → **Authentication** → **Users** → **Add user** → *Create new user*

| Email | Password | Auto Confirm |
|---|---|---|
| your first address | anything you'll remember | ✅ tick |
| your second address | anything you'll remember | ✅ tick |

The second account is what proves the isolation actually works. With one
account every check below would pass trivially and prove nothing.

---

## Step 2 — Run the schema migration

Supabase Dashboard → **SQL Editor** → **New query**

Paste the whole of `supabase/migrations/001_employer_schema.sql` and run it.

Expect: **Success. No rows returned.**

If it errors, paste the entire error text into the chat. The migration wraps
itself in a transaction, so a failure leaves nothing half-applied.

> The migration deliberately refuses to run twice. That is protection, not a
> bug.

---

## Step 3 — Run the isolation harness

SQL Editor → **New query**

1. Open `supabase/harness/rls_test.sql`
2. **Edit the two email addresses** in the CONFIG block near the top — this is
   the only edit needed
3. Paste the whole file and run it

You get two result sets back:

**Results table** — 12 rows. Every row must read `PASS`.

**Verdict table** — one row. It must say:

```
ALL CHECKS PASSED — isolation holds
```

The harness seeds test data, checks it, then **rolls everything back**. It
leaves nothing behind and is safe to re-run.

### What each check proves

| # | Check | Why it matters |
|---|---|---|
| 1–3 | Employer sees the full roster | The employer isn't locked out of their own data |
| 4–6 | Employee sees **only** themselves | The core isolation guarantee |
| 7 | Employee cannot read a colleague's ₦99,000 rate | A specific, deliberate bait value |
| 8 | Employee cannot read a colleague's day record | Same, for attendance |
| 9 | Employee cannot self-confirm a day | Blocks bypassing the employer entirely |
| 10 | A forged amount is overwritten by the server | Money cannot be claimed by a client |
| 11–12 | Signed-out visitors see nothing | No public exposure |

**Paste the results back**, including any FAIL.

---

## Step 4 — Only then, real data

If every check passes, the project is safe to use. If any fails, that is a
genuine security hole and it gets fixed before anything else happens.

---

## Meanwhile — the pay engine is already pinned down

No Supabase needed. Runs anywhere, no dependencies:

```bash
npm test
```

**26 tests, all passing.** They lock the three rules the whole product rests on:

- **A raise never reprices the past.** The test asserts that a month split
  across a rate change totals the *sum of stored amounts*, and explicitly
  asserts it differs from `days × newest rate`.
- **A mixed-rate month never prints a false equation.** It checks the payslip
  says "rates changed during this period" instead of quietly multiplying every
  day by one rate.
- **Weekend / overtime / holiday earn their multiplier**, leave is paid
  separately and never counted as a worked day, and malformed legacy records
  stay interpretable rather than producing `NaN` on a payslip.

These ran before any schema change, so if something later breaks them, that's a
real regression and the suite says so.
