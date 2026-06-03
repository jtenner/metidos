# GitHub Discussions Setting Review — 2026-06-03

## Scope

This note covers the GitHub public repository setup checklist item to confirm that GitHub Discussions are enabled only if the project intends to support them after publication.

## Evidence

- Command run from the repository root:
  - `gh repo view --json nameWithOwner,hasDiscussionsEnabled,visibility`
- Observed repository: `jtenner/metidos`
- Observed visibility: `PRIVATE`
- Observed Discussions setting: `hasDiscussionsEnabled: true`
- Checked-in support guidance reviewed:
  - `SUPPORT.md` says usage questions can be opened as a GitHub Discussion if Discussions are enabled, otherwise as documentation issues.
  - `docs/repository-publication-checklist.md` requires Discussions to be enabled only if the project intends to support them.

## Assessment

The repository currently has GitHub Discussions enabled while still private. The checked-in support guidance is compatible with either choice because it gives a fallback path when Discussions are not enabled, but it does not record a durable publication decision that the project will actively monitor and support Discussions.

Leaving Discussions enabled for a public repository is acceptable only if the maintainer intends to triage usage questions there. If the project does not want a separate support queue at launch, Discussions should be disabled before publication and `SUPPORT.md` can continue directing usage questions to documentation issues.

## Recommended publication decision

Before making the repository public, choose one of these outcomes:

1. Keep Discussions enabled and treat them as the primary place for usage questions. Record who monitors them and how often.
2. Disable Discussions for the initial public launch and rely on documentation issues for usage questions until the project is ready for another support channel.

## Acceptance decision

This checklist slice is not fully complete because the setting was inspected, but maintainer intent is still unrecorded. The remaining action is a repository-setting/product-support decision, not a code change.
