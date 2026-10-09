/* DayPay 2.0 — the design system specimen, as its own entry point.
 *
 * Same reasoning as the kiosk's entry: this page is not part of the
 * application, so it must not be a route inside it. It is built into the
 * PREVIEW directory only and is never part of `npm run build`.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../ui/ui.css'
import './specimen.css'
import Specimen from './Specimen.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Specimen />
  </StrictMode>,
)
