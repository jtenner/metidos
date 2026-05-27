# Agent TODO

This file records architecture-improvement epics discussed in thread 6099 so future agents do not lose context or misinterpret the intent.

## Shared architecture vocabulary

Use the terms from `.pi/skills/improve-codebase-architecture/LANGUAGE.md` when working these epics:

- **Module** — anything with an interface and an implementation.
- **Interface** — everything a caller must know to use the module correctly: types, invariants, ordering constraints, error modes, configuration, and performance characteristics.
- **Implementation** — the code inside a module.
- **Depth** — leverage at the interface. A **deep** module hides a lot of behavior behind a small interface; a **shallow** module has an interface nearly as complex as its implementation.
- **Seam** — where an interface lives; a place behavior can be altered without editing in place.
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge, and verification concentrated in one place.

Important principles:

- **Deletion test:** imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across many callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

## Domain vocabulary to preserve

Use project terms from `UBIQUITOUS_LANGUAGE.md`, especially:

- **Metidos** — the local IDE application.
- **Local Operator** — the single authenticated person using one installation.
- **Project** — high-level entry point for one or more Git Worktrees.
- **Worktree** — Git checkout context used as root for Thread tools.
- **Thread** — Pi-powered agent execution session attached to selected Project/Worktree context.
- **Backend** — Bun server layer.
- **Mainview** — React/Tailwind browser UI.
- **RPC** — typed WebSocket request/response contract between Mainview and Backend.
- **Plugin System v1**, **Plugin**, **Sidecar**, **Manifest**, **Access Group**, **Permission**, **Plugin Settings**, **Plugin Data**.
- **Pi Runtime**, **Pi Session**, **Provider**, **Model Catalog**, **Provider-qualified Model ID**.

## Relevant existing decision notes

- `docs/backend-rpc-transport-invariants.md` records the current Backend RPC transport extraction. Preserve its invariants if touching `src/bun/rpc-transport.ts` or `src/bun/index.ts`.
- `docs/metidos-plugin-decisions.md` records Plugin System v1 decisions. Important for these epics:
  - PLUG-003: exactly one sidecar process per activated plugin.
  - PLUG-004: execute plugin code in QuickJS, not main Bun runtime.
  - PLUG-005: custom typed JSON RPC over stdio between host and sidecar.
  - PLUG-009: Thread Access Control controls tool visibility only.
  - PLUG-014: provider and notification provider registration are initialization-only.
  - PLUG-020: model provider identities are stable composite keys.
  - PLUG-021: Python plugin entrypoints are part of Plugin System v1 through the safe Pyodide host. QuickJS remains the TypeScript/JavaScript adapter; deepen the multi-adapter runtime path for `.py` manifests.
  - PLUG-022: embedding providers and embedding consumers use separate permissions.

---

# Epics

## Epic 1 — Complete or delete the Mainview Shell Controller extraction

**Status:** done

**Completed slice:** Wired the existing `useMainviewShellController` into `src/mainview/App.tsx` for shell-owned selection state, navigation refs/commands, sidebar collapse state, mobile/completed indicators, session readiness, and persisted shell-state flushing. App no longer carries a duplicate shell persistence/navigation implementation.

**Follow-up notes:**

1. Add hook-level tests for `useMainviewShellController` if/when the Mainview test harness supports React hook lifecycle tests without broad setup churn.
2. Revisit the `setThreadMessagesForNavigation` seam during the Thread workspace workflow extraction in Epic 2 so Thread message ownership does not continue to leak into shell navigation.

### Files / modules involved

- `src/mainview/App.tsx`
- `src/mainview/app/use-mainview-shell-controller.ts`
- `src/mainview/app/mainview-shell-state.ts`
- `src/mainview/app/mainview-shell-state.test.ts`

### Problem

`src/mainview/app/use-mainview-shell-controller.ts` looks like an intended deepened Mainview shell module, but it appears unused. Meanwhile `src/mainview/App.tsx` still directly owns the same shell state, refs, persistence writer, navigation update commands, and derived shell state.

Duplicated Mainview shell implementation currently exists in `App.tsx`, including:

- `persistedMainviewStateWriterRef`
- `flushPersistedMainviewStateWrite`
- `schedulePersistedMainviewStateWrite`
- selected refs such as `selectedThreadIdRef`, `selectedProjectIdRef`, `selectedWorktreePathRef`
- `commitShellNavigationUpdate`
- `setSelectedProjectIdForNavigation`
- `setSelectedWorktreePathForNavigation`
- `setSelectedThreadIdForNavigation`
- `setThreadMessagesForNavigation`
- `setPrimaryViewForNavigation`
- `mainviewShellState`
- `persistedMainviewState`
- persistence effects for unload/pagehide/visibility changes

That creates a misleading seam: callers must still understand the App-level state machinery, and future agents may believe the controller is active when it is not.

By the deletion test, the current unused controller likely fails today: deleting it probably removes confusion because the active complexity already exists in `App.tsx`.

### Recommendation from thread

The **concept** is useful, but the **current unused module** is not earning its keep yet.

`use-mainview-shell-controller.ts` captures a real and coherent seam:

- selected Project / Worktree / Thread
- primary Workspace Panel view
- shell navigation updates
- persisted Mainview shell state
- before-unload/pagehide/visibility persistence flushing
- sidebar collapsed state
- mobile/completed Thread indicators

This could improve **locality** because shell navigation and persistence bugs would live in one module instead of being mixed through `App.tsx`.

However, do **not** keep it as-is indefinitely. Dead unused architecture modules hurt AI-navigability more than a large but honest `App.tsx`.

### Solution

Either:

1. **Finish the extraction immediately** so Mainview shell selection/navigation/persistence actually lives behind `useMainviewShellController`; or
2. **Delete the unused controller** if this extraction is not going to happen soon.

Preferred path: keep the module only if we immediately wire it into `App.tsx`.

Focused refactor path:

1. Replace the duplicated shell state/persistence block in `App.tsx` with `useMainviewShellController`.
2. Keep `mainview-shell-state.ts` as the pure helper module.
3. Add or adjust tests for the hook seam if test harness support is already present.
4. If integration reveals missing shell state, expand the hook only for shell-owned concerns.
5. Do not let the shell controller absorb Thread message fetching, Git history, notifications, or other non-shell workflows.

### Caution

The hook currently accepts `setThreadMessages`, which slightly leaks Thread workspace behavior into the shell module. It may be acceptable because navigation transitions clear/swap messages, but watch the seam carefully. If it grows, it could become another shallow orchestration module.

### Benefits

- **Locality:** shell navigation and persistence bugs concentrate in one module.
- **Leverage:** Mainview gets shell state and commands from one place.
- **Tests:** hook-level tests can exercise the same seam Mainview actually uses, rather than only testing pure helper functions.

### Done when

- `useMainviewShellController` is used by `App.tsx`, or the unused file is deleted.
- There is no duplicated shell persistence/navigation implementation in both `App.tsx` and `use-mainview-shell-controller.ts`.
- Existing `mainview-shell-state` tests still pass, and new/updated tests cover the active shell controller seam if the module is kept.

---

## Epic 2 — Deepen the Mainview App orchestration module

**Status:** done

**Completed slices:**

1. Moved selected Thread message-history replacement, merge, and paginated backfill ownership out of `App.tsx` into `src/mainview/app/use-thread-message-history-controller.ts`. App no longer owns the selected message-history pagination cursor, backfill abort controller, retention/merge ordering, or selected detail refresh-key updates for history loads.
2. Moved selected Thread turn send/stop busy state, optimistic user-message id ownership, and optimistic stop handling into `src/mainview/app/use-thread-turn-controller.ts`. App now asks the Thread turn workflow seam to post, stop, and report empty-thread discard protection instead of owning those send/stop internals.
3. Moved selected Thread settings update workflows (model, reasoning effort, and Access Control) into `src/mainview/app/use-thread-settings-controller.ts`. App now delegates settings sync, optimistic pending values, busy flags, RPC updates, rollback/error handling, and stale-selection guards to that seam.
4. Added `src/mainview/app/use-thread-workspace-controller.ts` as the App-facing Thread workspace seam for selected Thread message history, status refresh side effects, send/stop commands, and settings update commands. `App.tsx` now consumes one composed Thread workspace controller for those workflow slices instead of importing/calling each controller separately.
5. Moved Thread workspace selection into `useThreadWorkspaceController`. The composed seam now owns selected Thread open/create/clear commands, Thread start request approval/dismissal, selected Worktree synchronization, and context-focus side effects; `App.tsx` no longer imports the selection controller directly.
6. Added hook-level workflow tests for the consolidated Thread workspace seam covering Thread open/history replacement and selected Thread model updates through the App-facing controller interface.

**Remaining slices:** none.

### Files / modules involved

- `src/mainview/App.tsx`
- `src/mainview/app/use-mainview-startup-controller.ts`
- `src/mainview/app/use-mainview-derived-state.ts`
- `src/mainview/app/use-project-worktree-controller.ts`
- `src/mainview/app/use-thread-workspace-selection-controller.ts`
- `src/mainview/app/use-thread-status-controller.ts`
- `src/mainview/app/use-worktree-diff.ts`
- `src/mainview/app/use-git-history-controller.ts`

### Problem

`App.tsx` is still the Mainview coordination hub for many unrelated concerns:

- Project/Worktree state
- Thread state
- Model Catalog refresh
- notification trays
- terminal state
- Git history
- shell navigation
- transcript media payload retention
- Thread Start Requests
- workspace rendering

Some deepened modules already exist, but their leverage is limited because `App.tsx` still wires huge parameter bags and owns many cross-concern invariants. The interfaces to those modules are often nearly as complex as their implementations.

### Solution

Pick one vertical Mainview workflow and move both its state and commands behind a deeper module.

Best first candidate: the **Thread workspace workflow**, including:

- selected Thread detail
- message loading
- send/stop commands
- Thread status updates
- Thread settings updates
- transcript retention
- selection side effects

Avoid extracting pure helper functions only for testability. The goal is a deeper module with a smaller, behavior-rich interface.

### Benefits

- **Locality:** Thread workspace bugs concentrate in a Thread workspace module instead of requiring navigation through `App.tsx` plus several hooks.
- **Leverage:** Mainview can get “current Thread workspace state + commands” from one seam.
- **Tests:** tests can exercise real user workflows through one module instead of validating scattered helper functions.

### Done when

- One vertical Mainview workflow is owned by a deeper module with state and commands behind a smaller interface.
- `App.tsx` no longer needs to understand the workflow’s internal ordering/state invariants.
- Tests cover the workflow through the same interface used by `App.tsx`.

---

## Epic 3 — Deepen Thread Turn execution around one workflow module

**Status:** done

**Completed slices:**

1. Moved active-run status lookup inside `ThreadTurnRunner` so queue/stop workflows use the `ThreadRuntimeLifecycle` seam directly instead of requiring `project-procedures.ts` to pass a separate `currentRunStatus` callback.
2. Moved runtime acquisition/session sync behind `ThreadTurnRuntimeCoordinator` so `ThreadTurnRunner` depends on a smaller runtime-manager seam instead of wiring `createRuntime`, `syncRuntimeSessionState`, and lifecycle runtime storage directly.
3. Moved Thread Turn persistence/readback dependencies behind `ThreadTurnPersistenceCoordinator`, giving `ThreadTurnRunner` one persistence-manager seam for queued user-message persistence, stopped/interrupted settlement, Thread detail invalidation, cron-run cleanup, and detail readback.
4. Moved startup interrupted-turn recovery inputs and stale-active-turn rules behind `ThreadTurnRunner`. Startup recovery now asks the Thread Turn module to recover without coordinating Thread/message store reads or lifecycle helper recovery decisions in `project-procedures.ts`.
5. Added broader queue/stop/recover workflow tests through the deepened Thread Turn module interface, covering queued-message persistence failures, runtime abort during stop, idle-stop readback, missing-controller stop protection, and interrupted cron-turn cleanup.

**Remaining slices:** none.

### Files / modules involved

- `src/bun/project-procedures.ts`
- `src/bun/project-procedures/thread-turn-runner.ts`
- `src/bun/project-procedures/thread-runtime-lifecycle.ts`
- `src/bun/project-procedures/thread-activity-persistence.ts`
- `src/bun/project-procedures/work-context-lifecycle.ts`

### Problem

`ThreadTurnRunner` is useful, but its interface is a long dependency bundle that exposes much of the Thread Turn implementation:

- runtime creation
- persistence
- stop persistence
- detail reads
- status lookup
- recovery decisions
- session sync
- provider validation
- background execution

That makes the seam somewhat shallow. Callers still need to know how Thread runtime, Thread detail cache, activity persistence, provider validation, and Pi Runtime lifecycle fit together.

### Solution

Deepen the Thread Turn module so queue/stop/recover behavior owns more of the Thread Turn workflow, not just the middle of it.

The Backend procedure layer should mostly say:

- “queue this Thread Turn”
- “stop this Thread Turn”
- “recover interrupted Thread Turns”

The module should internally handle:

- persistence
- lifecycle status
- runtime acquisition
- recovery
- detail invalidation/readback
- provider validation
- active-run status rules

### Benefits

- **Locality:** Thread Turn race conditions, stop/recovery bugs, and active-run status rules concentrate in one module.
- **Leverage:** Cron Runner, Mainview send, ingress, and future Thread callers can reuse the same behavior.
- **Tests:** tests can assert full queue/stop/recover workflows through the Thread Turn module instead of mocking many small callbacks.

### Done when

- `ThreadTurnRunner` or a successor module exposes a smaller interface with more behavior behind it.
- `project-procedures.ts` passes fewer callback bundles and owns fewer Thread Turn ordering details.
- Existing Thread Turn tests remain green and new tests cover full queue/stop/recover workflows through the deepened interface.

---

## Epic 4 — Split the Work Context Lifecycle helper bag into deeper modules

**Status:** done

**Completed slices:**

1. Extracted Work Context event construction/publication into `src/bun/project-procedures/work-context-events.ts` while preserving the existing `workContextLifecycle.events` compatibility seam for current callers.
2. Extracted Project Worktree lifecycle/listing/polling behavior into `src/bun/project-procedures/project-worktree-lifecycle.ts` with workflow-oriented tests while preserving the existing `workContextLifecycle.projectWorktrees` compatibility seam for current callers.
3. Extracted Thread lifecycle/create/detail/turn behavior into `src/bun/project-procedures/thread-lifecycle.ts` with focused queue/create/read/stop workflow tests while preserving the existing `workContextLifecycle.threads` compatibility seam for current callers.
4. Rewired `src/bun/project-procedures.ts` to import and call the focused Work Context event, Project Worktree lifecycle, and Thread lifecycle modules directly. The aggregate `workContextLifecycle` compatibility object remains available for other callers, but the Backend procedure layer no longer routes these workflows through the helper-bag seam.

**Remaining slices:** none.

### Files / modules involved

- `src/bun/project-procedures/work-context-lifecycle.ts`
- `src/bun/project-procedures.ts`
- `src/bun/project-procedures/work-context-lifecycle.test.ts`
- `src/bun/project-procedures/project-worktrees.ts`
- `src/bun/project-procedures/git-history.ts`

### Problem

`workContextLifecycle` groups Project Worktree lifecycle, Thread lifecycle, and event helpers under one exported object.

Its interface is large and mirrors the implementation:

- many methods
- many input types
- callers still pass dependency bundles for polling, Git history, snapshots, Thread Turn runners, and publishing

This is shallow in places: the caller still has to understand almost every moving part.

### Solution

Deepen by domain workflow:

1. Project Worktree lifecycle/polling
2. Thread lifecycle/turns
3. Work Context event publication

Each module should hide more of its own ordering and state transitions instead of requiring `project-procedures.ts` to supply many callback-shaped dependencies.

### Benefits

- **Locality:** Project Worktree polling bugs do not share a module with Thread Turn recovery logic.
- **Leverage:** each workflow module can provide a smaller, more behavior-rich interface.
- **Tests:** tests become workflow-oriented, such as “open Worktree starts polling and warms Git history,” not “given this callback bundle, helper X mutates field Y.”

### Done when

- Project Worktree lifecycle, Thread lifecycle, and Work Context event publication are separated into focused modules or otherwise made deeper.
- `project-procedures.ts` supplies fewer low-level callbacks to lifecycle helpers.
- Tests assert domain workflows through deepened interfaces.

---

## Epic 5 — Deepen Plugin Runtime host operations across QuickJS and Python adapters

**Status:** done

**Completed slices:**

1. Extracted shared structured-data host operation semantics into `src/bun/plugin/host-structured-data.ts`, used by both QuickJS and Python adapters for TOML/YAML/HTML/XML operation dispatch and fallback TOML stringification. Added adapter-independent tests for the shared operation path.
2. Extracted shared language-neutral host capability operations into `src/bun/plugin/host-capabilities.ts` for fetch, notifications, calendar/events, terminal, SQLite, LanceDB, embeddings, fs, WebSocket, and log dispatch. QuickJS and Python adapters now preserve adapter-specific value conversion and callback wiring while delegating permission checks, host API availability errors, metadata forwarding, and common request normalization to the shared operation path. Added adapter-independent permission/capability tests and kept adapter integration tests focused on bridge behavior.

**Remaining slices:** none.

### Files / modules involved

- `src/bun/plugin/quickjs-runtime.ts`
- `src/bun/plugin/python-runtime.ts`
- `src/bun/plugin/plugin-runtime.ts`
- `src/bun/plugin/plugin-runtime-contract.ts`
- `src/bun/plugin/startup-registrations.ts`
- `src/bun/plugin/sidecar-capability-seams.ts`
- `docs/metidos-plugin-decisions.md`

### Problem

Plugin System v1 decision PLUG-021 says Python plugin entrypoints are part of v1 through the safe Pyodide host, while QuickJS remains the JavaScript adapter. This means multi-adapter behavior is no longer hypothetical.

Currently, QuickJS and Python runtime modules both contain language-adapter code mixed with host operation rules, including:

- permissions
- operation classification
- startup registration validation
- callback context
- fetch
- notifications
- calendar events
- terminal operations
- SQLite/LanceDB-like operation handling
- structured data helpers
- XML/HTML utilities

That risks drift between adapters. The seam between “language adapter” and “Plugin host capability behavior” is not deep enough.

### Solution

Move language-neutral Plugin host operation behavior behind a shared module used by both runtime adapters.

QuickJS and Python should primarily adapt values/callbacks into the common host operation path.

This aligns with PLUG-021 rather than contradicting it.

### Benefits

- **Locality:** permission bugs and capability semantics are fixed once for both adapters.
- **Leverage:** adding another Plugin runtime adapter would reuse the same host behavior.
- **Tests:** shared capability tests can validate adapter-independent rules, while adapter tests focus on value conversion and callback invocation.

### Done when

- QuickJS and Python runtime modules delegate shared host operation semantics to a common module.
- Adapter modules focus mostly on language/runtime value conversion and callback invocation.
- Shared tests cover adapter-independent permission/capability behavior.
- Adapter-specific tests cover QuickJS/Pyodide integration details.

---

## Epic 6 — Deepen the Backend RPC procedure registration seam

**Status:** done

**Completed slices:**

1. Extracted Cron RPC procedure registration from the giant inline `rpcHandlers` map in `src/bun/index.ts` into `src/bun/rpc-handlers/cron.ts`, including cron scheduler side effects and focused handler-map tests.
2. Extracted Settings RPC procedure registration into `src/bun/rpc-handlers/settings.ts`, including timezone-change cron scheduler synchronization and focused handler-map tests.
3. Extracted Plugin Administration RPC registration into `src/bun/rpc-handlers/plugin-admin.ts`, including plugin runtime reconciliation, model-provider refreshes, sidecar diagnostics, lifecycle side effects, and admin runtime hooks. Added focused registrar tests for those side effects.
4. Extracted Model Catalog and Terminal RPC registration into `src/bun/rpc-handlers/model-catalog.ts` and `src/bun/rpc-handlers/terminal.ts`, including model-provider refresh side effects and focused handler-map tests.
5. Extracted Calendar RPC registration into `src/bun/rpc-handlers/calendar.ts` with focused handler-map tests covering the calendar handler map delegation.
6. Extracted Thread RPC registration into `src/bun/rpc-handlers/thread.ts` with focused handler-map tests covering exact Thread method registration and procedure delegation.
7. Extracted Work Context RPC registration into `src/bun/rpc-handlers/work-context.ts`, including Project/Worktree directory, selection, file, Git history, skill, and focus-context handlers. Added focused handler-map tests covering exact Work Context method registration and procedure delegation.
8. Replaced the remaining inline `rpcHandlers` object in `src/bun/index.ts` with the composed Backend RPC registrar in `src/bun/rpc-handlers/backend.ts`, added the App bootstrap/logging registrar, and added broader registration tests covering the complete RPC surface plus cross-domain side effects.

**Remaining slices:** none.

### Files / modules involved

- `src/bun/index.ts`
- `src/bun/rpc-schema.ts`
- `src/bun/rpc-schema/*`
- `src/bun/project-procedures.ts`
- `src/bun/rpc-transport.ts`

### Problem

`src/bun/rpc-transport.ts` is now a real seam. It hides request lifecycle, client registries, cancellation, backpressure, and publishing.

However, `src/bun/index.ts` still owns a very large `rpcHandlers` object, plus domain side effects such as:

- plugin runtime reconciliation
- cron scheduler syncing
- model catalog refresh logic
- procedure wiring

The transport extraction is deep, but procedure registration remains a shallow central map. Adding a new domain procedure requires editing a high-churn bootstrap module and knowing which post-procedure side effects belong there.

### Solution

Group procedure registration by domain workflow:

- Plugin Administration
- Calendar
- Thread
- Work Context
- Terminal
- Settings
- Cron
- Model Catalog

Each domain registrar should own its procedure handlers and their immediate side effects. `index.ts` should compose registrars rather than listing every handler inline.

Preserve `docs/backend-rpc-transport-invariants.md` if touching transport behavior.

### Benefits

- **Locality:** plugin lifecycle side effects live near Plugin Administration procedures, cron side effects near Cron procedures, etc.
- **Leverage:** Backend bootstrap becomes mostly HTTP/WebSocket composition.
- **Tests:** domain handler maps can be tested without importing the whole server bootstrap.

### Done when

- `index.ts` no longer owns one giant inline `rpcHandlers` object.
- Domain registrar modules own procedure handlers and immediate side effects.
- Backend RPC transport invariants remain preserved.
- Handler registration tests can exercise domain-specific handler maps without server bootstrap.
