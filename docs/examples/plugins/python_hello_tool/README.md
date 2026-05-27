# Python Hello Tool

A copyable Plugin System v1 example that registers an agent tool from `main.py`.

Copy this directory to `APP_DATA/plugins/python_hello_tool`, review it in Settings → Plugins, approve it, and enable the `python_hello_tool/python_tools` access group in a thread.

The plugin runs in Metidos' safe Pyodide host. It cannot access host `process`, `Bun`, `globalThis`, or raw host filesystem paths; use Metidos APIs instead.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
