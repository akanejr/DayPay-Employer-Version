/* DayPay Employer Version — stop a crash from blanking the screen.
 *
 * WHY THIS EXISTS
 *
 * The roster pane went blank in the employer's hands. The cause was a single
 * undeclared identifier — a reference to a variable that lived in a parent
 * component — which threw a ReferenceError while React was rendering. With no
 * error boundary anywhere in the app, React tore down the entire tree, and all
 * the employer saw was white.
 *
 * The bug is fixed. This exists because the FAILURE MODE was the real problem:
 * a blank screen tells the user nothing. Not whether the database is down,
 * not whether they are signed in, not whether the app is broken. They cannot
 * tell me what happened either, because there is nothing on screen to report.
 *
 * With this in place, a crash in one pane shows the actual message and a way
 * back, and every other pane keeps working.
 *
 * A class component because that is the only thing React offers for this — a
 * function component cannot catch a render error below it.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { Component } from 'react'

export default class PaneErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    /* Also into the console, because this is the one place with the component
       stack, and the stack is what makes it fixable. */
    console.error('[DayPay] a pane crashed while rendering:', error, info)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const message = error?.message || String(error)

    return (
      <div className="ew-card ew-crash" role="alert">
        <div className="ew-crash-title">
          {this.props.title || 'This section could not be shown'}
        </div>

        <p className="ew-crash-body">
          Nothing you have recorded was affected — this is a display problem in
          this one section, and the rest of the app still works.
        </p>

        <pre className="ew-crash-detail">{message}</pre>

        <div className="ew-actions" style={{ justifyContent: 'flex-start', marginTop: 11 }}>
          <button type="button" className="ew-btn ew-btn-primary ew-btn-sm" onClick={this.reset}>
            Try again
          </button>
          <button
            type="button" className="ew-btn ew-btn-ghost ew-btn-sm"
            onClick={() => window.location.reload()}
          >
            Reload the app
          </button>
        </div>

        {/* The message is often cryptic. What actually unblocks a fix is the
            browser console, so point at it rather than pretending otherwise. */}
        <p className="ew-crash-hint">
          If it keeps happening, the browser console has the full detail.
        </p>
      </div>
    )
  }
}
