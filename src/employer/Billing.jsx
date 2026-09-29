/* DayPay Employer Version — Billing.

 * The employer's month-end question, in two halves:
 *
 *   "What can I bill for?"      the period summary, one row per contractor
 *   "What have I billed?"       the documents already issued, voidable
 *
 * Two rules this screen is built around:
 *
 *   1. It does not work anything out. The summary rows come from `summarise`
 *      (the same function the Summary pane uses) and every figure on a document
 *      comes back from the database, which aggregated the stored days itself.
 *      Issuing sends three identifiers and a note — no amount is ever sent from
 *      here, exactly as no amount is ever sent when recording a day.
 *
 *   2. A document is frozen. Once issued, its numbers do not follow later
 *      corrections: a contractor holding a copy must be able to trust it. The
 *      fix for a wrong invoice is to void it and issue a new one, so that is
 *      what the buttons do — and voiding keeps the wrong one on file.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmployerError, listAllMonth, listInvoices, listInvoiceLines, issueInvoice,
  voidInvoice, invoicesAvailable, billingRows, isBillable, liveInvoiceFor,
  periodLabel, monthLabelFor, monthBounds, formatNaira, invoiceStatusLabel,
} from '../lib/employer'
import { downloadInvoice } from '../lib/invoicePdf'

function figure(n) {
  return Number(n) || 0
}

/* One contractor's row: what the period adds up to, and the single button that
   turns it into a document. */
function BillRow({ row, live, busy, onBill, onOpen }) {
  const billed = !!live
  const flags = []
  if (row.claimed > 0) flags.push(`${row.claimed} unconfirmed`)
  if (row.disputed > 0) flags.push(`${row.disputed} disputed`)

  return (
    <div className="ew-bill-row">
      <div className="ew-bill-head">
        <div className="ew-bill-body">
          <div className="ew-name">{row.name}</div>
          <div className="ew-meta">
            <span>{row.workerCount} {row.workerCount === 1 ? 'worker' : 'workers'}</span>
            <span>· {row.days} {row.days === 1 ? 'day' : 'days'}</span>
            <span>· {row.equivalents} equiv.</span>
          </div>
        </div>
        <div className="ew-bill-amount">{formatNaira(row.total)}</div>
      </div>

      {(flags.length > 0 || billed) && (
        <div className="ew-bill-flags">
          {flags.map(f => <span key={f} className="ew-chip ew-chip-warn">{f}</span>)}
          {billed && <span className="ew-chip ew-chip-live">Billed · {live.number}</span>}
        </div>
      )}

      {billed ? (
        <div className="ew-bill-actions">
          <p className="ew-bill-note">
            This period is already on {live.number}. Void it below to reissue it.
          </p>
          <button type="button" className="ew-btn ew-btn-ghost ew-btn-sm" onClick={() => onOpen(live)}>
            View {live.number}
          </button>
        </div>
      ) : (
        <div className="ew-bill-actions">
          <button
            type="button"
            className="ew-btn ew-btn-primary ew-btn-sm"
            disabled={busy}
            onClick={() => onBill(row)}
          >
            {busy ? 'Billing…' : 'Bill this period'}
          </button>
        </div>
      )}
    </div>
  )
}

/* One issued document. Collapsed it is a line of paper; opened it shows the
   workers it froze, and the two things you can do with it. */
function InvoiceCard({ invoice, lines, open, loading, onToggle, onVoid, onDownload }) {
  const voided = invoice.status === 'void'
  return (
    <div className={`ew-inv${voided ? ' ew-inv-void' : ''}`}>
      <div className="ew-inv-head">
        <div className="ew-inv-body">
          <div className="ew-inv-number">
            {invoice.number}
            <span className={`ew-chip ${voided ? 'ew-chip-warn' : 'ew-chip-live'}`}>
              {invoiceStatusLabel(invoice.status)}
            </span>
          </div>
          <div className="ew-meta">
            <span>{invoice.contractor_name}</span>
            <span>· {periodLabel(invoice.period_from, invoice.period_to)}</span>
            <span>· {invoice.worker_count} {figure(invoice.worker_count) === 1 ? 'worker' : 'workers'}</span>
          </div>
        </div>
        <div className="ew-bill-amount">{formatNaira(invoice.total)}</div>
      </div>

      {voided && (
        <p className="ew-inv-void-note">
          Voided{invoice.void_reason ? `: ${invoice.void_reason}` : '.'} Kept for the record — do not pay it.
        </p>
      )}

      <div className="ew-inv-actions">
        <button
          type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
          aria-expanded={open} onClick={() => onToggle(invoice)}
        >
          {open ? 'Hide workers' : 'Workers'}
        </button>
        <button
          type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
          onClick={() => onDownload(invoice)}
        >
          Download PDF
        </button>
        {!voided && (
          <button type="button" className="ew-btn ew-btn-danger ew-btn-sm" onClick={() => onVoid(invoice)}>
            Void
          </button>
        )}
      </div>

      {open && (
        loading ? (
          <div className="ew-loading">Loading {invoice.number}…</div>
        ) : (
          <div className="ew-inv-table-wrap">
            <table className="ew-inv-table">
              <thead>
                <tr>
                  <th scope="col">Worker</th>
                  <th scope="col">Days</th>
                  <th scope="col">Equiv.</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.id}>
                    <td>
                      {l.employee_name}
                      {l.job_title && <span className="ew-inv-job">{l.job_title}</span>}
                    </td>
                    <td>{l.days}</td>
                    <td>{Number(l.equivalents)}</td>
                    <td className="ew-inv-money">{formatNaira(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{invoice.actual_days}</td>
                  <td>{Number(invoice.equivalents)}</td>
                  <td className="ew-inv-money">{formatNaira(invoice.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  )
}

export default function Billing({ employees, contractors }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [days, setDays] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [openLines, setOpenLines] = useState([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [voidTarget, setVoidTarget] = useState(null)
  const [voidReason, setVoidReason] = useState('')

  const { from, to } = monthBounds(year, month)
  const label = monthLabelFor(year, month)
  const period = periodLabel(from, to)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [dayRows, invoiceRows] = await Promise.all([
        listAllMonth(year, month),
        listInvoices({ from, to }),
      ])
      setDays(dayRows || [])
      setInvoices(invoiceRows || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLoading(false)
    }
  }, [year, month, from, to])

  useEffect(() => { load() }, [load])

  const rows = useMemo(
    () => billingRows(contractors, employees, days, from, to),
    [contractors, employees, days, from, to],
  )

  const billable = rows.filter(isBillable)
  const quiet = rows.filter(r => !isBillable(r) && r.workerCount > 0)

  const liveFor = row => liveInvoiceFor(invoices, row.contractorId, from, to)
  const unbilled = billable.filter(r => !liveFor(r))
  const outstanding = unbilled.reduce((a, r) => a + figure(r.total), 0)
  const billedTotal = invoices
    .filter(i => i.status === 'issued')
    .reduce((a, i) => a + figure(i.total), 0)

  function stepMonth(delta) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
    setNotice(null)
    setError(null)
    setOpenId(null)
    setVoidTarget(null)
  }

  async function openInvoice(invoice) {
    setOpenId(prev => (prev === invoice.id ? null : invoice.id))
    setLinesLoading(true)
    try {
      const rowsFor = await listInvoiceLines(invoice.id)
      setOpenLines(rowsFor || [])
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setLinesLoading(false)
    }
  }

  async function bill(row) {
    setBusyKey(row.key)
    setError(null)
    setNotice(null)
    try {
      const inv = await issueInvoice(row.contractorId, from, to, null)
      await load()
      setNotice(`${inv.number} issued for ${inv.contractor_name} · ${formatNaira(inv.total)}`)
      setOpenId(inv.id)
      setOpenLines(await listInvoiceLines(inv.id))
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusyKey(null)
    }
  }

  async function confirmVoid() {
    const target = voidTarget
    if (!target) return
    setBusyKey(`void:${target.id}`)
    setError(null)
    setNotice(null)
    try {
      await voidInvoice(target.id, voidReason)
      setVoidTarget(null)
      setVoidReason('')
      await load()
      setNotice(`${target.number} voided. That period can be billed again.`)
    } catch (e) {
      setError(e instanceof EmployerError ? e : new EmployerError(String(e)))
    } finally {
      setBusyKey(null)
    }
  }

  async function download(invoice) {
    setError(null)
    try {
      const rowsFor = invoice.id === openId && openLines.length
        ? openLines
        : await listInvoiceLines(invoice.id)
      downloadInvoice(invoice, rowsFor)
    } catch (e) {
      setError(new EmployerError('The invoice could not be prepared.', { hint: String(e.message || e) }))
    }
  }

  return (
    <>
      <div className="ew-monthbar">
        <button type="button" className="ew-datebar-step" aria-label="Previous month" onClick={() => stepMonth(-1)} disabled={!!busyKey}>‹</button>
        <div className="ew-datebar-mid">
          <div className="ew-datebar-day">{label}</div>
        </div>
        <button type="button" className="ew-datebar-step" aria-label="Next month" onClick={() => stepMonth(1)} disabled={!!busyKey}>›</button>
      </div>

      {notice && <div className="ew-msg ew-msg-ok">{notice}</div>}
      {error && (
        <div className="ew-msg ew-msg-error">
          {error.message}
          {error.hint && <span className="ew-msg-hint">{error.hint}</span>}
        </div>
      )}

      {!invoicesAvailable() && (
        <div className="ew-msg ew-msg-warn">
          Invoices need a database update.
          <span className="ew-msg-hint">Run supabase/migrations/013_invoices.sql in the SQL editor.</span>
        </div>
      )}

      {loading ? (
        <div className="ew-loading">Loading {label}…</div>
      ) : (
        <>
          <div className="ew-owe">
            <div className="ew-owe-label">Not yet billed · {period}</div>
            <div className="ew-owe-figure">{formatNaira(outstanding)}</div>
            <div className="ew-owe-sub">
              {unbilled.length === 0
                ? (billable.length === 0
                  ? 'No days recorded for this period yet'
                  : 'Everything recorded for this period has been billed')
                : `${unbilled.length} ${unbilled.length === 1 ? 'contractor' : 'contractors'} to bill`}
              {billedTotal > 0 && ` · ${formatNaira(billedTotal)} already billed`}
            </div>
          </div>

          {unbilled.length > 0 && (
            <>
              <div className="ew-section-label">Ready to bill</div>
              {unbilled.map(row => (
                <BillRow
                  key={row.key}
                  row={row}
                  live={null}
                  busy={busyKey === row.key}
                  onBill={bill}
                  onOpen={openInvoice}
                />
              ))}
            </>
          )}

          {billable.length > 0 && (
            <>
              <div className="ew-section-label">Already billed for this period</div>
              {billable.filter(r => liveFor(r)).map(row => (
                <BillRow
                  key={row.key}
                  row={row}
                  live={liveFor(row)}
                  busy={false}
                  onBill={bill}
                  onOpen={openInvoice}
                />
              ))}
            </>
          )}

          {quiet.length > 0 && (
            <p className="ew-bill-note">
              {quiet.map(r => r.name).join(', ')} — no days recorded in this period.
            </p>
          )}

          <div className="ew-section-label">Invoices for {label}</div>
          {invoices.length === 0 ? (
            <div className="ew-empty">
              <div className="ew-empty-title">Nothing billed yet</div>
              <div className="ew-empty-body">
                Bill a contractor above and the document will appear here, with a PDF you can hand over.
              </div>
            </div>
          ) : (
            invoices.map(inv => (
              <InvoiceCard
                key={inv.id}
                invoice={inv}
                lines={openId === inv.id ? openLines : []}
                open={openId === inv.id}
                loading={linesLoading && openId === inv.id}
                onToggle={openInvoice}
                onVoid={target => { setVoidTarget(target); setVoidReason(''); setError(null) }}
                onDownload={download}
              />
            ))
          )}

          {voidTarget && (
            <div className="ew-card ew-void-form">
              <div className="ew-empty-title">Void {voidTarget.number}?</div>
              <p className="ew-bill-note">
                The invoice stays on file, marked voided, and the period becomes billable again.
                Nothing is deleted.
              </p>
              <label className="ew-void-label" htmlFor="void-reason">Why (optional)</label>
              <input
                id="void-reason"
                className="ew-void-input"
                type="text"
                value={voidReason}
                placeholder="Wrong period, wrong rate, contractor changed…"
                onChange={e => setVoidReason(e.target.value)}
              />
              <div className="ew-void-actions">
                <button
                  type="button" className="ew-btn ew-btn-danger ew-btn-sm"
                  disabled={busyKey === `void:${voidTarget.id}`}
                  onClick={confirmVoid}
                >
                  {busyKey === `void:${voidTarget.id}` ? 'Voiding…' : 'Void this invoice'}
                </button>
                <button
                  type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
                  onClick={() => { setVoidTarget(null); setVoidReason('') }}
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
