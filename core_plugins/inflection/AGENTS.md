# AGENTS for Inflection AI

## Purpose

This first-party core plugin registers Inflection AI as a Metidos model provider. It exposes Inflection's OpenAI-compatible chat completions endpoint and a separate embedding provider backed by the official `/v1/embeddings` endpoint. The plugin may fetch only Inflection config discovery and embeddings endpoints on `https://api.inflection.ai`.

## Source layout

- `metidos-plugin.json`: Plugin Manifest v1 reviewed by the local operator.
- `index.ts`: TypeScript entry point that registers chat and embedding provider families.
- `AGENTS.md`: this operator/agent guide.
- `.data/`: generated plugin data owned by Metidos; this plugin does not intentionally create files there.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. Validate the manifest through repository tests or the schema helper in `docs/metidos-plugin-authoring-guide.md`.
2. Run `bun test src/bun/plugin/inflection-core-plugin.test.ts`.
3. Run `bun format` and `bun validate` before committing repository changes.
4. Confirm imports are local or `@metidos/plugin-api` only.

## `.data` contents

The plugin does not intentionally persist plugin-owned data. Any `.data` directory is managed by Metidos lifecycle operations and should normally be empty for this plugin.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files if future versions add any.
- Do not edit `.data` while the plugin sidecar is running unless future plugin docs explicitly allow it.

## Safe `.data` repair

No manual `.data` repairs are expected. If unexpected generated files become corrupt, disable the plugin and use Metidos Reset Plugin Data rather than editing unknown files.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. Because this plugin has no seed data or durable local state, reset should not require data migration. The local operator must still keep the Inflection API key configured through Plugin Settings or `INFLECTION_API_KEY`.

## Secrets and logs

Secrets are supplied through the `api_key` Plugin Setting or `INFLECTION_API_KEY`. The plugin sends the key only in `Authorization: Bearer ...` headers to Inflection endpoints. Do not log API keys, prompts, completions, embedding inputs, request bodies, Authorization headers, or embedding vectors. The plugin writes warning logs only for discovery failures when logging is enabled.

## Embeddings and vector search

This plugin provides embeddings and therefore declares `metidos:provides_embeddings`. It does not consume Metidos embeddings, does not declare `metidos:can_embed`, and does not store LanceDB vectors.

- Embedding provider callback: `inflection_embeddings.embed(...)` in `index.ts`.
- Embedding-capable model marking: models are returned with `api: "embeddings"` and `compat.providesEmbeddings: true`.
- Upstream endpoint: `https://api.inflection.ai/v1/embeddings`.
- Auth: `api_key` Plugin Setting or `INFLECTION_API_KEY` as a bearer token.
- Raw embedding input leaves the local machine and is sent to Inflection AI. Do not embed secrets or unnecessary private content.

## Context notes

Provider registration is initialization-only. Chat inference is handed off to Pi using the OpenAI-compatible base URL `https://api.inflection.ai/v1`; plugin-owned network fetch is used only for `/v1/discovery/configs` and `/v1/embeddings`. The plugin has no project `./` file access, no terminal access, no storage permission, and no unsafe permission.
