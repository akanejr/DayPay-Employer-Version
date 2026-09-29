/* DayPay — the invoice as a document model (pure: no jsPDF, no React, no
   storage). Turns a stored invoice and its lines into what the document says.

   THE RULE THIS FILE EXISTS TO KEEP

   Every figure below is a number ALREADY STORED on the invoice row or its
   lines. Nothing here multiplies by a rate, infers a multiplier, or looks at a
   day. If this file ever needed a rate to answer a question, the invoice would
   have quietly become a second calculation engine — the exact thing the brief
   forbids, because a second engine eventually disagrees with the ledger and
   nobody can then tell which figure is right.

   It follows the payslip's formatting conventions deliberately: deterministic
   ₦ grouping from fmtMoney, plain equivalents from fmtEquiv, fixed month
   tables for dates, so a document printed on one phone reads the same as on
   another. `fmtMoney` is imported rather than re-written — one money formatter
   in the whole product.

   Copyright © 2026 Akaninyene. All rights reserved.
*/

import { fmtMoney, fmtEquiv, fmtStamp } from './payslip.js'
import { periodLabel } from './employerLogic.js'

/* A document number is stored, never derived here. If it is missing the
   document says so rather than inventing one. */
export function invoiceTitle(invoice) {
  return invoice && invoice.number ? `Invoice ${invoice.number}` : 'Invoice'
}

export function invoicePeriodText(invoice) {
  if (!invoice) return ''
  return periodLabel(invoice.period_from, invoice.period_to)
}

/* A filename that is safe on every platform and still identifies the document
   when it is sitting in a downloads folder next to five others. */
export function invoiceFilename(invoice) {
  const slug = String(invoice?.contractor_name || 'contractor')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'contractor'
  const number = String(invoice?.number || 'invoice').replace(/[^A-Za-z0-9-]+/g, '-')
  const period = `${invoice?.period_from || ''}_${invoice?.period_to || ''}`
  return `DayPay-${number}-${slug}-${period}.pdf`
}

/* "22 days · 25 equivalents" — the two facts a contractor checks the bill
   against, in one line. */
export function invoiceLineCaption(line) {
  if (!line) return ''
  const d = Number(line.days) || 0
  const e = fmtEquiv(line.equivalents)
  if (d === 0) return 'No days'
  return `${d} ${d === 1 ? 'day' : 'days'} · ${e} ${Number(line.equivalents) === 1 ? 'equivalent' : 'equivalents'}`
}

/* What the bill's status mix means in words. A disputed day is INCLUDED in the
   total — the same rule the Summary screen states — and saying so on the
   document is what stops it being read as an oversight. */
export function invoiceStatusNote(invoice) {
  if (!invoice) return ''
  const parts = []
  if (Number(invoice.claimed_days) > 0) parts.push(`${invoice.claimed_days} awaiting confirmation`)
  if (Number(invoice.disputed_days) > 0) parts.push(`${invoice.disputed_days} disputed`)
  if (Number(invoice.confirmed_days) > 0) parts.push(`${invoice.confirmed_days} confirmed`)
  if (!parts.length) return ''
  return `${parts.join(' · ')}. All recorded days are included in the total.`
}

export function invoiceModel(invoice, lines = []) {
  const rows = (lines || []).filter(Boolean).map(l => ({
    id: l.id,
    name: l.employee_name || 'Unnamed worker',
    job: l.job_title || '',
    days: Number(l.days) || 0,
    worked: Number(l.worked) || 0,
    leave: Number(l.leave_days) || 0,
    equivalents: Number(l.equivalents) || 0,
    equivalentsText: fmtEquiv(l.equivalents),
    amount: Number(l.amount) || 0,
    amountText: fmtMoney(l.amount),
    caption: invoiceLineCaption(l),
    disputed: Number(l.disputed_days) || 0,
    claimed: Number(l.claimed_days) || 0,
  }))

  const isVoid = invoice?.status === 'void'

  const figures = [
    { label: 'Workers', value: String(invoice?.worker_count ?? rows.length) },
    { label: 'Days recorded', value: String(invoice?.actual_days ?? rows.reduce((a, r) => a + r.days, 0)) },
    { label: 'Paid-day equivalents', value: fmtEquiv(invoice?.equivalents ?? rows.reduce((a, r) => a + r.equivalents, 0)) },
  ]

  return {
    isVoid,
    statusLabel: isVoid ? 'Voided' : 'Issued',
    title: invoiceTitle(invoice),
    number: invoice?.number || '',
    contractor: invoice?.contractor_name || '',
    periodText: invoicePeriodText(invoice),
    from: invoice?.period_from || '',
    to: invoice?.period_to || '',
    issuedText: invoice?.issued_at ? fmtStamp(new Date(invoice.issued_at)) : '',
    voidedText: isVoid && invoice?.voided_at ? fmtStamp(new Date(invoice.voided_at)) : '',
    note: invoice?.note || '',
    voidReason: invoice?.void_reason || '',
    figures,
    total: Number(invoice?.total) || 0,
    totalText: fmtMoney(invoice?.total),
    statusNote: invoiceStatusNote(invoice),
    rows,
    rowCount: rows.length,
    /* Said on the document itself, because a printed invoice that has drifted
       from the ledger is worse than no invoice. */
    provenance: 'Figures are the recorded days for this period, not a re-estimate.',
  }
}
