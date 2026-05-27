# Ollama via Core Plugin

## Summary

Current Metidos exposes Ollama through the first-party core plugin at `core_plugins/ollama`. The plugin registers a Plugin System v1 model provider, discovers local models from the configured Ollama-compatible endpoint, and projects those provider configurations into Pi's model registry at catalog/runtime load. Operators should configure the plugin or environment variables; they should not edit Pi's standalone `~/.pi/agent/models.json`.

## Current integration shape

- core plugin source: `core_plugins/ollama`
- runtime plugin folder: `<app-data>/plugins/ollama`
- plugin id: `ollama`
- manifest permissions: `network:fetch`, `provider:register`, `log:write`
- plugin provider id: `ollama`
- Pi runtime provider id shape: `ollama/ollama/default`
- runtime base URL: `{baseUrl}/v1`
- default base URL: `http://localhost:11434`
- network allowlist: `http://localhost:11434/**`, `http://127.0.0.1:11434/**`, and Podman host-loopback `http://10.0.2.2:11434/**`
- refresh interval: 60 seconds
- model identity shape: `ollama/ollama/default/<model-id>`

## Configuration sources

The provider uses one local-operator-reviewed endpoint for discovery and runtime:

1. `base_url` Plugin Setting
2. env var `OLLAMA_BASE_URL`
3. default `http://localhost:11434`

API keys are optional and are resolved for discovery from:

1. `api_key` Plugin Setting
2. env var `OLLAMA_API_KEY`

Inference auth is declared on the provider configuration with ordered `piAuth` records:

1. `api_key` Plugin Setting
2. env var `OLLAMA_API_KEY`

There is no separate per-user `base_url`; endpoint selection is intentionally one local-operator-reviewed Plugin Setting.

## Discovery behavior

The core plugin discovers models in this order:

1. `GET {baseUrl}/api/tags` for native Ollama. This is the primary source because it mirrors the locally available `ollama list` inventory.
2. `GET {baseUrl}/v1/models` for OpenAI-compatible local servers when the native endpoint fails or returns no models.
3. an empty model list when discovery fails or returns no models, so Metidos does not display a model that is not locally installed.

Discovery warnings are written with `metidos.log("warn", ...)` when plugin logging is enabled, but logging failures do not block provider startup.

## Provider configuration emitted to Pi

The plugin emits an OpenAI-compatible provider configuration:

- `api: "openai-completions"`
- `baseUrl: "{baseUrl}/v1"`
- optional `apiKey` and `authHeader: true` when a global/env key exists
- text-only model input
- 131072 context tokens
- 8192 max tokens
- zero placeholder costs
- `compat.supportsDeveloperRole = false`
- `compat.supportsReasoningEffort = false`

Metidos stores Pi auth and registry state under `<app-data>/pi-agent/`, but Ollama's source of truth is the approved core plugin plus its settings/env contract. `METIDOS_APP_DATA_DIR` only moves that Metidos-owned app-data root.

## Durable rules

- Keep the network allowlist scoped to localhost or explicitly reviewed host-loopback/private addresses unless remote Ollama support is deliberately reviewed.
- Local/private Ollama endpoints require the plugin `unsafe` permission plus `METIDOS_PLUGIN_UNSAFE_PRIVATE_NETWORK_PLUGINS=ollama`; safe plugin fetch blocks localhost and private LAN targets even when they appear in `network.allow`.
- Keep `base_url` as a local-operator-controlled Plugin Setting so endpoint changes remain an explicit plugin configuration choice.
- Prefer plugin settings or env vars over manual edits to `<app-data>/pi-agent/models.json`.
- Do not use Pi's standalone `PI_CODING_AGENT_DIR` or `~/.pi/agent/models.json` as the Metidos configuration path.
- Do not log API keys, prompts, model responses, or full request payloads.

## Related pages

- [pi-coding-agent-migration](./pi-coding-agent-migration.md)
- [codex-via-pi-wiring](./codex-via-pi-wiring.md)
- [nvidia-build-via-pi-configuration](./nvidia-build-via-pi-configuration.md)

## Source

Originally ingested from `docs/2026-04-10-ollama-via-pi-configuration.md` on 2026-04-19. Updated on 2026-04-29 to reflect the Plugin System v1 core-provider implementation in `core_plugins/ollama`. Updated on 2026-05-09 to make native `/api/tags` the primary discovery source so the catalog follows local `ollama list` inventory. Updated again on 2026-05-09 to require unsafe private-network runtime access for local/container Ollama endpoints and to remove the misleading `llama3.2` discovery fallback.
