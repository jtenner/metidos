# Thread Tool Access Controls

Superseded note

This 2026-04-07 write-up documents the original access-control fix when Metidos still ran through the Codex client and MCP sidecar. After the Pi migration cleanup in RM15, the live equivalents are the Pi-native tool packs in `src/bun/pi-metidos-tools.ts`, `src/bun/pi-github-tools.ts`, and `src/bun/pi-agents-tools.ts`.

Summary

Thread-level tool access drifted out of sync with the actual tool surface exposed to Codex. A thread could show only `Metidos` and `Unsafe` as enabled in the UI while still reporting access to planning/sub-agent tools, GitHub connector tools, and only a partial subset of Metidos tools. The fix on 2026-04-07 aligned the runtime with the thread toggles by explicitly configuring the Codex client per thread, moving Metidos-sidecar thread tools behind the `Metidos` toggle, and tightening test coverage around the generated config.

## Problem

Observed repro:

1. Create a new thread.
2. Verify access so only `Metidos` and `Unsafe` are checked.
3. Ask the thread which tools it can access.

Observed result before the fix:

- planning and collaboration tools still appeared
- GitHub connector tools still appeared
- some Metidos tools were missing even though `Metidos` was enabled

Expected result:

- `Agents` controls planning and sub-agent tools
- `GitHub` controls GitHub connector tools
- `Metidos` controls all Metidos MCP tools
- `Unsafe` controls sandbox mode only, not tool family visibility

## Root Causes

### 1. Thread flags were not fully projected into the Codex client config

`src/bun/project-procedures.ts` created a Codex client that only conditionally added the local Metidos MCP server. It did not also apply thread-scoped config for built-in tool families such as:

- GitHub app tools
- planning and collaboration features

That meant a thread could disable `GitHub` or `Agents` in Metidos while the underlying Codex runtime still exposed those tool families.

### 2. Metidos tools were split across two toggles

The old sidecar path registered these tools behind `agentsAccess` instead of `metidosAccess`:

- `update_thread`
- `list_threads`
- `new_thread`

At the same time, other Metidos tools were already behind `metidosAccess`:

- `run_untrusted_js`
- `set_context`
- `list_crons`
- `new_cron`
- `update_cron`

That split produced the partial-Metidos behavior: enabling `Metidos` alone did not expose the full Metidos tool set.

### 3. UI copy no longer matched runtime behavior

The access control menu described:

- `Agents`: "Allow thread and agent tools."
- `Metidos`: "Allow Metidos MCP tools such as cron helpers."

That wording matched neither the actual built-in tool family boundaries nor the intended ownership of Metidos thread-management tools.

## Desired Access Model

The intended steady-state behavior is:

| Toggle | What it controls |
| --- | --- |
| `GitHub` | `mcp__codex_apps__github_*` tools |
| `Agents` | planning/sub-agent tooling such as `update_plan`, `request_user_input`, `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, and `close_agent` |
| `Metidos` | all `mcp__metidos__*` tools exposed by the sidecar, including thread, workspace, cron, and JS sandbox helpers |
| `Unsafe` | sandbox/network mode for the thread, not app/tool family visibility |

## Fix Implemented On 2026-04-07

### 1. Build explicit Codex config from thread access flags

`src/bun/project-procedures.ts` now builds the Codex config from thread state instead of only deciding whether to attach the Metidos sidecar at all.

The generated config now:

- sets `apps.github.enabled` from `thread.githubAccess`
- sets multi-agent and request-user-input related features from `thread.agentsAccess`
- only injects the Metidos MCP server when `thread.metidosAccess` is true
- adds thread-scoped developer instructions so tool-listing behavior stays aligned with the active thread access controls
- normalizes SQLite-style `0 | 1` access values to real booleans before passing them to the Codex SDK config layer

This closes the gap between Metidos’s thread settings and the effective runtime tool surface presented to the agent.

### 2. Move Metidos thread tools behind `metidosAccess`

The current Pi-native Metidos tool pack in `src/bun/pi-metidos-tools.ts` now exposes all Metidos thread/workspace tools behind `metidosAccess`, including:

- `update_thread`
- `list_threads`
- `run_untrusted_js`
- `init_task_graph`
- `validate_task_graph`
- `normalize_task_graph`
- `set_context`
- `list_crons`
- `new_cron`
- `update_cron`
- `new_thread`

This makes the `Metidos` toggle own the full sidecar surface instead of only the cron/runtime subset, while still allowing narrower runtime policy on specific high-impact helpers such as the task-graph admin tools.

### 2a. Keep `update_thread` metadata-only inside a running thread

`update_thread` is a metadata tool, not an access-toggle tool.

Inside a running thread:

- `title`, `summary` / `description`, and `pinned` may update thread metadata
- access-control inputs such as `githubAccess`, `agentsAccess`, `metidosAccess`, and `unsafeMode` are legacy compatibility fields and are ignored

That rule is especially important for `unsafeMode`: a thread must never be able to upgrade or downgrade its own sandbox/network policy by calling `update_thread`.

### 3. Update UI copy to match the real boundaries

`src/mainview/controls/thread-access-control.tsx` now labels the toggles as:

- `Agents`: "Allow planning and sub-agent tools."
- `Metidos`: "Allow Metidos MCP tools such as thread, cron, and workspace helpers."

That wording matches the runtime model and should reduce confusion during manual verification.

## Current State vs Desired State

### Before

- `GitHub` toggle only affected Metidos-sidecar metadata and thread records, not the built-in GitHub connector surface
- `Agents` toggle did not prevent planning/sub-agent tools from being reported as available
- `Metidos` toggle exposed only part of the Metidos tool surface

### After

- `GitHub` toggle participates in actual Codex client configuration
- `Agents` toggle participates in actual Codex client configuration
- `Metidos` toggle owns the full Metidos MCP sidecar surface
- access checks should now report a tool set consistent with the enabled thread flags

## Verification

Targeted validation completed during the fix, using the current Pi-native tool-pack coverage paths:

- `bun test src/bun/project-procedures-config.test.ts src/bun/pi-metidos-tools.test.ts src/bun/sidecar-thread-metadata.test.ts`
- `bunx biome check src/bun/project-procedures.ts src/bun/project-procedures-config.test.ts src/bun/pi-metidos-tools.ts src/mainview/controls/thread-access-control.tsx`
- `bun run typecheck`

New test coverage was added in `src/bun/project-procedures-config.test.ts` to assert:

- thread-scoped Codex config disables GitHub and agent tool families when requested
- the Metidos sidecar is omitted entirely when `metidosAccess` is disabled

## Manual Recheck

Recommended manual spot check after future access-control changes:

1. Create a thread with only `Metidos` enabled.
2. Ask the agent to list available tools.
3. Confirm GitHub and agent/planning tools are not listed.
4. Confirm Metidos thread tools and cron tools are listed together.
5. Toggle `Agents` on and confirm planning/sub-agent tools appear.
6. Toggle `GitHub` on and confirm GitHub connector tools appear.

## Relevant Code Paths

- `src/bun/project-procedures.ts`
  - now routes thread access semantics into the Pi-backed runtime path
- `src/bun/pi-metidos-tools.ts`
  - registers the Pi-native Metidos tool pack and applies access gating
- `src/mainview/controls/thread-access-control.tsx`
  - renders thread access toggle labels
- `src/bun/project-procedures-config.test.ts`
  - verifies generated runtime config behavior

## Maintenance Note

This access-control area now depends on Metidos’s own Pi-native tool-pack wiring. If the thread-access boundaries change again, update both:

- the runtime/tool wiring in `src/bun/project-procedures.ts` and `src/bun/pi-thread-runtime.ts`
- the assertions in `src/bun/project-procedures-config.test.ts`

The highest-risk future regression is reintroducing a mismatch where Metidos persists a thread flag but the Pi-native tool packs still expose a broader surface than that thread should have.
