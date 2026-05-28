# Cron jobs

Metidos Cron Jobs are recurring scheduled agent sessions tied to a Project and Worktree. They let the Local Operator run future Pi-powered work without manually starting each Thread.

## What a Cron Job contains

A Cron Job stores:

- title and description,
- Project id,
- Worktree path,
- schedule expression,
- prompt,
- provider-qualified model id,
- reasoning effort when supported,
- native Access Control permissions,
- plugin access groups,
- Unsafe Mode flag,
- enabled/deleted state,
- last run date and status,
- next run date.

## Scheduler and runner

Cron behavior is split across two responsibilities:

- **Cron Scheduler** keeps schedule registrations synchronized.
- **Cron Runner** turns due fires into child Threads and records run status.

A due run creates or updates a child Thread under the selected Project/Worktree context. The Thread then follows normal runtime policy for model selection, tools, permissions, plugin access groups, and unsafe constraints.

## Creating a job

Recommended first job process:

1. Start with a prompt you already tested in an interactive Thread.
2. Select the exact Project and Worktree.
3. Pick a provider-qualified model that is currently available.
4. Choose the minimum Access Control set.
5. Leave Unsafe Mode off unless the schedule truly needs shell or unsafe escalation.
6. Use a conservative schedule.
7. Save the job.
8. Use Run now once to validate behavior before relying on future fires.

## Run now behavior

Run now triggers the same execution path as a scheduled fire, but immediately. It is useful for validating prompt wording, model availability, provider credentials, plugin access, and worktree state.

If Run now fails, inspect the child Thread and the cron status before waiting for the next scheduled fire.

## Disabling and deletion

Use **Disable** when a job should stop firing but its configuration and history should remain available. Disable jobs before:

- changing provider credentials they rely on,
- reworking plugin permissions,
- moving or deleting the target worktree,
- making broad prompt changes,
- debugging repeated failures.

Deletion is a stronger lifecycle action. Metidos tracks deleted state so the scheduler can stop registering the job and UI can avoid treating it as active.

## Failure handling

Common failure causes:

- target Project or Worktree is unavailable,
- provider-qualified model no longer exists,
- provider credentials are missing or expired,
- plugin access group points to an inactive/unapproved plugin,
- prompt requires a tool not enabled in Access Control,
- unsafe behavior was requested from a safe job,
- worktree has unexpected local changes,
- scheduler or sidecar was restarted during execution.

Failure triage:

1. Open the latest child Thread.
2. Read the final error and tool outputs.
3. Confirm provider and model availability.
4. Confirm Project/Worktree selection.
5. Confirm plugin lifecycle state and access groups.
6. Run the prompt manually in a safe Thread.
7. Update or disable the Cron Job.

## Safe prompts

Good scheduled prompts are narrow and idempotent. Prefer:

- "Inspect X and summarize findings" before "change X".
- explicit output expectations,
- explicit boundaries about committing or not committing,
- small scopes,
- instructions to stop and report ambiguity.

Avoid prompts that encourage broad unattended edits, secret handling, irreversible external actions, or private-network scanning.

## Access Control and Unsafe Mode

Cron Jobs use the same native permission vocabulary as Threads. Safe jobs may have scoped tools but do not get `bash` or unsafe child escalation. Unsafe Mode is explicit, security-sensitive, and should be rare for scheduled work.

A safe Cron Job must not be able to create unsafe child Threads or unsafe Cron Jobs through Metidos tools.

## Plugin interactions

Cron Jobs can enable plugin access groups just like interactive Threads. The plugin must be approved and active when the job runs.

Plugin-declared global crons are different: they are callbacks registered by approved plugin sidecars and managed by the plugin lifecycle. They do not automatically run in a selected Project/Worktree Thread context.

## Operational checklist

- [ ] Job has a clear title and purpose.
- [ ] Prompt was tested interactively.
- [ ] Project/Worktree is stable.
- [ ] Provider/model is available.
- [ ] Access Control is minimum necessary.
- [ ] Unsafe Mode is off unless justified.
- [ ] Plugin access groups are still active and needed.
- [ ] Run now succeeds.
- [ ] Failures are reviewed before increasing schedule frequency.
