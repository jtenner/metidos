# Ollama Model Provider example

This copyable Plugin System v1 example registers a model provider family named `ollama`. It is intended for local Ollama instances and demonstrates:

- provider family registration through `metidos.providers.addProvider`,
- multiple provider configurations loaded from plugin-owned `~/.data` (`~/providers.json`),
- narrow HTTP network allowlists for local Ollama only,
- dynamic model discovery from `GET /api/tags`,
- stable configuration ids and model ids, and
- empty-model failure behavior when Ollama is offline.

## Copy into Metidos

Copy this folder into:

```text
APP_DATA/plugins/ollama_model_provider/
```

Approve it from Settings. On first activation, Metidos copies `seed/providers.json` to `.data/providers.json`.

## Configure instances

Edit `.data/providers.json` while the plugin is stopped or disabled:

```json
{
  "providers": [
    {
      "id": "local",
      "label": "Local Ollama",
      "baseUrl": "http://localhost:11434",
      "discoverModels": true,
      "models": []
    }
  ]
}
```

Keep `id` stable. Metidos uses the plugin id, provider id, configuration id, and model id to build stable model identities.

## Network allowlist

The manifest allows only:

- `http://localhost:11434/**`
- `http://127.0.0.1:11434/**`

If you use a different host or port, update `network.allow` and re-review the plugin before activation.

## Failure behavior

If `~/providers.json` cannot be read or parsed, the plugin uses one local configuration with no models. If model discovery fails or returns no models, it logs a warning when logging is enabled and returns an empty model list instead of inventing fallback models. Static `models` entries are used only when `discoverModels` is `false`.

## Embeddings and vector search

When adapting this model provider example for embeddings, add `metidos:provides_embeddings`, implement an `embed(context, request)` callback, and expose only models that can return numeric vectors as embedding-capable. Embedding consumers are separate plugins and should use `metidos:can_embed` plus `metidos:lancedb` only when they call the embedding API or store vectors.
