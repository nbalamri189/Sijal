"""Bump the ?v= cache-busting version on the page's CSS and JS links.

GitHub Pages lets browsers reuse files for 10 minutes; a new version number
makes every visitor load the updated files right away. Run before pushing a
change to css/ or js/:  python3 tools/bump_version.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js"))]

current = max(int(v) for f in FILES for v in re.findall(r"\?v=(\d+)", f.read_text()))
for f in FILES:
    f.write_text(re.sub(r"\?v=\d+", f"?v={current + 1}", f.read_text()))
print(f"v{current} -> v{current + 1}")
