# Metidos

<p align="center">
  <img src="bird.png" alt="Pixel art owl mascot for Metidos" width="96" height="96">
</p>

Metidos is a local workspace for developers who use AI coding agents. It brings Projects, Git Worktrees, Threads, diffs, tasks, plugins, and scheduled jobs into one calmer place so you can focus on the work instead of juggling terminals and tabs.

The name comes from *mētis*: practical wisdom, good judgment, and knowing the right move at the right time.

## Status

Metidos is pre-1.0 local developer tooling. Expect rough edges, changing APIs, and incomplete public-release polish. Keep backups of important local data, review plugin and provider access carefully, and do not treat Unsafe Mode or unreviewed plugins as safe defaults.

## What Metidos is

Metidos combines:

- a local Bun backend for projects, Git, persistence, auth, plugins, scheduled jobs, and runtime orchestration;
- a Pi-powered agent runtime adapter for model selection, tools, sessions, and Thread execution;
- a React/Tailwind Mainview for managing work across Projects and Worktrees.

It is designed for one Local Operator running a local installation, not for hosted multi-tenant use.

## What Metidos helps with

- Coordinate many AI coding Threads across multiple Projects and Worktrees.
- Keep agent work, human edits, diffs, tasks, and cron jobs visible in one UI.
- Connect model providers and approved local plugins without hiding their permissions.
- Review file changes before they land.
- Preserve useful context across sessions while keeping local data under operator control.

## Core concepts

- **Projects** are high-level entries for one or more Git Worktrees.
- **Worktrees** are concrete Git checkout contexts where Threads and tools operate.
- **Threads** are Pi-powered agent execution sessions attached to a selected Project and Worktree.
- **Diffs** show changed files so agent or human edits can be reviewed before they are kept.
- **Cron Jobs** schedule future agent work.
- **Plugins** are local, review-first extension folders approved by the Local Operator.
- **Providers** connect Metidos and Pi to model services, including local, built-in, and plugin-backed providers.

## Safety and scope

Metidos is not a sandbox for arbitrary untrusted code, a replacement for code review and tests, or a stable plugin marketplace yet. Treat App Data, diagnostics, plugin-authored logs, provider credentials, and project paths as private local information.

## Documentation

The README is intentionally an overview. Setup, tutorial, and installer details live in the dedicated install guide and installer skill:

- [`INSTALLATION.md`](INSTALLATION.md) — canonical installation guide and first-run tutorial.
- [`.pi/skills/metidos-installation/SKILL.md`](.pi/skills/metidos-installation/SKILL.md) — interactive plan-first installer workflow.
- [`docs/README.md`](docs/README.md) — full documentation index.

Useful reference docs:

- [`docs/architecture.md`](docs/architecture.md) — system architecture and data flows.
- [`docs/security-model.md`](docs/security-model.md) — auth, secrets, plugins, filesystem, network, backups, and safe issue reporting.
- [`docs/plugin-system.md`](docs/plugin-system.md) — Plugin System v1 overview.
- [`docs/development.md`](docs/development.md) — contributor workflow, validation, and debugging.
- [`SUPPORT.md`](SUPPORT.md), [`SECURITY.md`](SECURITY.md), and [`ROADMAP.md`](ROADMAP.md) — support, disclosure, and project direction.

## Repository map

- `src/bun/` — backend, persistence, Git, RPC handlers, plugins, cron, and runtime orchestration.
- `src/mainview/` — browser UI.
- `core_plugins/` — first-party plugin source.
- `docs/` — operator, architecture, security, plugin, development, and release docs.
- `.pi/skills/` — repo-local agent skills for workflows such as installation, commits, QA, research, and plugin authoring.
- `.wiki/` — durable project knowledge and research notes.

## License

Metidos is released under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
