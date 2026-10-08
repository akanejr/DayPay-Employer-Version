/* DayPay — every cross-layer proof in one command.
 *
 *     npm install --no-save @electric-sql/pglite
 *     npm run prove
 *
 * The three scripts answer different questions and none of them replaces the
 * others:
 *
 *   migrations.mjs  Does the SCHEMA this app expects come out of an empty
 *                   database when 001..013 are applied in order? Nothing else
 *                   here is meaningful if this fails, so it runs first.
 *
 *   e2e.mjs         Does a real day of work end up as the same money on every
 *                   screen? It walks the whole product — check-in, dashboard,
 *                   worker, month, year, contractor total, invoice — and
 *                   reconciles each layer against the layer below it. This is
 *                   the Phase 8 mandate.
 *
 *   harness.mjs     Can an employee see another employee's wages? It runs the
 *                   shipped supabase/harness/rls_test.sql in one go and reports
 *                   the file's own verdict.
 *
   *   lockout-probe.mjs
   *                   Does five wrong codes actually lock anybody out? It did not
   *                   for three phases: the refusal was raised, which rolled back
   *                   the attempt record it had just written. Migration 017 fixed
   *                   it. This measures the fixed behaviour and exits non-zero if
   *                   the cap ever stops working again.
   *
   *   ../ui-check     Does every SCREEN actually render, and does each control do
   *                   something? A build proves a file compiles and nothing more.
   *                   This mounts the employer and worker screens in a real DOM
   *                   and drives them like a person would.
   *
   *                   It is in this list because on 1 October 2026 it was found to
   *                   have been quietly testing nothing: its fixtures were pinned
   *                   to September, the app opens on the CURRENT month, so the
   *                   days it went looking for were not on screen. `npm run prove`
   *                   did not run it, which is why nobody noticed for a day. A
   *                   proof that is not run is not a proof.
 *
 * Each exits non-zero on failure, so the runner does too.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('./', import.meta.url))
const scripts = [
  ['migrations.mjs', 'THE SCHEMA — 001 to 019, from empty'],
  ['e2e.mjs', 'THE FIGURES — every layer reconciles with the one below it'],
  ['harness.mjs', 'THE PERMISSIONS — the shipped RLS harness, every check'],
  ['lockout-probe.mjs', 'THE LOCKOUT — five wrong codes recorded, the sixth refused'],
]

const failed = []
for (const [file, title] of scripts) {
  console.log(`\n\n${'#'.repeat(78)}\n#  ${title}\n#  scripts/integration/${file}\n${'#'.repeat(78)}`)
    const r = spawnSync(process.execPath, [here + file], { stdio: 'inherit' })
    if (r.status !== 0) failed.push(file)
  }

  /* The screen proofs. Two steps, because the harness has to be compiled first —
     a vite build of the real components, so what gets mounted is the code that
     ships rather than a paraphrase of it. Kept last: it is the slowest, and a
     schema failure makes every screen it would mount meaningless. */
  const uiCheck = fileURLToPath(new URL('../ui-check/', import.meta.url))
  const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url))
  console.log(`\n\n${'#'.repeat(78)}\n#  THE SCREENS — every pane mounts, every control does something\n#  scripts/ui-check\n${'#'.repeat(78)}`)
  const compiled = spawnSync(process.execPath, [vite, 'build', '--config', uiCheck + 'vite.ssr.config.mjs'], { stdio: 'inherit' })
  if (compiled.status !== 0) {
    failed.push('ui-check (build)')
  } else {
    const bundle = fileURLToPath(new URL('../../node_modules/.daypay-ui-check/entry.js', import.meta.url))
    const run = spawnSync(process.execPath, [bundle], { stdio: 'inherit' })
    if (run.status !== 0) failed.push('ui-check')
  }

console.log(`\n\n${'='.repeat(78)}`)
if (failed.length === 0) {
  console.log('ALL PROOFS PASSED — schema, figures, permissions and screens')
} else {
  console.log(`FAILED: ${failed.join(', ')}`)
}
console.log('='.repeat(78))
process.exit(failed.length === 0 ? 0 : 1)
