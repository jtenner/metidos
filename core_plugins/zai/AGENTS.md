# AGENTS for Z.AI

## Purpose

First-party plugin for Pi's built-in `zai` provider id. The plugin owns the provider registration so Metidos can choose the correct Z.AI endpoint instead of relying on Pi's bundled static coding-plan endpoint.

## Files

- `metidos-plugin.json`: manifest, `ZAI_API_KEY` env declaration, `api_key` and `endpoint` settings, network allowlist for model discovery, `piAuth` binding, and `zai`/`zai_coding_plan` provider declarations.
- `index.ts`: provider registration, upstream `/models` discovery, static GLM fallback catalog, endpoint selection, and per-configuration `piAuth` records.
- `AGENTS.md`: maintenance guide.

## Behavior

The plugin registers provider ids `zai` and `zai_coding_plan` and replaces Pi's bundled Z.AI catalog while still using Pi's OpenAI-compatible transport. With an API key configured, it refreshes the catalog from the selected endpoint's `/models` response; without a key or after discovery failure, it uses the built-in fallback GLM catalog.

Endpoint setting values:

- `general_api` (default): `https://api.z.ai/api/paas/v4`, intended for long-lived Z.AI console API keys.
- `coding_plan`: `https://api.z.ai/api/coding/paas/v4`, intended for Coding Plan tokens. These tokens may expire and should be refreshed outside chat.

Auth precedence for inference remains:

1. `api_key` Plugin Setting
2. `ZAI_API_KEY`

If both are configured, the Plugin Setting wins. Clear the Plugin Setting when you want to fall back to the environment variable.

## Safety

Do not log API keys, Authorization headers, prompts, model responses, or discovery payloads. Discovery warning logs may include HTTP status/error text only. Do not paste Coding Plan tokens or console API keys into chat.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
