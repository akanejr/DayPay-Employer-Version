# What still needs a real device

Written in Phase 5. Everything here is **NOT PHYSICALLY VERIFIED**. Each item
says what *has* been proven automatically, what has not, and the smallest check
that would close it.

Nothing in this list is a known defect. They are claims the automated harness
structurally cannot make: jsdom has no layout engine, no touch, no GPU, no
radio, and no iOS.

---

## 1. iOS safe-area insets — outstanding by decision

**The situation.** Four declarations use `env(safe-area-inset-*)`:

| File | Line | What it pads |
|---|---|---|
| `src/index.css` | `:1405` | the sticky tab bar's bottom |
| `src/index.css` | `:1495` | a toast's top offset |
| `src/index.css` | `:1734` | the backup nudge's top offset |
| `src/ui/ui.css` | `:387` | a bottom sheet's padding |

`index.html` has no `viewport-fit`, so on iOS the browser insets the viewport
itself and every `env()` resolves to **0**. The declarations are inert.

**Why this is safe today.** iOS keeps the page inside the safe area, so no
control sits under the notch or the home indicator. The layout is correct — the
inset code simply never runs.

**Why it was left alone.** Adding `viewport-fit=cover` would activate the
insets *and* let content run to the physical edges — but `.header`
(`src/index.css:316–324`) has no `env(safe-area-inset-top)`, so the sticky
header would slide under the notch on every iPhone. That is a regression on a
device nobody here can hold. **Decision recorded: leave unchanged.**

**To close it.** On a notched iPhone: confirm the tab bar's last row is fully
tappable and nothing sits under the home indicator; confirm the sticky header
clears the status bar. If `cover` is ever added, `.header` must gain a top inset
in the same change.

---

## 2. Pinch-zoom, after the Phase 4 fix

`maximum-scale=1.0, user-scalable=no` was removed from `index.html` (WCAG 1.4.4
AA). Proven automatically: the built and served `index.html` carry
`width=device-width, initial-scale=1.0`, and `tests/deploy.test.js` fails the
build if either lock returns or if `touch-action: manipulation` disappears.

**Not proven:** that a thumb can actually pinch a payslip to 200% on Android
Chrome and iOS Safari, and that removing the lock did not reintroduce an
annoying double-tap zoom on the data-dense rows. `touch-action: manipulation` is
on `button` only, so double-tapping a non-button surface is the thing to watch.

---

## 3. Android hardware Back — carried from Phase 2

Proven automatically in jsdom: `scripts/ui-check/nav.jsx` §41 A–G, 22 assertions,
including `C · each Android Back moves exactly one logical step`
(`/more/settings → /more/contractors → /more`) and `G · Android Back out of the
kiosk returns to More, one step, not out of the app`. The Connect walk adds
`Android Back out of Connect lands on Settings`. `tests/routes.test.js` 24/24.

**Not proven:** that a physical Back key/gesture produces the same `popstate`
sequence as the harness simulates, and that the app never exits to the launcher
when it should step back. Check on a real Android phone, in Chrome and in the
installed PWA — they differ.

---

## 4. The kiosk on a real machine

`docs/SITE-ATTENDANCE.md` §21's ergonomics are asserted in CSS terms: keypad keys
**76px**, worker buttons **64px**, the answer set at **32–46px**, its supporting
sentence at **22px**, and it adapts to a tablet. 80/80 kiosk UI checks pass and
`tests/kiosk.test.js` proves the bundle imports no employer code (48/48).

**Not proven:** readability in daylight on a yard-facing screen, thumb reach at
the height a machine is actually mounted, glove use, and whether a queue of
people can complete contractor → name → PIN → code without hesitating.

---

## 5. The eight scenarios, by hand, against a real project

All eight are asserted automatically — `npm run prove` runs 45 assertions in
`scripts/integration/e2e.mjs` step 10, 18 of them labelled A–H, each printing
the value it observed. Migration chain 36/36, e2e 115/115, RLS 78/78, lockout
proven.

**Not proven:** the same eight walked in a browser against a live Supabase
project with `018` and `019` applied. The sandbox has **no outbound route to
Supabase**, so this cannot be done here at all. It needs the reviewer. Runbook:
`docs/SITE-ATTENDANCE.md` §4.

---

## 6. Offline / installed PWA behaviour

Proven automatically: `public/sw.js` lists all ten font paths in `APP_SHELL` and
degrades gracefully (`cache.addAll(APP_SHELL).catch(() => …)`);
`CACHE_NAME = 'daypay-employer-v2'` matches `APP_VERSION`; `manifest.json` is
complete (standalone, portrait, maskable icon, two shortcuts); every route and
font returns 200 from the preview server.

**Not proven:** install-to-home-screen on iOS and Android, a cold start in
airplane mode, and that a stale service worker does not serve an old shell after
a deploy.

---

## 7. Colour and type on real panels

Contrast is asserted to WCAG AA in both themes with a non-inverting hierarchy
(`tests/design.test.js`, 154 checks), the 11px floor holds, and no one-off text
sizes exist.

**Not proven:** legibility on a cheap Android panel in sunlight, and dark mode on
an OLED screen.

---

## 8. Tap sizes on hardware

The 44px floor is enforced across a named list of controls and now includes
`.sp-export-btn` (Phase 3 — it was rendering at 37.5px and had escaped because
the scan is a named list). `.dp-item` and `.dp-sec-action` are checked in
`src/ui/ui.css`.

**Not proven:** that 44px is comfortable for the actual hands using it, in the
actual conditions. That is a judgement only field use can make.
