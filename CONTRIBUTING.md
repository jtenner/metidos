# Contributing

Thanks for helping make Metidos safer, clearer, and easier to operate.

## Development setup

Start with the install docs:

- [`docs/getting-started.md`](docs/getting-started.md)
- [`docs/installation.md`](docs/installation.md)

Common commands:

```bash
bun install
bun run dev
bun run validate
```

For focused checks, use the relevant package scripts from `package.json`, such as:

```bash
bun run typecheck
bun run test
bun run style:check
bun run toml:check
```

## Pull requests

Before opening a pull request:

- keep the change focused and reviewable,
- update docs when behavior, setup, security posture, public terminology, or user-visible workflows change,
- use fake/demo data in screenshots and fixtures,
- avoid committing generated files, caches, local databases, logs, plugin runtime output, App Data, or secrets,
- run `bun run validate` when practical,
- list any checks you skipped and why.

## Code and docs expectations

- Read `AGENTS.md` for repository guidance.
- Read `STYLE.md` before changing `src/mainview/` UI.
- Use `UBIQUITOUS_LANGUAGE.md` for canonical terminology.
- Keep docs plain, actionable, and aligned with current commands.
- Do not add private paths, private package references, internal URLs, credentials, or unsafe demo data.

## Security-sensitive changes

Call out changes that affect Local Auth, Sessions, WebSocket Tickets, step-up authentication, Provider Auth, plugin permissions, filesystem scope, network access, Unsafe Mode, diagnostics, telemetry, or logs.

Security vulnerabilities should be reported privately through [`SECURITY.md`](SECURITY.md), not public issues.
