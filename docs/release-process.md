# Release process

Metidos is pre-public/alpha software. This process describes how to prepare a tagged release once public release automation and repository settings are ready.

## Versioning

Use semantic-version-style tags with an explicit pre-release channel until the project declares stability:

```text
v0.1.0-alpha.1
v0.1.0-alpha.2
v0.1.0-beta.1
```

Before `1.0`, APIs, plugin contracts, RPC internals, and data formats may change. Public docs and release notes should state that clearly.

## Release inputs

A release should include:

- version tag,
- changelog entries,
- migration notes,
- validation result summary,
- known limitations,
- security notes,
- plugin API stability notes,
- rollback guidance.

## Pre-release checklist

From a clean checkout:

```bash
bun install --frozen-lockfile
bun run validate
bun run start
```

Manual checks:

- first-run auth setup,
- provider configuration with placeholders/private local values,
- project creation/opening,
- first safe Thread,
- diff review,
- cron create/run-now/disable/delete,
- plugin discovery/review/approval/disable/reset-data,
- settings screens,
- sanitized issue-reporting guidance,
- reverse-proxy/TLS docs if claiming support.

Security checks:

- working-tree secret scan,
- Git-history secret scan before publishing,
- private path/hostname review,
- docs and screenshots use fake/demo data,
- `.env.example` contains placeholders only,
- generated outputs and App Data are ignored,
- plugin examples contain fake secrets and safe URLs only.

## Changelog workflow

Until automated changelog generation exists, maintain a human-readable changelog section in the release notes or a future `CHANGELOG.md`.

Group changes by:

- Added,
- Changed,
- Fixed,
- Security,
- Docs,
- Internal.

Every entry should be useful to an operator or contributor. Avoid exposing private issue links or internal-only identifiers in public releases.

## Tagging

After validation and review:

```bash
git status --short
git tag -a v0.1.0-alpha.1 -m "Metidos v0.1.0-alpha.1"
git push origin v0.1.0-alpha.1
```

Use the actual chosen version. Do not tag from a dirty working tree.

## Release notes

Release notes should include:

- one-paragraph summary,
- install/update instructions,
- required Bun version,
- breaking changes and migrations,
- plugin API stability warning,
- security-sensitive changes,
- known limitations,
- validation commands run,
- rollback notes.

## Rollback expectations

Metidos stores local state in App Data. Rollback safety depends on data format compatibility.

Before upgrading:

1. Stop Metidos.
2. Back up App Data.
3. Back up private `.env` or secret-manager configuration.
4. Record current version/commit.
5. Upgrade and validate.

If rollback is needed:

1. Stop Metidos.
2. Restore the previous checkout or tag.
3. Restore the matching App Data backup if data migrations occurred.
4. Start Metidos.
5. Re-check plugin approvals and provider configuration.

## Artifact and log hygiene

Do not publish release artifacts that contain:

- `.env`,
- App Data,
- SQLite databases,
- telemetry sidecar DBs,
- plugin `.data`, `.logs`, or reset backups,
- local auth files,
- screenshots with private data,
- generated logs with secrets or host paths.

## Branch protection notes

Before public release, configure repository protections outside the codebase:

- require CI on pull requests,
- require review before merge,
- restrict force-pushes to the default branch,
- require status checks for validation workflows,
- protect release tags if available,
- keep security reporting private.

Document actual repository rules in release notes or repository settings docs once configured.
