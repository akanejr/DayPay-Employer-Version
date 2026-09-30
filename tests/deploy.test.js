/* The deploy configuration, held to the code it deploys.
 *
 * `vercel.json` is a promise about a build: run this command, and the files
 * will appear in that directory, with these headers on them. Nothing in the app
 * checks that promise, and a deploy is a bad place to discover it has drifted —
 * the failure arrives as a 404 on a live site rather than a red test.
 *
 * So these checks are cheap and specific: the build command exists, the output
 * directory is the one Vite actually writes to, both entry points are produced
 * by that build, and the committed public config carries no secret (reusing the
 * same detector the build uses, so there is one definition of "a secret").
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { looksSecret } from '../scripts/prepare-env.mjs'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const json = (rel) => JSON.parse(read(rel))

describe('vercel.json deploys what the build actually produces', () => {
  const cfg = json('vercel.json')
  const pkg = json('package.json')

  test('it is strict JSON, so Vercel can read it', () => {
    assert.doesNotThrow(() => JSON.parse(read('vercel.json')))
  })

  test('the build command it names is a real script', () => {
    const m = /^npm run (\S+)$/.exec(cfg.buildCommand)
    assert.ok(m, `buildCommand is not an npm script: ${cfg.buildCommand}`)
    assert.ok(pkg.scripts[m[1]], `package.json has no script "${m[1]}"`)
    // and that script must actually build, not just prepare the environment
    assert.match(pkg.scripts[m[1]], /vite build/)
  })

  test('the output directory is the one Vite is configured to write', () => {
    const vite = read('vite.config.js')
    const m = /outDir:\s*'([^']+)'/.exec(vite)
    assert.ok(m, 'vite.config.js no longer sets build.outDir explicitly')
    assert.equal(cfg.outputDirectory, m[1],
      'vercel.json would publish a directory Vite never writes to')
  })

  test('both entry points are real files, so both get built', () => {
    // A missing kiosk.html is not a build error — Vite would simply not emit a
    // kiosk page, and the machine at the gate would 404. This is the check that
    // notices.
    for (const file of ['index.html', 'kiosk.html']) {
      assert.ok(fs.existsSync(path.join(REPO, file)), `${file} is missing`)
    }
    const vite = read('vite.config.js')
    assert.match(vite, /main:\s*path\.resolve\(process\.cwd\(\), 'index\.html'\)/)
    assert.match(vite, /kiosk:\s*path\.resolve\(process\.cwd\(\), 'kiosk\.html'\)/)
  })

  test('nothing the app needs at runtime lives outside the published directory', () => {
    // Everything in public/ is copied to the web root. The service worker
    // caches its app shell by absolute path, so a rename here breaks the
    // offline shell silently, on a phone, later.
    for (const asset of ['manifest.json', 'sw.js', 'daypay-icon-512.png', 'daypay-icon.svg']) {
      assert.ok(fs.existsSync(path.join(REPO, 'public', asset)), `public/${asset} is missing`)
    }
    const sw = read('public/sw.js')
    assert.match(sw, /'\/manifest\.json'/)
    assert.match(sw, /'\/daypay-icon\.svg'/)
  })

  test('the headers are sane: the catch-all first, exact rules after', () => {
    const sources = cfg.headers.map(h => h.source)
    assert.equal(sources[0], '/(.*)', 'the catch-all must come first or it shadows the rest')
    assert.equal(new Set(sources).size, sources.length, 'duplicate header source')
    for (const h of cfg.headers) {
      for (const header of h.headers) {
        assert.ok(header.key && header.value, `empty header in ${h.source}`)
      }
    }
  })

  test('the kiosk is kept out of search results and never cached hard', () => {
    const kiosk = cfg.headers.find(h => h.source === '/kiosk.html')
    assert.ok(kiosk, 'no header rule for the kiosk page')
    const keys = Object.fromEntries(kiosk.headers.map(h => [h.key, h.value]))
    assert.equal(keys['X-Robots-Tag'], 'noindex')
    assert.match(keys['Cache-Control'], /must-revalidate/)
  })

  test('the browser is told not to offer location, camera or microphone', () => {
    // The brief forbids GPS outright. Denying the permission at the host means
    // it is refused before any code runs, whatever the code later says.
    const all = cfg.headers.find(h => h.source === '/(.*)')
    const policy = all.headers.find(h => h.key === 'Permissions-Policy')
    assert.ok(policy, 'no Permissions-Policy header')
    for (const api of ['geolocation', 'camera', 'microphone']) {
      assert.match(policy.value, new RegExp(`${api}=\\(\\)`), `${api} is not denied`)
    }
  })
})

describe('the committed public config carries no secret', () => {
  const file = 'config/supabase-public.env'

  test('it is committed, because the build depends on it', () => {
    assert.ok(fs.existsSync(path.join(REPO, file)))
  })

  test('it holds exactly the two public values and nothing else', () => {
    const keys = read(file).split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.slice(0, l.indexOf('=')).trim())
    assert.deepEqual(keys.sort(), ['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL'])
  })

  test('every value passes the same secret detector the build uses', () => {
    for (const line of read(file).split('\n')) {
      const s = line.trim()
      if (!s || s.startsWith('#')) continue
      const eq = s.indexOf('=')
      const key = s.slice(0, eq).trim()
      const value = s.slice(eq + 1).trim()
      assert.equal(looksSecret(key, value), null,
        `${key} looks like a secret and must not be committed`)
    }
  })

  test('the detector would actually catch a service_role key', () => {
    // A guard that never fires is not a guard. These are the shapes it exists
    // to stop, using fake values.
    assert.ok(looksSecret('VITE_SUPABASE_ANON_KEY', 'sb_secret_abcdefg'))
    assert.ok(looksSecret('VITE_SUPABASE_ANON_KEY', 'sbp_0123456789'))
    assert.ok(looksSecret('SUPABASE_SERVICE_ROLE', 'anything'))
    assert.ok(looksSecret('X', 'eyJhbGciOiJIUzI1NiJ9.' +
      Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.sig'))
  })
})
