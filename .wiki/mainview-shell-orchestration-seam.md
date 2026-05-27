# Mainview Shell Orchestration Seam

Observed 2026-05-10. This page maps the Mainview shell invariants that should stay stable while `src/mainview/App.tsx` is collapsed into deeper shell-state and orchestration modules. The claims below are an architecture synthesis from the current source tree, not a new behavior proposal.

## Summary

`src/mainview/App.tsx` is still the composition layer that wires Project, Worktree, Thread, Cron, notification, runtime-event, and persistence state together. Several seams already exist, so the next refactor should move state shape and transition functions behind a small shell-state Module instead of inventing new UI behavior.

The follow-up Module should preserve these tested invariants:

- Project selection clears stale Worktree and Thread selection.
- Worktree selection clears stale Thread selection and then opens or creates the appropriate Thread only when the active Worktree is stable.
- Thread selection always moves the primary view back to chat and owns the Project/Worktree context implied by the Thread.
- Persisted startup restoration treats Project and Worktree reopens as tentative until Backend RPCs confirm them.
- Context Focus events reconcile Project/Worktree/Thread navigation without changing unrelated shell state.

## Current state

Observed orchestration still owned directly by `src/mainview/App.tsx` includes:

- **Project and Worktree collections:** `projectStore`, `projectStates`, `worktreeStates`, and helper callbacks such as `replaceProjects`, `upsertProject`, `setProjectState`, `setWorktreeState`, and `clearProjectState`.
- **Thread collection and selected transcript state:** `threadStore`, `selectedThreadId`, `threadMessages`, transcript payload caches, and callbacks such as `replaceThreads`, `upsertThread`, `removeThread`, `replaceSelectedThreadMessageHistory`, and history backfill helpers.
- **Shell selection:** `selectedProjectId`, `selectedWorktreePath`, `primaryView`, mobile navigation state, and transition-wrapped setters used for navigation updates.
- **Persistence:** `initialMainviewStateRef`, debounced `schedulePersistedMainviewStateWrite`, and serialized selected Project/Worktree/Thread/open-Worktree state.
- **Cron and notifications:** `cronJobs` plus cron creator/edit state, `calendarNotifications`, `userNotifications`, notification tray state, and dismissal callbacks.
- **Runtime reconciliation refs:** selected context refs, active request ids, abort controllers, and event subscriptions for model catalog changes, thread status changes, Context Focus, cron changes, and calendar/user notifications.

Existing deeper Modules already own important parts of the Implementation:

- `src/mainview/thread-workspace-selection.ts` owns pure Project/Worktree/Thread transition rules.
- `src/mainview/app/use-thread-workspace-selection-controller.ts` owns thread opening, auto-creation, cross-workspace approval, Worktree clicks, and Context Focus side effects.
- `src/mainview/app/use-mainview-startup-controller.ts`, `src/mainview/startup-project-restore.ts`, and `src/mainview/startup-worktree-restore.ts` own startup restore reconciliation.
- `src/mainview/app/use-project-worktree-controller.ts`, `src/mainview/app/use-git-history-controller.ts`, `src/mainview/app/use-thread-status-controller.ts`, and `src/mainview/app/use-mainview-derived-state.ts` already remove major async and derived-state paths from `App.tsx`.

## Proposed shell seam

Recommended next Module name: `src/mainview/app/mainview-shell-state.ts`.

The Interface should stay small and testable:

- a `MainviewShellState` snapshot for selected Project, selected Worktree, selected Thread, primary view, open Worktrees, and readiness flags;
- transition helpers for selecting a Project, opening a Worktree, opening a Thread, applying Context Focus, restoring persisted startup state, and clearing stale Thread state;
- serialization helpers that decide what shell fields are durable enough to persist;
- runtime-event reconciliation helpers that convert Backend events into transition intents, leaving RPC calls and React rendering in existing controllers.

This should be a real seam only when it concentrates behavior now spread across `App.tsx`, `thread-workspace-selection.ts`, startup restore helpers, and controller glue. Do not create a pass-through Module that simply renames existing setters.

## Invariants and validation

Current validation surfaces:

- `src/mainview/thread-workspace-selection.test.ts` covers Project, Worktree, Thread, optimistic Thread, pinned-thread, selected-Thread reconciliation, selected-Worktree Thread sync, and Context Focus transition plans.
- `src/mainview/app/use-thread-workspace-selection-controller.test.tsx` covers stale Worktree clicks, stale Thread-open responses, immediate chat view selection, empty optimistic Thread cleanup, and create-request dedupe.
- `src/mainview/startup-project-restore.test.ts` covers tentative Project close/reopen behavior, selected Project fallback, and Thread-owned startup selection preservation.
- `src/mainview/startup-worktree-restore.test.ts` covers open-project filtering, selected Worktree fallback, and Thread-owned Worktree preservation when fallback is disabled.
- `src/mainview/app/use-mainview-startup-controller.test.ts` covers inline bootstrap hydration versus RPC fallback.
- `src/mainview/app/use-thread-status-controller.test.ts` covers thread-status polling, selected-detail polling throttles, empty-thread discard guards, and hidden-document polling suppression.

The next refactor should keep these tests green and add shell-state tests at the new Interface instead of testing React state setters through `App.tsx`.

## Adoption status

As of task `tg-01kr9hdhcb000002wg70zgbjje`, `src/mainview/app/mainview-shell-state.ts` owns the shell snapshot, transition wrapper, Project selection helper, selected Project/Worktree/Thread/primary-view commit boundary, persisted Mainview-state builder, debounced persisted-state writer, Project Worktree hydration updates, hidden Worktree menu hydration/open planning, optimistic Worktree pin planning/rollback, selected-Thread active Worktree reconciliation decisions, Thread start-request event state, Thread status event store acceptance/upsert decisions, selected-Thread detail refresh markers, and completed-Thread/mobile indicator decisions. The React-facing `use-mainview-shell-controller.ts` now owns initial persisted shell-state loading, selected-entity refs, primary-view transition wrappers, sidebar collapse persistence, mobile/completed Thread indicator state, and debounced persisted shell writes. Cron workspace lifecycle orchestration lives in `mainview-cron-workspace-controller.tsx`, so `App.tsx` composes the cron surface instead of carrying cron refresh, run/delete, editor, and folder-selection state inline. `App.tsx` now requests shell navigation, persistence, Project/Worktree hydration, Thread runtime reconciliation, and cron workspace operations through focused seams instead of manually coordinating selected entity refs, selected entity setters, primary-view changes, storage write scheduling, loaded Worktree cache updates, pin rollback shapes, start-request queue updates, raw Thread status event acceptance, completed indicator transitions, or cron controller state. Broader RPC orchestration remains in existing controllers for follow-up slices.

## Adoption strategy

1. Continue moving only pure selection/persistence decisions first; leave RPC and browser event subscriptions in controller hooks.
2. Rewire controllers to consume the shell-state Interface where it reduces duplicated setter knowledge.
3. Reconcile Project/Worktree hydration through the shell seam once navigation persistence is stable.
4. Collapse `App.tsx` toward composition after the transition Interface is stable and covered by focused tests.

## Non-goals

- No visual or styling changes.
- No Backend RPC contract changes.
- No new persisted storage version unless a future slice changes durable fields.
- No rewrite of existing controller hooks that are already deep enough for their current responsibilities.

## Related pages

- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)
