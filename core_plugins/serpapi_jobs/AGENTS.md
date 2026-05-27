# AGENTS for SerpApi Jobs

## Purpose

First-party plugin for Google Jobs, Google Light web search, YouTube search, and YouTube video transcript retrieval via SerpApi. It registers the `search_jobs`, `search_google`, `search_youtube`, and `fetch_youtube_transcript` agent tools, reads a SerpApi API key from the Plugin Setting or `SERPAPI_API_KEY`, reads default `google_domain`, `gl`, and `hl` localization settings, and fetches only `https://serpapi.com/search.json`.

## Source layout

- `metidos-plugin.json`: v1 manifest, env/settings declarations, Google domain/country/language defaults, network allowlist, and job search access group.
- `index.ts`: plugin entry point and Google Jobs / Google Search / YouTube Search / YouTube transcript result formatters.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; this plugin does not intentionally create data files.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

1. Validate `metidos-plugin.json` against the Metidos Plugin Manifest v1 schema.
2. Confirm `index.ts` imports only `@metidos/plugin-api`.
3. Confirm no root `node_modules/` exists.
4. Optional live test: configure a SerpApi key outside chat, approve the plugin, enable `serpapi_jobs/job_search_tools`, `serpapi_jobs/google_search_tools`, and/or `serpapi_jobs/youtube_tools` on a test thread, then call `search_jobs` with `{ "q": "software engineer", "location": "Austin, TX" }`, `search_google` with `{ "q": "Metidos coding agent", "gl": "us", "hl": "en" }`, `search_youtube` with `{ "search_query": "Metidos coding agent" }`, or `fetch_youtube_transcript` with `{ "v": "VIDEO_ID", "language_code": "en" }`.

## `.data` contents

This plugin has no persistent state and should not create `.data` files during normal operation.

## Safe `.data` inspection

- Prefer read-only inspection.
- Unexpected `.data` files can usually be treated as transient artifacts after confirming they are not needed by a local operator.
- Do not inspect or copy secret-bearing files unless necessary for repair.

## Safe `.data` repair

No manual `.data` repair is expected. Use Metidos Reset Plugin Data if unexpected runtime files need to be cleared.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. API key settings and env vars are owned by Metidos/server configuration and are not recreated by reset.

## Secrets and logs

Secrets are configured through the `api_key` Plugin Setting or `SERPAPI_API_KEY`. Non-secret localization defaults are configured with `google_domain`, `gl`, and `hl` Plugin Settings. Do not hard-code keys, paste keys into chat, log keys, or include keys in tool output. The plugin logs only successful search query text when plugin logging is enabled.

## Context notes

`search_jobs` is a thread tool. It does not read or write project files and does not require storage. Network access must stay limited to SerpApi's HTTPS search endpoint.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
