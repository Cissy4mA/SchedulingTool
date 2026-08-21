#!/usr/bin/env python3
"""Low-memory build script for the React frontend.

Vite build OOMs on 8GB Macs, so we use esbuild to bundle src/main.tsx
and then inline the JS (and any CSS it extracts) into dist/index.html.
"""
import glob
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(BASE, "dist", ".bundle-tmp.js")
TMP_CSS = os.path.join(BASE, "dist", ".bundle-tmp.css")

cmd = [
    os.path.join(BASE, "node_modules", ".bin", "esbuild"),
    "src/main.tsx",
    "--bundle",
    f"--outfile={TMP}",
    "--jsx=automatic",
    "--format=iife",
    "--platform=browser",
    "--minify",
    '--define:process.env.NODE_ENV="production"',
]
print("== bundling with esbuild ==")
subprocess.run(cmd, cwd=BASE, check=True)

with open(TMP, "r", encoding="utf-8") as f:
    js = f.read()
os.remove(TMP)

# Prevent inline JS from prematurely closing the script tag.
js = js.replace("</script>", "<\\/script>")

if os.path.exists(TMP_CSS):
    with open(TMP_CSS, "r", encoding="utf-8") as f:
        css = f.read()
    os.remove(TMP_CSS)
    css_tag = f"<style>\n{css}\n</style>"
else:
    css_links = []
    for css_file in sorted(glob.glob(os.path.join(BASE, "dist", "assets", "*.css"))):
        css_links.append(f'<link rel="stylesheet" href="/assets/{os.path.basename(css_file)}">')
    css_tag = chr(10).join(css_links)

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Cache-Control" content="no-store" />
<title>my schedule</title>
{css_tag}
</head>
<body>
<div id="root"></div>
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

out_path = os.path.join(BASE, "dist", "index.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)
print(f"== wrote {out_path} ==")
