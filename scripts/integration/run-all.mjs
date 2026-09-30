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
 *                   shipped supabase/harness/rls_test.sql, all 58 checks, in
 *                   one go, and reports the file's own verdict.
 *
 * Each exits non-zero on failure, so the runner does too.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('./', import.meta.url))
const scripts = [
  ['migrations.mjs', 'THE SCHEMA — 001 to 013, from empty'],
  ['e2e.mjs', 'THE FIGURES — every layer reconciles with the one below it'],
  ['harness.mjs', 'THE PERMISSIONS — the shipped RLS harness, all 58 checks'],
]

const failed = []
for (const [file, title] of scripts) {
  console.log(`\n\n${'#'.repeat(78)}\n#  ${title}\n#  scripts/integration/${file}\n${'#'.repeat(78)}`)
  const r = spawnSync(process.execPath, [here + file], { stdio: 'inherit' })
  if (r.status !== 0) failed.push(file)
}

console.log(`\n\n${'='.repeat(78)}`)
if (failed.length === 0) {
  console.log('ALL PROOFS PASSED — schema, figures and permissions')
} else {
  console.log(`FAILED: ${failed.join(', ')}`)
}
console.log('='.repeat(78))
process.exit(failed.length === 0 ? 0 : 1)
