# GitHub Branch Protection and Ruleset Availability Review — 2026-06-03

## Scope

This note covers the public repository setup checklist item to confirm that branch protection or repository rulesets are enabled for the default branch before publication.

## Evidence

Commands run from the repository root on 2026-06-03:

```sh
gh api repos/jtenner/metidos/branches/master/protection --jq '{enabled: true, required_status_checks: .required_status_checks, enforce_admins: .enforce_admins.enabled, required_pull_request_reviews: .required_pull_request_reviews}'
gh api repos/jtenner/metidos/rulesets --jq '.[] | {id,name,target,enforcement}'
```

Observed results:

- Branch protection API returned HTTP 403 with GitHub's message that this feature requires GitHub Pro or a public repository for the current private repository.
- Repository rulesets API returned the same HTTP 403 feature-availability message.
- `docs/github-required-checks-review-2026-06-03.md` already records the intended baseline required check recommendation: require at least the `CI` workflow's `Validate` job once branch protection or rulesets are available.

## Assessment

The branch protection/ruleset setting cannot be confirmed or enabled from this repository's current private state with the available account/repository feature set. This is not a checked-in code or documentation defect; it is a GitHub settings availability blocker until the repository is public or the account/repository plan exposes private-repository branch protection and rulesets.

## Decision

Do not attempt to emulate branch protection in repository files. Re-check and configure the GitHub setting after the repository is public, or earlier only if branch protection/rulesets become available for this private repository.

When available, configure protection for the default branch `master` and require at least the `CI` workflow's `Validate` job, selecting the check from GitHub's presented check list rather than hand-typing a name.

## Remaining follow-up

- After publication, re-run the branch protection and rulesets checks.
- Enable either branch protection or a repository ruleset for `master`.
- Record the enabled setting, enforcement mode, required check names, and any pull-request review requirements.
