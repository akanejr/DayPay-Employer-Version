# DayPay — Employer Version

**Know what your work is worth.** A day-rate attendance and pay record for
workplaces that pay by the day: an employer runs the site, a worker records
what they worked, and every figure is traceable to a stored amount.

Two applications and a machine, in one repository:

| Where | Who uses it | What it is for |
|---|---|---|
| **`/`** — the app (*Month · Year · My work · Staff*) | one person, whatever their role | everything, filtered by what they are allowed to see |
| **`/kiosk.html`** — DayPay Site Attendance | a worker at the gate | naming themselves and recording the day. *Nothing else* |
| **`Staff`** (inside the app) | the employer | the workforce, the days, the money out |

---

## The money rule

A day is worth `rate × multiplier`: **work 1×**, **weekend / overtime /
holiday 2×**, **leave** a percentage the employer sets. Two rules keep it
honest, and both exist because the opposite loses money:

- **A rate change never rewrites history.** Rates are effective-dated, so a day
  keeps the rate it was worked at.
- **Confirming a day freezes its money.** After that the database itself refuses
  to change the amount.

Every figure on every screen — hero, folds, summaries, payslips, invoices,
exports — is the stored amount for that day, never today's rate applied
backwards.

---

## What it does

**Employer side** — open and close attendance (the day's code is read out
loud), mark and confirm days for the whole roster, manage workers and their
contractors, issue **attendance PINs** and **invite codes**, see the month per
worker and per contractor, issue/void/reissue **invoices**, export CSV and PDF.

**Worker side** — their own calendar, year, rates and ledger; **check in** with
today's site code; ask for a correction and see the answer with a reason.

**Site kiosk** — a machine at the worksite records attendance for workers with
no smartphone or no network: contractor → name → personal PIN → today's code.
It runs its own bundle with no employer code in it, and it cannot see money.

**Roles and access** — Employer or Employee at sign-up, enforced in the
database rather than hidden in the interface. The invite code is an onboarding
credential: given once, at registration, and never asked for again.

---

## Running it

```bash
npm install
npm run dev          # dev server, fills .env from config/supabase-public.env
npm run build        # production build → dist/  (index.html + kiosk.html)
npm run preview      # serve the build locally
```

The Supabase project URL and publishable key live in
`config/supabase-public.env`, which is **committed on purpose** — both values
ship inside the browser bundle, and RLS is what protects the data. `npm run
build` fills `.env` from it before Vite reads the config, and fails the build if
the bundle ends up without them.

## The database

Nineteen migrations, applied **in order**, in the Supabase SQL editor. All of
them are safe to re-run.

```
001 employer schema   006 employer kind      011 check-in can write   016 attendance tie-break
002 audit trigger     007 contractors        012 correction requests  017 refusal as a value
003 legacy user_data  008 attendance sessions 013 invoices            018 attendance PIN
004 grants            009 opaque failures     014 refusal wording     019 site kiosk
005 invite redeem     010 any live code covers 015 refusal final
```

> **Two are not simply "run it":** `010` must **not** be run on this project
> (`016` carries its only good part), and `015` is **superseded** by `017`.
> The batch that brings an older project up to date is **`012 → 016 → 017`**,
> followed by **`018 → 019`**.

To find out what a project already has, paste **`supabase/harness/verify_installed.sql`**
into the SQL editor. It returns seventeen PASS/FAIL rows naming any missing
migration, changes nothing, and is written to survive a half-installed project.

## Proving it works

```bash
npm test        # 321 unit tests — the maths, the wording, the access rules
npm run prove   # real PostgreSQL (wasm): schema, figures, permissions, lockout
npm run lint
```

`npm run prove` runs four proofs against migrations 001→019: the chain applies
from empty **and** on top of a project that predates it; one day of work ends up
as the same money on every layer; the shipped RLS harness passes end to end; and
the five-attempt lockout actually locks. There is also a UI check that renders
every screen in a real DOM, including the kiosk:

```bash
npx vite build --config scripts/ui-check/vite.ssr.config.mjs
node node_modules/.daypay-ui-check/entry.js
```

## Deploying

`vercel.json` is committed: framework Vite, `npm run build`, publish `dist/`,
**no environment variables**. See `docs/DEPLOY-VERCEL.md` — including the one
step outside this repository (point Supabase's Auth URL configuration at the
deployed address).

## The docs

| File | What it is |
|---|---|
| `docs/APP-SUMMARY.md` | what the app is and what every feature does, in plain language |
| `docs/SITE-ATTENDANCE.md` | setting a kiosk up, daily use, and the eight verification scenarios |
| `docs/DEPLOY-VERCEL.md` | deploying, and what to check afterwards |
| `docs/PROGRESS.md` | where the project stands, phase by phase |
| `docs/SUPABASE-SETUP.md` | the credentials, ranked by danger; what must never be shared |
| `docs/PHASE-0-ARCHITECTURE.md` | **historical** — the inspection made before any of this was built |

---

© 2026 Akaninyene — All rights reserved.
