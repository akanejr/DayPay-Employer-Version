/* DayPay 2.0 — the design system, on one page.
 *
 * This page is the design system's own screen: it renders every token and every
 * component in src/ui/, in both themes, so the look can be agreed on once
 * rather than argued about screen by screen. It is built for the PREVIEW only
 * (see scripts/specimen.vite.config.mjs) and is not part of the application
 * bundle — `npm run build` still produces exactly two entries.
 *
 * It is also what keeps the system honest: a component that is not good enough
 * to put on this page is not good enough to put in front of an employer.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { useState } from 'react'
import { Section, List, Item, Progress, Skeleton, Loading, Chip, Notice } from '../ui/Ui.jsx'

/* The ramp, exactly as src/index.css declares it. Writing the list out rather
   than reading it at runtime is deliberate: if a step is renamed, this page
   stops compiling and the specimen cannot quietly disagree with the product. */
const RAMP = [
  ['--fs-display', '34px', 'Splash only'],
  ['--fs-hero', 'clamp(38–46px)', 'Earnings hero'],
  ['--fs-hero-sm', 'clamp(30–36px)', 'Sub-hero'],
  ['--fs-2xl', '26px', 'Screen heading, card hero'],
  ['--fs-xl', '22px', 'Stat value'],
  ['--fs-lg', '19px', 'Page and modal titles'],
  ['--fs-md', '16px', 'Inputs, emphasised body'],
  ['--fs-sm', '15px', 'Body, rows, actions'],
  ['--fs-xs', '13px', 'Secondary text, hints'],
  ['--fs-label', '12px', 'Section labels'],
  ['--fs-2xs', '11px', 'Micro — kiosk and badges only'],
]

const INK = [
  ['--text', 'Primary'],
  ['--text-2', 'Secondary'],
  ['--text-3', 'Tertiary — hints, metadata'],
  ['--text-4', 'Faintest — still above AA'],
]

const MEANING = [
  ['--green-ink', 'Working · confirmed · earnings'],
  ['--amber', 'Pending · needs attention'],
  ['--danger', 'Destructive · critical error'],
]

const SURFACES = [
  ['--bg', 'Page'],
  ['--bg-elevated', 'Cards, rows'],
  ['--bg-sunken', 'Track, inputs'],
  ['--border', 'Hairline'],
  ['--border-light', 'Divider inside a list'],
]

function Swatch({ token, label, meaning }) {
  return (
    <div className="spx-swatch">
      <span className="spx-swatch-chip" style={{ background: `var(${token})` }} />
      <span className="spx-swatch-body">
        <span className="spx-swatch-name">{label}</span>
        <span className="spx-swatch-token">{token}{meaning ? ` · ${meaning}` : ''}</span>
      </span>
    </div>
  )
}

export default function Specimen() {
  const [theme, setTheme] = useState('light')
  const [copied, setCopied] = useState(false)

  return (
    <div className="spx-root" data-theme={theme === 'dark' ? 'dark' : undefined}>
      <header className="spx-head">
        <div>
          <h1 className="spx-h1">DayPay design system</h1>
          <p className="spx-lede">
            Every token and every component, in one place. Phase 2 of the DayPay 2.0
            redesign — the foundation the screens are built on in phases 4 to 13.
          </p>
        </div>
        <button
          type="button"
          className="spx-theme"
          onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </header>

      <Section label="Type ramp" />
      <div className="spx-panel">
        {RAMP.map(([token, size, use]) => (
          <div className="spx-ramp-row" key={token}>
            <span className="spx-ramp-sample" style={{ fontSize: `var(${token})` }}>
              Know what your work is worth
            </span>
            <span className="spx-ramp-meta">
              <code>{token}</code> · {size} · {use}
            </span>
          </div>
        ))}
      </div>

      <Section label="Ink" />
      <div className="spx-grid">
        {INK.map(([t, use]) => <Swatch key={t} token={t} label={use} />)}
      </div>

      <Section label="Colour with meaning" />
      <div className="spx-grid">
        {MEANING.map(([t, use]) => <Swatch key={t} token={t} label={use} />)}
      </div>
      <p className="spx-note">
        Colour is never the only signal. A chip carries a word; a progress bar carries
        its figures. Somebody who cannot tell green from amber reads the same screen.
      </p>

      <Section label="Surfaces and dividers" />
      <div className="spx-grid">
        {SURFACES.map(([t, use]) => <Swatch key={t} token={t} label={use} />)}
      </div>

      <Section label="Status chips" />
      <div className="spx-row">
        <Chip tone="ok">Registered</Chip>
        <Chip tone="warn">Not registered</Chip>
        <Chip tone="quiet">Not registered</Chip>
        <Chip tone="danger">Void</Chip>
        <Chip>Neutral</Chip>
      </div>
      <p className="spx-note">
        <strong>ok</strong> is a completed state, <strong>warn</strong> needs somebody,
        <strong> danger</strong> is destructive, <strong>quiet</strong> is a fact about the
        record rather than a call to action. “Not registered” is shown twice on purpose:
        the warn tone is right when it is the first worker on a new site, and the quiet
        tone is right on a list of twenty.
      </p>

      <Section label="Progress" />
      <div className="spx-panel">
        <Progress value={18} max={21} label="Workers recorded today" caption="2 absent · 3 not recorded">
          18 / 21 recorded
        </Progress>
        <Progress value={21} max={21} label="Workers recorded today" caption="Everybody recorded" />
        <Progress value={0} max={21} label="Workers recorded today" caption="Nothing recorded yet" />
      </div>

      <Section label="Rows" />
      <List>
        <Item
          icon={<span aria-hidden="true">📄</span>}
          title="A plain row"
          sub="Title, sub-line, and nothing to press"
        />
        <Item
          onClick={() => setCopied(true)}
          icon={<span aria-hidden="true">▸</span>}
          title="A row you can press"
          sub="It is a real button: focusable, Enter and Space work"
          trail={<span aria-hidden="true">›</span>}
        />
        {/* A row can go somewhere as well as do something, and the two are
            not the same element. This one is a link, so it can be copied,
            long-pressed, or opened in a new tab — none of which a button can
            do — and it looks identical, because the difference is for the
            browser and the keyboard, not for the eye. */}
        <Item
          href="#/specimen"
          title="A row that goes somewhere"
          sub="It is a real link: copy it, long-press it, open it in a new tab"
          trail={<span aria-hidden="true">›</span>}
        />
        <Item
          title="A row with a chip"
          sub="The chip stays on the right where a thumb expects it"
          trail={<Chip tone="ok">Registered</Chip>}
        />
      </List>

      <Section label="Notices" />
      <div className="spx-stack">
        <Notice
          tone="empty"
          title="No workers yet"
          body="Add your first worker to start tracking attendance and earnings."
          action={<button type="button" className="spx-btn">Add worker</button>}
        />
        <Notice
          tone="error"
          title="Attendance couldn’t be saved"
          body="Check your connection and try again. Nothing was recorded, so nothing is half-true."
          action={<button type="button" className="spx-btn">Try again</button>}
        />
        <Notice
          tone="attention"
          title="3 workers have no rate set"
          body="Days can still be recorded, but they will not be worth anything until a rate is set."
          action={<button type="button" className="spx-btn">Set rates</button>}
        />
      </div>

            <Section label="Loading" />
      <div className="spx-panel">
        <Skeleton variant="title" />
        <Skeleton count={2} />
        <Skeleton variant="block" />
      </div>
      <p className="spx-note">
        A loading screen says what is coming and roughly how much of it, instead of one
        line of grey text. The shimmer stops for anybody who asked motion to stop; the
        skeleton itself is hidden from screen readers, which are told by the screen.
      </p>

      {/* The shapes above are what it is made of; this is what a screen should
          reach for. It is deliberately one thing and not three. */}
      <div className="spx-panel">
        <Loading label="Loading your staff…" shape="rows" lines={2} />
      </div>
      <p className="spx-note">
        <code>Loading</code> is those three answers at once, so a screen cannot
        half-say it: the shapes, a sentence for assistive technology, and
        <code>aria-busy</code> on the block. A pane that waits and says nothing is
        indistinguishable from a pane that has finished and found nothing.
      </p>

      <Section label="The way back" />
      <div className="dp-back-wrap">
        <a className="dp-back" href="#/specimen">Back to the screen you came from</a>
      </div>
      <p className="spx-note">
        A screen reached by going deeper needs a way up, or Back is the only exit.
      </p>

      <Section label="Focus" />
      <div className="spx-panel spx-row">
        <button type="button" className="spx-btn">Tab to me</button>
        <button type="button" className="spx-btn spx-btn-primary">Then me</button>
        <span className="spx-note" style={{ margin: 0 }}>
          The ring is <code>:focus-visible</code> — a keyboard sees it, a thumb never does.
        </span>
      </div>

      <footer className="spx-foot">
        {copied ? 'That press registered.' : 'Press the second row to prove it is a button.'}
      </footer>
    </div>
  )
}
