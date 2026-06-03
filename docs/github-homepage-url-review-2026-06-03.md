# GitHub Homepage URL Review — 2026-06-03

## Scope

This note covers the GitHub public repository setup checklist item to confirm whether the repository homepage URL should point to canonical docs or a repository-hosted website before making the repository public.

## Evidence

- Command run from the repository root:
  - `gh repo view --json name,description,homepageUrl,repositoryTopics,visibility,isFork,defaultBranchRef`
- Observed repository: `jtenner/metidos`
- Observed visibility: `PRIVATE`
- Observed default branch: `master`
- Observed homepage URL:
  - empty string
- README documentation entry points reviewed:
  - `README.md` points operators to `INSTALLATION.md`, `.pi/skills/metidos-installation/SKILL.md`, and `docs/README.md`.
  - `INSTALLATION.md` is described as the canonical human setup guide.
  - `docs/README.md` is the full documentation index.
- Website status reviewed:
  - `website/README.md` documents a plain static landing page that can be served from GitHub Pages or any static host.
  - `website/README.md` still lists going-live TODOs for placeholder GitHub URLs, the real canonical site URL, and Open Graph/Twitter image URLs.

## Assessment

The current empty homepage URL avoids pointing public visitors at an undecided or placeholder site. That is safer than publishing a placeholder canonical URL.

The repository does contain a static website source under `website/`, but the public host and canonical site URL are not decided yet. Because the website still has going-live URL and Open Graph TODOs, the GitHub homepage field should not be set to a guessed website URL.

If the repository is made public before the static website is deployed, leave the homepage URL empty rather than using a deep GitHub `blob` URL. The README already exposes the canonical docs entry points clearly from the repository landing page.

## Recommended public repository homepage decision

Use this decision when public repository settings are updated:

1. If the static website is deployed before publication, set the GitHub homepage URL to the final canonical website URL.
2. If no static website is deployed before publication, leave the GitHub homepage URL empty until the website URL is chosen.
3. Do not set the homepage URL to a placeholder, local preview URL, or undecided GitHub Pages URL.

## Acceptance decision

This checklist slice is complete for homepage URL review: the current setting was inspected, the README and website docs were checked, and a safe publication decision was recorded. The repository settings still need to be updated manually or through an authenticated GitHub settings workflow before publication if a final website URL becomes available.
