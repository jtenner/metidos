# AGENTS for Tencent TokenHub

## Purpose

This first-party core plugin registers Tencent TokenHub / Hunyuan chat models with Metidos as an OpenAI-compatible model provider.

Registered capability:

- `provider:register` for the `tokenhub` model provider family.

The plugin does not call Tencent APIs directly during startup. It returns a conservative static catalog from official TokenHub/Hunyuan documentation and hands the selected fixed base URL plus API-key auth to Pi's OpenAI-compatible completions transport.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: TypeScript plugin entry point and static TokenHub catalog.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; this plugin does not intentionally create any files there.
- `.logs/`: generated plugin logs if logging is enabled; this plugin does not request `log:write` and should not write plugin logs.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root:

1. Validate the manifest against `docs/metidos-plugin.schema.json`.
2. Run `bun test src/bun/plugin/tokenhub-core-plugin.test.ts`.
3. Run the repository validation flow required by `.pi/skills/commit/SKILL.md` (`bun format`, then `bun validate` for code changes).
4. Confirm imports are local or `@metidos/plugin-api` only.

## `.data` contents

This plugin has no expected `.data` files. Provider settings and secrets are managed by Metidos Plugin Settings or declared host environment variables, not plugin-owned files.

## Safe `.data` inspection

- Prefer read-only inspection.
- If `.data` exists, it should be empty unless a future version documents files here.
- Do not copy or print unrelated secret-bearing files that might have been placed there manually.

## Safe `.data` repair

No manual `.data` repair is expected. If unknown generated files appear and the plugin is unhealthy, disable the plugin and use Metidos Reset Plugin Data rather than editing files in place.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. Because this plugin has no seed data and stores no runtime data, reset should only clear unexpected local files. Plugin Settings and host environment variables must still be configured outside `.data`.

## Secrets and logs

Secrets:

- Plugin Setting: `api_key`.
- Environment fallbacks: `TENCENT_TOKENHUB_API_KEY`, `TENCENT_MAAS_API_KEY`, `HUNYUAN_API_KEY`.

Do not paste API keys into chat, manifests, source files, tests, logs, or commit messages. This plugin does not request `log:write`, should not emit plugin-authored logs, and should never log prompts, completions, request bodies, Authorization headers, or API keys.

## Embeddings and vector search

This plugin intentionally does not provide embeddings, consume embeddings, or store LanceDB vectors. It does not request `metidos:provides_embeddings`, `metidos:can_embed`, `metidos:lancedb`, or `storage:write`.

Embedding support is deferred until Tencent official TokenHub documentation exposes a stable embedding API contract and the plugin implements and tests an `embed(context, request)` callback that returns finite numeric vectors.

## Context notes

- Provider registration is initialization-only.
- This plugin does not use project `./` files, terminal APIs, crons, notifications, plugin storage, or plugin network fetch.
- The `region` setting chooses one of four fixed official TokenHub hosts; arbitrary custom base URLs are intentionally not supported in this safe core slice.
- The static catalog is intentionally conservative. Future model additions should update `TOKENHUB_MODELS` and tests together after checking current official documentation.
