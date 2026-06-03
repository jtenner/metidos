# GitHub Wiki Setting Review — 2026-06-03

## Scope

This note covers the GitHub public repository setup checklist item to confirm that GitHub Wiki is disabled unless the project intentionally uses it.

## Evidence

- Command run from the repository root:
  - `gh repo view --json name,visibility,defaultBranchRef,hasWikiEnabled --jq '{name, visibility, defaultBranch: .defaultBranchRef.name, hasWikiEnabled}'`
- Observed repository: `metidos`
- Observed visibility: `PRIVATE`
- Observed GitHub default branch: `master`
- Observed Wiki setting: `hasWikiEnabled: false`
- Repository documentation entry points reviewed from prior public-readiness notes remain the checked-in docs, especially `README.md`, `INSTALLATION.md`, and `docs/README.md`, rather than a GitHub-hosted Wiki.

## Assessment

The current GitHub Wiki setting is aligned with the public-readiness checklist: Wiki is disabled, and the repository already keeps project documentation in versioned files. Keeping Wiki disabled avoids splitting public documentation between tracked repository docs and an out-of-band GitHub Wiki.

If the project later intentionally adopts GitHub Wiki, that should be treated as a separate documentation-governance decision with ownership, migration, and update expectations documented before enabling it.

## Acceptance decision

This checklist slice is complete for the GitHub Wiki setting: the authenticated GitHub repository setting was inspected and Wiki is currently disabled. No repository setting change is needed before publication unless the project intentionally decides to use GitHub Wiki.
