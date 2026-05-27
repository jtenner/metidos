# Vector Memory Plugin Example

This copyable Plugin System v1 example registers two thread tools backed by Metidos embeddings and plugin-scoped LanceDB storage:

- `remember_note` embeds and stores a note in `~/memory/notes`.
- `search_notes` embeds a natural-language query and returns the closest stored notes.

The plugin requires an embedding model to be configured in Settings → General → Runtime. It stores only plugin-owned data under `.data/` and does not read project files.

## Example tool calls

Remember a note:

```json
{ "note": "Metidos LanceDB paths in plugins should use ~/ plugin data roots.", "title": "LanceDB plugin paths" }
```

Search notes:

```json
{ "query": "How should plugins store vectors?", "limit": 5 }
```

## Embeddings and vector search

This example demonstrates the recommended consumer flow: embed text with `metidos.embeddings.embed(...)`, store rows with `vector` fields through `metidos.lancedb.open("~/...")`, and query by embedding the user's search text. It requires a configured embedding model in runtime settings.
