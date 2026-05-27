# Project Procedures Responsibility Map

Summary: `src/bun/project-procedures.ts` is the backend RPC procedure hub. Updated on 2026-05-09, it remains the application-service boundary for Mainview RPC calls, Metidos tool-host callbacks, and runtime lifecycle hooks, while more focused helpers now live under `src/bun/project-procedures/`. The best split is not by current line order alone; it is by the invariants each group must preserve.

## Current state

Observed files:

- `src/bun/project-procedures.ts` owns the public procedure exports consumed by `src/bun/index.ts`, Metidos tool-host callbacks, cron runner tests, and direct backend tests.
- `src/bun/project-procedures/` already contains extracted support modules for auth context, calendar procedures, client logs, command normalization, directory suggestions, Git history caching, model catalog and model-catalog cache, plugin and plugin-ingress procedures, Pi event projection, Pi SDK shape helpers, Pi session telemetry, project skills, project worktrees, thread activity persistence, thread-detail helpers, thread runtime lifecycle, thread turn runner, and shared utilities.
- `src/bun/index.ts` maps websocket/RPC method names to `*Procedure` exports. This makes `project-procedures.ts` the application-service boundary for mainview calls.

The file has two broad regions:

1. A top procedure section that wraps store modules directly: auth, listing, model catalog, plugins, calendar, notifications, and bootstrap.
2. A large stateful orchestration section for projects, worktrees, threads, Git caches, Pi runtimes, cron creation/update/run-now, terminals, activity persistence, polling, and listener wiring.

## Responsibility groups

### Auth and workspace path scope

Current owners: local-operator auth helpers, `requireUnsafeModeAllowed`, `workspacePathScopeForContext`, `assertWorkspacePathAllowed`, app-owned project/thread/cron visibility helpers, and related path-format helpers.

Responsibilities:

- Derive local-operator context from `RpcRequestContext`.
- Enforce the local workspace policy for interactive callers.
- Filter projects, worktrees, threads, and cron jobs by local-installation visibility.
- Keep path errors safe by formatting paths relative to the allowed workspace root where possible.

Movement map: continue extracting toward an `access-scope` service before moving the remaining tightly coupled procedure groups. Most other groups depend on these helpers, so this remains the first missing seam.

### Bootstrap, local settings, and lightweight listing

Current exports include `getHomeDirectoryProcedure`, `getAppBootstrapProcedure`, `getModelCatalogProcedure`, terminal/timezone settings procedures, `listProjectsProcedure`, `listThreadsProcedure`, and `listThreadStatusesProcedure`.

Responsibilities:

- Provide initial app bootstrap data.
- Handle bootstrap and local-operator settings reads needed before heavier views load.
- Resolve model/provider catalog state.
- Return visible projects, threads, and thread statuses without opening worktrees.
- Read and write terminal/timezone settings.

Movement map: split any remaining inline bootstrap/settings logic into `bootstrap-procedures.ts` and `settings-procedures.ts`; keep model catalog calls behind the existing `model-catalog.ts` and `model-catalog-cache.ts` modules.

### Project and worktree orchestration

Current exports include `openProjectProcedure`, `openProjectsBatchProcedure`, `listProjectWorktreesProcedure`, `createWorktreeProcedure`, `setWorktreePinnedProcedure`, `openWorktreeProcedure`, `openWorktreesBatchProcedure`, `getWorktreeSnapshotProcedure`, `setActiveWorktreeProcedure`, `focusContextProcedure`, `closeWorktreeProcedure`, `closeProjectProcedure`, `deleteProjectProcedure`, `getOpenWorktreeSnapshot`, polling controls, and Git-history read/diff procedures.

Responsibilities:

- Normalize, authorize, create, open, close, and delete project/worktree paths.
- Reconcile primary worktree metadata with Git worktree state.
- Maintain open-worktree polling state and foreground-read pressure.
- Serve worktree snapshots, file pages, file diffs, Git history pages, commit diffs, and active-worktree focus updates.
- Coordinate cache invalidation for project/worktree changes.

Movement map: extract to `project-worktree-procedures.ts` plus a narrower `worktree-polling-service.ts`. Git history RPC wrappers should sit near `project-procedures/git-history.ts`; snapshot/file/diff wrappers should sit near Git access helpers.

### Thread lifecycle and Pi runtime orchestration

Current exports include `createThreadProcedure`, `requestThreadStartProcedure`, `approveThreadStartRequestProcedure`, `getThreadProcedure`, `sendThreadMessageProcedure`, `stopThreadTurnProcedure`, `renameThreadProcedure`, `updateThreadMetadataProcedure`, `setThreadPinnedProcedure`, `updateThreadModelProcedure`, `updateThreadReasoningEffortProcedure`, `updateThreadAccessProcedure`, `deleteThreadProcedure`, `discardEmptyThreadProcedure`, `shutdownActiveThreadTurns`, `notifyContextFocusChangedForThread`, `onThreadRunSettled`, listener setters, and Pi extension UI procedures.

Responsibilities:

- Normalize thread access controls and permission strings.
- Create, rename, pin, delete, and discard threads.
- Start direct or approval-gated thread turns.
- Manage per-thread Pi runtime instances, abort controllers, completion promises, run statuses, and session-state sync.
- Persist projected assistant/user/tool activities and invalidate thread-detail caches.
- Bridge extension UI messages/editor updates.

Movement map: extract to `thread-procedures.ts` with sub-services for `thread-runtime-registry.ts`, `thread-turn-orchestrator.ts`, and `thread-activity-writer.ts`. Preserve `src/bun/index.ts` RPC names while moving implementations.

### Cron procedures

Current exports include `newCronProcedure`, `updateCronProcedure`, `runCronNowProcedure`, `listCronsProcedure`, `setCronJobsChangeListener`, and cron-related Metidos tool-host callbacks.

Responsibilities:

- Create/update/list soft-deletable cron jobs visible in the current local installation.
- Resolve thread access permissions for scheduled thread runs.
- Enforce unsafe-mode policy when cron creation or updates request unsafe execution.
- Stop active cron job runs when cron jobs are updated or removed.

Movement map: extract to `cron-procedures.ts`. It should depend on the same thread access-control resolver as thread creation, rather than duplicating permission normalization.

### Calendar and notifications

Current exports cover calendar bootstrap, occurrence listing, calendar/event CRUD, shared calendars, external ICS calendars, notification settings, listing, dismiss, and snooze. `createPiMetidosToolHost` also routes calendar tool calls back through these procedures.

Responsibilities:

- Require an authenticated local operator for calendar changes.
- Normalize occurrence windows and reminder delivery inputs.
- Bridge local calendar store operations and external ICS refresh.
- Send plugin-backed notifications when the listener is installed.

Movement map: extract to `calendar-procedures.ts` and keep notification sending in a small `notification-procedures.ts` adapter shared by calendar and plugin notification paths.

### Plugin inventory, settings, lifecycle, and tool host

Current exports include plugin inventory/settings procedures, access-group listing, lifecycle/local-operator action procedures, `setPiPluginSidecarManager`, `createPiToolRequestContext`, and `createPiMetidosToolHost`.

Responsibilities:

- Build plugin inventory with lifecycle metadata.
- Read/update unified Plugin Settings maps.
- Gate local-operator-only lifecycle actions.
- Translate Pi tool host calls into existing Metidos procedures with explicit local-operator context.

Movement map: plugin lifecycle/settings procedures now have `plugin-procedures.ts`, and request-ingress behavior has `plugin-ingress-procedures.ts`. Keep `createPiMetidosToolHost` near Pi thread runtime integration or split it into `pi-metidos-tool-host.ts` because it depends on many procedure families by design.

### Terminal procedures

Current exports include `listTerminalsProcedure`, `createTerminalProcedure`, `renameTerminalProcedure`, and `closeTerminalProcedure`.

Responsibilities:

- List terminals visible for the current project/worktree context.
- Create terminal sessions rooted in authorized worktree paths.
- Rename and close sessions.

Movement map: extract to `terminal-procedures.ts` after access-scope extraction.

### Runtime stats, cache maintenance, and shutdown hooks

Current exports include `startProcedureCacheMaintenance`, `warmProcedureStartupCaches`, `getProcedureRuntimeStats`, `recoverInterruptedThreadTurnsOnStartup`, `shutdownProjectPolling`, `suspendActiveWorktreePolling`, `shutdownProcedureCacheMaintenance`, and runtime listener setters.

Responsibilities:

- Start/warm/stop directory suggestion and model catalog caches.
- Recover interrupted thread turns after startup.
- Expose runtime queue/cache counters.
- Stop polling and active work on shutdown.

Movement map: extract to `procedure-runtime-lifecycle.ts`. This module should own process-level lifecycle hooks and coordinate group-specific shutdown functions.

## Shared invariants to preserve

- Auth context: every procedure should derive the authenticated session/local-operator context exactly once and avoid reintroducing account-management helpers in new code.
- Visibility: list/get/update/delete procedures must not reveal projects, threads, crons, calendars, or terminals outside the current local installation/session visibility. Internal calls should stay explicit.
- Workspace path scope: interactive callers operate inside the current local workspace policy. Internal/maintenance calls may use broader host scope only when that distinction stays named in code.
- Unsafe mode: creating/updating threads and crons with unsafe execution must continue to call `requireUnsafeModeAllowed` before persistence or launch.
- Cache invalidation: thread detail caches, Git history caches, worktree polling, and model catalog caches are stateful process-local data. Movement should keep invalidation next to the mutation that requires it.
- Runtime ownership: Pi runtime maps, abort controllers, and completion maps are keyed by thread id and must be cleared on thread deletion, project deletion, shutdown, and failed/cancelled turns.
- Listener contracts: websocket push listeners are global process callbacks. Splitting modules should not create competing listener registries.
- RPC compatibility: `src/bun/index.ts` method names are the external contract. Extraction should only change imports, not RPC names or parameter/result shapes.

## Tests and validation surfaces

Directly relevant existing tests include:

- `src/bun/project-procedures.workspace-scope.test.ts` for workspace path restrictions.
- `src/bun/project-procedures/client-log.test.ts` for client log normalization.
- `src/bun/project-procedures/model-catalog.test.ts` for model catalog behavior.
- `src/bun/project-procedures/git-history.test.ts` and `src/bun/project-procedures/command-normalization.test.ts` for Git/cache helpers.
- `src/bun/project-procedures/thread-detail.test.ts` for thread detail helpers.
- `src/bun/project-procedures/pi-event-projection.test.ts`, `pi-session-telemetry.test.ts`, and `pi-sdk-shapes.test.ts` for Pi activity/session boundaries.
- `src/bun/sidecar-cron-runner.test.ts` for cron/thread procedure interactions.
- `src/bun/rpc-authz.test.ts` and `src/bun/rpc-validation.test.ts` for externally visible RPC behavior.
- Calendar, plugin, terminal, and DB tests under `src/bun/calendar/`, `src/bun/plugin/`, `src/bun/terminal-manager.test.ts`, and `src/bun/db.test.ts` cover store-level behavior used by procedures.

## Follow-up slice order

1. Extract access-scope helpers and update imports in `project-procedures.ts` without changing behavior.
2. Move read-only/bootstrap/local-settings procedures into small modules.
3. Continue reducing calendar, Plugin administration, and plugin ingress call sites now that focused procedure modules exist.
4. Move terminal and cron procedures after shared auth/path and thread access-control helpers are stable.
5. Split project/worktree/Git polling from thread/Pi runtime orchestration last, because those regions share process-level cache, listener, and lifecycle state.

## Open questions

- Should procedure modules export only RPC handlers, or should `src/bun/index.ts` depend on a composed registry object instead of many named imports?
- Should `createPiMetidosToolHost` stay as the single cross-domain adapter, or should each procedure group contribute a small tool-host facet?
- Can listener setters become a typed event bus to avoid global mutable singleton callbacks during extraction?
