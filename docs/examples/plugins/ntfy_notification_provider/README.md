# ntfy Notification Provider example

This copyable Plugin System v1 example registers a notification provider named `ntfy`. It forwards Metidos notifications to an ntfy topic and returns provider receipts.

It demonstrates:

- `metidos.notifications.addProvider`,
- the `notification:provider` permission,
- secret env and general setting declarations,
- a narrow `network.allow` for `https://ntfy.sh/**`,
- receipt objects for delivered and failed sends, and
- timeout/error handling that fails the receipt instead of crashing Metidos.

## Copy into Metidos

Copy this folder into:

```text
APP_DATA/plugins/ntfy_notification_provider/
```

Approve it from Settings, then configure either:

- `NTFY_TOPIC` in the Metidos host environment, or
- the plugin's secret `default_topic` general setting.

Use a private, unguessable topic. Set `NTFY_TOKEN` only when your topic/server requires bearer authentication.

## Network allowlist

The default manifest allows only `https://ntfy.sh/**`. To use a self-hosted ntfy server, update both:

1. the `server_url` setting value, and
2. `network.allow` in `metidos-plugin.json`.

Changing the manifest requires plugin re-review.

## Receipt behavior

A successful send returns a delivered receipt with the ntfy message id when the server provides one. Missing topic, network policy failures, server errors, and timeouts return failed receipts with stable `code` values so Metidos can surface diagnostics without treating the plugin as crashed.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
