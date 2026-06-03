# Pre-public dedicated secret scanner availability check (2026-06-03)

## Scope

This note records a bounded recurring-agent preflight for the final dedicated secret-scanner pass requested by `agent-todo.md`.

The earlier `docs/pre-public-secret-scan-2026-06-03.md` scan used available Git and ripgrep tooling. The remaining acceptance criterion is still to run at least one dedicated secret scanner, such as Gitleaks, TruffleHog, git-secrets, or an equivalent CI-backed scanner, across the full working tree and Git history.

## Environment

- Date/time: 2026-06-03T08:03:25+00:00
- OS/kernel: Linux `bf28335b6a4b` 6.12.90+deb13.1-amd64, Debian kernel build `6.12.90-2 (2026-05-27)`, x86_64
- Workspace: `/home/jtenner/Projects/jt-ide`

## Commands and results

```sh
command -v gitleaks || true
command -v trufflehog || true
command -v git-secrets || true
command -v detect-secrets || true
```

Result: no paths were printed.

```sh
for tool in gitleaks trufflehog git-secrets detect-secrets; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '%s: ' "$tool"
    command -v "$tool"
    "$tool" --version 2>&1 | head -n 3 || true
  else
    printf '%s: not found\n' "$tool"
  fi
done
```

Result:

```text
gitleaks: not found
trufflehog: not found
git-secrets: not found
detect-secrets: not found
```

## Outcome

The dedicated scanner pass was **not run** in this workspace runtime because no dedicated secret-scanning tool was installed or otherwise available on `PATH`.

The pre-public secret-scan checklist item remains open. A future run must use an environment with at least one dedicated scanner installed, or a CI-backed equivalent, then record the scanner name/version, exact command, pass/fail status, and any resolved findings.
