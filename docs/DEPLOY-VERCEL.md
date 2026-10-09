# Deploying DayPay to Vercel

Three routes. **Route A needs no token, no CLI and no secrets** — the repository
already carries everything a build needs, so Vercel only has to build it.

> **Which route to use depends on one fact: is this work on GitHub yet?**
> Vercel builds from the GitHub branch, so a commit that only exists locally is not
> in any deployment. If the branch on GitHub is behind, use **Route C** — it deploys
> the same sources straight from your machine, with one command, and does not need
> GitHub at all.

---

## Why this works with no environment variables

`config/supabase-public.env` is **committed** and holds the project URL and the
publishable key. Both are designed to be public: they ship inside the browser
bundle on every load, and the key carries the `anon` role, so every read and
write is still filtered by Row Level Security.

`scripts/prepare-env.mjs` runs *before* Vite reads its config, copies those two
values into `.env` (which is gitignored, so it does not exist on Vercel), and
the build fails loudly if the bundle ends up without them. This was verified
with `.env` deleted:

```
✓ dist/ carries the Supabase config (crirzuoehbkzpnwokyxl)
```

So: **do not add environment variables in Vercel.** If you ever point at a
different Supabase project, that is the file to change — nothing else.

### Vercel will offer you an Environment Variables box. Leave it empty.

The import screen shows an **Environment Variables** section, and because
`.env.example` is committed it may even prefill the two *names*:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

That box is **optional**. Leaving it blank deploys correctly — the values come
from `config/supabase-public.env`, which the build reads. Filling it in would
not break anything, but it creates a second source of truth that can drift from
the repository, so the recommendation is to skip it.

If you do fill it in, use exactly these two values, and **only** these:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://crirzuoehbkzpnwokyxl.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable__dh7r1RnxEEEPuP08z1zEw_iPk6NywS` |

Three things then protect you, and all three were verified by triggering them:

1. **The secret key is refused.** The Supabase dashboard shows the publishable
   key and the `sb_secret_` key in the same panel. Pasting the wrong one fails
   the build with a sentence naming the variable — Vite gives host variables
   precedence over the file, so without this guard a service key would be
   compiled into the browser bundle:

   > `prepare-env: the environment sets VITE_SUPABASE_ANON_KEY to something that looks like secret key (sb_secret_…). It would be compiled into the browser bundle.`

2. **A different project is refused by default.** Two projects in one account
   and a URL copied from the wrong tab is the accident that hurts, so pointing
   at anything other than `crirzuoehbkzpnwokyxl` stops the build and names both
   projects. A deliberate staging target can be allowed with
   `DAYPAY_ALLOW_OTHER_PROJECT=1`.

3. **The bundle is checked against what actually shipped.** After the build the
   project ref is grepped out of the output, so a build that produced an
   unconfigured app fails instead of deploying one.

---

## Route A — deploy from GitHub (recommended)

### Step 1 — import

1. Go to **vercel.com → Add New → Project → Import Git Repository**.
2. Pick **`akanejr/DayPay-Employer-Version`**.
3. Vercel reads `vercel.json`, so the settings appear already filled:

   | Setting | Value |
   |---|---|
   | Framework Preset | Vite |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |
   | Install Command | `npm install` (from the committed lockfile) |
   | Environment Variables | **none — leave the box empty** |

4. **Deploy.** You get `https://<project>.vercel.app`.

### If the project already exists (DayPay is already deployed once)

Skip the import entirely: **Project → Deployments → Create Deployment →
Branch-Based → `arena/01a0cffa-daypay-employer-version` → Create Deployment**, then
**⋯ → Promote to Production** on the finished build. That is Steps 3 and 4 below,
without Steps 1 and 2.

### Step 2 — expect the first build to FAIL, and ignore it

This is the step that decides whether the deploy works, and the failure it
produces is alarming if nobody has warned you. It is also not what it looks
like: **nothing is wrong with the code.**

**The import screen has no Production Branch field.** It cannot have one: Vercel
chooses the production branch by itself, in a documented order — **`main`
first**, then `master`, then the repository's default branch. This repository
does have a `main`, and `main` is a placeholder: **one file, a README with a
single line of text.** No `package.json`, no lockfile, no application. All 162
files of the app are on `arena/01a0cffa-daypay-employer-version`.

So the first deployment builds a repository with nothing in it to install, and
it fails exactly like this:

```
Cloning github.com/akanejr/DayPay-Employer-Version (Branch: main, Commit: c5fd6f9)
sh: line 1: vite: command not found
Error: Command "vite build" exited with 127
```

That is the whole story of that error. There is no application on `main` for any
build command to succeed on. **No code was lost and nothing needs repairing** —
the fix is Step 3, which points Production at the branch that holds the app.

To confirm you are serving the right build afterwards, fetch:

```
https://<project>.vercel.app/sw.js
```

`CACHE_NAME = 'daypay-employer-v2'` is this branch. Anything else, or a 404,
means Production is still pointing somewhere that is not this branch.

### Step 3 — point Production at the right branch

**Project → Settings → Environments → Production → Branch Tracking** → set the
branch to **`arena/01a0cffa-daypay-employer-version`** → **Save**.

(Not *Settings → Git*; that page no longer holds this.)

### Step 4 — make it build that branch now

Changing Branch Tracking does not rebuild by itself. Pick one:

* **Deployments → Create Deployment → Branch-Based** → enter
  `arena/01a0cffa-daypay-employer-version` → **Create Deployment**; or
* push any commit to that branch — a push to the production branch *is* a
  production deployment; or
* if a deployment for that branch already exists in the list, open it →
  **⋯ → Promote to Production** (promotion reassigns the production domain
  without rebuilding).

Confirm `/sw.js` says `daypay-employer-v2`. That is the whole check.

> **If a preview deployment asks you to log in to Vercel**, that is Deployment
> Protection, not a broken build. The production domain is public.

Every later push to that branch redeploys automatically, and every other branch
gets its own preview URL. When you eventually merge this work into `main`,
change Branch Tracking to `main` and it follows.

---

## Route B — deploy from your own machine

```bash
git clone https://github.com/akanejr/DayPay-Employer-Version.git
cd DayPay-Employer-Version
git checkout arena/01a0cffa-daypay-employer-version

npm install
npm run build          # writes dist/, and proves the config shipped

npx vercel             # first run asks you to log in, then deploy a preview
npx vercel --prod      # and this one makes it the real site
```

No environment variables to set at any point.

---

## Route C — deploy the zip, with no GitHub and no clone

Use this when the branch on GitHub is behind the work you have (or when you would
rather not touch git at all). The zip is the same sources.

```bash
unzip DayPay-Employer-Version.zip -d daypay
cd daypay
npx vercel login          # first time only
npx vercel link           # choose the EXISTING project: daypay-employer-v2
npx vercel --prod         # build happens in Vercel, no env vars needed
```

Vercel installs the committed lockfile and runs `npm run build` from `vercel.json`,
so this produces the same files as Route A. Linking to the existing project is what
keeps the same `*.vercel.app` address and its Production domain.

Two things to know about this route:

* It is a **source** deployment, not a git one, so it does not become "the branch
  Vercel watches" — a later push to GitHub does not replace it, and a later deploy
  from the zip does not touch GitHub. That is fine for a one-off; Route A is the
  one to make permanent.
* If `vercel link` offers to create a *new* project instead, say no and link to
  `daypay-employer-v2` — a second project would be a second address, a second
  service-worker cache and a second place to configure Supabase Auth.

---

## The one step that will bite you if it is skipped

**Tell Supabase the new address.** Until you do, sign-up confirmation e-mails
will send people to `localhost`.

> Supabase Dashboard → **Authentication → URL Configuration**
> * **Site URL** → `https://<project>.vercel.app`
> * **Redirect URLs** → add `https://<project>.vercel.app/**`
>   (and keep `http://localhost:5173/**` if you still develop locally)

That is the only setting outside the repository that a deploy depends on.

---

## Verify after deploying

| Check | Where | Expected |
|---|---|---|
| The app loads | `https://<project>.vercel.app/` | the DayPay sign-in screen |
| The kiosk loads | `https://<project>.vercel.app/kiosk.html` | **DAYPAY / SITE ATTENDANCE** and "Sign in on this device" |
| Sign-in works | the app | you land on **Staff** (employer) |
| The kiosk links | `/kiosk.html` | sign in with a *separate* machine account, paste the code from Roster → Site attendance kiosk |
| §23 A–H | both surfaces | `docs/SITE-ATTENDANCE.md` §4 — the checklist, with the expected words |

Note the kiosk is at **`/kiosk.html`**, not `/kiosk`. That is deliberate: the
exact URLs are the ones already proven locally, and `cleanUrls` would add a
redirect layer in front of a page that runs unattended at a gate. If you later
want `/kiosk`, it is one line in `vercel.json` — but change it on a quiet day,
not on the day you deploy.

---

## What deploying does and does not change

**Does not change:** the database, the migrations, your data, the sandbox
preview in Arena, or anything about how the app works. Vercel serves static
files; every read and write still goes straight from the browser to your
Supabase project.

**Does change, and for the better:**

- **HTTPS everywhere.** Login, the kiosk and the service worker all want a
  secure origin. The kiosk's Copy button (clipboard API) only works on one.
- **Installing to a phone**, so the PWA is used the way it was designed.
- **A stable address** you can put on a kiosk machine and leave there.

---

## Host configuration, and why each line is there

`vercel.json` is short on purpose:

| Rule | Reason |
|---|---|
| `max-age=0, must-revalidate` on `/`, `/index.html` and `/kiosk.html` | an HTML file cached hard would keep pointing at asset names the next deploy has replaced. Revalidating means the browser asks, gets a 304 when nothing changed, and a fresh page when something did — correctness without paying for the whole file each visit |
| `Cache-Control: immutable` on `/assets/**` | every asset name carries a content hash, so it can be cached for a year safely |
| the same on `/sw.js` | a stale service worker is the classic "the site updated but my phone didn't" bug; revalidating on each load means a deploy rolls out on the next visit instead of being pinned by a cached worker |
| `X-Robots-Tag: noindex` on `/kiosk.html` | the kiosk has no business in search results |
| `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()` | the browser refuses these APIs at the door. No GPS was ever in this product — this makes it a property of the deployment rather than a promise about the code |
| `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, HSTS | standard hardening for a site that carries logins |

No `rewrites` block. The app *does* have addresses — since §41 every step worth
linking to is one, in a **hash** router (`/#/more/settings/earnings`) — and a hash
router is exactly why nothing here needs a rewrite: the fragment after `#` never
reaches the server, so every deep link is served the same single `index.html` by
default. A catch-all rewrite would add nothing and would turn a missing asset into
`index.html` served as JavaScript, which is a far more confusing failure than a
plain 404. If the router ever moves off the hash, this is the line to revisit.

---

## Notes

- The committed lockfile is what Vercel installs from, so the build is
  reproducible. `package.json` pins `engines.node` to `22.x` because Vite 8
  needs Node ≥ 20.19.
- The **Arena sandbox preview** and the Vercel site are independent. The preview
  is only alive while this session runs; Vercel is the durable address.
- Two Vercel-side things do not exist in this repository and are worth setting
  up once you have a domain: a custom domain (Vercel → Domains), and Supabase's
  own rate limits if the roster gets large (the anon key is public, so the
  database, not the host, is what protects your data).
