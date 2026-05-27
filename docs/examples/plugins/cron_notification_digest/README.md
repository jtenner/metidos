# Cron Notification Digest example

This copyable Plugin System v1 example registers one global cron named `send_digest`. Every 15 minutes it calls `metidos.notifications.send` and logs receipt diagnostics.

It demonstrates:

- `metidos.cron` with the `cron:create` permission,
- `metidos.notifications.send` with the `notification:send` permission,
- Plugin Settings that can disable the cron or adjust the title prefix,
- timeout-bounded cron execution (`timeoutMs: 2000`),
- no-outlet and rate-limit receipt handling, and
- log-based diagnostics that do not crash the sidecar when logging itself fails.

## Copy into Metidos

Copy this folder into:

```text
APP_DATA/plugins/cron_notification_digest/
```

Approve it from Settings. Keep plugin notifications enabled and configure at least one notification outlet or notification-provider plugin if you want delivered receipts.

## Receipt behavior

`metidos.notifications.send` returns receipts. Delivery controls and rate limits are enforced by Metidos before provider delivery. This example treats failed receipts as expected diagnostics and returns them from the cron action so a developer can inspect behavior in tests or sidecar traces.

Common failed receipt codes include:

- `NO_ENABLED_NOTIFICATION_OUTLETS` when no outlet can deliver a global cron notification.
- `RATE_LIMITED` when the plugin exceeds notification controls.
- `CRON_NOTIFICATION_TIMEOUT` when the send path exceeds the cron deadline.
- `CRON_NOTIFICATION_SEND_ERROR` for permission, malformed request, or host send failures that throw before receipts exist.

## Cron context limitations

The cron has no current thread or project. It should not read project files, use terminal APIs, or depend on interactive notification state. If the `enabled` setting is `false`, the cron logs a skipped run and does not send a notification.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
