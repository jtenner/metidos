# AGENTS for Himalayas Jobs

## Purpose

First-party plugin for remote job search via the free Himalayas Remote Jobs API. It registers the `search_remote_jobs` agent tool, requires no API key, and fetches only `https://himalayas.app/jobs/api/search`. Tool output is markdown with visible Himalayas attribution and canonical `applicationLink` apply URLs.

## Source layout

- `metidos-plugin.json`: v1 manifest, network allowlist, and job search access group.
- `index.ts`: plugin entry point, input validation, Himalayas API request builder, de-duplication, and markdown table formatter.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; this plugin does not intentionally create data files.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

1. Validate `metidos-plugin.json` against the Metidos Plugin Manifest v1 schema.
2. Confirm `index.ts` imports only `@metidos/plugin-api`.
3. Confirm no root `node_modules/` exists.
4. Optional live test: approve the plugin, enable `himalayas_jobs/job_search_tools` on a test thread, then call `search_remote_jobs` with `{ "query": "software engineer", "country": "US", "seniority": "Senior", "employmentType": "Full Time", "sort": "recent", "page": 1 }`.

## `.data` contents

This plugin has no persistent state and should not create `.data` files during normal operation. It de-duplicates jobs within each response by `guid` but does not store saved-search state.

## Safe `.data` inspection

- Prefer read-only inspection.
- Unexpected `.data` files can usually be treated as transient artifacts after confirming they are not needed by a local operator.
- Do not edit `.data` while the plugin sidecar is running unless these docs are updated to declare a repairable file.

## Safe `.data` repair

No manual `.data` repair is expected. Use Metidos Reset Plugin Data if unexpected runtime files need to be cleared.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No plugin settings or secrets are required or recreated by reset.

## Secrets and logs

No API key or other secret is required. The plugin logs only successful search query text when plugin logging is enabled. Avoid logging full result payloads or user-sensitive search terms if behavior changes.

## Context notes

`search_remote_jobs` is a thread tool. It does not read or write project files and does not require storage. Network access must stay limited to Himalayas HTTPS job API endpoints. Himalayas requests visible attribution and says not to submit its jobs to third-party job websites such as LinkedIn Jobs, Google Jobs, Jooble, or similar boards.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
