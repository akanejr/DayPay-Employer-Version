/* DayPay Site Attendance — the machine at the worksite.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * One worker at a time, at the start of a shift, in a hurry, with a queue
 * behind them. Every decision here is made for that person: large targets, one
 * question per screen, a keypad instead of a hardware keyboard, and an answer
 * in under a second that a person can read from a metre away.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE
 *
 * No dashboard, no roster management, no reports, no settings, no pay — not
 * hidden, absent. The kiosk imports three functions from lib/kiosk.js and
 * nothing else from the application, so the employer's screens are not on this
 * machine to be found. §20 asks for separation; a separate entry point is how
 * you get it rather than promise it.
 *
 * A worker without a smartphone, or without a network today, uses this and
 * leaves with exactly the same day_regords row as a colleague who checked in on
 * their phone. The only difference is a column the payroll does not read.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  kioskRoster, kioskCheckIn, claimDevice, signInKiosk, signOutKiosk,
  currentSessionUser, onSessionChange,
} from '../lib/kiosk'
import {
  contractorChoices, peopleForContractor, filterPeople, keypadPress, masked,
  codeSlots, isComplete, kioskOutcome, resultDuration, personLabel,
  KIOSK_FILTER_THRESHOLD, backStep,
} from '../lib/kioskLogic'

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

/* Four digits, drawn as dots that fill. Never the digits themselves — §8 says
   the PIN is entered privately, and the surest way to keep it private is for
   the screen never to hold it in a form that can be read over a shoulder. */
function PinDots({ value }) {
  return (
    <div className="ks-dots" aria-label="PIN entry">
      {masked(value).map((ch, i) => (
        <span key={i} className={`ks-dot${ch === '•' ? ' is-set' : ''}`}>{ch}</span>
      ))}
    </div>
  )
}

/* The site code is shown, not hidden: it is on a wall, the crew knows it, and
   hiding it only makes a typo invisible and unfixable. */
function CodeSlots({ value }) {
  return (
    <div className="ks-slots" aria-label="Site code entry">
      {codeSlots(value).map((ch, i) => (
        <span key={i} className={`ks-slot${ch === '·' ? '' : ' is-set'}`}>{ch}</span>
      ))}
    </div>
  )
}

function Keypad({ onKey, disabled }) {
  return (
    <div className="ks-keypad">
      {KEYPAD.map(k => (
        <button
          key={k}
          type="button"
          className={`ks-key${k === 'back' || k === 'clear' ? ' ks-key-fn' : ''}`}
          disabled={disabled}
          onClick={() => onKey(k)}
          aria-label={k === 'back' ? 'Delete last digit' : k === 'clear' ? 'Clear' : k}
        >
          {k === 'back' ? '⌫' : k === 'clear' ? 'Clear' : k}
        </button>
      ))}
    </div>
  )
}

function Shell({ children, footer }) {
  return (
    <div className="ks">
      <header className="ks-head">
        <span className="ks-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="34" height="34">
            <rect x="15" y="16" width="26" height="26" rx="7" fill="#15803D" />
            <rect x="7" y="8" width="26" height="26" rx="7" fill="#0B1B32" stroke="#FFFFFF" strokeWidth="4" />
          </svg>
        </span>
        <span className="ks-brand">
          <span className="ks-wordmark">DayPay</span>
          <span className="ks-sub">Site Attendance</span>
        </span>
      </header>
      <main className="ks-body">{children}</main>
      {footer && <footer className="ks-foot">{footer}</footer>}
    </div>
  )
}

export default function Kiosk() {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)
  const [phase, setPhase] = useState('signin')      // signin | link | ready
  const [roster, setRoster] = useState(null)
  const [error, setError] = useState(null)

  const [step, setStep] = useState('contractor')
  const [contractorId, setContractorId] = useState(undefined)
  const [person, setPerson] = useState(null)
  const [pin, setPin] = useState('')
  const [code, setCode] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // sign-in form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // link form
  const [linkCode, setLinkCode] = useState('')

  const timer = useRef(null)

  const loadRoster = useCallback(async () => {
    setError(null)
    try {
      const r = await kioskRoster()
      setRoster(r)
      setPhase('ready')
    } catch (e) {
      /* "Not linked" is not a failure — it is the normal state of a machine
         that has been signed in to but not yet told WHOSE site it is. It gets
         the link screen, not an error screen. Everything else is an error. */
      if (/not linked/i.test(e.message)) {
        setPhase('link')
      } else {
        setError(e.message || 'Could not load the roster.')
        setPhase('link')
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const u = await currentSessionUser()
      if (cancelled) return
      setUser(u)
      if (u) await loadRoster()
      setBooting(false)
    })()
    const off = onSessionChange(u => { setUser(u) })
    return () => { cancelled = true; off() }
  }, [loadRoster])

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setStep('contractor')
    setContractorId(undefined)
    setPerson(null)
    setPin(''); setCode(''); setQuery('')
    setResult(null)
    setBusy(false)
  }, [])

  /* The screen clears itself. A kiosk that keeps the last worker's name and
     result on it is a small privacy leak and a big queue-stopper — the next
     person stands there waiting for it to go away. */
  useEffect(() => {
    if (step !== 'result' || !result) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(reset, resultDuration(result.tone))
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [step, result, reset])

  const choices = useMemo(
    () => (roster ? contractorChoices(roster.people, roster.contractors) : []),
    [roster],
  )
  const crew = useMemo(
    () => (roster ? peopleForContractor(roster.people, contractorId) : []),
    [roster, contractorId],
  )
  const visible = useMemo(() => filterPeople(crew, query), [crew, query])

  const submit = useCallback(async (pinValue, codeValue) => {
    setBusy(true)
    try {
      const row = await kioskCheckIn(person.id, contractorId ?? null, pinValue, codeValue)
      setResult(kioskOutcome(row))
      setStep('result')
      // The roster is re-read on the way out of a result, so a worker with no
      // PIN, or one who has just been issued one, is drawn correctly for the
      // next person without anybody reloading the page.
      loadRoster()
    } catch (e) {
      setResult(kioskOutcome({ ok: false, message: e.message }))
      setStep('result')
    } finally {
      setBusy(false)
    }
  }, [person, contractorId, loadRoster])

  // A desktop kiosk usually has a keyboard. Accepting it costs nothing and
  // refusing it is the kind of small rudeness that makes people hate a machine.
  useEffect(() => {
    if (step !== 'pin' && step !== 'code') return
    const onKey = (e) => {
      if (busy) return
      if (e.key === 'Backspace') { e.preventDefault(); onKeyPress('back'); return }
      if (e.key === 'Escape') { e.preventDefault(); reset(); return }
      if (e.key === 'Enter') { e.preventDefault(); advance(); return }
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); onKeyPress(e.key) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onKeyPress = (k) => {
    if (step === 'pin') {
      const next = keypadPress(pin, k)
      setPin(next)
      if (isComplete(next)) setTimeout(() => { setCode(''); setStep('code') }, 250)
    } else if (step === 'code') {
      const next = keypadPress(code, k)
      setCode(next)
      if (isComplete(next)) setTimeout(() => submit(pin, next), 250)
    }
  }

  const advance = () => {
    if (step === 'pin' && isComplete(pin)) { setCode(''); setStep('code') }
    else if (step === 'code' && isComplete(code)) submit(pin, code)
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  if (booting) {
    return <Shell><div className="ks-panel"><p className="ks-lead">Starting…</p></div></Shell>
  }

  if (!user) {
    return (
      <Shell>
        <div className="ks-panel ks-narrow">
          <h1 className="ks-question">Sign in on this device</h1>
          <p className="ks-help">
            Once, so this machine can be linked to your employer&apos;s site.
            After that, workers use it without signing in.
          </p>
          <form
            className="ks-form"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true); setError(null)
              try {
                await signInKiosk(email, password)
                setPassword('')
                /* Signing in is not the end of this screen, it is the middle
                   of it. Without this the machine sits on phase 'signin' with no
                   roster — it skips past the link step and tells the first
                   worker "no contractors have been set up on this site yet",
                   which is both wrong and the employer's problem to chase. */
                await loadRoster()
              } catch (err) {
                setError(err.message)
              } finally { setBusy(false) }
            }}
          >
            <input className="ks-input" type="email" placeholder="Email" value={email}
              autoComplete="username" onChange={e => setEmail(e.target.value)} required />
            <input className="ks-input" type="password" placeholder="Password" value={password}
              autoComplete="current-password" onChange={e => setPassword(e.target.value)} required />
            {error && <div className="ks-error">{error}</div>}
            <button className="ks-btn ks-btn-primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </Shell>
    )
  }

  // ── Link this machine to one employer ─────────────────────────────────────
  if (phase === 'link') {
    return (
      <Shell footer={<button className="ks-link" onClick={() => { signOutKiosk(); setUser(null); setPhase('signin') }}>Sign out</button>}>
        <div className="ks-panel ks-narrow">
          <h1 className="ks-question">Link this device</h1>
          <p className="ks-help">
            Your employer will read out a code from their DayPay staff screen.
            Enter it here, once.
          </p>
          {error && <div className="ks-error">{error}</div>}
          <form
            className="ks-form"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true); setError(null)
              try {
                await claimDevice(linkCode)
                setLinkCode('')
                await loadRoster()
              } catch (err) {
                setError(err.message)
              } finally { setBusy(false) }
            }}
          >
            <input
              className="ks-input ks-input-code" type="text" placeholder="ABCD2345"
              value={linkCode} autoComplete="off" autoCapitalize="characters" spellCheck="false"
              onChange={e => setLinkCode(e.target.value.toUpperCase())} required
            />
            <button className="ks-btn ks-btn-primary" type="submit" disabled={busy || !linkCode.trim()}>
              {busy ? 'Linking…' : 'Link this device'}
            </button>
          </form>
          <p className="ks-help ks-dim">Signed in as {user.email}</p>
        </div>
      </Shell>
    )
  }

  // ── The attendance flow ───────────────────────────────────────────────────
  const head = (
    <div className="ks-site">
      <span className="ks-site-name">{roster?.businessName || 'Your site'}</span>
      <span className="ks-site-device">{roster?.deviceLabel || 'Site kiosk'}</span>
    </div>
  )

  if (step === 'result' && result) {
    return (
      <Shell>
        <div className={`ks-panel ks-result ks-${result.tone}`} role="status">
          <div className="ks-result-title">{result.title}</div>
          <div className="ks-result-body">{result.body}</div>
          {result.detail?.work_date && (
            <div className="ks-result-meta">
              {result.detail.full_name} · {result.detail.work_date}
              {result.detail.contractor_name ? ` · ${result.detail.contractor_name}` : ''}
              {result.detail.method ? ` · ${result.detail.method === 'kiosk' ? 'Kiosk' : result.detail.method === 'mobile' ? 'Mobile' : 'Recorded by employer'}` : ''}
            </div>
          )}
          <button className="ks-btn ks-btn-primary ks-wide" onClick={reset}>Done — next worker</button>
        </div>
      </Shell>
    )
  }

  if (step === 'contractor') {
    return (
      <Shell footer={head}>
        <div className="ks-panel">
          <h1 className="ks-question">Who are you working for today?</h1>
          {choices.length === 0 ? (
            <p className="ks-help">No contractors have been set up on this site yet. Ask your employer.</p>
          ) : (
            <div className="ks-grid">
              {choices.map(c => (
                <button
                  key={c.id ?? 'none'}
                  className="ks-btn ks-btn-choice"
                  onClick={() => { setContractorId(c.id); setQuery(''); setStep('person') }}
                >
                  <span className="ks-btn-main">{c.name}</span>
                  {c.sub && <span className="ks-btn-sub">{c.sub}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </Shell>
    )
  }

  if (step === 'person') {
    return (
      <Shell footer={head}>
        <div className="ks-panel">
          <h1 className="ks-question">Select your name</h1>

          {crew.length >= KIOSK_FILTER_THRESHOLD && (
            <input
              className="ks-input ks-search" type="text" placeholder="Type to find your name"
              value={query} autoComplete="off" onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          )}

          {visible.length === 0 ? (
            <p className="ks-help">No names here. Check with your supervisor.</p>
          ) : (
            <div className="ks-grid ks-grid-people">
              {visible.map(p => {
                const { name, job } = personLabel(p)
                return (
                  <button
                    key={p.id}
                    className={`ks-btn ks-btn-choice${p.has_pin ? '' : ' is-nopin'}`}
                    onClick={() => {
                      if (!p.has_pin) {
                        setResult(kioskOutcome({ ok: false, message: 'No PIN has been set for you yet. Ask your employer for one.' }))
                        setStep('result')
                        return
                      }
                      setPerson(p); setPin(''); setStep('pin')
                    }}
                  >
                    <span className="ks-btn-main">{name}</span>
                    <span className="ks-btn-sub">{p.has_pin ? (job || 'Tap to enter your PIN') : 'No PIN yet — ask your supervisor'}</span>
                  </button>
                )
              })}
            </div>
          )}

          <button className="ks-link" onClick={() => { setStep('contractor'); setQuery('') }}>← Back</button>
        </div>
      </Shell>
    )
  }

  if (step === 'pin') {
    return (
      <Shell footer={head}>
        <div className="ks-panel">
          <h1 className="ks-question">Enter your PIN</h1>
          <p className="ks-help">{person?.name} — four digits, just for you.</p>
          <PinDots value={pin} />
          <Keypad onKey={onKeyPress} disabled={busy} />
          <div className="ks-row">
            <button className="ks-link" onClick={() => setStep(backStep('pin'))}>← Back</button>
            <button className="ks-btn ks-btn-primary" disabled={!isComplete(pin) || busy} onClick={advance}>
              Next
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // step === 'code'
  return (
    <Shell footer={head}>
      <div className="ks-panel">
        <h1 className="ks-question">Enter today&apos;s site code</h1>
        <p className="ks-help">The four digits on display at the gate.</p>
        <CodeSlots value={code} />
        <Keypad onKey={onKeyPress} disabled={busy} />
        <div className="ks-row">
          <button className="ks-link" onClick={() => setStep('pin')}>← Back</button>
          <button className="ks-btn ks-btn-primary" disabled={!isComplete(code) || busy} onClick={advance}>
            {busy ? 'Checking…' : 'Check in'}
          </button>
        </div>
      </div>
    </Shell>
  )
}
