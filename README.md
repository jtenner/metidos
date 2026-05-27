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

Installation and deployment guidance lives in:

- [`INSTALLATION.md`](INSTALLATION.md)
- [`.pi/skills/metidos-installation/SKILL.md`](.pi/skills/metidos-installation/SKILL.md)

Those guides cover local setup, provider configuration, integrations, reverse proxies, and Tailscale-style access.

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
- `docs/` — operator notes, plugin guides, decisions, and design references.
- `.pi/skills/` — repo-local agent skills for workflows such as commits, QA, research, installation, and plugin authoring.
- `.wiki/` — durable project knowledge and research notes.

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
