/* DayPay — the information architecture, held to its own rules.
 *
 * Phase 3 gave every screen an address. That is only worth anything if the
 * addresses and the navigation cannot drift apart: a destination in the bar
 * with no address is a dead control, and an address with no destination is a
 * blank pane. These tests read the real table — src/lib/routes.js is pure, so
 * they need no browser and no mocks — and they hold the promises the brief
 * makes about navigation:
 *
 *   · four destinations, and the name each one is called by (§3);
 *   · nothing secondary pretending to be primary (§32): Contractors, the kiosk,
 *     Billing and Reports are under More, not in the bar;
 *   · the personal tracker still has a door (§ the audit's finding that DayPay
 *     is three products in one shell — the tracker needs no account, and
 *     deleting it from the interface would delete a product);
 *   · an unknown address falls back to something that exists rather than to a
 *     blank pane;
 *   · the way in and the way out agree: whatever a path says you are looking
 *     at, the pane it names is the pane that renders.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test, describe } from 'node:test'

import {
  ALL_PATHS, EMPLOYER, EMPLOYER_NAV, HOME, MORE, MORE_GROUPS, PEOPLE_ADD,
  PEOPLE_SCREENS, SETTINGS_CATEGORIES, TRACKER, WORK, employerPaneFor,
  moreScreenFor, normalisePath, pathForView, peopleScreenFor, settingsCategoryFor,
  settingsPath, shellViewFor, titleFor,
} from '../src/lib/routes.js'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

describe('every destination has an address, and every address a destination', () => {
  test('the employer navigates by the four destinations the brief names', () => {
    assert.deepEqual(
      EMPLOYER_NAV.map(d => d.label),
      ['Today', 'Attendance', 'People', 'More'],
      'the primary navigation is not the four destinations §3 asks for')
    assert.deepEqual(
      EMPLOYER_NAV.map(d => d.path),
      ['/today', '/attendance', '/people', '/more'],
      'a destination moved address, so every link to it is now wrong')
  })

  test('nothing secondary is in the primary bar', () => {
    /* §32 — "does the user need this right now". Invoicing, contractors and the
       kiosk fail that test; they live one level down, which is the whole point
       of More existing rather than a sixth and seventh tab. */
    for (const label of ['Contractors', 'Site kiosk', 'Billing', 'Reports', 'Settings']) {
      assert.ok(!EMPLOYER_NAV.some(d => d.label === label),
        `${label} is back in the primary bar — it belongs under More`)
    }
  })

  test('the bar is rendered from this table, so it cannot disagree with it', () => {
    const bar = read('src/ui/TabBar.jsx')
    assert.ok(bar.includes('EMPLOYER_NAV'),
      'the tab bar does not read the destination list, so the two can drift apart')
    const workspace = read('src/employer/EmployerWorkspace.jsx')
    assert.ok(workspace.includes('<TabBar pane={pane} />'),
      'the workspace renders no tab bar')
  })

  test('every path in the table resolves to a screen, and none to blank', () => {
    for (const path of ALL_PATHS) {
      /* '/' is deliberately not a screen: it means "wherever this account
         belongs", and homeViewFor() answers that. Every other address must name
         one, or a link to it would open a blank pane. */
      if (path === HOME) continue
      assert.ok(employerPaneFor(path) || shellViewFor(path),
        `${path} is in the address table but names no screen`)
      assert.ok(titleFor(path) !== 'DayPay',
        `${path} has no title, so a reader cannot tell where they are`)
    }
  })
})

describe('the address decides the screen', () => {
  test('the four destinations name the four employer panes', () => {
    assert.equal(employerPaneFor(EMPLOYER.today), 'today')
    assert.equal(employerPaneFor(EMPLOYER.attendance), 'attendance')
    assert.equal(employerPaneFor(EMPLOYER.people), 'people')
    assert.equal(employerPaneFor(EMPLOYER.more), 'more')
  })

  test('a screen inside More is still More', () => {
    /* Otherwise the tab bar loses its selected state the moment you open
       Invoicing, and a reader loses the one cue that says which of the four
       they are inside. */
    for (const path of Object.values(MORE)) {
      assert.equal(employerPaneFor(path), 'more',
        `${path} does not sit inside More, so the bar stops showing where you are`)
    }
  })

  test('the tracker and the worker have addresses of their own', () => {
    assert.equal(shellViewFor(TRACKER.month), 'month')
    assert.equal(shellViewFor(TRACKER.year), 'year')
    assert.equal(shellViewFor(WORK), 'me')
    assert.equal(shellViewFor(EMPLOYER.people), 'staff')
  })

  test('adding a worker is a step inside People, with an address of its own', () => {
    /* The command centre's one action on an empty roster has to land ON the form,
       a reload has to come back to it, and the way out has to be an address rather
       than a piece of state only one component can see. The step is still People:
       the tab bar keeps saying where the employer is. */
    assert.equal(PEOPLE_ADD, '/people/new')
    assert.equal(peopleScreenFor(PEOPLE_ADD), 'new')
    assert.equal(peopleScreenFor(EMPLOYER.people), null)
    assert.equal(employerPaneFor(PEOPLE_ADD), 'people',
      'the add step left People, so the tab bar stops saying where you are')
    assert.ok(ALL_PATHS.includes(PEOPLE_ADD), 'the add step has no address')
    assert.ok(Object.values(PEOPLE_SCREENS).includes('new'))
    assert.equal(titleFor(PEOPLE_ADD), 'Add a worker')

    /* And the guarantee this could have quietly broken: the step is named exactly,
       so an address nobody wrote a screen for still falls through to home. */
    for (const junk of ['/people/new/2', '/people/whoever', '/people/new/done']) {
      assert.equal(employerPaneFor(junk), null, `${junk} claims to be a step in People`)
    }
  })

  test('an address nobody wrote a screen for is not a blank pane', () => {
    for (const junk of ['/nope', '/people/whoever/deeper', '/  ', 'what is this']) {
      assert.equal(shellViewFor(junk), null,
        `${junk} claims to name a screen — an unknown address must fall through to home`)
      assert.equal(employerPaneFor(junk), null, `${junk} claims to be an employer pane`)
    }
    /* The employer's default is the command centre, not an empty pane: `/`
       means "wherever this account belongs", and for an employer that is Today
       — which is also what homeViewFor() has always said. */
    assert.equal(employerPaneFor('/') || 'today', 'today')
  })

  test('rounding a view through an address gets you back', () => {
    for (const view of ['month', 'year', 'me', 'staff']) {
      assert.equal(shellViewFor(pathForView(view)), view,
        `${view} → ${pathForView(view)} → ${shellViewFor(pathForView(view))} is not a round trip`)
    }
  })

  test('a link keeps its own shape', () => {
    assert.equal(normalisePath('#/people'), '/people')
    assert.equal(normalisePath('/#/people'), '/people')
    assert.equal(normalisePath('/people/'), '/people', 'a trailing slash is a different path')
    assert.equal(normalisePath(''), '/')
    assert.equal(normalisePath('#'), '/')
    assert.equal(normalisePath('#/more/billing?x=1'), '/more/billing')
    assert.equal(normalisePath('#/people#top'), '/people')
  })
})

describe('More is a page, not a menu of nothing', () => {
  test('every group has a label and at least one row', () => {
    assert.ok(MORE_GROUPS.length >= 3, `only ${MORE_GROUPS.length} groups under More`)
    for (const group of MORE_GROUPS) {
      assert.ok(group.label && group.label.trim(), 'a group has no label')
      assert.ok(group.items.length > 0, `${group.label} has no rows`)
      for (const item of group.items) {
        assert.ok(item.label && item.path, `a row in ${group.label} has no label or no address`)
      }
    }
  })

  test('every row goes somewhere that exists', () => {
    for (const group of MORE_GROUPS) {
      for (const item of group.items) {
        assert.ok(ALL_PATHS.includes(item.path),
          `"${item.label}" points at ${item.path}, which is not in the address table`)
        assert.ok(titleFor(item.path) !== 'DayPay',
          `"${item.label}" goes to a screen with no title`)
      }
    }
  })

  test('the personal tracker keeps a door', () => {
    /* The audit's first finding: DayPay is three products sharing a shell, and
       the personal tracker is one of them — account-less, local, with its own
       pay model. The four destinations are the EMPLOYER's navigation, so the
       tracker has to be reachable from them, or the redesign deleted a product
       by tidying up. */
    const paths = MORE_GROUPS.flatMap(g => g.items.map(i => i.path))
    assert.ok(paths.includes(TRACKER.month), 'the personal tracker lost its way in')
    assert.ok(paths.includes(TRACKER.year), 'the tracker year view lost its way in')
    assert.ok(read('src/App.jsx').includes('dp-back'),
      'the tracker has no way back to More when an employer opens it')
  })

  test('the screens that moved out of the bar are all reachable', () => {
    /* Contractors, the kiosk, Billing and Reports used to be rows at the foot
       of the People screen. They are under More now — so the check that matters
       is not where they went but that they can still be got to. */
    for (const path of [MORE.contractors, MORE.kiosk, MORE.billing, MORE.reports]) {
      assert.equal(moreScreenFor(path), path.split('/').pop(),
        `${path} is listed as reachable but resolves to no screen`)
    }
    const workspace = read('src/employer/EmployerWorkspace.jsx')
    for (const name of ['ContractorEditor', 'DevicePanel', 'Billing', 'Summary']) {
      assert.ok(workspace.includes(name),
        `${name} is not rendered anywhere, so a row under More opens nothing`)
    }
  })

  test('Settings is an address, and the shell is what answers it', () => {
    const app = read('src/App.jsx')
    assert.ok(app.includes('path === MORE.settings'),
      'the Settings row under More opens nothing')
    assert.ok(app.includes('closeSettings'),
      'closing Settings does not put the address back, so Back appears to do nothing')
  })
})

describe('a step inside a screen is an address too (§41)', () => {
  /* The navigation defect this pass fixed: a level a screen keeps in `useState`
     is invisible to the browser's history, so the phone's own Back button has
     nothing to walk and closes the app instead of stepping up. A category inside
     Settings was the one that mattered. It is an address now. */

  test('a category is a step inside Settings, not a seventh destination', () => {
    for (const cat of SETTINGS_CATEGORIES) {
      const p = settingsPath(cat)
      assert.equal(p, `${MORE.settings}/${cat}`)
      assert.equal(settingsCategoryFor(p), cat, `${p} does not name its category`)
      assert.equal(employerPaneFor(p), 'more', `${p} left the More destination`)
      assert.equal(moreScreenFor(p), 'settings',
        `${p} is not answered by the Settings screen, so Back would land on nothing`)
      assert.equal(titleFor(p), 'Settings', `${p} has no title of its own`)
    }
  })

  test('and the Settings index is still the index', () => {
    assert.equal(settingsPath(), MORE.settings)
    assert.equal(settingsCategoryFor(MORE.settings), null)
    assert.equal(moreScreenFor(MORE.settings), 'settings')
  })

  test('an address nobody wrote claims nothing', () => {
    /* The rule the whole file keeps: junk falls through to home rather than
       pretending to be a screen. A made-up category must not become one. */
    for (const junk of ['/more/settings/nonsense', '/more/settings/PROFILE',
      '/more/settings/', '/more/settings/profile/extra']) {
      assert.equal(settingsCategoryFor(junk), null, `${junk} claims to be a category`)
    }
    assert.equal(moreScreenFor('/more/settings/nonsense'), null,
      'a made-up category is being answered by the Settings screen')
    assert.equal(employerPaneFor('/more/settings/nonsense'), 'more',
      'an unknown step under More stops belonging to More')
  })

  test('the categories the address table knows are the ones the page draws', () => {
    /* Two lists exist for a reason: the addresses are routing, the names are copy.
       What must never happen is a category the page can open and the router cannot
       name — that is a Back button with nowhere to go. */
    const app = read('src/App.jsx')
    const names = /const SP_CAT_NAMES = \{([\s\S]*?)\}/.exec(app)
    assert.ok(names, 'SP_CAT_NAMES is gone — the crumb has nothing to say')
    const listed = [...names[1].matchAll(/([a-z]+):\s*'/g)].map(m => m[1]).sort()
    assert.deepStrictEqual(listed, [...SETTINGS_CATEGORIES].sort(),
      'the settings page and the routing table disagree about which categories exist')
  })

  test('every category card opens its own address', () => {
    const app = read('src/App.jsx')
    for (const cat of SETTINGS_CATEGORIES) {
      assert.ok(app.includes(`settingsPath('${cat}')`),
        `the ${cat} card does not open an address, so Back cannot step out of it`)
    }
    assert.ok(app.includes('settingsCategoryFor(path)'),
      'nothing reads the category out of the address, so a deep link cannot open one')
  })

  test('and every one of them is a screen the app can draw', () => {
    for (const cat of SETTINGS_CATEGORIES) {
      const p = settingsPath(cat)
      assert.ok(employerPaneFor(p) || shellViewFor(p), `${p} resolves to no screen`)
      assert.notEqual(titleFor(p), 'DayPay', `${p} is an unnameable address`)
    }
  })
})

describe('the four destinations are the only navigation an employer gets', () => {
  test('the old five-tab bar is gone, not hidden', () => {
    const workspace = read('src/employer/EmployerWorkspace.jsx')
    assert.ok(!workspace.includes('ew-subtabs'),
      'the old five-tab bar is still in the workspace, so an employer sees two navigations')
    const people = read('src/employer/PeoplePane.jsx')
    assert.ok(!people.includes('DevicePanel') && !people.includes('ContractorEditor'),
      'the roster still carries the two footer rows that moved to More')
  })

  test('a person row still opens the person, and People is where they live', () => {
    /* The rename must not lose the work the previous pass did: the heading, the
       tab and the address all say People, and the word only survives where it
       is the correct word for a group of workers. */
    const people = read('src/employer/PeoplePane.jsx')
    assert.ok(people.includes('<h2 className="ew-title">People</h2>'),
      'the screen still calls itself Roster while the tab says People')
    assert.ok(people.includes('on roster,'),
      'the summary line lost the word roster, which is the correct word here')
  })
})
