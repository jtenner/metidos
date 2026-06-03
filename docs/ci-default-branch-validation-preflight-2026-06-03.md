# Default-branch CI validation preflight (2026-06-03)

## Scope

This note records a bounded recurring-agent preflight for the final pre-public checklist item "CI passes on the default branch."

The repository CI workflow (`.github/workflows/ci.yml`) validates pushes to `master` with Bun `1.3.14`, `bun install --frozen-lockfile`, and `bun run validate`.

## Environment

- Date/time: 2026-06-03T08:30:42Z
- OS/kernel: Linux `bf28335b6a4b` 6.12.90+deb13.1-amd64, Debian GNU/Linux 13 (trixie), x86_64
- Workspace: `/home/jtenner/Projects/jt-ide`
- Current branch: `master`
- Current HEAD: `6fd4b5b`
- Local Bun version: `1.3.13`
- Declared package manager: `bun@1.3.14`

## Commands and results

```sh
git branch --show-current
git rev-parse --short HEAD
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
git status --short --untracked-files=no | wc -l
```

Result summary:

```text
branch: master
HEAD: 6fd4b5b
bun --version: 1.3.13
packageManager: bun@1.3.14
modified tracked paths: 22
```

The tracked modifications were unrelated in-progress workspace changes, including CI workflow, installation docs, backend runtime files, and mainview cron workspace files. This preflight did not overwrite, stage, or validate those changes.

## Outcome

The default-branch CI pass was **not confirmed** in this recurring-agent slice.

Validation was deferred for two reasons:

1. The local runtime does not match CI's declared Bun version (`1.3.13` locally vs `1.3.14` in `package.json` and `.github/workflows/ci.yml`).
2. The workspace contains unrelated tracked modifications, so a local `bun run validate` would validate a dirty working tree rather than the default branch at `HEAD`.

## Next actionable slice

Use either GitHub Actions on `master` or a clean checkout/worktree with Bun `1.3.14`, then run the CI-equivalent commands and record:

- commit SHA validated
- OS/runner
- Bun version
- exact commands
- pass/fail status
- any remediation if validation fails
