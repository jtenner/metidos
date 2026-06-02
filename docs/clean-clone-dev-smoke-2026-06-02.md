# Clean-clone `bun run dev` smoke — 2026-06-02

This note records the public-readiness smoke for `bun run dev` from a disposable checkout with fake local App Data and no provider credentials.

## Environment

- Host OS: Linux (`uname -a` captured during the run; exact kernel recorded in command output below if re-run is needed)
- Workspace: `/home/jtenner/Projects/jt-ide`
- Disposable checkout root: `.metidos/cache/dev-clean-clone-smoke-2026-06-02/checkout` (gitignored)
- Disposable App Data: `.metidos/cache/dev-clean-clone-smoke-2026-06-02/app-data` (gitignored)
- Bun version: `1.3.13`, matching `package.json`
- Ports: `METIDOS_PORT=17613`, `METIDOS_WEB_SERVER_SHARE_PORT=17614`

## Initial finding

The first clean-clone attempt exposed a non-interactive watcher issue:

```bash
git clone --local "$PWD" .metidos/cache/dev-clean-clone-smoke-2026-06-02/checkout
cd .metidos/cache/dev-clean-clone-smoke-2026-06-02/checkout
bun install --frozen-lockfile
METIDOS_APP_DATA_DIR="$PWD/../app-data" \
  METIDOS_PORT=17613 \
  METIDOS_WEB_SERVER_SHARE_PORT=17614 \
  timeout 30s bun run dev
```

Result before the fix: `bun run dev` exited with code `1` because `tailwind:watch` completed its initial build and exited in the non-interactive smoke environment. The dev supervisor correctly treated that child exit as unexpected.

## Fix

`package.json` now passes `--watch=always` for both `tailwind:watch` and `website:watch`, keeping Tailwind's watcher process alive in non-interactive shells. This preserves interactive development behavior while making watcher smoke tests deterministic.

## Post-fix verification

The fixed `bun run dev` path was first verified from the working checkout with disposable App Data:

```bash
METIDOS_APP_DATA_DIR=.metidos/cache/dev-smoke-current-2026-06-02/app-data \
  METIDOS_PORT=17615 \
  METIDOS_WEB_SERVER_SHARE_PORT=17616 \
  timeout 30s bun run dev
```

Result: the command stayed running until the `timeout` sent `SIGTERM` (`124`), which is the expected result for a long-running dev server smoke. The logs included:

```text
Web server share worker listening on http://localhost:17616
Metidos web app listening ... "url":"http://localhost:17615"
[dev] received SIGTERM; stopping children
```

The committed fix was then verified from a disposable clean clone:

```bash
SMOKE_ROOT="$PWD/.metidos/cache/dev-clean-clone-smoke-final-2026-06-02"
mkdir -p "$SMOKE_ROOT"
uname -a >"$SMOKE_ROOT/uname.txt"
git clone --local "$PWD" "$SMOKE_ROOT/checkout"
cd "$SMOKE_ROOT/checkout"
git status --short
bun --version
bun install --frozen-lockfile
METIDOS_APP_DATA_DIR="$SMOKE_ROOT/app-data" \
  METIDOS_PORT=17617 \
  METIDOS_WEB_SERVER_SHARE_PORT=17618 \
  timeout 30s bun run dev
```

Clean-clone result:

- Commit under test: `737d9528055ec2f44405a646b60f574c9c9b0b18`
- OS: `Linux eefe0b53020d 6.12.90+deb13.1-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.12.90-2 (2026-05-27) x86_64 GNU/Linux`
- Bun version: `1.3.13`
- `git status --short`: empty
- `bun install --frozen-lockfile`: passed
- `bun run dev`: reached the local web server and stayed running until the 30-second timeout sent `SIGTERM` (`124`)
- Local URL output: `http://localhost:17617`
- Web server share URL output: `http://localhost:17618`
- Stop method: GNU `timeout` sent `SIGTERM`; the dev supervisor logged `[dev] received SIGTERM; stopping children`

A non-blocking startup warning reported the optional native plugin SQLite security extension artifact was missing for this disposable clone; TypeScript SQL guards remained active and startup continued. The clean-clone dev smoke passed.
