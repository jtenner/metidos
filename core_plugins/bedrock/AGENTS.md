# AGENTS for Amazon Bedrock

## Purpose

This first-party core plugin registers Amazon Bedrock as a Metidos model provider. It exposes one provider family, `bedrock`, discovers OpenAI-compatible models from the configured regional Bedrock Models API endpoint, and hands an Amazon Bedrock API key from the `api_key` Plugin Setting, `BEDROCK_API_KEY`, or `AWS_BEARER_TOKEN_BEDROCK` environment variable to Pi's OpenAI-compatible chat-completions transport.

The plugin does not register tools, crons, prompt injections, notification providers, OAuth providers, embedding consumers, or vector stores.

## Source layout

- `metidos-plugin.json`: Plugin Manifest v1 reviewed by the local operator.
- `index.ts`: TypeScript plugin entry point, region list, model discovery, and model metadata normalization.
- `AGENTS.md`: this operator and agent guide.
- `.data/`: generated plugin data owned by Metidos; this plugin does not intentionally create data files.
- `.logs/`: generated plugin logs when enabled; warning logs may mention discovery failures without secrets.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the Metidos repository root:

1. Validate the manifest against `docs/metidos-plugin.schema.json` if editing manifest structure.
2. Run `bun test src/bun/plugin/bedrock-core-plugin.test.ts`.
3. Run the repository workflow: `bun format` followed by `bun validate`.
4. Confirm imports are limited to `@metidos/plugin-api` and local files inside this folder.
5. Confirm network allowlists stay limited to the documented fixed `https://bedrock-mantle.{region}.api.aws/v1/models` discovery endpoints.

## `.data` contents

This plugin does not intentionally store plugin-owned data. If `.data/` exists, it should contain only Metidos runtime bookkeeping or future explicitly documented files.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files unless needed for repair.
- Do not edit `.data` while the plugin sidecar is running unless future plugin docs explicitly allow it.

## Safe `.data` repair

No manual repair workflow is currently needed because the plugin has no durable data schema. If `.data/` appears corrupt, disable the plugin and use Metidos Reset Plugin Data rather than hand-editing unknown runtime files.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. This plugin has no `seed/` directory and no plugin-authored data to restore. The local operator must still configure `api_key`, `BEDROCK_API_KEY`, or `AWS_BEARER_TOKEN_BEDROCK` outside chat for discovery and inference to work.

## Secrets and logs

Secrets are supplied only through the secret `api_key` Plugin Setting, secret `BEDROCK_API_KEY`, or secret `AWS_BEARER_TOKEN_BEDROCK` environment variable. Do not place API keys or bearer tokens in source, manifests, docs, seed files, `.data`, `.logs`, thrown errors, or test fixtures.

The plugin may write warning logs when regional model discovery fails. Logs must never include Authorization headers, API keys, prompts, completions, request bodies, model request payloads, or user content. Metidos v1 does not promise automatic redaction of plugin-authored logs or thrown messages.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, store LanceDB vectors, or request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`.

Amazon Bedrock OpenAI-compatible chat models are exposed for chat completions only. If future Bedrock OpenAI-compatible embedding endpoints are added, they must implement and test an `embed(context, request)` callback that returns finite numeric vectors before requesting `metidos:provides_embeddings`.

## Context notes

Provider registration happens during plugin initialization. `getProviderConfigurations()` reads Plugin Settings and declared environment variables, attempts region-scoped model discovery with `GET /v1/models`, and returns models through Pi's OpenAI-compatible transport. This plugin has no project `./` file access, no terminal access, no cron context, and no provider-owned execution callback.
