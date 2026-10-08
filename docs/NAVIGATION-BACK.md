# Going back (§41)

*Written 6 October 2026, during the final QA pass. This is the one functional change
that pass made, and this file is the whole of it: what was wrong, what changed, and
what still has to be seen on a real phone.*

---

## The report

Two symptoms, and they were the same fault seen from two sides.

1. **In-app.** Stand on *More → Contractors → a contractor*, then **More → Settings →
   Connect**, and there was no obvious way up. The control that did exist was the
   words "More" or "All workers" with a glyph typed in front of them: 12px, in the
   quietest grey in the palette, no border, no background. It read as a caption. To
   use it you had to already know what the screen behind you was called.
2. **Android system Back.** On the installed PWA, several levels deep, the phone's
   own Back **closed the app** instead of stepping back one screen.

## The cause

The app has had a real router since Phase 3 (`src/lib/router.js`, a hash router so a
deep link works on any static host). Every destination — `/today`, `/people`,
`/more/contractors` — is an address, and every address press **does** create a
history entry. So the browser's history was never empty; it simply did not know
about the levels that lived in `useState`.

A screen that a component kept in state — a contractor opened from the More list, a
worker opened from the roster, **a category inside Settings** — was invisible to the
history. Android's Back asked the history to go back one entry; the history went
wherever the last *address-level* press had been, and when there was nothing behind
it, the app exited. Nothing was broken about the browser; the app had never told it
about those steps.

## The change

Smallest correct fix, in three parts, entirely inside the existing architecture. No
second router, no blanket `history.back()`, no new dependency.

1. **A depth on every history entry** (`src/lib/router.js`). The first entry is
   depth 0, each push is +1, and a `replace` keeps the depth it replaced. That makes
   "is there anywhere behind the reader?" a question the app can *answer* rather than
   guess:
   ```js
   export function back(fallback = HOME) {
     if (canGoBack()) { window.history.back(); return }
     navigate(fallback, { replace: true })   // deep link, notification, shortcut
   }
   ```
   A fresh launch on `/more/settings/earnings` has nothing behind it, so Back goes to
   the screen's logical parent instead of leaving the app.
2. **A level that was pure state became an address.** The seven Settings categories
   are `/more/settings/<category>` (profile, workplace, appearance, earnings,
   reminders, data, about). `settingsCategoryFor()` rejects anything that is not one
   of them, and `moreScreenFor()` still answers such an address with the **Settings**
   screen, so the workspace and the tab bar keep saying *Settings* while you are
   inside one. That is what lets Android Back step out of a category rather than out
   of the app.
3. **A control that looks like one** (`BackLink` in `src/ui/Ui.jsx`, `.dp-back` in
   `ui.css`): a chevron **icon** (not a typed glyph) with the word **Back**, in a
   bordered box at the tap-target floor, at the top of the page header, with an
   `aria-label` of `Back to <the screen it returns to>`. It is an `<a href>` wherever
   the parent is a real address — copyable, middle-clickable — and a `<button>` for
   the levels that are still state.

`closeSettings` and `back` use `replace`, so **Back can never walk the reader
forward** into the screen they just left.

## What Back does now

| Where you are | Back goes to | How |
|---|---|---|
| A Settings category | Settings | the address, or Android Back, one step |
| Settings (opened from More) | More | replace — More is already behind it |
| Connect / Kiosk / Billing / Reports / Notifications | More | the address |
| A contractor | More → Contractors | the address |
| A worker, from the roster | the roster | state-only level: `<button>`, same control |
| The personal tracker (opened from More) | More | the address |
| A deep link, opened cold | the screen's logical parent | `back(fallback)` — never an exit |
| The root (`/`) | exits the app | correct: that is the true root |

## What was verified, and what was not

**Verified (automation).** §41 A–F in `scripts/ui-check/nav.jsx` and `more.jsx`,
inside the 626-check UI harness, which renders the app in a real DOM:
A More→Contractors→Back→More · B a category → Android Back → Settings → Back → More ·
C three deep addresses, three steps back, each landing on a screen that can draw ·
D forward → Back → forward again, history sane · E a deep link opened directly, Back
never reaching an invalid destination · F the root has no depth and no Back control,
and one step in sets `dpDepth: 1`.
`tests/routes.test.js` proves every category is an address that resolves to a real
screen with a title, that junk categories resolve to nothing, and that the cards and
the routing table name the same seven categories.

**NOT PHYSICALLY VERIFIED.** Android's real Back gesture was simulated through the
DOM's own history — it was **not** tested on a physical Android device or an
installed PWA. That is the one item that needs a phone, and it is the next step in
`docs/PROGRESS.md`.

## To confirm on the phone (about three minutes)

1. Open the installed app on `/more`, tap **Contractors**, open one, tap **Back** —
   you are in the contractors list, not Today. Tap **Back** again — you are on More.
2. From More, open **Settings**, open **Connect**, then press the **system Back** —
   you are back in Settings, with the crumb still reading *Settings · Connect*.
   Press it again — you are on More. Again — Today. Again — the app closes.
3. Kill the app, open a deep link (e.g. `…/#/more/settings/earnings`), press system
   Back — you land on Settings, **not** outside the app.
4. Reload the page mid-way — you stay where you are, and Back still steps up.
