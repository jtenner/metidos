# README public-readiness link audit — 2026-06-03

Scope: bounded slice of the final pre-public checklist item “README is updated and accurate.” This audit only checked whether README local links and image references resolve to tracked workspace paths; it did not validate product claims, screenshots, installation behavior, or external URLs.

## Environment

- Workspace: `/home/jtenner/Projects/jt-ide`
- Date: 2026-06-03
- Tooling: Python 3 via the recurring Agent TODO runner environment

## Command

```sh
python3 - <<'PY'
from pathlib import Path
import re, urllib.parse
p=Path('README.md')
text=p.read_text()
links=[]
for m in re.finditer(r'!??\[[^\]]*\]\(([^)]+)\)', text):
    links.append((m.group(1), m.start()))
for m in re.finditer(r'\b(?:href|src)="([^"]+)"', text):
    links.append((m.group(1), m.start()))
missing=[]
for link,pos in links:
    target=link.split('#',1)[0].strip()
    if not target or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
        continue
    target=urllib.parse.unquote(target)
    if not Path(target).exists():
        missing.append((link, pos))
print(f'checked {len(links)} README links/assets')
if missing:
    print('missing:')
    for link,pos in missing: print(pos, link)
else:
    print('all local README links/assets exist')
PY
```

## Result

```text
checked 28 README links/assets
all local README links/assets exist
```

## Follow-up

The broader README accuracy checklist item remains open. Future slices should validate the README’s product/security claims against current docs and implementation, then validate external badge/workflow URLs once the repository is public or public-like CI evidence exists.
