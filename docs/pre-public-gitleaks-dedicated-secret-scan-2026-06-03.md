# Pre-Public Gitleaks Dedicated Secret Scan - 2026-06-03

## Scope

This note records the dedicated scanner pass for the pre-public secret-scan checklist item.

The earlier `docs/pre-public-secret-scan-2026-06-03.md` note covered available Git/ripgrep pattern scans. This slice added a dedicated scanner run using Gitleaks against:

- Git history for the repository.
- The current tracked working tree, copied from `git ls-files` so current tracked modifications were included while ignored local secrets/caches were excluded from repository-publication evidence.

No secret values, environment-file contents, cookies, tokens, or unredacted scanner reports are committed in this evidence note.

## Environment

- Date/time: 2026-06-03T10:24:00Z to 2026-06-03T10:26:00Z
- OS: Debian GNU/Linux 13 (trixie)
- Worktree: `/home/jtenner/Projects/jt-ide`
- Git branch: `master`
- Scanner: Gitleaks `8.30.1`, downloaded into untracked `.metidos/cache/gitleaks-8.30.1/` from the official GitHub release archive for this one-off scan

The workspace already had unrelated tracked modifications before this slice began. They were not staged or committed by this evidence update.

## Commands

```sh
mkdir -p .metidos/cache/gitleaks-8.30.1
cd .metidos/cache/gitleaks-8.30.1
wget -q -O gitleaks.tar.gz \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
tar -xzf gitleaks.tar.gz
./gitleaks version
```

Observed scanner version:

```text
8.30.1
```

Git-history scan:

```sh
.metidos/cache/gitleaks-8.30.1/gitleaks git \
  --no-banner \
  --redact \
  --report-format json \
  --report-path .metidos/cache/secret-scan-2026-06-03-1024/gitleaks-git.json \
  .
```

Tracked working-tree scan:

```sh
rm -rf .metidos/cache/secret-scan-2026-06-03-1024/tracked-working-tree
mkdir -p .metidos/cache/secret-scan-2026-06-03-1024/tracked-working-tree
git ls-files -z |
  tar --null -T - -cf - |
  tar -xf - -C .metidos/cache/secret-scan-2026-06-03-1024/tracked-working-tree

.metidos/cache/gitleaks-8.30.1/gitleaks dir \
  --no-banner \
  --redact \
  --report-format json \
  --report-path .metidos/cache/secret-scan-2026-06-03-1024/gitleaks-tracked-working-tree.json \
  .metidos/cache/secret-scan-2026-06-03-1024/tracked-working-tree
```

## Results

### Git history

Gitleaks scanned 582 commits and reported 6 findings, all under the `generic-api-key` rule:

- 3 findings in `src/bun/auth/index.test.ts` on hard-coded RFC/TOTP test-vector values used by authentication tests.
- 3 findings in `native/sqlite-security-extension/src/sqlite3ext.h` on SQLite extension API macro names such as `sqlite3_api->...`.

Classification: **false positives**. No real secret material was identified in Git history by this dedicated scanner pass.

### Tracked working tree

Gitleaks scanned the copied tracked working tree and reported 6 findings, all under the `generic-api-key` rule:

- 3 findings in `src/bun/auth/index.test.ts` on hard-coded RFC/TOTP test-vector values used by authentication tests.
- 3 findings in `native/sqlite-security-extension/src/sqlite3ext.h` on SQLite extension API macro names such as `sqlite3_api->...`.

Classification: **false positives**. No real secret material was identified in tracked repository files by this dedicated scanner pass.

### Ignored local artifacts

A broader exploratory `gitleaks dir .` scan also saw ignored local files/caches, including `.metidos/cache/**`, `.tmp*`, and ignored Podman `.env.*` files. Those artifacts are excluded by `.gitignore` and were not used as repository-publication evidence. Their contents and reports were not committed.

## Outcome

The dedicated scanner requirement for the public-repository secret-scan checklist is satisfied for tracked repository files and Git history.

No repository changes, credential rotation, or history rewrite were required from this scan because the tracked/history findings were classified as false positives and no real tracked or historical secret was identified.
