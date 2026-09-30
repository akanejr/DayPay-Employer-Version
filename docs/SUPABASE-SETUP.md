# Connecting a Supabase project — DayPay Employer Version

Read the security section before pasting anything anywhere. Two of the five
credentials Supabase shows you are harmless; the other three are account-level
and must never be shared with anyone, including an AI agent.

---

## 1. The five credentials, ranked by danger

| Credential | Looks like | Share with the agent? |
|---|---|---|
| **Project URL** | `https://abcd1234.supabase.co` | ✅ Yes — public, and visible in every request anyway |
| **Publishable / anon key** | `sb_publishable_…` or `eyJhbGci…` | ✅ Yes — **designed** to be public; ships in the browser bundle |
| **Secret / service_role key** | `sb_secret_…` or `eyJhbGci…` | ❌ **NEVER** — bypasses every RLS policy. Full read/write on all data |
| **Database password** | your own string | ❌ **NEVER** — direct Postgres access |
| **Personal Access Token** | `sbp_…` | ❌ **NEVER** — manages *every* project on your account |

### Why the anon key is safe (and the service_role key is not)

The anon key is a JWT that carries `"role": "anon"`. It grants **no** access on
its own. Every read and write it attempts is filtered by Row Level Security,
which is why it is safe to embed in client-side JavaScript. It is already
public in your current `daypay-app` and in the built `site/assets/*.js`.

The service_role key carries `"role": "service_role"` and **skips RLS
entirely**. Anyone holding it can read every salary in the database. There is
no safe place for it in a browser app. It is never needed for this project.

### A note on the anon key's blast radius

"Safe to share" is conditional on your RLS policies being correct. A table with
RLS **disabled** and the anon key in circulation is a public table. That is
exactly why this project runs a verification harness before real data lands.

---

## 2. What the agent needs — and what it will never ask for

**Send exactly two things:**

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable or anon key>
```

If a future message from the agent asks for a `service_role` key, a database
password, or an `sbp_` token, stop — that request is wrong, regardless of how
it is justified. There is no task in this project that requires them.

---

## 3. Why migrations are done by you, not the agent

The agent's sandbox has an **egress allowlist**. Measured from inside it:

```
github.com                      HTTP 200
registry.npmjs.org              HTTP 200
*.supabase.co                   BLOCKED
api.supabase.com                BLOCKED
supabase.com                    BLOCKED
```

So even if you handed over a Personal Access Token or the database password,
**the agent could not use it** — there is no route from the sandbox to Supabase.
Sharing them would be pure downside: you would hand over account-wide
credentials in exchange for zero extra capability.

**Therefore the workflow is:**

1. The agent writes `.sql` migration files into `supabase/migrations/`
2. You paste each one into the Supabase **SQL Editor** and run it
3. You paste any error text back into the chat
4. The agent writes a verification script; you run it and paste the result

Your browser *can* reach Supabase (it is on your own network), so the app
preview talks to the database normally. Only the agent's sandbox is isolated.

---

## 4. Creating the project

### Use a NEW, separate project — not your live one

Your existing project `kwedhxmparriekjnwlal` holds real salary data. The new
schema involves `DROP`, `ALTER`, and hand-written RLS policies. A single
mistake there could expose or destroy real records. A free-tier project costs
nothing and keeps the blast radius at zero.

### Steps

1. Go to <https://supabase.com/dashboard> → **New project**
2. **Name:** `daypay-employer-dev` (the `dev` suffix is deliberate — it should
   always be obvious this is not production)
3. **Database password:** generate a strong one. Save it to your password
   manager. **Do not send it to anyone.**
4. **Region:** there is no African region. For Port Harcourt, the lowest
   latency is `eu-west-1` (Ireland) or `eu-central-1` (Frankfurt) — either is
   roughly equivalent. Do not pick a distant region "for safety"; it only adds
   round-trip delay to every query.
5. Wait for provisioning (~2 minutes)

### Collect the two safe values

Go to **Project Settings → API Keys** (older projects: **Settings → API**).

- **Project URL** — copy it
- **Publishable key** — copy it
  *(On older projects this is labelled **anon public**. Both are fine.)*

While you are on that page, note that **Secret keys** / **service_role** and
the **JWT Secret** are shown nearby. Those are the ones to leave alone.

### Recommended dev-only setting

**Authentication → Sign In / Providers → Email:** turn **off** "Confirm email"
for the dev project. It removes a round-trip through your inbox on every test
signup. Do not carry this setting into production.

---

## 5. Auth redirect URLs (and a preview caveat)

Basic email + password sign-in needs **no** redirect configuration. Redirects
matter only for email confirmation, magic links, and password recovery.

This matters here because **the preview URL changes between turns** — the
sandbox is rebuilt with a new ID, e.g.:

```
https://5173-iv46027skhyltx0g6puz5.e2b.app
https://5173-ij5imcljadl7eidtpfpgr.e2b.app
```

So a hard-coded redirect URL will break constantly. Two options:

- **Skip it** (recommended for now). Sign in with a password; ignore
  confirmation and recovery emails in the dev environment.
- **Add a wildcard** — Authentication → URL Configuration → Redirect URLs, add
  `https://*.e2b.app/**`. Convenient, but it trusts every e2b sandbox on the
  internet. Acceptable for a disposable dev project with test data; never for
  production.

---

## 6. Where the key lives (given the sandbox wipes state)

The sandbox is rebuilt between turns, and `.env` is treated as a sensitive
path — it is **stripped from every snapshot**. This already bit us once: the
key vanished mid-session and the build silently produced an app with no
Supabase config.

The current workaround is that `start-preview.sh` regenerates `.env` from a
hard-coded copy of the key. That works, but it means:

> **The anon key for the current project is committed to git** in
> `start-preview.sh` (commit `15d7df0`, not yet pushed).

That is *not* a security breach — anon keys are public by design and the same
key already ships in the browser bundle. But it is untidy, and it will get
confusing once a second project exists.

**Proposed change when the new project is ready:** move the public values into
one clearly-named committed file:

```
config/supabase-public.env     ← committed, URL + publishable key only
.env                           ← gitignored, generated from the above, may hold secrets
```

The filename says `public` so that nobody ever pastes a secret into it. The
agent will set this up when the new keys arrive.

---

## 7. After the keys arrive — order of work

Nothing touches real data until step 4 passes.

1. Agent writes migration SQL into `supabase/migrations/`
2. **You** run it in the SQL Editor
3. Agent writes an RLS verification harness — a script that impersonates two
   different employees and asserts that neither can read the other's wages
4. **You** run the harness and paste the output
5. Only then does the app get wired to the new project

### The one question to answer now

Is there a **second person** available to test with — a colleague, a second
email address, a spare account? The entire point of this work is that employee
A cannot see employee B's data, and that cannot be demonstrated with one
account. A second email address is enough; the harness creates both users.

---

## 8. Checklist

```
[ ] New project created, named *-dev
[ ] Database password saved to password manager, NOT shared
[ ] Region chosen (eu-west-1 or eu-central-1)
[ ] Project URL copied
[ ] Publishable / anon key copied
[ ] Confirmed: service_role / secret key NOT copied anywhere
[ ] Email confirmation disabled (dev only)
[ ] Second email address available for RLS testing
[ ] Both values sent to the agent
```
