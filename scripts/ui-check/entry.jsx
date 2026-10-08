import './client.jsx'
import './interact.jsx'
import './existing.jsx'
import './nav.jsx'
import './kiosk.jsx'
import './specimen.jsx'
/* Last on purpose: today.jsx freezes the clock, and nothing after it may be
   measured against a frozen 'now'. */
import './today.jsx'
import './attendance.jsx'
import './people.jsx'
import './profile.jsx'
import './more.jsx'
import './polish.jsx'
import './states.jsx'
import './desktop.jsx'
import './consistency.jsx'
import './workplace.jsx'

const total = globalThis.__bad || 0
console.log(total === 0
  ? '\n== DAYPAY UI CHECK: ALL GREEN =='
  : `\n== DAYPAY UI CHECK: ${total} FAILURE(S) ==`)
process.exit(total === 0 ? 0 : 1)
