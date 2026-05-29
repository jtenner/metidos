# Wiki Public Readiness Audit — 2026-05-28

Scope: initial public-readiness sift through `.wiki/` research notes and raw captures, plus promotion of durable operator-facing guidance into `docs/` where appropriate.

## What was reviewed

- `.wiki/index.md` and all listed wiki pages.
- `.wiki/raw/` source captures.
- Pattern scans for personal email/name markers, local absolute paths, credential words, localhost/private-network examples, and publish-risk terms.
- Public docs that should receive durable wiki guidance: security, backend, model providers, and performance validation.

## Findings

### No live secrets found by text scan

The wiki contains security terminology, placeholder credential names, and provider env variable names, but no obvious live API key, token, password, private key, or credential value was found by the scan.

### Private/local path cleanup performed

The only publish-risk absolute project path pattern found in wiki pages was the benchmark example path `/home/metidos/Projects/jt-ide`. It was replaced with placeholder text in:

- `.wiki/performance-validation-workflow.md`
- `.wiki/git-background-preemption-churn.md`
- `.wiki/2026-04-11-opt01-baseline-benchmark.md`

Synthetic fixture paths such as `/home/metidos` and `/Users/example` remain where they document test behavior or generic local setup.

### Wiki content is mostly architecture/research material

Most pages are durable design records or time-bound audit snapshots. They appear appropriate to keep public if the project wants to publish engineering rationale. The higher-risk areas remain:

- `.wiki/raw/` because raw captures are less curated,
- time-bound benchmark/audit pages because they may include local run context,
- provider/auth/security pages because they describe sensitive boundaries and should remain accurate.

### Traditional docs updated

Durable guidance promoted from wiki into public docs:

- `docs/security-model.md` now includes current Local Auth hardening expectations and `auth-secret.key` backup/restore guidance.
- `docs/backend.md` now documents auth-secret/App Data permission expectations and links performance validation.
- `docs/model-providers.md` now documents first-party plugin-backed providers and no-fallback discovery expectations.
- `docs/performance-validation.md` was added for repeatable local performance checks.
- `docs/README.md` now links the performance validation page.

## Recommendation

Keep `.wiki/` in the public repository only if the project intentionally publishes implementation research and audit history. If a smaller public surface is desired, keep curated durable pages and remove or rewrite `.wiki/raw/` plus time-bound benchmark snapshots before launch.

## Required follow-ups

- Run a dedicated secret scanner over `.wiki/` and `.wiki/raw/`.
- Manually review `.wiki/raw/optimization-proposals.md` and `.wiki/raw/2026-04-16-accessibility-audit.md` before launch because raw captures receive less editing.
- Re-run the broader working-tree and Git-history secret scans before publishing.
