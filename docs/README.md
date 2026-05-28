# Metidos documentation

This directory contains the public operator and contributor documentation for Metidos.

## Start here

- [Getting started](./getting-started.md) — shortest path from clean clone to first project and first agent thread.
- [Installation](./installation.md) — canonical setup, first-run auth, local production, and container notes.
- [Troubleshooting](./troubleshooting.md) — common install, auth, provider, plugin, WebSocket, and runtime problems.

## How Metidos works

- [Architecture](./architecture.md) — backend, Mainview, Pi runtime, persistence, plugins, and data flows.
- [Backend](./backend.md) — Bun services, app-data layout, RPC surfaces, runtime assumptions, and validation.
- [Mainview](./mainview.md) — React/Tailwind architecture, design-system references, state management, and UI workflow.
- [RPC](./rpc.md) — typed WebSocket contract, auth/session behavior, request expectations, and errors.
- [Cron jobs](./cron.md) — scheduled agent jobs, run-now, disabling, deletion, failures, and plugin interactions.

## Configuration and safety

- [Model providers](./model-providers.md) — provider setup, secrets, local/private providers, and safety expectations.
- [Security model](./security-model.md) — auth, secrets, plugins, filesystem, network, reverse proxy, backups, and safe issue reporting.
- [Security threat model](./security/threat-model.md) — assets, trust boundaries, abuse cases, and mitigations.
- [Plugin system](./plugin-system.md) — Plugin System v1 overview and links to authoring details.

## Contributors and release operators

- [Development](./development.md) — local dev setup, validation, tests, style, docs workflow, and debugging.
- [Release process](./release-process.md) — versioning, changelog, tagging, release notes, validation, and rollback expectations.
- [Repository publication checklist](./repository-publication-checklist.md) — GitHub metadata, public-readiness, safety, and repository settings checklist.
- [Glossary](./glossary.md) — canonical terms for projects, worktrees, threads, diffs, cron jobs, plugins, providers, approvals, and unsafe mode.

## Community and governance

- [Contributing](../CONTRIBUTING.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Security](../SECURITY.md)
- [Support](../SUPPORT.md)
- [Privacy](../PRIVACY.md)
- [Roadmap](../ROADMAP.md)
- [License](../LICENSE)

## Existing specialist references

- [Plugin authoring guide](./metidos-plugin-authoring-guide.md)
- [Plugin AGENTS.md guide](./metidos-plugin-agents-guide.md)
- [Plugin decisions](./metidos-plugin-decisions.md)
- [Operator runbook](./operator-runbook.md)
- [Backend RPC transport invariants](./backend-rpc-transport-invariants.md)
