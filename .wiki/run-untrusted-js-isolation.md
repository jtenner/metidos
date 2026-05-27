# Retired Run Untrusted JS Isolation

This page records the retired 2026-04-12 `run_untrusted_js` / vm2 isolation work. Current Metidos no longer exposes a `run_untrusted_js` tool and no longer has `src/bun/vm2-runner*` implementation files in the live tree.

## Current State

- Safe Pi threads do not receive bash.
- Unsafe execution is controlled by thread and cron access policy, not by a vm2 helper tool.
- Project-scoped SQLite access now lives in structured Pi and Plugin System v1 surfaces rather than in a general-purpose untrusted JavaScript sandbox.
- Network-capable behavior is split across explicit access families such as Web Search, WebView, WebServer, plugin network permissions, and provider/plugin host APIs.

The old sandbox page remains useful as a historical record of the kinds of escape hatches that must not be reintroduced if Metidos adds a new untrusted-code execution surface.

## Historical Findings

The 2026-04-12 audit proved that the old vm2-backed helper needed more than a Node `fs` mock. The concrete escape paths were:

- outside-worktree reads through unscoped `Bun.file(...)`,
- outside-worktree SQLite writes through raw `Bun.SQLite`,
- network egress through ambient `fetch(...)`,
- filesystem traversal through unscoped Bun helpers such as `Bun.Glob`.

The immediate hardening work removed or scoped those capabilities before the helper was later retired from the live product path.

## Durable Rules

- Do not add a broad untrusted-code tool without an explicit threat model, path policy, network policy, timeout policy, and regression suite.
- Treat Bun helpers that read files, open databases, walk directories, spawn processes, or reach the network as explicit capabilities.
- Keep safe threads free of ambient host execution. Add narrow structured tools instead.
- Keep SQLite access project- or plugin-scoped, and continue blocking cross-database or extension escape statements.

## Current Verification Surface

Use the current tests when touching nearby boundaries:

- `src/bun/pi/thread-runtime.test.ts` for safe versus unsafe runtime tool policy.
- `src/bun/pi/sqlite-tools.test.ts` for project-scoped SQLite query restrictions.
- `src/bun/plugin/sqlite.test.ts` for Plugin System v1 SQLite path and SQL restrictions.
- `src/bun/pi/web-server/tools.test.ts` and `src/bun/pi/web-server/share.test.ts` for project-scoped hosted-web-server behavior.
- `src/bun/pi/metidos/tools.test.ts` for unsafe child-thread and cron access behavior.

## Related Pages

- [execution-boundary-hardening](./execution-boundary-hardening.md)
- [thread-tool-access-controls](./thread-tool-access-controls.md)
- [sqlite-query-plan-indexes](./sqlite-query-plan-indexes.md)

## Source

- Source note ingested from `docs/2026-04-12-run-untrusted-js-isolation-audit.md` on 2026-04-19.
- Updated on 2026-04-29 to mark the vm2 / `run_untrusted_js` path as retired in current Metidos.
