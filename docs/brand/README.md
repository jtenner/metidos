# Brand assets

This folder is the public-readiness home for Metidos brand asset guidance. Keep repo-owned source files, exported images, and provenance notes here when brand assets are added or replaced.

## Current assets

| Asset | Role | Source/provenance status | Public-use status |
| --- | --- | --- | --- |
| `website/favicon.svg` | Website favicon | Original generated SVG artwork created in-repository on 2026-06-02 from simple terminal-prompt geometry and project colors. | Safe to redistribute. |
| `website/app-icon.svg` | Website app icon / manifest icon | Original generated SVG artwork created in-repository on 2026-06-02 from simple terminal-prompt geometry and project colors. | Safe to redistribute. |
| `bird.png` | Root mascot/fav icon asset used by README and mainview metadata | Shared PNG mascot. Provenance is still pending maintainer confirmation. | Do not treat as public-ready until `docs/public-asset-provenance-audit-2026-06-02.md` is resolved. |
| `website/bird.png` | Static website header mascot | Byte-identical copy of `bird.png` kept so `website/` can be self-contained. Provenance is still pending maintainer confirmation. | Do not treat as public-ready until `docs/public-asset-provenance-audit-2026-06-02.md` is resolved. |
| `src/mainview/pixel-crown.png` | Mainview app artwork | PNG artwork from the initial open-source snapshot. Provenance is still pending maintainer confirmation. | Do not treat as public-ready until `docs/public-asset-provenance-audit-2026-06-02.md` is resolved or the asset is replaced/removed. |
| `docs/images/readme-hero-demo.svg` | README/demo image | Repo-owned generated SVG with fake/demo data only. | Safe to redistribute. |
| `docs/images/readme-feature-tour.svg` | README/demo image | Repo-owned generated SVG with fake/demo data only. | Safe to redistribute. |
| `docs/images/feature-agent-thread-demo.svg` | README feature screenshot | Repo-owned generated SVG with fake/demo agent thread data only. | Safe to redistribute. |
| `docs/images/feature-cron-workspace-demo.svg` | README feature screenshot | Repo-owned generated SVG with fake/demo cron workspace data only. | Safe to redistribute. |
| `docs/images/feature-diff-review-demo.svg` | README feature screenshot | Repo-owned generated SVG with fake/demo diff review data only. | Safe to redistribute. |
| `docs/images/feature-plugin-admin-demo.svg` | README feature screenshot | Repo-owned generated SVG with fake/demo plugin administration data only. | Safe to redistribute. |
| `docs/images/feature-project-worktree-demo.svg` | README feature screenshot | Repo-owned generated SVG with fake/demo project and worktree data only. | Safe to redistribute. |
| `docs/images/feature-provider-settings-demo.svg` | README feature screenshot | Repo-owned generated SVG with fake/demo provider settings data only. | Safe to redistribute. |
| `docs/brand/github-social-preview.svg` | GitHub social preview source image | Repo-owned generated 1280×640 SVG using only text, shapes, and project colors. No external artwork or private data. | Safe to redistribute and upload in GitHub repository settings. |
| `docs/brand/github-social-preview.png` | GitHub social preview raster export | Repo-owned 1280×640 PNG exported from `docs/brand/github-social-preview.svg` with headless Chromium on 2026-06-03 for GitHub settings UI compatibility. | Safe to redistribute and upload in GitHub repository settings. |
| `website/og.svg` / `website/og.png` | Website Open Graph preview source/export | Repo-owned generated 1200×630 preview using only text, shapes, and website color tokens. | Safe to redistribute; keep separate from the GitHub social preview unless website metadata changes. |

The canonical tracked-asset audit is `docs/public-asset-provenance-audit-2026-06-02.md`. Update that audit first when asset ownership or redistribution status changes, then mirror durable brand guidance here if the asset remains part of the project identity.

## Adding or replacing brand assets

For each new logo, mascot, icon, social preview, or screenshot asset:

1. Prefer an editable source format (`.svg`, `.fig`, `.afdesign`, `.kra`, or another documented source file) plus any exported PNG/WebP variants that are actually used.
2. Record creator/source, creation date if known, license or assignment status, and redistribution approval before committing the export.
3. Use fake/demo data only in screenshots and social images.
4. Avoid usernames, hostnames, tokens, internal repositories, local paths, private branches, and real customer/user data.
5. Re-run the tracked asset inventory from the public asset provenance audit after adding, replacing, or removing assets.

## Pending decisions

- Confirm or replace the shared bird mascot before publishing the repository.
- Confirm, replace, or remove `src/mainview/pixel-crown.png` before publishing the repository.
- Upload `docs/brand/github-social-preview.svg` as the GitHub social preview when repository settings are prepared for publication, or use the tracked `docs/brand/github-social-preview.png` raster export if the settings UI rejects SVG uploads.
