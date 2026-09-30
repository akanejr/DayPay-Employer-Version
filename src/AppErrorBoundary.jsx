/* DayPay — the app-level safety net.
 *
 * WHY THIS EXISTS
 *
 * PaneErrorBoundary already stops a crash in one employer pane from blanking
 * the screen. It was never used at the top. <App /> was rendered bare, so a
 * throw anywhere in the employee's app — Month, Year, the payslip, the
 * calendar — took the whole tree down and left white space. That is the exact
 * failure the employer's boundary was written to end, still live on the other
 * half of the product: a person cannot tell a crash from a database problem,
 * and has nothing to report.
 *
 * WHY IT IS NOT JUST PaneErrorBoundary
 *
 * Two reasons, both about honesty.
 *
 *   1. The pane version says "this is a display problem in this one section,
 *      and the rest of the app still works". At app level that is false — there
 *      is no rest of the app. A fallback that misdescribes what happened is
 *      worse than no fallback, because it sends someone looking in the wrong
 *      place.
 *
 *   2. employer.css is imported by EmployerWorkspace. An employee who never
 *      opens the employer workspace never loads it, so the pane boundary's
 *      ew-* classes would render unstyled exactly when they are needed. This
 *      one uses dp-* classes that live in index.css, which main.jsx imports
 *      before anything else and therefore always has.
 *
 * A class component because React offers no hook for this — a function
 * component cannot catch a render error below it.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    /* The console is the only place with the component stack, and the stack is
       what makes this fixable. */
    console.error('[DayPay] the app crashed while rendering:', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const message = error?.message || String(error)

    return (
      <div className="dp-crash" role="alert">
        <div className="dp-crash-card">
          <div className="dp-crash-mark" aria-hidden="true">!</div>

          <h1 className="dp-crash-title">DayPay could not finish drawing this screen</h1>

          <p className="dp-crash-body">
            This is a display problem, not a loss of data. Nothing you have
            recorded has been changed or removed.
          </p>

          <pre className="dp-crash-detail">{message}</pre>

          <div className="dp-crash-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload DayPay
            </button>
            <button type="button" className="btn-secondary" onClick={this.reset}>
              Try again
            </button>
          </div>

          <p className="dp-crash-hint">
            If it happens again, the browser console has the full detail — that
            is the part worth sending on.
          </p>
        </div>
      </div>
    )
  }
}
