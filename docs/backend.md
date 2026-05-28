# Backend

The Backend is the Bun server layer under `src/bun/`. It owns HTTP startup, RPC handling, persistence, auth, project/worktree operations, Pi runtime orchestration, plugins, cron execution, terminal sockets, share workers, and diagnostics.

## Runtime assumptions

- Runs with Bun matching `package.json` `packageManager`.
- Reads private configuration from environment variables and `.env` during `bun run ...`.
- Stores durable local state in App Data, not in the source checkout.
- Serves Mainview assets and WebSocket RPC from the same local server.
- Treats the Local Operator as the authenticated owner of one installation.

## Entrypoints and scripts

Common scripts:

```bash
bun run dev                 # build assets, sync core plugins, run dev supervisor
bun run start               # build assets, sync core plugins, start Backend
bun run start:tls           # Backend mode for trusted reverse-proxy TLS
bun run start:telemetry     # start with local runtime telemetry sidecar
bun run validate            # formatting/style/type/test validation
bun run auth:reset          # Local Auth maintenance commands
bun run audit:log           # inspect security audit events
```

Key entrypoints:

- `src/bun/index.ts` — Bun server bootstrap, route wiring, runtime configuration, and long-lived services.
- `src/bun/start.ts` — package-script bootstrap for production-style starts.
- `src/bun/dev-supervisor.ts` — local development supervisor.
- `src/bun/build-mainview.ts` — Mainview bundling.
- `src/bun/project-procedures.ts` and `src/bun/project-procedures/**` — product RPC procedures.
- `src/bun/rpc-transport.ts` — WebSocket request lifecycle, cancellation, push fanout, backpressure, and metrics.

## App Data layout

App Data is resolved from `METIDOS_APP_DATA_DIR` or the OS default. It contains private runtime state such as:

- `app.db` and SQLite sidecar files,
- auth secrets, TOTP material, sessions, and recovery-code state,
- Pi runtime sessions,
- plugin installations under `plugins/`,
- plugin `.data/`, `.logs/`, and reset backups,
- local settings,
- optional telemetry sidecar databases.

Backend-created App Data directories use owner-only permissions where POSIX chmod semantics are available.

Do not commit App Data, copied database files, auth files, telemetry files, plugin `.data`, or plugin `.logs`.

## RPC surfaces

The typed RPC schema is rooted at `src/bun/rpc-schema.ts` and split into focused files under `src/bun/rpc-schema/`. Backend handlers expose operations for:

- app bootstrap and model catalog loading,
- project and worktree lifecycle,
- Thread creation, status, messages, and metadata,
- Git history and diff retrieval,
- cron create/update/list/run-now,
- plugin inventory, settings, review, approval, data reset, and ingress routing,
- notifications and calendars,
- terminal sessions and terminal WebSocket access,
- runtime settings.

Mainview connects through `/rpc`. The Backend requires an authenticated WebSocket ticket and revalidates the Session for each non-terminal RPC message.

See [RPC](./rpc.md).

## Auth and sessions

Backend Local Auth covers:

- first-run setup,
- primary factor verification,
- TOTP enrollment and verification,
- recovery codes,
- Session creation and expiration,
- step-up authentication for sensitive plugin actions,
- WebSocket ticket issuance for `/rpc`,
- security audit events for privileged maintenance.

Step-up authentication is intentionally narrower than full admin mode. It is used for actions that approve or run plugin code, such as Enable, Re-approve, Retry Plugin, and Run Plugin GC.

## Workspace path scope

The Backend normalizes and authorizes project/worktree paths. It should remain the authority for:

- opening projects and worktrees,
- directory suggestions,
- resolving worktree-bound tool paths,
- plugin filesystem access to `./`,
- refusing traversal and symlink escapes,
- avoiding sensitive host path leaks in user-visible errors.

## Pi runtime responsibilities

The Backend adapter around Pi:

- opens or creates deterministic Pi sessions for Threads,
- resolves provider-qualified model IDs,
- builds the allowed tool surface from Access Control,
- applies Safe Mode and Unsafe Mode policy,
- installs native tools such as Git, GitHub, SQLite, LanceDB, web server, agents, threads, crons, calendars, and notifications according to permissions,
- installs plugin tools from approved active sidecars and selected access groups,
- streams messages, status, tool calls, and Pi extension UI events back to Mainview.

## Plugin runtime responsibilities

Backend plugin modules own discovery, inventory, lifecycle, settings, storage, filesystem, fetch, websocket, SQLite, sidecar protocol, sidecar manager, startup registrations, registered capabilities, model-provider registration, notification delivery, embedding, ingress, prompt injection, and tool access.

The important invariant is that discovery and inventory must not execute plugin code. Approved sidecars run only after manifest validation and operator approval of the current review hash.

## Cron responsibilities

Backend cron modules store Cron Job definitions, sync the scheduler sidecar, and run due jobs as child Threads. `runCronNow` uses the same child-thread execution path but is triggered manually.

Cron mutations should invalidate or refresh the Mainview cron workspace and update the scheduler registration.

## Diagnostics and telemetry

Backend runtime stats track request timings, websocket pushes, SQLite retry loops, cron queue pressure, tool calls, cache counters, and selected pressure signals. Optional telemetry writes coarse snapshots to a local sidecar SQLite database.

Diagnostics must stay low-cardinality and should not include secrets, recovery codes, session tokens, provider keys, or private file contents.

## Validation commands

For Backend code changes:

```bash
bun run typecheck
bun run test
bun run validate
```

For narrower checks:

```bash
bun test src/bun/path/to/file.test.ts
bun run toml:check
bun run audit:log
```

Use `bun run validate` before publishing changes that affect runtime behavior, RPC contracts, auth, plugins, cron, or provider configuration.
