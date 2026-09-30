/* Stands in for src/lib/invoicePdf.js.
 *
 * The real module draws with jsPDF, which has no business running in node. What
 * the check needs to know is WHAT the document was asked to print — the frozen
 * rows read back from the database, not a fresh calculation — so the call is
 * recorded with the figures it was handed. */

globalThis.__calls = globalThis.__calls || []

export function downloadInvoice(invoice, lines) {
  globalThis.__calls.push(['downloadInvoice', invoice?.number, (lines || []).map(l => [l.employee_name, l.days, l.amount])])
}

export function buildInvoiceDoc() {
  throw new Error('the real PDF renderer must not run inside the check')
}
