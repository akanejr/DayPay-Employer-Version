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
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { looksSecret, prepareEnv } from '../scripts/prepare-env.mjs'

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

describe('a host that injects environment variables cannot poison the bundle', () => {
  /* Vercel's import screen offers an "Environment Variables" box, and the two
     Supabase keys sit next to each other in the dashboard — the publishable
     one and the secret one. Vite gives host variables precedence over the
     committed file, so a paste of the wrong key would be compiled straight
     into the browser. prepareEnv is the only thing standing there, so it is
     tested directly rather than through a build. */
  const tmpProject = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daypay-env-'))
    fs.mkdirSync(path.join(root, 'config'))
    fs.copyFileSync(
      path.join(REPO, 'config', 'supabase-public.env'),
      path.join(root, 'config', 'supabase-public.env'),
    )
    return root
  }

  const withEnv = (vars, fn) => {
    const saved = {}
    for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v }
    try { return fn() } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v
      }
    }
  }

  test('a secret pasted into the host is refused, by name and by reason', () => {
    const root = tmpProject()
    assert.throws(
      () => withEnv({ VITE_SUPABASE_ANON_KEY: 'sb_secret_this-is-a-service-key' },
        () => prepareEnv(root, { quiet: true })),
      /looks like secret key/,
    )
  })

  test('a service_role JWT in a variable this file never reads is refused too', () => {
    const root = tmpProject()
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.' +
      Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.sig'
    assert.throws(
      () => withEnv({ NEXT_PUBLIC_SUPABASE_SERVICE_KEY: jwt },
        () => prepareEnv(root, { quiet: true })),
      /looks like service_role JWT/,
    )
  })

  test('pointing at a DIFFERENT project is refused by default, and says both names', () => {
    // Two projects in one account, a URL copied from the wrong tab: the build
    // must not quietly roll out against another database.
    const root = tmpProject()
    assert.throws(
      () => withEnv({ VITE_SUPABASE_URL: 'https://kwedhxmparriekjnwlal.supabase.co' },
        () => prepareEnv(root, { quiet: true })),
      (e) => /kwedhxmparriekjnwlal/.test(e.message) &&
        /crirzuoehbkzpnwokyxl/.test(e.message) &&
        /DAYPAY_ALLOW_OTHER_PROJECT/.test(e.message),
    )
  })

  test('the same override is allowed when it is asked for by name', () => {
    const root = tmpProject()
    const { url } = withEnv({
      VITE_SUPABASE_URL: 'https://kwedhxmparriekjnwlal.supabase.co',
      DAYPAY_ALLOW_OTHER_PROJECT: '1',
    }, () => prepareEnv(root, { quiet: true }))
    assert.equal(url, 'https://kwedhxmparriekjnwlal.supabase.co',
      'a deliberate staging target must be honoured, and verified against itself')
  })

  test('with no host variables at all, the committed file is what ships', () => {
    const root = tmpProject()
    const { url, key } = prepareEnv(root, { quiet: true })
    assert.match(url, /crirzuoehbkzpnwokyxl/)
    assert.match(key, /^sb_publishable_/)
  })
})

/* ── The build must not remember where it used to live ────────────────────
 * A deploy that carries the previous deployment's address inside it is a
 * deploy that is right only by accident. Two strings used to do exactly that:
 * the About screen printed `daypay-app.vercel.app` whatever the real address
 * was, and every exported reminder put that same host inside the calendar
 * entry a worker taps — so after moving to a new project, the reminder opened
 * the old app. Both now read the address they are actually running at, which
 * is also what makes a preview build tell the truth about itself.
 *
 * The release identity is the other half: `APP_VERSION` decides when the
 * splash is an occasion and, paired with the service worker's cache name,
 * decides whether a returning browser keeps the previous shell. Drifting them
 * apart is how a phone ends up running last month's files, so they are
 * asserted to be one string, in the spelling this product actually uses.
 */
describe('the shipped app knows its own address and its own release', () => {
  const app = read('src/App.jsx')
  const sw = read('public/sw.js')

  test('no source file hard-codes a deployment address', () => {
    const carriers = ['src/App.jsx', 'index.html', 'kiosk.html', 'public/sw.js',
      'public/manifest.json']
    const offenders = carriers.filter(f => /vercel\.app/.test(read(f)))
    assert.deepEqual(offenders, [],
      'these carry a fixed host instead of reading the one they run at')
  })

  test('the About screen and the reminder use the address the app is served from', () => {
    assert.match(app, /Running at/, 'About must describe where this copy runs')
    assert.match(app, /window\.location\.hostname/, 'About reads the real host')
    assert.match(app, /window\.location\.origin/, 'the reminder link reads the real origin')
  })

  test('APP_VERSION and the service-worker cache name are one release', () => {
    const appVersion = /const APP_VERSION = '([^']+)'/.exec(app)
    const cacheName = /const CACHE_NAME = '([^']+)'/.exec(sw)
    assert.ok(appVersion && cacheName, 'both constants must be findable')
    assert.equal(appVersion[1], cacheName[1],
      'a bumped version with an unbumped cache serves the previous shell')
    assert.match(appVersion[1], /^daypay-employer-v\d/,
      `the release name must identify this product, not the tracker it came from: ${appVersion[1]}`)
  })
})
