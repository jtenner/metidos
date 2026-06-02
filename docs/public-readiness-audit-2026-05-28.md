# Public Readiness Audit — 2026-05-28

Scope: initial working-tree/source audit for private data before publishing Metidos as open source. This is not a replacement for a dedicated secret-scanning tool or Git-history scan.

## Checks performed

- Searched source files for common secret/token markers, private-key headers, provider key names, and placeholder credential examples.
- Searched for personal/local path markers, hostnames, local URLs, and email addresses.
- Reviewed currently visible generated/local artifacts and ignored-output patterns.
- Reviewed image-like assets present in the source tree for follow-up provenance/screenshot safety review.

## Findings

### No live secrets found in source text by pattern scan

The scan found placeholder provider variables in docs and `.env.example`, test fixtures using `example.com`/`example.test`, and intentionally documented secret-handling terminology. No obvious live API key, private key, token, password, or credential value was found in the source text inspected.

### Public contact email is present intentionally

`SECURITY.md`, `SUPPORT.md`, and `.github/ISSUE_TEMPLATE/config.yml` include the public vulnerability/contact email `tenner.joshua@gmail.com`. Keep this only if it is the intended public disclosure/support contact.

### Local path examples are present but appear synthetic

Tests and docs include examples such as `/Users/example`, `/home/metidos`, and localhost URLs. These appear to be synthetic fixtures or necessary local-development examples, not private host paths. `.wiki/` contains benchmark notes naming `/home/metidos/Projects/jt-ide`; those are durable research notes and should be reviewed in the dedicated `.wiki/` public-readiness pass.

### Generated/local artifacts are present on disk but ignored

Ignored local artifacts observed on disk include `.tmp/`, `reports/`, `.metidos/cache/`, and log-like files. These should not be committed. `.gitignore` was tightened to cover common Metidos app-data, plugin runtime output, logs, local databases, screenshots, and diagnostic/export artifacts.

### Image/provenance follow-up remains required

Source images observed include `bird.png`, `docs/uploadthing-test.png`, `src/mainview/crown.png`, `src/mainview/logo.png`, and `src/mainview/pixel-crown.png`. They need the separate asset ownership/provenance review already listed in `agent-todo.md`.

## Required follow-ups

- Run a dedicated working-tree secret scanner and review all findings.
- Run a Git-history secret scanner before publishing.
- Complete the separate `.wiki/` audit before public launch.
- `.pi/skills/` audit completed in [`public-skills-audit-2026-06-02.md`](./public-skills-audit-2026-06-02.md); repeat only for newly added skill content before launch.
- Confirm the public contact email is acceptable.
- Review image assets for ownership, provenance, and screenshot safety.
