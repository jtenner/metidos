# AGENTS for DGX Cloud Lepton

## Purpose

This first-party core plugin registers a configured DGX Cloud Lepton OpenAI-compatible endpoint as a Metidos model provider. It registers one provider family, `lepton`, and hands chat-completions requests to Pi's OpenAI-compatible transport using a Lepton endpoint base URL, optional bearer token, and configured model IDs.

The plugin does not perform plugin-owned network discovery. Lepton endpoint URLs are deployment-specific, so the plugin avoids `network:fetch` and exposes only model IDs explicitly configured by the local operator.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point, settings/env normalization, provider registration, and model metadata shaping.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos; this plugin does not intentionally create any `.data` files.
- `.logs/`: generated plugin logs when enabled; this plugin does not intentionally write logs.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

From the repository root after editing this plugin:

1. Validate the manifest through the repository plugin tests or schema path.
2. Run `bun test src/bun/plugin/lepton-core-plugin.test.ts`.
3. Run `bun format` before repository-wide validation.
4. Run `bun validate` before committing code changes.
5. Confirm no root `node_modules/` exists and imports are limited to `@metidos/plugin-api` plus local files inside this plugin folder.

## `.data` contents

This plugin does not intentionally write plugin-owned data. If `.data/` exists, it should be empty unless future revisions document generated state here.

## Safe `.data` inspection

- Prefer read-only inspection, such as listing `.data/` from Metidos plugin settings.
- Do not copy or print secret-bearing files if future revisions add any.
- Do not edit `.data` while the plugin sidecar is running unless a future guide explicitly allows it.

## Safe `.data` repair

There are no repairable `.data` files for this plugin. If generated data appears corrupt or unexpected, disable the plugin and use Metidos Reset Plugin Data instead of manual edits.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. Because this plugin has no seed data and no expected generated data, reset should not affect the configured Plugin Settings or required environment variables.

## Secrets and logs

Secrets are supplied through the `api_key` Plugin Setting, `LEPTON_API_KEY`, or `LEPTON_API_TOKEN`. Do not paste or commit those values. The plugin passes configured credentials to Pi auth handoff and does not intentionally log secrets, prompts, completions, request bodies, Authorization headers, API keys, or model responses.

## Embeddings and vector search

This plugin intentionally does not provide embeddings, consume embeddings, or store LanceDB vectors. It does not request `metidos:provides_embeddings`, `metidos:can_embed`, or `metidos:lancedb`. Although Lepton endpoints can run model servers that may expose embedding routes, this plugin does not implement an `embed(context, request)` callback and must not advertise embedding models until finite-vector embedding tests are added.

## Context notes

Provider registration is initialization-only. The plugin reads Plugin Settings and declared environment variables during provider refresh. Because the plugin does not request `network:fetch`, it does not call the endpoint `/models` route itself; operators should copy model IDs from the Lepton endpoint API tab, `/models` response, or deployed model configuration into `model_ids` or `LEPTON_MODEL_IDS`.

The plugin restricts `base_url` to HTTPS Lepton-owned endpoint domains and the `/api/v1` or `/v1` OpenAI-compatible base paths. Custom domains and arbitrary OpenAI-compatible endpoint URLs are deferred to a dedicated reviewed generic provider.
