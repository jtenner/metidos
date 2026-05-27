# AGENTS for Ollama

## Purpose

First-party provider plugin for local Ollama and compatible local servers. It exposes local models through Pi's `openai-completions` transport without keeping Ollama-specific catalog code in the backend.

## Files

- `metidos-plugin.json`: local network allowlist, optional base URL and API key settings.
- `index.ts`: base URL resolution, two-step discovery, provider registration, and per-configuration `piAuth` records.
- `AGENTS.md`: maintenance guide.

## Permissions

- `network:fetch`: required to read local model lists from Ollama.
- `provider:register`: required to register the `ollama` provider.
- `log:write`: used only when one discovery path fails and another path or no-model state is used.
- `unsafe`: required because local Ollama endpoints are localhost/private-network targets. Runtime access still requires `METIDOS_PLUGIN_UNSAFE_PRIVATE_NETWORK_PLUGINS` to include `ollama`.

## Settings

- `base_url` Plugin Setting: optional URL for the local Ollama-compatible server; defaults to `http://localhost:11434` and must match the manifest allowlist.
- `api_key` Plugin Setting: optional secret for authenticated compatible local servers; used for discovery and as the shared inference fallback before `OLLAMA_API_KEY`.
- `base_url` is a Plugin Setting; model discovery and provider registration are intentionally anchored to one local-operator-reviewed endpoint.

## Endpoints

- Default base URL: `http://localhost:11434`
- Ollama-native discovery: `GET {baseUrl}/api/tags`
- OpenAI-compatible discovery fallback: `GET {baseUrl}/v1/models`
- Runtime base URL registered with Pi: `{baseUrl}/v1`
- Manifest allowlist: `http://localhost:11434/**`, `http://127.0.0.1:11434/**`, and Podman host-loopback `http://10.0.2.2:11434/**`; keep it local/private-host scoped unless remote Ollama support is deliberately reviewed.

## Credentials

Base URL resolves from the `base_url` Plugin Setting, then `OLLAMA_BASE_URL`, then the default localhost URL. The plugin trims trailing slashes before appending paths.

API keys are optional. Discovery uses the `api_key` Plugin Setting, then `OLLAMA_API_KEY`. Inference auth is declared on each provider configuration with ordered `piAuth` records: `api_key` Plugin Setting, then `OLLAMA_API_KEY`.

## Behavior

`getProviderConfigurations()` refreshes every minute to reflect local model pulls quickly. Discovery first tries native Ollama `/api/tags`, which mirrors the locally available `ollama list` inventory, then falls back to `/v1/models` so OpenAI-compatible local servers still work. If both fail or return no models, it returns an empty model list so Metidos shows the provider as unavailable instead of inventing a local model.

The provider registers `api: "openai-completions"`, text-only input, 131072 context tokens, 8192 max tokens, zero cost, no reasoning, and compatibility flags disabling developer-role and reasoning-effort features.

## Safety

Do not log API keys, prompts, or model responses. Keep the network allowlist narrow because this plugin is allowed to use plain HTTP for local/private Ollama endpoints and declares `unsafe` for that purpose.

## Embeddings and vector search

This plugin provides local Ollama models for both chat-style provider registration and Metidos embeddings. The manifest declares `provider:register`, `network:fetch`, and `metidos:provides_embeddings`; `index.ts` exposes discovered Ollama models as embedding-capable and implements embedding calls through `/api/embed`. Do not add `metidos:can_embed` or `metidos:lancedb` unless this plugin starts consuming embeddings or storing its own vectors.
