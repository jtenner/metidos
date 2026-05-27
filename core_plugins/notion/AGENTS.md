# AGENTS for Notion

## Purpose

This first-party core plugin exposes safe Notion REST API helpers to approved Metidos threads. It registers:

- `notion_search`, `notion_fetch`, and `notion_query_data_source` through the **Notion - Read** access group.
- `notion_create_page`, `notion_update_page`, and `notion_comment` through the **Notion - Write** access group.

The plugin talks only to `https://api.notion.com/v1/**` using `Notion-Version: 2026-03-11`. It does not expose token lifecycle, raw block deletion, schema management, page moves, file uploads, views, or webhooks as agent tools.

## Source layout

- `metidos-plugin.json`: Plugin System v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point and Notion REST client helpers.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; `semantic_search` may create derived LanceDB-style vector cache files here.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

1. Validate `core_plugins/notion/metidos-plugin.json` against `docs/metidos-plugin.schema.json`.
2. Run plugin manifest/startup validation where practical, for example `bun test src/bun/plugin/manifest.test.ts src/bun/plugin/examples.test.ts` plus any core-plugin validation available in the current branch.
3. Confirm no root `node_modules/` exists.
4. Confirm imports are local or `@metidos/plugin-api`.

## `.data` contents

This plugin has no seed data. `.data/` may be empty, or it may contain a derived semantic-search vector cache produced from bounded Notion search summaries. That cache is regenerable and should not be treated as source of truth.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files if future versions add any.
- Do not edit `.data` while the plugin sidecar is running unless future docs explicitly allow it.

## Safe `.data` repair

Use Metidos Reset Plugin Data for unknown `.data` contents or corrupted semantic-search cache files. There are currently no documented hand-editable data files for this plugin.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, copies `seed/**` if present, and restarts/reloads the plugin. Because this plugin has no seed files, reset only recreates an empty data directory. Plugin Settings and env vars are not stored in `.data` and must remain configured separately.

## Secrets and logs

Configure credentials outside chat through one of:

1. `api_key` Plugin Setting.
2. Host env var `NOTION_API_KEY`.

The plugin must not log or return API keys. Notion error bodies may be included in thrown errors or tool results only in truncated form and should not contain credentials.

## Context notes

- Tools run in thread tool contexts only.
- The plugin has no project file, terminal, cron, provider, notification, or websocket permissions. It does have plugin-owned storage/vector permissions for the derived semantic-search cache.
- `notion_update_page` can trash a page through `in_trash`; only enable **Notion - Write** for threads trusted to mutate Notion content.
- `notion_comment` is in **Notion - Write** because the same tool can create comments.
- Notion integration capabilities are still enforced by Notion. Configure the Notion connection with the least capabilities needed: read content for read tools, insert/update content for page creation/update, and read/insert comments for comments.

## Embeddings and vector search

`semantic_search` consumes Metidos embeddings and stores a derived LanceDB-style vector cache in plugin-owned data. Keep `metidos:can_embed`, `metidos:lancedb`, and `storage:write` in sync with that tool. The cache is derived from bounded Notion search result summaries and can be regenerated; do not store Notion API keys, raw headers, or unnecessary page bodies in vectors or logs.
