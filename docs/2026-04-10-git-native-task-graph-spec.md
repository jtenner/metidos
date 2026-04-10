# Specification: Minimal Git-Native Task Graph Filesystem

Date: 2026-04-10  
Repository: `metidos`  
Status: Draft v2  
Audience: Metidos runtime, Metidos UI, agent tool hosts, repository maintainers

## Summary

This document specifies a git-native task management system for repositories.

The system is intentionally minimal:

- the source of truth lives in repo files
- the task model is a graph
- each task gets its own folder
- all structured metadata, including task links, lives in a single `task.toml`
- long-form prose lives in `body.md`
- agents use normal file search and file edit tools for almost all task operations
- dedicated task tools are reduced to a very small admin surface

The default root is:

```text
.metidos/tasks/
```

The canonical layout is:

```text
.metidos/
  tasks/
    config.toml
    tags.toml          # optional
    types.toml         # optional
    items/
      tg-<id>/
        task.toml
        body.md
```

This version is a deliberate simplification of the earlier, more tool-heavy design.

The main design choice is:

- **task search is file search**
- **task mutation is file edit**
- **task linking is TOML edit**

That keeps the agent surface small and reduces confusion.

## Problem

Repo-native task systems usually fail in one of these ways:

1. they are just a flat tasks file
2. they centralize state in one giant JSON or YAML file
3. they hide state in a database
4. they add too many special tools, forcing agents to choose among overlapping ways to do the same thing

This spec is designed to avoid all four problems.

## Goals

- Keep the task graph in normal repository files.
- Make task state travel with Git branches and commits.
- Support multiple link kinds between tasks.
- Keep the canonical format understandable to humans.
- Make task changes small and merge-friendly.
- Reduce dedicated tool count and task-specific protocol complexity.
- Let existing file search and file edit capabilities do most of the work.

## Non-Goals

- This spec does not require a database.
- This spec does not require a daemon.
- This spec does not require a dedicated search API.
- This spec does not require a dedicated mutation API for ordinary task edits.
- This spec does not define a complete UI.
- This spec does not attempt to replace GitHub issues everywhere.

## Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used in the RFC 2119 sense.

## Design Principles

### 1. Git is the versioning system

The task graph gets history from commits, branches, merges, rebases, cherry-picks, and pull requests.

### 2. One task, one folder

Each task lives in one directory. Most edits touch one task and one or two files.

### 3. One structured metadata file per task

All structured metadata for a task SHOULD live in `task.toml`.

That includes:

- identity
- status
- priority
- type
- tags
- assignees
- links to other tasks

There is no separate `edges.toml` in this simplified version.

### 4. Long prose stays in Markdown

Long descriptions, acceptance criteria, rollout notes, and context belong in `body.md`.

### 5. No task-specific search protocol

Searching tasks SHOULD happen through ordinary file search over `.metidos/tasks/items/**`.

### 6. No task-specific mutation protocol for ordinary edits

Most task edits SHOULD happen through normal file editing tools constrained to `.metidos/tasks/**`.

### 7. Keep the special tool surface tiny

The only strongly justified dedicated task tools are:

- `init_task_graph`
- `validate_task_graph`
- `normalize_task_graph`

Everything else should usually be a file read, file search, or file edit.

### 8. Prefer one canonical direction for dependency links

To make “ready work” simple, each task stores the tasks that block it, not the tasks it blocks.

That means this spec uses:

- `blockers`

instead of:

- `blocks`

for the canonical dependency direction.

This choice is deliberate:

- a task declares its own prerequisites
- readiness is derived from the task itself
- the shape is easy for humans and agents to understand

## Why This Shape

This spec intentionally chooses:

- `TOML` for structured metadata
- `Markdown` for prose
- one folder per task
- normal file search for discovery
- normal file edit for mutation

instead of:

- a giant YAML file
- a database
- a custom graph protocol
- a large task-specific tool surface

The main reason is operational clarity. Agents already know how to search files and edit files. Reusing those primitives is better than teaching them a second overlapping abstraction unless the additional tool is clearly necessary.

## Canonical Filesystem Layout

### Root Layout

The default root for a conforming repository is:

```text
.metidos/tasks/
```

Canonical layout:

```text
.metidos/
  tasks/
    config.toml
    tags.toml
    types.toml
    items/
      tg-01jv4e4m0j0s8s8av9drw6m5vw/
        task.toml
        body.md
      tg-01jv4e87rqv3g2c85gw4w2kq5n/
        task.toml
        body.md
```

Optional non-canonical cache artifacts MAY exist, for example:

```text
.metidos/cache/tasks/...
```

Those caches MUST be gitignored and MUST NOT be treated as source of truth.

All canonical files under `.metidos/tasks/` SHOULD be committed unless a repository intentionally chooses to keep the task graph private or branch-local.

### Required Files

| Path | Required | Purpose |
| --- | --- | --- |
| `.metidos/tasks/config.toml` | Yes | Repo-level schema and defaults |
| `.metidos/tasks/items/<task-id>/task.toml` | Yes | Structured task metadata and links |
| `.metidos/tasks/items/<task-id>/body.md` | Yes | Long-form Markdown body |

### Optional Files

| Path | Optional | Purpose |
| --- | --- | --- |
| `.metidos/tasks/tags.toml` | Yes | Registered / recommended tags |
| `.metidos/tasks/types.toml` | Yes | Registered custom task types |

### Path Rules

- All canonical files MUST be UTF-8 text.
- All canonical files MUST use LF line endings.
- Task directories MUST be named only by task ID.
- Task directories MUST NOT include title slugs or status markers.

That rule matters because:

- title changes should not rename paths
- status changes should not move folders
- assignment changes should not move folders

## Repository Config

### `.metidos/tasks/config.toml`

Minimal example:

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

### Required keys

| Key | Type | Meaning |
| --- | --- | --- |
| `schema` | string | MUST be `metidos.task-graph/v2` |
| `id_prefix` | string | Prefix used for generated task IDs |
| `body_format` | string | MUST be `markdown` in v2 |

### Optional keys

| Key | Type | Meaning |
| --- | --- | --- |
| `strict_tags` | boolean | If true, tags MUST be present in `tags.toml` |
| `strict_types` | boolean | If true, types MUST be core types or registered in `types.toml` |
| `defaults.type` | string | Default task type |
| `defaults.status` | string | Default task status |
| `defaults.priority` | string | Default priority |

## Task Identity

### ID Format

Task IDs MUST be unique within a repository and SHOULD be collision-resistant across branches.

Recommended format:

```text
tg-<lowercase-ulid>
```

Recommended regex:

```text
^tg-[0-9a-hjkmnp-tv-z]{26}$
```

Example:

```text
tg-01jv4e4m0j0s8s8av9drw6m5vw
```

### Why ULIDs

ULIDs are recommended because they are:

- stable
- branch-safe enough for decentralized creation
- lexicographically sortable
- easy to use as both ID and folder name

## Task Directory Specification

Each task lives in:

```text
.metidos/tasks/items/<task-id>/
```

Each task directory contains exactly two canonical files in v2:

- `task.toml`
- `body.md`

## `task.toml`

Example:

```toml
schema = "metidos.task/v2"
id = "tg-01jv4e4m0j0s8s8av9drw6m5vw"
title = "Refactor auth token refresh flow"
type = "feature"
status = "open"
priority = "p1"
severity = "high"
size = "m"
created_at = "2026-04-10T15:00:00Z"
created_by = "metidos"
assignees = ["agent"]
tags = ["area:auth", "discipline:backend", "release:v0.8"]
milestone = "v0.8"
closed_at = ""

[blockers]
tasks = ["tg-01jv4e87rqv3g2c85gw4w2kq5n"]

[related]
tasks = ["tg-01jv4eb8h5j0hv8d0v4yq0w6pt"]

[docs_for]
tasks = ["tg-01jv4f2s1kdb3r9kkwqdb7a83"]

[tests_for]
tasks = ["tg-01jv4f2s1kdb3r9kkwqdb7a83"]

[parent]
task = "tg-01jv4dn18j9w9w2y9knh7zmx1"
```

### Required keys

| Key | Type | Meaning |
| --- | --- | --- |
| `schema` | string | MUST be `metidos.task/v2` |
| `id` | string | Task ID |
| `title` | string | Short human-readable title |
| `type` | string | Task type |
| `status` | string | Task status |
| `priority` | string | Priority enum |
| `created_at` | string | RFC 3339 UTC timestamp |

### Optional scalar / array keys

| Key | Type | Meaning |
| --- | --- | --- |
| `created_by` | string | Tool / user / agent identifier |
| `severity` | string | Optional severity, usually for `bug` or `risk` |
| `size` | string | Optional size |
| `assignees` | array<string> | Assigned humans or agents |
| `tags` | array<string> | Lightweight labels |
| `milestone` | string | Milestone / release bucket |
| `closed_at` | string | RFC 3339 UTC timestamp for terminal statuses |

### Link sections

Link sections are ordinary TOML tables inside `task.toml`.

Core multi-target sections:

- `[blockers]`
- `[related]`
- `[implements]`
- `[docs_for]`
- `[tests_for]`
- `[caused_by]`
- `[mitigates]`
- `[duplicates]`
- `[supersedes]`
- `[references]`

Each multi-target section uses:

```toml
[section_name]
tasks = ["tg-...", "tg-..."]
```

Core single-target section:

- `[parent]`

It uses:

```toml
[parent]
task = "tg-..."
```

### Link reference format

Task references in link sections MUST use task directory names, which in this spec are identical to task IDs.

That means link values MUST be task IDs like:

```text
tg-01jv4e87rqv3g2c85gw4w2kq5n
```

The phrase “task folder” in this spec therefore means the task’s directory name / ID, not an arbitrary filesystem path string.

### Key ordering

Conforming writers SHOULD emit `task.toml` in this stable order:

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

Within link arrays:

- values MUST be unique
- values SHOULD be sorted lexicographically

## `body.md`

`body.md` is the long-form Markdown body of the task.

It MAY contain:

- problem statement
- acceptance criteria
- rollout notes
- verification notes
- examples
- risks
- decisions
- checklists

It SHOULD NOT be used to encode structured graph relationships. Those belong in `task.toml`.

Example:

```md
Refactor the token refresh path so refresh failures do not silently log users out.

## Acceptance

- expired access token triggers refresh once
- invalid refresh token clears session
- race conditions are covered by tests
```

## Task Types

V2 defines the following core task types:

| Type | Meaning |
| --- | --- |
| `task` | Generic work item |
| `feature` | User-visible capability or product increment |
| `bug` | Defect or regression |
| `docs` | Documentation deliverable |
| `risk` | Risk record or mitigation target |
| `blocker` | Unblocking item |
| `epic` | Container item for grouped work |
| `spike` | Time-boxed exploration |
| `chore` | Maintenance work |
| `decision` | Decision record represented as a task |
| `test` | Verification or test implementation |
| `refactor` | Structural code improvement |
| `research` | Investigation or comparison task |

### Type rules

- Every task MUST have exactly one `type`.
- Types are first-class metadata, not tags.
- Repositories MAY register custom types in `types.toml`.
- If `strict_types = true`, only core or registered types are valid.

## Status Model

V2 defines these core statuses:

| Status | Terminal | Meaning |
| --- | --- | --- |
| `open` | No | Available but not started |
| `in_progress` | No | Actively being worked |
| `blocked` | No | Explicitly blocked for a reason not captured fully by current links |
| `done` | Yes | Completed |
| `cancelled` | Yes | Intentionally dropped |
| `duplicate` | Yes | Duplicate of another task |

### Status rules

- `closed_at` SHOULD be present only for terminal statuses.
- `duplicate` SHOULD usually be paired with a `[duplicates]` link.
- `blocked` is manual state and does not replace blocker link analysis.

## Priority, Severity, And Size

### Priority

Priority is required and MUST be one of:

- `p0`
- `p1`
- `p2`
- `p3`
- `p4`

### Severity

Severity is optional and SHOULD be used mainly for `bug` and `risk`.

Allowed values:

- `critical`
- `high`
- `medium`
- `low`

### Size

Size is optional and MAY be one of:

- `xs`
- `s`
- `m`
- `l`
- `xl`

## Tags

Tags are lightweight labels.

### Tag grammar

Tags SHOULD use lowercase kebab-case and MAY use namespaced form like `area:auth`.

Recommended regex:

```text
^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[a-z0-9]+(?:[._-][a-z0-9]+)*)?$
```

Examples:

- `area:auth`
- `discipline:backend`
- `platform:web`
- `release:v0.8`
- `theme:reliability`

### Recommended tag namespaces

| Namespace | Meaning |
| --- | --- |
| `area:` | Broad product or code area |
| `component:` | Specific subsystem |
| `discipline:` | Backend/frontend/infra/security/docs/test |
| `platform:` | web/mobile/server/cli/windows/linux/macos |
| `release:` | Release or milestone |
| `theme:` | performance/reliability/security/usability |
| `customer:` | Customer/account/workspace grouping |
| `source:` | Discovery source |

### `tags.toml`

Repositories MAY register preferred tags:

```toml
schema = "metidos.task-tags/v2"

[[tag]]
name = "area:auth"
description = "Authentication and authorization"
exclusive_group = "area"
```

### Tag rules

- Tags MUST be unique per task.
- Tags SHOULD be sorted lexicographically.
- If strict tag mode is enabled, tags MUST be present in `tags.toml`.

## Link Kinds

V2 intentionally fixes a small core set of link sections instead of offering arbitrary custom edge kinds. This is a complexity reduction, not a limitation by accident.

Core link sections:

| Section | Cardinality | Meaning |
| --- | --- | --- |
| `blockers.tasks` | many | Tasks that must complete before this task is ready |
| `related.tasks` | many | Semantically related tasks |
| `implements.tasks` | many | This task implements those tasks |
| `docs_for.tasks` | many | This task documents those tasks |
| `tests_for.tasks` | many | This task validates those tasks |
| `caused_by.tasks` | many | This task exists because of those tasks |
| `mitigates.tasks` | many | This task mitigates those tasks, typically risks |
| `duplicates.tasks` | many | This task duplicates those tasks; usually one target |
| `supersedes.tasks` | many | This task replaces those tasks |
| `references.tasks` | many | Loose references |
| `parent.task` | one | Parent / epic / container task |

### Why fixed sections

This spec intentionally chooses fixed link sections because:

- they are easier for humans to learn
- they are easier for agents to edit reliably
- they avoid a registry and custom-section explosion
- they reduce validator and renderer complexity

If future needs justify custom link kinds, that can be added in a later schema version.

## Derived Views And Algorithms

### Search

Task search is intentionally not a special protocol.

Implementations SHOULD search these files using existing file search:

- `.metidos/tasks/items/**/task.toml`
- `.metidos/tasks/items/**/body.md`

That means:

- title search is ordinary text search
- tag search is ordinary text search
- body search is ordinary text search
- ID search is ordinary text search

Hosts MAY layer better UI on top, but the underlying primitive does not need to be a dedicated task search tool.

### Ready Work

A task is **ready** in v2 if all of the following are true:

1. `status == "open"`
2. `blockers.tasks` is absent or empty, or every referenced blocker task is terminal

Terminal statuses are:

- `done`
- `cancelled`
- `duplicate`

### Blocked View

A task is blocked by dependency analysis if:

- it is non-terminal
- and `blockers.tasks` contains at least one non-terminal referenced task

### Parent / Child View

Children are derived by scanning for tasks whose `[parent].task` points to a given task.

Children are not stored canonically as a mirrored array on the parent task.

### Duplicate View

A task is duplicate-tracked if:

- `status == "duplicate"`
- and `[duplicates].tasks` contains at least one target

## Merge And Conflict Model

### Why this shape merges cleanly

This spec avoids:

- a giant shared graph file
- global counters
- mirrored backlinks
- path renames for status/title changes
- a second edge file

That means:

- ordinary metadata edits usually touch one file
- body edits usually touch one file
- link edits usually touch one file

### Canonical formatting rules

Writers SHOULD:

- sort `assignees`
- sort `tags`
- sort every `*.tasks` array
- omit empty link sections unless preserving existing content intentionally
- avoid rewriting unrelated keys

### Atomic write rules

Writers SHOULD:

1. read the current file
2. validate the requested shape
3. write a temp file
4. replace the canonical file atomically

### Normalization

Implementations SHOULD provide a normalization pass that:

- sorts keys and arrays canonically
- removes duplicate tags
- removes duplicate links
- removes empty link tables when policy allows
- preserves semantics while minimizing diff churn

## Validation Rules

A conforming validator MUST reject:

- invalid task IDs
- duplicate task IDs
- missing `task.toml`
- missing `body.md`
- invalid core statuses
- invalid core priorities
- invalid core types when strict mode is enabled
- invalid tags when strict mode is enabled
- self-references in any link section
- links to missing task IDs
- invalid `[parent].task` references

A validator SHOULD warn on:

- `duplicate` tasks with no `[duplicates]` section
- `docs` tasks with no `[docs_for]`
- `test` tasks with no `[tests_for]`
- `blocker` tasks with no incoming references and no strong justification in body text
- `epic` tasks with no children

## Minimal Tool Model

## Principle

The point of this section is to reduce tool count, not increase it.

### What should NOT be a dedicated task tool

These SHOULD NOT be dedicated task tools in the default design:

- task search
- task listing built from search
- task metadata mutation
- task body mutation
- task linking
- tag assignment

Those actions SHOULD happen through normal file search and file edit tools against `.metidos/tasks/**`.

### Recommended dedicated tools

Only these dedicated task tools are recommended by default:

| Tool | Purpose |
| --- | --- |
| `init_task_graph` | Scaffold `.metidos/tasks/` |
| `validate_task_graph` | Validate canonical files |
| `normalize_task_graph` | Rewrite canonical files into stable canonical form |

### Recommended runtime toggles

Because task edits happen through ordinary file tools, tool toggling should be expressed as access policy, not as a large dedicated task tool family.

Recommended host-level policy toggles:

| Toggle | Meaning |
| --- | --- |
| `taskGraphFiles` | Existing file search/edit tools may read and write `.metidos/tasks/**` |
| `taskGraphAdmin` | Admin tools `init_task_graph`, `validate_task_graph`, and `normalize_task_graph` may run |

These toggles are runtime policy. They are not stored canonically in the repository task graph.

### Why runtime policy instead of repo-stored tool policy

Tool policy belongs to the host application and execution environment, not the repository graph itself.

That is why this simplified version removes the earlier `tooling.toml` design.

## Dedicated Tool Specifications

### 1. `init_task_graph`

Purpose:

- create the minimal task graph layout

Input:

```json
{
  "idPrefix": "tg",
  "strictTags": false,
  "strictTypes": false
}
```

Files touched:

- `.metidos/tasks/config.toml`
- optional empty `tags.toml`
- optional empty `types.toml`

Behavior:

- MUST create `.metidos/tasks/` if absent
- MUST NOT overwrite existing files unless an explicit future force mode is defined

### 2. `validate_task_graph`

Purpose:

- validate canonical task files

Input:

```json
{
  "taskIds": ["optional", "subset"]
}
```

Files touched:

- none

Behavior:

- MUST be read-only
- MUST return machine-readable errors and warnings

### 3. `normalize_task_graph`

Purpose:

- canonicalize formatting and ordering

Input:

```json
{
  "taskIds": ["optional", "subset"]
}
```

Files touched:

- any canonical task files that require normalization

Behavior:

- MUST preserve semantics
- MUST sort arrays canonically
- MUST de-duplicate tags and link targets
- SHOULD avoid noisy rewrites

## Recommended Editing Patterns

These are not dedicated tools. They are patterns agents and humans should follow when using ordinary file editing.

### Creating a new task

1. Create a new folder under `.metidos/tasks/items/<new-id>/`
2. Write `task.toml`
3. Write `body.md`

### Linking blockers

Edit the current task’s `task.toml`:

```toml
[blockers]
tasks = [
  "tg-01jv4e87rqv3g2c85gw4w2kq5n",
  "tg-01jv4f2s1kdb3r9kkwqdb7a83"
]
```

### Adding documentation linkage

Edit the docs task’s `task.toml`:

```toml
[docs_for]
tasks = ["tg-01jv4f2s1kdb3r9kkwqdb7a83"]
```

### Adding parent relationship

Edit the child task’s `task.toml`:

```toml
[parent]
task = "tg-01jv4dn18j9w9w2y9knh7zmx1"
```

## Example

### Example repository state

```text
.metidos/
  tasks/
    config.toml
    items/
      tg-01jv4dn18j9w9w2y9knh7zmx1/
        task.toml
        body.md
      tg-01jv4e4m0j0s8s8av9drw6m5vw/
        task.toml
        body.md
      tg-01jv4e87rqv3g2c85gw4w2kq5n/
        task.toml
        body.md
```

### Example task

```toml
schema = "metidos.task/v2"
id = "tg-01jv4e4m0j0s8s8av9drw6m5vw"
title = "Refactor auth token refresh flow"
type = "feature"
status = "open"
priority = "p1"
created_at = "2026-04-10T15:00:00Z"
tags = ["area:auth", "discipline:backend"]

[blockers]
tasks = ["tg-01jv4e87rqv3g2c85gw4w2kq5n"]

[parent]
task = "tg-01jv4dn18j9w9w2y9knh7zmx1"
```

Interpretation:

- this task is open
- it belongs under the parent epic `tg-01jv4dn18j9w9w2y9knh7zmx1`
- it is not ready until blocker `tg-01jv4e87rqv3g2c85gw4w2kq5n` is terminal

## Metidos Integration Notes

### Runtime role

Metidos should treat this task graph as:

- repo-native source of truth
- plain files that travel with commits
- a graph discoverable by existing search tools
- a graph editable by existing file edit tools

### Recommended host behavior

1. Reuse existing file search for discovery.
2. Reuse existing file read/edit for ordinary task work.
3. Keep dedicated task tools to `init`, `validate`, and `normalize`.
4. Constrain generic file edits to `.metidos/tasks/**` when task graph access is enabled.
5. Optionally maintain an ignored local index for UI speed.

### Optional local cache

An implementation MAY maintain a derived ignored cache such as:

```text
.metidos/cache/tasks/index.sqlite
```

or

```text
.metidos/cache/tasks/index.json
```

That cache:

- is optional
- is derived
- is not canonical
- MUST be gitignored

## Recommended Future Work

- add task templates
- add a canonical renderer for tree/graph views
- add import/export bridges to GitHub issues
- add a stricter transition policy layer if needed
- add better UI affordances on top of normal file search/edit

## Final Recommendation

If the goal is a git-native task graph with low agent confusion, the right design is:

- tasks live in folders
- one `task.toml` plus one `body.md` per task
- task links live directly in `task.toml`
- existing file search finds tasks
- existing file edits modify tasks
- only a tiny dedicated admin tool surface remains

That is simpler than the earlier design, more aligned with how agents already work, and still preserves the important properties:

- graph structure
- Git-friendly diffs
- multiple link kinds
- standardized taxonomy
- repo-native history
