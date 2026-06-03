# Public Repository Settings Final Checklist Rollup — 2026-06-03

## Scope

This note consolidates the GitHub public repository settings review evidence that already exists under the detailed setup notes. It supports the final pre-public checklist item, "Public repository settings have been reviewed," without re-running every GitHub CLI/API probe in each recurring TODO slice.

## Completed pre-public settings reviews

The following repository settings have been inspected and have launch decisions or recommendations recorded:

- Repository description: `docs/github-public-repository-description-review-2026-06-03.md` recommends a shorter README-aligned public description.
- Homepage URL: `docs/github-homepage-url-review-2026-06-03.md` recommends leaving the field empty unless a final static website URL is deployed before publication.
- Repository topics: `docs/github-public-repository-topics-review-2026-06-03.md` records that the public topic set was applied and verified while the repository was still private.
- Default branch: `docs/github-default-branch-review-2026-06-03.md` records the decision to keep `master` for initial publication unless the maintainer intentionally renames it before launch.
- Wiki: `docs/github-wiki-setting-review-2026-06-03.md` confirms GitHub Wiki is disabled and versioned repository docs remain the documentation source of truth.
- Public CI configuration: `docs/github-public-ci-review-2026-06-03.md` confirms checked-in workflows are public-ready and do not reference `secrets.*`; public run evidence remains a post-public/public-like verification.
- Required checks naming: `docs/github-required-checks-review-2026-06-03.md` records the workflow/job names to select from GitHub's UI when branch protection or rulesets become available.
- Visibility, fork, and Actions settings: `docs/github-visibility-fork-actions-settings-review-2026-06-03.md` records the private-state settings and the intended public launch posture.

## Settings still blocked on maintainer action, GitHub UI, or publication state

The final checklist item should not be marked complete until these settings are resolved or explicitly waived:

1. Upload and verify the repository social preview image.
   - Source review: `docs/github-social-preview-setting-review-2026-06-03.md`
   - Remaining action: upload `docs/brand/github-social-preview.svg` or the tracked PNG fallback through GitHub repository settings, then verify `openGraphImageUrl` and visually check the render.
2. Enable branch protection or a repository ruleset for `master` when GitHub exposes the feature.
   - Source reviews: `docs/github-required-checks-review-2026-06-03.md` and `docs/github-branch-protection-ruleset-availability-review-2026-06-03.md`
   - Remaining action: require at least the `CI` workflow's `Validate` job from GitHub's presented check list.
3. Resolve the GitHub Discussions support-policy decision.
   - Source review: `docs/github-discussions-setting-review-2026-06-03.md`
   - Remaining action: either record a monitoring owner/cadence and keep Discussions enabled, or disable Discussions for launch.
4. Confirm private security reporting.
   - Source review: `docs/github-private-security-reporting-review-2026-06-03.md`
   - Remaining action: verify and enable private security reporting in GitHub settings if available, or record why `SECURITY.md` is the intended fallback.
5. Change repository visibility to public only after the other pre-public checklist items are ready.
   - Source review: `docs/github-visibility-fork-actions-settings-review-2026-06-03.md`
   - Remaining action: after publication, re-check visibility, forking, Actions permissions, fork PR approval behavior, and public CI runs.

## Acceptance criteria for the final checklist item

Mark "Public repository settings have been reviewed" complete only after the detailed GitHub setup section records outcomes for social preview, branch protection/rulesets, Discussions, private security reporting, and visibility/fork/Actions post-public checks, or after maintainers explicitly document a launch waiver for any unavailable setting.
