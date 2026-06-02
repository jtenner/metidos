# Generated Artifacts Audit — 2026-06-02

Scope: repository hygiene check for generated files, caches, build artifacts, logs, local database files, plugin runtime output, screenshots, temporary files, and derived outputs that should not be checked in before publishing Metidos as open source.

This audit is a source-control hygiene pass only. It does not replace the dedicated working-tree or Git-history secret scans tracked separately in `agent-todo.md`.

## Checks performed

- Reviewed `.gitignore` coverage for build outputs, dependency directories, local Metidos data, plugin runtime output, logs, databases, diagnostics, screenshots, local deployment files, and generated CSS.
- Checked for tracked files matching common generated-artifact patterns with `git ls-files` and extension/path filters.
- Checked for tracked files that currently match `.gitignore` with `git ls-files -ci --exclude-standard`.
- Reviewed the current ignored local-artifact inventory with `git status --ignored --short` to confirm local-only outputs are ignored rather than staged.
- Reviewed the largest tracked files to spot accidental bulky generated outputs.

## Findings

- No tracked file currently matches `.gitignore`.
- The generated-artifact pattern scan did not find tracked logs, temporary files, local SQLite/database files, screenshots, diagnostics, build directories, coverage outputs, `node_modules`, or generated CSS.
- The only tracked matches from the broad `.env` pattern are intentional example files:
  - `.env.example`
  - `.pi/skills/metidos-installation/assets/docker/.env.docker.example`
  - `deploy/podman/.env.podman.example`
- Ignored local artifacts are present on the developer machine, including `.env`, `.metidos/`, `.metidos-build/`, `.tmp*`, `node_modules/`, build `dist/` and `target/` directories, `reports/`, generated CSS, and local deployment files. They are ignored and not staged.
- The largest tracked files are source files, tests, fonts, lockfile data, SQLite C header source, and repo-owned image assets. The image assets still require the separate ownership/provenance review tracked in `agent-todo.md`.

## Conclusion

No accidental generated files, caches, logs, local databases, plugin runtime outputs, screenshots, temporary files, or derived outputs were found checked into the repository in this pass.

## Follow-ups still tracked elsewhere

- Run the dedicated working-tree secret scan.
- Run the dedicated Git-history secret scan.
- Review checked-in assets for ownership, provenance, license compatibility, and redistribution permission.
- Verify a clean clone works without relying on ignored local state.
