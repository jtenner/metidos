# Security Audit Follow-up: jt-ide

## Summary

- Audit date: 2026-04-03
- Scope: current repository snapshot in `/home/jtenner/Projects/jt-ide`
- Method: static source review of the Bun backend, auth/session transport, Codex integration, sidecar scope controls, task execution paths, and task/worktree filesystem containment
- Overall result: materially improved from the earlier 2026-04-03 audit, but still high risk

## What Looks Fixed Since The Earlier Audit

Compared with `docs/2026-04-03-security-audit.md`, several previously critical issues appear to be addressed in the current code:

- Websocket RPC is no longer unauthenticated. The upgrade now requires a live session cookie plus a short-lived one-time websocket ticket. Evidence:
  - `src/bun/index.ts:1622-1678`
  - `src/bun/rpc-websocket-auth.ts:36-92`
  - `src/bun/auth-service.ts:852-937`
- Browser websocket upgrades now enforce an origin allowlist. Evidence:
  - `src/bun/server-security.ts:96-120`
  - `src/bun/index.ts:1624-1645`
- Worktree file reads and diffs now apply lexical and realpath containment checks before reading from disk. Evidence:
  - `src/bun/git.ts:545-619`
  - `src/bun/git.ts:1078-1171`
- `/health` was reduced to a minimal liveness payload instead of exposing runtime internals. Evidence:
  - `src/bun/server-security.ts:193-200`
  - `src/bun/index.ts:1714-1718`
- The earlier temp-directory fallback for app data no longer appears in `src/bun/db.ts`; the app now fails closed when it cannot find a writable app-data directory. Evidence:
  - `src/bun/db.ts:318-360`

Those are meaningful improvements. The remaining findings below are the highest-risk issues I found in the current code.

## Finding Summary

| Severity | Count | Findings |
| --- | --- | --- |
| High | 3 | Origin-blind auth write endpoints; `.tasks` symlink escape; default Codex network egress with no approval barrier |
| Medium | 2 | Unsafe-mode escalation without fresh auth; sidecar scope is still opt-out |
| Low | 1 | TOTP secret encryption key is stored next to the database |

## Detailed Findings

### 1. High: auth write endpoints are origin-blind and content-type-blind

**What is wrong**

The app now protects `/rpc` websocket upgrades with origin validation, but the HTTP auth mutation endpoints do not enforce the same-origin boundary:

- `src/bun/index.ts:635-889` dispatches all `/auth/*` routes without checking `Origin`, `Sec-Fetch-Site`, or any CSRF token
- `src/bun/index.ts:478-500` accepts any request body that parses as JSON; it does not require `Content-Type: application/json`
- `src/bun/auth-service.ts:45-49` enforces a global lockout after 3 failures for 10 minutes

That combination matters because a hostile website can send cross-origin `POST` requests using a simple `text/plain` body that still contains JSON. The browser will prevent the attacker from reading the response, but it will not prevent the state change.

**Why this matters**

Two concrete attack paths remain:

1. First-run setup poisoning:
   - If the app is not configured yet, a malicious site can `POST /auth/setup` with an attacker-chosen PIN/password, TOTP secret, and matching TOTP code.
   - The attacker does not need `/auth/setup/start`; they can choose their own `totpSecret`.
   - Result: the local app is configured with credentials the user never chose.

2. Forced auth lockout:
   - A malicious site can repeatedly `POST /auth/login` or `/auth/recovery-login` with invalid credentials.
   - After 3 attempts, the app enters the 10-minute global lockout window.
   - Result: repeated availability loss without needing websocket access.

**Impact**

- confidentiality: limited directly
- integrity: moderate
- availability: high

**Recommended fix**

- Reject cross-origin auth mutations:
  - require an allowed `Origin` for every mutating `/auth/*` endpoint
  - also validate `Sec-Fetch-Site` when available
- Enforce `Content-Type: application/json` for JSON endpoints
- Add an anti-CSRF token or same-origin bootstrap token for first-run setup
- Consider refusing all unauthenticated setup/login writes unless they originate from the app’s own loopback origin

### 2. High: `.tasks` file handling still allows symlink escape outside the repository

**What is wrong**

The task-file path resolver only performs lexical containment checks under `.tasks`, then accepts any path that `stat()` reports as a file:

- `src/bun/project-procedures/project-tasks.ts:483-511`
- `src/bun/project-procedures/shared.ts:300-305`

Because `safeIsFile()` uses `statSync()` rather than `lstatSync()`, symlinks are followed. That means a file such as:

- `.tasks/leak.md -> /home/user/.ssh/id_rsa`

passes the resolver even though the final target is outside the repository.

The task runner then reads the resolved file contents and injects them directly into the Codex prompt:

- `src/bun/project-procedures.ts:2975-2986`

Task discovery also follows file symlinks when building the task list:

- `src/bun/project-procedures/project-tasks.ts:156-166`
- `src/bun/project-procedures/project-tasks.ts:169-225`

**Why this matters**

A malicious repository can hide a symlink inside `.tasks` and make it look like a normal task file. If the user runs it, the backend reads an arbitrary local file and hands its contents to Codex. Because normal Codex threads also have outbound network access by default, this becomes an exfiltration path rather than just a local disclosure path.

The same root problem also affects package-task validation:

- `src/bun/project-procedures/project-tasks.ts:517-572`

That path also relies on lexical containment plus `stat()`.

**Impact**

- confidentiality: high
- integrity: low directly
- availability: low directly

**Recommended fix**

- Reject symlinks for `.tasks` files and package `package.json` task targets, or
- resolve `realpath()` for the final target and re-check containment under the intended root
- use `lstat()` when you need to distinguish regular files from symlinks
- apply the same containment rule to both file-backed tasks and package-script task discovery/selection

### 3. High: every Codex thread still has outbound network access and no tool-approval barrier by default

**What is wrong**

The default Codex thread options still grant:

- `approvalPolicy: "never"`
- `networkAccessEnabled: true`

for every thread, even when `unsafeMode` is `false`:

- `src/bun/project-procedures.ts:711-726`

The only difference between normal and unsafe threads is the sandbox mode:

- normal threads: `workspace-write`
- unsafe threads: `danger-full-access`

**Why this matters**

This leaves a large prompt-injection and data-exfiltration surface even after the websocket/auth fixes.

Examples:

- a malicious repository instruction can tell the agent to upload code, config, or secrets to an external service
- a malicious `.tasks` file can cause the agent to exfiltrate task contents
- a compromised or overly-trusting local session can launch web requests without any second confirmation from the runtime

`workspace-write` is not a confidentiality boundary if network egress stays enabled and approval is permanently disabled.

**Impact**

- confidentiality: high
- integrity: moderate
- availability: moderate

**Recommended fix**

- Disable network access by default for ordinary threads
- Require an explicit per-run approval to turn network on
- Treat outbound network access as a privileged capability distinct from filesystem sandbox level
- Reconsider `approvalPolicy: "never"` for any thread that can read repository or task content

### 4. Medium: unsafe mode can be created or enabled without fresh step-up authentication

**What is wrong**

The backend requires step-up auth for:

- deleting a project
- running project tasks
- creating a thread outside the current workspace

Evidence:

- `src/bun/index.ts:328-357`

But it does not require step-up auth to:

- create a thread with `unsafeMode: true` inside the current workspace
- toggle an existing thread into unsafe mode
- continue sending messages to that now-unsafe thread

Evidence:

- `src/bun/index.ts:337-345`
- `src/bun/index.ts:353-364`
- `src/bun/project-procedures.ts:2525-2547`
- `src/bun/project-procedures.ts:3081-3100`

Once enabled, the thread runs with `sandboxMode: "danger-full-access"`:

- `src/bun/project-procedures.ts:721-724`

**Why this matters**

The current step-up model protects some dangerous actions, but not the most consequential privilege escalation inside Codex itself.

That means:

- an already-unlocked session can quietly escalate a thread into `danger-full-access`
- the elevated state persists as thread metadata rather than being limited to one run
- later prompts can use the elevated thread without another authentication checkpoint

**Impact**

- confidentiality: moderate
- integrity: high
- availability: high

**Recommended fix**

- Require fresh step-up authentication to create or enable `unsafeMode`
- Make unsafe mode a one-run capability instead of persistent thread state
- Require an explicit UI gesture before the first prompt sent on an unsafe thread
- Log every unsafe-thread start, not only the toggle event

### 5. Medium: sidecar project isolation is still opt-out rather than enforced

**What is wrong**

The sidecar scope check returns immediately when `allowCrossProject` is set:

- `src/bun/codex-sidecar-scope.ts:56-59`

The `new_thread` tool exposes that bypass directly:

- `src/bun/codex-sidecar-mcp.ts:752-810`

And forwards it into target resolution:

- `src/bun/codex-sidecar-mcp.ts:828-837`
- `src/bun/codex-sidecar-mcp.ts:452-462`

**Why this matters**

This means the sidecar’s project/worktree boundary is advisory, not mandatory. A hostile repository prompt can simply ask the model to set `allowCrossProject=true` and attempt to spawn a new thread in another project/worktree if it knows or can infer the target path or project id.

That is better than the earlier “no boundary at all” state, but it is still not a real containment control.

**Impact**

- confidentiality: moderate
- integrity: moderate
- availability: low

**Recommended fix**

- Remove the tool-level bypass entirely, or
- require an out-of-band user approval before any cross-project sidecar operation
- do not let the model self-attest that cross-project access is intentional
- emit an audit event for every attempted cross-project sidecar action, including denied ones

### 6. Low: TOTP secret encryption is only best-effort because the key lives next to the database

**What is wrong**

The app encrypts the TOTP secret with a locally generated AES key, but the key is stored in the same app-data directory as the SQLite database:

- `src/bun/auth-secrets.ts:21-27`
- `src/bun/auth-secrets.ts:73-94`
- `src/bun/db.ts:733-769`

**Why this matters**

This still protects against accidental plaintext disclosure, but it does not meaningfully protect against an attacker who can already read the app-data directory. In that case the attacker can usually take both:

- `app.db`
- `auth-secret.key`

So the protection mostly collapses to filesystem permissions.

**Recommended fix**

- Prefer OS-backed secret storage where possible
- If that is not practical, document this as best-effort local encryption rather than strong secret isolation
- Keep the key outside the SQLite directory if a stronger local boundary is desired

## Priority Order

If I were sequencing fixes from this audit, I would do them in this order:

1. Add same-origin / CSRF protection plus content-type enforcement to mutating `/auth/*` endpoints.
2. Fix `.tasks` and package-task symlink containment with `realpath` or explicit symlink rejection.
3. Turn off default Codex network access for ordinary threads.
4. Require step-up auth for unsafe-mode creation/toggle and make unsafe privilege temporary.
5. Remove or externally gate `allowCrossProject` in the sidecar.

## Final Assessment

The current codebase is in better shape than the earlier 2026-04-03 audit. The websocket transport, worktree containment, `/health`, and app-data directory handling are all notably stronger.

The remaining risk now comes less from unauthenticated localhost takeover and more from:

- origin-blind auth mutation endpoints
- filesystem escape through symlinked task files
- a very permissive Codex privilege model once a session exists
- sidecar boundaries that are still bypassable by model-controlled inputs

That is a healthier security posture than the prior snapshot, but it is not yet a tight one.
