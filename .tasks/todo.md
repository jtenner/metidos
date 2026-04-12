# Task Graph Guide

This repository treats `.metidos/tasks/` as canonical, repo-owned source of truth for the task graph. These files are not generated output and should be committed like normal source files. Derived caches belong under `.metidos/cache/` and stay gitignored.

This guide is based on the live task graph in `.metidos/tasks/` and the v2 spec in `docs/2026-04-10-git-native-task-graph-spec.md`.

Quick rule:

- commit `.metidos/tasks/**`
- ignore `.metidos/cache/**` and other generated artifacts
- do not apply the general "ignore generated files" rule to the canonical task graph

## Current Layout

```text
.metidos/
  tasks/
    config.toml
    tags.toml
    items/
      tg-<id>/
        task.toml
        body.md
```

Notes:

- `config.toml` is required and defines the repo-level task graph schema and defaults.
- `tags.toml` is optional in the spec but present in this repo and should be reused.
- `types.toml` is allowed by the spec but is not present in this repo today.
- Each task directory name is the task ID. Do not add title slugs or status markers to folder names.

## Repo-Level Files

### `.metidos/tasks/config.toml`

The current repo config is:

```toml
schema = "metidos.task-graph/v2"
id_prefix = "tg"
body_format = "markdown"
strict_tags = false
strict_types = false

[defaults]
type = "task"
status = "open"
priority = "p2"
```

Implications:

- New task IDs should use the `tg-` prefix.
- Task bodies are always Markdown in `body.md`.
- Tags and types are not strictly enforced by config right now, but new tasks should still prefer the existing tag set in `tags.toml` and the core types from the spec.

### `.metidos/tasks/tags.toml`

This repo already maintains a tag registry with entries such as:

- `area:*`
- `component:*`
- `discipline:*`
- `source:*`
- `theme:*`

Some tags are grouped with `exclusive_group`, for example the `area` and `discipline` namespaces.

## Task Directory Format

Each task lives in `.metidos/tasks/items/<task-id>/` and has exactly two canonical files:

- `task.toml`: structured metadata and graph links
- `body.md`: long-form task description

Recommended ID shape:

```text
tg-<lowercase-ulid>
```

The spec recommends a lowercase ULID after the prefix, and the existing repo data follows that pattern.

## `task.toml`

Every task file in this repo currently uses:

```toml
schema = "metidos.task/v2"
id = "tg-..."
title = "Short human title"
type = "feature"
status = "open"
priority = "p1"
size = "m"
created_at = "2026-04-12T16:24:00Z"
created_by = "codex"
assignees = ["agent"]
tags = ["area:agent-runtime", "discipline:backend"]
milestone = "audit-remediation-2026-04"

[parent]
task = "tg-..."
```

Required core keys:

- `schema`
- `id`
- `title`
- `type`
- `status`
- `priority`
- `created_at`

Common optional keys used in this repo:

- `created_by`
- `severity`
- `size`
- `assignees`
- `tags`
- `milestone`

The spec also allows `closed_at` for terminal statuses even though the current repo data does not use it yet.

### Types in Current Use

The live task graph currently uses these task types:

- `epic`
- `feature`
- `risk`
- `refactor`
- `docs`
- `test`
- `spike`

The spec also allows additional core types such as `task`, `bug`, `blocker`, `chore`, `decision`, and `research`.

### Status, Priority, Severity, Size

The spec defines:

- status: `open`, `in_progress`, `blocked`, `done`, `cancelled`, `duplicate`
- priority: `p0` through `p4`
- severity: `critical`, `high`, `medium`, `low`
- size: `xs`, `s`, `m`, `l`, `xl`

Current repo usage is mostly:

- statuses: `open`
- priorities: `p1`, `p2`, `p3`
- severity: used on `risk` tasks
- sizes: `s`, `m`, `l`, `xl`

### Link Tables

The graph is stored directly in `task.toml` as TOML tables. Current repo usage includes:

- `[parent]`
- `[blockers]`
- `[mitigates]`
- `[docs_for]`
- `[tests_for]`

Examples:

```toml
[blockers]
tasks = ["tg-01...", "tg-02..."]

[mitigates]
tasks = ["tg-03..."]

[parent]
task = "tg-04..."
```

Important conventions:

- `blockers` points to prerequisites of the current task.
- `parent` lives only on the child task. Children are derived by scanning for matching parent references.
- Link values are task IDs, not filesystem paths.
- Arrays should be unique and lexicographically sorted.
- Empty link tables should usually be omitted.

The spec also permits additional link kinds such as `related`, `implements`, `caused_by`, `duplicates`, `supersedes`, and `references`, but this repo is not using them at the moment.

### Preferred Key Order

Keep `task.toml` in this stable order:

1. `schema`
2. `id`
3. `title`
4. `type`
5. `status`
6. `priority`
7. `severity`
8. `size`
9. `created_at`
10. `created_by`
11. `assignees`
12. `tags`
13. `milestone`
14. `closed_at`
15. link tables in alphabetical order, with `[parent]` last

## `body.md`

`body.md` holds the long-form description. In this repo, common patterns are:

- short opening summary
- `## Scope`
- `## Notes`
- `## Signals`
- `## Desired Outcome`
- `## Acceptance`

Use `body.md` for prose, acceptance criteria, rollout notes, risks, or context. Do not encode structured task relationships here; keep graph structure in `task.toml`.

## Normal Workflow

The spec is intentionally file-first:

- task search is normal file search
- task reads are normal file reads
- ordinary task updates are normal file edits

In practice:

1. Search with `rg` under `.metidos/tasks/items/`.
2. Read both `task.toml` and `body.md` for the task you want.
3. Edit the task files directly.
4. Commit the task graph changes with the rest of the work when they are part of the same slice.

Useful searches:

```bash
rg -n 'status = "open"|priority = "p1"|area:auth' .metidos/tasks/items
rg -n 'Desired Outcome|Acceptance|telemetry' .metidos/tasks/items
```

## Creating a New Task

1. Generate a new `tg-...` ID in the same lowercase-ULID style already used in the repo.
2. Create `.metidos/tasks/items/<new-id>/`.
3. Add `task.toml`.
4. Add `body.md`.
5. Link the task from the new task itself, not from mirrored backlink arrays on other tasks unless the relationship semantics require it.

Minimal template:

```toml
schema = "metidos.task/v2"
id = "tg-01xxxxxxxxxxxxxxxxxxxxxxxx"
title = "Describe the work"
type = "feature"
status = "open"
priority = "p2"
created_at = "2026-04-12T00:00:00Z"
created_by = "codex"
assignees = ["agent"]
tags = ["area:task-graph", "discipline:docs"]

[parent]
task = "tg-01parenttaskidxxxxxxxxxxxx"
```

Minimal `body.md`:

```md
Short summary of the work.

## Scope

- first concrete slice
- second concrete slice

## Acceptance

- observable outcome one
- observable outcome two
```

Adjust the task type and metadata for the actual work. For `risk` items, add `severity`. For docs and test tasks, add `docs_for` or `tests_for` when the relationship is clear.

## Updating Existing Tasks

Common edits:

- change `status` as work moves
- add or remove blockers on the blocked task
- attach a task to an epic through `[parent]`
- connect documentation work with `[docs_for]`
- connect verification work with `[tests_for]`
- link mitigation work to risk tasks with `[mitigates]`

When a task reaches a terminal state, the spec expects:

- `status = "done"`, `status = "cancelled"`, or `status = "duplicate"`
- `closed_at` to be set to an RFC 3339 UTC timestamp

If a task is marked `duplicate`, add `[duplicates]` pointing at the canonical task.

## Derived Semantics

The spec defines a few views that matter when editing:

- A task is ready when `status = "open"` and all blockers are terminal.
- A task is dependency-blocked when any blocker is non-terminal.
- Child tasks are derived from `[parent]`; they are not stored on the parent.

This means you should usually edit only one side of the relationship:

- add blockers on the blocked task
- add parent on the child task

## Validation And Admin Tools

The v2 spec recommends only three dedicated admin tools:

- `init_task_graph`
- `validate_task_graph`
- `normalize_task_graph`

After inspecting this repo, those names appear in design docs and in task descriptions, but not in the current source tree as implemented runtime tools yet. For now, task graph maintenance is primarily manual file editing against `.metidos/tasks/**`, following the canonical format above.

The shared filesystem reader and canonical writer for those files now lives in `src/bun/project-procedures/task-graph-filesystem.ts`. The structured validator for canonical findings now lives in `src/bun/project-procedures/task-graph-validation.ts`, and the canonical rewrite pass now lives in `src/bun/project-procedures/task-graph-normalization.ts`. Future admin tooling should build on those modules rather than reparsing `.metidos/tasks/**` ad hoc.

Once admin tooling exists, the intended split is:

- use normal file edits for routine task creation and updates
- use admin tools only for scaffolding, validation, and canonical normalization

## Canonical Vs Generated

Keep this distinction explicit:

- `.metidos/tasks/**` is canonical and should be version controlled
- `.metidos/cache/**` is derived and should stay gitignored

Do not treat the task graph as generated output. It is part of the repository’s maintained source-of-truth data.
