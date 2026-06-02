# Plugin Permission Reference

Plugin permissions are manifest-declared host capabilities. A plugin can use only the permissions listed in its `metidos-plugin.json`, and the local operator must approve the plugin review hash before Metidos executes it. Thread access groups only control which plugin tools or prompt injections are visible to a Thread; they never grant these permissions by themselves.

Use the narrowest permission set that supports the plugin's purpose. Treat file, network, provider, terminal, and `unsafe` permissions as review-sensitive because they can expose local data, external services, or high-impact host actions.

## Risk levels

| Risk | Meaning |
| --- | --- |
| Low | Mostly plugin-local state or diagnostics. Still review for data retention and log content. |
| Medium | Can affect user-visible workflows, send data to approved destinations, or modify bounded plugin-owned resources. |
| High | Can read or change project data, register host-facing providers, accept external ingress, use terminals, or reach broad/private networks. |
| Critical | Explicit high-impact escalation requiring exceptional review, normally paired with other permissions. |

## Permission matrix

| Permission | Capability granted | Risk | User-facing explanation |
| --- | --- | --- | --- |
| `storage:read` | Read files under the plugin-owned `~/` data area, within storage quotas and path validation. | Low | Lets the plugin read its own saved data. |
| `storage:write` | Create or modify files under the plugin-owned `~/` data area, within storage quotas and path validation. | Medium | Lets the plugin save or update its own data. |
| `storage:delete` | Delete files under the plugin-owned `~/` data area, within path validation. | Medium | Lets the plugin remove its own saved data. |
| `files:read` | Read project `./` paths allowed by `files.allow.read` and not denied by built-in or manifest deny rules. | High | Lets the plugin read approved files in the current project. |
| `files:write` | Create or modify project `./` paths allowed by `files.allow.write` and not denied by built-in or manifest deny rules. | High | Lets the plugin write approved files in the current project. |
| `files:delete` | Delete project `./` paths allowed by `files.allow.delete` and not denied by built-in or manifest deny rules. | High | Lets the plugin delete approved files in the current project. |
| `network:fetch` | Make HTTP(S) fetch requests only to manifest `network.allow` targets, subject to response-size, timeout, and private-network policy. | High | Lets the plugin contact approved web services. |
| `network:websocket` | Open WebSocket connections only to manifest `network.webSocketAllow` targets, subject to message and connection limits. | High | Lets the plugin keep live connections to approved services. |
| `cron:create` | Register manifest-declared plugin cron jobs that run in approved plugin contexts. | Medium | Lets the plugin run scheduled background work. |
| `metidos:can_embed` | Call the host embedding API for plugin-provided text/content. | Medium | Lets the plugin turn text into embeddings using configured model providers. |
| `metidos:lancedb` | Use plugin-scoped LanceDB/vector storage under plugin `~/` data; also requires `storage:write`. | Medium | Lets the plugin store and query vectors in its own data area. |
| `metidos:prompt_inject` | Register manifest-declared prompt injections exposed through access groups. | High | Lets the plugin add approved context to thread prompts when its access group is enabled. |
| `metidos:provides_embeddings` | Register embedding-capable model provider configurations; provider registration also requires `provider:register`. | High | Lets the plugin offer embedding models to Metidos. |
| `plugin:request-ingress` | Register manifest-declared request ingress sources for external or provider-originated messages. | High | Lets the plugin receive approved incoming requests through Metidos. |
| `plugin:reply-to-source` | Reply only through verified ingress source metadata supplied by Metidos. | High | Lets the plugin respond to messages from an approved ingress source. |
| `notification:send` | Send notifications through configured notification channels, subject to plugin notification controls and rate limits. | Medium | Lets the plugin send notifications to you. |
| `notification:provider` | Register notification provider families and delivery handlers declared in the manifest. | High | Lets the plugin add a notification delivery provider. |
| `oauth:register` | Register OAuth adapter families declared in the manifest. | High | Lets the plugin add an OAuth integration path. |
| `provider:register` | Register model provider families declared in the manifest. | High | Lets the plugin add model provider configurations. |
| `calendar:list` | List calendars in supported interactive contexts. | Medium | Lets the plugin see available calendars. |
| `calendar:create` | Create calendars in supported interactive contexts. | Medium | Lets the plugin create calendars. |
| `calendar:modify` | Modify calendars in supported interactive contexts. | Medium | Lets the plugin change calendar details. |
| `calendar:delete` | Delete calendars in supported interactive contexts; destructive operations require explicit confirmation where supported. | High | Lets the plugin delete calendars after required confirmation. |
| `events:list` | List calendar events in supported interactive contexts. | Medium | Lets the plugin see calendar events. |
| `events:get` | Read an individual calendar event in supported interactive contexts. | Medium | Lets the plugin inspect a calendar event. |
| `events:create` | Create calendar events in supported interactive contexts. | Medium | Lets the plugin add calendar events. |
| `events:modify` | Modify calendar events in supported interactive contexts. | Medium | Lets the plugin change calendar events. |
| `events:delete` | Delete calendar events in supported interactive contexts; destructive operations require explicit confirmation where supported. | High | Lets the plugin delete calendar events after required confirmation. |
| `terminal:create` | Create terminal sessions when terminal APIs are available; also requires `unsafe`. | Critical | Lets the plugin start terminal processes. |
| `terminal:read` | Read terminal session metadata/output available to the plugin context. | High | Lets the plugin inspect terminal output. |
| `terminal:grep` | Search terminal output available to the plugin context. | High | Lets the plugin search terminal output. |
| `terminal:kill` | Stop terminal sessions when terminal APIs are available; also requires `unsafe`. | Critical | Lets the plugin terminate terminal processes. |
| `sqlite` | Use plugin-scoped SQLite data files under plugin `~/` data; also requires `storage:write`. | Medium | Lets the plugin maintain its own SQLite database. |
| `log:write` | Write plugin diagnostic logs, subject to logging controls and redaction expectations. | Low | Lets the plugin write local diagnostic logs. |
| `unsafe` | Opt into capabilities or allowlist shapes that Metidos treats as high-impact, such as terminal create/kill or broad/private network access. | Critical | Grants an explicit unsafe escalation; approve only when the plugin purpose requires it. |

## Review checklist

- Confirm every permission maps to a manifest declaration, code path, or user-visible feature.
- Remove permissions that are only speculative or useful during prototyping.
- For `files:*`, verify allowlists are narrow and use fake/demo paths in docs and examples.
- For `network:*`, verify hosts, schemes, and private-network expectations are explicit.
- For provider, notification, OAuth, ingress, prompt injection, terminal, and `unsafe` permissions, review the plugin `AGENTS.md` and source before approval.
- Re-review permissions after any source or manifest change invalidates the approval hash.
