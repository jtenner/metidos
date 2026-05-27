# AGENTS for Custom OpenAI-Compatible Endpoint

## Purpose

This first-party core plugin registers one local-operator-configured OpenAI-compatible chat provider. It uses `provider:register` only, exposes manually configured model IDs through Pi's OpenAI-compatible chat-completions transport, and does not perform plugin-owned network discovery.

The plugin accepts an HTTPS public-host base URL that ends in `/v1` or has no path so `/v1` can be appended. It rejects HTTP, loopback, private-style hostnames, IP literals, query strings, fragments, and non-`/v1` paths. When a configured model is selected, Pi sends model requests to the configured endpoint; treat the endpoint as receiving prompts, tool context, and completions for that model run.

## Source layout

- `metidos-plugin.json`: Plugin System v1 manifest reviewed by the local operator.
- `index.ts`: TypeScript entry point that validates settings/env and registers provider configurations.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; this plugin does not intentionally create data files.
- `.logs/`: generated plugin logs when enabled; this plugin does not intentionally write logs.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root after editing this plugin:

1. Validate the manifest against `docs/metidos-plugin.schema.json`.
2. Run `bun test src/bun/plugin/custom-openai-core-plugin.test.ts`.
3. Run the repository workflow when committing: `bun format` followed by `bun validate`.
4. Confirm no root `node_modules/` exists.
5. Confirm imports are local or `@metidos/plugin-api` only.

## `.data` contents

This plugin has no expected `.data` files. If `.data/` exists, it was created by the Metidos plugin lifecycle and should be treated as generated runtime state.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print files containing secrets.
- Do not edit `.data` while the plugin sidecar is running unless future plugin docs explicitly allow it.

## Safe `.data` repair

There are no documented hand-editable data files. Prefer Metidos Reset Plugin Data for unexpected generated state.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. Because there is no seed data, endpoint settings and env vars remain the source of configuration after reset.

## Secrets and logs

Secrets are supplied through the `api_key` Plugin Setting or `CUSTOM_OPENAI_API_KEY` env var. Do not put API keys in source files, manifests, logs, model IDs, names, URLs, commit messages, or chat.

The plugin does not intentionally call `metidos.log`. Provider requests are handled by Pi after the provider is selected; do not add logging of prompts, completions, request bodies, response bodies, Authorization headers, API keys, or other endpoint secrets.

## Embeddings and vector search

This plugin does not provide embedding models, consume embeddings, or store LanceDB vectors. It intentionally does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`.

OpenAI-compatible endpoints often expose `/v1/embeddings`, but this safe slice only registers chat-completions models. Add embeddings later only with a tested `embed(context, request)` callback that returns finite numeric vectors and documents upstream privacy behavior.

## Context notes

- Provider registration happens during plugin initialization through `metidos.providers.addProvider(...)`.
- The plugin uses no project `./` file access, terminal access, cron callbacks, storage writes, or plugin-owned network fetch.
- Model IDs are configured manually through `model_ids` or `CUSTOM_OPENAI_MODEL_IDS`; use the endpoint's `/v1/models` response or official provider documentation.
- Custom headers and live model discovery are deferred because arbitrary endpoint discovery or header forwarding would require additional review and validation.
