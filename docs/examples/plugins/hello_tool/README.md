# Hello Tool example plugin

A copyable minimal Plugin System v1 plugin.

## Install in a dev app-data directory

Copy this whole `hello_tool/` folder into:

```text
APP_DATA/plugins/hello_tool/
```

Then review and approve the plugin from Settings → Plugins. Enable the `hello_tools` access group on a thread to expose the `hello_world` tool.

## Tool arguments

```json
{
  "name": "Metidos",
  "format": "markdown"
}
```

- `name` is optional and defaults to `world`.
- `format` is optional; use `text` or `markdown`.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
