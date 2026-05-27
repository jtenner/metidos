# Plugin Sidecar and Ingress Concurrency Audit

Summary: On 2026-05-23, a focused source review of `src/bun/plugin/sidecar-manager.ts` and `src/bun/plugin/ingress-batch-processor.ts` found that the highest-risk sidecar request and host-callback paths already have explicit concurrency, timeout, framing, and failure-cleanup boundaries. The ingress batch processor is intentionally sequential per polled batch, which favors ordering and cursor safety over throughput. No immediate security-critical code change was identified in this pass; the remaining findings are bounded maintenance follow-ups.

## Scope

Observed files:

- `src/bun/plugin/sidecar-manager.ts`
- `src/bun/plugin/sidecar-rpc.ts` as the framing/JSON boundary used by the manager
- `src/bun/plugin/sidecar-runtime.ts` as the process write/read boundary imported by the manager
- `src/bun/plugin/ingress-batch-processor.ts`
- Existing related test surfaces in `src/bun/plugin/sidecar-manager.test.ts`, `src/bun/plugin/sidecar-rpc.test.ts`, and `src/bun/plugin/ingress-batch-processor.test.ts`

## Current state observed

### Sidecar manager

- `PLUGIN_SIDECAR_MAX_IN_FLIGHT_REQUESTS` bounds maincar-to-sidecar operations per plugin session before writing new request frames.
- Each sidecar operation records a request timer and abort handler, removes them on response/failure, and rejects all in-flight operations when a session terminates.
- Timed-out operations attempt sidecar cancellation and then terminate the session, avoiding an indefinitely wedged runtime after a missed deadline.
- `PLUGIN_SIDECAR_MAX_CONCURRENT_HOST_REQUESTS` bounds sidecar-to-maincar host callbacks per session. The manager tracks active host request ids in `session.hostRequests` and rejects excess callbacks with a host error frame.
- Sidecar stdout is line-delimited and decoded through `decodePluginSidecarRpcEnvelope`; earlier audit work documents that this protects protocol framing, not arbitrary byte-stream integrity.
- Startup, shutdown, stdin write, callback, and crash-loop controls are named constants, which makes operational limits grep-able.

### Ingress batch processor

- `processBatch()` resolves a source once, records invalid-source messages as failed, then processes messages sequentially with `await` in a `for...of` loop.
- Duplicate or already-terminal messages are skipped by durable message lookup before routing.
- Unverified external users are persisted as `unverified` and audited without dispatching to thread routing.
- Link-code messages are handled before normal routing, persist success/failure status, and deliberately swallow best-effort confirmation failures so a reply outage does not poison the poll cursor.
- Verified messages are routed through `PluginIngressThreadRouter`; success/failure transitions are mediated by store functions rather than ad hoc state mutation in the processor.

## Decisions from this pass

- Keep the ingress processor sequential per polled batch. This is a safe default because source ordering, duplicate checks, link-code consumption, and route-to-thread side effects are easier to reason about than a parallel batch worker.
- Do not add a second in-process queue around sidecar manager operations in this slice. The manager already rejects excess in-flight operations and excess host callbacks per session; adding queuing would change plugin-visible backpressure semantics.
- Treat this audit item as documentation-only. The review produced bounded follow-ups, but no unbounded memory/concurrency path severe enough to justify a mixed audit-plus-refactor commit.

## Follow-up candidates

These are recommendations, not completed implementation:

1. Add an explicit maximum retained entries limit for `PluginIngressBatchProcessor.sourcesByKey` if future plugin ingress sources can churn without process restart. Today the key set is expected to follow registered plugin/source ids, but the map is not independently bounded.
2. Add a small regression test that `session.hostRequests` is cleared after failed host callbacks if one does not already cover the failure path. The code is structured for cleanup, but a focused test would guard future edits.
3. Consider a per-source ingress batch size cap at the poll scheduler boundary if plugins can return arbitrarily large `messages` arrays. The processor is sequential, but a huge batch can still monopolize the event loop through many durable operations.
4. Keep sidecar stdout frame size, operation timeout, write timeout, in-flight limit, and host-callback limit changes in one place with tests when tuning Plugin System v1 runtime behavior.

## Validation

Documentation-only audit record. Formatting was run on this page, `.wiki/index.md`, `.wiki/log.md`, and `agent-todo.md` before commit.
