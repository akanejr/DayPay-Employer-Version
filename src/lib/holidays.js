/* DayPay — Nigerian public holidays — the offline fallback
 *
 * The app tries Nager.Date first and falls back to this list, so a screen that
 * shows a holiday has a holiday to show even with no network. The dates are data:
 * do not "correct" them without checking the gazette.
 *
 * Moved out of src/App.jsx verbatim during DayPay 2.0 Phase 2b. Nothing
 * about how it behaves changed; it only stopped living in the file that owns
 * the whole application.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

export function getNigerianHolidaysFallback(year) {
  const fixed = [
    { month: 0, day: 1, name: "New Year's Day" },
    { month: 4, day: 1, name: "Workers' Day" },
    { month: 5, day: 12, name: "Democracy Day" },
    { month: 9, day: 1, name: "Independence Day" },
    { month: 11, day: 25, name: "Christmas Day" },
    { month: 11, day: 26, name: "Boxing Day" },
  ]
  const movable = {
    2024: [
      { month: 2, day: 29, name: "Good Friday" },
      { month: 3, day: 1, name: "Easter Monday" },
      { month: 3, day: 10, name: "Eid al-Fitr" },
      { month: 5, day: 16, name: "Eid al-Adha" },
    ],
    2025: [
      { month: 3, day: 18, name: "Good Friday" },
      { month: 3, day: 21, name: "Easter Monday" },
      { month: 2, day: 30, name: "Eid al-Fitr" },
      { month: 5, day: 6, name: "Eid al-Adha" },
    ],
    2026: [
      { month: 3, day: 3, name: "Good Friday" },
      { month: 3, day: 6, name: "Easter Monday" },
      { month: 2, day: 20, name: "Eid al-Fitr" },
      { month: 4, day: 27, name: "Eid al-Adha" },
    ],
    2027: [
      { month: 2, day: 26, name: "Good Friday" },
      { month: 2, day: 29, name: "Easter Monday" },
      { month: 2, day: 9, name: "Eid al-Fitr" },
      { month: 4, day: 16, name: "Eid al-Adha" },
    ]
  }
  return [...fixed, ...(movable[year] || [])]
}

export function isHolidayDayFallback(dateObj) {
  if (!dateObj) return null
  const holidays = getNigerianHolidaysFallback(dateObj.getFullYear())
  const found = holidays.find(h => h.month === dateObj.getMonth() && h.day === dateObj.getDate())
  return found || null
}
