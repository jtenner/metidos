# AGENTS for LiteLLM Proxy

## Purpose

This first-party core plugin registers a local LiteLLM Proxy OpenAI-compatible server as a Metidos model provider. It uses LiteLLM Proxy's OpenAI-compatible `/v1` API through Pi's OpenAI-compatible transport and exposes only model IDs configured by the local operator.

Registered capabilities:

- `provider:register` for the `litellm` provider.

The plugin does not perform plugin-owned network fetches. Pi owns OpenAI-compatible inference after provider registration.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point, loopback base URL/model setting normalization, and provider registration.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. `bun format`
2. `bun test src/bun/plugin/litellm-core-plugin.test.ts`
3. `bun validate`
4. Confirm no root `node_modules/` exists in this plugin folder.
5. Confirm imports are local or `@metidos/plugin-api` only.

## `.data` contents

This provider does not intentionally create or read `.data` files. Any `.data` content is runtime-owned and should be treated as generated.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files unless needed for repair.
- Do not edit `.data` while the plugin sidecar is running unless the plugin docs explicitly allow it.

## Safe `.data` repair

This plugin has no durable repairable `.data` schema. Prefer Metidos Reset Plugin Data for unknown or stale generated state.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No seed files are copied for this plugin. Configure `base_url`, optional `api_key`, and `model_ids` Plugin Settings, or the documented environment-variable fallbacks, outside chat.

## Secrets and logs

Secrets may come from the optional `api_key` Plugin Setting or `LITELLM_API_KEY`, `LITELLM_VIRTUAL_KEY`, or `LITELLM_MASTER_KEY`. LiteLLM Proxy commonly uses bearer-token virtual keys or a local master key; prefer scoped virtual keys when available. Do not log bearer tokens, prompts, completions, request bodies, Authorization headers, embedding inputs, vectors, or model outputs.

This plugin does not request `log:write`, so it does not intentionally write plugin logs.

## Embeddings and vector search

LiteLLM Proxy documents OpenAI-compatible embeddings, but this plugin does not provide embeddings, consume embeddings, or store LanceDB vectors. It intentionally exposes configured chat-completions models only and does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`. Add an `embed(context, request)` callback, a narrow documented local embeddings endpoint, and finite-vector tests before broadening embedding permissions.

## Context notes

Provider registration is initialization-only. The plugin reads Plugin Settings and declared environment variables during startup/refresh. Project `./` files, terminal APIs, network fetch, thread tools, crons, and plugin-owned storage are not used. Inference is performed by Pi's OpenAI-compatible transport using the provider configuration and auth handoff, not by plugin-owned callbacks. The plugin intentionally accepts only loopback `/v1` base URLs (`localhost`, `127.0.0.1`, or `::1`) to avoid turning this first-party local provider into a generic arbitrary-endpoint bridge.
