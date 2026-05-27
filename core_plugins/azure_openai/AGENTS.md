# AGENTS for Azure OpenAI

## Purpose

This first-party core plugin registers Azure OpenAI as a Metidos model provider. It exposes local-operator-configured Azure OpenAI deployment names as model ids and hands Azure OpenAI API-key auth to Pi for Azure OpenAI Responses API inference through `https://{resource}.openai.azure.com/openai/v1`.

Registered capabilities:

- `provider:register` for the `azure_openai` provider.

The plugin intentionally does not request `network:fetch` because Azure OpenAI endpoints are resource-specific and Plugin System v1 safe network allowlists require literal hosts. This safe slice avoids arbitrary base URLs and constructs the endpoint only from a validated Azure OpenAI resource DNS label. Inference is performed by Pi's Azure OpenAI transport, not by plugin-owned fetch callbacks.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point, resource-name validation, deployment-name normalization, and provider registration.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. `bun format`
2. `bun test src/bun/plugin/azure-openai-core-plugin.test.ts`
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

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No seed files are copied for this plugin. Configure the `api_key`, `resource_name`, and `deployment_names` Plugin Settings, or `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE_NAME`, and `AZURE_OPENAI_DEPLOYMENTS` environment variables, outside chat before expecting models or inference to work.

## Secrets and logs

Secrets may come from the `api_key` Plugin Setting or `AZURE_OPENAI_API_KEY`. The resource name and deployment names are configuration metadata, not secrets, but they can still reveal infrastructure names and should not be copied unnecessarily. Do not log API keys, prompts, completions, request bodies, Authorization headers, embedding inputs, vectors, or model outputs. This plugin does not intentionally write logs.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, or store LanceDB vectors. Azure OpenAI supports embeddings through Azure OpenAI endpoints, but this safe first-party slice intentionally exposes configured Responses API deployments only and does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`. Add an `embed(context, request)` callback and finite-vector tests before broadening embedding permissions.

## Context notes

Provider registration is initialization-only. The plugin does not perform dynamic Azure model discovery because Azure endpoints are resource-specific and this safe slice avoids arbitrary network allowlists. The local operator must list deployment names explicitly; Azure v1 requests use deployment names in the model field. Inference is performed by Pi's Azure OpenAI Responses API transport using the provider configuration and auth handoff, not by plugin-owned tool callbacks.
