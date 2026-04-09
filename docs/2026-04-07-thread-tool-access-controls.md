# Thread Tool Access Controls

Summary

Thread-level tool access drifted out of sync with the actual tool surface exposed to Codex. A thread could show only `Jolt` and `Unsafe` as enabled in the UI while still reporting access to planning/sub-agent tools, GitHub connector tools, and only a partial subset of Jolt tools. The fix on 2026-04-07 aligned the runtime with the thread toggles by explicitly configuring the Codex client per thread, moving Jolt-sidecar thread tools behind the `Jolt` toggle, and tightening test coverage around the generated config.

## Problem

Observed repro:

1. Create a new thread.
2. Verify access so only `Jolt` and `Unsafe` are checked.
3. Ask the thread which tools it can access.

Observed result before the fix:

- planning and collaboration tools still appeared
- GitHub connector tools still appeared
- some Jolt tools were missing even though `Jolt` was enabled

Expected result:

- `Agents` controls planning and sub-agent tools
- `GitHub` controls GitHub connector tools
- `Jolt` controls all Jolt MCP tools
- `Unsafe` controls sandbox mode only, not tool family visibility

## Root Causes

### 1. Thread flags were not fully projected into the Codex client config

`src/bun/project-procedures.ts` created a Codex client that only conditionally added the local Jolt MCP server. It did not also apply thread-scoped config for built-in tool families such as:

- GitHub app tools
- planning and collaboration features

That meant a thread could disable `GitHub` or `Agents` in Jolt while the underlying Codex runtime still exposed those tool families.

### 2. Jolt tools were split across two toggles

`src/bun/codex-sidecar-mcp.ts` registered these tools behind `agentsAccess` instead of `joltAccess`:

- `update_thread`
- `list_threads`
- `new_thread`

At the same time, other Jolt tools were already behind `joltAccess`:

- `run_untrusted_js`
- `set_context`
- `list_crons`
- `new_cron`
- `update_cron`

That split produced the partial-Jolt behavior: enabling `Jolt` alone did not expose the full Jolt tool set.

### 3. UI copy no longer matched runtime behavior

The access control menu described:

- `Agents`: "Allow thread and agent tools."
- `Jolt`: "Allow Jolt MCP tools such as cron helpers."

That wording matched neither the actual built-in tool family boundaries nor the intended ownership of Jolt thread-management tools.

## Desired Access Model

The intended steady-state behavior is:

| Toggle | What it controls |
| --- | --- |
| `GitHub` | `mcp__codex_apps__github_*` tools |
| `Agents` | planning/sub-agent tooling such as `update_plan`, `request_user_input`, `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, and `close_agent` |
| `Jolt` | all `mcp__jolt__*` tools exposed by the sidecar, including thread, workspace, cron, and JS sandbox helpers |
| `Unsafe` | sandbox/network mode for the thread, not app/tool family visibility |

## Fix Implemented On 2026-04-07

### 1. Build explicit Codex config from thread access flags

`src/bun/project-procedures.ts` now builds the Codex config from thread state instead of only deciding whether to attach the Jolt sidecar at all.

The generated config now:

- sets `apps.github.enabled` from `thread.githubAccess`
- sets multi-agent and request-user-input related features from `thread.agentsAccess`
- only injects the Jolt MCP server when `thread.joltAccess` is true
- adds thread-scoped developer instructions so tool-listing behavior stays aligned with the active thread access controls
- normalizes SQLite-style `0 | 1` access values to real booleans before passing them to the Codex SDK config layer

This closes the gap between Jolt’s thread settings and the effective runtime tool surface presented to the agent.

### 2. Move Jolt thread tools behind `joltAccess`

`src/bun/codex-sidecar-mcp.ts` now registers all Jolt-sidecar thread/workspace tools behind `joltAccess`, including:

- `update_thread`
- `list_threads`
- `new_thread`

This makes the `Jolt` toggle own the full sidecar surface instead of only the cron/runtime subset.

### 3. Update UI copy to match the real boundaries

`src/mainview/controls/thread-access-control.tsx` now labels the toggles as:

- `Agents`: "Allow planning and sub-agent tools."
- `Jolt`: "Allow Jolt MCP tools such as thread, cron, and workspace helpers."

That wording matches the runtime model and should reduce confusion during manual verification.

## Current State vs Desired State

### Before

- `GitHub` toggle only affected Jolt-sidecar metadata and thread records, not the built-in GitHub connector surface
- `Agents` toggle did not prevent planning/sub-agent tools from being reported as available
- `Jolt` toggle exposed only part of the Jolt tool surface

### After

- `GitHub` toggle participates in actual Codex client configuration
- `Agents` toggle participates in actual Codex client configuration
- `Jolt` toggle owns the full Jolt MCP sidecar surface
- access checks should now report a tool set consistent with the enabled thread flags

## Verification

Targeted validation completed during the fix:

- `bun test src/bun/project-procedures-config.test.ts src/bun/codex-sidecar-mcp.test.ts src/bun/sidecar-thread-metadata.test.ts`
- `bunx biome check src/bun/project-procedures.ts src/bun/project-procedures-config.test.ts src/bun/codex-sidecar-mcp.ts src/mainview/controls/thread-access-control.tsx`
- `bun run typecheck`

New test coverage was added in `src/bun/project-procedures-config.test.ts` to assert:

- thread-scoped Codex config disables GitHub and agent tool families when requested
- the Jolt sidecar is omitted entirely when `joltAccess` is disabled

## Manual Recheck

Recommended manual spot check after future access-control changes:

1. Create a thread with only `Jolt` enabled.
2. Ask the agent to list available tools.
3. Confirm GitHub and agent/planning tools are not listed.
4. Confirm Jolt thread tools and cron tools are listed together.
5. Toggle `Agents` on and confirm planning/sub-agent tools appear.
6. Toggle `GitHub` on and confirm GitHub connector tools appear.

## Relevant Code Paths

- `src/bun/project-procedures.ts`
  - builds per-thread Codex config
  - injects the Jolt sidecar environment
- `src/bun/codex-sidecar-mcp.ts`
  - registers the Jolt MCP tools and applies access gating
- `src/mainview/controls/thread-access-control.tsx`
  - renders thread access toggle labels
- `src/bun/project-procedures-config.test.ts`
  - verifies generated runtime config behavior

## Maintenance Note

This integration depends on the current Codex CLI config surface for app and feature gating. If the upstream Codex config keys or tool-family boundaries change, update both:

- the generated config in `src/bun/project-procedures.ts`
- the assertions in `src/bun/project-procedures-config.test.ts`

The highest-risk future regression is reintroducing a mismatch where Jolt persists a thread flag but the Codex client still advertises a broader tool surface than that thread should have.
