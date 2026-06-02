# Metidos Plugin Authoring Guide v1

This guide is the copy/edit path for local, local-operator-approved Metidos Plugin System v1 plugins. It complements the product rules in [`metidos-plugin-system-v1-prd.md`](./metidos-plugin-system-v1-prd.md), the locked design decisions in [`metidos-plugin-decisions.md`](./metidos-plugin-decisions.md), and the manifest schema in [`metidos-plugin.schema.json`](./metidos-plugin.schema.json).

Plugin System v1 is intentionally local and review-first: a plugin folder is copied under `APP_DATA/plugins/`, Metidos discovers and validates it without executing code, the local operator reviews the declared capabilities and deterministic folder hash, and only then does Metidos build and run the plugin in a per-plugin sidecar.

Agents helping local operators create or repair plugins should use the repository skill at [`.pi/skills/metidos-plugin-authoring/SKILL.md`](../.pi/skills/metidos-plugin-authoring/SKILL.md). Keep that skill, this guide, the [`AGENTS.md` guide](./metidos-plugin-agents-guide.md), the schema, and the examples synchronized whenever Plugin System v1 public behavior changes.

## Quick start: copy an example and edit it

1. Pick the closest copyable example under [`examples/plugins/`](./examples/plugins/):
   - [`hello_tool`](./examples/plugins/hello_tool/) for a minimal TypeScript agent tool.
   - [`python_hello_tool`](./examples/plugins/python_hello_tool/) for a minimal Python agent tool.
   - [`cron_notification_digest`](./examples/plugins/cron_notification_digest/) for global crons and notification sending.
   - [`ollama_model_provider`](./examples/plugins/ollama_model_provider/) for model provider registration and dynamic model discovery.
   - [`ntfy_notification_provider`](./examples/plugins/ntfy_notification_provider/) for notification provider registration, settings/env, network fetch, and receipts.
   - [`fake_ingress`](./examples/plugins/fake_ingress/) for a provider-agnostic fake request ingress source and reply-to-source fixture.
   - [`vector_memory`](./examples/plugins/vector_memory/) for plugin-scoped LanceDB vector storage with Metidos embeddings.
   - [`rss_feed_indexer`](./examples/plugins/rss_feed_indexer/) for local RSS/OPML refresh with a local cron, unsafe all-domain HTTPS feed fetching, Metidos embeddings, and plugin-scoped LanceDB query storage.
2. Copy the whole example directory into a development app-data directory using a stable folder name that matches the manifest `id`:

   ```text
   APP_DATA/plugins/{plugin_id}/
   ```

3. Rename the manifest `id`, `name`, `version`, `description`, access-group ids, tool names, provider ids, cron keys, settings, env keys, and file/network allowlists to match your plugin. Plugin ids must be unique in `APP_DATA/plugins/`, and neither the plugin id nor display name may be `metidos`.
4. Edit the manifest `main` entry file (`index.ts`, `main.py`, or another declared path) and keep every registration aligned with the manifest. If a tool/injection/provider/cron is registered in code, it must be declared in `metidos-plugin.json` with the needed permission.
5. Edit `AGENTS.md` so operators and future agents know how to validate, inspect, repair, and reset your plugin data safely.
6. Start or refresh Metidos, open Settings → Plugins, fix validation errors, review declared capabilities, approve the plugin, and enable any thread access group needed by a thread.
7. After each source or manifest change, use Review Plugin Changes and Re-approve Plugin. Changes outside excluded data/log paths intentionally invalidate the previous approval hash.

Do not copy `.data/`, `.data-bak-*`, `.logs/`, `node_modules/`, host secrets, or generated build output as plugin source.

## Required folder layout

Each plugin installation is one directory below `APP_DATA/plugins/{plugin_id}/`.

```text
APP_DATA/plugins/{plugin_id}/
  metidos-plugin.json        # required manifest; must match the folder identity
  AGENTS.md                  # required operator/agent guidance
  index.ts                   # conventional TypeScript entry point; manifest main may also point at .py
  seed/                      # optional first-activation data seed
  .data/                     # created and owned by Metidos at activation/runtime
  .data-bak-{timestamp}/     # created by Reset Plugin Data
  .logs/                     # created only when plugin logging is enabled
```

Rules for install roots:

- `metidos-plugin.json`, `AGENTS.md`, and the file referenced by manifest `main` are required and part of the review hash.
- `seed/**` is copied into `.data/**` only during first activation or explicit Reset Plugin Data.
- `.data/**`, `.data-bak-*/**`, and `.logs/**` are mutable runtime paths and are excluded from the review hash.
- `node_modules/` at the plugin root is activation-blocking. Plugin v1 has no runtime package-manager install step.
- Symlinks that escape the plugin directory are invalid for validation, hashing, and data operations.
- Plugin code cannot use `metidos.fs` to read its own manifest/source files.

## Write the manifest first

The manifest file is `metidos-plugin.json`. It is the review contract between the plugin author, the local operator, and the runtime. Keep it minimal and exact; do not request broad permissions while prototyping.

Minimal tool manifest:

```json
{
  "id": "hello_tool",
  "name": "Hello Tool",
  "version": "1.0.0",
  "metidosApiVersion": "v1",
  "main": "./index.ts",
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

Top-level manifest fields:

| Field | Authoring guidance |
| --- | --- |
| `id` | Required. Stable lowercase id, `^[a-z][a-z0-9_]{1,63}$`, globally unique within `APP_DATA/plugins/`, not `metidos`, and should match the install folder. Changing it creates a different plugin identity. |
| `name`, `description`, `version` | Required review text. `name` must not be `metidos` case-insensitively. `version` must be semver. |
| `color` | Optional CSS color string used to tint the plugin's access groups in thread/cron access controls. |
| `metidosApiVersion` | Required and must be `"v1"`. |
| `telemetry` | Optional boolean; defaults to `true`. `false` opts out of plugin-specific telemetry where supported but does not hide local stderr diagnostics. |
| `permissions` | Exact approved host capabilities. Runtime APIs still enforce these permissions even when a thread enables a plugin access group. |
| `access` | Thread-visible access groups. Declare every tool in `tools[]` and every prompt injection in `injects[]` that may be registered by the manifest `main` entry file. |
| `files` | Project `./` file policy. Declare `allow.read`/`allow.write`/`allow.delete` patterns, and optional `deny.read`/`deny.write`/`deny.delete` exclusions. Patterns must start with `./`; Metidos injects built-in deny rules for `.git` and `.ssh`. |
| `network` | URL allowlists and HTTPS policy for `metidos.fetch` and `metidos.websocket`. Required with the matching non-empty allowlist when `network:fetch` or `network:websocket` is requested. |
| `env` | Host environment variables captured at sidecar startup. Secret env vars cannot define defaults. |
| `settings` | Plugin Settings. Declare every key before using it. |
| `piAuth` | Optional ordered handoff from declared plugin settings or env vars into Pi auth. The first record that resolves a credential for a provider wins. |
| `providers` | Model provider families registered during initialization. Requires `provider:register`. |
| `notificationProviders` | Notification provider families registered during initialization. Requires `notification:provider`. |
| `oauthProviders` | OAuth adapter families registered during initialization. Requires `oauth:register`. |
| `storage.defaults` | Plugin `.data` quota defaults. Defaults are 100 MB total, 10 MB per file, and 10,000 files. |
| `gc` | Optional plugin data GC declaration. `enabled` must be `true`; `timeoutMs` must be 1,000–600,000. |
| `limits` | Optional caps. Defaults: 1 MB RPC payload, 256 KB text/markdown tool output, 25 MB network response, 128 MB sidecar memory, 4 WebSocket connections, 64 KB WebSocket messages, and 32 queued WebSocket messages. |

Permission list:

See the [plugin permission reference](./plugin-permissions.md) for each exact permission name, capability granted, risk level, and user-facing explanation.

- Storage and project files: `storage:read`, `storage:write`, `storage:delete`, `files:read`, `files:write`, `files:delete`
- Network: `network:fetch`, `network:websocket`
- Scheduling: `cron:create`
- Ingress and source replies: `plugin:request-ingress`, `plugin:reply-to-source`
- Notifications: `notification:send`, `notification:provider`
- Model providers: `provider:register`, plus `metidos:provides_embeddings` when the provider exposes embedding models
- Calendar/events: `calendar:list`, `calendar:create`, `calendar:modify`, `calendar:delete`, `events:list`, `events:get`, `events:create`, `events:modify`, `events:delete`
- Terminal: `terminal:create`, `terminal:read`, `terminal:grep`, `terminal:kill`
- Prompt injection: `metidos:prompt_inject`
- Local database/vector storage/logging/high-impact access: `sqlite`, `metidos:lancedb`, `log:write`, `unsafe`

Important manifest constraints:

- `sqlite` also requires `storage:write` and is always scoped to plugin `~/` data.
- `metidos:lancedb` also requires `storage:write` and is always scoped to plugin `~/` data. Use `metidos:can_embed` too when the plugin embeds text before upserting or querying vectors.
- `terminal:create` and `terminal:kill` also require `unsafe`; approval UI surfaces unsafe warnings.
- `network:fetch` requires a non-empty `network.allow` list.
- `network:websocket` requires a non-empty `network.webSocketAllow` list.
- All-domain host allow patterns such as `https://**/**` or `wss://**/**` require the plugin manifest to declare `unsafe`; use them only when the plugin must accept arbitrary public hosts and will validate/distrust fetched content.
- Localhost and private LAN allowlist targets are still blocked by safe runtime defaults. Reaching them requires the local operator to start Metidos with `METIDOS_PLUGIN_UNSAFE_ALLOW_PRIVATE_NETWORK=true` and the plugin manifest to declare `unsafe` so approval surfaces the escalation.
- `plugin:request-ingress` allows the plugin to offer a Metidos-owned request ingress source for external messages; it does not expose a thread tool or grant direct thread access. Manifests must declare each source in `ingressSources` before plugin code executes, including stable `id`, human `name`, optional `description`, `pollIntervalMs`, `timeoutMs`, and `supportsReplyToSource`.
- `plugin:reply-to-source` allows replies only through the verified ingress source metadata that Metidos provides; it does not grant general network, notification, or cross-source send access. Set `supportsReplyToSource: true` only when this permission is also declared. Reply handlers should log only synthetic ids or redacted provider ids.
- Ingress and reply permissions intentionally use the `plugin:*` manifest namespace, not `metidos:*`, to avoid collision with Thread Access Control ids such as `metidos:threads` and `metidos:webSearch`.
- Provider registration requires `provider:register`; embedding provider configurations should also declare `metidos:provides_embeddings`. Plugins that call the host embedding API require `metidos:can_embed`. Notification provider registration requires `notification:provider`.
- `access` is limited to 25 groups. Access group ids are lowercase identifier strings without `:`. Tool and injection names are `snake_case` identifier strings without `:`. A plugin can register at most 30 distinct tools and 25 distinct prompt injections.
- The same tool or injection may appear in more than one access group.
- `access[].injects` requires the plugin manifest permission `metidos:prompt_inject`. Registered injections run before each thread prompt when the containing plugin access group is enabled for the thread.
- Secret env declarations cannot include defaults.
- Settings must match their declared kind: `string`, `number`, `boolean`, `enum`, `secret`, `url`, `date`, or `list`.
- `url` defaults must be valid HTTP(S) URLs, `date` defaults use `YYYY-MM-DD`, enum defaults must match an option, and list defaults are arrays of strings or numbers according to the list item kind.

## Declare settings and secrets

Use manifest `settings[]` for local-operator-editable values. Each declaration needs a stable `key`, human-readable `label`, `kind`, and optional `description`, `required`, `default`, `options`, or `items` depending on the kind.

```json
{
  "settings": [
    {
      "key": "endpoint_url",
      "label": "Endpoint URL",
      "kind": "url",
      "required": true,
      "default": "https://api.example.test/v1"
    },
    {
      "key": "api_key",
      "label": "API key",
      "kind": "secret",
      "required": true,
      "description": "Stored locally and used only by this plugin."
    },
    {
      "key": "enabled_labels",
      "label": "Enabled labels",
      "kind": "list",
      "items": { "kind": "string" },
      "default": ["triage"]
    }
  ]
}
```

Authoring rules:

- Prefer Plugin Settings for values the Local Operator edits in Settings → Plugins. Prefer `env[]` for process-level deployment values that should be captured at sidecar startup.
- Use `kind: "secret"` for API keys, bearer tokens, passwords, webhook topics that act as capabilities, and similar credentials.
- Secret settings are scalar-only in practice: save strings, numbers, booleans, or `null`; use `null` to clear/reset the stored secret. Do not model secret lists.
- Avoid secret defaults. The schema permits scalar defaults for secret settings, but public examples and real plugins should not embed live credentials or reusable private values. Secret `env` declarations cannot define defaults.
- Keep labels and descriptions specific enough that operators know where the value goes and what happens if it is missing.

Storage and runtime behavior:

- Plugin Settings are persisted under App Data in `plugin-settings-v1.json`, keyed by plugin install directory.
- Non-secret settings are stored as JSON values. Secret setting values are encrypted when saved with the local auth secret key and plugin/key-specific authenticated data.
- If an old plaintext or legacy-scoped encrypted secret is found, Metidos attempts to migrate it to current encrypted storage on read. If a secret cannot be decrypted, it is treated as unset and the operator should save the setting again.
- Plugin sidecar startup receives a `metidos.settings` snapshot with materialized values and `missingRequiredKeys`. Secret values are available to that plugin runtime, so do not log them or return them from tools.

Display, redaction, diagnostics, and reset behavior:

- Settings UI snapshots mark secret settings as `secret` and `readable: false`; their `value` and `defaultValue` are `null`, while `hasStoredValue` tells the UI whether a saved secret exists.
- Host diagnostics and warnings may name the plugin directory and setting key and give repair steps, but must not include decrypted values.
- v1 does not automatically redact plugin-authored logs, thrown errors, tool results, provider responses, or notification payloads. Treat every plugin output path as author-controlled and avoid echoing settings.
- Reset Plugin Data affects `.data` and seed/reset behavior only; it does not clear Plugin Settings. To reset a setting, save a new value or save `null` for secrets.
- Do not ask operators to paste `plugin-settings-v1.json`, plugin `.data`, `.logs`, or unredacted diagnostics into public issues.

## Implement the manifest `main` entry point

Every manifest must declare a `main` string such as `"./index.ts"` or `"./main.py"`. The path must stay inside the plugin folder and cannot point into `.data`, `.logs`, or `.data-bak-*`. TypeScript and JavaScript entries are bundled directly. Python entries use a `.py` file and run in the safe Pyodide plugin host.

## Implement a TypeScript/JavaScript entry point

The only allowed bare import is `@metidos/plugin-api`. Local relative imports are allowed only when they stay inside the plugin folder. Imports that escape the folder, other bare imports, `node:` imports, `bun:` imports, and dynamic `import(...)` are rejected before execution. Do not rely on `Bun`, `process`, raw `fetch`, raw filesystem APIs, unrestricted timers, host DB handles, or terminal primitives; QuickJS receives only the injected Metidos plugin API.

A plugin entry point exports `definePlugin(...)`:

```ts
import { definePlugin } from "@metidos/plugin-api";

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "hello_world",
    name: "Hello world",
    description: "Return a greeting.",
    timeoutMs: 5000,
    validateProps(input) {
      const record = input && typeof input === "object" ? input : {};
      const name =
        "name" in record && typeof record.name === "string"
          ? record.name.slice(0, 80)
          : "world";
      return { name };
    },
    async action(_context, props) {
      await metidos.log("info", `Saying hello to ${props.name}`);
      return { type: "text", text: `Hello ${props.name}!` };
    },
  });
});
```

Registration rules:

- Register tools, prompt injections, crons, model providers, notification providers, and GC callbacks during initialization. Provider/cron/injection registration is not available from tool, injection, cron, provider execution, notification provider, or GC callbacks.
- Registration must match the manifest. Duplicate or undeclared registrations, missing permissions, too many registrations, or timeout values outside 1,000–600,000 ms are startup contract failures.
- Tool registration requires `tool`, `name`, `description`, `timeoutMs`, `validateProps(input)`, and `action(context, props)`.
- Prompt injection registration requires `inject`, `name`, `timeoutMs`, and `prompt(context, prompt)`. The `prompt` argument is the simple user prompt sent to the thread; Metidos prepends non-empty injection results to that prompt before sending the turn to Pi.
- Tool runtime IDs shown to agents are `plugin_id_tool_name` so provider tool-name validators accept them.
- Tool callbacks receive a thread tool context. The currently stable fields are context metadata such as `contextKind`, `projectId`, `threadId`, and `worktreePath`; avoid depending on extra fields unless documented by your installed Metidos version.
- Use `validateProps` to reject unsafe inputs before touching host APIs. Keep error messages concise and free of secrets.

Tool results may be ordinary strings/JSON values or one of these typed objects:

```ts
type PluginToolResult =
  | { type: "text"; text: string }
  | { type: "markdown"; markdown: string }
  | { type: "image:url"; url: string; alt?: string }
  | { type: "image:file"; path: string; mimeType: `image/${string}`; alt?: string };
```

Text and markdown results sent to the model are capped at 256 KB by default. `image:file` paths are resolved through the same plugin file rules as `metidos.fs.read`; plugin data images require `storage:read`, while project images require both `storage:read` and `files:read`, matching `files.allow.read` coverage, and no matching read deny pattern.

## Use permissions and access groups correctly

Permissions are local-operator-approved host capabilities. Access groups are thread opt-ins for plugin tool visibility and prompt injection. These are deliberately separate:

- Enabling `plugin_id/group_id` on a thread can make tools from that group available to the agent and allow injections from that group to run.
- Enabling an access group never grants storage, project files, network, terminal, calendar, events, notifications, providers, SQLite, logging, or unsafe capabilities.
- Every host API call still checks the manifest-approved permission and whether the current callback context supports that API.

Design access groups around local-operator intent, not around host permissions. For example, a `research_tools` group may expose `read_source_file`, `write_scratch_note`, and `delete_scratch_note`, while the manifest still separately declares `files.allow.read`, `files.allow.write`, `files.allow.delete`, and any deny patterns for the precise `./` paths those tools can touch.

## File and storage API (`metidos.fs`)

The plugin virtual filesystem has two roots:

- `~/` maps to plugin-owned `.data` and uses `storage:*` permissions and quotas.
- `./` maps to the current thread/project worktree and is available only in thread tool contexts. It requires the matching storage guard (`storage:read`, `storage:write`, or `storage:delete`), the matching `files:*` permission, matching `files.allow.*` coverage, and no matching `files.deny.*` pattern.

Read APIs:

- `metidos.fs.ls(path)`
- `metidos.fs.glob(pattern)`
- `metidos.fs.stat(path)`
- `metidos.fs.exists(path)`
- `metidos.fs.read(path)`
- `metidos.fs.readText(path)`

Write/delete APIs:

- `metidos.fs.write(path, bytes)`
- `metidos.fs.writeText(path, text)`
- `metidos.fs.mkdir(path, { recursive? })`
- `metidos.fs.rm(path, { force?, recursive? })`
- `metidos.fs.rmdir(path)`
- `metidos.fs.copy(from, to)`
- `metidos.fs.move(from, to)`

Safety rules:

- Keep durable plugin state under `~/`.
- Use `./` only when the tool genuinely needs project files; broad allows such as `./**` should be paired with explicit deny patterns where the plugin should not inspect or mutate project data.
- All operations normalize paths, resolve realpaths/symlinks, and enforce containment.
- `ls` and `glob` return plugin-visible virtual paths, not host absolute paths.
- Denied project paths are filtered or rejected without leaking host absolute paths.
- `~/` writes/deletes require `storage:write`/`storage:delete`; project reads/writes/deletes require both the matching `storage:*` guard and `files:*` permission, allow coverage, and no matching deny pattern.
- Project file APIs are unavailable from global crons, GC, startup, provider discovery, provider execution, and notification provider callbacks.
- Never store secrets in plain text unless the local operator explicitly configured the plugin to do so and understands the persistence model.

Quota defaults are 100 MB total plugin data, 10 MB per file, and 10,000 files. Use GC and small, bounded files to avoid quota failures.

## SQLite API (`metidos.sqlite`)

`metidos.sqlite(path)` requires `sqlite` and `storage:write`. It opens only plugin-owned `~/` paths and never opens project files, `:memory:`, `file:` URLs, or the Metidos application database.

```ts
const db = metidos.sqlite("~/state.sqlite");
await db.run("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT)");
await db.run("INSERT OR REPLACE INTO notes (id, body) VALUES (?, ?)", [
  "welcome",
  "hello",
]);
const row = await db.get("SELECT body FROM notes WHERE id = ?", ["welcome"]);
await db.close();
```

Available methods are `run`, `all`, `query`, `get`, and `close`. Statements reject multi-statement input, `ATTACH`/`DETACH`, `VACUUM INTO`, `load_extension()`, traversal, and symlink escapes. Use bound parameters instead of string interpolation.

## Embeddings API (`metidos.embeddings`)

Embedding support has two separate roles with different permissions:

- **Embedding providers** expose models that can produce vectors. They require `provider:register` and `metidos:provides_embeddings`, register `metidos.providers.addProvider({ ..., embed })`, and should mark embedding-capable models with `api: "embeddings"` or `compat.providesEmbeddings: true`.
- **Embedding consumers** call `metidos.embeddings.embed(input, payload?)`. They require `metidos:can_embed`. They may also require `metidos:lancedb` and `storage:write` if they persist/query vectors.

`metidos.embeddings.embed(input, payload?)` routes through the local runtime embedding model. Consumers should not assume a specific provider. The host normalizes provider responses into `readonly number[]` and rejects missing, empty, or non-finite vectors.

```ts
const vector = await metidos.embeddings.embed("Search text", {
  purpose: "my_plugin.semantic_search.query",
});
```

Supported input values are strings, number arrays, `Uint8Array`, and `ArrayBuffer`. Prefer strings for semantic search and document the source of text being embedded. Treat embedding inputs as potentially sensitive: avoid embedding secrets, raw headers, API keys, hidden thread state, full transcripts, or unnecessary private document bodies. If a plugin derives embeddings from project files or external records, document exactly which content is embedded and whether the derived vectors can be regenerated.

Use the optional `payload` for bounded provider hints and auditing metadata such as `purpose`, source ids, or truncation strategy. Do not put secrets in `payload`; provider plugins may receive it.

## LanceDB vector API (`metidos.lancedb`)

`metidos.lancedb.open(path)` requires `metidos:lancedb` and `storage:write`. It opens only plugin-owned `~/` paths. Store rows with a `vector: number[]` field, optionally include `id` to update a record, and use `metidos.embeddings.embed(input, payload?)` when you need text-to-vector conversion.

```ts
const db = await metidos.lancedb.open("~/memory/notes");
const vector = await metidos.embeddings.embed("Remember this note");
await db.upsert([{ id: 1, vector, title: "Note", body: "Remember this note" }]);
const rows = await db.query(vector, { limit: 5 });
await db.remove(1);
```

Available methods are `query(vector, options?)`, `upsert(rowOrRows)`, and `remove(id)`. Paths reject project roots, traversal, and symlink escapes through the normal plugin data resolver.

Design vector stores as derived plugin-owned data unless the product intentionally requires durable local-operator-authored memory. Recommended practice:

- keep ids stable so repeated indexing updates instead of duplicating rows,
- store bounded metadata, excerpts, source ids, timestamps, and hashes rather than full secret-bearing documents,
- document the `.data` path and whether Reset Plugin Data can safely regenerate it,
- cap query limits in `validateProps`, even though the host also enforces caps,
- avoid logging raw embedded text or search results that may contain private source content,
- consider stale/deleted source cleanup by calling `remove(id)` or rebuilding the store after Reset Plugin Data.

Thread-level native `metidos:lancedb` tools are separate from plugin `metidos.lancedb`. Plugin code cannot open project vector stores through `./`; plugin vector storage stays under `~/`.

## Environment and settings

Declare every env key and setting in the manifest before reading it.

- `metidos.env.get(KEY)` returns a string or `null` for declared keys and throws for undeclared keys.
- Only declared env keys are captured at sidecar startup. Host process env changes require a sidecar/app restart before plugins see new values.
- Missing required env vars fail startup with lifecycle and stderr diagnostics.
- Secret env vars cannot have defaults and are masked in local-operator review UI.
- `metidos.settings.get(key)`, `.has(key)`, and `.all()` are available in plugin contexts for manifest-declared Plugin Settings.
- Tools may set secret settings where supported by the runtime, but secret settings are not readable by tools.

V1 masks host-owned secret values in host-provided views, but it does not automatically redact plugin-authored logs, thrown errors, tool outputs, provider outputs, notification payloads, or network requests. Do not intentionally include secrets in those surfaces.

## Network fetch API (`metidos.fetch`)

`metidos.fetch(url, options?)` requires `network:fetch` and a matching `network.allow` entry.

Manifest example:

```json
{
  "permissions": ["network:fetch"],
  "network": {
    "allow": ["https://api.example.test/v1/**"]
  }
}
```

Runtime behavior:

- Omitted protocols in allowlist patterns default to HTTPS.
- Matching normalizes protocol and host casing, keeps paths case-sensitive, and ignores query strings/fragments.
- Literal hosts are the default. The special all-domain host patterns `https://**/**` and `https://*/**` are accepted only when the manifest also declares `unsafe`.
- URL credentials are rejected in both manifest patterns and runtime requests.
- HTTP is rejected unless `network.enforceHttps` is `false` and the allowlist entry itself uses `http://`.
- Localhost and private LAN targets are blocked unless the local operator enables unsafe private-network runtime mode and approves a plugin that declares `unsafe`.
- Redirects are followed up to 5 hops, and every hop must match the allowlist and HTTPS policy.
- Requests time out after 30 seconds by default.
- Response bodies are capped at 25 MB by default.
- Dangerous hop-by-hop or ambient-auth headers such as `host`, `connection`, `transfer-encoding`, `content-length`, and `cookie` are blocked.
- Request bodies may be strings, `Uint8Array`, or `ArrayBuffer`. Use byte bodies for approved binary uploads; avoid logging or returning the bytes.
- The response object exposes `status`, `ok`, `redirected`, `statusText`, `headers`, `url`, `text()`, and `json()`.

Network allowlists are URL boundaries, not semantic data-loss prevention. An allowed endpoint can still receive whatever data the plugin sends. Avoid secrets in URLs, headers, bodies, logs, errors, and tool/provider output unless the destination and purpose are documented for local-operator review.

## WebSocket client API (`metidos.websocket`)

`metidos.websocket.connect(url, options?)` requires `network:websocket` and a matching `network.webSocketAllow` entry. It returns a `MetidosWebSocketClient` with a numeric runtime-local `id`, `sendText`, `receive`, `events`, `state`, and `close` methods.

Manifest example:

```json
{
  "permissions": ["network:websocket"],
  "network": {
    "webSocketAllow": ["wss://stream.example.test/v1/**"]
  },
  "limits": {
    "maxWebSocketConnections": 4,
    "maxWebSocketMessageBytes": 65536,
    "maxWebSocketQueuedMessages": 32
  }
}
```

Runtime behavior:

- Omitted protocols in WebSocket allowlist patterns default to WSS.
- `ws://` is rejected unless `network.enforceHttps` is `false` and the allowlist entry itself uses `ws://`.
- Literal hosts are the default. The special all-domain host patterns `wss://**/**` and `wss://*/**` are accepted only when the manifest also declares `unsafe`.
- Localhost and private LAN targets are blocked unless the local operator enables unsafe private-network runtime mode and approves a plugin that declares `unsafe`.
- URL credentials are rejected in both manifest patterns and runtime requests.
- Request headers are optional, but ambient-auth and handshake headers such as `host`, `connection`, `upgrade`, `cookie`, and `sec-websocket-*` are blocked.
- Connections time out after 30 seconds by default.
- `receive({ timeoutMs })` pulls the next queued event and rejects on timeout; only one pending receive is allowed per socket.
- `events(options?)` is an async iterator over repeated `receive(options)` calls and stops after yielding a `close` or `error` event.
- Plugins must call `close()` when done; Metidos also closes all plugin-owned sockets on plugin stop, reset, reload, or sidecar exit.

Example:

```ts
const socket = await metidos.websocket.connect("wss://stream.example.test/v1/events");
try {
  await socket.sendText(JSON.stringify({ type: "subscribe" }));
  for await (const event of socket.events({ timeoutMs: 30_000 })) {
    if (event.type === "message") {
      // Handle event.text.
    }
  }
} finally {
  await socket.close(1000, "done");
}
```

## Notifications

### Sending notifications

`metidos.notifications.send({ title, message, priority?, tags?, clickUrl? })` requires `notification:send`. `body` is accepted as an alias for `message`.

- Thread tool callbacks can send to the current local notification context.
- Plugin cron contexts can send through plugin notification controls and rate limits.
- Sends are awaited and return `{ receipts }`.
- Delivery failures return failed receipts without throwing; permission, malformed request, and context errors still throw.
- If no enabled outlet exists, the failed receipt uses `NO_ENABLED_NOTIFICATION_OUTLETS`.
- Default rate limits are 3 notifications per minute and 25 per day per `plugin_id + local_recipient`; cron uses a global cron recipient key.

### Registering notification providers

A notification provider plugin adds a delivery outlet that Metidos can use for later notification sends. It does not automatically send notifications by itself; the Local Operator must approve the plugin and configure/enable the outlet in plugin settings and notification controls.

Declare the outlet family in the manifest and request only the capabilities the provider needs:

```json
{
  "permissions": ["notification:provider", "network:fetch"],
  "notificationProviders": [
    {
      "id": "ntfy",
      "name": "ntfy",
      "description": "Forward Metidos notifications to an ntfy topic.",
      "timeoutMs": 10000
    }
  ],
  "settings": [
    { "key": "server_url", "label": "Server URL", "kind": "url", "required": true },
    { "key": "default_topic", "label": "Default topic", "kind": "secret" }
  ],
  "network": { "allow": ["https://ntfy.sh/**"] }
}
```

`metidos.notifications.addProvider({ id, timeoutMs, send })` and `metidos.notifications.registerProvider(...)` require `notification:provider`, must run during initialization, and are limited to 10 providers per plugin. The `id` and `timeoutMs` must match one manifest `notificationProviders[]` entry. Provider registration is unavailable from tool, cron, GC, provider execution, notification provider, and other non-startup callbacks so the activation review remains stable.

The `send(request)` callback receives a normalized notification request with `title`, `message`/`body`, optional `priority`, `tags`, `clickUrl`, and any extra host metadata supported by the runtime. Return `{ receipts }`; each receipt should include `status: "delivered"` or `status: "failed"`, a user-readable `message`, and stable provider-specific `code`, `externalId`, `externalUrl`, `retryAfter`, or other metadata when helpful.

User configuration rules:

- Use manifest `settings[]` or `env[]` for server URLs, topics, routing names, API tokens, and bearer credentials; mark secrets as `kind: "secret"` or secret env declarations.
- Use narrow `network.allow` entries for provider HTTP calls. Self-hosted or private-network targets require an explicit manifest/network update, re-review, and any unsafe private-network runtime opt-in documented for the plugin.
- Keep topics, tokens, URLs with credentials, and receipt payloads out of logs and public support files. V1 does not automatically redact plugin-authored notification payloads or provider output.
- Document whether missing settings disable the outlet, use a safe default, or return a failed receipt.

Failure-state rules:

- Delivery failures, disabled/missing configuration, rate-limit or policy denials, remote server errors, and callback timeouts should return failed receipts instead of throwing whenever the provider can classify the problem.
- Permission errors, malformed registrations, undeclared providers, registration after startup, and callback results that are not `{ receipts }` are contract failures and may block activation or be converted by the host into failed receipts.
- Use stable failure `code` values such as `MISSING_TOPIC`, `NETWORK_POLICY_DENIED`, `REMOTE_ERROR`, or `TIMEOUT` so Settings, diagnostics, and future tests can recognize the failure without parsing prose.
- Prefer retry hints (`retryAfter`, `retryable`, provider status fields) when the remote provider exposes them, but do not include secrets or sensitive local paths.

Use [`ntfy_notification_provider`](./examples/plugins/ntfy_notification_provider/) as the copyable example.

## Model providers

Use `piAuth` instead of `providers` when Pi already owns the provider id, endpoint, model catalog, and transport. For API-key providers, define the setting shape in `settings`, then bind each fallback explicitly and in order:

```json
"piAuth": [
  { "kind": "api_key", "provider": "openai", "source": "setting", "value": "api_key" },
  { "kind": "api_key", "provider": "openai", "source": "env", "value": "OPENAI_API_KEY" }
]
```

For Codex CLI file auth, resolve an auth JSON path from a setting or env var:

```json
"piAuth": [
  { "kind": "codex_auth", "provider": "openai-codex", "source": "setting", "value": "auth_json_path" }
]
```

For Pi OAuth auth-file imports such as GitHub Copilot, use the first-party `github_copilot` core plugin pattern: resolve a Pi `auth.json` path from a setting or env var, mount or copy only that file into plugin `.data`, and let Pi own provider behavior and token refresh:

```json
"piAuth": [
  { "kind": "pi_oauth_file", "provider": "github-copilot", "source": "setting", "value": "auth_json_path" }
]
```

`pi_oauth_file` reads either a whole Pi auth file containing the named provider key or a direct OAuth credential object. It requires `storage:read` for plugin-owned `.data/auth.json` workflows.

For OAuth providers with plugin-owned import or refresh behavior, declare `oauthProviders`, request `oauth:register`, and register an adapter during initialization with `metidos.oauth.registerProvider(...)` or the top-level alias `metidos.registerOAuth(...)`:

```ts
metidos.oauth.registerProvider({
  id: "example_oauth",
  provider: "example-provider",
  timeoutMs: 5000,
  importCredentials() {
    return null;
  },
  refresh(credentials) {
    return refreshExampleToken(credentials.refresh);
  },
});
```

OAuth adapters return normalized credentials with `access`, `refresh`, and `expires` in milliseconds. Metidos owns storage and refresh locking. Provider-neutral helpers such as `metidos.util.decodeJwtExp(token)`, `metidos.util.atob(value)`, and `metidos.util.btoa(value)` are host utilities; provider-specific parsing remains plugin code. JavaScript plugins also receive browser-compatible global `atob(value)` and `btoa(value)` functions for binary-string base64 conversions, and may import `{ atob, btoa }` from `@metidos/plugin-api` when explicit imports are preferred. Plugins can also use host-backed structured data helpers `metidos.yaml.parse(content)`, `metidos.yaml.stringify(value)`, `metidos.toml.parse(content)`, `metidos.toml.stringify(value)`, `metidos.xml.parse(content, options?)`, and `metidos.xml.encode(value)` without importing parser packages. XML parsing is backed by the bundled Rust `xmloxide` WebAssembly parser. It defaults to strict mode with rejected DTD declarations and bounded bytes, depth, element count, and text size. Plugins that need real-world feed/OPML recovery can pass `metidos.xml.parse(content, { loose: true })`, which preserves the same host-side size and tree limits. `metidos.xml.encode(value)` escapes XML text/attribute-sensitive characters; it does not build complete XML documents.

For plugin-owned model providers, Metidos normally creates the Pi registry id `plugin_id/provider_id/configuration_id`, such as `ollama/ollama/default`. The `provider` value is passed to Pi as written. An intentional exception is a plugin that refreshes a Pi built-in provider in place by reusing that built-in provider id; in that case Metidos preserves the built-in provider id instead of namespacing it.

When a plugin owns dynamic provider configurations, put the ordered auth records on each returned configuration instead of the manifest. The host derives the target Pi provider id from that configuration:

```ts
return [{
  id: "local",
  piAuth: [
    { kind: "api_key", source: "setting", value: "api_key" },
    { kind: "api_key", source: "env", value: "OLLAMA_API_KEY" }
  ],
  // ...
}];
```

`metidos.providers.addProvider({ id, timeoutMs, refreshIntervalMs?, getProviderConfigurations, execute?, embed? })` and `metidos.providers.registerProvider(...)` require `provider:register`, must run during initialization, and are limited to 10 provider families per plugin. Providers that can return embeddings should declare `metidos:provides_embeddings` and implement `embed(context, request)`; callers use `metidos.embeddings.embed(input, payload?)` and require `metidos:can_embed`.

Embedding provider callback details:

```ts
metidos.providers.addProvider({
  id: "example_embeddings",
  timeoutMs: 30000,
  async getProviderConfigurations() {
    return [
      {
        id: "default",
        label: "Example Embeddings",
        models: [
          {
            api: "embeddings",
            compat: { providesEmbeddings: true },
            id: "embed-small",
            input: ["text"],
            name: "Embed Small",
          },
        ],
      },
    ];
  },
  async embed(context, request) {
    // Use request.input, request.model.id, request.configuration, and request.options.
    return [0.1, 0.2, 0.3];
  },
});
```

`embed(context, request)` runs in a provider execution context with local-operator, project, or thread metadata when available. It must return a finite non-empty vector, either directly as `number[]` or as `{ embedding: number[] }`. Provider plugins should enforce upstream response limits, reject malformed vectors, avoid logging raw embedding input, and document any upstream privacy implications. Provider plugins normally do **not** need `metidos:can_embed` or `metidos:lancedb`; those are consumer/storage permissions.

- `getProviderConfigurations()` runs at plugin startup/load and during refresh. It receives Plugin Settings.
- A plugin may return at most 25 provider configurations total.
- Each configuration requires a stable string `id` and can include labels, base URLs, API hints, model metadata, pricing, capability flags, or other provider-specific fields.
- Optional `execute(context, request)` runs model requests through a Pi-compatible one-shot provider adapter with the callback context.
- Optional `refreshIntervalMs` enables cached background rediscovery without disrupting active selections.
- Provider model identities are stable composite keys: `plugin_id/provider_id/configuration_id/model_id`.
- Models that disappear from a refresh are removed from the catalog instead of being kept as unavailable fallback rows; refresh errors should leave the provider visible with no models or an explicit placeholder status.

Use [`ollama_model_provider`](./examples/plugins/ollama_model_provider/) as the copyable provider-registration example. For credential-only handoff to an existing Pi provider, compare first-party core plugins such as `core_plugins/codex`, `core_plugins/github_copilot`, `core_plugins/anthropic`, and `core_plugins/openai` before writing a custom provider.

## Crons and GC

`metidos.cron({ key, schedule, timeoutMs, action })` requires `cron:create`, must run during initialization, and is limited to 10 total crons per plugin.

- `key` is plugin-local and must be unique across plugin cron registrations. Metidos stores crons as `plugin_id:cron_key`.
- `schedule` must be a valid Bun cron expression.
- `timeoutMs` must be between 1,000 and 600,000 ms.
- Cron callbacks receive a cron context and no current thread/project context.
- Cron callbacks may read plugin `metidos.settings` values when declared by the manifest.
- Crons cannot use project `./` files, terminal APIs, confirmation flows, provider registration, or notification provider registration.
- Calendar/event delete fails in cron because delete confirmation is unavailable.
- Notification-sending crons are supported when `notification:send` is declared and plugin notification controls allow sending.

If your manifest declares `gc.enabled = true`, register one GC callback during initialization with `metidos.gc({ timeoutMs, action })`. The callback receives a GC context with `contextKind: "gc"` and `virtualRoot: "~/"`. GC should prune plugin-owned `~/` data and should never assume project context. Run Plugin GC appears in plugin settings only when the plugin is approved/available and GC is enabled.

## Calendar, events, and terminal APIs

Calendar APIs:

- `metidos.calendar.list(params?)` requires `calendar:list`.
- `metidos.calendar.create(params)` requires `calendar:create`.
- `metidos.calendar.modify(params)` requires `calendar:modify`.
- `metidos.calendar.delete({ id | calendarId, confirmation: true })` requires `calendar:delete` and confirmation.

Event APIs:

- `metidos.events.list({ start, end, timezone? })` requires `events:list`.
- `metidos.events.get({ id | eventId })` requires `events:get`.
- `metidos.events.create(params)` requires `events:create`.
- `metidos.events.modify(params)` requires `events:modify`.
- `metidos.events.delete({ id | eventId, confirmation: true })` requires `events:delete` and confirmation.

Terminal APIs:

- `metidos.terminal.create({ command?, dir?, title? })` requires `terminal:create` and `unsafe`.
- `metidos.terminal.read({ terminalIndex, lineCount?, lineOffset? })` requires `terminal:read`.
- `metidos.terminal.grep({ terminalIndex, pattern, ignoreCase?, maxMatches? })` requires `terminal:grep`.
- `metidos.terminal.kill({ terminalIndex })` requires `terminal:kill` and `unsafe`.
- Terminal APIs are available only from thread tool callbacks and are unavailable in cron.
- V1 intentionally has no terminal write API.

## Logging, stderr, telemetry, and diagnostics

`metidos.log(level, message)` requires `log:write`. Supported levels are `debug`, `info`, `warn`, and `error`.

- Plugin logs are disabled by default and local-operator-controlled.
- When disabled, log calls no-op after permission/context checks.
- When enabled, logs are stored under `.logs/log-YYYY-MM-DD.log` as `[level] [ISO time] : [message]`.
- Log retention defaults to 14 days and 25 MB per plugin; oldest log files are pruned first when size caps are exceeded.
- Sidecar stderr is separate from plugin logs. It is used for startup, crash, and runtime diagnostics and keeps the last 200 lines for local diagnostics.
- Crash-loop threshold is exactly 3 crashes within 60 seconds. After that, the plugin is Failed/Degraded until local-operator Retry Plugin.
- In-flight operations are not automatically retried after a crash.

Runtime isolation is deployment-controlled, not plugin-authored. Metidos defaults Plugin System v1 to a per-plugin worker-thread sidecar (`METIDOS_PLUGIN_RUNTIME_KIND=worker`). Operators who want the stronger blast-radius boundary of an OS process sidecar can start Metidos with `METIDOS_PLUGIN_RUNTIME_KIND=process`; plugin APIs and manifests are unchanged. Process mode still uses the sidecar lifecycle, diagnostics, crash-loop handling, and memory-limit command wrapper. The configured memory ceiling is a sidecar host virtual-address-space guard, so failures there should be treated differently from ordinary resident-memory pressure.

Diagnostics shown in Settings are meant to be actionable. Fix activation-blocking validation errors before approval, and include enough context in plugin-authored errors to identify the bad input without leaking secrets.

## Review hashing and lifecycle

Metidos computes a deterministic SHA-256 review hash over sorted entries of:

```text
relative/path\0sha256(file contents)
```

The hash includes manifest, `AGENTS.md`, the manifest `main` entry file, `seed/**`, local source modules, and support files. It excludes only `.data/**`, `.data-bak-*/**`, and `.logs/**`.

Lifecycle expectations:

1. Discovery validates folder structure and manifest without executing code.
2. Local-operator approval stores the current review hash and approval metadata.
3. Startup/refresh reconciles approved active plugins into sidecars only when the current hash still matches and validation passes.
4. Changing approved installation files outside excluded paths moves the plugin to Needs Review.
5. Disable marks a plugin disabled and restart-required; v1 does not hot-unregister already-loaded runtime capabilities.
6. Retry Plugin clears failed runtime state and retries startup without changing the approved hash.
7. Reset Plugin Data stops the runtime, backs up `.data` to `.data-bak-{timestamp}`, reseeds from `seed/**`, audit-logs the action, and restarts/reloads the plugin.

Plugin lifecycle step-up threat model:

- Enable, Re-approve Plugin, Retry Plugin, and Run Plugin GC require recent step-up authentication because they approve plugin code, reactivate approved plugin code, or directly invoke a plugin callback.
- Disable, Review Plugin Changes, Open `.data`, Open `.logs`, and Reset Plugin Data require a local-operator session but do not require recent step-up authentication. They either reduce runtime exposure, inspect local plugin-owned files, or perform bounded data maintenance with explicit destructive confirmation.
- Reset Plugin Data remains destructive and requires typing the plugin folder name, but it is treated as operational recovery rather than privilege elevation.

## Safe secrets handling

Treat approved plugin code as trusted local code, but keep secrets out of avoidable surfaces:

- Prefer secret env declarations or secret settings over hard-coded source constants.
- Do not put secrets in manifests, `AGENTS.md`, README files, seed files, examples, logs, thrown errors, tool results, provider output, notification payloads, URL query strings/fragments, or copied support files.
- Use private, unguessable notification topics and narrow network allowlists.
- Document what secrets are needed and where they are configured.
- Remember that v1 does not automatically redact plugin-authored text.

## Write `AGENTS.md`

Every plugin must include an `AGENTS.md`. Use [`metidos-plugin-agents-guide.md`](./metidos-plugin-agents-guide.md) as the template and customize it for your plugin.

At minimum, document:

- what the plugin does,
- which files are source and which are generated/runtime data,
- how to validate the plugin after editing,
- what `.data` contains,
- how to inspect `.data` safely,
- how to repair corrupt data,
- how Reset Plugin Data behaves,
- which secrets are required and how to avoid exposing them,
- destructive operations and required confirmations,
- expected diagnostics and how to recover from common failures.

## Validation checklist before approval or distribution

Before sharing a plugin folder or asking the local operator to approve it:

- Validate `metidos-plugin.json` against [`metidos-plugin.schema.json`](./metidos-plugin.schema.json) and backend typed validation.
- Confirm `id` matches the folder identity and `metidosApiVersion` is `v1`.
- Confirm `AGENTS.md` exists and matches current behavior.
- Confirm there is no root `node_modules/`.
- Confirm imports are local or `@metidos/plugin-api` only.
- Confirm manifest permissions are the minimal set needed by code.
- Confirm access groups list every registered tool/injection and no undeclared tool or injection is registered.
- Confirm project file patterns are narrow and never cover `.git` or `.ssh`.
- Confirm network allowlists are narrow, HTTPS-first, and do not rely on credentials in URLs; if all-domain patterns are present, confirm the plugin declares `unsafe` and treats all fetched content as untrusted.
- Confirm env/settings declarations match code and secret defaults are not used.
- Confirm provider, notification provider, cron, storage, GC, and limits declarations match code.
- Confirm example/seed data is safe to review and contains no secrets.
- Confirm `.data`, `.data-bak-*`, and `.logs` are not bundled as source.
- Confirm failures are diagnosable through Settings, stderr, plugin logs, or returned receipts without leaking host paths or secrets.

For repository-maintained examples, `bun test src/bun/plugin/examples.test.ts` validates manifests and startup registrations. For broader Metidos changes, run the repository validation flow required by `.pi/skills/commit/SKILL.md`.

## Common manifest validation errors

Use this section when Settings → Plugins reports a manifest problem or a copied example fails to activate:

| Error pattern | Likely cause | Fix |
| --- | --- | --- |
| Schema rejects an unknown property | `metidos-plugin.json` includes a field that is not part of Plugin System v1, or a field is nested under the wrong object. | Remove the field or move it to the schema-defined location. The manifest schema has `additionalProperties: false` at each level. |
| Folder identity mismatch | The install directory under `APP_DATA/plugins/` does not match the manifest `id`. | Rename the folder or the `id` so both use the same stable lowercase plugin id. |
| Reserved or invalid identity | The manifest uses `metidos`, uppercase characters, hyphens, a leading digit, or an id outside the length/pattern limits. | Use a unique id matching `^[a-z][a-z0-9_]{1,63}$`, and keep the human-readable text in `name`. |
| Missing or unsupported entry point | `main` is absent, does not start with `./`, escapes the plugin root, points into `.data`/`.logs`, or uses an unsupported runtime form. | Point `main` at a source file inside the plugin folder, typically `./index.ts` or `./main.py`. |
| Permission dependency failure | A capability is declared without its paired permission, such as `sqlite` without `storage:write`, `terminal:create` without `unsafe`, or `network:fetch` without an allowlist. | Add the required paired permission or remove the capability. Prefer removing broad permissions until code actually needs them. |
| Registration mismatch at startup | Code registers a tool, injection, provider, notification provider, cron, ingress source, or GC callback that the manifest does not declare, or vice versa. | Update the manifest and code together so every registered capability has one manifest declaration and required permission. |
| Unsafe broad network access rejected | The manifest includes all-domain patterns such as `https://**/**` or `wss://**/**` without `unsafe`, or expects localhost/private-network access in safe mode. | Narrow the allowlist, or declare `unsafe` and require the operator-controlled private-network mode only when the plugin purpose requires it. |
| Setting/env default rejected | A secret env var has a default, a URL/date/enum/list default does not match its declared kind, or code uses undeclared settings/env keys. | Remove secret defaults, correct typed defaults, and declare every key before reading it. |
| Review hash changes after approval | Source, manifest, `AGENTS.md`, seed data, or support files changed after local-operator approval. | Use Review Plugin Changes, inspect the diff/hash, and re-approve. Runtime `.data`, `.data-bak-*`, and `.logs` do not affect the review hash. |
| Root `node_modules/` blocks activation | A copied plugin includes package-manager output. | Remove root `node_modules/`; Plugin System v1 does not install or load runtime dependencies from plugin folders. |

## Non-goals to keep out of v1 plugins

Plugin System v1 intentionally does not support:

- React plugin panels, arbitrary plugin UI surfaces, or frontend component extension points.
- Plugin-defined backend RPC routes or arbitrary server extension points.
- Direct access to the Metidos application database or plugin database migrations.
- Runtime package-manager installation or reliance on plugin `node_modules/`.
- Public marketplace, remote install flow, signature distribution, or auto-update channel.
- Hot-unregistering disabled plugins from a running Metidos process.
- A guarantee that approved trusted code cannot semantically exfiltrate data it is allowed to read.

## Example reference

Manifest-only fixtures:

- Minimal tool plugin manifest: [`examples/metidos-plugin-minimal-tool.json`](./examples/metidos-plugin-minimal-tool.json)
- Provider plugin manifest: [`examples/metidos-plugin-provider.json`](./examples/metidos-plugin-provider.json)

Copyable plugin folders:

- Cron notification digest plugin: [`examples/plugins/cron_notification_digest/`](./examples/plugins/cron_notification_digest/)
- Hello-world tool plugin: [`examples/plugins/hello_tool/`](./examples/plugins/hello_tool/)
- Python hello-world tool plugin: [`examples/plugins/python_hello_tool/`](./examples/plugins/python_hello_tool/)
- Ollama model provider plugin: [`examples/plugins/ollama_model_provider/`](./examples/plugins/ollama_model_provider/)
- ntfy notification provider plugin: [`examples/plugins/ntfy_notification_provider/`](./examples/plugins/ntfy_notification_provider/)
- Fake request-ingress plugin: [`examples/plugins/fake_ingress/`](./examples/plugins/fake_ingress/)
- Vector memory plugin: [`examples/plugins/vector_memory/`](./examples/plugins/vector_memory/)
- RSS feed indexer plugin: [`examples/plugins/rss_feed_indexer/`](./examples/plugins/rss_feed_indexer/)
