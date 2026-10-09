/* DayPay 2.0 — the components behind src/ui/ui.css.
 *
 * Deliberately small and deliberately dumb: no data fetching, no formatting,
 * no business rules. They lay out what they are handed, so that a screen's
 * only job is to decide WHAT to show, and the design system decides how it
 * looks. The moment one of these starts computing money, the interface has
 * another place for a figure to be wrong.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { back, href } from '../lib/router.js'
import { titleFor } from '../lib/routes.js'

/* ── Section ──────────────────────────────────────────────────────────────── */

export function Section({ label, action, children }) {
  return (
    <>
      {(label || action) && (
        <div className="dp-sec">
          <span className="dp-sec-label">{label}</span>
          {action}
        </div>
      )}
      {children}
    </>
  )
}

/* ── List and row ─────────────────────────────────────────────────────────────
   A row with an `onClick` is a button, because that is what it is: it is
   focusable, it answers Enter and Space, and a screen reader announces it as
   something you can press. A row without one is a plain div — never a div with
   a click handler, which is the usual way a tap target disappears for somebody
   using a keyboard. */

export function List({ children, className = '' }) {
  return <div className={`dp-list ${className}`.trim()}>{children}</div>
}

/* A row can do three things: go somewhere, do something, or just sit there and
   be read. The first is an <a>, the second is a <button>, the third is a div —
   because each of those is what the row actually is, and pretending otherwise
   costs a reader something. Colour alone never carries the difference: the row
   looks the same, the keyboard and the screen reader get the truth. */
export function Item({ icon, title, sub, trail, href, onClick, children }) {
  const body = (
    <>
      {icon && <span className="dp-item-icon" aria-hidden="true">{icon}</span>}
      <span className="dp-item-text">
        <span className="dp-item-title">{title}</span>
        {sub && <span className="dp-item-sub">{sub}</span>}
      </span>
      {(trail || children) && <span className="dp-item-trail">{trail || children}</span>}
    </>
  )

  if (href) {
    return <a className="dp-item" href={href} onClick={onClick}>{body}</a>
  }
  if (onClick) {
    return <button type="button" className="dp-item" onClick={onClick}>{body}</button>
  }
  return <div className="dp-item">{body}</div>
}

/* ── Progress ─────────────────────────────────────────────────────────────────
   The bar is decorative — `aria-hidden` — because the figures beside it already
   say the same thing in words. Announcing both would read the count twice. */
export function Progress({ value, max, label, caption, children }) {
  const total = Number(max) || 0
  const done = Math.max(0, Math.min(Number(value) || 0, total))
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="dp-progress">
      <div className="dp-progress-figures">
        <span className="dp-progress-value">{children ?? `${done} / ${total}`}</span>
        {caption && <span className="dp-progress-caption">{caption}</span>}
      </div>
      <div
        className="dp-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className="dp-progress-bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/* ── Skeleton ─────────────────────────────────────────────────────────────────
   Hidden from assistive technology on purpose: a shimmer is not information.
   The screen it stands in for should carry the live region that says what is
   loading. */
export function Skeleton({ variant = 'line', count = 1 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`dp-skel ${variant === 'block' ? 'dp-skel-block' : `dp-skel-line${variant === 'title' ? ' is-title' : variant === 'sub' ? ' is-sub' : ''}`}`} />
      ))}
    </div>
  )
}

/* ── Loading ──────────────────────────────────────────────────────────────────
   One shape for "this screen has not arrived yet", used by every screen that waits
   for the database.

   It is three things together because separately they are three ways to get it
   wrong: a shape standing in for the content (so the screen does not jump when the
   data lands), a sentence a screen reader can announce — a shimmer is not
   information, and Skeleton is `aria-hidden` on purpose — and `aria-busy` on the
   block, so the thing that is filling says that it is.

   Before this, three screens wrote that out by hand and six showed a centred line
   of grey text in an otherwise empty pane, which reads as a screen that has
   finished and found nothing. `shape` is what the screen will look like when it
   lands:

     · 'page'  a title, a block of figures, and some rows — the usual screen;
     · 'rows'  a list, with nothing above it;
     · 'panel' one block, inside a screen that is already on screen. */
export function Loading({ label, shape = 'page', lines = 3 }) {
  return (
    <div className="dp-loading" aria-busy="true">
      <p className="dp-sr">{label}</p>
      {shape === 'rows'
        ? <Skeleton variant="line" count={lines} />
        : shape === 'panel'
          ? <Skeleton variant="block" />
          : (
            <>
              <Skeleton variant="title" />
              <Skeleton variant="block" />
              <Skeleton variant="line" count={lines} />
            </>
          )}
    </div>
  )
}

/* ── Chip ─────────────────────────────────────────────────────────────────────
   `tone` is a meaning, not a colour: ok · warn · danger · quiet · neutral. */

export function Chip({ tone = 'neutral', children }) {
  const cls = tone === 'neutral' ? 'dp-chip' : `dp-chip is-${tone}`
  return <span className={cls}>{children}</span>
}

/* ── TechDetail ───────────────────────────────────────────────────────────────
   The ONE place a file path is allowed to be seen by an employer, and it is shut
   until they open it.

   §39 found the product naming its own plumbing on four screens — "Run
   supabase/migrations/013_invoices.sql in the SQL editor", "Ask for migration
   016" — to a business owner who is not the person who runs the database. The
   information is real and somebody needs it: it is the difference between "this
   is broken" and "this is not switched on yet". So it moved behind a summary,
   which is one tap on a phone, rather than out of the product.

   The header is a control, so it stands at the tap floor in both axes. */

export function TechDetail({ label = 'Technical detail', children }) {
  return (
    <details className="dp-tech">
      <summary>{label}</summary>
      <div className="dp-tech-body">{children}</div>
    </details>
  )
}

/* ── Notice ───────────────────────────────────────────────────────────────── */

export function Notice({ tone, title, body, action }) {
  const cls = tone ? `dp-notice is-${tone}` : 'dp-notice'
  return (
    <div className={cls}>
      {title && <div className="dp-notice-title">{title}</div>}
      {body && <p className="dp-notice-body">{body}</p>}
      {action}
    </div>
  )
}

/* ── Back ─────────────────────────────────────────────────────────────────────
 * The one way back out of a screen, used by every screen that is a step deeper
 * than the one that opened it.
 *
 * §41 found this control failing its only job. It was the words "More" or "All
 * workers" with a glyph typed in front of them, set at 12px in the quietest grey
 * the palette has, with no border and no background — so it read as a caption or
 * a stray link, and on a phone it did not look like something you press. A reader
 * one level deep had to know what the screen before them was called to know that
 * this was the way back to it.
 *
 * What it is now: a chevron in a bordered box, standing at the tap floor, saying
 * the one word that cannot be misread. The destination is still there, where it
 * belongs — in the accessible name, so somebody using a screen reader hears
 * "Back to More" rather than "Back".
 *
 * It calls `back()`, not a hard navigation, because those are different promises.
 * `back()` goes to the screen the reader actually came from when there is one;
 * the destination is what it falls back to for a deep link, a notification or a
 * fresh launch, where "the previous screen" does not exist inside the app and the
 * only truthful answer is the screen this one belongs to.
 *
 * Two shapes, and the difference is real: a step with an address of its own is an
 * <a> — copyable, middle-clickable, openable in a new tab — while a level a screen
 * keeps in its own state is a <button>, because there is no address to link to.
 */
export function BackLink({ to, onBack, label = 'Back', className = '' }) {
  const cls = `dp-back ${className}`.trim()
  const name = to ? `Back to ${titleFor(to)}` : 'Back'
  const chevron = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
  const body = <>{chevron}<span className="dp-back-label">{label}</span></>

  return (
    <div className="dp-back-wrap">
      {onBack ? (
        <button type="button" className={cls} onClick={onBack} aria-label={name} title={name}>
          {body}
        </button>
      ) : (
        <a
          className={cls}
          href={href(to)}
          aria-label={name}
          title={name}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
            e.preventDefault()
            back(to)
          }}
        >
          {body}
        </a>
      )}
    </div>
  )
}
