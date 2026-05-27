# RSS Feed Indexer Core Plugin

`rss_feed_indexer` is a first-party Plugin System v1 core plugin that keeps a local semantic index of RSS items.

## What it does

- Adds a Plugin Setting named `list_url` containing RSS feed URLs or OPML subscription-list URLs.
- Registers a local cron, `refresh_feeds`, on `0 3 * * *` so the configured RSS list is refreshed daily at 3:00 AM server time.
- Fetches each configured URL, detects OPML vs. RSS/Atom XML, expands OPML `outline xmlUrl` children, and indexes RSS/Atom items.
- Stores vectors in plugin-owned LanceDB paths under `~/rss/local/items` using the local operator's configured Metidos embedding model.
- Stores a bounded metadata catalog at `~/rss/local/catalog.json` so date-only queries can be answered even though the current plugin LanceDB API exposes vector query but not a full table scan.
- Exposes the `RSS: Query` access group with one tool: `rss_query`.

## `rss_query` input

All properties are optional, but at least one must be present:

```ts
interface Options {
  startDate?: string;
  endDate?: string;
  q?: string;
}
```

- `q`: embeds the query and searches the local LanceDB rows semantically.
- `startDate`: inclusive ISO date or date-time lower bound.
- `endDate`: inclusive ISO date or date-time upper bound.

When `q` is present, the plugin semantic-searches LanceDB first and then applies date filters. When only dates are present, it searches the regenerated metadata catalog and returns the newest matching items.

## Required setup

1. Run the normal core plugin sync path, usually by starting Metidos or running `bun run sync:core-plugins`, so this folder is copied into `APP_DATA/plugins/rss_feed_indexer/`.
2. Review the manifest before approval:

   ```json
   "permissions": ["network:fetch", "unsafe"],
   "network": { "allow": ["https://**/**"], "enforceHttps": true }
   ```

   The checked-in manifest intentionally uses all-domain HTTPS fetch access so users can configure arbitrary public RSS or OPML feed hosts. Plugin System v1 accepts this star-domain pattern only when the plugin also declares the existing `unsafe` permission. Keep the wildcard only if this installation accepts that review risk; otherwise replace it with literal approved feed origins in the app-data plugin copy before approval.
3. Approve the plugin in Settings → Plugins.
4. Configure the `list_url` Plugin Setting with HTTPS RSS or OPML URLs.
5. Ensure the user has a runtime embedding model configured; both the daily cron and semantic queries call `metidos.embeddings.embed(...)`.
6. Enable the `RSS: Query` access group on threads that should use `rss_query`.

## Permissions

- `cron:create`: register the daily local refresh cron.
- `network:fetch` plus `unsafe`: fetch arbitrary user-configured public HTTPS RSS and OPML URLs through `https://**/**`. Safe outbound/private-network protections still apply; fetched XML and feed item content must remain untrusted.
- `metidos:can_embed`: call the local operator's configured embedding model for feed items and query text.
- `metidos:lancedb`: open plugin-owned LanceDB vector stores.
- `storage:read` / `storage:write`: maintain the local metadata catalog and LanceDB-derived data under `.data/`.
- `log:write`: write bounded operational diagnostics without feed item bodies.

## Validation

From the repository root:

```bash
bun test src/bun/plugin/core-rss-feed-indexer-plugin.test.ts
bun test src/bun/plugin/examples.test.ts --test-name-pattern "copyable example"
```

Core plugin sync can be checked with `bun run sync:core-plugins` in a development app-data directory.
