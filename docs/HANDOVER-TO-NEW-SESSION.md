# Handover — the Roster redesign and the UI/UX pass are built here, green, and need pushing

**Why this note exists:** the coding session that did this work had its pull
request merged, which closed its access to GitHub. The work is finished and
verified **on disk in this sandbox**, but it has not been pushed. A new session
must push it. Everything below is the exact procedure plus what to check.

---

## 1. What state this checkout is in, and why

`git log` shows `c5fd6f9 Initial commit`, and almost the whole app is **untracked**.
That is the sandbox reverting local git, not a broken repository. Do not try to
repair it with `git reset --hard` or `git clean` — that deletes the work. The
files on disk are correct and complete; only git's index is behind.

- **GitHub holds the truth.** The branch's last pushed commit is `226a09c`.
- Everything since then is in the working tree, and now also in local commits
  `87ffc1c`, `971ac61`, `81bc33e`, `5b15ffc`, `bd2a77a`, `705c549` and `a8595a1`,
  which sit on top of `c5fd6f9 Initial commit`. They therefore need re-parenting
  onto the remote tip before they can be pushed — see §2.
- `node_modules/`, `dist/`, `site/` and `.env` are gitignored, so `git add -A`
  picks up source only. `config/supabase-public.env` **is** tracked on purpose —
  it carries the publishable key, which is public by design.

## 2. Push it

**Read this first.** The commit that exists here sits on top of `c5fd6f9 Initial
commit`, because that is where the sandbox reverted `HEAD` — **not** on top of
`226a09c`, which is what the branch on GitHub holds. So a plain `git push` will be
rejected as non-fast-forward, and force-pushing is not allowed and not needed.
What you want is to re-parent the work onto the remote tip. `git reset --soft`
does exactly that: it moves the branch pointer and **never touches a single file**
in the working tree or the index.

```bash
cd /home/user/DayPay-Employer-Version

# 1. get the sandbox ready (node_modules is stripped between sessions)
npm install --silent
node scripts/prepare-env.mjs

# 2. see where the remote actually is
git fetch origin arena/01a0cffa-daypay-employer-version
git log --oneline -3 origin/arena/01a0cffa-daypay-employer-version   # 226a09c …
git log --oneline -3                    # c5fd6f9 Initial commit, then this work

# 3. re-parent the tree onto the remote tip. --soft ONLY moves the pointer:
#    the working tree and the staged files are untouched. Do NOT use --hard.
git reset --soft origin/arena/01a0cffa-daypay-employer-version

# 4. sanity-check BEFORE committing: the staged changes must be additions and
#    modifications against the remote, and must not delete files it has.
git diff --cached --stat origin/arena/01a0cffa-daypay-employer-version | tail -5
git diff --cached --name-status origin/arena/01a0cffa-daypay-employer-version | grep -c '^D'   # must be 0

# 5. commit the same tree again, now on top of what is already pushed
git commit -m "Roster redesign: one list with dividers, one filled button, one tab bar"

# 6. push, then confirm it is a fast-forward and not a force
git push origin arena/01a0cffa-daypay-employer-version
git log --oneline -2 origin/arena/01a0cffa-daypay-employer-version
```

If step 4 reports deletions, **stop** — the working tree is missing files the
remote has, and the right move is to recover them from the remote rather than to
commit over them. If the push is still rejected, **do not force it**: fetch and
look at what the remote has first; that commit is the one that was reviewed.

## 3. Verify before and after pushing

```bash
npm test         # 390 tests, 0 failures
npm run lint     # 0 errors, 13 warnings (all pre-existing in src/)
npm run build    # dist/ + dist/kiosk.html
npm run prove    # migration chain 36/36 · e2e 115/115 · RLS 78/78 · lockout PASS · screens 204/204
```

`npm run prove` now runs the screen proofs too. That is new — they used to be
run by hand, and this pass is why that changed (see §5).

## 4. What this pass changed

- **Typefaces are self-hosted.** Ten woff2 in `public/fonts/` (Manrope and Geist
  Mono, weights 400–800, ≈144 KB), declared in `src/fonts.css`, imported by both
  stylesheets, listed in `public/sw.js`'s `APP_SHELL`. No page and no script
  requests a font from a CDN any more.
- **₦ is a real glyph in all ten files**, built from each font's own `N` by
  `scripts/build-naira.py`. `public/fonts/manifest.json` records each file's
  sha256; `tests/design.test.js` fails if a shipped file stops matching.
- **The ink and the scale were measured and fixed**: two tokens were below WCAG
  AA (one at 2.58:1), the type ramp had ~20 one-off sizes, and tap targets were
  below 44px. The kiosk keeps its own deliberately larger scale.
- **Every screen has an address.** `src/lib/routes.js` holds the address table and
  the navigation as data (EMPLOYER_NAV, MORE_GROUPS); `src/lib/router.js` is the
  hash router (`useRoute`, `navigate`, `href`) with scroll memory. The employer's
  four destinations are Today · Attendance · People · More, and More holds
  Contractors, Site kiosk, Billing, Reports, the personal tracker and Settings.
  `/` means "wherever this account belongs" and `homeViewFor()` answers it.
  Adding a screen: put its address in routes.js, add it to the group list, and the
  tab bar and More screen render it without further edits. `tests/routes.test.js`
  fails if a destination and its address ever disagree.
- **The shell is split, so look in the right file.** `src/App.jsx` is the app shell
  (3,256 lines after Phase 2b, still one component — it owns the tracker's month
  view and the settings page). The employer tab shell is
  `src/employer/EmployerWorkspace.jsx` (171 lines) and **the roster pane is
  `src/employer/PeoplePane.jsx`** — `Staff`, `RateEditor`, `AddEmployee` and
  `currentRateFor`. Pure helpers live in `src/lib/format.js`, `src/lib/constants.js`
  and `src/lib/holidays.js`; `AnimatedAmount`/`NeutralAvatar` in `src/ui/Display.jsx`;
  `useExit` in `src/ui/useExit.js`. Two tests read those files as text — if you move
  code again, move the assertions in the same commit.
- **Release identity is `daypay-employer-v2`** — `APP_VERSION` in `src/App.jsx`
  must equal `CACHE_NAME` in `public/sw.js`, and a test enforces it.

## 4b. The Roster screen was redesigned (1 October, second pass)

Seven reported faults, all real, all fixed in `src/employer/EmployerWorkspace.jsx`
and its stylesheet: the contractor select sat on the row clipped to 116px; the
worker's own name was not rendered; the contractor appeared twice; four
same-weight buttons shared a row with Archive among them; two stacked tab bars
with different selected states and a heading that disagreed with its tab; two
stat cards and a kiosk paragraph pushing the list down; and the start month
printed as `2026-09`.

The brief's rules are asserted rather than eyeballed: **exactly one filled
button** in seven states, a **40px floor** on every control, **no ALL CAPS** in
the roster's panels (scoped, because `.ew-label` is shared), and every one of the
eight handlers re-driven in the harness — including Add contractor and Show
archived/Restore, which had no coverage anywhere before.

The Month / Year / Join / Staff switcher is **not removed**: it lives in the app
shell (`src/App.jsx`, `.seg-wrap`) and is simply not rendered while the Staff view
is open. The two stat cards still render on the other four panes.

## 5. Two real defects were found on 1 October, and both are fixed

1. **`src/App.jsx` still fetched Google Fonts at runtime**, via a `<style>` tag
   injected into the app root. The pages and stylesheets had been cleaned, so the
   design suite was green while every screen still pulled the CDN — which the
   service worker skips by design, so the fonts were never cached. Found by
   grepping the **built** bundle. The suite now scans every file that ships.
2. **The UI check had been testing nothing for a day.** Its fixtures were pinned
   to September 2026; the employer screen opens on the current month, so October
   1st put every fixture day off the calendar and the run died mid-suite. The
   messages it printed all read like a broken app. Fixtures now derive from
   today, `tests/harness.test.js` holds them to the calendar, and the runner runs
   the suite so it cannot rot unnoticed again.

## 6. Still outstanding, and not code

- **Supabase → Authentication → URL Configuration.** Set the Site URL to
  `https://daypay-employer-version-sigma.vercel.app` and add `/**` as a redirect
  URL. Until this is done, confirmation e-mails point at `localhost`.
- The live deployment serves the **previous** release (`daypay-employer-v1`)
  until this work is pushed and Vercel rebuilds.
- A browsable build is at `https://{port}-{sandboxId}.e2b.app` while
  `bash start-preview.sh` is running (serves `site/` on `0.0.0.0:5173`).
