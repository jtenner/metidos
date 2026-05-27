# Ubiquitous Language

## Product, operator, and auth

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Metidos** | The local IDE application that coordinates projects, worktrees, agent threads, tools, plugins, tasks, calendars, notifications, and runtime diagnostics. | jt-ide, app shell |
| **Local Operator** | The single authenticated person using one local Metidos installation. | Human actor, signed-in operator, user |
| **Manage App Capability** | The local-operator authority for high-impact actions such as plugin approval, unsafe runtime changes, and unrestricted internal workspace-path flows. | Admin, administrator, isAdmin |
| **App Data** | The Metidos data root for one local installation that stores SQLite databases, Pi runtime state, plugin installations, plugin data, auth secrets, settings, and telemetry sidecars. | Config dir, data dir |
| **Local Settings** | Metidos-owned configuration for one installation, such as timezone, terminal defaults, runtime embedding model, and notification preferences. | User settings, account settings |
| **Local Auth** | The local setup and sign-in system that protects browser access to one Metidos installation. | Account system, user management |
| **Primary Factor** | The configured PIN, password, or passphrase used for local sign-in and step-up checks. | Password only, login code |
| **TOTP Enrollment** | The local time-based one-time-password secret and policy used as the second factor for sign-in and recovery-sensitive flows. | MFA setup, authenticator setup |
| **Recovery Code** | A locally generated backup code that can recover access when normal TOTP use is unavailable. | Backup code, reset code |
| **Session** | The authenticated browser/login session used to authorize HTTP and RPC access. | Login, cookie |
| **Step-up Authentication** | A recent primary-factor plus TOTP proof required before plugin actions that approve or run code. | Elevation, admin prompt, reauth |
| **WebSocket Ticket** | A short-lived auth credential issued by `/auth/ws-ticket` before the browser opens `/rpc`. | RPC token, socket token |

## Work context

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Project** | A high-level entry point for one or more Git worktrees. | Repository, repo |
| **Worktree** | A Git checkout context that can be opened, closed, selected, and used as the root for thread tools. | Workspace, checkout |
| **Workspace Path Scope** | The Backend-owned policy object that normalizes, formats, and restricts project and worktree paths for a caller. | Workspace root, path filter |
| **Directory Suggestion** | A Backend-produced folder option for path inputs that mirrors Workspace Path Scope without authorizing access itself. | Folder autocomplete, path hint |
| **Thread** | A Pi-powered agent execution session attached to a selected project and worktree context. | Conversation, chat |
| **Message** | A single persisted communication item within a thread. | Chat item |
| **Turn** | One complete agent response cycle inside a thread, from user request to final output. | Round, iteration |
| **Run Status** | The current execution state of a thread turn, such as queued, working, stopped, completed, or failed. | Thread state, activity state |
| **Thread Start Request** | An approval-aware request to create or start a thread when the target context or unsafe policy needs confirmation. | Start approval, launch request |
| **Context Focus** | A browser-facing selection event that moves the UI to a project, worktree, thread, or cron-created thread. | Navigation target |
| **Pinned Thread** | A thread shortcut kept above recency-ordered thread lists. | Favorite thread |
| **Pinned Folder** | A folder shortcut shown as a compact project/worktree navigation affordance. | Favorite folder |

## Execution, runtime, and model selection

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Agent** | The Pi-powered coding runtime that executes thread turns and invokes tools. | Bot, assistant runtime |
| **Pi Runtime** | The Metidos adapter around Pi sessions, provider resolution, tool installation, extension UI, and persisted thread session files. | Agent backend |
| **Pi Session** | The persisted Pi runtime session identity attached to a Metidos thread. | Runtime file, conversation id |
| **Provider** | A model service family exposed through Pi, such as OpenAI, OpenAI Codex, Anthropic, OpenRouter, Ollama, or a plugin provider. | Vendor, backend |
| **Built-in Provider** | A provider implemented by Pi and configured by Metidos through environment variables, plugin settings, or `piAuth` handoff. | Core provider |
| **Plugin-backed Provider** | A provider registered at runtime by an approved Plugin System v1 sidecar. | Custom provider |
| **Model** | A specific AI model identifier offered by a provider. | Provider model |
| **Model Catalog** | The UI-visible set of provider-qualified model options built from Pi's registry and active plugin provider registrations. | Model list |
| **Provider Configuration** | A concrete provider registration with endpoint, auth behavior, compatibility flags, model metadata, and optional embedding behavior. | Provider setup |
| **Embedding Provider** | A provider configuration that can return numeric vector embeddings for text. | Vector provider |
| **Embedding Model** | The selected provider model used for Metidos vector search and plugin embedding calls. | Vector model |
| **Embedding Consumer** | A plugin or tool path that calls the host embedding API instead of providing embeddings itself. | Vector caller |
| **Provider-qualified Model ID** | The stable model selection key that includes provider identity, such as `openai:gpt-5.4` or `ollama/ollama/default/llama3.2`. | Raw model id |
| **Reasoning Effort** | The optional thinking-depth selection shown only for models that support it. | Thinking level |
| **Skill** | A specialized agent instruction set stored under `.pi/skills/`. | Template, prompt |
| **Tool** | A callable capability exposed to the agent runtime during a turn; tool names use verb-first snake_case such as `notify_user`, `list_crons`, and `update_thread`. | Function, capability |
| **Access Control** | The per-thread or per-cron toggle set that determines which tool families, plugin access groups, and sandbox policies are active. | Permissions, flags |
| **Safe Mode** | The default thread posture where bash and unsafe child-thread or cron escalation are unavailable. | Normal mode |
| **Unsafe Mode** | An explicit access-control state that enables bash and unsafe child-thread or cron requests. | Unrestricted mode |
| **Sidecar** | An auxiliary runtime process or worker, such as the cron scheduler, telemetry sink, share worker, or a plugin process. | Worker, helper |
| **Pi Extension UI** | The browser-facing bridge for Pi prompts, status lines, widgets, editor text, title updates, and notifications. | Extension bridge, UI escape hatch |

## Provider auth and OAuth

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Provider Auth** | The credentials and request-auth behavior Metidos supplies to Pi for a provider. | Provider settings, auth config |
| **Pi Auth Binding** | A manifest or provider-configuration declaration that hands a plugin setting, environment value, or plugin-owned auth material to Pi auth storage. | Auth mapping, credential binding |
| **OAuth Provider Adapter** | Plugin code that imports, refreshes, and exposes OAuth credentials for a Pi provider using Metidos-owned credential lifecycle rules. | OAuth implementation, login plugin |
| **OAuth Credential** | A normalized credential record containing an access token, refresh token, expiry, and optional provider-specific metadata. | Token blob, auth JSON |
| **Auth Import** | The act of reading external auth material such as plugin `.data/auth.json` and normalizing it into an OAuth Credential. | Credential load, token import |
| **Token Refresh** | The provider-specific exchange of a stored refresh token for a new OAuth Credential. | Reauth, renewal |
| **Request Token** | The access token or API key extracted from Provider Auth for one outbound provider request. | API token, bearer token |
| **OAuth Utility** | A host-provided helper for provider-neutral OAuth mechanics such as decoding a JWT expiry. | Plugin helper, auth helper |
| **Provider Metadata** | Provider-specific fields stored with an OAuth Credential, such as Codex `accountId`, Copilot `enterpriseUrl`, or Google `projectId`. | Extra fields, custom auth state |

## Tool families and capabilities

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Metidos Tools** | Pi-native tools for updating thread metadata and managing Metidos threads and cron jobs from an agent turn. | App tools |
| **Agents Tools** | Pi-native `update_plan` and bounded `delegate_task` helpers for one-shot planning and helper execution. | Subagents, child lifecycle |
| **Git Tools** | Worktree-scoped local Git tools exposed without requiring bash. | VCS tools |
| **GitHub Tools** | Worktree-bound GitHub CLI tools for repository, issue, pull request, CI, and diff inspection. | GitHub integration |
| **SQLite Tools** | Worktree-scoped SQLite query tools limited to database files inside the current worktree. | DB tools |
| **LanceDB Tools** | Project-scoped vector tools that upsert, query, or delete records inside the selected worktree. | Vector tools, semantic memory tools |
| **Web Search** | Provider-native or local web-search capability installed for a thread when web-search access is enabled. | Search |
| **Browser Plugin Tools** | Plugin-provided browser-control tools, such as Chrome DevTools navigation, interaction, and screenshot capture. | WebView tools |
| **Web Server Tools** | Project-scoped tools that host files or directories from the current worktree on loopback and optional stable share URLs. | Static server tools |
| **Calendar Tools** | Agent or plugin capabilities that list and mutate calendars, events, occurrences, and reminders. | Calendar access |
| **Notification Tools** | Agent or plugin capabilities that create local notifications and dispatch them through configured outlets. | Notification access |
| **Terminal Tools** | Unsafe Metidos tools for creating, listing, viewing, grepping, and killing managed terminal sessions. | Shell tools, PTY tools |
| **Prompt Injection Capability** | An internal native permission that lets approved plugins inject access-scoped prompt content before a turn starts and is hidden from normal access-control selection. | Prompt access, prompt injection toggle |
| **Gmail Tools** | First-party plugin tools that search/read Gmail messages and create Gmail drafts through approved Gmail access groups and direct Gmail REST fetches. | Google mail tools, email tools |

## Plugin System v1

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Plugin System v1** | The local-operator-approved extension system that discovers plugin folders, reviews manifests and hashes, and runs approved code in sidecars. | Plugin framework |
| **Plugin** | A local extension folder under App Data that contains `metidos-plugin.json`, `AGENTS.md`, and a manifest-declared entrypoint. | Extension, add-on |
| **Core Plugin** | A first-party plugin source folder under `core_plugins/` that Metidos syncs into App Data on startup. | Built-in plugin |
| **Manifest** | The `metidos-plugin.json` review contract declaring plugin identity, permissions, settings, access groups, providers, ingress sources, notifications, and limits. | Plugin config |
| **Review Hash** | The deterministic hash of plugin source and seed files that the local operator approves before activation. | Checksum |
| **Approval** | The local operator's decision that allows the current plugin review hash to run. | Enablement |
| **Activation** | Runtime loading of an approved plugin into its sidecar. | Startup |
| **Plugin Inventory** | The side-effect-free settings payload that lists discovered plugins, review state, diagnostics, settings declarations, and runtime data summaries. | Plugin manager list |
| **Plugin Lifecycle Status** | The review/runtime state label for a plugin, such as Uninitialized, Needs Review, Active, Failed/Degraded, Disabled/Restart Required, or Missing/Unavailable. | Plugin state |
| **Plugin Administration** | The Settings workflow for plugin inventory, settings, lifecycle actions, diagnostics, ingress bindings, link codes, and routes. | Plugin manager, admin panel |
| **Access Group** | A plugin-declared thread-visible group that controls which plugin tools are offered to a thread. | Tool group |
| **Permission** | A manifest-declared host capability such as `network:fetch`, `files:read`, `provider:register`, or `notification:provider`. | Access group |
| **Plugin Settings** | The single per-plugin map of manifest-declared configuration values stored in App Data. | Global settings, user settings, general settings, scoped settings |
| **Environment Declaration** | A manifest-declared host environment variable captured at sidecar startup. | Env setting, process env |
| **Plugin Data** | The plugin-owned `.data/` directory addressed through `~/` by plugin filesystem APIs. | Storage |
| **Plugin Vector Store** | Plugin-owned LanceDB-style vector data under Plugin Data, usually derived and regenerable from bounded source content. | Plugin memory, vector memory |
| **Project File Access** | Plugin access to the current worktree through `./` paths, gated by `files.*` permissions and manifest allowlists. | Workspace access |
| **Seed Data** | Optional plugin `seed/**` files copied into `.data/**` during first activation or Reset Plugin Data. | Initial data |
| **Notification Provider** | A plugin-registered delivery outlet for Metidos notifications. | Notifier |
| **Notification Receipt** | The provider result that records whether a notification delivery succeeded, failed, or should be retried. | Delivery result |
| **Plugin Cron** | A plugin-registered global scheduled callback without current thread or project context. | Scheduled plugin job |
| **Plugin GC** | A plugin-registered garbage-collection callback that prunes plugin-owned data under `~/`. | Cleanup job, data compaction |
| **Plugin Log** | Local-operator-controlled plugin-authored diagnostics written under `.logs/`. | Sidecar log |
| **Gmail OAuth Client** | The Google OAuth client id/secret configured through Gmail Plugin Settings or declared env vars for the Gmail core plugin's refresh-token exchange. | Google API package config, Gmail provider auth |
| **Gmail Refresh Token** | The local Google OAuth refresh token stored in Gmail Plugin Settings and exchanged for short-lived access tokens before Gmail REST calls. | Gmail API key, Google password |

## Plugin request ingress

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Request Ingress** | The plugin capability that lets an approved plugin poll an external private message source and submit external messages to Metidos for trust decisions and routing. | Webhook, inbound bot, plugin inbox |
| **Ingress Source** | A manifest-declared and startup-registered plugin source that globally polls one external message stream and returns external messages. | Provider, channel, poller |
| **External Message** | A plugin-reported plain-text message with external ids that has not yet been trusted as a Metidos operator request. | User message, Thread message |
| **External User ID** | The provider-specific sender id reported by an ingress source. | Metidos user id, account id |
| **External Conversation ID** | The provider-specific direct-chat id reported by an ingress source; in V1 it must be absent or equal to the External User ID. | Chat id, channel id, group id |
| **Direct Chat** | A supported V1 external conversation where the sender and conversation target are the same external user context. | Private chat, DM |
| **Group Conversation** | An unsupported V1 external conversation where the conversation id differs from the external user id. | Group chat, channel |
| **Ingress Identity Binding** | A Metidos-owned verified mapping from an external user id for a plugin/source to the Local Operator. | Account link, user mapping |
| **Link Code** | A self-service, one-time, short-lived code generated by Metidos for the Local Operator to create an ingress identity binding. | Pairing code, invite code |
| **Ingress Route** | A local-operator-owned configuration that selects the Project, Worktree, model, and safe Access Control template for a plugin/source. | Workspace mapping, routing rule |
| **Dedicated Ingress Thread** | A Thread created or reused for one local operator, plugin/source, route, and direct response target during a 30-minute incoming-message window. | Ingress chat, session, temporary thread |
| **Ingress Prompt Envelope** | Metidos-owned prompt framing that wraps source instructions and the external message before queuing a Thread turn. | Prompt template, wrapper |
| **Source Instructions** | Bounded plugin-authored text produced synchronously by an ingress source and embedded inside the ingress prompt envelope. | Prompt template, system prompt |
| **Reply to Source** | The scoped Tool capability that sends an explicitly authored response through the Thread-bound ingress response target. | Response egress, outbound message |
| **Response Target** | The direct external destination coupled to a dedicated ingress Thread for reply-to-source calls. | Recipient, chat id, destination |
| **Thread Memory** | Agent-managed notes or wiki content in the selected Worktree, accessible only through the Thread's own tools and permissions. | Plugin memory, source memory |
| **Ingress Cursor** | An opaque checkpoint stored by Metidos for one plugin/source after returned messages are durably accounted for. | Offset, checkpoint |
| **Durable Dedupe Key** | The persisted uniqueness key that prevents reprocessing of the same external message for a plugin/source. | Message id, replay guard |
| **Ignored Ingress Message** | A recorded external message that Metidos deliberately does not route, such as an unsupported group conversation. | Dropped message |
| **Unverified Ingress Message** | A recorded non-link external message from an external user without an enabled identity binding. | Unknown user message |
| **Source Degraded** | A source-level operational state after repeated polling failures while the plugin itself may remain active. | Plugin failed, source failed |

## Repository data

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Canonical** | Repo-owned source-of-truth data that is version controlled. | Source, master |
| **Derived** | Generated, cached, or runtime output that is not version controlled. | Output, build artifact |

## Calendar, notification, and terminal workflows

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Calendar** | A local calendar collection owned by the installation and shown in Mainview calendar workspaces. | Schedule, shared calendar |
| **External ICS Calendar** | A read-only calendar source refreshed from an external ICS feed. | Imported calendar, subscribed calendar |
| **Calendar Event** | A dated or timed item stored in a Calendar. | Appointment, meeting |
| **Calendar Occurrence** | One concrete instance of a possibly recurring Calendar Event inside a requested time window. | Event instance |
| **Reminder** | A configured offset before an occurrence that can produce a notification delivery. | Alert |
| **Notification** | A local operator-visible message created by Metidos, a tool, a calendar reminder, or a plugin. | Alert, toast |
| **Notification Outlet** | A configured delivery path for notifications, such as in-app, browser, ntfy, or a plugin notification provider. | Channel |
| **Notification Delivery** | A persisted attempt or result for sending a Notification through one outlet. | Notification record |
| **Managed Terminal Session** | A Metidos-owned PTY session rooted in an authorized worktree and exposed only through unsafe terminal controls. | Shell, terminal |
| **Terminal Connection** | The authenticated websocket path used by Mainview to stream a managed terminal session. | Terminal socket |

## Scheduling, sharing, and diagnostics

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Cron Job** | A recurring scheduled agent session tied to a project and worktree. | Job, schedule |
| **Cron Scheduler** | The sidecar worker that keeps `Bun.cron` registrations in sync with cron rows. | Scheduler worker |
| **Cron Runner** | The main-process executor that turns a due cron fire into a child thread and tracks run state. | Job runner |
| **Share URL** | A stable browser URL for a thread-hosted web server, mediated through `/share/open` and `/s/<thread>/<server>/...`. | Public link |
| **Share Session** | The cookie-backed claim state that allows a browser to access a stable share route. | Share cookie |
| **Runtime Stats** | Resettable in-memory counters and summaries for RPC, websocket, SQLite, cron, tool, cache, and budget behavior. | Metrics |
| **Runtime Diagnostics Snapshot** | A point-in-time summary of runtime stats, health counters, and pressure signals exposed to health checks and telemetry. | Health snapshot |
| **Telemetry Sidecar** | The optional `--track-telemetry` SQLite sink for periodic runtime-diagnostics snapshots. | Metrics DB |
| **Security Audit Event** | A persisted record for privileged or sensitive local actions such as auth reset, project deletion, plugin data reset, or cross-worktree thread creation. | Audit log |
| **Wiki** | The research knowledge base in `.wiki/` used for durable design, migration, and architecture notes. | Docs |
| **Raw Source** | Immutable input material preserved in `.wiki/raw/` for factual authority. | Source, input |

## System architecture

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Backend** | The Bun server layer that hosts HTTP routes, RPC handlers, persistence, Pi orchestration, plugins, cron execution, and share workers. | Server, API |
| **Mainview** | The browser-first React/Tailwind UI for projects, worktrees, threads, tasks, calendars, settings, plugins, terminals, and diffs. | Frontend, UI, client |
| **RPC** | The typed WebSocket request/response contract between Mainview and Backend. | API, endpoint |
| **RPC Schema** | The TypeScript source of truth for request and response payload shapes shared by Backend and Mainview. | API types |
| **Transport** | The WebSocket connection layer with auth tickets, reconnect, cancellation, backpressure, and priority tagging. | Channel, socket |
| **Workspace Panel** | The Mainview shell area that swaps between chat, diff, cron, calendar, terminal, and other active workspaces. | Workspace, view |
| **Transcript Pipeline** | The Mainview projection layer that classifies messages, tool calls, media, diff summaries, and virtual rows before rendering. | Message pipeline |
| **Diff** | A file content comparison shown in the worktree view, message history, or git history. | Patch, compare |
| **Model Selector** | The Mainview control that chooses provider, model, and reasoning effort from the Model Catalog. | Provider picker |

## Relationships

- A **Local Operator** authenticates through **Local Auth**, receives a **Session**, and obtains **WebSocket Tickets** for **Transport** connections.
- **Step-up Authentication** is required only for plugin actions that approve code, reactivate approved code, or directly invoke plugin callbacks such as **Plugin GC**.
- **App Data** contains **Local Settings**, **Plugin Settings**, **Plugin Data**, **Pi Sessions**, auth secrets, SQLite databases, and optional **Telemetry Sidecar** data.
- A **Project** contains one or more **Worktrees**.
- A **Workspace Path Scope** authorizes **Project** and **Worktree** paths; **Directory Suggestions** only mirror that scope for UX.
- A **Worktree** hosts zero or more **Threads**.
- A **Thread** consists of one or more **Turns**.
- A **Turn** produces one or more **Messages** and has a **Run Status** while active or settled.
- A **Thread Start Request** may create a **Thread** only after required context or unsafe-policy approval.
- A **Thread** has one **Access Control** set and zero or more plugin **Access Groups**.
- A **Prompt Injection Capability** may be present in runtime policy but should not appear as an ordinary user-facing **Access Control** toggle.
- A **Provider** exposes one or more **Models** through the **Model Catalog**.
- A **Provider-qualified Model ID** selects both the **Provider** and **Model** and must not collapse across providers with the same raw model name.
- An **Embedding Provider** exposes one or more **Embedding Models** or configurations for vector generation.
- An **Embedding Consumer** may call the host embedding API but does not automatically become an **Embedding Provider**.
- A **Provider** has zero or one active **Provider Auth** source for a given runtime context.
- A **Pi Auth Binding** produces **Provider Auth** from declared **Plugin Settings**, **Environment Declarations**, or plugin-owned auth material.
- An **OAuth Provider Adapter** performs **Auth Import** and **Token Refresh** while Metidos owns credential storage and refresh locking.
- An **OAuth Credential** contains one **Request Token** and may contain **Provider Metadata**.
- A **Plugin-backed Provider** is registered by one approved **Plugin** sidecar.
- A **Core Plugin** is source-controlled under `core_plugins/` and synced into **App Data** before review or activation.
- A **Manifest** declares **Permissions**, **Plugin Settings**, **Access Groups**, and **Ingress Sources**; **Access Groups** only control thread-visible tool selection.
- **Plugin Settings** are a single map per **Plugin**, not separate global, user, local, server, or general scopes.
- **LanceDB Tools** store project-scoped vector records in the selected **Worktree**, while a **Plugin Vector Store** stores plugin-owned vectors under **Plugin Data**.
- **Gmail Tools** belong to the Gmail **Core Plugin**, use one **Gmail OAuth Client**, and require one **Gmail Refresh Token** for the current **Local Operator**.
- An **Ingress Source** belongs to exactly one **Plugin** and is both manifest-declared and startup-registered.
- A **Request Ingress** poll produces zero or more **External Messages**.
- An **External Message** has exactly one **External User ID** and zero or one **External Conversation ID**.
- An **Ingress Identity Binding** maps one **External User ID** for one plugin/source to the **Local Operator**.
- A **Link Code** belongs to the **Local Operator**, one plugin/source, and expires after one use or timeout.
- An **Ingress Route** belongs to the **Local Operator** and one plugin/source.
- A **Dedicated Ingress Thread** belongs to one **Ingress Route** and one **Response Target** during a 30-minute incoming-message window.
- An **Ingress Prompt Envelope** contains one **External Message** and zero or one **Source Instructions** section.
- **Reply to Source** sends only to the **Response Target** coupled to the active **Dedicated Ingress Thread**.
- **Thread Memory** belongs to the **Thread** and **Worktree**, never to the **Plugin**.
- A **Durable Dedupe Key** is unique for one plugin/source/external-message id tuple.
- A **Calendar** contains zero or more **Calendar Events**.
- A recurring **Calendar Event** expands into zero or more **Calendar Occurrences** for a requested time window.
- A **Reminder** can produce one or more **Notification Deliveries** through configured **Notification Outlets**.
- A **Managed Terminal Session** belongs to one **Project** and **Worktree** and is controlled through unsafe terminal access.
- A **Cron Job** targets exactly one **Project** and **Worktree**.
- A **Cron Runner** creates a child **Thread** for each allowed due cron run.
- **Web Server Tools** create thread-owned servers that may receive **Share URLs** and **Share Sessions**.
- **Canonical** project knowledge lives in `.wiki/**`; **Derived** data lives in `.metidos/cache/**`, `.metidos-build/**`, plugin `.data/**`, plugin `.logs/**`, and other build/runtime outputs.

## Example dialogue

> **Dev:** "If I create a **Thread** in a **Worktree**, does the **Agent** see every **Tool**?"
>
> **Domain expert:** "No. The **Thread**'s **Access Control** set installs selected tool families, and plugin **Access Groups** only expose selected plugin tools."
>
> **Dev:** "So enabling a plugin **Access Group** grants `files:read` or the plugin's **Plugin Settings**?"
>
> **Domain expert:** "No. The **Manifest** grants **Permissions** after local-operator **Approval**, and **Plugin Settings** are configured separately as one per-plugin map."
>
> **Dev:** "Should Ollama or NVIDIA be configured by editing Pi's global `models.json`?"
>
> **Domain expert:** "No. Metidos uses **Core Plugins**, **Plugin Settings**, environment fallbacks, and **Pi Auth Bindings** to project provider setup into the **Model Catalog**."
>
> **Dev:** "If a plugin wants semantic search, should it use project **LanceDB Tools**?"
>
> **Domain expert:** "Only agent-managed project vectors use **LanceDB Tools**. Plugin semantic indexes are **Plugin Vector Stores** under **Plugin Data**, and plugins that embed text are **Embedding Consumers**."
>
> **Dev:** "Can a Telegram plugin map `from.id` directly to a Metidos account and choose a thread?"
>
> **Domain expert:** "No. The plugin returns an **External User ID** in an **External Message**; Metidos routes it only after an **Ingress Identity Binding** and **Ingress Route** exist."
>
> **Dev:** "Can **Reply to Source** send to any chat id?"
>
> **Domain expert:** "No. It sends only to the **Response Target** coupled to the active **Dedicated Ingress Thread**."
>
> **Dev:** "Why does enabling a plugin sometimes ask for **Step-up Authentication**?"
>
> **Domain expert:** "Because Enable, Re-approve, Retry, and Run **Plugin GC** can approve or run plugin code; Disable and Reset Plugin Data are recovery actions and only need an authenticated **Local Operator** plus confirmation."
>
> **Dev:** "Can a cron-created thread open a **Managed Terminal Session** or delete a **Calendar Event** without confirmation?"
>
> **Domain expert:** "No. **Terminal Tools** require **Unsafe Mode** and interactive thread context, and calendar/event deletes require confirmation."

## Flagged ambiguities

- **"workspace"** is overloaded. Use **Worktree** for the Git checkout context, **Workspace Panel** for browser layout, and **Workspace Path Scope** for Backend path policy.
- **"repository"** can mean a Git remote, a local worktree root, or the product source tree. Use **Project** for the Metidos entry, **Worktree** for the checkout, and **repo** only for Git-specific discussion.
- **"model"** means both an AI **Model** and a data/domain model. Prefer **provider model** for AI and **data model** for domain structures.
- **"provider"** can refer to a model **Provider**, **Notification Provider**, or **OAuth Provider Adapter**. Qualify the term when more than one provider kind is in scope.
- **"auth"** can refer to local operator sessions, provider API keys, OAuth credentials, or request headers. Use **Local Auth** for sign-in, **Session** for browser login, **Provider Auth** for Pi/model-provider credentials, **OAuth Credential** for refreshable OAuth state, and **Request Token** for per-request bearer/API material.
- **"settings"** is ambiguous. Use **Plugin Settings** for manifest-declared plugin configuration, **Local Settings** for Metidos installation preferences, and **Environment Declaration** for captured process env vars.
- **"global settings," "user settings," "general settings," and "scoped settings"** are stale Plugin Settings terms. Current Plugin System v1 documentation should say **Plugin Settings** unless it is describing legacy migration code.
- **"permission"** can refer to plugin **Permissions**, thread **Access Control**, hidden internal runtime capabilities such as **Prompt Injection Capability**, or calendar-sharing compatibility fields. Use the qualified term whenever plugin review or runtime tool visibility is involved.
- **"unsafe"** is an **Access Control** state that enables specific high-risk runtime paths. It is not a general quality judgment.
- **"agent"** refers to the Pi-powered coding **Agent** runtime, not a human team member.
- **"backend"** refers specifically to the Bun server layer. Avoid using it to mean a model **Provider**.
- **"admin"** and **"administrator"** are legacy compatibility labels. Use **Local Operator** for the person and **Manage App Capability** for high-impact authority.
- **"user"** is usually imprecise in Metidos. Use **Local Operator** for the human using this installation, **External User ID** for provider sender ids, and **legacy user field** only when naming compatibility payloads or database fields.
- **"ingress"** should mean **Request Ingress**, the trusted Metidos workflow for external messages; avoid using it for plugin-defined webhooks or arbitrary backend routes.
- **"source"** is overloaded. Use **Ingress Source** for a plugin-polled external message stream, **Raw Source** for research material, and **Provider** for model or notification services.
- **"message"** is overloaded. Use **External Message** before Metidos verifies and routes it, and **Message** for persisted Thread communication.
- **"conversation"** can mean a chat, Thread, or group. Use **External Conversation ID** for provider conversation ids and **Thread** for Metidos agent conversations.
- **"prompt template"** is too broad for ingress. Use **Source Instructions** for plugin-authored bounded text and **Ingress Prompt Envelope** for Metidos-owned framing.
- **"response egress"** was considered but rejected. Use **Reply to Source** for the scoped Tool/capability that sends explicit responses through a Thread-bound **Response Target**.
- **"memory"** must not imply plugin storage. Use **Thread Memory** for Agent-managed Worktree notes/wiki content, **Plugin Vector Store** for plugin-owned vector indexes, and **Plugin Data** for the plugin-owned `.data/` directory.
- **"dedicated thread"** should be qualified as **Dedicated Ingress Thread** when referring to the 30-minute external-message context window.
- **"notification"** can mean a local UI item, a provider send, or a calendar reminder. Use **Notification**, **Notification Delivery**, **Notification Outlet**, and **Reminder** to keep those boundaries clear.
