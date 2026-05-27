# Fake Ingress Plugin Agent Notes

This fixture is for local ingress testing only. It must not contact real services or use real credentials.

## Validate

- Keep `metidos-plugin.json` permissions narrow: storage read/write, `plugin:request-ingress`, `plugin:reply-to-source`, and logging only.
- Do not add `network:fetch` or network allowlists to this fake fixture.
- Keep seeded external ids synthetic and non-secret.

## Reset behavior

Reset Plugin Data restores `seed/fake-updates.json` into `.data/fake-updates.json` and removes runtime reply logs. Use reset before reproducing cursor, dedupe, identity-binding, or link-code behavior.

## Logs and replies

Replies are appended to `.data/fake-replies.jsonl` so operators can inspect what `reply_to_source` attempted to send. Treat these files as test artifacts and do not commit `.data/` or `.logs/` from an installed plugin copy.

## Link-code expectations

Inbound messages from unknown fake external users should be recorded as unverified until a Metidos user links the matching external user id. Use the seeded `external_user_id` values when exercising link-code setup.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
