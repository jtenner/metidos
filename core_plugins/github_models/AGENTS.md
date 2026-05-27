# AGENTS for GitHub Models

## Purpose

This first-party core plugin registers GitHub Models as a Metidos model provider. It uses GitHub's catalog API for model discovery and hands GitHub token auth to Pi for OpenAI-compatible chat-completions inference through `https://models.github.ai/inference`.

Registered capabilities:

- `network:fetch` for the GitHub Models catalog endpoint only.
- `provider:register` for the `github_models` provider.
- `log:write` for bounded discovery warnings that never include tokens, prompts, completions, or request bodies.

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
2. `bun test src/bun/plugin/github-models-core-plugin.test.ts`
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

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No seed files are copied for this plugin. Configure the `api_key` Plugin Setting or `GITHUB_MODELS_TOKEN` / `GITHUB_TOKEN` environment variables outside chat if discovery or inference needs auth.

## Secrets and logs

Secrets may come from the `api_key` Plugin Setting, `GITHUB_MODELS_TOKEN`, or `GITHUB_TOKEN`. The plugin passes bearer auth only to GitHub Models catalog discovery and Pi auth handoff. Do not log tokens, prompts, completions, request bodies, Authorization headers, or model outputs. Discovery warnings should contain only status text and high-level failure context.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, or store LanceDB vectors. It intentionally does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`.

## Context notes

Provider registration is initialization-only. The plugin discovers catalog entries with `metidos.fetch` during provider refresh. Inference is performed by Pi's OpenAI-compatible transport using the provider configuration and auth handoff, not by plugin-owned tool callbacks.
