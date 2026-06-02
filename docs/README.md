# Metidos documentation

This directory contains the public operator and contributor documentation for Metidos. The root README is intentionally a concise overview; setup, tutorial, and installer details belong in `INSTALLATION.md` and the installer skill.

## Start here

- [Project overview](../README.md) — concise overview of what Metidos is and how the repository is organized.
- [Installation and first-run tutorial](../INSTALLATION.md) — canonical setup, first-run auth, local production, containers, providers, backups, and remote access.
- [Installer wizard skill](../.pi/skills/metidos-installation/SKILL.md) — plan-first interactive Docker/Podman/source installer workflow.
- [Troubleshooting](./troubleshooting.md) — common install, auth, provider, plugin, WebSocket, and runtime problems.

## How Metidos works

- [Architecture](./architecture.md) — backend, Mainview, Pi runtime, persistence, plugins, and data flows.
- [Backend](./backend.md) — Bun services, app-data layout, RPC surfaces, runtime assumptions, and validation.
- [Mainview](./mainview.md) — React/Tailwind architecture, design-system references, state management, and UI workflow.
- [RPC](./rpc.md) — typed WebSocket contract, auth/session behavior, request expectations, and errors.
- [Cron jobs](./cron.md) — scheduled agent jobs, run-now, disabling, deletion, failures, and plugin interactions.
- [Performance validation](./performance-validation.md) — repeatable local runtime and bounded-tool checks for performance-sensitive changes.
- [Manual QA checklist](./manual-qa-checklist.md) — end-to-end install, auth, provider, project, thread, diff, cron, plugin, settings, and diagnostics checks.

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
