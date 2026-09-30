/* DayPay — Know what your work is worth.
   Copyright © 2026 Akaninyene. All rights reserved.
   Unauthorized copying, modification, or distribution is prohibited. */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './AppErrorBoundary.jsx'
import './ux-motion.js' // DayPay visual-only motion layer (no logic/data changes)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Outermost net. PaneErrorBoundary protects one employer pane; this
        protects the whole app, because <App /> used to render bare — a throw
        anywhere in the employee's Month, Year or payslip took the entire tree
        down and left a white screen with nothing to report. React can only
        catch a render error ABOVE the component that threw, so this cannot be
        done any lower down. */}
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)

// DayPay PWA - register service worker for offline + installable (production only;
// disabled in dev so HMR + fresh assets are never shadowed by the SW cache)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('DayPay PWA: SW registered', reg.scope)
    }).catch(err => {
      console.log('DayPay PWA: SW registration failed', err)
    })
  })
}
