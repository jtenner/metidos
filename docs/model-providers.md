# Model providers

Metidos uses provider-qualified model IDs so the runtime can distinguish models that have the same raw name but come from different provider families. Providers may be built in through Pi or registered by approved plugins.

## Provider types

- **Built-in Provider** — implemented by Pi and configured by Metidos through environment variables, plugin settings, or Pi Auth handoff.
- **Plugin-backed Provider** — registered at runtime by an approved Plugin System v1 sidecar.
- **Local/private provider** — a provider endpoint reachable from the Metidos process, such as a local Ollama service.
- **Embedding Provider** — a provider/model configuration that can generate embeddings for vector search or embedding consumers.

## Model IDs

Use provider-qualified IDs in persisted selections and documentation examples:

```text
openai:gpt-example
anthropic:claude-example
ollama/ollama/default/llama-example
plugin_id/provider_id/configuration_id/model_id
```

Do not assume a raw model name is globally unique.

## Secret handling

Provider credentials can come from private environment variables, Plugin Settings, or provider auth imports. Examples in docs should use placeholders only.

Safe placeholders:

```bash
OPENAI_API_KEY=replace-with-your-openai-key
ANTHROPIC_API_KEY=replace-with-your-anthropic-key
OPENROUTER_API_KEY=replace-with-your-openrouter-key
```

Never paste real provider keys, OAuth refresh tokens, auth JSON files, or `.env` contents into issues.

## Environment-based setup

1. Copy `.env.example` to `.env`.
2. Set only the provider variables you need.
3. Start Metidos.
4. Open Settings or the model selector and confirm the provider appears.
5. Start a small safe Thread to validate the model.

Common env names are documented in `.env.example`; use that file as the current placeholder reference.

## Plugin-backed setup

1. Install the plugin folder under `APP_DATA/plugins/{plugin_id}/`.
2. Start or refresh Metidos.
3. Open Settings -> Plugins.
4. Review manifest permissions, settings, env declarations, network allowlists, and provider registrations.
5. Approve the current review hash.
6. Configure Plugin Settings with real secrets only in the local UI.
7. Confirm the provider appears in the model catalog.
8. Start a safe Thread with a small prompt.

If the plugin source changes, re-review and re-approve before relying on it.

## Local/private providers

Local providers are useful but can cross sensitive network boundaries. Before enabling one:

- confirm the endpoint URL from the Metidos process or container,
- bind local services to loopback when possible,
- avoid broad private-network allowlists,
- understand whether prompts or project content leave the machine,
- document container network routing if Metidos runs in a container.

For Ollama-style setup, prefer the first-party `ollama` core plugin and use Plugin Settings or `.env.example` placeholders such as `OLLAMA_BASE_URL` and `OLLAMA_API_KEY`. The provider discovers installed local models from the configured endpoint and should not require manual edits to Pi's standalone model registry.

Local/private Ollama endpoints require explicit private-network/unsafe approval because localhost and private LAN services may expose sensitive local resources.

## First-party plugin-backed providers

Many provider integrations are shipped as core plugins under `core_plugins/` so catalog refresh and provider-specific behavior stay inside the plugin boundary. The checked-in plugin folders are the authoritative inventory; examples include:

- `ollama` for local/private Ollama-compatible chat models discovered from the configured endpoint.
- `openrouter` for chat and embedding models from OpenRouter's catalog.
- `nvidia_build` for NVIDIA-hosted chat models from NVIDIA's API catalog.
- `anthropic`, `openai`, `gemini`, `groq`, `mistral`, `deepseek`, `xai`, `github_copilot`, `github_models`, and other provider folders for their corresponding upstream APIs.
- compatibility or routing providers such as `custom_openai`, `litellm`, `llamacpp`, `lmstudio`, `localai`, `vllm`, `sglang`, and `tgi`.

If discovery fails, provider plugins should surface unavailable/no-model states rather than silently inventing fallback models.

## Embeddings

Embeddings are used by vector search features and embedding-consuming plugins. An embedding setup should document:

- provider and model,
- whether input text leaves the local machine,
- limits and expected costs,
- which plugins or tools consume embeddings,
- failure behavior when no embedding model is configured.

Plugin authors declaring embedding capabilities should describe the source text being embedded and where vectors are stored.

## Troubleshooting

Provider does not appear:

- restart Metidos after env changes,
- confirm `.env` is in the repository root used by `bun run ...`,
- confirm plugin provider is approved and active,
- check plugin diagnostics for provider registration errors,
- verify endpoint reachability from inside the container if containerized.

Thread fails immediately:

- confirm the provider-qualified model ID still exists,
- verify credentials are present and not expired,
- try a smaller prompt,
- check provider quota/rate limits,
- inspect sanitized logs.

Local provider unreachable:

- confirm host and port,
- check loopback versus container networking,
- ensure TLS/HTTP expectations match the provider,
- avoid exposing local providers publicly unless you have a separate security plan.

## Safety expectations

- Start with Safe Mode.
- Use least-privilege plugin/network permissions.
- Keep provider credentials private.
- Disable scheduled jobs before rotating credentials.
- Do not share provider request logs unless redacted.
- Re-test model selections after provider plugin updates.
