/* useExit — keeps a closing panel mounted long enough to animate out.
 *
 * Returns { mounted, closing }. Re-opening during the exit cancels it.
 * Moved out of src/App.jsx verbatim in Phase 2b; it is a hook, so it needs the
 * React import it used to inherit from the file around it.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useState, useEffect } from 'react'

/* useExit — v22 exit animations: keeps a closing panel mounted for `ms`
   so it can animate back out the way it came. Returns { mounted, closing }.
   Re-opening during the exit cancels it (the panel just flips back to dd-in). */
export function useExit(open, ms = 300) {
  const [state, setState] = useState({ mounted: open, closing: false })
  useEffect(() => {
    if (open) {
      if (!state.mounted || state.closing) setState({ mounted: true, closing: false })
      return
    }
    if (state.mounted && !state.closing) {
      setState({ mounted: true, closing: true })
      const t = setTimeout(() => setState({ mounted: false, closing: false }), ms)
      return () => clearTimeout(t)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps — only reacts to `open` flips
  return state
}
