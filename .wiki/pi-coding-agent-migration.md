# Pi Coding Agent Migration

## Summary

This page preserves the durable design and outcome of Metidos's migration from `@openai/codex-sdk` to Pi as the sole agent runtime. The core decision was to keep Metidos's Bun backend, SQLite app model, browser UI, cron system, and security model, while replacing the Codex runtime layer with Pi and porting product-specific integrations into Pi-native tools.

Observed outcome from the 2026-04-09 source document:

- Pi became the repository's primary agent harness because it natively provides provider/model abstraction, auth storage, session persistence, event streaming, built-in coding tools, and extension hooks.
- The migration was treated as a runtime replatforming, not a one-line SDK swap.
- Metidos kept ownership of projects, worktrees, threads, cron orchestration, local auth, security auditing, and the browser UI.
- Codex-era product behaviors that Pi does not provide in core — especially GitHub tools, Metidos app tools, planning/delegation, transcript adaptation, and safe-vs-unsafe policy — were explicitly rebuilt as Pi-era integrations.
- The final migration outcome removed live `@openai/codex-sdk` and MCP-sidecar runtime dependencies from the product.

Related pages:

- [codex-via-pi-wiring](./codex-via-pi-wiring.md)
- [thread-tool-access-controls](./thread-tool-access-controls.md)

## Problem

Metidos wanted one embeddable agent runtime that could support multiple providers and consistent session/tool behavior without giving up the existing product shell:

- Bun backend and RPC layer
- React/Tailwind mainview
- project/worktree/thread domain model
- per-thread access controls
- cron jobs
- local auth and security auditing

The prior runtime path was heavily shaped around Codex-specific event kinds, tool surfaces, and sandbox semantics. The design question was therefore not whether Pi could mimic Codex exactly, but whether Metidos could keep its product shell while replacing the underlying harness.

## Durable architecture decision

Recommended in the source and later observed in implementation:

1. Keep Metidos as the application shell.
2. Use Pi as the only live agent runtime.
3. Let Pi own provider/model/auth/session/tool/extension concerns.
4. Keep Metidos responsible for projects, worktrees, threads, cron, local auth, security policy, and browser UX.
5. Port Metidos-specific and product-specific integrations into Pi-native custom tools or backend-owned tool packs instead of preserving a self-hosted MCP bridge.

This is the durable boundary that future agent-runtime changes should preserve.

## Why Pi was chosen

Observed strengths called out by the source:

### Provider and model abstraction

Pi already supplied the hard part Metidos did not want to own from scratch:

- multi-provider model registry
- API-key and OAuth-backed auth storage
- custom-provider registration
- provider-qualified model identity
- session persistence and resume
- event streaming
- built-in coding tools
- compaction and context accounting
- extensions, skills, and prompt-template support

Inference: these capabilities made Pi a strong fit for Metidos's long-term "many endpoints, one interface" goal.

### Embeddable runtime

The source identified Pi as an embeddable SDK/runtime rather than only a terminal app. That meant Metidos could keep its own frontend and RPC transport while using Pi behind the backend.

Observed migration direction from the source:

- direct Bun SDK embedding was the preferred primary path
- a Node subprocess RPC fallback remained the contingency plan if provider-specific Bun incompatibilities appeared

## Important mismatches that shaped the migration

The source preserved several durable non-goals and gaps in Pi core that matter for Metidos:

### Pi is not a drop-in Codex replacement

Observed conclusion from the source:

- Pi had no built-in MCP model equivalent that Metidos should depend on.
- Pi had no built-in GitHub connector comparable to Codex app tools.
- Pi had no built-in Codex-style multi-agent lifecycle.
- Pi had no built-in plan mode in core.
- Pi had no built-in Codex sandbox abstraction.
- Metidos already depended on Codex-shaped transcript items such as `reasoning`, `file_change`, `web_search`, and `mcp_tool_call`.

Durable lesson: future runtime migrations should expect product-specific adaptation work, not just API substitution.

### Safe-vs-unsafe semantics required a Metidos-owned policy

The source treated this as the biggest behavioral gap. Pi's default tools operate on the host environment, so `unsafeMode` could not keep its old Codex meaning automatically.

Durable rule preserved by the migration:

- safety semantics must be explicitly implemented by Metidos as a tool-policy decision
- safe mode must not be described as a true sandbox unless the runtime actually provides one

Related durable boundary: [thread-tool-access-controls](./thread-tool-access-controls.md).

## Migration shape that proved durable

### Threads stay app-level, Pi sessions stay runtime-level

Observed design:

- Metidos threads remain the user-facing application entity.
- Pi sessions are stored and resumed behind those threads.
- The app persists references such as `piSessionId`, `piSessionFile`, and `piLeafEntryId` rather than trying to replace Pi's session system with a custom store on day one.

Durable benefit:

- Metidos keeps its stable thread model.
- Pi keeps responsibility for session files, branching metadata, and compaction state.

### Event and transcript adaptation stay in Metidos

Observed migration rule:

- Pi events are projected into Metidos-friendly message/activity rows.
- Transcript parity is maintained where it is cheap and valuable, especially for `chat`, `reasoning`, `command`, `tool_call`, and successful `file_change` rows.
- Exact Codex item parity is not the long-term goal.

Durable implication: the browser transcript contract is an app concern, not a raw runtime concern.

### Product-specific tools became Pi-native tool packs

Observed direction from the source and later implementation status:

- Metidos app tools moved from the old MCP bridge into Pi-native custom tools.
- GitHub access became a Pi-era GitHub tool pack rather than a Codex connector inheritance path.
- `agentsAccess` became a bounded Pi-era coordination pack rather than a promise of Codex-equivalent async agent lifecycle.

Durable rule: thread access flags should map to explicit Pi-era tool families, not legacy Codex assumptions.

## Durable workstreams and outcomes

The source document recorded the migration in workstream slices. The durable outcomes are:

### Runtime integration

Observed outcome:

- Metidos now creates and resumes Pi sessions behind its existing thread lifecycle.
- Direct Bun embedding was validated and selected as the primary path, with a Node RPC fallback retained only as contingency.
- Stop/abort behavior, streamed text, and resumed sessions became Pi-backed.

### Model and provider catalog

Observed outcome:

- provider-qualified model ids became authoritative
- model metadata now comes from Pi's model registry rather than local hardcoded tables
- frontend selector language shifted toward provider-aware model identity and thinking support

Related page: [codex-via-pi-wiring](./codex-via-pi-wiring.md).

### Persistence and telemetry

Observed outcome:

- thread rows now store Pi session references
- live context usage and compaction telemetry come from Pi session state rather than Codex JSONL scraping
- older Codex-derived compatibility fields were progressively retired from the live contract

### Metidos-native tools

Observed outcome:

- Metidos thread, cron, calendar, notification, and terminal helpers were rebuilt as Pi-native tools
- `metidosAccess` became the Pi-era compatibility umbrella that now defaults into the split `threadsAccess` and `cronsAccess` flags
- the old self-hosted MCP dependency became removable after the Pi tool pack stabilized

### GitHub tools

Observed outcome:

- GitHub functionality was reintroduced as a repository-scoped Pi-native tool pack backed by `gh`
- this preserved thread-level `githubAccess` meaning without restoring Codex app-tool dependence

### Agents and plan tools

Observed outcome:

- `agentsAccess` became a bounded plan/delegation surface
- the shipped behavior focused on explicit plan updates and one-shot delegated helper execution
- exact Codex-style persistent child-agent lifecycle was intentionally left out of scope

### Safety policy

Observed outcome:

- `unsafeMode=false` no longer implies Codex-style sandboxing
- safe threads still allow worktree-scoped file/search tools
- `bash` and unsafe child-thread/cron creation are gated behind `unsafeMode=true`
- UI copy and persisted audit language were updated to describe Pi-era behavior honestly

### Final cleanup

Observed final-state claim preserved from the source:

- live `@openai/codex-sdk` and `@modelcontextprotocol/sdk` dependencies were removed from the product runtime path
- the Codex sidecar bridge was deleted
- the live thread contract stopped depending on `codexThreadId`

## Durable design rules for future work

### 1. Keep runtime and product boundaries explicit

Recommended by the source and validated by the migration:

- Pi owns agent-runtime concerns.
- Metidos owns product concerns.
- Do not blur those boundaries by teaching the runtime about app state that belongs in the Metidos domain model.

### 2. Treat access toggles as runtime tool-family switches

Recommended durable invariant:

- `GitHub`, `Agents`, and `Metidos` each control a clear tool family.
- `Unsafe` controls safety policy, not generic feature visibility.
- Runtime wiring, UI copy, and tests must be updated together.

Related page: [thread-tool-access-controls](./thread-tool-access-controls.md).

### 3. Keep provider identity first-class

Observed durable migration rule:

- provider-qualified model ids are authoritative in persistence and runtime routing
- overlapping raw model ids must not collapse distinct providers into one ambiguous choice

Related page: [codex-via-pi-wiring](./codex-via-pi-wiring.md).

### 4. Prefer Pi-native tools over extra bridges

Durable recommendation preserved from the source:

- if Metidos needs app-specific capabilities, implement them as Pi-native tools or closely integrated backend-owned tool packs
- avoid reintroducing another protocol bridge merely to let Metidos talk to itself

### 5. Keep transcript adaptation incremental and intentional

Durable lesson:

- preserve transcript categories that matter to the UI and operator workflow
- do not force a one-to-one recreation of every historical Codex event type when Pi exposes different primitives

## Open questions preserved from the source

These questions remain useful as durable framing, even though much of the migration is now implemented:

- Whether Metidos should ever expose more of Pi's native session tree or branching model in the browser UI.
- Whether the current bounded delegation model is enough, or whether richer agent orchestration will later be worth the complexity.
- Whether safe mode should eventually move from host-process tool policy to stronger isolation infrastructure.
- Whether remaining internal `codex-*` filenames and compatibility naming should be cleaned up further when they no longer serve migration clarity.

## Source

Ingested from `docs/2026-04-09-pi-coding-agent-migration-research.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
