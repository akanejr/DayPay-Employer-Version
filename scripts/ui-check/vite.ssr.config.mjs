/* Vite config for the UI check. Deliberately a plain object with no
 * `import { defineConfig }` import: this file is loaded by vite from a
 * directory that may not be able to resolve bare specifiers, and a plain
 * object is all vite needs.
 *
 * `root` is the repository root so that react and react-dom resolve from the
 * repository's own node_modules. Paths are derived from this file's own
 * location, so the check runs from any checkout.
 */
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../../', import.meta.url))
const nm = `${repo}node_modules/`

export default {
  root: repo,
  logLevel: 'warn',
  resolve: {
    alias: [
      // every component in src/employer imports the data layer by this path
      { find: /^\.\.\/lib\/employer$/, replacement: `${here}mock-employer.js` },
      // the PDF layer draws with jsPDF; the check records the call instead
      { find: /^\.\.\/lib\/invoicePdf$/, replacement: `${here}mock-invoice-pdf.js` },
      // the check files themselves live outside src/, so their bare imports
      // need pointing at the repository explicitly
      { find: 'react-dom/client', replacement: `${nm}react-dom/client.js` },
      { find: 'react-dom/server', replacement: `${nm}react-dom/server.node.js` },
      { find: /^react$/, replacement: `${nm}react/index.js` },
      { find: /^react\/jsx-runtime$/, replacement: `${nm}react/jsx-runtime.js` },
      { find: /^jsdom$/, replacement: `${nm}jsdom/lib/api.js` },
    ],
  },
  build: {
    ssr: `${here}entry.jsx`,
    // Inside node_modules on purpose: the bundled react-dom does bare
    // require() calls at load time and node can only resolve those from a
    // directory that can see the repository's dependencies. node_modules is
    // gitignored, so nothing is added to the repository.
    outDir: `${nm}.daypay-ui-check`,
    emptyOutDir: true,
  },
}
