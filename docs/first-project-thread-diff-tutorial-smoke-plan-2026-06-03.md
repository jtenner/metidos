# First Project, Thread, and Diff Tutorial Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify the `INSTALLATION.md` first-run tutorial path for adding a first Project, selecting a Worktree, starting a safe Thread, and reviewing Diff state.

## Scope

Verify that a clean Metidos setup can follow the documented quick-start tutorial with fake/demo data only:

- create or use a disposable Git repository as the first Project,
- select the expected Worktree,
- start one safe no-edit Thread attached to that Project and Worktree,
- confirm Thread status and result are understandable,
- create a small local demo diff and review it in the Diff workspace,
- confirm reload/navigation does not leave stale Project, Worktree, Thread, or Diff context,
- collect sanitized evidence and note any documentation, UI, or Backend corrections.

Out of scope for this smoke:

- real repositories, private paths, provider secrets, customer data, or production App Data,
- unsafe-mode actions,
- large diff performance,
- exhaustive Project lifecycle, Worktree lifecycle, Thread lifecycle, or Diff review edge cases covered by separate smoke plans,
- validating the quality of a provider response beyond proving the safe Thread can run and settle.

## Preconditions

- Use a disposable Metidos App Data directory or clean local test profile.
- Use a disposable browser profile if the normal browser state may expose private Projects, Threads, cookies, or paths.
- Keep Unsafe Mode off for the first Thread.
- Use a fake/local provider if available, or a real provider only if evidence can avoid all credentials, account identifiers, prompt contents that reveal private data, and provider metadata.
- Do not capture screenshots or logs containing usernames, hostnames, tokens, cookies, TOTP seeds, recovery codes, private repository names, private paths, provider account metadata, or customer data.
- If local Bun does not match `package.json` `packageManager`, record the mismatch and defer runtime evidence until the environment is corrected.

## Test fixture

Create a safe demo repository outside the real workspace or under a disposable temp directory. Suggested setup commands, adjusted for the disposable directory used by the tester:

```sh
mkdir -p "$TMPDIR/metidos-first-project-tutorial-smoke/demo-repo/docs"
cd "$TMPDIR/metidos-first-project-tutorial-smoke/demo-repo"
git init
git checkout -b main
printf '# First Project tutorial smoke fixture\n' > README.md
printf 'safe baseline note\n' > docs/tutorial-note.txt
git add README.md docs/tutorial-note.txt
git commit -m 'Create first project tutorial smoke fixture'
```

After the safe no-edit Thread settles, create a small demo diff for the review step:

```sh
cd "$TMPDIR/metidos-first-project-tutorial-smoke/demo-repo"
printf '# First Project tutorial smoke fixture\n\nUpdated safe demo content.\n' > README.md
printf 'safe baseline note\nsafe diff review note\n' > docs/tutorial-note.txt
printf 'safe new file for diff review\n' > docs/tutorial-new-file.txt
```

Expected changed paths include:

- `README.md`,
- `docs/tutorial-note.txt`,
- `docs/tutorial-new-file.txt`.

## Smoke steps

1. Start Metidos from the clean/disposable App Data setup using documented commands from `INSTALLATION.md`.
2. Complete Local Auth setup or login with fake/demo values if the setup is new.
3. Confirm the model/provider selector has a usable fake, local, or approved provider-backed model for one safe Thread.
4. Add the disposable repository as the first Project.
5. Select the expected Worktree for that Project and confirm the displayed Project/Worktree labels are sanitized and recognizable.
6. Start a Thread with Unsafe Mode off using the documented no-edit prompt, for example: `Inspect this repository and summarize the test commands. Do not edit files.`
7. Confirm the Thread runs and settles with a user-visible status/result, or record the exact actionable error if provider/model setup prevents the run.
8. Confirm the repository still has no changes from the no-edit Thread before creating the manual demo diff.
9. Create the small demo diff from the fixture commands above.
10. Open the Diff workspace or equivalent changed-files view for the selected Worktree.
11. Confirm the changed-file list contains the expected modified and added paths.
12. Open at least one modified file and the new file; confirm added/modified lines are understandable and not mislabeled.
13. Navigate away and back, then reload the browser; confirm Project, Worktree, Thread summary, and Diff context either persist correctly or reset to a clear safe default without stale labels.
14. Inspect user-visible messages, startup logs, and diagnostics used for evidence; confirm they are actionable and do not expose secrets or unrelated private paths.
15. Stop the app and remove the disposable App Data, browser profile, and fixture repository unless intentionally retaining sanitized evidence fixtures.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- browser and version,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- fake/local/real provider category without account identifiers,
- exact commands used to create the fixture, start the app, create the demo diff, stop the app, and tear down fixtures,
- sanitized Project and Worktree path patterns without usernames or hostnames,
- pass/fail status for each smoke step,
- observed Project and Worktree labels,
- Thread status/identifier summary and whether the no-edit instruction was respected,
- observed Diff file labels and statuses for the modified and added files,
- exact user-visible summaries for any provider/model, Project, Thread, or Diff errors,
- whether reload preserved or clearly reset the Project/Worktree/Thread/Diff context,
- any documentation, UI, or Backend corrections needed.

## Acceptance criteria

The Testing TODO for the first Project, Worktree, safe Thread, and Diff review tutorial path can be marked complete only after sanitized evidence shows:

- a disposable Project can be added from the documented quick-start path,
- the intended Worktree is selected and visible before Thread creation,
- a safe no-edit Thread can run and settle, or provider/model setup failure is clearly actionable and documented,
- a manually created demo diff appears in the Diff workspace with understandable modified and added file labels,
- reload/navigation does not leave stale Project, Worktree, Thread, or Diff state,
- evidence contains no secrets, private machine identifiers, unrelated private paths, real customer/user data, or provider credentials.
