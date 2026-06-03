# Clean-clone `bun run start` smoke plan — 2026-06-03

This note defines the command-ready smoke plan for the public-readiness task: verify `bun run start` works from a clean clone after documented setup only.

## Current execution blocker

This workspace runtime is not suitable for recording final start-smoke evidence yet:

- `bun --version` currently prints `1.3.13`.
- `package.json` declares `packageManager: bun@1.3.14`.

Do not refresh install/start evidence from this runtime until Bun matches the repository requirement. The commands below are ready for a clean machine, clean checkout/worktree, CI runner, or disposable container with Bun `1.3.14` selected.

## Scope

Verify the production-style local run path from tracked source plus documented setup only:

- clone the repository into a disposable location;
- install dependencies with the documented frozen-lockfile command;
- create only the documented placeholder `.env` file;
- use a disposable App Data directory outside the checkout;
- run `bun run start` long enough to confirm the local URL is printed and the server remains alive;
- stop it with a controlled signal;
- record sanitized evidence.

This plan does not verify browser first-run Local Auth, provider setup, Project/Worktree creation, or Diff review. Those have separate smoke-plan TODOs.

## Safe evidence rules

Record only safe metadata:

- OS and runner/container identity at a high level;
- Bun version;
- commit SHA under test;
- exact commands;
- local loopback URL and port;
- pass/fail status;
- stop method and exit code;
- teardown confirmation;
- any user-visible error summaries.

Do not record `.env` secrets, App Data contents, cookies, WebSocket tickets, TOTP seeds, recovery codes, private project paths, provider credentials, hostnames beyond disposable/loopback values, or screenshots containing private values.

## Command sequence

Run from a directory that can contain disposable test output:

```bash
SMOKE_ROOT="$PWD/.metidos/cache/clean-clone-start-smoke-2026-06-03"
rm -rf "$SMOKE_ROOT"
mkdir -p "$SMOKE_ROOT"

uname -a | tee "$SMOKE_ROOT/uname.txt"
bun --version | tee "$SMOKE_ROOT/bun-version.txt"

git clone --local /path/to/metidos "$SMOKE_ROOT/checkout"
cd "$SMOKE_ROOT/checkout"

git rev-parse HEAD | tee "$SMOKE_ROOT/commit.txt"
git status --short | tee "$SMOKE_ROOT/status-before-install.txt"
node -e "const p=require('./package.json'); console.log(p.packageManager)" | tee "$SMOKE_ROOT/package-manager.txt"

bun install --frozen-lockfile 2>&1 | tee "$SMOKE_ROOT/bun-install.log"
cp .env.example .env

METIDOS_APP_DATA_DIR="$SMOKE_ROOT/app-data" \
  METIDOS_PORT=17621 \
  METIDOS_WEB_SERVER_SHARE_PORT=17622 \
  timeout 45s bun run start 2>&1 | tee "$SMOKE_ROOT/start.log"
START_STATUS=${PIPESTATUS[0]}
echo "$START_STATUS" | tee "$SMOKE_ROOT/start-exit-status.txt"
```

Expected `START_STATUS` is `124` when GNU `timeout` stops a healthy long-running server after 45 seconds. If `bun run start` exits before the timeout, record the exit code, visible error, and whether the message includes next-step guidance.

## Pass criteria

The smoke passes when all of these are true:

- `bun --version` matches `package.json`'s `packageManager` version.
- The clean clone reports no tracked or untracked changes before install.
- `bun install --frozen-lockfile` succeeds.
- `bun run start` builds Mainview assets, syncs core plugins, starts the Bun Backend, and prints a localhost URL.
- The process remains alive until the timeout sends `SIGTERM`.
- Shutdown is controlled; logs do not show secret values.
- Disposable App Data and checkout paths are removed or left only under ignored cache directories.

## Evidence note template

After running the smoke, commit a dated evidence note with:

```markdown
# Clean-clone `bun run start` smoke — YYYY-MM-DD

## Environment

- OS/runner:
- Commit under test:
- Bun version:
- Disposable checkout:
- Disposable App Data:
- Ports:

## Commands

<sanitized exact commands>

## Outcome

- `git status --short` before install:
- `bun install --frozen-lockfile`:
- `bun run start`:
- Local URL output:
- Stop method / exit code:
- Teardown:

## Follow-ups

- None, or list documentation/code fixes with exact paths.
```
