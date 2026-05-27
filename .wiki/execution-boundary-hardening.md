# Execution Boundary Hardening

This page records the durable execution-boundary hardening that closed the 2026-04-12 audit follow-up around unsafe-mode prevalence and unsafe child execution. **Observed:** new threads, thread-start requests, and cron jobs now default to safe mode unless a local-operator-authorized path explicitly requests `unsafeMode`; safe threads no longer receive `bash` or unsafe child escalation paths; the old vm2-backed `run_untrusted_js` path has been retired from current Metidos; and high-risk child-thread and cron mutation paths run behind shared bounded budgets with runtime-stats visibility. **Recommended durable rule:** treat these controls as the minimum security contract for Metidos execution boundaries unless a later execution architecture deliberately replaces them.

## Summary

- Safe mode is now the default posture for new interactive threads, thread-start requests, and cron definitions.
- Safe threads cannot escalate into unsafe children later through thread creation, cron creation, or metadata updates.
- The specific vm2 safe-thread escape vectors proven in the audit were closed before the old `run_untrusted_js` path was retired.
- Current structured boundaries carry the durable lessons forward: safe threads do not receive bash; SQLite and hosted-web-server helpers are project-scoped; plugin APIs require declared permissions; and network-capable surfaces are exposed only through explicit access families.
- Unsafe child-thread and unsafe cron mutations use bounded shared budgets with explicit saturation failures and runtime-stats counters.

## Problem

The 2026-04-12 audit follow-up was concerned with current execution boundaries being too broad and too weakly evidenced, not with proving that vm2 is permanently sufficient.

The concrete risks were:

- too many new execution paths still defaulted to unsafe mode,
- safe threads could still reach concrete Bun or network escape hatches from the now-retired `run_untrusted_js` path,
- and the highest-risk execution paths could accumulate without clear runtime evidence or bounded failure modes.

Without a durable wiki page, future work would need to rediscover which risks were actually closed versus which questions remain longer-term architectural concerns.

## Current state

### Safe mode is the default creation posture

**Observed:** newly created interactive threads, start requests, and cron definitions remain safe unless `unsafeMode` is explicitly requested through an authorized backend path.

Durable implication:

- historical `unsafe_mode_enabled` audit-log prevalence is a backward-looking signal from pre-hardening behavior,
- not evidence that current creation defaults remain unsafe.

### Safe threads cannot escalate into unsafe children

**Observed:** safe threads now:

- do not receive `bash`,
- cannot create unsafe child threads,
- cannot create unsafe cron jobs,
- and cannot later mutate safe child resources into unsafe ones.

Durable policy:

- safe execution contexts must not be able to upgrade themselves or their descendants into broader host access.

This complements the broader access-boundary rules preserved in [thread-tool-access-controls](./thread-tool-access-controls.md).

### Retired vm2 escape hatches remain a design warning

**Observed:** the narrowed vm2 follow-up removed the concrete bypasses proven locally in the audit, and the vm2-backed `run_untrusted_js` path is no longer present in the current tree.

Historical escape surfaces named by the source note:

- ambient `fetch`
- unscoped `Bun.file`
- unscoped `Bun.SQLite`
- unscoped `Bun.Glob`

Durable expectation if Metidos ever adds another untrusted-code execution surface:

- safe-thread sandbox code stays scoped to the worktree,
- cannot open network access by default,
- and cannot reach Bun-backed filesystem or SQLite capabilities outside the intended boundary.

### High-risk execution paths are now bounded and measurable

**Observed:** unsafe child-thread and unsafe cron mutations now consume shared bounded budgets.

Durable behavior:

- saturation fails loudly to the caller instead of disappearing into logs,
- counters are emitted through the shared runtime-stats path,
- and execution-boundary health can be measured through repeatable runtime evidence rather than anecdotal observation.

The source note explicitly ties this closeout to the time-bound benchmark preserved in [2026-04-12-metidos-tool-load-benchmark-baseline](./2026-04-12-metidos-tool-load-benchmark-baseline.md).

## Validation

**Observed:** targeted regression coverage now exists for current structured tool and access boundaries.

Expected verification shape after future boundary changes:

1. Create a safe thread and confirm `bash` is absent.
2. Confirm the thread cannot create unsafe child threads or unsafe cron jobs.
3. Run project-scoped SQLite and plugin SQLite regressions that attempt `ATTACH`, `VACUUM INTO`, extension loading, and outside-root database paths.
4. Confirm project-scoped WebServer and file-like tool paths remain inside the worktree.
5. Exercise bounded unsafe child-thread and cron budgets until saturation and confirm failures are explicit and runtime stats record the event.

## What this page does not claim

This closeout does **not** claim that:

- unsafe mode should remain part of the product forever,
- or future security review of execution boundaries is unnecessary.

Those remain valid design and maintenance questions, but they are narrower than the original audit risk about the current product's default posture and proven safe-thread escape paths.

## Risks and follow-up questions

Remaining future work noted by the source:

- whether a future untrusted-code execution surface should exist at all,
- whether future telemetry shows unsafe-mode usage drifting upward again.

Recommended maintenance rule:

- treat increased unsafe-mode prevalence, weakened sandbox scoping, or unbounded high-risk execution paths as regressions against the current security baseline.

## Related pages

- [run-untrusted-js-isolation](./run-untrusted-js-isolation.md) — historical record of the retired `run_untrusted_js` / vm2 audit and the escape classes that should not be reintroduced.
- [thread-tool-access-controls](./thread-tool-access-controls.md) — durable thread access and escalation boundaries.
- [pi-coding-agent-migration](./pi-coding-agent-migration.md) — higher-level split where Metidos owns safety policy while Pi owns core runtime/tooling surfaces.
- [local-auth-hardening](./local-auth-hardening.md) — related 2026-04-12 hardening record for the local auth surface.
- [2026-04-12-metidos-tool-load-benchmark-baseline](./2026-04-12-metidos-tool-load-benchmark-baseline.md) — time-bound benchmark snapshot for bounded thread and cron tool budgets introduced by the hardening work.

## Source

- Source note ingested from `docs/2026-04-12-execution-boundary-hardening-follow-up.md` on 2026-04-19.
