# Cron test gap audit (2026-06-02)

This audit identifies cron-related tests still missing before publishing the repository. It is scoped to repository tests only; it does not validate a clean install or package-script smoke run.

## Existing coverage observed

- `src/shared/cron-utc.test.ts` covers cron parsing, normalization, invalid expressions, and UTC conversion.
- `src/bun/cron-schedules.test.ts` covers next-run computation from UTC-expanded schedules.
- `src/bun/project-procedures.cron.test.ts` covers invalid cron schedule rejection on create and update without persisting invalid schedules, blank and oversized create/update fields, total and enabled cron job capacity limits, deterministic rejection when a timezone-expanded schedule exceeds the per-job handle limit, and manual-run edge cases for missing/deleted/active jobs, no-step-up routing, and regular-caller visible project scope.
- `src/bun/project-procedures.workspace-scope.test.ts` covers regular-user visibility for cron jobs whose project/worktree path is visible.
- `src/bun/rpc-handlers/cron.test.ts` covers scheduler sync after cron create/update and no sync for list/manual-run RPC delegation.
- `src/bun/sidecar-cron-scheduler.test.ts` covers registering enabled jobs, stopping jobs on shutdown, re-registering updated jobs, removing disabled jobs, and timezone sync removal/re-registration behavior.
- `src/bun/sidecar-cron-runner.test.ts` covers cron run creation/execution behavior with the runtime test provider, including persisted run/thread metadata paths.
- `src/bun/cron-store.test.ts` covers bound database use, `list`/`listActive`/`getById` soft-delete visibility, due scheduled job filtering for disabled/deleted jobs, stale last-run/in-progress state, active cron thread detection, scheduled/manual claim gates, returned claim metadata, and stop-in-progress run transitions.
- `src/mainview/app/cron-describe-thread-access.test.ts` and `src/mainview/app/use-access-permissions.test.ts` cover small cron permission/access projection helpers.

## Missing tests to add before public release

1. **Cron authorization and ownership boundaries**
   - Add route/procedure-level tests proving regular users cannot list, update, delete, or manually run cron jobs outside their visible project/worktree scope.
   - Cover deleted/untracked worktree contexts and missing user/project handling.
   - Include local-operator/admin contrast cases so the intended threat model is explicit.

2. **Cron scheduler/runner failure and concurrency paths**
   - Add tests for invalid schedules already stored in the database during scheduler startup/sync so one bad row does not prevent other cron jobs from registering.
   - Add tests for overlapping scheduled/manual triggers to prove only one run starts and the losing trigger reports/records a safe failure.
   - Add tests for runner failures before thread creation, during thread creation, and during runtime execution, including run status and telemetry/counter updates.

3. **Cron mainview composition tests**
   - The existing mainview cron coverage is helper-level only. Add controller/composition tests for the cron workspace that mock RPC calls and cover loading, refresh invalidation, create/edit/delete/disable/run-now busy states, mutation failures, permission/workspace summaries, and empty states.

## Notes

These gaps are intentionally split into small slices so future agent runs can add one test file or one narrow behavior group at a time. The related active TODOs in `agent-todo.md` should reference this audit instead of re-discovering the same gaps.
