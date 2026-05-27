# AGENTS for Agent Memory

## Purpose

Agent Memory is a first-party core plugin that exposes five thread tools through the **Agent Memory** access group:

- `agent_memory_remember`: stores direct text from a `payload` prop.
- `agent_memory_remember_file`: reads an allowed project file and stores its text.
- `agent_memory_recall`: embeds a query and returns relevant stored chunks with the plugin-owned memory file reference.
- `agent_memory_forget`: deletes stale or contradictory memory by memory id, file name, or `~/memory/files/{memory_id}.md` path.
- `agent_memory_modify`: replaces stale or contradictory memory with corrected content, then re-embeds fresh chunks under the same memory id.

Agents should use `recall` proactively for orientation. At the start of each turn, run a couple recalls related to the current user prompt/task before deciding what to do. Recall again before meaningful decisions and before tool/file/code actions when prior context could affect the outcome.

Agents should use `remember` and `remember_file` liberally whenever important information arises that could help future agents, or when information should be researched from the web and persisted. Use `forget` or `modify` when remembered information becomes stale, contradictory, or superseded.

The plugin consumes the local operator's configured Metidos embedding model and stores vectors in plugin-owned LanceDB data. It also writes one full-memory file per remembered item under plugin-owned `~/memory/files/`. It intentionally does not use SQLite or the Metidos application database.

## Source layout

- `metidos-plugin.json`: Plugin System v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point, input validation, chunking, full-file writing, embedding, LanceDB upsert/query, and markdown result rendering.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; contains full memory files and LanceDB vector data after tools run.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups from Reset Plugin Data; do not commit.

Root `node_modules/` is forbidden.

## Validation

1. Validate `core_plugins/agent_memory/metidos-plugin.json` against `docs/metidos-plugin.schema.json`.
2. Build/startup-check the plugin entrypoint where practical using the repository plugin tests.
3. Run `bun format` and the relevant validation/test slice before committing.
4. Confirm no root `node_modules/` exists.
5. Confirm imports are local or `@metidos/plugin-api` only.

Example manifest validation from the repository root:

```bash
bun -e 'import Ajv from "ajv"; import { readFileSync } from "node:fs"; const schema = JSON.parse(readFileSync("docs/metidos-plugin.schema.json", "utf8")); const manifest = JSON.parse(readFileSync("core_plugins/agent_memory/metidos-plugin.json", "utf8")); const validate = new Ajv({ allErrors: true, strict: false }).compile(schema); if (!validate(manifest)) { console.error(JSON.stringify(validate.errors, null, 2)); process.exit(1); } console.log("manifest schema ok");'
```

## `.data` contents

Expected runtime data:

- `.data/memory/files/{memory_id}.md`: full accepted user-authored memory text plus simple metadata (`id`, `created_at`, `title`, `source`, `chunk_count`, `memory_truncated`, `index_truncated`). This is durable user memory, not a disposable cache.
- `.data/memory/chunks/**`: LanceDB/vector-store files for embedded chunks. Rows use ids shaped like `{memory_id}:chunk:{index}` and store `memoryId`, `filePath`, `title`, `source`, `chunkIndex`, `chunkCount`, `createdAt`, a bounded `chunk`, and `vector`.

The vector store is derived from the full memory files. Treat `~/memory/files/` as the source of truth and `~/memory/chunks` as the query index. `modify` reindexes one memory in place, while `forget` removes both the memory file and its indexed chunks.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not print or copy memory files unless the user explicitly asks; they may contain private project or personal data.
- Do not inspect LanceDB internals unless diagnosing corruption.
- Do not edit `.data` while the plugin sidecar is running unless future docs explicitly allow it.

## Safe `.data` repair

Use Metidos Reset Plugin Data for unknown corruption only if the user accepts deleting all Agent Memory content. Reset clears both full memory files and vector data.

For narrow manual repair:

1. Stop or disable the plugin first.
2. Back up `.data/memory/files/` and `.data/memory/chunks/` or rely on a full `.data` copy.
3. Prefer deleting the corrupt vector index over editing LanceDB files by hand.
4. Keep full memory file edits minimal and user-approved.
5. Restart/retry the plugin and run a small `remember` + `recall` smoke test.

There is no bulk automated reindex command yet. Use `modify` to reindex a single existing memory with corrected content. If the vector index is deleted, existing full memory files will not be searchable until each memory is modified/re-remembered or a future bulk reindex mechanism is added.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, copies `seed/**` if present, and restarts/reloads the plugin. This plugin has no seed files, so reset removes all stored Agent Memory files and vector indexes. Embedding provider settings are not stored in `.data` and must remain configured separately.

## Secrets and logs

This plugin does not require API keys or direct network access. It uses the host-selected embedding provider, so memory text and file contents may be sent to whichever embedding provider the user configured. Do not store or remember secrets unless the user intentionally chooses to do so and understands that the full text and vectors persist in plugin-owned data.

The plugin logs only synthetic memory ids and chunk counts. Do not add raw memory payloads, file contents, query text, API keys, headers, or hidden thread state to logs or thrown errors.

## Embeddings and vector search

Agent Memory consumes embeddings and stores LanceDB vectors:

- `metidos:can_embed` is required because `remember`, `remember_file`, `recall`, and `modify` call `metidos.embeddings.embed(...)`.
- `metidos:lancedb` and `storage:write` are required because chunk vectors are stored under `~/memory/chunks`.
- Full memory files are stored under `~/memory/files` with `storage:write`; `forget` and `modify` use `storage:read` to inspect memory metadata for deterministic stale-chunk cleanup, and `forget` also requires `storage:delete` to remove stale memory files.
- The plugin does not provide embedding models and must not declare `metidos:provides_embeddings` unless it starts registering an embedding provider.
- The plugin does not use SQLite and must not request the `sqlite` permission.

Embedding inputs are bounded chunks derived from direct `remember.payload` text, bounded chunks derived from `remember_file` contents, bounded chunks derived from `modify.payload`, and `recall.query` text. Very large memories may be stored up to the plugin cap while only the first bounded portion is indexed; the memory file metadata records `chunk_count`, `memory_truncated`, and `index_truncated`. The optional embedding payload contains only purpose/source metadata and synthetic memory ids; it must not include secrets.

## Context notes

- Tools run in thread tool contexts only.
- `remember_file` reads project `./` files and therefore requires `storage:read` for the Plugin System v1 read API plus `files:read` for project-file authorization. The manifest currently allows `./**` with explicit denies for env files, `.git`, `.ssh`, and `node_modules`; tighten this allowlist for installations that only want memories from specific paths.
- Project file access is unavailable outside thread tool contexts.
- Plugin LanceDB storage is plugin-owned `~/` data only; it does not open project vector stores.
- Recall returns chunk text and a plugin-owned memory file path. Use that memory file path, file name, or memory id as the key for `forget` and `modify`.
- Agents cannot directly read plugin data paths unless future tools expose that ability; the path is for provenance, `forget`/`modify`, and local inspection.
