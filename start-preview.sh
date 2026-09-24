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
#    snapshots. Copy it into .env, which is what Vite reads.
if [ ! -f config/supabase-public.env ]; then
  echo "ERROR: config/supabase-public.env is missing." >&2
  exit 1
fi
cp config/supabase-public.env .env
echo "==> .env written from config/supabase-public.env"

# 2. Build if needed.
if [ ! -f site/index.html ]; then
  echo "==> Building into site/"
  [ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1
  npx vite build --outDir site --emptyOutDir >/dev/null 2>&1
  echo "    build complete"
fi

# 3. Guard: a build with no Supabase config boots silently offline.
URL_VAL="$(grep -m1 '^VITE_SUPABASE_URL=' .env | cut -d= -f2-)"
if [ -z "$URL_VAL" ]; then
  echo "ERROR: VITE_SUPABASE_URL is empty in .env" >&2
  exit 1
fi
if ! grep -rq "$(echo "$URL_VAL" | sed 's|https://||; s|\.supabase\.co||')" site/ 2>/dev/null; then
  echo "==> WARNING: Supabase URL not found in build; forcing rebuild"
  rm -rf site
  [ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1
  npx vite build --outDir site --emptyOutDir >/dev/null 2>&1
fi

# 4. Diagnostic page — the agent's sandbox cannot reach Supabase, the browser can.
python3 scripts/make-connection-check.py site

# 5. Serve.
echo "==> Serving site/ on 0.0.0.0:${PORT}"
echo "    app:              http://localhost:${PORT}/"
echo "    connection check: http://localhost:${PORT}/connection-check.html"
exec python3 serve.py
