# 2026-04-12 Execution Boundary Hardening Follow-up

This note closes the audit follow-up around unsafe-mode prevalence and the vm2-backed `run_untrusted_js` boundary.

## Why this is enough to close the risk

The open audit risk was not "Metidos will never revisit vm2" and it was not "unsafe mode can never be used again."

The open risk was that the current product still:

- defaulted most new execution paths to unsafe mode,
- let safe threads reach concrete Bun/network escape hatches from the vm2 runner,
- and lacked enough runtime evidence to tell whether the highest-risk execution paths were bounded or quietly piling up.

That is now addressed.

## Landed boundary controls

### 1. Safe mode is now the default creation posture

New interactive threads, thread-start requests, and cron definitions now stay safe unless `unsafeMode` is explicitly requested through the admin-authorized backend path.

That means the historical `unsafe_mode_enabled` audit log prevalence is now a backward-looking signal from pre-hardening behavior, not the current default creation policy.

### 2. Safe threads cannot escalate into unsafe children

Safe threads now:

- do not receive `bash`,
- cannot create unsafe child threads,
- cannot create unsafe cron jobs,
- and cannot update safe child resources into unsafe ones later.

Those denials are regression-tested in the Metidos-tool suite, and explicit unsafe requests are counted in runtime stats instead of disappearing into logs only.

### 3. The concrete safe-thread vm2 escapes from the audit are closed

The narrowed vm2 slice removed the three concrete bypasses that were proven locally in the audit:

- ambient `fetch`
- unscoped `Bun.file`
- unscoped `Bun.SQLite`
- unscoped `Bun.Glob`

The targeted sandbox-surface regressions now fail if safe-thread sandbox code can:

- read outside the worktree with `Bun.file(...)`,
- write outside the worktree with `Bun.SQLite`,
- or make network requests through `fetch(...)`.

### 4. High-risk execution paths are bounded and measurable

Unsafe child-thread mutations, unsafe cron mutations, and sandbox runs now use shared bounded budgets with loud saturation failures.

That means the current runtime no longer silently piles up the highest-risk execution paths:

- saturation is explicit to the caller,
- counters are emitted through `runtime-stats.ts`,
- and the repeatable benchmark in [docs/2026-04-12-metidos-tool-load-benchmark-baseline.md](./2026-04-12-metidos-tool-load-benchmark-baseline.md) records the current safe-versus-unsafe and sandbox saturation story.

## What remains future work rather than an open audit risk

This closeout does **not** claim that:

- vm2 is an ideal long-term isolation technology,
- unsafe mode is desirable as a product default,
- or future security review on execution boundaries is unnecessary.

The remaining questions are narrower and architectural:

- whether vm2 should eventually be replaced,
- whether the Bun-specific vm2 compatibility patch continues to be maintainable,
- and whether future telemetry shows unsafe-mode usage drifting back upward in practice.

Those are valid future design and maintenance concerns, but they are no longer the same as the original open audit risk about today's execution boundaries being too broad and too weakly evidenced.

## Conclusion

The execution-boundary audit risk is now closed.

Metidos still has future security and architecture work, but the acute 2026-04-12 audit concerns around unsafe-mode defaults, concrete vm2 safe-thread escapes, and unbounded high-risk execution paths are now addressed by landed code, targeted regressions, and repeatable runtime evidence.
