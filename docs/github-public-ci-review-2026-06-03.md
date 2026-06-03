# GitHub Public CI Review — 2026-06-03

## Scope

This note covers the GitHub public repository setup checklist item to confirm that checked-in CI workflows are suitable for public pull requests and pushes without relying on private secrets.

## Evidence

- Commands run from the repository root:
  - `gh repo view --json name,visibility,defaultBranchRef --jq '{name, visibility, defaultBranch: .defaultBranchRef.name}'`
  - `gh run list --limit 10 --json name,workflowName,event,headBranch,status,conclusion,createdAt,databaseId`
- Observed repository: `metidos`
- Observed visibility: `PRIVATE`
- Observed GitHub default branch: `master`
- Recent workflow run evidence: `gh run list` returned an empty list, so there are no recent GitHub Actions runs available from this checkout to prove public-run behavior or rendered check names.
- Checked-in workflow trigger and secret evidence:
  - `.github/workflows/ci.yml`: workflow `CI` runs on all pull requests and pushes to `master`; it checks out the repo, installs Bun `1.3.14`, installs dependencies with `bun install --frozen-lockfile`, and runs `bun run validate`. It declares only `contents: read` permission and does not reference `secrets.*`.
  - `.github/workflows/codeql.yml`: workflow `CodeQL` runs on all pull requests, pushes to `master`, and a weekly schedule. It declares `actions: read`, `contents: read`, and `security-events: write` permissions for CodeQL upload and does not reference `secrets.*`.
  - `.github/workflows/dependency-review.yml`: workflow `Dependency Review` runs on pull requests that touch dependency manifests, lockfiles, or the workflow itself. It declares `contents: read` and `pull-requests: read` permissions, uses `actions/dependency-review-action@v4`, and does not reference `secrets.*`.
- Related automation:
  - `.github/dependabot.yml` enables weekly Bun dependency updates for the root package, `src/mainview/getdown`, and GitHub Actions.

## Assessment

The checked-in workflows are appropriate for a public repository from a secret-handling perspective: none of the reviewed workflow files reference repository secrets, provider credentials, local paths, or private infrastructure. The primary validation workflow uses the repository-declared Bun version and a frozen lockfile install, which is suitable for repeatable public pull request and default-branch validation.

The CodeQL workflow needs `security-events: write` so GitHub can upload analysis results. That is expected for CodeQL and is not evidence of a private secret dependency.

The Dependency Review workflow is intentionally path-filtered. It should not be selected as a universally required status check unless GitHub branch protection/ruleset behavior is configured so unrelated pull requests are not blocked by a skipped path-filtered check.

Because the repository is still private and `gh run list` returned no recent runs, this review cannot honestly confirm that CI already runs publicly. It can only confirm that the checked-in workflow configuration is public-ready and secret-free by inspection.

## Decision

Keep the checked-in CI workflow configuration for publication. After the repository is public, confirm at least one pull request and one push to `master` create the expected public GitHub Actions runs:

- `CI` / `Validate`
- `CodeQL` / `Analyze JavaScript and TypeScript`
- `Dependency Review` / `Dependency Review` for a dependency-manifest or lockfile pull request

If public runs fail, update the workflow or installation documentation with the exact public failure mode and remediation.

## Acceptance decision

This checklist slice is complete for pre-public CI configuration review: workflow triggers, declared permissions, Bun version, frozen install behavior, and secret references were inspected and documented. The remaining GitHub settings task is to confirm actual public Actions runs after repository visibility changes or after a public-like test pull request is available.
