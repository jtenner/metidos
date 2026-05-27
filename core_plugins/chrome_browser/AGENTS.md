# AGENTS for Chrome Browser

## Purpose

This first-party Plugin System v1 plugin exposes Chrome DevTools Protocol browser-control tools to approved threads. It connects only to the container-local Chromium endpoint at `http://127.0.0.1:9222` / `ws://127.0.0.1:9222`, opens managed browser targets, navigates pages, converts current page HTML to Markdown through `metidos.html.toMarkdown`, captures screenshots, sends keyboard and mouse input, resizes the viewport, evaluates JavaScript, exposes raw CDP calls, lists status, closes managed sessions, and registers Plugin GC to remove generated screenshots.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point and CDP tool implementation.
- `AGENTS.md`: this operator and agent guide.
- `.data/`: generated plugin data owned by Metidos; screenshots are written below `.data/screenshots/`.
- `.logs/`: generated plugin logs when logging is enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

1. Validate `metidos-plugin.json` through the Metidos plugin manifest validation path.
2. Run `bunx biome check core_plugins/chrome_browser/index.ts src/bun/html-to-markdown.ts src/bun/plugin/author-api.ts src/bun/plugin/plugin-api-runtime.ts src/bun/plugin/quickjs-runtime.ts src/bun/plugin/python-runtime.ts src/bun/plugin/startup-registrations.ts src/bun/plugin/execution-capability.ts src/bun/plugin/sidecar-main.ts`.
3. Confirm no root `node_modules/` exists.
4. Confirm imports are local or `@metidos/plugin-api` only.
5. Live test after approval by enabling `chrome_browser/browser_tools` on a test thread, using `browser_open`, `browser_markdown`, `browser_screenshot`, and `browser_close`, then running Plugin GC from plugin settings to remove `~/screenshots/*.png` and other generated screenshot images.

## `.data` contents

- `screenshots/`: generated browser screenshots returned to agents as `image:file` tool results. Files are durable until reset, manual cleanup, or Plugin GC. Plugin GC removes generated `.png`, `.jpg`, and `.jpeg` files from this directory. Screenshot files are bounded by the plugin storage quota.

No secrets should be stored in `.data`.

## Safe `.data` inspection

- Prefer read-only inspection of `.data/screenshots/`.
- Screenshots may contain private page content. Do not copy or print them unless needed for the active debugging task.
- Do not edit `.data` while the plugin sidecar is running.

## Safe `.data` repair

1. Stop or disable the plugin before mutating screenshot files.
2. Prefer Run Plugin GC to remove stale generated screenshots under `.data/screenshots/`; if the runtime is unavailable, remove the generated image files manually.
3. Run validation again.
4. Restart or re-approve the plugin from Metidos settings if source files changed.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. All generated screenshots are removed from the active data directory. Run Plugin GC deletes generated screenshot images in `.data/screenshots/` without resetting other plugin data. Browser sessions are process-local and are lost when the plugin sidecar restarts.

## Secrets and logs

The plugin does not declare env vars or settings and should not store secrets. It may log session ids and high-level actions. Do not log page text, screenshot bytes, cookies, credentials, authorization headers, or raw CDP results that may contain private page content.

## Embeddings and vector search

This plugin does not provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic browser history or page memory, update the manifest and this file together.

## Context notes

- The plugin requires `unsafe`, `network:fetch`, and `network:websocket` because Plugin System v1 blocks loopback/private network access unless the local operator explicitly allows it.
- The local operator must include `chrome_browser` in `METIDOS_PLUGIN_UNSAFE_PRIVATE_NETWORK_PLUGINS` for container-local CDP access.
- The plugin uses only the container-local Chrome DevTools Protocol endpoint. It should not request terminal permissions or connect to arbitrary websites directly through plugin network APIs.
- Browser sessions are held in plugin sidecar memory and are owned by the thread context that opened them. A thread cannot use or close another thread's managed session even if it knows the session id.
- `browser_open` sets an idle timeout for each session. The default is 15 minutes, callers may set `idleTimeoutMs` from 1 minute to 1 hour, and expired sessions are closed lazily at the start of subsequent browser tool calls. Without a background plugin timer, a completely idle sidecar may retain an expired Chrome target until the next browser tool call, sidecar restart, app restart, or container restart.
