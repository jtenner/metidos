# GitHub social preview setting review — 2026-06-03

## Scope

Checked whether the repository social preview image is already configured and whether the tracked preview source is suitable for upload before publication.

## Evidence

Commands run from `/home/jtenner/Projects/jt-ide`:

```sh
gh repo view --json nameWithOwner,visibility,url
gh repo view --json openGraphImageUrl
```

Observed output:

```json
{"nameWithOwner":"jtenner/metidos","url":"https://github.com/jtenner/metidos","visibility":"PRIVATE"}
{"openGraphImageUrl":"https://avatars.githubusercontent.com/u/3761339?s=400&v=4"}
```

The current Open Graph image URL resolves to the owner avatar, not to the tracked Metidos social preview asset. This indicates the custom repository social preview is not confirmed as uploaded yet.

The intended source image remains `docs/brand/github-social-preview.svg`. It is a tracked 1280×640 generated SVG with only text, geometric shapes, and project colors. The brand asset index records it as repo-owned and safe to redistribute/upload.

A raster fallback is now tracked at `docs/brand/github-social-preview.png`. It was exported from the SVG with headless Chromium on 2026-06-03 for settings UI compatibility. A PNG header check confirmed `1280×640` dimensions and `30,583` bytes.

## Result

Not complete for launch: the social preview image still needs to be uploaded through GitHub repository settings and visually checked after upload.

## Follow-up

1. In GitHub repository settings, upload `docs/brand/github-social-preview.svg` as the repository social preview image, or upload the tracked raster fallback at `docs/brand/github-social-preview.png` if the settings UI rejects SVG uploads.
2. After upload, re-run `gh repo view --json openGraphImageUrl` and confirm it no longer returns the owner avatar URL.
3. Open or otherwise visually check the repository social preview/Open Graph render and record the final image URL plus pass/fail evidence.
