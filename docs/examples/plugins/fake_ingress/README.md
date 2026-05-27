# Fake Ingress Plugin

This non-normative example shows how a Plugin System v1 plugin can register a provider-agnostic request ingress source without talking to a real network.

The source behaves like a Telegram-style long-polling direct-message adapter, but it is deliberately fake: it reads queued messages from plugin storage and writes replies to plugin storage. Use it to exercise the Metidos-owned ingress flow, identity-linking flow, cursor/dedupe behavior, and reply-to-source plumbing without Telegram credentials or external webhooks.

## What it demonstrates

- Declaring only the ingress host capabilities needed by the plugin.
- Registering an ingress source at startup with `metidos.ingress.registerSource`.
- Returning plain-text external messages with provider-local ids.
- Advancing an opaque cursor only after messages are returned.
- Rendering short source instructions that Metidos embeds in its host-owned ingress prompt envelope.
- Optionally accepting scoped replies for the original response target.

## Storage files

The fixture uses plugin-owned `.data/` files only:

- `seed/fake-updates.json` seeds example inbound direct messages on first activation or Reset Plugin Data.
- `.data/fake-updates.json` is the editable fake inbound queue.
- `.data/fake-replies.jsonl` receives reply-to-source payloads for inspection.

Reset Plugin Data restores the seed queue and clears runtime replies. Do not put real tokens, chat ids, or production transcripts in these files.

## Telegram-like mapping

A real Telegram adapter would map Telegram update ids, user ids, chat ids, and message text into the same generic fields used here. That mapping belongs in the plugin; Metidos core remains provider-agnostic and only sees external ids as untrusted provider-local strings until the user completes the Metidos link-code flow.

The fake fixture intentionally omits network permissions and network allowlists. A real long-polling plugin would request `network:fetch`, declare a narrow HTTPS allowlist such as the provider API origin, and store credentials in secret env/settings declarations.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
