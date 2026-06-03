# Roadmap

Metidos is pre-1.0 local developer tooling for one Local Operator. The current priority is getting the repository and first-run experience ready for a public 0.1.0 release while keeping security, plugin review, and local-data boundaries explicit.

## Current status

- **Release phase:** pre-1.0 / public-readiness hardening.
- **Primary user:** a developer running Metidos locally against their own Projects and Worktrees.
- **Stability expectation:** APIs, plugin contracts, settings, and UI flows may change before 1.0.
- **Safety expectation:** Safe Mode is the default for Threads and Cron Jobs; Unsafe Mode and unreviewed Plugins require careful Local Operator review.

## Before 0.1.0 public release

- Finish public repository hygiene checks, including asset provenance, secret-scan evidence, and GitHub settings review.
- Verify install and first-run paths from clean disposable setups, including Local Auth, provider-free startup, fake-provider setup, and backup/restore guidance.
- Smoke core product workflows with fake or disposable data: Projects, Worktrees, Threads, Diffs, Cron Jobs, Plugins, and major error states.
- Keep README, installation docs, support, security, and known-limitations guidance aligned with the actual pre-1.0 behavior.

## After 0.1.0 release

- More first-party and community Plugins.
- Public Docker container.
- Expanded automated and smoke-test coverage.
- Stabilized Plugin System and RPC APIs.
- Approved plugin support for registering and executing sandboxed shell commands through the plugin sidecar.
- External harness support, such as Claude Code, Cursor, OpenCode, and similar tools.
- More settings, including default Thread permissions.
- Project configuration using JSON, YAML, or TOML.
