# Cron Notification Digest Plugin

This copyable example registers a global Plugin System v1 cron that sends a Metidos notification digest and records diagnostic logs.

## Files

- `metidos-plugin.json`: manifest, permissions, settings, and limits.
- `index.ts`: cron registration and notification-send callback.
- `README.md`: setup, cron context, and receipt behavior notes.
- `.data/`: not used by this plugin.
- `.logs/`: generated only if plugin logging is enabled; do not commit.

Root `node_modules/` is forbidden. Keep imports local or `@metidos/plugin-api` only.

## Validation

From the Metidos repository, run:

```bash
bun test src/bun/plugin/examples.test.ts src/bun/plugin/manifest.test.ts
```

After approval, inspect plugin logs or cron diagnostics for `send_digest`. Delivered, no-outlet, and rate-limited sends should appear as receipts instead of uncaught sidecar crashes.

## `.data` contents

This plugin intentionally does not use plugin-owned `.data`. If `.data` exists after local experimentation, inspect it before deleting, then remove it while the plugin is stopped.

## Safe inspection and repair

- Check `metidos-plugin.json` before adding permissions.
- Keep the cron global; do not add thread/project assumptions to the action.
- Preserve failed receipt handling for `NO_ENABLED_NOTIFICATION_OUTLETS` and `RATE_LIMITED` diagnostics.
- Keep the cron `timeoutMs` low enough for diagnostics, but high enough for the configured notification outlets.

## Reset behavior

Reset Plugin Data has no expected effect because this plugin does not maintain `.data` state.

## Secrets and logs

This example does not declare secrets. Avoid adding notification payload secrets because receipts and logs are intended to be easy to inspect during development.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
