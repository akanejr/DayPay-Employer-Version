/* DayPay — invoice PDF (jsPDF layer).

   The same arrangement as the payslip: a pure model (invoice.js) decides what
   the document says, and this file only draws it. The numbers printed here are
   the frozen ones read back from the database; nothing is recalculated, so an
   invoice can never disagree with the page it was issued from.

   Inter is embedded for the same reason as the payslip: jsPDF's built-in
   helvetica has no ₦ (U+20A6), so amounts would come out malformed. Reused
   from payslipFonts.js rather than re-subsetted.

   Copyright © 2026 Akaninyene. All rights reserved.
*/

import jsPDF from 'jspdf'
import { registerPayslipFonts } from './payslipFonts.js'
import { fmtStamp } from './payslip.js'
import { invoiceModel, invoiceFilename } from './invoice.js'

const NAVY = [11, 27, 50]
const GREEN = [21, 128, 61]
const INK = [51, 65, 85]
const GRAY = [100, 116, 139]
const FILL = [241, 245, 249]
const HAIR = [226, 232, 240]
const DANGER = [153, 27, 27]
const DANGER_FILL = [254, 226, 226]

export function buildInvoiceDoc(invoice, lines) {
  const M = invoiceModel(invoice, lines)
  const doc = new jsPDF()
  registerPayslipFonts(doc)
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const RIGHT = 196

  const F = (style, size) => { doc.setFont('DayPayInter', style); doc.setFontSize(size) }
  const C = (c) => doc.setTextColor(c[0], c[1], c[2])
  const label = (t, x, y) => { F('bold', 9); C(GRAY); doc.text(t.toUpperCase(), x, y) }

  const header = (withPill) => {
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, pageW, 30, 'F')
    doc.setFillColor(22, 163, 74)
    doc.roundedRect(18, 10.5, 16, 16, 4, 4, 'F')
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(14, 6.5, 16, 16, 4, 4, 'F')
    F('bold', 17); C([255, 255, 255]); doc.text('DayPay', 37, 18.5)
    F('normal', 9); C([203, 213, 225]); doc.text('Know what your work is worth.', 62, 18.5)
    F('bold', 9.5); C([255, 255, 255]); doc.text(M.title, RIGHT, 13.5, { align: 'right' })
    if (withPill) {
      const pill = M.isVoid ? 'VOID' : 'ISSUED'
      F('bold', 8)
      const pillW = doc.getTextWidth(pill) + 9
      doc.setFillColor(...(M.isVoid ? DANGER : GREEN))
      doc.roundedRect(RIGHT - pillW, 17, pillW, 7, 3.5, 3.5, 'F')
      C([255, 255, 255]); doc.text(pill, RIGHT - 4.5, 21.9, { align: 'right' })
    }
  }

  header(true)

  // ── Who it is for, and for when ──
  F('bold', 14); C(NAVY); doc.text(M.contractor || 'Contractor', 14, 42)
  F('normal', 9.5); C(GRAY); doc.text(`Period: ${M.periodText}`, 14, 47.5)
  F('bold', 7.5); C(GRAY); doc.text('BILLED TO', RIGHT - 40, 42)
  F('bold', 10); C(NAVY); doc.text(M.number || '—', RIGHT, 42, { align: 'right' })
  F('normal', 8.5); C(GRAY)
  if (M.issuedText) doc.text(`Issued ${M.issuedText}`, RIGHT, 47.5, { align: 'right' })

  // ── Total ──
  let y = 60
  label('Total for this period', 14, y); y += 10
  F('bold', 26); C(M.isVoid ? GRAY : GREEN); doc.text(M.totalText, 14, y); y += 6.5
  F('normal', 9.5); C(GRAY)
  doc.text(M.isVoid ? 'Voided — not payable' : 'All recorded days included', 14, y)
  y += 6

  const infoBox = (x, lab, val) => {
    doc.setFillColor(...FILL); doc.roundedRect(x, y, 89, 17, 2.5, 2.5, 'F')
    F('bold', 7.5); C(GRAY); doc.text(lab, x + 5, y + 6)
    F('bold', 16); C(NAVY); doc.text(val, x + 5, y + 13.5)
  }
  infoBox(14, 'WORKERS', String(M.figures[0].value))
  infoBox(107, 'DAYS RECORDED', String(M.figures[1].value))
  y += 22
  F('bold', 7.5); C(GRAY); doc.text('PAID-DAY EQUIVALENTS', 14, y)
  F('bold', 11); C(NAVY); doc.text(String(M.figures[2].value), 14, y + 5.5)
  y += 14

  if (M.isVoid) {
    const wrap = doc.splitTextToSize(
      `This invoice was voided${M.voidedText ? ` on ${M.voidedText}` : ''}${M.voidReason ? `: ${M.voidReason}` : '.'} It is kept for the record and must not be paid.`,
      178,
    )
    const h = wrap.length * 4.6 + 8
    doc.setFillColor(...DANGER_FILL); doc.roundedRect(14, y, 182, h, 2.5, 2.5, 'F')
    F('normal', 9); C(DANGER); doc.text(wrap, 19, y + 7)
    y += h + 8
  }

  // ── The lines ──
  label('Workers on this invoice', 14, y); y += 4
  y += 3
  F('bold', 8); C(GRAY)
  doc.text('WORKER', 14, y)
  doc.text('DAYS', 126, y, { align: 'center' })
  doc.text('EQUIV.', 150, y, { align: 'center' })
  doc.text('AMOUNT', RIGHT, y, { align: 'right' })
  y += 2.5
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.3); doc.line(14, y, RIGHT, y); y += 5.5

  M.rows.forEach((r, i) => {
    if (y > pageH - 40) { doc.addPage(); header(false); y = 40 }
    if (i % 2 === 1) { doc.setFillColor(...FILL); doc.rect(14, y - 4.4, 182, 8, 'F') }
    F('normal', 9.5); C(INK); doc.text(r.name, 14, y)
    if (r.job) { F('normal', 7.5); C(GRAY); doc.text(r.job, 14, y + 3.2) }
    F('normal', 9.5); C(INK); doc.text(String(r.days), 126, y, { align: 'center' })
    F('bold', 9.5); C(NAVY); doc.text(r.equivalentsText, 150, y, { align: 'center' })
    F('normal', 9.5); C(INK); doc.text(r.amountText, RIGHT, y, { align: 'right' })
    y += r.job ? 9.4 : 7
  })

  doc.setDrawColor(...NAVY); doc.setLineWidth(0.5); doc.line(14, y - 2.5, RIGHT, y - 2.5)
  F('bold', 10); C(NAVY); doc.text('TOTAL', 14, y + 2.5)
  F('bold', 10.5); C(M.isVoid ? GRAY : GREEN)
  doc.text(M.totalText, RIGHT, y + 2.5, { align: 'right' })
  y += 12

  if (M.statusNote) {
    F('normal', 8.5); C(GRAY)
    const wrap = doc.splitTextToSize(M.statusNote, 182)
    doc.text(wrap, 14, y); y += wrap.length * 4.4 + 3
  }

  if (M.note) {
    label('Note', 14, y); y += 5
    F('normal', 9); C(INK)
    const wrap = doc.splitTextToSize(M.note, 182)
    doc.text(wrap, 14, y); y += wrap.length * 4.6 + 4
  }

  // ── Footer, on the last page ──
  const footY = pageH - 16
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.3); doc.line(14, footY - 6, RIGHT, footY - 6)
  F('normal', 7.5); C(GRAY)
  doc.text(M.provenance, 14, footY - 1)
  doc.text(`Generated ${fmtStamp(new Date())}`, RIGHT, footY - 1, { align: 'right' })

  return doc
}

/* Generate and hand the file to the browser. Synchronous by design: it is
   called inside the click, and a browser is free to drop a download that
   arrives outside the user's gesture. */
export function downloadInvoice(invoice, lines) {
  const doc = buildInvoiceDoc(invoice, lines)
  doc.save(invoiceFilename(invoice))
}
