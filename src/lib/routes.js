/* DayPay — the addresses, and the navigation they describe.
 *
 * Every screen in the product has one address, and this file is the only place
 * that knows them. Before Phase 3 there were none: the app had a `view` string
 * and the employer workspace had a `pane` string, so nothing could be linked to,
 * bookmarked, or returned to with the back button — and a reload always dropped
 * you at the beginning.
 *
 * Two rules this file exists to keep true:
 *
 *   1. **One address space, two levels.** The shell chooses between the
 *      personal tracker, the worker's own view and the employer workspace; the
 *      employer workspace chooses between its own destinations. Both read the
 *      same path, so there is never a second answer to "where am I".
 *   2. **Nothing is deleted to make the navigation tidy.** The four employer
 *      destinations are the employer's navigation. The personal tracker is a
 *      complete product that needs no account, so it keeps its place under
 *      More rather than disappearing from the interface.
 *
 * This file is pure. It imports nothing, touches no browser API, and can be
 * read from a test with `node --test` alone — the browser half is router.js.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

/* The address that means "wherever this account belongs". What that is depends
   on the account, and `homeViewFor()` in employerLogic.js is still the single
   rule that decides it. */
export const HOME = '/'

/* ── The employer's four destinations (§3 of the brief) ───────────────────── */

export const EMPLOYER = {
  today: '/today',
  attendance: '/attendance',
  people: '/people',
  more: '/more',
}

/* Adding a worker is a step inside People, and it has its own address (Phase 9).
   The reason is not tidiness: on the day the roster is empty, the command centre
   offers "Add a worker" as the one thing to do — and a button that says that has
   to land on the form, not on a screen where the form is still one more tap away.
   An address also survives a reload, which a `useState` flag cannot. */
export const PEOPLE_ADD = '/people/new'

/* Everything secondary, grouped. Each of these is a screen with its own
   address, which is what lets More be a page rather than a menu. */
export const MORE = {
  contractors: '/more/contractors',
  kiosk: '/more/kiosk',
  billing: '/more/billing',
  reports: '/more/reports',
  settings: '/more/settings',
  notifications: '/more/notifications',
}

/* ── The surfaces that are not the employer's ─────────────────────────────── */

/* The personal tracker: account-less, local, and its own product. It was the
   app's default view before this phase and it still is for anyone without an
   account — the addresses are new, the screens are not. */
export const TRACKER = { month: '/tracker/month', year: '/tracker/year' }

/* A worker's own view — "My work". */
export const WORK = '/work'

/* ── The navigation, as data ──────────────────────────────────────────────────
   The tab bar and the More screen are rendered FROM these lists, so a
   destination cannot exist in the bar and be missing from the address table, or
   be added to the table and never appear. tests/routes.test.js holds both ends. */

export const EMPLOYER_NAV = [
  { path: EMPLOYER.today, label: 'Today' },
  { path: EMPLOYER.attendance, label: 'Attendance' },
  { path: EMPLOYER.people, label: 'People' },
  { path: EMPLOYER.more, label: 'More' },
]

export const MORE_GROUPS = [
  {
    label: 'Workforce',
    items: [
      { path: MORE.contractors, label: 'Contractors', sub: 'Who each worker answers to' },
      { path: MORE.kiosk, label: 'Site kiosk', sub: 'For workers without a phone' },
    ],
  },
  {
    label: 'Pay & reporting',
    items: [
      { path: MORE.billing, label: 'Billing', sub: 'What each contractor owes' },
      { path: MORE.reports, label: 'Reports', sub: 'What a month costs' },
    ],
  },
  {
    label: 'Your own tracker',
    items: [
      { path: TRACKER.month, label: 'Month', sub: 'Your own days, kept on this device' },
      { path: TRACKER.year, label: 'Year', sub: 'Your own year at a glance' },
    ],
  },
  {
    label: 'Account',
    items: [
      { path: MORE.settings, label: 'Settings', sub: 'Appearance, rates, data' },
      { path: MORE.notifications, label: 'Notifications', sub: 'Reminders to record your days' },
    ],
  },
]

/* ── Reading a path ─────────────────────────────────────────────────────────── */

/* '#/people' → '/people'. '' | '#' | '/#/' → '/'. A trailing slash is not a
   different screen: '/people/' is '/people'. Query strings and fragments are
   dropped — no screen needs them yet, and pretending otherwise would mean
   routing on something nobody has thought about. */
export function normalisePath(raw) {
  let p = String(raw == null ? '' : raw).trim()
  const hash = p.indexOf('#')
  if (hash !== -1) p = p.slice(hash + 1)
  /* A second '#' is a fragment inside the route — '#/people#top' is a link to
     the top of the People screen, and the screen is still People. */
  const inner = p.indexOf('#')
  if (inner !== -1) p = p.slice(0, inner)
  const q = p.indexOf('?')
  if (q !== -1) p = p.slice(0, q)
  if (!p.startsWith('/')) p = '/' + p
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p === '' ? HOME : p
}

/* Every address the app knows, in one list — used by the tests to prove that
   nothing in the navigation points at a screen that does not exist. */
export const ALL_PATHS = [
  HOME,
  ...EMPLOYER_NAV.map(d => d.path),
  PEOPLE_ADD,
  ...Object.values(MORE),
  /* One step inside Settings: not a screen of its own, and still an address that
     has to resolve to a real place rather than a blank pane. */
  settingsPath('earnings'),
  ...Object.values(TRACKER),
  WORK,
]

/* Which employer destination a path belongs to, or null if it is not the
   employer's at all. A More sub-screen belongs to More — that is what keeps the
   tab bar showing More while you are inside it. */
export function employerPaneFor(path) {
  const p = normalisePath(path)
  if (p === EMPLOYER.today) return 'today'
  if (p === EMPLOYER.attendance) return 'attendance'
  /* A step inside People still belongs to People — the tab bar keeps saying so,
     and the way back is the roster itself, not the tab bar. Named exactly, not by
     prefix: an address nobody wrote a screen for has to keep falling through to
     home rather than claiming to be a step. */
  if (p === EMPLOYER.people || p === PEOPLE_ADD) return 'people'
  if (p === EMPLOYER.more || p.startsWith(EMPLOYER.more + '/')) return 'more'
  return null
}

/* Which screen inside People a path names, or null for the roster itself. The
   same shape as MORE_SCREENS below, for the same reason: the workspace switches
   on these values, and a test counts them. */
export const PEOPLE_SCREENS = {
  [PEOPLE_ADD]: 'new',
}

export function peopleScreenFor(path) {
  return PEOPLE_SCREENS[normalisePath(path)] || null
}

/* ── The steps inside a screen ────────────────────────────────────────────────
   A category inside Settings is a step, not a screen of its own: the same page
   with one drawer open. It has an address for the reason every other level has
   one — the phone's own Back button. A level that lives only in `useState` is
   invisible to the browser's history, so Android's back gesture has nothing to
   walk and closes the app instead of stepping up. With an address, Back walks
   Settings → its category → Settings → whatever brought you here. */
export function settingsPath(category) {
  return category ? `${MORE.settings}/${category}` : MORE.settings
}

/* The categories Settings has, as data. The display names live with the page that
   draws them (SP_CAT_NAMES in App.jsx); this is the list of addresses, and
   tests/routes.test.js fails if the two ever disagree. */
export const SETTINGS_CATEGORIES = [
  'profile', 'workplace', 'appearance', 'earnings', 'reminders', 'data', 'about',
]

/* The category a path names, or null for the Settings index itself — and null for
   anything that is not a category, so a made-up address cannot claim to be one. */
export function settingsCategoryFor(path) {
  const p = normalisePath(path)
  const prefix = MORE.settings + '/'
  if (!p.startsWith(prefix)) return null
  const cat = p.slice(prefix.length)
  return SETTINGS_CATEGORIES.includes(cat) ? cat : null
}

/* Which screen inside More a path names, or null for the More index itself.
   The keys are what the workspace switches on; the values are what a test
   counts, so a screen added under More cannot be forgotten by the renderer. */
export const MORE_SCREENS = {
  [MORE.contractors]: 'contractors',
  [MORE.kiosk]: 'kiosk',
  [MORE.billing]: 'billing',
  [MORE.reports]: 'reports',
  [MORE.settings]: 'settings',
  [MORE.notifications]: 'notifications',
}

export function moreScreenFor(path) {
  const p = normalisePath(path)
  if (MORE_SCREENS[p]) return MORE_SCREENS[p]
  /* A step INSIDE a screen under More is still that screen — a Settings category
     is Settings with one drawer open, not a seventh destination, and the tab bar
     and the workspace both have to keep saying so. */
  if (settingsCategoryFor(p)) return MORE_SCREENS[MORE.settings]
  return null
}

/* Which of the shell's views a path names, or null for "wherever this account
   belongs" — the caller decides that with homeViewFor(). */
export function shellViewFor(path) {
  const p = normalisePath(path)
  if (employerPaneFor(p)) return 'staff'
  if (p === TRACKER.month) return 'month'
  if (p === TRACKER.year) return 'year'
  if (p === WORK) return 'me'
  return null
}

/* The reverse, so existing callers can say setView('month') and get an address.
   `homeViewFor()` returns 'staff' for a business account, and that is the
   employer's first destination — Today. */
export function pathForView(view) {
  if (view === 'month') return TRACKER.month
  if (view === 'year') return TRACKER.year
  if (view === 'me') return WORK
  if (view === 'staff') return EMPLOYER.today
  return HOME
}

/* What the browser tab should say. Short — a phone shows about fifteen
   characters of it. */
export function titleFor(path) {
  const p = normalisePath(path)
  if (p === EMPLOYER.today) return 'Today'
  if (p === EMPLOYER.attendance) return 'Attendance'
  if (p === EMPLOYER.people) return 'People'
  if (p === PEOPLE_ADD) return 'Add a worker'
  if (p === EMPLOYER.more) return 'More'
  if (p === MORE.contractors) return 'Contractors'
  if (p === MORE.kiosk) return 'Site kiosk'
  if (p === MORE.billing) return 'Billing'
  if (p === MORE.reports) return 'Reports'
  if (p === MORE.settings || settingsCategoryFor(p)) return 'Settings'
  if (p === MORE.notifications) return 'Notifications'
  if (p === TRACKER.month) return 'Month'
  if (p === TRACKER.year) return 'Year'
  if (p === WORK) return 'My work'
  return 'DayPay'
}
