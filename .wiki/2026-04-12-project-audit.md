# 2026-04-12 Project Audit: Risks, Bugs, and Problems

## Summary

This page preserves the durable outcome of the 2026-04-12 whole-project audit. **Observed:** the source audit reviewed Metidos across backend, mainview, auth, the then-current vm2 sandbox, Pi integration, cron, repository policy, and validation/test coverage. **Observed:** most acute 2026-04-12 audit risks were later closed the same day and now have narrower durable pages of their own; the vm2-backed `run_untrusted_js` path was later retired from the live tree. **Recommended durable use:** treat this page as the time-bound top-level audit snapshot that records what was reviewed, which risks became historical, and which longer-lived maintenance concerns still matter.

## Scope and review process

The source document described a repo-wide audit pass that:

- explored the project structure across `src/bun/`, `src/mainview/`, `docs/`, `.metidos/`, and related policy/docs files,
- searched for explicit TODO/FIXME/BUG markers,
- ran static checks, type checks, and the full test suite,
- reviewed security audit logs, auth, vm2, RPC authz, Git scoping, Pi wiring, cron sidecars, and mainview state,
- and sampled large implementation files such as `src/mainview/App.tsx`, the now-removed `src/bun/vm2-runner.ts`, `src/bun/auth/service.ts`, and tool/runtime integration code.

The source explicitly reported that the validation pass succeeded at the time of the audit, with broad test coverage and no immediately failing checks.

## Problem

The source was not trying to prove that Metidos was broken. The audit problem was narrower:

- capture the highest-risk architectural and operational concerns in one place,
- distinguish acute security/performance gaps from ordinary future maintenance work,
- and decompose actionable follow-up into durable repo records.

Without a durable synthesis, later work would need to rediscover which 2026-04-12 concerns were still open, which were already closed, and which belonged to longer-term architecture rather than urgent remediation.

## Current state recorded by the audit

### Validation and test posture

**Observed:** the audit found strong baseline engineering hygiene for the reviewed tree:

- static checks and tests passed,
- security, sandbox, auth, Pi integration, and UI-state tests already existed,
- database access used parameterized SQL,
- Git and path scoping logic was already defensive,
- and the codebase already carried explicit audit, telemetry, and validation surfaces.

Durable interpretation: the main risks were concentrated in architecture, boundary complexity, and operational posture, not in obvious failing checks or absent tests.

### High-level system strengths

The source repeatedly called out strengths worth preserving:

- strong test coverage around auth, the then-current vm2 escape fixes, tool scoping, and Pi integration,
- explicit local-auth and step-up security design,
- defensive path normalization and scope checks,
- runtime telemetry foundations,
- and a willingness to document and benchmark risky paths rather than relying on intuition.

## Main findings

### 1. Mainview shell complexity was the top maintainability risk

**Observed in the audit:** `src/mainview/App.tsx` was still very large and held too much state, rendering, orchestration, and helper logic.

Durable conclusion:

- large shell files raise cognitive load, merge-conflict pressure, and rerender/debugging risk,
- controller extraction and derived-state cleanup were the correct direction,
- and shell modularity should remain an explicit maintenance goal even after the first refactors landed.

**Observed update from the source:** by the end of 2026-04-12, additional controller extraction had already reduced the remaining shell-level knot and materially lowered this risk.

Related pages:

- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)
- [optimization-execution-proposal](./optimization-execution-proposal.md)

### 2. Unsafe-mode prevalence was an audit concern, but the acute risk was closed

**Observed in the source:** audit logs showed historically heavy `unsafeMode` usage, which had expanded the execution surface.

**Observed update from the source:** the active risk was closed on 2026-04-12 through:

- safe-by-default thread and cron creation,
- blocking safe-thread escalation into unsafe children,
- explicit admin/authorized backend handling for unsafe requests,
- and runtime telemetry for unsafe requests and high-risk tool paths.

Durable conclusion: historical audit-log prevalence remains useful context, but it should not be treated as the current creation posture.

Related page:

- [execution-boundary-hardening](./execution-boundary-hardening.md)

### 3. The retired vm2 path remains a design warning

**Observed in the source:** the audit considered vm2 historically risky because Metidos then ran untrusted JavaScript and the safe sandbox had a large custom filesystem and Bun-compatibility surface.

**Observed update:** the concrete safe-thread escape vectors identified in the audit were already removed and regression-tested by the end of the day, including ambient network and unscoped Bun-host access that did not belong in the safe sandbox. Current Metidos has also retired the `run_untrusted_js` / vm2 path entirely.

Durable conclusion:

- the acute boundary failure was closed,
- the live product no longer carries that vm2 helper surface,
- and any future untrusted-code execution surface should be treated as new architecture work, not as evidence that the 2026-04-12 audit remained unresolved.

Related pages:

- [execution-boundary-hardening](./execution-boundary-hardening.md)
- [performance-validation-workflow](./performance-validation-workflow.md)

### 4. Performance risk shifted from unknowns to measured maintenance work

**Observed in the source:** Metidos had already accumulated multiple performance-related fixes and proposals around mainview rerenders, SQLite contention, RPC payload size, cron concurrency, and telemetry.

**Observed update from the source:** by the end of 2026-04-12, the major evidence gap was closed through:

- runtime stats and optional sidecar persistence,
- a stronger starvation-harness workflow,
- and a bounded Metidos-tool benchmark for child-thread, cron, and sandbox pressure paths.

Durable conclusion: performance remained an engineering area, but later optimization work should build on the benchmarked workflow rather than relitigating whether measurement exists.

Related pages:

- [performance-validation-workflow](./performance-validation-workflow.md)
- [2026-04-12-metidos-tool-load-benchmark-baseline](./2026-04-12-metidos-tool-load-benchmark-baseline.md)
- [runtime-stats-collector](./runtime-stats-collector.md)
- [track-telemetry-sidecar-db](./track-telemetry-sidecar-db.md)

### 5. Auth and user-management design was strong but operationally sensitive

**Observed in the source:** the auth stack was large and highly orchestrated, with strong tests and generally careful security behavior.

The audit still identified durable operational concerns:

- `auth-service.ts` had become monolithic,
- `auth-secret.key` remained critical operational state,
- custom TOTP behavior required clear documentation and tests,
- multi-user migration compatibility increased complexity,
- and unsafe-mode use after authentication remained security-sensitive even though creation defaults were being hardened.

**Observed update from the source:** the auth hardening follow-up later closed the lockout race, tightened primary-factor setup/reset requirements, documented `auth-secret.key` recovery behavior, constrained new usernames for per-user workspace homes, and added loopback HTTP auth rate limiting.

Durable conclusion: the auth posture was already security-minded, but key management, TOTP policy, and service-boundary maintainability remain long-lived concerns.

Related page:

- [local-auth-hardening](./local-auth-hardening.md)

### 6. Pi SDK and sidecar coupling is a durable integration risk

**Observed:** Metidos intentionally depends on Pi for provider/model/session/tool runtime concerns while retaining its own app shell, project/worktree model, auth, cron orchestration, and UI.

Durable conclusion:

- this split is intentional and still sound,
- but upstream Pi changes can break event projection, tool/runtime assumptions, telemetry extraction, or session behavior,
- so Metidos should continue centralizing Pi-owned payload knowledge and testing Bun-runtime compatibility explicitly.

Related page:

- [pi-coding-agent-migration](./pi-coding-agent-migration.md)

### 7. Lower-level observations

The source also recorded several lower-priority but durable observations:

- future-dated 2026 fixtures/docs imply time-sensitive behavior should keep using explicit validation rather than assumptions,
- the UI intentionally exposes many warning/error states because the runtime has many safety and edge-case boundaries,
- and the single-process Bun server still concentrates WebSocket RPC, SQLite, Git filesystem operations, worker activity, cron scheduling, and telemetry in one runtime.

These are not by themselves unresolved audit failures, but they are useful operating context.

## Open versus closed audit items

### Closed by the end of 2026-04-12

The source explicitly treated these as closed or substantially closed by linked follow-up work:

- safe-by-default thread/cron creation posture,
- safe-thread anti-escalation into unsafe children,
- concrete vm2 safe-thread escape paths proven during the audit, later made historical by retiring the `run_untrusted_js` path,
- the broad performance/load-evidence gap,
- major auth hardening gaps such as lockout accounting and weak primary-factor defaults,
- and the remaining mainview shell selection/workspace/startup knot that had kept `App.tsx` oversized.

### Still durable maintenance concerns

The source left these as ordinary future engineering concerns rather than urgent unresolved audit failures:

- continuing to decompose monolithic files and dense orchestration boundaries,
- deciding whether any future untrusted-code execution surface should exist and what isolation model it would require,
- maintaining clear TOTP/key-management policy,
- tracking unsafe-mode adoption trends over time,
- and keeping Pi integration assumptions centralized and tested.

## Recommendations preserved from the audit

### Recommended priorities

1. Keep splitting monolithic orchestration boundaries where they still dominate maintainability cost.
2. Preserve the safe-by-default thread/cron posture and treat regressions as security issues.
3. Reuse the documented benchmark and telemetry workflow before and after runtime changes.
4. Treat any future untrusted-code execution surface as an architecture decision with explicit tradeoffs, not as an already-proven urgent defect.
5. Keep repo policy clear about generated local artifacts versus source-controlled files.

### Recommended operating rule

When future work references the 2026-04-12 audit, it should say whether it is addressing:

- a **closed historical audit finding**,
- a **current maintenance concern**,
- or a **new regression against the post-2026-04-12 baseline**.

That prevents older audit language from being misread as current product state.

## Related pages

- [execution-boundary-hardening](./execution-boundary-hardening.md)
- [run-untrusted-js-isolation](./run-untrusted-js-isolation.md)
- [local-auth-hardening](./local-auth-hardening.md)
- [performance-validation-workflow](./performance-validation-workflow.md)
- [2026-04-12-metidos-tool-load-benchmark-baseline](./2026-04-12-metidos-tool-load-benchmark-baseline.md)
- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)
- [optimization-execution-proposal](./optimization-execution-proposal.md)
- [pi-coding-agent-migration](./pi-coding-agent-migration.md)

## Source

Ingested from `docs/2026-04-12-project-audit-risks-bugs-problems.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
