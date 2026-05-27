# AGENTS for Upstage

## Purpose

This first-party core plugin registers Upstage Solar as a Metidos model provider. It exposes a conservative static catalog of current official Solar chat model aliases and hands Upstage API-key auth to Pi for OpenAI-compatible chat-completions inference through `https://api.upstage.ai/v1`.

Registered capabilities:

- `provider:register` for the `upstage` provider.

The plugin intentionally does not request `network:fetch` because Upstage's current official docs did not surface a shared `/v1/models` discovery endpoint for this safe slice. Inference is performed by Pi's OpenAI-compatible transport, not by plugin-owned fetch callbacks.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point and static Solar model catalog.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. `bun format`
2. `bun test src/bun/plugin/upstage-core-plugin.test.ts`
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

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No seed files are copied for this plugin. Configure the `api_key` Plugin Setting or `UPSTAGE_API_KEY` environment variable outside chat if inference needs auth.

## Secrets and logs

Secrets may come from the `api_key` Plugin Setting or `UPSTAGE_API_KEY`. The plugin hands bearer auth to Pi for Upstage inference. Do not log API keys, prompts, completions, request bodies, Authorization headers, embedding inputs, vectors, or model outputs. This plugin does not intentionally write logs.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, or store LanceDB vectors. Upstage documents embeddings through its `/v1/embeddings` API and Solar embedding models, but this safe first-party slice intentionally exposes chat-completions models only and does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`. Add an `embed(context, request)` callback and finite-vector tests before broadening embedding permissions.

## Context notes

Provider registration is initialization-only. The plugin uses a static model catalog because no stable shared Upstage model-discovery endpoint is declared in the current official docs. Inference is performed by Pi's OpenAI-compatible transport using the provider configuration and auth handoff, not by plugin-owned tool callbacks.
