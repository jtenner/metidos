# Design: `run_untrusted_js` Isolation Audit And Bounded Hardening Plan

Date: 2026-04-12  
Repository: `metidos`

## Summary

- The current `run_untrusted_js` path is safer than raw host execution, but it is not a complete worktree or network sandbox today.
- The custom vm2 `fs` mock does block ordinary Node `fs` writes outside the worktree, and the existing regression tests already verify that behavior.
- However, the top-level sandbox still exposes unscoped Bun and network surfaces that bypass the `fs` mock entirely.
- Local probes in this repo confirmed three concrete escape paths from a safe thread's vm2 runner:
  - `Bun.file("/abs/path").text()` can read files outside the worktree
  - `new Bun.SQLite.Database("/abs/path")` can create and write a database outside the worktree
  - global `fetch(...)` can make network requests
- Recommendation: keep vm2 for the next implementation slice, but materially narrow the exposed surface first. Do not treat replacement as the immediate move while these cheaper, high-impact reductions are still unimplemented.

## Goal

Complete the design work needed before changing `run_untrusted_js` so the next implementation task has a bounded plan instead of an open-ended "sandbox harder" instruction.

## Current Runtime Shape

The current implementation lives in:

- [src/bun/vm2-runner.ts](../src/bun/vm2-runner.ts)
- [src/bun/vm2-runner-worker.ts](../src/bun/vm2-runner-worker.ts)
- [src/bun/pi-metidos-tools.ts](../src/bun/pi-metidos-tools.ts)

Important current characteristics:

- `run_untrusted_js` is exposed as a normal Metidos tool when `metidosAccess` is enabled.
- The worker creates a vm2 `NodeVM` with:
  - `compiler: "typescript"`
  - `console: "redirect"`
  - `eval: false`
  - `wasm: false`
  - a worktree-scoped `require.root`
  - a custom `fs` mock under `require.mock.fs`
- A Bun-specific compatibility patch monkey-patches `fs.readFileSync` process-wide so vm2's `setup-sandbox.js` can finish under Bun.
- The top-level sandbox exposes:
  - global `fetch`
  - a custom `Bun` object including `Glob`, `SQLite`, `TOML`, `file`, compression helpers, `markdown`, `sleep`, `semver`, and related utilities

## What Already Works

The existing vm2 path does have meaningful safety controls:

- no shell access
- no arbitrary `require()` of external packages
- no `eval`
- no `wasm`
- redirected console capture
- worker-level timeout enforcement
- Node `fs` path writes constrained to the current worktree

Existing coverage already exercises:

- console capture
- timeout behavior
- Bun helper availability
- Node `fs` write blocking outside the worktree

That matters because the follow-up work should preserve the controls that are already working instead of replacing them blindly.

## Concrete Gaps Confirmed In Local Probes

The main issue is that the `fs` mock is not the whole sandbox boundary. The top-level Bun and network globals expose capabilities that never pass through the mocked `fs` layer.

### 1. Outside-worktree file reads via `Bun.file`

Local probe result:

```json
{
  "ok": true,
  "resultText": "\"top-secret\""
}
```

The sandboxed code successfully read a file outside the active worktree using:

```ts
module.exports = Bun.file("/tmp/.../secret.txt").text();
```

### 2. Outside-worktree writes via `Bun.SQLite.Database`

Local probe result:

```json
{
  "ok": true,
  "resultText": "\"x\""
}
```

The sandboxed code successfully created and wrote a SQLite database outside the active worktree using:

```ts
const db = new Bun.SQLite.Database("/tmp/.../outside.sqlite");
db.run("CREATE TABLE demo (value TEXT)");
db.run("INSERT INTO demo VALUES ('x')");
```

### 3. Network egress via global `fetch`

Local probe result:

```json
{
  "ok": true,
  "resultText": "\"network-ok\""
}
```

The sandboxed code successfully reached a loopback HTTP server using:

```ts
module.exports = fetch("http://127.0.0.1:...").then((response) =>
  response.text(),
);
```

### Meaning

The current tool description in [src/bun/pi-metidos-tools.ts](../src/bun/pi-metidos-tools.ts) says the sandboxed `fs` mock is read-only outside the worktree and writable only inside it. That is true for Node `fs`, but it is not a complete description of the actual reachable surface.

The real risk is:

- host file reads outside the worktree
- host file creation outside the worktree
- network access from "safe" threads

## Risk Assessment

### Why this is still worth hardening in place first

There is a meaningful difference between:

- "vm2 is historically risky and should probably be replaced someday"
- "the current exposed surface contains specific, removable escapes today"

The second problem is more urgent and more bounded.

The repo already has:

- worker-based execution
- report formatting
- path-normalized file-diff integration
- tool wiring
- existing tests around timeout and worktree writes

That means the next implementation slice can reduce real risk quickly without redesigning the entire execution model first.

### Why full replacement should not be the immediate first move

A complete replacement would require choosing and integrating a new execution boundary for:

- TypeScript execution
- captured return values
- console streaming
- timeout behavior
- filesystem policy
- tool result formatting

That is a larger change surface than the immediate problems justify right now.

## Options Considered

### Option 1: Keep vm2, but shrink the exposed surface aggressively

Pros:

- directly addresses the concrete bypasses already confirmed
- preserves the existing worker/report/tool integration shape
- can be covered with targeted regression tests
- is the smallest implementation slice that materially improves safety

Cons:

- still leaves vm2 in the architecture
- still depends on the Bun-specific setup patch
- still requires careful future review of any newly exposed helpers

### Option 2: Replace vm2 immediately

Pros:

- reduces long-term dependence on a historically risky library
- could eventually provide a cleaner trust story

Cons:

- much larger implementation and migration surface
- easy to under-scope because it combines security work with runtime redesign
- would delay fixes to the already-proven Bun/global escape paths

## Recommendation

Use **Option 1** for the next implementation task:

- keep vm2 for now
- materially narrow the available Bun and network surface
- add regression coverage for the newly proven escape paths
- revisit replacement only after the narrowed runner exists

This is the smallest plan that meaningfully reduces risk.

## Minimum Follow-up Implementation Set

The next implementation task should do all of the following.

### 1. Remove global network access from the sandbox

- stop exposing top-level `fetch`
- ensure safe-thread `run_untrusted_js` has no ambient network access

### 2. Remove unscoped Bun file and database capabilities

At minimum, remove these from `buildVm2BunSandbox()`:

- `file`
- `SQLite`
- `Glob`

Those APIs either bypass the worktree `fs` guard directly or make it too easy to do so.

### 3. Re-evaluate the rest of the Bun allowlist

Keep only Bun helpers that are pure computation or serialization utilities. Likely candidates to keep:

- `TOML`
- compression helpers
- `semver`
- `sleep`
- `nanoseconds`

Helpers that interact with the host filesystem, database layer, browser-like fetching, or path walking should be excluded unless they get their own explicit policy wrapper.

### 4. Add regression tests for the concrete escape paths

Add tests that fail if sandbox code can still:

- read outside-worktree files with `Bun.file`
- create or mutate outside-worktree SQLite files through `Bun.SQLite`
- make network requests through `fetch`

### 5. Update the tool contract wording

After hardening lands, update the `run_untrusted_js` tool description so it describes the actual boundary instead of only the mocked `fs` behavior.

### 6. Measure failures and timeouts explicitly

The later telemetry task should count:

- sandbox invocation totals
- timeout totals
- failure totals
- denied-capability outcomes if the hardening path surfaces them distinctly

## Replacement Decision For Later

After the narrowed vm2 path exists, revisit replacement only if one of these remains true:

- the Bun-specific vm2 patch keeps breaking on upstream updates
- the reduced API surface is still too broad for the threat model
- performance or reliability data shows the vm2 path itself is the bottleneck

At that point, replacement will be an informed second step instead of a speculative first one.

## Outcome

This spike recommends a **bounded hardening-first plan**, not an immediate runtime replacement:

1. keep vm2 short-term
2. remove `fetch` plus unscoped Bun host APIs
3. add regression coverage for the proven escape paths
4. then evaluate whether a deeper replacement is still necessary
