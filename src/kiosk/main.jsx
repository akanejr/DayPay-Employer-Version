/* DayPay Site Attendance — its own entry point.
 *
 * This file is the separation §20 asks for, made structural rather than
 * promised: the kiosk bundle starts here and imports the kiosk, and nothing
 * that reaches back into the employer application. Whatever is not imported
 * cannot be reached from a browser console on a machine standing in a yard.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './kiosk.css'
import Kiosk from './Kiosk.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Kiosk />
  </StrictMode>,
)
