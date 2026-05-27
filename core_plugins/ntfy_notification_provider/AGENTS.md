# AGENTS for ntfy Notification Provider

## Purpose

First-party notification provider plugin for sending Metidos notifications through ntfy.

## Files

- `metidos-plugin.json`: manifest, env/settings declarations, network allowlist, and notification provider declaration.
- `index.ts`: provider registration and ntfy send callback.

## Safety

Keep `server_url` covered by `network.allow`. The default manifest permits only `https://ntfy.sh/**`.
Do not log notification bodies, topics, tokens, or headers.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
