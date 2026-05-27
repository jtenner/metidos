# AGENTS for Hugging Face Inference Providers

## Purpose

This first-party core plugin registers Hugging Face Inference Providers as a Metidos model provider. It uses the Hugging Face router model catalog for discovery and hands Hugging Face token auth to Pi for OpenAI-compatible chat-completions inference through `https://router.huggingface.co/v1`.

Registered capabilities:

- `network:fetch` for the Hugging Face router model catalog endpoint only.
- `provider:register` for the `huggingface` provider.
- `log:write` for bounded discovery warnings that never include tokens, prompts, completions, request bodies, Authorization headers, or model outputs.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point and model normalizers.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. `bun format`
2. `bun test src/bun/plugin/huggingface-core-plugin.test.ts`
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

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No seed files are copied for this plugin. Configure the `api_key` Plugin Setting or `HF_TOKEN` / `HUGGINGFACE_API_KEY` environment variables outside chat if inference needs auth.

## Secrets and logs

Secrets may come from the `api_key` Plugin Setting, `HF_TOKEN`, or `HUGGINGFACE_API_KEY`. The plugin passes bearer auth only to Hugging Face router discovery and Pi auth handoff. Discovery can run without a token, but inference generally requires a Hugging Face token. Do not log tokens, prompts, completions, request bodies, Authorization headers, embedding inputs, vectors, or model outputs. Discovery warnings should contain only status text and high-level failure context.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, or store LanceDB vectors. It intentionally does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`. Although Hugging Face Inference Providers document feature-extraction/embedding tasks outside the OpenAI-compatible chat path, this plugin exposes chat-completions models only until a dedicated embedding callback is implemented and tested with finite numeric vectors.

## Context notes

Provider registration is initialization-only. The plugin discovers catalog entries with `metidos.fetch` during provider refresh. Inference is performed by Pi's OpenAI-compatible transport using the provider configuration and auth handoff, not by plugin-owned tool callbacks. The Hugging Face router may route a model to multiple upstream providers; provider-specific routing and extra request parameters are deferred until Metidos models them explicitly.
