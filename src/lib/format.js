/* DayPay — the formatters and the small export helpers
 *
 * Every function here is pure — in, out, no React, no database. That is the
 * property that makes them safe to call from anywhere, and the reason the screens
 * built in phases 4–13 can use them without depending on the shell.
 *
 * formatNaira defers to the payslip's fmtMoney, which is the one money formatter
 * in the product; src/lib/employerLogic.js delegates here too, so an amount can
 * only ever be written one way.
 *
 * Moved out of src/App.jsx verbatim during DayPay 2.0 Phase 2b. Nothing
 * about how it behaves changed; it only stopped living in the file that owns
 * the whole application.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { fmtMoney } from './payslip.js'

/* The week, Monday first, spelled the one way this product spells it.
   Two calendars print these words — the personal tracker's month grid and the
   employer's month picker — and each had its own copy of the list, so "the same
   week" depended on two arrays staying in step. (Phase 16.) */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function formatDateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export function isWeekendDay(dateObj) {
  const day = dateObj.getDay()
  return day === 0 || day === 6
}
/* One way to write money, everywhere.
   This used to be Number(n).toLocaleString('en-NG'), which is a different
   formatter from the one the payslip uses and depends on the device's ICU
   data: on a runtime built without the en-NG locale it falls back to whatever
   the default is, and a browser that groups with a space or a full stop turns
   ₦16,000 into ₦16 000 or ₦16.000 without anything going wrong that a test
   would notice. It also printed decimals, so a part-day could render ₦8,000.5
   on a screen where every other amount was whole naira.
   src/lib/payslip.js already had the correct, locale-independent version and
   documents why. This now defers to it, so the 60 call sites in this file
   inherit the fix and the two cannot drift apart again. */
export function formatNaira(n) {
  return fmtMoney(n)
}
// v18: truthful share/PDF line — "N × ₦per-day" only when every day in the
// group paid the same amount; a mixed-rate group shows "N days" instead.
export function rateLine(n, pay, amt) {
  const left = (amt && n > 0 && n * amt === pay) ? `${n} × ${formatNaira(amt)}` : `${n} day${n === 1 ? '' : 's'}`
  return `${left} = ${formatNaira(pay)}`
}
export function shortDate(key) {
  const d = new Date(`${key}T00:00:00`)
  return isNaN(d) ? key : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// v18-C: Export my data — one tap in Settings downloads the raw record.
// JSON = every record + setting (a full backup); CSV = one row per worked day.
export function fileDateStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function sortedDayRecords(attendance) {
  return Object.values(attendance || {}).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
export function csvCell(v) {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function buildDayPayBackup(attendance, settings, leaveTypes) {
  const records = sortedDayRecords(attendance)
  const total = records.reduce((s, r) => s + (r.amount || 0), 0)
  return JSON.stringify({
    app: 'DayPay',
    format: 'daypay-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    records,
    settings: {
      dailyRate: settings.dailyRate,
      weekendMultiplier: settings.weekendMultiplier,
      holidayMultiplier: settings.holidayMultiplier,
      salaryGoal: settings.salaryGoal,
      paydayDay: settings.paydayDay,
      startMonthKey: settings.startMonthKey ?? null,
      ratePeriods: settings.ratePeriods ?? [],
      leaveTypes,
      reminder: settings.reminder ?? null,
    },
    summary: {
      days: records.length,
      totalEarned: total,
      firstDay: records.length ? records[0].date : null,
      lastDay: records.length ? records[records.length - 1].date : null,
    },
  }, null, 2)
}
export function buildDayPayCsv(attendance) {
  const rows = ['date,day,type,rate,amount']
  for (const r of sortedDayRecords(attendance)) {
    const d = new Date(`${r.date}T00:00:00`)
    const day = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short' })
    const type = r.isOvertime ? 'overtime' : r.isWeekend ? 'weekend' : r.isHoliday ? 'holiday' : r.isLeave ? 'leave' : 'work'
    rows.push([r.date, day, type, r.rate ?? 0, r.amount ?? 0].map(csvCell).join(','))
  }
  return rows.join('\r\n') + '\r\n'
}
export function triggerDownload(name, content, mime) {
  try {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  } catch {}
}

export function getMonthName(monthIndex, short = false) {
  const names = short
    ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    : ['January','February','March','April','May','June','July','August','September','October','November','December']
  return names[monthIndex]
}
export function monthKey(year, month) {
  return `${year}-${String(month+1).padStart(2,'0')}`
}
export function parseMonthKey(key) {
  const [y,m] = key.split('-').map(Number)
  return { year: y, month: m-1 }
}
export function ordDay(n) {
  if (n >= 11 && n <= 13) return `${n}th`
  switch (n % 10) { case 1: return `${n}st`; case 2: return `${n}nd`; case 3: return `${n}rd`; default: return `${n}th` }
}

// v23.1 — compact reminder-day summary for Settings ("Mon–Fri", "Wed · Sat–Sun", …)
export function remDaysShort(days) {
  if (!days || !days.length) return 'no days'
  if (days.length === 7) return 'Every day'
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const order = [1, 2, 3, 4, 5, 6, 0] // Monday-first
  const inSet = d => days.includes(d)
  let out = ''
  let i = 0
  while (i < 7) {
    if (!inSet(order[i])) { i += 1; continue }
    let j = i
    while (j + 1 < 7 && inSet(order[j + 1])) j += 1
    out += (out ? ' · ' : '') + (i === j ? names[order[i]] : `${names[order[i]]}–${names[order[j]]}`)
    i = j + 1
  }
  return out
}

// v23.1 — "18:00" → "6:00 PM" (local time, as stored)
export function time12(t) {
  const [h, m] = String(t || '').split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return t || ''
  const ap = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`
}
