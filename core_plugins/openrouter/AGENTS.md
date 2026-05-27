# AGENTS for OpenRouter

## Purpose

First-party OpenRouter plugin that:

- stores OpenRouter API key settings,
- registers the OpenRouter provider,
- refreshes chat and embedding model lists from OpenRouter upstream,
- serves chat models through Pi's OpenAI-compatible transport,
- embeds text through OpenRouter's embeddings API for Metidos vector search.

## Files

- `metidos-plugin.json`: manifest, env/settings, `piAuth`, network allowlist, and provider registration.
- `index.ts`: provider registration, upstream model discovery, and embedding request routing.
- `openrouter-models.ts`: pure OpenRouter model/embedding normalization helpers used by the plugin and tests.
- `AGENTS.md`: maintenance guide.

## Behavior

This plugin now owns OpenRouter chat and embedding model discovery instead of relying on Pi's bundled static OpenRouter catalog.

Auth precedence for inference remains:

1. `api_key` Plugin Setting
2. `OPENROUTER_API_KEY`

Chat discovery currently uses the `api_key` Plugin Setting or `OPENROUTER_API_KEY` when available. Embedding discovery tries OpenRouter's embeddings model endpoint with that same discovery credential when present, then falls back to filtered `/models` discovery. If discovery fails, Metidos should show an unavailable/no-models state rather than falling back to Pi's bundled OpenRouter catalog.

Embedding request auth precedence is the same as inference auth precedence: `api_key` Plugin Setting, then `OPENROUTER_API_KEY`.

Generated `.data/`, `.logs/`, and `.data-bak-*` directories are runtime output and must not be committed.

## Safety

Do not log API keys, Authorization headers, prompts, embedding inputs, request bodies, model responses, embedding response bodies, or vectors.

## Embeddings and vector search

This plugin provides OpenRouter embedding models for Metidos vector search. The manifest declares `metidos:provides_embeddings` because `index.ts` registers `openrouter_embeddings` with an `embed(context, request)` callback. Embedding-capable models are marked with `api: "embeddings"` and `compat.providesEmbeddings: true`, and embedding requests call `https://openrouter.ai/api/v1/embeddings` using the configured OpenRouter API key.

Raw embedding input may leave the local machine and be sent to OpenRouter and the selected upstream model provider. Do not log embedding inputs, request bodies, API keys, Authorization headers, response bodies, or vectors.

This plugin does not call `metidos.embeddings.embed(...)`, does not consume another provider's embeddings, and does not store LanceDB vectors. Do not add `metidos:can_embed`, `metidos:lancedb`, or storage permissions unless this plugin starts consuming embeddings or persisting vectors itself.
