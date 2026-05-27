# AGENTS for xAI

## Purpose

First-party xAI plugin that:

- stores xAI API key settings,
- registers the `xai` provider,
- refreshes the chat/coding model list from xAI upstream,
- serves models through Pi's OpenAI-compatible transport.

## Files

- `metidos-plugin.json`: manifest, env/settings, `piAuth`, network allowlist, and provider registration.
- `index.ts`: provider registration and upstream model discovery.
- `AGENTS.md`: maintenance guide.

## Behavior

This plugin owns xAI model discovery instead of relying on Pi's bundled static xAI catalog.

Auth precedence for inference remains:

1. `api_key` Plugin Setting
2. `XAI_API_KEY`

Discovery currently uses the `api_key` Plugin Setting or `XAI_API_KEY` when available. If discovery fails, Metidos should show an unavailable/no-models state rather than falling back to Pi's bundled xAI catalog.

The xAI `/v1/models` endpoint also returns image/video generation models. Keep this provider catalog limited to chat/coding models that Pi can route through the OpenAI-compatible chat transport.

Generated `.data/`, `.logs/`, and `.data-bak-*` directories are runtime output and must not be committed.

## Safety

Do not log API keys, Authorization headers, prompts, request bodies, model responses, or raw discovery payloads.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
