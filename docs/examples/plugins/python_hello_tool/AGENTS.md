# Python Hello Tool Plugin

Use this copyable example to verify Python plugin entrypoints.

- Entrypoint: `main.py`
- Runtime: safe Pyodide plugin host, not host Python
- Tool: `python_hello_world`

Validation:

```bash
bun test src/bun/plugin/examples.test.ts
```

Safety notes:

- Do not use raw Python `open()` for host files.
- Use the Metidos API exposed by `from metidos import ...`.
- Keep the manifest `access[].tools[].name` aligned with `add_agent_tool({"tool": ...})`.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
