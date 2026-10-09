/* DayPay — the two display components the shell keeps to itself.
 *
 * AnimatedAmount counts an earnings figure up on change; NeutralAvatar is the
 * person placeholder Settings uses (no photographs, by design). Both used to be
 * declared inside src/App.jsx. Moved verbatim in Phase 2b.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useRef, useEffect } from 'react'
import { formatNaira } from '../lib/format.js'

// Nigerian Public Holidays - Fixed + some movable for 2024-2027 (fallback if API fails)
/* AnimatedAmount — premium count-up for earnings figures (visual only).
   Renders the same formatted value the app already computes; on change,
   counts smoothly to the new value (550ms, ease-out). Reduced motion =
   instant swap. Parent carries .dp-count so ux-motion skips its bump. */
export function AnimatedAmount({ value }) {
  const ref = useRef(null)
  const prevRef = useRef(value)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const from = prevRef.current
    const to = value
    prevRef.current = value
    if (from === to) { el.textContent = formatNaira(to); return }
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { el.textContent = formatNaira(to); return }
    const DUR = 550
    const t0 = performance.now()
    let raf = 0
    const step = (t) => {
      const p = Math.min(1, (t - t0) / DUR)
      const e = 1 - Math.pow(1 - p, 3)
      el.textContent = formatNaira(Math.round(from + (to - from) * e))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className="dp-amount" ref={ref}>{formatNaira(value)}</span>
}

/* v23.1 — neutral person avatar for Settings (no photos by design). */
export function NeutralAvatar({ size = 46 }) {
  return (
    <span className="sp-neutral-avatar" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.52)} height={Math.round(size * 0.52)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="8.2" r="3.6" />
        <path d="M4.8 19.6c1.4-3.2 4-4.8 7.2-4.8s5.8 1.6 7.2 4.8" />
      </svg>
    </span>
  )
}
