# Screenshot privacy scan (2026-06-03)

Scope: public-facing README/feature screenshots under `docs/images/` plus README image references.

## Commands

```sh
git ls-files 'docs/images/*' README.md | sort
grep -RInE "!\\[[^]]*\\]\\([^)]*\\.(png|jpg|jpeg|gif|webp|svg)" README.md docs/*.md website/*.md 2>/dev/null | head -200
```

Marker scan used against tracked SVG screenshot text:

```sh
grep -RInE '(jtenner|/home/|Projects/|token|secret|password|sk-|ghp_|github_pat|localhost|127\\.0\\.0\\.1|internal|private|customer|user@|@[A-Za-z0-9._-]+|metidos-access|api[_-]?key)' docs/images --include='*.svg'
```

## Findings

Tracked screenshot/demo image files in scope:

- `docs/images/readme-hero-demo.svg`
- `docs/images/readme-feature-tour.svg`
- `docs/images/feature-project-worktree-demo.svg`
- `docs/images/feature-agent-thread-demo.svg`
- `docs/images/feature-diff-review-demo.svg`
- `docs/images/feature-plugin-admin-demo.svg`
- `docs/images/feature-provider-settings-demo.svg`
- `docs/images/feature-cron-workspace-demo.svg`

README image references point only at generated SVG demo artwork under `docs/images/`.

The marker scan found no real usernames, hostnames, tokens, internal repositories, local host paths, private branches, customer/user data, or real screenshots. Matches were self-descriptive safety copy such as "no private paths", "no tokens", "No secrets loaded", and a fake loopback endpoint `http://127.0.0.1:0000/demo` in the generated provider settings demo.

## Outcome

The screenshot privacy/public-readiness slice passes for the currently tracked README/feature screenshots. If future screenshots are added, repeat this scan and confirm new images are generated/fake or otherwise sanitized before publication.
