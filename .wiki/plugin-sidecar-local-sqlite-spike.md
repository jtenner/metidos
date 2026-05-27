# Plugin Sidecar-Local SQLite Spike

Date: 2026-05-02
Task: `tg-01kqn6dm922zhgfe5qjdsgjd13`

## Decision

Defer sidecar-local SQLite execution for now. Keep plugin SQLite operations maincar-mediated until the sidecar can receive a complete, revocable data-scope snapshot plus a quota/lock protocol that is shared with storage operations.

The current code is intentionally centralized in `src/bun/plugin/sqlite.ts`, and that central point is doing more than query dispatch: it validates manifest permissions, resolves `~/` paths through the approved plugin installation path, rejects non-plugin-data SQLite targets, applies SQL safety rules, loads the optional native security extension, caps result size, and checks plugin data quota after every operation.

## Current SQLite Path

Observed call chain:

- `src/bun/plugin/plugin-api-runtime.ts` exposes `metidos.sqlite(path)` to JS plugins and dispatches `sqlite.all`, `sqlite.get`, and `sqlite.run` through `globalThis.__metidosHostSqliteOperation`.
- `src/bun/plugin/quickjs-runtime.ts` installs `__metidosHostSqliteOperation` and delegates to the runtime `pluginApi.sqlite` callback without exposing host filesystem paths to plugin code.
- `src/bun/plugin/python-runtime.ts` builds the same operation model in `createSqliteBridge(...)`, validates operation names with `isPluginSqliteOperation(...)`, and delegates to `options.pluginApi.sqlite(...)`.
- `src/bun/plugin/sidecar-main.ts` checks `isPluginSqliteOperation(...)`, runs the sidecar capability gate, and forwards permitted operations to the host over sidecar RPC.
- `src/bun/plugin/sidecar-manager.ts` performs the maincar-side capability check and executes `executePluginSqliteOperation(...)`.
- `src/bun/plugin/sqlite.ts` owns permission checks, path resolution, statement validation, execution, result normalization, result caps, native security extension loading, and quota enforcement.

Supported operations are exactly:

- `sqlite.all` — SELECT/WITH-only read path with a 1,000-row cap and approximate 1 MiB result cap.
- `sqlite.get` — single-row statement path.
- `sqlite.run` — write-capable statement path.

All operations require both `sqlite` and `storage:write`, and all SQLite database paths must resolve to plugin `~/` data paths. `:memory:`, `file:` URIs, bare `~`, bare `~/`, and project `./` paths are rejected.

## Tests Affected

Relevant existing coverage:

- `src/bun/plugin/sqlite.test.ts` covers `executePluginSqliteOperation(...)` path scope, required permissions, traversal/symlink rejection, row caps, quota checks, and blocked attach/write statements.
- `src/bun/plugin/capability-gate.test.ts` covers sidecar capability decisions for SQLite `~/` plugin-data scope and rejection of project paths.
- `src/bun/plugin/quickjs-runtime.test.ts` covers JS `metidos.sqlite(...)` host dispatch shape and callback metadata for thread and cron contexts.
- Python parity is covered through `src/bun/plugin/python-runtime.ts` bridge semantics and should get dedicated regression tests if SQLite execution moves into the sidecar.

Any implementation that moves execution local to the sidecar would need to keep these tests passing and add concurrent sidecar/lifecycle/quota-race tests.

## Sidecar-Local Eligibility

Only `~/` plugin-data SQLite databases are even candidates for local execution. There is no safe candidate for project paths, arbitrary file URIs, or in-memory handles because the public contract deliberately scopes SQLite to plugin-owned persisted data.

Even for `~/` paths, local execution should not mean plugin code gets raw filesystem authority. The sidecar would need an internal host-provided data-root capability and must keep the plugin API virtual-path-only.

## Permission And Path Requirements

Sidecar-local execution can preserve current permission semantics only if startup or per-operation state includes:

1. the exact approved plugin installation path;
2. the resolved plugin data root, not a caller-controlled path;
3. the active permission set containing both `sqlite` and `storage:write`;
4. enough manifest/context state to deny operations after disable, reset, reinstall, or permission changes; and
5. the same virtual-path resolver semantics as `resolvePluginFsVirtualPath({ access: "write" })`.

A stale permission snapshot is the main correctness risk. The current maincar path naturally observes lifecycle changes because every operation crosses the host boundary.

## Quota, WAL, Journal, And GC Implications

`executePluginSqliteOperation(...)` currently combines two quota mechanisms:

- `PRAGMA max_page_count` limits database page growth while the database handle is open.
- `calculatePluginDataQuotaUsage(...)` checks aggregate plugin `.data` bytes, file count, and largest file after each operation.

Local sidecar execution would need equivalent aggregate quota enforcement across the database file plus SQLite-created side files such as WAL, SHM, rollback journal, and temporary files. Page-count limits alone are not sufficient because plugin data quota is directory-wide and file-count-aware.

The design also needs a shared answer for storage deletes/moves while a database is open. If normal plugin filesystem operations remain maincar-mediated while SQLite becomes local, the quota and GC boundary splits across two processes and can become inconsistent.

## Concurrency Implications

SQLite itself can coordinate multiple connections, but Metidos still needs product-level lifecycle safety. Potential concurrent actors for the same plugin include:

- multiple thread tool callbacks;
- cron runs;
- notification providers;
- model providers;
- sidecar restarts during long-lived plugin activity; and
- plugin disable/reset/reinstall while work is queued or active.

The current implementation opens and closes a `Database` per operation in the maincar. Moving execution into each sidecar introduces cross-process handles for the same plugin data path. That may be acceptable after explicit busy-timeout/WAL policy and lifecycle locking, but it should be designed alongside sidecar-owned storage I/O rather than as an isolated SQLite special case.

## Expected Performance Benefit

The likely benefit is reducing one sidecar RPC round trip per SQLite call and removing synchronous maincar filesystem/SQLite work from high-frequency plugin callbacks. This helps only plugins that issue many small SQLite operations. It is unlikely to dominate overall latency for coarse callbacks or large queries, where SQLite execution and result transfer still cost more than dispatch.

Because `sqlite.all` result payloads still cross from sidecar/runtime back to the caller, sidecar-local execution primarily improves dispatch overhead, not result serialization overhead.

## Risks

- stale sidecar permission or lifecycle snapshots after plugin disable/reset/reinstall;
- quota drift between SQLite-created files and maincar-owned storage operations;
- inconsistent deletion/GC behavior while a sidecar has an open database handle;
- duplicated SQL/path/security logic between maincar and sidecar bundles;
- native SQLite security extension loading differences between maincar and sidecar process environments;
- harder incident response if plugin data writes no longer pass through one host execution point.

## Recommendation

Do not implement sidecar-local SQLite as an immediate standalone optimization.

Proceed only after the broader sidecar-local filesystem work defines a shared data-root capability, quota accounting protocol, lifecycle locks, and revocation behavior. At that point SQLite can reuse the same sidecar-local storage authority and should move as a package with plugin-owned `~/` filesystem operations.

Minimum constraints if revisited:

- sidecar-local SQLite remains limited to `~/` plugin data paths;
- JS/Python plugin APIs continue to expose only virtual paths;
- operation support remains `sqlite.all`, `sqlite.get`, and `sqlite.run` unless the public API is revised;
- the sidecar and maincar share one implementation or generated contract for path, SQL, result, and quota validation;
- quota checks account for DB, WAL, SHM, journal, temp files, aggregate bytes, largest file, and file count;
- plugin disable/reset/reinstall obtains maincar-owned lifecycle locks before local DB opens continue;
- validation includes concurrent sidecar sessions for one plugin and storage delete/move races.

## Follow-Up

No new implementation task is created from this spike. The existing parent-sidecar work should absorb SQLite only after sidecar-local storage authority and quota/lifecycle controls exist.
