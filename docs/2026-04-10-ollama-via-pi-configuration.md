# Research: Configuring Pi for an Ollama Endpoint in Metidos

Date: 2026-04-10  
Repository: `metidos`

## Goal

Figure out how Metidos's Pi integration should be configured for an Ollama endpoint, and which environment variables actually matter.

## Bottom Line

Metidos does not have a dedicated Ollama endpoint environment variable.

For Ollama, Pi is configured through a custom-provider entry in `models.json`, and Metidos reads that file from its own app-data directory under `.../pi-agent/models.json`.

Current product behavior:

- Metidos shows `Ollama` in the model selector even before it is configured.
- Until a valid `providers.ollama` entry exists in Metidos's Pi `models.json`, that selector entry is shown as disabled.
- The Settings panel includes a minimal `Ollama` section with only `Ollama URL` and `Ollama key`.
- When those values are saved, Metidos queries Ollama's models endpoint, rebuilds the `providers.ollama.models` list, and writes the Pi `models.json` entry itself.

For a normal local Ollama setup:

- `METIDOS_APP_DATA_DIR` is optional and only matters if you want to move Metidos's app-data directory.
- `PI_CODING_AGENT_DIR` is not used by Metidos's Pi runtime or model catalog.
- There is no built-in `OLLAMA_BASE_URL` env var.
- There is no required `OLLAMA_API_KEY` env var.
- Pi still requires an `apiKey` field in the Ollama provider config, but Ollama ignores it, so a literal placeholder such as `"ollama"` works.

If you want env-backed auth or custom headers, the env var names are user-defined through `models.json`. They are not fixed by Metidos or by Pi's built-in provider list.

## Why

Metidos's Pi integration does not use Pi's default agent directory lookup.

- [src/bun/pi-thread-runtime.ts](../src/bun/pi-thread-runtime.ts) creates `ModelRegistry` with `join(agentDirectory, "models.json")`, where `agentDirectory` is Metidos's own `pi-agent` directory under app data.
- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts) builds the browser-visible model catalog from that same Metidos-owned `models.json`.
- [src/bun/db.ts](../src/bun/db.ts) resolves the app-data root from `METIDOS_APP_DATA_DIR` first, then falls back to platform defaults under `.metidos`.

Pi's own docs also make the Ollama contract explicit:

- `node_modules/@mariozechner/pi-coding-agent/docs/providers.md` says Ollama is configured as a custom provider via `models.json`.
- `node_modules/@mariozechner/pi-coding-agent/docs/models.md` shows Ollama configured with `baseUrl`, `api: "openai-completions"`, and `apiKey`.
- That same Pi doc says only `apiKey` and `headers` support env-var or shell-command resolution in `models.json`.

Inference from those sources: for Ollama, the endpoint URL belongs in `baseUrl` as literal config, not in a dedicated env var.

## Environment Variables

These are the env vars that matter for Ollama in Metidos:

- `METIDOS_APP_DATA_DIR`
  - Optional.
  - Use this only if you want Metidos to store `pi-agent/models.json` somewhere other than the default per-user app-data directory.
- Custom env vars referenced by your own `models.json`
  - Optional.
  - Only relevant if you choose to set `apiKey` or custom `headers` to env-var names such as `OLLAMA_API_KEY`.

These env vars do not define the Ollama endpoint for Metidos:

- `PI_CODING_AGENT_DIR`
  - Pi's standalone CLI env var, but not used by Metidos's Pi integration.
- `OLLAMA_BASE_URL`
  - No built-in support in Metidos or in Pi's `models.json` contract.
- `OLLAMA_API_KEY`
  - Not required for normal local Ollama use. You may invent and use this name yourself if you reference it from `models.json`.

## Example `models.json`

Put this file under Metidos's Pi config path:

- default path: `<metidos-app-data>/pi-agent/models.json`
- overridden path: `${METIDOS_APP_DATA_DIR}/pi-agent/models.json`

Example:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen2.5-coder:7b"
        }
      ]
    }
  }
}
```

Notes:

- `apiKey` is required by Pi's custom-provider schema, but Ollama ignores it.
- `compat.supportsDeveloperRole=false` and `compat.supportsReasoningEffort=false` are commonly needed for Ollama and other OpenAI-compatible local servers.
- If you want env-backed values, Pi docs only guarantee env resolution for `apiKey` and `headers`, not for `baseUrl`.

## Default Paths

If `METIDOS_APP_DATA_DIR` is unset, Metidos uses these defaults:

- macOS: `~/Library/Application Support/.metidos/pi-agent/models.json`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/.metidos/pi-agent/models.json`
- Windows: `%APPDATA%\\.metidos\\pi-agent\\models.json`
