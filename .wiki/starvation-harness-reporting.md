# Starvation Harness Reporting

## Summary

This page captures the durable design and implementation outcome for optimization slice `OPT01.2`, completed on 2026-04-11. Metidos's starvation harness now consumes the backend runtime stats collector, resets and snapshots diagnostics around benchmark windows, reports percentile latency summaries and process memory, and can emit either human-readable output or structured JSON for before/after comparisons.

Observed outcome as of 2026-04-11:

- the backend exposes loopback-only runtime diagnostics endpoints for harness use
- the harness records snapshots before warmup, after warmup, and after the pressure phase
- measured startup HTTP, startup RPC, and pressure RPC operations are summarized with `p50`, `p95`, and `p99`
- the existing startup-budget pass/fail decision remains intact
- structured `--json` output is available for durable comparison workflows

Related pages:

- [runtime-stats-collector](./runtime-stats-collector.md)
- [rpc-payload-measurement](./rpc-payload-measurement.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- [performance-validation-workflow](./performance-validation-workflow.md)

## Problem

`OPT01.1` established a cheap internal runtime stats collector, but Metidos still lacked a practical measurement workflow that could turn those counters into repeatable before/after benchmark evidence. The starvation harness needed a way to reset runtime stats at the start of a measured window, capture the resulting snapshots, combine them with process memory information, and emit stable summaries that could be compared across later optimization slices.

## Current state before the slice

Observed from the source document:

- `src/bun/runtime-stats.ts` already provided a resettable backend collector after `OPT01.1`
- `src/bun/starvation-harness.ts` already exercised startup and pressure scenarios and enforced a startup budget
- the harness did not yet report percentile latency summaries
- the harness did not yet pair benchmark output with runtime diagnostics snapshots and memory observations
- there was not yet a structured JSON report format suitable for baseline capture or automated comparison

## Chosen design

Recommended and implemented outcome from the source:

- add loopback runtime-diagnostics HTTP endpoints in `src/bun/index.ts`
  - `GET /health/runtime-stats`
  - `POST /health/runtime-stats/reset`
- extend `src/bun/runtime-stats.ts` with shared diagnostics snapshot types used by both the backend and the harness
- extend `src/bun/starvation-harness.ts` to:
  - reset runtime stats before the measured warmup and pressure window
  - capture diagnostics snapshots before warmup, after warmup, and after pressure
  - compute `p50`/`p95`/`p99` summaries for startup HTTP, startup RPC, and pressure RPC measurements
  - emit either human-readable output or structured JSON via `--json`
  - preserve the existing startup-budget pass/fail decision
- add focused tests in `src/bun/starvation-harness.test.ts` for JSON parsing, percentile math, merged pressure summaries, and report generation
- document the richer harness behavior and runtime-stats route in `src/bun/README.md`

## Durable design rules

### Diagnostics exposure stays narrow and loopback-oriented

Observed implementation rule:

- the new diagnostics surface exists to support local harness measurement, not as a browser-facing diagnostics product feature
- `OPT01.2` uses loopback health endpoints instead of introducing a new authenticated RPC contract

### Benchmark output should support both humans and automation

Recommended and implemented rule:

- the default harness output should remain readable for local operator use
- the same measured run should be exportable as structured JSON so baseline captures and future comparisons can reuse the exact result shape

### Percentiles belong in the harness workflow, not the always-on collector

Durable boundary preserved from the source:

- percentile summaries are derived during benchmark reporting
- the always-on runtime collector remains low-cardinality and avoids per-call histogram storage in this slice

### Measurement windows must be explicit

Observed implementation rule:

- the harness resets runtime stats before the measured window
- snapshots are taken at named phases so warmup and pressure effects can be compared explicitly instead of inferred from process lifetime totals

## Key implementation areas

The source named these repository areas as the main implementation surfaces:

- `src/bun/index.ts`
- `src/bun/runtime-stats.ts`
- `src/bun/starvation-harness.ts`
- `src/bun/starvation-harness.test.ts`
- `src/bun/README.md`

## Scope boundaries and non-goals

The source explicitly preserved these non-goals for `OPT01.2`:

- no browser diagnostics UI
- no persisted benchmark history
- no OpenTelemetry exporters
- no percentile tracking inside the always-on runtime collector itself
- no new user-facing performance settings surface

This is a durable planning boundary: `OPT01.2` improves the measurement workflow and report shape without turning runtime diagnostics into a permanent product feature set.

## Validation status

Observed in the source document:

- validation ran with `bun run format`
- validation ran with `bun run validate`
- dedicated harness tests cover JSON flag parsing, percentile summary math, merged pressure aggregation, and structured report generation

## Relationship to later slices

The source explicitly positioned this slice as the bridge between `OPT01.1` and later benchmark workflow work:

- `OPT01.1` created the backend runtime collector
- `OPT01.2` made the starvation harness consume that collector and emit comparison-friendly reports
- `OPT01.3` was expected to capture a representative baseline run and record the exact harness command line used

## Source

Ingested from `docs/2026-04-11-opt01-2-harness-percentile-memory-reporting.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
