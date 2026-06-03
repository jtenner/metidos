# GitHub Private Security Reporting Review (2026-06-03)

## Scope

Review whether the repository's private security reporting setting can be confirmed before the public/open-source launch.

## Evidence collected

- Repository queried: `jtenner/metidos`
- Local GitHub CLI auth: logged in as `jtenner`
- Token scopes observed: `gist`, `read:org`, `repo`, `workflow`
- Repository metadata command:
  - `gh repo view --json nameWithOwner,visibility,hasDiscussionsEnabled,url`
  - Result: `jtenner/metidos`, `visibility=PRIVATE`, URL `https://github.com/jtenner/metidos`
- Security metadata command:
  - `gh api repos/jtenner/metidos --jq '{name:.full_name, visibility:.visibility, private:.private, security_and_analysis:.security_and_analysis}'`
  - Result: `security_and_analysis=null`
- Private vulnerability reporting endpoint command:
  - `gh api repos/jtenner/metidos/private-vulnerability-reporting -i`
  - Result: `404 Not Found`

## Interpretation

The repository is still private, and this run could not confirm the private security reporting setting from API output. The `404 Not Found` response from the private vulnerability reporting endpoint should not be treated as launch-ready evidence that the feature is enabled; it may indicate the setting is disabled, unavailable for the current repository state/account, or not exposed through this API path for this repository.

## Recommendation

Before publication, verify the setting in GitHub's repository settings UI or another authoritative GitHub-provided surface. If available, enable private security reporting so external reporters can submit vulnerabilities privately after the repository is public.

If the feature is not available for this repository, record the reason and make sure `SECURITY.md` remains the public fallback for coordinated disclosure instructions.

## Acceptance criteria for completion

This TODO can be marked complete when one of the following is recorded:

1. Private security reporting is enabled and verified through GitHub settings or authoritative API evidence.
2. GitHub does not offer private security reporting for this repository/account state, and `SECURITY.md` is confirmed as the intended fallback disclosure path.
