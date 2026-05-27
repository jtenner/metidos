# AGENTS for Vector Memory Example

This example demonstrates Plugin System v1 vector storage with Metidos embeddings and `metidos.lancedb`.

## Files

- `metidos-plugin.json`: manifest with `metidos:can_embed`, `metidos:lancedb`, and `storage:write` permissions plus the `memory_tools` access group.
- `index.ts`: registers `remember_note` and `search_notes` tools.
- `README.md`: copyable usage notes.

## Safety and storage

- The plugin stores vectors only under plugin-owned `~/memory/notes` data.
- Do not add project `files:*` permissions; this example should not read or write worktree files.
- Do not log note contents. Logging should remain generic.
- Keep results bounded by the `limit` prop and the host LanceDB query cap.

## Validation

Run:

```bash
bun test src/bun/plugin/examples.test.ts --test-name-pattern "examples|vector|builds and activates"
```

The full repository validation path remains `bun validate`.

## Embeddings and vector search

This example is the canonical minimal embedding consumer. It requires `metidos:can_embed` for `metidos.embeddings.embed(...)`, `metidos:lancedb` for `metidos.lancedb.open(...)`, and `storage:write` for plugin-owned vector data. Keep the example small: no project file access, no network access, no secret storage, and no note content in logs.
