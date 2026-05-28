# Metidos

<p align="center">
  <img src="bird.png" alt="Pixel art owl mascot for Metidos" width="96" height="96">
</p>

Metidos is a local workspace for people who use AI coding agents.

It helps you keep projects, Git worktrees, agent threads, diffs, tasks, plugins, and scheduled jobs in one place—so you can focus on the work instead of juggling terminals and tabs.

The name comes from *mētis*: practical wisdom, good judgment, and knowing the right move at the right time.

## What you can do with it

- Open and manage multiple projects and Git worktrees.
- Start, monitor, and stop AI coding threads.
- Review file changes and diffs without leaving the app.
- Run project tasks and keep track of results.
- Create scheduled agent jobs with the cron workspace.
- Add approved local plugins for tools, notifications, model providers, browser helpers, GitHub, SQLite, vector search, and more.

## Who it is for

Metidos is for developers who work across many parallel coding threads and want a calmer way to coordinate them.

It is especially useful when you want to:

- keep long-running agent work visible,
- separate experiments into worktrees,
- review changes before they land,
- connect local tools safely,
- and preserve context across sessions.

## How it works, at a glance

Metidos has two main parts:

- **A local backend** built with Bun. It handles projects, worktrees, files, Git, plugins, scheduled jobs, persistence, and agent runtime orchestration.
- **A browser UI** built with React. It gives you the project, thread, task, plugin, cron, and diff views.

The UI and backend communicate through a typed WebSocket RPC layer, which keeps the app responsive while work happens in the background.

## Installation

Start with the canonical install docs:

- [`docs/getting-started.md`](docs/getting-started.md) for the shortest clean-clone path.
- [`docs/installation.md`](docs/installation.md) for local development, local production, containers, first-run auth, providers, backups, reverse proxies, and Tailscale-style access.
- [`INSTALLATION.md`](INSTALLATION.md) as a root-level pointer to the same canonical install entry point.

## Common development commands

```bash
bun run dev          # start the local development server
bun run start        # run the local server
bun run build:dev    # build an unminified development bundle
bun run build:prod   # build a production bundle
bun run validate     # run formatting, style, type, and test checks
bun run format       # format the repository
bun run typecheck    # run TypeScript checks
```

## Where things live

- `src/bun/` — backend, persistence, Git, RPC handlers, plugins, cron, and runtime orchestration.
- `src/mainview/` — browser UI.
- `docs/` — getting started, installation, architecture, security, plugin, development, and release docs.
- `.pi/skills/` — repo-local agent skills for workflows such as commits, QA, research, installation, and plugin authoring.
- `.wiki/` — durable project knowledge and research notes.

## Documentation

- [`docs/README.md`](docs/README.md) — documentation index.
- [`docs/architecture.md`](docs/architecture.md) — backend, Mainview, Pi runtime, persistence, plugin system, and data flows.
- [`docs/security-model.md`](docs/security-model.md) — auth, secrets, plugins, filesystem, network, remote access, backups, and safe issue reporting.
- [`docs/plugin-system.md`](docs/plugin-system.md) — Plugin System v1 overview.
- [`docs/development.md`](docs/development.md) — local contributor workflow and validation.
- [`docs/release-process.md`](docs/release-process.md) — release validation, tagging, notes, and rollback.

## Contributing

Before changing code, please check the relevant docs:

- `AGENTS.md` for repository guidance.
- `STYLE.md` before UI work.
- `UBIQUITOUS_LANGUAGE.md` for project terminology.
- `docs/operator-runbook.md` for common operations.

For code changes, run:

```bash
bun run validate
```

Metidos is meant to keep complex work understandable. Contributions should aim for that same goal: make the system easier to reason about, safer to operate, and friendlier to humans.
