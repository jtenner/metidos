# AGENTS for Anthropic

## Purpose

Settings-only first-party plugin for Pi's built-in Anthropic provider. Pi owns the provider id, endpoint, model catalog, transport, and model metadata.

## Files

- `metidos-plugin.json`: manifest, env declaration, `api_key` Plugin Setting, and `piAuth` binding to `anthropic`.
- `index.ts`: no-op sidecar entry point.
- `AGENTS.md`: maintenance guide.

## Behavior

Do not register a model provider here. The `piAuth` manifest binding bridges runtime auth into Pi's `anthropic` provider from the `api_key` Plugin Setting, with `ANTHROPIC_API_KEY` left to Pi's normal environment fallback.

## Safety

Do not log API keys, request headers, prompts, or model responses.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
