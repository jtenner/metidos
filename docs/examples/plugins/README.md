# Copyable Plugin System v1 examples

These directories are complete plugin folders that can be copied into `APP_DATA/plugins/{plugin_id}/` for development review and approval.

- [`cron_notification_digest`](./cron_notification_digest/) demonstrates a global cron that sends notifications and records no-outlet/rate-limit diagnostics.
- [`fake_ingress`](./fake_ingress/) demonstrates a provider-agnostic request ingress source and reply-to-source fixture.
- [`hello_tool`](./hello_tool/) demonstrates a minimal agent tool with text and markdown results.
- [`ntfy_notification_provider`](./ntfy_notification_provider/) demonstrates a notification provider with settings/env, network fetch, receipts, and timeout-safe failure handling.
- [`ollama_model_provider`](./ollama_model_provider/) demonstrates an Ollama model provider with multi-instance `.data` configuration, local network allowlists, dynamic discovery, stable model IDs, and notes for adapting provider plugins to expose embeddings.
- [`python_hello_tool`](./python_hello_tool/) demonstrates a minimal Python agent tool running in the safe Pyodide plugin host.
- [`rss_feed_indexer`](./rss_feed_indexer/) demonstrates app-local RSS/OPML feed refresh with `metidos.cron`, unsafe all-domain HTTPS feed fetching, Metidos embeddings, and plugin-scoped LanceDB query storage.
- [`vector_memory`](./vector_memory/) demonstrates `metidos.embeddings.embed(...)` plus plugin-scoped LanceDB vector storage for semantic memory.

The standalone JSON files one level up are manifest-only fixtures for schema documentation. The directories here include the full copyable shape: `metidos-plugin.json`, `AGENTS.md`, a manifest-declared entrypoint such as `index.ts` or `main.py`, and a README. Keep each example `AGENTS.md` aligned with [`../../metidos-plugin-agents-guide.md`](../../metidos-plugin-agents-guide.md) and use [`../../../.pi/skills/metidos-plugin-authoring/SKILL.md`](../../../.pi/skills/metidos-plugin-authoring/SKILL.md) when creating or updating copyable plugin examples.

## Embeddings and vector search

The example set now includes both sides of the embeddings story:

- Provider examples should request `metidos:provides_embeddings` only when they implement `embed(context, request)` and expose embedding-capable models.
- Consumer examples should request `metidos:can_embed` only when they call `metidos.embeddings.embed(...)`.
- Vector storage examples should request `metidos:lancedb` plus `storage:write`, open only plugin-owned `~/` paths, and document reset/regeneration behavior in `AGENTS.md`.

Use `vector_memory` as the minimal copyable consumer/vector-store example.
