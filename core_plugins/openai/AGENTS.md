# AGENTS for OpenAI API

## Purpose

First-party OpenAI plugin for Pi's built-in OpenAI chat provider plus Metidos embedding-model registration. Pi owns the chat provider id, endpoint, model catalog, transport, and chat model metadata; this plugin owns API-key settings and the OpenAI embedding provider family used by Metidos vector search.

## Files

- `metidos-plugin.json`: manifest, env declaration, `api_key` Plugin Setting, `piAuth` binding to `openai`, and the `openai_embeddings` provider declaration.
- `index.ts`: embedding provider registration and OpenAI embeddings request adapter.
- `AGENTS.md`: maintenance guide.

## Behavior

Do not register a replacement chat model provider here. The `piAuth` manifest binding bridges runtime auth into Pi's built-in `openai` provider from the `api_key` Plugin Setting, then `OPENAI_API_KEY`. The plugin does register a separate embedding provider family for Metidos vector search.

This plugin is for direct OpenAI API keys only; do not reuse Codex auth settings here.

## Safety

Do not log API keys, Authorization headers, prompts, request bodies, or model responses.

## Embeddings and vector search

This plugin now provides OpenAI embedding models for Metidos vector search. The manifest declares `provider:register`, `network:fetch`, and `metidos:provides_embeddings`; `index.ts` registers an embedding provider family and calls the OpenAI `/v1/embeddings` endpoint using declared API key settings or `OPENAI_API_KEY`. Do not add `metidos:can_embed` or `metidos:lancedb` here unless the plugin itself starts consuming embeddings or storing vectors; provider plugins only need `metidos:provides_embeddings` when they expose embedding models.
