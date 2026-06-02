# Missing `.env` startup smoke — 2026-06-02

## Scope

This smoke covers the install/setup failure-path TODO for missing `.env` or minimal `.env` behavior. It used a disposable tracked-source checkout with no copied local runtime state and no real provider credentials.

## Environment

- Date: 2026-06-02
- Host OS: Linux `6.12.90+deb13.1-amd64` on x86_64
- Bun: `1.3.13`
- Source revision: `dd1591e`
- Disposable checkout: `.metidos/cache/missing-env-smoke/checkout` (created with `git archive HEAD`; not committed)
- Disposable App Data: `.metidos/cache/missing-env-smoke/app-data-archive` (not committed)
- `.env` in disposable checkout: absent

## Commands

From the repository root:

```bash
rm -rf .metidos/cache/missing-env-smoke/checkout \
  .metidos/cache/missing-env-smoke/app-data-archive
mkdir -p .metidos/cache/missing-env-smoke/checkout \
  .metidos/cache/missing-env-smoke/app-data-archive
git archive HEAD | tar -x -C .metidos/cache/missing-env-smoke/checkout
cd .metidos/cache/missing-env-smoke/checkout

env -i PATH="$PATH" HOME="$HOME" bun install --frozen-lockfile

env -i PATH="$PATH" HOME="$HOME" \
  METIDOS_APP_DATA_DIR="$PWD/../app-data-archive" \
  METIDOS_PORT=17602 \
  timeout 25s bun run start
```

The command intentionally supplied only `PATH`, `HOME`, `METIDOS_APP_DATA_DIR`, and `METIDOS_PORT` to avoid inheriting local provider keys or private `.env` values.

## Result

- `bun install --frozen-lockfile` completed successfully.
- `bun run start` rebuilt Tailwind assets and synced core plugins into the disposable App Data directory.
- Startup exited with status `1` before printing a local URL.
- The final startup message was:

```text
Metidos failed to start: Web server share worker failed before startup completed. Check share host, port, and database availability.
```

## Readability assessment

This smoke did not expose a missing-`.env` parse failure. The available install docs tell contributors to copy `.env.example` to `.env`, and they document defaults such as the OS App Data location when `METIDOS_APP_DATA_DIR` is omitted. In this disposable no-`.env` run, startup advanced far enough to build assets and sync plugins, which suggests the missing file itself is not the immediate failure.

However, the observed web-server share-worker failure is not enough for a first-time contributor to recover from this exact startup path. The message mentions share host, port, and database availability, but it does not identify the concrete setting, port, database path, log location, or next command to try.

## Follow-up

Resolved in a follow-up slice: share-worker startup failures now include the resolved share host, share port, database path, and underlying worker startup error in the top-level startup exception. A contributor who hits this no-`.env` path should be able to identify whether the recovery action is changing `METIDOS_WEB_SERVER_SHARE_PORT`, changing `METIDOS_WEB_SERVER_SHARE_HOST`, or fixing App Data/database access.
