# Workflow: Task Graph Admin Tooling

Date: 2026-04-12  
Repository: `metidos`

## Summary

- The repository now exposes exactly three dedicated task-graph admin tools:
  - `init_task_graph`
  - `validate_task_graph`
  - `normalize_task_graph`
- Those tools operate on the current workspace's canonical task graph at `.metidos/tasks/`.
- They are intentionally narrow. They do not replace ordinary task editing.
- Creating, editing, linking, closing, or deleting individual tasks should still happen through the normal file/search/edit tools against canonical task files.

## Runtime Gating

Two runtime conditions must be true before an agent can use these helpers:

1. The thread must have `metidosAccess` so the Pi-native Metidos tool pack is installed.
2. The runtime host must also allow `taskGraphAdmin`.

In the current Bun implementation, `taskGraphAdmin` is a host/runtime capability, not repository state. The Pi Metidos host currently derives that capability from administrator context. When the capability is absent, the admin tools fail cleanly instead of silently mutating files.

That split is intentional:

- `metidosAccess` installs the broader Metidos tool pack
- `taskGraphAdmin` narrows the high-impact task-graph helpers to explicitly allowed runtimes

## Use Normal File Tools For Routine Task Work

Use ordinary file tools for:

- creating a new task directory under `.metidos/tasks/items/<task-id>/`
- editing `task.toml` or `body.md`
- adding or removing blocker links
- updating status, priority, size, or tags
- removing a completed task from the canonical graph

Do not add bespoke admin-tool mutations for those operations. The repo intentionally keeps task maintenance git-native and file-based.

## Use Admin Tools Only For Repository-Level Maintenance

Use `init_task_graph` when:

- a repository does not yet have `.metidos/tasks/`
- you need the minimal canonical scaffold created without overwriting existing files

Use `validate_task_graph` when:

- you want machine-readable errors and warnings after manual task edits
- you want to validate either the full graph or a known task-id subset

Use `normalize_task_graph` when:

- you want canonical ordering and formatting restored after edits
- you want stable no-op rewrites instead of ad hoc manual cleanup

## Current Tool Contracts

The current structured result shapes are defined in [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts), and the live host wiring is in [src/bun/project-procedures.ts](../src/bun/project-procedures.ts) plus [src/bun/pi-metidos-tools.ts](../src/bun/pi-metidos-tools.ts).

All three tools return:

- a short human-readable summary string
- a structured details payload suitable for agents and the UI

### `init_task_graph`

Purpose:

- scaffold the canonical task-graph root for the current workspace

Input:

- `createTagsRegistry?: boolean`
- `createTypesRegistry?: boolean`
- `idPrefix?: string`
- `strictTags?: boolean`
- `strictTypes?: boolean`

Structured result:

- `config`
  - `schema`
  - `idPrefix`
  - `bodyFormat`
  - `strictTags`
  - `strictTypes`
  - `defaults`
- `paths`
  - `root`
  - `config`
  - `items`
  - `tags`
  - `types`
- `status`
  - `root`
  - `items`
  - `config`
  - `tags`
  - `types`

Status values are:

- `created`
- `existing`
- `skipped`

Behavior:

- creates missing canonical directories/files
- does not clobber existing canonical files
- can optionally seed empty `tags.toml` and `types.toml`

### `validate_task_graph`

Purpose:

- validate the canonical task graph without mutating files

Input:

- `taskIds?: string[]`

Structured result:

- `ok`
- `root`
- `validatedTaskIds`
- `findings`
- `errors`
- `warnings`

Each finding includes:

- `severity`
- `code`
- `message`
- `path`
- `field`
- `taskId`
- `relatedTaskId`

Behavior:

- read-only
- supports whole-repository or task-id-subset validation
- still resolves links against the full repository graph when a subset is requested

### `normalize_task_graph`

Purpose:

- rewrite canonical task-graph files into stable normalized form

Input:

- `taskIds?: string[]`

Structured result:

- `root`
- `normalizedTaskIds`
- `changedFiles`
- `unchangedFiles`

Each file entry includes:

- `changed`
- `fileKind`
- `path`
- `taskId`

Behavior:

- preserves semantics
- rewrites only files whose canonical output changed
- supports whole-repository or task-id-subset normalization

## Recommended Maintainer And Agent Flow

1. If the repository does not yet have `.metidos/tasks/`, run `init_task_graph`.
2. Make normal task edits directly in canonical files.
3. Run `validate_task_graph`.
4. If formatting/order drift is present, run `normalize_task_graph`.
5. Run `validate_task_graph` again before committing if the graph changed materially.

For mature repositories that already have the graph scaffolded, the common loop is:

1. edit files directly
2. validate
3. normalize if needed
4. validate again

## What This Workflow Deliberately Does Not Add

It does not add custom admin tools for:

- creating a single task
- updating task metadata fields
- linking tasks together
- closing tasks
- deleting completed tasks

Those remain normal file operations so the repository task graph stays transparent, diffable, and easy to repair with standard tooling.
