# Gmail core plugin

The Gmail core plugin adds Plugin System v1 tools for approved threads without using the `googleapis` npm package or Metidos built-in provider APIs. It manually exchanges a Google OAuth refresh token through `metidos.fetch`, then calls the Gmail REST API over the manifest allowlist. It can create drafts, but it intentionally never sends email.

## Tools

Enable access groups per thread:

- **Gmail - Read** (`gmail:gmail_read`)
  - `gmail_gmail_search`: search Gmail with Gmail query syntax and return bounded metadata.
  - `gmail_gmail_read`: read one message by id and return headers plus a bounded text/plain body, falling back to stripped text/html.
- **Gmail - Drafts only** (`gmail:gmail_drafts`)
  - `gmail_gmail_create_draft`: create a Gmail draft. This does not send mail.

The drafts group is intentionally separate from the read group and exposes no send tool. The manifest also excludes Gmail send endpoints from the network allowlist, so the plugin cannot send mail through `metidos.fetch`.

## OAuth setup

1. In Google Cloud Console, enable the Gmail API for the project that owns your OAuth client.
2. Configure the OAuth consent screen for the Gmail scopes you need.
3. Create an OAuth client. A desktop or local web client is easiest for local installations.
4. Obtain a local refresh token with the scopes required by the access groups you intend to enable:
   - read only: `https://www.googleapis.com/auth/gmail.readonly`
   - create drafts: `https://www.googleapis.com/auth/gmail.compose`

Gmail's `gmail.compose` scope can authorize both draft creation and draft sending at the Gmail API level. Metidos enforces draft-only behavior by registering no send tool and by keeping `/drafts/send` out of the plugin network allowlist.
5. In Metidos, open Settings -> Plugins -> Gmail:
   - set the `client_id` and `client_secret` Plugin Settings, or set env vars `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` before startup;
   - set the `refresh_token` Plugin Setting;
   - optionally set `send_as_email` for the default draft From header.
6. Review and approve the plugin. The manifest allows only:
   - `https://oauth2.googleapis.com/token`
   - `https://gmail.googleapis.com/gmail/v1/users/me/messages`
   - `https://gmail.googleapis.com/gmail/v1/users/me/messages/**`
   - `https://gmail.googleapis.com/gmail/v1/users/me/drafts`

The broad `users/me/**` Gmail pattern and `/drafts/send` endpoint are intentionally not allowed.

Do not paste OAuth client secrets or refresh tokens into chat, task files, logs, or screenshots.

## Installation and approval

Core plugins under `core_plugins/` sync into app data on startup via `bun run sync:core-plugins` / `bun run start`. After sync:

1. Sign in as the local operator.
2. Open Settings -> Plugins.
3. Review Gmail's network allowlist, settings/env declarations, and the two access groups.
4. Approve or re-approve the plugin hash.
5. In a thread, enable only the Gmail access group needed for that work.

Container installs that use env-backed client credentials must pass `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` into the Metidos process. Refresh tokens are better stored in Plugin Settings rather than container env.

## Tool notes

- `gmail_search` accepts `query`, `max_results` (1-10), and `include_spam_trash`. It uses Gmail query syntax such as `from:alice@example.com newer_than:7d`.
- `gmail_read` accepts `id` or `message_id` and optional `max_body_chars` (1000-20000).
- `gmail_create_draft` accepts `to`, `cc`, `bcc`, `subject`, `body`, optional `body_format` (`plain` or `html`), and optional `from`.

Gmail decides whether a From address is authorized for the signed-in account. If the refresh token lacks a required Gmail scope, Google will reject the corresponding request. This plugin has no send tool; users must review and send drafts outside Metidos.

## Validation

From the repository root:

```bash
bun test src/bun/plugin/core-gmail-plugin.test.ts src/bun/plugin/manifest.test.ts
bunx tsgo --noEmit
```

## Privacy and retention

This plugin does not store mailbox content in plugin `.data`, does not create embeddings, and does not maintain a local message cache. Message bodies and snippets returned by tools become part of the thread context, so enable Gmail access only for threads where that disclosure is intended.
