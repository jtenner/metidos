# 2026-04-12 Performance Validation Workflow

This note closes the audit follow-up around missing repeatable performance evidence.

Metidos now has two local validation paths that cover the main pressure shapes the audit cared about:

- `bun run harness:starvation` for broad startup, HTTP, RPC, cache, and memory pressure
- `bun run benchmark:metidos-tools --json` for the bounded Metidos child-thread/cron and sandbox budgets

## Why this is enough to close the risk

The open audit risk was not "Metidos will never need more optimization work."

The open risk was that performance and load discussions could still drift back into guesswork. That is now addressed:

- the runtime has low-cardinality counters in `runtime-stats.ts`
- `--track-telemetry` persists those counters into the sidecar DB
- the starvation harness provides a broad repeatable runtime-pressure report
- the Metidos-tool benchmark provides a narrow repeatable high-risk-tool report
- the starvation harness now reports git-scheduler preemptions separately from true failures, so load noise does not masquerade as product breakage

Future optimization work still exists, but it is now measurement-led rather than blind.

## Current workflow

### 1. Build the frontend assets

```bash
bun run tailwind:build
```

### 2. Start an isolated local server with telemetry enabled

```bash
APP_DATA_DIR="$(mktemp -d -t metidos-perf-XXXXXX)"

METIDOS_APP_DATA_DIR="$APP_DATA_DIR" \
METIDOS_DEV=1 \
METIDOS_DEV_BYPASS=1 \
bun run src/bun/index.ts --dev --port 7611 --track-telemetry
```

This keeps the run isolated, enables the runtime-stats sidecar, and avoids browser-auth/session setup noise.

### 3. Run the broad runtime harness

```bash
bun run harness:starvation \
  --port 7611 \
  --project-path /home/jtenner/Projects/jt-ide \
  --workers 3 \
  --warmup-ms 300 \
  --duration-ms 3000 \
  --json
```

### 4. Run the bounded Metidos-tool benchmark

```bash
bun run benchmark:metidos-tools --json
```

## Interpreting the starvation harness after the 2026-04-12 refresh

The important reporting change is:

- `pressure.failedCount` now means unexpected loop failures
- `pressure.preemptedCount` now captures expected git-scheduler aborts such as `Foreground git command preempted background work ...`

Earlier baseline notes that predate this change may show some of those scheduler preemptions inside the generic failure count. Use the refreshed interpretation going forward.

## Representative 2026-04-12 run

The following run was executed on **2026-04-12 America/New_York** with telemetry enabled and an isolated app-data directory at `/tmp/metidos-perf-7Tzcs8`.

The server logged the runtime-stats sidecar at:

- `/tmp/metidos-perf-7Tzcs8/runtime-stats.db`

### Starvation harness

- Command time in JSON report: `2026-04-13T02:04:50.854Z`
- `pass`: `true`
- Startup total: `67.1 ms`
- Startup RPC:
  - `getAppBootstrap`: `50.0 ms`
  - `openWorktree`: `15.5 ms`
- Pressure loops:
  - completed: `27`
  - preempted: `8`
  - failed: `0`
- Pressure preemptions by label:
  - `openWorktree`: `8`
- Pressure percentiles:
  - `openWorktree`: p50 `34.9 ms`, p95 `44.4 ms`, p99 `46.2 ms`
  - `getWorktreeGitCommitDiff`: p50 `0.55 ms`, p95 `0.83 ms`
  - `listWorktreeGitHistory`: p50 `0.46 ms`, p95 `2.13 ms`
- Runtime counters after pressure:
  - RPC calls: `91`
  - RPC failed: `8`
  - SQLite retries: `0`
  - history cache range hits: `27`
  - commit-diff cache hits: `27`
  - websocket pushes: `0`

The key point is that the broad runtime run now completed with **zero unexpected loop failures** while still surfacing **eight scheduler preemptions** explicitly.

### Metidos-tool benchmark

- Command time in JSON report: `2026-04-13T02:02:19.759Z`
- Options: concurrency `4`, hold `20 ms`, iterations `12`
- Safe scenarios:
  - `new_thread_safe`: `12/12` completed
  - `new_cron_safe`: `12/12` completed
  - `update_cron_safe`: `12/12` completed
- Unsafe scenarios:
  - `new_thread_unsafe`: `1` completed, `11` saturated
  - `new_cron_unsafe`: `1` completed, `11` saturated
  - `update_cron_unsafe`: `1` completed, `11` saturated
- Sandbox scenario:
  - `run_untrusted_js`: `1` completed, `11` saturated

Representative successful latency percentiles from that run:

- `new_thread_safe`: p50 `122.9 ms`, p95 `140.0 ms`
- `new_cron_safe`: p50 `81.8 ms`, p95 `85.5 ms`
- `update_cron_safe`: p50 `40.5 ms`, p95 `42.7 ms`

This confirms the intended behavior of the landed budgets:

- safe child mutations queue and complete within the shared bounded budget
- unsafe child mutations saturate loudly instead of quietly piling up
- sandbox execution saturates loudly instead of quietly piling up

## How to use this going forward

For general runtime regressions:

- use `bun run harness:starvation`
- watch startup totals, `openWorktree` percentiles, memory snapshots, and cache/retry counters
- treat `preemptedCount` as scheduler backpressure, not product failure

For bounded tool-path regressions:

- use `bun run benchmark:metidos-tools --json`
- compare safe latency distributions and unsafe/sandbox saturation counts against the baseline docs

## Conclusion

The audit-era performance measurement gap is now closed.

Metidos still has future optimization work, but it no longer lacks repeatable evidence for the broad runtime path or the highest-risk Metidos tool paths.
