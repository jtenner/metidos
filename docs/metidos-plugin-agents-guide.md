# Plugin `AGENTS.md` guide

Every Metidos plugin must include an `AGENTS.md` at the plugin root. The file is part of the review hash and should be written for future humans and agents who need to inspect, repair, or validate the plugin without guessing.

Use this guide as a template when authoring a plugin-specific `AGENTS.md`. Agents creating or repairing plugins should also use the repository skill at [`.pi/skills/metidos-plugin-authoring/SKILL.md`](../.pi/skills/metidos-plugin-authoring/SKILL.md), which points back to this guide, the authoring guide, the JSON Schema, and the copyable examples.

## Required sections

### Purpose

Describe what the plugin does, which Metidos capabilities it registers, and which external services or local files it may touch.

### Source layout

List source files and generated files. At minimum, identify:

- `metidos-plugin.json`
- `index.ts`
- `AGENTS.md`
- optional local source modules
- optional `seed/`
- generated `.data/`
- generated `.logs/`
- generated `.data-bak-*` reset backups

State that root `node_modules/` is forbidden.

### Validation commands

Document the plugin's local validation workflow. Include manifest validation, example input validation, and any safe dry-run checks. If the plugin has no custom validation command yet, say so explicitly and point to the Metidos manifest/schema validation path.

### `.data` contents

Explain every known file or directory under `.data`, including schemas, ownership, expected size, and whether it can be regenerated. Mention quota expectations when useful.

### Safe `.data` inspection

Give read-only inspection steps first. Prefer commands or workflows that do not mutate data. Warn operators not to inspect or copy files containing secrets unless necessary.

### Safe `.data` repair

Describe narrow repair workflows:

- which files can be edited by hand,
- which files should be regenerated,
- how to make a backup before edits,
- how to validate after repair,
- when to use Metidos Reset Plugin Data instead of manual edits.

### Reset behavior

Explain what happens when Metidos Reset Plugin Data runs for this plugin. Identify which seed files will be copied back and which local configuration must be recreated afterward.

### Secrets and logs

List where secrets may appear. State whether the plugin intentionally writes logs. Warn that v1 does not promise automatic redaction of plugin-authored log lines or tool results.

### Embeddings and vector search

State whether the plugin provides embedding models, consumes embeddings, stores LanceDB vectors, or intentionally does none of those things.

For embedding providers, document:

- why `metidos:provides_embeddings` is present,
- which provider callback implements `embed(context, request)`,
- how embedding-capable models are marked (`api: "embeddings"` or `compat.providesEmbeddings`),
- which upstream endpoint is called,
- which settings/env secrets authorize the upstream request,
- whether raw embedding input may leave the local machine.

For embedding consumers, document:

- why `metidos:can_embed` is present,
- which tool/cron/provider callback calls `metidos.embeddings.embed(...)`,
- what text or bytes are embedded,
- whether source content may contain project, external, or local-operator-private data,
- what is passed in the optional embedding payload,
- what happens if no runtime embedding model is configured.

For LanceDB/vector storage, document:

- why `metidos:lancedb` and `storage:write` are present,
- exact `~/` vector store paths,
- row ids and stored props schema,
- whether vector data is derived/regenerable or local-operator-authored/durable,
- cleanup/reindex/reset behavior,
- quota expectations and maximum result sizes,
- what content must not be logged or copied during inspection.

Plugins that do not use embeddings should say that explicitly so future changes broaden permissions intentionally rather than by accident.

### Context and permission notes

Summarize context-specific behavior that affects operation, for example:

- `./` project access works only in thread tool contexts.
- Crons have no current thread/project. Prefer `metidos.cron(...)` plus Plugin Settings.
- Terminal APIs are unavailable in cron.
- Calendar/event delete requires confirmation and fails in cron.
- Provider registration is initialization-only.
- Embedding provider registration is initialization-only; embedding consumers can call `metidos.embeddings.embed(...)` only with `metidos:can_embed`.
- Plugin LanceDB storage is plugin-owned `~/` data only and requires `metidos:lancedb` plus `storage:write`.

## Minimal plugin `AGENTS.md` template

```md
# AGENTS for {Plugin Name}

## Purpose

{Short purpose and registered capabilities.}

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point.
- `AGENTS.md`: this guide.
- `seed/`: optional first-activation seed data.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

1. Validate `metidos-plugin.json` against the Metidos Plugin Manifest v1 schema.
2. Run {plugin-specific validation command or "no custom command yet"}.
3. Confirm no root `node_modules/` exists.
4. Confirm imports are local or `@metidos/plugin-api`.

## `.data` contents

{Describe files, schemas, and whether each can be regenerated.}

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files unless needed for repair.
- Do not edit `.data` while the plugin sidecar is running unless the plugin docs explicitly allow it.

## Safe `.data` repair

1. Stop or disable the plugin if a repair mutates files.
2. Make a backup or use Metidos Reset Plugin Data.
3. Edit only the files listed as safe to repair.
4. Run validation again.
5. Restart/retry the plugin from Metidos settings.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, copies `seed/**`, and restarts/reloads the plugin. {Describe plugin-specific aftermath.}

## Secrets and logs

{Describe secret locations and logging behavior. Avoid intentional secret logging.}

## Embeddings and vector search

{Say whether this plugin provides embeddings, consumes embeddings, stores LanceDB vectors, or intentionally does none. If it stores vectors, list `~/` paths, row schema, regeneration/reset behavior, and sensitive-content rules.}

## Context notes

{Describe thread/cron/provider/notification/embedding context limitations relevant to this plugin.}
```
