#!/usr/bin/env python3
"""Low-memory build script for the React frontend.

Vite build OOMs on 8GB Macs, so we use esbuild to bundle src/main.tsx and
inline the JS + CSS into <OUT_DIR>/index.html.

Environment:
  OUT_DIR   output directory (default: dist)
  GLASS     set to 1 to add class="glass" on <body> (enables the glass theme)
"""
import os
import subprocess
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.environ.get("OUT_DIR", "dist")
GLASS = os.environ.get("GLASS", "") == "1"
OUT = os.path.join(BASE, OUT_DIR)
os.makedirs(OUT, exist_ok=True)

BUILD_TIME = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

TMP_JS = os.path.join(OUT, ".bundle-tmp.js")
TMP_CSS = os.path.join(OUT, ".bundle-tmp.css")
ESBUILD = os.path.join(BASE, "node_modules", ".bin", "esbuild")

# 1) JS bundle. Treat the CSS import inside main.tsx as empty, because we
#    bundle styles.css separately below (esbuild can't emit both from one entry).
print("== bundling JS with esbuild ==")
subprocess.run(
    [ESBUILD, "src/main.tsx", "--bundle",
     f"--outfile={TMP_JS}", "--jsx=automatic", "--format=iife",
     "--platform=browser", "--minify",
     '--define:process.env.NODE_ENV="production"',
     "--loader:.css=empty"],
    cwd=BASE, check=True,
)

# 2) CSS bundle (real, fresh styles.css — fixes the stale dist/assets bug).
print("== bundling CSS with esbuild ==")
subprocess.run(
    [ESBUILD, "src/styles.css", "--bundle", f"--outfile={TMP_CSS}", "--minify"],
    cwd=BASE, check=True,
)

with open(TMP_JS, "r", encoding="utf-8") as f:
    js = f.read()
os.remove(TMP_JS)
js = js.replace("</script>", "<\\/script>")

with open(TMP_CSS, "r", encoding="utf-8") as f:
    css = f.read()
os.remove(TMP_CSS)
css_tag = f"<style>\n{css}\n</style>"

body_class = ' class="glass"' if GLASS else ""

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="0" />
<title>my schedule</title>
{css_tag}
</head>
<body{body_class}>
<div id="root"></div>
<div id="build-badge">build: {BUILD_TIME}</div>
<script>
window.addEventListener("error", function(e){{
  var pre=document.createElement("pre");
  pre.style.cssText="color:#b91c1c;background:#fef2f2;padding:16px;font-family:monospace;white-space:pre-wrap;border:2px solid #b91c1c;border-radius:8px;margin:16px;font-size:14px";
  pre.textContent="JS: "+(e.error&&e.error.message||e.message);
  document.body&&document.body.appendChild(pre);
}});
</script>
<script>
{js}
</script>
</body>
</html>
"""

out_path = os.path.join(OUT, "index.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)
print(f"== wrote {out_path} ==")
