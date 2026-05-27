# Hello Tool example plugin

This copyable plugin demonstrates the smallest useful Plugin System v1 agent-tool shape.

## What it does

- Declares the `hello_tools` thread access group.
- Registers one `hello_world` tool from `index.ts`.
- Accepts optional `name` and `format` arguments.
- Returns either a `text` or `markdown` tool result.

## Validate it

From the Metidos repository root:

```bash
bun test src/bun/plugin/examples.test.ts
```

The manifest is also covered by the plugin manifest schema drift tests.

## Data and generated files

This plugin does not declare storage permissions and should not create `.data`, `.logs`, or generated source files. If a local run leaves those directories behind, they can be removed before review.

## Safe editing guidance

- Keep the manifest `id` equal to the install directory name: `hello_tool`.
- Keep tool declarations in `metidos-plugin.json` aligned with `metidos.addAgentTool(...)` in `index.ts`.
- Do not add package-manager install steps or `node_modules/`.
- Only import local files or `@metidos/plugin-api`.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
