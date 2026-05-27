---
name: metidos-plugin-authoring
description: Create, adapt, validate, and safely maintain local Metidos Plugin System v1 plugins, including manifests, AGENTS.md guidance, examples, data repair, and approval-safe edits.
compatibility: Project skill for this repository. Use from the repository root when working on Plugin System v1 plugin folders.
---

# Metidos Plugin Authoring

Use this skill when a user wants to create, copy, edit, validate, repair, or document a Metidos Plugin System v1 plugin.

## Read first

Before changing plugin files, read the smallest relevant set:

1. `../../../AGENTS.md` for repository-wide rules.
2. `../../../docs/metidos-plugin-authoring-guide.md` for the current public Plugin System v1 API.
3. `../../../docs/metidos-plugin-agents-guide.md` for the required plugin `AGENTS.md` operator guidance shape.
4. `../../../docs/metidos-plugin.schema.json` before editing manifest schema examples or validating unusual manifest fields.
5. The closest copyable example under `../../../docs/examples/plugins/`.

If this skill and those docs disagree, treat the docs and implementation tests as source of truth, then update this skill in the same change.

## Safety rules

- Work only inside the current repository or the explicit plugin folder the user asked about.
- Do not ask the user to paste secrets into chat. Prefer declared secret env vars or secret settings.
- Do not add root `node_modules/`, runtime package-manager installation, `node:` imports, `bun:` imports, dynamic imports, or arbitrary bare imports. Plugin code may import only `@metidos/plugin-api` plus local relative files that stay inside the plugin folder.
- Do not broaden permissions, file allowlists, network allowlists, terminal access, or `unsafe` without calling out the review impact. All-domain network patterns such as `https://**/**` must declare `unsafe` and require explicit local-operator review.
- Do not edit an already-approved plugin's source, manifest, `AGENTS.md`, `seed/**`, or support files unless the user intends to trigger Review Plugin Changes and Re-approve Plugin.
- `.data/**`, `.data-bak-*/**`, and `.logs/**` are runtime/generated paths. Inspect them read-only first, back them up before repair, and do not bundle them as plugin source.

## Ask first

Ask only for facts needed for the next safe step:

1. Is this a new plugin, a copy of an example, or a repair to an existing plugin?
2. Plugin purpose and closest example: `hello_tool`, `python_hello_tool`, `cron_notification_digest`, `ollama_model_provider`, `vector_memory`, `rss_feed_indexer`, or `ntfy_notification_provider`?
3. Required capabilities: tools, project files, plugin storage, network fetch, settings/env, crons, notifications, providers, embedding providers, embedding consumers, LanceDB/vector storage, calendar/events, terminal, SQLite, logging?
4. Does it need plugin-owned `~/.data`; if yes, what files and what reset behavior?
5. Which secrets are needed, and should they be env vars or Plugin Settings?
6. Is the plugin already approved in a Metidos installation?

## Creation workflow

1. Choose the closest example under `docs/examples/plugins/` and copy its whole folder.
2. Rename the folder and manifest `id` together. Use lowercase `^[a-z][a-z0-9_]{1,63}$` ids, keep plugin ids unique in `APP_DATA/plugins/`, and do not use `metidos` as either the plugin id or display name.
3. Update `name`, `version`, `description`, permissions, access groups, tools, prompt injections, providers, crons, env/settings, storage, GC, network, and limits in `metidos-plugin.json`.
4. Update the manifest `main` entry file (usually `index.ts` for TypeScript or `main.py` for Python) so every registration exactly matches the manifest. No undeclared tools/injections/providers/crons. Tool and injection ids must be snake_case and must not contain `:`.
5. Update or create `AGENTS.md` from `docs/metidos-plugin-agents-guide.md`.
6. Add safe `seed/**` files only when first-activation data should be copied into `.data/**`.
7. Validate before asking for approval.
8. Tell the user that every source change after approval requires Review Plugin Changes and Re-approve Plugin.

## Manifest JSON Schema skeleton

Start minimal and add only needed capabilities:

```json
{
  "id": "example_tool",
  "name": "Example Tool",
  "version": "1.0.0",
  "metidosApiVersion": "v1",
  "main": "./index.ts",
  "description": "Adds one example tool for approved threads.",
  "permissions": ["log:write"],
  "access": [
    {
      "id": "example_tools",
      "name": "Example tools",
      "description": "Expose the example tool to selected threads.",
      "tools": [
        {
          "name": "example_tool",
          "description": "Return a bounded example result.",
          "timeoutMs": 5000
        }
      ]
    }
  ],
  "limits": {
    "maxTextResultBytes": 262144
  }
}
```

Common capability snippets:

```json
{
  "permissions": ["storage:read", "storage:write", "files:read", "files:write"],
  "files": {
    "allow": {
      "read": ["./docs/**"],
      "write": ["./docs/plugin-scratch/**"]
    },
    "deny": {
      "read": ["./docs/private/**"]
    }
  }
}
```

```json
{
  "permissions": ["network:fetch"],
  "network": {
    "allow": ["https://api.example.test/v1/**"],
    "enforceHttps": true
  }
}
```

```json
{
  "permissions": ["network:websocket"],
  "network": {
    "webSocketAllow": ["wss://stream.example.test/v1/**"],
    "enforceHttps": true
  }
}
```

```json
{
  "env": [
    {
      "key": "EXAMPLE_API_TOKEN",
      "description": "Token for Example API.",
      "required": true,
      "secret": true
    }
  ],
  "settings": {
    "global": [
      {
        "key": "endpoint",
        "label": "Endpoint",
        "kind": "url",
        "default": "https://api.example.test"
      }
    ]
  }
}
```

Embedding and vector capability snippets:

```json
{
  "permissions": ["provider:register", "network:fetch", "metidos:provides_embeddings"],
  "providers": [
    {
      "id": "example_embeddings",
      "name": "Example Embeddings",
      "description": "Provides embedding vectors for Metidos semantic search.",
      "timeoutMs": 30000
    }
  ],
  "network": {
    "allow": ["https://api.example.test/v1/embeddings"]
  }
}
```

```json
{
  "permissions": ["metidos:can_embed", "metidos:lancedb", "storage:write"],
  "storage": {
    "defaults": {
      "maxDataBytes": 104857600,
      "maxFileBytes": 10485760,
      "maxFiles": 10000
    }
  }
}
```

Use `metidos:provides_embeddings` only for provider plugins that implement an `embed(context, request)` callback and expose embedding-capable models. Use `metidos:can_embed` only for plugins that call `metidos.embeddings.embed(...)`. Use `metidos:lancedb` plus `storage:write` only when a plugin stores or queries vectors in plugin-owned `~/` data. A provider plugin usually should not request `metidos:can_embed` or `metidos:lancedb` unless it also consumes embeddings or persists vectors itself.

Prompt injection snippet:

```json
{
  "permissions": ["metidos:prompt_inject"],
  "access": [
    {
      "id": "thread_context",
      "name": "Thread context",
      "description": "Inject plugin context into selected threads.",
      "injects": [
        {
          "name": "context",
          "description": "Build context for the next thread prompt.",
          "timeoutMs": 5000
        }
      ]
    }
  ]
}
```

Check `docs/metidos-plugin.schema.json` for exact constraints before adding less common fields.

## Entrypoint skeleton

```ts
import { definePlugin } from "@metidos/plugin-api";

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "example_tool",
    name: "Example tool",
    description: "Return a bounded example result.",
    timeoutMs: 5000,
    validateProps(input) {
      const record = input && typeof input === "object" ? input : {};
      const message =
        "message" in record && typeof record.message === "string"
          ? record.message.slice(0, 200)
          : "hello";
      return { message };
    },
    async action(context, props) {
      await metidos.log("info", `example_tool ran in ${context.contextKind}`);
      return { type: "text", text: props.message };
    },
  });
});
```

Keep `validateProps` defensive, truncate untrusted strings, and avoid returning or logging secrets.

Prompt injection entrypoint pattern:

```ts
import { definePlugin } from "@metidos/plugin-api";

export default definePlugin((metidos) => {
  metidos.addInjection({
    inject: "context",
    name: "Thread context",
    timeoutMs: 5000,
    async prompt(context, prompt) {
      return `Context before: ${prompt}`;
    },
  });
});
```

`prompt` is the simple user prompt sent to the thread. Metidos prepends non-empty injection results before that user prompt when the containing plugin access group is enabled for the thread.

## Embeddings and LanceDB authoring patterns

There are two separate embedding roles:

1. **Embedding providers** register models that can produce vectors. They declare `provider:register` and `metidos:provides_embeddings`, implement `metidos.providers.addProvider({ ..., embed })`, and return finite numeric vectors from `embed(context, request)`. Provider configurations should mark embedding models with `api: "embeddings"` or `compat.providesEmbeddings: true`. Provider discovery runs during startup/refresh and receives Plugin Settings, not thread-only project file access.
2. **Embedding consumers** call `metidos.embeddings.embed(input, payload?)`. They declare `metidos:can_embed`. Consumers often also declare `metidos:lancedb` and `storage:write` when they persist vectors for semantic search or memory.

`metidos.embeddings.embed(...)` is host-routed through the user's configured runtime embedding model. Do not hard-code provider ids in consumer plugins unless the user explicitly asks for provider-specific behavior. Treat embedding inputs and payloads as potentially sensitive: do not log raw prompts, documents, API keys, headers, hidden thread state, or large file contents. Prefer compact summaries and stable ids in logs.

`metidos.lancedb.open(path)` opens plugin-owned vector storage only for `~/` paths. The common consumer shape is:

```ts
const db = await metidos.lancedb.open("~/memory/items");
const vector = await metidos.embeddings.embed(text, { purpose: "my_plugin.index" });
await db.upsert([{ id, vector, title, excerpt }]);
const queryVector = await metidos.embeddings.embed(query, { purpose: "my_plugin.query" });
const rows = await db.query(queryVector, { limit: 10 });
await db.remove(id);
```

Rows must include `vector: number[]`; `id` is optional for inserts and should be stable when you want upserts to update existing records. Keep stored props bounded and reviewable. Store derived summaries/excerpts instead of entire secret-bearing source documents when possible. Derived LanceDB data belongs under `.data/**`, can usually be regenerated, and should be documented in plugin `AGENTS.md`.

For Python plugins, the same host APIs are exposed through the generated `metidos` module. Check the Python examples and runtime docs before assuming JavaScript object methods map exactly in Python.

## Plugin AGENTS.md checklist

Every plugin root needs an `AGENTS.md` that future operators and agents can follow without guessing. Include:

- purpose and registered capabilities,
- source vs generated/runtime files,
- validation commands,
- `.data` contents and schemas,
- read-only `.data` inspection steps,
- safe repair and backup steps,
- Reset Plugin Data behavior,
- secret and log locations,
- context limitations such as thread-only `./` file access or cron restrictions,
- embedding behavior: whether the plugin provides embeddings, consumes embeddings, stores LanceDB vectors, where vector data lives, whether it can be regenerated, and what sensitive content must not be embedded or logged.

Use `docs/metidos-plugin-agents-guide.md` as the copyable template. Keep example plugin `AGENTS.md` files synchronized with their manifest and runtime behavior.

## Validation commands

From the Metidos repository root, validate a manifest against the JSON Schema with:

```bash
bun -e 'import Ajv from "ajv"; import { readFileSync } from "node:fs"; const [manifestPath = "metidos-plugin.json"] = process.argv.slice(1); const schema = JSON.parse(readFileSync("docs/metidos-plugin.schema.json", "utf8")); const manifest = JSON.parse(readFileSync(manifestPath, "utf8")); const validate = new Ajv({ allErrors: true, strict: false }).compile(schema); if (!validate(manifest)) { console.error(JSON.stringify(validate.errors, null, 2)); process.exit(1); } console.log("manifest schema ok");' path/to/metidos-plugin.json
```

For repository-maintained examples, run:

```bash
bun test src/bun/plugin/manifest.test.ts src/bun/plugin/examples.test.ts
```

If you add a new copyable example to the repository, also add it to `COPYABLE_EXAMPLES` in `src/bun/plugin/examples.test.ts` so the manifest, build, QuickJS startup registrations, and callback behavior stay covered.

For general code changes, follow `.pi/skills/commit/SKILL.md`: run `bun format` and then `bun validate`. For docs-only plugin guidance, `bun validate` may be skipped only if you explain why.

## Approval and review handoff

When handing a plugin to the local operator:

- State what the plugin does and why each permission exists, explicitly distinguishing `metidos:provides_embeddings`, `metidos:can_embed`, and `metidos:lancedb` when present.
- List file and network allowlists in plain language; call out any all-domain network patterns and why the existing `unsafe` permission is justified.
- Identify all settings/env secrets and how to configure them outside chat.
- Mention whether logs are expected and what they may contain.
- For embedding/vector plugins, mention which embedding provider settings must be configured, what text is embedded, where vector data is stored, whether it is derived/regenerable, and how Reset Plugin Data affects it.
- Tell the local operator to review the deterministic hash in Settings → Plugins before approval.
- Remind them that source changes outside `.data/**`, `.data-bak-*/**`, and `.logs/**` move the plugin to Needs Review.

## Data repair workflow

For existing plugin data issues:

1. Inspect read-only first.
2. Stop/disable the plugin before mutating `.data` unless plugin docs explicitly allow live edits.
3. Back up affected files or rely on Metidos Reset Plugin Data when a full reseed is safer.
4. Edit only documented repairable files.
5. Validate schemas and restart/retry the plugin.
6. Review plugin diagnostics, stderr, logs, receipts, or provider discovery output.

Prefer Reset Plugin Data for unknown corruption, stale generated caches, or unsafe manual repairs. Prefer narrow manual edits for small, well-documented JSON/data fixes the plugin `AGENTS.md` declares repairable.
