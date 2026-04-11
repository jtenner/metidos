# 2026-04-11 OPT01.3 Baseline Benchmark Write-up

**Status:** completed on 2026-04-11  
**Slice:** [OPT01.3](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt01-1-runtime-stats-collector-proposal.md](./2026-04-11-opt01-1-runtime-stats-collector-proposal.md)
- [docs/2026-04-11-opt01-2-harness-percentile-memory-reporting.md](./2026-04-11-opt01-2-harness-percentile-memory-reporting.md)

## Summary

This document records the **first repeatable baseline run** using the new runtime-stats collector and the enhanced starvation harness.

The baseline is intentionally modest and local:
- single local server process
- dev mode with auth bypass so the harness can connect directly
- isolated temporary app-data directory
- current repository worktree as the target project
- short warmup and short pressure window

This is enough to establish a **repeatable comparison workflow** for future optimization slices. It is not meant to be a universal performance certification number.

## Baseline environment

- **Date:** 2026-04-11
- **Project:** current `metidos` worktree at `/home/jtenner/Projects/jt-ide`
- **Server mode:** dev mode with auth bypass
- **App data:** temporary isolated `METIDOS_APP_DATA_DIR`
- **Public port:** `7611`
- **Harness mode:** JSON report mode

## Exact workflow used

### 1. Build CSS

```bash
METIDOS_APP_DATA_DIR="$APP_DATA_DIR" \
METIDOS_DEV=1 \
METIDOS_DEV_BYPASS=1 \
bun run tailwind:build
```

### 2. Start the server

```bash
METIDOS_APP_DATA_DIR="$APP_DATA_DIR" \
METIDOS_DEV=1 \
METIDOS_DEV_BYPASS=1 \
bun run src/bun/index.ts --dev --port 7611
```

### 3. Run the harness

```bash
bun run src/bun/starvation-harness.ts \
  --port 7611 \
  --project-path /home/jtenner/Projects/jt-ide \
  --workers 3 \
  --warmup-ms 300 \
  --duration-ms 3000 \
  --json
```

## Why this baseline shape was chosen

This baseline intentionally uses:
- **dev auth bypass** so the harness can measure the transport/procedure path without needing browser-auth/session setup,
- **temporary app data** so the run is isolated and repeatable,
- **short duration** so it is cheap enough to repeat during development,
- **current repo as the project** because it exercises real Git history, diff, and worktree paths.

This means the baseline is best understood as:

> a repeatable local regression-check baseline for Metidos internals,

not as:

> an end-user production benchmark.

## Reported result

The representative baseline run **passed** all configured startup budgets.

### Configured budgets

- HTTP per-endpoint budget: **3000 ms**
- RPC per-request budget: **5000 ms**
- Total startup budget: **12000 ms**

### Startup totals

- **Startup total:** `84.3 ms`
- **getAppBootstrap:** `53.9 ms`
- **openWorktree:** `29.2 ms`

### Startup HTTP timings

| Endpoint | Duration |
|---|---:|
| `/health` | `0.19 ms` |
| `/` | `0.94 ms` |
| `/index.js` | `0.33 ms` |
| `/index.css` | `0.86 ms` |

### Pressure summary

- **Workers:** `3`
- **Completed loops:** `31`
- **Failed loops:** `1`
- **Aborted loops:** `0`
- **Recorded failure label:** `openWorktree: 1`

## Pressure RPC percentiles

### `openWorktree`

- **count:** `31`
- **min:** `14.8 ms`
- **p50:** `31.2 ms`
- **p95:** `84.7 ms`
- **p99:** `91.7 ms`
- **max:** `91.7 ms`
- **mean:** `34.5 ms`

### `getWorktreeGitCommitDiff`

- **count:** `31`
- **min:** `0.25 ms`
- **p50:** `0.36 ms`
- **p95:** `14.0 ms`
- **p99:** `24.0 ms`
- **max:** `24.0 ms`
- **mean:** `1.90 ms`

### `listWorktreeGitHistory`

- **count:** `31`
- **min:** `0.13 ms`
- **p50:** `0.23 ms`
- **p95:** `2.18 ms`
- **p99:** `2.74 ms`
- **max:** `2.74 ms`
- **mean:** `0.54 ms`

## Memory snapshots

### Before warmup

- **rss:** `798,793,728` bytes (~`761.8 MiB`)
- **heapUsed:** `63,944,542` bytes (~`61.0 MiB`)
- **heapTotal:** `209,270,784` bytes (~`199.6 MiB`)
- **external:** `37,630,572` bytes (~`35.9 MiB`)

### After warmup

- **rss:** `811,687,936` bytes (~`774.1 MiB`)
- **heapUsed:** `165,032,406` bytes (~`157.4 MiB`)
- **heapTotal:** `209,618,944` bytes (~`199.9 MiB`)
- **external:** `139,831,703` bytes (~`133.4 MiB`)

### After pressure

- **rss:** `818,847,744` bytes (~`780.9 MiB`)
- **heapUsed:** `187,598,400` bytes (~`178.9 MiB`)
- **heapTotal:** `209,812,480` bytes (~`200.1 MiB`)
- **external:** `160,296,817` bytes (~`152.9 MiB`)

## Runtime stats snapshot after pressure

### RPC totals

- **calls:** `96`
- **succeeded:** `95`
- **failed:** `1`
- **timed out:** `0`
- **canceled:** `0`
- **method count:** `4`
- **request bytes:** `18,411`
- **response bytes:** `601,366`
- **peak duration:** `91.58 ms`
- **total measured duration:** `1259.33 ms`

### RPC totals by method

| Method | Calls | Success | Fail | Peak | Response bytes |
|---|---:|---:|---:|---:|---:|
| `getAppBootstrap` | `1` | `1` | `0` | `53.56 ms` | `36,160` |
| `openWorktree` | `33` | `32` | `1` | `91.58 ms` | `155,392` |
| `getWorktreeGitCommitDiff` | `31` | `31` | `0` | `23.73 ms` | `270,658` |
| `listWorktreeGitHistory` | `31` | `31` | `0` | `0.91 ms` | `139,156` |

### SQLite retry totals

- **loops with retry:** `0`
- **total retries:** `0`
- **exhausted retry loops:** `0`
- **peak retry count:** `0`
- **total backoff:** `0 ms`

### Git cache totals

#### Git history cache
- **cache range hits:** `31`
- **fetches:** `6`
- **prefetch waits:** `0`
- **preemptions:** `0`

#### Commit diff cache
- **hits:** `29`
- **misses:** `1`
- **pending reuse:** `1`
- **stores:** `1`

### Websocket push totals

No websocket push activity was recorded during this harness run:
- **messages:** `0`
- **type count:** `0`
- **payload bytes:** `0`

## Initial interpretation

### 1. `openWorktree` is the dominant measured pressure path

The startup and pressure data both show `openWorktree` as the expensive operation in this short benchmark shape.

That does **not** prove the implementation is wrong, but it does identify the first obvious place to look when later slices pursue Git/worktree and derived-state optimizations.

### 2. The existing Git caches are already buying something

The after-pressure runtime stats show:
- many history cache range hits,
- one diff miss followed by many diff hits,
- one in-flight diff reuse event.

That supports the earlier planning decision to **defer** a more aggressive persistent git-cache project until later evidence says otherwise.

### 3. SQLite contention did not show up in this run

No SQLite retries were recorded. That means:
- the new retry instrumentation is working,
- but this specific baseline does not yet stress SQLite enough to justify conclusions about DB contention.

That is still useful. It gives later DB slices a “before” number.

### 4. There was one pressure failure on `openWorktree`

This run recorded one failed pressure loop labeled `openWorktree`.

For now, this should be treated as part of the baseline rather than immediately explained away. Future runs should watch whether:
- the same single-failure pattern repeats,
- it disappears,
- or it grows under more pressure.

That trend matters more than a single local explanation guess.

## How to use this baseline later

Future optimization slices should repeat the same general flow:

1. use dev mode with auth bypass,
2. use a temporary `METIDOS_APP_DATA_DIR`,
3. run the same harness command shape,
4. compare against the metrics above,
5. explain materially different results in the slice document or commit notes.

### Minimum comparison points for later slices

Later slices should at least compare:
- startup total
- `getAppBootstrap` startup latency
- `openWorktree` pressure p50/p95/p99
- pressure failure count
- runtime RPC totals
- SQLite retry totals
- git cache hit/miss totals
- memory `rss` and `heapUsed` after pressure

## Limitations of this baseline

- It is a **local development** benchmark, not a CI benchmark.
- It uses **dev auth bypass**, so it does not measure browser-auth/session flows.
- It measures one repository shape: the current Metidos worktree.
- It uses a short pressure window, which is good for repeatability but not enough for long-duration memory analysis.
- It does not yet record historical series over time.

Those limitations are acceptable for the first baseline. The point here is to establish a stable comparison ritual, not to solve every measurement problem at once.

## Completion note

With this document in place, the full `OPT01` chain is now materially established:

- `OPT01.1` created the runtime collector,
- `OPT01.2` made the harness consume it,
- `OPT01.3` recorded the first repeatable baseline.

That is enough groundwork to move on to the next optimization slice with real measurements available.
