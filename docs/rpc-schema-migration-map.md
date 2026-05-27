# RPC schema migration map

This note inventories `src/bun/rpc-schema.ts` before splitting the aggregate RPC contract into domain files. The migration should preserve every exported type name, request key, payload shape, and response shape while moving ownership into smaller modules.

## Current aggregate contract

`rpc-schema.ts` currently owns three different concerns:

1. cross-process wire shapes for Backend/Mainview RPC requests and push payloads;
2. shared domain DTOs used by backend procedures, plugin code, Pi tools, and Mainview state; and
3. the aggregate `AppRPCSchema`/`ProjectProcedures` types that bind request names to params and responses.

Keep a barrel at `src/bun/rpc-schema.ts` for the first migration. Existing import specifiers are widespread, so the first split should move declarations into domain files and re-export them without renaming symbols.

## Proposed domain files

| Domain file | Exports to move | RPC request keys |
| --- | --- | --- |
| `rpc-schema/project-worktree.ts` | `RpcProject`, `RpcWorktree`, worktree change/diff/history shapes, open/batch request/result shapes, home/directory suggestion results, `RpcProjectSkill`, `RpcCreateWorktreeResult`, `RpcContextFocusChanged` | `getHomeDirectory`, `listDirectorySuggestions`, `listProjects`, `openProject`, `openProjectsBatch`, `closeProject`, `deleteProject`, `listProjectWorktrees`, `createWorktree`, `openWorktree`, `openWorktreesBatch`, `getWorktreeSnapshot`, `listProjectSkills`, `readWorktreeFileContentPage`, `readWorktreeFileDiff`, `setActiveWorktree`, `focusContext`, `listWorktreeGitHistory`, `getWorktreeGitCommitDiff`, `closeWorktree`, `setWorktreePinned` |
| `rpc-schema/plugin.ts` | `RPC_PLUGIN_INVENTORY_GROUP_LABELS`, plugin inventory, manifest summary, settings, lifecycle, admin action, sidecar diagnostic, security diagnostic, permission descriptor, access group, and ingress route/link/binding types | `getPluginInventory`, `listPluginAccessGroups`, `getPluginSettings`, `updatePluginSettings`, `listPluginIngressSources`, `createPluginIngressLinkCode`, `listPluginIngressExternalBindings`, `setPluginIngressExternalBindingEnabled`, `deletePluginIngressExternalBinding`, `listPluginIngressRouteConfigs`, `upsertPluginIngressRouteConfig`, `getPluginSidecarDiagnostics`, `getPluginSecurityDiagnostics`, `runPluginLifecycleAction`, `runPluginAdminAction` |
| `rpc-schema/thread.ts` | `RpcThreadStartRequest`, `RpcThreadStartRequestResolved`, `RpcChatImageAttachment`, `RpcReasoningEffort`, thread run/usage/compaction/queue/status shapes, every `Rpc*ThreadMessage`, `RpcThreadMessage`, `RpcThread`, `RpcThreadDetail`, cron DTOs, thread extension UI request/response shapes | `listThreads`, `listThreadStatuses`, `createThread`, `requestThreadStart`, `approveThreadStartRequest`, `getThread`, `getThreadMessageContent`, `markThreadErrorSeen`, `sendThreadMessage`, `stopThreadTurn`, `updateThreadAccess`, `updateThreadMetadata`, `renameThread`, `setThreadPinned`, `updateThreadModel`, `updateThreadReasoningEffort`, `deleteThread`, `discardEmptyThread`, `newCron`, `updateCron`, `listCrons`, `runCronNow`, `respondThreadExtensionUi`, `updateThreadExtensionEditor` |
| `rpc-schema/terminal.ts` | `RpcTerminalStatus`, `RpcTerminal`, `RpcTerminalSettings`, `RpcCreateTerminalRequest`, `RpcCreateTerminalResult`, `RpcTerminalConnectionInfo` | `listTerminals`, `createTerminal`, `renameTerminal`, `closeTerminal`, `getTerminalSettings`, `updateTerminalSettings` |
| `rpc-schema/model-catalog.ts` | `RpcModelOption`, `RpcReasoningEffortOption`, `RpcModelCatalog` | `getModelCatalog` |
| `rpc-schema/settings-notifications.ts` | `RpcTimezoneSettings`, `RpcUserRuntimeSettings`, `RpcUserNotificationDelivery`, `RpcUserNotificationProviderReceipt`, `RpcUserNotificationDeliveryResult`, `RpcClientLogSeverity`, `RpcClientLogRequest`, security audit event/payload shapes | `getTimezoneSettings`, `getUserRuntimeSettings`, `updateTimezoneSettings`, `updateUserRuntimeSettings`, `logClientEvent`, `listUserNotifications`, `dismissUserNotification` |
| `rpc-schema/mainview-bootstrap.ts` | `RpcAppBootstrapHint`, `RpcMainviewHtmlBootstrap*`, `MAINVIEW_HTML_BOOTSTRAP_CONTRACT`, `RpcAppBootstrapPinnedWorktree`, `RpcAppBootstrapResult` | `getAppBootstrap` |
| `rpc-schema/calendar.ts` | calendar re-exports from `src/bun/calendar/types` that are referenced by `AppRPCSchema` | `getCalendarBootstrap`, `listCalendarOccurrences`, `createCalendar`, `updateCalendar`, `deleteCalendar`, `leaveSharedCalendar`, `updateCalendarPreference`, `setCalendarShare`, `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`, `createExternalIcsCalendar`, `updateExternalIcsCalendar`, `refreshExternalIcsCalendar`, `deleteExternalIcsCalendar`, `updateCalendarNotificationSettings`, `listCalendarNotifications`, `dismissCalendarNotification`, `snoozeCalendarNotification` |
| `rpc-schema/transport.ts` | `RpcRequestPriority`, `RpcProcedureCallOptions`, `RpcAuthContext`, `RpcRequestContext`, push payload types such as `RpcWorktreeGitHistoryChanged`, `RpcContextFocusChanged`, `RpcModelCatalog`, `RpcPluginInventory`, `RpcTerminal`, `RpcThread`, `RpcThreadExtensionUiRequest`, `RpcThreadStartRequest`, `RpcThreadStartRequestResolved`, and `RpcUserNotificationDelivery` as consumed by transport publishers | none directly; supports `AppRPCSchema`, socket pushes, authz, runtime stats, and request handlers |
| `rpc-schema/app.ts` | `AppRPCSchema`, `ProjectProcedures`, and the internal `RpcProcedureCall` helper | all request keys by importing domain request/response types |

## Import hot paths

The aggregate import is used by both runtime modules and UI state. Split work should update imports in small batches only after the compatibility barrel is in place.

High-fan-in Backend files:

- `src/bun/project-procedures.ts` imports 36 symbols across project/worktree, thread, terminal, notifications, client logging, bootstrap, and schema surfaces. It is the highest-risk backend consumer because it wires the procedure implementation map.
- `src/bun/index.ts` imports 15 symbols for bootstrap, push events, request context, priority, and thread start responses. It should stay on the compatibility barrel until the transport extraction stabilizes.
- `src/bun/rpc-transport.ts` imports 12 symbols for typed request handlers and push payloads. Treat this as a transport-domain consumer, not as a procedure-domain owner.
- `src/bun/git.ts`, `src/bun/terminal-manager.ts`, `src/bun/project-procedures/work-context-lifecycle.ts`, and `src/bun/metidos-tool-load-benchmark.ts` each import multiple domain DTOs and should move after the domain files exist.
- Plugin runtime files mostly import one or two plugin inventory/manifest symbols, but `src/bun/plugin/inventory.ts`, `src/bun/plugin/lifecycle.ts`, `src/bun/plugin/sidecar-manager.ts`, and `src/bun/plugin/settings.ts` are concentrated plugin-domain consumers.

High-fan-in Mainview files:

- `src/mainview/App.tsx` imports 19 symbols spanning procedure typing, project/worktree, model catalog, plugin access, threads, notifications, and git state. It should be migrated last or broken up alongside UI state extraction.
- `src/mainview/index.ts` imports 12 transport/procedure symbols and should keep using stable aggregate exports while wire-frame types move.
- `src/mainview/app/use-plugin-administration-controller.ts` imports 15 plugin and model/project symbols and is the most concentrated plugin-admin Mainview consumer.
- `src/mainview/app/plugin-administration-panel.tsx` imports 14 plugin/policy symbols; move with plugin UI state, not with generic project state.
- `src/mainview/app/mainview-cron-workspace-controller.tsx`, `src/mainview/app/use-thread-workspace-selection-controller.ts`, and `src/mainview/app/use-mainview-startup-controller.ts` each import 8-10 symbols across multiple domains and should remain on the barrel until narrower UI modules own those shapes.

## Stable exports for the first split

The first split must keep these compatibility guarantees:

- `src/bun/rpc-schema.ts` remains the public import path and re-exports every current symbol.
- `AppRPCSchema["requests"]` preserves all 94 current request keys and their exact params/response types.
- `ProjectProcedures` remains assignable to the current client bridge and backend procedure map.
- `MAINVIEW_HTML_BOOTSTRAP_CONTRACT` and `RPC_PLUGIN_INVENTORY_GROUP_LABELS` keep their exported names and literal array values.
- Calendar request shapes continue to use `src/bun/calendar/types` payloads without changing serialized field names.
- Push payload DTOs keep their existing field names because `index.ts`, `rpc-transport.ts`, Mainview invalidation handlers, and runtime stats share them.

## Suggested migration order

1. Add domain files plus a barrel that re-exports all current names; do not change callers yet.
2. Move pure DTO groups first: project/worktree/git, terminal, model catalog, settings/notifications, and bootstrap.
3. Move plugin DTOs as one batch because manifest summaries, inventory groups, lifecycle actions, settings, and ingress route state reference each other heavily.
4. Move thread/message/cron DTOs after project/worktree types, because thread DTOs reference project/worktree context and UI controllers import both.
5. Move `AppRPCSchema` and `ProjectProcedures` last, after every domain type import is available from the new files.
6. Only after the compatibility barrel validates should consumers be migrated from `../bun/rpc-schema` to domain-specific imports.

## Validation checkpoints

- Run `bun format` and `bun validate` after any code split.
- Add or keep type-level coverage that imports `AppRPCSchema`, `ProjectProcedures`, `MAINVIEW_HTML_BOOTSTRAP_CONTRACT`, and `RPC_PLUGIN_INVENTORY_GROUP_LABELS` from `src/bun/rpc-schema.ts` to prove compatibility.
- For consumer migration batches, prefer one domain at a time and verify Mainview build/type coverage before deleting any compatibility re-export.
