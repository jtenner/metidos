# 2026-04-12 Metidos Tool Load Benchmark Baseline

## Summary

This page preserves the first repeatable local baseline captured on 2026-04-12 for bounded Metidos thread and cron tool paths introduced during the audit-remediation work. The original source also included a synthetic sandbox scenario for the now-retired `run_untrusted_js` path; current Metidos no longer exposes that tool and the live benchmark now covers thread and cron tools.

Observed result from the source benchmark: at the default benchmark concurrency, the safe child-thread and cron mutation paths completed all attempts without saturation, while the stricter unsafe child-operation budget allowed only one active success and then failed loudly with explicit saturation events. Recommended use: treat this benchmark as a narrow deterministic regression check for tool-budget behavior, not as a production-throughput benchmark.

Related pages:
- [execution-boundary-hardening](./execution-boundary-hardening.md)
- [thread-tool-access-controls](./thread-tool-access-controls.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [performance-validation-workflow](./performance-validation-workflow.md)

## Benchmark purpose

The source document established a separate benchmark shape from the broader starvation harness.

Observed durable goal:
- exercise the real Pi-backed Metidos thread and cron tool pack directly,
- avoid requiring a running Metidos server,
- compare safe and unsafe thread/cron mutation pressure through the real Pi-native Metidos tool pack,
- and fix cron-sensitive timestamps to absolute values so future runs compare like-for-like inputs.

Recommended interpretation:
- use this benchmark when validating bounded tool-path behavior,
- use the starvation harness for broader end-to-end runtime pressure.

## Exact workflow

Durable command preserved from the source:

```bash
bun run benchmark:metidos-tools --json
```

Observed default benchmark options:
- `--iterations 12`
- `--concurrency 4`
- `--hold-ms 20`

Observed fixed fixture timestamps:
- benchmark reference time: `2026-04-12T20:30:00.000Z`
- new-cron next run: `2026-04-13T06:15:00.000Z`
- updated-cron next run: `2026-04-14T18:45:00.000Z`

Durable rule preserved from the source: keep these timestamps explicit in the fixture so schedule-sensitive tool behavior is not benchmarked against ambiguous relative dates such as "today" or "next run".

## Representative baseline run

Observed representative run metadata from the source:
- local timestamp: `2026-04-12 21:24:01 EDT`
- UTC timestamp from the report: `2026-04-13T01:24:01.313Z`
- command: `bun run benchmark:metidos-tools --json`

## Safe versus unsafe results

### Safe paths stayed bounded without saturation

Observed at concurrency `4`:
- `new_thread_safe`: `12` completed, `0` failed, `0` saturations
- `new_cron_safe`: `12` completed, `0` failed, `0` saturations
- `update_cron_safe`: `12` completed, `0` failed, `0` saturations

Observed implication: the shared safe mutation budget queued work within its configured bounds rather than rejecting the benchmark load.

### Unsafe child paths saturated immediately

Observed at the same concurrency:
- `new_thread_unsafe`: `1` completed, `11` failed, `11` saturations
- `new_cron_unsafe`: `1` completed, `11` failed, `11` saturations
- `update_cron_unsafe`: `1` completed, `11` failed, `11` saturations

Observed implication: the stricter unsafe-child budget is intentionally a loud-fail guard, not a hidden queue builder.

## Runtime-stats counters recorded by the run

### Shared safe mutation budget

Observed counters for the successful safe scenarios on `thread_cron_mutations`:
- `startedCalls: 12`
- `completedCalls: 12`
- `queuedCalls: 10`
- `saturationEvents: 0`
- `peakActiveCount: 2`
- `peakPendingCount: 2`

Durable takeaway: safe thread/cron mutations are more permissive than unsafe-child operations, but still explicitly bounded and measurable.

### Unsafe child-operation budget

Observed counters:
- `unsafe_child_operations.startedCalls: 1`
- `unsafe_child_operations.completedCalls: 1`
- `unsafe_child_operations.saturationEvents: 11`
- `unsafe_child_operations.peakActiveCount: 1`
- `unsafe_child_operations.peakPendingCount: 0`

Current takeaway: unsafe child operations should continue to expose explicit saturation counters through the shared runtime-stats path when configured limits are exceeded.

## Representative successful-attempt latencies

Observed successful-attempt latency snapshots from the source report:
- `new_thread_safe`: `p50 122.9 ms`, `p95 137.0 ms`
- `new_thread_unsafe`: `p50 64.2 ms` on the single successful attempt
- `new_cron_safe`: `p50 81.6 ms`, `p95 85.4 ms`
- `new_cron_unsafe`: `p50 42.5 ms` on the single successful attempt
- `update_cron_safe`: `p50 40.7 ms`, `p95 42.9 ms`
- `update_cron_unsafe`: `p50 20.4 ms` on the single successful attempt

Recommended use of these latency numbers: compare them as local regression signals, but prioritize the behavioral invariants over absolute timings.

## Durable conclusions

### Safe and unsafe paths now have intentionally different pressure behavior

Observed conclusion from the source: under the same concurrency, safe paths queue within bounded limits while unsafe-child paths saturate immediately.

This is a deliberate product behavior difference, not an incidental benchmark artifact.

### The audit-remediation budgets are measurable in practice

Observed conclusion from the source: the benchmark confirms that the new budgets are not just policy on paper; they produce visible saturation failures and matching runtime-stats counters.

### Fixed absolute cron dates are part of the benchmark contract

Observed conclusion from the source: benchmark fixtures for cron creation and update should continue using concrete timestamps so schedule-shaped behavior stays comparable across runs.

## Recommended reuse

Use this benchmark first when changing:
- `src/bun/pi/metidos/shared.ts`
- `src/bun/pi/metidos/thread.ts`
- `src/bun/pi/metidos/cron.ts`
- `src/bun/runtime-stats.ts`

Recommended workflow:
1. run `bun run benchmark:metidos-tools --json`
2. compare completions, failures, saturations, and budget counters against this baseline
3. explain any material changes in the relevant wiki page, PR, or commit message
4. use `bun run harness:starvation` separately if the change also affects broader runtime pressure

## Limits of the baseline

Observed limits from the source:
- it is a local deterministic benchmark, not a production load test,
- it does not require or measure a live server,
- and it is intended to validate budget behavior more than throughput capacity.

These limits are acceptable because the source benchmark was explicitly designed as a fast regression harness for bounded tool paths.

## Source

Ingested from `docs/2026-04-12-metidos-tool-load-benchmark-baseline.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
