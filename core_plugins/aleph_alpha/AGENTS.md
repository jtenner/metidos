# AGENTS for Aleph Alpha

## Purpose

This first-party core plugin registers Aleph Alpha Pharia chat models as a Metidos model provider. It uses the hosted Aleph Alpha API at `https://api.aleph-alpha.com/v1`, discovers chat-capable models from `/model-settings`, and hands the configured API key to Pi for OpenAI-compatible chat-completions requests.

Registered capabilities:

- `provider:register` for the `aleph_alpha` model provider.
- `network:fetch` only for `https://api.aleph-alpha.com/v1/model-settings` discovery.
- `log:write` for bounded discovery diagnostics.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point and model-setting normalizers.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden. Plugin code may import only `@metidos/plugin-api` and local relative files inside this plugin folder.

## Validation

From the repository root:

1. Validate the manifest against `docs/metidos-plugin.schema.json`.
2. Run `bun test src/bun/plugin/aleph-alpha-core-plugin.test.ts`.
3. Run the repository validation flow when committing: `bun format` and `bun validate`.
4. Confirm no root `node_modules/` exists and all imports stay within the allowed plugin import policy.

## `.data` contents

This plugin does not intentionally create durable `.data` files. Discovery results are returned to the host provider registry and can be refreshed from Aleph Alpha. Any future cache must be documented here with schema, size, and regeneration behavior.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files unless required for repair.
- Do not edit `.data` while the plugin sidecar is running unless this guide is updated to explicitly allow it.

## Safe `.data` repair

Because this plugin owns no intentional durable `.data`, prefer Metidos Reset Plugin Data for unknown corruption. If future files are added:

1. Stop or disable the plugin before mutating files.
2. Back up the affected file or use Reset Plugin Data.
3. Edit only files documented as repairable in this guide.
4. Run validation and retry the plugin from Metidos settings.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, copies any `seed/**` files, and restarts/reloads the plugin. This plugin has no seed files and no local data to recreate; API key settings/env configuration remain outside `.data`.

## Secrets and logs

Secrets:

- `api_key` Plugin Setting.
- `ALEPH_ALPHA_API_KEY` environment variable fallback.

Do not log API keys, Authorization headers, prompts, completions, request bodies, or model outputs. The plugin logs only bounded discovery failure messages. Plugin System v1 does not promise automatic redaction of plugin-authored logs.

## Embeddings and vector search

This plugin does not currently provide embeddings, consume embeddings, or store LanceDB vectors.

Aleph Alpha's current Pharia Inference OpenAPI includes `/embeddings`, `/semantic_embed`, `/batch_semantic_embed`, `/instructable_embed`, and `/embed` endpoints. This safe core slice does not request `metidos:provides_embeddings` because the plugin does not yet implement and test an embedding callback that returns finite numeric vectors from the appropriate upstream endpoint. Add `metidos:provides_embeddings` only in the same change that implements and tests `embed(context, request)`.

## Context notes

- Provider registration is initialization-only.
- Model discovery requires an `api_key` Plugin Setting or `ALEPH_ALPHA_API_KEY`; without a key the provider remains registered but returns an empty dynamic catalog until discovery succeeds.
- Network access is limited to the fixed HTTPS model-settings discovery URL. Pi owns chat-completions inference using the registered base URL and API-key handoff.
- The plugin does not request `unsafe`, project file access, terminal access, `metidos:can_embed`, or `metidos:lancedb`.
