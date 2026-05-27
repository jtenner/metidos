# Codex via Pi Wiring

## Summary

This page captures the durable design and implementation outcome for restoring Codex usage in Metidos without reintroducing a second runtime. The repository standard is to keep Pi as the only agent runtime and expose ChatGPT-plan-backed Codex through Pi's built-in `openai-codex` provider.

Current result:

- Metidos treats `openai` and `openai-codex` as separate providers in the model catalog and UI.
- Provider-qualified model ids are authoritative in persistence and runtime routing.
- Metidos imports file-backed Codex credentials through the first-party `core_plugins/codex` plugin and its `codex_auth` `piAuth` binding.
- Runtime selection no longer silently falls back from explicit `openai-codex` choices to plain `openai`.
- The supported operator path is to run `codex login`, then let the Codex core plugin import `.data/auth.json` when present or fall back to `$CODEX_HOME/auth.json` / `~/.codex/auth.json`.

Related pages:

- [thread-tool-access-controls](./thread-tool-access-controls.md)

## Problem

Metidos wanted to restore Codex access after moving to Pi, but without bringing back `@openai/codex-sdk` as a second execution harness. The design problem was to preserve one runtime, one session/tool model, and one provider-aware selector while still supporting ChatGPT-plan-backed Codex access and clear operator diagnostics.

## Current state

### Runtime and provider model

Observed in the 2026-04-09 implementation snapshot:

- Pi remains the only runtime used by Metidos.
- Pi's built-in `openai-codex` provider is exposed through the Metidos model catalog.
- `openai` and `openai-codex` are labeled separately in the catalog and UI (`OpenAI API` vs `OpenAI Codex`).
- Provider-qualified ids such as `openai:gpt-5.4` and `openai-codex:gpt-5.4` stay distinct even when raw model ids overlap.
- Runtime resolution in `src/bun/pi/thread-runtime.ts` respects the chosen provider-qualified id instead of trying plain `openai` first.

### Selector and UX contract

Observed behavior:

- The selector flow is `Provider -> Model -> Reasoning effort`.
- Reasoning effort is shown only when the chosen model supports it.
- Provider-scope guidance is repeated at action points such as send and cron creation so users can see whether execution uses `OpenAI Codex` or `OpenAI API`.
- Unavailable `openai-codex` selections are surfaced as unavailable and rejected before thread creation, queued sends, thread-model mutations, or cron mutations.

### Auth and credential handling

Observed behavior:

- `core_plugins/codex/metidos-plugin.json` declares `storage:read`, the default `.data/auth.json` path, an optional `CODEX_AUTH_JSON_PATH` fallback, and `piAuth` bindings of kind `codex_auth` for Pi provider `openai-codex`.
- `src/bun/pi/builtin-provider-settings.ts` reads the configured auth JSON path, resolves safe `.data/...` paths inside the Codex plugin data directory, falls back to the standard Codex CLI file when the default plugin-owned file is absent, extracts `tokens.access_token` and `tokens.refresh_token`, and writes the resulting OAuth shape into Pi auth storage.
- Relative `.data/...` paths are plugin-owned runtime data under `<app-data>/plugins/codex/.data/`; they are not source files and must not be committed.
- If only an access token is present, Metidos stores it as a runtime API key for `openai-codex`; when both access and refresh tokens are present, it stores OAuth auth with expiry and account id when those can be decoded.

### Unsupported or intentionally limited behavior

Observed product boundary:

- Metidos does not run Codex login/logout flows itself.
- Metidos does not directly import OS-keyring-backed Codex credentials.
- Operators should supply file-backed Codex auth through the Codex CLI login file, the Codex plugin `.data/auth.json`, the plugin `auth_json_path` setting, or `CODEX_AUTH_JSON_PATH`.
- Destructive login/logout verification against a real ChatGPT-plan session remains an operator-managed activity outside the runtime.

## Why Metidos should not restore the Codex SDK

Inferred from the local research source and installed package behavior:

- `@openai/codex-sdk` wraps the `codex` CLI over JSONL stdin/stdout.
- When no API key is passed, authentication is delegated to the CLI's own login state.
- Reintroducing the SDK would therefore reintroduce the Codex CLI as a second runtime rather than supplying a missing reusable auth primitive.

Recommendation retained from the research:

- Keep Pi as the sole runtime.
- Use Pi's built-in `openai-codex` provider for Codex access.
- Mirror documented Codex auth behavior only where Metidos needs provider-aware UX and backend orchestration.

## Durable design rules

### Provider identity is first-class

Recommended and now implemented:

- Provider identity must be selected explicitly before model choice.
- Provider-qualified ids remain authoritative in storage, RPC payloads, and runtime routing.
- Overlapping raw ids must never collapse `openai` and `openai-codex` into one ambiguous choice.

### Codex auth precedence

Observed implementation rule:

1. Prefer the first usable `codex_auth` binding for provider `openai-codex`.
2. Resolve the Codex plugin `auth_json_path` setting first when that binding is selected; the default value is `.data/auth.json`.
3. When the default plugin data file is absent, fall back to `$CODEX_HOME/auth.json` and then `~/.codex/auth.json`.
4. Fall back to `CODEX_AUTH_JSON_PATH` when the plugin env binding supplies it and no earlier binding configured the provider.
5. Translate usable file-backed auth into Pi's `openai-codex` OAuth shape when refresh credentials are available, otherwise into a runtime API key.
6. Treat direct OS-keyring import as unsupported until OpenAI exposes a stable documented contract.

### Fail fast on unavailable Codex

Observed implementation rule:

- Explicit `openai-codex:*` selections must be rejected before execution if auth is unavailable.
- Metidos must not silently reroute those requests through `openai`.
- Selector and settings surfaces should explain unavailable, keyring-only, or stale-auth states with actionable recovery guidance.

## Key implementation areas

The current repository areas are:

- `src/bun/project-procedures/model-catalog.ts`
- `src/bun/pi/builtin-provider-settings.ts`
- `src/bun/pi/thread-runtime.ts`
- `src/bun/plugin/manifest.ts`
- `src/bun/plugin/sidecar-manager.ts`
- `core_plugins/codex/metidos-plugin.json`
- `src/bun/project-procedures.ts`
- `src/bun/rpc-schema.ts`
- `src/mainview/controls/codex-model-selector.tsx`
- `src/mainview/controls/codex-utils.ts`
- `src/mainview/app/settings-panel.tsx`
- `src/mainview/app/chat-workspace.tsx`
- `src/mainview/App.tsx`

## Validation status

Observed from the current tests and the original source document:

- Automated coverage exists for plugin-owned Codex auth import into Pi `openai-codex` auth storage, selector reasoning-step behavior, provider-scope callouts, unavailable-provider rejection, and the no-silent-fallback runtime rule.
- Manifest validation requires `codex_auth` bindings to hold `storage:read`.
- A live Pi runtime smoke succeeded with `openai-codex:gpt-5.4-mini` and the prompt `Reply with exactly OK and nothing else.`
- A live end-to-end Metidos thread smoke also succeeded using `openai-codex:gpt-5.4-mini`.
- Destructive login/logout verification remains outside Metidos because the current app does not own Codex CLI login flows.

## Open questions

Open questions preserved from the source:

- Whether any future requirement would justify exact Codex CLI semantic parity beyond the current Pi-native bridge.
- Whether OpenAI will eventually expose a stable enough keyring contract to support non-brittle import.
- Whether the canonical default should remain API-backed or favor Codex-backed models as operator availability changes.

## Source

Ingested from `docs/2026-04-09-codex-via-pi-wiring.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
