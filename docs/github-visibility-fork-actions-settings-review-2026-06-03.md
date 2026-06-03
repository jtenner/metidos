# GitHub Visibility, Fork, and Actions Settings Review — 2026-06-03

## Scope

This note covers the GitHub public repository setup checklist item to confirm repository visibility, fork settings, and Actions permissions for the public launch of `jtenner/metidos`.

## Evidence

Commands run from the repository root:

- `gh repo view --json nameWithOwner,visibility,isFork,viewerPermission,defaultBranchRef --jq '{nameWithOwner, visibility, isFork, viewerPermission, defaultBranch: .defaultBranchRef.name}'`
- `gh api repos/jtenner/metidos --jq '{full_name, private, visibility, fork, allow_forking, archived, disabled, default_branch, permissions, has_issues, has_projects, has_wiki, has_discussions}'`
- `gh api repos/jtenner/metidos/actions/permissions --jq .`
- `gh api repos/jtenner/metidos/actions/permissions/workflow --jq .`
- `gh api repos/jtenner/metidos/actions/permissions/fork-pr-contributor-approval --jq .`
- `gh api repos/jtenner/metidos/actions/permissions/selected-actions --jq .`

Observed repository settings:

- Repository: `jtenner/metidos`
- Visibility: `PRIVATE`
- Fork status: `isFork=false` / `fork=false`
- Default branch: `master`
- Operator permission for this check: `ADMIN`
- Repository flags: `archived=false`, `disabled=false`, `allow_forking=true`
- Collaboration surfaces: `has_issues=true`, `has_projects=false`, `has_wiki=false`, `has_discussions=true`
- Actions: `enabled=true`
- Allowed Actions policy: `allowed_actions=all`
- SHA pinning: `sha_pinning_required=false`
- Workflow token default: `default_workflow_permissions=read`
- Workflow approval setting: `can_approve_pull_request_reviews=false`
- Fork pull request contributor approval endpoint result: GitHub returned `422` with `Fork PR approval is not allowed for private repositories.`
- Selected Actions endpoint result: GitHub returned `409` because all actions and workflows are currently allowed.

## Assessment

The repository is not itself a fork, which is appropriate for the canonical public project repository. `allow_forking=true` is also appropriate for an open source launch because contributors need to be able to fork the repository for pull requests.

Actions are enabled and the default workflow token permission is read-only, which is the important safety baseline for public pull request execution. This aligns with the public CI review in `docs/github-public-ci-review-2026-06-03.md`, which found the checked-in workflows do not reference `secrets.*` and declare minimal workflow permissions.

The repository currently allows all Actions and reusable workflows. That is acceptable for launch with the current checked-in workflows and read-only default token permissions, but a stricter organization/repository policy that allows only GitHub-owned and explicitly approved third-party actions would be a reasonable future supply-chain hardening step. This review does not require that hardening before publication.

The repository is still private, so this check cannot confirm the final public visibility state or public-fork pull request approval behavior. The fork PR contributor approval endpoint is not available while the repository is private.

## Decision

For public launch:

- Keep this repository as the canonical non-fork repository.
- Change visibility from private to public only after the final pre-public checklist is complete.
- Keep forking enabled for open source contribution workflows.
- Keep Actions enabled.
- Keep the default workflow token permission set to read-only.
- Do not allow workflows to approve pull request reviews.
- Treat the current `allowed_actions=all` policy as launch-acceptable, with optional future hardening to a selected-actions allowlist if maintainers want tighter supply-chain controls.

## Remaining verification after publication

After the repository visibility is changed to public, re-check:

- Repository visibility is `PUBLIC`.
- Forking remains enabled.
- Actions remain enabled.
- Default workflow token permission remains read-only.
- Fork pull request contributor approval behavior is available and set intentionally for the public repository.
- The CI public-run confirmation in `docs/github-public-ci-review-2026-06-03.md` has actual pull request and push run evidence.
