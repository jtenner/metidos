# 2026-04-11 OPT01.2 Harness Percentile and Memory Reporting

**Status:** completed on 2026-04-11  
**Slice:** [OPT01.2](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt01-1-runtime-stats-collector-proposal.md](./2026-04-11-opt01-1-runtime-stats-collector-proposal.md)

## What this slice implemented

This slice completes the next step after `OPT01.1` by making the starvation harness consume the runtime instrumentation that now exists in the backend and by turning the harness output into something useful for before/after comparisons.

Implemented changes:

- added loopback runtime-diagnostics HTTP endpoints in `src/bun/index.ts`
  - `GET /health/runtime-stats`
  - `POST /health/runtime-stats/reset`
- extended `src/bun/runtime-stats.ts` with shared diagnostics snapshot types used by both server and harness
- extended `src/bun/starvation-harness.ts` to:
  - reset runtime stats before the measured warmup/pressure window
  - capture diagnostics snapshots before warmup, after warmup, and after pressure
  - compute p50/p95/p99 latency summaries for measured startup HTTP, startup RPC, and pressure RPC operations
  - emit either human-readable text or a structured JSON report (`--json`)
  - preserve the existing startup-budget pass/fail decision
- added `src/bun/starvation-harness.test.ts` coverage for:
  - `--json` flag parsing
  - percentile summary math
  - merged pressure-summary aggregation
  - structured report generation
- updated `src/bun/README.md` to document the richer harness behavior and the runtime-stats health route

## Scope boundaries kept for this slice

This slice intentionally did **not** add:

- a browser diagnostics UI
- persisted benchmark history
- OpenTelemetry exporters
- percentile tracking in the always-on runtime collector
- any new performance settings surface

Those remain later work.

## Why the route was added

`OPT01.1` deliberately kept the runtime collector internal. `OPT01.2` needed a reliable way for the harness to:

1. reset stats before a measurement window,
2. fetch the resulting runtime snapshot,
3. pair that snapshot with process memory usage.

The new loopback health endpoints provide exactly that without requiring auth, new RPC contracts, or a browser-facing feature surface.

## Files changed by the slice

- [src/bun/index.ts](../src/bun/index.ts)
- [src/bun/runtime-stats.ts](../src/bun/runtime-stats.ts)
- [src/bun/starvation-harness.ts](../src/bun/starvation-harness.ts)
- [src/bun/starvation-harness.test.ts](../src/bun/starvation-harness.test.ts)
- [src/bun/README.md](../src/bun/README.md)

## Validation

This slice was validated with:

- `bun run format`
- `bun run validate`

## Follow-on expectations

With `OPT01.1` and `OPT01.2` complete, the next telemetry slice should be `OPT01.3`:

- capture one representative baseline run
- record the exact harness command line used
- write the initial benchmark/baseline document in `docs/`

That will turn the new collector and harness reporting into a stable comparison workflow for the remaining optimization backlog.
