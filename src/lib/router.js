/* DayPay — the router. Small on purpose.
 *
 * The brief asks for navigation that keeps your place and lets you go back
 * (§28). That needs addresses, and addresses need somewhere to live. This is
 * the whole of it: a hash, a subscription, and a memory of where you were
 * standing on each screen.
 *
 * **Why the hash and not the History API.** The app is served as static files
 * from `dist/` — on Vercel, and in this preview, and on any other host someone
 * points at it. A History-API router needs the server to serve index.html for
 * every unknown path, which means a rewrite rule that has to be right on every
 * host forever, and a deep link that 404s when it is not. `#/people` works
 * everywhere the file itself works, including from the filesystem, and cannot
 * be broken by a hosting config. The cost is a `#` in the address bar; the
 * benefit is that a link somebody sends you always opens.
 *
 * **Why not a routing library.** What the app needs is: read the address, go to
 * an address, hear about it when it changes. That is about forty lines, it adds
 * no dependency to vet, and it keeps the existing `view`/`pane` state as the
 * description of what is on screen with the address as its name — rather than
 * making every screen learn a router's vocabulary first.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useState } from 'react'
import { HOME, normalisePath } from './routes.js'

/* ── How deep this screen is, stamped on the entry itself ─────────────────────
 *
 * The browser will not tell an app whether the entry behind it is one of its own.
 * `history.length` counts everything — the page before DayPay, the new-tab page,
 * the whole session — so a screen cannot tell "there is a screenshot of mine
 * behind me" from "behind me is somebody else's website", and an app that guesses
 * either strands the reader inside itself or drops them out of it.
 *
 * So every entry this router creates carries a depth of its own. The first is 0;
 * each push is one more than the entry it came from. Then `back()` is decidable:
 * depth > 0 means this app put something behind us and the browser's back is the
 * right move; depth 0 means this screen was opened by a link or a fresh launch,
 * and "back" means the screen it belongs to.
 *
 * This is also what makes the phone's own Back work. A state a screen keeps in
 * `useState` — a contractor, a worker, a settings category — is not in the
 * history, so Android's back gesture has nothing to walk and closes the app
 * instead. Anything a reader can go a level deeper into now has an entry. */
const STATE_KEY = 'dpDepth'

function depthOf() {
  if (!hasWindow() || !window.history || !window.history.state) return 0
  const d = window.history.state[STATE_KEY]
  return typeof d === 'number' && d >= 0 ? d : 0
}

/* Is there a screen of ours behind this one? */
export function canGoBack() {
  return depthOf() > 0
}

const hasWindow = () => typeof window !== 'undefined' && !!window.location

/* The address right now. Never throws on a path nobody wrote a screen for —
   an unknown address is a 404 only in the sense that it falls back to home,
   which is friendlier than a blank pane and is what a static host would give
   us anyway. */
export function currentPath() {
  if (!hasWindow()) return HOME
  return normalisePath(window.location.hash)
}

/* Where the reader was standing on each screen. Restoring it is what makes the
   back button feel like going back rather than starting again. */
const scrollMemo = new Map()
const listeners = new Set()

function remember(path) {
  if (!hasWindow()) return
  if (typeof window.scrollY === 'number') scrollMemo.set(path, window.scrollY)
}

function restore(path) {
  if (!hasWindow()) return
  const y = scrollMemo.get(path)
  if (y == null) return
  /* jsdom has no layout, so scrollY is always 0 and this never fires there.
     The guard is also what keeps a remembered 0 from being a pointless call. */
  if (y !== window.scrollY && typeof window.scrollTo === 'function') {
    try { window.scrollTo(0, y) } catch { /* no layout engine — nothing to scroll */ }
  }
}

function announce(path) {
  for (const fn of listeners) fn(path)
}

/* Subscribe to address changes, including the ones the browser makes for us:
   the back button, a pasted link, a hash someone edits by hand. Returns the
   unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn)
  if (!hasWindow()) return () => listeners.delete(fn)
  const onHash = () => {
    const path = currentPath()
    restore(path)
    fn(path)
  }
  window.addEventListener('hashchange', onHash)
  window.addEventListener('popstate', onHash)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('hashchange', onHash)
    window.removeEventListener('popstate', onHash)
  }
}

/* Go to an address.
 *
 * `replace` swaps the current entry instead of adding one — for a redirect the
 * reader did not ask for, so the back button does not lead into a loop.
 *
 * Listeners are told immediately rather than waiting for the browser's
 * hashchange event. The event is what makes the back button work; waiting for
 * it would make every tap in the interface lag one task behind the finger. */
export function navigate(path, { replace = false } = {}) {
  const next = normalisePath(path)
  const now = currentPath()
  if (next === now) return
  remember(now)
  if (!hasWindow()) { announce(next); return }
  const url = `#${next}`
  const depth = depthOf()
  const canPush = window.history && typeof window.history.pushState === 'function'
  if (canPush) {
    /* `replace` keeps the depth it is replacing — a redirect the reader did not
       ask for must not count as a step they can go back to. */
    const state = { [STATE_KEY]: replace ? depth : depth + 1 }
    if (replace) window.history.replaceState(state, '', url)
    else window.history.pushState(state, '', url)
  } else {
    /* No History API (an ancient browser, or a test double): the address still
       moves, which is the part that matters. `back()` degrades to its fallback,
       which is the screen the reader came from as far as anyone can prove. */
    window.location.hash = next
  }
  /* Arriving at a screen you have already been on puts you back where you were;
     a screen you have not opened starts at the top. */
  restore(next)
  announce(next)
}

/* ── Going back one logical step ──────────────────────────────────────────────
 *
 * What every Back control in the product calls. Two cases, and the difference is
 * the whole reason this function exists rather than a `window.history.back()` in
 * each screen:
 *
 *   · there is a screen of ours behind this one — the reader walked here, so the
 *     truth is whatever they came from. The browser's own back, unchanged;
 *   · there is not — this screen was opened by a link, a notification, a shortcut,
 *     or a fresh launch on the phone. Going "back" out of the app would be wrong,
 *     so it goes to the screen this one belongs to, and it replaces the entry so
 *     the deep link does not end up with the parent stacked on top of it.
 *
 * It never guesses, and it never leaves the app on a press the reader made.
 */
export function back(fallback = HOME) {
  const now = currentPath()
  remember(now)
  if (!hasWindow()) { navigate(fallback, { replace: true }); return }
  if (canGoBack()) { window.history.back(); return }
  navigate(fallback, { replace: true })
}

/* For real links. A row that navigates should be an <a> when it can be: the
   browser then gives it middle-click, long-press-to-copy and "open in new tab"
   for free, and a keyboard reaches it without any help from us. */
export function href(path) {
  return `#${normalisePath(path)}`
}

/* The current address as React state. */
export function useRoute() {
  const [path, setPath] = useState(currentPath)
  useEffect(() => subscribe(setPath), [])
  const go = useCallback((next, opts) => navigate(next, opts), [])
  return { path, go }
}
