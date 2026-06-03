# Installer skill dry-run verification — 2026-06-03

This note records a secret-safe dry-run of `.pi/skills/metidos-installation/SKILL.md` for the open-source launch checklist item: verify the installer wizard asks the expected questions, can emit a secret-safe `metidos-config.md` plan, and does not apply host changes before approval.

## Scope

- Reviewed the complete installer skill text in `.pi/skills/metidos-installation/SKILL.md`.
- Dry-ran the plan-first wizard path with disposable/fake answers only.
- Did **not** run Docker, Podman, Tailscale, npm, Codex, package installs, file-copy commands, or host mutation commands.
- Did **not** write a real root-level `metidos-config.md`, because that artifact is operator-specific install output and would be unsafe/noisy to commit from a cron dry-run.

## Dry-run scenario

Fake answers used to trace the wizard:

- Intent: generate an installation plan only.
- Detail level: recommended install.
- Install target: Docker.
- Runtime detection: Docker assumed present for branch tracing; no command was executed.
- Container name/image: `metidos`, `metidos:local`.
- Durable paths: `~/.metidos`, `~/.metidos/plugins`, `~/.metidos/cache`, `~/.metidos/.env`.
- Project access: current repository only, read/write.
- Network: port `7599`, bind `127.0.0.1`, localhost-only access.
- Base image: Bun and Zig required by the skill.
- Optional toolchains: none.
- Codex: no active subscription for the fake scenario.
- Core plugins/model providers: recommended/minimal fake selection, no real credentials.
- Environment variables: placeholders only; no secret values supplied.
- Telegram/Gmail: skipped.
- Permission profile: normal coding with approvals for risky actions.
- Cron/background agents: disabled.
- Updates/backups/diagnostics: manual/default plan entries only.
- Final action: export-only / do not install.

## Expected-question verification

The skill contains the required opening greeting and question flow:

- Starts with the required installer greeting.
- Asks whether the operator is installing now, generating a plan, or updating an install.
- Asks recommended vs advanced vs export-plan-only mode.
- Asks one primary install target question: Docker, Podman, or source.
- Branches container runtime detection before container-specific settings.
- Captures container names, durable paths, project mounts, port/bind address, toolchains, Codex, plugins, model providers, environment variable handling, integrations, safety profile, cron policy, remote access, and final review.
- Includes a condensed 46-item checklist that matches the detailed wizard flow.

Result: **pass** for expected question coverage in the documented wizard flow.

## Secret-safety verification

The skill repeatedly prohibits secret collection in chat and requires config output to omit or mask secret values:

- It tells the wizard to never ask the user to paste secrets into chat.
- API keys are collected as env var names, not values.
- Telegram/Gmail credential handling points to local secret prompts, env files, or placeholders rather than chat.
- `metidos-config.md` is required to include env var names and source types, but never raw secret values.
- Tailscale auth keys and other sensitive values are represented by env var names.

A secret-safe generated plan for the fake scenario would contain only placeholder/source metadata such as:

```markdown
## Environment variables

- Import mode: placeholders only
- Provider/API variables: none selected in this dry-run
- Secret values: omitted
```

Result: **pass** for documented secret-safety requirements.

## Host-mutation and approval-gate verification

The skill has an explicit plan-first contract:

- The prime directive says not to install, copy, generate, or mutate anything until required answers are gathered and the user approves the final plan.
- The wizard behavior contract says to pause for confirmation before filesystem/runtime actions.
- Step 21 requires a final plan review with choices to install, export only, edit answers, or cancel.
- Step 22 writes `metidos-config.md` only after approval or export-only selection.
- Step 23 applies installation only after explicit approval.

Result: **pass** for documented no-host-mutation-before-approval behavior.

## Config artifact shape checked

The required output artifact section and Step 22 define a human-readable Markdown `metidos-config.md` with sections for:

- install timestamp,
- container runtime and base image,
- optional toolchains,
- paths and mounts,
- networking/access,
- reverse proxy/Tailscale,
- core plugins,
- Codex,
- model providers and generated provider plugins,
- environment variables,
- Telegram/Gmail,
- permissions and safety,
- cron/background agents,
- updates/backups/diagnostics,
- calendar bootstrap/manual import,
- installation actions,
- validation checklist,
- next steps.

Result: **pass** for documented config shape and secret-safe fields.

## Outcome

The installer skill passes this dry-run/desk-check slice for public-readiness tracking. No live container install, source startup, Tailscale route, or root-level operator `metidos-config.md` was created in this slice.

Future work, if desired, should be tracked as a separate live disposable install smoke test rather than as installer-skill dry-run coverage.
