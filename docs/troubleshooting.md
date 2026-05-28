# Troubleshooting

This page lists common Metidos install, runtime, auth, plugin, provider, WebSocket, cron, and issue-reporting problems.

## Start with a clean baseline

From the repository root:

```bash
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
bun install --frozen-lockfile
bun run validate
```

If you only need a local server smoke test:

```bash
bun run dev
# or
bun run start
```

## Install problems

### Bun version mismatch

Symptom: install, typecheck, or runtime behavior differs from docs.

Fix:

1. Read `package.json` `packageManager`.
2. Install that Bun version.
3. Re-run `bun install --frozen-lockfile`.

### Clean clone depends on local state

Symptom: app works on one machine but not from a fresh checkout.

Fix:

- do not copy `.metidos/`, `.metidos-build/`, `node_modules/`, plugin `.data`, app databases, or personal `.env` files,
- copy `.env.example` to `.env`,
- set only the documented placeholders you need,
- run `bun install --frozen-lockfile`.

### Port already in use

Symptom: server cannot bind the configured port.

Fix:

- stop the other process, or
- set `METIDOS_PORT` in private `.env` to another local port.

## Runtime startup problems

### Mainview assets stale or missing

Fix:

```bash
bun run tailwind:build
bun run build:dev
bun run dev
```

For production-style startup, `bun run start` rebuilds assets before starting.

### App Data is not writable

Symptom: Backend reports it cannot find a writable application data directory.

Fix:

- choose a private writable directory,
- set `METIDOS_APP_DATA_DIR=/absolute/path/to/metidos-app-data`,
- ensure the Metidos process owner can create files there.

## Auth problems

### First-run auth cannot complete

Fix:

- ensure browser cookies are allowed for the local origin,
- use the exact origin printed by the server,
- check system time if TOTP fails,
- restart Metidos and retry if setup was interrupted.

### Lost recovery codes or primary factor

Use the auth reset commands documented in [Operator runbook](./operator-runbook.md). Keep in mind that reset operations revoke auth sessions but are not a process supervisor; stop separate terminal or container processes when needed.

### WebSocket asks you to sign in again

Likely causes:

- Session expired or was revoked,
- WebSocket Ticket was stale,
- browser used a different origin than expected,
- reverse proxy did not forward cookies or upgrade headers correctly.

Fix: sign in again, then check origin/proxy settings if it repeats.

## WebSocket and reverse proxy problems

### `/rpc` fails behind a proxy

Check:

- proxy forwards WebSocket upgrade headers,
- browser origin exactly matches `METIDOS_PUBLIC_ORIGIN`,
- additional origins are listed in `METIDOS_ALLOWED_WS_ORIGINS`,
- `METIDOS_TRUST_PROXY=true` is set only when the proxy is trusted and overwrites forwarded headers,
- Backend is started with `bun run start:tls` when operating behind TLS termination.

### Tailscale URL fails

Use the Tailscale DNS name configured as the public origin, not a raw `100.x.x.x` address.

## Provider problems

### No model appears

Check:

- env values are in private `.env`,
- Metidos was restarted after env changes,
- provider plugin is approved and active,
- endpoint is reachable from the process/container,
- plugin diagnostics do not report provider registration errors.

### Provider returns auth or quota errors

Fix:

- rotate or re-enter the provider credential privately,
- check provider dashboard quota/rate limits,
- disable Cron Jobs using that provider until fixed,
- do not paste raw provider errors if they include keys or account identifiers.

## Plugin problems

### Plugin stays Needs Review

This is expected for new or changed source. Open Settings -> Plugins, inspect the manifest/capabilities/review hash, then approve if safe.

### Plugin fails activation

Check:

- folder name matches manifest id,
- `metidos-plugin.json`, `AGENTS.md`, and manifest main file exist,
- no root `node_modules/`,
- registrations in code match manifest declarations,
- required settings/env values are present,
- network/file allowlists are not too narrow for intended behavior.

### Plugin data seems corrupted

Read the plugin's `AGENTS.md` first. Prefer read-only inspection and documented repair. If data is derived or unknown, use Reset Plugin Data rather than hand-editing.

## Cron problems

### Job did not run

Check:

- job is enabled,
- schedule expression is valid,
- next run date is in the future,
- target Project/Worktree is still available,
- scheduler was running,
- model/provider is available.

### Job failed

Open the child Thread, read the final error, verify provider/plugin access, then use Run now after making changes.

## Diff or Thread display problems

For large diffs or transcripts:

- wait for worker-backed parsing/preprocessing to finish,
- try a narrower Thread or smaller diff,
- refresh the worktree view,
- collect sanitized browser console errors if filing an issue.

## Logs and diagnostics

Useful commands:

```bash
bun run audit:log
bun run audit:log -- --json
bun run harness:starvation
bun run benchmark:metidos-tools
```

Logs can contain sensitive local details. Redact before sharing.

## Safe issue report checklist

Include:

- OS,
- Bun version,
- Metidos commit/version,
- command run,
- clean-clone status,
- sanitized `.env` variable names without values,
- reproduction steps,
- expected and actual behavior,
- sanitized logs/screenshots.

Do not include API keys, OAuth tokens, recovery codes, TOTP secrets, cookies, session ids, WebSocket tickets, full `.env`, private repo URLs, local databases, plugin `.data`, or unredacted logs.
