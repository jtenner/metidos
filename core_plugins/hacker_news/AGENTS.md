# AGENTS for Hacker News

## Purpose

First-party Plugin System v1 tool plugin for Hacker News story lists. It registers three thread access groups:

- `Hacker News - Top Stories`, exposing `top_stories`.
- `Hacker News - New Stories`, exposing `new_stores` using the requested tool spelling.
- `Hacker News - Ask Stories`, exposing `ask_stories`.

The plugin fetches public JSON from the Hacker News Firebase API and returns markdown tables. It does not read project files, write plugin data, require secrets, send notifications, or use terminal access.

## Source layout

- `metidos-plugin.json`: manifest, network allowlist, access groups, and tool declarations.
- `index.ts`: plugin entry point and runtime fetch/cache behavior.
- `hacker-news.ts`: local parsing and markdown rendering helpers.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; this plugin should not create durable data.
- `.logs/`: generated plugin logs when enabled; this plugin does not request `log:write`.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. Validate the manifest against `docs/metidos-plugin.schema.json`.
2. Run the core Hacker News plugin test when present: `bun test src/bun/plugin/core-hacker-news-plugin.test.ts`.
3. Confirm no root `node_modules/` exists under `core_plugins/hacker_news/`.
4. Confirm imports are local files or `@metidos/plugin-api` only.

## `.data` contents

No durable `.data` files are expected. The plugin keeps only an in-memory, per-sidecar, 60-second cache for each story list.

## Safe `.data` inspection

- Prefer read-only inspection.
- If `.data/` exists, it is unexpected generated runtime state and can be inspected before removal.
- Do not edit `.data` while the plugin sidecar is running unless a future version documents a mutable schema.

## Safe `.data` repair

This plugin has no repairable `.data` schema. If unexpected data appears, disable the plugin and use Metidos Reset Plugin Data or remove the generated directory after making any needed backup.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No seed files or plugin settings need to be recreated.

## Secrets and logs

No secrets are required. The manifest only grants `network:fetch` to `https://hacker-news.firebaseio.com/v0/**`. The plugin does not request `log:write`; avoid adding logging that records story content unless the manifest and this guide are updated.

## Embeddings and vector search

This plugin does not provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.

## Context notes

- Tools run only in thread tool contexts after the corresponding access group is enabled.
- Network access is limited to the Hacker News Firebase API allowlist.
- The markdown tables include external source and Hacker News comment links, but the plugin does not fetch those external article/comment pages.
- The `new_stores` tool id intentionally preserves the requested spelling; do not rename it without coordinating access configuration and users.
