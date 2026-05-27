# AGENTS for Replicate

## Purpose

This first-party core plugin registers Replicate as a Metidos model provider. It discovers prompt-based text-generation models from Replicate's fixed `https://api.replicate.com/v1/models` catalog and executes selected models with Replicate's model-scoped Predictions API at `https://api.replicate.com/v1/models/{owner}/{model}/predictions`.

Registered capabilities:

- `provider:register` for the `replicate` model provider family.
- `network:fetch` for the fixed Replicate catalog and prediction endpoints declared in `metidos-plugin.json`.
- `log:write` for bounded discovery warnings only.

The plugin does not request `unsafe`, project file access, terminal access, cron access, notification access, or storage access.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point, Replicate catalog normalizers, prompt serialization, and prediction execution.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos if the host creates it; this plugin does not intentionally write data.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden. Plugin code may import only `@metidos/plugin-api` and local files within this plugin folder.

## Validation

From the repository root:

1. Validate the manifest against `docs/metidos-plugin.schema.json`.
2. Run the targeted regression test: `bun test src/bun/plugin/replicate-core-plugin.test.ts`.
3. Run repository validation for committed code changes: `bun format` and `bun validate`.
4. Confirm no root `node_modules/` exists and imports remain limited to `@metidos/plugin-api` or local files.

## `.data` contents

This plugin does not intentionally write plugin-owned `.data` files. Any `.data` directory is host-generated runtime scaffolding and can be regenerated.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files if a future version adds local state.
- Do not edit `.data` while the plugin sidecar is running unless future docs explicitly allow it.

## Safe `.data` repair

No manual `.data` repair is currently supported or needed. If generated runtime data appears corrupt, disable the plugin and use Metidos Reset Plugin Data instead of hand-editing unknown files.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. Because this plugin has no seed files and no durable plugin-owned state, reset only clears generated runtime scaffolding. Replicate credentials configured through Plugin Settings or environment variables remain outside `.data`.

## Secrets and logs

Secrets:

- `api_key` Plugin Setting.
- `REPLICATE_API_TOKEN` environment variable.

The plugin sends the token only as an `Authorization: Bearer ...` header to `api.replicate.com`. Do not log, paste, commit, or include Replicate tokens in manifests, docs, tests, prompts, prediction input, thrown errors, or tool outputs.

Logs are optional and local-operator-controlled. This plugin only attempts to log bounded discovery warnings. It must not log prompts, completions, request bodies, response bodies, `Authorization` headers, API tokens, or model outputs.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, store LanceDB vectors, or request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`.

Replicate can host embedding models, but Replicate's catalog and Predictions API do not provide one stable OpenAI-compatible embeddings endpoint or one uniform finite-vector response contract for this safe core slice. Add embedding support only with a dedicated `embed(context, request)` callback, finite-vector tests, and updated manifest permissions.

## Context notes

- Provider registration happens during plugin initialization.
- Model discovery runs at startup/refresh and requires either the `api_key` Plugin Setting or `REPLICATE_API_TOKEN`.
- Prediction execution serializes the current Pi model context into a bounded text prompt and sends it to Replicate. Raw prompt text leaves the local machine for Replicate when a Replicate model is selected.
- The plugin filters discovery to models whose OpenAPI schema exposes a prompt-like text input and text-like output. Replicate model schemas vary; keep normalizers defensive and representative rather than overfitted.
- Replicate's Predictions API is not OpenAI-compatible. This plugin uses a custom provider execution callback instead of Pi's OpenAI-compatible transport.
- The network allowlist is intentionally limited to `https://api.replicate.com/v1/models` and `https://api.replicate.com/v1/models/**/predictions`; do not broaden it to arbitrary model URLs or user-provided base URLs without explicit review.
