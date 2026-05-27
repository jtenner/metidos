# RPC Payload Measurement

## Summary

This page records the durable design and implementation outcome for optimization slice `OPT05.1`, completed on 2026-04-11. Metidos kept its existing JSON transport and coarse runtime byte counters, but extended the runtime diagnostics summary so the heaviest transport paths are ranked explicitly instead of being visible only through totals and raw maps.

Observed outcome as of 2026-04-11:

- runtime diagnostics now rank top RPC methods by accumulated response bytes
- runtime diagnostics now rank top websocket push types by accumulated payload bytes
- the starvation harness prints those ranked hot paths in its human-readable summary
- the ranking logic stays bounded, in-memory, and low-cardinality

Related pages:

- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)

## Problem

`OPT01.1` and `OPT01.2` had already given Metidos a shared runtime-stats collector plus a benchmark harness that could reset and snapshot those stats. The remaining transport-observability gap was prioritization: operators could see aggregate request and response byte totals, but they could not immediately tell which RPC methods or websocket push categories were dominating payload volume.

That made later transport-oriented slices less disciplined than they should be. Before changing refresh behavior, diff/history loading, or websocket push strategies, Metidos needed a cheap ranking of the noisiest paths in measured scenarios.

## Current state before the slice

Observed from the source document:

- `src/bun/runtime-stats.ts` already tracked coarse RPC request bytes, RPC response bytes, and websocket push payload bytes
- `/health/runtime-stats` and `buildServerHealthSnapshot(...).runtimeStats` already exposed runtime stats summaries
- `src/bun/starvation-harness.ts` already consumed runtime stats for benchmark reporting
- diagnostics still emphasized totals and raw maps rather than explicit ranked hot paths

## Chosen design

Recommended and implemented outcome from the source:

- extend `RuntimeStatsSummary` in `src/bun/runtime-stats.ts`
- add ranked RPC response-byte summaries under `rpc.topResponseBytesMethods`
- add ranked websocket push payload-byte summaries under `websocketPush.topPayloadBytesTypes`
- sort those rankings by descending total bytes so the heaviest paths surface first
- keep the rankings cheap by deriving them from existing in-memory maps and returning only the top 5 entries
- expose the new rankings automatically through the already existing runtime diagnostics surfaces
- print the ranked summaries in `src/bun/starvation-harness.ts` so benchmark runs show the hot paths without requiring manual JSON inspection

## Durable design rules

### Keep transport measurement actionable without redesigning the transport

Observed and recommended rule:

- keep the existing JSON RPC and websocket transport intact in this slice
- improve diagnostics first so later protocol or refresh changes can be justified by measured rankings

### Ranking should stay bounded and low-cardinality

Durable implementation rule:

- compute rankings from existing collector state
- do not add persistence, traces, histograms, or per-project/per-thread labels
- return only a small top-N ranking rather than dumping ever-growing detailed summaries into routine diagnostics

### Reuse existing diagnostics surfaces

Observed implementation rule:

- no new endpoint was required for `OPT05.1`
- the ranking data flows through the same runtime-stats summary already exposed by `src/bun/index.ts`
- the harness reuses that summary so operators see the highest-volume transport paths inside the normal benchmark workflow

## Ranked summary shape

### RPC rankings

`rpc.topResponseBytesMethods` records the top response-volume methods. Each entry includes:

- `method`
- `calls`
- `requestBytes`
- `responseBytes`

The entries are ordered by descending `responseBytes`.

### Websocket push rankings

`websocketPush.topPayloadBytesTypes` records the top payload-volume websocket push categories. Each entry includes:

- `type`
- `messages`
- `payloadBytes`
- `deliveredClients`
- `droppedClients`

The entries are ordered by descending `payloadBytes`.

## Representative measurements preserved from the source

### Pressure-run RPC ranking

A representative local starvation-harness pressure run reported the following top RPC response-byte methods:

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

Durable takeaway: in the representative measured scenario, worktree diff and history flows dominated response volume, especially `getWorktreeGitCommitDiff`, `openWorktree`, and `listWorktreeGitHistory`.

### Websocket push smoke check

The representative pressure run happened to produce zero websocket pushes, so the source also preserved a separate smoke check with one connected websocket client and a watched frontend-file touch. That check populated `websocketPush.topPayloadBytesTypes` with a `reload` push entry and confirmed that push rankings become meaningful as soon as a push type is observed.

Durable takeaway: later transport follow-up can distinguish between runs with no push activity and runs where a specific push type dominates payload volume.

## Scope boundaries and non-goals

The source explicitly preserved these non-goals for `OPT05.1`:

- no websocket payload-format redesign
- no MessagePack or CBOR transport change
- no request deduplication yet
- no push batching yet
- no RPC protocol redesign

This is a durable planning boundary: `OPT05.1` improves measurement visibility and prioritization, not the transport itself.

## Key implementation areas

The source named these repository areas as the main implementation surfaces:

- `src/bun/runtime-stats.ts`
- `src/bun/runtime-stats.test.ts`
- `src/bun/starvation-harness.ts`
- `src/bun/starvation-harness.test.ts`
- `src/bun/README.md`

## Validation status

Observed in the source document:

- `bun run format`
- `bun run validate`
- a representative local starvation-harness run
- a local websocket-push smoke check against `/health/runtime-stats`

## Relationship to adjacent slices

The source positioned this slice as the measurement prerequisite for later transport work:

- `OPT01.1` created the low-cardinality runtime collector
- `OPT01.2` made the starvation harness consume that collector and emit richer reports
- `OPT05.1` made transport-heavy paths explicit by ranking response-byte RPC methods and payload-byte websocket push types
- [thread-status-refresh-dedupe](./thread-status-refresh-dedupe.md) shows the next disciplined step: reduce avoidable client-side refresh churn before considering protocol changes
- later `OPT05.x` follow-up can now target the highest-volume paths based on measured evidence instead of aggregate totals alone

## Source

Ingested from `docs/2026-04-11-opt05-1-rpc-payload-measurement.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
