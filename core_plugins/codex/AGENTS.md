# AGENTS for Codex

## Purpose

First-party credential plugin for Pi's built-in `openai-codex` provider. Pi owns the provider id, endpoint, model catalog, transport, and model metadata.

## Files

- `metidos-plugin.json`: manifest, `.data` quota for `auth.json`, auth path setting/env declarations, and `piAuth` binding to `openai-codex`.
- `index.ts`: no-op sidecar entry point.
- `AGENTS.md`: maintenance guide.

## Behavior

Do not register a model provider here. Put the Codex CLI file-auth JSON at `.data/auth.json`; the `piAuth` manifest binding resolves `auth_json_path` and propagates `tokens.access_token` and `tokens.refresh_token` into Pi's `openai-codex` auth storage before runtime startup.

## Safety

Do not store, log, or copy Codex access tokens in plugin source. `.data/auth.json` is runtime data and must not be committed.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
