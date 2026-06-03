# Git Worktree Lifecycle Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify Git Worktree listing, opening, switching, and failure states with small and realistic repositories.

## Scope

Verify that Metidos discovers and presents Git Worktrees accurately for a Project, can open and switch between them without stale state, and reports unsupported or broken Worktree states with actionable next steps.

In scope:

- a small disposable Project with multiple Git Worktrees,
- a larger-but-safe demo Project to exercise list rendering and switching with more files,
- opening each Worktree from the Project context,
- switching back and forth between Worktrees,
- confirming the selected Worktree is used by Thread/Diff entry points without starting real provider work,
- failure states for missing, pruned, dirty, detached, or non-Git Worktree paths where the UI exposes them,
- safe, sanitized evidence collection.

Out of scope for this smoke:

- full agent Thread execution,
- provider/model correctness,
- Diff review correctness beyond confirming the selected Worktree context,
- unsafe-mode shell access,
- private repositories, private branch names, real credentials, or customer data.

## Preconditions

- Use a disposable Metidos App Data directory or clean local test profile.
- Use a disposable browser profile if normal browser state may expose private Projects or Worktrees.
- Keep Unsafe Mode off.
- Do not capture screenshots or logs containing usernames, hostnames, tokens, cookies, TOTP seeds, recovery codes, private repository names, private paths, provider metadata, or customer data.
- If local Bun does not match `package.json` `packageManager`, record the mismatch and defer runtime evidence until the environment is corrected.

## Test fixtures

Create fixtures under a disposable temp directory. Use sanitized branch and Worktree names only.

### Small multi-Worktree repository

Suggested setup commands, adjusted for the disposable directory used by the tester:

```sh
mkdir -p "$TMPDIR/metidos-worktree-smoke/small-main"
cd "$TMPDIR/metidos-worktree-smoke/small-main"
git init
git checkout -b main
printf '# Small Worktree smoke\n' > README.md
printf 'main worktree fixture\n' > notes.txt
git add README.md notes.txt
git commit -m 'Create small worktree fixture'
git branch feature-alpha
git worktree add ../small-feature-alpha feature-alpha
git checkout -b feature-beta
printf 'feature beta fixture\n' > beta.txt
git add beta.txt
git commit -m 'Add feature beta fixture'
git checkout main
git worktree add ../small-feature-beta feature-beta
```

Expected safe Worktree labels include `small-main`, `small-feature-alpha`, and `small-feature-beta`, or the branch names `main`, `feature-alpha`, and `feature-beta` depending on the UI.

### Realistic repository fixture

Use a generated repository rather than a private production repository. Suggested approach:

```sh
mkdir -p "$TMPDIR/metidos-worktree-smoke/realistic-main/src" "$TMPDIR/metidos-worktree-smoke/realistic-main/docs"
cd "$TMPDIR/metidos-worktree-smoke/realistic-main"
git init
git checkout -b main
for i in $(seq 1 120); do printf 'fixture file %s\n' "$i" > "src/file-$i.txt"; done
for i in $(seq 1 20); do printf '# Fixture doc %s\n' "$i" > "docs/doc-$i.md"; done
git add src docs
git commit -m 'Create realistic worktree fixture'
git branch review-large
git worktree add ../realistic-review-large review-large
```

This fixture is intended to exercise Worktree listing and context switching with a moderately sized file list, not performance under very large repositories.

## Failure-state fixtures

Prepare any failure states that can be produced safely and restored afterward:

- Remove or rename one linked Worktree directory after it has been discovered, then verify the app reports that the path is missing and offers a recovery path such as refresh, remove, or recreate.
- Run `git worktree prune` after deleting a linked Worktree directory and confirm the app no longer shows it as active after refresh/reload.
- Create a detached-head Worktree if supported by the fixture and confirm the label/status is understandable.
- Add an uncommitted change in one Worktree and confirm switching does not lose or hide dirty-state context if the UI presents it.
- Try to open a non-Git directory through the Project/Worktree flow only if the UI allows it, and confirm the error explains the Git repository requirement.

## Smoke steps

1. Start Metidos from the clean/disposable App Data setup using documented commands.
2. Complete Local Auth setup or login with fake/demo values if the setup is new.
3. Add the small main repository as a Project.
4. Confirm all expected small Worktrees appear after refresh/reload, with no unrelated private paths.
5. Open the main Worktree and confirm Project/Worktree context labels are visible and match the selected fixture.
6. Switch to `feature-alpha`, then `feature-beta`, then back to `main`; after each switch, confirm the selected Worktree label, branch/status indicator, and navigation context update without stale data from the previous Worktree.
7. Open Diff review or the equivalent read-only Project view for each Worktree and confirm it uses the selected Worktree context. Do not start provider-backed work unless a fake/local provider is intentionally configured.
8. Reload the browser and confirm the selected Project and Worktree state persists or recovers to a clearly labeled default.
9. Add or switch to the realistic fixture and confirm Worktree listing and switching remain usable with the larger generated file set.
10. Exercise the prepared failure-state fixtures one at a time, refreshing/reloading as needed.
11. Inspect user-visible errors, startup logs, and diagnostics used for evidence; confirm they are actionable and do not expose secrets or unrelated private paths.
12. Stop the app and remove the disposable App Data, browser profile, and fixture repositories unless intentionally retaining sanitized evidence fixtures.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- browser and version,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- exact commands used to create fixtures, start the app, stop the app, and tear down fixtures,
- sanitized Project and Worktree path patterns without usernames or hostnames,
- pass/fail status for each smoke step,
- observed Project and Worktree labels,
- branch/status labels for normal, detached, dirty, missing, pruned, and non-Git cases that were tested,
- exact user-visible summaries for failure states,
- whether switching and reload preserved or clearly recovered context,
- any documentation, UI, or Backend corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for Git Worktree lifecycle only after sanitized evidence shows:

- multiple Worktrees are listed for a disposable Project,
- each Worktree can be opened and selected without stale Project/Worktree context,
- switching and browser reload either preserve the chosen Worktree or recover to a clear default,
- realistic generated repositories remain usable for listing and switching,
- missing, pruned, detached, dirty, and non-Git states tested by the fixture produce understandable labels or actionable errors,
- evidence contains no secrets, private machine identifiers, private paths, real customer/user data, or real provider credentials.
