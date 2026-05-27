# OpenRouter via Core Plugin

## Summary

OpenRouter is now a first-party plugin-backed provider in Metidos.

The core plugin at `core_plugins/openrouter`:

- stores OpenRouter credentials,
- registers the `openrouter` chat provider and `openrouter_embeddings` embedding provider,
- fetches the upstream OpenRouter chat and embedding model catalogs,
- refreshes those catalogs on provider refresh,
- continues to route chat inference through Pi's OpenAI-compatible transport,
- and routes embedding requests through OpenRouter's embeddings API.

If upstream discovery has not completed or fails, Metidos keeps OpenRouter provider ownership visible with an unavailable/no-models state instead of falling back to Pi's bundled OpenRouter catalog.

## Current integration shape

- core plugin source: `core_plugins/openrouter`
- runtime plugin folder: `<app-data>/plugins/openrouter`
- plugin id: `openrouter`
- chat provider id: `openrouter`
- embedding provider id: `openrouter_embeddings`
- entrypoint: provider registration, chat/embedding model discovery, and embedding request routing
- manifest permissions: `network:fetch`, `provider:register`, `metidos:provides_embeddings`, `log:write`
- credential precedence for inference and embedding requests: `api_key` Plugin Setting, then env var `OPENROUTER_API_KEY`
- discovery auth: `api_key` Plugin Setting or env var `OPENROUTER_API_KEY` when available

## Why this path exists

Pi's bundled OpenRouter catalog is static, while OpenRouter's upstream model list changes frequently. Moving catalog refresh into the core plugin keeps OpenRouter discovery local to the provider integration instead of adding provider-specific catalog refresh logic in the main Bun backend.

## Durable rules

- Keep the chat provider id `openrouter` aligned across manifest auth bindings and provider registration.
- Keep the embedding provider id `openrouter_embeddings` separate so chat models are not treated as embedding-capable.
- Prefer upstream discovery over hardcoded OpenRouter model lists in Metidos source.
- If discovery fails, do not expose Pi's bundled OpenRouter catalog as if it were fresh provider-owned data; surface an unavailable/no-models state until upstream discovery succeeds.
- Do not log API keys, request headers, prompts, embedding inputs, request bodies, model responses, embedding vectors, or raw discovery payloads.
- Generated runtime paths such as `.data/`, `.logs/`, and `.data-bak-*` are not source and must not be committed.

## Related pages

- [nvidia-build-via-pi-configuration](./nvidia-build-via-pi-configuration.md)
- [ollama-via-pi-configuration](./ollama-via-pi-configuration.md)
- [codex-via-pi-wiring](./codex-via-pi-wiring.md)
