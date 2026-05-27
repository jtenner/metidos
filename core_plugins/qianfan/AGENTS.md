# AGENTS for Baidu Qianfan

## Purpose

This first-party core plugin registers a conservative Baidu Qianfan chat model catalog as a Metidos model provider. It exposes one provider family, `qianfan`, and hands a Baidu Qianfan API key from the `api_key` Plugin Setting, `QIANFAN_API_KEY`, `BAIDU_QIANFAN_API_KEY`, or `BAIDU_API_KEY` environment variable to Pi's OpenAI-compatible chat-completions transport. If configured, the optional `app_id` Plugin Setting is sent as the Qianfan `appid` request header.

The plugin does not register tools, crons, prompt injections, notification providers, OAuth providers, embedding consumers, or vector stores.

## Source layout

- `metidos-plugin.json`: Plugin Manifest v1 reviewed by the local operator.
- `index.ts`: TypeScript plugin entry point and static Baidu Qianfan model catalog.
- `AGENTS.md`: this operator and agent guide.
- `.data/`: generated plugin data owned by Metidos; this plugin does not intentionally create data files.
- `.logs/`: generated plugin logs when enabled; this plugin does not intentionally write logs.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the Metidos repository root:

1. Validate the manifest against `docs/metidos-plugin.schema.json` if editing manifest structure.
2. Run `bun test src/bun/plugin/qianfan-core-plugin.test.ts`.
3. Run the repository workflow: `bun format` followed by `bun validate`.
4. Confirm imports are limited to `@metidos/plugin-api` and local files inside this folder.

## `.data` contents

This plugin does not intentionally store plugin-owned data. If `.data/` exists, it should contain only Metidos runtime bookkeeping or future explicitly documented files.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files unless needed for repair.
- Do not edit `.data` while the plugin sidecar is running unless future plugin docs explicitly allow it.

## Safe `.data` repair

No manual repair workflow is currently needed because the plugin has no durable data schema. If `.data/` appears corrupt, disable the plugin and use Metidos Reset Plugin Data rather than hand-editing unknown runtime files.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. This plugin has no `seed/` directory and no plugin-authored data to restore. The local operator must still configure `api_key` or a declared API-key environment variable outside chat for inference to work.

## Secrets and logs

Secrets are supplied only through the secret `api_key` Plugin Setting or the secret `QIANFAN_API_KEY`, `BAIDU_QIANFAN_API_KEY`, or `BAIDU_API_KEY` environment variables. Do not place API keys in source, manifests, docs, seed files, `.data`, `.logs`, thrown errors, or test fixtures.

The plugin does not intentionally write plugin logs. Metidos v1 does not promise automatic redaction of plugin-authored logs or thrown messages, so future diagnostics must not include Authorization headers, API keys, prompts, completions, request bodies, app IDs, or other user content.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, store LanceDB vectors, or request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`.

Baidu Qianfan chat models are exposed for OpenAI-compatible chat completions only. If a future Qianfan embedding provider is added, it must implement and test an `embed(context, request)` callback that calls a documented embedding endpoint and returns finite numeric vectors before requesting `metidos:provides_embeddings`.

## Context notes

Provider registration happens during plugin initialization. `getProviderConfigurations()` reads Plugin Settings and declared environment variables, then returns a static Baidu Qianfan model catalog. This plugin has no project `./` file access, no network fetch permission, no terminal access, and no cron context.
