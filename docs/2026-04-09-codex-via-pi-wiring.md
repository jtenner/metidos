# Research: Wiring Codex Back Into Jolt Through Pi

Date: 2026-04-09  
Repository: `jt-ide`  
Primary target: enable ChatGPT-plan-backed Codex usage in Jolt without restoring a second runtime

## Goal

Reintroduce Codex usage in `jt-ide` while keeping Pi as the only agent runtime.

The concrete product goal is:

- let Jolt use ChatGPT-plan-backed Codex through Pi's built-in `openai-codex` provider
- keep the existing Pi-backed thread/session/tool architecture
- move the browser model picker to a three-level selection flow: `Provider -> Model -> Reasoning effort`
- make provider identity first-class so `openai-codex` and plain `openai` are always distinguishable in both catalog data and UI as two separate providers, each with its own model list
- avoid bringing back `@openai/codex-sdk` as a parallel runtime unless it is strictly necessary

## Bottom Line

Pi already has the main primitive Jolt needs: a built-in `openai-codex` provider with OAuth login support and a first-class model catalog.

Jolt now has the minimum backend path needed to make Codex work through Pi without restoring the Codex SDK. The repo now:

- exposes `openai-codex` in the public Pi-backed model catalog
- labels `openai` and `openai-codex` as separate providers (`OpenAI API` and `OpenAI Codex`)
- prefers `openai-codex` for overlapping raw GPT ids such as `gpt-5.4` when ChatGPT-backed Codex auth is available
- imports `~/.codex/auth.json` into Pi's `openai-codex` OAuth shape and treats the Codex file as authoritative when it exists
- exposes backend RPC procedures for Codex auth status, login start/finish, refresh, and logout
- mirrors backend-managed Codex login and refresh results back into both Jolt's Pi auth store and `~/.codex/auth.json`
- exposes a browser settings surface for Codex auth state, CLI-status diagnostics, recovery guidance, refresh, and logout
- surfaces actionable recovery guidance in the browser for keyring-only, missing-cache, broken-cache, and headless Codex setups
- detects Codex CLI credential storage mode from `config.toml` and shows whether the current machine is configured for `file`, `keyring`, or `auto` storage
- non-destructively probes `codex login status` so keyring-backed Codex CLI sessions show up as explicit ChatGPT-versus-API-key diagnostics instead of looking like a generic missing-file failure
- now makes the supported operator path explicit: users log into Codex through the Codex CLI itself, then refresh Jolt status so the selector can enable `OpenAI Codex`
- intentionally does not import or trust OS-keyring-backed Codex credentials directly, because OpenAI does not document a stable keyring schema or export contract that Jolt can safely mirror
- surfaces billing and policy-scope guidance directly in the provider/model selector when users choose between `OpenAI Codex` and `OpenAI API`
- repeats the provider billing and policy cue at the chat-send and cron-create surfaces so users see the active scope again before they trigger work
- surfaces Codex provider availability directly in the selector so unauthenticated `OpenAI Codex` choices are marked unavailable instead of looking equivalent to ready-to-run providers, and the unavailable note now explains when Codex CLI is already logged in but Jolt still cannot import that session
- rejects unavailable `openai-codex` selections before thread creation, queued runs, thread-model changes, or cron mutations so stale auth state fails fast with actionable errors
- stops the runtime from silently trying plain `openai` first when the resolved provider is `openai-codex`

The planned Codex-via-Pi wiring slices are now complete.

The main remaining operator note is:

- destructive login/logout verification against a real ChatGPT-plan session should still be done only in an isolated operator environment, not against an active everyday Codex login

## Why Jolt Should Not Restore The Codex SDK

The installed local `@openai/codex-sdk` package explicitly says the SDK wraps the `codex` CLI and communicates over JSONL stdin/stdout. That means restoring it would reintroduce a second agent runtime on top of the Pi runtime Jolt already uses.

That conflicts with the current product goal:

- one harness
- many endpoints
- one tool/session/runtime model

For Jolt, the clean path is:

- keep Pi for execution
- use Pi's `openai-codex` provider for Codex access
- copy the public Codex authentication behavior where it matters

Restoring the Codex SDK only makes sense if Jolt decides it needs exact Codex CLI semantics that Pi cannot reproduce.

## What Was Researched

### Local Jolt files

- [src/bun/pi-codex-auth.ts](../src/bun/pi-codex-auth.ts)
- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/project-procedures/provider-auth.ts](../src/bun/project-procedures/provider-auth.ts)
- [src/bun/pi-thread-runtime.ts](../src/bun/pi-thread-runtime.ts)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)
- [src/bun/db.ts](../src/bun/db.ts)
- [src/mainview/controls/codex-model-selector.tsx](../src/mainview/controls/codex-model-selector.tsx)
- [src/mainview/controls/codex-utils.ts](../src/mainview/controls/codex-utils.ts)
- [src/mainview/app/settings-panel.tsx](../src/mainview/app/settings-panel.tsx)
- [agents-todo.md](../agents-todo.md)

### Local Pi sources

- `node_modules/@mariozechner/pi-coding-agent/docs/providers.md`
- `node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`
- `node_modules/@mariozechner/pi-coding-agent/docs/custom-provider.md`
- `node_modules/@mariozechner/pi-coding-agent/examples/sdk/09-api-keys-and-oauth.ts`
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/preset.ts`
- `node_modules/@mariozechner/pi-coding-agent/CHANGELOG.md`
- `node_modules/@mariozechner/pi-ai/README.md`

### Local Codex sources

- `node_modules/@openai/codex/README.md`
- `node_modules/@openai/codex-sdk/README.md`
- `node_modules/@openai/codex-sdk/dist/index.js`

### Official OpenAI sources

- [Codex authentication](https://developers.openai.com/codex/auth)
- [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- [Billing settings in ChatGPT vs Platform](https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform)
- [Codex SDK overview](https://developers.openai.com/codex/sdk)

## Upstream Facts That Matter

## 1. Pi already has a built-in `openai-codex` provider

Pi documents `ChatGPT Plus/Pro (Codex)` as a subscription-backed provider in `providers.md`. Pi AI also exposes programmatic OAuth helpers including `loginOpenAICodex` and `getOAuthApiKey` through `@mariozechner/pi-ai/oauth`.

Important constraints:

- Pi stores provider credentials in `auth.json`
- Pi auto-refreshes OAuth credentials
- Pi's OAuth login flow is a Node/backend concern, not a browser concern
- Pi's browser notes explicitly say OAuth login flows are not supported in browser environments

This aligns with Jolt's architecture because Jolt already has a Bun backend and browser frontend.

## 2. Pi can already see current `openai-codex` models

The installed Pi version in this repo (`0.66.1`) exposes the following built-in `openai-codex` models through `ModelRegistry`:

- `gpt-5.1`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini`
- `gpt-5.2`
- `gpt-5.2-codex`
- `gpt-5.3-codex`
- `gpt-5.3-codex-spark`
- `gpt-5.4`
- `gpt-5.4-mini`

That means Jolt does not need to hand-maintain a Codex model list. It only needs to stop filtering the provider out.

## 3. Public Codex authentication behavior is documented

OpenAI's current Codex authentication docs say:

- Codex supports ChatGPT sign-in for subscription access
- Codex supports API-key sign-in for usage-based access
- Codex cloud requires ChatGPT sign-in
- Codex CLI defaults to ChatGPT authentication when no valid session is available
- cached credentials live in `~/.codex/auth.json` or an OS credential store
- Codex supports device-code authentication for headless situations
- ChatGPT-authenticated Codex usage follows ChatGPT workspace controls and retention policies, while API-key usage follows API org policies instead

This is the public behavior Jolt can reasonably mirror.

## 4. The Codex SDK does not give Jolt a separate auth model

The installed `@openai/codex-sdk` package says it wraps the `codex` CLI. Its shipped `dist/index.js` confirms that:

- it spawns the `codex` executable
- it communicates over JSONL stdin/stdout
- it injects `CODEX_API_KEY` only when the caller passes an `apiKey`

Inference from the local SDK code:

- when an SDK caller does not pass `apiKey`, authentication is delegated to the CLI's normal login state and config
- the SDK is therefore not a separate authentication platform
- restoring the SDK would reintroduce the Codex CLI runtime, not a reusable auth primitive Jolt is missing today

## 5. Pi and Codex are similar at the behavior level, not identical in storage details

Codex publicly documents:

- `~/.codex/auth.json`
- optional keyring storage
- forced login mode / forced workspace controls
- dedicated login diagnostics
- device-code fallback

Pi publicly documents:

- `auth.json` storage under the configured Pi agent directory
- OAuth login and refresh
- provider/model discovery
- backend-friendly programmatic OAuth helpers

Pi does not publicly document Codex-style keyring storage or built-in managed-login restrictions for the built-in `openai-codex` provider. Those pieces would need Jolt work if exact parity is desired.

## Current Jolt State

## 1. Jolt now exposes `openai-codex` in the model catalog and keeps it distinct from OpenAI API

[src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts) now allowlists both `openai` and `openai-codex`, assigns them separate labels, and keeps provider-qualified ids authoritative. Today that means:

- browser/model-catalog consumers can see `openai-codex:*`
- overlapping ids such as `gpt-5.4` stay distinct in catalog payloads
- raw GPT ids normalize toward `openai-codex` when plan-backed Codex auth is available and toward `openai` otherwise
- the browser selector can now walk `Provider -> Model -> Reasoning effort` instead of collapsing those choices into one flat model list

## 2. Jolt already keeps Pi auth and model files under app data

Both the model catalog and the runtime create Pi storage under the Jolt app-data directory:

- `.../pi-agent/auth.json`
- `.../pi-agent/models.json`

This is a good foundation for backend-managed provider login, status, and logout.

## 3. Jolt now mirrors Codex file auth into Pi auth and has both backend and browser provider-auth surfaces

[src/bun/pi-codex-auth.ts](../src/bun/pi-codex-auth.ts) now imports `~/.codex/auth.json` into Jolt's Pi auth store, gives that file precedence over stale Pi-managed `openai-codex` OAuth state, and can mirror backend-managed login or refresh results back into both stores. The backend also now exposes dedicated provider-auth orchestration through [src/bun/project-procedures/provider-auth.ts](../src/bun/project-procedures/provider-auth.ts), [src/bun/project-procedures.ts](../src/bun/project-procedures.ts), and [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts):

- provider-auth status/read API
- login start/finish orchestration
- refresh
- logout
- refreshed model-catalog payloads returned alongside provider-auth status so the browser can react to Codex availability changes without guessing

[src/mainview/app/settings-panel.tsx](../src/mainview/app/settings-panel.tsx) now consumes that RPC surface and provides:

- provider-status and auth-source visibility for `openai-codex`
- refresh/logout actions
- CLI-status diagnostics plus recovery guidance
- copy that distinguishes ChatGPT-plan Codex from API-billed OpenAI
- copy that explains why provider is selected before model
- recovery steps for keyring-only, broken-cache, and headless-device situations, including file-storage and `codex login` / `codex login --device-auth` guidance derived from OpenAI's Codex auth docs

What remains after the implementation work is operator guidance rather than missing product plumbing:

- explicit documentation of which parts were verified live on 2026-04-09 and which parts remain covered only by automated tests
- fuller operator notes for auth-source expectations outside the selector and settings surfaces

## 4. Jolt's runtime selection now respects Codex billing precedence for overlapping ids

[src/bun/pi-thread-runtime.ts](../src/bun/pi-thread-runtime.ts) now resolves the provider-qualified model selected by [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts) instead of trying `openai` before `openai-codex`. In practice:

- explicit `openai:*` selections stay API-backed
- explicit `openai-codex:*` selections stay Codex-backed
- raw GPT ids such as `gpt-5.4` become Codex-backed only when Codex auth is actually available
- the remaining ambiguity is UI-level, not runtime-level

## Recommended Direction

Use this implementation strategy unless product requirements change:

1. Keep Pi as the only runtime.
2. Add `openai-codex` as a first-class provider in Jolt's catalog and UI.
3. Change the model-selection contract to `Provider -> Model -> Reasoning effort`, where the reasoning-effort step appears only when the chosen model supports it.
4. Build backend-managed Pi OAuth login/logout/status around Jolt's existing Bun RPC layer.
5. Make provider choice explicit in the UI and runtime instead of silently preferring plain `openai`.
6. Treat `~/.codex/auth.json` as the preferred source of truth for `openai-codex` when it exists, and translate it into Pi's credential shape automatically when Jolt needs Pi-managed auth state.
7. Fall back to Jolt's Pi `auth.json` only when `~/.codex/auth.json` is absent or unusable for `openai-codex`.
8. Treat direct Codex OS-keyring import as unsupported until OpenAI exposes a much less brittle interface or Jolt adopts another documented, stable bridge. Use file auth and device-auth recovery instead.

This gives Jolt:

- one runtime
- one session system
- one tool system
- Codex plan usage through Pi
- no need to bring back `@openai/codex-sdk`

## Requirements For Jolt

## 1. Define the selector as `Provider -> Model -> Reasoning effort`

Required changes:

- make provider identity a first-class selector step instead of a secondary label on a flat model list
- represent `openai` and `openai-codex` as two separate providers in the first step, each with its own models listed beneath it in the second step
- ensure `openai-codex` and `openai` remain distinct even when they expose the same model ids such as `gpt-5.4`
- make model selection provider-scoped so the second step only shows models for the chosen provider
- make reasoning-effort selection conditional on the chosen model supporting it
- keep provider-qualified ids authoritative in persistence and runtime resolution even if the browser presents the flow as three separate choices

Jolt can reuse from Pi:

- provider-qualified model metadata
- per-model reasoning support flags
- built-in provider and model discovery

Jolt must implement:

- RPC data shape or client-side derivation that can drive the three-step flow
- unambiguous persistence rules so `openai:gpt-5.4` and `openai-codex:gpt-5.4` never collapse together

## 2. Expose `openai-codex` in the model catalog

Required changes:

- add `openai-codex` to the provider allowlist
- give it a human label and sensible sort order
- ensure the catalog preserves enough provider metadata for a provider-first selector instead of flattening overlapping GPT ids into an ambiguous list
- decide whether the default model should remain `openai:gpt-5.4` or become `openai-codex:gpt-5.4`
- stop normalizing raw GPT ids to plain `openai` when the user explicitly wants Codex

Jolt can reuse from Pi:

- built-in provider definition
- built-in model discovery
- built-in model metadata

Jolt must implement:

- catalog exposure
- provider/model grouping for the selector
- migration of persisted defaults if the canonical default changes

## 3. Add backend provider-auth procedures

Required backend capabilities:

- read provider auth status for `openai-codex`
- start login
- surface login instructions or auth URL to the browser
- complete login and persist credentials into the Pi `auth.json`
- logout and clear stored credentials
- return refreshed provider availability to the UI after login/logout

Jolt can reuse from Pi:

- `AuthStorage`
- `loginOpenAICodex`
- `getOAuthApiKey`
- Pi's existing `auth.json` contract

Jolt must implement:

- RPC schema
- Bun procedures
- persistence handoff into Jolt's configured Pi agent directory
- error mapping for failed login or refresh

## 4. Add browser provider-auth UI

Required browser capabilities:

- show whether `openai-codex` is configured
- start login
- show auth instructions and progress
- allow logout
- explain the difference between ChatGPT-plan Codex and API-billed OpenAI
- host the provider step of the `Provider -> Model -> Reasoning effort` flow or clearly coordinate with the surface that does

Jolt can reuse from Pi:

- nothing directly in the browser; Pi's OAuth flow is backend-side

Jolt must implement:

- settings panel UI
- a provider-auth state machine
- modal/dialog surfaces for auth prompts and success/failure states

## 5. Fix runtime provider selection and billing precedence

Required runtime changes:

- stop silently preferring plain `openai` when a thread should use `openai-codex`
- keep explicit provider-qualified ids authoritative
- make plan-backed Codex the default only when that is an intentional product choice
- avoid accidental PAYG fallback when the user expects ChatGPT-plan usage

This matters because Pi's changelog explicitly notes prior billing bugs where the wrong credential source could send plan users through PAYG instead.

Jolt can reuse from Pi:

- provider-qualified model ids
- provider-specific auth lookup

Jolt must implement:

- selection policy
- migration logic for stored defaults
- tests for `openai` versus `openai-codex` ambiguity

## 6. Decide on auth-storage parity

The recommended first implementation is:

- treat `~/.codex/auth.json` as the preferred source of truth for `openai-codex` when that file exists
- automatically translate Codex auth into Pi's `openai-codex` OAuth shape when Jolt needs Pi-managed credentials
- prefer the Codex file over any stale Jolt-managed Pi `openai-codex` entry when both exist
- fall back to Jolt's Pi agent-directory `auth.json` only when `~/.codex/auth.json` is absent, unreadable, or does not contain usable Codex credentials
- do not implement direct OS-keyring import until OpenAI exposes a documented, stable contract for it or Jolt adopts another non-brittle bridge

The practical mapping is straightforward for ChatGPT-backed Codex auth:

- Codex `tokens.access_token` -> Pi `access`
- Codex `tokens.refresh_token` -> Pi `refresh`
- Codex `tokens.account_id` -> Pi `accountId`
- JWT `exp` from `tokens.access_token` -> Pi `expires`

If deeper Codex parity is later required, Jolt would need to add by-hand work for:

- keyring-backed credential storage
- continuous sync or invalidation between `~/.codex/auth.json` and Jolt-managed Pi auth state
- managed restrictions similar to `forced_login_method` and `forced_chatgpt_workspace_id`

Current product decision:

- Jolt supports file-backed Codex auth import and backend-driven device-auth recovery
- when Codex is configured for `keyring` or `auto` without a usable `auth.json`, Jolt should diagnose that state clearly and direct the operator toward file storage or a fresh CLI-managed login flow

This is still a Pi-native implementation because Jolt is not sharing the Codex file schema directly with Pi. It is importing or mirroring Codex auth into the Pi credential shape while treating the Codex file as authoritative when present.

This first-pass parity is now implemented in [src/bun/pi-codex-auth.ts](../src/bun/pi-codex-auth.ts), and both the model catalog and the runtime use that same helper before constructing Pi `AuthStorage`.

## 7. Add diagnostics and recovery

Required operational surfaces:

- login failure logging
- visible status when `openai-codex` is unauthenticated
- clear indication when a thread is API-billed OpenAI versus ChatGPT-plan Codex
- clear indication when Jolt is using imported Codex auth from `~/.codex/auth.json` versus fallback Pi-managed auth
- recovery steps for stale credentials or revoked sessions
- clear indication in the selector when a chosen provider/model pair supports reasoning effort and when it does not

OpenAI publicly documents device-code and localhost-callback troubleshooting for Codex. Pi's public built-in `openai-codex` docs do not document that same end-user flow in the browser, so Jolt should not assume it gets full Codex CLI recovery behavior for free.

## 8. Test the full Codex path

Minimum coverage should include:

- model selector logic proves `Provider -> Model -> Reasoning effort` works as intended
- model catalog exposes `openai-codex`
- overlapping model ids remain distinct by provider
- default/normalized model selection behaves as intended
- automatic import from `~/.codex/auth.json` works when no Pi `openai-codex` auth entry exists
- `~/.codex/auth.json` wins over stale Pi `openai-codex` auth when both exist
- login status surfaces to the UI
- login/logout updates the model catalog and availability
- runtime uses the intended provider for overlapping ids like `gpt-5.4`
- reasoning-effort controls only appear for models that support them
- regression tests prove Jolt does not silently bill through plain `openai` when `openai-codex` is intended

Verification status on 2026-04-09:

- Automated coverage now explicitly covers missing Codex-file diagnostics, unusable Codex-file diagnostics, selector reasoning-step behavior, and the no-silent-fallback runtime rule when a thread explicitly selects `openai-codex`.
- Automated coverage now also proves unavailable `openai-codex` selections are rejected before thread-start requests, thread creation, queued sends, thread-model changes, and cron create/update mutations.
- Automated coverage now proves the active-model provider-scope callout resolves correctly for both `openai` and `openai-codex`, including unavailable Codex selections.
- Automated coverage now proves backend provider-auth status and settings-panel helpers distinguish Codex `keyring`, `file`, and `auto` credential-storage modes from `config.toml`.
- A non-destructive local status/catalog probe was run on 2026-04-09 with a fresh temporary `JOLT_APP_DATA_DIR`. Result: Jolt detected a real `~/.codex/auth.json`, surfaced `source: codex-file`, and promoted the default model to `openai-codex:gpt-5.4`.
- A live Pi runtime smoke was run on 2026-04-09 against `openai-codex:gpt-5.4-mini` with the prompt `Reply with exactly OK and nothing else.` Result: the runtime returned `OK`.
- A live end-to-end Jolt thread smoke was run on 2026-04-09 through `openProjectProcedure(...)`, `createThreadProcedure(...)`, and `sendThreadMessageProcedure(...)` against `openai-codex:gpt-5.4-mini`. Result: the thread settled to `idle`, persisted Pi session metadata, and stored the assistant reply `OK`.
- Destructive login/logout was not manually rerun against the operator's real Codex session. That path is covered by automated tests and should be exercised manually only against an isolated `CODEX_HOME` when release verification requires it.

## Risks

- No active product risks are tracked here for the supported path. Unsupported keyring behavior is already called out in the README/settings docs where operators need it, and provider mix-ups are user error: Skill Issue.

## Blockers

- None for the recommended Pi-native path.

## Suggested Execution Slices

### CD01 - Expose `openai-codex` in the model catalog

Status: completed on 2026-04-09.

Deliverables:

- add provider allowlist, labels, and sort order
- surface `openai-codex:*` ids in RPC payloads
- guarantee that provider-qualified ids remain distinct for overlapping GPT model ids
- decide and encode default-model behavior

Primary files:

- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)

### CD02 - Build the three-level model selector

Status: completed on 2026-04-09.

Deliverables:

- change the browser model-picker flow to `Provider -> Model -> Reasoning effort`
- make `openai` and `openai-codex` separate provider choices with separate model lists beneath them even when they expose the same model ids
- only show the reasoning-effort step when the selected model supports it
- preserve provider-qualified ids in RPC payloads and persistence while presenting a structured selection flow

Primary files:

- [src/mainview/controls/codex-model-selector.tsx](../src/mainview/controls/codex-model-selector.tsx)
- [src/mainview/controls/codex-utils.ts](../src/mainview/controls/codex-utils.ts)
- [src/mainview/controls/reasoning-effort-selector.tsx](../src/mainview/controls/reasoning-effort-selector.tsx)
- [src/mainview/app/use-mainview-derived-state.ts](../src/mainview/app/use-mainview-derived-state.ts)

### CD03 - Add backend `openai-codex` auth procedures

Status: completed on 2026-04-09.

Deliverables:

- provider-auth status/read API
- login start/finish orchestration
- logout
- automatic import/translation from `~/.codex/auth.json` when no Pi `openai-codex` auth entry exists
- deterministic precedence so `~/.codex/auth.json` overrides stale Pi `openai-codex` auth when both exist
- persistence into Jolt's Pi `auth.json` when Jolt needs Pi-managed credentials

Primary files:

- [src/bun/project-procedures/provider-auth.ts](../src/bun/project-procedures/provider-auth.ts)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/pi-codex-auth.ts](../src/bun/pi-codex-auth.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)
- [src/bun/index.ts](../src/bun/index.ts)

### CD04 - Add browser provider-auth UI

Status: completed on 2026-04-09.

Deliverables:

- settings panel surfaces for provider status
- login/logout actions
- login progress and failure states
- copy that distinguishes ChatGPT-plan Codex from API-billed OpenAI
- copy that explains why provider is selected before model

Primary files:

- [src/mainview/app/settings-panel.tsx](../src/mainview/app/settings-panel.tsx)
- [src/mainview/App.tsx](../src/mainview/App.tsx)

### CD05 - Fix runtime provider selection and billing precedence

Status: completed on 2026-04-09.

Deliverables:

- make explicit provider-qualified thread models authoritative
- stop preferring plain `openai` when `openai-codex` is intended
- add regression coverage around overlapping model ids

Primary files:

- [src/bun/pi-thread-runtime.ts](../src/bun/pi-thread-runtime.ts)
- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/db.ts](../src/bun/db.ts)

### CD06 - Implement auth-storage behavior and diagnostics

Status: partially completed on 2026-04-09.

Deliverables:

- finalize first-pass auth precedence so `~/.codex/auth.json` is authoritative for `openai-codex` when present
- implement the fallback path to Jolt's Pi agent-directory `auth.json` when the Codex file is absent or unusable
- add visible diagnostics and stale-session recovery
- document the remaining keyring gap and how Jolt behaves when no Codex file exists

Primary files:

- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/index.ts](../src/bun/index.ts)
- [src/mainview/app/settings-panel.tsx](../src/mainview/app/settings-panel.tsx)

### CD07 - Verify the full Codex path and document operator behavior

Status: completed on 2026-04-09.

Deliverables:

- focused backend and frontend tests
- manual verification notes for auth detection, thread execution, and isolated login/logout guidance
- selector verification for provider/model/reasoning behavior
- final doc updates once the path is working

### CD08 - Add keyring and headless recovery guidance

Status: completed on 2026-04-09.

Deliverables:

- surface actionable browser recovery guidance for missing `~/.codex/auth.json`, broken Codex file caches, Pi-auth fallback, and headless-device situations
- reference the official Codex guidance for `cli_auth_credentials_store = "file"` and `codex login --device-auth`
- keep the implementation UI-only so runtime/provider behavior does not change

Primary files:

- [src/mainview/app/settings-panel.tsx](../src/mainview/app/settings-panel.tsx)
- [src/mainview/app/settings-panel.test.ts](../src/mainview/app/settings-panel.test.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)

### CD09 - Expose provider billing and policy scope in the selector

Status: completed on 2026-04-09.

Deliverables:

- surface provider-scope guidance at selection time for `OpenAI Codex` versus `OpenAI API`
- make the billing/policy difference visible in both the provider list and the currently active provider step
- keep the implementation UI-only so persisted model ids and runtime routing remain unchanged

Primary files:

- [src/mainview/controls/codex-model-selector.tsx](../src/mainview/controls/codex-model-selector.tsx)
- [src/mainview/controls/codex-utils.ts](../src/mainview/controls/codex-utils.ts)
- [src/mainview/controls/codex-utils.test.ts](../src/mainview/controls/codex-utils.test.ts)

### CD10 - Surface unavailable Codex providers in the selector

Status: completed on 2026-04-09.

Deliverables:

- surface provider availability for `OpenAI Codex` in the model catalog payload
- mark unauthenticated Codex provider rows as unavailable in the selector instead of presenting them like ready-to-run choices
- block new model selection for unavailable Codex providers while keeping persisted provider-qualified ids and runtime routing unchanged

Primary files:

- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/project-procedures-config.test.ts](../src/bun/project-procedures-config.test.ts)
- [src/mainview/controls/codex-model-selector.tsx](../src/mainview/controls/codex-model-selector.tsx)
- [src/mainview/controls/codex-utils.ts](../src/mainview/controls/codex-utils.ts)

### CD11 - Reject unavailable Codex provider selections before execution

Status: completed on 2026-04-09.

Deliverables:

- reject explicit `openai-codex:*` selections before thread-start requests, thread creation, thread-model changes, and cron create/update mutations when Codex auth is unavailable
- reject queued sends for existing threads whose stored `openai-codex` model becomes unavailable after auth disappears
- fail fast before persisting a new user message or starting a run so stale auth state cannot drift into ambiguous runtime failures

Primary files:

- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/project-procedures-config.test.ts](../src/bun/project-procedures-config.test.ts)
- [src/bun/README.md](../src/bun/README.md)
- [src/bun/project-procedures/README.md](../src/bun/project-procedures/README.md)

### CD12 - Surface provider scope at the action point

Status: completed on 2026-04-09.

Deliverables:

- repeat the active provider billing/policy cue directly under the chat composer model selector so thread sends show their effective scope at the point of action
- repeat the same cue in the cron editor so scheduled work shows whether it will run under `OpenAI Codex` or `OpenAI API`
- keep the content driven by the shared provider/model metadata helper so selector, composer, and cron surfaces stay consistent

Primary files:

- [src/mainview/controls/codex-utils.ts](../src/mainview/controls/codex-utils.ts)
- [src/mainview/controls/codex-utils.test.ts](../src/mainview/controls/codex-utils.test.ts)
- [src/mainview/app/chat-workspace.tsx](../src/mainview/app/chat-workspace.tsx)
- [src/mainview/App.tsx](../src/mainview/App.tsx)

### CD13 - Detect Codex credential storage mode

Status: completed on 2026-04-09.

Deliverables:

- inspect Codex `config.toml` under `CODEX_HOME` to detect `cli_auth_credentials_store`
- surface the detected `file`, `keyring`, or `auto` mode through the backend provider-auth status contract
- show the detected storage mode and keyring-aware recovery copy in Settings so missing `auth.json` states stop looking ambiguous

Primary files:

- [src/bun/pi-codex-auth.ts](../src/bun/pi-codex-auth.ts)
- [src/bun/project-procedures/provider-auth.ts](../src/bun/project-procedures/provider-auth.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)
- [src/mainview/app/settings-panel.tsx](../src/mainview/app/settings-panel.tsx)
- [src/bun/pi-codex-auth.test.ts](../src/bun/pi-codex-auth.test.ts)
- [src/bun/project-procedures/provider-auth.test.ts](../src/bun/project-procedures/provider-auth.test.ts)
- [src/mainview/app/settings-panel.test.ts](../src/mainview/app/settings-panel.test.ts)

### CD14 - Probe Codex CLI login status for keyring-backed sessions

Status: completed on 2026-04-09.

Deliverables:

- run a non-destructive `codex login status` probe behind the shared auth bridge so Jolt can distinguish active ChatGPT-backed Codex CLI sessions, API-key-only CLI sessions, and fully signed-out states even when `~/.codex/auth.json` is absent
- surface that CLI-auth signal through the backend provider-auth status contract and the Settings UI so missing-file diagnostics stop looking like a generic failure when Codex CLI is already authenticated elsewhere
- reuse the same signal in the model catalog so unavailable `OpenAI Codex` selector rows can explain when Codex CLI is already signed in but Jolt still needs its own importable or Pi-managed credentials

Primary files:

- [src/bun/pi-codex-auth.ts](../src/bun/pi-codex-auth.ts)
- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/project-procedures/provider-auth.ts](../src/bun/project-procedures/provider-auth.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)
- [src/mainview/app/settings-panel.tsx](../src/mainview/app/settings-panel.tsx)
- [src/bun/pi-codex-auth.test.ts](../src/bun/pi-codex-auth.test.ts)
- [src/bun/project-procedures/provider-auth.test.ts](../src/bun/project-procedures/provider-auth.test.ts)
- [src/bun/project-procedures-config.test.ts](../src/bun/project-procedures-config.test.ts)
- [src/mainview/app/settings-panel.test.ts](../src/mainview/app/settings-panel.test.ts)

### CD15 - Add backend-driven device-auth login

Status: completed on 2026-04-09.

Current product note:

- the backend bridge exists, but the supported operator path now stays simpler: use Codex CLI itself (`codex login` or `codex login --device-auth`) and then refresh Jolt status

Deliverables:

- add a real backend `device` login mode for `openai-codex` instead of limiting headless support to static recovery copy
- launch `codex login --device-auth` behind the provider-auth state machine, stream the device-auth URL and one-time code into the existing login-status contract, and import the resulting Codex credential automatically when the CLI flow finishes
- expose a dedicated Settings action for device-auth login so remote or headless operators can complete the documented Codex flow without leaving Jolt's provider-auth surface

Primary files:

- [src/bun/pi-codex-auth.ts](../src/bun/pi-codex-auth.ts)
- [src/bun/project-procedures/provider-auth.ts](../src/bun/project-procedures/provider-auth.ts)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)
- [src/mainview/app/settings-panel.tsx](../src/mainview/app/settings-panel.tsx)
- [src/bun/pi-codex-auth.test.ts](../src/bun/pi-codex-auth.test.ts)
- [src/bun/project-procedures/provider-auth.test.ts](../src/bun/project-procedures/provider-auth.test.ts)
- [src/mainview/app/settings-panel.test.ts](../src/mainview/app/settings-panel.test.ts)

## Recommendation

Do not reintroduce `@openai/codex-sdk` as a live runtime dependency.

Instead:

- restore Codex usage through Pi's `openai-codex` provider
- model the user-facing auth experience on Codex's documented ChatGPT/API-key behavior
- keep the implementation Jolt-native and Pi-native

That preserves the original reason for moving to Pi at all: one consistent agent runtime across providers.
