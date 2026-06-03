# Project Lifecycle Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify Project creation, opening, closing/removal, and error handling from a clean setup.

## Scope

Verify that a clean Metidos setup can add and reopen a safe demo Project, show its Worktree context, remove or close it without stale UI state, and report invalid Project paths with actionable next steps.

In scope:

- add a Project from a disposable Git repository,
- open the Project and confirm the expected Worktree appears,
- navigate away, reload, and reopen the Project,
- close or remove the Project from the app,
- re-add the same Project after removal,
- attempt to add invalid, missing, and non-Git paths,
- confirm errors are user-visible, actionable, and safe to capture.

Out of scope for this smoke:

- model-provider configuration,
- agent Thread execution,
- Diff review correctness beyond confirming the Project opens,
- large repository performance,
- unsafe-mode access,
- real repositories, real credentials, or private worktrees.

## Preconditions

- Use a disposable Metidos App Data directory or clean local test profile.
- Use a disposable browser profile if browser state may otherwise point at private Projects.
- Keep Unsafe Mode off unless the app requires it for a clearly documented local-only path selection step; record the state either way.
- Do not capture screenshots or logs containing usernames, hostnames, tokens, cookies, TOTP seeds, recovery codes, private repository names, private paths, or customer data.
- If local Bun does not match `package.json` `packageManager`, record the mismatch and defer runtime evidence until the environment is corrected.

## Test fixture

Create a safe demo repository outside the real workspace or under a disposable temp directory. Suggested contents:

```text
README.md
notes/project-lifecycle-smoke.txt
```

Suggested setup commands, adjusted for the disposable directory used by the tester:

```sh
mkdir -p "$TMPDIR/metidos-project-lifecycle-smoke/demo-repo/notes"
cd "$TMPDIR/metidos-project-lifecycle-smoke/demo-repo"
git init
printf '# Demo project lifecycle smoke\n' > README.md
printf 'Safe disposable fixture for Project lifecycle testing.\n' > notes/project-lifecycle-smoke.txt
git add README.md notes/project-lifecycle-smoke.txt
git commit -m 'Create demo project fixture'
```

Also prepare these invalid-path fixtures:

- a missing path that has never existed,
- an existing directory that is not a Git repository,
- if supported by the UI, a regular file path instead of a directory.

## Smoke steps

1. Start Metidos from the clean/disposable App Data setup using documented commands.
2. Complete Local Auth setup or login with fake/demo values if the setup is new.
3. Add the disposable Git repository as a Project.
4. Confirm the Project appears in the Project list with a recognizable sanitized name and no unrelated private paths.
5. Open the Project and confirm the expected default Worktree or current branch context appears.
6. Navigate away and back to the Project, then confirm the same Project and Worktree state loads without duplicate Projects.
7. Reload the browser and confirm the Project can still be opened from persisted state.
8. Close or remove the Project from the app using the normal UI action.
9. Confirm the Project no longer appears as an active/open Project after navigation and reload.
10. Re-add the same disposable Git repository and confirm it opens cleanly without stale errors from the previous removal.
11. Try to add the missing path and confirm the error explains that the path cannot be found or selected and gives a clear recovery step.
12. Try to add the existing non-Git directory and confirm the error explains the Git repository requirement or the supported alternative.
13. If the UI accepts manual path entry, try a regular file path and confirm the error distinguishes files from Project directories.
14. Inspect startup logs, UI errors, and any diagnostics used for evidence; confirm they do not expose unrelated private directories, credentials, cookies, recovery material, or provider metadata.
15. Stop the app and remove the disposable App Data, browser profile, and demo repository unless intentionally retained as sanitized evidence fixtures.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- browser and version,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- exact commands used to create the demo repository, start the app, stop the app, and tear down fixtures,
- sanitized Project path pattern without username/hostname details,
- pass/fail status for each smoke step,
- observed Project and Worktree labels,
- exact user-visible summaries for invalid, missing, non-Git, and file-path errors,
- whether removal and re-add persisted correctly after reload,
- any documentation, UI, or Backend corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for Project lifecycle only after sanitized evidence shows:

- a disposable Git repository can be added, opened, reloaded, removed, and re-added from a clean setup,
- the expected Worktree context is visible after opening and after reload,
- invalid Project paths produce actionable messages with next-step guidance,
- Project removal leaves no active stale Project entry or misleading open state,
- evidence contains no secrets, private machine identifiers, unrelated private paths, real customer/user data, or real provider credentials.
