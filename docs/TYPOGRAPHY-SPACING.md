# DayPay — typography, spacing and alignment

*The pass that followed the §39 audit and §40 review, from the brief of the same
name. Visual only: no feature, route, calculation, permission or table was
touched. Every number below is in the repository and guarded by a test.*

---

## 1. What was actually wrong

The brief named one symptom:

> `ContractorsWho each worker answers to`

It was not a margin that was set too small. `.dp-item-title` and `.dp-item-sub`
were `<span>`s inside a plain `<span>`, so they were **inline**: one line box, no
separation, and the `margin-top: 1px` between them did **nothing at all** — a top
margin has no effect on an inline element. The pair looked right only when a
font's own metrics happened to leave a sliver of space, which is why it survived
every visual review and every screen check: jsdom has no layout, so no test could
see it.

The same shape existed in nine more places, in three files:

| Container | Held | Why it collided |
|---|---|---|
| `.dp-item-text` | row title + description | not a column (the reported bug) |
| `.ew-head-text` | page title + description | not a column, 4px margin |
| `.ew-att-body` | worker name + line | not a column, no-op 1px margin |
| `.ew-person-body` | roster name + facts | not a column, `margin-top: 2px` |
| `.ew-device-body` | machine name + line | not a column |
| `.ew-prof-body` | worker name + trade | not a column, `margin-top: 2px` |
| `.sp-title`, `.sp-rh-head`, `.sp-export-head`, `.dp-fold-main`, `.ks-site` | stacks | `gap: 1px` / `gap: 2px` |
| `.dp-item-sub`, `.ew-sub`, `.ew-att-sub`, `.ew-row-sub`, `.ew-inv-job` … | descriptions | margins of 1–2px instead of a gap |

And a second, quieter problem the brief also names: **~80 inline margins in JSX** —
`style={{ marginTop: 10 }}` at 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16 and 18px. No
audit in this repository can see a number inside a JSX attribute; no token scan
can see it; and it is the definition of a per-screen margin (§13).

Third: **the workspace had no page gutter.** The header's logo sits at 16px and
the tracker's pages inset themselves by 16px, so the app's left edge already
existed — but the employer screens put their blocks directly on `.ew`, which had
no side padding at all. A page title began at the glass while the row repeating
the same word began at 16px: two left edges on one screen.

---

## 2. The system

### Type roles — `src/index.css`

Aliases of the existing ramp, not a second scale, named for the job:

| Token | Resolves to | Role (brief's band) |
|---|---|---|
| `--fs-page` | `--fs-xl` 22px | page titles — 20–24, weight 600–700, `--lh-title` 1.25 |
| `--fs-section` | `--fs-xs` 13px | section headings — 13–15, weight 500–600, `--lh-row` 1.4 |
| `--fs-row` | `--fs-sm` 15px | card and row titles — 15–16, 500–600, 1.4 |
| `--fs-body` | `--fs-xs` 13px | supporting text — 13–14, 400, 1.4 |
| `--fs-nav` | `--fs-label` 12px | navigation labels — 12–14, 500 |
| `--fs-meta` | `--fs-2xs` 11px | small metadata — 11–12 |

### Rhythm — named for what it separates

| Token | Value | Meaning (brief) |
|---|---|---|
| `--gap-stack` | 4px | a title and its description (4–6) |
| `--gap-head` | 20px | under a page header (16–20) |
| `--gap-section` | 24px | between two sections (24–32) |
| `--gap-page` | 16px | the one horizontal page inset (16–20) |
| `--pad-row-y` / `--pad-row-x` | 16 / 16px | a list row (14–16 vertical, 16–18 horizontal) |
| `--sp-4h` | 20px | the step the scale was missing between 16 and 24 |

`--sp-1…6` (4/8/12/16/24/32) are untouched — 500+ rules read them.

### The text stack

Every container that puts a description under a title is a column flex whose gap
is `--gap-stack`, and **no description carries its own top margin inside one**
(the container's gap is the only mechanism, so the two cannot drift apart). This
is the fix for the reported bug, expressed once.

### Connector classes — `src/index.css`

`.dp-mt-*`, `.dp-mb-*`, `.dp-ml-*`, `.dp-mr-*`, `.dp-gap-*`, named for their size
and defined as the token of that size. They replace the ~80 inline margins. Each
old value moved to the **nearest** step of the scale; where a value sat exactly
between two steps it took the larger, because air is safer than a collision.

---

## 3. The page grid

```css
.ew :is(.ew-head, .dp-sec, .ew-glance, .ew-today-head, .ew-dash-block-title,
        .ew-dash-money, .ew-dash-note, .ew-screen-note, .ew-dash-foot,
        .ew-att-foot, .ew-more-foot, .ew-find):not(
  .ew-card *, .ew-sheet *, .ew-bill-row *, .dp-list *, .ew-person *,
  .dp-notice *, .ew-prof *, .ew-screen-info *, .ew-owe *, .ew-codebox *,
  .ew-corr-card *, .ew-corr-row *, .ew-dayrow *) {
  padding-inline: var(--gap-page);
}
```

Only the blocks that sit **directly on a page** are listed; the `:not()` is what
stops a block already inside a card, a sheet, a list or a person row from being
inset twice. Rows and cards carry the same 16px in their own padding. The result
is one claim that can be checked by eye on any screen: **every line of text in the
workspace begins 16px from the page's left edge — the same edge as the logo.**

Cards and notes whose horizontal padding was 12px (`.ew-pane-note`, `.ew-bill-row`,
`.ew-sheet`, `.ew-msg`) moved to `--pad-row-x`; the attendance day row
(`.ew-att-row`) and the roster row moved to the row rhythm (14–16 vertical).

---

## 4. What changed

| Area | Change |
|---|---|
| `src/index.css` | 6 type roles, 2 line heights, 3 rhythm values, `--sp-4h`, 17 connector classes; 8 stacks moved onto `--gap-stack`; 6 definitions moved onto the roles; 3 tiny margins replaced |
| `src/ui/ui.css` | the row's text stack (the reported bug), row insets, section rhythm 8px → 12px, the tab cell's padding, nav label role |
| `src/employer/employer.css` | the page grid; header text stack; page title onto `--fs-page` (19px → 22px); 7 text stacks; row, roster, attendance, billing, sheet, message and note insets; form gap 12px → 16px; field gap 4px → 8px; button box (centred label, 8px icon gap); the desktop rail's item gap |
| `src/kiosk/kiosk.css` | one stack onto the shared token — the kiosk is the visual standard and stays otherwise untouched |
| 16 JSX files | ~80 inline margins → connector classes; one inline `marginBottom: 12` → `.dp-mb-12` |

**Preserved:** every route, every string, every calculation, every read and write,
the dark identity and the full palette, the kiosk, the empty/loading/error states,
and the engine underneath all of it. Nothing was enlarged to create space
(§10) and no card was stretched (§12).

---

## 5. The guards, and proof that they work

`tests/design.test.js` gained four suites — *the type and rhythm system*, *the
More screen's rows are two lines*, *the spacing scale as it is used*, *the page
grid* — 17 tests, 144 in that file, 519 in the unit suite.

They are structural on purpose: a screenshot cannot fail a build, but "this
container is not a column" can.

Six deliberate mutations, each reverted and byte-verified:

| Mutation | Result |
|---|---|
| `.dp-item-text` back to a non-column | **caught** |
| `margin-top: 1px` back on `.dp-item-sub` | **caught** |
| an inline margin back in a screen | **caught** |
| a connector class loses its token (`11px`) | **caught** |
| a text stack given a 2px separation | **caught** |
| the page grid loses the page title | **caught** |

The same pass also caught two real defects in the codebase that reading had
missed: a `.dp-mb-20` class used on a screen but never defined (a silent no-op),
and `.ew-prof-body` — a worker's name and trade held apart by a 2px margin on an
inline-ish child, the reported bug's twin.

---

## 6. Where it still is not perfect

- **Nothing has been measured on a real phone in daylight.** The guards are
  structural, and jsdom has no layout engine: what is asserted is that the
  containers, gaps and tokens are right, not that a pixel lands where it should.
- **Two inline margins remain, both on SVG icons** (`marginLeft: 2`), and they are
  optical alignment rather than spacing; the inline-margin guard allows an `<svg>`
  and nothing else.
- **The 1–3px gaps that remain are allow-listed with a reason** — the calendar's
  hairline grid, a chip's letter over its number, a checkbox's nudge, a tick
  inside a 44px target. The list is in the test, and a new one fails the build.
- **The desktop layout inherits the phone rules**, so the rail, the capped
  `--content-max` column and the wide-screen grids were re-checked structurally
  but not measured.
