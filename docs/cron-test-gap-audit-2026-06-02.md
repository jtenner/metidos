# Cron test gap audit (2026-06-02)

This audit identifies cron-related tests still missing before publishing the repository. It is scoped to repository tests only; it does not validate a clean install or package-script smoke run.

## Existing coverage observed

- `src/shared/cron-utc.test.ts` covers cron parsing, normalization, invalid expressions, and UTC conversion.
- `src/bun/cron-schedules.test.ts` covers next-run computation from UTC-expanded schedules.
- `src/bun/project-procedures.cron.test.ts` covers invalid cron schedule rejection on create and update without persisting invalid schedules.
- `src/bun/project-procedures.workspace-scope.test.ts` covers regular-user visibility for cron jobs whose project/worktree path is visible.
- `src/bun/rpc-handlers/cron.test.ts` covers scheduler sync after cron create/update and no sync for list/manual-run RPC delegation.
- `src/bun/sidecar-cron-scheduler.test.ts` covers registering enabled jobs, stopping jobs on shutdown, re-registering updated jobs, removing disabled jobs, and timezone sync removal/re-registration behavior.
- `src/bun/sidecar-cron-runner.test.ts` covers cron run creation/execution behavior with the runtime test provider, including persisted run/thread metadata paths.
- `src/mainview/app/cron-describe-thread-access.test.ts` and `src/mainview/app/use-access-permissions.test.ts` cover small cron permission/access projection helpers.

## Missing tests to add before public release

1. **Cron procedure input and capacity validation**
   - Add focused tests for missing/blank prompt, title, description, and schedule inputs in `newCronProcedure` and `updateCronProcedure`.
   - Add tests for max-length errors on schedule, prompt, title, and description.
   - Add tests for `MAX_CRON_JOBS`, `MAX_ACTIVE_CRON_JOBS`, and expanded-handle limits so contributors get deterministic errors instead of scheduler/database surprises.

2. **Cron manual-run procedure edge cases**
   - Add tests for `runCronNowProcedure` when the cron job is missing, deleted, already `InProgress`, or has an active cron-owned thread.
   - Assert the public error text stays deterministic and safe.
   - Assert manual run does not require step-up but remains scoped to the caller-visible cron job.

3. **Cron authorization and ownership boundaries**
   - Add route/procedure-level tests proving regular users cannot list, update, delete, or manually run cron jobs outside their visible project/worktree scope.
   - Cover deleted/untracked worktree contexts and missing user/project handling.
   - Include local-operator/admin contrast cases so the intended threat model is explicit.

4. **Cron store persistence boundaries**
   - Add direct `cron-store` tests for bound singleton database use, deleted-job filtering, due-job filtering, stale `lastRunAt`/`lastRunStatus` values, active cron thread detection, and stop-in-progress run transitions.
   - Cover disabled/deleted jobs in due selection separately from scheduler registration tests.

5. **Cron scheduler/runner failure and concurrency paths**
   - Add tests for invalid schedules already stored in the database during scheduler startup/sync so one bad row does not prevent other cron jobs from registering.
   - Add tests for overlapping scheduled/manual triggers to prove only one run starts and the losing trigger reports/records a safe failure.
   - Add tests for runner failures before thread creation, during thread creation, and during runtime execution, including run status and telemetry/counter updates.

6. **Cron mainview composition tests**
   - The existing mainview cron coverage is helper-level only. Add controller/composition tests for the cron workspace that mock RPC calls and cover loading, refresh invalidation, create/edit/delete/disable/run-now busy states, mutation failures, permission/workspace summaries, and empty states.

## Notes

These gaps are intentionally split into small slices so future agent runs can add one test file or one narrow behavior group at a time. The related active TODOs in `agent-todo.md` should reference this audit instead of re-discovering the same gaps.
