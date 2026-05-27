# AGENTS for Build NVIDIA

## Purpose

First-party provider plugin for Build NVIDIA / NVIDIA API Catalog models. It replaces the old backend-specific NVIDIA provider path with a plugin-backed OpenAI-compatible provider.

## Files

- `metidos-plugin.json`: manifest, `NVIDIA_API_KEY` env declaration, network allowlist, settings.
- `index.ts`: model discovery, chat-model filtering, provider configuration, and per-configuration `piAuth` records.
- `AGENTS.md`: maintenance guide.

## Permissions

- `network:fetch`: required to call NVIDIA's model catalog.
- `provider:register`: required to register the `nvidia_build` provider with Metidos.
- `log:write`: used for discovery failure/no-model warnings only.

## Settings

- `api_key` Plugin Setting: optional secret used for NVIDIA model discovery and inference before `NVIDIA_API_KEY`.
- Keep the key name aligned with the provider configuration `piAuth` records.

## Endpoints

- Discovery: `GET https://integrate.api.nvidia.com/v1/models`
- Runtime base URL: `https://integrate.api.nvidia.com/v1`
- Discovery auth: `Authorization: Bearer <api key>`
- The manifest allowlist intentionally includes only the model discovery endpoint; runtime inference is performed by the host using the registered provider base URL.

## Credentials

Discovery uses the `api_key` Plugin Setting, then `NVIDIA_API_KEY`. Inference auth is declared on each provider configuration with ordered `piAuth` records: `api_key` Plugin Setting, then `NVIDIA_API_KEY`.

Inference precedence is the `api_key` Plugin Setting, then `NVIDIA_API_KEY`. Missing keys produce an explicit setup message and sentinel key rather than hiding the provider.

## Behavior

`getProviderConfigurations()` refreshes every 10 minutes. Discovery filters out non-chat catalog entries by rejecting ids containing tokens such as `embed`, `image`, `rerank`, `tts`, `video`, and `whisper`. Names come from catalog metadata when present, otherwise from a readable id-derived display name.

The provider registers `api: "openai-completions"`, `authHeader: true`, 128k context, 16k max tokens, text-only input, zero placeholder costs, and compatibility flags disabling developer-role and reasoning-effort transport features by default. Reasoning is enabled for model ids containing `thinking`, `reasoning`, or `deepseek-v4-pro`; DeepSeek V4 Pro also carries `thinkingFormat: "qwen-chat-template"`. If discovery cannot run, fails, or returns no chat-capable models, return an empty model list instead of adding curated fallback models.

## Safety

Do not log API keys, Authorization headers, prompts, model responses, or catalog payloads. Warning logs may include discovery failure or no-model status.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
