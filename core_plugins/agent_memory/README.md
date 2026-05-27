# Agent Memory plugin

Agent Memory is a Plugin System v1 plugin that adds an access group named **Agent Memory** with five tools:

- `agent_memory_remember` — store a direct string payload.
- `agent_memory_remember_file` — read an allowed project file and store its contents.
- `agent_memory_recall` — search stored memory chunks with semantic embeddings.
- `agent_memory_forget` — delete stale or contradictory memory by memory id, file name, or memory file path.
- `agent_memory_modify` — replace a memory's content and re-embed fresh chunks under the same memory id.

Agents should use `recall` proactively for orientation. At the start of each turn, run a couple recalls related to the current user prompt/task before deciding what to do. Recall again before meaningful decisions and before tool/file/code actions when prior context could affect the outcome.

Agents should use `remember` and `remember_file` liberally whenever important information arises that could help future agents, or when information should be researched from the web and persisted. Use `forget` or `modify` when remembered information becomes stale, contradictory, or superseded.

The plugin is intentionally separate from SQLite. It writes full memories to plugin-owned files under `~/memory/files/` and writes embedded chunk rows to plugin-owned LanceDB storage under `~/memory/chunks`.

## Tool props

Remember direct content:

```json
{
  "payload": "Important context to remember.",
  "title": "Optional title",
  "source": "Optional source label"
}
```

Remember an allowed project file:

```json
{
  "path": "./docs/example.md",
  "title": "Optional title"
}
```

Recall relevant memory chunks:

```json
{
  "query": "What context do we have about example?",
  "limit": 8
}
```

Forget stale or contradictory memory:

```json
{
  "file": "~/memory/files/mem-example123-abc456.md"
}
```

Modify a memory in place and re-embed it:

```json
{
  "file": "mem-example123-abc456.md",
  "payload": "Corrected memory content.",
  "title": "Optional updated title",
  "source": "Optional updated source"
}
```

## Notes

- Requires a configured Metidos embedding model.
- `remember_file` reads project files through the manifest allowlist and denies common secret-heavy paths.
- `forget` removes both the full memory file and linked chunk rows.
- `modify` reads memory file metadata (`chunk_count`, and fallback `title`/`source`) to clear stale chunks, then rewrites the file and re-indexes chunks under the same memory id.
- Memory files may contain sensitive content. Do not enable the access group on threads that should not persist project or user context.
