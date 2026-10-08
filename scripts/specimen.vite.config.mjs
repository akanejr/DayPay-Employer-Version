/* The design system's specimen page — BUILT FOR THE PREVIEW ONLY.
 *
 * It writes into site/ (the static preview served by start-preview.sh) and
 * never into dist/. `npm run build` still produces exactly two entries, the app
 * and the kiosk, so nothing about the product's shape changes by having this
 * page exist.
 *
 * emptyOutDir is false on purpose: this runs AFTER build:site, which has
 * already cleared and filled the directory with the app. Clearing it here would
 * delete the application.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { prepareEnv } from './prepare-env.mjs'

const repo = path.resolve(import.meta.dirname, '..')

prepareEnv(repo, { quiet: true })

export default defineConfig({
  root: repo,
  logLevel: 'warn',
  plugins: [react()],
  build: {
    outDir: 'site',
    emptyOutDir: false,
    rollupOptions: {
      input: { specimen: path.resolve(repo, 'specimen.html') },
    },
  },
})
