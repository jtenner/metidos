# Performance Validation Workflow

## Summary

This page preserves the durable local workflow recorded on 2026-04-12 for validating Metidos performance with repeatable evidence instead of ad hoc impressions.

Observed conclusion from the source: Metidos now has two complementary local validation paths:

- `bun run harness:starvation` for broad startup, HTTP, RPC, git-cache, SQLite-retry, and memory pressure
- `bun run benchmark:metidos-tools --json` for bounded Metidos child-thread and cron tool budgets

Recommended use: treat these two commands together as the standard local regression workflow for performance-sensitive backend and tool-budget changes.

Related pages:

- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- [2026-04-12-metidos-tool-load-benchmark-baseline](./2026-04-12-metidos-tool-load-benchmark-baseline.md)
- [runtime-stats-collector](./runtime-stats-collector.md)
- [track-telemetry-sidecar-db](./track-telemetry-sidecar-db.md)

## Problem

The source note closed an audit-era gap: performance discussions still risked drifting back into guesswork because Metidos lacked one clearly documented repeatable validation workflow.

The durable problem was not that optimization work was finished forever. The problem was that operators and future agents needed a stable way to:

- measure broad runtime behavior,
- measure the highest-risk bounded tool paths,
- distinguish scheduler backpressure from true product failures,
- and compare future changes against named local baselines.

## Workflow outcome

Observed outcome from the source note:

- `src/bun/runtime-stats.ts` provides low-cardinality counters for measured runtime behavior.
- `--track-telemetry` persists checkpointed runtime snapshots into the sidecar database when operators want a durable run record.
- `bun run harness:starvation` provides repeatable broad runtime pressure evidence.
- `bun run benchmark:metidos-tools --json` provides repeatable bounded-tool evidence.
- the starvation harness reporting was refreshed so git-scheduler preemptions are reported separately from unexpected failures.

Durable conclusion: Metidos no longer lacks repeatable local evidence for the broad runtime path or the highest-risk Metidos tool paths.

## Standard local workflow

### 1. Build frontend assets

Observed command from the source:

```bash
bun run tailwind:build
```

### 2. Start an isolated local server with telemetry enabled

Observed command pattern from the source:

```bash
APP_DATA_DIR="$(mktemp -d -t metidos-perf-XXXXXX)"

METIDOS_APP_DATA_DIR="$APP_DATA_DIR" \
METIDOS_DEV=1 \
METIDOS_DEV_RESET=1 \
bun run src/bun/index.ts --dev --port 7611 --track-telemetry
```

Observed reason for this setup:

- isolate app data from the operator's normal environment,
- enable runtime-stats sidecar persistence,
- and force a clean real setup/login flow for local benchmarking.

### 3. Run the broad runtime harness

Observed command from the source:

```bash
bun run harness:starvation \
  --port 7611 \
  --project-path /home/metidos/Projects/jt-ide \
  --workers 3 \
  --warmup-ms 300 \
  --duration-ms 3000 \
  --json
```

Recommended interpretation:

- use this command for startup, RPC, cache, retry, and memory regression checks,
- and compare its output against the documented baseline pages rather than against intuition.

### 4. Run the bounded Metidos-tool benchmark

Observed command from the source:

```bash
bun run benchmark:metidos-tools --json
```

Recommended interpretation:

- use this command when changing bounded thread or cron tool paths,
- and compare safe latency distributions plus unsafe saturation counts against the documented baseline.

## Reporting interpretation after the 2026-04-12 refresh

Observed durable reporting rule from the source:

- `pressure.failedCount` means unexpected loop failures
- `pressure.preemptedCount` captures expected git-scheduler aborts such as foreground work preempting background work

Recommended usage rule: treat `preemptedCount` as scheduler backpressure, not as proof of product breakage.

Observed caution from the source: earlier baseline notes that predate this reporting refresh may have included some scheduler preemptions inside a generic failure count. Future interpretation should use the refreshed split.

## Representative 2026-04-12 validation run

The source recorded one representative local run executed on 2026-04-12 in `America/New_York` with telemetry enabled and an isolated app-data directory.

### Starvation harness snapshot

Observed results from the source:

- JSON report time: `2026-04-13T02:04:50.854Z`
- pass: `true`
- startup total: `67.1 ms`
- startup RPC:
  - `getAppBootstrap`: `50.0 ms`
  - `openWorktree`: `15.5 ms`
- pressure loops:
  - completed: `27`
  - preempted: `8`
  - failed: `0`
- pressure preemptions by label:
  - `openWorktree`: `8`
- pressure percentiles:
  - `openWorktree`: `p50 34.9 ms`, `p95 44.4 ms`, `p99 46.2 ms`
  - `getWorktreeGitCommitDiff`: `p50 0.55 ms`, `p95 0.83 ms`
  - `listWorktreeGitHistory`: `p50 0.46 ms`, `p95 2.13 ms`
- runtime counters after pressure:
  - RPC calls: `91`
  - RPC failed: `8`
  - SQLite retries: `0`
  - history cache range hits: `27`
  - commit-diff cache hits: `27`
  - websocket pushes: `0`

Durable interpretation: the representative broad run completed with zero unexpected loop failures while still surfacing scheduler contention explicitly.

### Metidos-tool benchmark snapshot

Observed results from the source:

- JSON report time: `2026-04-13T02:02:19.759Z`
- options: concurrency `4`, hold `20 ms`, iterations `12`
- safe scenarios:
  - `new_thread_safe`: `12/12` completed
  - `new_cron_safe`: `12/12` completed
  - `update_cron_safe`: `12/12` completed
- unsafe scenarios:
  - `new_thread_unsafe`: `1` completed, `11` saturated
  - `new_cron_unsafe`: `1` completed, `11` saturated
  - `update_cron_unsafe`: `1` completed, `11` saturated
- representative successful safe latencies:
  - `new_thread_safe`: `p50 122.9 ms`, `p95 140.0 ms`
  - `new_cron_safe`: `p50 81.8 ms`, `p95 85.5 ms`
  - `update_cron_safe`: `p50 40.5 ms`, `p95 42.7 ms`

Durable interpretation: safe child mutations queue and complete within the bounded safe budget, while unsafe child mutations saturate loudly instead of silently piling up. The original 2026 source also recorded a synthetic sandbox scenario, but current Metidos has retired the `run_untrusted_js` path and the live benchmark now focuses on thread and cron tools.

## How to use this workflow going forward

### For general runtime regressions

Recommended workflow from the source:

- run `bun run harness:starvation`
- watch startup totals, `openWorktree` percentiles, memory snapshots, and cache/retry counters
- treat scheduler preemptions as backpressure signals unless they are accompanied by unexpected failures

### For bounded tool-path regressions

Recommended workflow from the source:

- run `bun run benchmark:metidos-tools --json`
- compare safe latency distributions and unsafe saturation counts against the baseline pages
- use the benchmark as a regression check for tool-budget behavior, not as a production-throughput claim

## Durable takeaway

The key durable lesson from the source is procedural: future performance work in Metidos should begin from the documented starvation-harness plus Metidos-tool-benchmark workflow, with telemetry enabled when a durable run record is useful.

Metidos may still need later optimization work, but it no longer needs to reason about the broad runtime path or the highest-risk tool paths without repeatable evidence.

## Source

Ingested from `docs/2026-04-12-performance-validation-workflow.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
