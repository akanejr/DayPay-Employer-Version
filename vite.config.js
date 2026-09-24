import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { prepareEnv } from './scripts/prepare-env.mjs'

/* https://vite.dev/config/

   prepareEnv() runs at module load, which is BEFORE Vite resolves config and
   reads .env. Without it, a build on a machine whose .env has been stripped
   produces a bundle with no Supabase credentials — the app boots, looks
   normal, and silently offers no cloud, no sign-in and no Join tab. */

const { url: supabaseUrl } = prepareEnv(process.cwd(), { quiet: true })
const projectRef = supabaseUrl.replace(/^https:\/\//, '').split('.')[0]

/* Proof, not hope: after the bundle is written, confirm the project ref is
   actually inside it. This is what turns "silently offline" into a failed
   build. Cheap — the output is a few hundred KB. */
function assertConfigShipped() {
  let outDir = 'dist'
  return {
    name: 'daypay:assert-config-shipped',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const files = []
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (/\.(js|html|json)$/.test(entry.name) && entry.name !== 'sw.js') files.push(full)
        }
      }
      try {
        walk(outDir)
      } catch {
        return
      }
      const found = files.some((f) => fs.readFileSync(f, 'utf8').includes(projectRef))
      if (!found) {
        throw new Error(
          `Build shipped WITHOUT the Supabase project ref "${projectRef}".\n` +
            'The app would boot and quietly report "Cloud sync not configured."\n' +
            'Check that config/supabase-public.env is present and that .env VITE_ vars survive the build.'
        )
      }
      console.log(`\n✓ ${path.relative(process.cwd(), outDir)}/ carries the Supabase config (${projectRef})`)
    },
  }
}

export default defineConfig({
  plugins: [react(), assertConfigShipped()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
  },
})
