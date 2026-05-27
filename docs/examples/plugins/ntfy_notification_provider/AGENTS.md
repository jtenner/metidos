# ntfy Notification Provider Plugin

This copyable example registers an ntfy notification provider for Plugin System v1. It demonstrates `notification:provider`, settings/env declarations, permissioned network fetch, provider receipts, and safe failure/timeout handling.

## Files

- `metidos-plugin.json`: manifest, network allowlist, env/settings declarations, and provider declaration.
- `index.ts`: provider registration and ntfy send callback.
- `README.md`: setup, topic, and receipt behavior notes.
- `.data/`: not used by this plugin.
- `.logs/`: generated only if plugin logging is enabled; do not commit.

Root `node_modules/` is forbidden. Keep imports local or `@metidos/plugin-api` only.

## Validation

From the Metidos repository, run:

```bash
bun test src/bun/plugin/examples.test.ts src/bun/plugin/manifest.test.ts
```

After approval, send a Metidos notification and confirm the receipt identifies provider `ntfy_notification_provider/ntfy`.

## `.data` contents

This plugin intentionally does not use plugin-owned `.data`. If `.data` exists after local experimentation, inspect it before deleting, then remove it while the plugin is stopped.

## Safe inspection and repair

- Check `metidos-plugin.json` before changing any network destination.
- Keep `server_url` covered by `network.allow`; the default manifest permits only `https://ntfy.sh/**`.
- Prefer `NTFY_TOPIC` or the secret `default_topic` setting for topic names.
- Do not print or copy topic names/tokens into issue comments, logs, or screenshots unless necessary for repair.

## Reset behavior

Reset Plugin Data has no expected effect because this plugin does not maintain `.data` state.

## Secrets and logs

`NTFY_TOPIC`, `NTFY_TOKEN`, and the secret `default_topic` setting can grant notification access. Do not log request headers, full URLs with private topics, or token values. The example returns redacted receipt messages and never includes the bearer token in receipts.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
