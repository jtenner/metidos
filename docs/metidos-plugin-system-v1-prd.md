# Metidos Plugin System v1 PRD

Metidos Plugin System v1 lets the local operator install trusted local plugins under `APP_DATA/plugins/`, review their declared capabilities, approve them, and expose approved plugin capabilities to Metidos runtime contexts through a narrow host-owned API.

## Goals

- Discover local plugin folders without executing plugin code.
- Require local-operator review and approval before any plugin code is built or run.
- Run each activated plugin in exactly one sidecar process and execute TypeScript/JavaScript entrypoints in QuickJS or Python entrypoints in the safe Pyodide host, with only the injected Metidos plugin API exposed.
- Provide typed, permission-checked host APIs for agent tools, files, storage, network fetch, env/settings, crons, notifications, notification providers, model providers, calendars, events, users, terminal inspection/control, SQLite data files, logging, telemetry, and diagnostics.
- Let threads opt in to plugin tool access groups. Access groups control tool visibility only; they do not grant permissions.
- Keep plugin data under plugin-owned `.data`, support first-activation seeding, quotas, GC, reset, and diagnostics.
- Make plugin changes auditable through deterministic review hashes.
- Provide examples, JSON Schema, and authoring guidance that plugin authors and implementation workers can use without rediscovering design rules.

## Non-goals

- No React plugin panels, arbitrary plugin UI surfaces, or frontend component extension points in v1.
- No plugin-defined backend RPC routes or arbitrary server extension points.
- No direct access to the Metidos application database and no plugin database migrations.
- No runtime package-manager installation step; plugins cannot rely on `node_modules/`.
- No public marketplace, remote install flow, signature distribution, or auto-update channel in v1.
- No hot-unregistering disabled plugins from a running runtime; disabling requires a Metidos restart to fully remove already-registered runtime capabilities.
- No guarantee that trusted approved plugin code is semantically safe from exfiltrating data it is allowed to read. The v1 trust boundary is local-operator approval plus capability review.

## Installation layout

Each plugin is a directory below `APP_DATA/plugins/{plugin_id}/`.

Required root files:

- `metidos-plugin.json` — manifest validated before review or activation.
- `AGENTS.md` — plugin-maintained operator guidance for safe inspection, repair, validation, and `.data` workflows.
- `index.ts` or `main.py` — plugin entry point loaded by the sidecar after approval.

Optional root directories:

- `seed/` — files copied into `.data/` only during first activation or explicit Reset Plugin Data.
- `.data/` — plugin-owned persistent data. Created by Metidos and excluded from review hashing.
- `.data-bak-{timestamp}/` — reset backups. Hidden from normal UI and excluded from review hashing.
- `.logs/` — plugin log files when logging is enabled. Excluded from review hashing.

Forbidden root content:

- `node_modules/` is always activation-blocking.
- Symlinks that escape the plugin directory are invalid for validation, hashing, and data operations.

## Trust model

Local-operator approval is the v1 trust boundary. Discovery and review parse files but never build, import, evaluate, or execute plugin code. Activation happens only after the local operator approves the current review hash.

Metidos enforces declared permissions, allowlists, context availability, quotas, limits, timeouts, and payload sizes. These controls reduce accidental overreach and define reviewable host capabilities. They are not a semantic data-loss-prevention system for a malicious plugin that has already been approved to read sensitive data.

## Manifest and schema

The v1 manifest target is `metidos-plugin.json` with `metidosApiVersion = "v1"`. The JSON Schema draft lives in [`metidos-plugin.schema.json`](./metidos-plugin.schema.json).

Top-level manifest fields:

- `id`, `name`, `version`, `metidosApiVersion`, and `description` are required.
- `telemetry` defaults to `true` when omitted.
- `permissions` is a unique array of exact permission strings.
- `access` declares thread-visible tool groups and their manifest-known tool names.
- `files`, `network`, `env`, `settings`, `providers`, `notificationProviders`, `storage.defaults`, `gc`, and `limits` declare the capabilities that activation UI and runtime validation use.

The exact v1 permission list is:

- `storage:read`, `storage:write`, `storage:delete`
- `files:read`, `files:write`, `files:delete`
- `network:fetch`
- `cron:create`
- `notification:send`, `notification:provider`
- `provider:register`
- `metidos:provides_embeddings`, `metidos:can_embed`, `metidos:lancedb`
- `calendar:list`, `calendar:create`, `calendar:modify`, `calendar:delete`
- `events:list`, `events:get`, `events:create`, `events:modify`, `events:delete`
- `terminal:create`, `terminal:read`, `terminal:grep`, `terminal:kill`
- `sqlite`
- `log:write`
- `unsafe`

Important manifest constraints:

- `sqlite` requires `storage:write` and is limited to plugin `.data`.
- `terminal:create` and `terminal:kill` require `unsafe`.
- `network:fetch` requires a non-empty `network.allow` list.
- Provider families require `provider:register`; embedding providers also require `metidos:provides_embeddings`; notification providers require `notification:provider`.
- Embedding consumers require `metidos:can_embed`. LanceDB vector storage requires `metidos:lancedb` and `storage:write`.
- `access` is limited to 25 groups. Tool names must be `snake_case`, and a plugin can register at most 30 distinct tools. The same tool may appear in more than one access group.
- Project file patterns must start with `./`. Patterns that can match `./.git/**` or `./.ssh/**` are invalid.
- `~/` is governed by storage permissions and quotas, not by `files.*` project allowlists.
- Secret env declarations cannot include defaults.
- Setting defaults must match the declared kind: URL defaults are syntactically valid URLs, date defaults use `YYYY-MM-DD`, enum defaults match an option, and list defaults are arrays of strings.
- Secret settings are scalar-only; list settings can contain only string, URL, or email items.

## Example: minimal tool plugin manifest

This example is also stored as [`examples/metidos-plugin-minimal-tool.json`](./examples/metidos-plugin-minimal-tool.json).

```json
{
  "id": "hello_tool",
  "name": "Hello Tool",
  "version": "1.0.0",
  "metidosApiVersion": "v1",
  "description": "Adds a simple hello-world tool for approved threads.",
  "permissions": ["storage:read", "storage:write", "log:write"],
  "access": [
    {
      "id": "hello_tools",
      "name": "Hello tools",
      "description": "Expose the hello_world tool to selected threads.",
      "tools": [
        {
          "name": "hello_world",
          "description": "Return a greeting and optionally persist a note.",
          "timeoutMs": 5000
        }
      ]
    }
  ],
  "storage": {
    "defaults": {
      "maxDataBytes": 104857600,
      "maxFileBytes": 10485760,
      "maxFiles": 10000
    }
  },
  "limits": {
    "maxTextResultBytes": 262144
  }
}
```

## Example: provider plugin manifest

This example is also stored as [`examples/metidos-plugin-provider.json`](./examples/metidos-plugin-provider.json).

```json
{
  "id": "local_ollama_provider",
  "name": "Local Ollama Provider",
  "version": "1.0.0",
  "metidosApiVersion": "v1",
  "description": "Registers local Ollama model provider configurations from plugin data.",
  "permissions": [
    "storage:read",
    "storage:write",
    "network:fetch",
    "provider:register",
    "log:write"
  ],
  "network": {
    "allow": ["http://localhost:11434/**", "http://127.0.0.1:11434/**"],
    "enforceHttps": false
  },
  "settings": [
    {
      "key": "refresh_interval_minutes",
      "label": "Refresh interval minutes",
      "kind": "number",
      "default": 10,
      "required": true
    }
  ],
  "providers": [
    {
      "id": "ollama",
      "name": "Ollama",
      "description": "Discovers models from one or more local Ollama instances.",
      "timeoutMs": 30000
    }
  ],
  "storage": {
    "defaults": {
      "maxDataBytes": 104857600,
      "maxFileBytes": 10485760,
      "maxFiles": 10000
    }
  }
}
```

## Discovery and review lifecycle

1. Metidos watches `APP_DATA/plugins/` for folder additions, deletions, and uninitialized mutations.
2. Discovery validates readable structure and manifest shape without executing plugin code.
3. Settings groups plugins as Uninitialized, Needs Review, Active, Failed/Degraded, Disabled/Restart Required, or Missing/Unavailable. Missing or unreadable folders for persisted lifecycle records stay visible and are not loaded until the folder returns and validates.
4. The plugin activation screen is titled `Plugin Activation: {Plugin name}` and displays description, permissions, access groups, tools, file allowlists, network allowlists, env/settings declarations, provider declarations, notification provider declarations, cron/log/storage/GC declarations, unsafe warnings, review hash, log opt-in, and notification controls.
5. The same screen exposes backend-provided local-operator capability flags for Open `.data`, Open `.logs`, Reset Plugin Data, and Run Plugin GC. Reset Plugin Data is local-operator-only, requires destructive confirmation, stops the plugin runtime, backs up `.data` to `.data-bak-{timestamp}`, reseeds from `seed/**`, audit-logs the action, and restarts/reloads the plugin. Unavailable actions explain whether the plugin is unapproved, has no logs, or lacks enabled GC.
6. Enable/approval records the approved review hash and approval metadata.
7. App startup and explicit inventory refresh reconcile approved active plugins into sidecars only when the current review hash still matches the approved hash and validation passes.
8. Any changed approved installation file outside excluded paths moves the plugin to `Needs Review` and removes it from active runtime loading until `Review Plugin Changes` and `Re-approve Plugin` succeed.
9. `Disable` marks the plugin disabled and restart-required; runtime capabilities already loaded in the current process are not hot-unregistered.
10. `Retry Plugin` clears failed runtime state and retries startup without changing approval hash.
11. Plugin lifecycle step-up follows the runtime-exposure threat model: Enable, Re-approve Plugin, Retry Plugin, and Run Plugin GC require recent step-up authentication; Disable, Review Plugin Changes, Open `.data`, Open `.logs`, and Reset Plugin Data require a local-operator session but not recent step-up. Reset Plugin Data still requires destructive confirmation by typing the plugin folder name.

## Deterministic review hashing

The approved folder hash is SHA-256 over sorted entries of:

```text
relative/path\0sha256(file contents)
```

Rules:

- Use normalized forward-slash relative paths.
- Include manifest, `AGENTS.md`, `index.ts`, `seed/**`, and other source/support files.
- Exclude `.data/**`, `.data-bak-*/**`, and `.logs/**`.
- Do not follow symlinks outside the plugin folder.
- Treat missing or unreadable required files and root `node_modules/` as activation-blocking.

## Runtime architecture

Activated plugins run one sidecar process per plugin. The manifest `main` extension selects the execution adapter:

- TypeScript/JavaScript entrypoints are bundled with `Bun.build`, loaded into QuickJS, injected with the Metidos plugin API object, and executed through the `definePlugin` setup callback.
- Python `.py` entrypoints run in the safe Pyodide plugin host with the same reviewed manifest, sidecar lifecycle, permissions, and host API checks. They do not run in host Python.

Import and runtime-surface rules:

- Relative TypeScript/JavaScript imports are allowed only when they stay inside the plugin folder.
- The only allowed TypeScript/JavaScript bare import is `@metidos/plugin-api`.
- Imports escaping the plugin folder, other bare imports, `node:` imports, `bun:` imports, and dynamic `import(...)` are rejected before execution.
- No raw Node, Bun, Python host filesystem, raw network, process env, DB handles, terminal primitives, unrestricted timers, or runtime package installation are exposed to plugin code.

Startup and callback limits:

- Startup timeout: 60 seconds.
- Callback timeout bounds: 1,000 ms to 600,000 ms.
- Default sidecar memory limit: 128 MB.
- RPC payload limit: 1 MB. Binary payloads are base64 and still count toward the limit.
- Tool text/markdown result limit: 256 KB.
- Network response body limit: 25 MB.

Sidecar protocol:

- Host-owned typed JSON RPC over stdio.
- Envelopes include `id`, `type`, `pluginId`, and `payload`.
- `host.startup.payload.env` contains only manifest-declared env keys with captured string values or `null`; undeclared host env keys are not sent to sidecars.
- stdout is protocol only; stderr is diagnostics.
- In-flight operations are not automatically retried after a crash.
- Crash-loop threshold is exactly 3 crashes within 60 seconds; after that the plugin is Failed/Degraded until local-operator Retry Plugin.

## Host API summary

### Tools and access groups

Plugins register tools during setup with `metidos.addAgentTool`. Runtime tool IDs are `plugin_id_tool_name` so provider tool-name validators accept them. Manifest-declared access groups control which plugin tools appear in a thread. Threads persist enabled access group keys as `plugin_id/group_id`, and only access groups from active approved plugins are offered for selection. They do not grant permissions and do not bypass host API permission checks.

Tool actions may return plain JSON/string values or one of these typed result objects:

- `{ type: "text", text: string }`
- `{ type: "markdown", markdown: string }`
- `{ type: "image:url", url: string, alt?: string }`
- `{ type: "image:file", path: string, mimeType: "image/...", alt?: string }`

Text and markdown output sent to the model is capped at 256 KB. `image:file` paths are resolved through the same `metidos.fs` read path and require `storage:read`; `./` project paths also require `files:read`, matching `files.allow.read` coverage, and no matching `files.deny.read` pattern. Image file failures are reported with controlled plugin-result errors rather than host filesystem paths.

### Files and storage

`metidos.fs` supports `ls`, `glob`, `stat`, `exists`, `read`, `readText`, `write`, `writeText`, `mkdir`, `rm`, `rmdir`, `copy`, and `move`.

- `~/` maps to plugin `.data` and uses `storage:*` permissions and quotas.
- `./` maps to the current thread/project folder and is available only in thread tool contexts; cron, GC, init, provider configuration, provider execution, and notification provider callbacks receive `PluginContextError` when they request project paths.
- Project paths require the matching `files:*` permission plus `files.*` allowlist coverage; plugin data paths require `storage:*` permissions and quotas.
- Every operation normalizes paths, resolves symlinks, realpaths, and ensures containment.
- Plugin code cannot read its own manifest/source through `metidos.fs`.

### Network

`metidos.fetch` requires `network:fetch` and a matching `network.allow` entry. Patterns default to HTTPS when protocol is omitted. Redirects are limited to 5 and every hop must match allowlist and HTTPS policy. URL credentials are forbidden. Dangerous hop-by-hop request headers are blocked.

### Env and settings

Only manifest-declared env keys are captured at sidecar startup. Optional env defaults are captured when the host environment does not provide a value; secret env declarations cannot define defaults. `metidos.env.get(KEY)` throws for undeclared keys. Missing required env vars fail startup with lifecycle and stderr diagnostics. Secret env values are masked in local-operator UI as exactly 50 asterisks. Host process env changes require a sidecar/app restart before plugins see new values.

Plugin Settings are local-operator-writable and exposed in every plugin context as `metidos.settings` with `get(key)`, `has(key)`, and `all()` helpers over manifest-declared settings. Tools may set secret settings where supported but cannot read unreadable secret values. v1 masks host-owned secret settings in host-provided views, but it does not automatically redact plugin-authored logs, thrown errors, or tool outputs.

### Notifications and notification providers

`metidos.notifications.send` requires `notification:send`. Delivery failures return failed receipts instead of throwing; permission errors still throw. Defaults are 3 notifications per minute and 25 per day per `plugin_id + local_recipient`; global cron contexts use the same plugin notification controls and rate limits with a global cron recipient key.

Notification provider registration uses `metidos.notifications.addProvider({ id, timeoutMs, send })`, requires `notification:provider`, is initialization-only, and is limited to 10 providers per plugin. The provider `send` callback returns `{ receipts }`; `metidos.notifications.registerProvider(...)` is an alias. Notification send receipts include the source provider plus optional provider external id/url and failure code/message/retryable/retry-after details; callback failures are converted into failed receipts instead of crashing Metidos.

### Model providers

Provider registration requires `provider:register`, is initialization-only, and uses `metidos.providers.addProvider({ id, timeoutMs, refreshIntervalMs?, getProviderConfigurations, execute?, embed? })` / `metidos.providers.registerProvider(...)`. `getProviderConfigurations(): Promise<ProviderConfiguration[]>` runs at plugin startup/load and again on refresh, receives Plugin Settings, and supports up to 10 provider families and 25 provider configurations per plugin. Optional `execute(context, request)` runs model requests through a Pi-compatible one-shot provider adapter with the callback context. `timeoutMs` applies to startup, refresh, and execution callbacks; optional `refreshIntervalMs` enables cached background rediscovery without interrupting active selections. Provider model identities use:

```text
plugin_id/provider_id/configuration_id/model_id
```

Dynamic refresh can update model metadata, availability, labels, pricing, capabilities, and reasoning settings without disrupting active selections for models that remain present. Models that disappear from a refreshed provider are removed from the catalog instead of being synthesized as cached fallback selections; stale/error states disable new selection until the provider refresh succeeds. Execution callback failures are surfaced as provider/model errors and do not mutate active selections.

Embedding provider plugins declare `metidos:provides_embeddings`, mark embedding-capable models with `api: "embeddings"` or `compat.providesEmbeddings: true`, and implement `embed(context, request)`. Embedding consumers declare `metidos:can_embed` and call `metidos.embeddings.embed(input, payload?)`, which routes to the configured runtime embedding model. Consumers that store/query vectors declare `metidos:lancedb` plus `storage:write` and use `metidos.lancedb.open("~/...")`; plugin LanceDB paths are plugin-owned data only, never project `./` paths.

### Crons

`metidos.cron({ key, schedule, timeoutMs, action })` requires `cron:create`. Crons are registered during plugin setup, are limited to 10 total per plugin, and have keys unique within that plugin. Cron contexts have no current thread/project, may read declared `metidos.settings`, and disable thread APIs, terminal APIs, confirmation flows, provider registration, and notification provider registration.

### Calendar, events, terminal, SQLite

Calendar and event APIs require their matching permissions. The v1 author API exposes `metidos.calendar.list/create/modify/delete` and `metidos.events.list/get/create/modify/delete`; these operations require a thread or other interactive callback context. Calendar/event delete always requires `confirmation: true` or `confirmed: true` and therefore fails in cron because confirmation is unavailable. Terminal create/kill require `unsafe`; terminal APIs are unavailable in cron. SQLite requires `sqlite + storage:write`, opens only under plugin `~/`, and never exposes the Metidos application DB. Missing permissions from these APIs surface as `PluginPermissionError`; unavailable callback contexts surface as `PluginContextError`.

### Logging, telemetry, diagnostics

`metidos.log(level, message)` requires `log:write`. Logs are disabled by default and local-operator-controlled. Plugin logs live in `.logs/log-YYYY-MM-DD.log` with lines formatted:

```text
[level] [time] : [message]
```

Retention defaults to 14 days and 25 MB per plugin. Sidecar stderr is separate from plugin logs, streamed to Metidos stderr, reported to telemetry where allowed, and retains the last 200 lines for local diagnostics. `telemetry: false` opts out of plugin-specific telemetry where supported; local stderr still reports local failures.

## Definition of done for v1

- Dropping a plugin folder into `APP_DATA/plugins/` makes it appear without executing plugin code.
- Local-operator review shows all declared capabilities and unsafe warnings before approval.
- Approved plugin code builds in its own sidecar and runs in QuickJS with only injected APIs.
- Registrations are validated against the manifest.
- Thread access groups expose only selected plugin tools.
- Host APIs enforce permissions, context rules, quotas, path containment, network allowlists, timeouts, and result-size limits.
- `.data` is seeded on first activation, quota-managed, resettable, and excluded from review hashing with `.logs` and data backups.
- Notifications, crons, notification providers, model providers, embedding providers, embedding consumers, and plugin-owned LanceDB vector stores can be implemented by approved plugins.
- Failed/degraded plugins are diagnosable from plugin settings.
- Plugin changes outside excluded paths require review.
- Disabling a plugin requires restart.
- Examples validate and demonstrate the full authoring path.
