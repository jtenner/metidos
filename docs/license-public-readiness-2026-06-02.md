# License public-readiness verification — 2026-06-02

## Scope

This note verifies the repository-level license signals needed before making the repository public.

## Findings

- The repository root contains `LICENSE`.
- `LICENSE` contains the Apache License, Version 2.0 text and an applied copyright appendix for `Copyright 2026 Joshua Tenner`.
- Local comparison against `/usr/share/common-licenses/Apache-2.0` found only the expected differences: the local file omits a leading blank line and fills in the copyright appendix.
- `README.md` links to `LICENSE` and describes the project as released under the Apache License, Version 2.0.
- `package.json` now declares the SPDX identifier `Apache-2.0`, matching the repository license file and README badge.

## Validation commands

```sh
head -n 5 LICENSE
python3 - <<'PY'
from pathlib import Path
p = Path('LICENSE').read_text()
print('Apache markers:', all(s in p for s in [
    'Apache License',
    'Version 2.0, January 2004',
    'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION',
]))
PY
if [ -f /usr/share/common-licenses/Apache-2.0 ]; then
  diff -u /usr/share/common-licenses/Apache-2.0 LICENSE | head -n 40
fi
```

## Public repository note

GitHub license detection is based on the repository license file. The checked-in root `LICENSE` is Apache-2.0 compatible, and the package metadata now uses the matching SPDX identifier. After the repository is public, maintainers should still visually confirm the GitHub sidebar displays Apache-2.0 because that final rendering is controlled by GitHub.
