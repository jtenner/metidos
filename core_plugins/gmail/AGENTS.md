# AGENTS for Gmail

## Purpose

First-party Plugin System v1 plugin for Gmail. It registers thread tools for Gmail search, message read, and draft creation only. It talks only to Google OAuth and Gmail REST endpoints through `metidos.fetch`; it does not use the `googleapis` package, raw Node/Bun APIs, IMAP, SMTP, Gmail web scraping, or any Gmail send endpoint.

## Source layout

- `metidos-plugin.json`: manifest, Google/Gmail network allowlist, OAuth settings/env, and read/draft-only access groups.
- `index.ts`: plugin entry point and tool registrations.
- `gmail.ts`: local helper module for MIME, base64url, Gmail payload parsing, and markdown shaping.
- `README.md`: operator setup and usage notes.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos if future versions add storage; this version should not create it.
- `.logs/`: generated plugin logs when plugin logging is enabled; this version does not intentionally log.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden. Only import `@metidos/plugin-api` and local files.

## Validation

From the Metidos repository root:

```bash
bun test src/bun/plugin/core-gmail-plugin.test.ts src/bun/plugin/manifest.test.ts
bunx tsgo --noEmit
```

Also confirm:

1. `metidos-plugin.json` validates against `docs/metidos-plugin.schema.json`.
2. Tool names in `index.ts` exactly match manifest declarations.
3. No root `node_modules/` exists in this plugin.
4. Network access remains limited to Google OAuth token refresh, Gmail message list/read endpoints, and Gmail draft creation. Keep broad `users/me/**` and `/drafts/send` out of the allowlist.

## `.data` contents

This plugin does not request storage permissions and should not create durable `.data` files. OAuth secrets live in Metidos plugin settings or declared environment variables, not plugin-owned files.

## Safe `.data` inspection

If `.data/` exists after local experimentation, inspect read-only first:

```bash
find core_plugins/gmail/.data -maxdepth 2 -type f -print
```

Do not copy or print secret-bearing files. This plugin version has no expected `.data` contents, so unexpected files should usually be removed from an installed development copy after backing them up if needed.

## Safe `.data` repair

There is no supported manual `.data` repair workflow for this version. If runtime data appears corrupt in an installed copy, disable the plugin, back up the directory, use Metidos Reset Plugin Data, and reconfigure settings if necessary.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. Because this plugin has no seed data and no storage permissions, reset should not affect Gmail OAuth client settings, refresh tokens, or access-group approval state.

## Secrets and logs

Secrets may exist in:

- Plugin Setting `client_secret`, or env `GMAIL_CLIENT_SECRET`;
- Plugin Setting `refresh_token`.

Do not paste those values into chat, logs, errors, tool results, or tests. The plugin intentionally returns only Gmail message metadata/body content requested by enabled tools and draft creation result ids. Plugin System v1 does not automatically redact plugin-authored logs or tool output.

## Embeddings and vector search

This plugin does not provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic Gmail search or mailbox memory, update the manifest, README, and this file together. Embedding consumers require `metidos:can_embed`; vector stores require `metidos:lancedb` plus `storage:write` and must document exact `~/` paths and retention/reset behavior.

## Context and permission notes

- `gmail_read` exposes `gmail_search` and `gmail_read` only when the thread enables the Gmail read access group.
- `gmail_drafts` exposes only `gmail_create_draft`; it must never expose a send tool.
- `network:fetch` is the only host permission. Access groups never grant network permission by themselves; the approved manifest does.
- Google scopes are enforced by the local refresh token. Gmail's `gmail.compose` scope can authorize draft sending at the Gmail API level, so this plugin enforces draft-only behavior by registering no send tool and excluding `/drafts/send` from the network allowlist.
- Tool callbacks require Plugin Settings because the refresh token is stored in plugin settings.
- Gmail enforces allowed send-as addresses. The plugin may include a configured or requested From header, but Google decides whether the account may use it.
