# Metidos Architecture Improvement TODO

This file tracks active repository-local work slices only. Each checked item must be small enough for one focused agent/PR, must have a clear validation command, and must not depend on maintainer decisions, GitHub settings, external services, private credentials, or machine-level setup outside this workspace.

General rules for every slice:

- Keep changes atomic; do not mix tracks unless a listed slice explicitly says to.
- Preserve unrelated working-tree changes, including existing `deploy/podman/*` edits and untracked runtime data.
- Follow `UBIQUITOUS_LANGUAGE.md` terminology in code comments/docs.
- For Backend behavior changes, run at least `bun test` for touched tests plus `bun run typecheck` when practical.
- For Mainview behavior changes, read `STYLE.md` before UI edits and run the relevant `bun test src/mainview/...` tests plus `bun run style:check` when styling changes.

## Track A — Deepen Backend Work Context and Thread Turn modules

- [ ] Extract Backend access-scope helpers from `src/bun/project-procedures.ts` into `src/bun/project-procedures/access-scope.ts`. Move only auth/context/path-scope/visibility helpers needed by multiple procedure families. Keep public procedure behavior unchanged. Add or update focused tests around visible Project/Thread/Cron filtering and Workspace Path Scope errors. Validation: `bun test src/bun/project-procedures.workspace-scope.test.ts src/bun/rpc-authz.test.ts`.

- [ ] Extract Thread Access Control resolution from `src/bun/project-procedures.ts` into `src/bun/project-procedures/thread-access-controls.ts`. Include permission registry loading, legacy projection, unsafe-mode checks, and plugin access-group normalization. Add tests for default access, explicit permission arrays, unknown plugin permissions, and unsafe denial without Manage App Capability. Validation: `bun test src/bun/project-procedures/thread-access-controls.test.ts src/bun/thread-permissions.test.ts src/bun/project-procedures.step-up-guards.test.ts`.

- [ ] Deepen the Thread runtime registry by moving Pi Runtime maps, abort controllers, completion maps, `ensurePiThreadRuntime`, runtime disposal, and session-state sync out of `src/bun/project-procedures.ts` into a focused `src/bun/project-procedures/thread-runtime-registry.ts`. Preserve existing listener and cache invalidation behavior. Add tests for runtime reuse, disposal, abort, and session-state sync. Validation: `bun test src/bun/project-procedures/thread-runtime-registry.test.ts src/bun/pi/thread-runtime.test.ts src/bun/project-procedures/thread-lifecycle.test.ts`.

- [ ] Move `runThreadMessageInBackground(...)` from `src/bun/project-procedures.ts` behind a Thread Turn execution module, reusing `thread-turn-runner.ts`, `thread-turn-runtime.ts`, `thread-turn-persistence.ts`, and `pi-event-projection.ts` instead of callback-heavy orchestration in the procedure hub. Preserve cancellation, trailing assistant event grace, plugin prompt injection, image forwarding, usage persistence, and activity flushing. Add tests for successful assistant persistence, tool-use/no-text fallback, prompt error, and abort settlement. Validation: `bun test src/bun/project-procedures/thread-turn-execution.test.ts src/bun/project-procedures/thread-turn-runner.test.ts src/bun/project-procedures/thread-activity-persistence.test.ts`.

- [ ] Extract Thread detail cache ownership from `src/bun/project-procedures.ts` into a small cache module used by Thread procedures, runtime settlement, and lifecycle invalidation events. Include cache warm/read/invalidate behavior and stale-detail guards. Validation: `bun test src/bun/project-procedures/thread-detail.test.ts src/bun/project-procedures/thread-lifecycle.test.ts`.

- [ ] Move Cron RPC procedure implementations (`newCron`, `updateCron`, `runCronNow`, `listCrons`) from `src/bun/project-procedures.ts` into `src/bun/project-procedures/cron-procedures.ts`. Depend on the extracted access-scope and Thread Access Control modules instead of duplicating permission logic. Preserve scheduler listener calls and active-run stopping. Validation: `bun test src/bun/project-procedures.cron.test.ts src/bun/sidecar-cron-runner.test.ts src/bun/sidecar-cron-scheduler.test.ts`.

- [ ] Move terminal RPC procedure implementations from `src/bun/project-procedures.ts` into `src/bun/project-procedures/terminal-procedures.ts`. Depend on access-scope helpers for Manage App Capability and Workspace Path Scope. Add handler-level tests for unauthorized context, deleted Worktree context, and sanitized error text. Validation: `bun test src/bun/rpc-handlers/terminal.test.ts src/bun/project-procedures.terminal.test.ts src/bun/terminal-manager.test.ts`.

- [ ] Update `.wiki/project-procedures-responsibility-map.md` after the extraction slices above land. Record the new module ownership, invariants, and remaining slices without reintroducing broad or stale TODOs. Validation: `bun run typecheck`.

## Track B — Deepen App Data persistence stores

- [ ] Add direct tests for bound persistence adapters before refactoring them. Cover `createBoundThreadStore`, `createBoundCronStore`, `createBoundMessageActivityStore`, `thread-status-coalescer`, and `user-notifications` with isolated SQLite handles to lock current transaction/scope behavior. Validation: `bun test src/bun/thread-store.test.ts src/bun/cron-store.test.ts src/bun/message-activity-store.test.ts src/bun/thread-status-coalescer.test.ts src/bun/user-notifications.test.ts`.

- [ ] Move Thread persistence implementation from `src/bun/db.ts` into `src/bun/thread-store.ts`, leaving compatibility re-exports in `db.ts` only where existing callers still need them. The deepened Thread Store interface should not require callers to pass `Database` after binding. Validation: `bun test src/bun/thread-store.test.ts src/bun/thread-metadata.test.ts src/bun/project-procedures/thread-lifecycle.test.ts src/bun/db.test.ts`.

- [ ] Move Cron Job and Cron run persistence implementation from `src/bun/db.ts` into `src/bun/cron-store.ts`, leaving compatibility re-exports in `db.ts` during migration. Preserve due-run claiming, stale in-progress handling, soft delete, and active Thread checks. Validation: `bun test src/bun/cron-store.test.ts src/bun/cron-schedules.test.ts src/bun/sidecar-cron-runner.test.ts src/bun/db.test.ts`.

- [ ] Move Thread activity persistence implementation from `src/bun/db.ts` into `src/bun/message-activity-store.ts`. Preserve idempotent upsert behavior for Pi-projected activity items and normal Thread Message writes. Validation: `bun test src/bun/message-activity-store.test.ts src/bun/project-procedures/thread-activity-persistence.test.ts src/bun/thread-store.test.ts`.

- [ ] Move web-server share/session persistence from `src/bun/db.ts` into `src/bun/pi/web-server/share-store.ts`. Preserve claim-token timing-safe checks, session expiry, rotation, revoke, and stop behavior. Validation: `bun test src/bun/pi/web-server/*.test.ts src/bun/db.test.ts`.

- [ ] After at least Thread, Cron, Thread activity, and web-server share persistence are moved, remove shallow pass-through store constructors that no longer earn their interface. Update imports to use bound domain stores or direct compatibility exports consistently. Validation: `bun run typecheck && bun test src/bun`.

- [ ] Update `src/bun/README.md` to describe the new App Data persistence ownership: `db.ts` for connection/schema/migration and focused stores for domain reads/writes. Validation: `bun run typecheck`.

## Track C — Move RPC validation out of Backend bootstrap

- [ ] Create `src/bun/rpc-validation.ts` and move pure RPC parameter validation helpers plus `validateRpcRequestParams` out of `src/bun/index.ts`. Keep constants exported where tests need them. Update `src/bun/rpc-validation.test.ts` to import the pure module without importing Backend bootstrap. Validation: `bun test src/bun/rpc-validation.test.ts src/bun/rpc-websocket-abuse-control.test.ts`.

- [ ] Split RPC validator definitions by domain to mirror `src/bun/rpc-schema/*`: app bootstrap, project/worktree, thread, cron, calendar, plugin, terminal, settings, memory, notifications, and model catalog. Compose them in `rpc-validation.ts`. Validation: `bun test src/bun/rpc-validation.test.ts src/bun/rpc-schema.contract.test.ts`.

- [ ] Add a contract test that every `AppRPCSchema["requests"]` method has exactly one runtime validator and every validator key exists in the schema. This should fail typecheck or test execution when RPC Schema and validators drift. Validation: `bun test src/bun/rpc-schema.contract.test.ts src/bun/rpc-validation.test.ts`.

- [ ] Move `parseRpcClientMessage` request-shape parsing that is pure and transport-independent from `src/bun/index.ts` into an RPC parsing/validation module consumed by `rpc-transport` or Backend bootstrap. Keep socket/session behavior in transport/bootstrap. Validation: `bun test src/bun/rpc-validation.test.ts src/bun/rpc-transport.test.ts src/bun/rpc-websocket-abuse-control.test.ts`.

- [ ] Update `src/bun/rpc-schema/README.md` and `src/bun/README.md` so adding an RPC method requires schema type, runtime validator, handler binding, and contract test updates in one documented checklist. Validation: `bun run typecheck`.

## Track D — Deepen the Mainview shell module

- [ ] Delete the unused compatibility barrel `src/mainview/app/state.ts` after confirming there are no imports; migrate any reintroduced imports to focused modules first. Validation: `bun run typecheck && bun test src/mainview/app`.

- [ ] Extract Project favicon refresh state from `src/mainview/App.tsx` into `src/mainview/app/use-project-favicons.ts`. Preserve batching, force refresh, stale interval, and merge behavior. Add focused tests with fake Project rows and fake RPC procedures. Validation: `bun test src/mainview/app/use-project-favicons.test.ts`.

- [ ] Extract notification tray projection and open-state handling from `src/mainview/App.tsx` into `src/mainview/app/notification-tray-state.ts` plus `src/mainview/app/use-notification-tray.ts`. Cover Calendar Reminder and User Notification merge/sort/slice behavior with fake data only. Validation: `bun test src/mainview/app/calendar-notifications.test.ts src/mainview/app/notification-tray-state.test.ts`.

- [ ] Extract Project and Thread action-menu orchestration from `src/mainview/App.tsx` into a focused controller. Include rename, pin, delete, hidden Worktree open, Git initialization prompt state, rollback, busy state, and error state. Add focused controller tests with fake Project, Worktree, and Thread payloads. Validation: `bun test src/mainview/app/action-menu-controller.test.ts src/mainview/app/mainview-shell-state.test.ts`.

- [ ] Extract pending Thread defaults from `src/mainview/App.tsx` into `src/mainview/app/use-pending-thread-defaults.ts`: selected model, reasoning effort, permissions, default fallback, model-catalog application, and persistence inputs. Validation: `bun test src/mainview/app/use-thread-settings-controller.test.tsx src/mainview/app/thread-access-sanitization.test.ts src/mainview/app/use-access-permissions.test.ts`.

- [ ] Deepen `use-mainview-shell-controller.ts` so it exposes a smaller shell view model and command set to `App.tsx`. Move selected Project/Worktree/Thread refs, primary-view transitions, mobile indicator handling, completed Thread indicators, and persisted shell writes behind that module. Add focused hook/controller tests for persisted shell writes and navigation transitions. Validation: `bun test src/mainview/app/use-mainview-shell-controller.test.ts src/mainview/app/mainview-shell-state.test.ts`.

- [ ] Add Mainview shell navigation integration tests with fake Projects, Worktrees, Threads, statuses, and RPC procedures. Cover switching Project, Worktree, Thread, Diff, Git history, Cron, Calendar, Plugin administration, terminal, and settings surfaces without losing selected context. Validation: `bun test src/mainview/app/workspace-panel.test.tsx src/mainview/app/sidebar-content.test.tsx src/mainview/app/desktop-sidebar-content.test.tsx`.

- [ ] After the shell extraction slices land, reduce `src/mainview/App.tsx` by removing state and callbacks now owned by focused shell modules. Keep `App.tsx` as composition only and update `src/mainview/app/README.md` with the new ownership map. Validation: `bun run typecheck && bun test src/mainview/app`.

## Track E — Add source-time Provider declarations for Core Plugins

- [ ] Add a repository-local audit script plus test that reports Core Plugin provider boilerplate drift: API key setting/env lookup, `piAuth` records, `apiKeyMissingMessage`, OpenAI-compatible `compat` fields, timeout/default cost defaults, and duplicated helper names. The script must not require network access or provider credentials. Validation: `bun test scripts/audit-core-provider-drift.test.ts && bun run scripts/audit-core-provider-drift.ts`.

- [ ] Define a source-time Provider Declaration schema for OpenAI-compatible Core Plugins in `src/bun/plugin/core-provider-declaration.ts`. Include auth sources, base URL, provider id, configuration id, static models, discovery hooks, embedding support, compatibility flags, and missing-key copy. Add unit tests for generated provider configuration objects. Validation: `bun test src/bun/plugin/core-provider-declaration.test.ts`.

- [ ] Implement `scripts/generate-core-provider-plugin.ts` to emit standalone plugin-local TypeScript from Provider Declarations. The generated Core Plugin entrypoints must keep Plugin System v1 import policy intact: no runtime package imports except `@metidos/plugin-api`, no cross-plugin imports, and no generated `node_modules`. Validation: `bun test src/bun/plugin/entrypoint-build.test.ts src/bun/plugin/core-provider-declaration.test.ts`.

- [ ] Migrate `core_plugins/upstage` and `core_plugins/zai` to the Provider Declaration path. Preserve Manifest, Provider-qualified Model IDs, missing-key behavior, and existing tests. Validation: `bun test src/bun/plugin/upstage-core-plugin.test.ts src/bun/plugin/zai-core-plugin.test.ts src/bun/plugin/model-provider-capability.test.ts`.

- [ ] Migrate `core_plugins/openrouter` to the Provider Declaration path. Preserve refresh interval, discovery error logging, model normalization, embedding provider behavior, and Provider Auth behavior. Validation: `bun test src/bun/plugin/openrouter-core-plugin.test.ts src/bun/plugin/model-provider-capability.test.ts src/bun/project-procedures/model-catalog.test.ts`.

- [ ] Add a contract test that every Provider Core Plugin using the declaration path exposes stable `piAuth` records and does not inline divergent API key missing messages outside the declaration. Validation: `bun test src/bun/plugin/core-provider-declaration.test.ts src/bun/plugin/upstage-core-plugin.test.ts src/bun/plugin/zai-core-plugin.test.ts src/bun/plugin/openrouter-core-plugin.test.ts`.

- [ ] Document the Provider Declaration workflow in `docs/model-providers.md`, including when not to use it for custom provider behavior. Validation: `bun run typecheck`.

## Track F — Close QuickJS host bridge drift

- [ ] Add a QuickJS host bridge drift test that enumerates plugin host globals installed by `src/bun/plugin/quickjs-runtime.ts` and asserts all async host capabilities use `installQuickJsHostOperation(...)`. Keep structured data explicitly listed as the only synchronous outlier. Validation: `bun test src/bun/plugin/quickjs-host-bridge.test.ts src/bun/plugin/quickjs-runtime.test.ts`.

- [ ] Extract structured-data host installation from `src/bun/plugin/quickjs-runtime.ts` into a named adapter in `src/bun/plugin/quickjs-structured-data-bridge.ts`. Preserve its current synchronous guest payload contract. Validation: `bun test src/bun/plugin/quickjs-host-bridge.test.ts src/bun/plugin/plugin-api-runtime.test.ts`.

- [ ] Add payload-size protection to the structured-data host bridge while preserving the current `{ result }` / `{ error }` envelope expected by guest wrappers. Cover oversized success and error payloads with tests. Validation: `bun test src/bun/plugin/quickjs-host-bridge.test.ts src/bun/plugin/plugin-api-runtime.test.ts`.

- [ ] Standardize host bridge error payload tests so every fallback error name in `docs/plugin-quickjs-host-bridge-invariants.md` is asserted by code. Include fetch, websocket, filesystem, calendar events, terminal, SQLite, LanceDB, embeddings, log, notification, and structured data. Validation: `bun test src/bun/plugin/quickjs-host-bridge.test.ts src/bun/plugin/quickjs-runtime.test.ts`.

- [ ] Update `docs/plugin-quickjs-host-bridge-invariants.md` after the bridge cleanup lands. Remove stale notes about old extra fallback catches and make the documented bridge behavior match the regression tests. Validation: `bun run typecheck`.
