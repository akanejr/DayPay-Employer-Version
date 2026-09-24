# What I need from you

**Total time: about 10 minutes. All of it in your browser. No coding.**

I cannot do these steps myself. My sandbox has no network route to Supabase —
I verified it: `github.com` works, `*.supabase.co` is blocked. So the database
steps have to happen on your machine, and you tell me the result.

Every step below says **what to click**, **what you should see**, and
**what to do if it looks wrong**.

---

## The 30-second version of why

I've written the database design that lets one employer manage many employees,
where each employee can see only their own wages.

Before any real salary data goes near it, we have to **prove that isolation
actually works.** If it's wrong, employee A could read employee B's pay. That's
not a bug you find later — that's a data breach, and the whole point of this
step is to make sure it can't happen.

So: you create two test accounts, and I give you a script that logs in as each
one and tries to peek at the other's wages. It should fail to peek. That's the
proof.

---

## Step 1 — Check the connection (1 minute)

**What to do:** Open the connection check page.

Because the preview link changes every time the sandbox rebuilds, use the
**LIVE PREVIEW panel in your Arena UI** and add `/connection-check.html` to the
end of the address. If you can't reach it, skip this step — it's a
convenience, not a requirement.

**What you should see:**

| Check | Expected |
|---|---|
| Project reachable | ✓ green |
| Publishable key accepted | ✓ green |
| Migration applied | ⚠ amber — **this is correct right now**, we haven't run it yet |
| Anonymous access denied | ✓ green |

**If the key check shows red:** stop and tell me. Everything after this depends
on the key working.

---

## Step 2 — Create two test accounts (3 minutes)

**What to do:**

1. Go to <https://supabase.com/dashboard>
2. Open your project (`crirzuoehbkzpnwokyxl`)
3. Left sidebar → **Authentication**
4. Click **Add user** → **Create new user**
5. Fill in an email and password. **Tick the box that says "Auto Confirm User."**
6. Click Create
7. **Repeat for the second email address**

**Why two?** Because the whole test is "can account 1 see account 2's wages?"
With one account, every check passes trivially and proves nothing.

**Use your two real email addresses.** They can be any two you control — the
test cleans up after itself, so nothing is left behind.

**What you should see:** two rows in the Users list, both with a green
"Confirmed" badge.

**If a user shows "Waiting for verification":** the Auto Confirm box wasn't
ticked. Click the user, and confirm them manually.

---

## Step 3 — Create the database tables (2 minutes)

**What to do:**

1. In the Supabase sidebar, click **SQL Editor**
2. Click **New query**
3. Open the file `supabase/migrations/001_employer_schema.sql` on your computer
   *(it's in the zip I gave you, or on GitHub)*
4. **Select all of it, copy, and paste it into the SQL Editor**
5. Click **Run** (or press Ctrl+Enter)

**What you should see:**

```
Success. No rows returned
```

That's the correct result. Creating tables doesn't return data.

**If you see a red error:** copy the whole error message and send it to me.
The script wraps itself in a transaction, so a failure changes nothing — it's
safe to fix and re-run.

**If you run it twice by accident:** it will refuse and say
"Migration 001 has already been applied." That's intentional, not a bug.

---

## Step 4 — Run the security test (2 minutes)

**This is the important one.**

**What to do:**

1. SQL Editor → **New query**
2. Open `supabase/harness/rls_test.sql`
3. Copy the **whole file** and paste it in
4. Click **Run**

**You do NOT need to edit anything.** The script finds your two accounts by
itself — it uses the two most recently created ones, which will be the two you
just made. It tells you which addresses it picked.

**What you should see — three result tables.**

**Table 1 — which accounts it tested.** Check these are your two:

| employer account | employee account | accounts in project |
|---|---|---|
| you@example.com | second@example.com | 2 |

**Table 2 — thirteen checks.** Every row must say `PASS` in the last column.

**Table 3 — the verdict.** It must say exactly:

```
ALL CHECKS PASSED — isolation holds
```

**What the checks actually do**, in plain terms:

| # | What it tries | It must be... |
|---|---|---|
| 1–3 | Employer looks at their own roster | Allowed |
| 4–6 | Employee looks at the staff list | **Blocked** — sees only themselves |
| 7 | Employee hunts for a colleague's ₦99,000/day rate | **Blocked** — zero results |
| 8 | Employee hunts for a colleague's attendance | **Blocked** — zero results |
| 9 | Employee tries to confirm their own day | **Blocked** |
| 10 | Employee tries to write a fake amount | **Overwritten** by the server |
| 11–12 | A signed-out stranger looks around | **Blocked** |

The script **rolls everything back at the end.** No test data is left in your
project. It's safe to run as many times as you like.

---

## Step 5 — Send me the result (1 minute)

Just paste the output of the last two tables. That's it.

- **All PASS** → I start wiring the app to the new database.
- **Any FAIL** → that's a real hole. Tell me and I fix it before anything else.
- **An error instead of results** → paste the error, we work through it.

---

## Two things worth knowing

**Nothing has touched your live data.** This is a brand-new project. Your
existing DayPay app and its real salary records are completely untouched.

**The migration is not yet connected to the app.** Running it creates tables;
it doesn't change how the app behaves. The app gets wired up only after the
tests pass.

---

## Quick checklist

```
[ ] Step 1  Connection check page — key accepted
[ ] Step 2  Two accounts created, both Auto Confirmed
[ ] Step 3  Migration run — "Success. No rows returned"
[ ] Step 4  Harness run — all 13 PASS, verdict "isolation holds"
[ ] Step 5  Results pasted back to me
```
