#!/usr/bin/env python3
"""Static server for the DayPay preview build.

Zero dependencies on purpose: node_modules is stripped from sandbox snapshots
between turns, so a Node-based server dies. This one always starts.

Serves ./preview-dist on 0.0.0.0 so the Arena preview proxy can reach it.
"""

import http.server
import os
import socketserver
import sys

PORT = int(os.environ.get("PORT", "5173"))
HERE = os.path.dirname(os.path.abspath(__file__))

# "dist"/"build"/"out" are stripped from sandbox snapshots between turns, so the
# build lives in "site/" — a name that survives. Fall back for safety.
for _candidate in ("site", "preview-dist", "dist"):
    if os.path.isdir(os.path.join(HERE, _candidate)):
        ROOT = os.path.join(HERE, _candidate)
        break
else:
    ROOT = os.path.join(HERE, "site")

EXTRA_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        # Never cache, so a redeploy always shows up on reload.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # Deliberately no X-Frame-Options / CSP frame-ancestors: the preview is
        # embedded in an iframe on the Arena host, and blocking that breaks it.
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        # SPA fallback: unknown non-file routes render the app shell.
        if not os.path.exists(path) and "." not in os.path.basename(self.path):
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    if not os.path.isdir(ROOT):
        sys.exit(f"ERROR: build directory not found: {ROOT}\nRun: npm run build && cp -r dist preview-dist")
    server = Server(("0.0.0.0", PORT), Handler)
    print(f"DayPay preview serving {ROOT} on http://0.0.0.0:{PORT}", flush=True)
    server.serve_forever()
