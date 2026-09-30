#!/usr/bin/env bash
# One-command DayPay preview startup.
#
# Context: the sandbox is rebuilt between turns. node_modules/, dist/, .env and
# even the build output can be stripped. So this rebuilds whatever is missing
# and then serves a static build with zero runtime dependencies.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5173}"

# 1. Public config lives in a COMMITTED file, because .env is stripped from
#    snapshots. This fills .env in from it, and fails the run if the config is
#    missing or looks like a secret.
node scripts/prepare-env.mjs

# 2. Build if needed. vite.config.js now refuses to finish a build that did not
#    pick up the Supabase config, so "built but silently offline" cannot ship.
if [ ! -f site/index.html ]; then
  echo "==> Building into site/"
  [ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1
  npx vite build --outDir site --emptyOutDir
  echo "    build complete"
fi

# 3. Diagnostic page — the agent's sandbox cannot reach Supabase, the browser can.
python3 scripts/make-connection-check.py site

# 4. Serve.
echo "==> Serving site/ on 0.0.0.0:${PORT}"
echo "    app:              http://localhost:${PORT}/"
echo "    connection check: http://localhost:${PORT}/connection-check.html"
exec python3 serve.py
