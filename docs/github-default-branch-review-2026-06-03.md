# GitHub Default Branch Review — 2026-06-03

## Scope

This note covers the GitHub public repository setup checklist item to confirm that the repository default branch name is intentional and documented before making the repository public.

## Evidence

- Command run from the repository root:
  - `gh repo view --json name,visibility,defaultBranchRef,homepageUrl`
- Observed repository: `metidos`
- Observed visibility: `PRIVATE`
- Observed GitHub default branch: `master`
- Local branch evidence:
  - `git branch --show-current` returned `master`
  - `git branch -a --list` showed local `master` and `remotes/origin/master`
- Workflow evidence:
  - `.github/workflows/ci.yml` runs on pushes to `master`
  - `.github/workflows/codeql.yml` runs on pushes to `master`
- Documentation evidence:
  - `SECURITY.md` refers to the default branch generically for pre-1.0 security fixes.
  - `docs/release-process.md` refers to protecting the default branch generically rather than hard-coding a branch name.

## Assessment

The repository currently uses `master` as the GitHub default branch and the checked-in GitHub Actions push filters already match that branch. Keeping `master` is therefore internally consistent for publication and does not require code changes before making the repository public.

The public-facing docs intentionally use the generic phrase `default branch` for support, security, and release-process guidance. That keeps the docs correct if the repository is renamed to `main` later, while this note records the current publication decision.

## Decision

Keep `master` as the default branch for the initial public repository setup unless the maintainer intentionally decides to rename it before publication.

If the default branch is renamed later, update at least:

- GitHub repository default branch setting
- `.github/workflows/ci.yml` push branch filters
- `.github/workflows/codeql.yml` push branch filters
- branch protection or ruleset targets
- any release or publication notes that mention the concrete branch name

## Acceptance decision

This checklist slice is complete for branch-name review: the current GitHub default branch was inspected, the checked-in workflow filters were compared against it, and the intentional publication decision was recorded. Branch protection/ruleset configuration remains a separate GitHub settings task.
