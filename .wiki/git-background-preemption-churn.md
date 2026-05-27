# Git Background Preemption Churn

## Summary

Observed on 2026-05-01: Metidos already measures foreground preemption of background git work in the starvation harness and runtime diagnostics. The available benchmark evidence shows scheduler backpressure under intentional pressure, but not unexpected failures or product-facing breakage. No mitigation task is justified until future telemetry shows repeated preemption churn during normal UI flows.

Related pages:

- [performance-validation-workflow](./performance-validation-workflow.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [runtime-stats-collector](./runtime-stats-collector.md)

## Problem

The git scheduler protects interactive responsiveness by allowing foreground git commands to preempt background work. That policy is correct, but repeated foreground activity could waste background prefetch work if aborted jobs are immediately restarted and preempted again.

This note answers whether the current repository evidence points to a real production concern that needs implementation work.

## Current state

Observed code paths:

- `src/bun/git.ts` serializes git commands per normalized cwd and lets foreground commands abort active or queued background tasks with the label `Foreground git command preempted background work for <cwd>.`.
- `src/bun/starvation-harness.ts` recognizes that label separately from ordinary RPC failures via `isGitBackgroundPreemptionStatus()`.
- The pressure loop in `src/bun/starvation-harness.ts` intentionally sends `openWorktree`, `getWorktreeGitCommitDiff`, and `listWorktreeGitHistory` with background priority, so foreground startup and setup work can expose preemption behavior without counting it as an unexpected failure.
- Runtime diagnostics surface history-cache preemptions through `runtimeStatsSummary.gitCache.historyPage.preemptions`, and the human-readable harness output prints the same counter.

## Measurement evidence

The durable local performance workflow already records a representative starvation-harness run from 2026-04-13:

- pass: `true`
- pressure loops completed: `27`
- pressure loops preempted: `8`
- pressure loops failed unexpectedly: `0`
- preemptions by label: `openWorktree: 8`
- git history cache counters after pressure: `rangeHits=27`, `fetches` tracked, and `preemptions` reported by the harness output

Interpretation: the current measurement path can detect git-scheduler backpressure, and the representative pressure run showed expected preemption under synthetic load without unexpected failures. That is a signal to keep watching the counter, not evidence that foreground responsiveness should be weakened.

A fresh isolated 2026-05-01 harness attempt did not produce a comparable benchmark because the local temporary server exited during bootstrap with an unrelated `Cannot use a closed database` startup error after the web-server share worker started. That failed run is not evidence about git scheduler behavior.

## Decision

No code mitigation is needed for this task.

Rationale:

- The scheduler invariant is correct: foreground git work must continue to win over background prefetch.
- Existing diagnostics already separate preemptions from unexpected failures.
- The available representative run shows preemptions only under intentional pressure and records zero unexpected loop failures.
- There is no current measurement showing repeated restart/preempt cycles during ordinary UI flows.

## Future trigger for implementation work

Create a follow-up implementation task only if telemetry or a reproducible benchmark shows one of these conditions during normal UI usage:

- repeated preemption bursts for the same worktree while foreground latency remains healthy but background cache effectiveness drops,
- history-cache preemption counters rising without corresponding cache hits or completed fetches,
- user-visible stale git history caused by background cache warmup never completing,
- or measurable CPU/process churn from repeatedly restarted background git commands.

Likely mitigations remain conservative: per-worktree cooldown before restarting background warmup, debounce of background cache requests, or cache-aware resumable prefetch. Any mitigation must preserve foreground preemption semantics.

## Validation

For future checks, run the standard workflow from [performance-validation-workflow](./performance-validation-workflow.md):

```bash
bun run harness:starvation --port <port> --project-path /home/metidos/Projects/jt-ide --workers 3 --warmup-ms 300 --duration-ms 3000 --json
```

Then inspect:

- `pressure.preemptedCount`
- `pressure.preemptionCountByLabel`
- `runtimeStatsSummary.gitCache.historyPage.preemptions`
- completed pressure-loop counts and unexpected failures
