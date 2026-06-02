# Security-sensitive error message audit — 2026-06-02

This note records a bounded repository-readiness slice for checking whether security-sensitive errors are actionable without exposing secrets or sensitive local paths.

## Scope

Reviewed high-risk Backend patterns that could expose secrets, tokens, API keys, or local filesystem paths through error strings:

- `throw new Error(...)` constructors in `src/bun/**/*.ts` containing path-, token-, secret-, key-, password-, authorization-, file-, directory-, or environment-related terms.
- `console.error` / `console.warn` / `console.log` calls in `src/**/*.ts` containing similar sensitive terms.
- Backend propagation of `error.message` into RPC/log-style payloads for follow-up review.

Commands used:

```sh
grep -R "throw new Error([^\n]*(path|Path|process\.env|token|secret|key|password|Authorization|HOME|cwd|dir|file)" src/bun --include='*.ts'
grep -R "console\.(error|warn|log)([^\n]*(process\.env|token|secret|key|password|Authorization|path|Path)" src --include='*.ts'
grep -R "message:.*(path|Path|token|secret|key|password|Authorization)|errorMessage|error\.message" src/bun --include='*.ts'
```

## Findings

- Workspace path policy intentionally uses stable, mostly generic user-facing messages. The existing policy note in `.wiki/workspace-path-policy-invariants.md` documents which strings intentionally include display paths and why Mainview depends on them.
- Plugin filesystem and plugin data errors mostly report virtual paths or generic policy failures (`~/`, `./`, traversal denied, outside allowed root) instead of resolved host paths.
- Provider plugin guidance in `core_plugins/*/AGENTS.md` consistently forbids logging API keys, authorization headers, prompts, request payloads, and model responses; that remains a policy constraint for future plugin edits.
- One Backend store error included the raw Project path after an impossible-looking upsert/readback mismatch. Even though the failure is exceptional, the raw local path is not needed for the user-facing message and could leak a sensitive local path if propagated through RPC/log surfaces.
- Follow-up review of `src/bun/index.ts` direct `error.message` serialization found the intentionally user-facing paths: auth route `AuthServiceError` and `RequestValidationError` payloads, RPC `AuthServiceError` payloads, RPC `WorkspacePathError` payloads, and plugin error mapping. `RequestValidationError` messages are static validation strings, `WorkspacePathError` messages are governed by `.wiki/workspace-path-policy-invariants.md`, and plugin errors are already collapsed to public messages plus virtual paths/codes. The unsafe auth-secret exception path was `AuthSecretAccessError` being mapped into `AuthServiceError` with a raw `auth-secret.key` path, which then flowed through auth HTTP/RPC payloads.

## Change made

- `src/bun/project-store.ts` now reports `Failed to upsert project record.` instead of interpolating the raw Project path in the upsert/readback failure.
- `src/bun/auth/secret-errors.ts` now maps low-level `AuthSecretAccessError` values to a stable browser-facing `auth_secret_unavailable` message instead of forwarding the raw local `auth-secret.key` path through `AuthServiceError.message`.
- Pi web-server tool path errors now avoid echoing outside-project absolute paths; in-project missing/type errors report only the project-relative display path.
- Pi Git/file path containment errors now use a stable `current worktree` message instead of interpolating the raw worktree path or rejected path. Normal successful Git tool output still returns repository-relative paths and Git stderr where useful, which is acceptable inside the project-bound agent runtime because commands are scoped to the active worktree and do not include provider secrets or callback tokens.

## Remaining review slices

The broad release-readiness task is not fully complete. Future slices should inspect and, where needed, fix or explicitly document:

1. Terminal and worker startup errors that include configured executable or hosted paths.
2. Plugin sidecar/runtime error propagation to ensure host paths, callback tokens, and provider secrets are redacted before display.
