"""Bump the ?v= cache-busting version on the page's CSS and JS links.

GitHub Pages lets browsers reuse files for 10 minutes; a new version number
makes every visitor load the updated files right away, and version.json
tells tabs that are already open to reload. Run before pushing a
change to css/ or js/:  python3 tools/bump_version.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js"))]

current = max(int(v) for f in FILES for v in re.findall(r"\?v=(\d+)", f.read_text()))
for f in FILES:
    text = re.sub(r"\?v=\d+", f"?v={current + 1}", f.read_text())
    f.write_text(re.sub(r"APP_VERSION = \d+", f"APP_VERSION = {current + 1}", text))
# Open tabs compare their APP_VERSION with this file and reload when it is newer.
(ROOT / "version.json").write_text(f'{{"v": {current + 1}}}\n')
print(f"v{current} -> v{current + 1}")
