# Build NVIDIA via Core Plugin

## Summary

Current Metidos exposes NVIDIA-hosted API Catalog models through the first-party core plugin at `core_plugins/nvidia_build`. The plugin registers a Plugin System v1 model provider and discovers chat-capable models from `https://integrate.api.nvidia.com/v1/models` when an API key is available. If discovery cannot run, fails, or returns no chat-capable models, the provider returns no models instead of synthesizing fallback catalog entries. It no longer relies on a backend-specific NVIDIA provider configuration module or an operator-edited Pi `models.json` entry.

## Current integration shape

- core plugin source: `core_plugins/nvidia_build`
- runtime plugin folder: `<app-data>/plugins/nvidia_build`
- plugin id: `nvidia_build`
- manifest permissions: `network:fetch`, `provider:register`, `log:write`
- plugin provider id: `nvidia_build`
- Pi runtime provider id shape: `nvidia_build/nvidia_build/default`
- base URL: `https://integrate.api.nvidia.com/v1`
- discovery endpoint: `GET https://integrate.api.nvidia.com/v1/models`
- discovery refresh interval: 10 minutes
- model identity shape: `nvidia_build/nvidia_build/default/<model-id>`

## Configuration sources

Discovery uses:

1. `api_key` Plugin Setting
2. env var `NVIDIA_API_KEY`

Inference auth is declared on the provider configuration with ordered `piAuth` records:

1. `api_key` Plugin Setting
2. env var `NVIDIA_API_KEY`

If no key is available, the plugin still emits an unavailable provider configuration with a sentinel key and explicit setup message so the model selector can explain what is missing.

## Discovery and model filtering

Live discovery reads NVIDIA's `/v1/models` payload and keeps entries that look chat-capable. The filter rejects ids containing tokens such as `embed`, `image`, `rerank`, `tts`, `video`, and `whisper`. Names come from catalog metadata when present, otherwise from readable id-derived display names.

If live discovery fails or returns no chat-capable models, the plugin logs a warning when logging is enabled and returns an empty model list. Missing NVIDIA models should be treated as a discovery/access/network problem rather than masked by curated fallback models.

## Provider configuration emitted to Pi

The plugin emits an OpenAI-compatible provider configuration:

- `api: "openai-completions"`
- `authHeader: true`
- `baseUrl: "https://integrate.api.nvidia.com/v1"`
- text-only model input
- 128000 context tokens
- 16384 max tokens
- zero placeholder costs
- `compat.maxTokensField = "max_tokens"`
- `compat.supportsDeveloperRole = false`
- `compat.supportsReasoningEffort = false`

Reasoning is enabled for model ids containing `thinking`, `reasoning`, or `deepseek-v4-pro`. DeepSeek V4 Pro also carries `compat.thinkingFormat = "qwen-chat-template"`.

## Durable rules

- Keep runtime inference in Pi's OpenAI-compatible path; do not reintroduce a bespoke backend NVIDIA transport.
- Keep live model discovery in the plugin, not in `src/bun/project-procedures`.
- Keep the manifest network allowlist limited to NVIDIA's model discovery endpoint; runtime inference is performed by the host using the registered provider base URL.
- Prefer plugin settings or env vars over manual edits to `<app-data>/pi-agent/models.json`.
- Do not log API keys, Authorization headers, prompts, model responses, or raw catalog payloads.

## Related pages

- [ollama-via-pi-configuration](./ollama-via-pi-configuration.md)
- [openrouter-via-pi-configuration](./openrouter-via-pi-configuration.md)
- [pi-coding-agent-migration](./pi-coding-agent-migration.md)
- [codex-via-pi-wiring](./codex-via-pi-wiring.md)

## Source

Originally ingested from `docs/2026-04-14-nvidia-build-via-pi-configuration.md` on 2026-04-19. Updated on 2026-04-29 to reflect the Plugin System v1 core-provider implementation in `core_plugins/nvidia_build`.
