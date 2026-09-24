#!/usr/bin/env python3
"""Generate the Supabase connection-check page.

Why this exists: the agent's sandbox has an egress allowlist and cannot reach
*.supabase.co, so the agent cannot verify credentials. The user's browser can.
This page performs the checks the agent cannot and reports pass/fail in plain
language, so a bad key or a missing table surfaces immediately rather than
mid-feature.

Usage:  python3 scripts/make-connection-check.py [output_dir]
Reads:  .env  (falls back to config/supabase-public.env)
"""

import html
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read_env():
    cfg = {}
    for path in (os.path.join(ROOT, ".env"), os.path.join(ROOT, "config", "supabase-public.env")):
        if not os.path.isfile(path):
            continue
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            cfg.setdefault(k.strip(), v.strip())
    return cfg


def resolve(cfg):
    url = cfg.get("VITE_SUPABASE_URL") or cfg.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (
        cfg.get("VITE_SUPABASE_ANON_KEY")
        or cfg.get("VITE_SUPABASE_PUBLISHABLE_KEY")
        or cfg.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
        or cfg.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or ""
    )
    return url, key


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DayPay — Supabase connection check</title>
<style>
  :root {{ --navy:#0B1B32; --green:#15803D; --ink:#334155; --gray:#64748B;
           --faint:#94A3B8; --fill:#F1F5F9; --hair:#E2E8F0; --red:#B91C1C;
           --amber:#B45309; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; padding:24px 16px 64px; background:var(--fill); color:var(--ink);
          font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }}
  .wrap {{ max-width:680px; margin:0 auto; }}
  h1 {{ font-size:20px; color:var(--navy); margin:0 0 4px; }}
  .sub {{ color:var(--gray); font-size:13px; margin:0 0 20px; }}
  .card {{ background:#fff; border:1px solid var(--hair); border-radius:12px;
           padding:16px; margin-bottom:14px; }}
  .card h2 {{ font-size:13px; text-transform:uppercase; letter-spacing:.06em;
              color:var(--gray); margin:0 0 10px; font-weight:600; }}
  table {{ width:100%; border-collapse:collapse; font-size:13.5px; }}
  td {{ padding:5px 0; vertical-align:top; }}
  td.k {{ color:var(--gray); width:132px; }}
  code {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px;
          background:var(--fill); padding:2px 5px; border-radius:4px; word-break:break-all; }}
  .test {{ display:flex; gap:11px; padding:11px 0; border-top:1px solid var(--hair); }}
  .test:first-of-type {{ border-top:0; }}
  .dot {{ flex:0 0 auto; width:20px; height:20px; border-radius:50%; margin-top:1px;
          display:flex; align-items:center; justify-content:center; font-size:12px;
          font-weight:700; color:#fff; background:var(--faint); }}
  .dot.pass {{ background:var(--green); }}
  .dot.fail {{ background:var(--red); }}
  .dot.warn {{ background:var(--amber); }}
  .dot.run  {{ background:var(--navy); }}
  .tname {{ font-weight:600; color:var(--navy); font-size:14px; }}
  .tdet {{ color:var(--gray); font-size:13px; margin-top:2px; }}
  pre {{ background:var(--navy); color:#E2E8F0; padding:10px 12px; border-radius:8px;
         font-size:12px; overflow-x:auto; margin:8px 0 0; white-space:pre-wrap;
         word-break:break-word; }}
  .verdict {{ border-radius:12px; padding:14px 16px; font-weight:600; font-size:14.5px; }}
  .verdict.ok   {{ background:#DCFCE7; color:#14532D; border:1px solid #86EFAC; }}
  .verdict.bad  {{ background:#FEE2E2; color:#7F1D1D; border:1px solid #FCA5A5; }}
  .verdict.wait {{ background:#E0E7FF; color:#312E81; border:1px solid #A5B4FC; }}
  button {{ font:inherit; font-size:14px; font-weight:600; padding:10px 18px;
            border-radius:9px; border:0; background:var(--green); color:#fff;
            cursor:pointer; margin-top:6px; }}
  button:hover {{ filter:brightness(1.08); }}
  button:disabled {{ opacity:.6; cursor:default; }}
  .note {{ font-size:12.5px; color:var(--gray); margin-top:10px; }}
</style>
</head>
<body>
<div class="wrap">
  <h1>Supabase connection check</h1>
  <p class="sub">Run this in the browser that should reach your database. It reports exactly
  what failed, if anything.</p>

  <div class="card">
    <h2>Resolved configuration</h2>
    <table>
      <tr><td class="k">Project URL</td><td><code id="cfgUrl">—</code></td></tr>
      <tr><td class="k">Key</td><td><code id="cfgKey">—</code></td></tr>
      <tr><td class="k">Key type</td><td id="cfgKind">—</td></tr>
      <tr><td class="k">Key length</td><td id="cfgLen">—</td></tr>
    </table>
  </div>

  <div class="card">
    <h2>Checks</h2>
    <div id="tests"></div>
  </div>

  <div id="verdict" class="verdict wait">Running checks…</div>
  <p class="note">Note: <code>day_records</code> and <code>employees</code> are expected to be
  missing until the migration has been run in the Supabase SQL Editor. A "table not found"
  result on that check is normal before the migration, and a pass afterwards.</p>
</div>

<script type="module">
const URL_ = {url!r};
const KEY = {key!r};

const $ = (id) => document.getElementById(id);
const el = (t, c, s) => {{ const e = document.createElement(t); if (c) e.className = c; if (s) e.textContent = s; return e; }};

$("cfgUrl").textContent = URL_ || "(not set)";
$("cfgKey").textContent = KEY ? KEY.slice(0, 22) + "…" + KEY.slice(-4) : "(not set)";
$("cfgLen").textContent = KEY ? KEY.length + " characters" : "—";
$("cfgKind").textContent = KEY.startsWith("sb_publishable_")
  ? "publishable (new format)"
  : KEY.startsWith("eyJ") ? "anon JWT (legacy format)"
  : KEY ? "unrecognised — see check 2" : "—";

const rows = {{}};
function addRow(id, name) {{
  const d = el("div", "test");
  const dot = el("div", "dot", "…"); dot.id = id + "-dot";
  const body = el("div");
  body.appendChild(el("div", "tname", name));
  const det = el("div", "tdet", "waiting…"); det.id = id + "-det";
  body.appendChild(det);
  d.appendChild(dot); d.appendChild(body);
  $("tests").appendChild(d);
  rows[id] = {{ dot, det }};
  return {{ dot, det }};
}}
function done(id, state, text, raw) {{
  const r = rows[id];
  r.dot.className = "dot " + state;
  r.dot.textContent = state === "pass" ? "✓" : state === "fail" ? "✕" : "!";
  r.det.innerHTML = "";
  r.det.appendChild(document.createTextNode(text));
  if (raw) {{
    const p = el("pre", null, raw);
    r.det.appendChild(p);
  }}
}}

async function probe(url, opts) {{
  const t0 = performance.now();
  try {{
    const res = await fetch(url, opts);
    const text = await res.text();
    return {{ ok: res.ok, status: res.status, text, ms: Math.round(performance.now() - t0) }};
  }} catch (e) {{
    return {{ ok: false, status: 0, text: String(e && e.message || e), ms: Math.round(performance.now() - t0), network: true }};
  }}
}}

async function run() {{
  if (!URL_ || !KEY) {{
    $("verdict").className = "verdict bad";
    $("verdict").textContent = "Missing configuration — no URL or key was resolved.";
    return;
  }}

  const auth = {{ apikey: KEY, Authorization: "Bearer " + KEY }};
  let allOk = true;
  let migrationState = null;

  // 1 — reachability (no key needed)
  addRow("t1", "1. Project reachable");
  const t1 = await probe(URL_ + "/auth/v1/health", {{ headers: {{ apikey: KEY }} }});
  if (t1.network) {{
    done("t1", "fail", "Could not reach the host at all (" + t1.ms + " ms).", t1.text);
    allOk = false;
  }} else if (t1.status >= 500) {{
    done("t1", "warn", "Host answered but returned " + t1.status + ".", t1.text);
  }} else {{
    done("t1", "pass", "Reached in " + t1.ms + " ms (HTTP " + t1.status + ").", null);
  }}

  // 2 — key accepted (the decisive check)
  addRow("t2", "2. Publishable key accepted");
  const t2 = await probe(URL_ + "/rest/v1/", {{ headers: auth }});
  if (t2.status === 200) {{
    done("t2", "pass", "Key accepted. REST API responded normally.", null);
  }} else if (t2.status === 401 || t2.status === 403) {{
    done("t2", "fail", "Key REJECTED (HTTP " + t2.status + "). The key is wrong, truncated, or has a stray character — check for the double underscore near the start of sb_publishable__.", t2.text);
    allOk = false;
  }} else if (t2.network) {{
    done("t2", "fail", "Network error.", t2.text);
    allOk = false;
  }} else {{
    done("t2", "warn", "Unexpected HTTP " + t2.status + ".", t2.text);
  }}

  // 3 — schema state
  addRow("t3", "3. Migration applied");
  const t3 = await probe(URL_ + "/rest/v1/employees?select=id&limit=1", {{ headers: auth }});
  if (t3.status === 200) {{
    done("t3", "pass", "Tables exist and are queryable. Migration is applied.", null);
    migrationState = true;
  }} else {{
    let msg = "HTTP " + t3.status;
    try {{ const j = JSON.parse(t3.text); if (j.message) msg = j.message; if (j.code) msg += " (" + j.code + ")"; }} catch (e) {{}}
    done("t3", "warn", "Not applied yet — " + msg + ". This is expected before the migration.", null);
    migrationState = false;
  }}

  // 4 — anonymous access must be denied (RLS sanity)
  addRow("t4", "4. Anonymous access denied");
  const t4 = await probe(URL_ + "/rest/v1/employees?select=id", {{}});
  if (t4.status === 401 || t4.status === 403 || t4.status === 404) {{
    done("t4", "pass", "Requests without a key are refused (HTTP " + t4.status + ").", null);
  }} else if (t4.status === 200) {{
    done("t4", "fail", "Data is readable WITHOUT any key. Do not put real data in this project until this is fixed.", t4.text.slice(0, 300));
    allOk = false;
  }} else {{
    done("t4", "pass", "Refused (HTTP " + t4.status + ").", null);
  }}

  const v = $("verdict");
  if (!allOk) {{
    v.className = "verdict bad";
    v.textContent = "Action needed — see the failing checks above.";
  }} else if (migrationState === false) {{
    v.className = "verdict warn";
    v.style.background = "#FEF3C7"; v.style.color = "#78350F"; v.style.border = "1px solid #FCD34D";
    v.textContent = "Connection is healthy. Next step: run the migration SQL in the Supabase SQL Editor.";
  }} else {{
    v.className = "verdict ok";
    v.textContent = "All checks passed. Connection healthy and migration applied.";
  }}
}}

window.runCheck = run;
run();
</script>
</body>
</html>
"""


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "site")
    os.makedirs(out_dir, exist_ok=True)
    url, key = resolve(read_env())
    page = PAGE.replace("{url!r}", repr(url)).replace("{key!r}", repr(key))
    page = page.replace("{{", "{").replace("}}", "}")
    dest = os.path.join(out_dir, "connection-check.html")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(page)
    print(f"connection-check.html written to {dest}")
    print(f"  url: {url or '(not set)'}")
    print(f"  key: {(key[:22] + '…' + key[-4:]) if key else '(not set)'}  [{len(key)} chars]")


if __name__ == "__main__":
    main()
