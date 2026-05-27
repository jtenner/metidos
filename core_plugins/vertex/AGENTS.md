# AGENTS for Google Vertex AI

## Purpose

This first-party core plugin registers Google Vertex AI as a Metidos model provider. It exposes a conservative static Gemini chat model catalog through Vertex AI's OpenAI-compatible endpoint at `https://aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi` and hands a Google Cloud OAuth access token to Pi for inference.

Registered capabilities:

- `provider:register` for the `vertex` provider.

The plugin intentionally does not request `network:fetch` because Vertex AI endpoints are project/location-specific and this safe slice does not perform plugin-owned discovery or arbitrary base-url access. Inference is performed by Pi's OpenAI-compatible transport, not by plugin-owned fetch callbacks.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point, project/location validation, static Gemini chat catalog, and provider registration.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. `bun format`
2. `bun test src/bun/plugin/vertex-core-plugin.test.ts`
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

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. No seed files are copied for this plugin. Configure `project_id`, `location`, and the `access_token` Plugin Setting, or `GOOGLE_VERTEX_PROJECT_ID`, `GOOGLE_VERTEX_LOCATION`, and `GOOGLE_VERTEX_ACCESS_TOKEN` environment variables, outside chat before expecting models or inference to work.

## Secrets and logs

Secrets may come from the `access_token` Plugin Setting or Google Vertex access-token environment variables. Project IDs and locations are configuration metadata, not secrets, but can still reveal infrastructure names and should not be copied unnecessarily. Do not log OAuth tokens, prompts, completions, request bodies, Authorization headers, embedding inputs, vectors, or model outputs. This plugin does not intentionally write logs.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, or store LanceDB vectors. Vertex AI supports text embeddings through native Gemini/Vertex endpoints, but this safe first-party slice intentionally exposes OpenAI-compatible chat-completions models only and does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`. Add an `embed(context, request)` callback and finite-vector tests before broadening embedding permissions.

## Context notes

Provider registration is initialization-only. The plugin does not perform dynamic Vertex model discovery because project/location routing and OAuth are tenant-specific and this safe slice avoids plugin-owned network access. OAuth access tokens expire; local operators should provide a currently valid Google Cloud access token or use a future dedicated Google OAuth/service-account integration when available. Inference is performed by Pi's OpenAI-compatible transport using the provider configuration and auth handoff, not by plugin-owned tool callbacks.
