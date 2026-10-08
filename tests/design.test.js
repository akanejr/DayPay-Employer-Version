/* The design system, held to its own rules.
 *
 * Everything asserted here was found by measuring the app rather than reading
 * it, and each check corresponds to a fault that was actually present:
 *
 *   · two ink tokens used for 44 pieces of meaning failed WCAG AA — one at
 *     2.58:1 against a 4.5:1 requirement, in a light theme read outdoors;
 *   · the type scale was declared and then bypassed ~20 times with one-off
 *     half-pixel sizes, which is what makes a screen look assembled;
 *   · 163 uses of 700/800 against 69 of 500, so nothing was emphasised;
 *   · tap targets of 30–42px on a phone held in one hand;
 *   · both typefaces fetched from a CDN the service worker deliberately skips,
 *     so they were never cached and every offline screen fell back to another
 *     font — with money, which is set in Geist Mono, losing its alignment;
 *   · and neither font contains ₦, so the most repeated glyph in a money app
 *     was drawn by the device's fallback typeface.
 *
 * A stylesheet cannot be reviewed by eye for any of these. That is the point of
 * this file.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as routes from '../src/lib/routes.js'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const CSS_FILES = ['src/index.css', 'src/employer/employer.css', 'src/kiosk/kiosk.css']

/* ── colour maths ─────────────────────────────────────────────────────────── */

const lum = (hex) => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
/** the value of a custom property, from whichever block defines it last */
const rawToken = (css, name, block = null) => {
  const scope = block ? css.slice(css.indexOf(block)) : css
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(scope)
  return m ? m[1].trim() : null
}
/** ...and resolved, because --text is defined as var(--daypay-navy) */
const token = (css, name, block = null, depth = 0) => {
  const value = rawToken(css, name, block)
  if (!value || depth > 4) return value
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)
  return ref ? token(css, ref[1], null, depth + 1) : value
}

describe('the ink is readable — measured, both themes', () => {
  const css = read('src/index.css')

  const themes = [
    { name: 'light', block: ':root', bg: '#FFFFFF', sunken: '#F7F8FA', elevated: '#FFFFFF' },
    { name: 'dark', block: '[data-theme="dark"]', bg: '#080C16', sunken: '#060A13', elevated: '#0D1528' },
  ]

  for (const t of themes) {
    for (const [name, min] of [['--text', 7], ['--text-2', 4.5], ['--text-3', 4.5], ['--text-4', 4.5]]) {
      test(`${t.name}: ${name} clears AA on every surface it is used on`, () => {
        const value = token(css, name, t.block)
        assert.ok(value, `${name} not found in ${t.block}`)
        const surfaces = { page: t.bg, sunken: t.sunken, card: t.elevated }
        for (const [where, hex] of Object.entries(surfaces)) {
          const ratio = contrast(value, hex)
          assert.ok(ratio >= min,
            `${name} (${value}) on ${where} (${hex}) is ${ratio.toFixed(2)}:1, below the ${min}:1 floor`)
        }
      })
    }

    test(`${t.name}: the ink hierarchy still descends — nothing inverts`, () => {
      const seq = ['--text', '--text-2', '--text-3', '--text-4']
        .map((n) => token(css, n, t.block))
      const ratios = seq.map((c) => contrast(c, t.bg))
      for (let i = 1; i < ratios.length; i++) {
        assert.ok(ratios[i] < ratios[i - 1],
          `${seq[i]} is not fainter than ${seq[i - 1]} — the hierarchy is inverted`)
      }
      assert.ok(ratios[3] >= 4.5, 'and the faintest step must still be readable')
    })
  }

  test('the failing values we replaced are gone, not just overridden', () => {
    const css = read('src/index.css')
    for (const dead of ['#98A2B3', '#4A5875']) {
      assert.ok(!css.includes(dead.toUpperCase()) && !css.includes(dead),
        `${dead} failed AA (2.58:1 and 2.74:1) and must not return`)
    }
  })
})

describe('one type scale, and nothing below the floor', () => {
  test('no stylesheet reaches below 11px, and no one-off sizes remain', () => {
    // 11px is the floor: this is read outdoors, one-handed, often in a queue.
    const offenders = []
    for (const file of CSS_FILES) {
      const css = read(file)
      for (const m of css.matchAll(/font-size:\s*([0-9.]+)px/g)) {
        const px = parseFloat(m[1])
        if (px < 11) offenders.push(`${file}: ${px}px`)
      }
    }
    assert.deepEqual(offenders, [], 'text below the 11px floor')
  })

  test('the app stylesheets use the ramp for every size', () => {
    // The site code, the owed figure and the PIN value are deliberately larger
    // than the ramp's top step and would look wrong shrunk onto it.
    const DISPLAY = ['28px', '34px', '36px', '42px']
    const hardcoded = []
    for (const file of ['src/index.css', 'src/employer/employer.css']) {
      for (const m of read(file).matchAll(/font-size:\s*([0-9.]+px)/g)) {
        if (!DISPLAY.includes(m[1])) hardcoded.push(`${file}: ${m[1]}`)
      }
    }
    assert.deepEqual(hardcoded, [],
      'off-ramp sizes — a half-pixel scale is not a scale, it is an accident')
  })

  test('the kiosk keeps its own larger scale, by design', () => {
    // The machine at a site is read standing up, often in sunlight, by someone
    // who is about to start work. Its sizes are deliberately bigger than the
    // phone's ramp and are NOT mapped onto it. What is asserted is the floor
    // and a sane ceiling — not that it matches the phone.
    const css = read('src/kiosk/kiosk.css')
    const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => parseFloat(m[1]))
    assert.ok(sizes.length > 10, 'the kiosk stylesheet should declare its own scale')
    for (const px of sizes) {
      assert.ok(px >= 13, `kiosk text at ${px}px is below its own floor, and this is a machine people walk up to`)
      assert.ok(px <= 64, `kiosk text at ${px}px is beyond any sensible size`)
    }
    assert.ok(Math.max(...sizes) >= 24, 'the kiosk needs at least one genuinely large size for its headings')
  })

  test('the ramp itself is monotonic, so "bigger" means bigger', () => {
    const css = read('src/index.css')
    const order = ['--fs-2xs', '--fs-label', '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl']
    const values = order.map((n) => parseFloat(token(css, n)))
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] > values[i - 1],
        `${order[i]} (${values[i]}px) must be larger than ${order[i - 1]} (${values[i - 1]}px)`)
    }
  })
})

describe('weight is used as emphasis, not as decoration', () => {
  test('bold is a minority of the type in both stylesheets', () => {
    for (const file of ['src/index.css', 'src/employer/employer.css']) {
      const weights = [...read(file).matchAll(/font-weight:\s*(\d+)/g)].map((m) => +m[1])
      const loud = weights.filter((w) => w >= 700).length
      const share = loud / weights.length
      assert.ok(share <= 0.35,
        `${file}: ${(share * 100).toFixed(0)}% of declarations are 700+ — when everything shouts, nothing is emphasised`)
    }
  })

  test('900 is never used, and 800 is reserved', () => {
    for (const file of CSS_FILES) {
      const weights = [...read(file).matchAll(/font-weight:\s*(\d+)/g)].map((m) => +m[1])
      assert.ok(!weights.includes(900), `${file} uses 900, which the ramp does not define`)
      const extrabold = weights.filter((w) => w === 800).length
      assert.ok(extrabold <= 6,
        `${file}: ${extrabold} uses of 800 — that weight belongs to the hero figure and the splash only`)
    }
  })
})

  describe('the fonts ship with the app', () => {
    const manifest = JSON.parse(read('public/fonts/manifest.json'))

    /* Every file that ships and could pull a typeface off the network.
     *
     * This check used to read the two HTML files and the three stylesheets, and
     * that was not enough: `src/App.jsx` was still injecting
     *     <style>{`@import url('https://fonts.googleapis.com/css2?family=…`}</style>
     * into the app root at runtime. Nothing in the pages or the stylesheets named
     * Google, so the suite was green while every screen still fetched Manrope and
     * Geist Mono from a CDN the service worker skips — which is the exact defect
     * the self-hosted fonts exist to end. Found on 1 October 2026 by grepping the
     * BUILT bundle rather than the sources. So the scan is now over the sources,
     * and over all of them.
     *
     * The pattern matches a REQUEST, not a mention: both files below talk about
     * fonts.googleapis.com in comments explaining why they no longer use it, and
     * a check that fails on its own documentation is a check nobody keeps.
     */
    const shipping = [
      'index.html', 'kiosk.html', 'specimen.html', 'public/sw.js', 'public/manifest.json',
      ...fs.readdirSync(path.join(REPO, 'src'), { recursive: true })
        .map((f) => `src/${f}`)
        .filter((f) => /\.(js|jsx|css|html)$/.test(f)),
    ]
    const REQUESTS_A_FONT = [
      /url\(\s*['"]?https?:\/\/fonts\.(googleapis|gstatic)\.com/,
      /(?:href|src)\s*=\s*['"]https?:\/\/fonts\.(googleapis|gstatic)\.com/,
      /['"`]https?:\/\/fonts\.(googleapis|gstatic)\.com\/css/,
    ]

    test('the scan covers more than the pages', () => {
      assert.ok(shipping.length >= 30, `only ${shipping.length} files to scan — the glob is wrong`)
      assert.ok(shipping.includes('src/App.jsx'), 'src/App.jsx is not being scanned')
    })

    test('no file that ships fetches a typeface from a CDN any more', () => {
      const offenders = []
      for (const file of shipping) {
        const body = read(file)
        for (const re of REQUESTS_A_FONT) {
          const hit = body.match(re)
          if (hit) offenders.push(`${file}  →  ${hit[0]}`)
        }
      }
      assert.deepEqual(offenders, [],
        'a typeface is still fetched from Google at runtime. The service worker skips\n'
        + 'those hosts by design, so the font is never cached and every offline screen\n'
        + 'falls back to another typeface — with money, which is set in Geist Mono,\n'
        + 'losing its alignment. The fonts are in public/fonts now; use them.')
    })

  test('every shipped font file exists and is the one that was verified', () => {
    for (const f of manifest.fonts) {
      const file = path.join(REPO, 'public/fonts', f.file)
      assert.ok(fs.existsSync(file), `${f.file} is missing`)
      const data = fs.readFileSync(file)
      assert.equal(data.length, f.bytes, `${f.file} changed size`)
      const hash = crypto.createHash('sha256').update(data).digest('hex')
      assert.equal(hash, f.sha256,
        `${f.file} is not the file whose U+20A6 coverage was verified — rebuild with ` +
        'scripts/build-naira.py and re-run this test, do not edit the manifest')
      assert.equal(f.naira, true, `${f.file} is not recorded as carrying the naira sign`)
    }
    assert.equal(manifest.fonts.length, 10, 'five weights of two families')
  })

  test('every weight the stylesheets ask for has a file', () => {
    const declared = [...read('src/fonts.css').matchAll(
      /font-family:\s*'([^']+)';\s*font-style:\s*normal;\s*font-weight:\s*(\d+);[\s\S]*?url\('([^']+)'\)/g)]
      .map((m) => ({ family: m[1], weight: m[2], url: m[3] }))
    assert.equal(declared.length, 10, '@font-face blocks in src/fonts.css')
    for (const d of declared) {
      const file = path.join(REPO, 'public', d.url.replace(/^\//, ''))
      assert.ok(fs.existsSync(file), `@font-face points at a file that does not exist: ${d.url}`)
    }
    const families = [...new Set(declared.map((d) => d.family))].sort()
    assert.deepEqual(families, ['Geist Mono', 'Manrope'])
  })

  test('the service worker caches them, so offline keeps its typeface', () => {
    const sw = read('public/sw.js')
    for (const f of manifest.fonts) {
      assert.ok(sw.includes(`/fonts/${f.file}`),
        `public/sw.js does not cache ${f.file} — it will fall back offline`)
    }
  })
})

describe('the controls can be hit with a thumb', () => {
  test('there is a single tap-target token and it is at least 44px', () => {
    const css = read('src/index.css')
    const tap = token(css, '--tap')
    assert.ok(tap, '--tap is not defined')
    assert.ok(parseFloat(tap) >= 44, `--tap is ${tap}; Apple asks 44pt and Material 48dp`)
  })

  test('the primary controls use it', () => {
    const css = read('src/index.css') + read('src/employer/employer.css')
    // Anchored to a whole selector, so `.ew-btn` cannot be satisfied by
    // `.ew-btn-primary` — which is how this check first passed on a button
    // that was still 38px.
    for (const sel of ['.icon-btn', '.nav-btn', '.segmented button', '.ew-btn']) {
      const block = new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 's').exec(css)
      assert.ok(block, `${sel} not found as a rule of its own`)
      assert.ok(/var\(--tap\)/.test(block[1]),
        `${sel} does not use var(--tap) — a 38px target is a mis-tap on a phone`)
    }
  })
})
/* ── the roster screen, held to the layout it was redesigned to ─────────────
 *
 * Seven faults were reported on this screen, and every one of them is a fact
 * about the markup or the stylesheet that a reviewer should never have to
 * re-check by eye:
 *
 *   · the contractor select sat on the row and, at `max-width: 116px`, clipped
 *     the rate and the status text beside it;
 *   · the worker's own name was not rendered anywhere on the card;
 *   · the contractor appeared twice — once as the select, once as a chip;
 *   · four same-weight buttons shared a row, Archive among them looking like
 *     the other three;
 *   · two stacked tab bars with different selected states, one saying "Staff"
 *     and one saying "Roster", and the heading said "Staff" too;
 *   · two stat cards and a paragraph about kiosks pushed the list down;
 *   · the start date printed as the raw key "2026-09".
 *
 * These assertions are the shape of the answer, not a description of it. */
describe('the roster screen says one thing at a time', () => {
  const css = read('src/employer/employer.css')
  /* As of Phase 2b this screen is two files: EmployerWorkspace.jsx owns the tab
     shell and PeoplePane.jsx owns the roster pane itself. These assertions are
     about the screen an employer sees, so they read both — shell first, which
     keeps the slices below (activeList, rowBlock) meaningful because the roster
     markup is entirely in the second one. */
  const jsx = read('src/employer/EmployerWorkspace.jsx') + '\n'
    + read('src/employer/PeoplePane.jsx')
  const rule = (sel) => {
    const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 's').exec(css)
    assert.ok(m, `${sel} is not a rule of its own`)
    return m[1]
  }

  test('the heading and the tab agree on what this screen is called', () => {
    /* Phase 3 renamed this screen to People and gave it an address, so the tab
       no longer sets a pane string — the address names the pane. The guarantee
       is what it always was: one screen, one name, reachable by the thing that
       says its name. */
    assert.match(jsx, /<h2 className="ew-title">People<\/h2>/,
      'the heading does not say People, so the tab and the title disagree')
    assert.ok(jsx.includes("pane === 'people'"),
      'no destination renders the People pane, so the tab that names it does nothing')
    assert.ok(read('src/lib/routes.js').includes("people: '/people'"),
      'the People destination has no address, so it cannot be linked to or returned to')
  })

  test('the counts are a line of text, not two stat cards', () => {
    assert.match(jsx, /on roster, \$\{ratesSet\} with/, 'the summary line is gone')
    /* Phase 4 extended this to Today. On both screens the numbers those cards
       carry are now stated as an answer — "18 of 21 recorded today", plus a
       named row for anyone whose rate is missing — so the cards would be a
       second way of saying it, and on a phone they push the answer down. */
    /* Phase 4 stopped the cards being drawn on Today — whose answer is already
       "18 of 21 recorded today" — and Phase 6 stopped them everywhere. The two
       numbers are one line of context on Attendance now: the last screen that has
       nowhere else to state them. A card is a thing to read before the thing you
       came for. */
    assert.ok(!/<div className="ew-stat\b/.test(jsx),
      'the shell is drawing stat cards again — the numbers are one line now')
    assert.match(jsx, /\{pane === 'attendance' && \(/,
      'the line of context is not scoped to the one pane that has nowhere else to say it')
    assert.match(jsx, /ew-glance/,
      'the two numbers have no line to live on')
  })

  test('the roster is one list with dividers, not a card per person', () => {
    assert.ok(rule('.ew-list'), '.ew-list is missing')
    const divider = rule('.ew-row + .ew-row')
    assert.ok(/border-top:\s*1px solid/.test(divider),
      'rows are not separated by a hairline divider, so the list does not read as one list')
    assert.ok(jsx.includes('className="ew-list"'), 'the rows are not inside the list container')
    assert.ok(!/className="ew-person"[^>]*key=\{e\.id\}/.test(jsx),
      'a worker row is still an .ew-person card')
  })

  test('the row names the person, and says trade and contractor as one line', () => {
    assert.ok(rule('.ew-row-name'), 'there is no name element on the row')
    /* Scoped to the ACTIVE roster, not the file. The archived rows below use the
       same `.ew-row-name` element, so a file-wide search for {e.full_name} is
       satisfied by one of those while the live row renders nothing — which is
       exactly how this check first passed against a mutation that deleted the
       name from the row an employer actually looks at. */
    const activeList = jsx.slice(jsx.indexOf('className="ew-list"'), jsx.indexOf('{inviteFor && ('))
    assert.ok(activeList.length > 200, 'the active roster block was not found')
    /* Phase 6 turned the row into a door: the top half of it is a button that
       opens the person, so the name and the sub-line are spans now — a button may
       only hold phrasing content. The rule is unchanged, and so is the reason the
       assertion is scoped to the active block rather than to the whole file. */
    assert.ok(activeList.includes('<span className="ew-row-name">{e.full_name}</span>'),
      'the worker\'s own name is not rendered on the roster row')
    const door = activeList.slice(activeList.indexOf('ew-row-open'))
    assert.ok(door.indexOf('{e.full_name}') < door.indexOf('</button>'),
      'the name is outside the button, so pressing the worker\'s name does nothing')
    assert.match(activeList, /\[e\.job_title, supplier\]\.filter\(Boolean\)\.join\(', '\)/,
      'the sub-line is not "Trade, Contractor"')
  })

  test('the contractor is in the overflow, not on the row', () => {
    // The select was on the row, capped at 116px, clipping its neighbours.
    const rowBlock = jsx.slice(jsx.indexOf('className="ew-row-top"'), jsx.indexOf('className="ew-menu"'))
    assert.ok(!/<select/.test(rowBlock),
      'a select is back on the main row — it clipped the rate and the status last time')
    assert.ok(jsx.includes('ew-menu-select'),
      'the contractor select is not in the overflow menu at all')
    assert.ok(/max-width:\s*none/.test(rule('.ew-menu-select')),
      'the select keeps its 116px cap inside the menu, where it has room')
  })

  test('the contractor is named once, not twice', () => {
    // It used to be a select AND a chip on the same row.
    assert.ok(!/contractorName\(e\.contractor_id\)\) && \(\s*<span className="ew-chip"/.test(jsx),
      'the contractor appears as a chip as well as a control')
  })

  test('one contextual action is visible, and it depends on the login', () => {
    assert.match(jsx, /\{st\.registered \? 'Rates' : 'Send invite'\}/,
      'the contextual action no longer distinguishes registered from not')
    assert.ok(jsx.includes('ew-btn-accent'),
      'the unregistered action has no accent treatment — it looks like a leftover')
    assert.ok(/\.ew-btn-accent\s*\{[^}]*var\(--green-ink\)/.test(css),
      'the accent button does not use the green ink')
  })

  test('everything else is behind an overflow that opens inline', () => {
    assert.match(jsx, /aria-expanded=\{open\}/, 'the overflow trigger does not say whether it is open')
    assert.ok(jsx.includes('className="ew-menu"'), 'there is no inline menu')
    assert.ok(/\.ew-menu\s*\{/.test(css), '.ew-menu is not styled')
    // Inline means it is inside the row, not positioned over the page.
    assert.ok(!/position:\s*(absolute|fixed)/.test(rule('.ew-menu')),
      'the menu floats — on a phone it covers the row it belongs to')
    assert.ok(jsx.includes('Reset PIN'), 'Reset PIN left the menu')
  })

  test('the employer screens say things in sentence case', () => {
    /* The brief: sentence case, no excessive uppercase. Phase 6 turned the caps off
       inside the roster's own panels with a scoped override; Phase 9 moved the
       shared style itself, which is why the override is gone — the alternative was
       eleven other micro-labels still shouting, each needing its own exception.
       The one thing that keeps its capitals is a CODE, because a site code is read
       out loud at a kiosk and two characters must not be able to be confused. */
    assert.ok(/\.ew-label\s*\{[^}]*text-transform:\s*none/.test(css),
      '.ew-label is not sentence case')
    assert.ok(!/\.ew-roster-panel \.ew-label\s*\{/.test(css),
      'the roster still carries its own override, so the shared style did not move')

    const shouting = [...css.matchAll(/^([^{}\n]+)\{[^}]*text-transform:\s*uppercase/gm)]
      .map((m) => m[1].trim())
    assert.deepEqual(shouting, ['.ew-code'],
      `these rules still shout: ${shouting.join(', ')}`)
  })

  test('no panel opened inside People brings a second filled button', () => {
    /* The screen's one filled button is Add. Each panel that opens inside the
       roster had a solid submit of its own — which produced two solid buttons
       when a panel was open beside Add, and none at all in the one case where the
       panel's own button was already a ghost.
  
       Phase 3 took contractor management out of the roster to its own address
       under More, so this is two rules now: nothing that renders inside People may
       bring a filled button of its own, and the screen that does own a form keeps
       exactly one filled button in every state it can be in. */
    assert.ok(!read('src/employer/PinPanel.jsx').includes('ew-btn-primary'),
      'PinPanel carries a filled button, so the roster can show two')
    assert.ok(!read('src/employer/PeoplePane.jsx').includes('ContractorEditor'),
      'the contractor editor is rendered inside the roster again — it is a screen under More')
    assert.match(read('src/employer/ContractorEditor.jsx'), /\{!adding && editingId === null && \(/,
      'the contractor screen keeps its Add filled while a row is being renamed, so two solid ' +
      'buttons are on screen at once')
    assert.match(jsx, /\{!adding && !rateFor && !inviteFor && \(/,
      'the Add button is not hidden while a share form with its own action is open')
  })

  test('Archive is last, in danger, and asks first', () => {
    // It has to be the LAST menu item, so the destructive one is never the
    // control a thumb lands on while reaching for something above it.
    const items = [...jsx.matchAll(/className="ew-menu-item([^"]*)"/g)].map(m => m[1])
    assert.ok(items.length >= 2, `only ${items.length} menu items found`)
    assert.ok(/is-danger/.test(items[items.length - 1]),
      `the last item in the menu is "${items[items.length - 1].trim() || 'a plain item'}" — ` +
      'the destructive one must be last, never the control a thumb lands on ' +
      'while reaching for the one above it')
    assert.ok(/\.ew-menu-item\.is-danger\s*\{[^}]*var\(--danger\)/.test(css),
      'the danger menu item does not use the danger ink')
    assert.ok(jsx.includes('ew-confirm') && jsx.includes('Yes, archive'),
      'archiving happens on one press, with no confirmation step')
    assert.ok(/Move \{e\.full_name\} off the roster\?/.test(jsx),
      'the confirmation does not say what it will do')
  })

  test('no text on the row falls below 12px', () => {
    for (const sel of ['.ew-row-name', '.ew-row-sub', '.ew-row-note', '.ew-contractor-who']) {
      const m = /font-size:\s*var\(--(fs-[a-z0-9]+)\)/.exec(rule(sel))
      assert.ok(m, `${sel} does not take its size from the ramp`)
      const px = parseFloat(new RegExp(`--${m[1]}:\\s*([0-9.]+)px`).exec(read('src/index.css'))[1])
      assert.ok(px >= 12, `${sel} is ${px}px, below the 12px floor this brief sets`)
    }
    // the row's chips are lifted off their 11px default
    assert.ok(/\.ew-row \.ew-chip\s*\{[^}]*--fs-label/.test(css),
      'the status chip is still 11px on the roster row')
  })

  test('the two rows that used to sit at the foot of the roster are gone', () => {
    /* Phase 2b made kiosk and contractor management two compact rows under the
       worker list instead of two more cards. Phase 3 gave them addresses under
       More; Phase 8 made them screens. A compact row is the right shape for
       housekeeping you reach from a list — it is the wrong shape for a screen you
       arrive at by name, and leaving the CSS behind would leave the next screen
       free to grow a second, quieter header. */
    for (const file of ['src/employer/DevicePanel.jsx', 'src/employer/ContractorEditor.jsx']) {
      assert.ok(!read(file).includes('ew-tool'),
        `${file} still renders the roster's compact tool row`)
    }
    assert.ok(!/^\.ew-tool\b/m.test(css) && !/^\.ew-tool-row\b/m.test(css),
      'the tool-row styling outlived the two screens that used it')
    assert.ok(!/^\.ew-tool-sub\b/m.test(css) && !/^\.ew-tool-title\b/m.test(css),
      'the tool-row text styles outlived the two screens that used them')
  })

  test('the tab bar scrolls rather than crushing five labels', () => {
    const tabs = rule('.ew-subtabs')
    assert.ok(/overflow-x:\s*auto/.test(tabs), 'the tab bar cannot scroll')
    assert.ok(/white-space:\s*nowrap/.test(rule('.ew-subtab')), 'a tab label can wrap mid-word')
  })
})

/* ── the app shell's share of the same brief ─────────────────────────────── */
/* ── the design system ───────────────────────────────────────────────────────
 *
 * Phase 2 of the DayPay 2.0 redesign. src/ui/ is the set of names the screens
 * are built from in phases 4–13, so it is held to the same rules as everything
 * else — and to two of its own:
 *
 *   · every value is a token. A design system that hard-codes #15803D is one
 *     that will disagree with itself the moment the theme changes.
 *   · it is actually reachable. A stylesheet nothing imports is a drawing.
 */
describe('the design system', () => {
  const ui = read('src/ui/ui.css')
  const components = read('src/ui/Ui.jsx')
  /* A token's size in px, following ONE level of alias: the v26 type ROLES
     (`--fs-page`, `--fs-row`, …) are names for a ramp step, not a second scale, so
     a component that says `var(--fs-row)` is still on the ramp and still has to
     clear the floor. */
  const rampPx = (name) => {
    const root = read('src/index.css')
    const direct = new RegExp(`${name}:\\s*([0-9.]+)px`).exec(root)
    if (direct) return parseFloat(direct[1])
    const alias = new RegExp(`${name}:\\s*var\\((--fs-[a-z0-9]+)\\)`).exec(root)
    assert.ok(alias, `${name} is neither a size nor an alias of one`)
    return rampPx(alias[1])
  }
  const blockOf = (sel, css) => {
    const m = new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 's').exec(css)
    assert.ok(m, `${sel} is not a rule of its own`)
    return m[1]
  }

  test('it is imported by the application shell', () => {
    assert.ok(read('src/main.jsx').includes('ui/ui.css'),
      'src/main.jsx does not import the design system, so none of it applies')
    assert.ok(components.includes('export function Section'),
      'the components module exports nothing')
  })

  test('no colour is written by hand', () => {
    // A literal colour is one that will not follow the theme.
    const literals = [...ui.matchAll(/#[0-9a-fA-F]{3,8}|rgba?\(/g)].map(m => m[0])
    assert.deepEqual(literals, [],
      `ui.css writes colour by hand: ${literals.join(', ')}. Every ink and surface is a token.`)
  })

  test('every size comes from the ramp and nothing is below 12px', () => {
    const sizes = [...ui.matchAll(/font-size:\s*([^;]+);/g)].map(m => m[1].trim())
    assert.ok(sizes.length >= 8, `only ${sizes.length} font sizes found — the scan is wrong`)
    for (const size of sizes) {
      const m = /^var\(--(fs-[a-z0-9]+)\)$/.exec(size)
      assert.ok(m, `font-size: ${size} is not a ramp token`)
      assert.ok(rampPx(`--${m[1]}`) >= 12,
        `font-size: ${size} is ${rampPx(`--${m[1]}`)}px, below the 12px floor this brief sets`)
    }
  })

  test('every tappable row clears the tap floor', () => {
    for (const sel of ['.dp-item', '.dp-sec-action']) {
      const body = blockOf(sel, ui)
      const tap = /min-height:\s*var\(--tap\)/.test(body)
      const px = tap ? 44 : Number(/min-height:\s*([0-9]+)px/.exec(body)?.[1])
      assert.ok(px >= 40, `${sel} floors at ${Number.isNaN(px) ? 'nothing' : px + 'px'} — below the 40px a thumb needs`)
    }
  })

  test('a status chip carries a word, never colour alone', () => {
    assert.ok(/\.dp-chip::before/.test(ui), 'the chip has no dot')
    assert.ok(/\.dp-chip::before\s*\{[^}]*content:/.test(ui), 'the dot is not drawn in CSS')
    assert.ok(components.includes('{children}'), 'the chip renders no text')
  })

  test('motion stops for anybody who asked it to', () => {
    const reduced = [...ui.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g)]
      .map(m => m[1])
    assert.ok(reduced.length >= 2, `only ${reduced.length} reduced-motion blocks`)
    assert.ok(reduced.some(b => /\.dp-skel::after/.test(b)),
      'the skeleton keeps shimmering for somebody who asked motion to stop')
    assert.ok(reduced.some(b => /\.dp-progress-bar/.test(b)),
      'the progress bar keeps animating')
  })

  test('a keyboard can see where it is', () => {
    assert.ok(/:focus-visible\s*\{[^}]*outline:/.test(ui),
      'there is no focus ring, so a keyboard user cannot see where they are')
    assert.ok(!/(^|\n)\s*\*?:focus\s*\{/.test(ui),
      'the ring is on :focus, which draws it for a tap as well')
  })
})

describe('every control on the roster clears the forty-pixel floor', () => {
  const css = read('src/employer/employer.css')
  const rule = (sel) => {
    const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 's').exec(css)
    assert.ok(m, `${sel} is not a rule of its own`)
    return m[1]
  }

  /* The brief sets the floor at 40px; the house token --tap is 44px, so the
     check is against the token rather than the number. A rule with no floor at
     all is the failure this is looking for — a 35px-tall trigger looks fine in
     a screenshot and is a miss under a thumb. */
  const controls = [
    ['.ew-more', 'the overflow trigger'],
    ['.ew-menu-item', 'an item in the overflow'],
    ['.ew-text-btn', 'the "Show archived" toggle'],
    ['.ew-menu-select', 'the contractor select in the overflow'],
    ['.ew-subtab', 'a tab in the bar'],
    ['.ew-btn', 'every button'],
  ]
  for (const [cls, what] of controls) {
    test(`${what} has a floor of at least 40px`, () => {
      const body = rule(cls)
      const m = body.match(/min-height:\s*([^;]+);/)
      assert.ok(m, `${cls} sets no min-height at all`)
      const value = m[1].trim()
      const px = value === 'var(--tap)' ? 44 : Number.parseFloat(value)
      assert.ok(Number.isFinite(px) && px >= 40,
        `${cls} floors at ${value}, below the 40px a thumb needs`)
    })
  }
})

describe('the shell stops saying the same thing twice', () => {
  const app = read('src/App.jsx')

  test('the start month is written as a month, not as a database key', () => {
    assert.ok(!/Started \$\{startMonthKey\}/.test(app),
      'the raw key "2026-09" is still printed next to the email')
    assert.ok(/Started \$\{startLabel\}/.test(app), 'the formatted start label is not used')
    assert.ok(/getMonthName\(sm, true\)/.test(app), 'the month is not shortened to "Sep"')
  })

  test('the greeting never falls back to the email address', () => {
    assert.ok(/const greetingName = [^\n]*\|\| ''/.test(app),
      'the greeting name still falls back to something derived from the email')
    assert.ok(!/Hi, \{displayName\}/.test(app),
      'the greeting still prints displayName, which is the email\'s local part when ' +
      'the account has no name — that is how "Hi, infopromptpilot" happens')
  })

  test('the app-level switcher is not stacked above the employer screens', () => {
    /* The switcher belongs to the personal tracker, which is the product for
       somebody without an employer account. The employer has the four
       destinations instead — one navigation, not two stacked bars with two
       different selected styles, which is the fault this project started with.
       A business account therefore sees the switcher nowhere, and the tracker it
       opens from More carries a way back instead. */
    assert.ok(app.includes("{view !== 'staff' && !(user && roles?.isBusiness) && ("),
      'Month/Year/Join/Staff still renders for a business account, which already has ' +
      'the four destinations and their own selected state')
    for (const label of ['Month', 'Year', 'Staff']) {
      assert.ok(app.includes(`>${label}</button>`),
        `the ${label} control was removed from the codebase — it must be left intact`)
    }
    assert.ok(app.includes('<BackLink'),
      'a business account that opens the tracker from More has no way back to it')
  })
})


/* ── Today, the command centre (Phase 4) ──────────────────────────────────────
   Three rules about the employer's first screen, each here because breaking it
   would be invisible in a screenshot:

     · it records nothing. Marking a day is a deliberate act on the screen that
       exists for it; a mis-tap on an overview is how somebody is paid for a day
       they did not work, with the amount frozen on confirm.
     · it does not total the month a second way. monthFigures() wraps the same
       summarise() the Summary pane and the payslip use — a second total is a
       second answer, and the two will disagree.
     · it did not drop the one thing that was already there. The site attendance
       code is not in the four destinations, so this screen is the only place an
       employer running a kiosk opens it — exactly what a tidier screen loses
       without anybody noticing.

   Copyright © 2026 Akaninyene. All rights reserved. */

describe('Today records nothing', () => {
  const dash = read('src/employer/Dashboard.jsx')

  test('Today imports no way to write a day', () => {
    const imported = (dash.match(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\.\/lib\/employer'/) || [])[1] || ''
    const verbs = ['setDay', 'confirmDay', 'clearDay', 'disputeDay', 'reopenDay',
      'requestCorrection', 'resolveCorrection', 'withdrawCorrection']
    const found = verbs.filter(v => imported.includes(v))
    assert.deepEqual(found, [],
      `Today imports a way to write a day (${found.join(', ')}). The command centre is a ` +
      'place to READ the day; recording it belongs on Attendance, where the employer meant it.')
  })

  test('and there is no second way to total the month', () => {
    /* Prose is stripped first. The comment above this screen's money explains WHY
       monthFigures is the only source, and a comment must not read as code — a
       check that cannot tell them apart fails on its own documentation. */
    const code = dash.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    assert.ok(code.includes('monthFigures('),
      'Today stopped using monthFigures(), the same source as the Summary pane and the payslip')
    assert.ok(!/\bsummarise\s*\(/.test(code),
      'Today totals the month itself — two totals for one month will eventually disagree')
  })

  test('the site attendance code still has its home here', () => {
    assert.ok(/<AttendancePanel/.test(dash),
      'the attendance panel was dropped from Today. It is not one of the four destinations, ' +
      'so this screen is the only place an employer running a site kiosk opens it.')
  })
})


/* ── Attendance (Phase 5) ─────────────────────────────────────────────────────
   This is the only screen that writes a day into the ledger, so its rules are
   about what must NOT happen as much as what must:

     · the employer cannot choose 'weekend'. The date decides that, because it
       carries the multiplier — a screen that let a plain day be recorded as
       weekend work would pay double for a Tuesday;
     · nothing but the button writes. A row that marks on a stray tap is how a
       day gets recorded for somebody who was not there;
     · the screen sends no rate and no amount, and adds up no money of its own.
       The server values each day from the rate period in force; a total
       computed here would be a second answer to a question the payslip answers;
     · every action says what happened, in a live region, because on a phone the
       row that changed is often below the fold.

   Copyright © 2026 Akaninyene. All rights reserved. */

describe('Attendance writes one day at a time', () => {
  const src = read('src/employer/StaffDays.jsx')
  /* Prose is stripped: the comment at the top of this screen explains why no
     amount is ever sent, and a check that cannot tell a comment from code fails
     on its own documentation. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  test('the employer chooses a kind, but never the weekend one', () => {
    const kinds = (code.match(/const KINDS = \[([^\]]*)\]/) || [])[1] || ''
    assert.equal(kinds.replace(/[\s'"]/g, ''), 'work,overtime,holiday,leave',
      'the manual kinds changed. weekend is decided by the DATE and carries the multiplier — ' +
      'offering it as a choice is a way to pay double for an ordinary day')
    assert.ok(code.includes('suggestedKind('),
      'the screen no longer asks the date what kind a day is')
  })

  test('only the button writes — never the row', () => {
    assert.ok(!/ew-att-row[^>]*onClick/.test(code),
      'the person row has a click handler, so a stray tap records a day')
    assert.ok(/onClick=\{onToggle\}/.test(code),
      'the Mark control is gone, and nothing can be recorded')
  })

  test('no rate and no amount is ever sent, and no money is added up here', () => {
    assert.ok(!/\b(rate|amount)\s*:/.test(code),
      'the screen is building a day WITH a rate or an amount. The server values the day ' +
      'from the rate period in force; sending a figure is how the two disagree')
    assert.ok(!code.includes('reduce('),
      'the screen totals money itself — that is monthFigures()\'s job, and the payslip ' +
      'reads the same function')
    assert.ok(code.includes('monthFigures('), 'the month figures are no longer the engine’s')
  })

  test('every action is confirmed in a live region', () => {
    assert.ok(/role="status"/.test(src) && /aria-live="polite"/.test(src),
      'nothing announces what just happened, so a tap that saves a day silently is ' +
      'indistinguishable from one that failed')
  })

  test('the screen is called what its destination is called', () => {
    assert.ok(/<h2 className="ew-title">Attendance<\/h2>/.test(src),
      'the screen still introduces itself as something else')
  })
})

/* ── People, held to what makes a list findable ──────────────────────────────
 *
 * Phase 6 gave the roster a search, a filter for the two account states, and a
 * row that opens the person. Each of the three is easy to fake:
 *
 *   · a search that matches a second way, so "the same search" finds different
 *     people on different screens. The rule lives in employerLogic.filterPeople,
 *     is unit-tested in tests/employer.test.js, and this screen must USE it;
 *   · a filter whose words are not the words printed on the row, so the tab and
 *     the chip can end up describing different people;
 *   · a row that looks pressable and is not, or one that swallows the three-dot
 *     menu that sits on the same row;
 *   · a "nothing matched" state that is a blank pane.
 */
describe('People finds people, and every row opens one', () => {
  const jsx = read('src/employer/PeoplePane.jsx')
  const logic = read('src/lib/employerLogic.js')
  const css = read('src/employer/employer.css')
  const rule = (sel) => {
    const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 's').exec(css)
    assert.ok(m, `${sel} is not a rule of its own`)
    return m[1]
  }

  test('the search is the engine’s rule, not a second one', () => {
    assert.ok(logic.includes('export function filterPeople('),
      'the matching rule has no home in the engine, so each screen would grow its own')
    assert.match(jsx, /import \{[^}]*filterPeople[^}]*\} from '\.\.\/lib\/employer'/s,
      'the roster does not import the engine’s search')
    assert.ok(jsx.includes('filterPeople('),
      'the roster does not search with it')
    // and every list on the screen is filtered, not just the visible one
    assert.ok((jsx.match(/filterPeople\(/g) || []).length >= 2,
      'the archived list is searched by a different rule than the active one')
  })

  test('the box says what it searches, and how to empty it', () => {
    assert.ok(jsx.includes('type="search"'),
      'the search is a plain text box, so a phone keyboard offers no way to clear it')
    assert.match(jsx, /aria-label="Search your workers"/,
      'the box has no accessible name — a placeholder is not a label')
    assert.ok(jsx.includes('ew-find-count') && jsx.includes('Clear'),
      'nothing says how much of the roster is showing, or clears the search')
    assert.ok(!/\.ew-row-open\s*\{[^}]*position:\s*absolute/.test(css),
      'the row door is taken out of the flow, so the row collapses')
  })

  test('the filter and the row’s chip are the same words, from the same place', () => {
    /* "Not Registered" never means "not employed" — it is a fact about a login.
       The chip's words come from accountStatus(); the filter's labels are pinned
       to those same strings here, so a tab can never quietly mean something else
       than the chip on the rows it shows. */
    assert.match(jsx, /\['all', 'All'\],\s*\['registered', 'Registered'\],\s*\['pending', 'Not registered'\]/,
      'the filter is not the three states the rows can be in')
    assert.match(logic, /text: registered \? 'Registered' : 'Not registered'/,
      'accountStatus no longer uses the words the filter offers')
    assert.ok(jsx.includes('st.text'),
      'the row no longer prints the words accountStatus returns')
    assert.ok(jsx.includes('.registered'),
      'the filter does not read the registration fact from accountStatus')
  })

  test('the filter is the app’s one segmented control, not a new kind of toggle', () => {
    assert.ok(jsx.includes('segmented ew-find-filter'),
      'the filter is not the house segmented control')
    assert.ok(read('src/index.css').includes('.segmented {'),
      'the control the filter borrows no longer exists')
    assert.ok(!read('src/ui/ui.css').includes('dp-segmented'),
      'a second segmented control was invented for this screen')
  })

  test('every row is a door, and the door says who it opens', () => {
    const doors = (jsx.match(/className="ew-row-top ew-row-open"/g) || []).length
    assert.ok(doors >= 2, `${doors} row door(s) — the archived rows are not openable`)
    assert.match(jsx, /aria-label=\{`Open \$\{e\.full_name\}`\}/,
      'the door does not say which worker it opens, so a screen reader reads the whole row')
    assert.ok(/min-height:\s*var\(--tap\)/.test(rule('.ew-row-open')),
      'the row door is under the 44px minimum target')
    /* The three-dot menu is a sibling of the door, not inside it: a button inside
       a button is invalid markup that browsers resolve in whichever way they like
       — usually by losing one of the two handlers. */
    const door = jsx.slice(jsx.indexOf('className="ew-row-top ew-row-open"'))
    assert.ok(door.indexOf('ew-more') > door.indexOf('</button>'),
      'the overflow button is inside the row door — one of the two presses will be lost')
  })

  test('nothing matched is a result, and says where the person may be', () => {
    assert.ok(jsx.includes('<Notice') && jsx.includes('tone="empty"'),
      'an empty roster draws nothing, so a search that matched nothing is a blank pane')
    assert.ok(jsx.includes('Nobody matches'),
      'the empty state does not say what happened')
    assert.ok(jsx.includes('archivedMatches') && /archived .*match/.test(jsx),
      'the empty state does not mention the archived worker who does match — the one case ' +
      'the roster cannot show and the one an employer is most likely to hit')
    assert.ok(!jsx.includes('className="ew-empty"'),
      'a screen-local empty class is back; the house pattern is Notice tone="empty"')
  })

  test('a worker’s day is valued from their whole rate history, not one period', () => {
    /* Phase 4 passed the ONE period in force today into the worker screen, which
       valued every earlier day in the month at nothing — a real regression, found
       while Phase 6 wired the roster's rows to the same screen. The rate that
       applies to a day is the one that covered THAT day. */
    const view = read('src/employer/WorkerView.jsx')
    assert.ok(view.includes('rateOn(periods || [], dateKey)'),
      'the day sheet no longer asks the rate question of the whole history')
    assert.match(view, /export default function WorkerView\(\{ employee, periods = null,/,
      'the worker screen does not take the rate history any more')
    /* null is "nobody told this screen" — the contractor's list opens a worker
       without them — and the screen must then say nothing about money rather than
       claim there is no rate. An empty array is the real answer "no rate at all",
       which is the one that has to be said out loud. */
    assert.ok(view.includes('const rateKnown = Array.isArray(periods)'),
      'the worker screen cannot tell "not told" from "no rate", so one of the two lies')
    assert.ok(!/\bperiod=\{/.test(view),
      'a single period is handed to the day sheet again')
    assert.ok(read('src/employer/Dashboard.jsx').includes('periods={(periods || []).filter('),
      'the command centre hands a worker a period that may not cover the day it shows')
    assert.ok(jsx.includes('periods={periods || []}'),
      'the roster hands a worker no rate history at all, so the profile shows no money')
  })
})

/* ── The worker profile, held to the one-person question ─────────────────────
 *
 * Phase 7 rebuilt the screen an employer opens about a single worker. Every rule
 * here is one of the things that made the old one hard to use, turned into a fact
 * about the source:
 *
 *   · four stat cards to read before the person — they say the same three things
 *     the screen now says in a sentence, under the date they belong to;
 *   · a screen pinned to the current month, so "was he in last month?" had no
 *     answer on the screen about him;
 *   · "not registered" left to a chip, which reads as "not employed" — and a
 *     worker without an account is still owed money;
 *   . a second place to record a day, which is how a day gets recorded twice.
 */
describe('the worker profile is about one person', () => {
  const view = read('src/employer/WorkerView.jsx')
  const css = read('src/employer/employer.css')
  const rule = (sel) => {
    const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 's').exec(css)
    assert.ok(m, `${sel} is not a rule of its own`)
    return m[1]
  }

  test('the person comes first, and the cards are gone', () => {
    assert.ok(view.includes('className="ew-prof"'), 'the profile has no header block')
    assert.ok(view.includes('initials(employee.full_name)'), 'the avatar lost the worker’s initials')
    assert.ok(/<h2 className="ew-name">\{employee\.full_name\}<\/h2>/.test(view),
      'the worker’s name is not the heading of their own screen')
    assert.ok(!view.includes('className="ew-stat'), 'a stat card is back on the profile')
    assert.ok(!/font-size:\s*var\(--fs-xl\)/.test(rule('.ew-prof-hero-sum')),
      'the month figure is a card figure rather than the screen’s headline')
  })

  test('trade and contractor are one line, and a blank one says so', () => {
    assert.match(view, /\[employee\.job_title, contractorName\]\.filter\(Boolean\)\.join\(' · '\)/,
      'the sub-line is no longer "Trade · Contractor", the way the roster prints it')
    assert.ok(view.includes('No trade or contractor set'),
      'a worker with neither shows an empty line instead of saying so')
    /* `employee.contractor_name` is a column on an INVOICE, never on a worker —
       the old screen printed it and rendered "Rigger" with nothing after it. The
       comments are stripped first: this file's own header names the field while
       explaining that it does not exist, and a check that cannot tell code from a
       comment is a check that fails on the explanation. */
    const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!code.includes('employee.contractor_name'),
      'the profile reads a contractor off a field a worker record does not have')
  })

  test('“Not registered” is explained, not left to a colour', () => {
    assert.ok(view.includes('accountStatus(employee)'),
      'the account state is not asked of the one function that owns its words')
    assert.ok(view.includes('account.hint'),
      'the sentence that stops “Not registered” reading as “not employed” is not rendered')
    assert.ok(/Another (worker|person)|still on your workforce/i.test(read('src/lib/employerLogic.js')),
      'accountStatus lost the sentence the profile relies on')
  })

  test('the month can be stepped, and the grid belongs to the month shown', () => {
    assert.match(view, /aria-label="Previous month"/, 'the month cannot be stepped back — so “last month” has no answer here')
    assert.match(view, /function stepMonth\(delta\)/, 'there is no month stepper')
    assert.ok(view.includes('monthLabelFor(year, month)'), 'the month is not named by the engine’s own labeller')
    assert.match(view, /listEmployeeMonth\(employee\.id, year, month\)/,
      'the month stepper does not fetch the month it is showing')
    assert.ok(/\.ew-datebar-step\s*\{[^}]*width:\s*var\(--tap\)/.test(css),
      'the step controls lost the size the rest of the product uses')
  })

  test('the figures are the engine’s, and nothing is computed twice', () => {
    assert.ok(view.includes('workerMonthTotals(days)'),
      'the month total is not the engine’s own sum')
    assert.ok(!/\.reduce\(/.test(view),
      'the screen adds money up itself, which is a second answer to a question the engine already answers')
    assert.ok(view.includes('Paid-day equivalents'),
      'the paid-day equivalents — the number the invoice actually uses — are not on the profile')
    assert.ok(view.includes('not counted as settled yet'),
      'unconfirmed days are counted without saying that they are not settled')
  })

  test('the screen never records a new day', () => {
    assert.ok(!view.includes('ew-att-mark'),
      'a marking control is on the profile: days are recorded in Attendance, and a second place is how a day gets recorded twice')
    assert.ok(/Days are recorded one at a time from/.test(view),
      'an empty day does not say where a day comes from, so it offers nothing at all')
    /* Reclassifying an EXISTING day is this screen’s job — it changes one row and
       never adds one — so setDay is present and must be confirm-only. */
    assert.ok(view.includes('{ confirm: true }'),
      'a kind change is sent without confirming the day, which would leave it unconfirmed')
  })

    test('loading, empty and failed states all say something', () => {
    /* Phase 14 moved the skeleton into the design system: the shape, the announced
       label and aria-busy are one component now, and a screen proves it is loading
       the same way it proves it is empty — by using the thing that cannot be a line
       of grey text in an empty pane. */
    assert.ok(view.includes('WorkerSkeleton') && view.includes('<Loading'),
      'the loading state is a blank pane with a line of text in it')
    assert.ok(view.includes('<Notice') && view.includes('tone="empty"'),
      'a month with no days draws an empty grid and no words')
    assert.ok(view.includes('tone="error"') && view.includes('Try again'),
      'a failed load leaves the screen blank instead of saying so')
    assert.ok(!view.includes('className="ew-loading"'),
      'the old one-line loading state is back')
  })

  test('the day sheet belongs to the tab that draws the calendar', () => {
    const calendarAt = view.indexOf("{tab === 'calendar' && (")
    const sheetAt = view.indexOf('<DaySheet')
    assert.ok(calendarAt > 0 && sheetAt > calendarAt,
      'the day sheet is rendered outside the days tab, so a tap near the bottom of a phone can open something off-screen')
    assert.ok(view.includes('setOpenDate(null)'),
      'switching tabs leaves a day sheet open behind the tab that replaced it')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════
   Phase 8 · every destination under More is a screen
   ═══════════════════════════════════════════════════════════════════════════════
   More is the one place in the navigation where a screen can be added without
   anybody noticing: it is a list of rows, and a row is cheap. Three of these four
   used to open as a compact card at the foot of the roster — an icon, a title and
   an action, with no name of their own and nowhere to say what they were for.

   What is asserted here is the shape a destination has to have, checked against
   the navigation itself rather than against a copy of it, so a row can never say
   one thing while the screen it opens says another.
   ─────────────────────────────────────────────────────────────────────────────── */

describe('the destinations under More', () => {
  /* The name on the row and the name on the screen are the same name. Read from
     the router, so a rename in either place fails here rather than shipping. */
  const { MORE_GROUPS, MORE } = routes
  const labelFor = (path) => MORE_GROUPS
    .flatMap(g => g.items).find(i => i.path === path)?.label
  const SCREENS = {
    [MORE.contractors]: 'src/employer/ContractorEditor.jsx',
    [MORE.kiosk]: 'src/employer/DevicePanel.jsx',
    [MORE.billing]: 'src/employer/Billing.jsx',
    [MORE.reports]: 'src/employer/Summary.jsx',
  }

  test('each one opens with its own name, taken from the row that links to it', () => {
    for (const [address, file] of Object.entries(SCREENS)) {
      const source = read(file)
      const label = labelFor(address)
      assert.ok(label, `no More row links to ${address}`)
      assert.ok(source.includes('<h2 className="ew-title">' + label + '</h2>'),
        `${file} does not open with the name its row uses (${label})`)
    }
  })

  test('and each says what it is for, and offers its own action', () => {
    /* Billing and Reports render a fragment: the pane that hosts them owns the
       container and its spacing, and wrapping them in a box of their own would put
       a second gap between the header and what follows it. What every one of the
       four has to do is name itself and say its job. */
    for (const file of Object.values(SCREENS)) {
      const source = read(file)
      assert.ok(source.includes('className="ew-head"') && source.includes('className="ew-sub"'),
        `${file} has no header line saying what the screen is for`)
      assert.ok(source.includes('ew-btn-primary') || source.includes('ew-btn-accent'),
        `${file} offers the reader nothing to do, on a screen that exists to do something`)
    }
  })

  test('an empty state on these screens is the house Notice', () => {
    /* Two of the four used a screen-local .ew-empty block. The rule is not
       cosmetic: one empty state per app is how "empty" comes to look the same
       everywhere, and how a screen stops being able to hide an empty state. */
    for (const file of ['src/employer/Summary.jsx', 'src/employer/Billing.jsx',
      'src/employer/ContractorEditor.jsx']) {
      assert.ok(read(file).includes('<Notice'), `${file} does not use the house Notice`)
      assert.ok(read(file).includes('tone="empty"'), `${file} does not say when it is empty`)
    }
  })

  test('no screen sends the reader to a screen that no longer exists', () => {
    /* Phase 5 renamed "Mark days" to Attendance and Phase 6 renamed "Roster" to
       People. Two lines of copy survived both renames and kept pointing at them —
       a screen that names a place the reader cannot find is worse than one that
       says nothing. */
    const summary = read('src/employer/Summary.jsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const dead of ['Roster tab', 'Mark days']) {
      assert.ok(!summary.includes(dead),
        `Reports still sends the reader to "${dead}", which is not a screen any more`)
    }
    assert.ok(/Restore the person on the People screen/.test(summary),
      'the archived-worker line no longer names where to restore them')
    assert.ok(/recorded one at a time from Attendance/.test(summary),
      'the empty month no longer says where a day comes from')
  })

  test('the kiosk screen tells loading apart from missing', () => {
    /* The row it replaced said "Not linked yet" while the list was still loading,
       which is a different thing to say and sometimes an untrue one. A screen that
       cannot tell the three states apart will eventually tell an employer to run a
       migration they have already run. */
    const kiosk = read('src/employer/DevicePanel.jsx')
    assert.ok(/devices === undefined/.test(kiosk) && kiosk.includes('Loading your machines'),
      'the kiosk screen has no loading state of its own')
    assert.ok(kiosk.includes('Could not load your machines'),
      'a failed load is reported as a missing migration')
    assert.ok(/onClick=\{load\}/.test(kiosk) || kiosk.includes('onClick={load}'),
      'a failed load offers no way to try again')
    assert.ok(kiosk.includes('<Skeleton'),
      'the loading state is a blank pane')
  })

  test('Settings names the page you are on, and has one door to each', () => {
    const app = read('src/App.jsx')
    // The crumb used to read "Settings" on all six sub-pages.
    assert.ok(app.includes('SP_CAT_NAMES['),
      'the settings header does not say which category is open')
    const cats = new Set([...app.matchAll(/spCat === '([a-z]+)'/g)].map(m => m[1]))
    const table = /const SP_CAT_NAMES = \{([\s\S]*?)\n\}/.exec(app)
    assert.ok(table, 'the settings categories are not named in one place')
    const named = new Map([...table[1].matchAll(/(\w+): '([^']+)'/g)].map(m => [m[1], m[2]]))
    /* Phase 17 added the seventh (Workplace), so the count stops being the point: the
       invariant is that the table and the pages agree BOTH ways — every page has a
       name, and nothing is named that cannot be opened. */
    assert.equal(named.size, cats.size,
      `${named.size} categories are named and ${cats.size} are rendered`)
    for (const cat of cats) {
      assert.ok(named.has(cat),
        `the "${cat}" page is rendered but has no name, so the crumb cannot say where you are`)
    }
    /* The profile card at the top of the list IS the door to Profile. A second row
       saying "Profile" beside it was two doors into one room. */
    /* §41: the door is an address now, so it is the address that must be unique. */
    assert.equal((app.match(/settingsPath\('profile'\)/g) || []).length, 1,
      'there is more than one way into Profile on the settings list')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════
   Phase 7 · the worker profile
   ═══════════════════════════════════════════════════════════════════════════════
   The one screen that is about a single person. It is the screen where a wrong
   number costs somebody money, so the rules here are about where its numbers come
   from and about the one thing it must never grow: a second place to record a day.
   ─────────────────────────────────────────────────────────────────────────────── */

describe('the worker profile', () => {
  const view = read('src/employer/WorkerView.jsx')

  test('the money is the engine’s, not a sum the screen does itself', () => {
    /* Every figure on the screen comes from workerMonthTotals — the same function
       the payroll screens use. A screen that adds amounts up in its own loop is a
       second implementation of the pay rules, and the two drift. */
    assert.ok(view.includes('workerMonthTotals('),
      'the profile does not use the engine’s month totals')
    assert.ok(!/reduce\(\s*\(/.test(view),
      'the profile sums money itself, so it can disagree with every other screen')
    assert.ok(view.includes('rateOn(') && view.includes('multiplierFor('),
      'the rate and the multiplier are not read from the engine')
  })

  test('it never becomes a second place to record a day', () => {
    assert.ok(!view.includes('ew-att-mark'),
      'a marking control is on the profile: days are recorded in Attendance, and two places to record one is how a day is recorded twice')
    assert.ok(/Days are recorded one at a time from/.test(view),
      'an empty day does not say where a day comes from, so it offers nothing at all')
    /* Reclassifying an EXISTING day is this screen’s job — it changes one row and
       never adds one — so setDay is present and must be confirm-only. */
    assert.ok(view.includes('{ confirm: true }'),
      'a kind change is sent without confirming the day, which would leave it unconfirmed')
  })

  test('the account state is stated in the engine’s words, and says what it means', () => {
    /* The comments in that file talk ABOUT accountStatus and about the columns that
       do not exist on a worker; the code is what has to be right, so they come off
       before anything is matched. */
    const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(code.includes('accountStatus(employee)'),
      'the profile states the account in its own words instead of the shared ones')
    /* accountStatus's hint promises the sentence; the screen has to print it, or
       "Not registered" is left to be read as "not employed". */
    assert.ok(/account\.hint/.test(code),
      'the profile prints the chip but not the sentence that explains it')
    const engine = read('src/lib/employerLogic.js')
    assert.ok(/No DayPay sign-in yet[\s\S]{0,120}still on your workforce/.test(engine),
      'the shared sentence stopped saying that a worker without a sign-in is still a worker')
  })

  test('the month steps, and says which month it is showing', () => {
    assert.ok(view.includes('monthLabelFor(') && /aria-label="Previous month"/.test(view),
      'the month is pinned, so "was he in last month?" has no answer on his own screen')
    assert.ok(/listEmployeeMonth\([^)]*year[^)]*month/.test(view),
      'stepping the month does not ask the database for that month')
    assert.ok(view.includes('Back to this month'),
      'the screen offers no way back to the current month')
  })

  test('the day sheet is rendered under the tab that draws the calendar', () => {
    const calendarAt = view.indexOf("{tab === 'calculator'") >= 0 ? -1 : view.indexOf('tab === \'calendar\'')
    const sheetAt = view.indexOf('<DaySheet')
    assert.ok(calendarAt > 0 && sheetAt > calendarAt,
      'the day sheet renders outside the days tab, so a tap near the bottom of a phone opens something off-screen')
    assert.ok(view.includes('setOpenDate(null)'),
      'switching tabs leaves a day sheet open behind the tab that replaced it')
  })

  test('loading, empty and failed states all say something', () => {
    /* Phase 14 moved the skeleton into the design system: the shape, the announced
       label and aria-busy are one component now, and a screen proves it is loading
       the same way it proves it is empty — by using the thing that cannot be a line
       of grey text in an empty pane. */
    assert.ok(view.includes('WorkerSkeleton') && view.includes('<Loading'),
      'the loading state is a blank pane with a line of text in it')
    assert.ok(view.includes('tone="empty"'),
      'a month with no days draws an empty grid and no words')
    assert.ok(view.includes('tone="error"') && view.includes('Try again'),
      'a failed load leaves the screen blank instead of saying so')
    assert.ok(!view.includes('className="ew-loading"'),
      'the old one-line loading state is back')
  })

  test('it is shaped like a screen, not like a stack of cards', () => {
    assert.ok(view.includes('<BackLink'),
      'the profile uses its own back control instead of the one the address uses')
    assert.ok(!view.includes('ew-stat') && !view.includes('ew-summary'),
      'the four stat cards are back — the month is one figure with facts under it now')
    assert.ok(!view.includes('ew-pay'),
      'the profile reuses the payroll screen’s classes: the money block is .ew-prof-pay')
    assert.ok(view.includes('ew-prof-pay'),
      'the profile’s money block lost its own class')
  })
})

describe('Phase 9 — the edges', () => {
  const peoplePane = read('src/employer/PeoplePane.jsx')
  const workspace = read('src/employer/EmployerWorkspace.jsx')
  const dashboard = read('src/employer/Dashboard.jsx')
  const employerCss = read('src/employer/employer.css')

  test('the address opens the add form, and the form has one way out', () => {
    /* Adding a worker used to be a `useState` flag only the roster could see: the
       command centre's "the one thing to do" landed on People and left the form one
       more tap away, a reload closed it, and the back button did nothing. A step is
       an address now, and the address is what opens and closes it. */
    assert.ok(workspace.includes('peopleScreenFor(path)'),
      'the workspace does not ask the address whether the form is open')
    assert.ok(workspace.includes("startAdding={peopleScreen === 'new'}"),
      'the form is not driven by the /people/new address')
    assert.ok(workspace.includes('PEOPLE_ADD'),
      'the workspace never navigates to the add address')
    assert.ok(workspace.includes('onCloseAdd={() => navigateDestination(EMPLOYER.people)}'),
      'closing the form does not put the address back on the roster')

    assert.ok(peoplePane.includes('useState(startAdding)'),
      'the form does not open when the screen is reached at /people/new')
    assert.ok(peoplePane.includes('onClick={openAdd}'),
      'the Add button still opens the form without changing the address')
    assert.ok(peoplePane.includes('const closeAdd = () => { setAdding(false); onCloseAdd?.() }'),
      'closing the form does not put the address back')
  })

  test('an empty form answers instead of being disabled into silence', () => {
    /* A disabled submit with no reason given reads as a broken screen, and on the
       day the roster is empty this form is the first thing an employer meets. */
    assert.ok(!/disabled=\{busy \|\| !name\.trim\(\)\}/.test(peoplePane),
      'the submit is dead again with no explanation')
    assert.ok(peoplePane.includes('A worker needs a name'),
      'pressing the submit with no name is not answered')
    assert.ok(peoplePane.includes('nameRef.current?.focus()'),
      'the cursor is not put on the field that is missing something')
    assert.ok(peoplePane.includes('aria-invalid={!!err && !name.trim()}'),
      'the field does not say it is the one at fault')
    assert.ok(/if \(!name\.trim\(\)\) \{\n\s+setErr\(new EmployerError/.test(peoplePane),
      'the empty press reaches the database instead of being answered locally')
  })

  test('the form says a roster record is not an account', () => {
    /* §10 and the standing rule: a worker without a smartphone is a worker. This
       sentence is the difference between "Not registered" reading as a fact about a
       login and reading as a fact about somebody's job. */
    assert.ok(peoplePane.includes('does not create a DayPay account'),
      'the form no longer says what it does not do')
    assert.ok(/They can be invited whenever they are ready/.test(peoplePane),
      'the form does not say that an account can come later')
  })

  test('the confirmation is announced, hands over the PIN once, and leaves with it', () => {
    assert.ok(peoplePane.includes('role="status"'),
      'the confirmation is not announced to a screen reader')
    assert.ok(peoplePane.includes('data-testid="pin-value"'),
      'the PIN is no longer shown on the confirmation')
    assert.ok(/only time/.test(peoplePane),
      'the card no longer says this is the only time the PIN can be read')
    assert.ok(peoplePane.includes("copied ? '✓ Copied' : 'Copy PIN'"),
      'copying the PIN gives no feedback')
    /* The click EVENT used to be handed to onCreated as if it were the worker's id. */
    assert.ok(!/onClick=\{onCreated\}/.test(peoplePane),
      'Done hands over its click event instead of the worker it created')
    assert.equal((peoplePane.match(/onClick=\{\(\) => onCreated\(created\.id\)\}/g) || []).length, 2,
      'the Done buttons do not both hand over the id of the worker that was created')
  })

  test('the command centre’s one action on an empty roster lands on the form', () => {
    assert.ok(dashboard.includes('data-testid="add-first-worker"'),
      'the empty command centre has no first action')
    assert.ok(dashboard.includes('onClick={onAddWorker || onOpenPeople}'),
      'the action falls back to nothing when the address half is missing')
    assert.ok(workspace.includes('onAddWorker={() => navigateDestination(PEOPLE_ADD)}'),
      'the command centre is wired to People rather than to the form')
  })

  test('nothing on an employer screen is below the design system floor', () => {
    /* 11px is the app's floor and it is too small for a phone held outdoors in one
       hand. The src/ui layer Phase 2 delivered never went below --fs-label (12px);
       Phase 9 brought the employer stylesheet up to its own design system. */
    assert.ok(!employerCss.includes('--fs-2xs'),
      'an employer screen still sets text at the 11px step')
    const small = []
    for (const file of fs.readdirSync(path.join(REPO, 'src/employer'))) {
      if (!file.endsWith('.jsx')) continue
      for (const m of read(`src/employer/${file}`).matchAll(/fontSize:\s*([0-9.]+)/g)) {
        if (parseFloat(m[1]) < 12) small.push(`${file}: ${m[1]}`)
      }
    }
    assert.deepEqual(small, [], `below the 12px floor: ${small.join(', ')}`)
  })

  test('every employer screen that shows a list says so when the list is empty', () => {
    /* An empty list drawn as nothing is the fault this phase exists to catch: it
       reads exactly like a screen that failed to load. MorePane is exempt and says
       why — it is a fixed menu of destinations, not a list that can be empty. */
    const STATES = {
      'Dashboard.jsx': 'tone="empty"',
      'StaffDays.jsx': 'tone="empty"',
      'PeoplePane.jsx': 'tone="empty"',
      'WorkerView.jsx': 'tone="empty"',
      'ContractorEditor.jsx': 'tone="empty"',
      'Billing.jsx': 'tone="empty"',
      'Summary.jsx': 'tone="empty"',
      /* The kiosk states it in the line above the list, beside the action that fills
         it. A machine list is short and the action is already on screen: a second
         sentence saying the same thing is the sort of thing this phase removes, and
         the requirement is that the state is SAID, not where it is said. */
      'DevicePanel.jsx': 'No machine is linked yet',
    }
    const missing = Object.entries(STATES)
      .filter(([file, mark]) => !read(`src/employer/${file}`).includes(mark))
      .map(([file]) => file)
    assert.deepEqual(missing, [], `${missing.join(', ')} can be empty and silent`)
    assert.ok(!read('src/employer/MorePane.jsx').includes('tone="empty"'),
      'MorePane grew an empty state — it is a menu, and a menu is never empty')
  })

  test('the focus ring covers the controls the app actually uses', () => {
    /* index.css rings button, a and input. A <select> — the contractor control on a
       roster row, and the appearance pickers in Settings — had none: the one control
       a keyboard user reaches with the arrow keys was the one they could not see. */
    assert.match(employerCss, /select:focus-visible[\s\S]{0,120}?outline: 2px solid/,
      'a select still has no visible focus state')
  })
})

describe('Phase 14 — the four states', () => {
  const ui = read('src/ui/Ui.jsx')
  const css = read('src/ui/ui.css')

  test('loading is one component, and it is three things at once', () => {
    /* The shape standing in for the content, the sentence a screen reader can
       announce, and aria-busy on the block. Separately they are three ways to get
       it wrong; together they are one thing a screen cannot half-do. */
    assert.ok(ui.includes('export function Loading'),
      'the design system has no Loading component')
    assert.ok(/export function Loading[\s\S]{0,600}?aria-busy="true"/.test(ui),
      'the loading block does not say it is busy')
    assert.ok(/export function Loading[\s\S]{0,600}?dp-sr/.test(ui),
      'the loading state has no sentence for assistive technology')
    assert.ok(/export function Loading[\s\S]{0,600}?<Skeleton/.test(ui),
      'the loading state draws no shape, so the screen jumps when the data lands')
    assert.ok(/\.dp-sr\s*\{[\s\S]{0,400}?clip: rect\(/.test(css),
      'the screen-reader text is not clipped, so it is visible on the screen')

    /* The kiosk and the specimen page import ui.css without index.css, so a
       rule the design system depends on cannot live in the app's stylesheet. */
    assert.ok(!/\.dp-sr\s*\{/.test(read('src/index.css')),
      'the design system borrowed a class from the app stylesheet')
  })

  test('no screen hand-rolls a loading state', () => {
    /* `.ew-loading` was a centred line of grey text in an otherwise empty pane. On
       a slow connection that is indistinguishable from a screen that has finished
       and found nothing — which is the fault this phase exists for. */
    const files = fs.readdirSync(path.join(REPO, 'src/employer'))
      .filter((f) => f.endsWith('.jsx')).map((f) => `src/employer/${f}`)
    const offenders = files.filter((f) => read(f).includes('ew-loading'))
    assert.deepEqual(offenders, [], `${offenders.join(', ')} still hand-rolls the loading line`)
    assert.ok(!read('src/employer/employer.css').includes('.ew-loading'),
      'the retired loading class is still styled')

    const needing = ['Dashboard.jsx', 'WorkerView.jsx', 'StaffDays.jsx']
    const missing = needing.filter((f) => !read(`src/employer/${f}`).includes('<Loading'))
    assert.deepEqual(missing, [], `${missing.join(', ')} went back to its own skeleton`)
  })

  test('a screen that failed says so instead of looking empty', () => {
    /* The two most dangerous places for this to be wrong are the two a worker
       reads at work: the check-in card, where "nothing is open today" is a claim
       about their employer's site, and their own month, where "no days recorded"
       is a claim about their pay. */
    const checkIn = read('src/employer/CheckIn.jsx')
    assert.ok(checkIn.includes('loadError'),
      'a failed check-in load is swallowed again, so it reads as "nothing is open"')
    assert.ok(/Could not check today’s attendance/.test(checkIn),
      'the check-in screen has no words for a failure')
    assert.ok(/if \(loadError\)[\s\S]{0,700}?Try again/.test(checkIn),
      'a failed check-in offers no way to try again')

    const view = read('src/employer/EmployeeView.jsx')
    assert.ok(/error \? \(/.test(view) || /error \?/.test(view),
      'the worker’s month draws its empty state under a failed read')
    assert.ok(/role="alert"/.test(view),
      'the worker’s month announces nothing when it fails')
    assert.ok(/onClick=\{\(\) => \{ setLoading\(true\); load\(\) \}\}/.test(view),
      'the worker’s month offers no way to load it again')
  })

  test('a screen never sends the reader to a screen that no longer exists', () => {
    /* The roster has been called People since Phase 6. "Assign them under Roster"
       was still on the contractor screen — a direction to a door that is not there. */
    for (const f of ['ContractorView.jsx', 'ContractorEditor.jsx', 'WorkerView.jsx',
      'Dashboard.jsx', 'Summary.jsx', 'Billing.jsx']) {
      const text = read(`src/employer/${f}`).replace(/\/\*[\s\S]*?\*\//g, '')
      assert.ok(!/under <strong>Roster|Roster tab|“Roster”/.test(text),
        `${f} still names Roster as a destination`)
    }
  })
})

describe('Phase 15 — desktop is additive', () => {
  const index = read('src/index.css')
  const employer = read('src/employer/employer.css')
  const ui = read('src/ui/ui.css')

  /* A media block, braced, so the assertions below can say "this declaration is
     inside the wide-screen rules" rather than "these words are somewhere in the
     file" — the difference between a guard and a coincidence. */
  function mediaBlock(css, query) {
    const start = css.indexOf(`@media (${query})`)
    assert.notEqual(start, -1, `no @media (${query}) block`)
    const open = css.indexOf('{', start)
    let depth = 0
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) return css.slice(open + 1, i)
      }
    }
    assert.fail(`@media (${query}) is not closed`)
  }

  test('the phone layout is still the phone layout', () => {
    /* The brief's rule for this phase: additive. Everything the 516 screen checks
       were written against is the base — the frame is capped at 480px and the
       navigation is sticky to the bottom of the screen. If either of those moves
       into a media query, the phone layout became a special case. */
    const frame = index.slice(index.indexOf('.phone-frame {'), index.indexOf('.phone-frame {') + 400)
    assert.ok(/max-width:\s*480px/.test(frame), 'the base frame is no longer 480px wide')
    const bar = ui.slice(ui.indexOf('.dp-tabbar {'), ui.indexOf('.dp-tabbar {') + 400)
    assert.ok(/position:\s*sticky/.test(bar) && /bottom:\s*0/.test(bar),
      'the phone navigation is no longer a bar at the bottom of the screen')
  })

  /* One rule out of a block, so an assertion about the frame cannot be satisfied
     by a coincidence somewhere else in the same media query. Written after the
     first version of this test passed while the frame was still 480px wide — it
     had found `max-width: none` on the rail's active marker instead. */
  function ruleIn(block, selector) {
    const start = block.indexOf(`${selector} {`)
    assert.notEqual(start, -1, `${selector} is not in this block`)
    return block.slice(start, block.indexOf('}', start))
  }

  test('the wide shell is a rail, a column, and room for both', () => {
    const wide = mediaBlock(index, 'min-width: 1024px') + mediaBlock(employer, 'min-width: 1024px')

    // the frame stops being a phone
    const frameWide = ruleIn(mediaBlock(index, 'min-width: 1024px'), '.phone-frame')
    assert.ok(/max-width:\s*none/.test(frameWide), 'the frame is still capped at 480px on a monitor')
    assert.ok(/overflow:\s*visible/.test(frameWide),
      'the frame still clips, so the fixed rail is cut off at the bottom of a short screen')

    // the rail
    const rail = ruleIn(wide, '.ew > .dp-tabbar')
    assert.ok(/position:\s*fixed/.test(rail), 'the navigation does not leave the bottom of the screen')
    assert.ok(/flex-direction:\s*column/.test(rail), 'the rail is still a row of labels')
    assert.ok(/width:\s*var\(--rail\)/.test(rail), 'the rail has no width of its own')
    assert.ok(/bottom:\s*0/.test(rail), 'the rail does not run the height of the window')

    // the content column
    const pane = ruleIn(wide, '.ew > :not(.dp-tabbar)')
    assert.ok(/max-width:\s*var\(--content-max\)/.test(pane),
      'the content column has no measure, so a line of text runs the width of the monitor')
    assert.ok(/padding-left:\s*var\(--rail\)/.test(wide),
      'the pane does not make room for the rail and would sit under it')

    // the three numbers live in the token block, once
    for (const token of ['--rail:', '--content-max:', '--header-h:']) {
      assert.equal(index.split(token).length - 1, 1, `${token} is declared more than once`)
    }
  })

  test('the screens with two jobs get two columns, and only at 1280', () => {
    const wide = mediaBlock(employer, 'min-width: 1280px')
    const dash = ruleIn(wide, '.ew-dash')
    assert.ok(/display:\s*grid/.test(dash) && /grid-template-columns/.test(dash),
      'Today is still one column at 1280px and up')
    assert.ok(/\.ew-dash-col\s*\{[^}]*display:\s*flex/.test(wide),
      'the two halves of Today do not become columns')

    const att = ruleIn(wide, '.ew-att-split')
    assert.ok(/display:\s*grid/.test(att), 'Attendance is still one column at 1280px and up')
    assert.ok(/\.ew-att-side\s*\{[^}]*position:\s*sticky/.test(wide),
      'the calendar does not stay put while the roster scrolls')
  })

  test('every wrapper the wide layout needs is invisible on a phone', () => {
    /* This is the guarantee that makes the phase safe: the column wrappers are
       `display: contents` in the base, so below 1280px they generate no box, no
       margin and no gap. A wrapper that quietly became a flex or block container
       on a phone would move the phone layout — and the 516 checks would not
       notice, because they read the DOM, not the layout. */
    const base = employer.slice(employer.indexOf('.ew-dash-col,'), employer.indexOf('}', employer.indexOf('.ew-dash-col,')))
    assert.ok(/display:\s*contents/.test(base),
      'the column wrappers are boxes on a phone, so the phone layout has moved')
    for (const cls of ['.ew-dash-col', '.ew-att-side', '.ew-att-main']) {
      assert.ok(base.includes(cls), `${cls} is not in the base rule that makes it invisible`)
    }
    // and the invisible rule is not itself inside a media query
    assert.ok(employer.indexOf('@media') > employer.indexOf('.ew-dash-col,'),
      'the `display: contents` rule has been moved inside a media query')

    // The two-column Attendance grid belongs to the branch that has two jobs.
    assert.ok(read('src/employer/StaffDays.jsx').includes('"ew-att ew-att-split"'),
      'the two-column attendance grid is on the empty-roster branch too')
    assert.ok(!/\.ew-att\s*\{[^}]*display:\s*grid/.test(mediaBlock(employer, 'min-width: 1280px')),
      'the grid is on `.ew-att` itself, which the empty-roster screen also uses')
  })

  test('the wide shell belongs to the workspace, and to nothing else', () => {
    /* The worker-facing screens are personal, one-handed screens. Stretching them
       across a monitor would be a regression dressed as a desktop layout, so the
       frame that does NOT contain the workspace keeps its 480px column — and the
       reading column below is the fail-safe for a browser without `:has()`, where
       the shell goes wide but the text still does not. */
    const block = mediaBlock(index, 'min-width: 1024px')
    assert.ok(block.includes('.phone-frame:not(:has(.ew))'),
      'every frame goes full width on a monitor, including the worker’s own screens')
    const kept = ruleIn(block, '.phone-frame:not(:has(.ew))')
    assert.ok(/max-width:\s*480px/.test(kept), 'the worker’s frame is no longer a phone column')
    assert.ok(/max-width:\s*720px/.test(ruleIn(block, '.view-wrap > :not(.ew)')),
      'there is no reading column for a screen inside a frame that went wide')

    // and Settings, which is also a frame, is still a panel of its own size
    const panel = ruleIn(block, '.phone-frame.sp-page')
    assert.ok(/max-width:\s*820px/.test(panel),
      'Settings lost its width and fell back to the shell or the phone column')
    assert.ok(block.indexOf('.phone-frame:not(:has(.ew))') < block.indexOf('.phone-frame.sp-page {'),
      'the Settings panel is declared before the rule it ties with, so that rule wins')
  })

  test('the rail and the rows were not left behind', () => {
    // The active marker survives the rail: it is still a rule beside the label,
    // not a colour swap.
    assert.ok(/\.dp-tab-rule\s*\{[^}]*width:\s*3px/.test(read('src/employer/employer.css')),
      'the active marker has no rail form, so the rail marks the active tab by colour alone')

    // Rows: the trail is a column and the sentence has a measure.
    const wide = mediaBlock(ui, 'min-width: 1024px')
    assert.ok(/\.dp-item-trail\s*\{[^}]*justify-content:\s*flex-end/.test(wide),
      'trailing figures are not aligned in a column, which is the point of the width')
    assert.ok(/\.dp-item-sub\s*\{[^}]*max-width:/.test(wide),
      'row descriptions run the full width of the monitor')

    // The kiosk is the visual standard and does not load this stylesheet.
    assert.ok(!read('src/kiosk/kiosk.css').includes('--rail'),
      'the kiosk picked up the desktop shell')
  })
})

describe('Phase 16 — one voice across the product', () => {
  /* The employer's screens were brought to sentence case in Phase 9. The rest of
     the app still shouted: 25 rules in `index.css` uppercased their micro-labels,
     so the personal tracker and the worker's own screens spoke in a different voice
     from the workspace next to them. The kiosk is the one place that keeps its
     capitals — it is the visual standard this redesign was measured against — and
     the site code keeps its own, because two characters read aloud must not be
     confusable. */
  const stylesheets = ['src/index.css', 'src/ui/ui.css', 'src/employer/employer.css',
    'src/specimen/specimen.css', 'src/kiosk/kiosk.css']

  function rulesWith(css, declaration) {
    /* Every selector whose block contains `declaration`. Blocks are taken as
       `selector { … }`, which is exact enough for a stylesheet this size and does
       not need a parser to be right about it. */
    const found = []
    const re = /([^{}]+)\{([^{}]*)\}/g
    let m
    while ((m = re.exec(css)) !== null) {
      if (m[2].includes(declaration)) found.push(m[1].trim().split('\n').pop().trim())
    }
    return found
  }

  test('the app does not shout any more', () => {
    const offenders = {}
    for (const file of stylesheets) {
      const rules = rulesWith(read(file), 'text-transform: uppercase')
      if (rules.length) offenders[file] = rules
    }

    // index.css: none. It was 25.
    assert.equal(offenders['src/index.css'], undefined,
      `index.css uppercases ${JSON.stringify(offenders['src/index.css'])}`)
    assert.equal(offenders['src/ui/ui.css'], undefined,
      'the design system uppercases something')

    /* employer.css: exactly one, and it is the site code. */
    assert.deepEqual(offenders['src/employer/employer.css'], ['.ew-code'],
      'the employer stylesheet uppercases something other than the site code')

    /* The kiosk keeps its capitals on purpose: it is the station screen, read at
       arm's length in the sun, and the pass that produced this brief held it up as
       the standard rather than the problem. If this ever changes it is a decision,
       not a drift. */
    assert.equal((offenders['src/kiosk/kiosk.css'] || []).length, 2,
      'the kiosk’s capitals changed — that is the visual standard, not a defect')
  })

  test('no badge or label is written in capitals in the source either', () => {
    /* CSS was only half of it: three status words and a start badge were typed in
       capitals in the JSX, so they would have stayed caps whatever the stylesheet
       said. The calendar's day codes are exempt — OK · OT · HOL · LV are stamps in
       a 40px cell, paired with the plain words beside them.
       Comments are stripped first: a rule that reads the source must not be able to
       satisfy itself with a comment about the rule. */
    const jsx = read('src/App.jsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const caps = [...new Set([...jsx.matchAll(/>\s*([A-Z][A-Z0-9 ×·&/-]{1,30})\s*</g)].map(m => m[1]))]
    const codes = ['OK', 'OT', 'HOL', 'LV', 'OT 2×', 'HOL 2×']
    const stray = caps.filter(c => !codes.includes(c))
    assert.deepEqual(stray, [], `these are still typed in capitals: ${stray.join(', ')}`)
  })

  test('status is one shape, in the chip’s own measurements', () => {
    /* Three answers to "what state is this in" lived in this app: a dot with caps
       text (the tracker's month badges), a filled pill (the employer's chip), and
       another pill in Settings. They are one shape now. The employer's chip is the
       reference — it is the one an employer sees most — so these are its numbers. */
    const index = read('src/index.css')
    /* The badge's own rules — both of them — rather than a window of characters
       that hopes to contain them. The first version of this check sliced 700
       characters and missed the green wash four lines later. */
    const badgeGroup = index.slice(index.indexOf('.final-badge, .active-badge'),
      index.indexOf('.locked-hint'))
    assert.ok(/font-size:\s*var\(--fs-label\)/.test(badgeGroup), 'the tracker badge is not the chip’s size')
    assert.ok(/font-weight:\s*600/.test(badgeGroup), 'the tracker badge is not the chip’s weight')
    assert.ok(/border-radius:\s*999px/.test(badgeGroup), 'the tracker badge is not a pill')
    assert.ok(/background:\s*var\(--bg-sunken\)/.test(badgeGroup), 'the tracker badge has no wash')
    assert.ok(/\.active-badge, \.mr-active\s*\{[^}]*--daypay-green-light/.test(badgeGroup),
      'the live state has no green wash, so the two states differ by ink alone')

    const pill = read('src/index.css').match(/\.sp-rh-pill\s*\{[^}]*\}/)[0]
    assert.ok(/font-size:\s*var\(--fs-label\)/.test(pill) && /border-radius:\s*999px/.test(pill),
      'the Settings pill is still a third shape')

    // and the dots follow their ink rather than a hardcoded colour
    assert.equal((badgeGroup.match(/background:\s*currentColor/g) || []).length, 2,
      'the status dots do not inherit the ink of the state they mark')
  })

  test('a list of records is one list, whichever screen shows it', () => {
    /* The roster is one bordered list with hairline dividers. The contractors screen
       was a card per contractor — the same content in a different shape, on the
       screen an employer reaches from the same menu. */
    const css = read('src/employer/employer.css')
    assert.ok(/\.ew-list \.ew-person\s*\{[^}]*border:\s*0/.test(css),
      'a contractor row still draws its own card inside the list')
    assert.ok(/\.ew-list \.ew-person \+ \.ew-person\s*\{[^}]*border-top:\s*1px solid var\(--border-light\)/.test(css),
      'contractor rows are not separated by the same hairline as every other list')

    const jsx = read('src/employer/ContractorEditor.jsx')
    assert.ok(jsx.includes('className="ew-list"'), 'the contractors are not in the shared list container')
    /* In the source the container opens, then the map that draws the rows. Whether
       the rows end up inside it is a question about the DOM, so the harness answers
       it there (`scripts/ui-check/consistency.jsx`) rather than guessing at tags. */
    const open = jsx.indexOf('className="ew-list"')
    const map = jsx.indexOf('{listed.map(c => (')
    const row = jsx.indexOf('className="ew-person"')
    assert.ok(open !== -1 && map > open && row > map,
      'the contractor rows are drawn outside the list container')

    /* And `.ew-person` still exists for the one place that needs a card: the rate
       panel's header in People, which is a person heading, not a row in a list. */
    assert.ok(read('src/employer/PeoplePane.jsx').includes('className="ew-person"'),
      'the rate panel lost its header card')
    assert.ok(/^\.ew-person\s*\{[^}]*border:\s*1px solid/m.test(css),
      'the standalone person card lost its border')
  })

  test('the tracker’s instruction line is in the product’s words', () => {
    /* It read "Tap weekday to log OK, edit icon to OT. Weekends auto 2×. Holidays
       auto HOL 2×." — four abbreviations in one sentence, and OK is not the word
       this product uses for a worked day anywhere else. The stamps stay (they are
       codes in a small cell); the sentence that explains them does not use them. */
    const src = read('src/App.jsx')
    assert.ok(!/log OK/.test(src), 'the tracker still tells the reader to "log OK"')
    assert.ok(/Tap a weekday to record work/.test(src),
      'the instruction line has no plain-language replacement')
  })
})

  /* ── Phase 17 — the last pass ───────────────────────────────────────────────
   * Two things live here: the audit's last unbuilt row (§20 — an employer could
   * not name their workplace, because the writer existed and nothing called it),
   * and the checks that close rows the audit called missing without anything
   * rebuilding them (§29 search, §10 filter chips, §34 sheets were all delivered
   * earlier; "delivered" is a claim, so it is held here rather than remembered).
   */
  describe('Phase 17 — a name for the workplace, and taps a thumb can hit', () => {
    const index = read('src/index.css')
    const employer = read('src/employer/employer.css')
    const ui = read('src/ui/ui.css')
    const appJsx = read('src/App.jsx')
    const workplace = read('src/employer/Workplace.jsx')

    /* One rule out of a stylesheet, by exact selector at the top level. */
    function ruleText(css, selector) {
      const start = css.indexOf(`${selector} {`)
      assert.notEqual(start, -1, `${selector} is not a rule of its own`)
      return css.slice(start, css.indexOf('}', start))
    }

    /* Every rule in a stylesheet, with the media query it sits inside (if any).
       Written by hand because there is no CSSOM here — and a check that cannot see
       which block a rule is in cannot tell the phone's layout from the desktop's. */
    function allRules(css) {
      const out = []
      const re = /([^{}]+)\{([^{}]*)\}/g
      let m = re.exec(css)
      while (m) {
        const before = css.slice(0, m.index)
        const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length
        const media = [...before.matchAll(/@media[^{]*\{/g)].pop()
        out.push({
          sel: m[1].trim().split('\n').pop().trim(),
          body: m[2],
          media: depth > 0 && media && !m[1].includes('@media') ? media[0].replace('{', '').trim() : '',
        })
        m = re.exec(css)
      }
      return out
    }

    test('the workplace is drawn behind the rule, not behind a copy of it', () => {
      assert.ok(/import \{ workplaceVisible \} from '\.\/lib\/employerLogic'/.test(appJsx),
        'the gate is not the tested rule any more')
      const gate = appJsx.indexOf('workplaceVisible(roles)')
      const row = appJsx.indexOf('<WorkplaceRow')
      assert.notEqual(gate, -1, 'the settings list no longer asks who should see a workplace')
      assert.ok(row > gate && row - gate < 200,
        'the Workplace row is drawn somewhere the rule does not guard')
    })

    test('and the screen that draws it is the one that writes the name', () => {
      // The fault §20 records: a writer in the data layer that nothing called.
      assert.ok(/import \{[^}]*updateBusinessName[^}]*\} from '\.\.\/lib\/employer'/.test(workplace),
        'the component does not import the writer')
      assert.ok(/await updateBusinessName\(next\)/.test(workplace),
        'the component never calls the writer')
      const page = appJsx.search(/<Workplace\s/)   // <WorkplaceRow is not the page
      assert.notEqual(page, -1, 'the settings page does not render the component')
      const block = appJsx.slice(page, page + 500)
      assert.ok(/onSaved=/.test(block), 'the page is not told what to do when a name is saved')
      const handler = block.slice(block.indexOf('onSaved='), block.indexOf('await refreshRoles()'))
      assert.ok(/await refreshRoles\(\)/.test(block),
        'a saved name does not re-read the roles, so the row behind the page keeps the old one')
      assert.ok(!/\breturn\b/.test(handler),
        'the handler can leave before it re-reads the roles')
    })

    test('and the save refuses an empty name even if the button is pressed', () => {
      /* The disabled attribute is the rendered half of this (checked in the DOM by
         `scripts/ui-check/workplace.jsx`); the function's own early return is the
         half that holds when the attribute is not there — a re-render mid-flight, a
         keyboard submit, a caller that forgets. A blank workplace name would clear
         the name three screens read. */
      assert.ok(/if \(!next \|\| saving\) return/.test(workplace),
        'the save function has no guard of its own — only the button refuses a blank name')
    })

    test('and a save that fails says so, in words a person can act on', () => {
      assert.ok(/role="alert"/.test(workplace), 'a failed save is silent')
      assert.ok(/role="status"/.test(workplace), 'a successful save is not announced')
      assert.ok(/Could not save your workplace name\./.test(workplace),
        'the failure has no wording of its own — it would show the database\'s')
    })

    test('and a workplace with no name yet is never blank', () => {
      /* The name was null for every employer, so these three surfaces were the
         product's actual face. They stay as the fallback now that a name is
         possible: a workplace nobody has named must still read as a place. */
      const employee = read('src/employer/EmployeeView.jsx')
      assert.ok(/linked\.business_name \|\| 'My team'/.test(employee),
        'the worker\'s own header has no fallback')
      assert.ok(/linked\.business_name \|\| 'this team'/.test(employee),
        'the leave prompt has no fallback')
      assert.ok(/roster\?\.businessName \|\| 'Your site'/.test(read('src/kiosk/Kiosk.jsx')),
        'the site kiosk has no fallback')
      assert.ok(/named \|\| 'Not named yet'/.test(workplace),
        'the settings row shows an empty summary for an unnamed workplace')
    })

    /* ── the audit's "missing" rows that were delivered without a guard ─────── */

    test('the roster search and its filter chips are still on the screen', () => {
      // §29 search, §10 "All / Active / Pending". The choices were renamed to the
      // facts (§4: a roster record is not an account), and both are guarded here
      // so the §39 audit can cite a check rather than a memory.
      const people = read('src/employer/PeoplePane.jsx')
      assert.ok(/type="search"/.test(people), 'the roster search is gone')
      assert.ok(/className="segmented ew-find-filter"/.test(people), 'the filter chips are gone')
      for (const label of ['All', 'Registered', 'Not registered']) {
        assert.ok(people.includes(`'${label}'`), `the filter no longer offers ${label}`)
      }
    })

    test('and the phone modal is a sheet from the bottom, not a card in the middle', () => {
      // §34. A 380px-wide phone gets a sheet; from 600px it is a centred dialog.
      const overlay = ruleText(index, '.modal-overlay')
      assert.ok(/align-items:\s*flex-end/.test(overlay), 'the phone modal is not anchored to the bottom')
      assert.ok(/border-radius:\s*18px 18px 0 0/.test(ruleText(index, '.modal')),
        'the sheet has no top rounding, so it reads as a floating card that fell')
      const wide = index.slice(index.indexOf('@media (min-width: 600px)'), index.indexOf('@media (min-width: 600px)') + 900)
      assert.ok(/align-items:\s*center/.test(wide), 'the modal is still a sheet on a desktop')
      assert.ok(/border-radius:\s*18px(?! )/.test(wide), 'the desktop dialog kept the sheet\'s top-only radius')
    })

    /* ── taps ──────────────────────────────────────────────────────────────── */

    test('every control reaches 44px, or says why it does not have to', () => {
      /* The rule is not "every box is 44px" — a header button, a chevron and a
         checkbox all sit inside something bigger, or are drawn small on purpose.
         The rule is that a THUMB can hit them: either the box is 44px, or the same
         selector carries a pseudo-element that extends the target, or the element
         is an inner mark inside a row that is the target. This scans the sheets
         instead of listing the classes, because the class that gets missed is the
         one added next.

         `min-width` media queries are skipped: the token is the phone's rule, and
         a pointer is not a thumb. */
      /* Things that are drawn small on purpose. Every entry is a mark, a track, a
         face, a label or hidden text — none of them is something a thumb is meant to
         press on its own, and each says where the real target is. A NEW control that
         is too small is not on this list and will be reported, which is the point:
         false positives are visible, false negatives are not. */
      const NOT_A_CONTROL = new Map([
        ['.status-dot', 'a day-state dot; the cell is the target'],
        ['.today-dot', 'a mark in the calendar'],
        ['.holiday-dot', 'a mark in the calendar'],
        ['.ew-mgrid-dot', 'a day mark'],
        ['.stamp', 'a day-code label, not a control'],
        ['.edit-corner', 'the pencil drawn inside a button that is the target'],
        ['.progress-bar', 'a track'],
        ['.dp-progress-track', 'a track'],
        ['.summary-divider', 'a rule'],
        ['.mr-name', 'a column, not a control'],
        ['.footer-dot', 'a dot'],
        ['.user-dot', 'a status dot'],
        ['.wp-banner-dot', 'a dot'],
        ['.dp-nudge-dot', 'a dot'],
        ['.dp-chip', 'a status label; the row it sits in is the target'],
        ['.welcome-avatar', 'a face'],
        ['.ew-avatar', 'a face'],
        ['.spin', 'a spinner'],
        ['.dp-skel-line', 'a skeleton line'],
        ['.dp-sr', 'visually hidden text'],
        ['.sr-only', 'visually hidden text'],
        ['.dp-toast-slip', 'a celebration mark'],
        ['.dp-toast-sparks', 'a celebration mark'],
        ['.app-sw', 'the swatch inside .app-tile, which is the target'],
        ['.theme-sw', 'the swatch inside .theme-opt, which is the target'],
        ['.sp-switch', 'the track; the whole switch is one target'],
        ['.sp-switch-knob', 'the knob on that track'],
        ['.sp-cat-ico', 'the icon inside a settings row, which is the target'],
        ['.sp-icon', 'a mark inside a settings row'],
        ['.dp-item-icon', 'a mark inside .dp-item, which is the target'],
        ['.share-option-icon', 'a mark inside .share-option'],
        ['.dp-rem-step-sq', 'the step square inside a reminder chip'],
        ['.dp-rem-pop-grab', 'the drag handle'],
        ['.dp-rem-pop-bell', 'the illustration'],
        ['.dp-crash-mark', 'the illustration on the failure screen'],
        ['.ew-tick', 'the tick beside a sentence'],
        ['.ew-att-said', 'the live message line, not a control'],
        ['.ew-dash-count', 'a count badge inside a row that is the target'],
        ['.ew-check input', 'a checkbox inside a label row that is the target'],
        ['.dp-sec', 'the section header; .dp-sec-action inside it is the control'],
        ['.dp-tab-rule', 'the rule under an active tab'],
        ['.dp-chip::before', 'a dot'],
        ['.month-row::before', 'the timeline dot'],
      ])
      /* Comments are stripped first: a rule that explains itself before its first
         declaration (several now do) was invisible to the size scan, which is how
         this check first passed while `.theme-toggle` was 38px with its hit-area
         rule deleted. */
      const sheets = [index, employer, ui].map(f => f.replace(/\/\*[\s\S]*?\*\//g, ' ')).join('\n')
      const extensions = new Map(
        allRules(sheets)
          .filter(r => r.sel.endsWith('::after') && /inset:\s*-\d/.test(r.body))
          .map(r => [r.sel.replace('::after', ''), parseFloat(/(?:inset|inset-inline|inset-block):\s*-?(\d+(?:\.\d+)?)px/.exec(r.body)?.[1] || 0)]),
      )
      const offenders = []
      for (const r of allRules(sheets)) {
        if (!r.sel.startsWith('.') || r.media.includes('min-width')) continue
        if (r.sel.includes('::') || r.sel.includes(' ') || r.sel.includes('>')) continue
        if ([...NOT_A_CONTROL.keys()].some(k => r.sel.startsWith(k))) continue
        const sizes = []
        for (const prop of ['width', 'height', 'min-height', 'min-width']) {
          const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(r.body)
          if (m) sizes.push([prop, m[1].trim()])
        }
        const fixed = sizes.filter(([, v]) => /^\d+(?:\.\d+)?px$/.test(v))
        if (!fixed.length) continue
        const grow = extensions.get(r.sel) || 0
        for (const [prop, v] of fixed) {
          const px = parseFloat(v) + grow * 2
          if (px < 44) offenders.push(`${r.sel} ${prop}: ${v}${grow ? ` (+${grow}px hit area = ${px}px)` : ''}`)
        }
      }
      assert.deepEqual(offenders, [], 'controls a thumb cannot hit')
    })
  })

/* ── §39: the product's own words never name its plumbing ─────────────────────
 *
 * Four screens told a business owner to run a .sql file in a vendor's console
 * ("Run supabase/migrations/013_invoices.sql in the SQL editor", "Ask for migration
 * 016"). The information is real and somebody needs it — that is the difference
 * between "this is broken" and "this is not switched on yet" — so it moved behind
 * `TechDetail`, which is the one disclosure in the product and is shut until it is
 * opened.
 *
 * This is a rule about what a PERSON can read, so it is checked on the rendered
 * shape rather than by hand: every path in these screens has to sit inside a
 * TechDetail block, and the screens an employer reads first must not carry one at
 * all. It is easy to reintroduce by adding a sentence, which is exactly why it is
 * a test and not a note.
 */
describe('a file path is only ever shown inside the technical detail', () => {
  const screens = [
    'src/employer/MorePane.jsx', 'src/employer/ContractorEditor.jsx',
    'src/employer/Billing.jsx', 'src/employer/DevicePanel.jsx',
    'src/employer/PeoplePane.jsx',
  ]

  /* Everything outside the <TechDetail>…</TechDetail> blocks, comments stripped —
     a comment may discuss a migration by name, a sentence shown to an employer may
     not. */
  function visibleSource(file) {
    const src = read(file)
    const parts = src.split('<TechDetail')
    const outside = [parts[0]]
    for (const part of parts.slice(1)) {
      const close = part.indexOf('</TechDetail>')
      assert.ok(close !== -1, `${file}: a <TechDetail> that is never closed`)
      outside.push(part.slice(close))
    }
    return outside.join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
  }

  test('not one of these screens shows a .sql path outside the disclosure', () => {
    for (const file of screens) {
      const visible = visibleSource(file)
      const found = visible.match(/supabase\/migrations[^'"`\s]*/g) || []
      assert.deepEqual(found, [],
        `${file} shows a database file to an employer: ${found.join(', ')}\n`
        + 'Put it inside <TechDetail> (src/ui/Ui.jsx) and say what is true in their words.')
    }
  })

  test('and none of them tells an employer to open a SQL editor', () => {
    for (const file of screens) {
      const visible = visibleSource(file)
      assert.ok(!/SQL editor|SQL Editor/.test(visible),
        `${file} tells the reader to open a SQL editor. That is a sentence for whoever`
        + ' set the database up, and it belongs behind the technical detail.')
    }
  })

  test('the data layer never hands a path to a screen in the first place', () => {
    /* Hints are printed verbatim under an error, so a path here is a path on screen
       whatever any component does. */
    const lib = read('src/lib/employer.js')
    const found = lib.match(/supabase\/migrations[^'"`\s]*/g) || []
    assert.deepEqual(found, [], `employer.js hands a file path to the screen: ${found.join(', ')}`)
  })

  test('the disclosure exists, is one component, and is shut by default', () => {
    const ui = read('src/ui/Ui.jsx')
    assert.match(ui, /export function TechDetail\(/, 'TechDetail is gone')
    const details = ui.match(/<details/g) || []
    assert.equal(details.length, 1, 'Ui.jsx should hold exactly one <details>')
    assert.ok(!/<details[^>]*open/.test(ui), 'the disclosure is open by default')
    const css = read('src/ui/ui.css')
    assert.match(css, /\.dp-tech > summary \{[^}]*min-height:\s*var\(--tap\)/,
      'the disclosure header is not a full-size tap target')
  })

  test('and the sentences that replaced the paths are the ones that ship', () => {
    const wanted = [
      ['src/employer/MorePane.jsx', /Contractors aren’t switched on yet/],
      ['src/employer/MorePane.jsx', /Whoever set up DayPay can switch them on/],
      ['src/employer/Billing.jsx', /Invoices aren’t switched on for this account yet/],
      ['src/employer/ContractorEditor.jsx', /switched on for this account yet/],
      ['src/employer/DevicePanel.jsx', /Not switched on for this account yet/],
      ['src/lib/employer.js', /Ask whoever set DayPay up to run the database update/],
    ]
    for (const [file, pattern] of wanted) {
      const src = read(file)
      assert.match(src, pattern, `${file} lost the plain-language sentence: ${pattern}`)
    }
  })
})

/* ── the type and rhythm system ───────────────────────────────────────────────
 *
 * The brief that produced this suite reported a specific defect: on the More
 * screen the row read "ContractorsWho each worker answers to". It was not a
 * spacing preference. `.dp-item-title` and `.dp-item-sub` were <span>s inside a
 * plain <span>, so they were INLINE: one line box, no separation, and the
 * `margin-top: 1px` between them did nothing at all — you cannot set a top margin
 * on an inline element. The pair only looked right when a font's own metrics
 * happened to leave a sliver, which is why it survived every review.
 *
 * So the guards below are about the STRUCTURE, not about looking at a screenshot:
 *
 *   1. every container that stacks a title over a description is a column flex or
 *      grid whose gap comes from the one token;
 *   2. no description class sits in a container that has not declared that — the
 *      inline-span fault, made impossible;
 *   3. the shared components take their sizes and insets from the roles, so
 *      "how big is a page title" has one answer;
 *   4. and a title-and-description pair keeps a gap of 4–6px, which is the thing
 *      the report actually asked for.
 */
describe('the type and rhythm system', () => {
  /* All four sheets: the shared row, section and tab live in src/ui/ui.css, which
     CSS_FILES does not include because the other suites are about the three
     colour-bearing stylesheets. */
  const sheetsText = [...CSS_FILES, 'src/ui/ui.css'].map((f) => read(f)).join('\n')
  const bare = sheetsText.replace(/\/\*[\s\S]*?\*\//g, ' ')

  function ruleOf(sel) {
    const m = new RegExp(`(?:^|[},])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(bare)
    assert.ok(m, `${sel} has no rule — the design system lost a component`)
    return m[1]
  }

  /* Every container that puts a description under a title. Adding one to the app
     means adding it here, which is the point: the list IS the system. */
  const TEXT_STACKS = [
    ['.dp-item-text', 'a list row (the shared Item: More, Reports, People)'],
    ['.ew-head-text', 'a page header'],
    ['.ew-att-body', 'an attendance row'],
    ['.ew-person-body', 'a roster row'],
    ['.ew-prof-body', 'a worker profile'],
    ['.ew-device-body', 'a machine row'],
    ['.sp-title', 'the app header'],
    ['.sp-prof-main', 'the profile card'],
    ['.sp-cat-body', 'a settings row'],
    ['.sp-row-main', 'a settings key/value row'],
    ['.sp-rh-head', 'a row header'],
    ['.dp-fold-main', 'a fold'],
    ['.ks-site', 'the kiosk header'],
  ]

  test('every title-over-description container is a column, with the stack gap', () => {
    for (const [sel, what] of TEXT_STACKS) {
      const body = ruleOf(sel)
      const column = /display:\s*(flex|grid)/.test(body)
        && (/flex-direction:\s*column/.test(body) || /display:\s*grid/.test(body))
      assert.ok(column,
        `${sel} (${what}) does not stack its children in a column, so a description`
        + ' can share a line box with its title — the "ContractorsWho each worker'
        + ' answers to" defect. Give it display:flex; flex-direction:column.')
      assert.match(body, /gap:\s*var\(--gap-stack\)/,
        `${sel} (${what}) does not take the stack gap. A gap of 1px or 2px, or a`
        + ' margin on a child, is how the separation went missing before.')
    }
  })

  test('no description class sets its own top margin inside a stack', () => {
    /* A margin here would ADD to the container's gap and be invisible until
       somebody changed one of the two. The gap is the only mechanism. */
    for (const sel of ['.dp-item-sub', '.ew-head-text > .ew-sub']) {
      const decl = /margin-top:\s*([^;]+)/.exec(ruleOf(sel))
      assert.ok(!decl || /^0(px)?$/.test(decl[1].trim()),
        `${sel} adds its own top margin (${decl && decl[1].trim()}) on top of the container's gap`)
    }
    assert.match(ruleOf('.dp-item-sub'), /(?:^|;)\s*font-size:\s*var\(--fs-body\)/)
  })

  test('and a description out on its own is still 4–6px from its title', () => {
    /* The three places where a title and a description are the only two children
       of a card (the card, the correction form, the join screen) rely on this. */
    const body = ruleOf('.ew-sub')
    const m = /margin:\s*var\(--gap-stack\)/.exec(body)
    assert.ok(m, '.ew-sub lost the stack gap: a title and its description would touch again')
    const gap = /--gap-stack:\s*var\(--sp-1\)/.exec(read('src/index.css'))
    assert.ok(gap, '--gap-stack no longer resolves to a step of the spacing scale')
  })

  test('the shared components size themselves from the type roles', () => {
    const roles = [
      ['.ew-title', '--fs-page', 'a page title'],
      ['.sp-title-main', '--fs-page', 'the tracker title'],
      ['.dp-sec-label', '--fs-section', 'a section heading'],
      ['.sp-section-label', '--fs-section', 'a settings section heading'],
      ['.dp-item-title', '--fs-row', 'a row title'],
      ['.ew-name', '--fs-row', 'a roster row title'],
      ['.dp-item-sub', '--fs-body', 'a row description'],
      ['.ew-sub', '--fs-body', 'a header description'],
      ['.dp-tab-label', '--fs-nav', 'a navigation label'],
      ['.sp-title-sub', '--fs-meta', 'small metadata'],
    ]
    for (const [sel, token, what] of roles) {
      assert.match(ruleOf(sel), new RegExp(`font-size:\\s*var\\(${token}\\)`),
        `${what} (${sel}) does not use ${token}`)
    }
  })

  test('the page title is in the brief’s band, on its own leading', () => {
    const root = read('src/index.css')
    const page = /--fs-page:\s*var\((--fs-[a-z0-9]+)\)/.exec(root)
    assert.ok(page, '--fs-page stopped being an alias of the ramp')
    const px = { '--fs-lg': 19, '--fs-xl': 22, '--fs-2xl': 26 }[page[1]]
    assert.ok(px >= 20 && px <= 24, `the page title resolves to ${px}px, outside the brief's 20–24`)
    assert.match(ruleOf('.ew-title'), /line-height:\s*var\(--lh-title\)/,
      'a page title needs the title leading (1.25), or a wrapped title reads as body')
  })

  test('list rows take their insets from the rhythm, not from a number', () => {
    for (const [sel, what] of [['.dp-item', 'a list row'], ['.ew-row', 'a roster row'], ['.ew-person', 'a person row'], ['.sp-kv', 'a settings row']]) {
      const body = ruleOf(sel)
      assert.match(body, /padding:\s*var\(--pad-row-y\)\s+var\(--pad-row-x\)/,
        `${what} (${sel}) has its own padding instead of the row rhythm`)
    }
    const root = read('src/index.css')
    const y = /--pad-row-y:\s*var\((--sp-[0-9a-z]+)\)/.exec(root)
    assert.ok(y, '--pad-row-y is not on the spacing scale')
    const scale = { '--sp-2': 8, '--sp-3': 12, '--sp-4': 16, '--sp-5': 24 }
    assert.ok(scale[y[1]] >= 14 && scale[y[1]] <= 16,
      `a row's vertical padding is ${scale[y[1]]}px, outside the brief's 14–16`)
  })

  test('a section heading is 12px from its card and 24px from the section above', () => {
    const body = ruleOf('.dp-sec')
    assert.match(body, /margin:\s*var\(--gap-section\)\s+0\s+var\(--sp-3\)/,
      'the section rhythm is back to an 8px heading gap: a heading glued to its list')
  })

  test('the four destinations divide the bar evenly and the rule sits in the cell', () => {
    const tab = ruleOf('.dp-tab')
    assert.match(tab, /flex:\s*1 1 0/, 'the tabs no longer share the width equally')
    assert.match(tab, /align-items:\s*center/,
      'the tab content is not centred, so the rule under it cannot be')
    const rule = ruleOf('.dp-tab-rule')
    assert.match(rule, /max-width:\s*28px/, 'the active rule lost its width')
    assert.ok(!/margin-left|margin-right|transform:/.test(rule),
      'the active rule is nudged off centre by a margin or a transform')
  })

  test('a button centres its label and keeps an icon a step away from it', () => {
    const btn = ruleOf('.ew-btn')
    assert.match(btn, /justify-content:\s*center/, 'a button label is not centred in its box')
    assert.match(btn, /gap:\s*var\(--sp-2\)/, 'an icon in a button can touch the word beside it')
    assert.match(btn, /min-height:\s*var\(--tap\)/, 'a button is below the tap floor')
  })

  test('a label, its input and its helper each have their own space', () => {
    assert.match(ruleOf('.ew-field'), /gap:\s*var\(--sp-2\)/,
      'a field packs its label, input and helper too tightly together')
    assert.match(ruleOf('.ew-form'), /gap:\s*var\(--sp-4\)/,
      'fields are no longer separated on the scale')
  })
})

/* ── the same rule, from the other side: the screen that reported it ──────────
 * A CSS rule can be right while the component does not use it. These check the
 * DOM the More screen actually renders: the pair exists, in that order, inside
 * the stack container — so the styling above has something to apply to.
 */
describe('the More screen’s rows are two lines, not one run-on', () => {
  const jsx = read('src/employer/MorePane.jsx')

  test('every destination in the table carries the line that explains it', () => {
    /* The rows under More come from MORE_GROUPS, so the invariant belongs to the
       table — one place to check them all, and the place a seventh would be added.
       A destination with no `sub` renders as a title with nothing under it, which
       is the same defect from the other side. */
    const lib = read('src/lib/routes.js')
    const table = /export const MORE_GROUPS = \[([\s\S]*?)\n\]/.exec(lib)
    assert.ok(table, 'MORE_GROUPS is gone — the More screen has lost its destinations')
    const destinations = table[1].match(/\{ path: [^}]+\}/g) || []
    assert.ok(destinations.length >= 6, `found ${destinations.length} destinations — the scan is wrong`)
    for (const d of destinations) {
      assert.match(d, /label: '/, `a destination has no label: ${d}`)
      assert.match(d, /sub: '/, `a destination has no description: ${d}`)
    }
    /* And the screen must render the pair, rather than the table being right while
       the row prints only one of the two. */
    assert.match(jsx, /<Item[\s\S]{0,200}?title=\{item\.label\}[\s\S]{0,200}?sub=\{item\.sub\}/,
      'the More row no longer renders the destination\u2019s title and description together')
  })

  test('and Item renders them as a stack, never on one line', () => {
    const ui = read('src/ui/Ui.jsx')
    assert.match(ui, /className="dp-item-text"[\s\S]{0,160}?dp-item-title/,
      'Item no longer puts its title inside the text stack')
    assert.match(ui, /className="dp-item-text"[\s\S]{0,300}?dp-item-sub/,
      'Item no longer puts its description inside the text stack')
  })
})

/* ── the spacing scale, as it is actually used ────────────────────────────────
 *
 * The type and rhythm suites above guard the components. These guard the WORK —
 * the numbers that reach the screen. The brief that produced them names the
 * failure directly: §13, "no random per-screen margins". The app had ~80 of them,
 * inline in JSX: `style={{ marginTop: 10 }}` and its cousins at 5, 6, 7, 9, 11,
 * 14 and 18px. A number in a JSX attribute is invisible to every audit this
 * repository runs — the CSS scans cannot see it, the token scans cannot see it,
 * and a reviewer reading a screen cannot see why it is that number.
 *
 * They are classes now. These tests are what keeps them classes.
 */
describe('the spacing scale as it is used', () => {
  const JSX = [
    'src/App.jsx', 'src/AccountChoice.jsx', 'src/employer/AttendancePanel.jsx',
    'src/employer/Billing.jsx', 'src/employer/CheckIn.jsx', 'src/employer/ContractorEditor.jsx',
    'src/employer/ContractorView.jsx', 'src/employer/CorrectionForm.jsx',
    'src/employer/Dashboard.jsx', 'src/employer/DevicePanel.jsx', 'src/employer/EmployeeView.jsx',
    'src/employer/PeoplePane.jsx', 'src/employer/PinPanel.jsx', 'src/employer/StaffDays.jsx',
    'src/employer/Summary.jsx', 'src/employer/WorkerView.jsx',
  ]

  test('no screen carries an inline margin any more', () => {
    /* A zero is allowed: `marginTop: 0` cancels something, which is a statement
       about a component rather than a spacing decision. Anything else is a number
       the design system cannot see, and it belongs in a class. */
    const offenders = []
    for (const file of JSX) {
      read(file).split('\n').forEach((line, i) => {
        const m = /style=\{\{[^}]*\b(marginTop|marginBottom|marginLeft|marginRight)\s*:\s*([0-9.]+)/.exec(line)
        if (!m || Number(m[2]) === 0) return
        /* An SVG icon is the one exception, and it is not a spacing decision: a
           chevron nudged 2px so it sits on the text's optical baseline is
           alignment, and the 4px step would push it away from the word. */
        if (/<svg/.test(line.slice(0, m.index))) return
        offenders.push(`${file}:${i + 1} ${m[1]}: ${m[2]}`)
      })
    }
    assert.deepStrictEqual(offenders, [],
      'inline margins are back — they belong in a dp-m* class:\n  ' + offenders.join('\n  '))
  })

  test('every connector class is a step of the scale, with the size in its name', () => {
    const root = read('src/index.css')
    const steps = { 4: '--sp-1', 8: '--sp-2', 12: '--sp-3', 16: '--sp-4', 20: '--sp-4h' }
    for (const [px, token] of Object.entries(steps)) {
      for (const prop of ['margin-top', 'margin-bottom', 'margin-left']) {
        const short = { 'margin-top': 'mt', 'margin-bottom': 'mb', 'margin-left': 'ml' }[prop]
        /* Only the classes that exist — the point of the test is that no class in
           this file may name a size it does not use. */
        if (!new RegExp(`\\.dp-${short}-${px}\\s*\\{`).test(root)) continue
        const m = new RegExp(`\\.dp-${short}-${px}\\s*\\{\\s*${prop}:\\s*var\\(${token}\\)`).exec(root)
        assert.ok(m, `.dp-${short}-${px} exists but is not ${prop}: var(${token})`)
      }
    }
    for (const px of ['4', '8', '12']) {
      assert.match(root, new RegExp(`\\.dp-gap-${px}\\s*\\{\\s*gap:\\s*var\\(--sp-[0-9a-z]+\\)`),
        `.dp-gap-${px} is not a gap on the scale`)
    }
  })

  test('and every connector class used on a screen is defined', () => {
    /* A typo in a class name is silent: the element renders, nothing moves, and
       the number somebody thought they set is simply not there. */
    const css = read('src/index.css')
    const used = new Set()
    for (const file of JSX) {
      for (const m of read(file).matchAll(/className="([^"]*)"/g)) {
        for (const cls of m[1].split(/\s+/)) if (/^dp-(mt|mb|ml|mr|gap)-/.test(cls)) used.add(cls)
      }
    }
    assert.ok(used.size >= 8, `found only ${used.size} connector classes — the scan is wrong`)
    const missing = [...used].filter((cls) => !new RegExp(`\\.${cls}\\s*\\{`).test(css))
    assert.deepStrictEqual(missing, [], `classes used but never defined: ${missing.join(', ')}`)
  })

  test('the small numbers that were left are not text separations', () => {
    /* 1px, 2px and 3px survive in exactly three kinds of place, and each is
       checked here rather than assumed: a hairline grid (the calendar's lines ARE
       1px), a micro stack inside a chip or a day cell (one letter over one
       number), and an optical nudge on a checkbox. None of them may be a title
       over its description — that is the defect this whole pass exists for. */
    const sheets = ['src/index.css', 'src/ui/ui.css', 'src/employer/employer.css', 'src/kiosk/kiosk.css']
    const ALLOWED = new Set([
      '.calendar-grid',        // 1px — the grid line itself
      '.yb-vals',              // 1px — two right-aligned figures in a breakdown
      '.future-chip',          // 1px — a weekday letter over a day number, in a chip
      '.ew-att-wd',            // 1px — the same, inside an attendance day cell
      '.ew-att-cell',          // 1px — and its cell
      '.ew-prof-hero',         // 2px — a value and its unit
      '.ew-check input',       // 2px — an optical nudge on a checkbox
      '.ks-btn',               // 3px — the kiosk's own button label, calibrated
      '.ew-inv-table th',      // 1px — a table cell's padding
      '.dp-tab-rule',          // a 3px rule is the active marker
      '.ew-att-mark',          // a tick inside a 44px target
      '.dp-rem-step-sq',       // 1px — a square inside the reminders stepper
      '.ew-att-cell',          // 1px — a day cell's own padding
      '.ew-checkin-tick',      // 2px — a tick inside a 44px circle
    ])
    for (const sheet of sheets) {
      const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, ' ')
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim().split(/\s+/).slice(-1)[0]
        if (!/\b(gap|margin-top|margin)\s*:\s*[123]px/.test(m[2])) continue
        const known = ALLOWED.has(sel) || ALLOWED.has(m[1].trim())
        assert.ok(known, `${sheet}: ${m[1].trim()} sets gap or margin to 1–3px.`
          + ' A separation that small is a no-op on text — use the stack gap,'
          + ' or add this selector to ALLOWED with the reason.')
      }
    }
  })
})

/* ── one left edge ────────────────────────────────────────────────────────────
 * The brief's §6: "logo, page content, section headings and cards share one left
 * grid". They did not. The header's logo sits at 16px and the tracker's pages
 * inset themselves by the same 16px, so the grid existed — but the employer
 * workspace put its blocks directly on `.ew`, which had no side padding at all.
 * A page title therefore began at the glass while the row that repeated the same
 * word began at 16px: two left edges on one screen.
 */
describe('the page grid', () => {
  const employer = read('src/employer/employer.css').replace(/\/\*[\s\S]*?\*\//g, ' ')

  test('page-level blocks are inset by the page gutter', () => {
    const m = /\.ew :is\(([^)]*)\):not\(([^)]*)\)\s*\{([^}]*)\}/.exec(employer)
    assert.ok(m, 'the page grid rule is gone — page titles are back at the glass')
    const inset = m[1]
    for (const sel of ['.ew-head', '.dp-sec', '.ew-glance', '.ew-today-head', '.ew-find']) {
      assert.ok(inset.includes(sel), `${sel} is no longer on the page grid`)
    }
    assert.match(m[3], /padding-inline:\s*var\(--gap-page\)/,
      'the page grid stopped using the page-gutter token')
    /* and it declares its own reason for the exclusion */
    assert.match(employer, /:not\([\s\S]{0,240}?\.ew-card \*/,
      'the page grid lost the rule that stops a nested block being inset twice')
  })

  test('the gutter is the same 16px as the logo and the tracker’s pages', () => {
    const root = read('src/index.css')
    assert.match(root, /--gap-page:\s*var\(--sp-4\)/, '--gap-page is no longer the 16px step')
    assert.match(root, /\.header\s*\{[^}]*padding:\s*var\(--sp-3\) var\(--sp-4\)/,
      'the header no longer insets its logo by the page gutter')
    assert.match(root, /\.summary-card\s*\{[^}]*padding:\s*var\(--sp-4\) var\(--sp-4\) 0/,
      'the tracker page no longer shares the one left edge')
    assert.match(root, /\.year-totals\s*\{[^}]*padding:\s*var\(--sp-4\) var\(--sp-4\) 0/,
      'the tracker page no longer shares the one left edge')
  })
})

/* ── the way back ─────────────────────────────────────────────────────────────
 * §41 found the control that leaves a screen failing its one job: the words
 * "More" or "All workers" with a glyph typed in front of them, 12px, in the
 * quietest grey in the palette, with no border and no background. It read as a
 * caption. A reader one level deep had to know what the previous screen was
 * called to know that this was the way back to it.
 *
 * These guard the shape it has now, and the two things that make a Back control
 * honest: it is a control you can see and press, and it goes to the previous
 * logical screen rather than to wherever a hard-coded link points.
 */
describe('the way back', () => {
  const ui = read('src/ui/ui.css').replace(/\/\*[\s\S]*?\*\//g, ' ')
  const component = read('src/ui/Ui.jsx')

  test('it is a control you can see and press, not a line of grey text', () => {
    const m = /\.dp-back \{([^}]*)\}/.exec(ui)
    assert.ok(m, '.dp-back is gone — the way back is back to being a caption')
    const body = m[1]
    assert.match(body, /min-height:\s*var\(--tap\)/, 'the way back is under the tap floor')
    assert.match(body, /border:\s*1px solid var\(--border\)/, 'the way back has no visible edge')
    assert.match(body, /background:\s*var\(--bg-elevated\)/, 'the way back is not a surface')
    assert.match(body, /color:\s*var\(--text\)/, 'the way back is set in the quietest grey again')
    assert.match(body, /gap:\s*var\(--sp-2\)/, 'the arrow touches its own word')
    assert.match(body, /font-weight:\s*var\(--fw-value\)/, 'the way back is not emphasised')
    assert.ok(!/::before\s*\{\s*content:\s*'[←‹]/.test(ui),
      'the arrow is a typed glyph again instead of an icon that scales with the text')
    assert.match(ui, /\.dp-back:focus-visible\s*\{[^}]*outline/, 'no focus ring on the way back')
  })

  test('it says Back, and names the screen in the accessible name', () => {
    assert.match(component, /export function BackLink\(/, 'the shared Back control is gone')
    assert.match(component, /aria-label=\{name\}/, 'the control has no accessible name')
    assert.match(component, /`Back to \$\{titleFor\(to\)\}`/,
      'the accessible name no longer says where it goes')
    assert.match(component, /useState|onBack \?/, 'BackLink no longer distinguishes a link from a button')
  })

  test('it goes back a step, and only falls back when there is nothing behind', () => {
    /* The difference between a Back control and a link to the parent screen. */
    const router = read('src/lib/router.js')
    assert.match(router, /export function back\(/, 'back() is gone')
    assert.match(router, /if \(canGoBack\(\)\) \{ window\.history\.back\(\); return \}/,
      'back() no longer prefers the screen the reader actually came from')
    assert.match(router, /export function canGoBack\(\)/, 'the depth test is gone')
    assert.match(router, /STATE_KEY/, 'history entries are no longer stamped with a depth')
    /* `replace` must not count as a step: a redirect the reader did not ask for
       must not become something they can go back to. */
    assert.match(router, /const state = \{ \[STATE_KEY\]: replace \? depth : depth \+ 1 \}/,
      'replace() now pushes a depth, so Back walks into redirects')
  })

  test('and every screen that is a step deeper carries it', () => {
    const workspace = read('src/employer/EmployerWorkspace.jsx')
    assert.ok(workspace.includes('<BackLink to='),
      'the screens under More lost their way back')
    assert.match(workspace, /settingsCategoryFor\(path\) \? MORE\.settings : EMPLOYER\.more/,
      "a Settings category's way back no longer goes to Settings")
    for (const file of ['src/employer/ContractorView.jsx', 'src/employer/WorkerView.jsx']) {
      assert.ok(read(file).includes('<BackLink onBack='),
        `${file} draws its own way back instead of the shared control`)
    }
    /* The old control's class must be gone with it, or a screen keeps a second
       way back that nobody styles. */
    assert.ok(!read('src/employer/employer.css').includes('.ew-back'),
      '.ew-back is still in the stylesheet after its last user retired')
  })
})
