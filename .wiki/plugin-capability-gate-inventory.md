# Plugin Capability Gate Inventory

Summary: Observed on 2026-05-01, Plugin System v1 capability checks are implemented across many focused host modules under `src/bun/plugin/**` plus Pi tool exposure in `src/bun/pi/plugin-tools.ts`. The current implementation follows the decision ledger, but permission, context, allowlist, confirmation, and startup-only rules are duplicated as local helper functions. A future `PluginCapabilityGate` should centralize rule evaluation without turning thread access groups into host API grants.

## Current state

Observed source-of-truth inputs:

- `docs/metidos-plugin-decisions.md` records the locked Plugin System v1 invariants.
- `src/bun/plugin/manifest.ts` owns the allowed manifest permission enum and cross-field manifest validation.
- `src/bun/plugin/context.ts` owns shared callback context names and common context errors.
- Narrow host modules enforce permissions and context rules immediately before touching host state or host IO.
- `src/bun/plugin/tool-access.ts` and `src/bun/pi/plugin-tools.ts` expose thread-selected plugin tools, but do not grant host API permissions.

## Decision-ledger invariant map

| Decision | Current implementation locations | Notes |
| --- | --- | --- |
| PLUG-001 admin approval is the v1 trust boundary | `plugin/discovery.ts`, `plugin/inventory.ts`, `plugin/lifecycle.ts`, `plugin/sidecar-manager.ts` | Discovery and inventory are side-effect-free; lifecycle approval state controls sidecar startup. Capability checks limit declared operations but do not prove plugin intent. |
| PLUG-002 no UI/backend RPC extensions | `plugin/startup-registrations.ts`, `plugin/quickjs-runtime.ts`, `plugin/sidecar-manager.ts` | Startup registrations validate only tools, crons, model providers, OAuth providers, and notification providers; there is no React injection or plugin-defined backend RPC route surface. |
| PLUG-003 one sidecar per activated plugin | `plugin/sidecar-manager.ts`, `plugin/sidecar-main.ts`, `plugin/sidecar-worker.ts`, `plugin/lifecycle.ts` | The manager tracks ready sessions and failures per plugin. |
| PLUG-004 QuickJS execution | `plugin/plugin-runtime.ts`, `plugin/quickjs-runtime.ts`, `plugin/entrypoint-build.ts`, `plugin/sidecar-main.ts` | QuickJS is the v1 execution boundary; Python adapter code exists separately and should remain a decision-ledger concern before being treated as v1. |
| PLUG-005 typed JSON RPC over stdio | `plugin/sidecar-rpc.ts`, `plugin/sidecar-manager.ts`, `plugin/sidecar-main.ts` | Protocol envelopes, payload limits, correlation ids, cancellation, and diagnostics are host-owned. |
| PLUG-006 no runtime dependency install | `plugin/manifest.ts`, `plugin/inventory.ts`, `plugin/entrypoint-build.ts` | Manifest/discovery validation rejects activation-blocking dependency and import shapes before execution. |
| PLUG-007 `AGENTS.md` required | `plugin/discovery.ts`, `plugin/manifest.ts`, `plugin/inventory.ts`, `plugin/lifecycle.ts` | Required root files and review hashes include operator/agent guidance. |
| PLUG-008 disabled plugins require restart for full removal | `plugin/lifecycle.ts`, `plugin/sidecar-manager.ts`, UI inventory payloads | Disable records restart-required state rather than hot-unregistering capabilities from already-running runtimes. |
| PLUG-009 thread access controls tool visibility only | `plugin/tool-access.ts`, `pi/plugin-tools.ts`, `pi/thread-runtime.ts` | Access groups filter visible tool registrations by `[plugin_id]:[access_id]`; host APIs still receive manifest permissions and run their own checks. |
| PLUG-010 deterministic review hashing excludes mutable data/logs | `plugin/lifecycle.ts`, `plugin/data.ts`, `plugin/log.ts` | Approval hashes include code/config/support files and exclude plugin-owned `.data`, `.data-bak-*`, and `.logs`. |
| PLUG-011 plugin `~/` data is separate from project `./` access | `plugin/fs-path.ts`, `plugin/fs-read.ts`, `plugin/fs-write.ts`, `plugin/sqlite.ts` | `~/` resolves to plugin `.data`; `./` needs thread/project context plus `files:*` permissions and allowlists. SQLite is restricted to `~/`. |
| PLUG-012 first activation seeding is one-shot except reset | `plugin/data.ts`, `plugin/lifecycle.ts` | Seed copy and reset flows are plugin-data lifecycle concerns, not general fs permissions. |
| PLUG-013 logging is local-operator opt-in and separate from stderr | `plugin/log.ts`, `plugin/sidecar-manager.ts`, `plugin/lifecycle.ts` | `metidos.log` requires `log:write` and settings; stderr remains local diagnostics. |
| PLUG-014 provider and notification provider registration are initialization-only | `plugin/plugin-api-runtime.ts`, `plugin/quickjs-runtime.ts`, `plugin/startup-registrations.ts`, `plugin/notifications.ts`, `plugin/model-providers.ts` | Registration APIs require setup/startup context and manifest permissions such as `provider:register` or `notification:provider`; execution contexts invoke already-registered handles. |
| PLUG-015 terminal create/kill require `unsafe`; terminal unavailable in cron | `plugin/terminal.ts`, `plugin/plugin-api-runtime.ts`, `plugin/quickjs-runtime.ts` | `terminal:create` and `terminal:kill` require both operation permission and `unsafe`; terminal operations validate interactive thread context and reject cron where required. |
| PLUG-016 calendar/event delete requires confirmation | `plugin/calendar-events.ts`, `plugin/plugin-api-runtime.ts`, `plugin/quickjs-runtime.ts` | Delete operations require `confirmation`/`confirmed` and fail in cron because confirmation is unavailable. |
| PLUG-017 SQLite is only for plugin `.data` | `plugin/sqlite.ts`, `plugin/fs-path.ts` | `sqlite` requires `sqlite` plus `storage:write`, resolves through the virtual path resolver, denies `./`, and blocks SQL escape statements such as `ATTACH`, `DETACH`, `VACUUM INTO`, and extension loading. |
| PLUG-018 network allowlists are URL boundaries | `plugin/fetch.ts`, `plugin/websocket.ts`, `plugin/network-allowlist.ts`, `outbound-url-security.ts` | Fetch and WebSocket require network permissions, non-empty manifest allowlists, HTTPS/WSS policy by default, per-hop redirect validation, blocked ambient-auth headers, and bounded response/message limits. |
| PLUG-019 secrets are not automatically redacted from plugin-authored output | `plugin/settings.ts`, `plugin/log.ts`, `plugin/notifications.ts`, `plugin/sidecar-manager.ts` | Settings reads redact local secrets where implemented, but logs, tool output, provider output, and notification text are plugin-authored and not globally scrubbed. |
| PLUG-020 model provider identities are stable composite keys | `plugin/model-providers.ts`, `project-procedures/model-catalog.ts`, `pi/thread-runtime.ts` | Provider/model ids are projected as `plugin_id/provider_id/configuration_id/model_id`; missing models are removed rather than synthesized as cached fallback rows. |

## Capability rule clusters

### Manifest permission declarations

Observed implementation: `src/bun/plugin/manifest.ts` defines the permission enum and validates dependency-like requirements, such as `sqlite` needing `storage:write`, terminal create/kill needing `unsafe`, network permissions needing network allowlists, file allowlists needing matching `files:*`, and provider declarations needing provider permissions.

Potential duplication: runtime modules repeat many of these permission checks, which is correct for defense in depth but currently lacks one typed rule catalog that can be tested independently.

### Thread access groups and tool exposure

Observed implementation: `src/bun/plugin/tool-access.ts` normalizes `plugin_id/group_id` access keys, lists active plugin access groups, and filters startup tool registrations. `src/bun/pi/plugin-tools.ts` wraps matching tools as Pi custom tools named `plugin_id_tool_name`.

Invariant: access groups affect agent-visible tool exposure only. They must not be treated as manifest permissions or host API permissions.

### Callback context rules

Observed implementation: `src/bun/plugin/context.ts` centralizes context names and common project-context assertions. Specialized context rules live in host modules:

- `fs-read.ts` and `fs-write.ts` require thread tool context for `./` project paths.
- `calendar-events.ts` requires a local interactive callback context and rejects delete confirmation in cron.
- `terminal.ts` requires interactive thread/project context for create and rejects cron-only contexts for unavailable terminal operations.
- Legacy user-operation adapters have been removed from the supported Plugin System surface; new host APIs should target the local operator model.
- `startup-registrations.ts` and runtime shims keep registration APIs startup-only.

### Filesystem and storage

Observed implementation:

- `fs-path.ts` resolves `~/` and `./`, realpath-checks roots/ancestors, rejects traversal/symlink escapes, hard-denies sensitive project paths, and sanitizes errors.
- `fs-read.ts` enforces `storage:read`; `./` reads additionally require `files:read`, thread/project context, allowlist coverage, denylist exclusion, and post-resolution rechecks.
- `fs-write.ts` enforces storage read/write/delete permissions for all operations and adds matching `files:*` permission, allowlist, denylist, context, and post-resolution checks for `./` operations.
- `data.ts` applies plugin-owned `.data` quotas and seed/reset behavior.

### Network

Observed implementation:

- `fetch.ts` requires `network:fetch`, compiles `network.allow`, validates every redirect hop through `network-allowlist.ts` and `outbound-url-security.ts`, blocks dangerous request headers, applies timeout and body-size limits, and can allow private-network requests only via explicit unsafe context controls.
- `websocket.ts` requires `network:websocket`, compiles `network.webSocketAllow`, blocks ambient-auth/handshake headers, applies WSS policy, and bounds connections, message sizes, queued messages, and receive timing.

### SQLite

Observed implementation: `sqlite.ts` requires `sqlite` and `storage:write`, resolves only `~/` paths through `fs-path.ts`, applies data quota checks, limits result rows/bytes, and blocks cross-database/open-file escape SQL.

### Calendar, notifications, terminal, and providers

Observed implementation:

- `calendar-events.ts` maps each calendar/event operation to an exact permission and enforces local callback context plus delete confirmation.
- `notifications.ts` requires `notification:send`, local callback or cron context, settings/rate-limit controls, and `notification:provider` for provider registration.
- `terminal.ts` maps operations to terminal permissions, requires `unsafe` for create/kill, and validates thread/project context.
- `startup-registrations.ts`, `quickjs-runtime.ts`, and `plugin-api-runtime.ts` require registration permissions and initialization context for crons, model providers, OAuth providers, and notification providers.

## Duplicated checks and missing central rules

Observed duplication:

- Each host API has a local `permissions.includes(...)` helper and local error wording.
- Manifest dependency checks and runtime dependency checks are expressed separately.
- Project `./` filesystem allowlist/denylist logic is implemented in both read and write paths.
- Context-kind checks are partly centralized in `context.ts`, but local-callback, startup-only, cron-prohibited, unsafe, and confirmation-required rules are local to each feature.
- Network fetch and WebSocket independently compile allowlists, block headers, enforce transport policy, and map allowlist errors.
- Terminal, calendar, and startup registration modules each maintain operation-to-permission maps with similar structure.

Missing central rule surface:

- There is no single typed catalog of Plugin System v1 capabilities, required manifest permissions, required callback contexts, operation-specific constraints, and decision-ledger references.
- There is no one invariant test surface that can ask, for example, whether PLUG-015 or PLUG-017 is enforced before host IO for every adapter.
- Runtime prompt/tool exposure and host API permissions are intentionally separate, but the separation is only documented and tested in scattered modules.

## Proposed `PluginCapabilityGate` shape

Recommended target interface in prose:

- Accept an immutable `PluginCapabilitySubject`: `pluginId`, approved manifest summary, declared permissions, network/files policy, lifecycle state, and mutable controls such as notification/log settings or data quota.
- Accept a `PluginCapabilityContext`: callback context kind, local operator id when needed for compatibility-backed storage, project/thread ids, project/worktree roots, confirmation availability, local-operator capability state, and unsafe/private-network flags.
- Accept a typed `PluginCapabilityRequest` union: filesystem read/write/delete/copy/move, network fetch/websocket connect, SQLite open/query, calendar/event operation, notification send/provider registration, terminal operation, startup registration, provider operation, tool exposure, or settings access.
- Return an explicit decision object: `{ allowed, code, permission, contextKind, reason, decisionIds, normalizedPolicy }`, where `normalizedPolicy` can carry compiled allowlists, resolved virtual roots, response limits, or registration limits.
- Keep side effects outside the gate. The gate should decide and normalize; adapters should still perform host IO, path realpathing, SQL execution, network fetches, and lifecycle mutations.
- Preserve defense in depth by using the gate from adapters while keeping adapter-specific validation for request shape and post-resolution rechecks.

Non-goals:

- Do not let thread access groups grant manifest permissions.
- Do not move plugin code execution or sidecar lifecycle into the gate.
- Do not promise semantic data-loss prevention or secret redaction beyond the explicit v1 decisions.

## Suggested adoption order

1. Extract a read-only rule catalog for operation-to-permission and decision-id mapping.
2. Move shared context assertions into gate helpers while preserving existing error codes.
3. Reuse one filesystem policy helper for read/write project allowlist and denylist checks.
4. Add invariant tests that call the gate for PLUG-009, PLUG-011, PLUG-015, PLUG-016, PLUG-017, and PLUG-018 before routing adapters through it.
5. Gradually replace local `permissions.includes(...)` blocks in narrow adapters with gate calls, leaving post-resolution and request-shape checks local.

## Related pages

- [thread-runtime-tool-policy-inventory](./thread-runtime-tool-policy-inventory.md)
- [thread-tool-access-controls](./thread-tool-access-controls.md)
- [execution-boundary-hardening](./execution-boundary-hardening.md)
