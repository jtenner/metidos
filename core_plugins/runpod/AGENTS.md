# AGENTS for Runpod

## Purpose

This first-party core plugin registers configured Runpod Serverless endpoints as Metidos model providers. It uses Runpod's fixed API host with a local-operator-provided endpoint ID to discover models from `https://api.runpod.ai/v2/{endpoint_id}/openai/v1/models`, then hands API-key auth to Pi for OpenAI-compatible chat-completions inference through `https://api.runpod.ai/v2/{endpoint_id}/openai/v1`.

Registered capabilities:

- `network:fetch` for endpoint-scoped Runpod `/openai/v1/models` discovery only.
- `provider:register` for the `runpod` provider.
- `log:write` for bounded discovery warnings that never include API keys, prompts, completions, request bodies, Authorization headers, or model outputs.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point and model/configuration normalizers.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. `bun format`
2. `bun test src/bun/plugin/runpod-core-plugin.test.ts`
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

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No seed files are copied for this plugin. Configure the `api_key`, `endpoint_id`, and optional `model_ids` Plugin Settings, or the matching `RUNPOD_*` environment variables, outside chat after reset if needed.

## Secrets and logs

Secrets may come from the `api_key` Plugin Setting or `RUNPOD_API_KEY`. The endpoint ID and model IDs are not treated as secrets, but they can reveal deployment details; avoid pasting them into public logs unnecessarily. The plugin passes bearer auth only to Runpod model discovery and Pi auth handoff. Do not log API keys, prompts, completions, request bodies, Authorization headers, embedding inputs, vectors, or model outputs. Discovery warnings should contain only HTTP status text and high-level failure context.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, or store LanceDB vectors. Although individual Runpod templates may expose other OpenAI-compatible routes depending on the deployed worker, this safe first-party slice exposes chat-completions models only and does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`. Add an `embed(context, request)` callback and finite-vector tests before broadening embedding permissions.

## Context notes

Provider registration is initialization-only. The plugin discovers catalog entries with `metidos.fetch` during provider refresh when both `endpoint_id` and `api_key` are configured. If discovery is unavailable, it falls back to configured `model_ids`/`RUNPOD_MODEL_IDS`. Inference is performed by Pi's OpenAI-compatible transport using the provider configuration and auth handoff, not by plugin-owned tool callbacks. The plugin intentionally avoids arbitrary base URLs; the only Runpod host used by plugin code is `api.runpod.ai`.
