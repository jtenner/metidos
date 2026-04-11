# 2026-04-11 OPT05.1 RPC Payload Measurement

**Status:** completed on 2026-04-11  
**Slice:** [OPT05.1](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt01-1-runtime-stats-collector-proposal.md](./2026-04-11-opt01-1-runtime-stats-collector-proposal.md)
- [docs/2026-04-11-opt01-2-harness-percentile-memory-reporting.md](./2026-04-11-opt01-2-harness-percentile-memory-reporting.md)

## Summary

`OPT05.1` closes the transport-measurement slice by extending the existing runtime-stats collector from “coarse byte totals exist” to “the noisiest RPC and websocket paths are explicitly ranked in diagnostics output.”

This slice does **not** introduce a new transport protocol. It keeps the JSON transport intact and instead makes the current payload accounting easier to act on.

After this slice, the runtime diagnostics summary now includes:

- top RPC methods ranked by accumulated response bytes,
- top websocket push types ranked by accumulated payload bytes.

That gives later slices (`OPT05.2` and conditional `OPT05.3`) a measured ranking to target instead of relying only on aggregate totals.

## Scope of the slice

Per the execution plan, this slice needed to:

- add per-method coarse payload accounting,
- identify the top response and push-volume paths,
- feed those numbers into the runtime stats output.

The first part was already substantially satisfied by `OPT01.1`:

- RPC request bytes were already recorded,
- RPC response bytes were already recorded,
- websocket push payload bytes were already recorded,
- `/health/runtime-stats` already exposed the counters.

The remaining gap was the second and third bullets: the diagnostics output still gave totals and raw maps, but it did not explicitly surface the heaviest transport paths in ranked summary form.

## What changed

## 1. Added ranked transport summaries to `RuntimeStatsSummary`

Updated file:

- [src/bun/runtime-stats.ts](../src/bun/runtime-stats.ts)

`RuntimeStatsSummary` now includes:

### RPC rankings

- `rpc.topResponseBytesMethods`

Each entry includes:

- `method`
- `calls`
- `requestBytes`
- `responseBytes`

These are sorted by descending `responseBytes` so the largest response paths surface first.

### Websocket push rankings

- `websocketPush.topPayloadBytesTypes`

Each entry includes:

- `type`
- `messages`
- `payloadBytes`
- `deliveredClients`
- `droppedClients`

These are sorted by descending `payloadBytes` so the heaviest push categories surface first.

The summary keeps the existing totals too, so callers still get both:

- global transport totals,
- top-byte rankings.

## 2. Kept ranking logic cheap and bounded

The ranking logic is intentionally small and bounded:

- computed from the already maintained in-memory maps,
- no extra persistence,
- no per-project or per-thread cardinality,
- only the top `5` entries are returned.

That stays aligned with the original runtime-stats design constraint from `OPT01.1`: always-on, numeric, low-cardinality telemetry.

## 3. Exposed the rankings automatically through existing diagnostics

No new endpoint was needed.

Because `src/bun/index.ts` already returns:

- `/health/runtime-stats`
- `buildServerHealthSnapshot(...).runtimeStats`

and both use `getRuntimeStatsSummary()`, the new rankings automatically appear in the existing runtime diagnostics story.

## 4. Made the starvation harness print the ranked hot paths

Updated file:

- [src/bun/starvation-harness.ts](../src/bun/starvation-harness.ts)

The harness console summary now prints:

- `top rpc response bytes: ...`
- `top websocket push bytes: ...`

when those rankings are non-empty.

That makes the ranking visible in the existing benchmark workflow instead of requiring manual JSON inspection every time.

## 5. Added regression coverage

Updated files:

- [src/bun/runtime-stats.test.ts](../src/bun/runtime-stats.test.ts)
- [src/bun/starvation-harness.test.ts](../src/bun/starvation-harness.test.ts)

The runtime-stats tests now verify that:

- RPC summary rankings are ordered by response bytes,
- websocket push summary rankings are ordered by payload bytes.

The starvation-harness fixture was updated so the summary type change remains covered.

## Representative measurement

## A. Pressure-run RPC ranking

A representative local harness run was executed against a dev-bypass local server.

### Representative result

Top RPC response-byte methods after pressure:

| Rank | Method | Calls | Request bytes | Response bytes |
|---|---|---:|---:|---:|
| 1 | `getWorktreeGitCommitDiff` | `28` | `6465` | `931697` |
| 2 | `openWorktree` | `30` | `4886` | `163398` |
| 3 | `listWorktreeGitHistory` | `28` | `5149` | `123505` |
| 4 | `getAppBootstrap` | `1` | `177` | `36160` |

The same run reported aggregate RPC totals of:

- `87` calls
- `16,677` request bytes
- `1,254,760` response bytes

### Takeaway

The heavy response paths in the representative run were clearly the worktree diff/history flows, especially:

- `getWorktreeGitCommitDiff`
- `openWorktree`
- `listWorktreeGitHistory`

That is exactly the sort of ranking `OPT05.1` needed to make explicit before any protocol or dedupe changes are considered.

## B. Websocket push ranking smoke check

A separate local dev-server smoke check was run with one connected websocket client and a watched frontend-file touch to trigger a reload push.

### Representative result

`runtimeStatsSummary.websocketPush` reported:

- `messages: 1`
- `payloadBytes: 43`
- `topPayloadBytesTypes: [{ type: "reload", payloadBytes: 43, ... }]`

### Takeaway

The representative pressure run happened to produce zero websocket pushes, so this explicit smoke check confirmed that the new ranked push summary becomes populated as soon as a push type is observed.

That matters because later transport follow-up can now distinguish between:

- runs where pushes were absent,
- runs where a specific push type dominated payload volume.

## Why this slice matters before OPT05.2 and OPT05.3

`OPT05.2` and conditional `OPT05.3` are supposed to reduce noisy transport work, but they should not do so blindly.

With this slice complete, later work can answer:

- which RPC methods are actually dominating response volume,
- whether websocket traffic is materially noisy in the measured scenario,
- whether follow-up should focus on selected-thread refresh, diff/history payloads, or push batching.

That is more disciplined than speculating about JSON transport overhead in the abstract.

## What stayed intentionally unchanged

To keep this slice narrow and measurement-led, it does **not**:

- change websocket payload formats,
- add MessagePack/CBOR,
- dedupe any requests yet,
- batch any push streams yet,
- redesign the RPC protocol.

This slice only improves measurement visibility.

## Files changed by the slice

- [src/bun/runtime-stats.ts](../src/bun/runtime-stats.ts)
- [src/bun/runtime-stats.test.ts](../src/bun/runtime-stats.test.ts)
- [src/bun/starvation-harness.ts](../src/bun/starvation-harness.ts)
- [src/bun/starvation-harness.test.ts](../src/bun/starvation-harness.test.ts)
- [src/bun/README.md](../src/bun/README.md)

## Validation performed

- `bun run format`
- `bun run validate`
- local representative starvation-harness run
- local websocket-push smoke check against `/health/runtime-stats`

## Completion note

`OPT05.1` is complete.

Metidos already had coarse transport byte counters from the earlier runtime-stats work; this slice makes those counters actionable by surfacing ranked top response-byte RPC methods and top payload-byte websocket push types directly in the runtime diagnostics summary and harness output.
