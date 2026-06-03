# GitHub Required Checks Review — 2026-06-03

## Scope

This note covers the GitHub public repository setup checklist item to confirm that required status checks, if enabled before publication, match the actual checked-in GitHub Actions workflow and job names.

## Evidence

- Commands run from the repository root:
  - `gh repo view --json name,visibility,defaultBranchRef --jq '{name, visibility, defaultBranch: .defaultBranchRef.name}'`
  - `gh api repos/:owner/:repo/branches/master/protection/required_status_checks`
  - `gh run list --limit 10 --json name,workflowName,event,headBranch,status,conclusion,createdAt,databaseId`
- Observed repository: `metidos`
- Observed visibility: `PRIVATE`
- Observed GitHub default branch: `master`
- Required status check API result: GitHub returned HTTP 403 with the message that branch protection requires GitHub Pro or a public repository for this private repository. This means required checks are not currently verifiable or configurable through the available branch-protection API while the repository remains private under the current plan.
- Recent workflow run evidence: `gh run list` returned an empty list, so there are no recent GitHub Actions runs available from this checkout to cross-check UI-rendered check names.
- Checked-in workflow/job names inspected:
  - `.github/workflows/ci.yml`: workflow `CI`, job `Validate`
  - `.github/workflows/codeql.yml`: workflow `CodeQL`, job `Analyze JavaScript and TypeScript`
  - `.github/workflows/dependency-review.yml`: workflow `Dependency Review`, job `Dependency Review`

## Assessment

There is no active required-check configuration available to compare against from the current private repository state. For public launch setup, the required checks should be selected only after GitHub Actions has produced runs on the public repository or after branch protection/rulesets become available for this repository.

The checked-in workflow job names are stable and clear. If branch protection or rulesets are enabled before publication, the required checks should match the checks that GitHub displays for these jobs, not hand-typed variants. In practice, the intended required checks are:

- `Validate` from the `CI` workflow for repository validation.
- `Analyze JavaScript and TypeScript` from the `CodeQL` workflow if security scanning is intended to block merges.
- `Dependency Review` from the `Dependency Review` workflow for pull requests that touch dependency manifests or lockfiles.

Because the dependency review workflow is path-filtered, make sure GitHub branch protection/ruleset behavior will not block unrelated pull requests waiting for a skipped path-filtered check before making it required.

## Decision

Do not configure required checks by guessing names while the private repository cannot expose required status checks through the available API and no recent workflow runs are available. When the repository is public, or when branch protection/rulesets become available, configure required checks from GitHub's presented check list and prefer at least the `CI` workflow's `Validate` job as the baseline required check.

## Acceptance decision

This checklist slice is complete for required-check name review: the available GitHub repository state was inspected, branch-protection API access was tested, checked-in workflow/job names were documented, and the safe publication recommendation was recorded. Enabling branch protection or rulesets remains a separate GitHub settings task.
