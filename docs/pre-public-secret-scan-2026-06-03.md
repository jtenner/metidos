# Pre-public secret scan evidence — 2026-06-03

## Scope

This note records a bounded recurring-agent slice for the final pre-public checklist item: working-tree and Git-history secret scans.

- Workspace: `/home/jtenner/Projects/jt-ide`
- Date: 2026-06-03
- Host tools available in this runtime:
  - `git version 2.47.3`
  - `ripgrep 14.1.1`
  - `gitleaks`: not installed
  - `trufflehog`: not installed
  - `git-secrets`: not installed

Because dedicated secret scanners were not installed in this workspace runtime, this slice performed a conservative regex-based scan with Git/ripgrep and leaves a follow-up to run a dedicated scanner before publication.

## Commands run

```sh
# Tool availability
command -v gitleaks >/dev/null 2>&1 && gitleaks version || echo 'gitleaks: not installed'
command -v trufflehog >/dev/null 2>&1 && trufflehog --version || echo 'trufflehog: not installed'
command -v git-secrets >/dev/null 2>&1 && git-secrets --version || echo 'git-secrets: not installed'
rg --version | head -n1
git --version

# High-signal provider/token patterns in tracked files and commit history.
patterns=(
  'AKIA[0-9A-Z]{16}'
  'ASIA[0-9A-Z]{16}'
  'ghp_[A-Za-z0-9_]{30,}'
  'github_pat_[A-Za-z0-9_]{40,}'
  'sk-(proj-)?[A-Za-z0-9_-]{20,}'
  'xox[baprs]-[A-Za-z0-9-]{20,}'
)
for p in "${patterns[@]}"; do
  git grep -nI -E "$p" -- . ':!bun.lock' || true
  git log --all --oneline -G"$p" -- . ':!bun.lock' || true
done

# Environment-file and private-key block checks.
git ls-files | grep -E '(^|/)\.env($|\.)|(^|/)env\.' | grep -Ev '(example|sample|template|docs/)' || true
git grep -nI -E -e '-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----' -- . ':!bun.lock' || true
git log --all --oneline -G'-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----' -- . ':!bun.lock' || true

# Generic secret-like assignments outside Markdown/docs/examples; file names only to avoid printing values.
git grep -Il -E '(password|passwd|token|secret|api[_-]?key)[A-Za-z0-9_ -]{0,30}[:=][[:space:]]*["'"''][^"'"'']{8,}' -- . ':!docs/**' ':!**/*.md' ':!**/*.example' ':!**/*.sample' ':!bun.lock' || true
```

## Results

- No matches were found for the checked AWS access key, GitHub token, OpenAI-style API key, Slack token, or private-key block patterns in tracked files or Git history.
- No checked-in `.env` files were found outside expected source/test files named `env.ts` / `env.test.ts`.
- The generic assignment scan returned source and test files that contain fixture credentials, placeholder tokens, encrypted-token plumbing, or configuration schema code. This slice did not identify a real secret in that list, but a dedicated scanner should still be run before publication.

## Follow-up

Before marking the final pre-public secret-scan checklist item complete, run at least one dedicated scanner such as `gitleaks detect --source . --no-banner` or an equivalent CI-backed scanner on the full working tree and Git history. Commit a short sanitized evidence note with scanner name/version, command, pass/fail status, and any resolved findings.
