# 2026-04-11 OPT01 Baseline Benchmark

## Summary

This page preserves the first repeatable local baseline run captured on 2026-04-11 after the runtime stats collector and enhanced starvation harness landed.

Observed result from the source benchmark: a short local dev-mode run against the current Metidos worktree passed the configured startup budgets, showed `openWorktree` as the dominant pressure-path cost, recorded no SQLite retries, and showed that the existing git-history and commit-diff caches were already producing useful hits.

Recommended use: treat this benchmark as a regression-check baseline for later optimization slices, not as a production or end-user performance certification number.

Related pages:
- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)

## Benchmark purpose

The source document established a durable workflow goal rather than a one-off result: create a cheap, repeatable comparison ritual that later optimization slices can rerun and compare against.

The benchmark intentionally measured:
- one local server process
- dev mode in an isolated temporary app-data directory
- an isolated temporary `METIDOS_APP_DATA_DIR`
- the current repository worktree at `<path-to-local-metidos-worktree>`
- a short warmup and short pressure window

This means the baseline is best interpreted as an observed local internal-regression check for Metidos internals.

## Environment and command shape

Observed benchmark environment from the source:
- date: 2026-04-11
- server mode: dev mode with isolated app data
- public port: `7611`
- app data: temporary isolated `METIDOS_APP_DATA_DIR`
- harness mode: JSON report mode
- target project: the current Metidos worktree at `<path-to-local-metidos-worktree>`

Durable workflow shape preserved from the source:
1. build CSS with dev-mode environment and temporary app data
2. start the backend in dev mode on a fixed local port
3. run `src/bun/starvation-harness.ts` against that port and project path

Observed harness arguments for the representative run:
- `--workers 3`
- `--warmup-ms 300`
- `--duration-ms 3000`
- `--json`

## Startup budgets and representative results

Observed configured budgets:
- HTTP per-endpoint budget: `3000 ms`
- RPC per-request budget: `5000 ms`
- total startup budget: `12000 ms`

Observed startup totals from the representative passing run:
- startup total: `84.3 ms`
- `getAppBootstrap`: `53.9 ms`
- `openWorktree`: `29.2 ms`

Observed startup HTTP timings:
- `/health`: `0.19 ms`
- `/`: `0.94 ms`
- `/index.js`: `0.33 ms`
- `/index.css`: `0.86 ms`

## Pressure-phase observations

Observed pressure summary:
- workers: `3`
- completed loops: `31`
- failed loops: `1`
- aborted loops: `0`
- recorded failure label: `openWorktree: 1`

Observed representative pressure RPC percentiles:

### `openWorktree`
- count: `31`
- min: `14.8 ms`
- p50: `31.2 ms`
- p95: `84.7 ms`
- p99: `91.7 ms`
- max: `91.7 ms`
- mean: `34.5 ms`

### `getWorktreeGitCommitDiff`
- count: `31`
- min: `0.25 ms`
- p50: `0.36 ms`
- p95: `14.0 ms`
- p99: `24.0 ms`
- max: `24.0 ms`
- mean: `1.90 ms`

### `listWorktreeGitHistory`
- count: `31`
- min: `0.13 ms`
- p50: `0.23 ms`
- p95: `2.18 ms`
- p99: `2.74 ms`
- max: `2.74 ms`
- mean: `0.54 ms`

## Runtime-stats and memory takeaways

Observed runtime-stats snapshot after pressure:
- RPC totals: `96` calls, `95` succeeded, `1` failed, `0` timed out, `0` canceled
- peak measured RPC duration: `91.58 ms`
- request bytes: `18,411`
- response bytes: `601,366`
- SQLite retries: none recorded
- git history cache: `31` range hits and `6` fetches
- commit diff cache: `29` hits, `1` miss, `1` pending reuse, `1` store
- websocket push activity: none recorded during this run

Observed memory snapshots showed RSS and heap growth across warmup and pressure, ending after pressure at roughly:
- rss: `780.9 MiB`
- heapUsed: `178.9 MiB`

## Durable conclusions

### `openWorktree` is the main pressure-path cost in this benchmark shape

Observed conclusion from the source: both startup and pressure measurements made `openWorktree` the obvious first place to inspect in later Git/worktree and derived-state optimization slices.

This is an observed benchmark outcome, not proof that the implementation is necessarily wrong.

### Existing git caches were already helping

Observed conclusion from the source: history cache range hits, a single diff miss followed by many diff hits, and one in-flight diff reuse event support the planning decision to defer a broader persistent git-cache project until later evidence justifies it.

### SQLite contention did not appear in this run

Observed conclusion from the source: the retry instrumentation worked, but this specific benchmark shape did not stress SQLite enough to support broader contention claims.

### The single `openWorktree` failure should be treated as baseline data

Recommended interpretation from the source: keep watching whether the one recorded `openWorktree` pressure failure repeats, disappears, or grows under later runs instead of explaining it away from a single local snapshot.

## Reuse guidance for later slices

The source established this as the minimum repeatable comparison ritual for later optimization work:
- use dev mode with a temporary `METIDOS_APP_DATA_DIR`
- complete the real setup/login flow before authenticated harness actions
- use the same general starvation-harness command shape
- compare against the baseline metrics recorded here
- explain any material differences in the relevant slice notes or commit message

Minimum comparison points preserved from the source:
- startup total
- `getAppBootstrap` startup latency
- `openWorktree` pressure `p50`/`p95`/`p99`
- pressure failure count
- runtime RPC totals
- SQLite retry totals
- git cache hit/miss totals
- memory `rss` and `heapUsed` after pressure

## Limits of the baseline

Observed limits from the source:
- this is a local development benchmark, not a CI benchmark
- it did not measure browser-auth or session flows
- it measures one repository shape: the current Metidos worktree
- the short pressure window helps repeatability but is not enough for long-duration memory analysis
- it does not record historical series over time

These are acceptable limitations for the first baseline because the goal was to establish a stable comparison workflow.

## Source

Ingested from `docs/2026-04-11-opt01-3-baseline-benchmark.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
