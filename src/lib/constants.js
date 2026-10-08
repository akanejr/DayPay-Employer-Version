/* DayPay — the small fixed lists the shell and the tracker share
 *
 * Both of these used to sit in the middle of src/App.jsx, between a formatter
 * and a hook, where nothing could find them. They are not settings — they are the
 * option lists the product ships with.
 *
 * Moved out of src/App.jsx verbatim during DayPay 2.0 Phase 2b. Nothing
 * about how it behaves changed; it only stopped living in the file that owns
 * the whole application.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

// v18 appearance modes — shown in the hamburger "Choose theme" picker and Settings
export const THEME_OPTIONS = [
  { id: 'light', label: 'Light', sw: 'sw-light' },
  { id: 'dark', label: 'Dark', sw: 'sw-dark' },
  { id: 'glass-dark', label: 'Glass · Dark', sw: 'sw-glass-dark' },
  { id: 'glass-light', label: 'Glass · Light', sw: 'sw-glass-light' },
]

// Leave & absence types. Paid leave accrues the regular daily rate (salaried
// pay doesn't drop); unpaid leave accrues nothing. Stored on the attendance
// record so locking, sync, projection and export all follow automatically.
// Default leave types — user-managed in Settings (add / rename / delete / set pay).
// payMode 'percent' = share of the daily rate · 'flat' = fixed ₦ per day.
// Existing logged entries always keep their original amounts (future-only changes).
export const DEFAULT_LEAVE_TYPES = [
  { id: 'annual', name: 'Annual leave', payMode: 'percent', payValue: 100 },
  { id: 'sick', name: 'Sick leave', payMode: 'percent', payValue: 100 },
  { id: 'permission', name: 'Permission', payMode: 'percent', payValue: 100 },
  { id: 'unpaid', name: 'Unpaid leave', payMode: 'percent', payValue: 0 },
]
